// Phase 1 behavior tests.
//
// Covers: migration 0051 (onboarding_checklist table + review-request settings
// columns), the per-document activity timeline, the first-run activation
// checklist (live computation + dismissal persistence), optimistic status
// transitions (reopenJob / unacceptQuote), the automated review-request email
// tick (timing, idempotency, failure handling, manual send), and estimate
// templates / trade assemblies (save + list + validation).
//
// Run from app/:  bun phase1.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq, isNull } from "drizzle-orm";
import { BaseActions, runReviewRequestTick } from "./server/src/actions.ts";
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
check("newest migration when is strictly greater than every earlier entry", last.when > maxBefore, `last=${last.when} maxBefore=${maxBefore}`);
check("newest migration tag is 0056_add_analytics_tables", last.tag === "0056_add_analytics_tables", last.tag);

// --- 2. Apply all migrations on a scratch DB ----------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-phase1-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const tables = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
check("migrations applied: onboarding_checklist table exists", tables.includes("onboarding_checklist"));
const settingsCols = (await sqlite.execute("PRAGMA table_info(settings)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: settings.review_requests_enabled exists", settingsCols.includes("review_requests_enabled"));
check("migrations applied: settings.review_request_delay_days exists", settingsCols.includes("review_request_delay_days"));

// --- 3. Test context -----------------------------------------------------------
const sentEmails: Array<{ to: string; subject: string }> = [];
const ctx = {
  slug: "tradesign",
  invocationId: "phase1-test",
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
    // sendNudgeEmail stub — throws for fail@example.com to simulate delivery failure.
    if (args && typeof args.to === "string" && typeof args.subject === "string") {
      if (args.to === "fail@example.com") throw new Error("SMTP refused");
      sentEmails.push({ to: args.to, subject: args.subject });
      return { delivery: "sent" };
    }
    throw new Error("unexpected privileged call");
  },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;

const DAY = 86400000;
const now = Date.now();

// --- 4. Activation checklist: empty-state first (before any seeding) -------------
const emptyChecklist = await (BaseActions.getOnboardingChecklist as any).handler(ctx, {});
check("checklist starts undismissed", emptyChecklist.dismissed === false);
check("checklist starts with all steps undone", emptyChecklist.allDone === false && emptyChecklist.steps.every((s: { done: boolean }) => s.done === false));
check("checklist steps are bilingual", emptyChecklist.steps.every((s: { titleEn: string; titleEs: string }) => s.titleEn && s.titleEs));

// --- 5. Per-document activity timeline -----------------------------------------
await db.insert(schema.authUsers).values({ companyId: 1, name: "Owner", email: "owner@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH" });

const created = new Date(now - 10 * DAY);
const sentAt = new Date(now - 9 * DAY);
const sharedAt = new Date(now - 8 * DAY);
const viewedAt = new Date(now - 7 * DAY);
const remindedAt = new Date(now - 6 * DAY);
const approvedAt = new Date(now - 5 * DAY);

const [invoice] = await db.insert(schema.invoices).values({
  companyId: 1, invoiceNumber: "INV-7001", clientName: "Timeline Tina", lineItemsJson: "[]", total: "4200",
  status: "sent", issueDate: "2026-09-20", createdAt: created, updatedAt: sentAt,
}).returning({ id: schema.invoices.id });

const [quote] = await db.insert(schema.quotes).values({
  companyId: 1, clientName: "Timeline Tina", clientEmail: "tina@example.com", lineItemsJson: "[]", total: "4200",
  sentAt: "2026-09-20", accepted: true, estimateNudgeSentAt: remindedAt, convertedToInvoiceId: invoice!.id,
  createdAt: created, updatedAt: approvedAt,
}).returning({ id: schema.quotes.id });
await db.insert(schema.documentLinks).values({
  companyId: 1, documentKind: "quote", documentId: quote!.id, tokenHash: `hash-${quote!.id}`, tokenHint: "abc",
  expiresAt: new Date(now + 30 * DAY), firstViewedAt: viewedAt, viewCount: 3, createdAt: sharedAt,
});

const quoteTimeline = await (BaseActions.getDocumentTimeline as any).handler(ctx, { kind: "quote", id: quote!.id });
const qTypes = quoteTimeline.events.map((e: { type: string }) => e.type);
check("quote timeline includes all lifecycle events", ["created", "sent", "shared", "viewed", "reminder", "approved", "converted"].every((t) => qTypes.includes(t)), JSON.stringify(qTypes));
const qSorted = quoteTimeline.events.every((e: { at: string | null }, i: number, arr: Array<{ at: string | null }>) => i === 0 || (arr[i - 1]!.at ?? "") <= (e.at ?? ""));
check("quote timeline events are sorted chronologically", qSorted);
const viewed = quoteTimeline.events.find((e: { type: string }) => e.type === "viewed");
check("quote viewed event carries the view count", viewed && viewed.detail === "3 views", JSON.stringify(viewed));

await db.insert(schema.documentLinks).values({
  companyId: 1, documentKind: "invoice", documentId: invoice!.id, tokenHash: `hash-inv-${invoice!.id}`, tokenHint: "def",
  expiresAt: new Date(now + 30 * DAY), firstViewedAt: viewedAt, viewCount: 1, createdAt: sharedAt,
});
await db.insert(schema.payments).values({ companyId: 1, invoiceId: invoice!.id, amount: "1500.00", paymentDate: "2026-09-24", method: "check", note: "" });
await db.insert(schema.automationLogs).values({ companyId: 1, kind: "payment", entityId: invoice!.id, stage: "Payment reminder", channel: "email", sentAt: remindedAt });

const invoiceTimeline = await (BaseActions.getDocumentTimeline as any).handler(ctx, { kind: "invoice", id: invoice!.id });
const iTypes = invoiceTimeline.events.map((e: { type: string }) => e.type);
check("invoice timeline includes payment + reminder events", ["created", "sent", "shared", "viewed", "reminder", "paid"].every((t) => iTypes.includes(t)), JSON.stringify(iTypes));
const paid = invoiceTimeline.events.find((e: { type: string }) => e.type === "paid");
check("invoice paid event carries amount and method", paid && paid.detail.includes("1500.00") && paid.detail.includes("check"), JSON.stringify(paid));

await checkThrows("timeline on unknown estimate id throws", () => (BaseActions.getDocumentTimeline as any).handler(ctx, { kind: "quote", id: 999999 }));
await checkThrows("timeline on unknown invoice id throws", () => (BaseActions.getDocumentTimeline as any).handler(ctx, { kind: "invoice", id: 999999 }));

// --- 6. Activation checklist: full state ------------------------------------------
const fullChecklistSeed = await (BaseActions.getOnboardingChecklist as any).handler(ctx, {});
check("checklist not all-done before seeding signals", fullChecklistSeed.allDone === false);
await db.insert(schema.clients).values({ companyId: 1, name: "Checklist Carl" });
await db.insert(schema.jobs).values({ companyId: 1, clientName: "Checklist Carl", jobAddress: "9 Elm St", jobType: "Remodel", jobDate: "2026-09-25" });
await db.insert(schema.quotes).values({ companyId: 1, clientName: "Checklist Carl", lineItemsJson: "[]", total: "100", sentAt: "2026-09-25" });
await db.insert(schema.invoices).values({ companyId: 1, invoiceNumber: "INV-7002", clientName: "Checklist Carl", lineItemsJson: "[]", total: "100" });

const fullChecklist = await (BaseActions.getOnboardingChecklist as any).handler(ctx, {});
check("checklist goes all-done when real data exists", fullChecklist.allDone === true && fullChecklist.steps.every((s: { done: boolean }) => s.done === true));

const dismiss = await (BaseActions.dismissOnboardingChecklist as any).handler(ctx, {});
check("dismiss checklist returns ok", dismiss.ok === true);
const afterDismiss = await (BaseActions.getOnboardingChecklist as any).handler(ctx, {});
check("checklist dismissal persists", afterDismiss.dismissed === true);
const stored = (await db.select().from(schema.onboardingChecklist).where(eq(schema.onboardingChecklist.userId, 1)).limit(1))[0];
check("checklist dismissal stored per user", stored !== undefined && stored.dismissedAt !== null);

// --- 6. Optimistic status transitions -------------------------------------------
const [job] = await db.insert(schema.jobs).values({
  companyId: 1, clientName: "Undo Uma", jobAddress: "3 Oak St", jobType: "Remodel", jobDate: "2026-09-25", completedAt: new Date(now - 2 * DAY),
}).returning({ id: schema.jobs.id });
const reopen = await (BaseActions.reopenJob as any).handler(ctx, { jobId: job!.id });
check("reopenJob returns ok", reopen.ok === true);
const jobAfter = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, job!.id)).limit(1))[0]!;
check("reopenJob clears completedAt", jobAfter.completedAt === null);
await checkThrows("reopenJob on unknown job throws", () => (BaseActions.reopenJob as any).handler(ctx, { jobId: 999999 }));

