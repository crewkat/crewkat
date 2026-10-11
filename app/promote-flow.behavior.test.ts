// Build 3.0 promote flow behavior tests.
//
// Covers the end-to-end listing-boost purchase path:
//  1. startListingBumpCheckout: unconfigured without STRIPE_BUMP_PRICE_ID
//     (mirrors the real privileged handler's unconfigured branch); rejects
//     foreign/missing/inactive listings.
//  2. Stripe webhook (checkout.session.completed / listing_bump): sets
//     featuredUntil ~7 days out and records the purchase row.
//  3. Boosted listing floats to the top of listMarketplaceListings.
//  4. getListingBumpStatus: featured + expiry + configured + price.
//  5. Expiry: a past featuredUntil drops the boost from status and feed order.
//  6. The real getListingBumpPrice privileged handler: Stripe price fetch,
//     USD/EUR formatting, null on missing env / bad payload / fetch failure,
//     10-minute in-process caching.
//  7. Static client guards: no-wrap pay CTA, price shown, billing-ready gating.
//
// Run from app/:  bun promote-flow.behavior.test.ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import { privileged, privilegedHandlers } from "./server/src/privileged.ts";
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
async function checkThrows(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    failures++;
    console.error(`FAIL ${name} — expected an error but none was thrown`);
  } catch {
    console.log(`ok   ${name}`);
  }
}

// --- 1. Scratch DB + migrate -------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-promote-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

// --- 2. Test context ----------------------------------------------------------
const cannedWebhookEvents: Array<Record<string, unknown>> = [];
let stubPriceDisplay: string | null = "$9.00";
const ctx = {
  slug: "tradesign",
  invocationId: "promote-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async (_fn: unknown, args: Record<string, unknown>) => {
    // NOTE: actions.ts imports the privileged contracts from the generated
    // @space/privileged module (a different module instance than the
    // ./server/src/privileged.ts import here), so dispatch on the request
    // shape rather than contract identity.
    // getListingBumpPrice: request is an empty object.
    if (args && Object.keys(args).length === 0) return { priceDisplay: stubPriceDisplay };
    // createListingBumpCheckout: mirror the real handler's unconfigured branch
    // (env is empty in tests, so no Stripe call happens).
    if (args && typeof args.listingId === "number") {
      return { configured: false, checkoutUrl: null, missing: ["STRIPE_SECRET_KEY", "STRIPE_BUMP_PRICE_ID", "CREWKAT_PUBLIC_URL"] };
    }
    // verifyStripeWebhook stub: serve canned events in order.
    const event = cannedWebhookEvents.shift();
    if (!event) throw new Error("no canned webhook event");
    return event;
  },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;

await db.insert(schema.authUsers).values({ companyId: 1, name: "Owner", email: "owner@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH" });
await db.insert(schema.settings).values({ companyId: 1, companyName: "Stallions Test Co" });

const DAY = 86400000;
const now = Date.now();
const mkListing = async (title: string, createdAt: Date) => (await db.insert(schema.marketplaceListings).values({
  companyId: 1, title, category: "plumbing", serviceArea: "Tampa, FL 34691",
  companyName: "Stallions Test Co", companyPhone: "8135550100",
  moderationStatus: "active", createdAt, updatedAt: createdAt,
}).returning({ id: schema.marketplaceListings.id }))[0]!.id;

// --- 3. startListingBumpCheckout ----------------------------------------------
const listingId = await mkListing("Boost me", new Date(now - 3 * DAY));
const start = await (BaseActions.startListingBumpCheckout as any).handler(ctx, { listingId });
check("bump checkout unconfigured without STRIPE_BUMP_PRICE_ID", start.configured === false && start.checkoutUrl === null && start.missing.includes("STRIPE_BUMP_PRICE_ID"), JSON.stringify(start.missing));
await checkThrows("bump checkout rejects unknown listing", () => (BaseActions.startListingBumpCheckout as any).handler(ctx, { listingId: 999999 }));
const inactiveId = await mkListing("Pending review", new Date(now - 3 * DAY));
await db.update(schema.marketplaceListings).set({ moderationStatus: "pending_review" }).where(eq(schema.marketplaceListings.id, inactiveId));
await checkThrows("bump checkout rejects inactive listing", () => (BaseActions.startListingBumpCheckout as any).handler(ctx, { listingId: inactiveId }));
await checkThrows("bump checkout rejects foreign company listing", () => (BaseActions.startListingBumpCheckout as any).handler({ ...ctx, workspaceCompanyId: 2, workspaceUserId: 1 }, { listingId }));

