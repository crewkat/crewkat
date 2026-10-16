// Duplicate invoice fix (Danny, 2026-10-15 — INV-0005 options sheet report:
// "Duplicating document doesn't actually work.").
//
// Root causes pinned here:
//  1. Server duplicateInvoice inserted {...row} — the spread copied the
//     original's invoiceNumber verbatim, so the "copy" was also INV-0005:
//     same number, same client, same total. The client navigated to the
//     new id but the screen was indistinguishable from the original.
//  2. The copy never brought documentAttachments along (quote→invoice
//     conversion does; duplication must behave the same).
//  3. The client mutation swallowed every non-limit error
//     (onError: handleLimitError(e, () => {})) — the sheet just sat there.
//     QuotePreview's duplicate had no onError at all.
//
// Fix: the duplicate gets a FRESH number from nextInvoiceNumber(db),
// stays draft with quoteId null / dueDate + recurring cleared /
// parentInvoiceId = source; attachments are copied best-effort;
// payments, signatures and share links are NOT copied (separate tables,
// a duplicate is a new document); both preview callers surface non-limit
// errors in the options sheet via duplicateError + actionErrorMessage,
// while handleLimitError keeps the free-tier upgrade path.
//
// Run from app/:  bun duplicate-invoice.behavior.test.ts
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

// --- Static pins -------------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const actionsSrc = await readFile("server/src/actions.ts", "utf8");

const dupStart = actionsSrc.indexOf("duplicateInvoice: defineAction");
const dupEnd = actionsSrc.indexOf("duplicateQuote: defineAction", dupStart);
const DUP = actionsSrc.slice(dupStart, dupEnd);
check("server duplicateInvoice exists", dupStart > -1);
check("duplicate mints a fresh number via nextInvoiceNumber", DUP.includes("const invoiceNumber=await nextInvoiceNumber(db)") && DUP.includes("invoiceNumber,quoteId:null"));
check("duplicate keeps the new-document resets (draft, no quote, no due date, no recurring, parent set)",
  DUP.includes('status:"draft"') && DUP.includes('dueDate:""') && DUP.includes('recurringFrequency:"none"') && DUP.includes("parentInvoiceId:row.id"));
check("duplicate copies documentAttachments best-effort (mirrors conversion)",
  DUP.includes("schema.documentAttachments") && DUP.includes('docType:"invoice",docId:next.id') && DUP.includes("never fail duplication"));
check("duplicate still enforces the free-tier invoice limit", DUP.includes("assertInvoiceLimit(ctx, db)"));

const invDupLine = appSrc.split("\n").find((l) => l.includes("api.duplicateInvoice")) ?? "";
check("invoice caller surfaces non-limit errors instead of swallowing them",
  invDupLine.includes("handleLimitError(e,()=>setDuplicateError(actionErrorMessage(e)))") && !invDupLine.includes("handleLimitError(e,()=>{})"));
check("invoice options sheet renders the duplicate error",
  appSrc.includes('{duplicateError&&<p className="status error">{duplicateError}</p>}'));
const quoteDupLine = appSrc.split("\n").find((l) => l.includes("api.duplicateQuote")) ?? "";
check("quote caller surfaces errors too (it previously had no onError at all)",
  quoteDupLine.includes("onError:(e)=>handleLimitError(e,()=>setDuplicateError(actionErrorMessage(e)))"));

