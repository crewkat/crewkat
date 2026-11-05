// Doc-only document saves (Danny, 2026-10-15).
//
// Danny's decision: "Build true doc-only edits — client record never
// changes from a document." Before this build, saveQuote / saveInvoice ran
// upsertClient: saving an estimate or invoice UPDATED the matched client
// record from the document's fields (or CREATED a record when none
// matched), so "a different address for this one job" silently rewrote the
// client's profile. Now the two document handlers keep args.clientId as a
// link only and persist exactly the snapshot fields entered in the sheet.
//
// Covers:
//  1. Picked client + edited snapshot on saveQuote: the clients-table row
//     is byte-identical afterwards (updatedAt included) and the quote
//     carries the edited snapshot + the clientId link.
//  2. Same for saveInvoice.
//  3. Typed-in name with no pick (clientId null): NO client row is created
//     — not even when the typed name matches an existing client — and the
//     document keeps clientId null + its snapshot.
//  4. Quote -> invoice conversion preserves the quote's (edited) snapshot
//     and writes no client.
//  5. Read path: listInvoices shapes the converted invoice from its own
//     snapshot (the edited address), not the client record.
//  6. Divergence pin: the JOB path still owns the client record —
//     createJob with a typed new name still creates the client, and
//     updateJob still keeps the record current (jobs are not documents).
//  7. Static guards: `await upsertClient` survives ONLY in createJob /
//     updateJob / prepareLeadQuote; saveQuote / saveInvoice contain no
//     upsertClient call and no clients-table insert/update.
//  8. Deposit round trip through the PRODUCTION response path: reads go
//     through action.response.safeParse exactly as server.mjs's
//     dispatchAction applies it (the client only ever sees the parsed
//     data — zod strips undeclared keys), and the edit-save echoes the
//     parsed payload the way FinancialEditor does (App.tsx save:
//     depositType: document.depositType ?? "none"). A percent deposit on
//     a quote and a fixed deposit on an invoice (via conversion) must
//     survive list -> edit -> list unchanged; none stays none.
//
// Run from app/:  bun doc-only-saves.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// --- Scratch DB + ctx -----------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-doc-only-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  slug: "tradesign",
  invocationId: "doc-only-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => { throw new Error("unexpected privileged call"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;
const A = BaseActions as any;

await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "DocOnly Co", updatedAt: new Date() });

// The pre-existing client record (as if created on the Clients screen).
const [anthony] = await db.insert(schema.clients).values({
  companyId: 1, name: "Anthony Porreca", phone: "(813) 555-0100", email: "anthony@example.com",
  address: "100 Original Ave, Clearwater, FL", notes: "Garage conversion", tags: "[]",
  createdAt: new Date(), updatedAt: new Date(),
}).returning();
const anthonyId = anthony!.id;

const clientRowJson = async (id: number) => {
  const row = (await db.select().from(schema.clients).where(eq(schema.clients.id, id)).limit(1))[0];
  return JSON.stringify(row ?? null);
};
const clientCount = async () => (await db.select({ id: schema.clients.id }).from(schema.clients)).length;
const anthonyBefore = await clientRowJson(anthonyId);
const countBefore = await clientCount();

const docFields = {
  jobId: null, clientPhone: "(813) 555-0199", clientEmail: "anthony.new@example.com",
  shippingAddress: "", jobType: "Garage conversion",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a",
};
const line = [{ name: "Paneling", description: "Walnut-look wall paneling", amount: "1000.00", quantity: 1 }];

// --- 1. saveQuote: picked client + edited address -> record untouched -----------
const quote = await A.saveQuote.handler(ctx, {
  ...docFields, clientId: anthonyId, clientName: "Anthony Porreca",
  jobAddress: "200 Jobsite Rd, Clearwater, FL", // different address, this doc only
  lineItems: line, subtotal: "1000.00", total: "1000.00",
  expiryDate: "", sentAt: "", depositType: "none", depositValue: "0", materials: [],
});
check("saveQuote: client row byte-identical after save with edited address", (await clientRowJson(anthonyId)) === anthonyBefore);
check("saveQuote: no client created", (await clientCount()) === countBefore);
const quoteRow = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, quote.id)).limit(1))[0]!;
check("saveQuote: quote keeps the clientId link", quoteRow.clientId === anthonyId, String(quoteRow.clientId));
check("saveQuote: quote snapshot carries the EDITED address", quoteRow.jobAddress === "200 Jobsite Rd, Clearwater, FL", quoteRow.jobAddress);
check("saveQuote: quote snapshot carries the edited phone/email", quoteRow.clientPhone === "(813) 555-0199" && quoteRow.clientEmail === "anthony.new@example.com");

