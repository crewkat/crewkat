// Admin panel Phase 1 behavior tests (2026-10-09).
//
// Covers:
//  1. Migration 0071: new tables/columns; journal newest tag is
//     0071_admin_phase1 with strictly newer `when` than 0070.
//  2. Users: delete (reuses deletion machinery, refuses self/admins),
//     Founders grant/revoke, impersonation start/end with audit rows.
//  3. Team roles: permission matrix (support can suspend, not refund/ban;
//     moderator can moderate, not touch billing; role set/remove audited).
//  4. Billing: promo create/delete (privileged mocked) + audit; plan update.
//  5. Moderation: keyword hold/flag rules, new-user listing cap,
//     user-report decide, content hide/unhide, all audited.
//  6. Audit: adminAuditLogSearch filters.
//
// Run from app/:  bun admin-phase1.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
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

// --- 1. Scratch DB + migrate -------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-p1-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

// --- 2. Journal check ----------------------------------------------------------
const journal = await import("./drizzle/meta/_journal.json");
const entries = journal.entries;
const last = entries[entries.length - 1];
const prev = entries[entries.length - 2];
check("newest migration tag is 0072_admin_phase2", last.tag === "0072_admin_phase2", last.tag);
check("0071 when is strictly newer than 0070 (drizzle skips older)", last.when > prev.when, `${last.when} vs ${prev.when}`);

// --- 3. Migration 0071 schema ----------------------------------------------------
const tables = (await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map((r) => (r as any).name as string);
for (const t of ["admin_team_roles", "user_reports", "moderation_keyword_rules", "promo_code_log"]) {
  check(`table exists: ${t}`, tables.includes(t));
}
const sessionCols = (await client.execute("PRAGMA table_info(auth_sessions)")).rows.map((r) => (r as any).name as string);
check("auth_sessions.impersonated_by exists", sessionCols.includes("impersonated_by"));
const msgCols = (await client.execute("PRAGMA table_info(marketplace_messages)")).rows.map((r) => (r as any).name as string);
check("marketplace_messages.hidden exists", msgCols.includes("hidden"));
const settingsKeys = (await db.select({ key: schema.platformSettings.key }).from(schema.platformSettings)).map((r) => r.key);
for (const k of ["automod_new_user_listing_cap", "automod_new_user_days", "plan_pro_name", "plan_pro_price_cents", "plan_pro_interval"]) {
  check(`platform setting seeded: ${k}`, settingsKeys.includes(k), settingsKeys.join(","));
}

// --- 4. Fixtures -------------------------------------------------------------------
const now = new Date();
const mkUser = (name: string, email: string, opts: { admin?: boolean; verified?: boolean } = {}) =>
  db.insert(schema.authUsers).values({
    name, email, passwordHash: "x", passwordSalt: "y",
    isPlatformAdmin: opts.admin ?? false,
    emailVerifiedAt: opts.verified === false ? null : now,
    createdAt: now,
  });
await mkUser("Danny", "admin@test.com", { admin: true });
await mkUser("Support Sam", "support@test.com");
await mkUser("Mod Maya", "mod@test.com");
await mkUser("User One", "user1@test.com");
await mkUser("Fresh Fran", "fresh@test.com");
const byEmail = async (email: string) =>
  (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, email)).limit(1))[0];
const admin = await byEmail("admin@test.com");
const support = await byEmail("support@test.com");
const mod = await byEmail("mod@test.com");
const user1 = await byEmail("user1@test.com");
const fresh = await byEmail("fresh@test.com");
await db.insert(schema.settings).values({ companyId: 1, companyName: "Test Co", licenseNumber: "CRC1234567" });
// Give team roles to support + moderator.
await db.insert(schema.adminTeamRoles).values([
  { userId: support.id, role: "support", grantedBy: admin.id, createdAt: now, updatedAt: now },
  { userId: mod.id, role: "moderator", grantedBy: admin.id, createdAt: now, updatedAt: now },
]);
// Generous free listing limit so the new-user cap test is isolated.
await db.insert(schema.platformSettings).values({ key: "free_listing_limit", value: "100", updatedAt: now }).onConflictDoNothing();

const ctxFor = (user: typeof admin, privilegedMock?: (name: string, args: any) => Promise<any>) => ({
  db: () => db,
  unscopedDb: () => db,
  workspaceCompanyId: user.companyId,
  workspaceUserId: user.id,
  workspaceTier: user.tier,
  invalidateQueries: () => {},
  executePrivileged: async (contract: any, args: any) => {
    if (privilegedMock) return privilegedMock(contract?.name, args);
    const entry = (privilegedHandlers as any).entries.find((e: any) => e.contract?.name === contract?.name);
    if (!entry) throw new Error(`Unknown privileged contract: ${contract?.name}`);
    return entry.handler(entry.contract.request.parse(args));
  },
}) as any;

