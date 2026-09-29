// Regression tests — 2026-09-29: two Danny-reported UI issues.
//
// Issue 1: "In jobs the last button is covered." On the job detail screen the
// last accordion ("More job tools") stayed hidden behind the bottom nav no
// matter how far you scrolled.
// Root cause: JobDetail is wrapped in DetailHero, whose div used a DEFINITE
// `height: "100%"` with `display:flex; flex-direction:column`. The
// <main class="page"> flex child then shrink-clamped to exactly the viewport
// height, so its padding-bottom (the .app-shell.has-bottom-nav .page 152px
// bottom-nav clearance) landed mid-scroll instead of at the end of the
// content. Only the shell's own 76px padding remained at the true bottom —
// not enough to clear the fixed bottom nav.
// Fix: the wrapper uses minHeight instead of height, so the page grows with
// its content and the clearance padding lands at the end of the scroll.
//
// Issue 2: "The preview pdf is not to scale." The fullscreen "PDF preview"
// screen rendered the HTML QuotePaper mock (a fluid div with min-height,
// NOT Letter-proportioned and NOT the actual PDF), so it never matched the
// document the client receives. The real pipeline (jsPDF letter +
// pdftoppm -r 120 + width:100%/height:auto) is pixel-exact; the overlay just
// wasn't using it.
// Fix: both fullscreen preview overlays (estimate + invoice) render the real
// generated PDF blob through PdfFrame instead of the HTML mock.
//
// Run from app/:  bun test preview-fidelity.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildInvoicePdf,
  type FinancialDocument,
  type PdfStrings,
} from "./client/src/financialPdf.ts";

const APP_SRC = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const THEME_CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

function extractFunction(src: string, name: string): string {
  const lines = src.split("\n");
  const startIdx = lines.findIndex((l) => l.startsWith(`function ${name}(`));
  if (startIdx === -1) throw new Error(`function ${name} not found`);
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^function \w+\(/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

describe("job detail scroll clearance (DetailHero)", () => {
  test("DetailHero wrapper grows with content (minHeight, not a definite height)", () => {
    const body = extractFunction(APP_SRC, "DetailHero");
    // A definite height:100% on this flex column wrapper shrink-clamps the
    // <main class="page"> child to viewport height, stranding its
    // bottom-nav clearance padding mid-scroll.
    expect(body).not.toMatch(/style=\{\{\s*height:\s*"100%"/);
    expect(body).toMatch(/minHeight:\s*"100%"/);
  });
});

describe("fullscreen PDF preview shows the real document", () => {
  test("every document fullscreen-preview overlay renders PdfFrame with the document blob", () => {
    const overlays = APP_SRC.split("\n").filter(
      (l) => l.includes("fullscreen-preview") && !l.includes("customize-fullscreen"),
    );
    // The customize overlay keeps its own live HTML mock on purpose: it
    // re-renders on every design keystroke, where a PDF rebuild + server
    // render round-trip would lag. The applied design is verified through
    // the detail screen's real PDF preview below.
    expect(overlays.length).toBe(2); // estimate + invoice detail screens
    for (const line of overlays) {
      expect(line).toContain("<PdfFrame");
      expect(line).toContain("blob={blob}");
      // The HTML mock must not be the preview body anymore.
      expect(line).not.toContain("<QuotePaper");
    }
  });

  test("preview CSS never distorts the rendered page (height:auto)", () => {
    const rule = THEME_CSS.match(/\.pdf-pages img\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/height:\s*auto/);
    expect(rule![0]).toMatch(/width:\s*100%/);
  });

  test("the generated invoice PDF is exactly US Letter (612 x 792 pt)", async () => {
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
    const invoice = {
      id: 1,
      invoiceNumber: "INV-0001",
      clientName: "Jhon",
      jobAddress: "123 main street",
      shippingAddress: "",
      jobType: "Repair",
      lineItems: [
        { name: "356 look", description: "", amount: "50000", quantity: 1, discount: "0", unit: "none" },
      ],
      subtotal: "$50,000.00",
      discountType: "fixed",
      discountValue: "0",
      taxType: "fixed",
      taxValue: "0",
      total: "$50,000.00",
      footnote: "",
      theme: "classic",
      font: "helvetica",
      accentColor: "#1f5a4a",
      showTaxLine: false,
      showDiscountLine: false,
      showPaidLine: true,
      showPaymentTerms: true,
      showFooterNotes: true,
      showLogo: false,
      showCompanyInfo: true,
      customizeJson: "{}",
      issueDate: "2026-09-25",
      dueDate: "2026-10-09",
    } as unknown as FinancialDocument;
    const strings: PdfStrings = { discount: "Discount", tax: "Tax", paymentInstructions: "Payment instructions" };
    const blob = await buildInvoicePdf(invoice, settings, "en", strings);
    const raw = Buffer.from(await blob.arrayBuffer()).toString("latin1");
    const mediaBox = raw.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
    expect(mediaBox).not.toBeNull();
    const [, x1, y1, x2, y2] = mediaBox!;
    expect(Number(x2) - Number(x1)).toBe(612);
    expect(Number(y2) - Number(y1)).toBe(792);
  });
});
