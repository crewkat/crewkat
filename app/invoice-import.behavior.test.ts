// Invoice Fly import behavior tests: preview classification against the
// REAL export files Danny produced (27 client rows, 21 invoice rows —
// the mapping spec's "28/20" was written before the final export), a
// confirmed run creating exactly the selected records, totals that
// reconcile to the CSV Total column, idempotent re-runs, force-import
// of flagged rows, and the exports-family gating (office role +
// seeMoney switch, company scoping).
//
// Exercised through the real protected `Actions` surface with real
// logins (same harness style as exports.behavior.test.ts), plus direct
// DB seeds for the overlap records.
//
// Run from app/:  bun invoice-import.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
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

// --- 1. Permission classification -------------------------------------------------
const IMPORT_ACTIONS = ["previewInvoiceFlyImport", "runInvoiceFlyImport"];
check("both import actions are office+ in the role map", IMPORT_ACTIONS.every((a) => minRoleForAction(a) === "office"));
check("both import actions are in the seeMoney switch family", IMPORT_ACTIONS.every((a) => MONEY_EXPORT_ACTIONS.has(a)));
checkThrows("assertAccessAllowed refuses import preview when seeMoney is off", async () => {
  assertAccessAllowed({ ...effectiveAccess("office", {}), seeMoney: false }, "previewInvoiceFlyImport");
}, /seeing money totals/);

