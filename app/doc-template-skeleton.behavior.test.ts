import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { buildInvoicePdf, buildQuotePdf, type FinancialDocument } from "./client/src/financialPdf";
import { appendAttachmentsToPdf } from "./client/src/pdfAttachments";

// Document template rebuild (Danny 2026-10-15 — Invoice Fly reference):
// pins for the shared skeleton across all four Customize themes — header
// band + full company stack, oversized title block with date, meta row,
// solid TOTAL band, in-panel "Deposit due at signing" line, structured
// OPTIONS sections with their own subtotals (incl. the ACCEPTED split),
// banded "Project photos" attachment pages, and long-document pagination.

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

const enStrings = { discount: "Discount", tax: "Tax", paymentInstructions: "Payment instructions" };
const esStrings = { discount: "Descuento", tax: "Impuesto", paymentInstructions: "Instrucciones de pago" };

function sampleDoc(overrides: Partial<FinancialDocument> = {}): FinancialDocument {
  return {
    id: 2,
    invoiceNumber: "INV-0002",
    clientName: "Denny",
    jobAddress: "456 bgyu",
    shippingAddress: "",
    jobType: "Bathroom remodel",
    lineItems: [
      { name: "Tile labor", description: "Shower walls", amount: "120", quantity: 2, discount: "0", unit: "none" },
      { name: "Fony", description: "All", amount: "50", quantity: 1, discount: "0", unit: "none" },
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
  } as FinancialDocument;
}

async function pdfText(blob: Blob): Promise<string> {
  return Buffer.from(await blob.arrayBuffer()).toString("latin1");
}

describe("template rebuild: header band + company stack", () => {
  test("classic: full-width dark band carries name, phone, license, website, address AND email", async () => {
    const raw = await pdfText(await buildInvoicePdf(sampleDoc(), settings, "en", enStrings));
    // Full-width 66pt header band (612 wide, -66 tall in PDF coords).
    expect(raw).toContain("612. -66. re");
    expect(raw).toContain("Stallions Construction Company LLC");
    expect(raw).toContain("516-5720"); // jsPDF escapes the parens in raw text runs
    expect(raw).toContain("CRC1335847");
    expect(raw).toContain("stallionsconstruction.com");
    expect(raw).toContain("Trinity, FL");
    // Email is part of the header stack now (it used to be footer-only).
    expect(raw).toContain("stallionsconstructioncompany@gmail.com");
  });

  test("bold: 76pt accent band + oversized 30pt centered title", async () => {
    const raw = await pdfText(await buildInvoicePdf(sampleDoc({ theme: "bold" }), settings, "en", enStrings));
    expect(raw).toContain("612. -76. re");
    expect(raw).toContain("30 Tf");
    expect(raw).toContain("INVOICE");
  });

  test("modern + minimal: same stack on white (no full-width band)", async () => {
    for (const theme of ["modern", "minimal"] as const) {
      const raw = await pdfText(await buildInvoicePdf(sampleDoc({ theme }), settings, "en", enStrings));
      expect(raw).not.toContain("612. -66. re");
      expect(raw).toContain("Stallions Construction Company LLC");
      expect(raw).toContain("stallionsconstructioncompany@gmail.com");
      expect(raw).toContain("INVOICE");
    }
  });
});

describe("template rebuild: title block + meta row", () => {
  test("date sits under the title (uppercased); meta row carries Number/Date/Due + Bill-to", async () => {
    const raw = await pdfText(await buildInvoicePdf(sampleDoc(), settings, "en", enStrings));
    expect(raw).toContain("SEP 29, 2026");
    expect(raw).toContain("Number: INV-0002");
    expect(raw).toContain("Date: Sep 29, 2026");
    expect(raw).toContain("Due date: Oct 13, 2026");
    expect(raw).toContain("Bill to");
    expect(raw).toContain("Denny");
    expect(raw).toContain("Bathroom remodel");
  });

  test("spanish: ESTIMADO headline, Facturar a, Número/Fecha/Vencimiento", async () => {
    const raw = await pdfText(await buildQuotePdf(sampleDoc({ expiryDate: "2026-10-20" }), settings, "es", esStrings));
    expect(raw).toContain("ESTIMADO");
    expect(raw).toContain("Facturar a");
    expect(raw).toContain("Número: EST0002");
    expect(raw).toContain("Vencimiento: 20 oct 2026");
  });
});

describe("template rebuild: TOTAL is a solid band on every theme", () => {
  test("classic + bold + modern share the 250pt inset band; minimal spans the panel (262pt)", async () => {
    for (const theme of ["classic", "bold", "modern"] as const) {
      const raw = await pdfText(await buildInvoicePdf(sampleDoc({ theme }), settings, "en", enStrings));
      expect(raw).toContain("250. -22. re");
      expect(raw).toContain("Total:");
    }
    const minimal = await pdfText(await buildInvoicePdf(sampleDoc({ theme: "minimal" }), settings, "en", enStrings));
    expect(minimal).toContain("262. -22. re");
    expect(minimal).not.toContain("250. -22. re");
  });
});

describe("template rebuild: deposit due at signing", () => {
  test("deposit renders inside the totals block (EN + ES)", async () => {
    const doc = sampleDoc({ depositType: "percent", depositValue: "50", total: "$290.00" });
    const raw = await pdfText(await buildQuotePdf(doc, settings, "en", enStrings));
    expect(raw).toContain("Deposit due at signing");
    expect(raw).toContain("$145.00");
    expect(raw).toContain("Remaining balance");
    const rawEs = await pdfText(await buildQuotePdf(doc, settings, "es", esStrings));
    expect(rawEs).toContain("Anticipo al firmar");
    expect(rawEs).toContain("Saldo restante");
  });

  test("no deposit configured -> no deposit line", async () => {
    const raw = await pdfText(await buildQuotePdf(sampleDoc(), settings, "en", enStrings));
    expect(raw).not.toContain("Deposit due at signing");
  });

  test("summary panel hidden -> standalone deposit line still renders", async () => {
    const doc = sampleDoc({
      depositType: "fixed",
      depositValue: "500",
      customizeJson: JSON.stringify({ showSummaryInfo: false }),
    });
    const raw = await pdfText(await buildQuotePdf(doc, settings, "en", enStrings));
    expect(raw).toContain("Deposit due at signing");
    expect(raw).toContain("$500.00");
  });
});

describe("template rebuild: options sections are structured with own subtotals", () => {
  const withOptions = () =>
    sampleDoc({
      lineItems: [
        { name: "Tile install", description: "Install floor tile", amount: "1000.00", quantity: 1, discount: "0", unit: "none" },
        { name: "Grout sealer", description: "Premium grout sealer", amount: "250.00", quantity: 1, discount: "0", unit: "none", optional: true, id: "opt-sealer" },
        { name: "Heated floor", description: "Electric heat mat", amount: "400.00", quantity: 1, discount: "0", unit: "none", optional: true, id: "opt-heat" },
      ],
      subtotal: "1000.00",
      total: "1000.00",
    });

  test("OPTIONS gets a banded subhead (second 528pt band) + its own subtotal", async () => {
    const raw = await pdfText(await buildQuotePdf(withOptions(), settings, "en", enStrings));
    const bandCount = (raw.match(/528\. -20\. re/g) ?? []).length;
    expect(bandCount).toBeGreaterThanOrEqual(2); // items header + options band
    expect(raw).toContain("OPTIONS");
    expect(raw).toContain("Options total");
    expect(raw).toContain("$650.00");
    expect(raw).toContain("Total with all options selected");
  });

  test("accepted snapshot splits ACCEPTED OPTIONS from the remaining OPTIONS", async () => {
    const doc = withOptions();
    doc.optionSelection = {
      selectedKeys: ["opt-sealer"],
      accepted: {
        items: [
          { key: "opt-sealer", name: "Grout sealer", description: "Premium grout sealer", amount: "250.00", quantity: 1, discount: "0", unit: "none" },
        ],
        optionsTotal: "250.00",
        totalWithOptions: "1250.00",
        acceptedAt: "2026-10-15T00:00:00.000Z",
      },
    };
    const raw = await pdfText(await buildQuotePdf(doc, settings, "en", enStrings));
    expect(raw).toContain("ACCEPTED OPTIONS");
    expect(raw).toContain("Options total");
    expect(raw).toContain("$250.00");
    expect(raw).toContain("Total with accepted options");
    expect(raw).toContain("$1,250.00");
    expect(raw).toContain("Available options total");
    expect(raw).toContain("Heated floor");
    const rawEs = await pdfText(await buildQuotePdf(doc, settings, "es", esStrings));
    expect(rawEs).toContain("OPCIONES ACEPTADAS");
    expect(rawEs).toContain("Total de opciones disponibles");
  });
});

describe("template rebuild: attachment photo pages carry the banded header", () => {
  const pngBytes = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );

  // pdf-lib compresses the appended pages' content streams on save, so
  // the header text is read back by decoding the last page's streams.
  async function lastPageText(bytes: Uint8Array): Promise<string> {
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPage(pdf.getPageCount() - 1);
    const contents = page.node.Contents();
    const chunks: string[] = [];
    const collect = (obj: unknown) => {
      const stream = pdf.context.lookup(obj as never) as PDFRawStream;
      if (stream instanceof PDFRawStream) chunks.push(Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"));
    };
    if (contents && typeof (contents as { asArray?: unknown }).asArray === "function") {
      for (const ref of (contents as { asArray: () => unknown[] }).asArray()) collect(ref);
    } else if (contents) {
      collect(contents);
    }
    const streamText = chunks.join("\n");
    // pdf-lib writes drawn text as hex strings (<50726F...> Tj) — decode
    // them back to plain text so assertions read naturally.
    const decoded = [...streamText.matchAll(/<([0-9A-Fa-f]{2,})>\s*Tj/g)]
      .map((m) => Buffer.from(m[1]!, "hex").toString("latin1"))
      .join(" ");
    return `${streamText}\n${decoded}`;
  }

  test("EN + ES headers; page count grows by one photo page", async () => {
    const base = await buildQuotePdf(sampleDoc(), settings, "en", enStrings);
    const baseBytes = new Uint8Array(await base.arrayBuffer());
    const basePages = (await PDFDocument.load(baseBytes)).getPageCount();
    const merged = await appendAttachmentsToPdf(baseBytes, [{ kind: "image", contentType: "image/png", bytes: pngBytes }], 1, { lang: "en" });
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(basePages + 1);
    const enText = await lastPageText(merged);
    expect(enText).toContain("Project photos");
    // The dark band precedes the text: a full-width 46pt path fill.
    expect(enText).toContain("612 46 l");
    const mergedEs = await appendAttachmentsToPdf(baseBytes, [{ kind: "image", contentType: "image/png", bytes: pngBytes }], 1, { lang: "es" });
    expect(await lastPageText(mergedEs)).toContain("Fotos del proyecto");
  });
});

describe("template rebuild: long documents (Anthony-length scope) paginate cleanly", () => {
  const bodies = [
    "Install two (2) new switches to the right of the lanai door: one for three (3) new exterior ceiling fans, one for two (2) new exterior recessed lights.",
    "Remove four (4) existing lights from the exterior block wall; patch and refinish stucco to match.",
    "Repurpose the existing block-wall lighting circuit to feed six (6) new recessed lights in the exterior lanai.",
    "Install eight (8) recessed lights and three (3) ceiling fans in the lanai, wiring concealed inside the insulated panels.",
  ];
  const sections: string[] = [
    "**SCOPE OF WORK — Garage Conversion** All work per the signed scope at the property in Clearwater, FL.",
  ];
  for (let i = 1; i <= 24; i++) {
    sections.push(`${i}. Section ${i}: ${bodies[i % bodies.length]}`);
    sections.push(bodies[(i + 1) % bodies.length]!);
    sections.push(bodies[(i + 2) % bodies.length]!);
  }
  const tallScope = sections.join("\n");

  test("24-section scope in all four themes: nothing lost, totals land, footers agree", async () => {
    for (const theme of ["classic", "modern", "bold", "minimal"] as const) {
      const doc = sampleDoc({
        theme,
        lineItems: [{ name: "Work", description: tallScope, amount: "18500", quantity: 1, discount: "0", unit: "none" }],
        subtotal: "$18,500.00",
        total: "$18,500.00",
        status: "paid",
        paidToDate: "18500",
      });
      const raw = await pdfText(await buildInvoicePdf(doc, settings, "en", enStrings));
      const found = new Set([...raw.matchAll(/(\d+)\. Section \d+:/g)].map((m) => m[1]));
      expect(found.size).toBe(24);
      const pageCount = (raw.match(/\/Type \/Page[^s]/g) ?? []).length;
      const footerTotal = Number(raw.match(/\(Page 1 of (\d+)\)/)?.[1] ?? "0");
      expect(footerTotal).toBeGreaterThanOrEqual(3);
      expect(pageCount).toBeGreaterThanOrEqual(3);
      expect(raw).toContain("Subtotal");
      expect(raw).toContain("Total:");
      expect(raw).toContain("Balance due");
      expect(raw).toContain("Thank you for your business");
    }
  });

  test("40 short items repeat the table header on continuation pages", async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      name: `Item ${i + 1}`,
      description: `Scope line ${i + 1} for the conversion`,
      amount: "100",
      quantity: 1,
      discount: "0",
      unit: "none" as const,
    }));
    const doc = sampleDoc({ lineItems: items, subtotal: "$4,000.00", total: "$4,000.00" });
    const raw = await pdfText(await buildInvoicePdf(doc, settings, "en", enStrings));
    const headerBands = (raw.match(/528\. -20\. re/g) ?? []).length;
    expect(headerBands).toBeGreaterThanOrEqual(2);
    expect(raw).toContain("Item 40");
    expect(raw).toContain("Total:");
  });
});

describe("template rebuild: HTML paper (QuotePaper) mirrors the skeleton", () => {
  const appSrc = readFileSync("client/src/App.tsx", "utf8");
  const css = readFileSync("client/src/theme.css", "utf8");

  test("paper markup: company stack, title block, meta row, deposit, accepted options", () => {
    expect(appSrc).toContain("quote-paper-stack");
    expect(appSrc).toContain("quote-paper-title-block");
    expect(appSrc).toContain("quote-paper-meta");
    expect(appSrc).toContain("Deposit due at signing");
    expect(appSrc).toContain("Accepted options");
  });

  test("paper CSS: stack + meta styles; modern/minimal grand totals are solid bands", () => {
    expect(css).toContain(".quote-paper-stack");
    expect(css).toContain(".quote-paper.theme-modern .document-totals .grand-total { background: var(--quote-accent); color: #fff; }");
    expect(css).toContain(".quote-paper.theme-minimal .document-totals .grand-total { background: #18201e; color: #fff; }");
    expect(css).toContain(".quote-paper-options h3");
    expect(css).toContain(".document-totals .deposit-due");
  });
});
