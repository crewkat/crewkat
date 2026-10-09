// Chunk D behavior tests.
//
// Covers: migration journal ordering + application, referral loop (code issue,
// event recording, +5 bonus on email verification, effective-limit math),
// marketplace alert matching logic + alert CRUD + alert-match notification
// fan-out, push subscription save/remove round trip, getVapidPublicKey with
// no env configured, and the client service-worker/offline-cache wiring.
//
// Run from app/:  bun chunk-d.behavior.test.ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import { alertMatchesListing, BaseActions, notifyAlertMatches } from "./server/src/actions.ts";
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

// --- 1. Migration journal ordering ------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
let nonDecreasing = true;
for (let i = 1; i < entries.length; i++) {
  if (entries[i]!.when < entries[i - 1]!.when) nonDecreasing = false;
  if (entries[i]!.when === entries[i - 1]!.when) {
    console.warn(`warn journal entries idx ${entries[i - 1]!.idx} and ${entries[i]!.idx} share when=${entries[i]!.when} (pre-existing; left untouched)`);
  }
}
check("journal when values are non-decreasing", nonDecreasing);
const last = entries[entries.length - 1]!;
const maxBefore = Math.max(...entries.slice(0, -1).map((e) => e.when));
check("newest migration (0048) when is strictly greater than every earlier entry", last.when > maxBefore, `last=${last.when} maxBefore=${maxBefore}`);
check("newest migration tag is 0072_admin_phase2", last.tag === "0072_admin_phase2", last.tag);
check("0046_referral_loop and 0047_marketplace_alerts are journaled in order",
  entries.some((e) => e.tag === "0046_referral_loop") && entries.some((e) => e.tag === "0047_marketplace_alerts"));

// --- 2. Apply all migrations on a scratch DB --------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-chunkd-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });
const tables = await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'");
const tableNames = (tables.rows as Array<{ name: string }>).map((r) => r.name);
for (const table of ["referral_events", "marketplace_alerts", "user_notifications", "push_subscriptions"]) {
  check(`migrations applied: ${table} exists`, tableNames.includes(table));
}
const userCols = (await sqlite.execute("PRAGMA table_info(auth_users)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: auth_users.referral_code exists", userCols.includes("referral_code"));
const settingsCols = (await sqlite.execute("PRAGMA table_info(settings)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: settings.listing_bonus exists", settingsCols.includes("listing_bonus"));

// --- 3. Test context ---------------------------------------------------------
const blobStore = new Map<string, { data: Buffer; contentType: string }>();
const blobs = {
  put: async (key: string, data: Uint8Array | Buffer, opts: { contentType?: string } = {}) => {
    blobStore.set(key, { data: Buffer.from(data), contentType: opts.contentType ?? "application/octet-stream" });
  },
  getUrl: async (key: string) => `blob://test/${key}`,
  get: async (key: string) => {
    const b = blobStore.get(key);
    if (!b) throw new Error(`blob not found: ${key}`);
    return b.data;
  },
  delete: async (key: string) => { blobStore.delete(key); },
  head: async (key: string) => {
    const b = blobStore.get(key);
    if (!b) throw new Error(`blob not found: ${key}`);
    return { contentType: b.contentType, size: b.data.length };
  },
};
// executePrivileged stub: auth emails fall back to the testing code path;
// alert emails are best-effort and only need the call not to throw.
const ctx = {
  slug: "tradesign",
  invocationId: "chunk-d-test",
  spaceDir: dir,
  db: () => db,
  blobs,
  executePrivileged: async () => ({ delivery: "fallback" }),
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;

// --- 4. Referral loop ---------------------------------------------------------
const signupA = await (BaseActions.signUp as any).handler(ctx, {
  name: "Referrer Rita", email: "rita@example.com", password: "supersecretpassword", marketplaceTermsAccepted: true,
});
check("signUp (referrer) ok", signupA.ok === true);
const userA = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "rita@example.com")).limit(1))[0]!;
check("new user gets an 8-char referral code", /^[A-Z0-9]{8}$/.test(userA.referralCode ?? ""), String(userA.referralCode));
const codeA: string = userA.referralCode!;

const signupB = await (BaseActions.signUp as any).handler(ctx, {
  name: "Referred Bob", email: "bob@example.com", password: "supersecretpassword", marketplaceTermsAccepted: true, referralCode: ` ${codeA.toLowerCase()} `,
});
check("signUp with referral code ok", signupB.ok === true);
const userB = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "bob@example.com")).limit(1))[0]!;
const eventsBefore = await db.select().from(schema.referralEvents).where(eq(schema.referralEvents.referredUserId, userB.id));
check("referral event recorded (rewarded=false)", eventsBefore.length === 1 && eventsBefore[0]!.rewarded === false && eventsBefore[0]!.referrerUserId === userA.id);