// --- 2. Fresh DB + accounts ---------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-import-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const blobStore = new Map<string, Buffer>();
const ctx = {
  slug: "tradesign",
  invocationId: "import-test",
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

const owner = await signUpOwner("Olivia Owner", "owner@import.test", "owner-pass-123");
const ownerToken = owner.sessionToken;
const companyId = owner.user.companyId;
await A.createStaffAccount.handler(ctx, { _sessionToken: ownerToken, name: "Oscar Office", email: "office@import.test", password: "office-pass-123", role: "office" });
await A.createStaffAccount.handler(ctx, { _sessionToken: ownerToken, name: "Fred Field", email: "field@import.test", password: "field-pass-123", role: "field" });
const officeLogin = await A.login.handler(ctx, { email: "office@import.test", password: "office-pass-123" });
const fieldLogin = await A.login.handler(ctx, { email: "field@import.test", password: "field-pass-123" });
const officeToken = officeLogin.sessionToken as string;
const officeId = officeLogin.user.id as number;
const fieldToken = fieldLogin.sessionToken as string;

// --- 3. Seeds: the Danny-like overlaps ----------------------------------------------
const now = new Date();
const shawRows = await db.insert(schema.clients).values({
  companyId, name: "Robert Shaw", email: "Bookon@gmail.com", phone: "(603) 204-1100", address: "", addressesJson: "[]", notes: "", tags: "[]", createdAt: now, updatedAt: now,
}).returning({ id: schema.clients.id });
const shawId = shawRows[0]!.id;
const michAddress = "9519 Colony Dr. Odessa, Fl 33556";
const michRows = await db.insert(schema.clients).values({
  companyId, name: "Mich Coffield", email: "mich.coffield@gmail.com", phone: "8137656052", address: michAddress,
  addressesJson: JSON.stringify([{ label: "", address: michAddress, primary: true }]), notes: "", tags: "[]", createdAt: now, updatedAt: now,
}).returning({ id: schema.clients.id });
const michId = michRows[0]!.id;

// Crewkat's own record of the job Invoice Fly calls INV0021 (same
// client, same $3,500 total, dated two days later) -> duplicate flag.
await db.insert(schema.invoices).values({
  companyId, invoiceNumber: "INV-0100", clientId: michId, clientName: "Mich Coffield", clientEmail: "mich.coffield@gmail.com",
  lineItemsJson: "[]", subtotal: "3500.00", total: "3500.00", issueDate: "2026-10-06", dueDate: "", status: "paid", createdAt: now, updatedAt: now,
});
// A Crewkat invoice that merely shares the INV0013 display number with
// a different client and amount -> number collision.
await db.insert(schema.invoices).values({
  companyId, invoiceNumber: "INV-0013", clientName: "Unrelated Person",
  lineItemsJson: "[]", subtotal: "999.00", total: "999.00", issueDate: "2026-01-15", dueDate: "", status: "sent", createdAt: now, updatedAt: now,
});
// Another company's records — must never be read or touched.
await db.insert(schema.clients).values({
  companyId: 999, name: "Other Co Client", email: "other@b.test", phone: "", address: "", addressesJson: "[]", notes: "", tags: "[]", createdAt: now, updatedAt: now,
});
await db.insert(schema.invoices).values({
  companyId: 999, invoiceNumber: "INV0001", clientName: "Other Co Client",
  lineItemsJson: "[]", subtotal: "4500.00", total: "4500.00", issueDate: "2026-02-04", dueDate: "", status: "paid", createdAt: now, updatedAt: now,
});

// --- 4. The real files ----------------------------------------------------------------
const filesDir = join(import.meta.dir, "..", "..", "user", "files");
const clientsCsv = await readFile(join(filesDir, "Clients-20261027-091716_29_y2ns.csv"), "utf8");
const invoicesCsv = await readFile(join(filesDir, "Invoices-20261027-091606_31_czz6.csv"), "utf8");
check("fixtures loaded", clientsCsv.includes("Bookon@gmail.com") && invoicesCsv.includes("INV0021"));

// --- 5. Preview classification ----------------------------------------------------------
const preview = await A.previewInvoiceFlyImport.handler(ctx, { _sessionToken: ownerToken, clientsCsv, invoicesCsv });
check("preview: client counts 27 total / 24 new / 3 matched / 0 invalid",
  preview.counts.clientsTotal === 27 && preview.counts.clientsNew === 24 && preview.counts.clientsMatched === 3 && preview.counts.clientsInvalid === 0,
  JSON.stringify(preview.counts));
check("preview: invoice counts 21 total / 19 new / 1 duplicate / 1 collision / 0 imported / 0 invalid",
  preview.counts.invoicesTotal === 21 && preview.counts.invoicesNew === 19 && preview.counts.invoicesDuplicate === 1
  && preview.counts.invoicesCollision === 1 && preview.counts.invoicesImported === 0 && preview.counts.invoicesInvalid === 0,
  JSON.stringify(preview.counts));

const shawRow = preview.clients[0]!;
check("preview: Shaw row matched the seeded client by email", shawRow.status === "matched" && shawRow.matchedClientId === shawId, JSON.stringify(shawRow));
check("preview: Shaw row takes its address from the Name field, name from the email", shawRow.address === "13842 Rudi Loop, Spring Hill, FL 34609" && shawRow.name === "Bookon", JSON.stringify(shawRow));
const michRow = preview.clients.find((r: any) => r.email === "mich.coffield@gmail.com")!;
check("preview: Mich row matched the seeded client", michRow.status === "matched" && michRow.matchedClientId === michId);
const seanRows = preview.clients.filter((r: any) => r.name === "Sean C. Duclos");
check("preview: first Sean row is new, second matches the first inside the file",
  seanRows.length === 2 && seanRows[0].status === "new" && seanRows[1].status === "matched" && seanRows[1].matchedClientId === null,
  JSON.stringify(seanRows.map((r: any) => r.status)));

const dupRow = preview.invoices.find((r: any) => r.number === "INV0021")!;
check("preview: INV0021 duplicate-flagged against INV-0100 and excluded by default",
  dupRow.status === "duplicate" && dupRow.matchedInvoiceNumber === "INV-0100" && dupRow.included === false, JSON.stringify(dupRow));
const collisionRow = preview.invoices.find((r: any) => r.number === "INV0013")!;
check("preview: INV0013 is a number collision and excluded by default",
  collisionRow.status === "collision" && collisionRow.matchedInvoiceNumber === "INV-0013" && collisionRow.included === false, JSON.stringify(collisionRow));
check("preview: every new invoice is included by default",
  preview.invoices.filter((r: any) => r.status === "new").every((r: any) => r.included === true));
check("preview: preview writes nothing",
  (await db.select().from(schema.clients).where(eq(schema.clients.companyId, companyId))).length === 2
  && (await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, companyId))).length === 2);

await checkThrows("preview: a non-Invoice-Fly file is refused with a friendly error",
  () => A.previewInvoiceFlyImport.handler(ctx, { _sessionToken: ownerToken, clientsCsv: "", invoicesCsv: "a,b,c\n1,2,3" }), /Invoice Fly/);
