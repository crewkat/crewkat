// Admin panel Phase 2 — Settings workstream behavior tests.
//
// Covers:
//  1. Migration 0072 tables/columns exist (admin_totp_secrets,
//     platform_policy_versions, auth_sessions.totp_pending).
//  2. The settings actions exist on BaseActions; the four public ones accept
//     a body without _sessionToken (PUBLIC_ACTIONS wiring).
//  3. Maintenance set/get round-trip; signUp refuses while enabled.
//  4. Branding: color validation rejects bad hex; logo upload round-trip with
//     old-blob replacement; public getPlatformBranding.
//  5. Policy versions: publish/list + public latest lookup.
//  6. TOTP: RFC 6238 test vector, setup/verify round-trip, wrong code
//     rejected, disable, require-toggle, non-team blocked.
//  7. Login returns totpRequired for an enrolled team member when required;
//     verifyTotpLogin completes the login and burns the pending proof.
//
// Run from app/:  bun admin-phase2-settings.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { Actions, BaseActions } from "./server/src/actions.ts";
import {
  platformAdminPhase2SettingsActions,
  totpCode,
  verifyTotpCode,
} from "./server/src/platform-admin-phase2-settings.ts";
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
async function throwsAsync(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (e) {
    check(name, !match || match.test(String((e as Error).message ?? e)), String((e as Error).message ?? e).slice(0, 120));
  }
}

// --- 1. Scratch DB + migrate -------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-pa2-settings-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const tables = (await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`)).map((r) => r.name);
check("admin_totp_secrets table exists", tables.includes("admin_totp_secrets"));
check("platform_policy_versions table exists", tables.includes("platform_policy_versions"));
const sessionCols = (await db.all<{ name: string }>(`PRAGMA table_info("auth_sessions")`)).map((r) => r.name);
check("auth_sessions.totp_pending column exists", sessionCols.includes("totp_pending"));

// --- 2. Users ----------------------------------------------------------------
const now = new Date();
async function mkUser(name: string, email: string, opts: { isAdmin?: boolean; password?: string; verified?: boolean } = {}) {
  let passwordHash = "x";
  let passwordSalt = "y";
  let passwordIterations = 0;
  if (opts.password) {
    passwordSalt = "aabbccddeeff00112233445566778899";
    passwordIterations = 210_000;
    const salt = Uint8Array.from(passwordSalt.match(/.{1,2}/g) ?? [], (v) => Number.parseInt(v, 16));
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(opts.password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: passwordIterations }, material, 256);
    passwordHash = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const rows = await db.insert(schema.authUsers).values({
    name, email, passwordHash, passwordSalt, passwordIterations,
    isPlatformAdmin: opts.isAdmin ?? false,
    emailVerifiedAt: opts.verified === false ? null : now,
    createdAt: now,
  }).returning({ id: schema.authUsers.id, companyId: schema.authUsers.companyId });
  return rows[0]!;
}
const adminRow = await mkUser("Danny", "admin@test.com", { isAdmin: true, password: "password1234" });
const supportRow = await mkUser("Support One", "support1@test.com", { password: "password1234" });
const userRow = await mkUser("Regular User", "user@test.com", { password: "password1234" });
await db.insert(schema.adminTeamRoles).values({ userId: supportRow.id, role: "support", grantedBy: adminRow.id, createdAt: now, updatedAt: now });

// In-memory blob stub for the logo upload tests.
const blobStore = new Map<string, { data: Uint8Array; contentType: string }>();
const ctxFor = (user: { id: number; companyId: number }) => ({
  db: () => db,
  unscopedDb: () => db,
  workspaceCompanyId: user.companyId,
  workspaceUserId: user.id,
  invalidateQueries: () => {},
  blobs: {
    put: async (key: string, data: Uint8Array, opts: { contentType: string }) => { blobStore.set(key, { data, contentType: opts.contentType }); },
    getUrl: async (key: string) => { if (!blobStore.has(key)) throw new Error("missing blob"); return `blob://${key}`; },
    delete: async (key: string) => { blobStore.delete(key); },
  },
}) as any;

const actions = BaseActions as any;
const myActions = platformAdminPhase2SettingsActions as any;
for (const name of [
  "getMaintenanceStatus", "adminMaintenanceSet",
  "getPlatformBranding", "adminBrandLogoUpload", "adminBrandingColorSet",
  "adminPolicyVersionPublish", "adminPolicyVersionsList", "getPolicyVersion",
  "adminTotpSetupStart", "adminTotpSetupVerify", "adminTotpDisable", "adminTotpStatus",
  "adminTotpRequiredSet", "verifyTotpLogin",
]) {
  check(`action exists: ${name}`, typeof actions[name]?.handler === "function");
}

