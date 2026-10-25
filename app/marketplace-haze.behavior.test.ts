// Marketplace haze occlusion (Danny's production screenshots,
// 2026-10-24): the app-wide animated haze showed on Marketplace only
// as a thin sliver at the very bottom at full scroll. Mechanism: the
// shell's haze layers are fixed ::before/::after on .app-shell
// (z-index -1, above the shell's own background, below content), so a
// page exposes them only by NOT painting an opaque background — the
// way Home/Jobs do with the plain .page rule. Build 3.0 item 5 had
// painted every marketplace page surface pure white in light theme,
// burying the haze under the whole page; the sliver was the shell
// background showing past the page box's bottom edge. Fix: those
// page-background rules are gone; listing cards keep their own opaque
// --surface backgrounds, and the navy header band rules are untouched.
// Run from app/:  bun test marketplace-haze.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

const DIST_ASSETS = join(import.meta.dir, "client/dist/assets");
const distCss = existsSync(DIST_ASSETS)
  ? readdirSync(DIST_ASSETS)
      .filter((f) => f.endsWith(".css"))
      .map((f) => readFileSync(join(DIST_ASSETS, f), "utf8"))
      .join("\n")
  : "";

// A rule whose LAST selector is one of the marketplace page classes and
// whose block paints a background — the occlusion pattern itself.
const PAGE_BG_RULE = /\.page\.marketplace-(?:page|thread|detail|form-page)\s*\{[^}]*background\s*:/;

describe("shell haze (the shared treatment)", () => {
  test("haze layers live on the app shell, behind content", () => {
    expect(CSS).toContain(".app-shell { isolation: isolate; }");
    expect(CSS).toContain(".app-shell.has-bottom-nav::before, .app-shell.master-nav-hidden::before");
    expect(CSS).toContain(".app-shell.has-bottom-nav::after, .app-shell.master-nav-hidden::after");
    expect(CSS).toContain("animation: haze-drift-a 16s linear infinite;");
    expect(CSS).toContain("animation: haze-drift-b 22s linear infinite;");
  });

  test("the base page rule paints no background (how Home/Jobs expose the haze)", () => {
    expect(CSS).toContain(".page { width: min(100%, 920px); min-height: 100%; margin: 0 auto; padding: 0 16px 36px; }");
  });
});

describe("marketplace no longer paints over the haze", () => {
  test("no rule gives a marketplace page surface an opaque background", () => {
    expect(CSS).not.toMatch(PAGE_BG_RULE);
    // the exact build-3.0 white blocks are gone, both theme paths
    expect(CSS).not.toContain(".page.marketplace-form-page { background:#ffffff; }");
    expect(CSS).not.toContain(":root:not([data-theme]) .page.marketplace-page, :root:not([data-theme]) .page.marketplace-thread");
  });

  test("the shipped bundle matches: no marketplace page background, haze present", () => {
    expect(distCss).not.toMatch(PAGE_BG_RULE);
    expect(distCss).toContain("haze-drift-a");
  });
});

describe("what must not change", () => {
  test("listing cards stay fully opaque", () => {
    expect(CSS).toMatch(/\.market-card\s*\{[^}]*background:\s*var\(--surface\)/);
    expect(distCss).toMatch(/\.market-card\s*\{[^}]*background:\s*var\(--surface\)/);
  });

  test("the navy marketplace header band is unchanged", () => {
    expect(CSS).toContain(":root[data-theme=\"light\"] .page.marketplace-form-page .app-header { background:linear-gradient(180deg, var(--navy-900), var(--navy-700)); }");
  });
});
