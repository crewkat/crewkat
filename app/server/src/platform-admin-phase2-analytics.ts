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

  /** Admin-only: client-link growth loop stats (platform-wide). */
  adminLoopStats: defineAction({
    request: z.object({}),
    response: z.object({
      linkOpens: z.object({
        total: z.number(),
        bySurface: z.array(z.object({ surface: z.string(), opens: z.number() })),
      }),
      landingClicks: z.object({
        total: z.number(),
        bySurface: z.array(z.object({ surface: z.string(), count: z.number() })),
      }),
      signups: z.object({
        total: z.number(),
        bySurface: z.array(z.object({ surface: z.string(), count: z.number() })),
      }),
    }),
    async handler(ctx) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const surfaces = ["estimate", "invoice", "contract", "changeorder", "portal", "receipt", "photo"] as const;

      // linkOpens: documentLinks SUM(viewCount) grouped by documentKind,
      // mapped quote->estimate, invoice->invoice, contract->contract,
      // change_order->changeorder; portalTokens SUM(viewCount) -> portal.
      // Receipt/photo opens happen inside the portal and are not
      // separately recorded — they stay 0.
      const kindToSurface: Record<string, string> = {
        quote: "estimate",
        invoice: "invoice",
        contract: "contract",
        change_order: "changeorder",
      };
      const opensBySurface = new Map<string, number>(surfaces.map((s) => [s, 0]));
      const docLinks = await db
        .select({
          documentKind: schema.documentLinks.documentKind,
          viewCount: schema.documentLinks.viewCount,
        })
        .from(schema.documentLinks);
      for (const row of docLinks) {
        const surface = kindToSurface[row.documentKind];
        if (surface) opensBySurface.set(surface, (opensBySurface.get(surface) ?? 0) + (row.viewCount ?? 0));
      }
      const portalRows = await db
        .select({ viewCount: schema.portalTokens.viewCount })
        .from(schema.portalTokens);
      let portalOpens = 0;
      for (const row of portalRows) portalOpens += row.viewCount ?? 0;
      opensBySurface.set("portal", (opensBySurface.get("portal") ?? 0) + portalOpens);
      const linkOpensBySurface = surfaces.map((surface) => ({
        surface,
        opens: opensBySurface.get(surface) ?? 0,
      }));
      const linkOpensTotal = linkOpensBySurface.reduce((sum, r) => sum + r.opens, 0);

      // landingClicks: COUNT growthLoopEvents grouped by surface.
      const clicksBySurface = new Map<string, number>(surfaces.map((s) => [s, 0]));
      const events = await db
        .select({ surface: schema.growthLoopEvents.surface })
        .from(schema.growthLoopEvents);
      for (const row of events) {
        if (clicksBySurface.has(row.surface)) {
          clicksBySurface.set(row.surface, (clicksBySurface.get(row.surface) ?? 0) + 1);
        }
      }
      const landingBySurface = surfaces.map((surface) => ({
        surface,
        count: clicksBySurface.get(surface) ?? 0,
      }));
      const landingTotal = landingBySurface.reduce((sum, r) => sum + r.count, 0);

      // signups: COUNT authUsers where signupSource is not null, grouped
      // by signupSource.
      const signupsBySurfaceMap = new Map<string, number>(surfaces.map((s) => [s, 0]));
      const users = await db
        .select({ signupSource: schema.authUsers.signupSource })
        .from(schema.authUsers);
      let signupsTotal = 0;
      for (const row of users) {
        if (row.signupSource != null) {
          signupsTotal++;
          if (signupsBySurfaceMap.has(row.signupSource)) {
            signupsBySurfaceMap.set(row.signupSource, (signupsBySurfaceMap.get(row.signupSource) ?? 0) + 1);
          }
        }
      }
      const signupsBySurface = surfaces.map((surface) => ({
        surface,
        count: signupsBySurfaceMap.get(surface) ?? 0,
      }));

      return {
        linkOpens: { total: linkOpensTotal, bySurface: linkOpensBySurface },
        landingClicks: { total: landingTotal, bySurface: landingBySurface },
        signups: { total: signupsTotal, bySurface: signupsBySurface },
      };
    },
  }),
};
