// Portal payments + receipts (Danny 2026-10-20): the client portal
// shows each invoice's individual payments (date · method · amount,
// oldest → newest) and a per-payment receipt view with a client-side
// HTML download. Before this, payments only fed the balance number and
// receipts existed solely as an in-app "Send payment receipt" action.
//
// Covers:
//  1. Payload: an invoice's payments appear with exact amount/date/
//     method, sorted oldest → newest even when recorded out of order.
//  2. An invoice with no payments returns an empty payments array and
//     its balance math is unchanged; the paid invoice's balance still
//     reflects every payment.
//  3. Isolation: a second job's payments never appear under this
//     token, and another company's payments never appear either.
//  4. Payment notes are internal — the note text never reaches the
//     portal payload (payments carry id/amount/paymentDate/method
//     only).
//  5. Client + server source wiring: payments block renders only when
//     payments exist, receipt view + download, EN/ES strings, CSS.
//
// Run from app/:  bun portal-payments.behavior.test.ts
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
const dir = await mkdtemp(join(tmpdir(), "crewkat-portal-payments-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const blobStore = new Map<string, Buffer>();
const ctx = {
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
  workspaceCompanyId: 1,
  workspaceUserId: 1,
} as any;
const A = BaseActions as any;
const now = new Date();
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Stallions Construction Company LLC", updatedAt: now });
const mkJob = async (clientName: string, jobAddress: string, companyId = 1) =>
  (await db.insert(schema.jobs).values({ companyId, clientName, clientEmail: "", jobAddress, jobType: "Garage conversion", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const jobA = await mkJob("Anthony Porreca", "2337 Eastwood Dr");
const jobB = await mkJob("Other Client", "9 Elsewhere St");
const jobC2 = await mkJob("Rival Client", "1 Competitor Way", 2);

const docFields = {
  clientPhone: "", clientEmail: "", shippingAddress: "", jobType: "Garage conversion",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a",
};
async function makeInvoice(jobId: number, total: string): Promise<number> {
  const inv = await A.saveInvoice.handler(ctx, {
    ...docFields, jobId, clientId: null, clientName: "Anthony Porreca", jobAddress: "2337 Eastwood Dr",
    invoiceNumber: "", quoteId: null,
    lineItems: [{ name: "Work", description: "Garage gym conversion", amount: total, quantity: 1 }],
    subtotal: total, total,
    issueDate: "2026-10-20", dueDate: "2026-11-19", status: "sent",
    recurringFrequency: "none", nextDueDate: "", recurringEndDate: "",
  });
  return inv.id as number;
}
const pay = (invoiceId: number, amount: string, paymentDate: string, method: string, note = "") =>
  A.addPayment.handler(ctx, { invoiceId, amount, paymentDate, method, note });

// --- Seed ----------------------------------------------------------------------
// Job A: one invoice with two payments recorded OUT of date order, one
// invoice with no payments at all.
const invA1 = await makeInvoice(jobA, "6060.00");
const payLater = await pay(invA1, "1000.00", "2026-10-19", "Cash", "internal: second check, hold till Monday");
const payEarlier = await pay(invA1, "2000.00", "2026-10-18", "Zelle");
const invA2 = await makeInvoice(jobA, "500.00");

// Job B (same company): its own invoice + payment — must stay invisible to A.
const invB = await makeInvoice(jobB, "777.00");
await pay(invB, "777.00", "2026-10-17", "Venmo");

// Another company's job: invoice + payment — must stay invisible to A.
const invC2 = await makeInvoice(jobC2, "4242.00");
await db.update(schema.invoices).set({ companyId: 2 }).where(eq(schema.invoices.id, invC2));
const payC2 = await pay(invC2, "4242.00", "2026-10-16", "Wire");
await db.update(schema.payments).set({ companyId: 2 }).where(eq(schema.payments.id, payC2.id));

// --- 1-2. Job A payload -----------------------------------------------------------
const portalA = await A.createPortalLink.handler(ctx, { jobId: jobA, expiresInDays: 90 });
const dataA = await A.getPortalData.handler(ctx, { token: portalA.token });
const rowA1 = dataA.invoices.find((i: any) => i.id === invA1);
const rowA2 = dataA.invoices.find((i: any) => i.id === invA2);
check("paid invoice lists both payments", Array.isArray(rowA1?.payments) && rowA1.payments.length === 2, JSON.stringify(rowA1?.payments));
check("payments are sorted oldest → newest", rowA1?.payments[0]?.paymentDate === "2026-10-18" && rowA1?.payments[1]?.paymentDate === "2026-10-19", JSON.stringify(rowA1?.payments));
check("first payment carries exact amount + method", rowA1?.payments[0]?.amount === "2000.00" && rowA1?.payments[0]?.method === "Zelle" && rowA1?.payments[0]?.id === payEarlier.id, JSON.stringify(rowA1?.payments[0]));
check("second payment carries exact amount + method", rowA1?.payments[1]?.amount === "1000.00" && rowA1?.payments[1]?.method === "Cash" && rowA1?.payments[1]?.id === payLater.id, JSON.stringify(rowA1?.payments[1]));
check("balance math is unchanged by the payments payload", rowA1?.balanceDue === "3060.00", rowA1?.balanceDue);
check("invoice with no payments returns an empty array", Array.isArray(rowA2?.payments) && rowA2.payments.length === 0, JSON.stringify(rowA2?.payments));
check("unpaid invoice balance is untouched", rowA2?.balanceDue === "500.00", rowA2?.balanceDue);

// --- 3-4. Isolation + note privacy ---------------------------------------------------
const payloadA = JSON.stringify(dataA);
check("job B's payment never appears under job A's token", !payloadA.includes("Venmo") && !payloadA.includes("777.00"), "");
check("another company's payment never appears under job A's token", !payloadA.includes("4242.00") && !payloadA.includes("Wire"), "");
check("payment notes never reach the portal payload", !payloadA.includes("second check") && !("note" in (rowA1?.payments[0] ?? {})), "");
check("payment objects carry exactly the four public fields", rowA1?.payments.every((p: any) => Object.keys(p).sort().join(",") === "amount,id,method,paymentDate"), JSON.stringify(rowA1?.payments.map((p: any) => Object.keys(p))));

const portalB = await A.createPortalLink.handler(ctx, { jobId: jobB, expiresInDays: 90 });
const dataB = await A.getPortalData.handler(ctx, { token: portalB.token });
const rowB = dataB.invoices.find((i: any) => i.id === invB);
check("job B sees exactly its own payment", rowB?.payments.length === 1 && rowB.payments[0].method === "Venmo" && rowB.payments[0].amount === "777.00", JSON.stringify(rowB?.payments));
check("job B payload contains none of job A's payments", !JSON.stringify(dataB).includes("Zelle") && !JSON.stringify(dataB).includes("2000.00"), "");

// --- 5. Source wiring ------------------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");
const cssSrc = await readFile("client/src/theme.css", "utf8");
check("server adds payments to the portal invoice schema", serverSrc.includes("payments:z.array(z.object({id:z.number(),amount:z.string(),paymentDate:z.string(),method:z.string()}))"));
check("server maps only this invoice's payments, sorted", serverSrc.includes("payments.filter(p=>p.invoiceId===inv.id).sort(") && serverSrc.includes("payments:invPayments.map"));
check("portal renders the payments block only when payments exist", appSrc.includes("inv.payments.length > 0") && appSrc.includes("portal-v2-payments"));
check("portal payment rows show date · method · amount", appSrc.includes("portal-v2-payment-meta") && appSrc.includes("fmtDay(pay.paymentDate)") && appSrc.includes("pay.method"));
check("portal offers a receipt per payment", appSrc.includes("openReceipt(inv, pay)") && appSrc.includes("portal-v2-receipt"));
check("receipt view carries the payment's data", appSrc.includes("receipt.payment.amount") && appSrc.includes("receipt.balanceAfter") && appSrc.includes("receipt.invoiceNumber"));
check("receipt downloads client-side from the payload", appSrc.includes("downloadReceipt") && appSrc.includes("downloadBlob(new Blob([html]"));
check("portal strings cover payments/receipt in EN + ES", appSrc.includes('"Payments"') && appSrc.includes('"Pagos"') && appSrc.includes('"Receipt"') && appSrc.includes('"Recibo"') && appSrc.includes("Payment receipt") && appSrc.includes("Recibo de pago") && appSrc.includes("Balance remaining") && appSrc.includes("Saldo restante"));
check("portal payments + receipt styles exist", cssSrc.includes(".portal-v2-payments") && cssSrc.includes(".portal-v2-payment") && cssSrc.includes(".portal-v2-receipt"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