const actions = BaseActions as any;
const auditCount = async (action: string) =>
  (await db.select().from(schema.adminAuditLog).where(eq(schema.adminAuditLog.action, action))).length;

// --- 5. Users: delete ---------------------------------------------------------------
await throwsAsync("non-admin blocked from adminUserDelete", () => actions.adminUserDelete.handler(ctxFor(user1), { userId: support.id, reason: "" }));
await throwsAsync("admin cannot delete self", () => actions.adminUserDelete.handler(ctxFor(admin), { userId: admin.id, reason: "" }));
await mkUser("Other Admin", "admin2@test.com", { admin: true });
const admin2 = await byEmail("admin2@test.com");
await throwsAsync("admin cannot delete another platform admin", () => actions.adminUserDelete.handler(ctxFor(admin), { userId: admin2.id, reason: "" }));
const delRes = await actions.adminUserDelete.handler(ctxFor(admin), { userId: user1.id, reason: "test" });
check("adminUserDelete returns ok", delRes.ok === true);
check("deleted user is gone", (await byEmail("user1@test.com")) === undefined);
check("user.delete audit row written", (await auditCount("user.delete")) === 1);

// --- 6. Users: Founders ---------------------------------------------------------------
await throwsAsync("support blocked from founder grant", () => actions.adminUserGrantFounder.handler(ctxFor(support), { userId: fresh.id }));
await actions.adminUserGrantFounder.handler(ctxFor(admin), { userId: fresh.id });
const franAfter = await byEmail("fresh@test.com");
check("founder grant sets premium+founder", franAfter.tier === "premium" && franAfter.subscriptionStatus === "founder");
check("user.founder_grant audited", (await auditCount("user.founder_grant")) === 1);
await throwsAsync("double founder grant rejected", () => actions.adminUserGrantFounder.handler(ctxFor(admin), { userId: fresh.id }));
await actions.adminUserRevokeFounder.handler(ctxFor(admin), { userId: fresh.id });
const franRevoked = await byEmail("fresh@test.com");
check("founder revoke back to free", franRevoked.tier === "free" && franRevoked.subscriptionStatus === "inactive");
check("user.founder_revoke audited", (await auditCount("user.founder_revoke")) === 1);

// --- 7. Users: impersonation ---------------------------------------------------------------
await throwsAsync("non-admin blocked from impersonate start", () => actions.adminImpersonateStart.handler(ctxFor(support), { userId: fresh.id }));
await throwsAsync("cannot impersonate self", () => actions.adminImpersonateStart.handler(ctxFor(admin), { userId: admin.id }));
await throwsAsync("cannot impersonate another admin", () => actions.adminImpersonateStart.handler(ctxFor(admin), { userId: admin2.id }));
const imp = await actions.adminImpersonateStart.handler(ctxFor(admin), { userId: fresh.id });
check("impersonate start returns proof", typeof imp.proof === "string" && imp.proof.length > 32 && imp.userName === "Fresh Fran");
check("user.impersonate_start audited", (await auditCount("user.impersonate_start")) === 1);
const impSessions = await db.select().from(schema.authSessions).where(eq(schema.authSessions.userId, fresh.id));
check("impersonation session flagged", impSessions.some((s) => s.impersonatedBy === admin.id));
// End via the impersonation proof itself (no admin role needed).
const endCtx = { ...ctxFor(admin), workspaceUserId: fresh.id };
const ended = await actions.adminImpersonateEnd.handler(endCtx, { _sessionToken: imp.proof });
check("impersonate end returns ok", ended.ok === true);
check("user.impersonate_end audited", (await auditCount("user.impersonate_end")) === 1);
await throwsAsync("double end rejected", () => actions.adminImpersonateEnd.handler(endCtx, { _sessionToken: imp.proof }));

