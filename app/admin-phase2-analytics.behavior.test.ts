// Admin panel Phase 2 — analytics behavior tests (2026-10-09).
//
// Covers:
//  1. adminMarketplaceOverview: listing/message/conversation/completed-job
//     counts with seeded rows (mixed moderationStatus, intent, dates,
//     completedAt set/null), listingsByIntent, listingsByDay buckets,
//     listingToMessageRate math (incl. 0 when no listings).
//  2. adminGrowthMetrics: WoW signup % math (with + without a baseline),
//     premium conversion %, avg messages per listing, open support count.
//  3. Non-admin (no team role) is blocked from both actions.
//
// NOTE: the coordinator bumps migration tags in ALL *.behavior.test.ts at
// the end, so this file has no "newest migration tag" check.
//
// Run from app/:  bun admin-phase2-analytics.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
// NOTE: dynamic imports, actions.ts first — it pulls in the phase2 aggregator
// which spreads this module's exports. Static interleaved imports hit a
// circular-import TDZ quirk in the bundler. Same pattern as the support tests.
const { BaseActions } = await import("./server/src/actions.ts");
const { platformAdminPhase2AnalyticsActions } = await import("./server/src/platform-admin-phase2-analytics.ts");
import * as schema from "./server/src/schema.ts";

const DAY = 86400000;
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else {
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

// --- 1. Scratch DB -----------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-an2-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const mkUser = (name: string, email: string, opts: { admin?: boolean; tier?: "free" | "premium"; createdAt?: Date } = {}) =>
  db.insert(schema.authUsers).values({
    name, email, passwordHash: "x", passwordSalt: "y",
    isPlatformAdmin: opts.admin ?? false,
    tier: opts.tier ?? "free",
    createdAt: opts.createdAt ?? now,
  });
const byEmail = async (email: string) =>
  (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, email)).limit(1))[0];

await mkUser("Danny", "admin@test.com", { admin: true, tier: "premium", createdAt: daysAgo(20) });
await mkUser("User One", "user1@test.com", { createdAt: daysAgo(3) });   // current 7d
await mkUser("User Two", "user2@test.com", { createdAt: daysAgo(4) });   // current 7d
await mkUser("User Three", "user3@test.com", { tier: "premium", createdAt: daysAgo(10) }); // prior 7d
await mkUser("User Four", "user4@test.com", { createdAt: daysAgo(11) }); // prior 7d
await mkUser("User Five", "user5@test.com", { createdAt: daysAgo(12) }); // prior 7d
await mkUser("User Six", "user6@test.com", { createdAt: daysAgo(13) });  // prior 7d
await mkUser("Oldie", "old@test.com", { createdAt: daysAgo(40) });       // outside windows
const admin = await byEmail("admin@test.com");
const user1 = await byEmail("user1@test.com");

const ctxFor = (user: typeof admin) => ({
  db: () => db,
  unscopedDb: () => db,
  workspaceCompanyId: user.companyId,
  workspaceUserId: user.id,
  invalidateQueries: () => {},
}) as any;

const actions = platformAdminPhase2AnalyticsActions as any;

// --- 2. Marketplace fixtures --------------------------------------------------
const mkListing = async (intent: "need" | "offer", moderationStatus: string, createdAt: Date) =>
  (await db.insert(schema.marketplaceListings).values({
    title: "Test listing", category: "handyman", intent, serviceArea: "Tampa Bay",
    companyName: "Test Co", moderationStatus, createdAt,
  }).returning({ id: schema.marketplaceListings.id }))[0];
const l1 = await mkListing("offer", "active", daysAgo(5));
await mkListing("offer", "active", daysAgo(5));
await mkListing("need", "active", daysAgo(40));
await mkListing("offer", "removed", daysAgo(5)); // not active
// listingsTotal=4, active=3, last30d=3 (l1 + 2 more), need=1, offer=3

await db.insert(schema.marketplaceMessages).values([
  { listingId: l1.id, body: "hi", createdAt: daysAgo(5) },
  { listingId: l1.id, body: "hello", createdAt: daysAgo(5) },
  { listingId: l1.id, body: "yo", createdAt: daysAgo(5) },
  { listingId: l1.id, body: "old", createdAt: daysAgo(40) },
  { listingId: l1.id, body: "older", createdAt: daysAgo(41) },
]);
// messagesTotal=5, last30d=3

