// Appearance-sync behavior tests (installed-app theme mismatch fix).
//
// Covers:
//  1. Migration 0055 — settings gains theme_mode + ui_accent, backfilled to
//     the product defaults (system / orange) on existing rows.
//  2. updateAppearance — saves theme + accent; creates the settings row when
//     missing; request schema rejects out-of-enum values.
//  3. getSettings — returns the synced appearance fields.
//  4. updateSettings — still accepts the new fields (full-form save round trip).
//  5. Client static guards — server-wins sync logic, immediate-save wiring,
//     pre-React theme script, proactive SW update checks, build-id display,
//     light-theme CSS variables, cross-device note copy.
//  6. Intent-race fix — the user's own optimistic change is never reverted
//     while its save is in flight (onMutate records the intent; the effect
//     yields until the server confirms); orange/red accents are visually
//     distinct.
//
// Run from app/:  bun appearance-sync.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const appSrc = await readFile("client/src/App.tsx", "utf8");
const pushSrc = await readFile("client/src/push.ts", "utf8");
const indexHtml = await readFile("client/index.html", "utf8");
const buildMjs = await readFile("client/build.mjs", "utf8");
const cssSrc = await readFile("client/src/theme.css", "utf8");
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));

// --- 1. Scratch DB + migrations ------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-appearance-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  slug: "tradesign",
  invocationId: "appearance-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => { throw new Error("not stubbed"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;

// Journal: 0055 entry present with a `when` strictly newer than 0054's.
const entries = journal.entries as Array<{ idx: number; when: number; tag: string }>;
const e54 = entries.find((e) => e.tag === "0055_add_appearance_settings");
const e53 = entries.find((e) => e.tag === "0054_phase3_dispatch");
check("journal has 0055_add_appearance_settings", !!e54);
check("0055 when is strictly newer than 0054 (drizzle skips older)", !!e54 && !!e53 && e54.when > e53.when);

// Columns exist after migrate.
const cols = await sqlite.execute("PRAGMA table_info(settings)");
const colNames = (cols.rows as Array<{ name: string }>).map((r) => r.name);
check("settings has theme_mode column", colNames.includes("theme_mode"));
check("settings has ui_accent column", colNames.includes("ui_accent"));

await db.insert(schema.authUsers).values({
  companyId: 1, name: "Owner", email: "owner@example.com",
  passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH",
});

// Backfill: inserting without appearance fields gets the product defaults.
await db.insert(schema.settings).values({ companyId: 1, companyName: "Stallions Test Co" });
let row = (await db.select().from(schema.settings).where(eq(schema.settings.companyId, 1)).limit(1))[0]!;
check("theme_mode backfills to 'system'", (row as any).themeMode === "system", `got ${(row as any).themeMode}`);
check("ui_accent backfills to 'orange'", (row as any).uiAccent === "orange", `got ${(row as any).uiAccent}`);

// --- 2. updateAppearance --------------------------------------------------------
const updateAppearance = BaseActions.updateAppearance as any;

// Schema rejects out-of-enum values.
check("request schema rejects bad themeMode", !updateAppearance.request.safeParse({ themeMode: "neon", uiAccent: "orange" }).success);
check("request schema rejects bad uiAccent", !updateAppearance.request.safeParse({ themeMode: "light", uiAccent: "teal" }).success);
check("request schema accepts light/red", updateAppearance.request.safeParse({ themeMode: "light", uiAccent: "red" }).success);

const saveRes = await updateAppearance.handler(ctx, { themeMode: "light", uiAccent: "red" });
check("updateAppearance returns ok", saveRes?.ok === true);
row = (await db.select().from(schema.settings).where(eq(schema.settings.companyId, 1)).limit(1))[0]!;
check("updateAppearance persists themeMode", (row as any).themeMode === "light");
check("updateAppearance persists uiAccent", (row as any).uiAccent === "red");

// Second save overwrites (last write wins across devices).
await updateAppearance.handler(ctx, { themeMode: "dark", uiAccent: "blue" });
row = (await db.select().from(schema.settings).where(eq(schema.settings.companyId, 1)).limit(1))[0]!;
check("updateAppearance overwrite works", (row as any).themeMode === "dark" && (row as any).uiAccent === "blue");

