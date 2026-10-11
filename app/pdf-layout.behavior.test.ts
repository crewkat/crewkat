// PDF layout behavior tests (invoice/estimate redesign, 2026-09-29).
//
// Covers: buildInvoicePdf / buildQuotePdf from app/client/src/financialPdf.ts
// build without errors, return non-empty PDFs, and carry the redesigned
// structure — dark header band with company block, big document title,
// Bill-to / number+date block, dark table header row, right-aligned
// subtotal, TOTAL in a full dark band, footer with license/contact +
// italic thank-you. Bilingual EN/ES. Customize toggles (theme, thank-you)
// keep working.
//
// Run from app/:  bun test pdf-layout.behavior.test.ts
import { describe, expect, test } from "bun:test";
import {
  buildInvoicePdf,
  buildQuotePdf,
  type FinancialDocument,
  type PdfStrings,
} from "./client/src/financialPdf.ts";

const enStrings: PdfStrings = {
  discount: "Discount",
  tax: "Tax",
  paymentInstructions: "Payment instructions",
};
const esStrings: PdfStrings = {
  discount: "Descuento",
  tax: "Impuesto",
  paymentInstructions: "Instrucciones de pago",
};

// Minimal settings object — only the fields the PDF builder reads.
const settings = {
  companyName: "Stallions Construction Company LLC",
  phone: "(813) 516-5720",
  email: "stallionsconstructioncompany@gmail.com",
  website: "stallionsconstruction.com",
  address: "Trinity, FL",
  licenseNumber: "CRC1335847",
  paymentInstructions: "Zelle to (813) 516-5720",
  accentColor: "#1f5a4a",
  logoUrl: null,
  defaultDocumentFont: "helvetica",
} as any;

function sampleInvoice(overrides: Partial<FinancialDocument> = {}): FinancialDocument {
  return {
    id: 2,
    invoiceNumber: "INV-0002",
    clientName: "Denny",
    jobAddress: "456 bgyu",
    shippingAddress: "",
    jobType: "Bathroom remodel",
    lineItems: [
      { name: "Fony", description: "All", amount: "50", quantity: 1, discount: "0", unit: "none" },
      { name: "Tile labor", description: "Shower walls", amount: "120", quantity: 2, discount: "0", unit: "hours" },
    ],
    subtotal: "$290.00",
    discountType: "fixed",
    discountValue: "0",
    taxType: "fixed",
    taxValue: "0",
    total: "$290.00",
    footnote: "Workmanship guaranteed for one year.",
    theme: "classic",
    font: "helvetica",
    accentColor: "#1f5a4a",
    showTaxLine: true,
    showDiscountLine: true,
    showPaidLine: true,
    showPaymentTerms: true,
    showFooterNotes: true,
    showLogo: false,
    showCompanyInfo: true,
    customizeJson: "{}",
    issueDate: "2026-09-29",
    dueDate: "2026-10-13",
    ...overrides,
  };
}

/** Raw PDF bytes as latin1 so WinAnsi text runs stay searchable. */
async function pdfText(blob: Blob): Promise<string> {
  const buf = Buffer.from(await blob.arrayBuffer());
  return buf.toString("latin1");
}

describe("invoice PDF redesign", () => {
  test("builds without errors and returns a non-empty PDF", async () => {
    const blob = await buildInvoicePdf(sampleInvoice(), settings, "en", enStrings);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(4000);
  });

  test("has the reference structure: header band, big title, bill-to, dark table header, total band, footer", async () => {
    const raw = await pdfText(await buildInvoicePdf(sampleInvoice(), settings, "en", enStrings));
    // Big document title + number block
    expect(raw).toContain("INVOICE");
    expect(raw).toContain("INV-0002");
    // Title rendered at the new larger 24pt size
    expect(raw).toContain("24 Tf");
    // Bill-to / For client block
    expect(raw).toContain("Bill to");
    expect(raw).toContain("Denny");
    // Dark header band with company block (full-width band, 56pt tall)
    expect(raw).toContain("Stallions Construction Company LLC");
    expect(raw).toContain("CRC1335847");
    // Line-item table with dark header row
    expect(raw).toContain("Description");
    expect(raw).toContain("Amount");
    // Hairline row dividers between line items (thin 0.5pt lines)
    expect(raw).toContain("0.5 w");
    // Subtotal right-aligned, then TOTAL in the full dark band (250pt wide)
    expect(raw).toContain("Subtotal");
    expect(raw).toContain("250. -22. re");
    expect(raw).toContain("Total:");
    // Footer: license/phone/website + italic thank-you
    expect(raw).toContain("Thank you for your business");
    expect(raw).toContain("stallionsconstruction.com");
    // Kept data fields: line items, footnote, payment terms, due date
    expect(raw).toContain("Fony");
    expect(raw).toContain("Tile labor");
    expect(raw).toContain("Workmanship guaranteed");
    expect(raw).toContain("Zelle to");
  });

  test("spanish invoice keeps the same structure with ES labels", async () => {
    const raw = await pdfText(
      await buildInvoicePdf(sampleInvoice(), settings, "es", esStrings),
    );
    expect(raw).toContain("FACTURA");
    expect(raw).toContain("INV-0002");
    expect(raw).toContain("Facturar a");
    expect(raw).toContain("250. -22. re");
    expect(raw).toContain("Gracias por su preferencia");
  });

  test("quote PDF uses the ESTIMATE headline and the same bands", async () => {
    const raw = await pdfText(
      await buildQuotePdf({ ...sampleInvoice(), id: 7 }, settings, "en", enStrings),
    );
    expect(raw).toContain("ESTIMATE");
    expect(raw).toContain("EST0007");
    expect(raw).toContain("250. -22. re");
    expect(raw).toContain("Thank you for your business");
  });

  test("spanish estimate headline is ESTIMADO", async () => {
    const raw = await pdfText(
      await buildQuotePdf(sampleInvoice(), settings, "es", esStrings),
    );
    expect(raw).toContain("ESTIMADO");
    expect(raw).toContain("Gracias por su preferencia");
  });

  test("customize toggles still work: thank-you off, minimal theme has no dark total band", async () => {
    const noThanks = sampleInvoice({
      customizeJson: JSON.stringify({ showThankYou: false, theme: "minimal" } as any),
      theme: "minimal",
    });
    const raw = await pdfText(await buildInvoicePdf(noThanks, settings, "en", enStrings));
    expect(raw).not.toContain("Thank you for your business");
    expect(raw).not.toContain("250. -22. re");
    expect(raw).toContain("INVOICE");
    expect(raw).toContain("Total:");
  });

  test("discount and tax lines appear when present", async () => {
    const raw = await pdfText(
      await buildInvoicePdf(
        sampleInvoice({ discountType: "percent", discountValue: "10", taxType: "percent", taxValue: "7" }),
        settings,
        "en",
        enStrings,
      ),
    );
    expect(raw).toContain("Discount");
    expect(raw).toContain("Tax");
  });
});

