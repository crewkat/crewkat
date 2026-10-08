// Build 4 behavior tests.
//
// Covers: migration 0050 (bump + portal nudge columns), the estimate-nudge
// scheduler tick (3-day timing, accepted/superseded exclusions, email fallback,
// idempotency), the marketplace bump webhook (company ownership check,
// 7-day featured window, purchase recording, duplicate-event idempotency),
// and the Crew Day view.
//
// Run from app/:  bun build4.behavior.test.ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import { BaseActions, runEstimateNudgeTick } from "./server/src/actions.ts";
import * as privileged from "./server/src/privileged.ts";
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
}
check("journal when values are non-decreasing", nonDecreasing);
const last = entries[entries.length - 1]!;
const maxBefore = Math.max(...entries.slice(0, -1).map((e) => e.when));
check("newest migration when is strictly greater than every earlier entry", last.when > maxBefore, `last=${last.when} maxBefore=${maxBefore}`);
check("newest migration tag is 0070_account_deletion_codes", last.tag === "0070_account_deletion_codes", last.tag);

// --- 2. Apply all migrations on a scratch DB ---------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-build4-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const quoteCols = (await sqlite.execute("PRAGMA table_info(quotes)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: quotes.estimate_nudge_sent_at exists", quoteCols.includes("estimate_nudge_sent_at"));
const listingCols = (await sqlite.execute("PRAGMA table_info(marketplace_listings)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: marketplace_listings.featured_until exists", listingCols.includes("featured_until"));
const tables = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
check("migrations applied: listing_bump_purchases table exists", tables.includes("listing_bump_purchases"));

// --- 3. Test context ----------------------------------------------------------
const sentEmails: Array<{ to: string; subject: string }> = [];
const cannedWebhookEvents: Array<Record<string, unknown>> = [];
const ctx = {
  slug: "tradesign",
  invocationId: "build4-test",
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
    // sendNudgeEmail stub
    if (args && typeof args.to === "string" && typeof args.subject === "string") {
      sentEmails.push({ to: args.to, subject: args.subject });
      return { delivery: "sent" };
    }
    // createStripeCheckout: mirror the real handler's unconfigured branch (env is
    // empty in tests, so no Stripe call happens).
    if (args && (args.plan === "monthly" || args.plan === "annual")) {
      const name = args.plan === "annual" ? "STRIPE_PREMIUM_ANNUAL_PRICE_ID" : "STRIPE_PREMIUM_PRICE_ID";
      return { configured: false, checkoutUrl: null, missing: ["STRIPE_SECRET_KEY", name, "CREWKAT_PUBLIC_URL"] };
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

// Seed a company user so the in-app nudge fallback has a recipient.
await db.insert(schema.authUsers).values({ companyId: 1, name: "Owner", email: "owner@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH" });
await db.insert(schema.settings).values({ companyId: 1, companyName: "Stallions Test Co" });

const DAY = 86400000;
const now = Date.now();
const mkQuote = (over: Record<string, unknown>) => db.insert(schema.quotes).values({
  companyId: 1, clientName: "Client X", lineItemsJson: "[]", total: "1000", sentAt: "2026-09-01",
  ...over,
}).returning({ id: schema.quotes.id });

// --- 4. Estimate nudge tick ---------------------------------------------------
const fourDaysAgo = new Date(now - 4 * DAY);
const oneDayAgo = new Date(now - 1 * DAY);
const mkLink = (quoteId: number, firstViewedAt: Date | null) => db.insert(schema.documentLinks).values({
  companyId: 1, documentKind: "quote", documentId: quoteId, tokenHash: `hash-${quoteId}-${Date.now()}`, tokenHint: "abc",
  expiresAt: new Date(now + 30 * DAY), firstViewedAt,
});

// q1: eligible — sent, viewed 4 days ago, valid email.
const [q1] = await mkQuote({ clientName: "Eligible Erin", clientEmail: "erin@example.com" });
await mkLink(q1!.id, fourDaysAgo);
// q2: viewed only 1 day ago — too fresh.
const [q2] = await mkQuote({ clientName: "Fresh Fiona", clientEmail: "fiona@example.com" });
await mkLink(q2!.id, oneDayAgo);
// q3: accepted — excluded.
const [q3] = await mkQuote({ clientName: "Accepted Amy", clientEmail: "amy@example.com", accepted: true });
await mkLink(q3!.id, fourDaysAgo);
// q4: superseded — excluded.
const [q4] = await mkQuote({ clientName: "Superseded Sam", clientEmail: "sam@example.com", superseded: true });
await mkLink(q4!.id, fourDaysAgo);
// q5: no valid email — falls back to in-app notification.
const [q5] = await mkQuote({ clientName: "Noemail Ned", clientEmail: "not-an-email" });
await mkLink(q5!.id, fourDaysAgo);
// q6: never viewed — excluded.
const [q6] = await mkQuote({ clientName: "Unviewed Uly", clientEmail: "uly@example.com" });
await mkLink(q6!.id, null);

const tick1 = await runEstimateNudgeTick(ctx);
check("nudge tick nudges the eligible quote", tick1.nudged.includes(q1!.id), JSON.stringify(tick1.nudged));
check("nudge tick skips fresh/accepted/superseded/unviewed quotes", !tick1.nudged.includes(q2!.id) && !tick1.nudged.includes(q3!.id) && !tick1.nudged.includes(q4!.id) && !tick1.nudged.includes(q6!.id));
check("nudge email sent to the eligible client", sentEmails.some((e) => e.to === "erin@example.com"));
check("nudge falls back to in-app notification when email is invalid", (await db.select().from(schema.userNotifications).where(eq(schema.userNotifications.kind, "estimate-nudge"))).length >= 1);
const q1After = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, q1!.id)).limit(1))[0]!;
check("nudge timestamp recorded (idempotency marker)", q1After.estimateNudgeSentAt !== null);

