// Build 1.2 (part A): floating document forms — new estimate, new invoice,
// and the edit-existing-document sheet become floating windows with an
// X | title | Preview + Save header (no gear/wrench), big line-item fields,
// compact auto-saving discount/tax, and the exit X running the save path.
//
// Static assertions on App.tsx + theme.css, plus logic checks on the
// quantity-aware totals and the discount/tax commit predicate.
// Run from app/:  bun test build12-forms.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { financialTotals, money } from "./client/src/financialPdf.ts";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

// The shared floating header's source, for the no-gear/wrench assertion.
const headerSrc = APP.slice(
  APP.indexOf("function FloatingDocHeader("),
  APP.indexOf("function formatDate("),
);

describe("floating windows", () => {
  test("quote builder renders a floating sheet, not a full page", () => {
    expect(APP).toContain('className="floating-doc-sheet b06-quote-builder-page"');
    expect(APP).not.toContain('<main className="page form-page b06-quote-builder-page">');
  });

  test("invoice builder renders a floating sheet, not a full page", () => {
    expect(APP).toContain('className="floating-doc-sheet invoice-builder-page"');
    expect(APP).not.toContain('<main className="page form-page invoice-builder-page">');
  });

  test("edit-existing-document sheet uses the floating backdrop", () => {
    expect(APP).toContain('className="sheet-backdrop floating-doc-backdrop"');
  });

  test("floating shell CSS: centered, rounded on all sides, elevated", () => {
    expect(CSS).toContain(".floating-doc-backdrop");
    expect(CSS).toContain("align-items: center");
    expect(CSS).toContain(".floating-doc-sheet");
    // All four corners rounded — never the old bottom-attached 18px 18px 0 0.
    expect(CSS).toMatch(/\.floating-doc-sheet\s*\{[^}]*border-radius:\s*20px/);
    expect(CSS).toMatch(/\.more-sheet\.editor-sheet\s*\{\s*border-radius:\s*20px/);
    expect(CSS).toContain("max-height: min(92vh, 860px)");
    expect(CSS).toContain("width: min(100%, 640px)");
    expect(CSS).toContain("box-shadow: 0 24px 64px");
  });

  test("animated open/close pattern reused (useAnimatedDismiss + .closing)", () => {
    expect(APP).toContain("const docDismiss = useAnimatedDismiss(docOpen);");
    expect(APP).toContain('floating-doc-backdrop${docDismiss.closing ? " closing" : ""}');
    expect(CSS).toContain("@keyframes floating-doc-in");
    expect(CSS).toContain(".floating-doc-backdrop.closing .floating-doc-sheet");
  });

  test("prefers-reduced-motion disables the floating motion", () => {
    expect(CSS).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.floating-doc-sheet[^}]*animation:\s*none/,
    );
  });

  test("sticky floating header keeps Save visible while scrolling", () => {
    expect(CSS).toMatch(/\.floating-doc-header\s*\{[^}]*position:\s*sticky/);
  });

  test("preview overlay opened from the floating sheet paints above it", () => {
    expect(CSS).toContain(".floating-doc-sheet .document-overlay");
  });
});

describe("floating form header", () => {
  test("shared header exists: X | title | icon-only Preview + Save", () => {
    expect(headerSrc).toContain("floating-doc-header");
    expect(headerSrc).toContain("floating-doc-exit");
    expect(headerSrc).toContain("aria-label={t.close}");
    expect(headerSrc).toContain("<h2>{title}</h2>");
    // Build 2.0: preview shrank to a self-explanatory icon-only button.
    expect(headerSrc).toContain("floating-doc-preview");
    expect(headerSrc).toContain("aria-label={t.previewPdf}");
    expect(headerSrc).not.toContain("preview-trigger");
    expect(headerSrc).toContain('type="submit"');
    // Save is a solid button labeled just "Save", not a text link.
    expect(headerSrc).toContain('className="sheet-save-btn"');
  });

  test("no gear (settings) or wrench (tools) buttons in the form headers", () => {
    expect(headerSrc).not.toContain("GearIcon");
    expect(headerSrc).not.toContain("openTools");
    expect(headerSrc).not.toContain("openSettings");
    expect(headerSrc).not.toContain("master-settings-button");
  });

  test("all three forms use the shared header, none use PageHeader", () => {
    expect(APP).not.toContain("<PageHeader lang={lang} title={t.newQuote}");
    expect(APP).not.toContain("<PageHeader lang={lang} title={t.newInvoice}");
    expect(APP).not.toContain("sheet-header-row editor-header");
    // QuoteBuilder, InvoiceBuilder, FinancialEditor.
    expect(APP.split("<FloatingDocHeader").length - 1).toBe(3);
  });
});