// --- 2. saveInvoice: same invariants ---------------------------------------------
const invoice = await A.saveInvoice.handler(ctx, {
  ...docFields, clientId: anthonyId, clientName: "Anthony Porreca",
  jobAddress: "300 Invoice Blvd, Clearwater, FL",
  invoiceNumber: "", quoteId: null, lineItems: line, subtotal: "1000.00", total: "1000.00",
  issueDate: "2026-10-15", dueDate: "", status: "draft",
  recurringFrequency: "none", nextDueDate: "", recurringEndDate: "",
});
check("saveInvoice: client row byte-identical after save with edited address", (await clientRowJson(anthonyId)) === anthonyBefore);
check("saveInvoice: no client created", (await clientCount()) === countBefore);
const invoiceRow = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.id)).limit(1))[0]!;
check("saveInvoice: invoice keeps the clientId link + edited snapshot", invoiceRow.clientId === anthonyId && invoiceRow.jobAddress === "300 Invoice Blvd, Clearwater, FL");

// --- 3. Typed name, no pick: NO record — even on an exact name match --------------
const typed = await A.saveQuote.handler(ctx, {
  ...docFields, clientId: null, clientName: "Anthony Porreca", // same name as the record
  jobAddress: "400 Typed Ln, Clearwater, FL",
  lineItems: line, subtotal: "1000.00", total: "1000.00",
  expiryDate: "", sentAt: "", depositType: "none", depositValue: "0", materials: [],
});
check("typed match: client row still byte-identical (no silent update)", (await clientRowJson(anthonyId)) === anthonyBefore);
check("typed match: no client created", (await clientCount()) === countBefore);
const typedRow = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, typed.id)).limit(1))[0]!;
check("typed match: quote clientId stays null (snapshot only)", typedRow.clientId === null, String(typedRow.clientId));
check("typed match: quote snapshot keeps the typed fields", typedRow.clientName === "Anthony Porreca" && typedRow.jobAddress === "400 Typed Ln, Clearwater, FL");

const brandNew = await A.saveInvoice.handler(ctx, {
  ...docFields, clientId: null, clientName: "Never Seen Before",
  jobAddress: "500 Fresh St, Tampa, FL",
  invoiceNumber: "", quoteId: null, lineItems: line, subtotal: "1000.00", total: "1000.00",
  issueDate: "2026-10-15", dueDate: "", status: "draft",
  recurringFrequency: "none", nextDueDate: "", recurringEndDate: "",
});
check("typed new name: no client row created by an invoice either", (await clientCount()) === countBefore);
const brandNewRow = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, brandNew.id)).limit(1))[0]!;
check("typed new name: invoice clientId null + snapshot kept", brandNewRow.clientId === null && brandNewRow.clientName === "Never Seen Before");

// --- 4. Conversion preserves the (edited) snapshot, writes no client -------------
const converted = await A.convertQuoteToInvoice.handler(ctx, { quoteId: quote.id, today: "2026-10-15" });
check("conversion: client row byte-identical", (await clientRowJson(anthonyId)) === anthonyBefore);
check("conversion: no client created", (await clientCount()) === countBefore);
const convertedRow = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, converted.invoiceId)).limit(1))[0]!;
check("conversion: invoice inherits the quote's EDITED address", convertedRow.jobAddress === "200 Jobsite Rd, Clearwater, FL", convertedRow.jobAddress);
check("conversion: invoice keeps the clientId link", convertedRow.clientId === anthonyId);

// --- 5. Read path shapes from the document snapshot --------------------------------
const listed = await A.listInvoices.handler(ctx, {});
const shaped = listed.invoices.find((i: any) => i.id === converted.invoiceId);
check("read path: listInvoices shows the document's own snapshot address", shaped?.jobAddress === "200 Jobsite Rd, Clearwater, FL", shaped?.jobAddress);
check("read path: shaped snapshot did NOT resolve the record's original address", shaped?.jobAddress !== "100 Original Ave, Clearwater, FL");

