// Build 0.6 item 22: marketplace contact unlock monetization (hybrid model).
//
// Covers:
//  1. Migration 0065 applies: unlock/credit/quota tables + settings.phone flag.
//  2. getMarketplaceUnlockStatus: fresh company -> 3 free, 0 pro (not pro), 0 credits.
//  3. Phone gating: listing shape hides companyPhone until unlocked.
//  4. unlockMarketplaceContact: consumes free first; idempotent on re-unlock.
//  5. Consumption order: free -> pro_quota -> credit.
//  6. NO_UNLOCKS_REMAINING when everything is exhausted.
//  7. Cross-company isolation: unlocks are per-company.
//  8. createMarketplaceListing requires phone verification (PHONE_NOT_VERIFIED).
//  9. Credit-pack webhook: credits balance, idempotent on duplicate events.
//  10. Static guards: privileged checkout + client unlock UI exist.
//
// Run from app/:  bun marketplace-unlocks.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq, and } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
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

const clientSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");
const privSrc = await readFile("server/src/privileged.ts", "utf8");

// --- 1. Scratch DB + migrate -------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-unlock-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

for (const t of ["marketplace_unlocks", "marketplace_credits", "marketplace_credit_purchases", "marketplace_pro_quota"]) {
  const tables = await sqlite.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='${t}'`);
  check(`migration creates ${t}`, tables.rows.length === 1);
}
const settingsCols = await sqlite.execute("PRAGMA table_info(settings)");
check("settings.marketplace_phone_verified exists", settingsCols.rows.some((r) => (r as { name: string }).name === "marketplace_phone_verified"));

// Canned webhook events for the privileged stub.
const cannedWebhookEvents: any[] = [];
const ctx: any = {
  slug: "tradesign",
  invocationId: "unlock-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => null,
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => {
    const event = cannedWebhookEvents.shift();
    if (!event) throw new Error("no canned webhook event");
    return event;
  },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
};

const now = new Date();
// Company 1: free user with a listing to unlock.
await db.insert(schema.authUsers).values({ companyId: 1, name: "Owner", email: "owner@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH" });
await db.insert(schema.settings).values({ companyId: 1, companyName: "Test Co", phone: "8135550100", marketplacePhoneVerified: true });
// Company 2: owns the listings being unlocked.
await db.insert(schema.authUsers).values({ companyId: 2, name: "Other", email: "other@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "HIJKLMNO" });
await db.insert(schema.settings).values({ companyId: 2, companyName: "Other Co", phone: "8135550200", marketplacePhoneVerified: true });

const mkListing = async (n: number) => (await db.insert(schema.marketplaceListings).values({
  companyId: 2, title: `Listing ${n}`, category: "plumbing", serviceArea: "Tampa",
  companyName: "Other Co", companyPhone: "8135550200", moderationStatus: "active",
  createdAt: now, updatedAt: now,
}).returning({ id: schema.marketplaceListings.id }))[0]!.id;
const listingIds = [await mkListing(1), await mkListing(2), await mkListing(3), await mkListing(4), await mkListing(5)];

// --- 2. Unlock status for a fresh company ------------------------------------
const fresh = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("fresh company: 3 free unlocks", fresh?.freeRemaining === 3 && fresh?.freeTotal === 3, JSON.stringify(fresh));
check("fresh company: not pro, no quota", fresh?.isPro === false && fresh?.proQuotaRemaining === 0);
check("fresh company: 0 credits", fresh?.creditBalance === 0);

// --- 3. Phone gating ---------------------------------------------------------
const gated = await (BaseActions.getMarketplaceListing as any).handler(ctx, { id: listingIds[0] });
check("phone hidden before unlock", gated?.listing?.companyPhone === "" && gated?.listing?.contactUnlocked === false, JSON.stringify(gated?.listing?.companyPhone));

// --- 4. Unlock consumes free first; idempotent -------------------------------
const u1 = await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: listingIds[0] });
check("first unlock uses free source", u1?.source === "free" && u1?.phone === "8135550200", JSON.stringify(u1));
const after1 = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("free remaining drops to 2", after1?.freeRemaining === 2, JSON.stringify(after1));
const u1again = await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: listingIds[0] });
check("re-unlock is idempotent (same source)", u1again?.source === "free" && u1again?.phone === "8135550200");
const after1again = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("re-unlock does not consume again", after1again?.freeRemaining === 2);
const gated2 = await (BaseActions.getMarketplaceListing as any).handler(ctx, { id: listingIds[0] });
check("phone revealed after unlock", gated2?.listing?.companyPhone === "8135550200" && gated2?.listing?.contactUnlocked === true);

// --- 5. Consumption order: free -> pro_quota -> credit ------------------------
// Exhaust the 3 free unlocks.
await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: listingIds[1] });
await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: listingIds[2] });
const noFree = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("free exhausted after 3", noFree?.freeRemaining === 0);
// Make the user Pro -> next unlock should use pro_quota.
await db.update(schema.authUsers).set({ tier: "premium" }).where(eq(schema.authUsers.id, 1));
const uPro = await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: listingIds[3] });
check("pro user consumes pro_quota after free exhausted", uPro?.source === "pro_quota", JSON.stringify(uPro));
const proStatus = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("pro quota decrements", proStatus?.isPro === true && proStatus?.proQuotaRemaining === 9, JSON.stringify(proStatus));
// Exhaust pro quota (9 more) then fall to credits.
for (let i = 0; i < 9; i++) {
  const id = await mkListing(100 + i);
  await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: id });
}
const noPro = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("pro quota exhausted", noPro?.proQuotaRemaining === 0, JSON.stringify(noPro));
// Give credits directly, then unlock should use credit.
await db.insert(schema.marketplaceCredits).values({ companyId: 1, balance: 5, updatedAt: now });
const uCredit = await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: listingIds[4] });
check("falls back to credit when free+pro exhausted", uCredit?.source === "credit", JSON.stringify(uCredit));
const credStatus = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("credit balance decrements", credStatus?.creditBalance === 4, JSON.stringify(credStatus));

// --- 6. NO_UNLOCKS_REMAINING ---------------------------------------------------
// Downgrade to free (no pro quota), drain credits.
await db.update(schema.authUsers).set({ tier: "free" }).where(eq(schema.authUsers.id, 1));
await db.update(schema.marketplaceCredits).set({ balance: 0 }).where(eq(schema.marketplaceCredits.companyId, 1));
let noUnlocks = false;
try {
  await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: await mkListing(999) });
} catch (e) {
  noUnlocks = (e as Error).message === "NO_UNLOCKS_REMAINING";
}
check("throws NO_UNLOCKS_REMAINING when exhausted", noUnlocks);

// --- 7. Cross-company isolation -----------------------------------------------
const ctx2: any = { ...ctx, workspaceCompanyId: 2, workspaceUserId: 2 };
const otherStatus = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx2, {});
check("company 2 has its own fresh quota", otherStatus?.freeRemaining === 3, JSON.stringify(otherStatus));

// --- 8. Phone verification gate -------------------------------------------------
// Company 3: no phone verification.
await db.insert(schema.authUsers).values({ companyId: 3, name: "Third", email: "third@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "PQRSTUVW" });
await db.insert(schema.settings).values({ companyId: 3, companyName: "Third Co", phone: "8135550300" });
const ctx3: any = { ...ctx, workspaceCompanyId: 3, workspaceUserId: 3 };
let phoneBlocked = false;
try {
  await (BaseActions.createMarketplaceListing as any).handler(ctx3, {
    title: "Test", category: "plumbing", listingType: "project", employmentType: "full_time",
    payUnit: "hourly", priceKind: "contact", price: "", originalPrice: "", description: "d",
    serviceArea: "Tampa", companyName: "Third Co", companyPhone: "8135550300", photos: [],
  });
} catch (e) {
  phoneBlocked = (e as Error).message === "PHONE_NOT_VERIFIED";
}
check("listing blocked without phone verification", phoneBlocked);
const verified = await (BaseActions.verifyMarketplacePhone as any).handler(ctx3, {});
check("verifyMarketplacePhone sets the flag", verified?.verified === true);
const madeListing = await (BaseActions.createMarketplaceListing as any).handler(ctx3, {
  title: "Test", category: "plumbing", listingType: "project", employmentType: "full_time",
  payUnit: "hourly", priceKind: "contact", price: "", originalPrice: "", description: "d",
  serviceArea: "Tampa", companyName: "Third Co", companyPhone: "8135550300", photos: [],
});
check("listing succeeds after verification", typeof madeListing?.id === "number");

// --- 9. Credit-pack webhook ------------------------------------------------------
cannedWebhookEvents.push({
  eventId: "evt_credit_1", eventType: "checkout.session.completed",
  userId: 1, customerId: "cus_1", subscriptionId: null, subscriptionStatus: null,
  currentPeriodEnd: null, cancelAtPeriodEnd: false,
  checkoutType: "credit_pack", plan: null, listingId: null, companyId: 1,
  packSize: 5, stripeSessionId: "cs_credit_1",
});
const wh1 = await (BaseActions.handleStripeWebhook as any).handler(ctx, { payload: "x", signature: "y" });
check("credit webhook processed", wh1?.processed === true);
const bal1 = (await db.select().from(schema.marketplaceCredits).where(eq(schema.marketplaceCredits.companyId, 1)).limit(1))[0];
check("webhook credits the balance (+5)", bal1?.balance === 5, `balance=${bal1?.balance}`);
const purchase = (await db.select().from(schema.marketplaceCreditPurchases).where(eq(schema.marketplaceCreditPurchases.stripeSessionId, "cs_credit_1")).limit(1))[0];
check("purchase recorded", purchase?.packSize === 5 && purchase?.amountCents === 900);
// Duplicate event -> idempotent.
cannedWebhookEvents.push({
  eventId: "evt_credit_1", eventType: "checkout.session.completed",
  userId: 1, customerId: "cus_1", subscriptionId: null, subscriptionStatus: null,
  currentPeriodEnd: null, cancelAtPeriodEnd: false,
  checkoutType: "credit_pack", plan: null, listingId: null, companyId: 1,
  packSize: 5, stripeSessionId: "cs_credit_1",
});
const wh2 = await (BaseActions.handleStripeWebhook as any).handler(ctx, { payload: "x", signature: "y" });
check("duplicate webhook is idempotent", wh2?.duplicate === true);
const bal2 = (await db.select().from(schema.marketplaceCredits).where(eq(schema.marketplaceCredits.companyId, 1)).limit(1))[0];
check("duplicate does not double-credit", bal2?.balance === 5, `balance=${bal2?.balance}`);

// --- 10. Static guards ------------------------------------------------------------
check("privileged: createCreditPackCheckout contract exists", privSrc.includes("createCreditPackCheckout"));
check("privileged: credit pack uses env price IDs", privSrc.includes("STRIPE_CREDIT_PACK_5_PRICE_ID") && privSrc.includes("STRIPE_CREDIT_PACK_15_PRICE_ID"));
check("server: unlock consumes free->pro->credit", serverSrc.includes('source = "free"') && serverSrc.includes('source = "pro_quota"') && serverSrc.includes('source = "credit"'));
check("server: unlock rate limit (20/hr)", serverSrc.includes('"marketplace_unlock"') && serverSrc.includes(">= 20"));
check("client: unlock sheet UI exists", clientSrc.includes("MarketplaceContactUnlock") && clientSrc.includes("unlock-sheet"));
check("client: unlock status pill exists", clientSrc.includes("UnlockStatusPill") && clientSrc.includes("unlock-status-pill"));
check("client: phone gated behind contactUnlocked", clientSrc.includes("contactUnlocked"));

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
} else {
  console.log("\nALL CHECKS PASSED");
}
