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

export function lineItemsTotal(items: Array<{ amount: string; quantity?: number; discount?: string }>) {
  return items.reduce((sum, item) => sum + Math.max(0, money(item.amount) * (item.quantity ?? 1) - money(item.discount ?? "0")), 0);
}

export function financialTotals(
  items: Array<{ amount: string; quantity?: number; discount?: string; optional?: boolean }> ,
  discountType: PdfAdjustmentType,
  discountValue: string,
  taxType: PdfAdjustmentType,
  taxValue: string,
) {
  // Estimate options (0076): optional line items are priced add-ons the
  // client may select on the client page. They are NEVER part of the base
  // subtotal/total — they are summed separately (lineItemsTotal) and shown
  // in their own Options section on the document.
  const subtotal = lineItemsTotal(items.filter((item) => !item.optional));
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

// Signatures fix (2026-10-14): blob URLs are minted against the public
// origin (CREWKAT_PUBLIC_URL — the apex, crewkat.com), but the app is only
// ever served from www.crewkat.com (the apex 301-redirects everything to
// www). A fetch() of the absolute apex URL from the www origin starts
// cross-origin, the redirect carries no Access-Control-Allow-Origin, and
// the browser rejects it — so every fetch-based PDF embed of a blob
// (signature images, uploaded originals, logos) silently failed while
// <img> displays of the same URLs worked fine. Blob bytes are served from
// /blobs/<key> on the app's own origin too, so fetch the path-relative
// form: same bytes, same origin, no CORS. Non-blob URLs pass through.
export function sameOriginBlobPath(url: string): string {
  if (!url) return url;
  try {
    const parsed = new URL(url, "https://crewkat.invalid");
    if (parsed.pathname.startsWith("/blobs/")) return parsed.pathname + parsed.search;
  } catch {
    /* keep the original URL */
  }
  return url;
}

export async function loadImageDataUrl(url: string | null) {
  if (!url) return null;
  try {
    return await blobDataUrl(await (await fetch(sameOriginBlobPath(url))).blob());
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
    const merged = { ...base, ...parsed, labels: { ...base.labels, ...(parsed.labels ?? {}) } };
    // Converting an estimate to an invoice copies customizeJson verbatim, so
    // a stored headline can be the OTHER kind's stock word ("ESTIMATE" on an
    // invoice). A stock headline of the wrong kind is never a deliberate
    // choice — render this kind's stock headline instead. Custom headlines
    // pass through untouched.
    const otherKindStock = kind === "invoice" ? ["ESTIMATE", "ESTIMADO"] : ["INVOICE", "FACTURA"];
    if (otherKindStock.includes(merged.headline)) merged.headline = base.headline;
    return merged;
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
  lineItems: Array<{ name?: string; description: string; amount: string; quantity?: number; discount?: string; unit?: "none" | "days" | "hours"; id?: string; optional?: boolean }>;
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
  // Estimate options (0076): the client's selection state, when the caller
  // has it (in-app quote objects and the document-link payload both carry
  // it). The accepted snapshot drives the ACCEPTED OPTIONS section of the
  // PDF; absent/null renders the plain OPTIONS section.
  optionSelection?: {
    selectedKeys: string[];
    accepted: {
      items: Array<{ key: string; name: string; description: string; amount: string; quantity: number; discount: string; unit: string }>;
      optionsTotal: string;
      totalWithOptions: string;
      acceptedAt: string;
    } | null;
  } | null;
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
  // Document template rebuild (Danny 2026-10-15 — Invoice Fly reference,
  // "can we beat it?"): ONE skeleton for all four themes. Full-width header
  // zone with the logo left and the FULL company stack right-aligned (name,
  // phone · license · website, address, email); an oversized title block
  // with the date under it; then the meta row. Each theme keeps its
  // identity as skin: bold/classic get a filled header band and a centered
  // title, modern/minimal render the same layout on white with a hairline
  // under the header zone (modern keeps its left accent rail).
  const headerH = theme === "bold" ? 76 : 66;
  const inBand = theme === "bold" || theme === "classic";
  const centeredTitle = inBand;
  if (theme === "bold") {
    fillBand(0, 0, w, headerH, [r, g, b]);
  } else if (theme === "modern") {
    fillBand(0, 0, 12, 792, [r, g, b], true);
  } else if (theme === "classic") {
    fillBand(0, 0, w, headerH, [23, 26, 28]);
  }
  if (logo) {
    try {
      // Aspect-preserved draw (Danny 2026-10-12): the preset box is ~1.6:1,
      // and the old fixed-box draw stretched any other aspect into it —
      // his roughly square Stallions logo rendered squished wide/short in
      // the band. Scale the image to FIT INSIDE the box (contain) using
      // its intrinsic pixel size, left-aligned at the box's x and
      // vertically centered in the box. A logo already at the box's aspect
      // gets byte-identical geometry; if the intrinsic size can't be read,
      // fall back to the old fixed box.
      const boxW = { huge: 72, big: 58, medium: 40, small: 28 }[custom.logoSize];
      const boxH = { huge: 45, big: 36, medium: 25, small: 18 }[custom.logoSize];
      const boxY = (headerH - boxH) / 2;
      let drawW = boxW;
      let drawH = boxH;
      try {
        const props = doc.getImageProperties(logo);
        if (props.width > 0 && props.height > 0) {
          const scale = Math.min(boxW / props.width, boxH / props.height);
          drawW = props.width * scale;
          drawH = props.height * scale;
        }
      } catch {
        /* intrinsic size unavailable — fixed box */
      }
      if (theme === "bold") {
        // Bold identity: the logo sits in a white tile on the accent band.
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(margin - 5, boxY - 5, boxW + 10, boxH + 10, 4, 4, "F");
      }
      doc.addImage(
        logo,
        logo.startsWith("data:image/png") ? "PNG" : "JPEG",
        margin,
        boxY + (boxH - drawH) / 2,
        drawW,
        drawH,
        undefined,
        "FAST",
      );
    } catch {
      /* text branding stays */
    }
  }
  if (document.showCompanyInfo) {
    // Company stack, right-aligned on every theme: name (bold), then
    // phone · license · website, address, and email as small detail lines.
    const stackLines: Array<{ text: string; name?: boolean }> = [];
    if (custom.showBusinessName) {
      const nameText = custom.showShortBusinessName ? (settings?.companyName || "").split(/\s+/).slice(0, 2).join(" ") : settings?.companyName || "";
      if (nameText) stackLines.push({ text: nameText, name: true });
    }
    const infoBits = [settings?.phone, custom.showLicenseNumber ? settings?.licenseNumber : "", settings?.website].filter(Boolean);
    if (infoBits.length) stackLines.push({ text: infoBits.join("  ·  ") });
    if (settings?.address) stackLines.push({ text: settings.address });
    if (settings?.email) stackLines.push({ text: settings.email });
    const stackStep = 11;
    let stackY = headerH / 2 - ((stackLines.length - 1) * stackStep) / 2 + 3;
    for (const line of stackLines) {
      if (line.name) {
        doc.setFont(font, "bold");
        doc.setFontSize(F(theme === "bold" ? 12 : 11));
        if (inBand) doc.setTextColor(255, 255, 255);
        else doc.setTextColor(...ink);
      } else {
        doc.setFont(font, "normal");
        doc.setFontSize(F(7.5));
        if (inBand) doc.setTextColor(...bandDimInk);
        else doc.setTextColor(...dimInk);
      }
      doc.text(line.text, w - margin, stackY, { align: "right" });
      stackY += stackStep;
    }
  }
  if (!inBand) {
    doc.setDrawColor(theme === "modern" ? 205 : 226, theme === "modern" ? 212 : 230, theme === "modern" ? 209 : 228);
    doc.setLineWidth(0.75);
    doc.line(margin, headerH, w - margin, headerH);
  }
  const titleY = headerH + 40;
  doc.setFont(font, "bold");
  doc.setFontSize(F(theme === "bold" ? 30 : theme === "modern" ? 26 : 24));
  doc.setTextColor(...ink);
  if (centeredTitle) doc.text(docTitle, w / 2, titleY, { align: "center" });
  else doc.text(docTitle, margin, titleY);
  const titleDate = document.issueDate ? formatDocumentDate(document.issueDate, custom.dateFormat, lang).toUpperCase() : "";
  const dateY = titleY + 17;
  if (titleDate) {
    doc.setFont(font, "normal");
    doc.setFontSize(F(8.5));
    doc.setTextColor(...dimInk);
    if (centeredTitle) doc.text(titleDate, w / 2, dateY, { align: "center", charSpace: 1 });
    else doc.text(titleDate, margin, dateY, { charSpace: 1 });
  }
  const ruleY = (titleDate ? dateY : titleY) + 11;
  if (custom.colorMode === "gradient") {
    fillBand(centeredTitle ? w / 2 - 24 : margin, ruleY - 1.25, 48, 2.5, [r, g, b]);
  } else {
    doc.setLineWidth(2.5);
    doc.setDrawColor(r, g, b);
    if (centeredTitle) doc.line(w / 2 - 24, ruleY, w / 2 + 24, ruleY);
    else doc.line(margin, ruleY, margin + 48, ruleY);
  }
  const infoY = ruleY + 25;
  const clientPad = theme === "modern" ? 12 : 0;
  const clientX = margin + clientPad;
  const rightX = w - margin - clientPad;
  const clientSub = [document.jobType, document.jobAddress, document.shippingAddress]
    .filter((s) => s && s.trim())
    .join("  ·  ");
  const clientLines = clientSub
    ? ((doc.splitTextToSize(clientSub, (w - margin * 2) * 0.58) as string[]).slice(0, 3))
    : [];
  // Meta rows (right column): Number / Date / Due, label + value.
  // The due date lives in the header meta block (it used to print alone
  // under the totals). Estimates show their expiry date here.
  const metaDueDate = kind === "invoice" ? document.dueDate : document.expiryDate;
  const metaTexts: Array<{ text: string; strong?: boolean }> = [];
  if (docNumber) metaTexts.push({ text: `${labels.number}: ${docNumber}`, strong: true });
  if (document.issueDate) metaTexts.push({ text: `${labels.date}: ${formatDocumentDate(document.issueDate, custom.dateFormat, lang)}` });
  if (custom.showDueDate && metaDueDate) metaTexts.push({ text: `${labels.dueDate}: ${formatDocumentDate(metaDueDate, custom.dateFormat, lang)}` });
  const clientBlockH = 27 + clientLines.length * 10 * FONT_SCALE;
  const rightBlockH = metaTexts.length ? (metaTexts.length - 1) * metaStep + 4 : 0;
  if (theme === "modern") {
    doc.setFillColor(241, 244, 243);
    doc.roundedRect(margin, infoY - 12, w - margin * 2, Math.max(clientBlockH, rightBlockH) + 24, 6, 6, "F");
  }
  // Bill-to / FOR block: small label line, bold client name, detail lines.
  doc.setFont(font, "bold");
  doc.setFontSize(F(7.5));
  doc.setTextColor(...dimInk);
  doc.text(labels.billTo, clientX, infoY);
  doc.setFont(font, "bold");
  doc.setFontSize(F(11));
  doc.setTextColor(...ink);
  doc.text(document.clientName || "—", clientX, infoY + 14);
  if (clientLines.length) {
    doc.setFont(font, "normal");
    doc.setFontSize(F(8));
    doc.setTextColor(...dimInk);
    doc.text(clientLines, clientX, infoY + 27);
  }
  let ry = infoY;
  for (const row of metaTexts) {
    doc.setFont(font, row.strong ? "bold" : "normal");
    doc.setFontSize(F(8.5));
    doc.setTextColor(...ink);
    doc.text(row.text, rightX, ry, { align: "right" });
    ry += metaStep;
  }
  let y = Math.max(infoY + clientBlockH + 10, ry + 6);
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
    if (theme === "minimal") {
      // Minimal has no header band — a firm ink rule under the header row
      // is its band, in the same design language.
      doc.setDrawColor(...ink);
      doc.setLineWidth(1.4);
      doc.line(margin, y + 7, w - margin, y + 7);
      doc.setTextColor(...ink);
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
  // Estimate options render in their own section after the totals (below);
  // the main table carries base items only.
  const baseLineItems = document.lineItems.filter((item) => !item.optional);
  let rowIndex = 0;
  for (const item of baseLineItems) {
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
  // Deposit (0064): computed once. When the totals panel renders, the
  // deposit becomes a "Deposit due at signing" row INSIDE the panel;
  // otherwise it falls back to the standalone lines after the options
  // section (the historical placement). The math is unchanged.
  const depType = document.depositType === "percent" || document.depositType === "fixed" ? document.depositType : "none";
  const depVal = Number(document.depositValue ?? "0");
  const depTotalNum = money(kind === "invoice" ? String(document.totalWithLateFee ?? document.total) : String(totals.total));
  const depAmount = depType === "percent" && depVal > 0 ? (depTotalNum * depVal) / 100 : depType === "fixed" && depVal > 0 ? depVal : 0;
  const depDetail = depType === "percent" && depVal > 0 ? ` (${depVal}%)` : "";
  const depInPanel = custom.showSummaryInfo && depAmount > 0;
  if (custom.showSummaryInfo) {
    // Phase 2: the totals live in a boxed summary panel — label left, amount
    // right, divider, then the emphasized Total — now a solid band on every
    // theme (dark on classic/minimal, accent on bold/modern). The classic
    // theme keeps its dark total band inset 6pt inside the 262pt panel so
    // the band keeps its exact legacy 250pt width; minimal's band spans
    // the full panel width. Invoices also get a Balance due row that
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
    const panelH = 12 + rows.length * rowStep + (rows.length && totalRowH ? 8 : 0) + totalRowH + (showBalance ? 19 : 0) + (depInPanel ? 35 : 0) + 8;
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
    if (custom.showAmount) {
      // Template rebuild: the TOTAL is a solid band on EVERY theme — dark
      // on classic/minimal, the accent on bold/modern. Classic keeps its
      // exact legacy 250pt inset band; minimal's band spans the panel.
      if (theme === "minimal") fillBand(panelX, by - 12, panelW, 22, [24, 32, 30]);
      else if (theme === "classic") fillBand(panelX + 6, by - 12, 250, 22, [23, 26, 28]);
      else fillBand(panelX + 6, by - 12, 250, 22, [r, g, b]);
      doc.setTextColor(255, 255, 255);
      doc.setFont(font, "bold");
      doc.setFontSize(F(13));
      doc.text(`${totalLabel}:`, theme === "minimal" ? panelX + 10 : panelX + 16, by + 3);
      doc.text(totalValue, theme === "minimal" ? panelX + panelW - 10 : panelX + panelW - 14, by + 3, { align: "right" });
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
    if (depInPanel) {
      doc.setDrawColor(224, 227, 226);
      doc.setLineWidth(0.5);
      doc.line(panelX + 12, by + 1, panelX + panelW - 12, by + 1);
      by += 14;
      doc.setFont(font, "bold");
      doc.setFontSize(F(9.5));
      doc.setTextColor(r, g, b);
      doc.text(`${lang === "es" ? "Anticipo al firmar" : "Deposit due at signing"}${depDetail}:`, panelX + 12, by);
      doc.text(usd(depAmount), panelX + panelW - 12, by, { align: "right" });
      by += 14;
      doc.setFont(font, "normal");
      doc.setFontSize(F(9.5));
      doc.setTextColor(...ink);
      doc.text(`${lang === "es" ? "Saldo restante" : "Remaining balance"}:`, panelX + 12, by);
      doc.text(usd(Math.max(0, depTotalNum - depAmount)), panelX + panelW - 12, by, { align: "right" });
      by += 6;
    }
    y += panelH;
  }
  // Estimate options (0076): structured sections under the base totals,
  // each with a banded subhead in the items-table language and its OWN
  // subtotal — never prices buried in parentheses. When the client has
  // accepted options (the snapshot frozen at acceptance), they render
  // first as ACCEPTED OPTIONS with the accepted totals; optionals the
  // client did not pick stay under OPTIONS with the not-included note,
  // which states plainly that options are not part of the estimate total
  // unless the client selects them (on the client page, where tick-boxes
  // drive the live total).
  const optionItems = kind === "quote" ? document.lineItems.filter((item) => item.optional) : [];
  const acceptedSnap = kind === "quote" ? document.optionSelection?.accepted ?? null : null;
  if (optionItems.length || acceptedSnap) {
    const acceptedKeys = new Set((acceptedSnap?.items ?? []).map((item) => item.key));
    const remainingOptions = optionItems.filter((item) => !acceptedKeys.has(item.id ?? ""));
    const drawOptionsBand = (text: string) => {
      ensureSpace(48);
      if (theme === "classic") {
        fillBand(margin, y - 13, w - margin * 2, 20, [23, 26, 28]);
        doc.setTextColor(255, 255, 255);
      } else if (theme === "bold") {
        fillBand(margin, y - 13, w - margin * 2, 20, [r, g, b]);
        doc.setTextColor(255, 255, 255);
      } else if (theme === "modern") {
        doc.setFillColor(238, 241, 240);
        doc.rect(margin, y - 13, w - margin * 2, 20, "F");
        doc.setTextColor(...ink);
      } else {
        doc.setDrawColor(...ink);
        doc.setLineWidth(1.4);
        doc.line(margin, y + 7, w - margin, y + 7);
        doc.setTextColor(...ink);
      }
      doc.setFont(font, "bold");
      doc.setFontSize(F(10.5));
      doc.text(text, margin + 8, y);
      doc.setTextColor(...ink);
      y += 24;
    };
    const drawOptionRows = (items: Array<{ name?: string; description: string; amount: string; quantity?: number; discount?: string }>) => {
      for (const item of items) {
        const itemLabel = [item.name, item.description].filter(Boolean).join(" — ");
        const itemTotal = Math.max(0, money(item.amount) * (item.quantity ?? 1) - money(item.discount ?? "0"));
        doc.setFontSize(F(9));
        const richLines = wrapRichLines(doc, parseRichRuns(itemLabel), w - margin * 2 - 130, font);
        const rowH = Math.max(20, richLines.length * descStep + 6);
        ensureSpace(rowH);
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
    };
    const drawOptionsSubtotal = (label: string, value: number) => {
      ensureSpace(30);
      doc.setFont(font, "bold");
      doc.setFontSize(F(9.5));
      doc.setTextColor(...ink);
      doc.text(`${label}:`, margin + 8, y + 4);
      doc.text(usd(value), w - margin - 8, y + 4, { align: "right" });
      y += 15 * FONT_SCALE;
    };
    y += 16;
    if (acceptedSnap) {
      drawOptionsBand(lang === "es" ? "OPCIONES ACEPTADAS" : "ACCEPTED OPTIONS");
      drawOptionRows(acceptedSnap.items);
      drawOptionsSubtotal(lang === "es" ? "Total de opciones" : "Options total", money(acceptedSnap.optionsTotal));
      doc.setFont(font, "bold");
      doc.setFontSize(F(10));
      doc.setTextColor(r, g, b);
      doc.text(`${lang === "es" ? "Total con opciones aceptadas" : "Total with accepted options"}: ${usd(money(acceptedSnap.totalWithOptions))}`, margin + 8, y + 4);
      doc.setTextColor(...ink);
      y += 16;
    }
    if (remainingOptions.length) {
      if (acceptedSnap) y += 8;
      drawOptionsBand(lang === "es" ? "OPCIONES" : "OPTIONS");
      doc.setFont(font, "normal");
      doc.setFontSize(F(8));
      doc.setTextColor(...dimInk);
      const optionsNote = lang === "es"
        ? "Complementos opcionales — no están incluidos en el total del estimado a menos que se seleccionen."
        : "Optional add-ons — not included in the estimate total unless selected.";
      const optionsNoteLines = doc.splitTextToSize(optionsNote, w - margin * 2) as string[];
      doc.text(optionsNoteLines, margin + 8, y);
      y += optionsNoteLines.length * noteStep + 6;
      doc.setTextColor(...ink);
      drawOptionRows(remainingOptions);
      const optionsSum = lineItemsTotal(remainingOptions);
      drawOptionsSubtotal(
        acceptedSnap ? (lang === "es" ? "Total de opciones disponibles" : "Available options total") : (lang === "es" ? "Total de opciones" : "Options total"),
        optionsSum,
      );
      if (!acceptedSnap) {
        doc.setFont(font, "normal");
        doc.setFontSize(F(8.5));
        doc.setTextColor(...dimInk);
        doc.text(`${lang === "es" ? "Total con todas las opciones" : "Total with all options selected"}: ${usd(totals.total + optionsSum)}`, margin + 8, y + 4);
        y += 8;
      }
    }
  }
  // Deposit request line when the totals panel is hidden: the same
  // "Deposit due at signing" wording as the in-panel row + balance.
  if (depAmount > 0 && !depInPanel) {
    y += 16 * FONT_SCALE;
    doc.setFont(font, "normal");
    doc.setFontSize(F(10));
    doc.setTextColor(...dimInk);
    doc.text(`${lang === "es" ? "Anticipo al firmar" : "Deposit due at signing"}${depDetail}: ${usd(depAmount)}`, w - margin, y, { align: "right" });
    const balance = Math.max(0, depTotalNum - depAmount);
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

// ---------------------------------------------------------------------------
// Formal change-order document (Danny 2026-10-21): a change order renders
// as a real legal document — the same file the client views, downloads,
// signs, and is emailed. All amounts are computed SERVER-side (see
// server/src/changeOrders.ts) and passed in ready to print; this builder
// only lays them out. Used by the server (docPdf.ts) for the canonical
// PDF and by the client page when the client signs through a document
// link, so both produce the identical document.
// ---------------------------------------------------------------------------
export type ChangeOrderPdfData = {
  coNumber: number;
  // Document created date, yyyy-mm-dd ("" when unknown).
  dateIso: string;
  clientName: string;
  jobType: string;
  jobAddress: string;
  // Title of the job's original contract document ("" when none).
  referenceContract: string;
  scope: string;
  bodyText: string;
  contractSumBefore: string;
  amount: string;
  newContractSum: string;
  contractorSignerName: string;
  contractorSignatureDataUrl: string | null;
  contractorSignedAtIso: string | null;
  clientSignerName: string;
  clientSignatureDataUrl: string | null;
  clientSignedAtIso: string | null;
  logoDataUrl?: string | null;
};

export function changeOrderStrings(lang: PdfLang) {
  return lang === "es"
    ? {
        title: (n: number) => `Orden de cambio #${n}`,
        date: "Fecha",
        client: "Cliente",
        job: "Trabajo",
        address: "Dirección",
        reference: "Referencia",
        referenceText: (ref: string) =>
          `Esta orden de cambio modifica el contrato original de este trabajo${ref ? `: "${ref}"` : ""}. Forma parte de ese contrato y se rige por sus términos.`,
        scope: "ALCANCE DEL CAMBIO",
        price: "PRECIO",
        sumBefore: "Suma del contrato antes de esta orden de cambio",
        thisChange: "Monto de esta orden de cambio",
        newSum: "Nueva suma del contrato",
        schedule: "PLAZO",
        scheduleText:
          "Sin cambio al plazo del contrato. Esta orden de cambio no modifica la fecha de terminación del contrato original.",
        payment: "PAGO",
        paymentText:
          "El monto de esta orden de cambio vence según los términos de pago del contrato original.",
        terms: "TÉRMINOS",
        termsText:
          "Todos los demás términos y condiciones del contrato original permanecen sin cambios y en pleno vigor.",
        contractor: "Contratista",
        clientSignature: "Firma del cliente",
        contractorSignature: "Firma del contratista",
        signature: "Firma",
        printedName: "Nombre",
        signedDate: "Fecha",
        onBehalfOf: (company: string) => `en nombre de ${company}`,
        page: "Página",
        of: "de",
      }
    : {
        title: (n: number) => `Change Order #${n}`,
        date: "Date",
        client: "Client",
        job: "Job",
        address: "Address",
        reference: "Reference",
        referenceText: (ref: string) =>
          `This change order modifies the original contract for this job${ref ? `: "${ref}"` : ""}. It is part of that contract and is governed by its terms.`,
        scope: "SCOPE OF CHANGE",
        price: "PRICE",
        sumBefore: "Contract sum before this change order",
        thisChange: "Amount of this change order",
        newSum: "New contract sum",
        schedule: "SCHEDULE",
        scheduleText:
          "No change to the contract time. This change order does not change the completion date under the original contract.",
        payment: "PAYMENT",
        paymentText:
          "The amount of this change order is due in accordance with the payment terms of the original contract.",
        terms: "TERMS",
        termsText:
          "All other terms and conditions of the original contract remain unchanged and in full effect.",
        contractor: "Contractor",
        clientSignature: "Client signature",
        contractorSignature: "Contractor signature",
        signature: "Signature",
        printedName: "Printed name",
        signedDate: "Date",
        onBehalfOf: (company: string) => `on behalf of ${company}`,
        page: "Page",
        of: "of",
      };
}

function coDateLabel(iso: string | null, lang: PdfLang): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso).slice(0, 10);
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export async function buildChangeOrderPdf(
  data: ChangeOrderPdfData,
  settings: Settings | null,
  lang: PdfLang,
): Promise<Blob> {
  const s = changeOrderStrings(lang);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const w = 612;
  const h = 792;
  const margin = 54;
  const contentW = w - margin * 2;
  const ink: [number, number, number] = [24, 32, 30];
  const dim: [number, number, number] = [96, 106, 103];
  const faint: [number, number, number] = [120, 128, 125];
  const accent = hexRgb(settings?.accentColor || "#1f5a4a");
  const companyName = settings?.companyName || "";
  let y = 0;
  const ensure = (need: number) => {
    if (y + need <= h - 64) return;
    doc.addPage();
    y = 54;
  };
  const wrapped = (text: string, size: number, fontStyle = "normal") => {
    doc.setFont("helvetica", fontStyle);
    doc.setFontSize(size);
    return doc.splitTextToSize(text, contentW) as string[];
  };
  const paragraph = (text: string, size = 10.5, gap = 14, color = ink) => {
    if (!text.trim()) return;
    const lines = wrapped(text, size);
    ensure(lines.length * (size + 3.5) + gap);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(lines, margin, y);
    y += lines.length * (size + 3.5) + gap;
  };
  const sectionHead = (label: string) => {
    ensure(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...accent);
    doc.text(label, margin, y);
    y += 5;
    doc.setDrawColor(...accent);
    doc.setLineWidth(1);
    doc.line(margin, y, margin + 34, y);
    y += 15;
  };

  // Header band (classic contract treatment): dark band, logo left,
  // company stack right.
  const headerH = 66;
  doc.setFillColor(23, 26, 28);
  doc.rect(0, 0, w, headerH, "F");
  if (data.logoDataUrl) {
    try {
      const props = doc.getImageProperties(data.logoDataUrl);
      const boxW = 58;
      const boxH = 40;
      let drawW = boxW;
      let drawH = boxH;
      if (props.width > 0 && props.height > 0) {
        const scale = Math.min(boxW / props.width, boxH / props.height);
        drawW = props.width * scale;
        drawH = props.height * scale;
      }
      doc.addImage(
        data.logoDataUrl,
        data.logoDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG",
        margin,
        (headerH - drawH) / 2,
        drawW,
        drawH,
        undefined,
        "FAST",
      );
    } catch {
      /* text branding stays */
    }
  }
  const stack: Array<{ text: string; name?: boolean }> = [];
  if (companyName) stack.push({ text: companyName, name: true });
  const bits = [settings?.phone, settings?.licenseNumber, settings?.website].filter(Boolean);
  if (bits.length) stack.push({ text: bits.join("  ·  ") });
  if (settings?.address) stack.push({ text: settings.address });
  if (settings?.email) stack.push({ text: settings.email });
  let stackY = headerH / 2 - ((stack.length - 1) * 11) / 2 + 3;
  for (const line of stack) {
    doc.setFont("helvetica", line.name ? "bold" : "normal");
    doc.setFontSize(line.name ? 11.5 : 7.5);
    doc.setTextColor(255, 255, 255);
    doc.text(line.text, w - margin, stackY, { align: "right" });
    stackY += 11;
  }
  y = headerH + 40;

  // Title + date.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.setTextColor(...ink);
  doc.text(s.title(data.coNumber), w / 2, y, { align: "center" });
  y += 19;
  const dateText = coDateLabel(data.dateIso ? `${data.dateIso}T12:00:00` : null, lang);
  if (dateText) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...dim);
    doc.text(`${s.date}: ${dateText}`, w / 2, y, { align: "center" });
    y += 10;
  }
  y += 16;

  // Parties / job meta.
  const meta: Array<[string, string]> = [];
  if (companyName.trim()) meta.push([s.contractor, companyName]);
  if (data.clientName.trim()) meta.push([s.client, data.clientName]);
  if (data.jobType.trim()) meta.push([s.job, data.jobType]);
  if (data.jobAddress.trim()) meta.push([s.address, data.jobAddress]);
  for (const [label, value] of meta) {
    ensure(16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...dim);
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...ink);
    const lines = doc.splitTextToSize(value, contentW - 92) as string[];
    doc.text(lines, margin + 92, y);
    y += Math.max(1, lines.length) * 13 + 3;
  }
  y += 4;
  paragraph(`${s.reference}: ${s.referenceText(data.referenceContract)}`, 10, 16, dim);

  // Scope.
  sectionHead(s.scope);
  paragraph(data.scope, 10.5, 8);
  if (data.bodyText.trim() && data.bodyText.trim() !== data.scope.trim()) {
    paragraph(data.bodyText, 10.5, 14);
  } else {
    y += 6;
  }

  // Price: before / this change / new sum.
  sectionHead(s.price);
  const priceRow = (label: string, value: string, bold = false, band = false) => {
    ensure(24);
    if (band) {
      // Dark total band (Danny 2026-10-21): the NEW CONTRACT SUM row
      // carries the header band's treatment so the PDF and the
      // on-screen paper present the identical document.
      doc.setFillColor(23, 26, 28);
      doc.rect(margin, y - 13, contentW, 24, "F");
    }
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 11.5 : 10.5);
    if (band) doc.setTextColor(255, 255, 255);
    else doc.setTextColor(...ink);
    doc.text(label, margin + (band ? 8 : 0), y);
    doc.text(value, w - margin - (band ? 8 : 0), y, { align: "right" });
    y += 24;
  };
  priceRow(s.sumBefore, usd(money(data.contractSumBefore)));
  priceRow(s.thisChange, usd(money(data.amount)));
  priceRow(s.newSum, usd(money(data.newContractSum)), true, true);
  y += 4;

  sectionHead(s.schedule);
  paragraph(s.scheduleText, 10.5, 14);
  sectionHead(s.payment);
  paragraph(s.paymentText, 10.5, 14);
  sectionHead(s.terms);
  paragraph(s.termsText, 10.5, 18);

  // Signature blocks: contractor (signed at creation) + client. The
  // contractor signs "on behalf of" the company — the company is the
  // contracting party, never the individual.
  ensure(120);
  y += 6;
  const colW = (contentW - 28) / 2;
  const block = (
    x: number,
    heading: string,
    signatureDataUrl: string | null,
    printedName: string,
    behalfLine: string,
    signedAtIso: string | null,
  ) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...dim);
    doc.text(heading.toUpperCase(), x, y);
    const sigTop = y + 8;
    if (signatureDataUrl) {
      try {
        doc.addImage(signatureDataUrl, "PNG", x, sigTop, 150, 38, undefined, "FAST");
      } catch {
        /* the printed name + date below still carry the block */
      }
    }
    const ruleY = sigTop + 46;
    doc.setDrawColor(150, 158, 155);
    doc.setLineWidth(0.75);
    doc.line(x, ruleY, x + colW, ruleY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...faint);
    doc.text(s.signature, x, ruleY + 11);
    doc.setFontSize(10);
    doc.setTextColor(...ink);
    let lineY = ruleY + 27;
    if (printedName) {
      doc.text(`${s.printedName}: ${printedName}`, x, lineY);
      lineY += 13;
    }
    if (behalfLine) {
      doc.setFontSize(9);
      doc.setTextColor(...dim);
      const behalfLines = doc.splitTextToSize(behalfLine, colW) as string[];
      doc.text(behalfLines, x, lineY);
      lineY += behalfLines.length * 11;
      doc.setFontSize(10);
      doc.setTextColor(...ink);
    }
    const dateLabel = coDateLabel(signedAtIso, lang);
    if (dateLabel) doc.text(`${s.signedDate}: ${dateLabel}`, x, lineY);
  };
  block(
    margin,
    s.contractorSignature,
    data.contractorSignatureDataUrl,
    data.contractorSignerName,
    companyName ? s.onBehalfOf(companyName) : "",
    data.contractorSignedAtIso,
  );
  block(
    margin + colW + 28,
    s.clientSignature,
    data.clientSignatureDataUrl,
    data.clientSignerName,
    "",
    data.clientSignedAtIso,
  );
  y += 140;

  // Footer on every page: license/contact left, page numbers right.
  const pageCount = doc.getNumberOfPages();
  const footerParts = [settings?.licenseNumber, settings?.phone, settings?.email, settings?.website].filter(Boolean) as string[];
  while (footerParts.length > 1 && doc.getTextWidth(footerParts.join(" · ")) > 425) footerParts.pop();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setDrawColor(224, 227, 226);
    doc.setLineWidth(0.5);
    doc.line(margin, 758, w - margin, 758);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...faint);
    if (footerParts.length) doc.text(footerParts.join(" · "), margin, 770);
    doc.text(`${s.page} ${page} ${s.of} ${pageCount}`, w - margin, 770, { align: "right" });
  }
  return doc.output("blob");
}