// --- 4. Webhook purchase → boost active ----------------------------------------
cannedWebhookEvents.push({ eventId: "evt-bump-1", eventType: "checkout.session.completed", checkoutType: "listing_bump", listingId, companyId: 1, stripeSessionId: "cs-bump-1" });
const webhookResult = await (BaseActions.handleStripeWebhook as any).handler(ctx, { payload: "x", signature: "y" });
check("bump webhook processes", webhookResult.processed === true && webhookResult.duplicate === false);
const boosted = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, listingId)).limit(1))[0]!;
check("featuredUntil is ~7 days out", boosted.featuredUntil !== null && Math.abs(boosted.featuredUntil.getTime() - (Date.now() + 7 * DAY)) < 5 * 60_000, String(boosted.featuredUntil));
const purchases = await db.select().from(schema.listingBumpPurchases).where(eq(schema.listingBumpPurchases.listingId, listingId));
check("bump purchase recorded with session + expiry", purchases.length === 1 && purchases[0]!.stripeSessionId === "cs-bump-1" && purchases[0]!.companyId === 1 && Math.abs(purchases[0]!.expiresAt.getTime() - (Date.now() + 7 * DAY)) < 5 * 60_000);

// --- 5. Boosted listing floats to the top of the feed --------------------------
const midId = await mkListing("Mid recency", new Date(now - 2 * DAY));
const newId = await mkListing("Newest", new Date(now - 1 * DAY));
// Sanity: without any boost the feed is newest-first.
await db.update(schema.marketplaceListings).set({ featuredUntil: null }).where(eq(schema.marketplaceListings.id, listingId));
const baseline = await (BaseActions.listMarketplaceListings as any).handler(ctx, { search: "", category: null, serviceArea: "" });
const baselineOrder = baseline.listings.map((l: { id: number }) => l.id);
check("baseline feed is newest-first", baselineOrder[0] === newId && baselineOrder[1] === midId && baselineOrder[2] === listingId, JSON.stringify(baselineOrder));
// Re-boost the oldest listing: it must jump to the top.
cannedWebhookEvents.push({ eventId: "evt-bump-2", eventType: "checkout.session.completed", checkoutType: "listing_bump", listingId, companyId: 1, stripeSessionId: "cs-bump-2" });
await (BaseActions.handleStripeWebhook as any).handler(ctx, { payload: "x", signature: "y" });
const boostedFeed = await (BaseActions.listMarketplaceListings as any).handler(ctx, { search: "", category: null, serviceArea: "" });
const boostedOrder = boostedFeed.listings.map((l: { id: number }) => l.id);
check("boosted listing floats to top of feed", boostedOrder[0] === listingId, JSON.stringify(boostedOrder));
check("boosted listing shape is featured", boostedFeed.listings[0]!.featured === true && typeof boostedFeed.listings[0]!.featuredUntil === "string");
check("non-boosted listings are not featured", boostedFeed.listings.slice(1).every((l: { featured: boolean }) => l.featured === false));

// --- 6. getListingBumpStatus ----------------------------------------------------
const status = await (BaseActions.getListingBumpStatus as any).handler(ctx, { listingId });
check("bump status reports featured with expiry", status.featured === true && typeof status.featuredUntil === "string");
check("bump status reports billing unconfigured without env", status.configured === false, JSON.stringify(status.configured));
check("bump status carries the display price", status.price === "$9.00", JSON.stringify(status.price));
stubPriceDisplay = null;
const statusNoPrice = await (BaseActions.getListingBumpStatus as any).handler(ctx, { listingId });
check("bump status tolerates a null price lookup", statusNoPrice.price === null && statusNoPrice.featured === true);
stubPriceDisplay = "$9.00";
await checkThrows("bump status rejects foreign company listing", () => (BaseActions.getListingBumpStatus as any).handler({ ...ctx, workspaceCompanyId: 2 }, { listingId }));

