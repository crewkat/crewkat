// Platform admin Phase 1 (2026-10-09): Users (delete, Founders grants,
// impersonation with audit, team roles), Billing (subscriptions, payments,
// failed payments, plans, promo codes), Moderation (user reports, content
// hide/unhide, keyword rules). Every mutating action writes an audit entry.
//
// Guards: admin-only unless the permission matrix says otherwise —
//   adminTeamRole gating via requireTeamRole (platform-admin.ts).
import { defineAction, z, type Ctx } from "@hatch/space-sdk";
import { and, desc, eq, isNull, like, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import * as schema from "./schema";
import {
  deleteUserAccount,
  getPlatformSetting,
  logAdminAction,
  platformDb,
} from "./actions";
import { requireTeamRole, teamRoleOf, TEAM_ROLES, type TeamRole } from "./platform-admin";
import { privileged } from "@space/privileged";

type Db = ReturnType<Ctx["db"]>;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomHex(bytes = 48): string {
  return randomBytes(bytes).toString("hex");
}

async function getUserOrThrow(db: Db, userId: number) {
  const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, userId)).limit(1))[0];
  if (!user) throw new Error("User not found.");
  return user;
}

async function upsertPlatformSetting(db: Db, key: string, value: string): Promise<void> {
  const now = new Date();
  const existing = (await db.select({ key: schema.platformSettings.key }).from(schema.platformSettings).where(eq(schema.platformSettings.key, key)).limit(1))[0];
  if (existing) await db.update(schema.platformSettings).set({ value, updatedAt: now }).where(eq(schema.platformSettings.key, key));
  else await db.insert(schema.platformSettings).values({ key, value, updatedAt: now });
}