for (const inquirer of [2, 3]) {
  await db.insert(schema.marketplaceConversations).values({
    listingId: l1.id, ownerCompanyId: 1, inquirerCompanyId: inquirer, lastMessageAt: daysAgo(5),
  });
}
// conversationsTotal=2

await db.insert(schema.jobs).values([
  { clientName: "A", jobAddress: "1 Main St", jobType: "remodel", jobDate: "2026-09-01", completedAt: daysAgo(5) },
  { clientName: "B", jobAddress: "2 Main St", jobType: "remodel", jobDate: "2026-08-01", completedAt: daysAgo(40) },
  { clientName: "C", jobAddress: "3 Main St", jobType: "remodel", jobDate: "2026-10-01", completedAt: null },
]);
// completedJobsTotal=2, completedJobsLast30d=1

await db.insert(schema.platformSupportReports).values([
  { userId: user1.id, userName: "User One", userEmail: "user1@test.com", kind: "support", subject: "s1", message: "m1", status: "open" },
  { userId: user1.id, userName: "User One", userEmail: "user1@test.com", kind: "support", subject: "s2", message: "m2", status: "open" },
  { userId: user1.id, userName: "User One", userEmail: "user1@test.com", kind: "support", subject: "s3", message: "m3", status: "resolved" },
]);

// --- 3. adminMarketplaceOverview ------------------------------------------------
const ov = await actions.adminMarketplaceOverview.handler(ctxFor(admin), {});
check("overview listingsTotal", ov.listingsTotal === 4, String(ov.listingsTotal));
check("overview listingsActive (excludes removed)", ov.listingsActive === 3, String(ov.listingsActive));
check("overview listingsLast30d", ov.listingsLast30d === 3, String(ov.listingsLast30d));
check("overview listingsByIntent.need", ov.listingsByIntent.need === 1, JSON.stringify(ov.listingsByIntent));
check("overview listingsByIntent.offer", ov.listingsByIntent.offer === 3, JSON.stringify(ov.listingsByIntent));
check("overview messagesTotal", ov.messagesTotal === 5, String(ov.messagesTotal));
check("overview messagesLast30d", ov.messagesLast30d === 3, String(ov.messagesLast30d));
check("overview conversationsTotal", ov.conversationsTotal === 2, String(ov.conversationsTotal));
check("overview completedJobsTotal", ov.completedJobsTotal === 2, String(ov.completedJobsTotal));
check("overview completedJobsLast30d", ov.completedJobsLast30d === 1, String(ov.completedJobsLast30d));
check("overview listingToMessageRate = 2/4 → 50.0", ov.listingToMessageRate === 50, String(ov.listingToMessageRate));
check("overview listingsByDay has 30 buckets", ov.listingsByDay.length === 30, String(ov.listingsByDay.length));
const byDaySum = ov.listingsByDay.reduce((a: number, d: { count: number }) => a + d.count, 0);
check("overview listingsByDay sums to listingsLast30d", byDaySum === ov.listingsLast30d, String(byDaySum));
const todayKey = now.toISOString().slice(0, 10);
const fiveDaysKey = daysAgo(5).toISOString().slice(0, 10);
check("overview listingsByDay bucket 5d ago = 3", ov.listingsByDay.find((d: { date: string }) => d.date === fiveDaysKey)?.count === 3);
check("overview listingsByDay today bucket = 0", ov.listingsByDay.find((d: { date: string }) => d.date === todayKey)?.count === 0);

// --- 4. adminGrowthMetrics ------------------------------------------------------
const gr = await actions.adminGrowthMetrics.handler(ctxFor(admin), {});
// signups: current7d=2 (user1, user2), prior7d=4 (user3..user6) → (2-4)/4 = -50.0%
check("growth signupGrowthWow = -50.0", gr.signupGrowthWow === -50, String(gr.signupGrowthWow));
check("growth wowHasBaseline true", gr.wowHasBaseline === true);
check("growth premiumTotal = 2", gr.premiumTotal === 2, String(gr.premiumTotal));
check("growth premiumConversionRate = 2/8 → 25.0", gr.premiumConversionRate === 25, String(gr.premiumConversionRate));
check("growth activeListings = 3", gr.activeListings === 3, String(gr.activeListings));
check("growth avgMessagesPerListing = 5/4 → 1.3", gr.avgMessagesPerListing === 1.3, String(gr.avgMessagesPerListing));
check("growth supportOpenCount = 2", gr.supportOpenCount === 2, String(gr.supportOpenCount));

