// Numbers integrity (Crewkat audit Batch 2, 2026-11-05).
//
// The audit found the app's money/number/follow-up surfaces disagreeing
// with each other because each computed its own version of the truth:
//  1. An overpaid invoice ($1.00 total, four $1.00 payments) displayed
//     "Paid $4.00" in the app, counted differently in Office, and
//     printed "-$4.00 Amount paid" on the generated document. The shape
//     now carries paidApplied (capped at the amount owed) + credit, and
//     every surface derives from them. This suite pins the SHAPE through
//     the production response path (action.response.safeParse, exactly
//     as server.mjs applies it) so an undeclared field can never be
//     silently stripped again.
//  2. Invoice numbers collided across the import/native boundary
//     (imported "INV0015" vs native "INV-0015") and the native sequence
//     derived from max(invoice id) across ALL companies. Numbers are
//     now canonical, per-company, stored-number-aware, and
//     collision-rejecting.
//  3. "Overdue" had three definitions; two lacked a balance check, so
//     settled invoices counted as overdue. One shared definition now.
//  4. The follow-up queue is a persisted table whose cards froze at
//     creation; the queue now reconciles open automation items against
//     live state on load (paid invoice / accepted estimate items
//     resolve themselves).
//  5. Duplicate clients get an explicit merge (re-point + fold +
//     delete), and ALL-CAPS names are title-cased on save.
//  6. The retired legacy price-book actions are gone.
//
// Run from app/:  bun numbers-integrity.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
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

const dir = await mkdtemp(join(tmpdir(), "crewkat-numbers-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  slug: "tradesign",
  invocationId: "numbers-test",
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
  workspaceTier: "premium",
} as any;
const A = BaseActions as any;

await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Numbers Co", updatedAt: new Date() });
// The free-tier invoice cap reads the owner user's tier — run as premium.
await db.insert(schema.authUsers).values({ id: 1, companyId: 1, name: "Owner", email: "owner@test.local", passwordHash: "x", passwordSalt: "x", tier: "premium", createdAt: new Date(), updatedAt: new Date() });

const dayMs = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * dayMs));
const today = iso(new Date());

const docFields = {
  jobId: null, clientPhone: "", clientEmail: "",
  shippingAddress: "", jobType: "Remodel",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a",
};
const line = [{ name: "Work", description: "Work item", amount: "100.00", quantity: 1 }];
const makeInvoice = async (over: Record<string, unknown> = {}) => {
  const made = await A.saveInvoice.handler(ctx, {
    ...docFields, clientId: null, clientName: "Test Client", jobAddress: "1 Main St",
    invoiceNumber: "", quoteId: null, lineItems: line, subtotal: "100.00", total: "100.00",
    issueDate: today, dueDate: "", status: "draft",
    recurringFrequency: "none", nextDueDate: "", recurringEndDate: "",
    ...over,
  });
  return made.id as number;
};
const invoiceRow = async (id: number) => (await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1))[0]!;
const listInvoicesParsed = async () => {
  const parsed = A.listInvoices.response.safeParse(await A.listInvoices.handler(ctx, {}));
  if (!parsed.success) throw new Error(`listInvoices response failed safeParse: ${parsed.error.message}`);
  return parsed.data.invoices as Array<any>;
};

// --- 1. Overpayment: applied + credit through the production response path -----
const tinyId = await makeInvoice({ lineItems: [{ name: "Test", description: "One dollar test", amount: "1.00", quantity: 1 }], subtotal: "1.00", total: "1.00", status: "sent" });
for (let i = 0; i < 4; i++) {
  await db.insert(schema.payments).values({ companyId: 1, invoiceId: tinyId, amount: "1.00", paymentDate: today, method: "Card", note: "", createdAt: new Date() });
}
const shaped = (await listInvoicesParsed()).find((i) => i.id === tinyId);
check("overpaid: paidToDate keeps the true ledger sum", shaped?.paidToDate === "4.00", shaped?.paidToDate);
check("overpaid: paidApplied caps at the amount owed (survives safeParse)", shaped?.paidApplied === "1.00", shaped?.paidApplied);
check("overpaid: credit surfaces the excess (survives safeParse)", shaped?.credit === "3.00", shaped?.credit);
check("overpaid: balanceRemaining is 0.00", shaped?.balanceRemaining === "0.00", shaped?.balanceRemaining);