await checkThrows("preview: no file at all is refused",
  () => A.previewInvoiceFlyImport.handler(ctx, { _sessionToken: ownerToken, clientsCsv: "", invoicesCsv: "" }), /Choose a Clients or Invoices CSV/);

// --- 6. Confirmed run with the preview's default selection -------------------------------
const clientIndexes = preview.clients.filter((r: any) => r.included).map((r: any) => r.index);
const invoiceIndexes = preview.invoices.filter((r: any) => r.included).map((r: any) => r.index);
const run = await A.runInvoiceFlyImport.handler(ctx, { _sessionToken: ownerToken, clientsCsv, invoicesCsv, clientIndexes, invoiceIndexes });
check("run: 24 clients created, 3 matched, 2 addresses appended (Shaw + Sean's short address)",
  run.clientsCreated === 24 && run.clientsMatched === 3 && run.addressesAppended === 2, JSON.stringify(run));
check("run: 19 invoices + 19 payments created, none skipped",
  run.invoicesCreated === 19 && run.paymentsCreated === 19 && run.invoicesSkipped === 0, JSON.stringify(run));

const companyClients = await db.select().from(schema.clients).where(eq(schema.clients.companyId, companyId));
const companyInvoices = await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, companyId));
const companyPayments = await db.select().from(schema.payments).where(eq(schema.payments.companyId, companyId));
check("run: company now holds 26 clients / 21 invoices / 19 payments",
  companyClients.length === 26 && companyInvoices.length === 21 && companyPayments.length === 19,
  `${companyClients.length}/${companyInvoices.length}/${companyPayments.length}`);

const imported = companyInvoices.filter((inv) => inv.lineItemsJson.includes("Imported from Invoice Fly"));
const importedSum = imported.reduce((s, inv) => s + Number(inv.total), 0);
check("run: imported invoice totals sum to $148,193.95 (file total minus duplicate + collision)",
  imported.length === 19 && Math.abs(importedSum - 148193.95) < 0.001, `${imported.length} rows, sum ${importedSum}`);

const inv0007 = imported.find((inv) => inv.invoiceNumber === "INV0007")!;
check("run: imported invoice keeps the Invoice Fly number verbatim (no dash, no renumber)",
  !!inv0007 && inv0007.total === "50950.00" && inv0007.status === "paid", JSON.stringify(inv0007?.invoiceNumber));
check("run: imported invoice carries fixed discount/tax so totals reconcile",
  inv0007.discountType === "fixed" && inv0007.taxType === "fixed" && inv0007.discountValue === "0.00" && inv0007.taxValue === "0.00");
const lineItem = JSON.parse(inv0007.lineItemsJson)[0];
check("run: the single line item is the import marker at the subtotal",
  lineItem.description === "Imported from Invoice Fly — INV0007" && lineItem.amount === "50950.00", JSON.stringify(lineItem));
const pay0007 = companyPayments.find((p) => p.invoiceId === inv0007.id)!;
check("run: paid invoice got a payment row dated Paid Date with method Imported",
  !!pay0007 && pay0007.amount === "50950.00" && pay0007.paymentDate === "2026-04-03" && pay0007.method === "Imported", JSON.stringify(pay0007));
const inv0019 = imported.find((inv) => inv.invoiceNumber === "INV0019")!;
const pay0019 = companyPayments.find((p) => p.invoiceId === inv0019.id)!;
check("run: INV0019 (paid, no Paid Date in file) falls back to the due date",
  !!pay0019 && pay0019.paymentDate === "2026-09-21", JSON.stringify(pay0019));

const shawAfter = companyClients.find((c) => c.id === shawId)!;
check("run: Shaw gained the Rudi Loop address, name untouched",
  shawAfter.address === "13842 Rudi Loop, Spring Hill, FL 34609" && shawAfter.name === "Robert Shaw"
  && JSON.parse(shawAfter.addressesJson).length === 1, shawAfter.addressesJson);
const seanAfter = companyClients.find((c) => c.email === "Sean@smduclos.com")!;
check("run: Sean holds both address forms (long from his row, short appended from the duplicate row)",
  !!seanAfter && JSON.parse(seanAfter.addressesJson).length === 2, seanAfter?.addressesJson);