// --- 6. Divergence pin: the JOB path still owns the client record ------------------
const jobArgs = { clientPhone: "", clientEmail: "", notes: "", jobDate: "2026-10-20", appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "" };
const job = await A.createJob.handler(ctx, { ...jobArgs, clientId: null, clientName: "Job Path Client", clientPhone: "(813) 555-7777", jobAddress: "700 Job Way", jobType: "Kitchen remodel" });
check("job path: createJob with a typed name still CREATES the client (jobs are not documents)", (await clientCount()) === countBefore + 1);
const jobRow = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).limit(1))[0]!;
check("job path: the job links the created client", typeof jobRow.clientId === "number" && jobRow.clientId !== anthonyId);
const jobClientBefore = await clientRowJson(jobRow.clientId!);
await A.updateJob.handler(ctx, { id: job.id, clientId: jobRow.clientId, clientName: "Job Path Client", clientPhone: "(813) 555-7777", clientEmail: "", jobAddress: "701 Moved Way", jobType: "Kitchen remodel", notes: "", jobDate: "2026-10-20", appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "", galleryPick: false });
check("job path: updateJob still keeps the client record current", (await clientRowJson(jobRow.clientId!)) !== jobClientBefore);

// --- 7. Static guards ---------------------------------------------------------------
const serverSrc = await readFile("server/src/actions.ts", "utf8");
const upsertCalls = serverSrc.match(/await upsertClient\(ctx/g) ?? [];
check("static: exactly 4 upsertClient calls survive (createJob, updateJob, prepareLeadQuote, convertLeadToJob)", upsertCalls.length === 4, String(upsertCalls.length));
const quoteHandler = serverSrc.slice(serverSrc.indexOf("saveQuote: defineAction"), serverSrc.indexOf("convertQuoteToJob: defineAction"));
const invoiceHandler = serverSrc.slice(serverSrc.indexOf("saveInvoice: defineAction"), serverSrc.indexOf("convertQuoteToInvoice: defineAction"));
check("static: saveQuote handler makes no upsertClient call / clients-table write", !quoteHandler.includes("upsertClient(ctx") && !quoteHandler.includes("insert(schema.clients") && !quoteHandler.includes("update(schema.clients"));
check("static: saveInvoice handler makes no upsertClient call / clients-table write", !invoiceHandler.includes("upsertClient(ctx") && !invoiceHandler.includes("insert(schema.clients") && !invoiceHandler.includes("update(schema.clients"));

// --- 8. Deposit round trip through the production response path -------------------
// server.mjs dispatchAction: parsedArgs = action.request.safeParse(args);
// result = handler(ctx, parsedArgs); the client receives
// action.response.safeParse(result).data — never the raw handler result.
// These helpers reproduce that seam exactly; sections 1-7 call handlers
// directly and cannot see response-schema stripping (the Nov 1 INV-0048
// lesson, and the original deposit-wipe bug: quoteShape/invoiceShape and
// quoteSchema/invoiceSchema both omitted depositType/depositValue, so the
// editor's echo-save sent none/"0" and updateQuoteDocument overwrote the
// stored deposit on every edit).
const listQuotesViaResponse = async () => A.listQuotes.response.safeParse(await A.listQuotes.handler(ctx, {}));
const listInvoicesViaResponse = async () => A.listInvoices.response.safeParse(await A.listInvoices.handler(ctx, {}));
const dispatchUpdate = async (action: any, payload: any) => {
  const parsedArgs = action.request.safeParse(payload);
  if (!parsedArgs.success) return { ok: false, error: parsedArgs.error.message };
  const result = await action.handler(ctx, parsedArgs.data);
  const parsedResult = action.response.safeParse(result);
  return parsedResult.success ? { ok: true, error: "" } : { ok: false, error: parsedResult.error.message };
};
const echoLine = { name: "Paneling", description: "Walnut-look wall paneling — revised", amount: "1100.00", quantity: 1, discount: "0", unit: "none" as const };

// 8a. Quote with a PERCENT deposit.
const pctQuote = await A.saveQuote.handler(ctx, {
  ...docFields, clientId: anthonyId, clientName: "Anthony Porreca",
  jobAddress: "600 Deposit Way, Clearwater, FL",
  lineItems: line, subtotal: "1000.00", total: "1000.00",
  expiryDate: "", sentAt: "", depositType: "percent", depositValue: "25", materials: [],
  showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true, showFooterNotes: true, showLogo: true, showCompanyInfo: true,
});
const pctRow = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, pctQuote.id)).limit(1))[0]!;
check("deposit setup: percent quote stored as percent/25.00", pctRow.depositType === "percent" && pctRow.depositValue === "25.00", `${pctRow.depositType}/${pctRow.depositValue}`);
const listedPct1 = await listQuotesViaResponse();
check("response path: listQuotes result parses against its response schema", listedPct1.success, listedPct1.success ? "" : listedPct1.error.message);
const listedPctQuote = listedPct1.success ? listedPct1.data.quotes.find((q: any) => q.id === pctQuote.id) : undefined;
check("response path: listQuotes payload carries the percent deposit", listedPctQuote?.depositType === "percent" && listedPctQuote?.depositValue === "25.00", `${listedPctQuote?.depositType}/${listedPctQuote?.depositValue}`);
// The edit-save, built from the parsed payload exactly as FinancialEditor
// builds it (App.tsx): only line items change; the deposit is echoed from
// the document object the list delivered.
const pctSave = await dispatchUpdate(A.updateQuoteDocument, {
  id: listedPctQuote.id, lineItems: [echoLine],
  discountType: listedPctQuote.discountType, discountValue: listedPctQuote.discountValue,
  taxType: listedPctQuote.taxType, taxValue: listedPctQuote.taxValue,
  subtotal: "1100.00", total: "1100.00", footnote: listedPctQuote.footnote,
  depositType: listedPctQuote.depositType ?? "none", depositValue: listedPctQuote.depositValue ?? "0",
});
check("deposit round trip: quote edit-save dispatches cleanly", pctSave.ok, pctSave.error);
const pctRowAfter = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, pctQuote.id)).limit(1))[0]!;
check("deposit round trip: stored percent deposit survives the edit", pctRowAfter.depositType === "percent" && pctRowAfter.depositValue === "25.00", `${pctRowAfter.depositType}/${pctRowAfter.depositValue}`);
const listedPct2 = await listQuotesViaResponse();
const listedPctQuote2 = listedPct2.success ? listedPct2.data.quotes.find((q: any) => q.id === pctQuote.id) : undefined;
check("deposit round trip: re-listed quote still shows percent/25.00", listedPctQuote2?.depositType === "percent" && listedPctQuote2?.depositValue === "25.00", `${listedPctQuote2?.depositType}/${listedPctQuote2?.depositValue}`);

