// Build 0.4 (item 2): server-side PDF rendering for client document links.
// Chrome on Android cannot render blob: PDF URLs inside an <iframe>, so the
// client link now embeds GET /doc/:token/pdf, which is served from here with
// Content-Type: application/pdf and Content-Disposition: inline.
import { and, eq } from "drizzle-orm";
import type { Ctx } from "@hatch/space-sdk";
import {
  buildChangeOrderPdf,
  buildInvoicePdf,
  buildQuotePdf,
  type ChangeOrderPdfData,
  type FinancialDocument,
  type PdfLang,
  type PdfStrings,
} from "../../client/src/financialPdf";
import {
  changeOrderChain,
  jobDocumentsOrdered,
  referenceContractTitle,
} from "./changeOrders";
import { appendAttachmentsToPdf, type AttachmentForPdf } from "../../client/src/pdfAttachments";
import * as schema from "./schema";

declare module "@hatch/space-sdk" {
  // The production runtime (server.mjs) exposes raw blob byte reads alongside
  // the portable SDK contract; declare it so server-only code can use it.
  interface BlobClient {
    get(key: string): Promise<Buffer | null>;
  }
}

// bun has no FileReader; financialPdf's blobDataUrl() needs one, so install a
// minimal shim backed by Blob.arrayBuffer().
{
  const g = globalThis as unknown as { FileReader?: unknown };
  if (typeof g.FileReader === "undefined") {
    class FileReaderShim {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      readAsDataURL(blob: Blob) {
        blob.arrayBuffer().then(
          (buf) => {
            this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buf).toString("base64")}`;
            this.onload?.();
          },
          (err: unknown) => this.onerror?.(err),
        );
      }
    }
    g.FileReader = FileReaderShim;
  }
}

export interface DocumentLinkPdfPayload {
  kind: "invoice" | "quote";
  documentId: number;
  clientName: string;
  jobAddress: string;
  jobType: string;
  lineItems: Array<{
    description: string;
    amount: string;
    name?: string;
    quantity?: number;
    discount?: string;
    unit?: string;
    optional?: boolean;
    id?: string;
  }>;
  // Estimate options (0076): the link payload already carries the accepted
  // snapshot (quoteOptionsPayload) — forward it so the server-rendered PDF
  // shows the same ACCEPTED OPTIONS section as the in-app PDF.
  acceptedOptions?: {
    items: Array<{ key: string; name: string; description: string; amount: string; quantity: number; discount: string; unit: string }>;
    optionsTotal: string;
    totalWithOptions: string;
    acceptedAt: string;
  } | null;
  selectedOptionKeys?: string[];
  subtotal: string;
  total: string;
  footnote: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  expiryDate: string;
  status: string;
  // Payment truth (invoiceShape-derived in getDocumentLinkPayload). Without
  // these the server render showed every invoice as unpaid (Danny 2026-10-12).
  paidToDate?: string;
  lateFeeAccrued?: string;
  totalWithLateFee?: string;
  discountType: string;
  discountValue: string;
  taxType: string;
  taxValue: string;
  theme: string;
  font: string;
  accentColor: string;
  showTaxLine: boolean;
  showDiscountLine: boolean;
  showPaidLine: boolean;
  showPaymentTerms: boolean;
  showFooterNotes: boolean;
  showLogo: boolean;
  showCompanyInfo: boolean;
  customizeJson: string;
  depositType: string;
  depositValue: string;
}

const asPdfLang = (lang: "en" | "es"): PdfLang => lang;
const pdfStrings = (lang: "en" | "es"): PdfStrings =>
  lang === "es"
    ? { discount: "Descuento", tax: "Impuesto", paymentInstructions: "Instrucciones de pago" }
    : { discount: "Discount", tax: "Tax", paymentInstructions: "Payment instructions" };

export async function buildDocumentLinkPdf(
  ctx: Ctx,
  payload: DocumentLinkPdfPayload,
  lang: "en" | "es",
): Promise<{ bytes: Uint8Array; filename: string }> {
  const db = ctx.db<typeof schema>();
  const settings = (await db.select().from(schema.settings).where(eq(schema.settings.id, 1)).limit(1))[0];

  // The PDF builder loads the logo via fetch(url); pass it as a data: URL so
  // no HTTP round-trip to self is needed. bun's fetch supports data: URLs.
  let logoUrl: string | null = null;
  if (payload.showLogo && settings?.logoBlobKey) {
    try {
      const bytes = await ctx.blobs.get(settings.logoBlobKey);
      const head = bytes ? await ctx.blobs.head(settings.logoBlobKey) : null;
      if (bytes && bytes.length > 0) {
        logoUrl = `data:${head?.contentType || "image/png"};base64,${bytes.toString("base64")}`;
      }
    } catch {
      // Logo is decorative — never fail the PDF for it.
    }
  }

  const doc: FinancialDocument = {
    clientName: payload.clientName,
    jobAddress: payload.jobAddress,
    jobType: payload.jobType,
    lineItems: payload.lineItems.map((li) => ({
      name: li.name ?? "",
      description: li.description,
      amount: li.amount,
      quantity: li.quantity ?? 1,
      discount: li.discount ?? "0",
      unit: (li.unit === "days" || li.unit === "hours" ? li.unit : "none") as "none" | "days" | "hours",
      optional: li.optional === true,
      id: li.id,
    })),
    optionSelection: payload.acceptedOptions
      ? { selectedKeys: payload.selectedOptionKeys ?? [], accepted: payload.acceptedOptions }
      : undefined,
    invoiceNumber: payload.invoiceNumber || undefined,
    subtotal: payload.subtotal,
    discountType: payload.discountType === "fixed" ? "fixed" : "percent",
    discountValue: payload.discountValue,
    taxType: payload.taxType === "fixed" ? "fixed" : "percent",
    taxValue: payload.taxValue,
    total: payload.total,
    footnote: payload.footnote,
    theme: (["classic", "modern", "bold", "minimal"] as const).includes(payload.theme as never) ? (payload.theme as FinancialDocument["theme"]) : "classic",
    font: (["helvetica", "times", "courier", "palatino"] as const).includes(payload.font as never) ? (payload.font as FinancialDocument["font"]) : "helvetica",
    accentColor: payload.accentColor,
    showTaxLine: payload.showTaxLine,
    showDiscountLine: payload.showDiscountLine,
    showPaidLine: payload.showPaidLine,
    showPaymentTerms: payload.showPaymentTerms,
    showFooterNotes: payload.showFooterNotes,
    showLogo: payload.showLogo,
    showCompanyInfo: payload.showCompanyInfo,
    customizeJson: payload.customizeJson,
    expiryDate: payload.expiryDate || undefined,
    issueDate: payload.issueDate || undefined,
    dueDate: payload.dueDate || undefined,
    status: (["draft", "sent", "paid", "overdue"] as const).includes(payload.status as never) ? (payload.status as FinancialDocument["status"]) : undefined,
    paidToDate: payload.paidToDate,
    lateFeeAccrued: payload.lateFeeAccrued,
    totalWithLateFee: payload.totalWithLateFee,
    depositType: (payload.depositType === "percent" || payload.depositType === "fixed" ? payload.depositType : "none") as FinancialDocument["depositType"],
    depositValue: payload.depositValue || "0",
  };

  const companySettings = {
    companyName: settings?.companyName ?? "",
    phone: settings?.phone ?? "",
    email: settings?.email ?? "",
    website: settings?.website ?? "",
    address: settings?.address ?? "",
    licenseNumber: settings?.licenseNumber ?? "",
    logoUrl,
    accentColor: settings?.accentColor ?? "#1f5a4a",
    defaultDocumentFont: (settings?.defaultDocumentFont ?? "helvetica") as FinancialDocument["font"],
    paymentInstructions: settings?.paymentInstructions ?? "",
  };

  const blob =
    payload.kind === "invoice"
      ? await buildInvoicePdf(doc, companySettings as never, asPdfLang(lang), pdfStrings(lang))
      : await buildQuotePdf(doc, companySettings as never, asPdfLang(lang), pdfStrings(lang));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 100 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("The document PDF could not be generated.");
  }
  const safeNum = (payload.invoiceNumber || String(payload.documentId)).replace(/[^A-Za-z0-9-]+/g, "") || String(payload.documentId);
  const filename = payload.kind === "invoice" ? `invoice-${safeNum}.pdf` : `estimate-${payload.documentId}.pdf`;

  // Build 0.6: append attachment pages (images grouped per imagesPerPage,
  // then attached PDF pages) after the main document.
  try {
    const table = payload.kind === "quote" ? schema.quotes : schema.invoices;
    const docRow = (await db.select({ companyId: table.companyId, imagesPerPage: table.imagesPerPage }).from(table).where(eq(table.id, payload.documentId)).limit(1))[0];
    if (docRow) {
      const attRows = await db
        .select()
        .from(schema.documentAttachments)
        .where(and(eq(schema.documentAttachments.docType, payload.kind), eq(schema.documentAttachments.docId, payload.documentId), eq(schema.documentAttachments.companyId, docRow.companyId)))
        .orderBy(schema.documentAttachments.sortOrder, schema.documentAttachments.id);
      if (attRows.length > 0) {
        const atts: AttachmentForPdf[] = [];
        for (const a of attRows) {
          try {
            const data = await ctx.blobs.get(a.blobKey);
            if (data && data.length > 0) atts.push({ kind: a.kind, contentType: a.contentType, bytes: new Uint8Array(data) });
          } catch {
            // skip unreadable blobs
          }
        }
        const perPage = docRow.imagesPerPage === 2 ? 2 : docRow.imagesPerPage === 4 ? 4 : 1;
        const merged = await appendAttachmentsToPdf(bytes, atts, perPage as 1 | 2 | 4, { lang });
        return { bytes: merged, filename };
      }
    }
  } catch {
    // Attachments are additive — never fail the main document for them.
  }
  return { bytes, filename };
}

// ---------------------------------------------------------------------------
// Formal change-order PDF (Danny 2026-10-21): renders the CO document row
// as the legal change-order document — number, parties, reference,
// scope, contract-sum chain, schedule/payment/terms lines, both
// signature blocks. All math comes from changeOrders.ts (server-side);
// signature images are read from their blobs as data URLs. This is THE
// canonical rendering for generated (non-uploaded) change orders: link
// downloads, the signed copy, portal downloads, and the owner's copy
// all serve bytes built here (or the stored copy of them).
// ---------------------------------------------------------------------------
export async function buildChangeOrderPdfForDocument(
  ctx: Ctx,
  documentId: number,
  lang: "en" | "es",
): Promise<{ bytes: Uint8Array; filename: string }> {
  const db = ctx.db<typeof schema>();
  const doc = (await db.select().from(schema.documents).where(eq(schema.documents.id, documentId)).limit(1))[0];
  if (!doc || doc.kind !== "change_order") throw new Error("Change order not found.");
  const job = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, doc.jobId)).limit(1))[0];
  if (!job) throw new Error("Job not found.");
  const settings =
    (await db.select().from(schema.settings).where(eq(schema.settings.companyId, job.companyId)).limit(1))[0] ??
    (await db.select().from(schema.settings).where(eq(schema.settings.id, 1)).limit(1))[0];
  const docs = await jobDocumentsOrdered(db, job.id);
  const math = changeOrderChain(job, docs).get(doc.id);
  if (!math) throw new Error("Change order not found.");
  const imageDataUrl = async (key: string | null): Promise<string | null> => {
    if (!key) return null;
    try {
      const bytes = await ctx.blobs.get(key);
      if (!bytes || bytes.length === 0) return null;
      const head = await ctx.blobs.head(key).catch(() => null);
      return `data:${head?.contentType || "image/png"};base64,${Buffer.from(bytes).toString("base64")}`;
    } catch {
      return null;
    }
  };
  const data: ChangeOrderPdfData = {
    coNumber: math.number,
    dateIso: doc.createdAt.toISOString().slice(0, 10),
    clientName: job.clientName,
    jobType: job.jobType,
    jobAddress: job.jobAddress,
    referenceContract: referenceContractTitle(docs),
    scope: doc.description,
    bodyText: doc.bodyText,
    contractSumBefore: math.contractSumBefore,
    amount: math.amount,
    newContractSum: math.newContractSum,
    contractorSignerName: doc.signerName,
    contractorSignatureDataUrl: await imageDataUrl(doc.signatureBlobKey),
    contractorSignedAtIso: doc.signedAt ? doc.signedAt.toISOString() : null,
    clientSignerName: doc.clientSignerName,
    clientSignatureDataUrl: await imageDataUrl(doc.clientSignatureBlobKey),
    clientSignedAtIso: doc.clientSignedAt ? doc.clientSignedAt.toISOString() : null,
    logoDataUrl: settings?.logoBlobKey ? await imageDataUrl(settings.logoBlobKey) : null,
  };
  const companySettings = {
    companyName: settings?.companyName ?? "",
    phone: settings?.phone ?? "",
    email: settings?.email ?? "",
    website: settings?.website ?? "",
    address: settings?.address ?? "",
    licenseNumber: settings?.licenseNumber ?? "",
    logoUrl: null,
    accentColor: settings?.accentColor ?? "#1f5a4a",
  };
  const blob = await buildChangeOrderPdf(data, companySettings as never, asPdfLang(lang));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 100 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("The document PDF could not be generated.");
  }
  const filename = lang === "es" ? `orden-de-cambio-${math.number}.pdf` : `change-order-${math.number}.pdf`;
  return { bytes, filename };
}
