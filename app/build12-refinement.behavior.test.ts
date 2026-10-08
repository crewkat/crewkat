// Build 1.2 refinement (2026-10-07): Invoice Fly similarity pass on the
// Invoices & estimates screen + full theme audit fixes.
// Danny's verdict on the 1.2 deploy: "Not all pages have been updated. I need
// smaller button and more similarities to the example." Reference: Invoice Fly
// "Invoices & estimates" screen.
//
// Static CSS guards: compact header, ~44px segmented control, tight totals
// hero (no divider), ~52px CREATE button, ~46px search/filter row, dense
// invoice cards (34px status circle, 15px title, 38px action buttons), and the
// Follow-ups reminder rows that missed the 1.2 density pass.
// Run from app/:  bun test build12-refinement.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

// The LAST rule body for a selector wins in the cascade; the refinement rules
// are appended at the end of theme.css, so assert against the final occurrence.
function lastRuleBody(selector: string): string {
  const needle = `${selector} {`;
  const idx = CSS.lastIndexOf(needle);
  if (idx < 0) throw new Error(`selector ${selector} not found in theme.css`);
  const end = CSS.indexOf("}", idx);
  return CSS.slice(idx, end);
}

describe("compact app header (Invoice Fly reference)", () => {
  test("header is 50px with 20px title and 36px icon buttons", () => {
    expect(lastRuleBody(".app-header")).toContain("min-height: 50px");
    expect(lastRuleBody(".app-header h1")).toContain("font-size: 20px");
    const btn = lastRuleBody(".app-header .icon-button");
    expect(btn).toContain("min-width: 36px");
    expect(btn).toContain("height: 36px");
    expect(lastRuleBody(".app-header .icon-button svg")).toContain("width: 18px");
  });
});

describe("invoices screen: segmented control ~44px", () => {
  test("document-tabs buttons are 38px inside 3px padding", () => {
    const tabs = lastRuleBody(".document-tabs button");
    expect(tabs).toContain("min-height: 38px");
    expect(lastRuleBody(".document-tabs")).toContain("padding: 3px");
  });
});

describe("invoices screen: totals hero", () => {
  test("hero is tight with no divider line", () => {
    const hero = lastRuleBody(".document-hero");
    expect(hero).toContain("border-bottom: 0");
    expect(hero).toContain("gap: 2px");
    expect(lastRuleBody(".document-hero > strong")).toContain("font-size: 30px");
  });
});

describe("invoices screen: CREATE button ~52px", () => {
  test("create button is 52px tall, 14px text", () => {
    const btn = lastRuleBody(".page-actions.document-create .primary-button");
    expect(btn).toContain("min-height: 52px");
    expect(btn).toContain("font-size: 14px");
  });
});

describe("invoices screen: search + filter row ~46-48px", () => {
  test("search input and status select are compact", () => {
    expect(lastRuleBody(".ck-search input")).toContain("min-height: 44px");
    const sel = lastRuleBody(".ck-invoice-toolbar select.ck-btn-sm");
    expect(sel).toContain("min-height: 46px");
  });
});

describe("invoices screen: dense cards", () => {
  test("status circle is 34px", () => {
    const check = lastRuleBody(".ck-check");
    expect(check).toContain("width: 34px");
    expect(check).toContain("height: 34px");
  });

  test("card title is 15px", () => {
    expect(lastRuleBody(".ck-invoice-row-copy strong")).toContain("font-size: 15px");
  });

  test("action buttons are slim 38px with 12px text", () => {
    const btn = lastRuleBody(".document-list .row-actions button,\n.document-list .row-actions select");
    expect(btn).toContain("min-height: 38px");
    expect(btn).toContain("font-size: 12px");
  });

  test("card padding is tight", () => {
    expect(lastRuleBody(".document-tap.ck-invoice-row")).toContain("padding: 10px 12px");
  });
});

