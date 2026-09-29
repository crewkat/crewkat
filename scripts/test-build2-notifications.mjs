// Build 2 verification: migration 0049 + notification preferences + triggers.
// Run: bun scripts/test-build2-notifications.mjs
import { createTestEnv } from "/home/hatch/workspace/crewkat-app/scripts/secure-login-harness.mjs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

const env = await createTestEnv();
const { Actions, withMeta, libsql } = env;
const blobs = { put: async () => {}, getUrl: async () => null, delete: async () => {} };
const call = (action, args, extra = {}) => {
  const parsed = action.request.safeParse(args ?? {});
  if (!parsed.success) throw new Error("Invalid request: " + JSON.stringify(parsed.error.issues).slice(0, 300));
  return action.handler(withMeta({ blobs, ...extra }), parsed.data);
};
const notifCount = async (userId, kind) => {
  const r = await libsql.execute({ sql: "SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ? AND kind = ?", args: [userId, kind] });
  return Number(r.rows[0].n);
};

try {
  // 1. Journal timestamps strictly increasing (Drizzle libsql silently skips older ones).
  const journal = JSON.parse(await readFile("/home/hatch/workspace/crewkat-app/app/drizzle/meta/_journal.json", "utf8"));
  const entries = journal.entries;
  const last = entries[entries.length - 1];
  const prevEntry = entries[entries.length - 2];
  // Drizzle libsql only compares each journal entry's `when` against the SINGLE
  // latest applied migration: the new entry must be strictly newer than the
  // previous latest (older equal timestamps mid-journal are pre-existing).
  check("new migration when > previous latest", last.when > prevEntry.when, `${prevEntry.tag}@${prevEntry.when} -> ${last.tag}@${last.when}`);
  check("migration 0049 present", entries.some((e) => e.tag === "0049_notification_preferences"));

  // 2. New columns exist on scratch DB (all migrations applied).
  const cols = await libsql.execute("PRAGMA table_info(settings)");
  const names = cols.rows.map((r) => r.name);
  for (const c of ["notify_new_message", "notify_doc_signed", "notify_invoice_viewed", "notify_estimate_viewed"]) {
    check(`settings has ${c}`, names.includes(c));
  }

  // 3. Users + settings prefs.
  await env.createVerifiedUser("biz@test.com", "correct-horse-123");
  await env.createVerifiedUser("cust@test.com", "correct-horse-123");
  const bizLogin = await Actions.login.handler(withMeta({ blobs, userAgent: "t", clientIp: "10.9.0.1" }), { email: "biz@test.com", password: "correct-horse-123" });
  const custLogin = await Actions.login.handler(withMeta({ blobs, userAgent: "t", clientIp: "10.9.0.2" }), { email: "cust@test.com", password: "correct-horse-123" });
  const biz = (a, args) => call(a, { _sessionToken: bizLogin.sessionToken, ...args });
  const cust = (a, args) => call(a, { _sessionToken: custLogin.sessionToken, ...args });
  const bizUser = (await libsql.execute({ sql: "SELECT id, company_id FROM auth_users WHERE email = ?", args: ["biz@test.com"] })).rows[0];
  const bizUserId = Number(bizUser.id);

  const settings = await biz(Actions.getSettings, {});
  check("prefs default true", settings.notifyNewMessage === true && settings.notifyDocSigned === true && settings.notifyInvoiceViewed === true && settings.notifyEstimateViewed === true);
  await biz(Actions.updateSettings, { ...settings, notifyNewMessage: false });
  const after = await biz(Actions.getSettings, {});
  check("pref persists after update", after.notifyNewMessage === false && after.notifyDocSigned === true);
  await biz(Actions.updateSettings, { ...after, notifyNewMessage: true });

  // 4. Marketplace message: push is preference-gated, never throws.
  const listing = await biz(Actions.createMarketplaceListing, {
    title: "Drywall helper needed", category: "other", listingType: "job", employmentType: "full_time",
    payUnit: "hourly", priceKind: "contact", price: "", originalPrice: "", description: "Need a drywall helper this week.",
    serviceArea: "Tampa", companyName: "Biz Co", companyPhone: "", bookable: false, dailyRate: "", photos: [],
  });
  const msg1 = await cust(Actions.sendMarketplaceMessage, { listingId: listing.id, body: "I can help!", image: null, sender: "me" });
  check("inquiry message saved (pref on)", typeof msg1.id === "number");
  await biz(Actions.updateSettings, { ...(await biz(Actions.getSettings, {})), notifyNewMessage: false });
  const msg2 = await cust(Actions.sendMarketplaceMessage, { listingId: listing.id, body: "Still available?", image: null, sender: "me" });
  check("inquiry message saved (pref off, no crash)", typeof msg2.id === "number");
  await biz(Actions.updateSettings, { ...(await biz(Actions.getSettings, {})), notifyNewMessage: true });
  const inbox = await biz(Actions.getMarketplaceInbox, {});
  check("inbox unread counts inquiries", inbox.unreadCount >= 2, `unread=${inbox.unreadCount}`);

  // 5. Invoice view -> in-app + push notification (first view of the day only).
  const invoice = await biz(Actions.saveInvoice, {
    clientName: "Test Client", clientPhone: "", clientEmail: "", jobAddress: "123 Main St", jobType: "Remodel",
    lineItems: [{ description: "Labor", amount: "500.00", quantity: 1 }], subtotal: "500.00",
    discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0", total: "500.00",
    footnote: "", issueDate: "2026-09-28", dueDate: "2026-10-28", status: "sent",
    showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true,
    showFooterNotes: true, showLogo: true, showCompanyInfo: true,
    theme: "classic", font: "helvetica", accentColor: "#1f5a4a", customizeJson: "{}",
  });
  let tokenNonce = 0;
  const tokenFor = (kind, id) => {
    tokenNonce += 1;
    const token = `${kind}-${id}-${tokenNonce}-`.padEnd(64, "a1b2c3").slice(0, 64);
    const hash = createHash("sha256").update(token).digest("hex");
    return { token, hash };
  };
  const insertLink = async (kind, documentId) => {
    const { token, hash } = tokenFor(kind, documentId);
    const now = Date.now();
    await libsql.execute({
      sql: "INSERT INTO document_links (company_id, document_kind, document_id, token_hash, token_hint, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [Number(bizUser.company_id), kind, documentId, hash, token.slice(-6), now + 30 * 86400000, now],
    });
    return token;
  };
  const before = await notifCount(bizUserId, "document-viewed");
  const invToken = await insertLink("invoice", invoice.id);
  await call(Actions.resolveDocumentLink, { token: invToken, userAgent: "test" });
  check("invoice first view notifies", (await notifCount(bizUserId, "document-viewed")) === before + 1);
  await call(Actions.resolveDocumentLink, { token: invToken, userAgent: "test" });
  check("invoice second view same day does not re-notify", (await notifCount(bizUserId, "document-viewed")) === before + 1);
  await biz(Actions.updateSettings, { ...(await biz(Actions.getSettings, {})), notifyInvoiceViewed: false });
  const invToken2 = await insertLink("invoice", invoice.id);
  await call(Actions.resolveDocumentLink, { token: invToken2, userAgent: "test" });
  check("invoice view with pref off does not notify", (await notifCount(bizUserId, "document-viewed")) === before + 1);
  await biz(Actions.updateSettings, { ...(await biz(Actions.getSettings, {})), notifyInvoiceViewed: true });

  // 6. Estimate (quote) view notification.
  const quote = await biz(Actions.saveQuote, {
    clientName: "Test Client", clientPhone: "", clientEmail: "", jobAddress: "123 Main St", jobType: "Remodel",
    lineItems: [{ description: "Labor", amount: "500.00", quantity: 1 }], subtotal: "500.00",
    discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0", total: "500.00",
    footnote: "", issueDate: "2026-09-28", expiryDate: "2026-10-28", status: "sent", sentAt: "2026-09-28",
    showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true,
    showFooterNotes: true, showLogo: true, showCompanyInfo: true,
    theme: "classic", font: "helvetica", accentColor: "#1f5a4a", customizeJson: "{}",
  });
  const quoteToken = await insertLink("quote", quote.id);
  await call(Actions.resolveDocumentLink, { token: quoteToken, userAgent: "test" });
  check("estimate first view notifies", (await notifCount(bizUserId, "document-viewed")) === before + 2);

  // 7. Document signature notification.
  const now = Date.now();
  await libsql.execute({ sql: "INSERT INTO jobs (company_id, client_name, job_address, job_type, job_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", args: [Number(bizUser.company_id), "Test Client", "123 Main St", "Remodel", "2026-09-28", now, now] });
  const jobId = Number((await libsql.execute("SELECT last_insert_rowid() AS id")).rows[0].id);
  await libsql.execute({ sql: "INSERT INTO documents (company_id, job_id, kind, title, signer_name, signature_blob_key, signed_at, created_at) VALUES (?, ?, 'contract', 'Test Contract', 'Biz Owner', 'sig.png', ?, ?)", args: [Number(bizUser.company_id), jobId, now, now] });
  const docId = Number((await libsql.execute("SELECT last_insert_rowid() AS id")).rows[0].id);
  const docToken = await insertLink("contract", docId);
  const sigBefore = await notifCount(bizUserId, "document-signed");
  const pdfB64 = Buffer.alloc(200).toString("base64");
  const sig = await call(Actions.submitDocumentSignature, { token: docToken, signerName: "Test Client", signatureDataBase64: pdfB64, signedPdfDataBase64: pdfB64, userAgent: "test" });
  check("signature accepted", sig.ok === true);
  check("signature notifies company", (await notifCount(bizUserId, "document-signed")) === sigBefore + 1);
} catch (error) {
  console.log("FAIL  unexpected error —", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await env.cleanup();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
