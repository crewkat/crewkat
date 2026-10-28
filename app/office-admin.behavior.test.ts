// Office desktop admin console behavior tests (2026-10-27).
//
// The Office Admin section is a UI over the existing platform-admin
// suite; these tests pin the server contract it depends on:
//  1. Founder grant repair (server.mjs startup self-heal): the founder
//     account (subscription_status='founder') gains is_platform_admin;
//     non-founders untouched; re-running is a no-op.
//  2. Every admin surface the console wires rejects plain users.
//  3. Team-role gating matches the suite's permission matrix: support
//     reads the inbox + user list and can suspend, but cannot touch
//     feature flags, team roles, or the audit search (admin-only /
//     requirePlatformAdmin surfaces); moderators get user reports but
//     NOT the support inbox.
//  4. After the founder grant, the founder passes the platform-admin
//     gates (adminFeatureFlags, adminMyTeamRole -> "admin").
//
// Run from app/:  bun office-admin.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
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

// --- Scratch DB + migrate ---------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-office-admin-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

// --- Fixtures -----------------------------------------------------------------
const now = new Date();
async function mkUser(name: string, email: string, opts: { isPlatformAdmin?: boolean; subscriptionStatus?: string; tier?: string } = {}) {
  await db.insert(schema.authUsers).values({
    name, email, passwordHash: "x", passwordSalt: "y",
    isPlatformAdmin: opts.isPlatformAdmin ?? false,
    subscriptionStatus: (opts.subscriptionStatus ?? "inactive") as "inactive",
    tier: (opts.tier ?? "free") as "free",
    emailVerifiedAt: now,
    createdAt: now,
  });
  return (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, email)).limit(1))[0];
}

const founder = await mkUser("Founder", "founder@test.com", { subscriptionStatus: "founder", tier: "premium" });
const boss = await mkUser("Boss", "boss@test.com", { isPlatformAdmin: true });
const plain = await mkUser("Plain", "plain@test.com", {});
const plain2 = await mkUser("Plain Two", "plain2@test.com", {});
const support = await mkUser("Sue Support", "support@test.com", {});
const moderator = await mkUser("Mo Moderator", "mod@test.com", {});
await db.insert(schema.adminTeamRoles).values({ userId: support.id, role: "support", grantedBy: boss.id, createdAt: now, updatedAt: now });
await db.insert(schema.adminTeamRoles).values({ userId: moderator.id, role: "moderator", grantedBy: boss.id, createdAt: now, updatedAt: now });
await db.insert(schema.platformSupportReports).values({
  userId: plain.id, userName: plain.name, userEmail: plain.email,
  kind: "problem", subject: "Invoice PDF looks wrong", message: "The total line is cut off.",
  status: "open", isUnread: true, createdAt: now, updatedAt: now,
});

const ctxFor = (user: typeof boss) => ({
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

// --- 1. Founder grant repair ----------------------------------------------------
// The repair is a raw-SQL startup self-heal in server.mjs; pin its exact
// statement in the source, then run it against the scratch DB.
const serverMjs = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const FOUNDER_GRANT_SQL = "UPDATE `auth_users` SET `is_platform_admin` = 1 WHERE `subscription_status` = 'founder' AND COALESCE(`is_platform_admin`, 0) = 0";
check("server.mjs contains the founder grant repair", serverMjs.includes(FOUNDER_GRANT_SQL));

check("founder starts without the platform admin flag", founder.isPlatformAdmin === false);
const grant1 = await client.execute(FOUNDER_GRANT_SQL);
check("grant updates exactly the founder row", grant1.rowsAffected === 1, String(grant1.rowsAffected));
const founderAfter = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, founder.id)).limit(1))[0];
check("founder now holds is_platform_admin", founderAfter.isPlatformAdmin === true);
const plainAfter = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, plain.id)).limit(1))[0];
check("non-founder untouched by the grant", plainAfter.isPlatformAdmin === false);
const grant2 = await client.execute(FOUNDER_GRANT_SQL);
check("grant is idempotent (second run affects 0 rows)", grant2.rowsAffected === 0, String(grant2.rowsAffected));

// After the grant, the founder passes platform-admin gates.
const founderFlags = await actions.adminFeatureFlags.handler(ctxFor(founderAfter), {});
check("founder (post-grant) can read feature flags", Array.isArray(founderFlags.flags) && founderFlags.flags.length === 3);
const founderRole = await actions.adminMyTeamRole.handler(ctxFor(founderAfter), {});
check("founder (post-grant) effective team role is admin", founderRole.role === "admin", String(founderRole.role));

