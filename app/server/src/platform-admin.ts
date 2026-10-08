// Platform admin suite (2026-10-07): broadcast pushes, business verification,
// revenue dashboard, feature flags, read-only support view, audit logging,
// and abuse controls (send caps + auto-block).
//
// Every action here except getFeatureFlags requires is_platform_admin
// (server-side, via requirePlatformAdmin — never trust the client).
import { defineAction, z, type Ctx } from "@hatch/space-sdk";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "./schema";
import { getPlatformSetting, logAdminAction, platformDb, requirePlatformAdmin } from "./actions";
import { privileged } from "@space/privileged";
import { sendPushToUser } from "./push";

type Db = ReturnType<Ctx["db"]>;

// ---------------------------------------------------------------------------
// Feature flags (canonical store; legacy platform_settings fallbacks).
// ---------------------------------------------------------------------------

export const FEATURE_FLAG_KEYS = ["marketplace_enabled", "signups_enabled", "broadcasts_enabled"] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

const FLAG_DESCRIPTIONS: Record<FeatureFlagKey, string> = {
  marketplace_enabled: "Marketplace listings, search, and messaging",
  signups_enabled: "New account registrations",
  broadcasts_enabled: "Admin broadcast push messages",
};

/** Reads a feature flag. Falls back to the legacy platform_settings keys (and
 *  safe defaults) on databases that predate the flags table. */