// --- 5. WoW edge cases (fresh DBs, no baseline) ---------------------------------
async function edgeDb(setup: (db2: typeof db) => Promise<void>) {
  const dir2 = await mkdtemp(join(tmpdir(), "crewkat-an2e-"));
  const client2 = createClient({ url: `file:${join(dir2, "test.db")}` });
  const db2 = drizzle(client2, { schema });
  await migrate(db2, { migrationsFolder: "./drizzle" });
  await setup(db2);
  const ctx = {
    db: () => db2,
    unscopedDb: () => db2,
    workspaceCompanyId: 1,
    workspaceUserId: 1,
    invalidateQueries: () => {},
  } as any;
  const res = await actions.adminGrowthMetrics.handler(ctx, {});
  await client2.close();
  return res;
}

// Prior period empty, current period has a signup → 100, no baseline.
const edgeFresh = await edgeDb(async (db2) => {
  await db2.insert(schema.authUsers).values({ name: "A", email: "a@e.com", passwordHash: "x", passwordSalt: "y", isPlatformAdmin: true, createdAt: daysAgo(3) });
});
check("growth no-baseline with signup → 100", edgeFresh.signupGrowthWow === 100, String(edgeFresh.signupGrowthWow));
check("growth no-baseline flag false", edgeFresh.wowHasBaseline === false);
// Both periods empty → 0, no baseline.
const edgeEmpty = await edgeDb(async (db2) => {
  await db2.insert(schema.authUsers).values({ name: "A", email: "a@e.com", passwordHash: "x", passwordSalt: "y", isPlatformAdmin: true, createdAt: daysAgo(40) });
});
check("growth empty windows → 0", edgeEmpty.signupGrowthWow === 0, String(edgeEmpty.signupGrowthWow));
check("growth empty windows flag false", edgeEmpty.wowHasBaseline === false);

// Zero listings → rate 0, avg messages 0.
const dir2 = await mkdtemp(join(tmpdir(), "crewkat-an2z-"));
const client2 = createClient({ url: `file:${join(dir2, "test.db")}` });
const db2 = drizzle(client2, { schema });
await migrate(db2, { migrationsFolder: "./drizzle" });
await db2.insert(schema.authUsers).values({ name: "A", email: "a@e.com", passwordHash: "x", passwordSalt: "y", isPlatformAdmin: true });
const emptyAdmin = (await db2.select().from(schema.authUsers).where(eq(schema.authUsers.email, "a@e.com")).limit(1))[0];
const emptyCtx = {
  db: () => db2,
  unscopedDb: () => db2,
  workspaceCompanyId: emptyAdmin.companyId,
  workspaceUserId: emptyAdmin.id,
  invalidateQueries: () => {},
} as any;
const ovEmpty = await actions.adminMarketplaceOverview.handler(emptyCtx, {});
check("overview with no listings → rate 0", ovEmpty.listingToMessageRate === 0, String(ovEmpty.listingToMessageRate));
check("overview with no listings → totals 0", ovEmpty.listingsTotal === 0 && ovEmpty.messagesTotal === 0);
const grEmpty = await actions.adminGrowthMetrics.handler(emptyCtx, {});
check("growth with no listings → avg 0", grEmpty.avgMessagesPerListing === 0, String(grEmpty.avgMessagesPerListing));
await client2.close();

// --- 6. Non-admin blocked ---------------------------------------------------------
await throwsAsync("non-admin blocked from adminMarketplaceOverview", () =>
  actions.adminMarketplaceOverview.handler(ctxFor(user1), {}));
await throwsAsync("non-admin blocked from adminGrowthMetrics", () =>
  actions.adminGrowthMetrics.handler(ctxFor(user1), {}));

// --- Done -------------------------------------------------------------------------
await client.close();
if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nAll admin phase 2 analytics behavior tests passed.");
