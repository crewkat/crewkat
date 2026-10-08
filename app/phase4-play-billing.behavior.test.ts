// Phase 4 behavior tests: Google Play Billing (TWA, package com.crewkat.app).
//
// Covers: migration 0052 (play_purchase_token/play_order_id columns on
// auth_users + play_billing_purchases table), the privileged verification
// contract's graceful unconfigured behavior (no crash, no grant), and the
// action layer with mocked Google Play Developer API responses:
//   - grant premium on a valid ACTIVE subscription
//   - reject an invalid (unverifiable) subscription
//   - reject an expired subscription
//   - graceful failure when Play Billing is not configured
//   - refreshPlaySubscription downgrade on expiry
//   - getSubscription provider field ("play" vs "stripe" vs "none")
//
// No real Google credentials or network are used: executePrivileged is stubbed
// and the privileged handlers are invoked directly only for paths that return
// before any network call.
//
// Run from app/:  bun phase4-play-billing.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
// NOTE: there are two contract instances — the real one in privileged.ts
// (used to locate handler entries) and the generated mirror at
// @space/privileged (the one the actions actually pass to executePrivileged).
import { privileged as realPrivileged, privilegedHandlers } from "./server/src/privileged.ts";
// The generated mirror (the instance the actions pass to executePrivileged).
import { privileged } from "./server/.generated/privileged.contract.ts";
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
async function checkThrows(name: string, fn: () => Promise<unknown>, messagePart = "") {
  try {
    await fn();
    failures++;
    console.error(`FAIL ${name} — expected an error but none was thrown`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (messagePart && !message.includes(messagePart)) {
      failures++;
      console.error(`FAIL ${name} — error message ${JSON.stringify(message)} does not include ${JSON.stringify(messagePart)}`);
    } else {
      console.log(`ok   ${name}`);
    }
  }
}

// --- 1. Migration journal ordering -------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
let nonDecreasing = true;
for (let i = 1; i < entries.length; i++) {
  if (entries[i]!.when < entries[i - 1]!.when) nonDecreasing = false;
}
check("journal when values are non-decreasing", nonDecreasing);
const last = entries[entries.length - 1]!;
const maxBefore = Math.max(...entries.slice(0, -1).map((e) => e.when));
check("newest migration when is strictly greater than every earlier entry", last.when > maxBefore);
check("newest migration tag is 0070_account_deletion_codes", last.tag === "0070_account_deletion_codes", last.tag);

// --- 2. Apply all migrations on a scratch DB ---------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-phase4-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const tables = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
const userCols = (await sqlite.execute("PRAGMA table_info(auth_users)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: auth_users.play_purchase_token exists", userCols.includes("play_purchase_token"));
check("migrations applied: auth_users.play_order_id exists", userCols.includes("play_order_id"));
check("migrations applied: play_billing_purchases table exists", tables.includes("play_billing_purchases"));
const purchaseCols = (await sqlite.execute("PRAGMA table_info(play_billing_purchases)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: play_billing_purchases has purchase_token", purchaseCols.includes("purchase_token"));
const indexes = (await sqlite.execute("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='play_billing_purchases'").then((r) => (r.rows as Array<{ sql: string | null }>).map((i) => i.sql ?? "")));
check("migrations applied: play_billing_purchases unique purchase-token index", indexes.some((s) => s.toUpperCase().includes("UNIQUE") && s.includes("purchase_token")));

// --- 3. Privileged handlers, unconfigured (no env, no network) --------------
// Make sure no Play credentials leak in from the environment.
const savedEnv = { ...process.env };
delete process.env.PLAY_SERVICE_ACCOUNT_JSON;
delete process.env.PLAY_SERVICE_ACCOUNT_JSON_PATH;
delete process.env.PLAY_PREMIUM_SKU;
delete process.env.PLAY_PACKAGE_NAME;

function findHandler(contract: unknown): (args: never) => Promise<unknown> {
  const entry = (privilegedHandlers as unknown as { entries: Array<{ contract: unknown; handler: (args: never) => Promise<unknown> }> }).entries.find((e) => e.contract === contract);
  if (!entry) throw new Error("privileged handler entry not found");
  return entry.handler;
}
const verifyHandler = findHandler(realPrivileged.verifyPlayPurchase);
const statusHandler = findHandler(realPrivileged.getPlayBillingStatus);

const status = await statusHandler({} as never) as { configured: boolean; sku: string; packageName: string };
check("getPlayBillingStatus: unconfigured without env", status.configured === false);
check("getPlayBillingStatus: default SKU", status.sku === "crewkat_premium_monthly", status.sku);
check("getPlayBillingStatus: default package name", status.packageName === "com.crewkat.app", status.packageName);

const unconfigured = await verifyHandler({ purchaseToken: "tok", sku: "crewkat_premium_monthly" } as never) as { configured: boolean; verified: boolean; active: boolean };
check("verifyPlayPurchase: configured=false when no service account", unconfigured.configured === false);
check("verifyPlayPurchase: nothing verified when unconfigured", unconfigured.verified === false && unconfigured.active === false);

const wrongSku = await verifyHandler({ purchaseToken: "tok", sku: "not_our_sku" } as never) as { verified: boolean; error: string | null };
check("verifyPlayPurchase: unknown SKU rejected before any Google call", wrongSku.verified === false && wrongSku.error === "Unknown product.", JSON.stringify(wrongSku));

// --- 4. Action layer with mocked Google responses ----------------------------
type VerifyResult = {
  configured: boolean; verified: boolean; active: boolean;
  orderId: string | null; expiryTimeMillis: string | null; autoRenewing: boolean; error: string | null;
};
let mockedVerify: VerifyResult | null = null;
let privilegedCalls = 0;

const [owner] = await db.insert(schema.authUsers).values({ companyId: 1, name: "Play Owner", email: "owner@phase4.test", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "PHASE400" }).returning({ id: schema.authUsers.id });

const ctx = {
  slug: "tradesign",
  invocationId: "phase4-test",
  spaceDir: dir,
  db: () => db,
  workspaceCompanyId: 1,
  workspaceUserId: owner!.id,
  executePrivileged: async (fn: unknown, _args: Record<string, unknown>) => {
    privilegedCalls++;
    if (fn === privileged.verifyPlayPurchase) {
      if (!mockedVerify) throw new Error("no mocked Google response");
      return mockedVerify;
    }
    if (fn === privileged.getPlayBillingStatus) {
      return { configured: true, sku: "crewkat_premium_monthly", packageName: "com.crewkat.app" };
    }
    throw new Error("unexpected privileged call");
  },
  emit: () => {},
  invalidateQueries: () => {},
  sessionToken: null,
};

const activeGoogle: VerifyResult = {
  configured: true, verified: true, active: true,
  orderId: "GPA.1234-5678-9012-34567", expiryTimeMillis: String(Date.now() + 30 * 24 * 3600 * 1000),
  autoRenewing: true, error: null,
};
const invalidGoogle: VerifyResult = { configured: true, verified: false, active: false, orderId: null, expiryTimeMillis: null, autoRenewing: false, error: "Purchase not found." };
const expiredGoogle: VerifyResult = { configured: true, verified: true, active: false, orderId: "GPA.9999", expiryTimeMillis: String(Date.now() - 3600 * 1000), autoRenewing: false, error: null };
const unconfiguredGoogle: VerifyResult = { configured: false, verified: false, active: false, orderId: null, expiryTimeMillis: null, autoRenewing: false, error: "Google Play Billing verification is not configured." };

async function getUser() {
  return (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, owner!.id)).limit(1))[0]!;
}

// 4a. Valid active subscription -> premium granted, metadata linked.
mockedVerify = activeGoogle;
const granted = await BaseActions.verifyPlaySubscription.handler(ctx as never, { purchaseToken: "play-token-1", sku: "crewkat_premium_monthly" } as never);
check("verifyPlaySubscription: valid active purchase grants premium", (granted as { tier: string }).tier === "premium");
const afterGrant = await getUser();
check("verifyPlaySubscription: tier=premium + active status stored", afterGrant.tier === "premium" && afterGrant.subscriptionStatus === "active");
check("verifyPlaySubscription: purchase token + order id linked to account", afterGrant.playPurchaseToken === "play-token-1" && afterGrant.playOrderId === "GPA.1234-5678-9012-34567");
const purchaseRows = await db.select().from(schema.playBillingPurchases).where(eq(schema.playBillingPurchases.purchaseToken, "play-token-1"));
check("verifyPlaySubscription: verified-purchase row persisted", purchaseRows.length === 1 && purchaseRows[0]!.userId === owner!.id);

// Idempotency: verifying the same token again does not duplicate the row.
await BaseActions.verifyPlaySubscription.handler(ctx as never, { purchaseToken: "play-token-1", sku: "crewkat_premium_monthly" } as never);
const purchaseRows2 = await db.select().from(schema.playBillingPurchases).where(eq(schema.playBillingPurchases.purchaseToken, "play-token-1"));
check("verifyPlaySubscription: re-verifying the same token is idempotent", purchaseRows2.length === 1);

// getSubscription reports the Play provider.
const sub = await BaseActions.getSubscription.handler(ctx as never, {} as never) as { tier: string; provider: string };
check("getSubscription: provider=play after Play grant", sub.tier === "premium" && sub.provider === "play", JSON.stringify(sub));

// 4b. Invalid subscription -> rejected, account stays free.
await db.update(schema.authUsers).set({ tier: "free", subscriptionStatus: "none", playPurchaseToken: null, playOrderId: null }).where(eq(schema.authUsers.id, owner!.id));
mockedVerify = invalidGoogle;
await checkThrows("verifyPlaySubscription: invalid purchase throws and grants nothing", () => BaseActions.verifyPlaySubscription.handler(ctx as never, { purchaseToken: "bogus", sku: "crewkat_premium_monthly" } as never), "Purchase not found.");
check("verifyPlaySubscription: account still free after invalid purchase", (await getUser()).tier === "free");

// 4c. Expired subscription -> rejected, account stays free.
mockedVerify = expiredGoogle;
await checkThrows("verifyPlaySubscription: expired purchase throws and grants nothing", () => BaseActions.verifyPlaySubscription.handler(ctx as never, { purchaseToken: "old-token", sku: "crewkat_premium_monthly" } as never), "could not be verified");
check("verifyPlaySubscription: account still free after expired purchase", (await getUser()).tier === "free");

// 4d. Unconfigured server -> graceful error, no grant, no crash.
mockedVerify = unconfiguredGoogle;
await checkThrows("verifyPlaySubscription: unconfigured Play Billing fails gracefully", () => BaseActions.verifyPlaySubscription.handler(ctx as never, { purchaseToken: "play-token-9", sku: "crewkat_premium_monthly" } as never), "not connected yet");
check("verifyPlaySubscription: account still free when unconfigured", (await getUser()).tier === "free");

// 4e. getPlayBillingConfig passes server config through (no secrets).
const config = await BaseActions.getPlayBillingConfig.handler(ctx as never, {} as never) as { configured: boolean; sku: string; packageName: string };
check("getPlayBillingConfig: returns configured/sku/packageName", config.configured === true && config.sku === "crewkat_premium_monthly" && config.packageName === "com.crewkat.app");

// 4f. refreshPlaySubscription: active stored token keeps premium.
await db.update(schema.authUsers).set({ tier: "premium", subscriptionStatus: "active", playPurchaseToken: "play-token-1", playOrderId: "GPA.1234-5678-9012-34567" }).where(eq(schema.authUsers.id, owner!.id));
mockedVerify = activeGoogle;
const refreshed = await BaseActions.refreshPlaySubscription.handler(ctx as never, {} as never) as { tier: string; status: string };
check("refreshPlaySubscription: active stored purchase keeps premium", refreshed.tier === "premium" && refreshed.status === "active");

// 4g. refreshPlaySubscription: expired stored token downgrades to free.
mockedVerify = expiredGoogle;
const downgraded = await BaseActions.refreshPlaySubscription.handler(ctx as never, {} as never) as { tier: string; status: string };
check("refreshPlaySubscription: expired purchase downgrades to free", downgraded.tier === "free" && downgraded.status === "expired");
const afterDowngrade = await getUser();
check("refreshPlaySubscription: tier=free stored, token retained for resubscribe", afterDowngrade.tier === "free" && afterDowngrade.playPurchaseToken === "play-token-1");

// 4h. refreshPlaySubscription with no stored token: no Google call.
privilegedCalls = 0;
await db.update(schema.authUsers).set({ playPurchaseToken: null }).where(eq(schema.authUsers.id, owner!.id));
const noToken = await BaseActions.refreshPlaySubscription.handler(ctx as never, {} as never) as { tier: string };
check("refreshPlaySubscription: no stored token makes no privileged calls", privilegedCalls === 0 && noToken.tier === "free", `calls=${privilegedCalls}`);

// 4i. getSubscription provider variants.
await db.update(schema.authUsers).set({ tier: "premium", subscriptionStatus: "active", stripeSubscriptionId: "sub_stripe_1", playPurchaseToken: null }).where(eq(schema.authUsers.id, owner!.id));
const stripeSub = await BaseActions.getSubscription.handler(ctx as never, {} as never) as { provider: string };
check("getSubscription: provider=stripe for Stripe-billed account", stripeSub.provider === "stripe", stripeSub.provider);
await db.update(schema.authUsers).set({ tier: "free", subscriptionStatus: "none", stripeSubscriptionId: null }).where(eq(schema.authUsers.id, owner!.id));
const freeSub = await BaseActions.getSubscription.handler(ctx as never, {} as never) as { provider: string };
check("getSubscription: provider=none for free account", freeSub.provider === "none", freeSub.provider);

process.env = savedEnv;

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll Phase 4 Play Billing behavior checks passed.");
