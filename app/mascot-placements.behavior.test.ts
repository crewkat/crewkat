// Mascot placements beyond the marketing pages (2026-10-25): the iPad cat
// on the Crewkat Office sign-in screen (the Tier-2/Office surface) and the
// shipped-output checks for every mascot placed this round — marketing
// WebPs ride along in client/dist/marketing (build.mjs copies the whole
// folder), the office cat is bundled by the office build. Source pins for
// the marketing pages themselves live in marketing-pages.behavior.test.ts;
// the in-app Premium cat pins live in premium-selling-page.behavior.test.ts.
// Run from app/:  bun test mascot-placements.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OFFICE_APP = readFileSync(join(import.meta.dir, "office/src/App.tsx"), "utf8");
const OFFICE_CSS = readFileSync(join(import.meta.dir, "office/src/office.css"), "utf8");

const OFFICE_DIST_ASSETS = join(import.meta.dir, "office/dist/assets");
const officeDistFiles = existsSync(OFFICE_DIST_ASSETS) ? readdirSync(OFFICE_DIST_ASSETS) : [];
const officeDistJs = officeDistFiles
  .filter((f) => f.endsWith(".js"))
  .map((f) => readFileSync(join(OFFICE_DIST_ASSETS, f), "utf8"))
  .join("\n");

describe("office sign-in mascot", () => {
  test("iPad cat asset is copied into office assets and imported", () => {
    expect(existsSync(join(import.meta.dir, "office/src/assets/mascot-ipad.webp"))).toBe(true);
    expect(OFFICE_APP).toContain('import mascotIpad from "./assets/mascot-ipad.webp";');
  });

  test("the cat renders on the sign-in card under the wordmark, with alt text", () => {
    const login = OFFICE_APP.slice(OFFICE_APP.indexOf("function LoginScreen"));
    const img = /<img src=\{mascotIpad\}[^>]*>/.exec(login)?.[0] ?? "";
    expect(img).toContain('className="login-mascot"');
    expect(img).toContain('alt="Crewkat cat mascot holding a tablet');
    expect(login.indexOf('className="login-wordmark"')).toBeLessThan(login.indexOf('className="login-mascot"'));
    expect(login.indexOf('className="login-mascot"')).toBeLessThan(login.indexOf('className="field"'));
  });

  test("login mascot is sized and click-through in office.css", () => {
    expect(OFFICE_CSS).toContain(".login-mascot");
    const rule = /\.login-mascot \{([^}]*)\}/.exec(OFFICE_CSS)?.[1] ?? "";
    expect(rule).toContain("pointer-events: none");
    expect(rule).toContain("width:");
  });
});

describe("built output ships every placed mascot", () => {
  test("office bundle carries the iPad cat and references it", () => {
    expect(officeDistFiles.some((f) => /^mascot-ipad-.+\.webp$/.test(f))).toBe(true);
    expect(officeDistJs).toContain("mascot-ipad-");
  });

  test("marketing mascots are copied into client dist", () => {
    expect(existsSync(join(import.meta.dir, "client/dist/marketing/mascot-phone.webp"))).toBe(true);
    expect(existsSync(join(import.meta.dir, "client/dist/marketing/mascot-clipboard.webp"))).toBe(true);
    const distHome = readFileSync(join(import.meta.dir, "client/dist/marketing/index.html"), "utf8");
    expect(distHome).toContain('src="/marketing/mascot-phone.webp"');
  });
});
