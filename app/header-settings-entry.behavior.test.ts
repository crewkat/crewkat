// Header Settings entry guards (Danny 2026-10-15).
//
// Danny: the main-tab header showed a gear icon AND the user's avatar
// side by side, and both opened Settings. The gear is removed from the
// shared MainTabHeaderActions; the avatar is the single Settings entry
// point. Screens that had the gear but no avatar (Jobs, Clients,
// Invoices hub, Marketplace) render the shared SettingsAvatarButton so
// no main tab loses its Settings path. The Tools grid button is a
// different function and stays.
//
// Run from app/:  bun test header-settings-entry.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");

function slice(from: string, to: string): string {
  const a = APP.indexOf(from);
  const b = APP.indexOf(to, a + from.length);
  return APP.slice(a, b === -1 ? undefined : b);
}

describe("shared main-tab header actions", () => {
  test("MainTabHeaderActions renders the Tools grid only — no gear, no Settings nav", () => {
    const seg = slice("function MainTabHeaderActions", "function SettingsAvatarButton");
    expect(seg.length).toBeGreaterThan(0);
    expect(seg).not.toContain("GearIcon");
    expect(seg).not.toContain('name: "settings"');
    expect(seg).toContain('name: "tools"');
  });

  test("all six MainTabHeaderActions call sites survive (both Home variants + main tabs)", () => {
    const uses = APP.match(/<MainTabHeaderActions lang=\{lang\} setScreen=\{setScreen\} \/>/g) ?? [];
    expect(uses.length).toBe(6);
  });
});

describe("avatar is the single Settings entry point", () => {
  test("shared SettingsAvatarButton renders the home-avatar and opens Settings", () => {
    const seg = slice("function SettingsAvatarButton", "// Build 1.2 (part A): floating document forms");
    expect(seg).toContain('className="home-avatar"');
    expect(seg).toContain('setScreen({ name: "settings" })');
    expect(seg).toContain('aria-label={lang === "es" ? "Abrir configuración" : "Open settings"}');
    // Same initial derivation as Home's inline avatar.
    expect(seg).toContain('auth?.user.name.trim().charAt(0)');
  });

  test("avatar button is rendered at the four headers that had the gear but no avatar", () => {
    const uses = APP.match(/<SettingsAvatarButton lang=\{lang\} setScreen=\{setScreen\} \/>/g) ?? [];
    expect(uses.length).toBe(4);
  });

  test("Home keeps its own inline avatar buttons (loading + loaded headers)", () => {
    // Home's two inline copies + the shared component's identical button.
    const inline = APP.match(/<button className="home-avatar" type="button" onClick=\{\(\) => setScreen\(\{ name: "settings" \}\)\}/g) ?? [];
    expect(inline.length).toBe(3);
  });
});