const bonusBefore = (await db.select({ listingBonus: schema.settings.listingBonus }).from(schema.settings).where(eq(schema.settings.companyId, userA.companyId)).limit(1))[0]?.listingBonus ?? 0;
await (BaseActions.verifyEmail as any).handler(ctx, { email: "bob@example.com", code: signupB.verificationCode });
const eventsAfter = await db.select().from(schema.referralEvents).where(eq(schema.referralEvents.referredUserId, userB.id));
check("referral event marked rewarded after verification", eventsAfter.length === 1 && eventsAfter[0]!.rewarded === true);
const bonusAfter = (await db.select({ listingBonus: schema.settings.listingBonus }).from(schema.settings).where(eq(schema.settings.companyId, userA.companyId)).limit(1))[0]?.listingBonus ?? 0;
check("referrer company earns +5 bonus listings", bonusAfter - bonusBefore === 5, `${bonusBefore} -> ${bonusAfter}`);
// Verifying again must not double-reward.
await (BaseActions.verifyEmail as any).handler(ctx, { email: "bob@example.com", code: signupB.verificationCode }).catch(() => {});
const bonusAfter2 = (await db.select({ listingBonus: schema.settings.listingBonus }).from(schema.settings).where(eq(schema.settings.companyId, userA.companyId)).limit(1))[0]?.listingBonus ?? 0;
check("reward is not applied twice", bonusAfter2 === bonusAfter, String(bonusAfter2));

const stats = await (BaseActions.getReferralStats as any).handler(ctx, {});
check("getReferralStats returns the code", stats.referralCode === codeA, stats.referralCode);
check("getReferralStats counts joined users", stats.joinedCount === 1, String(stats.joinedCount));
check("getReferralStats reports bonus listings", stats.bonusListings === 5, String(stats.bonusListings));
check("getReferralStats effective limit = base + bonus", stats.effectiveLimit === stats.baseLimit + 5, `${stats.baseLimit}/${stats.effectiveLimit}`);

const gate = await (BaseActions.marketplaceGate as any).handler(ctx, {});
check("marketplaceGate reports bonusListings=5", gate.bonusListings === 5, String(gate.bonusListings));
check("marketplaceGate effectiveListingLimit = base + 5", gate.effectiveListingLimit === gate.freeListingLimit + 5, `${gate.freeListingLimit}/${gate.effectiveListingLimit}`);

// Bogus referral code: signup still works, no event recorded.
const signupC = await (BaseActions.signUp as any).handler(ctx, {
  name: "No Ref Nora", email: "nora@example.com", password: "supersecretpassword", marketplaceTermsAccepted: true, referralCode: "ZZZZZZZZ",
});
const userC = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "nora@example.com")).limit(1))[0]!;
const eventsC = await db.select().from(schema.referralEvents).where(eq(schema.referralEvents.referredUserId, userC.id));
check("unknown referral code records no event", eventsC.length === 0 && signupC.ok === true);

// --- 5. Alert matching logic --------------------------------------------------
const listing = { title: "Drywall helper needed", description: "Looking for drywall finishing help this week", category: "other", serviceArea: "Tampa, FL" };
check("match: keyword substring, case-insensitive", alertMatchesListing({ keyword: "DRYWALL", category: null, serviceArea: null }, listing));
check("match: description text counts", alertMatchesListing({ keyword: "finishing", category: null, serviceArea: null }, listing));
check("no match: keyword absent", !alertMatchesListing({ keyword: "plumbing", category: null, serviceArea: null }, listing));
check("no match: empty keyword", !alertMatchesListing({ keyword: "   ", category: null, serviceArea: null }, listing));
check("match: null category matches any", alertMatchesListing({ keyword: "drywall", category: null, serviceArea: null }, listing));
check("match: exact category matches", alertMatchesListing({ keyword: "drywall", category: "other", serviceArea: null }, listing));
check("no match: wrong category", !alertMatchesListing({ keyword: "drywall", category: "plumbing", serviceArea: null }, listing));
check("match: null service area matches any", alertMatchesListing({ keyword: "drywall", category: null, serviceArea: null }, listing));
check("match: service area substring, case-insensitive", alertMatchesListing({ keyword: "drywall", category: null, serviceArea: "tampa" }, listing));
check("no match: service area absent", !alertMatchesListing({ keyword: "drywall", category: null, serviceArea: "miami" }, listing));

