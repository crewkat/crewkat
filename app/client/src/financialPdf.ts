// Crewkat financial-document PDF builder (estimates + invoices).
// Extracted from App.tsx so the document layout is unit-testable in bun.
// Pure layout/drawing code: no React, no browser APIs at module load.
import { jsPDF } from "jspdf";
import type { api, ApiResponse } from "./api";

export type PdfLang = "en" | "es";
export type PdfStrings = { discount: string; tax: string; paymentInstructions: string };
type PdfAdjustmentType = "percent" | "fixed";
type QuoteTheme = "classic" | "modern" | "bold" | "minimal";
type DocumentFont = "helvetica" | "times" | "courier" | "palatino";
type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";
type Settings = ApiResponse<typeof api, "getSettings">;
type Quote = ApiResponse<typeof api, "listQuotes">["quotes"][number];
type Invoice = ApiResponse<typeof api, "listInvoices">["invoices"][number];

export type DocumentLabels = { headline: string; billTo: string; description: string; amount: string; subtotal: string; total: string; paid: string; balanceDue: string; number: string; date: string; dueDate: string };
export type DocumentCustomize = { logoSize: "huge" | "big" | "medium" | "small"; removeLogoBackground: boolean; colorMode: "solid" | "gradient"; showQuantityUnitPrice: boolean; showDiscount: boolean; showTax: boolean; showAmount: boolean; showSummaryInfo: boolean; showSubtotal: boolean; showPaidSummary: boolean; showBalanceDue: boolean; showPaidStamp: boolean; showBusinessSignature: boolean; showThankYou: boolean; showBusinessName: boolean; showShortBusinessName: boolean; showLicenseNumber: boolean; showDueDate: boolean; headline: string; dateFormat: "long" | "numeric" | "euro"; termsConditions: string; signatureDataUrl: string; labels: DocumentLabels; fontSize: "s" | "m" | "l" | "xl"; lineSpacing: "compact" | "comfortable" | "roomy"; highContrast: boolean };

export async function blobDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error());
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function money(value: string) {
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function companyContact(settings: Settings | null, separator = " · ") {
  return [
    settings?.phone,
    settings?.email,
    settings?.website,
    settings?.address,
  ]
    .filter(Boolean)
    .join(separator);
}

export function financialTotals(
  items: Array<{ amount: string; quantity?: number; discount?: string }> ,
  discountType: PdfAdjustmentType,
  discountValue: string,
  taxType: PdfAdjustmentType,
  taxValue: string,
) {
  const subtotal = items.reduce((sum, item) => sum + Math.max(0, money(item.amount) * (item.quantity ?? 1) - money(item.discount ?? "0")), 0);
  const discountRaw = Math.max(0, money(discountValue));
  const discount = Math.min(
    subtotal,
    discountType === "percent" ? (subtotal * discountRaw) / 100 : discountRaw,
  );
  const taxable = Math.max(0, subtotal - discount);
  const taxRaw = Math.max(0, money(taxValue));
  const tax = taxType === "percent" ? (taxable * taxRaw) / 100 : taxRaw;
  return { subtotal, discount, tax, total: taxable + tax };
}

export function usd(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export async function loadImageDataUrl(url: string | null) {
  if (!url) return null;
  try {
    return await blobDataUrl(await (await fetch(url)).blob());
  } catch {
    return null;
  }
}

export function hexRgb(hex: string) {
  const clean = hex.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16) || 31,
    Number.parseInt(clean.slice(2, 4), 16) || 90,
    Number.parseInt(clean.slice(4, 6), 16) || 74,
  ] as const;
}

