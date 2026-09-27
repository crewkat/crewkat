// Phase 4 jobs rebuild tests: setJobClient, updateJobInfo, linkInvoiceToJob,
// listDocuments, linkDocumentToJob.
// Run: bun scripts/test-jobs-phase4.mjs
// Phase 4/5/6 smoke tests: new job-linking server actions.
import { createTestEnv } from "/home/hatch/workspace/crewkat-hosting/scripts/secure-login-harness.mjs";

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

await env.createVerifiedUser("owner@test.com", "correct-horse-123");
const login = await Actions.login.handler(
  withMeta({ userAgent: "t", clientIp: "10.9.0.1" }),
  { email: "owner@test.com", password: "correct-horse-123" },
);
const callOwn = (action, args, extra = {}) =>
  call(action, { _sessionToken: login.sessionToken, ...args }, extra);

try {
  for (const n of ["setJobClient", "updateJobInfo", "linkInvoiceToJob", "listDocuments", "linkDocumentToJob"])
    check(`action registered: ${n}`, typeof Actions[n]?.handler === "function");

  // seed client + job
  const c = await callOwn(Actions.saveClient, { id: null, name: "Job Test", phone: "8135550199", email: "", address: "1 Test Way", notes: "", tags: [], referredByClientId: null });
  const job = await callOwn(Actions.createJob, { clientId: null, clientName: "Job Test", clientPhone: "", clientEmail: "", jobAddress: "1 Test Way", jobType: "Kitchen", notes: "", jobDate: "2026-09-27", appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "", galleryPick: false });
  check("job created", job.id > 0);

  // setJobClient
  await callOwn(Actions.setJobClient, { jobId: job.id, clientId: c.id });
  let row = (await q("SELECT client_id, client_name FROM jobs WHERE id = ?", [job.id]))[0];
  check("setJobClient links + copies details", row.client_id === c.id && row.client_name === "Job Test");

  // updateJobInfo
  await callOwn(Actions.updateJobInfo, { jobId: job.id, notes: "n", jobDate: "2026-09-28", appointmentAt: "2026-09-28T10:00", depositAmount: "500", paymentNotes: "half up front" });
  row = (await q("SELECT deposit_amount, payment_notes, job_date FROM jobs WHERE id = ?", [job.id]))[0];
  check("updateJobInfo saves", row.deposit_amount === "500.00" && row.payment_notes === "half up front");

  // linkInvoiceToJob (create invoice first)
  const inv = await callOwn(Actions.saveInvoice, { clientName: "Job Test", clientPhone: "", clientEmail: "", jobAddress: "1 Test Way", jobType: "Kitchen", lineItems: [{ name: "Work", description: "Labor", amount: "100", quantity: 1, discount: "0", unit: "none" }], subtotal: "100.00", discountType: "fixed", discountValue: "0", taxType: "fixed", taxValue: "0", total: "100.00", footnote: "", issueDate: "2026-09-27", dueDate: "2026-10-11", status: "draft", theme: "modern", font: "helvetica", accentColor: "#f97316", showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true, showFooterNotes: true, showLogo: true, showCompanyInfo: true, customizeJson: "{}" });
  await callOwn(Actions.linkInvoiceToJob, { invoiceId: inv.id, jobId: job.id });
  row = (await q("SELECT job_id, client_name FROM invoices WHERE id = ?", [inv.id]))[0];
  check("linkInvoiceToJob links + copies job details", row.job_id === job.id && row.client_name === "Job Test");
  await callOwn(Actions.linkInvoiceToJob, { invoiceId: inv.id, jobId: null });
  row = (await q("SELECT job_id FROM invoices WHERE id = ?", [inv.id]))[0];
  check("linkInvoiceToJob unlinks", row.job_id === null);

  // listDocuments + linkDocumentToJob
  const docs = await callOwn(Actions.listDocuments, {});
  check("listDocuments returns array", Array.isArray(docs.documents));
} catch (e) {
  check("no exceptions", false, e.message);
  process.exitCode = 1;
}
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
