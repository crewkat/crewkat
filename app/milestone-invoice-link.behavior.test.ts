// Payment schedule <-> invoices (Danny 2026-10-20): a payment-schedule
// milestone links to at most one invoice. The link column + the
// invoiceMilestone create action already existed; this build completes
// the feature:
//  - invoiceMilestone is company-scoped (requireJobCompany) and stamps the
//    shared INV-#### number on the invoice it mints, like every other
//    invoice creation path.
//  - getJobOperations exposes the linked invoice's number + LIVE status on
//    the milestone row (invoiceNumber / invoiceStatus), and reports a
//    dangling invoiceId as unlinked.
//  - deleteInvoice clears the milestone link explicitly (the row returns
//    to the unlinked "Create invoice" state, no dangling reference).
//  - The job page milestone row renders the invoice number + a status
//    pill (existing ck-pill vocabulary), tapping it opens the invoice.
//
// Covers:
//  1. Milestone CRUD unchanged (save + status update); a fresh milestone
//     reads back unlinked (invoiceId/invoiceNumber/invoiceStatus null).
//  2. invoiceMilestone mints a DRAFT invoice with the milestone's amount,
//     due date, job + client snapshot, a single line item named from the
//     milestone label, and an INV-#### number; the milestone links to it.
//  3. A second invoiceMilestone call returns the SAME invoice (no dupe).
//  4. The payload's invoiceStatus follows the invoice's live status
//     (draft -> sent -> paid via toggleInvoicePaid).
//  5. Editing the milestone afterwards does not rewrite the invoice.
//  6. deleteInvoice unlinks the milestone (stored invoiceId null AND the
//     payload is back to unlinked), and the milestone can mint a fresh
//     invoice afterwards.
//  7. Cross-company: another workspace cannot mint an invoice from this
//     company's milestone, and its operations payload never sees it.
//  8. Client + server source wiring (chip render, status pill, labels).
//
// Run from app/:  bun milestone-invoice-link.behavior.test.ts
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
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- Harness -------------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-milestone-invoice-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const blobStore = new Map<string, Buffer>();
const mkCtx = (companyId: number) => ({
  db: () => db,
  unscopedDb: () => db,
  blobs: {
    put: async (key: string, data: Buffer) => { blobStore.set(key, Buffer.from(data)); },
    get: async (key: string) => blobStore.get(key) ?? null,
    getUrl: async (key: string) => `https://crewkat.com/blobs/${key}`,
    delete: async (key: string) => { blobStore.delete(key); },
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => { throw new Error("unexpected privileged call"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: companyId,
  workspaceUserId: companyId,
}) as any;
const ctx = mkCtx(1);
const ctxOther = mkCtx(2);
const A = BaseActions as any;
const now = new Date();
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Stallions Construction Company LLC", updatedAt: now });
await db.insert(schema.settings).values({ id: 2, companyId: 2, companyName: "Other Company LLC", updatedAt: now });
const mkJob = async (companyId: number, clientName: string, jobAddress: string) =>
  (await db.insert(schema.jobs).values({ companyId, clientName, clientEmail: "", jobAddress, jobType: "Garage conversion", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const jobA = await mkJob(1, "Anthony Porreca", "2337 Eastwood Dr");
const jobOther = await mkJob(2, "Someone Else", "9 Elsewhere St");

const ops = async (c: any, jobId: number) => A.getJobOperations.handler(c, { jobId });
const milestoneRow = async (c: any, jobId: number, id: number) =>
  (await ops(c, jobId)).milestones.find((m: any) => m.id === id);

// --- 1. Milestone CRUD + unlinked read-back --------------------------------------
const saved = await A.saveMilestone.handler(ctx, { jobId: jobA, label: "Installment 1 of 3 (Start Payment)", amount: "6060", percentage: "", dueDate: "2026-10-21" });
const milestoneId = saved.id as number;
check("saveMilestone still creates a milestone", Number.isInteger(milestoneId) && milestoneId > 0);
let row = await milestoneRow(ctx, jobA, milestoneId);
check("fresh milestone is unlinked (id/number/status all null)", row?.invoiceId === null && row?.invoiceNumber === null && row?.invoiceStatus === null, JSON.stringify(row));
check("fresh milestone keeps its label/amount/due date", row?.label === "Installment 1 of 3 (Start Payment)" && row?.amount === "6060.00" && row?.dueDate === "2026-10-21", JSON.stringify(row));
await A.updateMilestoneStatus.handler(ctx, { id: milestoneId, status: "paid" });
row = await milestoneRow(ctx, jobA, milestoneId);
check("updateMilestoneStatus still works", row?.status === "paid", row?.status);
await A.updateMilestoneStatus.handler(ctx, { id: milestoneId, status: "pending" });

// --- 2. invoiceMilestone mints + links --------------------------------------------
const minted = await A.invoiceMilestone.handler(ctx, { id: milestoneId, today: "2026-10-20" });
const invoiceId = minted.invoiceId as number;
check("invoiceMilestone returns an invoice id", Number.isInteger(invoiceId) && invoiceId > 0);
const invRow = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)))[0]!;
check("minted invoice is a draft", invRow.status === "draft", invRow.status);
check("minted invoice total = milestone amount", invRow.total === "6060.00", invRow.total);
check("minted invoice due date = milestone due date", invRow.dueDate === "2026-10-21", invRow.dueDate);
check("minted invoice issue date = today", invRow.issueDate === "2026-10-20", invRow.issueDate);
check("minted invoice is linked to the milestone's job + client", invRow.jobId === jobA && invRow.clientName === "Anthony Porreca" && invRow.companyId === 1, JSON.stringify({ jobId: invRow.jobId, clientName: invRow.clientName, companyId: invRow.companyId }));
const items = JSON.parse(invRow.lineItemsJson) as Array<{ description: string; amount: string }>;
check("minted invoice has one line item named from the milestone label", items.length === 1 && items[0]!.description === "Installment 1 of 3 (Start Payment)" && items[0]!.amount === "6060.00", invRow.lineItemsJson);
check("minted invoice carries a real INV-#### number", /^INV-\d{4}$/.test(invRow.invoiceNumber), invRow.invoiceNumber);
const storedMilestone = (await db.select().from(schema.paymentMilestones).where(eq(schema.paymentMilestones.id, milestoneId)))[0]!;
check("milestone row persists the invoice link", storedMilestone.invoiceId === invoiceId, String(storedMilestone.invoiceId));
row = await milestoneRow(ctx, jobA, milestoneId);
check("payload exposes the linked invoice id + number + status", row?.invoiceId === invoiceId && row?.invoiceNumber === invRow.invoiceNumber && row?.invoiceStatus === "draft", JSON.stringify(row));

// --- 3. No duplicate minting ---------------------------------------------------------
const again = await A.invoiceMilestone.handler(ctx, { id: milestoneId, today: "2026-10-20" });
check("second invoiceMilestone call returns the same invoice", again.invoiceId === invoiceId);
const invoiceCount = (await db.select().from(schema.invoices).where(eq(schema.invoices.jobId, jobA))).length;
check("no duplicate invoice was created", invoiceCount === 1, String(invoiceCount));

// --- 4. Live status follows the invoice ----------------------------------------------
await db.update(schema.invoices).set({ status: "sent" }).where(eq(schema.invoices.id, invoiceId));
row = await milestoneRow(ctx, jobA, milestoneId);
check("payload status follows invoice -> sent", row?.invoiceStatus === "sent", row?.invoiceStatus);
await A.toggleInvoicePaid.handler(ctx, { id: invoiceId, paid: true, today: "2026-10-22" });
row = await milestoneRow(ctx, jobA, milestoneId);
check("payload status follows invoice -> paid", row?.invoiceStatus === "paid", row?.invoiceStatus);

// --- 5. Milestone edits do not rewrite the invoice ------------------------------------
await db.update(schema.paymentMilestones).set({ amount: "7000.00" }).where(eq(schema.paymentMilestones.id, milestoneId));
const invAfter = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)))[0]!;
check("editing the milestone amount leaves the created invoice untouched", invAfter.total === "6060.00", invAfter.total);
await db.update(schema.paymentMilestones).set({ amount: "6060.00" }).where(eq(schema.paymentMilestones.id, milestoneId));

