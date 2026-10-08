// Build 1.2 (part B): app-wide Invoice Fly theme — standard flush bottom tab bar,
// near-white light-mode background, denser cards/lists. Home restyle (Oct 7):
// flat bordered 12px cards, plain colored icons, hero line-art, full amounts.
// Zero functionality removed: same 5 tabs, center + button, badges, quick-create sheet.
//
// Static assertions on App.tsx + theme.css.
// Run from app/:  bun test build12-theme.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

// Extract the body of the first `.bottom-nav { ... }` rule (the base rule).
function baseRuleBody(selector: string): string {
  const idx = CSS.indexOf(`${selector} {`);
  if (idx < 0) throw new Error(`selector ${selector} not found in theme.css`);
  const end = CSS.indexOf("}", idx);
  return CSS.slice(idx, end);
}

describe("bottom nav", () => {
  const nav = baseRuleBody(".bottom-nav");

  test("nav is a full-width bottom bar, not a floating pill", () => {
    // Flush to the bottom edge, full width.
    expect(nav).toContain("inset: auto 0 0 0");
    // Hairline top border instead of a pill outline.
    expect(nav).toContain("border-top: 1px solid var(--border)");
    expect(nav).toContain("border-radius: 0");
    // No pill shadow.
    expect(nav).toContain("box-shadow: none");
    // Old floating-pill styles are gone from the base rule.
    expect(nav).not.toContain("border-radius: 999px");
    expect(nav).not.toContain("inset: auto 14px");
  });

  test("desktop keeps a centered bar", () => {
    expect(CSS).toContain(".bottom-nav { left: 50%; right: auto; width: min(640px, 100%); transform: translateX(-50%); }");
  });

  test("content clears the bottom bar (bottom padding rules)", () => {
    // ~84px clears the ~70px flush bar footprint.
    expect(CSS).toContain(".app-shell.has-bottom-nav .page { padding-bottom: calc(84px + env(safe-area-inset-bottom)); }");
    expect(CSS).not.toContain("padding-bottom: calc(104px + env(safe-area-inset-bottom))");
    expect(CSS).not.toContain("padding-bottom: calc(152px + env(safe-area-inset-bottom))");
    // Floating overlays that used to sit above the tall bar moved up with the pill.
    expect(CSS).toContain(".sticky-submit { position: fixed; left: auto; right: 16px; bottom: calc(96px + env(safe-area-inset-bottom)");
    expect(CSS).toContain(".update-toast { position: fixed; left: 16px; right: 16px; bottom: calc(96px + env(safe-area-inset-bottom))");
    expect(CSS).toContain(".document-action-bar { position: fixed; z-index: 78; inset: auto 0 calc(92px + env(safe-area-inset-bottom))");
  });
});

describe("whiter light-mode background", () => {
  test("page background is near-white in light mode", () => {
    expect(CSS).toContain("--bg: #f7f7f5;");
    // Near-white gradient wash (old wash started at #eceef4).
    expect(CSS).toContain('background-color: #ffffff; background-image: linear-gradient(180deg, #f1f3f7 0%, #f8f9fb 42%, #ffffff 100%)');
    expect(CSS).not.toContain("#eceef4");
  });

  test("dark mode untouched and coherent", () => {
    expect(CSS).toMatch(/:root\[data-theme="dark"\]\s*\{[^}]*--bg:\s*#121617/);
    // The floating pill + white cards use theme vars, so dark mode reads correctly.
    expect(baseRuleBody(".bottom-nav")).toContain("var(--surface)");
    expect(baseRuleBody(".bottom-nav")).toContain("var(--border)");
  });
});

describe("denser cards and lists", () => {
  test("jobs list rows are tighter", () => {
    expect(CSS).toContain("min-height: 76px; padding: 14px 4px;");
    expect(CSS).toContain("padding: 10px 12px; margin-bottom: 8px;");
  });

  test("home dashboard cards are denser", () => {
    expect(CSS).toContain(".home-summary-card { position: relative; overflow: hidden; display: grid; gap: 3px; margin: 4px 0 14px; padding: 16px;");
    expect(CSS).toContain(".home-job-card { width: 100%; min-height: 62px;");
    expect(CSS).toContain(".home-quick-access > button { position: relative; min-width: 0; min-height: 84px;");
    expect(CSS).toContain(".glance-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 4px 0 10px; }");
  });

  test("invoice/estimate lists are denser", () => {
    expect(CSS).toContain(".document-hero > strong { font: 800 32px/1");
    expect(CSS).toContain(".quote-list { display:grid; gap:8px; }");
    expect(CSS).toContain(".document-list { gap: 5px; }");
    expect(CSS).toContain(".document-list article { padding: 6px 10px; gap: 5px;");
  });

  test("quote chase queue cards are denser", () => {
    expect(CSS).toContain(".automation-group { margin: 0 0 .75rem;");
    expect(CSS).toContain(".automation-card { position: relative; padding: .7rem .8rem;");
  });

  test("marketplace feed is denser with soft card shadows", () => {
    expect(CSS).toContain(".market-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px 8px; }");
    expect(CSS).toContain(".market-card-copy { display:grid; gap:1px; padding:7px 10px 9px; }");
  });

  test("empty states shed dead space", () => {
    expect(CSS).toContain("min-height: 240px; padding: 28px 20px;");
  });

  test("job detail sections are tighter", () => {
    expect(CSS).toContain(".flow-stepper { display: flex; align-items: flex-start; gap: 0; padding: 8px 4px 2px; margin: 0; }");
    expect(CSS).toContain(".job-accordion { display:grid; gap:8px; padding-bottom:20px; }");
    expect(CSS).toContain(".accordion-trigger { width:100%; min-height:56px;");
  });
});

describe("functionality preserved", () => {
  test("bottom nav still renders all 5 slots (4 tabs + center +)", () => {
    // The four tab definitions.
    for (const tab of ['tab: "today"', 'tab: "jobs"', 'tab: "invoices"', 'tab: "marketplace"']) {
      expect(APP).toContain(tab);
    }
    // The center + button.
    expect(APP).toContain('className="bottom-nav-add"');
    expect(APP).toContain('aria-label={lang === "es" ? "Crear nuevo" : "Create new"}');
    // Two tabs render left of +, two right of +.
    expect(APP).toContain("items.slice(0, 2).map");
    expect(APP).toContain("items.slice(2).map");
  });

  test("nav labels, active states, and unread badges kept", () => {
    for (const label of ["Home", "Inicio", "Jobs", "Trabajos", "Invoices", "Facturas", "Marketplace", "Mercado"]) {
      expect(APP).toContain(label);
    }
    expect(APP).toContain('className={active === item.tab ? "active" : ""}');
    expect(APP).toContain("nav-unread-badge");
    expect(APP).toContain("unreadMarketplace");
  });

  test("quick-create sheet still opens from the + button", () => {
    expect(APP).toContain("quick-create-grid");
    expect(APP).toContain("setQuickCreateOpen(true)");
    expect(APP).toContain("What would you like to create?");
  });

  test("motion system untouched (transform/opacity only, reduced-motion kept)", () => {
    expect(CSS).toContain(".bottom-nav button:active");
    expect(CSS).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });
});
