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
  test("free groups exist in EN and ES", () => {
    for (const t of ["Estimating toolbox", "Money", "Clients & leads", "Jobs & crew", "Marketing", "Account & settings", "Just for fun"]) {
      expect(APP).toContain(t);
    }
    for (const t of ["Herramientas de estimación", "Dinero", "Clientes y prospectos", "Trabajos y equipo", "Cuenta y ajustes", "Solo por diversión"]) {
      expect(APP).toContain(t);
    }
  });

  // Fix 7 refinement (2026-10-12): the "Pro — " prefix is gone from the
  // group titles; the standard PRO badge next to the title marks them.
  test("Pro groups exist in EN and ES, at the bottom", () => {
    for (const t of ["Money & office", "Field & crew", "Clients & admin"]) {
      expect(APP).toContain(t);
    }
    for (const t of ["Dinero y oficina", "Campo y equipo", "Clientes y administración"]) {
      expect(APP).toContain(t);
    }
    expect(APP).not.toContain("Pro — Money & office");
    expect(APP).not.toContain("Pro — Clients & admin");
    // Pro groups are declared after every free group in the groups array.
    const lastFree = Math.max(
      APP.indexOf('"Just for fun"'),
      APP.indexOf('"Cuenta y ajustes"'),
    );
    const firstPro = APP.indexOf('"Money & office"');
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

  test("Admin controls tile (previously in no group) is now grouped", () => {
    expect(APP).toContain('"followups", "admin", "expansion:warranties"');
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