describe("exit X runs the save path", () => {
  test("builders: X closes and saves — complete content saves, partial keeps a draft, empty discards", () => {
    // Build 2.0: X is close-and-save. Complete content goes through the
    // normal save mutation; partial content is kept as a localStorage draft
    // (offered via a Resume/Discard banner); a fully empty form closes
    // silently without saving.
    expect(APP).toContain("const exitAndSave = () => {");
    expect(APP).toContain("quoteDraftHasContent");
    expect(APP).toContain("invoiceDraftHasContent");
    expect(APP).toContain("QUOTE_DRAFT_KEY");
    expect(APP).toContain("INVOICE_DRAFT_KEY");
    expect(APP).toContain("onExit={exitAndSave}");
    // Builders no longer navigate away without saving.
    expect(APP).not.toContain("<PageHeader lang={lang} title={t.newQuote} onBack={onBack}");
  });

  test("editor: X saves then closes (mirrors the hardware-back interceptor)", () => {
    expect(APP).toContain("onExit={exitAndSave}");
    expect(APP).toContain(
      "const exitAndSave = () => { if (saving) return; buzz(8); void Promise.resolve(save()).catch(() => {}).finally(() => onCancel()); };",
    );
    // Backdrop tap and Escape also save-then-close now.
    expect(APP).toContain("onClick={(e)=>{if(e.target===e.currentTarget)exitAndSave();}}");
    expect(APP).toContain("useEscapeToClose(true, exitAndSave);");
  });

  test("invoice draft autosave is preserved under the floating window", () => {
    expect(APP).toContain("readInvoiceDraft");
    expect(APP).toContain("INVOICE_DRAFT_KEY");
    expect(APP).toContain("flushInvoiceDraftRef");
  });
});

describe("big line-item fields", () => {
  test("all three forms use the full-width name / large description / price-qty layout", () => {
    // QuoteBuilder, InvoiceBuilder, FinancialEditor line-item cards.
    expect(APP.split("doc-line-name").length - 1).toBeGreaterThanOrEqual(3);
    expect(APP.split("doc-line-desc").length - 1).toBeGreaterThanOrEqual(3);
    expect(APP.split("doc-price-qty").length - 1).toBeGreaterThanOrEqual(3);
    expect(APP).toContain('rows={4}');
  });

  test("line-item CSS: big name row, large description area, price/qty pair", () => {
    expect(CSS).toMatch(/\.doc-line-card\s+\.doc-line-name\s*\{[^}]*min-height:\s*52px/);
    expect(CSS).toMatch(/\.doc-line-card\s+\.doc-line-desc\s*\{[^}]*min-height:\s*110px/);
    expect(CSS).toMatch(
      /\.doc-price-qty\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)\s*minmax\(0,1fr\)/,
    );
  });

  test("reorder affordances still present", () => {
    expect(APP).toContain("data-b06-line");
    expect(APP).toContain("onGripPointerDown");
    expect(APP).toContain("setReorder(!reorder)");
    expect(APP).toContain("b06-line-remove");
    expect(APP).toContain("doc-line-remove");
  });
});

describe("compact auto-saving discount/tax", () => {
  test("AdjustmentField renders a Done collapse button when onCollapse is set", () => {
    expect(APP).toContain("onCollapse?: () => void;");
    expect(APP).toContain("adjustment-collapse");
    expect(APP).toContain("adjustment-field${onCollapse ? \" collapsible\" : \"\"}");
  });

  test("quote builder: Done collapses the editor, value kept in form state", () => {
    expect(APP).toContain("onCollapse={() => setShowDiscount(false)}");
    expect(APP).toContain("onCollapse={() => setShowTax(false)}");
  });

  test("invoice builder: closing the sheet commits the value automatically", () => {
    expect(APP).toContain("setDiscountEnabled(money(form.discountValue) > 0)");
    expect(APP).toContain("setTaxEnabled(money(form.taxValue) > 0)");
    // Done in the sheet header, Done in the field, backdrop tap, Escape.
    expect(APP).toContain("onClick={commitAdjustmentAndClose}>{t.done}</button>");
    expect(APP).toContain("onCollapse={commitAdjustmentAndClose}");
    expect(APP).toContain(
      "onClick={(e) => { if (e.target === e.currentTarget) commitAdjustmentAndClose(); }}",
    );
    expect(APP).toContain(
      "useEscapeToClose(activeSheet !== null, () => commitAdjustmentAndClose());",
    );
  });

  test("editor: closing discount/tax persists the document automatically", () => {
    expect(APP).toContain("onCollapse={collapseDiscount}");
    expect(APP).toContain("onCollapse={collapseTax}");
    expect(APP).toContain(
      "const collapseDiscount = () => { setShowDiscount(false); exitAndSave(); };",
    );
    expect(APP).toContain(
      "const collapseTax = () => { setShowTax(false); exitAndSave(); };",
    );
  });

  test("discount/tax rows are compact", () => {
    expect(CSS).toMatch(/\.b06-adjust-toggle\s*\{[^}]*min-height:\s*40px/);
    expect(CSS).toMatch(
      /\.invoice-totals-block\s*>\s*div,\s*\.invoice-totals-block\s*>\s*button\s*\{[^}]*min-height:\s*44px/,
    );
    expect(CSS).toMatch(/\.totals-editor\s*>\s*button\s*\{[^}]*min-height:\s*38px/);
  });
});

