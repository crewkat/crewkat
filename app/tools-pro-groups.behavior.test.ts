// Danny 2026-10-11: the dead proWorkspace screen's Pro tools move into the
// main Tools page. Tools are organized into collapsible groups (native
// details/summary), free groups on top, Pro groups at the bottom. Every Pro
// tool carries a tiny PRO badge: muted while locked, accent once Premium is
// active. The proWorkspace screen (union member, render branch, component,
// isProToolScreen entry) is deleted.
// Run from app/:  bun tools-pro-groups.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const THEME = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");
const APPCSS = readFileSync(join(import.meta.dir, "client/src/app.css"), "utf8");

describe("Tools page group structure", () => {
  // Tools cleanup (2026-11-03, Danny-approved cut list): 10 groups /
  // 54 rows down to 3 groups — Estimate and Run the day are the free
  // groups; Money & records is the one Pro group (next test).
  test("free groups exist in EN and ES", () => {
    for (const t of ['"Estimate"', '"Run the day"', '"Estimación"', '"El día a día"']) {
      expect(APP).toContain(t);
    }
  });

  // Fix 7 refinement (2026-10-12): the "Pro — " prefix is gone from the
  // group titles; the standard PRO badge next to the title marks them.
  test("the one Pro group exists in EN and ES, at the bottom", () => {
    expect(APP).toContain('"Money & records"');
    expect(APP).toContain('"Dinero y registros"');
    expect(APP).not.toContain("Pro — Money & records");
    // The Pro group is declared after both free groups in the array.
    const lastFree = Math.max(
      APP.indexOf('? "Estimación" : "Estimate"'),
      APP.indexOf('? "El día a día" : "Run the day"'),
    );
    const firstPro = APP.indexOf('? "Dinero y registros" : "Money & records"');
    expect(firstPro).toBeGreaterThan(lastFree);
  });

  test("Pro group titles carry the standard PRO badge", () => {
    expect(APP).toMatch(/group\.pro && <span className=\{`pro-badge/);
  });

  test("every group has its own icon (Fix 7)", () => {
    expect(APP).toContain("tool-group-icon");
    expect(APP).toContain("icon: <Icon size={19}>");
  });

  test("groups render as collapsible details/summary dropdowns", () => {
    expect(APP).toContain("<details key={group.title}");
    expect(APP).toContain('<summary className="tool-group-heading">');
    expect(APP).toContain("tool-group-chevron");
  });

  test("Pro groups get the distinct pro-tool-group styling", () => {
    expect(APP).toContain('pro-tool-group');
    expect(THEME).toContain(".pro-tool-group");
  });

  test("Admin console entry lives in Settings (Tools tile cut)", () => {
    // Tools cleanup (2026-11-03): the Admin controls tile is cut; the
    // console opens from the Settings "Manage crew & team" accordion.
    expect(APP).toContain("admin-launch");
    expect(APP).toContain("Open admin panel");
    expect(APP).toContain('setScreen({ name: "admin" })');
    // Money & records carries the follow-ups + warranties doors.
    expect(APP).toContain('"expansion:warranties", "reports", "followups"');
  });
});

describe("PRO badge behavior", () => {
  test("every Pro tool row renders a PRO badge", () => {
    expect(APP).toContain("pro-badge");
    // Badge rendered for pro tiles inside row().
    expect(APP).toMatch(/isPro && <span className=\{`pro-badge/);
  });

  test("badge state differs free vs premium", () => {
    // Muted while locked, plain (accent) once Premium is active.
    expect(APP).toContain('pro-badge${isPremium ? "" : " is-locked"}');
    expect(APPCSS).toContain(".pro-badge.is-locked");
  });

  test("base badge uses the accent color", () => {
    expect(APPCSS).toMatch(/\.pro-badge\s*\{[^}]*background:\s*var\(--accent\)/);
  });
});

describe("Tools group header restyle (2026-10-12, Danny's inspiration shot)", () => {
  test("exactly one PRO badge renders per Pro group (PROPRO regression)", () => {
    expect(APP.match(/group\.pro &&/g)?.length).toBe(1);
    expect(APP).toContain("pro-group-badge");
  });

  test("group icons sit in soft tinted chips, not solid circles", () => {
    expect(THEME).toMatch(/\.tool-group-icon \{[^}]*background:\s*color-mix\(in srgb, var\(--accent\)/);
    expect(THEME).toMatch(/\.tool-group-icon \{[^}]*color:\s*var\(--accent\)/);
  });

  test("count is a soft tinted pill, chevron outside it", () => {
    expect(THEME).toMatch(/\.tool-group-count \{[^}]*border-radius:\s*999px/);
    expect(THEME).toMatch(/\.tool-group-count \{[^}]*background:\s*color-mix/);
    expect(THEME).not.toContain(".tool-group-heading > .tool-group-pill");
  });

  test("group PRO badge is a soft pill: tinted premium, gray locked", () => {
    expect(THEME).toMatch(/\.tool-group-heading \.pro-badge \{[^}]*border-radius:\s*999px/);
    expect(THEME).toContain(".tool-group-heading .pro-badge.is-locked");
  });

  test("groups are floating cards with shadow, no hairline separator", () => {
    expect(THEME).toMatch(/\.tool-group \{[^}]*border-radius:\s*16px/);
    expect(THEME).toMatch(/\.tool-group \{[^}]*box-shadow:/);
    expect(THEME).not.toMatch(/\.tool-group \{[^}]*border-bottom:/);
  });
});

describe("proWorkspace screen is gone", () => {
  test("no references remain in client source", () => {
    expect(APP).not.toContain("proWorkspace");
    expect(APP).not.toContain("ProWorkspaceScreen");
    expect(APP).not.toContain("TOOLBOX_BLURBS");
  });

  test("isProToolScreen no longer lists it but keeps the pro screens", () => {
    expect(APP).toContain("function isProToolScreen");
    for (const s of ['"businessTools"', '"admin"', '"expansion"', '"fieldIntelligence"', '"reports"', '"followups"']) {
      expect(APP).toContain(s);
    }
  });
});

describe("premium gating untouched", () => {
  test("locked Pro tools still open the upgrade prompt", () => {
    expect(APP).toContain("setLockedTool(tile)");
    expect(APP).toContain("<UpgradeGateSheet");
  });

  test("openTool still gates on isPremium", () => {
    expect(APP).toMatch(/if\s*\(!isPremium && \(tile\.pro \|\| isProToolScreen\(tile\.screen\)\)\)/);
  });
});

// Danny 2026-10-12 (evening): with all 10 compact groups on one screen, the
// fixed quick-create FAB sat on top of the last group (Clients & admin),
// covering its count pill and chevron. The FAB's top edge is at
// bottom 96px + 56px diameter = 152px (+ safe-area); both FAB pages
// (Home .today-page, Tools .more-page) must carry bottom padding past it.
describe("FAB-safe scroll clearance (Home + Tools)", () => {
  test("FAB stays on Home and Tools only", () => {
    expect(APP).toContain('SCREENS_WITH_QUICK_CREATE_FAB: ReadonlySet<Screen["name"]> = new Set(["today", "tools"])');
  });

  test("both FAB pages clear the FAB's top edge with bottom padding", () => {
    expect(THEME).toMatch(/\.app-shell\.has-bottom-nav \.page\.today-page,\s*\.app-shell\.has-bottom-nav \.page\.more-page \{\s*padding-bottom: calc\(168px \+ env\(safe-area-inset-bottom\)\);/);
  });
});
