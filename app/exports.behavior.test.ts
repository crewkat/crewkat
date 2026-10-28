// Exports behavior tests: accountant CSV datasets (invoices / payments /
// expenses+receipts), the batch invoice PDF ZIP, period filtering
// (all / lastMonth / month / quarter / year), company scoping, and the
// role + seeMoney gating around all of it.
//
// Exercised through the real protected `Actions` surface with real
// logins (same harness style as office-wave1), plus direct DB seeds.
//
// Run from app/:  bun exports.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { unzipSync } from "fflate";
import { Actions } from "./server/src/actions.ts";
import { MONEY_EXPORT_ACTIONS, assertAccessAllowed, effectiveAccess, minRoleForAction } from "./server/src/permissions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function checkThrows(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    failures++;
    console.error(`FAIL ${name} — expected an error but none was thrown`);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (match && !match.test(msg)) { failures++; console.error(`FAIL ${name} — wrong error: ${msg.slice(0, 140)}`); }
    else console.log(`ok   ${name}`);
  }
}

// Minimal RFC 4180 parser for assertions.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); cell = ""; rows.push(row); row = []; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

// --- 1. Permission classification -------------------------------------------------
const EXPORT_ACTIONS = ["exportInvoicesCsv", "exportPaymentsCsv", "exportExpensesCsv", "exportInvoicesPdfZip"];
check("all four exports are office+ in the role map", EXPORT_ACTIONS.every((a) => minRoleForAction(a) === "office"));
check("all four exports are in the seeMoney switch family", EXPORT_ACTIONS.every((a) => MONEY_EXPORT_ACTIONS.has(a)));
checkThrows("assertAccessAllowed refuses exports when seeMoney is off", async () => {
  assertAccessAllowed({ ...effectiveAccess("office", {}), seeMoney: false }, "exportInvoicesCsv");
}, /seeing money totals/);

// --- 2. Fresh DB + accounts ---------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-exports-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const blobStore = new Map<string, Buffer>();
const ctx = {
  slug: "tradesign",
  invocationId: "exports-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async (key: string, data: Buffer) => { blobStore.set(key, Buffer.from(data)); },
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async (key: string) => blobStore.get(key) ?? Buffer.alloc(0),
    delete: async (key: string) => { blobStore.delete(key); },
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => ({ delivery: "fallback" }),
  emit: () => {},
  invalidateQueries: () => {},
} as any;

const A = Actions as any;
async function signUpOwner(name: string, email: string, password: string) {
  const res = await A.signUp.handler(ctx, { name, email, password, marketplaceTermsAccepted: true });
  await A.verifyEmail.handler(ctx, { email, code: res.verificationCode });
  return A.login.handler(ctx, { email, password }) as Promise<{ sessionToken: string; user: { id: number; companyId: number } }>;
}

const owner = await signUpOwner("Olivia Owner", "owner@exports.test", "owner-pass-123");
const ownerToken = owner.sessionToken;
const companyId = owner.user.companyId;
await A.createStaffAccount.handler(ctx, { _sessionToken: ownerToken, name: "Oscar Office", email: "office@exports.test", password: "office-pass-123", role: "office" });
await A.createStaffAccount.handler(ctx, { _sessionToken: ownerToken, name: "Fred Field", email: "field@exports.test", password: "field-pass-123", role: "field" });
const officeLogin = await A.login.handler(ctx, { email: "office@exports.test", password: "office-pass-123" });
const fieldLogin = await A.login.handler(ctx, { email: "field@exports.test", password: "field-pass-123" });
const officeToken = officeLogin.sessionToken as string;
const officeId = officeLogin.user.id as number;
const fieldToken = fieldLogin.sessionToken as string;

// --- 3. Seeds -----------------------------------------------------------------------
const now = new Date();
const todayKey = now.toISOString().slice(0, 10);
const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 5)).toISOString().slice(0, 10);

