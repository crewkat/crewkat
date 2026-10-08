// Platform admin suite behavior tests (2026-10-07).
//
// Covers:
//  1. Migration 0069 creates broadcast_log, business_verifications,
//     feature_flags (+seed), send_caps, blocked_senders, send_usage.
//  2. Journal: newest tag is 0070_account_deletion_codes, `when` strictly newer.
//  3. Feature flags: seeded values, admin list/set, non-admin blocked,
//     public getFeatureFlags.
//  4. Broadcasts: admin send writes history + audit log; disabled flag blocks.
//  5. Verification: set/list round-trip; verified company IDs feed the
//     marketplace badge.
//  6. Abuse: caps enforced (daily + 3x-hourly auto-block), unblock works.
//  7. Support view: read-only snapshot; every view is audit-logged.
//  8. Revenue: unconfigured Stripe -> configured:false (no network).
//  9. Audit log filters (action/date).
//
// Run from app/:  bun platform-admin.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq, isNull } from "drizzle-orm";
import { BaseActions, verifiedCompanyIdSet } from "./server/src/actions.ts";
import { checkSendCap, recordSendAttempt } from "./server/src/platform-admin.ts";
import { privilegedHandlers } from "./server/src/privileged.ts";
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
async function throwsAsync(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch {
    check(name, true);
  }
}

// --- 1. Scratch DB + migrate -------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-pa-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

// --- 2. Journal check ----------------------------------------------------------
const journal = await import("./drizzle/meta/_journal.json");
const entries = journal.entries;
const last = entries[entries.length - 1];
const prev = entries[entries.length - 2];
check("newest migration tag is 0070_account_deletion_codes", last.tag === "0070_account_deletion_codes", last.tag);
check("0070 when is strictly newer than 0069 (drizzle skips older)", last.when > prev.when, `${last.when} vs ${prev.when}`);

// --- 3. Fixtures ---------------------------------------------------------------
const now = new Date();
const mkUser = (name: string, email: string, isAdmin: boolean, tier = "free") =>
  db.insert(schema.authUsers).values({ name, email, passwordHash: "x", passwordSalt: "y", isPlatformAdmin: isAdmin, tier: tier as "free", createdAt: now });
await mkUser("Danny", "admin@test.com", true);
await mkUser("User One", "user1@test.com", false);
await mkUser("User Two", "user2@test.com", false, "premium");
const admin = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "admin@test.com")).limit(1))[0];
const user1 = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "user1@test.com")).limit(1))[0];
const user2 = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "user2@test.com")).limit(1))[0];

await db.insert(schema.settings).values({ companyId: 1, companyName: "Test Co", licenseNumber: "CRC1234567" });

const ctxFor = (user: typeof admin) => ({
  db: () => db,
  unscopedDb: () => db,
  workspaceCompanyId: user.companyId,
  workspaceUserId: user.id,
  workspaceTier: user.tier,
  invalidateQueries: () => {},
  executePrivileged: async (contract: any, args: any) => {
    const entry = (privilegedHandlers as any).entries.find((e: any) => e.contract?.name === contract?.name);
    if (!entry) throw new Error(`Unknown privileged contract: ${contract?.name}`);
    return entry.handler(entry.contract.request.parse(args));
  },
}) as any;

const actions = BaseActions as any;
for (const name of ["adminBroadcastSend", "adminBroadcastHistory", "adminVerificationList", "adminVerificationSet", "adminRevenueDashboard", "adminFeatureFlags", "adminFeatureFlagSet", "getFeatureFlags", "adminSupportView", "adminAbuseOverview", "adminAbuseCapSet", "adminAbuseDefaultsSet", "adminBlockUser", "adminUnblockUser"]) {
  check(`action exists: ${name}`, typeof actions[name]?.handler === "function");
}

// --- 4. Feature flags ----------------------------------------------------------
const flags = await actions.getFeatureFlags.handler(ctxFor(user1), {});
check("public getFeatureFlags returns all three flags", flags.marketplace_enabled === true && flags.signups_enabled === true && flags.broadcasts_enabled === true, JSON.stringify(flags));

const flagList = await actions.adminFeatureFlags.handler(ctxFor(admin), {});
check("admin sees 3 seeded flags", flagList.flags.length === 3, String(flagList.flags.length));
await throwsAsync("non-admin blocked from adminFeatureFlags", () => actions.adminFeatureFlags.handler(ctxFor(user1), {}));

await actions.adminFeatureFlagSet.handler(ctxFor(admin), { key: "marketplace_enabled", enabled: false });
const flagsOff = await actions.getFeatureFlags.handler(ctxFor(user1), {});
check("flag toggle takes effect publicly", flagsOff.marketplace_enabled === false);
await actions.adminFeatureFlagSet.handler(ctxFor(admin), { key: "marketplace_enabled", enabled: true });
await throwsAsync("non-admin blocked from adminFeatureFlagSet", () => actions.adminFeatureFlagSet.handler(ctxFor(user1), { key: "marketplace_enabled", enabled: false }));