export async function isFeatureEnabled(db: Db, key: string): Promise<boolean> {
  try {
    const row = (await db.select({ enabled: schema.featureFlags.enabled }).from(schema.featureFlags).where(eq(schema.featureFlags.key, key)).limit(1))[0];
    if (row !== undefined) return row.enabled;
  } catch {
    // flags table missing (pre-migration DB) — use legacy settings below.
  }
  if (key === "marketplace_enabled") return (await getPlatformSetting(db, "marketplace_enabled", "1")) === "1";
  if (key === "signups_enabled") return (await getPlatformSetting(db, "registration_enabled", "1")) === "1";
  if (key === "broadcasts_enabled") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Abuse controls: caps, usage accounting, auto-block.
// ---------------------------------------------------------------------------

function parseCap(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

export async function getSendCaps(db: Db, userId: number): Promise<{ maxSmsPerDay: number; maxPushPerDay: number }> {
  const override = (await db.select().from(schema.sendCaps).where(eq(schema.sendCaps.userId, userId)).limit(1))[0];
  if (override) return { maxSmsPerDay: override.maxSmsPerDay, maxPushPerDay: override.maxPushPerDay };
  const [smsRaw, pushRaw] = await Promise.all([
    getPlatformSetting(db, "default_max_sms_per_day", "50"),
    getPlatformSetting(db, "default_max_push_per_day", "100"),
  ]);
  return { maxSmsPerDay: parseCap(smsRaw, 50), maxPushPerDay: parseCap(pushRaw, 100) };
}

export async function isSenderBlocked(db: Db, userId: number): Promise<boolean> {
  const row = (await db.select({ userId: schema.blockedSenders.userId }).from(schema.blockedSenders).where(eq(schema.blockedSenders.userId, userId)).limit(1))[0];
  return !!row;
}

async function bumpUsage(db: Db, userId: number, channel: "sms" | "push", period: "day" | "hour", periodStart: Date): Promise<number> {
  const existing = (await db.select().from(schema.sendUsage).where(and(
    eq(schema.sendUsage.userId, userId),
    eq(schema.sendUsage.channel, channel),
    eq(schema.sendUsage.period, period),
    eq(schema.sendUsage.periodStart, periodStart),
  )).limit(1))[0];
  if (existing) {
    const next = existing.count + 1;
    await db.update(schema.sendUsage).set({ count: next }).where(eq(schema.sendUsage.id, existing.id));
    return next;
  }
  await db.insert(schema.sendUsage).values({ userId, channel, period, periodStart, count: 1 });
  return 1;
}

export interface SendCheck {
  allowed: boolean;
  reason?: string;
  autoBlocked?: boolean;
}

/**
 * Records one send attempt and enforces caps. Returns allowed=false when the
 * account is blocked or the daily cap is reached. Auto-blocks the account
 * when the hourly count exceeds 3x the daily cap.
 */
export async function recordSendAttempt(db: Db, userId: number, channel: "sms" | "push"): Promise<SendCheck> {
  if (await isSenderBlocked(db, userId)) {
    return { allowed: false, reason: "Sending is blocked on this account." };
  }
  const caps = await getSendCaps(db, userId);
  const cap = channel === "sms" ? caps.maxSmsPerDay : caps.maxPushPerDay;
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const hourStart = new Date(now); hourStart.setMinutes(0, 0, 0);
  const [dayCount, hourCount] = await Promise.all([
    bumpUsage(db, userId, channel, "day", dayStart),
    bumpUsage(db, userId, channel, "hour", hourStart),
  ]);
  if (hourCount > 3 * cap) {
    await db.insert(schema.blockedSenders)
      .values({ userId, reason: `Auto-blocked: ${hourCount} ${channel} sends in one hour (daily cap ${cap}).`, blockedBy: null, blockedAt: now })
      .onConflictDoNothing();
    await logAdminAction(db, 0, "abuse.auto_block", "user", String(userId), `${channel}: ${hourCount}/hour exceeded 3x daily cap (${cap}).`);
    return { allowed: false, reason: "Sending is blocked on this account.", autoBlocked: true };
  }
  if (dayCount > cap) {
    return { allowed: false, reason: `Daily ${channel} limit reached (${cap}/day).` };
  }
  return { allowed: true };
}

/**
 * Read-only cap check: does NOT bump usage. Used as a client-side pre-check
 * before opening the phone's SMS app, so a capped user sees the error
 * immediately instead of after their messaging app already opened.
 */
export async function checkSendCap(db: Db, userId: number, channel: "sms" | "push"): Promise<SendCheck> {
  if (await isSenderBlocked(db, userId)) {
    return { allowed: false, reason: "Sending is blocked on this account." };
  }
  const caps = await getSendCaps(db, userId);
  const cap = channel === "sms" ? caps.maxSmsPerDay : caps.maxPushPerDay;
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const row = (await db.select().from(schema.sendUsage).where(and(
    eq(schema.sendUsage.userId, userId),
    eq(schema.sendUsage.channel, channel),
    eq(schema.sendUsage.period, "day"),
    eq(schema.sendUsage.periodStart, dayStart),
  )).limit(1))[0];
  if ((row?.count ?? 0) >= cap) {
    return { allowed: false, reason: `Daily ${channel} limit reached (${cap}/day).` };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Actions.
// ---------------------------------------------------------------------------

const broadcastSegmentSchema = z.enum(["all", "pro", "free"]);

export const platformAdminActions = {
  // -- 4. Feature flags ------------------------------------------------------
  /** Public: safe flag subset for clients (logged-in or not). */
  getFeatureFlags: defineAction({
    request: z.object({}),
    response: z.object({ marketplace_enabled: z.boolean(), signups_enabled: z.boolean(), broadcasts_enabled: z.boolean() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const [marketplace_enabled, signups_enabled, broadcasts_enabled] = await Promise.all([
        isFeatureEnabled(db, "marketplace_enabled"),
        isFeatureEnabled(db, "signups_enabled"),
        isFeatureEnabled(db, "broadcasts_enabled"),
      ]);
      return { marketplace_enabled, signups_enabled, broadcasts_enabled };
    },
  }),

  adminFeatureFlags: defineAction({
    request: z.object({}),
    response: z.object({
      flags: z.array(z.object({ key: z.string(), enabled: z.boolean(), description: z.string(), updatedAt: z.string() })),
    }),
    async handler(ctx) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const rows = await db.select().from(schema.featureFlags).orderBy(schema.featureFlags.key);
      return {
        flags: rows.map((r) => ({ key: r.key, enabled: r.enabled, description: r.description, updatedAt: r.updatedAt.toISOString() })),
      };
    },
  }),

  adminFeatureFlagSet: defineAction({
    request: z.object({ key: z.enum(FEATURE_FLAG_KEYS), enabled: z.boolean() }),
    response: z.object({ ok: z.literal(true), key: z.string(), enabled: z.boolean() }),
    async handler(ctx, args): Promise<{ ok: true; key: string; enabled: boolean }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const now = new Date();
      const existing = (await db.select({ key: schema.featureFlags.key }).from(schema.featureFlags).where(eq(schema.featureFlags.key, args.key)).limit(1))[0];
      if (existing) await db.update(schema.featureFlags).set({ enabled: args.enabled, updatedAt: now }).where(eq(schema.featureFlags.key, args.key));
      else await db.insert(schema.featureFlags).values({ key: args.key, enabled: args.enabled, description: FLAG_DESCRIPTIONS[args.key] ?? "", updatedAt: now });
      await logAdminAction(db, admin.id, "flags.toggle", "feature_flag", args.key, `${args.key} -> ${args.enabled ? "on" : "off"}`);
      ctx.invalidateQueries();
      return { ok: true, key: args.key, enabled: args.enabled };
    },
  }),

  // -- 1. Broadcast pushes ----------------------------------------------------
  adminBroadcastSend: defineAction({
    request: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), segment: broadcastSegmentSchema }),
    response: z.object({ ok: z.literal(true), sentCount: z.number(), totalUsers: z.number(), broadcastId: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; sentCount: number; totalUsers: number; broadcastId: number }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      if (!(await isFeatureEnabled(db, "broadcasts_enabled"))) throw new Error("Broadcasts are disabled.");
      const allUsers = await db.select({ id: schema.authUsers.id, tier: schema.authUsers.tier }).from(schema.authUsers);
      const targets = args.segment === "all" ? allUsers : allUsers.filter((u) => (args.segment === "pro" ? u.tier === "premium" : u.tier !== "premium"));
      let sentCount = 0;
      for (const user of targets) {
        // recordSendAttempt runs inside sendPushToUser (caps + auto-block).
        try {
          const result = await sendPushToUser(db, user.id, { titleEn: args.title, titleEs: args.title, bodyEn: args.body, bodyEs: args.body, url: "/app/" });
          if (result.sent > 0) sentCount += 1;
        } catch {
          // One bad subscription must not kill the broadcast.
        }
      }
      const inserted = (await db.insert(schema.broadcastLog).values({
        title: args.title, body: args.body, segment: args.segment, sentCount, createdBy: admin.id, createdAt: new Date(),
      }).returning({ id: schema.broadcastLog.id }))[0];
      if (!inserted) throw new Error("Could not record the broadcast.");
      await logAdminAction(db, admin.id, "broadcast.send", "broadcast", String(inserted.id), `"${args.title}" -> ${args.segment} (${sentCount}/${targets.length} delivered)`);
      ctx.invalidateQueries();
      return { ok: true, sentCount, totalUsers: targets.length, broadcastId: inserted.id };
    },
  }),

  adminBroadcastHistory: defineAction({
    request: z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(25) }),
    response: z.object({
      entries: z.array(z.object({ id: z.number(), title: z.string(), body: z.string(), segment: z.string(), sentCount: z.number(), createdBy: z.number(), createdAt: z.string() })),
      total: z.number(), page: z.number(), pageSize: z.number(),
    }),
    async handler(ctx, args) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const total = (await db.select({ n: sql<number>`count(*)` }).from(schema.broadcastLog))[0]?.n ?? 0;
      const rows = await db.select().from(schema.broadcastLog).orderBy(desc(schema.broadcastLog.createdAt), desc(schema.broadcastLog.id)).limit(args.pageSize).offset((args.page - 1) * args.pageSize);
      return {
        entries: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, segment: r.segment, sentCount: r.sentCount, createdBy: r.createdBy, createdAt: r.createdAt.toISOString() })),
        total, page: args.page, pageSize: args.pageSize,
      };
    },
  }),

  // -- 2. Business verification ----------------------------------------------
  adminVerificationList: defineAction({
    request: z.object({}),
    response: z.object({
      businesses: z.array(z.object({
        companyId: z.number(), companyName: z.string(), licenseNumber: z.string(),
        status: z.string(), note: z.string(),
        reviewedAt: z.string().nullable(), reviewedByName: z.string().nullable(),
      })),
    }),
    async handler(ctx) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const settingsRows = await db.select({
        companyId: schema.settings.companyId, companyName: schema.settings.companyName, licenseNumber: schema.settings.licenseNumber,
      }).from(schema.settings);
      const verifications = await db.select().from(schema.businessVerifications);
      const byCompany = new Map(verifications.map((v) => [v.companyId, v]));
      const reviewerIds = [...new Set(verifications.map((v) => v.reviewedBy).filter((id): id is number => typeof id === "number"))];
      const reviewers = reviewerIds.length
        ? await db.select({ id: schema.authUsers.id, name: schema.authUsers.name }).from(schema.authUsers).where(inArray(schema.authUsers.id, reviewerIds))
        : [];
      const reviewerName = new Map(reviewers.map((r) => [r.id, r.name]));
      // One row per company; keep the first settings row per companyId.
      const seen = new Map<number, { companyName: string; licenseNumber: string }>();
      for (const s of settingsRows) {
        if (!seen.has(s.companyId)) seen.set(s.companyId, { companyName: s.companyName, licenseNumber: s.licenseNumber });
      }
      return {
        businesses: [...seen.entries()].map(([companyId, s]) => {
          const v = byCompany.get(companyId);
          return {
            companyId, companyName: s.companyName, licenseNumber: v?.licenseNumber ?? s.licenseNumber,
            status: v?.status ?? "pending", note: v?.note ?? "",
            reviewedAt: v?.reviewedAt ? v.reviewedAt.toISOString() : null,
            reviewedByName: v?.reviewedBy != null ? (reviewerName.get(v.reviewedBy) ?? null) : null,
          };
        }).sort((a, b) => a.companyName.localeCompare(b.companyName)),
      };
    },
  }),

  adminVerificationSet: defineAction({
    request: z.object({ companyId: z.number().int().positive(), status: z.enum(["pending", "verified", "rejected"]), note: z.string().trim().max(500).default("") }),
    response: z.object({ ok: z.literal(true), companyId: z.number(), status: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; companyId: number; status: string }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const now = new Date();
      const settingsRow = (await db.select({ licenseNumber: schema.settings.licenseNumber }).from(schema.settings).where(eq(schema.settings.companyId, args.companyId)).limit(1))[0];
      const existing = (await db.select({ id: schema.businessVerifications.id }).from(schema.businessVerifications).where(eq(schema.businessVerifications.companyId, args.companyId)).limit(1))[0];
      if (existing) {
        await db.update(schema.businessVerifications).set({ status: args.status, note: args.note, reviewedBy: admin.id, reviewedAt: now, updatedAt: now }).where(eq(schema.businessVerifications.id, existing.id));
      } else {
        await db.insert(schema.businessVerifications).values({
          companyId: args.companyId, licenseNumber: settingsRow?.licenseNumber ?? "", status: args.status,
          note: args.note, reviewedBy: admin.id, reviewedAt: now, createdAt: now, updatedAt: now,
        });
      }
      await logAdminAction(db, admin.id, "verification.set", "business", String(args.companyId), `status -> ${args.status}${args.note ? ` — ${args.note}` : ""}`);
      ctx.invalidateQueries();
      return { ok: true, companyId: args.companyId, status: args.status };
    },
  }),

  // -- 3. Revenue dashboard (live Stripe, cached 5 min) ------------------------
  adminRevenueDashboard: defineAction({
    request: z.object({}),
    response: z.object({
      configured: z.boolean(),
      mrrDollars: z.number().nullable(),
      activeSubscriptions: z.number().nullable(),
      trialing: z.number().nullable(),
      failedPayments: z.number().nullable(),
      localActivePremium: z.number(),
      cachedAt: z.string(),
    }),
    async handler(ctx) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const now = Date.now();
      if (revenueCache && now - revenueCache.at < 5 * 60 * 1000) {
        return { ...revenueCache.data, cachedAt: new Date(revenueCache.at).toISOString() };
      }
      const stats = await ctx.executePrivileged(privileged.getStripeRevenueStats, {});
      const localActivePremium = (await db.select({ n: sql<number>`count(*)` }).from(schema.authUsers).where(eq(schema.authUsers.tier, "premium")))[0]?.n ?? 0;
      const data = {
        configured: stats.configured,
        mrrDollars: stats.mrrCents != null ? stats.mrrCents / 100 : null,
        activeSubscriptions: stats.activeSubscriptions,
        trialing: stats.trialing,
        failedPayments: stats.failedPayments,
        localActivePremium,
      };
      revenueCache = { at: now, data };
      return { ...data, cachedAt: new Date(now).toISOString() };
    },
  }),

  // -- 5. Support view (read-only snapshot) ------------------------------------
  adminSupportView: defineAction({
    request: z.object({ email: z.string().trim().email().max(200) }),
    response: z.object({
      found: z.boolean(),
      profile: z.object({
        id: z.number(), name: z.string(), email: z.string(), tier: z.string(),
        subscriptionStatus: z.string(), provider: z.string(),
        currentPeriodEnd: z.string().nullable(), cancelAtPeriodEnd: z.boolean(),
        suspended: z.boolean(), isPlatformAdmin: z.boolean(), createdAt: z.string(),
      }).nullable(),
      counts: z.object({ jobs: z.number(), clients: z.number(), invoices: z.number(), quotes: z.number() }).nullable(),
      recentActivity: z.array(z.object({ kind: z.string(), channel: z.string(), sentAt: z.string() })).nullable(),
    }),
    async handler(ctx, args) {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const email = args.email.toLowerCase();
      const user = (await db.select().from(schema.authUsers).where(sql`lower(${schema.authUsers.email}) = ${email}`).limit(1))[0];
      if (!user) return { found: false, profile: null, counts: null, recentActivity: null };
      const provider = user.playPurchaseToken ? "play" : user.stripeSubscriptionId ? "stripe" : user.subscriptionStatus === "founder" ? "founder" : user.subscriptionStatus === "manual" ? "manual" : "none";
      const [jobs, clients, invoices, quotes] = await Promise.all([
        db.select({ n: sql<number>`count(*)` }).from(schema.jobs).where(eq(schema.jobs.companyId, user.companyId)),
        db.select({ n: sql<number>`count(*)` }).from(schema.clients).where(eq(schema.clients.companyId, user.companyId)),
        db.select({ n: sql<number>`count(*)` }).from(schema.invoices).where(eq(schema.invoices.companyId, user.companyId)),
        db.select({ n: sql<number>`count(*)` }).from(schema.quotes).where(eq(schema.quotes.companyId, user.companyId)),
      ]);
      const activity = await db.select().from(schema.automationLogs).where(eq(schema.automationLogs.companyId, user.companyId)).orderBy(desc(schema.automationLogs.sentAt)).limit(10);
      await logAdminAction(db, admin.id, "support.view", "user", String(user.id), `viewed ${user.email}`);
      return {
        found: true,
        profile: {
          id: user.id, name: user.name, email: user.email, tier: user.tier,
          subscriptionStatus: user.subscriptionStatus, provider,
          currentPeriodEnd: user.subscriptionCurrentPeriodEnd ? user.subscriptionCurrentPeriodEnd.toISOString() : null,
          cancelAtPeriodEnd: user.cancelAtPeriodEnd, suspended: !!user.suspendedAt,
          isPlatformAdmin: user.isPlatformAdmin, createdAt: user.createdAt.toISOString(),
        },
        counts: {
          jobs: jobs[0]?.n ?? 0, clients: clients[0]?.n ?? 0,
          invoices: invoices[0]?.n ?? 0, quotes: quotes[0]?.n ?? 0,
        },
        recentActivity: activity.map((a) => ({ kind: a.kind, channel: a.channel, sentAt: a.sentAt.toISOString() })),
      };
    },
  }),

  // -- 7. Abuse controls -------------------------------------------------------
  adminAbuseOverview: defineAction({
    request: z.object({}),
    response: z.object({
      defaults: z.object({ maxSmsPerDay: z.number(), maxPushPerDay: z.number() }),
      overrides: z.array(z.object({ userId: z.number(), userName: z.string(), userEmail: z.string(), maxSmsPerDay: z.number(), maxPushPerDay: z.number() })),
      blocked: z.array(z.object({ userId: z.number(), userName: z.string(), userEmail: z.string(), reason: z.string(), blockedAt: z.string() })),
    }),
    async handler(ctx) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const [smsRaw, pushRaw] = await Promise.all([
        getPlatformSetting(db, "default_max_sms_per_day", "50"),
        getPlatformSetting(db, "default_max_push_per_day", "100"),
      ]);
      const caps = await db.select().from(schema.sendCaps);
      const blocked = await db.select().from(schema.blockedSenders).orderBy(desc(schema.blockedSenders.blockedAt));
      const userIds = [...new Set([...caps.map((c) => c.userId), ...blocked.map((b) => b.userId)])];
      const users = userIds.length
        ? await db.select({ id: schema.authUsers.id, name: schema.authUsers.name, email: schema.authUsers.email }).from(schema.authUsers).where(inArray(schema.authUsers.id, userIds))
        : [];
      const byId = new Map(users.map((u) => [u.id, u]));
      return {
        defaults: { maxSmsPerDay: parseCap(smsRaw, 50), maxPushPerDay: parseCap(pushRaw, 100) },
        overrides: caps.map((c) => ({ userId: c.userId, userName: byId.get(c.userId)?.name ?? `#${c.userId}`, userEmail: byId.get(c.userId)?.email ?? "", maxSmsPerDay: c.maxSmsPerDay, maxPushPerDay: c.maxPushPerDay })),
        blocked: blocked.map((b) => ({ userId: b.userId, userName: byId.get(b.userId)?.name ?? `#${b.userId}`, userEmail: byId.get(b.userId)?.email ?? "", reason: b.reason, blockedAt: b.blockedAt.toISOString() })),
      };
    },
  }),

  adminAbuseCapSet: defineAction({
    request: z.object({ userId: z.number().int().positive(), maxSmsPerDay: z.number().int().min(1).max(100000), maxPushPerDay: z.number().int().min(1).max(100000) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const now = new Date();
      const existing = (await db.select({ userId: schema.sendCaps.userId }).from(schema.sendCaps).where(eq(schema.sendCaps.userId, args.userId)).limit(1))[0];
      if (existing) await db.update(schema.sendCaps).set({ maxSmsPerDay: args.maxSmsPerDay, maxPushPerDay: args.maxPushPerDay, updatedAt: now }).where(eq(schema.sendCaps.userId, args.userId));
      else await db.insert(schema.sendCaps).values({ userId: args.userId, maxSmsPerDay: args.maxSmsPerDay, maxPushPerDay: args.maxPushPerDay, updatedAt: now });
      await logAdminAction(db, admin.id, "abuse.cap_set", "user", String(args.userId), `sms ${args.maxSmsPerDay}/day, push ${args.maxPushPerDay}/day`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminAbuseDefaultsSet: defineAction({
    request: z.object({ maxSmsPerDay: z.number().int().min(1).max(100000), maxPushPerDay: z.number().int().min(1).max(100000) }),
    response: z.object({ ok: z.literal(true), maxSmsPerDay: z.number(), maxPushPerDay: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; maxSmsPerDay: number; maxPushPerDay: number }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const now = new Date();
      for (const [key, value] of [["default_max_sms_per_day", args.maxSmsPerDay], ["default_max_push_per_day", args.maxPushPerDay]] as const) {
        const existing = (await db.select({ key: schema.platformSettings.key }).from(schema.platformSettings).where(eq(schema.platformSettings.key, key)).limit(1))[0];
        if (existing) await db.update(schema.platformSettings).set({ value: String(value), updatedAt: now }).where(eq(schema.platformSettings.key, key));
        else await db.insert(schema.platformSettings).values({ key, value: String(value), updatedAt: now });
      }
      await logAdminAction(db, admin.id, "abuse.defaults_set", "platform_setting", "send_caps", `defaults: sms ${args.maxSmsPerDay}/day, push ${args.maxPushPerDay}/day`);
      ctx.invalidateQueries();
      return { ok: true, maxSmsPerDay: args.maxSmsPerDay, maxPushPerDay: args.maxPushPerDay };
    },
  }),

  adminBlockUser: defineAction({
    request: z.object({ userId: z.number().int().positive(), reason: z.string().trim().max(300).default("") }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      await db.insert(schema.blockedSenders).values({ userId: args.userId, reason: args.reason, blockedBy: admin.id, blockedAt: new Date() }).onConflictDoNothing();
      await logAdminAction(db, admin.id, "abuse.block", "user", String(args.userId), args.reason || "manual block");
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminUnblockUser: defineAction({
    request: z.object({ userId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      await db.delete(schema.blockedSenders).where(eq(schema.blockedSenders.userId, args.userId));
      await logAdminAction(db, admin.id, "abuse.unblock", "user", String(args.userId), "unblocked");
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
};

// In-memory 5-minute cache for the Stripe revenue dashboard (per process).
let revenueCache: { at: number; data: { configured: boolean; mrrDollars: number | null; activeSubscriptions: number | null; trialing: number | null; failedPayments: number | null; localActivePremium: number } } | null = null;
