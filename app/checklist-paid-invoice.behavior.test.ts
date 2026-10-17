// Activation checklist: paid-invoice completion path (2026-10-16).
//
// getOnboardingChecklist computed the "Record a payment" step ONLY from the
// payments table. Invoices that reached fully-paid before the payments
// table existed — or via any path that never wrote a payments row — left
// the step undone forever, stranding established accounts at 4 of 5 with
// the Getting-started card stuck on Home (Danny's main account).
//
// Fix pinned here: the step also completes when any invoice carries the
// invoice model's own paid flag (status "paid"). The payments-row path
// keeps working exactly as before, and a merely-sent invoice with no
// payments row still leaves the step undone.
//
// Run from app/:  bun checklist-paid-invoice.behavior.test.ts
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

// --- Static pin ------------------------------------------------------------------
const actionsSrc = await readFile("server/src/actions.ts", "utf8");
const checklistStart = actionsSrc.indexOf("getOnboardingChecklist: defineAction");
const checklistEnd = actionsSrc.indexOf("dismissOnboardingChecklist: defineAction", checklistStart);
const CHECKLIST = actionsSrc.slice(checklistStart, checklistEnd);
check("checklist handler found", checklistStart > -1 && checklistEnd > checklistStart);
check("checklist also looks for an invoice with the model's paid status",
  CHECKLIST.includes('eq(schema.invoices.status, "paid")'));
check("receive_payment completes from a payments row OR a paid invoice",
  CHECKLIST.includes("payments.length > 0 || paidInvoices.length > 0"));

// --- Behavior ----------------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-checklist-paid-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  slug: "tradesign",
  invocationId: "checklist-paid-invoice-test",
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
const checklist = () => A.getOnboardingChecklist.handler(ctx, {});
const paymentStep = (result: { steps: Array<{ key: string; done: boolean }> }) =>
  result.steps.find((s) => s.key === "receive_payment");
const paymentRowCount = async () => (await db.select({ id: schema.payments.id }).from(schema.payments)).length;

// Empty workspace: nothing done.
const empty = await checklist();
check("empty workspace leaves receive_payment undone", paymentStep(empty)?.done === false && empty.allDone === false);

// Seed everything except any form of payment.
await db.insert(schema.clients).values({ companyId: 1, name: "Checklist Carl" });
await db.insert(schema.jobs).values({ companyId: 1, clientName: "Checklist Carl", jobAddress: "9 Elm St", jobType: "Remodel", jobDate: "2026-09-25" });
await db.insert(schema.quotes).values({ companyId: 1, clientName: "Checklist Carl", lineItemsJson: "[]", total: "100", sentAt: "2026-09-25" });
const [invoice] = await db.insert(schema.invoices).values({
  companyId: 1, invoiceNumber: "INV-9001", clientName: "Checklist Carl", lineItemsJson: "[]", total: "6500",
  status: "sent", issueDate: "2026-10-04",
}).returning({ id: schema.invoices.id });

const sentOnly = await checklist();
check("a merely-sent invoice with zero payments rows leaves the step undone",
  paymentStep(sentOnly)?.done === false && sentOnly.allDone === false);
check("the other four steps are done, isolating receive_payment",
  sentOnly.steps.filter((s: { done: boolean }) => s.done).length === 4);
check("payments table is really empty", (await paymentRowCount()) === 0);

// The Danny case: the invoice is fully paid under the model's own flag,
// with NO payments row ever written.
await db.update(schema.invoices).set({ status: "paid" }).where(eq(schema.invoices.id, invoice!.id));
const paidNoRows = await checklist();
check("fully-paid invoice completes receive_payment with zero payments rows",
  paymentStep(paidNoRows)?.done === true);
check("checklist reaches all-done via the paid invoice alone", paidNoRows.allDone === true);
check("still zero payments rows after the paid-invoice completion", (await paymentRowCount()) === 0);

// Back to unpaid + no rows: the step must drop again (no sticky false positive).
await db.update(schema.invoices).set({ status: "sent" }).where(eq(schema.invoices.id, invoice!.id));
const unpaidAgain = await checklist();
check("unpaying the invoice with no payments rows un-completes the step",
  paymentStep(unpaidAgain)?.done === false);

// The original path still works: a payments row completes the step even
// while the invoice itself is not marked paid.
await db.insert(schema.payments).values({ companyId: 1, invoiceId: invoice!.id, amount: "6500.00", paymentDate: "2026-10-04", method: "Cash", note: "" });
const viaRow = await checklist();
check("a payments row still completes the step on its own", paymentStep(viaRow)?.done === true && viaRow.allDone === true);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll checklist-paid-invoice checks passed.");