const michAfter = companyClients.find((c) => c.id === michId)!;
check("run: Mich's address was already saved — nothing appended, nothing replaced",
  JSON.parse(michAfter.addressesJson).length === 1 && michAfter.address === michAddress);

// --- 7. Idempotency -----------------------------------------------------------------------
const preview2 = await A.previewInvoiceFlyImport.handler(ctx, { _sessionToken: ownerToken, clientsCsv, invoicesCsv });
check("re-preview: 19 invoices now read as already imported, 0 new",
  preview2.counts.invoicesImported === 19 && preview2.counts.invoicesNew === 0, JSON.stringify(preview2.counts));
check("re-preview: every client now matches, 0 new",
  preview2.counts.clientsMatched === 27 && preview2.counts.clientsNew === 0, JSON.stringify(preview2.counts));
const run2 = await A.runInvoiceFlyImport.handler(ctx, {
  _sessionToken: ownerToken, clientsCsv, invoicesCsv,
  clientIndexes: preview2.clients.filter((r: any) => r.included).map((r: any) => r.index),
  invoiceIndexes: preview2.invoices.filter((r: any) => r.included).map((r: any) => r.index),
});
check("re-run: creates nothing and appends nothing",
  run2.clientsCreated === 0 && run2.invoicesCreated === 0 && run2.paymentsCreated === 0 && run2.addressesAppended === 0, JSON.stringify(run2));

// --- 8. Force-importing the flagged rows -----------------------------------------------------
const run3 = await A.runInvoiceFlyImport.handler(ctx, {
  _sessionToken: ownerToken, clientsCsv, invoicesCsv, clientIndexes: [], invoiceIndexes: [dupRow.index, collisionRow.index],
});
check("force run: the duplicate + collision rows import when the user toggles them on",
  run3.invoicesCreated === 2 && run3.paymentsCreated === 2, JSON.stringify(run3));
const preview3 = await A.previewInvoiceFlyImport.handler(ctx, { _sessionToken: ownerToken, clientsCsv, invoicesCsv });
check("after force run: all 21 invoices read as already imported",
  preview3.counts.invoicesImported === 21 && preview3.counts.invoicesDuplicate === 0 && preview3.counts.invoicesCollision === 0,
  JSON.stringify(preview3.counts));

// --- 9. Gating + scoping ----------------------------------------------------------------------
await checkThrows("gating: field login refused by the role map (preview)",
  () => A.previewInvoiceFlyImport.handler(ctx, { _sessionToken: fieldToken, clientsCsv, invoicesCsv: "" }), /Field role/);
await checkThrows("gating: field login refused by the role map (run)",
  () => A.runInvoiceFlyImport.handler(ctx, { _sessionToken: fieldToken, clientsCsv, invoicesCsv: "", clientIndexes: [], invoiceIndexes: [] }), /Field role/);
const officePreview = await A.previewInvoiceFlyImport.handler(ctx, { _sessionToken: officeToken, clientsCsv: "", invoicesCsv });
check("gating: office member with money on can preview", officePreview.counts.invoicesTotal === 21);
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: officeId, overrides: { seeMoney: false } });
await checkThrows("gating: office member with seeMoney off refused (preview)",
  () => A.previewInvoiceFlyImport.handler(ctx, { _sessionToken: officeToken, clientsCsv: "", invoicesCsv }), /seeing money totals/);
await checkThrows("gating: office member with seeMoney off refused (run)",
  () => A.runInvoiceFlyImport.handler(ctx, { _sessionToken: officeToken, clientsCsv: "", invoicesCsv, clientIndexes: [], invoiceIndexes: [] }), /seeing money totals/);
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: officeId, overrides: { seeMoney: null } });

const otherClients = await db.select().from(schema.clients).where(eq(schema.clients.companyId, 999));
const otherInvoices = await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, 999));
check("scoping: the other company's records are untouched",
  otherClients.length === 1 && otherInvoices.length === 1 && otherInvoices[0]!.invoiceNumber === "INV0001");

console.log(failures === 0 ? "\nALL IMPORT CHECKS PASSED" : `\n${failures} IMPORT CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