const jobRows = await db.insert(schema.jobs).values({
  companyId, clientName: "Acme, Inc.", jobAddress: "1 Main St", jobType: "Kitchen remodel", jobDate: todayKey,
}).returning({ id: schema.jobs.id });
const jobId = jobRows[0]!.id;

const lineItems = JSON.stringify([{ description: "Cabinets, \"custom\" fit\nsecond line", amount: "1000.00", quantity: 1 }]);
async function seedInvoice(values: Partial<typeof schema.invoices.$inferInsert> & { invoiceNumber: string }) {
  const rows = await db.insert(schema.invoices).values({
    companyId, clientName: "Acme, Inc.", lineItemsJson: lineItems, total: "0.00", ...values,
  }).returning({ id: schema.invoices.id });
  return rows[0]!.id;
}
const invNowId = await seedInvoice({ invoiceNumber: "INV-2001", clientEmail: "a@acme.test", jobId, jobAddress: "1 Main St", jobType: "Kitchen remodel", subtotal: "1000.00", total: "1000.00", status: "sent", issueDate: todayKey, dueDate: "" });
const invLastMonthId = await seedInvoice({ invoiceNumber: "INV-2002", clientName: "Beta LLC", subtotal: "500.00", total: "550.00", status: "paid", issueDate: lastMonthDate });
const invOldId = await seedInvoice({ invoiceNumber: "INV-2003", clientName: "Old Client", subtotal: "250.00", total: "250.00", status: "paid", issueDate: "2024-03-15" });
await seedInvoice({ invoiceNumber: "INV-9999", companyId: 999, clientName: "Other Company", subtotal: "777.00", total: "777.00", status: "sent", issueDate: todayKey });

await db.insert(schema.payments).values([
  { companyId, invoiceId: invNowId, amount: "400.00", paymentDate: todayKey, method: "card", note: "Deposit, half" },
  { companyId, invoiceId: invLastMonthId, amount: "550.00", paymentDate: lastMonthDate, method: "check", note: "" },
]);
await db.insert(schema.businessExpenses).values([
  { companyId, expenseDate: todayKey, vendor: "Home Depot", amount: "123.45", category: "materials", jobId, note: "Lumber" },
  { companyId, expenseDate: "2024-03-20", vendor: "Gas Co", amount: "60.00", category: "fuel", jobId: null, note: "" },
  { companyId: 999, expenseDate: todayKey, vendor: "Other Co", amount: "999.00", category: "materials", jobId: null, note: "" },
]);
await db.insert(schema.receipts).values([
  { companyId, jobId, vendor: "Lowe's", amount: "50.25", purchaseDate: todayKey, blobKey: "test/receipt.jpg", filename: "receipt.jpg", contentType: "image/jpeg", note: "Paint" },
]);

const decode = (dataBase64: string) => Buffer.from(dataBase64, "base64").toString("utf8");

