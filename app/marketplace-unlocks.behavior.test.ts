// Build 0.7: marketplace monetization is PAUSED.
//
// Covers:
//  1. Migration 0065 applies: unlock/credit/quota tables + settings.phone flag
//     (tables kept intact for a future re-enable).
//  2. getMarketplaceUnlockStatus: fresh company -> 3 free, 0 pro (not pro), 0 credits.
//  3. Phone gating: listing shape hides companyPhone until revealed.
//  4. unlockMarketplaceContact: returns phone with source "free", consumes NOTHING.
//  5. No consumption order anymore: reveals never touch free/pro/credit balances.
//  6. NO_UNLOCKS_REMAINING is gone: reveal succeeds even on an exhausted account.
//  7. Owner reveal: source "owner"; empty phone returns "" (client shows a note).
//  8. Cross-company isolation: status is per-company.
//  9. No phone-verification gate: createMarketplaceListing works unverified,
//     and companyName is optional (empty string allowed/stored).
//  10. startMarketplaceConversation is free: consumes nothing.
//  11. Credit-pack webhook: credits balance, idempotent on duplicate events
//      (Stripe products kept, paused not deleted).
//  12. Static guards: privileged checkout contract, no unlock sheet/upsell in
//      the client, pill moved to Profile, no company name on cards.
//
// Run from app/:  bun marketplace-unlocks.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
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
// Company 1: free user revealing contacts.
await db.insert(schema.authUsers).values({ companyId: 1, name: "Owner", email: "owner@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH" });
await db.insert(schema.settings).values({ companyId: 1, companyName: "Test Co", phone: "8135550100", marketplacePhoneVerified: true });
// Company 2: owns the listings being revealed.
await db.insert(schema.authUsers).values({ companyId: 2, name: "Other", email: "other@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "HIJKLMNO" });
await db.insert(schema.settings).values({ companyId: 2, companyName: "Other Co", phone: "8135550200", marketplacePhoneVerified: true });

const mkListing = async (n: number, phone = "8135550200") => (await db.insert(schema.marketplaceListings).values({
  companyId: 2, title: `Listing ${n}`, category: "plumbing", serviceArea: "Tampa",
  companyName: "Other Co", companyPhone: phone, moderationStatus: "active",
  createdAt: now, updatedAt: now,
}).returning({ id: schema.marketplaceListings.id }))[0]!.id;
const listingIds = [await mkListing(1), await mkListing(2), await mkListing(3), await mkListing(4), await mkListing(5)];

// --- 2. Unlock status for a fresh company ------------------------------------
const fresh = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("fresh company: 3 free unlocks", fresh?.freeRemaining === 3 && fresh?.freeTotal === 3, JSON.stringify(fresh));
check("fresh company: not pro, no quota", fresh?.isPro === false && fresh?.proQuotaRemaining === 0);
check("fresh company: 0 credits", fresh?.creditBalance === 0);

// --- 3. Phone gating in the listing shape ------------------------------------
const gated = await (BaseActions.getMarketplaceListing as any).handler(ctx, { id: listingIds[0] });
check("phone hidden in listing shape before reveal", gated?.listing?.companyPhone === "" && gated?.listing?.contactUnlocked === false, JSON.stringify(gated?.listing?.companyPhone));

// --- 4. Reveal is free and consumes nothing ----------------------------------
const u1 = await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: listingIds[0] });
check("reveal returns free source with phone", u1?.source === "free" && u1?.phone === "8135550200", JSON.stringify(u1));
const after1 = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("reveal consumes nothing (free still 3)", after1?.freeRemaining === 3, JSON.stringify(after1));
const u1again = await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: listingIds[0] });
check("repeat reveal is free too", u1again?.source === "free" && u1again?.phone === "8135550200");
const after1again = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("repeat reveal still consumes nothing", after1again?.freeRemaining === 3);

// --- 5. No consumption across many reveals -----------------------------------
for (const id of listingIds.slice(1)) {
  const u = await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: id });
  if (u?.source !== "free" || u?.phone !== "8135550200") {
    check(`reveal on listing ${id} is free`, false, JSON.stringify(u));
  }
}
console.log("ok   reveals on remaining listings are free");
const afterMany = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("free unlocks untouched after many reveals", afterMany?.freeRemaining === 3, JSON.stringify(afterMany));
// Pro user: still free, quota untouched.
await db.update(schema.authUsers).set({ tier: "premium" }).where(eq(schema.authUsers.id, 1));
const uPro = await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: listingIds[0] });
check("pro reveal is free (no quota consumed)", uPro?.source === "free", JSON.stringify(uPro));
const proStatus = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("pro quota still full", proStatus?.isPro === true && proStatus?.proQuotaRemaining === 10, JSON.stringify(proStatus));
await db.update(schema.authUsers).set({ tier: "free" }).where(eq(schema.authUsers.id, 1));

// --- 6. NO_UNLOCKS_REMAINING is gone ------------------------------------------
// Simulate a fully-exhausted account straight in the tables.
for (const id of listingIds.slice(0, 3)) {
  await db.insert(schema.marketplaceUnlocks).values({ companyId: 1, unlockedByUserId: 1, listingId: id, source: "free" });
}
await db.insert(schema.marketplaceCredits).values({ companyId: 1, balance: 0, updatedAt: now });
const exhausted = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("account shows exhausted", exhausted?.freeRemaining === 0, JSON.stringify(exhausted));
const uFree = await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: await mkListing(999) });
check("reveal succeeds on exhausted account (paused)", uFree?.source === "free" && uFree?.phone === "8135550200", JSON.stringify(uFree));