// --- 8. Team roles: matrix ---------------------------------------------------------------
check("adminMyTeamRole: admin", (await actions.adminMyTeamRole.handler(ctxFor(admin), {})).role === "admin");
check("adminMyTeamRole: support", (await actions.adminMyTeamRole.handler(ctxFor(support), {})).role === "support");
check("adminMyTeamRole: moderator", (await actions.adminMyTeamRole.handler(ctxFor(mod), {})).role === "moderator");
check("adminMyTeamRole: plain user null", (await actions.adminMyTeamRole.handler(ctxFor(fresh), {})).role === null);
// Support: suspend ok, refund/ban blocked.
await actions.adminUserSuspend.handler(ctxFor(support), { userId: fresh.id });
check("support can suspend", (await byEmail("fresh@test.com")).suspendedAt != null);
await actions.adminUserUnsuspend.handler(ctxFor(support), { userId: fresh.id });
await throwsAsync("support blocked from refunds", () => actions.adminRefund.handler(ctxFor(support), { chargeId: "ch_x", reason: "" }));
await throwsAsync("support blocked from abuse.block (ban)", () => actions.adminBlockUser.handler(ctxFor(support), { userId: fresh.id, reason: "" }));
// Moderator: moderation ok, billing blocked.
await throwsAsync("moderator blocked from billing", () => actions.adminFailedPayments.handler(ctxFor(mod), {}));
await throwsAsync("moderator blocked from user suspend", () => actions.adminUserSuspend.handler(ctxFor(mod), { userId: fresh.id }));
// Team management is admin-only.
await throwsAsync("support blocked from team set", () => actions.adminTeamSetRole.handler(ctxFor(support), { userId: fresh.id, role: "support" }));
const teamBefore = await actions.adminTeamList.handler(ctxFor(admin), {});
check("team list has 2 platform admins + 2 roles", teamBefore.members.length === 4, String(teamBefore.members.length));
await actions.adminTeamSetRole.handler(ctxFor(admin), { userId: fresh.id, role: "moderator" });
check("team.role_set audited", (await auditCount("team.role_set")) === 1);
await throwsAsync("cannot change own role", () => actions.adminTeamSetRole.handler(ctxFor(admin), { userId: admin.id, role: "support" }));
await actions.adminTeamRemoveRole.handler(ctxFor(admin), { userId: fresh.id });
check("team.role_removed audited", (await auditCount("team.role_removed")) === 1);

// --- 9. Billing: promo codes (mocked Stripe) + plans ---------------------------------------------------------------
const stripeMock = async (name: string, args: any) => {
  if (name === "createStripeCoupon") return { id: "coupon_test123", code: args.code.toUpperCase(), percentOff: args.percentOff ?? null, amountOff: null, duration: args.duration };
  if (name === "listStripeCoupons") return { configured: true, coupons: [] };
  if (name === "deleteStripeCoupon") return { ok: true, id: args.couponId };
  throw new Error(`unexpected privileged call: ${name}`);
};
await throwsAsync("moderator blocked from promo create", () =>
  actions.adminPromoCodeCreate.handler(ctxFor(mod, stripeMock), { code: "SAVE20", percentOff: 20, duration: "once", durationInMonths: 3 }));
const promo = await actions.adminPromoCodeCreate.handler(ctxFor(admin, stripeMock), { code: "SAVE20", percentOff: 20, duration: "once", durationInMonths: 3 });
check("promo created", promo.id === "coupon_test123");
check("billing.promo_create audited", (await auditCount("billing.promo_create")) === 1);
const promoLog = await db.select().from(schema.promoCodeLog).where(eq(schema.promoCodeLog.stripeCouponId, "coupon_test123"));
check("promo logged locally", promoLog.length === 1);
await actions.adminPromoCodeDelete.handler(ctxFor(admin, stripeMock), { couponId: "coupon_test123" });
check("billing.promo_delete audited", (await auditCount("billing.promo_delete")) === 1);
await actions.adminPlansUpdate.handler(ctxFor(admin), { name: "Crewkat Premium", priceCents: 1900, interval: "month" });
const planName = (await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, "plan_pro_name")))[0]?.value;
check("plan metadata updated", planName === "Crewkat Premium");
check("billing.plan_update audited", (await auditCount("billing.plan_update")) === 1);
const plans = await actions.adminPlansGet.handler(ctxFor(admin), {});
check("adminPlansGet returns metadata", plans.priceCents === 1900 && plans.stripePriceId === "price_1UK81ZAZoTlhRfFcUEqPjzxa");