const tick2 = await runEstimateNudgeTick(ctx);
check("nudge tick is idempotent (no second nudge)", tick2.nudged.length === 0, JSON.stringify(tick2.nudged));

// --- 5. Marketplace bump webhook ----------------------------------------------
const [listing] = await db.insert(schema.marketplaceListings).values({
  companyId: 1, title: "Bump me", category: "plumbing", serviceArea: "Tampa", companyName: "Stallions Test Co",
}).returning({ id: schema.marketplaceListings.id });

// Foreign company tries to feature company 1's listing — must be rejected.
cannedWebhookEvents.push({ eventId: "evt-foreign", eventType: "checkout.session.completed", checkoutType: "listing_bump", listingId: listing!.id, companyId: 2, stripeSessionId: "cs-foreign" });
await checkThrows("bump webhook rejects listing/company mismatch", () => (BaseActions.handleStripeWebhook as any).handler(ctx, { payload: "x", signature: "y" }));
const listingAfterForeign = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, listing!.id)).limit(1))[0]!;
check("rejected bump does not set featuredUntil", listingAfterForeign.featuredUntil === null);

// Legitimate purchase from the owning company.
cannedWebhookEvents.push({ eventId: "evt-legit", eventType: "checkout.session.completed", checkoutType: "listing_bump", listingId: listing!.id, companyId: 1, stripeSessionId: "cs-legit" });
const webhookResult = await (BaseActions.handleStripeWebhook as any).handler(ctx, { payload: "x", signature: "y" });
check("legit bump webhook processes", webhookResult.processed === true);
const listingAfter = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, listing!.id)).limit(1))[0]!;
const featuredMs = listingAfter.featuredUntil!.getTime();
check("featuredUntil is ~7 days out", Math.abs(featuredMs - (Date.now() + 7 * DAY)) < 5 * 60 * 1000, String(listingAfter.featuredUntil));
const purchases = await db.select().from(schema.listingBumpPurchases).where(eq(schema.listingBumpPurchases.listingId, listing!.id));
check("bump purchase recorded", purchases.length === 1 && purchases[0]!.stripeSessionId === "cs-legit" && purchases[0]!.companyId === 1);