export function defaultDocumentCustomize(kind: "quote" | "invoice", lang: PdfLang = "en"): DocumentCustomize {
  return {
    logoSize: "medium", removeLogoBackground: false, colorMode: "solid",
    showQuantityUnitPrice: true, showDiscount: true, showTax: true, showAmount: true,
    showSummaryInfo: true, showSubtotal: true, showPaidSummary: true, showBalanceDue: true,
    showPaidStamp: true, showBusinessSignature: false, showThankYou: true,
    showBusinessName: true, showShortBusinessName: false, showLicenseNumber: true, showDueDate: true,
    headline: kind === "invoice" ? (lang === "es" ? "FACTURA" : "INVOICE") : (lang === "es" ? "COTIZACIÓN" : "ESTIMATE"),
    dateFormat: "long", termsConditions: "", signatureDataUrl: "",
    labels: { headline: "", billTo: lang === "es" ? "Facturar a" : "Bill to", description: lang === "es" ? "Descripción" : "Description", amount: lang === "es" ? "Importe" : "Amount", subtotal: lang === "es" ? "Subtotal" : "Subtotal", total: lang === "es" ? "Total" : "Total", paid: lang === "es" ? "Pagado" : "Paid", balanceDue: lang === "es" ? "Saldo pendiente" : "Balance due", number: lang === "es" ? "Número" : "Number", date: lang === "es" ? "Fecha" : "Date", dueDate: lang === "es" ? "Vencimiento" : "Due date" },
    fontSize: "m", lineSpacing: "comfortable", highContrast: true,
  };
}

export function parseDocumentCustomize(value: string | undefined, kind: "quote" | "invoice", lang: PdfLang): DocumentCustomize {
  const base = defaultDocumentCustomize(kind, lang);
  if (!value || value === "{}") return base;
  try {
    const parsed = JSON.parse(value) as Partial<DocumentCustomize>;
    return { ...base, ...parsed, labels: { ...base.labels, ...(parsed.labels ?? {}) } };
  } catch { return base; }
}

export function formatDocumentDate(value: string, format: DocumentCustomize["dateFormat"], lang: PdfLang) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  if (format === "numeric") return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { month: "2-digit", day: "2-digit", year: "numeric" }).format(date);
  if (format === "euro") return new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export type FinancialDocument = {
  id?: number;
  clientName: string;
  clientEmail?: string;
  jobAddress: string;
  shippingAddress?: string;
  jobType: string;
  lineItems: Array<{ name?: string; description: string; amount: string; quantity?: number; discount?: string; unit?: "none" | "days" | "hours" }>;
  invoiceNumber?: string;
  subtotal: string;
  discountType: PdfAdjustmentType;
  discountValue: string;
  taxType: PdfAdjustmentType;
  taxValue: string;
  total: string;
  lateFeeAccrued?: string;
  totalWithLateFee?: string;
  footnote: string;
  theme: QuoteTheme;
  font: DocumentFont;
  accentColor: string;
  showTaxLine: boolean;
  showDiscountLine: boolean;
  showPaidLine: boolean;
  showPaymentTerms: boolean;
  showFooterNotes: boolean;
  showLogo: boolean;
  showCompanyInfo: boolean;
  customizeJson: string;
  paidToDate?: string;
  expiryDate?: string;
  issueDate?: string;
  dueDate?: string;
  status?: InvoiceStatus;
};

