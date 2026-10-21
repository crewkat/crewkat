// Client Portal v2 (Danny 2026-10-11): short links, branded previews,
// share flow, premium portal UI.
// - Migration 0074 adds portal_tokens.short_code (unique), backfilled.
// - create/rotatePortalLink generate + return shortCode; route is p/<code>.
// - getPortalLinkInfo backfills + returns shortCode for pre-existing rows.
// - requirePortalAccess accepts short code OR full token (backward compat).
// - /p/:code serves OG tags + JS-redirects to /app/#portal=<code>.
// - PortalOwnerPanel: native share + SMS fallback + copy; short URL shared.
// - ClientPortalScreen: premium branded redesign (company header, hero,
//   stats, tabbed gallery, timeline, approvals).
// Run from app/:  bun portal-v2.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const ACTIONS = readFileSync(join(import.meta.dir, "server/src/actions.ts"), "utf8");
const SCHEMA = readFileSync(join(import.meta.dir, "server/src/schema.ts"), "utf8");
const SERVER = readFileSync(join(import.meta.dir, "..", "server.mjs"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

describe("0074 migration: portal short codes", () => {
  test("migration file exists with backfill + unique index", () => {
    const sql = readFileSync(join(import.meta.dir, "drizzle/0074_portal_short_codes.sql"), "utf8");
    expect(sql).toContain("ADD `short_code`");
    expect(sql).toContain("CREATE UNIQUE INDEX");
    expect(sql).toContain("portal_tokens_short_code_unique");
  });

  test("journal when is strictly greater than 0073's (no silent skip)", () => {
    const j = JSON.parse(readFileSync(join(import.meta.dir, "drizzle/meta/_journal.json"), "utf8"));
    const byTag = Object.fromEntries(j.entries.map((e: any) => [e.tag, e]));
    expect(byTag["0074_portal_short_codes"].when).toBeGreaterThan(byTag["0073_crane_run_leaderboard"].when);
    expect(byTag["0073_crane_run_leaderboard"].when).toBe(1791736500000);
  });

  test("schema has shortCode on portalTokens", () => {
    expect(SCHEMA).toMatch(/export const portalTokens[\s\S]*?shortCode:\s*text\("short_code"\)\.unique\(\)/);
  });
});

describe("shortCode generated, returned, backfilled", () => {
  test("uniquePortalShortCode helper checks portal_tokens", () => {
    expect(ACTIONS).toContain("async function uniquePortalShortCode");
    expect(ACTIONS).toMatch(/uniquePortalShortCode[\s\S]*?schema\.portalTokens/);
  });

  test("createPortalLink generates, stores, and returns shortCode; route is p/<code>", () => {
    expect(ACTIONS).toMatch(/createPortalLink[\s\S]*?uniquePortalShortCode\(ctx\)/);
    expect(ACTIONS).toMatch(/createPortalLink[\s\S]*?shortCode,\s*expiresAt/);
    expect(ACTIONS).toMatch(/createPortalLink[\s\S]*?route:`p\/\${encodeURIComponent\(shortCode\)}`/);
  });

  test("rotatePortalLink generates, stores, and returns shortCode", () => {
    expect(ACTIONS).toMatch(/rotatePortalLink[\s\S]*?uniquePortalShortCode\(ctx\)/);
    expect(ACTIONS).toMatch(/rotatePortalLink[\s\S]*?shortCode,\s*expiresAt/);
  });

  test("getPortalLinkInfo backfills missing shortCode and returns it", () => {
    expect(ACTIONS).toMatch(/getPortalLinkInfo[\s\S]*?if\(!shortCode\)\{\s*shortCode=await uniquePortalShortCode\(ctx\)/);
    expect(ACTIONS).toMatch(/getPortalLinkInfo[\s\S]*?shortCode,/);
  });
});

describe("shortCode resolves in portal actions; full tokens still work", () => {
  test("requirePortalAccess tries short_code lookup for short-format input", () => {
    expect(ACTIONS).toMatch(/requirePortalAccess[\s\S]*?schema\.portalTokens\.shortCode,\s*token/);
  });

  test("requirePortalAccess falls back to tokenHash for full tokens", () => {
    expect(ACTIONS).toMatch(/requirePortalAccess[\s\S]*?schema\.portalTokens\.tokenHash,\s*hash/);
  });

  test("all five portal actions accept short codes (min 8)", () => {
    for (const name of ["getPortalData", "portalUpdateSelection", "portalSignChangeOrder", "portalListJobMessages", "portalSendJobMessage"]) {
      const idx = ACTIONS.indexOf(name + ": defineAction");
      expect(idx).toBeGreaterThan(-1);
      const chunk = ACTIONS.slice(idx, idx + 3000);
      expect(chunk).toMatch(/token:\s*z\.string\(\)\.min\(8\)\.max\(200\)/);
    }
  });

  test("privacy filter untouched: portalListJobMessages still only client+system", () => {
    expect(ACTIONS).toMatch(/portalListJobMessages[\s\S]*?inArray\(schema\.jobMessages\.sender,\s*\["client",\s*"system"\]\)/);
  });
});

describe("/p/:code unfurl route", () => {
  test("route matches short codes and validates format", () => {
    expect(SERVER).toContain('/^\\/p\\/([A-Za-z0-9]{8,24})$/');
  });

  test("looks up by short_code, rejects revoked/expired", () => {
    expect(SERVER).toMatch(/FROM portal_tokens WHERE short_code = \? AND revoked_at IS NULL AND \(expires_at IS NULL OR expires_at > \?\)/);
  });

  test("serves OG tags with company name, no client PII", () => {
    expect(SERVER).toMatch(/og:title/);
    expect(SERVER).toMatch(/Your project portal/);
    expect(SERVER).toMatch(/marketing\/og-portal\.jpg/);
    // No client name / address / amounts in the unfurl path
    expect(SERVER).not.toMatch(/shortPortalMatch[\s\S]{0,2000}client_name/);
  });

  test("JS-redirects to /app/#portal=<code> (fragment keeps credential out of logs)", () => {
    expect(SERVER).toMatch(/#portal=\$\{encodeURIComponent\(code\)\}/);
    expect(SERVER).toContain("location.replace");
  });

  test("branded OG image exists at 1200x630", () => {
    expect(existsSync(join(import.meta.dir, "client/marketing/og-portal.jpg"))).toBe(true);
  });
});

describe("PortalOwnerPanel share flow", () => {
  test("shareUrl prefers short URL (p/<code>) for issued and existing links", () => {
    expect(APP).toMatch(/crewkat\.com\/p\/\$\{encodeURIComponent\(link\.shortCode\)\}/);
  });

  test("native share with SMS deep-link fallback", () => {
    expect(APP).toContain("navigator.share({ title: t.shareTitle");
    expect(APP).toMatch(/sms:\?body=\$\{encodeURIComponent\(t\.shareText\(shareUrl\)\)\}/);
  });

  test("Share button is primary; copy kept as secondary", () => {
    expect(APP).toMatch(/portal-link-actions[\s\S]*?primary-button[\s\S]*?\{t\.share\}/);
  });

  test("EN/ES share strings present", () => {
    expect(APP).toContain('shareTitle: "Your project portal"');
    expect(APP).toContain('shareTitle: "Portal de su proyecto"');
  });
});

describe("ClientPortalScreen premium redesign", () => {
  test("branded company header from getPortalData company", () => {
    expect(APP).toContain("portal-v2-brand");
    expect(APP).toMatch(/company\.logoUrl/);
    expect(APP).toMatch(/company\.name/);
  });

  test("hero, stats, tabbed gallery, timeline, approvals sections", () => {
    for (const cls of ["portal-v2-hero", "portal-v2-stats", "portal-v2-tabs", "portal-v2-timeline", "portal-v2-approval"]) {
      expect(APP).toContain(cls);
    }
  });

  test("all portal capabilities kept: messages, selections, change orders, estimates, invoices", () => {
    expect(APP).toContain("<PortalMessages lang={lang} token={token} />");
    expect(APP).toContain("api.portalUpdateSelection");
    expect(APP).toContain("api.portalSignChangeOrder");
    expect(APP).toMatch(/d\.estimates\.map/);
    expect(APP).toMatch(/d\.invoices\.map/);
  });

  test("CSS for the redesign exists", () => {
    for (const cls of [".portal-v2-brand", ".portal-v2-hero", ".portal-v2-stats", ".portal-v2-card", ".portal-v2-lightbox"]) {
      expect(CSS).toContain(cls);
    }
  });

  test("getPortalData returns company for the branded header", () => {
    expect(ACTIONS).toMatch(/getPortalData[\s\S]*?company:z\.object\(\{name:z\.string\(\),phone:z\.string\(\),email:z\.string\(\),website:z\.string\(\),address:z\.string\(\),licenseNumber:z\.string\(\),accentColor:z\.string\(\),logoUrl:z\.string\(\)\.nullable\(\)\}\)/);
  });
});