// Duplicate delivery of the same event id — idempotent.
cannedWebhookEvents.push({ eventId: "evt-legit", eventType: "checkout.session.completed", checkoutType: "listing_bump", listingId: listing!.id, companyId: 1, stripeSessionId: "cs-legit" });
const dup = await (BaseActions.handleStripeWebhook as any).handler(ctx, { payload: "x", signature: "y" });
check("duplicate webhook event is not reprocessed", dup.duplicate === true && dup.processed === false);

// getListingBumpStatus reflects the active featured state.
const status = await (BaseActions.getListingBumpStatus as any).handler({ ...ctx, workspaceCompanyId: 1 }, { listingId: listing!.id });
check("bump status reports featured with expiry", status.featured === true && typeof status.featuredUntil === "string");

// --- 6. Crew Day view ----------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(now - DAY).toISOString().slice(0, 10);
const [jobToday] = await db.insert(schema.jobs).values({ companyId: 1, clientName: "Today Tess", jobAddress: "1 Main St", jobType: "Bathroom remodel", jobDate: today }).returning({ id: schema.jobs.id });
await db.insert(schema.jobs).values({ companyId: 1, clientName: "Old Otto", jobAddress: "2 Main St", jobType: "Kitchen", jobDate: yesterday });
await db.insert(schema.appointments).values({ companyId: 1, jobId: jobToday!.id, clientName: "Today Tess", startsAt: `${today}T09:00:00`, notes: "Rough-in" });
await db.insert(schema.dailyLogs).values({ companyId: 1, jobId: jobToday!.id, logDate: today, crew: "Danny, Marco" });
await db.insert(schema.invoices).values({ companyId: 1, invoiceNumber: "INV-9001", clientName: "Overdue Olivia", lineItemsJson: "[]", total: "2500", dueDate: yesterday, status: "sent" });
await db.insert(schema.invoices).values({ companyId: 1, invoiceNumber: "INV-9002", clientName: "Paid Paula", lineItemsJson: "[]", total: "900", dueDate: yesterday, status: "paid" });

const crewDay = await (BaseActions.getCrewDayView as any).handler(ctx, {});
check("crew day returns today's date", crewDay.date === today, crewDay.date);
check("crew day includes today's job", crewDay.jobsToday.some((j: { id: number }) => j.id === jobToday!.id) && crewDay.jobsToday.length === 1);
check("crew day includes today's appointment", crewDay.appointmentsToday.length === 1 && crewDay.appointmentsToday[0].notes === "Rough-in");
check("crew day derives crew names from daily logs", crewDay.crewToday.includes("Danny") && crewDay.crewToday.includes("Marco"), JSON.stringify(crewDay.crewToday));
check("crew day lists only unpaid overdue invoices", crewDay.overdueInvoices.length === 1 && crewDay.overdueInvoices[0].invoiceNumber === "INV-9001");

// --- 7. Annual vs monthly premium checkout --------------------------------------
const annual = await (BaseActions.startPremiumCheckout as any).handler({ ...ctx, workspaceUserId: 1 }, { plan: "annual" });
check("annual checkout is unconfigured without the annual price id", annual.configured === false && annual.missing.includes("STRIPE_PREMIUM_ANNUAL_PRICE_ID"), JSON.stringify(annual));
const monthly = await (BaseActions.startPremiumCheckout as any).handler({ ...ctx, workspaceUserId: 1 }, { plan: "monthly" });
check("monthly checkout is unconfigured without the monthly price id", monthly.configured === false && monthly.missing.includes("STRIPE_PREMIUM_PRICE_ID"), JSON.stringify(monthly));

await rm(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nAll Build 4 behavior tests passed.");
