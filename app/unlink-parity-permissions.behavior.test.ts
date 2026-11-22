// Audit fixes 2026-11-21 — A4 unlink parity + C4 fail-closed permissions.
//
// A4: linkInvoiceToJob accepted jobId: null (unlink) but linkQuoteToJob
// rejected it, so an estimate linked to the wrong job was stuck there.
// linkQuoteToJob now accepts null and clears the link (company-scoped).
// Documents intentionally stay link-only: documents.jobId is NOT NULL by
// design (a contract/change order is a job's own record), so there is no
// document unlink — the suite pins that the request schema still refuses
// null for documents rather than pretending parity exists.
//
// C4: minRoleForAction used to default UNCLASSIFIED actions to "field"
// (any signed-in role). It now fails closed to "admin"; every registered
// action is classified in exactly one set, and platform actions keep
// resolving to "field" at the company layer because their handlers
// enforce platform membership themselves.
//
// Run from app/:  bun unlink-parity-permissions.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";
import { minRoleForAction, roleCan } from "./server/src/permissions.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// --- Scratch DB + ctx -----------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-unlink-parity-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  slug: "tradesign",
  invocationId: "unlink-parity-test",
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

await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Parity Co", updatedAt: new Date() });

// --- Fixtures: a job, a quote + invoice created against it ----------------------
const job = await A.createJob.handler(ctx, {
  clientId: null, clientName: "Parity Client", clientPhone: "(813) 555-0100", clientEmail: "",
  jobAddress: "1 Parity Way", jobType: "Remodel", notes: "", jobDate: "2026-11-21",
  appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "",
});
const docFields = {
  clientPhone: "", clientEmail: "", shippingAddress: "", jobType: "Remodel",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a",
  showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true,
  showFooterNotes: true, showLogo: true, showCompanyInfo: true, customizeJson: "{}",
  depositType: "percent", depositValue: "0", expiryDate: "", sentAt: "",
};
const line = [{ name: "Work", description: "Scope of work", amount: "500.00", quantity: 1 }];

const quote = await A.saveQuote.handler(ctx, {
  ...docFields, jobId: job.id, clientId: null, clientName: "Parity Client",
  jobAddress: "1 Parity Way", lineItems: line, materials: [], subtotal: "500.00", total: "500.00",
});
const invoice = await A.saveInvoice.handler(ctx, {
  ...docFields, jobId: job.id, clientId: null, clientName: "Parity Client",
  jobAddress: "1 Parity Way", invoiceNumber: "", quoteId: null, lineItems: line,
  materials: [], subtotal: "500.00", total: "500.00", issueDate: "2026-11-21", dueDate: "",
  status: "draft", recurringFrequency: "none", nextDueDate: "", recurringEndDate: "",
});

const quoteJobId = async () => (await db.select().from(schema.quotes).where(eq(schema.quotes.id, quote.id)).limit(1))[0]?.jobId;
const invoiceJobId = async () => (await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.id)).limit(1))[0]?.jobId;
check("fixture: quote starts linked to the job", (await quoteJobId()) === job.id);
check("fixture: invoice starts linked to the job", (await invoiceJobId()) === job.id);

// --- A4: request schemas accept null for quote/invoice, refuse for documents ----
check("action definitions expose their request schemas", typeof A.linkQuoteToJob.request?.safeParse === "function");
check("linkQuoteToJob schema accepts jobId: null", A.linkQuoteToJob.request.safeParse({ quoteId: quote.id, jobId: null }).success === true);
check("linkInvoiceToJob schema accepts jobId: null", A.linkInvoiceToJob.request.safeParse({ invoiceId: invoice.id, jobId: null }).success === true);
check("linkDocumentToJob schema still refuses jobId: null (documents are job-owned)", A.linkDocumentToJob.request.safeParse({ documentId: 1, jobId: null }).success === false);

// --- A4: unlink actually clears the link -----------------------------------------
await A.linkQuoteToJob.handler(ctx, { quoteId: quote.id, jobId: null });
check("linkQuoteToJob(null) clears the quote's job link", (await quoteJobId()) === null);
await A.linkQuoteToJob.handler(ctx, { quoteId: quote.id, jobId: job.id });
check("linkQuoteToJob(jobId) re-links the quote", (await quoteJobId()) === job.id);
await A.linkInvoiceToJob.handler(ctx, { invoiceId: invoice.id, jobId: null });
check("linkInvoiceToJob(null) still clears the invoice's job link", (await invoiceJobId()) === null);

// --- A4: unlink is company-scoped (another company's quote is not touchable) -----
const ctx2 = { ...ctx, workspaceCompanyId: 2, workspaceUserId: 2 } as any;
await db.insert(schema.settings).values({ id: 2, companyId: 2, companyName: "Other Co", updatedAt: new Date() });
let crossCompanyError = "";
try {
  await A.linkQuoteToJob.handler(ctx2, { quoteId: quote.id, jobId: null });
} catch (error) {
  crossCompanyError = error instanceof Error ? error.message : String(error);
}
check("unlink from another company is refused", crossCompanyError.includes("not found"), crossCompanyError);
check("the quote's link survives the cross-company attempt", (await quoteJobId()) === job.id);

// --- C4: fail-closed default ------------------------------------------------------
check("an unclassified action defaults to admin-only", minRoleForAction("someBrandNewUnclassifiedAction") === "admin");
check("field role cannot run an unclassified action", roleCan("field", "someBrandNewUnclassifiedAction") === false);
check("office role cannot run an unclassified action", roleCan("office", "someBrandNewUnclassifiedAction") === false);
check("admin can run an unclassified action", roleCan("admin", "someBrandNewUnclassifiedAction") === true);
check("platform actions still resolve to field at the company layer", minRoleForAction("adminAuditLog") === "field");
check("all-role actions still resolve to field", minRoleForAction("saveQuote") === "field");
check("office actions still resolve to office", minRoleForAction("getProductionBoard") === "office");
check("admin actions still resolve to admin", minRoleForAction("createStaffAccount") === "admin");

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