// --- 6. Deleting the invoice unlinks cleanly -------------------------------------------
await A.deleteInvoice.handler(ctx, { id: invoiceId });
const storedAfter = (await db.select().from(schema.paymentMilestones).where(eq(schema.paymentMilestones.id, milestoneId)))[0]!;
check("deleteInvoice clears the stored milestone link", storedAfter.invoiceId === null, String(storedAfter.invoiceId));
row = await milestoneRow(ctx, jobA, milestoneId);
check("payload is back to unlinked after invoice deletion", row?.invoiceId === null && row?.invoiceNumber === null && row?.invoiceStatus === null, JSON.stringify(row));
const reminted = await A.invoiceMilestone.handler(ctx, { id: milestoneId, today: "2026-10-23" });
check("milestone can mint a fresh invoice after unlinking", Number.isInteger(reminted.invoiceId) && reminted.invoiceId !== invoiceId);
row = await milestoneRow(ctx, jobA, milestoneId);
check("re-minted link shows in the payload as a draft", row?.invoiceId === reminted.invoiceId && row?.invoiceStatus === "draft", JSON.stringify(row));

// --- 7. Cross-company isolation ---------------------------------------------------------
let threw = false;
try {
  await A.invoiceMilestone.handler(ctxOther, { id: milestoneId, today: "2026-10-20" });
} catch { threw = true; }
check("another workspace cannot mint from this company's milestone", threw);
const otherOps = await ops(ctxOther, jobOther);
check("other workspace's operations never include this job's milestones", otherOps.milestones.length === 0, String(otherOps.milestones.length));
let opsThrew = false;
try { await ops(ctxOther, jobA); } catch { opsThrew = true; }
check("other workspace cannot read this job's operations", opsThrew);

// --- 8. Source wiring ---------------------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");
const cssSrc = await readFile("client/src/theme.css", "utf8");
check("milestone row renders the invoice chip", appSrc.includes("milestone-invoice-link") && appSrc.includes("m.invoiceNumber") && appSrc.includes("m.invoiceStatus"));
check("chip reuses the ck-pill status vocabulary", appSrc.includes("ck-pill-paid") && appSrc.includes("ck-pill-overdue") && appSrc.includes("ck-pill-draft"));
check("chip labels are bilingual", appSrc.includes('"Pagada"') && appSrc.includes('"Borrador"') && appSrc.includes('"Vencida"'));
check("create-invoice action is still the unlinked path", appSrc.includes("api.invoiceMilestone") && appSrc.includes('"Create invoice"') && appSrc.includes('"Crear factura"'));
check("chip styling exists", cssSrc.includes(".milestone-invoice-link"));
check("server payload derives number/status from the linked invoice", serverSrc.includes("invoiceStatus: linked ? linked.status : null") && serverSrc.includes("invoiceNumber: linked ?"));
check("invoiceMilestone is company-scoped and numbers its invoice", serverSrc.includes("requireJobCompany(ctx, db, milestone.jobId)") && serverSrc.includes("const invoiceNumber = await nextInvoiceNumber(db); const rows = await db.insert(schema.invoices)"));
check("deleteInvoice clears milestone links", serverSrc.includes("paymentMilestones).set({invoiceId:null"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
