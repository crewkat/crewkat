// Crewkat financial-document PDF builder (estimates + invoices).
// Extracted from App.tsx so the document layout is unit-testable in bun.
// Pure layout/drawing code: no React, no browser APIs at module load.
import { jsPDF, GState } from "jspdf";
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
    headline: kind === "invoice" ? (lang === "es" ? "FACTURA" : "INVOICE") : (lang === "es" ? "ESTIMADO" : "ESTIMATE"),
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
  depositType?: "none" | "percent" | "fixed";
  depositValue?: string;
};

// Phase 2 (PDF polish): line-item descriptions use **bold** lead-ins (e.g.
// "**SCOPE OF WORK — ...**"). jsPDF draws one font per text call, so the
// label is parsed into styled runs, wrapped by measured word widths, and
// drawn run by run. Before this, the asterisks printed literally.
export type RichRun = { text: string; bold: boolean };

export function parseRichRuns(text: string): RichRun[] {
  const parts = text.split("**");
  if ((parts.length - 1) % 2 === 1) {
    // Unbalanced marker: keep the trailing "**" literal rather than bolding
    // the rest of the string.
    const last = parts.pop() as string;
    parts[parts.length - 1] = `${parts[parts.length - 1]}**${last}`;
  }
  const runs = parts
    .map((part, index) => ({ text: part, bold: index % 2 === 1 }))
    .filter((run) => run.text.length > 0);
  return runs.length ? runs : [{ text, bold: false }];
}

function wrapRichLines(doc: jsPDF, runs: RichRun[], maxWidth: number, font: DocumentFont): RichRun[][] {
  type Word = { text: string; bold: boolean; width: number };
  // Hard line breaks: a "\n" in the source text is a paragraph break, never
  // a wrappable space. jsPDF's doc.text() splits any string containing "\n"
  // into extra visual lines at its own line height (fontSize × 1.15), which
  // the layout (row height, page breaks) never counts — so every mid-run
  // newline added an uncounted line and long multi-line descriptions
  // progressively overprinted themselves (INV-0011, Danny 2026-10-12). Split
  // the run stream into paragraphs first and wrap each one independently,
  // so the lines returned here are exactly the lines drawn and no drawn run
  // ever contains a newline.
  const paragraphs: RichRun[][] = [[]];
  for (const run of runs) {
    run.text.split(/\r\n|\r|\n/).forEach((segment, index) => {
      if (index > 0) paragraphs.push([]);
      if (segment) paragraphs[paragraphs.length - 1]!.push({ text: segment, bold: run.bold });
    });
  }
  // Leading/trailing blank lines carry no visible content — drop them so a
  // stray trailing Enter doesn't grow the row. Blank lines BETWEEN
  // paragraphs keep their height (handled below).
  while (paragraphs.length > 1 && !paragraphs[0]!.length) paragraphs.shift();
  while (paragraphs.length > 1 && !paragraphs[paragraphs.length - 1]!.length) paragraphs.pop();
  const lines: RichRun[][] = [];
  for (const paragraph of paragraphs) {
    const linesBefore = lines.length;
    const words: Word[] = [];
    for (const run of paragraph) {
      doc.setFont(font, run.bold ? "bold" : "normal");
      for (const token of run.text.split(/(\s+)/)) {
        if (token) words.push({ text: token, bold: run.bold, width: doc.getTextWidth(token) });
      }
    }
    let line: Word[] = [];
    let lineWidth = 0;
    const flush = () => {
      while (line.length && line[line.length - 1]!.text.trim() === "") line.pop();
      const merged: RichRun[] = [];
      for (const word of line) {
        const prev = merged[merged.length - 1];
        if (prev && prev.bold === word.bold) prev.text += word.text;
        else merged.push({ text: word.text, bold: word.bold });
      }
      lines.push(merged);
      line = [];
      lineWidth = 0;
    };
    for (const word of words) {
      if (word.text.trim() === "") {
        if (line.length) {
          line.push(word);
          lineWidth += word.width;
        }
        continue;
      }
      if (line.length && lineWidth + word.width > maxWidth) flush();
      line.push(word);
      lineWidth += word.width;
    }
    if (line.length) flush();
    // A paragraph with no wrappable words (a blank source line between
    // paragraphs) still owns one line of height, exactly as typed.
    if (lines.length === linesBefore) lines.push([]);
  }
  return lines.length ? lines : [[]];
}