// --- 5. Broadcasts ---------------------------------------------------------------
const sent = await actions.adminBroadcastSend.handler(ctxFor(admin), { title: "Hello", body: "Test broadcast", segment: "all" });
check("broadcast send returns counts", sent.ok === true && sent.totalUsers === 3, JSON.stringify(sent));
const history = await actions.adminBroadcastHistory.handler(ctxFor(admin), { page: 1, pageSize: 25 });
check("broadcast history has the entry", history.entries.length === 1 && history.entries[0].title === "Hello" && history.entries[0].segment === "all", String(history.entries.length));
await throwsAsync("non-admin blocked from adminBroadcastSend", () => actions.adminBroadcastSend.handler(ctxFor(user1), { title: "x", body: "y", segment: "all" }));

await actions.adminFeatureFlagSet.handler(ctxFor(admin), { key: "broadcasts_enabled", enabled: false });
await throwsAsync("broadcast blocked when broadcasts_enabled is off", () => actions.adminBroadcastSend.handler(ctxFor(admin), { title: "x", body: "y", segment: "all" }));
await actions.adminFeatureFlagSet.handler(ctxFor(admin), { key: "broadcasts_enabled", enabled: true });

// --- 6. Verification ---------------------------------------------------------------
const vlist1 = await actions.adminVerificationList.handler(ctxFor(admin), {});
check("verification list shows the company with its license", vlist1.businesses.length === 1 && vlist1.businesses[0].licenseNumber === "CRC1234567" && vlist1.businesses[0].status === "pending", JSON.stringify(vlist1.businesses));
await actions.adminVerificationSet.handler(ctxFor(admin), { companyId: 1, status: "verified", note: "License checked." });
const vlist2 = await actions.adminVerificationList.handler(ctxFor(admin), {});
check("verification set persists", vlist2.businesses[0].status === "verified" && vlist2.businesses[0].note === "License checked.", JSON.stringify(vlist2.businesses[0]));
const verifiedIds = await verifiedCompanyIdSet(db);
check("verified company feeds the marketplace badge set", verifiedIds.has(1));
await throwsAsync("non-admin blocked from adminVerificationSet", () => actions.adminVerificationSet.handler(ctxFor(user1), { companyId: 1, status: "verified", note: "" }));

// --- 7. Abuse controls ---------------------------------------------------------------
const overview1 = await actions.adminAbuseOverview.handler(ctxFor(admin), {});
check("abuse defaults are sane", overview1.defaults.maxSmsPerDay === 50 && overview1.defaults.maxPushPerDay === 100, JSON.stringify(overview1.defaults));

// Daily cap: cap user1 at 1 sms/day.
await actions.adminAbuseCapSet.handler(ctxFor(admin), { userId: user1.id, maxSmsPerDay: 1, maxPushPerDay: 100 });
const attempt1 = await recordSendAttempt(db, user1.id, "sms");
check("first send under cap is allowed", attempt1.allowed === true);
const attempt2 = await recordSendAttempt(db, user1.id, "sms");
check("second send over daily cap is blocked", attempt2.allowed === false && (attempt2.reason ?? "").includes("Daily"), JSON.stringify(attempt2));

// Hourly auto-block: 4th send in the hour exceeds 3x the daily cap of 1.
const attempt3 = await recordSendAttempt(db, user1.id, "sms");
check("third send still daily-blocked (not yet auto-blocked)", attempt3.allowed === false && !attempt3.autoBlocked);
const attempt4 = await recordSendAttempt(db, user1.id, "sms");
check("fourth send triggers auto-block", attempt4.allowed === false && attempt4.autoBlocked === true, JSON.stringify(attempt4));
const blockedRows = await db.select().from(schema.blockedSenders).where(eq(schema.blockedSenders.userId, user1.id));
check("auto-block row recorded", blockedRows.length === 1 && blockedRows[0].reason.includes("Auto-blocked"), blockedRows[0]?.reason ?? "none");
const attempt5 = await recordSendAttempt(db, user1.id, "sms");
check("blocked user stays blocked", attempt5.allowed === false);

await actions.adminUnblockUser.handler(ctxFor(admin), { userId: user1.id });
const attempt6 = await recordSendAttempt(db, user2.id, "sms");
check("other user unaffected by the block", attempt6.allowed === true);

