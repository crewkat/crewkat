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
check("static: exactly 3 upsertClient calls survive (createJob, updateJob, prepareLeadQuote)", upsertCalls.length === 3, String(upsertCalls.length));
const quoteHandler = serverSrc.slice(serverSrc.indexOf("saveQuote: defineAction"), serverSrc.indexOf("convertQuoteToJob: defineAction"));
const invoiceHandler = serverSrc.slice(serverSrc.indexOf("saveInvoice: defineAction"), serverSrc.indexOf("convertQuoteToInvoice: defineAction"));
check("static: saveQuote handler makes no upsertClient call / clients-table write", !quoteHandler.includes("upsertClient(ctx") && !quoteHandler.includes("insert(schema.clients") && !quoteHandler.includes("update(schema.clients"));
check("static: saveInvoice handler makes no upsertClient call / clients-table write", !invoiceHandler.includes("upsertClient(ctx") && !invoiceHandler.includes("insert(schema.clients") && !invoiceHandler.includes("update(schema.clients"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