// --- 7. Expiry drops the boost ---------------------------------------------------
await db.update(schema.marketplaceListings).set({ featuredUntil: new Date(now - DAY) }).where(eq(schema.marketplaceListings.id, listingId));
const expiredStatus = await (BaseActions.getListingBumpStatus as any).handler(ctx, { listingId });
check("expired boost is not featured", expiredStatus.featured === false && expiredStatus.featuredUntil === null);
const expiredFeed = await (BaseActions.listMarketplaceListings as any).handler(ctx, { search: "", category: null, serviceArea: "" });
const expiredOrder = expiredFeed.listings.map((l: { id: number }) => l.id);
check("expired boost falls back to recency order", expiredOrder[0] === newId && expiredOrder[1] === midId, JSON.stringify(expiredOrder));
check("expired listing shape is not featured", expiredFeed.listings.every((l: { featured: boolean }) => l.featured === false));

// --- 8. Real getListingBumpPrice privileged handler -------------------------------
const priceEntry = privilegedHandlers.entries.find((e: { contract: unknown }) => e.contract === privileged.getListingBumpPrice);
check("getListingBumpPrice handler is registered", !!priceEntry);
const realFetch = globalThis.fetch;
const savedSecret = process.env.STRIPE_SECRET_KEY;
const savedPriceId = process.env.STRIPE_BUMP_PRICE_ID;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_BUMP_PRICE_ID;
try {
  let fetchCalls = 0;
  let lastUrl = "";
  let lastAuth = "";
  globalThis.fetch = (async (url: any, init: any) => {
    fetchCalls++;
    lastUrl = String(url);
    lastAuth = init?.headers?.Authorization ?? "";
    const priceId = lastUrl.split("/prices/")[1] ?? "";
    if (priceId === "price_9") return { ok: true, json: async () => ({ unit_amount: 900, currency: "usd" }) };
    if (priceId === "price_1999") return { ok: true, json: async () => ({ unit_amount: 1999, currency: "usd" }) };
    if (priceId === "price_eur") return { ok: true, json: async () => ({ unit_amount: 500, currency: "eur" }) };
    if (priceId === "price_null") return { ok: true, json: async () => ({ unit_amount: null, currency: "usd" }) };
    if (priceId === "price_500") return { ok: false, status: 404 };
    throw new Error("network down");
  }) as typeof fetch;

  const callPrice = (priceId: string) => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_BUMP_PRICE_ID = priceId;
    return (priceEntry as any).handler({});
  };

  check("price lookup returns null without env (no fetch)", (await (priceEntry as any).handler({})).priceDisplay === null && fetchCalls === 0);
  const usd9 = await callPrice("price_9");
  check("USD 900c formats as $9.00", usd9.priceDisplay === "$9.00", JSON.stringify(usd9));
  check("price fetch hits the Stripe prices API with Bearer auth", lastUrl === "https://api.stripe.com/v1/prices/price_9" && lastAuth === "Bearer sk_test_123", `${lastUrl} / ${lastAuth}`);
  const cached = await callPrice("price_9");
  check("price lookup is cached (no second fetch)", cached.priceDisplay === "$9.00" && fetchCalls === 1, `calls=${fetchCalls}`);
  check("USD 1999c formats as $19.99", (await callPrice("price_1999")).priceDisplay === "$19.99");
  check("non-USD formats with currency code", (await callPrice("price_eur")).priceDisplay === "5.00 EUR");
  check("null unit_amount yields null", (await callPrice("price_null")).priceDisplay === null);
  check("non-ok Stripe response yields null", (await callPrice("price_500")).priceDisplay === null);
  check("fetch failure yields null", (await callPrice("price_boom")).priceDisplay === null);
} finally {
  globalThis.fetch = realFetch;
  if (savedSecret === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = savedSecret;
  if (savedPriceId === undefined) delete process.env.STRIPE_BUMP_PRICE_ID; else process.env.STRIPE_BUMP_PRICE_ID = savedPriceId;
}

// --- 9. Static client guards ------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const themeSrc = await readFile("client/src/theme.css", "utf8");
check("pay CTA cannot wrap word-per-line", themeSrc.includes(".market-bump-sheet .primary-button { margin-top: 10px; width: 100%; white-space: nowrap; }"));
check("sheet gates the pay button on billing readiness", appSrc.includes("!billingReady ? (") && appSrc.includes("billingNote"));
check("sheet shows the price in the offer and CTA", appSrc.includes("launch-option-price") && appSrc.includes("${text.featureFor7Days} · ${price}"));
check("sheet falls back to a tap-to-open link when popups are blocked", appSrc.includes("popupBlocked") && appSrc.includes("openCheckout"));
check("success return refreshes bump status and feed", appSrc.includes('invalidateQueries({ queryKey: ["listing-bump"] })'));

await rm(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nAll promote flow behavior tests passed.");