describe("audit fix: follow-ups reminder rows", () => {
  test("reminder rows got the density pass", () => {
    expect(lastRuleBody(".reminder-section article")).toContain("min-height: 60px");
    expect(lastRuleBody(".reminder-section h2, .saved-section h2")).toContain("font-size: 17px");
  });
});

// Exact-selector variant: the selector must start at a line boundary, so
// `.flow-dot {` doesn't match `.flow-step.current .flow-dot {`.
function exactRuleBody(selector: string): string {
  const needle = `\n${selector} {`;
  const idx = CSS.lastIndexOf(needle);
  if (idx < 0) throw new Error(`selector ${selector} not found in theme.css`);
  const end = CSS.indexOf("}", idx);
  return CSS.slice(idx, end);
}

describe("visual audit: home hero matches reference", () => {
  test("greeting is 32px, hero number is 56px", () => {
    expect(exactRuleBody(".home-header > div:first-child > strong")).toContain("font-size: 32px");
    expect(exactRuleBody(".home-summary-card > strong")).toContain("font-size: 56px");
    expect(exactRuleBody(".home-summary-card")).toContain("padding: 20px");
  });
});

describe("visual audit: glance tiles have icons and reference proportions", () => {
  test("tiles are flat bordered cards with plain icons", () => {
    // Final cascade: skinny pass sets 8px radius (standing less-rounding rule).
    expect(exactRuleBody(".glance-card")).toContain("border-radius: 8px");
    expect(exactRuleBody(".glance-icon")).toContain("width: 28px");
    expect(exactRuleBody(".glance-card strong")).toContain("font-size: 24px");
    // No tinted circle backgrounds behind glance icons in light mode.
    expect(CSS).toContain(".glance-icon.tone-red { color: #d34a3a; }");
  });

  test("glance icons exist in JSX", () => {
    const tsx = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
    expect(tsx).toContain("glance-icon tone-red");
    expect(tsx).toContain("glance-icon tone-blue");
    expect(tsx).toContain("glance-icon tone-purple");
  });
});

describe("visual audit: money tiles are 3 white cards", () => {
  test("money snapshot is a 3-col tile grid, not a divider strip", () => {
    const sec = exactRuleBody(".today-page .money-snapshot.b06-money");
    expect(sec).toContain("grid-template-columns: repeat(3, 1fr)");
    expect(sec).toContain("gap: 10px");
    expect(exactRuleBody(".b06-money-icon")).toContain("width: 26px");
    expect(exactRuleBody(".b06-money-card strong")).toContain("800 17px/1.15");
    // Amounts never truncate (regression guard: "$38,18...").
    expect(exactRuleBody(".b06-money-card strong")).toContain("text-overflow: clip");
    expect(exactRuleBody(".b06-money-card strong")).not.toContain("text-overflow: ellipsis");
  });
});

describe("visual audit: job detail stepper and tabs", () => {
  test("stepper dots are 40px with 12px labels", () => {
    expect(exactRuleBody(".flow-dot")).toContain("width: 40px");
    expect(exactRuleBody(".flow-dot")).toContain("height: 40px");
    expect(exactRuleBody(".flow-label")).toContain("font-size: 12px");
  });

  test("tab pills are larger", () => {
    const tabs = exactRuleBody(".workspace-tabs button");
    expect(tabs).toContain("padding: 12px 18px");
    expect(tabs).toContain("font-size: 14px");
  });
});

describe("visual audit: quote chase button grid", () => {
  test("actions are a 3-col grid with full-width last button at 48px", () => {
    const actions = exactRuleBody(".quote-chase .automation-actions");
    expect(actions).toContain("grid-template-columns: repeat(3, 1fr)");
    expect(exactRuleBody(".quote-chase .automation-actions > :last-child")).toContain("grid-column: 1 / -1");
  });

  test("quote chase wrapper exists in JSX", () => {
    const tsx = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
    expect(tsx).toContain('className="quote-chase"');
  });
});