describe("zero functionality removed", () => {
  test("builders keep template picker, assembly saver, preview, footnote, deposit", () => {
    expect(APP).toContain("setTemplateOpen(true)");
    expect(APP).toContain("setAssemblyOpen(true)");
    expect(APP).toContain("<DocumentDesignOverlay");
    expect(APP).toContain("{t.footnote}");
    expect(APP).toContain("depositType");
    expect(APP).toContain("ClientPicker");
  });

  test("editor keeps delete flow, partial payments, mark-as-paid, notes", () => {
    expect(APP).toContain("setConfirmDelete(true)");
    expect(APP).toContain("{t.partialPayments}");
    expect(APP).toContain("toggleInvoicePaid");
    expect(APP).toContain("recordPayment");
  });

  test("bottom sticky save pills are gone from the three forms (Save lives in the header)", () => {
    const region = (start: string, end: string) =>
      APP.slice(APP.indexOf(start), APP.indexOf(end));
    const quote = region("function QuoteBuilder({", "function QuotePaper({");
    const invoice = region("function InvoiceBuilder({", "function PaymentSheet({");
    const editor = region("function FinancialEditor({", "function PreviewSendSheet({");
    for (const [name, src] of [["quote", quote], ["invoice", invoice], ["editor", editor]] as const) {
      expect(src, `${name} form`).not.toContain("sticky-submit");
    }
  });
});

describe("quantity-aware totals (logic)", () => {
  test("line quantity multiplies into the subtotal", () => {
    const t = financialTotals(
      [{ amount: "100", quantity: 2 }],
      "percent",
      "0",
      "percent",
      "0",
    );
    expect(t.subtotal).toBe(200);
    expect(t.total).toBe(200);
  });

  test("missing quantity defaults to 1 (old quote items unchanged)", () => {
    const t = financialTotals([{ amount: "100" }], "percent", "0", "percent", "0");
    expect(t.subtotal).toBe(100);
  });

  test("discount/tax commit predicate: nonzero enables, zero/empty keeps off", () => {
    expect(money("10") > 0).toBe(true);
    expect(money("0") > 0).toBe(false);
    expect(money("") > 0).toBe(false);
  });
});

describe("Build 2.0: Danny's UI fix list", () => {
  test("builder line items stand alone — no card-within-a-card", () => {
    expect(APP).toContain("doc-items-flat");
    expect(APP).toContain("doc-items-legend");
    expect(APP).not.toContain('<fieldset className="form-section">');
    expect(APP).not.toContain('<fieldset className="form-section invoice-items-section">');
    expect(CSS).toContain(".doc-items-flat .doc-line-card");
  });

  test("builder Save button says only Save", () => {
    // QuoteBuilder and InvoiceBuilder both pass the bare Save label now.
    expect(APP.split("saveLabel={t.save}").length - 1).toBeGreaterThanOrEqual(2);
    expect(APP).not.toContain("saveLabel={estTerms.saveDoc}");
    expect(APP).not.toContain("saveLabel={t.saveInvoice}");
  });

  test("quote drafts mirror the invoice draft machinery", () => {
    expect(APP).toContain('const QUOTE_DRAFT_KEY = "crewkat-quote-draft"');
    expect(APP).toContain("function quoteDraftHasContent");
    expect(APP).toContain("function readQuoteDraft");
    expect(APP).toContain("draftOffered");
  });

  test("client picker retracts when focus leaves without a pick", () => {
    expect(APP).toContain("event.relatedTarget");
    expect(APP).toContain("client-picker");
  });

  test("payment notes textarea shows its resize grip", () => {
    expect(APP).toContain("<ResizeGrip />");
    expect(CSS).toContain(".textarea-grip-wrap");
  });

  test("clients screen: slim search, edge-to-edge compressed cards, vivid avatars", () => {
    expect(CSS).toContain(".clients-page .client-list");
    expect(CSS).toContain(".client-avatar.tone-0 { background: #1f7a5c; color: #fff; }");
    expect(CSS).toContain("min-height: 64px");
  });

  test("marketplace post form: ZIP and Save share a row", () => {
    expect(APP).toContain("market-zip-save-row");
    expect(CSS).toContain(".market-zip-save-row");
  });

  test("messages inbox spacing tightened; beige background test hook present", () => {
    expect(CSS).toContain(".market-inbox-subheading { margin: 8px 0 4px; }");
    expect(CSS).toContain("--beige: #f5f0e6");
    expect(CSS).toContain(".page.marketplace-thread");
  });

  test("bottom nav hides inside the marketplace thread", () => {
    expect(APP).toContain('screen.name === "marketplaceThread"');
  });
});
