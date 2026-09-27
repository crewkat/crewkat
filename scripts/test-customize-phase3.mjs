// Phase 3 PDF preview/customize tests (migration 0039: customize_json on
// invoices/quotes, default_customize_json on settings; per-document design
// persistence, defaults, and invalid-JSON rejection).
// Run: bun scripts/test-customize-phase3.mjs
import { createTestEnv } from "./secure-login-harness.mjs";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

const env = await createTestEnv();
const { Actions, libsql, withMeta } = env;
const q = async (sql, args = []) => (await libsql.execute({ sql, args })).rows;

const call = (action, args, extra = {}) => {
  const parsed = action.request.safeParse(args ?? {});
  if (!parsed.success) throw new Error("Invalid request for this action.");
  return action.handler(withMeta({ ...extra }), parsed.data);
};

const baseInvoice = {
  clientName: "Customize Test",
  clientPhone: "8135550199",
  clientEmail: "",
  jobAddress: "456 Oak Ave",
  jobType: "Kitchen Remodel",
  lineItems: [{ name: "Cabinets", description: "Shaker cabinets", amount: "1200", quantity: 1, discount: "0", unit: "none" }],
  subtotal: "1200.00",
  discountType: "fixed",
  discountValue: "0",
  taxType: "fixed",
  taxValue: "0",
  total: "1200.00",
  footnote: "",
  issueDate: "2026-09-27",
  dueDate: "2026-10-11",
  status: "draft",
  theme: "classic",
  font: "helvetica",
  accentColor: "#1f5a4a",
  showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true,
  showFooterNotes: true, showLogo: true, showCompanyInfo: true,
};

const custom = JSON.stringify({
  logoSize: "big", removeLogoBackground: false,
  colorMode: "gradient", customColor: "#ff6600", gradientFrom: "#ff6600", gradientTo: "#cc3300",
  showQuantity: true, showDiscount: true, showTax: true, showAmount: true,
  showPaidStamp: true, showSignature: false, showThankYou: true,
  headline: "INVOICE", showBusinessName: true, shortBusinessName: "Stallions",
  showLicense: true, licenseNumber: "CRC1335847", showDueDate: true, dateFormat: "us",
  signatureDataUrl: "", terms: "Net 30", labels: {}, fontSize: "m", lineSpacing: "comfortable",
  highContrast: true, feedback: "up",
});

try {
  // --- migration 0039 ---
  for (const [table, col] of [["invoices", "customize_json"], ["quotes", "customize_json"], ["settings", "default_customize_json"]]) {
    const cols = await q(`PRAGMA table_info(${table})`);
    const found = cols.find((c) => c.name === col);
    check(`migration 0039: ${table}.${col} exists`, !!found);
    check(`${table}.${col} NOT NULL DEFAULT '{}'`, found?.notnull === 1 && found?.dflt_value === "'{}'");
  }

  await env.createVerifiedUser("owner3@test.com", "correct-horse-123");
  const login = await Actions.login.handler(
    withMeta({ userAgent: "t", clientIp: "10.9.0.2" }),
    { email: "owner3@test.com", password: "correct-horse-123" },
  );
  const callOwn = (action, args, extra = {}) =>
    call(action, { _sessionToken: login.sessionToken, ...args }, extra);

  // --- saveInvoice with customizeJson ---
  const made = await callOwn(Actions.saveInvoice, { ...baseInvoice, customizeJson: custom });
  const inv = (await callOwn(Actions.listInvoices, {})).invoices.find((i) => i.id === made.id);
  check("customizeJson persisted on create", inv.customizeJson === custom);
  const parsed = JSON.parse(inv.customizeJson);
  check("customize payload round-trips", parsed.logoSize === "big" && parsed.licenseNumber === "CRC1335847" && parsed.feedback === "up");

  // --- updateInvoiceDesign ---
  const custom2 = JSON.stringify({ logoSize: "small", colorMode: "solid", feedback: "down" });
  await callOwn(Actions.updateInvoiceDesign, {
    id: made.id, theme: "modern", font: "times", accentColor: "#f97316",
    showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true,
    showFooterNotes: true, showLogo: true, showCompanyInfo: true, customizeJson: custom2,
  });
  const inv2 = (await callOwn(Actions.listInvoices, {})).invoices.find((i) => i.id === made.id);
  check("updateInvoiceDesign persists customizeJson", inv2.customizeJson === custom2 && inv2.theme === "modern");

  // --- invalid JSON rejected ---
  let rejected = false;
  try {
    await callOwn(Actions.updateInvoiceDesign, {
      id: made.id, theme: "modern", font: "times", accentColor: "#f97316",
      showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true,
      showFooterNotes: true, showLogo: true, showCompanyInfo: true, customizeJson: "not-json{{{",
    });
  } catch { rejected = true; }
  check("invalid customizeJson rejected", rejected);

  // --- saveDocumentDesignDefault + getSettings ---
  await callOwn(Actions.saveDocumentDesignDefault, {
    theme: "bold", font: "courier", accentColor: "#ff6600",
    showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true,
    showFooterNotes: true, showLogo: true, showCompanyInfo: true, customizeJson: custom,
  });
  const settings = await callOwn(Actions.getSettings, {});
  check("defaultCustomizeJson persisted", settings.defaultCustomizeJson === custom, settings.defaultCustomizeJson?.slice(0, 40));

  // --- convertQuoteToInvoice carries customizeJson ---
  const qMade = await callOwn(Actions.saveQuote, {
    clientName: "Q Test", clientPhone: "", clientEmail: "", jobAddress: "1 Main", jobType: "Bath",
    lineItems: [{ description: "Tile", amount: "800" }],
    subtotal: "800.00", discountType: "fixed", discountValue: "0",
    taxType: "fixed", taxValue: "0", total: "800.00", footnote: "",
    expiryDate: "2026-10-27", sentAt: "", theme: "classic", font: "helvetica",
    accentColor: "#1f5a4a", showTaxLine: true, showDiscountLine: true, showPaidLine: true,
    showPaymentTerms: true, showFooterNotes: true, showLogo: true, showCompanyInfo: true,
    customizeJson: custom,
  });
  const conv = await callOwn(Actions.convertQuoteToInvoice, { id: qMade.id });
  const cinv = (await callOwn(Actions.listInvoices, {})).invoices.find((i) => i.id === conv.invoiceId);
  check("convertQuoteToInvoice carries customizeJson", cinv.customizeJson === custom);
} catch (e) {
  check("no unexpected errors", false, String(e).slice(0, 160));
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