describe("build 3.0 item 16b: text stays dark across page breaks", () => {
  // Regression: a long line item forced a page break inside the items loop.
  // drawTableHeaderRow() leaves white text active on classic/bold themes, so
  // every row after the break (and the totals) printed white-on-white — the
  // PDF looked empty (header only) even though the text was in the file.
  /** Fill color (gray `g` or rgb `rg`) active where `marker` text is drawn, per page. */
  function fillColorAtMarker(raw: string, marker: string): Array<string | null> {
    const colors: Array<string | null> = [];
    const streams = raw.match(/stream\n([\s\S]*?)endstream/g) ?? [];
    for (const block of streams) {
      const body = block.replace(/^stream\n/, "").replace(/endstream$/, "");
      const ops = body.matchAll(
        /(?<rgb>[\d.]+ [\d.]+ [\d.]+ rg)|(?<gray>[\d.]+ g)|(?<text>\((?:\\.|[^\\()])*\))/g,
      );
      let current: string | null = null;
      let found: string | null = null;
      for (const op of ops) {
        if (op.groups?.rgb ?? op.groups?.gray) current = (op.groups.rgb ?? op.groups.gray)!;
        else if (op.groups?.text?.includes(marker)) { found = current; break; }
      }
      colors.push(found);
    }
    return colors;
  }
  const isWhite = (c: string | null) => c === "1. g" || c === "1. 1. 1. rg";

  test("long line item: item text and totals print dark after the page break", async () => {
    const longDesc =
      "LONGITEMMARKER SCOPE OF WORK — " +
      "Install recessed lights and ceiling fans in the lanai, wiring concealed inside the insulated panels. ".repeat(45);
    const invoice = sampleInvoice({
      lineItems: [
        { name: "", description: longDesc, amount: "6500.00", quantity: 1, discount: "0", unit: "none" },
      ],
    });
    const raw = await pdfText(await buildInvoicePdf(invoice, settings, "en", enStrings));
    // Sanity: the item really did spill onto later pages.
    const pageBreaks = fillColorAtMarker(raw, "LONGITEMMARKER");
    const itemPage = pageBreaks.findIndex((c) => c !== null);
    expect(itemPage).toBeGreaterThan(0);
    expect(isWhite(pageBreaks[itemPage])).toBe(false);
    // Totals must be dark too, wherever they landed.
    const totalColors = fillColorAtMarker(raw, "Subtotal");
    const totalPage = totalColors.findIndex((c) => c !== null);
    expect(totalPage).toBeGreaterThan(-1);
    expect(isWhite(totalColors[totalPage])).toBe(false);
  });

  test("quote PDFs get the same page-break color reset", async () => {
    const longDesc =
      "LONGITEMMARKER " +
      "Framing, drywall, tape and texture, prime and two finish coats of paint. ".repeat(60);
    const quote = sampleInvoice({
      lineItems: [
        { name: "", description: longDesc, amount: "3200.00", quantity: 1, discount: "0", unit: "none" },
      ],
    });
    const raw = await pdfText(await buildQuotePdf(quote, settings, "en", enStrings));
    const colors = fillColorAtMarker(raw, "LONGITEMMARKER");
    const itemPage = colors.findIndex((c) => c !== null);
    expect(itemPage).toBeGreaterThan(0);
    expect(isWhite(colors[itemPage])).toBe(false);
  });
});