export const platformAdminPhase1Actions = {
  // -----------------------------------------------------------------------
  // Users
  // -----------------------------------------------------------------------

  /** Admin-only: permanently delete an account, reusing the self-service
   *  deletion machinery. Never self, never another platform admin. */
  adminUserDelete: defineAction({
    request: z.object({ userId: z.number().int().positive(), reason: z.string().trim().max(500).default("") }),
    response: z.object({ ok: z.literal(true), tablesCleared: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; tablesCleared: number }> {
      const { admin } = await requireTeamRole(ctx, "admin");
      const db = platformDb(ctx);
      const target = await getUserOrThrow(db, args.userId);
      if (target.id === admin.id) throw new Error("You can't delete your own account.");
      if (target.isPlatformAdmin) throw new Error("Platform admin accounts can't be deleted from here.");
      const { tablesCleared, soleUser } = await deleteUserAccount(db, target);
      await logAdminAction(db, admin.id, "user.delete", "auth_user", String(target.id),
        `${target.name} <${target.email}> — ${soleUser ? `company ${target.companyId} data cleared (${tablesCleared} tables)` : "personal rows removed"}${args.reason ? ` — ${args.reason}` : ""}`);
      ctx.invalidateQueries();
      return { ok: true, tablesCleared };
    },
  }),

  /** Admin-only: grant Founders (lifetime) status — premium tier, never billed. */
  adminUserGrantFounder: defineAction({
    request: z.object({ userId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requireTeamRole(ctx, "admin");
      const db = platformDb(ctx);
      const target = await getUserOrThrow(db, args.userId);
      if (target.subscriptionStatus === "founder") throw new Error("This user already has Founders status.");
      await db.update(schema.authUsers).set({ tier: "premium", subscriptionStatus: "founder", cancelAtPeriodEnd: false, updatedAt: new Date() }).where(eq(schema.authUsers.id, target.id));
      await logAdminAction(db, admin.id, "user.founder_grant", "auth_user", String(target.id), `${target.name} <${target.email}> granted Founders (lifetime) status`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminUserRevokeFounder: defineAction({
    request: z.object({ userId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requireTeamRole(ctx, "admin");
      const db = platformDb(ctx);
      const target = await getUserOrThrow(db, args.userId);
      if (target.subscriptionStatus !== "founder") throw new Error("This user doesn't have Founders status.");
      await db.update(schema.authUsers).set({ tier: "free", subscriptionStatus: "inactive", updatedAt: new Date() }).where(eq(schema.authUsers.id, target.id));
      await logAdminAction(db, admin.id, "user.founder_revoke", "auth_user", String(target.id), `${target.name} <${target.email}> Founders status revoked`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /** Admin-only: open an impersonation session. Mints a 30-minute proof
   *  session for the target user, flagged with impersonated_by. Logged. */
  adminImpersonateStart: defineAction({
    request: z.object({ userId: z.number().int().positive() }),
    response: z.object({ proof: z.string(), expiresAt: z.string(), userName: z.string(), userEmail: z.string() }),
    async handler(ctx, args) {
      const { admin } = await requireTeamRole(ctx, "admin");
      const db = platformDb(ctx);
      const target = await getUserOrThrow(db, args.userId);
      if (target.id === admin.id) throw new Error("You can't impersonate yourself.");
      if (target.isPlatformAdmin) throw new Error("You can't impersonate another platform admin.");
      if (target.suspendedAt) throw new Error("This account is suspended — unsuspend it first to impersonate.");
      if (!target.emailVerifiedAt) throw new Error("This account hasn't verified its email yet.");
      const meta = ctx as Ctx & { userAgent?: string; ipHash?: string };
      const now = new Date();
      const proof = randomHex();
      const expiresAt = new Date(now.getTime() + 30 * 60_000);
      await db.insert(schema.authSessions).values({
        userId: target.id, tokenHash: sha256Hex(proof), tokenType: "proof",
        expiresAt, lastSeenAt: now, createdAt: now,
        userAgent: `impersonation/${(meta.userAgent ?? "").slice(0, 280)}`,
        ipHash: meta.ipHash ?? "",
        impersonatedBy: admin.id,
      });
      await logAdminAction(db, admin.id, "user.impersonate_start", "auth_user", String(target.id),
        `${admin.name} started impersonating ${target.name} <${target.email}> (30 min)`);
      return { proof, expiresAt: expiresAt.toISOString(), userName: target.name, userEmail: target.email };
    },
  }),

  /** Ends an impersonation session. Called while holding the impersonation
   *  proof — no team role needed; the session row itself is the credential. */
  adminImpersonateEnd: defineAction({
    // Inline envelope (not authEnvelopeSchema): actions.ts imports this module,
    // so referencing its const at module-eval time hits TDZ.
    request: z.object({ _sessionToken: z.string().min(32).max(300) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = platformDb(ctx);
      const session = (await db.select().from(schema.authSessions).where(and(
        eq(schema.authSessions.tokenHash, sha256Hex(args._sessionToken)),
        isNull(schema.authSessions.revokedAt),
      )).limit(1))[0];
      if (!session || session.impersonatedBy == null) throw new Error("No active impersonation session found.");
      const target = await getUserOrThrow(db, session.userId);
      await db.update(schema.authSessions).set({ revokedAt: new Date() }).where(eq(schema.authSessions.id, session.id));
      await logAdminAction(db, session.impersonatedBy, "user.impersonate_end", "auth_user", String(target.id),
        `Impersonation of ${target.name} <${target.email}> ended`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // -- Team roles ------------------------------------------------------------

  adminTeamList: defineAction({
    request: z.object({}),
    response: z.object({
      members: z.array(z.object({
        userId: z.number(), name: z.string(), email: z.string(), role: z.string(),
        grantedByName: z.string().nullable(), createdAt: z.string(),
      })),
    }),
    async handler(ctx) {
      // Support staff assign tickets, so they need the team list too.
      await requireTeamRole(ctx, "admin", "support");
      const db = platformDb(ctx);
      const rows = await db.select().from(schema.adminTeamRoles).orderBy(schema.adminTeamRoles.createdAt);
      const admins = await db.select({ id: schema.authUsers.id, name: schema.authUsers.name, email: schema.authUsers.email }).from(schema.authUsers).where(eq(schema.authUsers.isPlatformAdmin, true));
      const roleUserIds = rows.map((r) => r.userId);
      const roleUsers = roleUserIds.length
        ? await db.select({ id: schema.authUsers.id, name: schema.authUsers.name, email: schema.authUsers.email }).from(schema.authUsers).where(sql`${schema.authUsers.id} IN (${sql.join(roleUserIds.map((id) => sql`${id}`), sql`, `)})`)
        : [];
      const byId = new Map(roleUsers.map((u) => [u.id, u]));
      const granters = new Map(admins.map((a) => [a.id, a.name]));
      const members = [
        ...admins.map((a) => ({ userId: a.id, name: a.name, email: a.email, role: "admin" as string, grantedByName: null as string | null, createdAt: "" })),
        ...rows.map((r) => {
          const u = byId.get(r.userId);
          return {
            userId: r.userId, name: u?.name ?? `#${r.userId}`, email: u?.email ?? "",
            role: r.role as string,
            grantedByName: r.grantedBy != null ? (granters.get(r.grantedBy) ?? null) : null,
            createdAt: r.createdAt.toISOString(),
          };
        }),
      ];
      return { members };
    },
  }),

  adminTeamSetRole: defineAction({
    request: z.object({ userId: z.number().int().positive(), role: z.enum(TEAM_ROLES) }),
    response: z.object({ ok: z.literal(true), role: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; role: string }> {
      const { admin } = await requireTeamRole(ctx, "admin");
      const db = platformDb(ctx);
      const target = await getUserOrThrow(db, args.userId);
      if (target.id === admin.id) throw new Error("You can't change your own role.");
      if (target.isPlatformAdmin) throw new Error("Platform admins already have full access.");
      if (args.role === "admin") throw new Error("Use the platform admin flag for full admins — team roles are support/moderator.");
      const now = new Date();
      const existing = (await db.select({ userId: schema.adminTeamRoles.userId }).from(schema.adminTeamRoles).where(eq(schema.adminTeamRoles.userId, target.id)).limit(1))[0];
      if (existing) await db.update(schema.adminTeamRoles).set({ role: args.role, grantedBy: admin.id, updatedAt: now }).where(eq(schema.adminTeamRoles.userId, target.id));
      else await db.insert(schema.adminTeamRoles).values({ userId: target.id, role: args.role, grantedBy: admin.id, createdAt: now, updatedAt: now });
      await logAdminAction(db, admin.id, "team.role_set", "auth_user", String(target.id), `${target.name} <${target.email}> → ${args.role}`);
      ctx.invalidateQueries();
      return { ok: true, role: args.role };
    },
  }),

  adminTeamRemoveRole: defineAction({
    request: z.object({ userId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requireTeamRole(ctx, "admin");
      const db = platformDb(ctx);
      const target = await getUserOrThrow(db, args.userId);
      if (target.id === admin.id) throw new Error("You can't remove your own role.");
      await db.delete(schema.adminTeamRoles).where(eq(schema.adminTeamRoles.userId, target.id));
      await logAdminAction(db, admin.id, "team.role_removed", "auth_user", String(target.id), `${target.name} <${target.email}> team role removed`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /** Any signed-in user: their own effective team role (drives admin UI gating). */
  adminMyTeamRole: defineAction({
    request: z.object({}),
    response: z.object({ role: z.string().nullable() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const identity = (ctx as { workspaceUserId?: number }).workspaceUserId;
      if (!identity) return { role: null };
      const user = (await db.select({ id: schema.authUsers.id, isPlatformAdmin: schema.authUsers.isPlatformAdmin }).from(schema.authUsers).where(eq(schema.authUsers.id, identity)).limit(1))[0];
      if (!user) return { role: null };
      const role: TeamRole | null = await teamRoleOf(db, { id: user.id, isPlatformAdmin: user.isPlatformAdmin });
      return { role };
    },
  }),

  // -----------------------------------------------------------------------
  // Billing (admin-only; Stripe is live, local DB is never the source of truth)
  // -----------------------------------------------------------------------

  adminSubscriptionsList: defineAction({
    request: z.object({ status: z.enum(["active", "trialing", "past_due", "canceled", "all"]).default("all"), limit: z.number().int().min(1).max(100).default(25), startingAfter: z.string().max(200).optional() }),
    response: z.object({
      configured: z.boolean(),
      subscriptions: z.array(z.object({
        id: z.string(), customerId: z.string(), customerEmail: z.string().nullable(), status: z.string(),
        amountCents: z.number(), interval: z.string(), currentPeriodEnd: z.number().nullable(), cancelAtPeriodEnd: z.boolean(),
      })),
      hasMore: z.boolean(),
    }),
    async handler(ctx, args) {
      await requireTeamRole(ctx, "admin");
      return ctx.executePrivileged(privileged.listStripeSubscriptions, args);
    },
  }),

  adminPaymentsList: defineAction({
    request: z.object({ limit: z.number().int().min(1).max(100).default(25), startingAfter: z.string().max(200).optional() }),
    response: z.object({
      configured: z.boolean(),
      charges: z.array(z.object({
        id: z.string(), amount: z.number(), amountRefunded: z.number(), currency: z.string(),
        created: z.number(), status: z.string(), customerEmail: z.string().nullable(), description: z.string().nullable(),
      })),
      hasMore: z.boolean(),
    }),
    async handler(ctx, args) {
      await requireTeamRole(ctx, "admin");
      return ctx.executePrivileged(privileged.listStripePayments, args);
    },
  }),

  adminFailedPayments: defineAction({
    request: z.object({}),
    response: z.object({
      configured: z.boolean(),
      failed: z.array(z.object({
        invoiceId: z.string(), customerEmail: z.string().nullable(), amountCents: z.number(),
        currency: z.string(), status: z.string(), attemptCount: z.number(),
        nextRetryAt: z.number().nullable(), created: z.number(),
      })),
    }),
    async handler(ctx) {
      await requireTeamRole(ctx, "admin");
      return ctx.executePrivileged(privileged.listStripeFailedPayments, {});
    },
  }),

  /** Plan metadata lives in platform_settings. The live Stripe Price is never
   *  rewritten here — the UI says so explicitly. */
  adminPlansGet: defineAction({
    request: z.object({}),
    response: z.object({ name: z.string(), priceCents: z.number(), interval: z.string(), stripePriceId: z.string() }),
    async handler(ctx) {
      await requireTeamRole(ctx, "admin");
      const db = platformDb(ctx);
      const [name, priceCents, interval] = await Promise.all([
        getPlatformSetting(db, "plan_pro_name", "Crewkat Premium"),
        getPlatformSetting(db, "plan_pro_price_cents", "1900"),
        getPlatformSetting(db, "plan_pro_interval", "month"),
      ]);
      return { name, priceCents: Number.parseInt(priceCents, 10) || 1900, interval, stripePriceId: "price_1UK81ZAZoTlhRfFcUEqPjzxa" };
    },
  }),

  adminPlansUpdate: defineAction({
    request: z.object({ name: z.string().trim().min(2).max(80), priceCents: z.number().int().min(100).max(100000), interval: z.enum(["month", "year"]) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requireTeamRole(ctx, "admin");
      const db = platformDb(ctx);
      await upsertPlatformSetting(db, "plan_pro_name", args.name);
      await upsertPlatformSetting(db, "plan_pro_price_cents", String(args.priceCents));
      await upsertPlatformSetting(db, "plan_pro_interval", args.interval);
      await logAdminAction(db, admin.id, "billing.plan_update", "platform_setting", "plan_pro",
        `${args.name} — ${(args.priceCents / 100).toFixed(2)}/${args.interval} (metadata only; Stripe Price untouched)`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminPromoCodesList: defineAction({
    request: z.object({}),
    response: z.object({
      configured: z.boolean(),
      coupons: z.array(z.object({
        id: z.string(), code: z.string().nullable(), percentOff: z.number().nullable(),
        amountOff: z.number().nullable(), currency: z.string().nullable(),
        duration: z.string(), timesRedeemed: z.number(),
      })),
    }),
    async handler(ctx) {
      await requireTeamRole(ctx, "admin");
      return ctx.executePrivileged(privileged.listStripeCoupons, { limit: 25 });
    },
  }),

  adminPromoCodeCreate: defineAction({
    request: z.object({
      code: z.string().trim().min(2).max(40).regex(/^[a-zA-Z0-9-_]+$/, "Letters, numbers, dashes and underscores only."),
      percentOff: z.number().min(1).max(100).optional(),
      amountOffCents: z.number().int().positive().max(100000).optional(),
      duration: z.enum(["once", "repeating", "forever"]).default("once"),
      durationInMonths: z.number().int().min(1).max(36).default(3),
    }),
    response: z.object({ id: z.string(), code: z.string().nullable() }),
    async handler(ctx, args) {
      const { admin } = await requireTeamRole(ctx, "admin");
      const db = platformDb(ctx);
      const coupon = await ctx.executePrivileged(privileged.createStripeCoupon, {
        code: args.code, percentOff: args.percentOff, amountOffCents: args.amountOffCents,
        duration: args.duration, durationInMonths: args.durationInMonths,
      });
      await db.insert(schema.promoCodeLog).values({
        stripeCouponId: coupon.id, code: coupon.code ?? args.code.toUpperCase(),
        percentOff: coupon.percentOff ?? undefined, amountOffCents: coupon.amountOff ?? undefined,
        duration: coupon.duration, createdBy: admin.id, createdAt: new Date(),
      }).onConflictDoNothing();
      const desc = coupon.percentOff ? `${coupon.percentOff}% off` : `$${((coupon.amountOff ?? 0) / 100).toFixed(2)} off`;
      await logAdminAction(db, admin.id, "billing.promo_create", "stripe_coupon", coupon.id, `${coupon.code} — ${desc} (${coupon.duration})`);
      ctx.invalidateQueries();
      return { id: coupon.id, code: coupon.code };
    },
  }),

  adminPromoCodeDelete: defineAction({
    request: z.object({ couponId: z.string().min(1).max(200) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requireTeamRole(ctx, "admin");
      const db = platformDb(ctx);
      await ctx.executePrivileged(privileged.deleteStripeCoupon, { couponId: args.couponId });
      await db.delete(schema.promoCodeLog).where(eq(schema.promoCodeLog.stripeCouponId, args.couponId));
      await logAdminAction(db, admin.id, "billing.promo_delete", "stripe_coupon", args.couponId, "coupon deleted");
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // -----------------------------------------------------------------------
  // Moderation (admin + moderator)
  // -----------------------------------------------------------------------

  /** Open user/message reports. (Listing flags stay in adminModerationQueue.) */
  adminUserReports: defineAction({
    request: z.object({}),
    response: z.object({
      reports: z.array(z.object({
        id: z.number(), targetType: z.string(), targetId: z.number(),
        targetName: z.string(), reporterName: z.string(),
        reason: z.string(), details: z.string(), createdAt: z.string(),
      })),
    }),
    async handler(ctx) {
      await requireTeamRole(ctx, "admin", "moderator");
      const db = platformDb(ctx);
      const rows = await db.select().from(schema.userReports).where(eq(schema.userReports.status, "open")).orderBy(desc(schema.userReports.createdAt));
      const userIds = [...new Set(rows.flatMap((r) => [r.reporterUserId, r.targetType === "user" ? r.targetId : null]).filter((id): id is number => typeof id === "number"))];
      const users = userIds.length
        ? await db.select({ id: schema.authUsers.id, name: schema.authUsers.name }).from(schema.authUsers).where(sql`${schema.authUsers.id} IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`)
        : [];
      const nameById = new Map(users.map((u) => [u.id, u.name]));
      const messageIds = rows.filter((r) => r.targetType === "message").map((r) => r.targetId);
      const messages = messageIds.length
        ? await db.select({ id: schema.marketplaceMessages.id, body: schema.marketplaceMessages.body }).from(schema.marketplaceMessages).where(sql`${schema.marketplaceMessages.id} IN (${sql.join(messageIds.map((id) => sql`${id}`), sql`, `)})`)
        : [];
      const bodyById = new Map(messages.map((m) => [m.id, m.body]));
      return {
        reports: rows.map((r) => ({
          id: r.id, targetType: r.targetType, targetId: r.targetId,
          targetName: r.targetType === "user" ? (nameById.get(r.targetId) ?? `#${r.targetId}`) : (bodyById.get(r.targetId)?.slice(0, 80) ?? `#${r.targetId}`),
          reporterName: r.reporterUserId != null ? (nameById.get(r.reporterUserId) ?? "—") : "—",
          reason: r.reason, details: r.details, createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  }),

  adminUserReportDecide: defineAction({
    request: z.object({ reportId: z.number().int().positive(), decision: z.enum(["reviewed_ok", "reviewed_actioned"]), note: z.string().trim().max(500).default("") }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requireTeamRole(ctx, "admin", "moderator");
      const db = platformDb(ctx);
      const now = new Date();
      const report = (await db.select().from(schema.userReports).where(eq(schema.userReports.id, args.reportId)).limit(1))[0];
      if (!report) throw new Error("Report not found.");
      if (report.status !== "open") throw new Error("This report was already decided.");
      await db.update(schema.userReports).set({ status: args.decision, decidedBy: admin.id, decidedAt: now, decisionNote: args.note }).where(eq(schema.userReports.id, args.reportId));
      await logAdminAction(db, admin.id, "moderation.report_decide", "user_report", String(args.reportId),
        `${report.targetType} #${report.targetId} → ${args.decision}${args.note ? ` — ${args.note}` : ""}`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /** Hide (removed) or unhide (active) a listing; hide/unhide a message. */
  adminContentHide: defineAction({
    request: z.object({ kind: z.enum(["listing", "message"]), id: z.number().int().positive(), reason: z.string().trim().max(300).default("") }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requireTeamRole(ctx, "admin", "moderator");
      const db = platformDb(ctx);
      const now = new Date();
      if (args.kind === "listing") {
        const listing = (await db.select({ id: schema.marketplaceListings.id, title: schema.marketplaceListings.title }).from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, args.id)).limit(1))[0];
        if (!listing) throw new Error("Listing not found.");
        await db.update(schema.marketplaceListings).set({ moderationStatus: "removed", moderationReason: args.reason || "Hidden by moderation.", updatedAt: now }).where(eq(schema.marketplaceListings.id, args.id));
        await db.update(schema.marketplaceFlags).set({ status: "reviewed_removed" }).where(and(eq(schema.marketplaceFlags.listingId, args.id), eq(schema.marketplaceFlags.status, "open")));
        await logAdminAction(db, admin.id, "moderation.content_hide", "marketplace_listing", String(args.id), `${listing.title}${args.reason ? ` — ${args.reason}` : ""}`);
      } else {
        const msg = (await db.select({ id: schema.marketplaceMessages.id }).from(schema.marketplaceMessages).where(eq(schema.marketplaceMessages.id, args.id)).limit(1))[0];
        if (!msg) throw new Error("Message not found.");
        await db.update(schema.marketplaceMessages).set({ hidden: true }).where(eq(schema.marketplaceMessages.id, args.id));
        await logAdminAction(db, admin.id, "moderation.content_hide", "marketplace_message", String(args.id), args.reason || "hidden by moderation");
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminContentUnhide: defineAction({
    request: z.object({ kind: z.enum(["listing", "message"]), id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requireTeamRole(ctx, "admin", "moderator");
      const db = platformDb(ctx);
      if (args.kind === "listing") {
        await db.update(schema.marketplaceListings).set({ moderationStatus: "active", moderationReason: "", updatedAt: new Date() }).where(eq(schema.marketplaceListings.id, args.id));
        await logAdminAction(db, admin.id, "moderation.content_unhide", "marketplace_listing", String(args.id), "restored to active");
      } else {
        await db.update(schema.marketplaceMessages).set({ hidden: false }).where(eq(schema.marketplaceMessages.id, args.id));
        await logAdminAction(db, admin.id, "moderation.content_unhide", "marketplace_message", String(args.id), "restored");
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminKeywordRulesList: defineAction({
    request: z.object({}),
    response: z.object({
      rules: z.array(z.object({ id: z.number(), pattern: z.string(), action: z.string(), note: z.string(), createdAt: z.string() })),
      newUserCap: z.object({ listingsPerDay: z.number(), newUserDays: z.number() }),
    }),
    async handler(ctx) {
      await requireTeamRole(ctx, "admin", "moderator");
      const db = platformDb(ctx);
      const rules = await db.select().from(schema.moderationKeywordRules).orderBy(schema.moderationKeywordRules.pattern);
      const [capRaw, daysRaw] = await Promise.all([
        getPlatformSetting(db, "automod_new_user_listing_cap", "3"),
        getPlatformSetting(db, "automod_new_user_days", "7"),
      ]);
      return {
        rules: rules.map((r) => ({ id: r.id, pattern: r.pattern, action: r.action, note: r.note, createdAt: r.createdAt.toISOString() })),
        newUserCap: { listingsPerDay: Number.parseInt(capRaw, 10) || 3, newUserDays: Number.parseInt(daysRaw, 10) || 7 },
      };
    },
  }),

  adminKeywordRuleAdd: defineAction({
    request: z.object({ pattern: z.string().trim().min(2).max(120), action: z.enum(["flag", "hold"]).default("flag"), note: z.string().trim().max(300).default("") }),
    response: z.object({ ok: z.literal(true), id: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; id: number }> {
      const { admin } = await requireTeamRole(ctx, "admin", "moderator");
      const db = platformDb(ctx);
      const dupe = (await db.select({ id: schema.moderationKeywordRules.id }).from(schema.moderationKeywordRules).where(sql`lower(${schema.moderationKeywordRules.pattern}) = ${args.pattern.toLowerCase()}`).limit(1))[0];
      if (dupe) throw new Error("A rule with this pattern already exists.");
      const made = (await db.insert(schema.moderationKeywordRules).values({ pattern: args.pattern, action: args.action, note: args.note, createdBy: admin.id, createdAt: new Date() }).returning({ id: schema.moderationKeywordRules.id }))[0];
      if (!made) throw new Error("Could not save the rule.");
      await logAdminAction(db, admin.id, "moderation.keyword_rule_add", "moderation_keyword_rule", String(made.id), `"${args.pattern}" → ${args.action}${args.note ? ` — ${args.note}` : ""}`);
      ctx.invalidateQueries();
      return { ok: true, id: made.id };
    },
  }),

  adminKeywordRuleDelete: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requireTeamRole(ctx, "admin", "moderator");
      const db = platformDb(ctx);
      const rule = (await db.select().from(schema.moderationKeywordRules).where(eq(schema.moderationKeywordRules.id, args.id)).limit(1))[0];
      if (!rule) throw new Error("Rule not found.");
      await db.delete(schema.moderationKeywordRules).where(eq(schema.moderationKeywordRules.id, args.id));
      await logAdminAction(db, admin.id, "moderation.keyword_rule_delete", "moderation_keyword_rule", String(args.id), `"${rule.pattern}" removed`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminAutomodCapSet: defineAction({
    request: z.object({ listingsPerDay: z.number().int().min(1).max(50), newUserDays: z.number().int().min(1).max(90) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requireTeamRole(ctx, "admin", "moderator");
      const db = platformDb(ctx);
      await upsertPlatformSetting(db, "automod_new_user_listing_cap", String(args.listingsPerDay));
      await upsertPlatformSetting(db, "automod_new_user_days", String(args.newUserDays));
      await logAdminAction(db, admin.id, "moderation.automod_cap_set", "platform_setting", "automod_new_user_listing_cap",
        `new-user cap: ${args.listingsPerDay}/day for first ${args.newUserDays} days`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // -----------------------------------------------------------------------
  // Audit log: extended filters (action contains, target type, admin, dates)
  // -----------------------------------------------------------------------

  adminAuditLogSearch: defineAction({
    request: z.object({
      action: z.string().trim().max(80).default(""),
      targetType: z.string().trim().max(40).default(""),
      adminUserId: z.number().int().positive().optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
    }),
    response: z.object({
      entries: z.array(z.object({
        id: z.number(), action: z.string(), targetType: z.string(), targetId: z.string(),
        details: z.string(), adminName: z.string(), createdAt: z.string(),
      })),
      total: z.number(), page: z.number(), pageSize: z.number(),
    }),
    async handler(ctx, args) {
      await requireTeamRole(ctx, "admin");
      const db = platformDb(ctx);
      const conds = [];
      if (args.action) conds.push(like(schema.adminAuditLog.action, `%${args.action}%`));
      if (args.targetType) conds.push(eq(schema.adminAuditLog.targetType, args.targetType));
      if (args.adminUserId) conds.push(eq(schema.adminAuditLog.adminUserId, args.adminUserId));
      if (args.from) conds.push(sql`${schema.adminAuditLog.createdAt} >= ${new Date(`${args.from}T00:00:00Z`).getTime()}`);
      if (args.to) conds.push(sql`${schema.adminAuditLog.createdAt} < ${new Date(`${args.to}T00:00:00Z`).getTime() + 86400000}`);
      const where = conds.length ? and(...conds) : undefined;
      const total = (await db.select({ n: sql<number>`count(*)` }).from(schema.adminAuditLog).where(where))[0]?.n ?? 0;
      const rows = await db.select({
        id: schema.adminAuditLog.id, action: schema.adminAuditLog.action,
        targetType: schema.adminAuditLog.targetType, targetId: schema.adminAuditLog.targetId,
        details: schema.adminAuditLog.details, createdAt: schema.adminAuditLog.createdAt,
        adminName: schema.authUsers.name, adminUserId: schema.adminAuditLog.adminUserId,
      })
        .from(schema.adminAuditLog)
        .leftJoin(schema.authUsers, eq(schema.adminAuditLog.adminUserId, schema.authUsers.id))
        .where(where)
        .orderBy(desc(schema.adminAuditLog.createdAt), desc(schema.adminAuditLog.id))
        .limit(args.pageSize)
        .offset((args.page - 1) * args.pageSize);
      return {
        entries: rows.map((r) => ({
          id: r.id, action: r.action, targetType: r.targetType, targetId: r.targetId,
          details: r.details, adminName: r.adminName ?? (r.adminUserId === 0 ? "System" : "—"),
          createdAt: r.createdAt.toISOString(),
        })),
        total, page: args.page, pageSize: args.pageSize,
      };
    },
  }),
};