// --- 6. Alert CRUD --------------------------------------------------------------
const saved = await (BaseActions.saveMarketplaceAlert as any).handler(ctx, { keyword: "drywall", category: null, serviceArea: "" });
check("saveMarketplaceAlert returns an id", typeof saved.id === "number");
const listed = await (BaseActions.listMarketplaceAlerts as any).handler(ctx, {});
check("listMarketplaceAlerts returns the alert", listed.alerts.length === 1 && listed.alerts[0].keyword === "drywall");
await checkThrows("duplicate keyword alert is refused", () => (BaseActions.saveMarketplaceAlert as any).handler(ctx, { keyword: "drywall", category: null, serviceArea: "" }));
// Fill to the 20-alert cap.
for (let i = 0; i < 19; i++) {
  await (BaseActions.saveMarketplaceAlert as any).handler(ctx, { keyword: `kw${i}`, category: null, serviceArea: "" });
}
await checkThrows("alerts are capped at 20", () => (BaseActions.saveMarketplaceAlert as any).handler(ctx, { keyword: "one-more", category: null, serviceArea: "" }));
await (BaseActions.deleteMarketplaceAlert as any).handler(ctx, { id: saved.id });
const listedAfter = await (BaseActions.listMarketplaceAlerts as any).handler(ctx, {});
check("deleteMarketplaceAlert removes the alert", listedAfter.alerts.length === 19 && !listedAfter.alerts.some((a: any) => a.id === saved.id));

// --- 7. Alert-match notification fan-out -----------------------------------------
// userA's alert "drywall" was deleted; re-save it, then notify on a listing
// authored by userB (author is excluded from their own alert matches).
const saved2 = await (BaseActions.saveMarketplaceAlert as any).handler(ctx, { keyword: "drywall", category: "other", serviceArea: "" });
check("alert re-saved for fan-out test", typeof saved2.id === "number");
await notifyAlertMatches(ctx, { id: 99, title: "Drywall helper needed", description: "Drywall finishing help", category: "other", serviceArea: "Tampa, FL", authorUserId: userB.id });
const notifications = await db.select().from(schema.userNotifications);
check("alert match creates an in-app notification", notifications.length === 1 && notifications[0]!.userId === userA.id && notifications[0]!.kind === "alert_match", JSON.stringify(notifications.map((n) => ({ userId: n.userId, kind: n.kind }))));
check("notification titles are bilingual", (notifications[0]!.titleEn ?? "").length > 0 && (notifications[0]!.titleEs ?? "").length > 0);
// Second call for the same listing link must not duplicate the notification.
await notifyAlertMatches(ctx, { id: 99, title: "Drywall helper needed", description: "Drywall finishing help", category: "other", serviceArea: "Tampa, FL", authorUserId: userB.id });
const notifications2 = await db.select().from(schema.userNotifications);
check("duplicate alert match is not re-notified", notifications2.length === 1, String(notifications2.length));
// Author's own alert must not fire on their own listing.
const ctxB = { ...ctx, workspaceUserId: userB.id, workspaceCompanyId: userB.companyId };
await (BaseActions.saveMarketplaceAlert as any).handler(ctxB, { keyword: "drywall", category: null, serviceArea: "" });
await notifyAlertMatches(ctx, { id: 100, title: "Drywall helper needed", description: "Drywall finishing help", category: "other", serviceArea: "Tampa, FL", authorUserId: userB.id });
const notifications3 = await db.select().from(schema.userNotifications).where(eq(schema.userNotifications.userId, userB.id));
check("listing author is excluded from their own alert matches", notifications3.length === 0, String(notifications3.length));

const notifsList = await (BaseActions.listNotifications as any).handler(ctx, {});
check("listNotifications reports unreadCount=2 (listings 99 and 100 both matched)", notifsList.unreadCount === 2, String(notifsList.unreadCount));
await (BaseActions.markNotificationsRead as any).handler(ctx, { ids: notifsList.notifications.map((n: any) => n.id) });
const notifsList2 = await (BaseActions.listNotifications as any).handler(ctx, {});
check("markNotificationsRead clears unread", notifsList2.unreadCount === 0, String(notifsList2.unreadCount));

// --- 8. Push plumbing --------------------------------------------------------------
const sub = { endpoint: "https://fcm.test/push/abc123", p256dh: "p256dh-key", auth: "auth-secret" };
await (BaseActions.savePushSubscription as any).handler(ctx, sub);
await (BaseActions.savePushSubscription as any).handler(ctx, sub);
const subs = await db.select().from(schema.pushSubscriptions);
check("savePushSubscription upserts (no duplicates)", subs.length === 1 && subs[0]!.userId === userA.id && subs[0]!.endpoint === sub.endpoint, `got ${subs.length}`);
await (BaseActions.removePushSubscription as any).handler(ctx, { endpoint: sub.endpoint });
const subsAfter = await db.select().from(schema.pushSubscriptions);
check("removePushSubscription deletes the endpoint", subsAfter.length === 0, String(subsAfter.length));
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
const vapid = await (BaseActions.getVapidPublicKey as any).handler(ctx, {});
check("getVapidPublicKey returns null when env is unset", vapid.publicKey === null, String(vapid.publicKey));

