// Builder horizontal-overflow guards (Danny 2026-10-15).
//
// Danny's New estimate screenshots: the builder was wider than the
// viewport — the orange Add line button bled past the right edge, and
// the "+ Discount" / "+ Tax" toggles and "Subtotal" sat clipped at the
// left edge. Root cause chain, all in the line-items section:
//
//  - .doc-items-flat is a FULL-BLEED section: it pulls itself out over
//    the floating-doc body's 14px side padding (margin: 0 -14px), so
//    every direct child must re-inset itself by 14px (the legend, the
//    template button row, quick-add and the line cards all do).
//  - .field-pair (discount/tax) and .calculation-summary (totals) are
//    direct children that never got a re-inset rule — they ran the
//    section's full width starting at the screen edge.
//  - .add-item-wide is width:100% globally; inside the section that
//    100% is the full-bleed width, and its 0 14px margins then pushed
//    its right edge 14px past the screen edge.
//
// The InvoiceBuilder shares the section component pattern but was NOT
// affected: its Add button is a plain .secondary-button (no width:100%)
// and its totals block lives outside the flat section (pinned below).
//
// Run from app/:  bun test builder-overflow.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

describe("doc-items-flat full-bleed contract", () => {
  test("section is full-bleed and every direct child re-insets", () => {
    expect(CSS).toMatch(/\.doc-items-flat \{[^}]*margin:\s*0 -14px/);
    // Children pinned re-inset before this fix — must not regress.
    expect(CSS).toMatch(/\.doc-items-flat > \.doc-items-legend \{[^}]*margin:\s*0 14px/);
    expect(CSS).toMatch(/\.doc-items-flat > \.b06-btn-row[^{]*\{[^}]*margin:\s*0 14px/);
    // The two children Danny's screenshot caught flush at the left edge.
    expect(CSS).toMatch(/\.doc-items-flat > \.field-pair[^{]*\{[^}]*margin-inline:\s*14px/);
    expect(CSS).toMatch(/\.doc-items-flat > \.calculation-summary[^{]*\{[^}]*margin-inline:\s*14px/);
  });

  test("Add line button sizes by stretch inside the section, not width:100%", () => {
    expect(CSS).toMatch(/\.add-item-wide \{ width: 100%; \}/);
    expect(CSS).toMatch(/\.doc-items-flat > \.primary-button\.add-item-wide \{ width: auto; \}/);
  });

  test("no 100vw-wide element exists in the builder sheets", () => {
    expect(CSS).not.toMatch(/\.floating-doc[^{]*\{[^}]*width:\s*100vw/);
    expect(CSS).not.toMatch(/\.doc-items-flat[^{]*\{[^}]*width:\s*100vw/);
  });
});

describe("builder markup shape stays the pattern the CSS expects", () => {
  test("QuoteBuilder: add-line + field-pair + totals live in the flat section", () => {
    const sectionAt = APP.indexOf('className="form-section doc-items-flat"');
    const addAt = APP.indexOf("primary-button add-item-wide");
    const pairAt = APP.indexOf('className="field-pair"', addAt);
    const totalsAt = APP.indexOf('className="calculation-summary"', addAt);
    expect(sectionAt).toBeGreaterThan(-1);
    expect(addAt).toBeGreaterThan(sectionAt);
    expect(pairAt).toBeGreaterThan(addAt);
    expect(totalsAt).toBeGreaterThan(pairAt);
  });

  test("InvoiceBuilder: totals block stays OUTSIDE its flat section", () => {
    const sectionAt = APP.indexOf("invoice-items-section doc-items-flat");
    const sectionEnd = APP.indexOf("</div>", APP.indexOf("secondary-button", sectionAt));
    const totalsAt = APP.indexOf('className="invoice-totals-block"', sectionAt);
    expect(sectionAt).toBeGreaterThan(-1);
    expect(totalsAt).toBeGreaterThan(sectionEnd);
  });
});