// Defaults update.
await actions.adminAbuseDefaultsSet.handler(ctxFor(admin), { maxSmsPerDay: 60, maxPushPerDay: 120 });
const overview2 = await actions.adminAbuseOverview.handler(ctxFor(admin), {});
check("abuse defaults update", overview2.defaults.maxSmsPerDay === 60 && overview2.defaults.maxPushPerDay === 120, JSON.stringify(overview2.defaults));
await throwsAsync("non-admin blocked from adminAbuseCapSet", () => actions.adminAbuseCapSet.handler(ctxFor(user1), { userId: user2.id, maxSmsPerDay: 5, maxPushPerDay: 5 }));

// --- 7b. SMS cap pre-check (read-only, runs before the SMS app opens) ---------
await actions.adminAbuseCapSet.handler(ctxFor(admin), { userId: user2.id, maxSmsPerDay: 3, maxPushPerDay: 100 });
const pre1 = await checkSendCap(db, user2.id, "sms");
check("pre-check allowed under cap", pre1.allowed === true, JSON.stringify(pre1));
await recordSendAttempt(db, user2.id, "sms");
await recordSendAttempt(db, user2.id, "sms");
const pre2 = await checkSendCap(db, user2.id, "sms");
check("pre-check blocked at cap", pre2.allowed === false && (pre2.reason ?? "").includes("Daily"), JSON.stringify(pre2));
const usageBefore = (await db.select().from(schema.sendUsage).where(and(eq(schema.sendUsage.userId, user2.id), eq(schema.sendUsage.channel, "sms"), eq(schema.sendUsage.period, "day"))))[0]?.count ?? 0;
await checkSendCap(db, user2.id, "sms");
const usageAfter = (await db.select().from(schema.sendUsage).where(and(eq(schema.sendUsage.userId, user2.id), eq(schema.sendUsage.channel, "sms"), eq(schema.sendUsage.period, "day"))))[0]?.count ?? 0;
check("pre-check does not bump usage", usageBefore === usageAfter && usageAfter === 3, `${usageBefore} -> ${usageAfter}`);
await actions.adminBlockUser.handler(ctxFor(admin), { userId: user2.id, reason: "test block" });
const pre3 = await checkSendCap(db, user2.id, "sms");
check("pre-check blocked for blocked accounts", pre3.allowed === false && (pre3.reason ?? "").includes("blocked"), JSON.stringify(pre3));
await actions.adminUnblockUser.handler(ctxFor(admin), { userId: user2.id });

// --- 8. Support view ---------------------------------------------------------------
await db.insert(schema.clients).values({ companyId: 1, name: "Test Client" });
const snap = await actions.adminSupportView.handler(ctxFor(admin), { email: "user1@test.com" });
check("support view finds the user", snap.found === true && snap.profile?.email === "user1@test.com", JSON.stringify(snap.found));
check("support view has counts", typeof snap.counts?.clients === "number" && snap.counts.clients >= 1, JSON.stringify(snap.counts));
const missing = await actions.adminSupportView.handler(ctxFor(admin), { email: "nobody@test.com" });
check("support view reports missing users", missing.found === false);
await throwsAsync("non-admin blocked from adminSupportView", () => actions.adminSupportView.handler(ctxFor(user1), { email: "user2@test.com" }));

// --- 9. Revenue (no Stripe key -> configured:false, no network) -----------------------
delete process.env.STRIPE_SECRET_KEY;
const revenue = await actions.adminRevenueDashboard.handler(ctxFor(admin), {});
check("revenue dashboard degrades gracefully without Stripe", revenue.configured === false && revenue.mrrDollars === null && typeof revenue.localActivePremium === "number", JSON.stringify(revenue));
await throwsAsync("non-admin blocked from adminRevenueDashboard", () => actions.adminRevenueDashboard.handler(ctxFor(user1), {}));

// --- 10. Audit log --------------------------------------------------------------------
const auditAll = await actions.adminAuditLog.handler(ctxFor(admin), { page: 1, pageSize: 100, action: "", actorId: null, since: "", until: "" });
const loggedActions = new Set(auditAll.entries.map((e: any) => e.action));
for (const expected of ["broadcast.send", "verification.set", "support.view", "abuse.cap_set", "abuse.unblock", "flags.toggle"]) {
  check(`audit log recorded: ${expected}`, loggedActions.has(expected), [...loggedActions].join(","));
}
const filtered = await actions.adminAuditLog.handler(ctxFor(admin), { page: 1, pageSize: 100, action: "broadcast", actorId: null, since: "", until: "" });
check("audit action filter works", filtered.entries.length >= 1 && filtered.entries.every((e: any) => e.action.includes("broadcast")), String(filtered.entries.length));
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const futureFiltered = await actions.adminAuditLog.handler(ctxFor(admin), { page: 1, pageSize: 100, action: "", actorId: null, since: tomorrow, until: "" });
check("audit date filter works", futureFiltered.entries.length === 0, String(futureFiltered.entries.length));
await throwsAsync("non-admin blocked from adminAuditLog", () => actions.adminAuditLog.handler(ctxFor(user1), { page: 1, pageSize: 25, action: "", actorId: null, since: "", until: "" }));

