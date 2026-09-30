// Phase 4: Google Play Billing for Crewkat Premium (TWA, package com.crewkat.app).
//
// Policy separation (Google Play policy): the Play-installed app sells Premium
// exclusively through Google Play Billing — Digital Goods API + Payment Request
// on the client, purchases.subscriptionsv2.get verification here. The regular
// web keeps Stripe. The two paths never link to each other: no Stripe URLs are
// ever surfaced inside the Play flow, and no Play Billing UI is surfaced on
// the web.
//
// Linking: verification runs in the signed-in user's session, so a Play
// purchase is granted to the Crewkat account that bought it — the same tier
// plumbing as Stripe premium (auth_users.tier = "premium"), which unlocks the
// exact same Pro tools.
import { defineAction, z, type Ctx } from "@hatch/space-sdk";
import { eq, and } from "drizzle-orm";
import * as schema from "./schema";
import { privileged } from "@space/privileged";
import { workspaceIdentity } from "./actions";

type Db = ReturnType<Ctx["db"]>;

async function grantPlayPremium(db: Db, userId: number, verification: { orderId: string | null; expiryTimeMillis: string | null }, purchaseToken: string, sku: string) {
  const now = new Date();
  const periodEnd = verification.expiryTimeMillis ? new Date(Number(verification.expiryTimeMillis)) : null;
  await db.update(schema.authUsers).set({
    tier: "premium",
    subscriptionStatus: "active",
    subscriptionCurrentPeriodEnd: periodEnd && !Number.isNaN(periodEnd.getTime()) ? periodEnd : null,
    cancelAtPeriodEnd: false,
    playPurchaseToken: purchaseToken,
    playOrderId: verification.orderId,
    updatedAt: now,
  }).where(eq(schema.authUsers.id, userId));
  // Idempotent: re-verifying the same purchase token never double-grants.
  await db.insert(schema.playBillingPurchases).values({
    userId, purchaseToken, orderId: verification.orderId, sku, verifiedAt: now,
  }).onConflictDoNothing({ target: schema.playBillingPurchases.purchaseToken });
  // Mission Control: log the Play subscription for analytics (idempotent —
  // only log if this user has no prior play_subscribed event).
  const existing = await db.select({ id: schema.subscriptionEvents.id }).from(schema.subscriptionEvents).where(and(eq(schema.subscriptionEvents.userId, userId), eq(schema.subscriptionEvents.eventType, "play_subscribed"))).limit(1);
  if (!existing[0]) {
    await db.insert(schema.subscriptionEvents).values({ userId, eventType: "play_subscribed", plan: "play_monthly", createdAt: now });
  }
}

export const playBillingActions = {
  // What the Upgrade screen needs to decide between the Play Billing and the
  // Stripe presentation. Never exposes secrets.
  getPlayBillingConfig: defineAction({
    request: z.object({}),
    response: z.object({ configured: z.boolean(), sku: z.string(), packageName: z.string() }),
    privileged: [privileged.getPlayBillingStatus],
    async handler(ctx) {
      return await ctx.executePrivileged(privileged.getPlayBillingStatus, {});
    },
  }),
  // Called by the Play app right after the Payment Request completes. Verifies
  // the purchase token with Google, then grants premium on the buyer's
  // Crewkat account. Throws (never grants) when unconfigured or unverifiable.
  verifyPlaySubscription: defineAction({
    request: z.object({ purchaseToken: z.string().min(1).max(2000), sku: z.string().min(1).max(200) }),
    response: z.object({ ok: z.literal(true), tier: z.literal("premium"), currentPeriodEnd: z.string().nullable() }),
    privileged: [privileged.verifyPlayPurchase],
    async handler(ctx, args): Promise<{ ok: true; tier: "premium"; currentPeriodEnd: string | null }> {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const result = await ctx.executePrivileged(privileged.verifyPlayPurchase, { purchaseToken: args.purchaseToken, sku: args.sku });
      if (!result.configured) throw new Error("Google Play Billing is not connected yet. The owner needs to finish the Play Console setup first.");
      if (!result.verified || !result.active) throw new Error(result.error || "This Google Play purchase could not be verified.");
      await grantPlayPremium(db, identity.workspaceUserId, result, args.purchaseToken, args.sku);
      const user = (await db.select({ subscriptionCurrentPeriodEnd: schema.authUsers.subscriptionCurrentPeriodEnd }).from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
      ctx.invalidateQueries();
      return { ok: true, tier: "premium", currentPeriodEnd: user?.subscriptionCurrentPeriodEnd?.toISOString() ?? null };
    },
  }),
  // Re-checks the stored Play purchase against Google (cancellations, expiry).
  // Downgrades to free when the subscription is no longer entitled. The app
  // calls this when the Upgrade screen opens for a Play-billed account.
  refreshPlaySubscription: defineAction({
    request: z.object({}),
    response: z.object({ tier: z.enum(["free", "premium"]), status: z.string(), currentPeriodEnd: z.string().nullable() }),
    privileged: [privileged.verifyPlayPurchase],
    async handler(ctx): Promise<{ tier: "free" | "premium"; status: string; currentPeriodEnd: string | null }> {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
      if (!user) throw new Error("Sign in to continue.");
      if (!user.playPurchaseToken) {
        return { tier: user.tier, status: user.subscriptionStatus, currentPeriodEnd: user.subscriptionCurrentPeriodEnd?.toISOString() ?? null };
      }
      const status = await ctx.executePrivileged(privileged.getPlayBillingStatus, {});
      const result = await ctx.executePrivileged(privileged.verifyPlayPurchase, { purchaseToken: user.playPurchaseToken, sku: status.sku });
      if (result.configured && result.verified && result.active) {
        await grantPlayPremium(db, user.id, result, user.playPurchaseToken, status.sku);
        const refreshed = (await db.select({ subscriptionCurrentPeriodEnd: schema.authUsers.subscriptionCurrentPeriodEnd }).from(schema.authUsers).where(eq(schema.authUsers.id, user.id)).limit(1))[0];
        ctx.invalidateQueries();
        return { tier: "premium", status: "active", currentPeriodEnd: refreshed?.subscriptionCurrentPeriodEnd?.toISOString() ?? null };
      }
      // No longer entitled (expired, revoked, or unverifiable): drop to free.
      // The purchase token is kept so a later resubscribe re-verifies cleanly.
      await db.update(schema.authUsers).set({ tier: "free", subscriptionStatus: "expired", cancelAtPeriodEnd: false, subscriptionCurrentPeriodEnd: null, updatedAt: new Date() }).where(eq(schema.authUsers.id, user.id));
      ctx.invalidateQueries();
      return { tier: "free", status: "expired", currentPeriodEnd: null };
    },
  }),
};
