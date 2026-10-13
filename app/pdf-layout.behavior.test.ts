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

// Regression (Danny 2026-10-12, INV-0011): a line-item description typed with
// line breaks — numbered scope sections, breaks INSIDE paragraphs — rendered
// with its lines progressively overprinting each other. Root cause: the rich
// text wrapper treated "\n" as a wrappable space and left newline characters
// inside the strings handed to doc.text(); jsPDF splits those into extra
// visual lines at its own line height (fontSize × 1.15 = 10.35pt), which the
// layout (descStep advance, row height, pagination) never counts. The fix
// makes the wrapper treat "\n" as a hard paragraph break. These tests pin
// the geometry: description line baselines must advance by exactly descStep
// (11pt at defaults; 11 × 1.16 × 0.92 at fontSize XL + lineSpacing compact),
// and every source line must start on its own PDF line.
describe("multi-line description line geometry (INV-0011 overprint regression)", () => {
  const scopeDescription = [
    "**SCOPE OF WORK — Exterior electrical** All work per NEC and local code.",
    "1. Exterior / Lanai: Run new dedicated 20A circuit from the panel to the lanai columns.",
    "Install weatherproof GFCI receptacles and seal all penetrations.",
    "Test every device under load before leaving.",
    "2. Entry: Replace the entry fixture with a client-supplied lantern and add a photocell.",
    "Verify the switch leg, grounding, and patch paint where disturbed.",
    "3. Garage: Install two 4-ft LED shop lights and add a receptacle above the workbench.",
    "Label all new circuits in the panel directory.",
    "4. Kitchen: Under-cabinet LED tape with a dimmable driver on its own switch leg.",
    "GFCI protection within six feet of the sink.",
    "5. Bathrooms: Humidity-sensing exhaust fans and vanity bar lights in both baths.",
    "6. Bedrooms: Fan-rated boxes in all three bedrooms with remotes paired.",
    "7. Living Room: LED retrofit trims and a dedicated media receptacle.",
    "8. Panel: Upgrade to 200A service with whole-home surge protection.",
    "9. Exterior Lighting: Low-voltage transformer and six pathway fixtures.",
    "10. Fans: Two client-provided exterior-rated fans over the porch lights.",
    "11. Repairs: Shorted wire repair, laundry receptacle, doorbell camera.",
    "12. Additional Work: Extra gallon of paint, receipt attached, final walkthrough.",
  ].join("\n");

  // First text run of each description line: "x y Td" + "(text) Tj" in the
  // content stream. Description lines start at x=50 (margin 42 + 8 indent);
  // the items region sits between the table header (y≈637) and the totals.
  function descriptionLines(raw: string): Array<{ y: number; text: string }> {
    const out: Array<{ y: number; text: string }> = [];
    const re = /([\d.]+) ([\d.]+) Td\n\(([^()]*)\) Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      const x = Number(m[1]);
      const y = Number(m[2]);
      if (x === 50 && y > 250 && y < 630) out.push({ y, text: m[3]! });
    }
    return out;
  }

  function expectUniformSteps(raw: string, step: number) {
    const lines = descriptionLines(raw);
    expect(lines.length).toBe(18);
    for (let i = 1; i < lines.length; i++) {
      const dy = lines[i - 1]!.y - lines[i]!.y;
      expect(dy).toBeGreaterThan(step - 0.06);
      expect(dy).toBeLessThan(step + 0.06);
    }
    // Hard breaks honored: numbered sections begin their own lines.
    const starts = lines.map((l) => l.text);
    expect(starts.some((t) => t.startsWith("1. Exterior"))).toBe(true);
    expect(starts.some((t) => t.startsWith("2. Entry"))).toBe(true);
    expect(starts.some((t) => t.startsWith("12. Additional Work"))).toBe(true);
    // Continuation lines of a broken paragraph start at the margin too.
    expect(starts.some((t) => t.startsWith("Install weatherproof"))).toBe(true);
    expect(starts.some((t) => t.startsWith("Test every device"))).toBe(true);
  }

  test("line baselines advance by exactly descStep at default design settings", async () => {
    const invoice = sampleInvoice({
      lineItems: [
        { name: "", description: scopeDescription, amount: "6500", quantity: 1, discount: "0", unit: "none" },
      ],
      total: "$6,500.00",
      subtotal: "$6,500.00",
    });
    const raw = await pdfText(await buildInvoicePdf(invoice, settings, "en", enStrings));
    expectUniformSteps(raw, 11);
  });

  test("line baselines stay uniform at fontSize XL + lineSpacing compact", async () => {
    const invoice = sampleInvoice({
      lineItems: [
        { name: "", description: scopeDescription, amount: "6500", quantity: 1, discount: "0", unit: "none" },
      ],
      total: "$6,500.00",
      subtotal: "$6,500.00",
      customizeJson: JSON.stringify({ fontSize: "xl", lineSpacing: "compact" }),
    });
    const raw = await pdfText(await buildInvoicePdf(invoice, settings, "en", enStrings));
    // descStep = 11 × 1.16 (XL) × 0.92 (compact) = 11.7392
    expectUniformSteps(raw, 11.74);
  });
});

