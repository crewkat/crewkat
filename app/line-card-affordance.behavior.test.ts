// Collapsed line-item card affordance (Danny, 2026-10-15).
//
// Danny's report (New invoice screenshot): the collapsed line-item cards
// were so white/flat they blended into the page — the builders' flat
// section stripped the shared .doc-line-card down to borderless full-bleed
// rows (border: 0, transparent background), so nothing read as "a card you
// tap to open and edit". Fix: at the shared class, the flat-section cards
// are real inset cards again (surface fill, hairline border, radius,
// subtle shadow — the editor sheet's card language), density unchanged,
// and the WHOLE card is the tap target opening the LineItemEditSheet at
// all three call sites (quote builder, invoice builder, document editor),
// with the drag grip / reorder / remove controls carved out.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

const rule = (selector: string) => {
  const start = CSS.indexOf(`${selector} {`);
  if (start < 0) return "";
  return CSS.slice(start, CSS.indexOf("}", start));
};

const quoteStart = APP.indexOf("function QuoteBuilder");
const invoiceStart = APP.indexOf("function InvoiceBuilder");
const invoiceEnd = APP.indexOf("function PaymentSheet", invoiceStart);
const editorStart = APP.indexOf("function FinancialEditor");
const editorEnd = APP.indexOf("function PreviewSendSheet", editorStart);
const QUOTE = APP.slice(quoteStart, invoiceStart);
const INVOICE = APP.slice(invoiceStart, invoiceEnd);
const EDITOR = APP.slice(editorStart, editorEnd);

describe("shared card treatment (CSS)", () => {
  test("flat-section line cards are real cards again — border, surface, radius, shadow", () => {
    const flat = rule(".floating-doc-form .doc-items-flat .doc-line-card");
    expect(flat).toContain("border: 1px solid var(--border)");
    expect(flat).toContain("background: var(--surface)");
    expect(flat).toContain("border-radius: 14px");
    expect(flat).toContain("box-shadow:");
    expect(flat).not.toContain("background: transparent");
    expect(flat).not.toContain("border: 0;");
  });

  test("density kept: same 12px padding, 10px gaps, inset like the section's other children", () => {
    const flat = rule(".floating-doc-form .doc-items-flat .doc-line-card");
    expect(flat).toContain("margin: 0 14px");
    expect(flat).toContain("padding: 12px");
    expect(rule(".floating-doc-form .doc-items-flat .b06-line-list")).toContain("gap: 10px");
  });

  test("collapsed cards everywhere take the pointer cursor (shared class)", () => {
    // (An older `.doc-line-card.collapsed { gap: 4px; }` rule exists too;
    // the cascade merges both — pin this build's exact rule text.)
    expect(CSS).toContain(".doc-line-card.collapsed { cursor: pointer; }");
  });

  test("the document editor's card rule already had the boundary and is untouched", () => {
    const ed = rule(".editor-sheet .doc-line-card");
    expect(ed).toContain("border: 1px solid");
    expect(ed).toContain("box-shadow:");
    expect(ed).toContain("border-radius: 16px");
  });
});

describe("whole card is the tap target", () => {
  test("the tap guard helper carves out grip, reorder and remove controls", () => {
    const start = APP.indexOf("function lineCardTapOpens");
    expect(start).toBeGreaterThan(-1);
    const helper = APP.slice(start, APP.indexOf("function lineItemSummary", start));
    for (const sel of [".b06-grip", ".b06-line-remove", ".doc-line-remove", ".reorder-buttons"]) {
      expect(helper).toContain(sel);
    }
  });

  test("quote builder card opens the editor on card tap", () => {
    expect(QUOTE).toContain("data-b06-line onClick={(e) => { if (lineCardTapOpens(e.target)) setEditingItem(i); }}");
  });

  test("invoice builder card opens the editor on card tap", () => {
    expect(INVOICE).toContain('className="invoice-line-card doc-line-card collapsed" key={index} onClick={(e) => { if (lineCardTapOpens(e.target)) setEditingItem(index); }}');
  });

  test("document editor card opens on tap, but never while reordering", () => {
    expect(EDITOR).toContain('className="doc-line-card collapsed" key={index} onClick={(e) => { if (!reorder && lineCardTapOpens(e.target)) setEditingItem(index); }}');
  });

  test("chevron affordance retained on the summary row at all three sites", () => {
    for (const slice of [QUOTE, INVOICE, EDITOR]) {
      expect(slice).toContain('className="doc-line-summary"');
      expect(slice).toContain('className="doc-line-open"');
    }
  });

  test("drag-reorder wiring on the quote card is unchanged", () => {
    expect(QUOTE).toContain('className="b06-grip"');
    expect(QUOTE).toContain("onGripPointerDown(e, i)");
    expect(QUOTE).toContain("onGripPointerMove");
    expect(QUOTE).toContain("onGripKeyDown(e, i)");
  });
});
