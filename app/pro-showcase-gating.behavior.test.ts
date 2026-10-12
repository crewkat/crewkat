// Pro showcase gating (Danny 2026-10-11): five surfaces stay visible with a
// PRO badge for free users; tapping opens the upgrade sheet. Premium users
// see no gate. Financials intentionally NOT gated (separate consolidation).
// Plus: client/operations spacing fix, client edit as modal.
// Run from app/:  bun pro-showcase-gating.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const ACTIONS = readFileSync(join(import.meta.dir, "server/src/actions.ts"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/app.css"), "utf8");
const THEME = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

describe("ProShowcase component", () => {
  test("component exists with badge + upgrade sheet pattern", () => {
    expect(APP).toContain("function ProShowcase(");
    expect(APP).toContain("pro-badge is-locked pro-showcase-badge");
    expect(APP).toContain("<UpgradeGateSheet");
    expect(APP).toMatch(/if \(isPremium\) return <>/);
  });

  test("CSS: showcase wrapper, badge positioning, inner pointer-events none", () => {
    expect(CSS).toContain(".pro-showcase { position: relative;");
    expect(CSS).toContain(".pro-showcase-badge");
    expect(CSS).toContain(".pro-showcase-inner { pointer-events: none;");
  });

  test("reuses existing UpgradeGateSheet (no new paywall)", () => {
    // ProShowcase renders the shared UpgradeGateSheet, navigating to upgrade screen
    expect(APP).toMatch(/ProShowcase[\s\S]*?setScreen\(\{ name: "upgrade" \}\)/);
  });
});

describe("Surface 1: Client portal Pro gate", () => {
  test("PortalOwnerPanel wrapped in ProShowcase", () => {
    expect(APP).toMatch(/<ProShowcase[^>]*title=\{[^}]*"Portal del cliente"[^}]*\}[\s\S]*?<PortalOwnerPanel/);
  });

  test("no simpleMode gate remains on portal panel", () => {
    expect(APP).not.toMatch(/simpleMode !== true && <PortalOwnerPanel/);
  });
});

describe("Surface 2: Pipeline Pro gate", () => {
  test("Pipeline button shows PRO badge for free users", () => {
    expect(APP).toMatch(/\{lang === "es" \? "Embudo" : "Pipeline"\} <span className="pro-badge is-locked">PRO<\/span>/);
  });

  test("free tap opens upgrade sheet, premium navigates", () => {
    expect(APP).toContain("setPipelineGate(true)");
    expect(APP).toMatch(/pipelineGate && !isPremium && \(\s*<UpgradeGateSheet/);
  });
});

describe("Surface 3: Field Intelligence Pro gate", () => {
  test("query only enabled for premium", () => {
    expect(APP).toMatch(/queryKey: \["field-intelligence-today"[\s\S]*?enabled: settings !== null && isPremium,/);
  });

  test("free users see showcase teaser", () => {
    expect(APP).toMatch(/<ProShowcase[^>]*title=\{[^}]*"Inteligencia de campo"[^}]*\}/);
  });
});

describe("Surface 4: Expansion Suite Pro gate", () => {
  test("query only enabled for premium", () => {
    expect(APP).toMatch(/queryKey: \["expansion-suite"[\s\S]*?enabled: settings !== null && isPremium,/);
  });

  test("free users see showcase teaser", () => {
    expect(APP).toMatch(/<ProShowcase[^>]*title=\{[^}]*"Expansi.n"[^}]*\}/);
  });
});

describe("Surface 5: Automations Pro gate", () => {
  test("recurring invoice effect only runs for premium", () => {
    expect(APP).toMatch(/if \(!settings \|\| !isPremium\) return;/);
  });

  test("crew compose wrapped in ProShowcase", () => {
    expect(APP).toMatch(/<ProShowcase[^>]*title=\{[^}]*"Automatizaciones"[^}]*\}[\s\S]*?<section className="crew-compose">/);
  });

  test("reengagement items wrapped in ProShowcase", () => {
    expect(APP).toMatch(/<ProShowcase[^>]*title=\{[^}]*"Reactivar clientes"[^}]*\}[\s\S]*?<TapArticle/);
  });
});

describe("Financials NOT gated (scope adjustment)", () => {
  test("profit strip has no ProShowcase wrapper", () => {
    expect(APP).not.toMatch(/<ProShowcase[^>]*>\s*<section className="profit-strip">/);
  });

  test("profit strip renders for everyone with data", () => {
    // Financial consolidation (1fa5200): the strip is now a tappable button
    // that deep-links to the unified Financials tab.
    expect(APP).toMatch(/\{\s*operationsQuery\.data && \(\s*<button[\s\S]*?className="profit-strip profit-strip-link"/);
    expect(APP).toContain('onClick={() => setWsTab("financials")}');
  });
});

describe("Danny's account never locked out", () => {
  test("first account gets premium tier (founder)", () => {
    expect(ACTIONS).toMatch(/tier: firstAccount \? "premium" : "free"/);
    expect(ACTIONS).toMatch(/subscriptionStatus: firstAccount \? "founder" : "inactive"/);
  });

  test("client premium checks use auth tier", () => {
    const matches = APP.match(/const isPremium = auth\?\.user\.tier === "premium"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Layout fixes", () => {
  test("profit strip has proper top margin (not tight)", () => {
    expect(THEME).toMatch(/\.profit-strip\{[^}]*margin:12px 0 14px/);
    expect(THEME).not.toMatch(/\.profit-strip\{[^}]*margin:-4px 0 14px/);
  });

  test("client edit opens as modal BottomSheet, not inline", () => {
    expect(APP).toMatch(/\{\s*editing && \(\s*<BottomSheet[\s\S]*?<EditJobForm/);
    expect(APP).not.toMatch(/\{\s*editing && \(\s*<EditJobForm/);
  });
});