// 8b. Invoice with a FIXED deposit (inherited through quote conversion —
// the production path by which invoices acquire deposits).
const fixedQuote = await A.saveQuote.handler(ctx, {
  ...docFields, clientId: anthonyId, clientName: "Anthony Porreca",
  jobAddress: "610 Deposit Way, Clearwater, FL",
  lineItems: line, subtotal: "1000.00", total: "1000.00",
  expiryDate: "", sentAt: "", depositType: "fixed", depositValue: "500", materials: [],
  showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true, showFooterNotes: true, showLogo: true, showCompanyInfo: true,
});
const fixedConverted = await A.convertQuoteToInvoice.handler(ctx, { quoteId: fixedQuote.id, today: "2026-10-15" });
const fixedInvRow = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, fixedConverted.invoiceId)).limit(1))[0]!;
check("deposit setup: converted invoice inherits fixed/500.00", fixedInvRow.depositType === "fixed" && fixedInvRow.depositValue === "500.00", `${fixedInvRow.depositType}/${fixedInvRow.depositValue}`);
const listedFixed1 = await listInvoicesViaResponse();
check("response path: listInvoices result parses against its response schema", listedFixed1.success, listedFixed1.success ? "" : listedFixed1.error.message);
const listedFixedInv = listedFixed1.success ? listedFixed1.data.invoices.find((i: any) => i.id === fixedConverted.invoiceId) : undefined;
check("response path: listInvoices payload carries the fixed deposit", listedFixedInv?.depositType === "fixed" && listedFixedInv?.depositValue === "500.00", `${listedFixedInv?.depositType}/${listedFixedInv?.depositValue}`);
const fixedSave = await dispatchUpdate(A.updateInvoiceDocument, {
  id: listedFixedInv.id, lineItems: [echoLine], issueDate: listedFixedInv.issueDate, dueDate: listedFixedInv.dueDate,
  discountType: listedFixedInv.discountType, discountValue: listedFixedInv.discountValue,
  taxType: listedFixedInv.taxType, taxValue: listedFixedInv.taxValue,
  subtotal: "1100.00", total: "1100.00", footnote: listedFixedInv.footnote,
  depositType: listedFixedInv.depositType ?? "none", depositValue: listedFixedInv.depositValue ?? "0",
});
check("deposit round trip: invoice edit-save dispatches cleanly", fixedSave.ok, fixedSave.error);
const fixedInvRowAfter = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, fixedConverted.invoiceId)).limit(1))[0]!;
check("deposit round trip: stored fixed deposit survives the edit", fixedInvRowAfter.depositType === "fixed" && fixedInvRowAfter.depositValue === "500.00", `${fixedInvRowAfter.depositType}/${fixedInvRowAfter.depositValue}`);
const listedFixed2 = await listInvoicesViaResponse();
const listedFixedInv2 = listedFixed2.success ? listedFixed2.data.invoices.find((i: any) => i.id === fixedConverted.invoiceId) : undefined;
check("deposit round trip: re-listed invoice still shows fixed/500.00", listedFixedInv2?.depositType === "fixed" && listedFixedInv2?.depositValue === "500.00", `${listedFixedInv2?.depositType}/${listedFixedInv2?.depositValue}`);