// --- 4. Invoices CSV ------------------------------------------------------------------
const invAll = await A.exportInvoicesCsv.handler(ctx, { _sessionToken: ownerToken, period: "all" });
check("invoices export: filename", invAll.filename === "crewkat-invoices-all-time.csv", invAll.filename);
check("invoices export: rowCount excludes other company", invAll.rowCount === 3, String(invAll.rowCount));
const invRows = parseCsv(decode(invAll.dataBase64));
check("invoices export: header", invRows[0]!.join(",") === "Invoice Number,Status,Client,Client Email,Job,Job Address,Issue Date,Due Date,Subtotal,Discount,Tax,Total,Paid,Late Fee,Balance", invRows[0]!.join(","));
const rNow = invRows.find((r) => r[0] === "INV-2001")!;
check("invoices export: current invoice present", !!rNow);
check("invoices export: comma client survives round-trip", rNow?.[2] === "Acme, Inc.", rNow?.[2]);
check("invoices export: totals reconcile (total/paid/balance)", rNow?.[11] === "1000.00" && rNow?.[12] === "400.00" && rNow?.[14] === "600.00", JSON.stringify(rNow));
check("invoices export: job label from job row", rNow?.[4] === "Kitchen remodel", rNow?.[4]);
const rOld = invRows.find((r) => r[0] === "INV-2003")!;
check("invoices export: tax derived so rows reconcile", rOld?.[9] === "0.00" && rOld?.[10] === "0.00" && rOld?.[11] === "250.00", JSON.stringify(rOld));
const rLast = invRows.find((r) => r[0] === "INV-2002")!;
check("invoices export: tax on 500→550 row is 50.00", rLast?.[10] === "50.00" && rLast?.[12] === "550.00" && rLast?.[14] === "0.00", JSON.stringify(rLast));
check("invoices export: other company absent", !invRows.some((r) => r[0] === "INV-9999"));
check("invoices export: Total column sums to 1800.00", Math.abs(invRows.slice(1).reduce((s, r) => s + Number(r[11]), 0) - 1800) < 0.001);

const invMonthDefault = parseCsv(decode((await A.exportInvoicesCsv.handler(ctx, { _sessionToken: ownerToken, period: "month" })).dataBase64));
check("invoices export: by-month defaults to current month", invMonthDefault.length === 2 && invMonthDefault[1]?.[0] === "INV-2001", JSON.stringify(invMonthDefault.map((r) => r[0])));
const invMonth2024 = await A.exportInvoicesCsv.handler(ctx, { _sessionToken: ownerToken, period: "month", year: 2024, month: 3 });
check("invoices export: by-month 2024-03 picks only the old invoice", invMonth2024.rowCount === 1 && invMonth2024.filename === "crewkat-invoices-2024-03.csv", invMonth2024.filename);
const invQuarter = await A.exportInvoicesCsv.handler(ctx, { _sessionToken: ownerToken, period: "quarter", year: 2024, quarter: 1 });
check("invoices export: by-quarter 2024 Q1 picks only the old invoice", invQuarter.rowCount === 1 && invQuarter.filename === "crewkat-invoices-2024-Q1.csv", invQuarter.filename);
const invQ2 = await A.exportInvoicesCsv.handler(ctx, { _sessionToken: ownerToken, period: "quarter", year: 2024, quarter: 2 });
check("invoices export: by-quarter 2024 Q2 is empty but valid", invQ2.rowCount === 0);
const invYear = await A.exportInvoicesCsv.handler(ctx, { _sessionToken: ownerToken, period: "year", year: 2024 });
check("invoices export: by-year 2024 picks only the old invoice", invYear.rowCount === 1 && invYear.filename === "crewkat-invoices-2024.csv", invYear.filename);
const invLastMonth = parseCsv(decode((await A.exportInvoicesCsv.handler(ctx, { _sessionToken: ownerToken, period: "lastMonth" })).dataBase64));
check("invoices export: last month picks only the last-month invoice", invLastMonth.length === 2 && invLastMonth[1]?.[0] === "INV-2002", JSON.stringify(invLastMonth.map((r) => r[0])));

// --- 5. Payments CSV ------------------------------------------------------------------
const payAll = parseCsv(decode((await A.exportPaymentsCsv.handler(ctx, { _sessionToken: ownerToken, period: "all" })).dataBase64));
check("payments export: header + 2 rows", payAll[0]!.join(",") === "Date,Invoice Number,Client,Method,Amount,Note" && payAll.length === 3, JSON.stringify(payAll[0]));
const pNow = payAll.find((r) => r[1] === "INV-2001")!;
check("payments export: invoice ref + method + amount", pNow?.[3] === "card" && pNow?.[4] === "400.00" && pNow?.[5] === "Deposit, half", JSON.stringify(pNow));
const payLastMonth = await A.exportPaymentsCsv.handler(ctx, { _sessionToken: ownerToken, period: "lastMonth" });
check("payments export: last month has the one check payment", payLastMonth.rowCount === 1);

