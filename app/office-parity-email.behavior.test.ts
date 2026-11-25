// Office parity item 10 (2026-11-24): direct email send for documents.
// Office was link-copy-only; emailDocumentLink mints a fresh document
// link (the same row createDocumentLink writes) and emails it to the
// client through the privileged mailer. Covered here through the
// functional round-trip harness: link creation + email payload, the
// quote sentAt stamp, missing-document refusal, mailer-failure
// surfacing, and the permission classification (ALL_ROLE_ACTIONS +
// SEND_DOCUMENT_ACTIONS — an unclassified action would fail closed to
// admin after audit C4, and a send not in SEND_DOCUMENT_ACTIONS would
// bypass the sendDocuments access switch).
//
// Run from app/:  bun office-parity-email.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";
import { ALL_ROLE_ACTIONS, SEND_DOCUMENT_ACTIONS } from "./server/src/permissions.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const dir = await mkdtemp(join(tmpdir(), "crewkat-office-parity-email-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const sentMail: Array<{ to: string; subject: string; text: string }> = [];
let mailDelivery = "sent";
const ctx = {
  slug: "tradesign",
  invocationId: "office-parity-email-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async (_fn: unknown, args: { to: string; subject: string; text: string }) => {
    sentMail.push(args);
    return { delivery: mailDelivery };
  },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "premium",
} as any;
const A = BaseActions as any;

await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Parity Co", updatedAt: new Date() });

const docFields = {
  clientId: null, jobId: null, clientPhone: "", clientEmail: "mary@example.com",
  jobAddress: "1 Main St", shippingAddress: "", jobType: "Kitchen remodel",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a", customizeJson: "{}",
  showTaxLine: true, showDiscountLine: true, showPaidLine: true,
  showPaymentTerms: true, showFooterNotes: true, showLogo: true, showCompanyInfo: true,
};
const quote = await A.saveQuote.handler(ctx, {
  ...docFields, clientName: "Mary Client",
  lineItems: [{ name: "Work", description: "Bath remodel", amount: "6500" }],
  subtotal: "6500", total: "6500", expiryDate: "", sentAt: "",
  depositType: "none", depositValue: "0", materials: [],
});
check("seed quote saved", quote.id > 0);

// --- classification -------------------------------------------------------------
check("emailDocumentLink is classified for all roles", ALL_ROLE_ACTIONS.has("emailDocumentLink"));
check("emailDocumentLink is gated by the sendDocuments switch", SEND_DOCUMENT_ACTIONS.has("emailDocumentLink"));

// --- happy path: quote ----------------------------------------------------------
const res = await A.emailDocumentLink.handler(ctx, { kind: "quote", id: quote.id, email: "mary@example.com", message: "Hi Mary — your estimate is ready." });
check("email send returns ok + shortCode", res.ok === true && typeof res.shortCode === "string" && res.shortCode.length >= 6);
const linkRows = await db.select().from(schema.documentLinks).where(eq(schema.documentLinks.documentId, quote.id));
check("a document link row was minted", linkRows.length === 1 && linkRows[0]?.documentKind === "quote" && linkRows[0]?.shortCode === res.shortCode);
check("exactly one email went out", sentMail.length === 1);
check("email addressed to the client", sentMail[0]?.to === "mary@example.com");
check("email carries the /d/ link", !!sentMail[0]?.text.includes(`/d/${res.shortCode}`), sentMail[0]?.text.slice(0, 200));
check("email carries the custom message", !!sentMail[0]?.text.includes("your estimate is ready"));
check("subject names the company", !!sentMail[0]?.subject.includes("Parity Co"), sentMail[0]?.subject);
const quoteRow = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, quote.id)).limit(1))[0];
check("quote sentAt stamped on first email send", !!quoteRow?.sentAt, String(quoteRow?.sentAt));

// --- second send mints a fresh link, old one stays --------------------------------
const res2 = await A.emailDocumentLink.handler(ctx, { kind: "quote", id: quote.id, email: "mary@example.com", message: "" });
const linkRows2 = await db.select().from(schema.documentLinks).where(eq(schema.documentLinks.documentId, quote.id));
check("second send mints a second link (old links stay valid)", linkRows2.length === 2 && res2.shortCode !== res.shortCode);

// --- invoice kind ------------------------------------------------------------------
const invoice = await A.saveInvoice.handler(ctx, {
  ...docFields, clientName: "Mary Client", invoiceNumber: "", quoteId: null,
  lineItems: [{ name: "Work", description: "Bath remodel", amount: "6500" }],
  subtotal: "6500", total: "6500", issueDate: "2026-11-24", dueDate: "", status: "draft",
  recurringFrequency: "none", nextDueDate: "", recurringEndDate: "",
});
const resInv = await A.emailDocumentLink.handler(ctx, { kind: "invoice", id: invoice.id, email: "mary@example.com", message: "" });
check("invoice email send works", resInv.ok === true && sentMail[sentMail.length - 1]?.subject.includes("Invoice") === true, sentMail[sentMail.length - 1]?.subject);

// --- missing document ---------------------------------------------------------------
let threw = false;
try { await A.emailDocumentLink.handler(ctx, { kind: "quote", id: 999999, email: "mary@example.com", message: "" }); } catch { threw = true; }
check("missing document is refused", threw);

// --- mailer failure surfaces ----------------------------------------------------------
mailDelivery = "failed";
let mailThrew = false;
try { await A.emailDocumentLink.handler(ctx, { kind: "quote", id: quote.id, email: "mary@example.com", message: "" }); } catch { mailThrew = true; }
check("mailer failure surfaces as an error (no silent success)", mailThrew);
mailDelivery = "sent";

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