// Public actions accept a body without _sessionToken (PUBLIC_ACTIONS wiring).
for (const name of ["getMaintenanceStatus", "getPlatformBranding", "getPolicyVersion", "verifyTotpLogin"]) {
  let parses = true;
  try { (Actions as any)[name].request.parse(name === "getPolicyVersion" ? { kind: "terms" } : name === "verifyTotpLogin" ? { code: "123456", _sessionToken: "x".repeat(64) } : {}); } catch { parses = false; }
  check(`public action parses without envelope: ${name}`, parses);
}
let adminSetNeedsEnvelope = false;
try { (Actions as any).adminMaintenanceSet.request.parse({ enabled: true }); } catch { adminSetNeedsEnvelope = true; }
check("adminMaintenanceSet requires the auth envelope", adminSetNeedsEnvelope);

// --- 3. Maintenance -----------------------------------------------------------
const status0 = await actions.getMaintenanceStatus.handler(ctxFor(userRow), {});
check("maintenance defaults to off", status0.enabled === false && status0.message === "");
await throwsAsync("non-admin blocked from adminMaintenanceSet", () => actions.adminMaintenanceSet.handler(ctxFor(userRow), { enabled: true, message: "" }));
const setOn = await actions.adminMaintenanceSet.handler(ctxFor(adminRow), { enabled: true, message: "Upgrading the platform." });
check("adminMaintenanceSet returns ok", setOn.ok === true && setOn.enabled === true);
const status1 = await actions.getMaintenanceStatus.handler(ctxFor(userRow), {});
check("getMaintenanceStatus reflects on", status1.enabled === true && status1.message === "Upgrading the platform.");
await throwsAsync("signUp refused during maintenance", () => actions.signUp.handler(ctxFor(userRow), { name: "New", email: "new@test.com", password: "password1234", marketplaceTermsAccepted: true }), /maintenance/i);
await actions.adminMaintenanceSet.handler(ctxFor(adminRow), { enabled: false, message: "" });
const status2 = await actions.getMaintenanceStatus.handler(ctxFor(userRow), {});
check("maintenance can be turned off", status2.enabled === false);

// --- 4. Branding --------------------------------------------------------------
const brand0 = await actions.getPlatformBranding.handler(ctxFor(userRow), {});
check("branding defaults", brand0.logoUrl === null && brand0.primaryColor === "#e8590c");
await throwsAsync("branding color rejects plain word", () => actions.adminBrandingColorSet.handler(ctxFor(adminRow), { primaryColor: "red" }));
await throwsAsync("branding color rejects short hex", () => actions.adminBrandingColorSet.handler(ctxFor(adminRow), { primaryColor: "#fff" }));
await throwsAsync("branding color rejects bad hex", () => actions.adminBrandingColorSet.handler(ctxFor(adminRow), { primaryColor: "#gggggg" }));
await throwsAsync("non-admin blocked from adminBrandingColorSet", () => actions.adminBrandingColorSet.handler(ctxFor(userRow), { primaryColor: "#123456" }));
const colorSet = await actions.adminBrandingColorSet.handler(ctxFor(adminRow), { primaryColor: "#1c7ed6" });
check("branding color set ok", colorSet.ok === true && colorSet.primaryColor === "#1c7ed6");
const brand1 = await actions.getPlatformBranding.handler(ctxFor(userRow), {});
check("getPlatformBranding reflects color", brand1.primaryColor === "#1c7ed6");

const tinyPng = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
await throwsAsync("non-admin blocked from adminBrandLogoUpload", () => actions.adminBrandLogoUpload.handler(ctxFor(userRow), { filename: "logo.png", contentType: "image/png", dataBase64: tinyPng }));
const up1 = await actions.adminBrandLogoUpload.handler(ctxFor(adminRow), { filename: "logo.png", contentType: "image/png", dataBase64: tinyPng });
check("logo upload ok", up1.ok === true && typeof up1.logoUrl === "string" && up1.logoUrl.startsWith("blob://branding/platform-"));
check("logo blob stored", blobStore.size === 1);
const brand2 = await actions.getPlatformBranding.handler(ctxFor(userRow), {});
check("getPlatformBranding reflects logo", brand2.logoUrl === up1.logoUrl);
const up2 = await actions.adminBrandLogoUpload.handler(ctxFor(adminRow), { filename: "new-logo.png", contentType: "image/png", dataBase64: tinyPng });
check("second upload replaces blob", blobStore.size === 1 && up2.logoUrl !== up1.logoUrl, `store=${blobStore.size}`);
const brand3 = await actions.getPlatformBranding.handler(ctxFor(userRow), {});
check("getPlatformBranding reflects new logo", brand3.logoUrl === up2.logoUrl);