// --- 6. Expenses CSV ------------------------------------------------------------------
const expAll = parseCsv(decode((await A.exportExpensesCsv.handler(ctx, { _sessionToken: ownerToken, period: "all" })).dataBase64));
check("expenses export: header", expAll[0]!.join(",") === "Date,Vendor,Category,Job,Amount,Note,Source", expAll[0]!.join(","));
check("expenses export: 3 rows (2 expenses + 1 receipt, other company excluded)", expAll.length === 4, String(expAll.length));
const rReceipt = expAll.find((r) => r[6] === "Receipt")!;
check("expenses export: receipt rides as Job materials with job label", rReceipt?.[2] === "Job materials" && rReceipt?.[3] === "Kitchen remodel" && rReceipt?.[4] === "50.25", JSON.stringify(rReceipt));
check("expenses export: amounts sum to 233.70", Math.abs(expAll.slice(1).reduce((s, r) => s + Number(r[4]), 0) - 233.7) < 0.001);
check("expenses export: other company vendor absent", !expAll.some((r) => r[1] === "Other Co"));
const expYear = await A.exportExpensesCsv.handler(ctx, { _sessionToken: ownerToken, period: "year", year: 2024 });
check("expenses export: by-year 2024 has only the fuel expense", expYear.rowCount === 1);

// --- 7. PDF ZIP -----------------------------------------------------------------------
const zipYear = await A.exportInvoicesPdfZip.handler(ctx, { _sessionToken: ownerToken, period: "year", year: 2024 });
check("zip export: filename", zipYear.filename === "crewkat-invoices-2024.zip", zipYear.filename);
const unzipped = unzipSync(Buffer.from(zipYear.dataBase64, "base64"));
const names = Object.keys(unzipped);
check("zip export: one PDF named for the invoice", names.length === 1 && names[0] === "invoice-INV-2003.pdf", names.join(","));
check("zip export: entry is a real PDF", Buffer.from(unzipped[names[0]!]!).subarray(0, 5).toString() === "%PDF-");
const zipAll = await A.exportInvoicesPdfZip.handler(ctx, { _sessionToken: ownerToken, period: "all" });
check("zip export: all-time bundles the company's 3 invoices only", zipAll.rowCount === 3 && Object.keys(unzipSync(Buffer.from(zipAll.dataBase64, "base64"))).length === 3);

// --- 8. Gating -------------------------------------------------------------------------
const officeOk = await A.exportInvoicesCsv.handler(ctx, { _sessionToken: officeToken, period: "all" });
check("gating: office member with money on can export", officeOk.rowCount === 3);
await checkThrows("gating: field login refused by the role map", () => A.exportInvoicesCsv.handler(ctx, { _sessionToken: fieldToken, period: "all" }), /Field role/);
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: officeId, overrides: { seeMoney: false } });
await checkThrows("gating: office member with seeMoney off refused (csv)", () => A.exportInvoicesCsv.handler(ctx, { _sessionToken: officeToken, period: "all" }), /seeing money totals/);
await checkThrows("gating: office member with seeMoney off refused (zip)", () => A.exportInvoicesPdfZip.handler(ctx, { _sessionToken: officeToken, period: "all" }), /seeing money totals/);
await checkThrows("gating: office member with seeMoney off refused (expenses)", () => A.exportExpensesCsv.handler(ctx, { _sessionToken: officeToken, period: "all" }), /seeing money totals/);
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: officeId, overrides: { seeMoney: null } });
const officeAgain = await A.exportPaymentsCsv.handler(ctx, { _sessionToken: officeToken, period: "all" });
check("gating: clearing the override restores export access", officeAgain.rowCount === 2);

console.log(failures === 0 ? "\nALL EXPORT CHECKS PASSED" : `\n${failures} EXPORT CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
