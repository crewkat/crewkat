// Client-link PDF parity + cache invalidation (2026-10-12) — Danny's
// INV-0011: the in-app PDF showed "Amount paid: -$6,500.00", "Balance due:
// $0.00" and the PAID stamp, while the SAME invoice via its client link
// rendered as unpaid (no Amount paid row, Balance due = $6,500.00).
// Two server defects:
//   1. getDocumentLinkPayload never computed paidToDate / lateFeeAccrued /
//      totalWithLateFee (invoiceShape derives them from the payments table
//      for the in-app path), and buildDocumentLinkPdf never passed them to
//      the generator — so every link render defaulted to paid = 0.
//   2. The link PDF caches (bytes + rasterized pages) key on the invoice
//      row's updatedAt, but addPayment only touched the invoice when a
//      payment COMPLETED the balance, and deletePayment never touched it —
//      a partial payment (or a deletion) kept serving the pre-payment
//      render indefinitely.
// Run from app/:  bun doc-link-pdf-parity.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { Actions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok - ${name}`);
  else { failures++; console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`); }
}

const dir = await mkdtemp(join(tmpdir(), "crewkat-link-parity-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx: any = {
  slug: "tradesign",
  invocationId: "link-parity-test",
  spaceDir: dir,
  db: () => db,
  blobs: { put: async () => {}, getUrl: async (k: string) => `blob://test/${k}`, get: async () => null, delete: async () => {}, head: async () => null },
  executePrivileged: async () => ({ delivery: "fallback" }),
  emit: () => {},
  invalidateQueries: () => {},
  clientIp: "10.2.2.2",
  userAgent: "test",
  ipHash: "",
  isProdCookie: false,
};

const su = await (Actions.signUp as any).handler(ctx, { name: "Parity Pat", email: "parity@example.com", password: "password1234", marketplaceTermsAccepted: true });
await (Actions.verifyEmail as any).handler(ctx, { email: "parity@example.com", code: su.verificationCode });
const login = await (Actions.login as any).handler(ctx, { email: "parity@example.com", password: "password1234" });
const sessionToken = (login as { sessionToken: string }).sessionToken;
check("setup: signed up + logged in", Boolean(sessionToken));

const userRow = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "parity@example.com")))[0];
const [inv] = await db.insert(schema.invoices).values({
  companyId: userRow!.companyId,
  invoiceNumber: "INV-0011",
  clientName: "Mich Cofield",
  jobAddress: "Hudson, FL",
  jobType: "Exterior electrical",
  lineItemsJson: JSON.stringify([{ name: "", description: "Electrical scope", amount: "6500", quantity: 1, discount: "0", unit: "none" }]),
  subtotal: "6500",
  total: "6500",
  status: "sent",
  issueDate: "2026-10-04",
  dueDate: "2026-10-04",
  footnote: "",
  customizeJson: "{}",
}).returning({ id: schema.invoices.id });
check("setup: invoice created", Boolean(inv?.id));

const link = await (Actions.createDocumentLink as any).handler(ctx, { kind: "invoice", id: inv!.id, _sessionToken: sessionToken });
check("setup: document link created", Boolean(link?.token));

async function linkPdfRaw(): Promise<string> {
  const res = await (Actions.getDocumentLinkPdf as any).handler(ctx, { token: link.token, lang: "en" });
  return Buffer.from(res.pdfBase64, "base64").toString("latin1");
}

// 1. Unpaid invoice: balance due in full, no Amount paid row.
const before = await linkPdfRaw();
check("unpaid: link PDF shows Balance due", before.includes("Balance due"));
check("unpaid: link PDF shows the full $6,500.00", before.includes("$6,500.00"));
check("unpaid: link PDF has no Amount paid row", !before.includes("Amount paid"));

// 2. Partial payment: parity (paid amount appears) AND invalidation (the
//    cached pre-payment render must not be served again).
const p1 = await (Actions.addPayment as any).handler(ctx, { invoiceId: inv!.id, amount: "2500", paymentDate: "2026-10-04", method: "Cash", note: "", _sessionToken: sessionToken });
check("partial payment recorded", Boolean(p1?.id));
const afterPartial = await linkPdfRaw();
check("partial: link PDF shows Amount paid row", afterPartial.includes("Amount paid"));
check("partial: link PDF shows -$2,500.00 paid", afterPartial.includes("-$2,500.00"));
check("partial: link PDF balance drops to $4,000.00", afterPartial.includes("$4,000.00"));

// 3. Completing payment: fully-paid truth — amount paid, $0.00 balance, stamp.
const p2 = await (Actions.addPayment as any).handler(ctx, { invoiceId: inv!.id, amount: "4000", paymentDate: "2026-10-04", method: "Cash", note: "", _sessionToken: sessionToken });
check("completing payment recorded", Boolean(p2?.id));
const afterPaid = await linkPdfRaw();
check("paid: link PDF shows -$6,500.00 paid", afterPaid.includes("-$6,500.00"));
check("paid: link PDF balance is $0.00", afterPaid.includes("$0.00"));
check("paid: link PDF carries the PAID stamp", afterPaid.includes("PAID"));

// 4. Deleting a payment must invalidate too — the render falls back to the
//    partial state, not the cached fully-paid one.
await (Actions.deletePayment as any).handler(ctx, { id: p2.id, _sessionToken: sessionToken });
const afterDelete = await linkPdfRaw();
check("delete: link PDF paid amount back to -$2,500.00", afterDelete.includes("-$2,500.00"));
check("delete: link PDF balance back to $4,000.00", afterDelete.includes("$4,000.00"));
check("delete: link PDF no longer shows -$6,500.00 paid", !afterDelete.includes("-$6,500.00"));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall client-link PDF parity checks passed");