function drawRichLine(doc: jsPDF, line: RichRun[], x: number, y: number, font: DocumentFont) {
  let cursor = x;
  for (const run of line) {
    doc.setFont(font, run.bold ? "bold" : "normal");
    doc.text(run.text, cursor, y);
    cursor += doc.getTextWidth(run.text);
  }
  doc.setFont(font, "normal");
}

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
  // Customize wiring (Danny 2026-10-12): fontSize, lineSpacing, highContrast,
  // colorMode, and showPaidStamp were saved by the Customize UI and parsed
  // into `custom`, but the generator never read them — the PDF always came
  // out at the defaults. They are honored below. The middle steps
  // (fontSize "m", lineSpacing "comfortable") and colorMode "solid" are
  // exact no-ops vs the historical rendering.
  const FONT_SCALE = ({ s: 0.92, m: 1, l: 1.08, xl: 1.16 } as const)[custom.fontSize];
  const LINE_FACTOR = ({ compact: 0.92, comfortable: 1, roomy: 1.12 } as const)[custom.lineSpacing];
  const F = (size: number) => size * FONT_SCALE;
  const descStep = 11 * FONT_SCALE * LINE_FACTOR;
  const noteStep = 10 * FONT_SCALE * LINE_FACTOR;
  const metaStep = 13 * FONT_SCALE;
  const rowTopPad = 11 * FONT_SCALE;
  type Rgb = readonly [number, number, number];
  // High contrast: body ink goes pure black and the secondary/dim grays
  // darken substantially (the preview's #101514 vs #47504e treatment). Off =
  // the historical palette, untouched.
  const ink: Rgb = custom.highContrast ? [0, 0, 0] : [24, 32, 30];
  const dimInk: Rgb = custom.highContrast ? [38, 43, 41] : [70, 78, 76];
  const faintInk: Rgb = custom.highContrast ? [52, 58, 55] : [90, 98, 96];
  const bandDimInk: Rgb = custom.highContrast ? [255, 255, 255] : [214, 218, 217];
  const DARK_SHADE: Rgb = [17, 24, 39];
  const mixTo = (base: Rgb, target: Rgb, t: number): [number, number, number] => [
    Math.round(base[0] + (target[0] - base[0]) * t),
    Math.round(base[1] + (target[1] - base[1]) * t),
    Math.round(base[2] + (target[2] - base[2]) * t),
  ];
  // A flat fill in solid mode (identical calls to the old code, so default
  // PDFs are unchanged); in gradient mode a 48-strip gradient from the base
  // color to a darker shade of it — the PDF echo of the preview's
  // linear-gradient(accent, accent mixed 46% with #111827).
  const fillBand = (x: number, y: number, bw: number, bh: number, base: Rgb, vertical = false) => {
    if (custom.colorMode !== "gradient") {
      doc.setFillColor(base[0], base[1], base[2]);
      doc.rect(x, y, bw, bh, "F");
      return;
    }
    const end = mixTo(base, DARK_SHADE, 0.54);
    const steps = 48;
    for (let i = 0; i < steps; i++) {
      const c = mixTo(base, end, i / (steps - 1));
      doc.setFillColor(c[0], c[1], c[2]);
      if (vertical) doc.rect(x, y + (bh * i) / steps, bw, bh / steps + 0.75, "F");
      else doc.rect(x + (bw * i) / steps, y, bw / steps + 0.75, bh, "F");
    }
  };
  const bandH = theme === "bold" ? 72 : 56;
  const inBand = theme === "bold" || theme === "classic";
  if (theme === "bold") {
    fillBand(0, 0, w, bandH, [r, g, b]);
    doc.setTextColor(255, 255, 255);
  } else if (theme === "modern") {
    fillBand(0, 0, 12, 792, [r, g, b], true);
    doc.setTextColor(r, g, b);
  } else if (theme === "classic") {
    fillBand(0, 0, w, bandH, [23, 26, 28]);
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
    doc.setFontSize(F(theme === "bold" ? 11 : theme === "classic" ? 10.5 : 9));
    if (custom.showBusinessName) doc.text(custom.showShortBusinessName ? (settings?.companyName || "").split(/\s+/).slice(0, 2).join(" ") : settings?.companyName || "", w - margin, 22, { align: "right" });
    doc.setFont(font, "normal");
    doc.setFontSize(F(7));
    doc.setTextColor(...bandDimInk);
    const infoBits = [settings?.phone, custom.showLicenseNumber ? settings?.licenseNumber : "", settings?.website].filter(Boolean);
    if (infoBits.length) doc.text(infoBits.join("  ·  "), w - margin, 33, { align: "right" });
    if (settings?.address) doc.text(settings.address, w - margin, 43, { align: "right" });
  } else if (document.showCompanyInfo) {
    doc.setFontSize(F(11));
    doc.setTextColor(...ink);
    if (custom.showBusinessName) doc.text(custom.showShortBusinessName ? (settings?.companyName || "").split(/\s+/).slice(0, 2).join(" ") : settings?.companyName || "", logo ? margin + 50 : margin, 30);
  }
  const titleY = theme === "bold" ? 58 : inBand ? bandH + 26 : 82;
  doc.setFont(font, "bold");
  doc.setFontSize(F(theme === "bold" ? 14 : theme === "minimal" ? 18 : theme === "classic" ? 24 : 20));
  if (theme === "bold") doc.setTextColor(255, 255, 255);
  else doc.setTextColor(...ink);
  doc.text(docTitle, margin, titleY);
  // Phase 2: short accent rule under the document title (white inside the
  // bold theme's accent band, template accent everywhere else).
  if (custom.colorMode === "gradient" && theme !== "bold") {
    // The accent rule is Minimal's main accent element (it has no band) and
    // a secondary one on classic/modern — gradient it like the bands.
    fillBand(margin, titleY + 9 - 1.25, 46, 2.5, [r, g, b]);
  } else {
    doc.setLineWidth(2.5);
    if (theme === "bold") doc.setDrawColor(255, 255, 255);
    else doc.setDrawColor(r, g, b);
    doc.line(margin, titleY + 9, margin + 46, titleY + 9);
  }
  doc.setFont(font, "normal");
  doc.setFontSize(F(8));
  if (theme === "bold") doc.setTextColor(255, 255, 255);
  else doc.setTextColor(...dimInk);
  if (docNumber) doc.text(docNumber, w - margin, titleY, { align: "right" });
  const infoY = titleY + 24;
  const clientPad = theme === "modern" ? 12 : 0;
  if (theme === "modern") {
    doc.setFillColor(241, 244, 243);
    doc.roundedRect(margin, infoY - 12, w - margin * 2, 68, 6, 6, "F");
  }
  const clientX = margin + clientPad;
  const rightX = w - margin - clientPad;
  doc.setTextColor(...ink);
  doc.setFont(font, "bold");
  doc.setFontSize(F(9));
  doc.text(`${labels.billTo}: ${document.clientName}`, clientX, infoY);
  doc.setFont(font, "normal");
  doc.setFontSize(F(8));
  doc.setTextColor(...dimInk);
  const clientSub = [document.jobType, document.jobAddress, document.shippingAddress]
    .filter((s) => s && s.trim())
    .join("  ·  ");
  const clientLines = clientSub
    ? ((doc.splitTextToSize(clientSub, (w - margin * 2) * 0.58) as string[]).slice(0, 3))
    : [];
  if (clientLines.length) doc.text(clientLines, clientX, infoY + 13);
  let ry = infoY;
  doc.setFont(font, "bold");
  doc.setFontSize(F(8));
  doc.setTextColor(...ink);
  if (docNumber) {
    doc.text(
      `${labels.number}: ${docNumber}`,
      rightX,
      ry,
      { align: "right" },
    );
    ry += metaStep;
  }
  if (document.issueDate) {
    doc.setFont(font, "normal");
    doc.text(`${labels.date}: ${formatDocumentDate(document.issueDate, custom.dateFormat, lang)}`, rightX, ry, {
      align: "right",
    });
    ry += metaStep;
  }
  // Phase 2: the due date lives in the header meta block (it used to print
  // alone under the totals). Estimates show their expiry date here.
  const metaDueDate = kind === "invoice" ? document.dueDate : document.expiryDate;
  if (custom.showDueDate && metaDueDate) {
    doc.setFont(font, "normal");
    doc.text(`${labels.dueDate}: ${formatDocumentDate(metaDueDate, custom.dateFormat, lang)}`, rightX, ry, {
      align: "right",
    });
    ry += metaStep;
  }
  let y = Math.max(infoY + 13 + clientLines.length * 10 * FONT_SCALE + 14, ry + 10);
  // Build 0.6 (item 13): paginate long documents. Content must stay above the
  // footer zone (thank-you ~748, footer hairline 758): without page breaks
  // the line items ran off the bottom of the page and the footer printed on
  // top of the flowing text.
  const PAGE_BOTTOM = 648;
  // Items area on a fresh continuation page: a break lands at y=40 and the
  // repeated table-header row takes it to 66, so a row fits whole on one
  // page only if its height is at most PAGE_BOTTOM - 66.
  const FRESH_ITEMS_Y = 66;
  const drawTableHeaderRow = () => {
    if (theme !== "minimal") {
      if (theme === "classic") fillBand(margin, y - 13, w - margin * 2, 20, [23, 26, 28]);
      else if (theme === "bold") fillBand(margin, y - 13, w - margin * 2, 20, [r, g, b]);
      else {
        doc.setFillColor(238, 241, 240);
        doc.rect(margin, y - 13, w - margin * 2, 20, "F");
      }
      if (theme === "bold" || theme === "classic") doc.setTextColor(255, 255, 255);
      else doc.setTextColor(...ink);
    }
    doc.setFont(font, "bold");
    doc.setFontSize(F(9));
    doc.text(labels.description, margin + 8, y);
    if (custom.showQuantityUnitPrice) doc.text(lang === "es" ? "Cant. × Precio" : "Qty × Price", w - margin - 92, y, { align: "right" });
    if (custom.showAmount) doc.text(labels.amount, w - margin - 8, y, { align: "right" });
    y += 26;
  };
  const breakToFreshPage = () => {
    doc.addPage();
    y = 40;
    drawTableHeaderRow();
    // Build 3.0 (item 16b): the header row leaves white text active on the
    // classic/bold themes. Without this reset, every line-item row and the
    // totals drawn after a page break print white-on-white, so the PDF looks
    // empty (header only) even though the text is in the file.
    doc.setTextColor(...ink);
    doc.setFont(font, "normal");
    doc.setFontSize(F(9));
  };
  const ensureSpace = (needed: number) => {
    if (y + needed <= PAGE_BOTTOM) return;
    breakToFreshPage();
  };
  ensureSpace(40);
  drawTableHeaderRow();
  doc.setTextColor(...ink);
  doc.setFont(font, "normal");
  doc.setFontSize(F(9));
  let rowIndex = 0;
  for (const item of document.lineItems) {
    const itemLabel = [item.name, item.description].filter(Boolean).join(" — ");
    const qty = item.quantity ?? 1;
    const itemTotal = Math.max(0, money(item.amount) * qty - money(item.discount ?? "0"));
    const suffix = !custom.showQuantityUnitPrice || (qty === 1 && item.unit === "none" && money(item.discount ?? "0") <= 0)
      ? ""
      : ` (${qty} ${item.unit === "days" ? "days" : item.unit === "hours" ? "hours" : "qty"}${money(item.discount ?? "0") > 0 ? `, -${usd(money(item.discount ?? "0"))}` : ""})`;
    // Phase 2: **bold** lead-ins render as real bold (parseRichRuns), and
    // alternating rows get a whisper zebra fill on the banded themes.
    const runs = parseRichRuns(itemLabel);
    if (suffix) runs.push({ text: suffix, bold: false });
    // wrapRichLines measures with the ambient font size — pin it to the
    // scaled body size first so fontSize/lineSpacing flow into the wrap.
    doc.setFontSize(F(9));
    const richLines = wrapRichLines(doc, runs, w - margin * 2 - 130, font);
    const rowH = Math.max(20, richLines.length * descStep + 6);
    const zebraRow = theme !== "minimal" && rowIndex % 2 === 1;
    if (rowH > PAGE_BOTTOM - FRESH_ITEMS_Y) {
      // A row taller than one full page of items area can never fit whole:
      // ensureSpace(rowH) would push the ENTIRE row off the current page
      // (page 1 left holding just the header + PAID stamp) and every line
      // past the next page's bottom was drawn off-page and silently lost —
      // INV-0011's 3-page scope, Danny 2026-10-12. Instead the row STARTS
      // on the current page and splits at description-line boundaries,
      // flowing across pages: the item name + amount ride the first chunk,
      // the repeated table header opens each continuation page, and the
      // row's separator line closes the final chunk. Rows that fit on one
      // page (the else branch) keep the move-whole behavior untouched.
      let lineStart = 0;
      let firstChunk = true;
      while (lineStart < richLines.length) {
        // Whole lines whose baselines stay inside the items area from here.
        const fit = Math.floor((PAGE_BOTTOM - 6 - y) / descStep);
        if (fit < 1) {
          breakToFreshPage();
          continue;
        }
        const remaining = richLines.length - lineStart;
        const isLast = fit >= remaining;
        const n = isLast ? remaining : fit;
        if (zebraRow) {
          doc.setFillColor(247, 249, 248);
          doc.rect(margin, y - (firstChunk ? rowTopPad : 6), w - margin * 2, n * descStep + 6, "F");
        }
        doc.setTextColor(...ink);
        doc.setFontSize(F(9));
        for (let i = 0; i < n; i++) {
          drawRichLine(doc, richLines[lineStart + i]!, margin + 8, y + i * descStep, font);
        }
        if (firstChunk && custom.showAmount) {
          doc.setFont(font, "normal");
          doc.text(usd(itemTotal), w - margin - 8, y, { align: "right" });
        }
        if (isLast) {
          doc.setDrawColor(224, 227, 226);
          doc.setLineWidth(0.5);
          doc.line(margin, y + n * descStep - 1, w - margin, y + n * descStep - 1);
          y += n * descStep + 6;
        } else {
          breakToFreshPage();
        }
        lineStart += n;
        firstChunk = false;
      }
    } else {
      ensureSpace(rowH);
      if (zebraRow) {
        doc.setFillColor(247, 249, 248);
        doc.rect(margin, y - rowTopPad, w - margin * 2, rowH, "F");
      }
      doc.setTextColor(...ink);
      doc.setFontSize(F(9));
      richLines.forEach((lineRuns, lineIndex) => drawRichLine(doc, lineRuns, margin + 8, y + lineIndex * descStep, font));
      if (custom.showAmount) {
        doc.setFont(font, "normal");
        doc.text(usd(itemTotal), w - margin - 8, y, { align: "right" });
      }
      doc.setDrawColor(224, 227, 226);
      doc.setLineWidth(0.5);
      doc.line(margin, y + rowH - 7, w - margin, y + rowH - 7);
      y += rowH;
    }
    rowIndex += 1;
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
    // Phase 2: the totals live in a boxed summary panel — label left, amount
    // right, divider, then the emphasized Total. The classic theme keeps its
    // dark total band, inset 6pt inside the 262pt panel so the band keeps
    // its exact legacy 250pt width. Invoices also get a Balance due row that
    // accounts for payments already made.
    const panelW = 262;
    const panelX = w - margin - panelW;
    const rowStep = 15 * FONT_SCALE;
    const paidToDate = kind === "invoice" ? money(document.paidToDate ?? "0") : 0;
    const lateFee = kind === "invoice" ? money(document.lateFeeAccrued ?? "0") : 0;
    const totalLabel =
      kind === "invoice" && lateFee > 0
        ? lang === "es"
          ? "Total con cargo"
          : "Total with fee"
        : labels.total;
    const totalNum = kind === "invoice" ? money(document.totalWithLateFee ?? document.total) : totals.total;
    const totalValue = usd(totalNum);
    const balanceDue = kind === "invoice" ? Math.max(0, totalNum - paidToDate) : 0;
    const showBalance = kind === "invoice" && custom.showBalanceDue && (paidToDate > 0 || balanceDue > 0);
    type TotalRow = { label: string; value: string };
    const rows: TotalRow[] = [];
    if (custom.showSubtotal) rows.push({ label: `${labels.subtotal}:`, value: usd(totals.subtotal) });
    if (custom.showDiscount && document.showDiscountLine && totals.discount > 0) rows.push({ label: `${strings.discount}:`, value: `-${usd(totals.discount)}` });
    if (custom.showTax && document.showTaxLine && totals.tax > 0) rows.push({ label: `${strings.tax}:`, value: usd(totals.tax) });
    if (kind === "invoice" && custom.showPaidSummary && document.showPaidLine && paidToDate > 0) rows.push({ label: `${lang === "es" ? "Monto pagado" : "Amount paid"}:`, value: `-${usd(paidToDate)}` });
    if (lateFee > 0) rows.push({ label: `${lang === "es" ? "Cargo por atraso" : "Late fee"}:`, value: usd(lateFee) });
    const totalRowH = custom.showAmount ? 24 : 0;
    const panelH = 12 + rows.length * rowStep + (rows.length && totalRowH ? 8 : 0) + totalRowH + (showBalance ? 19 : 0) + 8;
    ensureSpace(panelH + 6);
    doc.setFillColor(249, 251, 250);
    doc.setDrawColor(219, 223, 221);
    doc.setLineWidth(0.75);
    doc.roundedRect(panelX, y, panelW, panelH, 6, 6, "FD");
    let by = y + 21;
    doc.setFont(font, "normal");
    doc.setFontSize(F(9));
    doc.setTextColor(...ink);
    for (const row of rows) {
      doc.text(row.label, panelX + 12, by);
      doc.text(row.value, panelX + panelW - 12, by, { align: "right" });
      by += rowStep;
    }
    if (rows.length && totalRowH) {
      doc.setDrawColor(224, 227, 226);
      doc.setLineWidth(0.5);
      doc.line(panelX + 12, by - 9, panelX + panelW - 12, by - 9);
      by += 6;
    }
    if (custom.showAmount && theme === "classic") {
      fillBand(panelX + 6, by - 12, 250, 22, [23, 26, 28]);
      doc.setTextColor(255, 255, 255);
      doc.setFont(font, "bold");
      doc.setFontSize(F(13));
      doc.text(`${totalLabel}:`, panelX + 16, by + 3);
      doc.text(totalValue, panelX + panelW - 14, by + 3, { align: "right" });
      by += 24;
    } else if (custom.showAmount) {
      doc.setFont(font, "bold");
      doc.setFontSize(F(12.5));
      doc.setTextColor(r, g, b);
      doc.text(`${totalLabel}:`, panelX + 12, by + 3);
      doc.text(totalValue, panelX + panelW - 12, by + 3, { align: "right" });
      by += 24;
    }
    if (showBalance) {
      doc.setFont(font, "bold");
      doc.setFontSize(F(10));
      if (balanceDue > 0) doc.setTextColor(r, g, b);
      else doc.setTextColor(34, 120, 70);
      doc.text(`${labels.balanceDue}:`, panelX + 12, by + 4);
      doc.text(usd(balanceDue), panelX + panelW - 12, by + 4, { align: "right" });
      by += 19;
    }
    y += panelH;
  }
  // Deposit request line (estimates): "Deposit due (50%): $3,250.00" + balance.
  const depType = document.depositType === "percent" || document.depositType === "fixed" ? document.depositType : "none";
  const depVal = Number(document.depositValue ?? "0");
  if (depType !== "none" && depVal > 0) {
    const totalNum = money(kind === "invoice" ? String(document.totalWithLateFee ?? document.total) : String(totals.total));
    const depAmount = depType === "percent" ? (totalNum * depVal) / 100 : depVal;
    const depLabel = lang === "es" ? "Anticipo requerido" : "Deposit due";
    const depDetail = depType === "percent" ? ` (${depVal}%)` : "";
    y += 16 * FONT_SCALE;
    doc.setFont(font, "normal");
    doc.setFontSize(F(10));
    doc.setTextColor(...dimInk);
    doc.text(`${depLabel}${depDetail}: ${usd(depAmount)}`, w - margin, y, { align: "right" });
    const balance = Math.max(0, totalNum - depAmount);
    y += 14 * FONT_SCALE;
    doc.setFont(font, "bold");
    doc.setFontSize(F(10));
    doc.setTextColor(r, g, b);
    doc.text(`${lang === "es" ? "Saldo restante" : "Remaining balance"}: ${usd(balance)}`, w - margin, y, { align: "right" });
  }
  y += 24;
  // Phase 2: footnote / payment instructions / terms share one light shaded
  // panel in the flow. They used to print at fixed positions (y 680/715) on
  // the last page only, where long documents could collide with them.
  doc.setFont(font, "normal");
  doc.setFontSize(F(8));
  const noteSections: string[][] = [];
  if (document.showFooterNotes && document.footnote) {
    noteSections.push(doc.splitTextToSize(document.footnote, w - margin * 2 - 20) as string[]);
  }
  if (document.showPaymentTerms && settings?.paymentInstructions) {
    noteSections.push(doc.splitTextToSize(`${strings.paymentInstructions}: ${settings.paymentInstructions}`, w - margin * 2 - 20) as string[]);
  }
  if (custom.termsConditions) {
    noteSections.push((doc.splitTextToSize(`${lang === "es" ? "Términos y condiciones" : "Terms and conditions"}: ${custom.termsConditions}`, w - margin * 2 - 20) as string[]).slice(0, 4));
  }
  if (noteSections.length) {
    const noteLineCount = noteSections.reduce((sum, section) => sum + section.length, 0);
    const notesH = noteLineCount * noteStep + (noteSections.length - 1) * 5 + 16;
    ensureSpace(notesH + 14);
    y += 6;
    doc.setFillColor(246, 248, 247);
    doc.setDrawColor(226, 230, 228);
    doc.setLineWidth(0.5);
    doc.roundedRect(margin, y, w - margin * 2, notesH, 5, 5, "FD");
    let ny = y + 14;
    doc.setFont(font, "normal");
    doc.setFontSize(F(8));
    doc.setTextColor(...dimInk);
    for (const section of noteSections) {
      doc.text(section, margin + 10, ny);
      ny += section.length * noteStep + 5;
    }
    y += notesH + 8;
  }
  // Phase 2: styled business-signature block — image over a signature rule
  // with a caption (it used to float unstyled at a fixed position).
  if (custom.showBusinessSignature && custom.signatureDataUrl) {
    ensureSpace(72);
    y += 6;
    try { doc.addImage(`data:image/png;base64,${custom.signatureDataUrl}`, "PNG", w - margin - 120, y, 110, 38, undefined, "FAST"); } catch { /* keep PDF usable */ }
    const sigLineY = y + 46;
    doc.setDrawColor(120, 128, 125);
    doc.setLineWidth(0.75);
    doc.line(w - margin - 130, sigLineY, w - margin, sigLineY);
    doc.setFont(font, "normal");
    doc.setFontSize(F(7.5));
    doc.setTextColor(...dimInk);
    doc.text(lang === "es" ? "Firma de la empresa" : "Business signature", w - margin - 130, sigLineY + 11);
    y = sigLineY + 18;
  }
  // Customize wiring: the PAID stamp — invoices only (an accepted estimate
  // is not a paid document), and only when the invoice is fully paid and the
  // toggle is on. A rotated double-rule stamp in the accent color, echoing
  // the preview's .paid-stamp. It sits in the left-center body: the totals
  // panel owns the right side and amounts are right-aligned, so the stamp
  // can never cover either. Drawn on page 1, before the footer pass.
  if (kind === "invoice" && custom.showPaidStamp && document.status === "paid") {
    doc.setPage(1);
    const stampText = labels.paid.toUpperCase();
    const stampSize = 30 * FONT_SCALE;
    const cx = margin + 150;
    const cy = 402;
    const angleRad = (-12 * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const rot = (dx: number, dy: number): [number, number] => [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    doc.setFont(font, "bold");
    doc.setFontSize(stampSize);
    const charSpace = 3;
    const boxW = doc.getTextWidth(stampText) + charSpace * stampText.length + 44;
    const boxH = stampSize + 26;
    const ring = (inset: number, lineWidth: number) => {
      const hw = boxW / 2 - inset;
      const hh = boxH / 2 - inset;
      const pts = [rot(-hw, -hh), rot(hw, -hh), rot(hw, hh), rot(-hw, hh)];
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(lineWidth);
      for (let i = 0; i < 4; i++) {
        const [x1, y1] = pts[i]!;
        const [x2, y2] = pts[(i + 1) % 4]!;
        doc.line(x1, y1, x2, y2);
      }
    };
    let stampStateSaved = false;
    try {
      doc.saveGraphicsState();
      doc.setGState(new GState({ opacity: 0.55 }));
      stampStateSaved = true;
    } catch { /* full-strength stamp still reads fine */ }
    ring(0, 2.2);
    ring(4.5, 0.8);
    doc.setTextColor(r, g, b);
    const [tx, ty] = rot(0, stampSize * 0.36);
    doc.text(stampText, tx, ty, { align: "center", angle: -12, charSpace });
    if (stampStateSaved) {
      try { doc.restoreGraphicsState(); } catch { /* nothing to restore */ }
    }
  }
  // Phase 2: a real footer on EVERY page — thank-you line, hairline, then
  // license/contact on the left and Page X of Y on the right.
  const pageCount = doc.getNumberOfPages();
  const footerParts = [settings?.licenseNumber, settings?.phone, settings?.email, settings?.website, settings?.address].filter(Boolean) as string[];
  doc.setFont(font, "normal");
  doc.setFontSize(F(7));
  while (footerParts.length > 1 && doc.getTextWidth(footerParts.join(" · ")) > 425) footerParts.pop();
  const footerLeft = document.showCompanyInfo ? footerParts.join(" · ") : "";
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    if (custom.showThankYou) {
      doc.setFont(font, "italic");
      doc.setFontSize(F(7.5));
      doc.setTextColor(r, g, b);
      doc.text(lang === "es" ? "Gracias por su preferencia" : "Thank you for your business", w / 2, 748, { align: "center" });
    }
    doc.setDrawColor(224, 227, 226);
    doc.setLineWidth(0.5);
    doc.line(margin, 758, w - margin, 758);
    doc.setFont(font, "normal");
    doc.setFontSize(F(7));
    doc.setTextColor(...faintInk);
    if (footerLeft) doc.text(footerLeft, margin, 770);
    doc.text(`${lang === "es" ? "Página" : "Page"} ${page} ${lang === "es" ? "de" : "of"} ${pageCount}`, w - margin, 770, { align: "right" });
  }
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
