// Phase 2 invoice rebuild tests (migration 0038: invoice_number column,
// auto-assigned editable invoice numbers, expanded line items with
// name/quantity/per-item discount/unit).
// Run: bun scripts/test-invoices-phase2.mjs
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
  clientName: "Test Client",
  clientPhone: "8135550100",
  clientEmail: "",
  jobAddress: "123 Main St",
  jobType: "Bathroom Remodel",
  lineItems: [{ name: "Demo", description: "Demo old tub", amount: "500", quantity: 2, discount: "50", unit: "days" }],
  subtotal: "950.00",
  discountType: "fixed",
  discountValue: "0",
  taxType: "fixed",
  taxValue: "0",
  total: "950.00",
  footnote: "",
  issueDate: "2026-09-27",
  dueDate: "2026-10-11",
  status: "draft",
  theme: "modern",
  font: "helvetica",
  accentColor: "#f97316",
  showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true,
  showFooterNotes: true, showLogo: true, showCompanyInfo: true,
};

try {
  // --- migration 0038 ---
  const cols = await q("PRAGMA table_info(invoices)");
  const numCol = cols.find((c) => c.name === "invoice_number");
  check("migration 0038: invoices.invoice_number column exists", !!numCol);
  check("invoice_number NOT NULL DEFAULT ''", numCol?.notnull === 1 && numCol?.dflt_value === "''");

  await env.createVerifiedUser("owner@test.com", "correct-horse-123");
  const login = await Actions.login.handler(
    withMeta({ userAgent: "t", clientIp: "10.9.0.1" }),
    { email: "owner@test.com", password: "correct-horse-123" },
  );
  const callOwn = (action, args, extra = {}) =>
    call(action, { _sessionToken: login.sessionToken, ...args }, extra);

  // --- auto-assign ---
  const made1 = await callOwn(Actions.saveInvoice, { ...baseInvoice });
  const list1 = await callOwn(Actions.listInvoices, {});
  const inv1 = list1.invoices.find((i) => i.id === made1.id);
  check("invoice number auto-assigned", inv1.invoiceNumber === `INV-${String(made1.id).padStart(4, "0")}`, inv1.invoiceNumber);
  check("expanded line items persisted", inv1.lineItems[0].name === "Demo" && inv1.lineItems[0].quantity === 2 && inv1.lineItems[0].discount === "50.00" && inv1.lineItems[0].unit === "days", JSON.stringify(inv1.lineItems[0]));

  // --- custom number on create ---
  const made2 = await callOwn(Actions.saveInvoice, { ...baseInvoice, invoiceNumber: "INV-2026-007" });
  const list2 = await callOwn(Actions.listInvoices, {});
  const inv2 = list2.invoices.find((i) => i.id === made2.id);
  check("custom invoice number on create", inv2.invoiceNumber === "INV-2026-007", inv2.invoiceNumber);

  // --- edit number + dates via updateInvoiceDocument ---
  await callOwn(Actions.updateInvoiceDocument, { id: made1.id, invoiceNumber: "INV-CUSTOM-1", issueDate: "2026-09-28", dueDate: "2026-10-12", lineItems: baseInvoice.lineItems, discountType: "fixed", discountValue: "0", taxType: "fixed", taxValue: "0", subtotal: "950.00", total: "950.00", footnote: "" });
  const list3 = await callOwn(Actions.listInvoices, {});
  const inv3 = list3.invoices.find((i) => i.id === made1.id);
  check("invoice number editable", inv3.invoiceNumber === "INV-CUSTOM-1", inv3.invoiceNumber);
  check("issue/due dates editable", inv3.issueDate === "2026-09-28" && inv3.dueDate === "2026-10-12", `${inv3.issueDate} / ${inv3.dueDate}`);

  // --- backward compat: old-format line items ---
  const made4 = await callOwn(Actions.saveInvoice, { ...baseInvoice, lineItems: [{ description: "Old item", amount: "100" }] });
  const list4 = await callOwn(Actions.listInvoices, {});
  const inv4 = list4.invoices.find((i) => i.id === made4.id);
  check("old line-item format defaults", inv4.lineItems[0].quantity === 1 && inv4.lineItems[0].unit === "none" && inv4.lineItems[0].discount === "0.00" && inv4.lineItems[0].name === "", JSON.stringify(inv4.lineItems[0]));
} catch (e) {
  check("no unexpected errors", false, String(e).slice(0, 120));
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
