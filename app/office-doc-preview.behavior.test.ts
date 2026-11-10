// Office document preview + downloads (Danny 2026-11-09) — source pins
// plus a FUNCTIONAL production-path run of the new server action.
//
// Estimates/invoices had no preview or download in Office at all
// (contracts already had getDocumentPdf). The fix is a new owner action,
// getFinancialDocumentPdf, which renders the EXACT client PDF
// (buildDocumentLinkPdf over the link payload) for a quote/invoice id —
// the payload builder behind getDocumentLinkPayload was factored into
// buildDocumentPayload so both paths share one source of truth, and the
// PDF cache is shared (same key shape), so an edit invalidates both.
//
// Run from app/:  bun office-doc-preview.behavior.test.ts
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ---------------- source pins ----------------
const ACTIONS = readFileSync("server/src/actions.ts", "utf8");
const PERMS = readFileSync("server/src/permissions.ts", "utf8");
const DOCS = readFileSync("office/src/views/Documents.tsx", "utf8");
const UTILS = readFileSync("office/src/utils.ts", "utf8");
const CSS = readFileSync("office/src/office.css", "utf8");

check("payload builder factored out of the token path", ACTIONS.includes("async function buildDocumentPayload(ctx: Ctx, link: DocumentLinkLike)"));
check("token path delegates to the shared builder", ACTIONS.includes("payload: await buildDocumentPayload(ctx, link)"));
check("owner action renders via buildDocumentLinkPdf", ACTIONS.includes("getFinancialDocumentPdf: defineAction({") && ACTIONS.includes("await buildDocumentLinkPdf(ctx, { ...payload, kind: args.kind }, lang)"));
check("owner action classified in permissions", PERMS.includes('"getFinancialDocumentPdf"'));
check("Office: quote + invoice preview/download wired to the action",
  DOCS.includes('api.getFinancialDocumentPdf({ kind: "quote", documentId: quote.id })') &&
  DOCS.includes('api.getFinancialDocumentPdf({ kind: "invoice", documentId: invoice.id })'));
check("Office: signables get a Preview button too", DOCS.includes("void openPreview(() => api.getDocumentPdf({ documentId: signable.id }), heading)"));
check("Office: preview modal renders the PDF in an iframe", DOCS.includes('className="modal modal-preview"') && DOCS.includes('className="pdf-preview-frame"'));
check("Office: object-url helper exists", UTILS.includes("export function base64ToObjectUrl"));
check("preview modal CSS exists", CSS.includes(".modal-preview") && CSS.includes(".pdf-preview-frame"));

// ---------------- functional: real PDF bytes through the registry ----------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-docpdf-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  slug: "tradesign",
  invocationId: "docpdf-test",
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
  workspaceTier: "premium",
} as any;
const A = BaseActions as any;

await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Preview Co", updatedAt: new Date() });

const docFields = {
  clientId: null, jobId: null, clientName: "Mich Coffield", clientPhone: "", clientEmail: "",
  jobAddress: "9519 Colony Dr, Odessa, FL 33556", shippingAddress: "", jobType: "Floor",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "bold", font: "Inter", accentColor: "#174f7a", customizeJson: "{}",
  depositType: "none", depositValue: "0", materials: [],
  showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true,
  showFooterNotes: true, showLogo: true, showCompanyInfo: true,
};

const savedQuote = await A.saveQuote.handler(ctx, A.saveQuote.request.parse({
  ...docFields,
  subtotal: "3175", total: "3175", expiryDate: "", sentAt: "",
  lineItems: [
    { name: "Section 1 — Concrete Grinding", description: "Grind down high areas.", amount: "3175", quantity: 1 },
    { name: "PAUSE — CREW NOTE", description: "", amount: "0", quantity: 1, isTitle: true },
  ],
}));
const quoteId = savedQuote.id;

const quotePdf = await A.getFinancialDocumentPdf.handler(ctx, A.getFinancialDocumentPdf.request.parse({ kind: "quote", documentId: quoteId }));
const quoteBytes = Buffer.from(quotePdf.pdfBase64, "base64");
check("quote PDF renders real bytes", quoteBytes.subarray(0, 4).toString() === "%PDF" && quoteBytes.length > 2000, `${quoteBytes.length} bytes`);
check("quote PDF filename is a .pdf", /\.pdf$/i.test(quotePdf.filename), quotePdf.filename);
check("response schema keeps pdfBase64 + filename", (() => { const p = A.getFinancialDocumentPdf.response.parse(quotePdf); return typeof p.pdfBase64 === "string" && typeof p.filename === "string"; })());

const savedInvoice = await A.saveInvoice.handler(ctx, A.saveInvoice.request.parse({
  ...docFields,
  subtotal: "13520", total: "13520", status: "draft",
  issueDate: "2026-11-09", dueDate: "2026-11-23",
  lineItems: [{ name: "Porch tile", description: "Travertine install.", amount: "13520", quantity: 1 }],
}));
const invoicePdf = await A.getFinancialDocumentPdf.handler(ctx, A.getFinancialDocumentPdf.request.parse({ kind: "invoice", documentId: savedInvoice.id ?? savedInvoice.invoice?.id }));
const invoiceBytes = Buffer.from(invoicePdf.pdfBase64, "base64");
check("invoice PDF renders real bytes", invoiceBytes.subarray(0, 4).toString() === "%PDF" && invoiceBytes.length > 2000, `${invoiceBytes.length} bytes`);

let missingThrew = false;
try {
  await A.getFinancialDocumentPdf.handler(ctx, A.getFinancialDocumentPdf.request.parse({ kind: "quote", documentId: 99999 }));
} catch { missingThrew = true; }
check("missing document errors instead of fabricating a PDF", missingThrew);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