// --- 7. Owner + empty-phone cases ---------------------------------------------
const ctx2: any = { ...ctx, workspaceCompanyId: 2, workspaceUserId: 2 };
const ownReveal = await (BaseActions.unlockMarketplaceContact as any).handler(ctx2, { listingId: listingIds[0] });
check("owner reveal uses owner source", ownReveal?.source === "owner" && ownReveal?.phone === "8135550200", JSON.stringify(ownReveal));
const noPhoneId = await mkListing(1000, "");
const noPhone = await (BaseActions.unlockMarketplaceContact as any).handler(ctx, { listingId: noPhoneId });
check("listing without phone returns empty string (no throw)", noPhone?.source === "free" && noPhone?.phone === "", JSON.stringify(noPhone));

// --- 8. Cross-company isolation -------------------------------------------------
const otherStatus = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx2, {});
check("company 2 has its own fresh quota", otherStatus?.freeRemaining === 3, JSON.stringify(otherStatus));

// --- 9. No phone-verification gate; company name optional ------------------------
// Company 3: never verified.
await db.insert(schema.authUsers).values({ companyId: 3, name: "Third", email: "third@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "PQRSTUVW" });
await db.insert(schema.settings).values({ companyId: 3, companyName: "Third Co", phone: "8135550300" });
const ctx3: any = { ...ctx, workspaceCompanyId: 3, workspaceUserId: 3 };
const madeListing = await (BaseActions.createMarketplaceListing as any).handler(ctx3, {
  title: "Test", category: "plumbing", intent: "offer", employmentType: "full_time",
  payUnit: "hourly", priceKind: "contact", price: "", originalPrice: "", description: "Call 8135550300 for details",
  serviceArea: "Tampa", zipCode: "33647", companyName: "", companyPhone: "", photos: [],
});
check("listing succeeds without phone verification and without company name", typeof madeListing?.id === "number");
const stored = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, madeListing.id)).limit(1))[0];
check("empty company name is stored", stored?.companyName === "", JSON.stringify(stored?.companyName));
check("phone number in description is allowed through", stored?.description === "Call 8135550300 for details");
// The test's raw drizzle lacks the production db proxy that stamps company_id
// on inserts (schema defaults to 1); fix it up to mirror production.
await db.update(schema.marketplaceListings).set({ companyId: 3 }).where(eq(schema.marketplaceListings.id, madeListing.id));
// verifyMarketplacePhone still works (harmless, kept for a future re-enable).
const verified = await (BaseActions.verifyMarketplacePhone as any).handler(ctx3, {});
check("verifyMarketplacePhone still sets the flag", verified?.verified === true);
// Edit path: company name can be cleared on edit too.
const edited = await (BaseActions.updateMarketplaceListing as any).handler(ctx3, {
  id: madeListing.id, title: "Test", category: "plumbing", intent: "offer", employmentType: "full_time",
  payUnit: "hourly", priceKind: "contact", price: "", originalPrice: "", description: "d",
  serviceArea: "Tampa", zipCode: "33647", companyName: "", companyPhone: "", bookable: false, dailyRate: "",
  replacePhotos: false, photos: [],
});
check("edit succeeds with empty company name", edited?.id === madeListing.id);

// --- 10. Messaging is free -------------------------------------------------------
const convo = await (BaseActions.startMarketplaceConversation as any).handler(ctx, { listingId: madeListing.id });
check("starting a conversation works", typeof convo?.conversationId === "number");
const afterConvo = await (BaseActions.getMarketplaceUnlockStatus as any).handler(ctx, {});
check("messaging consumes no unlocks", afterConvo?.freeRemaining === 0, JSON.stringify(afterConvo));

// --- 11. Credit-pack webhook (kept, paused not deleted) -----------------------------
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

// --- 12. Static guards --------------------------------------------------------------
check("privileged: createCreditPackCheckout contract exists", privSrc.includes("createCreditPackCheckout"));
check("privileged: credit pack uses env price IDs", privSrc.includes("STRIPE_CREDIT_PACK_5_PRICE_ID") && privSrc.includes("STRIPE_CREDIT_PACK_15_PRICE_ID"));
check("server: reveal returns free without consuming", serverSrc.includes('return { phone: listing.companyPhone ?? "", source: "free" as const }'));
check("server: no PHONE_NOT_VERIFIED gate", !serverSrc.includes("PHONE_NOT_VERIFIED"));
check("server: companyName optional in create/update", !serverSrc.includes("companyName: z.string().trim().min(1).max(180)"));
check("server: conversation start does not consume unlocks", !serverSrc.includes("await consumeMarketplaceUnlock(db, myCompanyId"));
check("client: free Show-contact reveal, no unlock sheet or upsell", clientSrc.includes("MarketplaceContactReveal") && !clientSrc.includes("unlock-sheet") && !clientSrc.includes("Unlock to message"));
check("client: status pill moved off the marketplace page to Profile", clientSrc.includes("UnlockStatusPill") && clientSrc.includes("unlock-status-row") && !clientSrc.includes("market-unlock-status"));
check("client: no company name on listing cards", !/<div className="market-card-copy">[\s\S]{0,600}?listing\.companyName/.test(clientSrc));
check("client: company name optional in the listing form", clientSrc.includes("Company name (optional)") && clientSrc.includes("Nombre de la empresa (opcional)"));
check("client: phone gated behind contactUnlocked", clientSrc.includes("contactUnlocked"));

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
} else {
  console.log("\nALL CHECKS PASSED");
}
