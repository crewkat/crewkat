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

  test("Pro groups exist in EN and ES, at the bottom", () => {
    for (const t of ["Pro — Money & office", "Pro — Field & crew", "Pro — Clients & admin"]) {
      expect(APP).toContain(t);
    }
    for (const t of ["Pro — Dinero y oficina", "Pro — Campo y equipo", "Pro — Clientes y administración"]) {
      expect(APP).toContain(t);
    }
    // Pro groups are declared after every free group in the groups array.
    const lastFree = Math.max(
      APP.indexOf('"Just for fun"'),
      APP.indexOf('"Cuenta y ajustes"'),
    );
    const firstPro = APP.indexOf('"Pro — Money & office"');
    expect(firstPro).toBeGreaterThan(lastFree);
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