export async function buildFinancialPdf(
  document: FinancialDocument,
  settings: Settings | null,
  lang: PdfLang,
  kind: "quote" | "invoice",
  strings: PdfStrings,
) {
  const custom = parseDocumentCustomize(document.customizeJson, kind, lang);
  const labels = custom.labels;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const w = doc.internal.pageSize.getWidth();
  const [r, g, b] = hexRgb(
    document.accentColor || settings?.accentColor || "#1f5a4a",
  );
  const logo = document.showLogo ? await loadImageDataUrl(settings?.logoUrl ?? null) : null;
  const theme = document.theme || "classic";
  const margin = theme === "minimal" ? 56 : 42;
  const docTitle = labels.headline || custom.headline;
  const docNumber = kind === "invoice" && document.invoiceNumber
    ? document.invoiceNumber
    : document.id
      ? `${kind === "quote" ? "EST" : "INV"}${String(document.id).padStart(4, "0")}`
      : "";
  const font = document.font || settings?.defaultDocumentFont || "helvetica";
  const bandH = theme === "bold" ? 72 : 56;
  const inBand = theme === "bold" || theme === "classic";
  if (theme === "bold") {
    doc.setFillColor(r, g, b);
    doc.rect(0, 0, w, bandH, "F");
    doc.setTextColor(255, 255, 255);
  } else if (theme === "modern") {
    doc.setFillColor(r, g, b);
    doc.rect(0, 0, 12, 792, "F");
    doc.setTextColor(r, g, b);
  } else if (theme === "classic") {
    doc.setFillColor(23, 26, 28);
    doc.rect(0, 0, w, bandH, "F");
    doc.setTextColor(255, 255, 255);
  } else doc.setTextColor(r, g, b);
  if (logo) {
    try {
      doc.addImage(
        logo,
        logo.startsWith("data:image/png") ? "PNG" : "JPEG",
        margin,
        inBand ? 12 : 18,
        { huge: 72, big: 58, medium: 40, small: 28 }[custom.logoSize],
        { huge: 45, big: 36, medium: 25, small: 18 }[custom.logoSize],
        undefined,
        "FAST",
      );
    } catch {
      /* text branding stays */
    }
  }
  doc.setFont(font, "bold");
  if (document.showCompanyInfo && inBand) {
    doc.setFontSize(theme === "bold" ? 11 : theme === "classic" ? 10.5 : 9);
    if (custom.showBusinessName) doc.text(custom.showShortBusinessName ? (settings?.companyName || "").split(/\s+/).slice(0, 2).join(" ") : settings?.companyName || "", w - margin, 22, { align: "right" });
    doc.setFont(font, "normal");
    doc.setFontSize(7);
    doc.setTextColor(214, 218, 217);
    const infoBits = [settings?.phone, custom.showLicenseNumber ? settings?.licenseNumber : "", settings?.website].filter(Boolean);
    if (infoBits.length) doc.text(infoBits.join("  ·  "), w - margin, 33, { align: "right" });
    if (settings?.address) doc.text(settings.address, w - margin, 43, { align: "right" });
  } else if (document.showCompanyInfo) {
    doc.setFontSize(11);
    doc.setTextColor(24, 32, 30);
    if (custom.showBusinessName) doc.text(custom.showShortBusinessName ? (settings?.companyName || "").split(/\s+/).slice(0, 2).join(" ") : settings?.companyName || "", logo ? margin + 50 : margin, 30);
  }
  const titleY = theme === "bold" ? 58 : inBand ? bandH + 26 : 82;
  doc.setFont(font, "bold");
  doc.setFontSize(theme === "bold" ? 14 : theme === "minimal" ? 18 : theme === "classic" ? 24 : 20);
  if (theme === "bold") doc.setTextColor(255, 255, 255);
  else doc.setTextColor(24, 32, 30);
  doc.text(docTitle, margin, titleY);
  doc.setFont(font, "normal");
  doc.setFontSize(8);
  if (theme === "bold") doc.setTextColor(255, 255, 255);
  else doc.setTextColor(70, 78, 76);
  if (docNumber) doc.text(docNumber, w - margin, titleY, { align: "right" });
  const infoY = titleY + 24;
  const clientPad = theme === "modern" ? 12 : 0;
  if (theme === "modern") {
    doc.setFillColor(241, 244, 243);
    doc.roundedRect(margin, infoY - 12, w - margin * 2, 68, 6, 6, "F");
  }
  const clientX = margin + clientPad;
  const rightX = w - margin - clientPad;
  doc.setTextColor(24, 32, 30);
  doc.setFont(font, "bold");
  doc.setFontSize(9);
  doc.text(`${labels.billTo}: ${document.clientName}`, clientX, infoY);
  doc.setFont(font, "normal");
  doc.setFontSize(8);
  doc.setTextColor(70, 78, 76);
  const clientSub = [document.jobType, document.jobAddress, document.shippingAddress]
    .filter((s) => s && s.trim())
    .join("  ·  ");
  const clientLines = clientSub
    ? ((doc.splitTextToSize(clientSub, (w - margin * 2) * 0.58) as string[]).slice(0, 3))
    : [];
  if (clientLines.length) doc.text(clientLines, clientX, infoY + 13);
  let ry = infoY;
  doc.setFont(font, "bold");
  doc.setFontSize(8);
  doc.setTextColor(24, 32, 30);
  if (docNumber) {
    doc.text(
      `${labels.number}: ${docNumber}`,
      rightX,
      ry,
      { align: "right" },
    );
    ry += 13;
  }
  if (kind === "invoice" && document.issueDate) {
    doc.setFont(font, "normal");
    doc.text(`${labels.date}: ${formatDocumentDate(document.issueDate, custom.dateFormat, lang)}`, rightX, ry, {
      align: "right",
    });
    ry += 13;
  }
  let y = Math.max(infoY + 13 + clientLines.length * 10 + 14, ry + 10);
  // Build 0.6 (item 13): paginate long documents. Content must stay above the
  // fixed footer zone (payment terms ~680, thank-you 742, license line 752):
  // without page breaks the line items ran off the bottom of the page and
  // the fixed footer printed on top of the flowing text.
  const PAGE_BOTTOM = 648;
  const drawTableHeaderRow = () => {
    if (theme !== "minimal") {
      if (theme === "classic") doc.setFillColor(23, 26, 28);
      else if (theme === "bold") doc.setFillColor(r, g, b);
      else doc.setFillColor(238, 241, 240);
      doc.rect(margin, y - 13, w - margin * 2, 20, "F");
      if (theme === "bold" || theme === "classic") doc.setTextColor(255, 255, 255);
      else doc.setTextColor(24, 32, 30);
    }
    doc.setFont(font, "bold");
    doc.setFontSize(9);
    doc.text(labels.description, margin + 8, y);
    if (custom.showQuantityUnitPrice) doc.text(lang === "es" ? "Cant. × Precio" : "Qty × Price", w - margin - 92, y, { align: "right" });
    if (custom.showAmount) doc.text(labels.amount, w - margin - 8, y, { align: "right" });
    y += 26;
  };
  const ensureSpace = (needed: number) => {
    if (y + needed <= PAGE_BOTTOM) return;
    doc.addPage();
    y = 40;
    drawTableHeaderRow();
  };
  ensureSpace(40);
  drawTableHeaderRow();
  doc.setTextColor(24, 32, 30);
  doc.setFont(font, "normal");
  doc.setFontSize(9);
  for (const item of document.lineItems) {
    const itemLabel = [item.name, item.description].filter(Boolean).join(" — ");
    const qty = item.quantity ?? 1;
    const itemTotal = Math.max(0, money(item.amount) * qty - money(item.discount ?? "0"));
    const detail = !custom.showQuantityUnitPrice || (qty === 1 && item.unit === "none" && money(item.discount ?? "0") <= 0)
      ? itemLabel
      : `${itemLabel} (${qty} ${item.unit === "days" ? "days" : item.unit === "hours" ? "hours" : "qty"}${money(item.discount ?? "0") > 0 ? `, -${usd(money(item.discount ?? "0"))}` : ""})`;
    const lines = doc.splitTextToSize(detail, w - margin * 2 - 130) as string[];
    const rowH = Math.max(20, lines.length * 11 + 6);
    ensureSpace(rowH);
    doc.text(lines, margin + 8, y);
    if (custom.showAmount) doc.text(usd(itemTotal), w - margin - 8, y, { align: "right" });
    doc.setDrawColor(224, 227, 226);
    doc.setLineWidth(0.5);
    doc.line(margin, y + rowH - 7, w - margin, y + rowH - 7);
    y += rowH;
  }
  y += 6;
  const totals = financialTotals(
    document.lineItems,
    document.discountType,
    document.discountValue,
    document.taxType,
    document.taxValue,
  );
  if (custom.showSummaryInfo) {
  ensureSpace(120);
  doc.setDrawColor(r, g, b);
  doc.line(w - margin - 200, y, w - margin, y);
  y += 16;
  doc.setFontSize(9);
  if (custom.showSubtotal) doc.text(`${labels.subtotal}: ${usd(totals.subtotal)}`, w - margin, y, { align: "right" });
  if (custom.showDiscount && document.showDiscountLine && totals.discount > 0) {
    y += 14;
    doc.text(`${strings.discount}: -${usd(totals.discount)}`, w - margin, y, {
      align: "right",
    });
  }
  if (custom.showTax && document.showTaxLine && totals.tax > 0) {
    y += 14;
    doc.text(`${strings.tax}: ${usd(totals.tax)}`, w - margin, y, { align: "right" });
  }
  if (kind === "invoice" && custom.showPaidSummary && document.showPaidLine && money(document.paidToDate ?? "0") > 0) {
    y += 14;
    doc.text(`${lang === "es" ? "Monto pagado" : "Amount paid"}: -${usd(money(document.paidToDate ?? "0"))}`, w - margin, y, { align: "right" });
  }
  const lateFee =
    kind === "invoice" ? money(document.lateFeeAccrued ?? "0") : 0;
  if (lateFee > 0) {
    y += 14;
    doc.text(
      `${lang === "es" ? "Cargo por atraso" : "Late fee"}: ${usd(lateFee)}`,
      w - margin,
      y,
      { align: "right" },
    );
  }
  y += 18;
  const totalLabel =
    kind === "invoice" && lateFee > 0
      ? lang === "es"
        ? "Total con cargo"
        : "Total with fee"
      : labels.total;
  const totalValue = usd(
    kind === "invoice" ? money(document.totalWithLateFee ?? document.total) : totals.total,
  );
  if (custom.showAmount && theme === "classic") {
    doc.setFillColor(23, 26, 28);
    doc.rect(w - margin - 250, y - 12, 250, 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont(font, "bold");
    doc.setFontSize(13);
    doc.text(`${totalLabel}: ${totalValue}`, w - margin - 8, y + 3, {
      align: "right",
    });
  } else if (custom.showAmount) {
    doc.setFont(font, "bold");
    doc.setFontSize(12);
    doc.setTextColor(r, g, b);
    doc.text(`${totalLabel}: ${totalValue}`, w - margin, y, {
      align: "right",
    });
  }
  }
  y += 24;
  doc.setTextColor(70, 78, 76);
  const dateValue = kind === "quote" ? document.expiryDate : document.dueDate;
  const dateLabel = labels.dueDate;
  if (custom.showDueDate && dateValue) {
    ensureSpace(24);
    y += 6;
    doc.setFont(font, "normal");
    doc.setFontSize(9);
    doc.text(`${dateLabel}: ${formatDocumentDate(dateValue, custom.dateFormat, lang)}`, margin, y);
    y += 8;
  }
  if (document.showFooterNotes && document.footnote) {
    y += 16;
    doc.setFont(font, "normal");
    doc.setFontSize(8);
    doc.setTextColor(70, 78, 76);
    const lines = doc.splitTextToSize(
      document.footnote,
      w - margin * 2,
    ) as string[];
    ensureSpace(lines.length * 10 + 12);
    doc.text(lines, margin, y);
    y += lines.length * 10 + 6;
  }
  if (document.showPaymentTerms && settings?.paymentInstructions) {
    const paymentLines = doc.splitTextToSize(`${strings.paymentInstructions}: ${settings.paymentInstructions}`, w - margin * 2) as string[];
    doc.setFont(font, "normal"); doc.setFontSize(8); doc.setTextColor(70, 78, 76); doc.text(paymentLines, margin, 680);
  }
  if (custom.termsConditions) {
    const terms = doc.splitTextToSize(`${lang === "es" ? "Términos y condiciones" : "Terms and conditions"}: ${custom.termsConditions}`, w - margin * 2) as string[];
    doc.setFont(font, "normal"); doc.setFontSize(8); doc.setTextColor(70, 78, 76); doc.text(terms.slice(0, 4), margin, 715);
  }
  if (custom.showBusinessSignature && custom.signatureDataUrl) {
    try { doc.addImage(`data:image/png;base64,${custom.signatureDataUrl}`, "PNG", w - margin - 120, 665, 110, 38, undefined, "FAST"); } catch { /* keep PDF usable */ }
  }
  if (custom.showThankYou) { doc.setFont(font, "italic"); doc.setFontSize(8); doc.setTextColor(r, g, b); doc.text(lang === "es" ? "Gracias por su preferencia" : "Thank you for your business", w / 2, 742, { align: "center" }); }
  doc.setFont(font, "normal");
  doc.setFontSize(7);
  doc.setTextColor(90, 98, 96);
  if (document.showCompanyInfo) doc.text(
    [settings?.licenseNumber, companyContact(settings)]
      .filter(Boolean)
      .join(" · "),
    margin,
    752,
  );
  return doc.output("blob");
}
export async function buildQuotePdf(
  quote: Quote | FinancialDocument,
  settings: Settings | null,
  lang: PdfLang,
  strings: PdfStrings,
) {
  return buildFinancialPdf(quote, settings, lang, "quote", strings);
}
export async function buildInvoicePdf(
  invoice: Invoice | FinancialDocument,
  settings: Settings | null,
  lang: PdfLang,
  strings: PdfStrings,
) {
  return buildFinancialPdf(invoice, settings, lang, "invoice", strings);
}
