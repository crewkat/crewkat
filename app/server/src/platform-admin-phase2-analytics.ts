// Platform admin Phase 2 (2026-10-09): analytics — marketplace overview +
// growth metrics. Admin-only (requirePlatformAdmin), platform-wide via
// platformDb (same pattern as the Mission Control analytics actions).
//
// Exported as `platformAdminPhase2AnalyticsActions`; the coordinator spreads
// this into BaseActions (like platformAdminPhase1Actions).
import { defineAction, z } from "@hatch/space-sdk";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { platformDb, requirePlatformAdmin } from "./actions";

const DAY_MS = 86400000;

/** Round (numerator/denominator*100) to 1 decimal; 0 when denominator is 0. */
function pct1(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

/** 30 chronological {date, count} day buckets ending today. */
function dayBuckets(days: number): { date: string; count: number }[] {
  const out: { date: string; count: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    out.push({ date: d.toISOString().slice(0, 10), count: 0 });
  }
  return out;
}

export const platformAdminPhase2AnalyticsActions = {
  /** Admin-only: marketplace funnel overview (platform-wide). */
  adminMarketplaceOverview: defineAction({
    request: z.object({}),
    response: z.object({
      listingsTotal: z.number(),
      listingsActive: z.number(),
      listingsLast30d: z.number(),
      listingsByIntent: z.object({ need: z.number(), offer: z.number() }),
      // Daily listing volume for the "Listings — last 30 days" chart.
      listingsByDay: z.array(z.object({ date: z.string(), count: z.number() })),
      messagesTotal: z.number(),
      messagesLast30d: z.number(),
      conversationsTotal: z.number(),
      completedJobsTotal: z.number(),
      completedJobsLast30d: z.number(),
      listingToMessageRate: z.number(),
    }),
    async handler(ctx) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const now = new Date();
      const monthAgo = new Date(now.getTime() - 30 * DAY_MS);

      const listings = await db
        .select({
          moderationStatus: schema.marketplaceListings.moderationStatus,
          intent: schema.marketplaceListings.intent,
          createdAt: schema.marketplaceListings.createdAt,
        })
        .from(schema.marketplaceListings);
      const listingsTotal = listings.length;
      const listingsActive = listings.filter((l) => l.moderationStatus === "active").length;
      const listingsLast30d = listings.filter((l) => l.createdAt >= monthAgo).length;
      const listingsByIntent = {
        need: listings.filter((l) => l.intent === "need").length,
        offer: listings.filter((l) => l.intent === "offer").length,
      };

      const listingsByDay = dayBuckets(30);
      const byDate = new Map(listingsByDay.map((d) => [d.date, d]));
      for (const l of listings) {
        const bucket = byDate.get(l.createdAt.toISOString().slice(0, 10));
        if (bucket) bucket.count++;
      }

      const messages = await db
        .select({ createdAt: schema.marketplaceMessages.createdAt })
        .from(schema.marketplaceMessages);
      const messagesTotal = messages.length;
      const messagesLast30d = messages.filter((m) => m.createdAt >= monthAgo).length;

      const conversations = await db
        .select({ id: schema.marketplaceConversations.id })
        .from(schema.marketplaceConversations);
      const conversationsTotal = conversations.length;

      const jobs = await db
        .select({ completedAt: schema.jobs.completedAt })
        .from(schema.jobs);
      const completed = jobs.filter((j) => j.completedAt != null);
      const completedJobsTotal = completed.length;
      const completedJobsLast30d = completed.filter(
        (j) => (j.completedAt as Date) >= monthAgo,
      ).length;

      return {
        listingsTotal,
        listingsActive,
        listingsLast30d,
        listingsByIntent,
        listingsByDay,
        messagesTotal,
        messagesLast30d,
        conversationsTotal,
        completedJobsTotal,
        completedJobsLast30d,
        listingToMessageRate: pct1(conversationsTotal, listingsTotal),
      };
    },
  }),

  /** Admin-only: growth / health metrics (platform-wide). */
  adminGrowthMetrics: defineAction({
    request: z.object({}),
    response: z.object({
      // % change in signups: last 7d vs prior 7d. wowHasBaseline is false
      // when the prior period has 0 signups — then a current period with
      // signups reports 100 (fresh lift), and an empty one reports 0.
      signupGrowthWow: z.number(),
      wowHasBaseline: z.boolean(),
      premiumConversionRate: z.number(),
      activeListings: z.number(),
      avgMessagesPerListing: z.number(),
      supportOpenCount: z.number(),
      premiumTotal: z.number(),
    }),
    async handler(ctx) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
      const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);

      const users = await db
        .select({ createdAt: schema.authUsers.createdAt, tier: schema.authUsers.tier })
        .from(schema.authUsers);
      const totalUsers = users.length;
      const current7d = users.filter((u) => u.createdAt >= weekAgo).length;
      const prior7d = users.filter((u) => u.createdAt >= twoWeeksAgo && u.createdAt < weekAgo).length;
      const wowHasBaseline = prior7d > 0;
      const signupGrowthWow = wowHasBaseline
        ? Math.round(((current7d - prior7d) / prior7d) * 1000) / 10
        : current7d > 0
          ? 100
          : 0;

      const premiumTotal = users.filter((u) => u.tier === "premium").length;
      const premiumConversionRate = pct1(premiumTotal, totalUsers);

      const activeListings = await db
        .select({ id: schema.marketplaceListings.id })
        .from(schema.marketplaceListings)
        .where(eq(schema.marketplaceListings.moderationStatus, "active"));
      const listingsTotal = await db
        .select({ id: schema.marketplaceListings.id })
        .from(schema.marketplaceListings);
      const messagesTotal = await db
        .select({ id: schema.marketplaceMessages.id })
        .from(schema.marketplaceMessages);
      const avgMessagesPerListing =
        listingsTotal.length > 0
          ? Math.round((messagesTotal.length / listingsTotal.length) * 10) / 10
          : 0;

      const openReports = await db
        .select({ id: schema.platformSupportReports.id })
        .from(schema.platformSupportReports)
        .where(eq(schema.platformSupportReports.status, "open"));

      return {
        signupGrowthWow,
        wowHasBaseline,
        premiumConversionRate,
        activeListings: activeListings.length,
        avgMessagesPerListing,
        supportOpenCount: openReports.length,
        premiumTotal,
      };
    },
  }),
};