// --- 2. Invoice numbers ---------------------------------------------------------
const firstId = await makeInvoice();
const firstNumber = (await invoiceRow(firstId)).invoiceNumber;
check("numbering: native save stores a canonical INV-#### number", /^INV-\d{4,}$/.test(firstNumber), firstNumber);
// A legacy imported row, stored verbatim the old way.
const [legacy] = await db.insert(schema.invoices).values({
  companyId: 1, invoiceNumber: "INV0015", clientName: "Legacy Import", clientPhone: "", clientEmail: "",
  jobAddress: "", jobType: "", lineItemsJson: "[]", subtotal: "50.00", discountType: "fixed", discountValue: "0.00",
  taxType: "fixed", taxValue: "0.00", total: "50.00", footnote: "", issueDate: today, dueDate: "", status: "sent",
  createdAt: new Date(), updatedAt: new Date(),
}).returning();
check("numbering: legacy fixture stored", legacy!.invoiceNumber === "INV0015");
const afterLegacyId = await makeInvoice();
const afterLegacyNumber = (await invoiceRow(afterLegacyId)).invoiceNumber;
check("numbering: sequence steps over numbers an import already used", Number(afterLegacyNumber.replace(/\D/g, "")) > 15, afterLegacyNumber);
let collisionError = "";
try { await makeInvoice({ invoiceNumber: "INV-0015" }); } catch (e) { collisionError = (e as Error).message; }
check("numbering: dashed collision with the imported number is rejected", /already in use/.test(collisionError), collisionError);
collisionError = "";
try { await makeInvoice({ invoiceNumber: "INV0015" }); } catch (e) { collisionError = (e as Error).message; }
check("numbering: undashed spelling of the same number is rejected too", /already in use/.test(collisionError), collisionError);
const typedId = await makeInvoice({ invoiceNumber: "INV0101" });
check("numbering: a user-typed undashed number is stored canonicalized", (await invoiceRow(typedId)).invoiceNumber === "INV-0101", (await invoiceRow(typedId)).invoiceNumber);
let updateError = "";
try {
  await A.updateInvoiceDocument.handler(ctx, { id: firstId, invoiceNumber: "INV-0101", lineItems: line, discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0", subtotal: "100.00", total: "100.00", footnote: "", depositType: "none", depositValue: "0" });
} catch (e) { updateError = (e as Error).message; }
check("numbering: edit-save cannot steal another invoice's number", /already in use/.test(updateError), updateError);

// --- 3. One overdue definition ----------------------------------------------------
const settledId = await makeInvoice({ total: "500.00", subtotal: "500.00", lineItems: [{ name: "Work", description: "Big job", amount: "500.00", quantity: 1 }], status: "sent", dueDate: daysAgo(2) });
await db.insert(schema.payments).values({ companyId: 1, invoiceId: settledId, amount: "500.00", paymentDate: today, method: "Cash", note: "", createdAt: new Date() });
const openId = await makeInvoice({ total: "500.00", subtotal: "500.00", lineItems: [{ name: "Work", description: "Big job", amount: "500.00", quantity: 1 }], status: "sent", dueDate: daysAgo(2) });
const dash = await A.getDashboard.handler(ctx, {});
check("overdue: fully-paid-but-unflipped invoice is NOT overdue on the dashboard", dash.overdueCount === 1, `overdueCount=${dash.overdueCount}`);
const officeDash = await A.getOfficeDashboard.handler(ctx, {});
check("overdue: Office dashboard lists only the genuinely overdue invoice", officeDash.overdueInvoices.length === 1 && officeDash.overdueInvoices[0].id === openId, JSON.stringify(officeDash.overdueInvoices.map((i: any) => i.id)));

// --- 4. Follow-up queue reconciles against live state ------------------------------
const fuInvoiceId = await makeInvoice({ total: "60.00", subtotal: "60.00", lineItems: [{ name: "Vent", description: "Vent install", amount: "60.00", quantity: 1 }], status: "sent", dueDate: daysAgo(5) });
await db.insert(schema.followUps).values({
  companyId: 1, title: "Invoice INV overdue", body: "Balance of 60.00 is 4 days past due (due test)", dueDate: daysAgo(2),
  source: "automation", sourceKey: `overdue-invoice:${fuInvoiceId}:${daysAgo(5)}`, recipe: "invoice_overdue",
  invoiceId: fuInvoiceId, status: "open", createdAt: new Date(), updatedAt: new Date(),
});
let queue = await A.getFollowUpQueue.handler(ctx, { includeDone: false });
check("queue: genuinely overdue invoice's card is listed", queue.items.some((i: any) => i.invoiceId === fuInvoiceId));
await A.addPayment.handler(ctx, { invoiceId: fuInvoiceId, amount: "60.00", paymentDate: today, method: "Cash", note: "" });
check("queue: payment flipped the invoice to paid", (await invoiceRow(fuInvoiceId)).status === "paid");
queue = await A.getFollowUpQueue.handler(ctx, { includeDone: false });
check("queue: settled invoice's card auto-resolves", !queue.items.some((i: any) => i.invoiceId === fuInvoiceId));
queue = await A.getFollowUpQueue.handler(ctx, { includeDone: true });
const resolved = queue.items.find((i: any) => i.invoiceId === fuInvoiceId);
check("queue: the resolved card reads done, not deleted", resolved?.status === "done", resolved?.status);

// Accepted estimates leave the chase lists (item 7).
const chaseQuote = await A.saveQuote.handler(ctx, {
  ...docFields, clientId: null, clientName: "Chase Me", jobAddress: "2 Oak St",
  lineItems: line, subtotal: "100.00", total: "100.00", expiryDate: "", sentAt: daysAgo(5),
  depositType: "none", depositValue: "0", materials: [],
});
const openQuote = await A.saveQuote.handler(ctx, {
  ...docFields, clientId: null, clientName: "Still Waiting", jobAddress: "3 Pine St",
  lineItems: line, subtotal: "100.00", total: "100.00", expiryDate: "", sentAt: daysAgo(5),
  depositType: "none", depositValue: "0", materials: [],
});
// Simulate acceptQuoteVersion's state: accepted flips, automationStatus stays "awaiting".
await db.update(schema.quotes).set({ accepted: true }).where(eq(schema.quotes.id, chaseQuote.id));
const center = await A.getAutomationCenter.handler(ctx, { today });
check("chase: ACCEPTED estimate is not chased", !center.quoteChase.some((q: any) => q.id === chaseQuote.id), JSON.stringify(center.quoteChase.map((q: any) => q.id)));
check("chase: still-open estimate is still chased", center.quoteChase.some((q: any) => q.id === openQuote.id), JSON.stringify(center.quoteChase.map((q: any) => q.id)));
check("chase: payment escalations carry the document number", center.paymentEscalations.every((i: any) => typeof i.invoiceNumber === "string" && i.invoiceNumber.length > 0));

// --- 5. Client merge + name normalisation -------------------------------------------
const survivor = await A.saveClient.handler(ctx, { id: null, name: "Anthony Porreca", phone: "", email: "", address: "100 Survivor Ave", addresses: [], notes: "", tags: [], referredByClientId: null });
const duplicate = await A.saveClient.handler(ctx, { id: null, name: "Anthony P", phone: "(813) 555-7777", email: "", address: "200 Duplicate Rd", addresses: [], notes: "Duplicate record note", tags: ["vip"], referredByClientId: null });
await db.insert(schema.jobs).values({ companyId: 1, clientId: duplicate.id, clientName: "Anthony P", jobAddress: "200 Duplicate Rd", jobType: "Garage", jobDate: today });
const dupQuote = await A.saveQuote.handler(ctx, { ...docFields, clientId: duplicate.id, clientName: "Anthony P", jobAddress: "200 Duplicate Rd", lineItems: line, subtotal: "100.00", total: "100.00", expiryDate: "", sentAt: "", depositType: "none", depositValue: "0", materials: [] });
const dupInvoice = await A.saveInvoice.handler(ctx, { ...docFields, clientId: duplicate.id, clientName: "Anthony P", jobAddress: "200 Duplicate Rd", invoiceNumber: "", quoteId: null, lineItems: line, subtotal: "100.00", total: "100.00", issueDate: today, dueDate: "", status: "sent", recurringFrequency: "none", nextDueDate: "", recurringEndDate: "" });
await A.addPayment.handler(ctx, { invoiceId: dupInvoice.id, amount: "40.00", paymentDate: today, method: "Cash", note: "" });
const merged = await A.mergeClients.handler(ctx, { survivorId: survivor.id, duplicateId: duplicate.id });
check("merge: reports moved records", merged.moved >= 3, `moved=${merged.moved}`);
check("merge: duplicate row is deleted", (await db.select().from(schema.clients).where(eq(schema.clients.id, duplicate.id))).length === 0);
check("merge: job re-pointed at the survivor", (await db.select().from(schema.jobs).where(eq(schema.jobs.clientId, survivor.id))).length === 1);
check("merge: quote + invoice re-pointed", (await db.select().from(schema.quotes).where(eq(schema.quotes.id, dupQuote.id)))[0]?.clientId === survivor.id && (await invoiceRow(dupInvoice.id)).clientId === survivor.id);
const survivorRow = (await db.select().from(schema.clients).where(eq(schema.clients.id, survivor.id)).limit(1))[0]!;
check("merge: blank phone filled from the duplicate", survivorRow.phone === "(813) 555-7777", survivorRow.phone);
check("merge: notes folded in", survivorRow.notes.includes("Duplicate record note"), survivorRow.notes);
const clientsParsed = A.listClients.response.safeParse(await A.listClients.handler(ctx, { search: "" }));
const survivorSummary = (clientsParsed.data as any).clients.find((c: any) => c.id === survivor.id);
check("merge: survivor totals include the duplicate's invoice + payment", survivorSummary?.totalInvoiced === 100 && survivorSummary?.totalPaid === 40, JSON.stringify({ t: survivorSummary?.totalInvoiced, p: survivorSummary?.totalPaid }));
const caps = await A.saveClient.handler(ctx, { id: null, name: "DEBBIE JONES ANDREWS", phone: "", email: "", address: "", addresses: [], notes: "", tags: [], referredByClientId: null });
check("names: ALL-CAPS name is title-cased on save", (await db.select().from(schema.clients).where(eq(schema.clients.id, caps.id)).limit(1))[0]?.name === "Debbie Jones Andrews");
const mixed = await A.saveClient.handler(ctx, { id: null, name: "McDonald", phone: "", email: "", address: "", addresses: [], notes: "", tags: [], referredByClientId: null });
check("names: mixed-case name passes through untouched", (await db.select().from(schema.clients).where(eq(schema.clients.id, mixed.id)).limit(1))[0]?.name === "McDonald");

// --- 6. Deposit fields still round-trip (item 1 sibling parity) ----------------------
const depQuote = await A.saveQuote.handler(ctx, { ...docFields, clientId: null, clientName: "Deposit Q", jobAddress: "9 Elm St", lineItems: line, subtotal: "100.00", total: "100.00", expiryDate: "", sentAt: "", depositType: "percent", depositValue: "25", materials: [] });
const quotesParsed = A.listQuotes.response.safeParse(await A.listQuotes.handler(ctx, {}));
const depQuoteShaped = (quotesParsed.data as any).quotes.find((q: any) => q.id === depQuote.id);
check("deposit: quote percent deposit survives the response path", depQuoteShaped?.depositType === "percent" && depQuoteShaped?.depositValue === "25.00", JSON.stringify({ t: depQuoteShaped?.depositType, v: depQuoteShaped?.depositValue }));
const depInvoiceId = await makeInvoice({ depositType: "fixed", depositValue: "250" } as any);
const depInvoiceShaped = (await listInvoicesParsed()).find((i) => i.id === depInvoiceId);
check("deposit: invoice fixed deposit survives the response path", depInvoiceShaped?.depositType === "fixed" && depInvoiceShaped?.depositValue === "250", JSON.stringify({ t: depInvoiceShaped?.depositType, v: depInvoiceShaped?.depositValue }));

// --- 7. Retired legacy price-book actions are gone ------------------------------------
check("retired: listMaterialCosts no longer exists", (A as any).listMaterialCosts === undefined);
check("retired: saveMaterialCost no longer exists", (A as any).saveMaterialCost === undefined);
check("retired: deleteMaterialCost no longer exists", (A as any).deleteMaterialCost === undefined);
check("merge: mergeClients action exists", typeof (A as any).mergeClients?.handler === "function");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