// --- 2. Plain users are rejected everywhere the console wires -------------------
for (const [name, call] of [
  ["adminUsersList", () => actions.adminUsersList.handler(ctxFor(plain), { search: "", tier: "all", status: "all", page: 1, pageSize: 20 })],
  ["adminUserDetail", () => actions.adminUserDetail.handler(ctxFor(plain), { userId: plain2.id })],
  ["adminFeatureFlags", () => actions.adminFeatureFlags.handler(ctxFor(plain), {})],
  ["adminFeatureFlagSet", () => actions.adminFeatureFlagSet.handler(ctxFor(plain), { key: "marketplace_enabled", enabled: false })],
  ["adminBroadcastSend", () => actions.adminBroadcastSend.handler(ctxFor(plain), { title: "x", body: "y", segment: "all" })],
  ["adminBroadcastHistory", () => actions.adminBroadcastHistory.handler(ctxFor(plain), { page: 1, pageSize: 25 })],
  ["adminRevenueDashboard", () => actions.adminRevenueDashboard.handler(ctxFor(plain), {})],
  ["adminAnalyticsOverview", () => actions.adminAnalyticsOverview.handler(ctxFor(plain), {})],
  ["adminSupportView", () => actions.adminSupportView.handler(ctxFor(plain), { email: "plain2@test.com" })],
  ["adminVerificationList", () => actions.adminVerificationList.handler(ctxFor(plain), {})],
  ["platformSupportInbox", () => actions.platformSupportInbox.handler(ctxFor(plain), { status: "all", priority: "all", assignedTo: "all", search: "" })],
  ["adminUserReports", () => actions.adminUserReports.handler(ctxFor(plain), {})],
  ["adminTeamList", () => actions.adminTeamList.handler(ctxFor(plain), {})],
  ["adminTeamSetRole", () => actions.adminTeamSetRole.handler(ctxFor(plain), { userId: plain2.id, role: "support" })],
  ["adminAuditLogSearch", () => actions.adminAuditLogSearch.handler(ctxFor(plain), { action: "", targetType: "", page: 1, pageSize: 25 })],
] as [string, () => Promise<unknown>][]) {
  await throwsAsync(`plain user rejected: ${name}`, call);
}
const plainRole = await actions.adminMyTeamRole.handler(ctxFor(plain), {});
check("plain user has no team role (Admin nav stays hidden)", plainRole.role === null);

// --- 3. Support role: reads support surfaces, blocked from admin-only ones ------
const inbox = await actions.platformSupportInbox.handler(ctxFor(support), { status: "open", priority: "all", assignedTo: "all", search: "" });
check("support can read the support inbox", inbox.reports.length === 1 && inbox.unreadCount === 1, JSON.stringify(inbox.reports?.length));
const supportList = await actions.adminUsersList.handler(ctxFor(support), { search: "", tier: "all", status: "all", page: 1, pageSize: 20 });
check("support can list users", supportList.total >= 6, String(supportList.total));
const teamList = await actions.adminTeamList.handler(ctxFor(support), {});
check("support can read the team list (ticket assignment)", teamList.members.some((m: any) => m.userId === support.id && m.role === "support"));
await throwsAsync("support cannot change feature flags (requirePlatformAdmin)", () => actions.adminFeatureFlagSet.handler(ctxFor(support), { key: "marketplace_enabled", enabled: false }));
await throwsAsync("support cannot read revenue (requirePlatformAdmin)", () => actions.adminRevenueDashboard.handler(ctxFor(support), {}));
await throwsAsync("support cannot grant team roles (admin-only)", () => actions.adminTeamSetRole.handler(ctxFor(support), { userId: plain2.id, role: "support" }));
await throwsAsync("support cannot search the audit log (admin-only)", () => actions.adminAuditLogSearch.handler(ctxFor(support), { action: "", targetType: "", page: 1, pageSize: 25 }));
const supportRole = await actions.adminMyTeamRole.handler(ctxFor(support), {});
check("support effective team role is support", supportRole.role === "support", String(supportRole.role));

// Support can suspend (console exposes it to admin+support) — and it lands.
await actions.adminUserSuspend.handler(ctxFor(support), { userId: plain2.id });
const plain2After = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, plain2.id)).limit(1))[0];
check("support suspend takes effect", plain2After.suspendedAt != null);
await actions.adminUserUnsuspend.handler(ctxFor(support), { userId: plain2.id });

// --- 4. Moderator: user reports yes, support inbox no -----------------------------
const reports = await actions.adminUserReports.handler(ctxFor(moderator), {});
check("moderator can read user reports", Array.isArray(reports.reports));
await throwsAsync("moderator cannot read the support inbox (admin+support only)", () => actions.platformSupportInbox.handler(ctxFor(moderator), { status: "all", priority: "all", assignedTo: "all", search: "" }));
const modRole = await actions.adminMyTeamRole.handler(ctxFor(moderator), {});
check("moderator effective team role is moderator", modRole.role === "moderator", String(modRole.role));

// --- Summary ----------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll office-admin checks passed.");