// --- Server behavior -----------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-duplicate-invoice-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const blobStore = new Map<string, Buffer>();
const ctx = {
  slug: "tradesign",
  invocationId: "duplicate-invoice-test",
  spaceDir: dir,
  db: () => db,
  unscopedDb: () => db,
  blobs: {
    put: async (key: string, data: Buffer) => { blobStore.set(key, Buffer.from(data)); },
    get: async (key: string) => blobStore.get(key) ?? null,
    getUrl: async (key: string) => `https://crewkat.com/blobs/${key}`,
    delete: async (key: string) => { blobStore.delete(key); },
    head: async (key: string) => ({ contentType: "application/pdf", size: blobStore.get(key)?.length ?? 0 }),
  },
  executePrivileged: async () => { throw new Error("not stubbed"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
} as any;
const A = BaseActions as any;
const now = new Date();
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Stallions Construction Company LLC", updatedAt: now });
// Premium owner for company 1 — the limit path is exercised separately below.
await db.insert(schema.authUsers).values({ id: 1, name: "Danny", email: "owner@test.com", passwordHash: "x", passwordSalt: "y", companyId: 1, tier: "premium", emailVerifiedAt: now, createdAt: now, updatedAt: now } as any);

const lineItemsJson = JSON.stringify([{ description: "Concrete pad", quantity: 1, amount: "100.00", discount: "0" }]);
const baseInvoice = {
  companyId: 1, clientName: "Denny", clientPhone: "8135550100", clientEmail: "",
  jobAddress: "1 Main St", jobType: "Concrete pad",
  lineItemsJson, subtotal: "100.00", total: "100.00", footnote: "",
  issueDate: "2026-10-01", dueDate: "2026-10-15", status: "sent" as const,
  theme: "bold" as const, accentColor: "#1f5a4a", customizeJson: "{}",
  createdAt: now, updatedAt: now,
};
// Four fillers so the original lands on id 5 / INV-0005 — Danny's exact case.
for (let i = 1; i <= 4; i++) {
  await db.insert(schema.invoices).values({ ...baseInvoice, invoiceNumber: `INV-000${i}` });
}
const origId = (await db.insert(schema.invoices).values({ ...baseInvoice, invoiceNumber: "INV-0005" }).returning({ id: schema.invoices.id }))[0]!.id;
check("fixture: original is INV-0005", origId === 5, `id=${origId}`);
// A payment + two attachments ride on the original.
await db.insert(schema.payments).values({ companyId: 1, invoiceId: origId, amount: "40.00", paymentDate: "2026-10-10", method: "Cash" });
await db.insert(schema.documentAttachments).values([
  { companyId: 1, docType: "invoice", docId: origId, kind: "pdf", blobKey: "att/spec.pdf", fileName: "spec.pdf", contentType: "application/pdf", sortOrder: 0, createdAt: now },
  { companyId: 1, docType: "invoice", docId: origId, kind: "image", blobKey: "att/site.jpg", fileName: "site.jpg", contentType: "image/jpeg", sortOrder: 1, createdAt: now },
]);

const before = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, origId)).limit(1))[0]!;
const result = await A.duplicateInvoice.handler(ctx, { id: origId });
check("duplicate returns a new id", typeof result.id === "number" && result.id !== origId, `id=${result.id}`);
const copy = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, result.id)).limit(1))[0]!;
check("copy gets the NEXT invoice number, not the original's",
  copy.invoiceNumber === "INV-0006" && copy.invoiceNumber !== before.invoiceNumber, `number=${copy.invoiceNumber}`);
check("copy keeps client, job, line items, totals and theme",
  copy.clientName === before.clientName && copy.jobAddress === before.jobAddress
  && copy.lineItemsJson === before.lineItemsJson && copy.total === before.total
  && copy.subtotal === before.subtotal && copy.theme === before.theme && copy.accentColor === before.accentColor);
check("copy is a fresh draft: status draft, quote unlinked, due date cleared, issued today",
  copy.status === "draft" && copy.quoteId === null && copy.dueDate === "" && copy.issueDate === now.toISOString().slice(0, 10));
check("copy records its parent and drops recurring state",
  copy.parentInvoiceId === origId && copy.recurringFrequency === "none" && copy.seriesId === null && copy.recurringCancelled === false);
const copyPayments = await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, result.id));
check("no payments were copied to the duplicate", copyPayments.length === 0);
const copyAtts = await db.select().from(schema.documentAttachments).where(eq(schema.documentAttachments.docId, result.id));
check("attachments were copied to the duplicate (same files, same order)",
  copyAtts.length === 2 && copyAtts.some((a) => a.blobKey === "att/spec.pdf" && a.sortOrder === 0)
  && copyAtts.some((a) => a.blobKey === "att/site.jpg" && a.sortOrder === 1)
  && copyAtts.every((a) => a.docType === "invoice" && a.companyId === 1));
const origAtts = await db.select().from(schema.documentAttachments).where(eq(schema.documentAttachments.docId, origId));
check("original attachments untouched", origAtts.length === 2);
const after = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, origId)).limit(1))[0]!;
check("original row untouched",
  after.invoiceNumber === "INV-0005" && after.status === before.status && after.updatedAt.getTime() === before.updatedAt.getTime());

// --- Limit enforcement: free-tier company already at this month's cap --------
await db.insert(schema.settings).values({ id: 2, companyId: 2, companyName: "Free Co", updatedAt: now });
await db.insert(schema.authUsers).values({ id: 2, name: "Free", email: "free@test.com", passwordHash: "x", passwordSalt: "y", companyId: 2, tier: "free", emailVerifiedAt: now, createdAt: now, updatedAt: now } as any);
let freeOrigId = 0;
for (let i = 0; i < 5; i++) {
  freeOrigId = (await db.insert(schema.invoices).values({ ...baseInvoice, companyId: 2, invoiceNumber: `F-000${i + 1}` }).returning({ id: schema.invoices.id }))[0]!.id;
}
const freeCtx = { ...ctx, workspaceCompanyId: 2, workspaceUserId: 2 } as any;
let limitError = "";
try { await A.duplicateInvoice.handler(freeCtx, { id: freeOrigId }); } catch (e) { limitError = (e as Error).message; }
check("free-tier company at the 5-invoice monthly cap cannot duplicate",
  limitError.startsWith("FREE_INVOICE_LIMIT"), limitError || "did not throw");

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall duplicate-invoice checks passed");