// --- 5. Policy versions --------------------------------------------------------
check("getPolicyVersion null when none", (await actions.getPolicyVersion.handler(ctxFor(userRow), { kind: "terms" })) === null);
await throwsAsync("non-admin blocked from adminPolicyVersionPublish", () => actions.adminPolicyVersionPublish.handler(ctxFor(userRow), { kind: "terms", version: "1.0", url: "" }));
await throwsAsync("non-admin blocked from adminPolicyVersionsList", () => actions.adminPolicyVersionsList.handler(ctxFor(userRow), {}));
const eff = new Date("2026-10-01T00:00:00.000Z").toISOString();
const pub1 = await actions.adminPolicyVersionPublish.handler(ctxFor(adminRow), { kind: "terms", version: "1.0", url: "https://crewkat.com/terms-v1", effectiveAt: eff });
check("policy publish returns id", pub1.ok === true && typeof pub1.id === "number");
const pub2 = await actions.adminPolicyVersionPublish.handler(ctxFor(adminRow), { kind: "terms", version: "1.1", url: "https://crewkat.com/terms-v2" });
check("second publish ok", pub2.id !== pub1.id);
const latest = await actions.getPolicyVersion.handler(ctxFor(userRow), { kind: "terms" });
check("getPolicyVersion returns latest", latest?.version === "1.1" && latest?.url === "https://crewkat.com/terms-v2" && latest?.effectiveAt === null);
const list = await actions.adminPolicyVersionsList.handler(ctxFor(adminRow), { kind: "terms" });
check("history lists both, newest first", list.versions.length === 2 && list.versions[0].version === "1.1" && list.versions[1].version === "1.0");
check("first publish kept effective date", list.versions[1].effectiveAt === eff);
check("getPolicyVersion privacy null", (await actions.getPolicyVersion.handler(ctxFor(userRow), { kind: "privacy" })) === null);
const all = await actions.adminPolicyVersionsList.handler(ctxFor(adminRow), {});
check("list without kind returns all", all.versions.length === 2);

// --- 6. TOTP -------------------------------------------------------------------
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32 of ASCII "12345678901234567890"
check("RFC 6238 vector T=59 -> 287082", totpCode(RFC_SECRET, 59_000) === "287082", totpCode(RFC_SECRET, 59_000));
check("RFC 6238 vector T=1111111109 -> 081804", totpCode(RFC_SECRET, 1_111_111_109_000) === "081804", totpCode(RFC_SECRET, 1_111_111_109_000));
check("RFC 6238 vector T=1234567890 -> 005924", totpCode(RFC_SECRET, 1_234_567_890_000) === "005924", totpCode(RFC_SECRET, 1_234_567_890_000));
check("verifyTotpCode accepts the vector code", verifyTotpCode(RFC_SECRET, "287082", 59_000));
check("verifyTotpCode rejects wrong code", !verifyTotpCode(RFC_SECRET, "287083", 59_000));
check("verifyTotpCode rejects malformed code", !verifyTotpCode(RFC_SECRET, "abc", 59_000));

await throwsAsync("non-team user blocked from adminTotpSetupStart", () => actions.adminTotpSetupStart.handler(ctxFor(userRow), {}));
await throwsAsync("non-team user blocked from adminTotpStatus", () => actions.adminTotpStatus.handler(ctxFor(userRow), {}));
const st0 = await actions.adminTotpStatus.handler(ctxFor(supportRow), {});
check("totp status starts unenrolled", st0.enrolled === false && st0.verified === false);
const start = await actions.adminTotpSetupStart.handler(ctxFor(supportRow), {});
check("setup start returns secret + otpauth uri", typeof start.secret === "string" && start.secret.length >= 32 && start.otpauthUri.startsWith("otpauth://totp/Crewkat:") && start.otpauthUri.includes(`secret=${start.secret}`));
const st1 = await actions.adminTotpStatus.handler(ctxFor(supportRow), {});
check("enrolled but unverified after start", st1.enrolled === true && st1.verified === false);
const realCode = totpCode(start.secret);
const wrongCode = realCode === "000000" ? "000001" : "000000";
await throwsAsync("setup verify rejects wrong code", () => actions.adminTotpSetupVerify.handler(ctxFor(supportRow), { code: wrongCode }));
const verified = await actions.adminTotpSetupVerify.handler(ctxFor(supportRow), { code: realCode });
check("setup verify accepts current code", verified.ok === true);
const st2 = await actions.adminTotpStatus.handler(ctxFor(supportRow), {});
check("totp status verified after verify", st2.enrolled === true && st2.verified === true);

// Admin require-toggle.
await throwsAsync("non-admin blocked from adminTotpRequiredSet", () => actions.adminTotpRequiredSet.handler(ctxFor(supportRow), { required: true }));
const reqOn = await actions.adminTotpRequiredSet.handler(ctxFor(adminRow), { required: true });
check("require toggle on", reqOn.ok === true && reqOn.required === true);
const reqRow = (await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, "admin_2fa_required")).limit(1))[0];
check("require toggle persisted", reqRow?.value === "1");