// 8c. No deposit stays no deposit (the section-1 quote was saved none/"0").
const listedNone1 = await listQuotesViaResponse();
const listedNoneQuote = listedNone1.success ? listedNone1.data.quotes.find((q: any) => q.id === quote.id) : undefined;
check("response path: deposit-free quote lists as none/0.00", listedNoneQuote?.depositType === "none" && listedNoneQuote?.depositValue === "0.00", `${listedNoneQuote?.depositType}/${listedNoneQuote?.depositValue}`);
const noneSave = await dispatchUpdate(A.updateQuoteDocument, {
  id: listedNoneQuote.id, lineItems: [echoLine],
  discountType: listedNoneQuote.discountType, discountValue: listedNoneQuote.discountValue,
  taxType: listedNoneQuote.taxType, taxValue: listedNoneQuote.taxValue,
  subtotal: "1100.00", total: "1100.00", footnote: listedNoneQuote.footnote,
  depositType: listedNoneQuote.depositType ?? "none", depositValue: listedNoneQuote.depositValue ?? "0",
});
check("deposit round trip: none edit-save dispatches cleanly", noneSave.ok, noneSave.error);
const noneRowAfter = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, quote.id)).limit(1))[0]!;
check("deposit round trip: none stays none after the edit", noneRowAfter.depositType === "none" && noneRowAfter.depositValue === "0.00", `${noneRowAfter.depositType}/${noneRowAfter.depositValue}`);

// 8d. Static pins: the schema declares the fields and both shapes emit them.
const finSchemaSrc = serverSrc.slice(serverSrc.indexOf("const financialFieldsSchema"), serverSrc.indexOf("const quoteSchema"));
check("static: financialFieldsSchema declares depositType/depositValue", finSchemaSrc.includes("depositType: depositTypeSchema") && finSchemaSrc.includes("depositValue: z.string()"));
const quoteShapeSrc = serverSrc.slice(serverSrc.indexOf("function quoteShape"), serverSrc.indexOf("function quoteShape") + 4000);
const invoiceShapeSrc = serverSrc.slice(serverSrc.indexOf("function invoiceShape"), serverSrc.indexOf("function invoiceShape") + 6000);
check("static: quoteShape emits depositType/depositValue", quoteShapeSrc.includes("depositType: q.depositType") && quoteShapeSrc.includes("depositValue: q.depositValue"));
check("static: invoiceShape emits depositType/depositValue", invoiceShapeSrc.includes("depositType: row.depositType") && invoiceShapeSrc.includes("depositValue: row.depositValue"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