const [accQuote] = await db.insert(schema.quotes).values({
  companyId: 1, clientName: "Undo Uma", lineItemsJson: "[]", total: "800", accepted: true, automationStatus: "won", sentAt: "2026-09-20",
}).returning({ id: schema.quotes.id });
const unaccept = await (BaseActions.unacceptQuote as any).handler(ctx, { id: accQuote!.id });
check("unacceptQuote returns ok", unaccept.ok === true);
const quoteAfter = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, accQuote!.id)).limit(1))[0]!;
check("unacceptQuote clears accepted flag", quoteAfter.accepted === false);
check("unacceptQuote resets automation status", (quoteAfter.automationStatus as string) === "awaiting");
await checkThrows("unacceptQuote on unknown estimate throws", () => (BaseActions.unacceptQuote as any).handler(ctx, { id: 999999 }));

// --- 7. Review requests ----------------------------------------------------------
await db.insert(schema.settings).values({
  companyId: 1, companyName: "Stallions Test Co", reviewRequestsEnabled: true, reviewRequestDelayDays: 7,
  reviewUrl: "https://g.page/r/test/review",
});
const eightDaysAgo = new Date(now - 8 * DAY);
const twoDaysAgo = new Date(now - 2 * DAY);
const [jOld] = await db.insert(schema.jobs).values({ companyId: 1, clientName: "Review Rita", clientEmail: "rita@example.com", jobAddress: "4 Pine St", jobType: "Remodel", jobDate: "2026-09-25", completedAt: eightDaysAgo }).returning({ id: schema.jobs.id });
await db.insert(schema.jobs).values({ companyId: 1, clientName: "Fresh Fred", clientEmail: "fred@example.com", jobAddress: "5 Pine St", jobType: "Remodel", jobDate: "2026-09-25", completedAt: twoDaysAgo });
await db.insert(schema.jobs).values({ companyId: 1, clientName: "Noemail Ned", jobAddress: "6 Pine St", jobType: "Remodel", jobDate: "2026-09-25", completedAt: eightDaysAgo });

