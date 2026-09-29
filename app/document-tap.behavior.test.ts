// Regression test — 2026-09-29: Danny asked for (1) smaller invoice/estimate
// buttons, (2) tapping an invoice/estimate list card to open it for editing,
// and (3) smaller Tools screen buttons.
//
// Static assertions: the invoice/estimate cards render through TapArticle with
// the right detail destinations, nested controls (status select, View document)
// are guarded, swipe-revealed rows don't trigger navigation, and the compact
// button CSS classes exist with >=40px touch targets.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

describe("TapArticle document support", () => {
  test("TapArticle accepts a baseClass override", () => {
    expect(APP).toContain("baseClass?: string;");
    expect(APP).toContain("baseClass ?? \"automation-card\"");
  });

  test("taps are ignored when a SwipeRow's actions are revealed", () => {
    expect(APP).toContain('closest(".swipe-row")');
    expect(APP).toContain('querySelector(".swipe-content")');
    expect(APP).toContain("sw.style.transform");
  });

  test("nested interactive elements still don't navigate", () => {
    expect(APP).toContain('closest("a, button, input, select, textarea")');
  });
});

describe("invoice/estimate cards are tappable", () => {
  test("invoice card opens the invoice preview", () => {
    expect(APP).toContain(
      '<TapArticle baseClass="document-tap" onTap={() => setScreen({ name: "invoicePreview", invoiceId: invoice.id })}>',
    );
  });

  test("estimate card opens the quote preview", () => {
    expect(APP).toContain(
      '<TapArticle baseClass="document-tap" onTap={() => setScreen({ name: "quotePreview", quoteId: quote.id })}>',
    );
  });

  test("inner controls survive: status select and View document button", () => {
    expect(APP).toContain(
      '<select value={invoice.status} onChange={(e) => status.mutate(',
    );
    expect(APP).toContain("{t.viewDocument}</button>");
  });

  test("tap affordance CSS exists (chevron + press state + reduced motion)", () => {
    expect(CSS).toContain(".document-list .tap-target");
    expect(CSS).toContain(".document-list .tap-target::after");
    expect(CSS).toContain('content: "›"');
    expect(CSS).toContain("cursor: pointer");
    expect(CSS).toContain(
      "@media (prefers-reduced-motion: reduce) { .document-list .tap-target:active { transform: none; } }",
    );
  });
});

describe("compact invoice/estimate buttons", () => {
  test("create + list-card + detail action buttons are compact", () => {
    expect(CSS).toContain(
      ".page-actions.document-create .primary-button { min-height: 42px;",
    );
    expect(CSS).toContain(
      ".document-list .row-actions button { min-height: 40px;",
    );
    expect(CSS).toContain(
      ".document-list .row-actions select { min-height: 40px;",
    );
    expect(CSS).toContain(".document-action-bar { min-height: 54px; }");
    expect(CSS).toContain(
      ".document-action-bar svg { width: 17px; height: 17px; }",
    );
    expect(CSS).toContain(
      ".invoice-builder-page .sticky-submit, .form-page .sticky-submit { min-height: 44px;",
    );
  });
});

describe("compact Tools screen buttons", () => {
  test("featured cards, accordion summaries, and toolbox rows are slimmed", () => {
    expect(CSS).toContain(
      ".tools-featured-panels .pro-feature-card { min-height: 58px;",
    );
    expect(CSS).toContain(
      ".tools-featured-panels .action-details summary { min-height: 44px;",
    );
    expect(CSS).toContain(
      ".tools-home .tool-row-main { min-height: 56px;",
    );
    expect(CSS).toContain(
      ".tools-home .tool-tile-icon { width: 32px; height: 32px;",
    );
    expect(CSS).toContain(".tools-home .tool-pin-toggle { height: 40px; }");
  });
});