// Disable: self.
await actions.adminTotpDisable.handler(ctxFor(supportRow), {});
const st3 = await actions.adminTotpStatus.handler(ctxFor(supportRow), {});
check("self disable clears enrollment", st3.enrolled === false && st3.verified === false);
// Disable: admin for another user; non-admin cannot disable others.
const start2 = await actions.adminTotpSetupStart.handler(ctxFor(supportRow), {});
await actions.adminTotpSetupVerify.handler(ctxFor(supportRow), { code: totpCode(start2.secret) });
await throwsAsync("support cannot disable another user's 2FA", () => actions.adminTotpDisable.handler(ctxFor(supportRow), { userId: adminRow.id }));
await actions.adminTotpDisable.handler(ctxFor(adminRow), { userId: supportRow.id });
const st4 = await actions.adminTotpStatus.handler(ctxFor(supportRow), {});
check("admin disable clears another user's enrollment", st4.enrolled === false);

// --- 7. Login TOTP enforcement --------------------------------------------------
// Re-enroll the support user, then require 2FA and log in.
const start3 = await actions.adminTotpSetupStart.handler(ctxFor(supportRow), {});
await actions.adminTotpSetupVerify.handler(ctxFor(supportRow), { code: totpCode(start3.secret) });
const login1 = await actions.login.handler(ctxFor(supportRow), { email: "support1@test.com", password: "password1234" });
check("login returns totpRequired for enrolled team member", login1.totpRequired === true, String(login1.totpRequired));
check("pending login carries no refresh cookie", Array.isArray(login1.setCookies) && login1.setCookies.length === 0);
const pendingHash = createHash("sha256").update(login1.sessionToken, "utf8").digest("hex");
const pendingRow = (await db.select().from(schema.authSessions).where(eq(schema.authSessions.tokenHash, pendingHash)).limit(1))[0];
check("pending proof session stored with totpPending", !!pendingRow && pendingRow.totpPending === true && pendingRow.tokenType === "proof");
check("pending proof expires in ~5 minutes", !!pendingRow && pendingRow.expiresAt.getTime() - Date.now() < 6 * 60_000 && pendingRow.expiresAt.getTime() - Date.now() > 4 * 60_000);

// A protected action must not work with the pending proof.
await throwsAsync("protected actions reject the pending proof", async () => {
  const { requireSession } = await import("./server/src/actions.ts");
  await requireSession(ctxFor(supportRow), login1.sessionToken);
});

// Wrong code rejected; right code completes the login.
await throwsAsync("verifyTotpLogin rejects wrong code", () => myActions.verifyTotpLogin.handler(ctxFor(supportRow), { code: wrongCode, _sessionToken: login1.sessionToken }));
const done = await myActions.verifyTotpLogin.handler(ctxFor(supportRow), { code: totpCode(start3.secret), _sessionToken: login1.sessionToken });
check("verifyTotpLogin issues a real session", typeof done.sessionToken === "string" && done.sessionToken !== login1.sessionToken && done.setCookies.length === 1 && done.totpRequired === false);
check("verifyTotpLogin returns the user", done.user.email === "support1@test.com");
const burned = (await db.select().from(schema.authSessions).where(eq(schema.authSessions.tokenHash, pendingHash)).limit(1))[0];
check("pending proof burned after verify", !!burned?.revokedAt);
await throwsAsync("used pending proof cannot be reused", () => myActions.verifyTotpLogin.handler(ctxFor(supportRow), { code: totpCode(start3.secret), _sessionToken: login1.sessionToken }));

// Team member WITHOUT enrollment logs in normally (totpRequired false).
const login2 = await actions.login.handler(ctxFor(userRow), { email: "user@test.com", password: "password1234" });
check("non-team login unaffected by 2FA requirement", login2.totpRequired === false && login2.setCookies.length === 1);
// 2FA not required -> enrolled team member logs in normally.
await actions.adminTotpRequiredSet.handler(ctxFor(adminRow), { required: false });
const login3 = await actions.login.handler(ctxFor(supportRow), { email: "support1@test.com", password: "password1234" });
check("login normal when 2FA not required", login3.totpRequired === false && login3.setCookies.length === 1);

// --- 8. Audit log ---------------------------------------------------------------
const auditRows = await db.select({ action: schema.adminAuditLog.action }).from(schema.adminAuditLog);
const auditActions = new Set(auditRows.map((r) => r.action));
for (const a of ["settings.maintenance", "settings.branding_changed", "settings.policy_publish", "settings.totp_enabled", "settings.totp_disabled", "settings.totp_required"]) {
  check(`audit row: ${a}`, auditActions.has(a));
}

// --- Summary --------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log("\nAll admin-phase2-settings checks passed.");
}