const tick1 = await runReviewRequestTick(ctx);
check("review tick emails the eligible completed job", tick1.emailed.includes(jOld!.id), JSON.stringify(tick1.emailed));
check("review email went to the job's client address", sentEmails.some((e) => e.to === "rita@example.com"));
const reviewLog = (await db.select().from(schema.automationLogs).where(and(eq(schema.automationLogs.kind, "review"), eq(schema.automationLogs.channel, "email"))));
check("review request logged for idempotency", reviewLog.length === 1 && reviewLog[0]!.entityId === jOld!.id);

const tick2 = await runReviewRequestTick(ctx);
check("review tick is idempotent (no second email)", tick2.emailed.length === 0 && sentEmails.filter((e) => e.to === "rita@example.com").length === 1);

// Disabled automation: nothing new should go out.
await db.update(schema.settings).set({ reviewRequestsEnabled: false }).where(eq(schema.settings.companyId, 1));
const [jOld2] = await db.insert(schema.jobs).values({ companyId: 1, clientName: "Quiet Quinn", clientEmail: "quinn@example.com", jobAddress: "7 Pine St", jobType: "Remodel", jobDate: "2026-09-25", completedAt: eightDaysAgo }).returning({ id: schema.jobs.id });
const tick3 = await runReviewRequestTick(ctx);
check("review tick stays quiet when automation is disabled", tick3.ran === false && !sentEmails.some((e) => e.to === "quinn@example.com"));
await db.update(schema.settings).set({ reviewRequestsEnabled: true }).where(eq(schema.settings.companyId, 1));