// Regression (Danny 2026-10-12, INV-0011 again): once the overprint fix made
// row heights honest, a single line item whose description runs ~3 pages was
// TALLER than one page's whole items area — so the whole-row page break
// pushed it entirely off page 1 (page 1 shipped with just the header, table
// head, and PAID stamp) and every line past the next page's bottom was drawn
// off-page and silently lost (only 12 of 24 scope sections existed anywhere
// in the file). A row taller than a full page must now START on the current
// page and split at description-line boundaries. Rows that fit on one page
// keep the move-whole behavior (pinned byte-for-byte by the control docs in
// the fix's verification; the geometry tests above pin their layout).
describe("taller-than-a-page line items split across pages (INV-0011)", () => {
  const bodies = [
    "Install two (2) new switches to the right of the lanai door: one for three (3) new exterior ceiling fans, one for two (2) new exterior recessed lights.",
    "Remove four (4) existing lights from the exterior block wall; patch and refinish stucco to match.",
    "Repurpose the existing block-wall lighting circuit to feed six (6) new recessed lights in the exterior lanai.",
    "Install eight (8) recessed lights and three (3) ceiling fans in the lanai, wiring concealed inside the insulated panels.",
  ];
  const sections: string[] = [
    "**SCOPE OF WORK — Residential Electrical: Lighting, Fan & Switch Upgrade** All work to be performed at the property located in Odessa, FL.",
  ];
  for (let i = 1; i <= 24; i++) {
    sections.push(`${i}. Section ${i}: ${bodies[i % bodies.length]}`);
    sections.push(bodies[(i + 1) % bodies.length]);
    sections.push(bodies[(i + 2) % bodies.length]);
  }
  const tallDesc = sections.join("\n");

  /** Content streams in page order (fixtures carry no image/font streams). */
  function pageStreams(raw: string): string[] {
    return (raw.match(/stream\n([\s\S]*?)endstream/g) ?? []).map((block) =>
      block.replace(/^stream\n/, "").replace(/endstream$/, ""),
    );
  }

  test("invoice: the tall item starts on page 1 and no text is lost", async () => {
    const invoice = sampleInvoice({
      lineItems: [
        { name: "Work", description: tallDesc, amount: "6500", quantity: 1, discount: "0", unit: "none" },
      ],
      total: "$6,500.00",
      subtotal: "$6,500.00",
      status: "paid",
      paidToDate: "6500",
    });
    const raw = await pdfText(await buildInvoicePdf(invoice, settings, "en", enStrings));
    const pages = pageStreams(raw);
    // Honest pagination for this fixture: 4 pages, footers agree.
    expect(pages.length).toBe(4);
    expect(raw.match(/\(Page \d+ of 4\)/g)?.length).toBe(4);
    // Page 1 carries real description lines, not just header + stamp.
    expect(pages[0]).toContain("SCOPE OF WORK");
    expect(pages[0]).toContain("1. Section 1:");
    // Nothing is drawn off-page and lost: every section survives somewhere.
    const found = new Set([...raw.matchAll(/(\d+)\. Section \d+:/g)].map((m) => m[1]));
    expect(found.size).toBe(24);
    // The closing section and the totals panel land together on page 3;
    // the notes panel then breaks to page 4 (existing ensureSpace flow).
    expect(pages[2]).toContain("24. Section 24:");
    expect(pages[2]).toContain("Balance due");
  });

  test("quote: a tall second row (zebra chunk) also starts on page 1", async () => {
    const longPara =
      "TALLQUOTEMARKER Framing, drywall, tape and texture, prime and two finish coats of paint across the whole lanai ceiling and both side walls. ".repeat(
        60,
      );
    const quote = sampleInvoice({
      lineItems: [
        { name: "First", description: "Short first item.", amount: "100", quantity: 1, discount: "0", unit: "none" },
        { name: "", description: longPara, amount: "3200", quantity: 1, discount: "0", unit: "none" },
      ],
    });
    const raw = await pdfText(await buildQuotePdf(quote, settings, "en", enStrings));
    const pages = pageStreams(raw);
    expect(pages.length).toBe(3);
    expect(raw.match(/\(Page \d+ of 3\)/g)?.length).toBe(3);
    expect(pages[0]).toContain("TALLQUOTEMARKER");
    expect(pages[0]).toContain("Short first item.");
  });
});