// --- 10. Moderation: keyword rules + new-user cap ---------------------------------------------------------------
const listingArgs = (description: string) => ({
  title: "Test listing", category: "handyman", intent: "offer", neededBy: "", employmentType: "full_time", payUnit: "hourly",
  priceKind: "contact", price: "", originalPrice: "", description, serviceArea: "Tampa", zipCode: "33601",
  companyName: "Test Co", companyPhone: "8135550100", bookable: false, dailyRate: "", photos: [],
});
await actions.adminKeywordRuleAdd.handler(ctxFor(mod), { pattern: "holdme", action: "hold", note: "" });
check("moderation.keyword_rule_add audited", (await auditCount("moderation.keyword_rule_add")) === 1);
const held = await actions.createMarketplaceListing.handler(ctxFor(fresh), listingArgs("this one says holdme inside"));
check("keyword hold -> pending_review", held.moderation.status === "pending_review", held.moderation.status);
await actions.adminKeywordRuleAdd.handler(ctxFor(admin), { pattern: "flagme", action: "flag", note: "" });
const flagged = await actions.createMarketplaceListing.handler(ctxFor(fresh), listingArgs("this one says flagme inside"));
const flaggedRow = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, flagged.id)))[0];
check("keyword flag -> flagCount bumped", (flaggedRow?.flagCount ?? 0) >= 1, String(flaggedRow?.flagCount));
// New-user cap: fresh is < 7 days old; set cap to 2 (2 listings already made above).
await db.update(schema.platformSettings).set({ value: "2", updatedAt: now }).where(eq(schema.platformSettings.key, "automod_new_user_listing_cap"));
await throwsAsync("new-user cap enforced", () => actions.createMarketplaceListing.handler(ctxFor(fresh), listingArgs("a third listing today")));
// A moderator can decide the held listing.
const queue = await actions.adminModerationQueue.handler(ctxFor(mod), {});
check("moderator sees queue", Array.isArray(queue.queue));
await actions.adminListingDecision.handler(ctxFor(mod), { listingId: held.id, decision: "approve", note: "" });
const approvedRow = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, held.id)))[0];
check("moderator approve works", approvedRow?.moderationStatus === "active");

// --- 11. Moderation: user reports + hide ---------------------------------------------------------------
// Seed a user report against a message-less target (user).
await db.insert(schema.userReports).values({ targetType: "user", targetId: fresh.id, reporterUserId: support.id, reason: "spam", details: "spamming", status: "open", createdAt: now });
const reports = await actions.adminUserReports.handler(ctxFor(mod), {});
check("user reports listed", reports.reports.length === 1 && reports.reports[0].targetName === "Fresh Fran", JSON.stringify(reports.reports.length));
await throwsAsync("support blocked from user reports", () => actions.adminUserReports.handler(ctxFor(support), {}));
await actions.adminUserReportDecide.handler(ctxFor(mod), { reportId: reports.reports[0].id, decision: "reviewed_ok", note: "" });
check("moderation.report_decide audited", (await auditCount("moderation.report_decide")) === 1);
// Content hide/unhide on a listing.
await actions.adminContentHide.handler(ctxFor(mod), { kind: "listing", id: flagged.id, reason: "test hide" });
const hiddenRow = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, flagged.id)))[0];
check("content hide -> removed", hiddenRow?.moderationStatus === "removed");
check("moderation.content_hide audited", (await auditCount("moderation.content_hide")) === 1);
await actions.adminContentUnhide.handler(ctxFor(mod), { kind: "listing", id: flagged.id });
const unhiddenRow = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, flagged.id)))[0];
check("content unhide -> active", unhiddenRow?.moderationStatus === "active");
await actions.adminKeywordRuleDelete.handler(ctxFor(admin), { id: 1 });
check("moderation.keyword_rule_delete audited", (await auditCount("moderation.keyword_rule_delete")) === 1);

// --- 12. Audit search -------------------------------------------------------------------------------
const search = await actions.adminAuditLogSearch.handler(ctxFor(admin), { page: 1, pageSize: 25, action: "user.", targetType: "", from: "", to: "" });
check("audit search filters by action", search.entries.length > 0 && search.entries.every((e: any) => e.action.includes("user.")));
const searchTarget = await actions.adminAuditLogSearch.handler(ctxFor(admin), { page: 1, pageSize: 25, action: "", targetType: "stripe_coupon", from: "", to: "" });
check("audit search filters by targetType", searchTarget.entries.length === 2 && searchTarget.entries.every((e: any) => e.targetType === "stripe_coupon"), String(searchTarget.entries.length));
await throwsAsync("support blocked from audit search", () => actions.adminAuditLogSearch.handler(ctxFor(support), { page: 1, pageSize: 25, action: "", targetType: "", from: "", to: "" }));

console.log(failures === 0 ? "\nALL PHASE 1 CHECKS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