// Manual send bypasses the delay window.
const [jFresh] = await db.insert(schema.jobs).values({ companyId: 1, clientName: "Manual Mia", clientEmail: "mia@example.com", jobAddress: "8 Pine St", jobType: "Remodel", jobDate: "2026-09-25", completedAt: twoDaysAgo }).returning({ id: schema.jobs.id });
const manual = await (BaseActions.sendReviewRequest as any).handler(ctx, { jobId: jFresh!.id });
check("manual review request sends immediately", manual.emailed === true && sentEmails.some((e) => e.to === "mia@example.com"));
const manualAgain = await (BaseActions.sendReviewRequest as any).handler(ctx, { jobId: jFresh!.id });
check("manual review request is idempotent too", manualAgain.emailed === false);

// Failure path: SMTP throws -> the error surfaces (tick catches it per-job).
const [jFail] = await db.insert(schema.jobs).values({ companyId: 1, clientName: "Fail Fran", clientEmail: "fail@example.com", jobAddress: "9 Pine St", jobType: "Remodel", jobDate: "2026-09-25", completedAt: eightDaysAgo }).returning({ id: schema.jobs.id });
await checkThrows("review send failure surfaces an error", () => (BaseActions.sendReviewRequest as any).handler(ctx, { jobId: jFail!.id }));
const failLog = (await db.select().from(schema.automationLogs).where(and(eq(schema.automationLogs.kind, "review"), eq(schema.automationLogs.entityId, jFail!.id))));
check("failed review send is not logged as sent (no false idempotency)", failLog.length === 0);
const tickFail = await runReviewRequestTick(ctx);
check("tick skips already-mailed jobs but keeps running after a failure", tickFail.emailed.includes(jOld2!.id) && !tickFail.emailed.includes(jOld!.id));

// --- 8. Templates / trade assemblies --------------------------------------------
const template = await (BaseActions.saveQuoteTemplate as any).handler(ctx, {
  id: null,
  name: "Kitchen demo assembly",
  lineItems: [{ description: "Demo cabinets", amount: "450.00" }, { description: "Haul debris", amount: "200.00" }],
});
check("saveQuoteTemplate returns an id", typeof template.id === "number");
const toolkit = await (BaseActions.getGrowthToolkit as any).handler(ctx, {});
const saved = (toolkit.templates as Array<{ id: number; name: string; lineItems: Array<{ description: string }> }>).find((t) => t.id === template.id);
check("saved assembly appears in the growth toolkit", saved !== undefined && saved.name === "Kitchen demo assembly" && saved.lineItems.length === 2);
await checkThrows("saveQuoteTemplate rejects an empty name", () => (BaseActions.saveQuoteTemplate as any).handler(ctx, { id: null, name: "  ", lineItems: [{ description: "x", amount: "1" }] }));

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Phase 1 behavior checks passed.");