// --- 9. Client offline / service-worker wiring --------------------------------------
const pushClient = await readFile("client/src/push.ts", "utf8");
check("client push module registers /app/sw.js", pushClient.includes('"/app/sw.js"'));
check("client push module calls getVapidPublicKey", pushClient.includes("getVapidPublicKey"));
const apiClient = await readFile("client/src/api.ts", "utf8");
check("api caches listJobs for offline", apiClient.includes('"listJobs"'));
check("api caches listClients for offline", apiClient.includes('"listClients"'));
check("api caches listInvoices for offline", apiClient.includes('"listInvoices"'));
check("api caches listQuotes for offline", apiClient.includes('"listQuotes"'));
check("api exposes offlineCacheTimestamp", apiClient.includes("offlineCacheTimestamp"));
const swSource = await readFile("client/pwa/sw.js", "utf8");
check("service worker handles push events", swSource.includes('addEventListener("push"'));
check("service worker uses versioned shell/runtime caches", swSource.includes("crewkat-shell-") && swSource.includes("BUILD_ID") && swSource.includes("crewkat-runtime-"));
check("service worker fetches navigations network-first", swSource.includes("networkFirst") && swSource.includes('isNavigation(request)'));
check("service worker activates immediately and claims clients", swSource.includes("skipWaiting()") && swSource.includes("clients.claim()"));
check("service worker keeps the offline API fallback", swSource.includes("OFFLINE"));
const appClient = await readFile("client/src/App.tsx", "utf8");
check("App registers the service worker on launch", appClient.includes("registerAppServiceWorker()"));
check("App shows the service-worker update toast", appClient.includes("SW_UPDATE_AVAILABLE_EVENT") && appClient.includes("update-toast"));
check("App renders the offline banner", appClient.includes("<OfflineBanner"));
check("signup passes the referral code through", appClient.includes("referralCode: referralCode || undefined"));
check("iOS meta tags present in source index.html", (await readFile("client/index.html", "utf8")).includes("apple-mobile-web-app-capable"));
const icon180 = await readFile("client/pwa/icon-180.png").catch(() => null);
check("180x180 apple touch icon exists", icon180 !== null && icon180.length > 1000, icon180 ? `${icon180.length} bytes` : "missing");

// --- 10. Build 3: globalSearch groups clients/jobs/estimates/invoices --------
await db.insert(schema.clients).values({ name: "Search Test Client", phone: "555-0100" });
await db.insert(schema.jobs).values({ clientName: "Search Test Client", jobAddress: "1 Test Way", jobType: "Bathroom remodel", jobDate: "2026-09-28" });
await db.insert(schema.quotes).values({ clientName: "Search Test Client", jobType: "Bathroom remodel", lineItemsJson: "[]", total: "1200.00" });
await db.insert(schema.invoices).values({ clientName: "Search Test Client", jobType: "Bathroom remodel", lineItemsJson: "[]", total: "1200.00" });
const searchHit = await (BaseActions.globalSearch as any).handler(ctx, { term: "bathroom" });
check("globalSearch finds the job by type", searchHit.jobs.length === 1 && searchHit.jobs[0].title.includes("Bathroom remodel"), JSON.stringify(searchHit.jobs));
check("globalSearch finds the estimate by type", searchHit.quotes.length === 1, JSON.stringify(searchHit.quotes));
check("globalSearch finds the invoice by type", searchHit.invoices.length === 1, JSON.stringify(searchHit.invoices));
const searchName = await (BaseActions.globalSearch as any).handler(ctx, { term: "search test" });
check("globalSearch finds the client by name", searchName.clients.length === 1 && searchName.clients[0].title === "Search Test Client", JSON.stringify(searchName.clients));
const searchMiss = await (BaseActions.globalSearch as any).handler(ctx, { term: "zzz-no-match" });
check("globalSearch returns empty groups on no match", searchMiss.clients.length === 0 && searchMiss.jobs.length === 0 && searchMiss.quotes.length === 0 && searchMiss.invoices.length === 0);
const searchBlank = await (BaseActions.globalSearch as any).handler(ctx, { term: "   " });
check("globalSearch returns empty groups on blank term", searchBlank.clients.length === 0 && searchBlank.jobs.length === 0);

await rm(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Chunk D behavior checks passed.");