// --- 11. Self-service account deletion -----------------------------------------
import { createHash } from "node:crypto";
const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
const mkSession = (userId: number, token: string) =>
  db.insert(schema.authSessions).values({
    userId, tokenHash: sha256hex(token), tokenType: "legacy",
    expiresAt: new Date(Date.now() + 86400000), lastSeenAt: new Date(),
  });
await mkUser("Delete Me", "deleteme@test.com", false);
await db.update(schema.authUsers).set({ emailVerifiedAt: new Date(), companyId: 999 }).where(eq(schema.authUsers.email, "deleteme@test.com"));
const delUser = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "deleteme@test.com")).limit(1))[0];
const delToken = `del-session-${"x".repeat(48)}`;
await mkSession(delUser.id, delToken);
await db.insert(schema.clients).values({ companyId: 999, name: "Doomed Client" });
await db.insert(schema.jobs).values({ companyId: 999, clientName: "Doomed Client", jobAddress: "1 Test St", jobType: "Remodel", jobDate: "2026-10-07" });

const adminToken = `admin-session-${"x".repeat(48)}`;
await db.update(schema.authUsers).set({ emailVerifiedAt: new Date() }).where(eq(schema.authUsers.id, admin.id));
await mkSession(admin.id, adminToken);
await throwsAsync("platform admin cannot request deletion", () =>
  actions.requestAccountDeletion.handler(ctxFor(admin), { _sessionToken: adminToken }));
await throwsAsync("platform admin cannot self-delete", () =>
  actions.deleteMyAccount.handler(ctxFor(admin), { _sessionToken: adminToken, code: "123456" }));

const reqResult = await actions.requestAccountDeletion.handler(ctxFor(delUser), { _sessionToken: delToken });
check("deletion code request succeeds", reqResult.ok === true, JSON.stringify(reqResult));
await throwsAsync("deletion code rate-limited to 1/min", () =>
  actions.requestAccountDeletion.handler(ctxFor(delUser), { _sessionToken: delToken }));
await throwsAsync("deletion blocked on wrong code", () =>
  actions.deleteMyAccount.handler(ctxFor(delUser), { _sessionToken: delToken, code: "000000" }));

// Read the real code hash back out of the test DB to authorize deletion.
const codeRow = (await db.select().from(schema.accountDeletionCodes).where(and(
  eq(schema.accountDeletionCodes.userId, delUser.id),
  isNull(schema.accountDeletionCodes.consumedAt),
))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
check("code stored hashed, not plaintext", !!codeRow && /^[0-9a-f]{64}$/.test(codeRow.codeHash), codeRow ? codeRow.codeHash.slice(0, 16) + "…" : "missing");
// We can't reverse the hash in the test; verify the happy path by consuming
// flow: re-issue directly with a known code.
await db.update(schema.accountDeletionCodes).set({ consumedAt: new Date() }).where(eq(schema.accountDeletionCodes.userId, delUser.id));
const knownCode = "654321";
await db.insert(schema.accountDeletionCodes).values({
  userId: delUser.id, codeHash: sha256hex(knownCode),
  expiresAt: new Date(Date.now() + 30 * 60_000), createdAt: new Date(),
});
const delResult = await actions.deleteMyAccount.handler(ctxFor(delUser), { _sessionToken: delToken, code: knownCode });
check("sole-user deletion succeeds", delResult.ok === true && delResult.tablesCleared > 0, JSON.stringify(delResult));
const goneUser = await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "deleteme@test.com")).limit(1);
check("user row deleted", goneUser.length === 0);
const goneSessions = await db.select().from(schema.authSessions).where(eq(schema.authSessions.userId, delUser.id)).limit(1);
check("sessions deleted", goneSessions.length === 0);
const goneClients = await db.select().from(schema.clients).where(eq(schema.clients.companyId, 999)).limit(1);
check("sole user's company data cleared", goneClients.length === 0);
const keptCompany = await db.select().from(schema.settings).where(eq(schema.settings.companyId, 1)).limit(1);
check("other companies untouched", keptCompany.length === 1 && keptCompany[0].companyName === "Test Co");
const auditDel = await db.select().from(schema.adminAuditLog).where(eq(schema.adminAuditLog.action, "account.deleted")).limit(1);
check("deletion audit-logged", auditDel.length === 1 && (auditDel[0].targetId ?? "").includes("deleteme@test.com"), JSON.stringify(auditDel[0]?.details ?? ""));

// --- done ------------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log("\nALL CHECKS PASSED");
}