// Creates the row when none exists.
await db.delete(schema.settings).where(eq(schema.settings.companyId, 1));
await updateAppearance.handler(ctx, { themeMode: "system", uiAccent: "green" });
row = (await db.select().from(schema.settings).where(eq(schema.settings.companyId, 1)).limit(1))[0]!;
check("updateAppearance creates missing settings row", !!row && (row as any).themeMode === "system" && (row as any).uiAccent === "green");

// --- 3. getSettings returns the synced appearance --------------------------------
const got = await (BaseActions.getSettings as any).handler(ctx, {});
check("getSettings returns themeMode", got?.themeMode === "system", `got ${got?.themeMode}`);
check("getSettings returns uiAccent", got?.uiAccent === "green", `got ${got?.uiAccent}`);

// --- 4. updateSettings round trip still accepts the new fields -------------------
const settingsInput = (BaseActions.updateSettings as any).request.safeParse({ ...got, themeMode: "light", uiAccent: "purple" });
check("updateSettings schema accepts themeMode/uiAccent", settingsInput.success, settingsInput.success ? "" : JSON.stringify(settingsInput.error.issues).slice(0, 200));
if (settingsInput.success) {
  await (BaseActions.updateSettings as any).handler(ctx, settingsInput.data);
  const after = await (BaseActions.getSettings as any).handler(ctx, {});
  check("updateSettings round trip keeps appearance", after?.themeMode === "light" && after?.uiAccent === "purple");
}

// --- 5. Client static guards ------------------------------------------------------
check("client tracks the user's own appearance intent", appSrc.includes("appearanceIntentRef"));
check("intent is recorded before the save (onMutate)", appSrc.includes("appearanceIntentRef.current = { themeMode: v.themeMode, uiAccent: v.uiAccent }"));
check("server-wins effect yields while own save is in flight", appSrc.includes("our save is still in flight") && appSrc.includes("leave the user's choice alone"));
check("appearance save refetches settings on success", (appSrc.match(/client\.invalidateQueries\(\{ queryKey: \["settings"\] \}\)/g) ?? []).length >= 2);
check("client adopts server appearance when it differs (server wins)", appSrc.includes("serverTheme !== themeMode") && appSrc.includes("setThemeMode(serverTheme)"));
check("theme change saves to server immediately", appSrc.includes("saveAppearance.mutate({ themeMode: mode, uiAccent: accent })"));
check("accent change saves to server immediately", appSrc.includes("saveAppearance.mutate({ themeMode, uiAccent: value })"));
check("Settings picker wired to syncing handlers", appSrc.includes("onThemeChange={handleThemeChange}") && appSrc.includes("onAccentChange={handleAccentChange}"));
check("appearance calls api.updateAppearance", appSrc.includes("api.updateAppearance"));
check("note copy promises cross-device sync", appSrc.includes("sync across all your devices"));

check("index.html applies saved theme before React boots", indexHtml.includes("crewkat-theme") && indexHtml.includes('setAttribute("data-theme"'));
check("index.html applies saved accent before React boots", indexHtml.includes("crewkat-accent") && indexHtml.includes('setAttribute("data-accent"'));

check("push.ts exports proactive SW update checks", pushSrc.includes("export function startProactiveSwUpdateChecks"));
check("proactive check asks the worker for updates", pushSrc.includes("visibilitychange") && pushSrc.includes("reg?.update()"));
check("app starts proactive SW checks", appSrc.includes("startProactiveSwUpdateChecks()"));

check("build.mjs stamps build id into the app", buildMjs.includes("__CREWKAT_BUILD_ID__"));
check("Settings About shows the build id", appSrc.includes("appBuildId()") && appSrc.includes("Build"));
check("Settings About flags a waiting update", appSrc.includes("Update ready") && appSrc.includes("updateAvailable={swUpdateAvailable}"));

check("light theme sets light background", cssSrc.includes('[data-theme="light"]') && cssSrc.includes("--bg: #f4f2ed"));
check("orange accent is a true orange", cssSrc.includes("--accent: #f97316"));
check("red accent is distinct from orange", cssSrc.includes('--accent: #dc2626'));
check("accent swatches match the theme colors", appSrc.includes('{ value: "orange", color: "#f97316"') && appSrc.includes('{ value: "red", color: "#dc2626"'));

// --- summary ----------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nappearance-sync: all checks passed");
