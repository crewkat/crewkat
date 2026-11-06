// Promotions + manual review requests (0092, Danny 2026-11-01).
//
// Covers: migration 0092 (campaigns / campaign_recipients /
// email_suppressions), the "Estimate, never closed" segment definition,
// suppression exclusion across all recipient modes, the template
// composer, the campaign save → send → locked lifecycle with a stubbed
// mailer, and the Feature 1 review-request additions (shared
// exactly-once record, resend override, reviewRequestedAt surfacing,
// automation-after-manual never double-sends).
//
// Run from app/:  bun promotions-reviews.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import { BaseActions, composeCampaignContent, runReviewRequestTick } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function checkThrows(name: string, fn: () => Promise<unknown>) {
  try { await fn(); failures++; console.error(`FAIL ${name} — expected an error but none was thrown`); }
  catch { console.log(`ok   ${name}`); }
}

// --- 1. Migration journal ---------------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
const last = entries[entries.length - 1]!;
const maxBefore = Math.max(...entries.slice(0, -1).map((e) => e.when));
check("newest migration tag is 0101_price_book_description_cleanup", last.tag === "0101_price_book_description_cleanup", last.tag);
check("newest migration when is strictly greater than every earlier entry", last.when > maxBefore, `last=${last.when} maxBefore=${maxBefore}`);

// --- 2. Scratch DB ----------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-promo-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });
const tables = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
check("campaigns table exists", tables.includes("campaigns"));
check("campaign_recipients table exists", tables.includes("campaign_recipients"));
check("email_suppressions table exists", tables.includes("email_suppressions"));

// --- 3. Test context ----------------------------------------------------------
const sentEmails: Array<{ to: string; subject: string; html?: string }> = [];
const ctx = {
  slug: "tradesign",
  invocationId: "promo-test",
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
    if (args && typeof args.to === "string" && typeof args.subject === "string") {
      if (args.to === "fail@example.com") throw new Error("SMTP refused");
      sentEmails.push({ to: args.to, subject: args.subject, html: typeof args.html === "string" ? args.html : undefined });
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

await db.insert(schema.settings).values({
  companyId: 1, companyName: "Promo Test Co", phone: "(813) 555-0100", website: "https://example.com",
  serviceArea: "Tampa Bay", reviewUrl: "https://g.page/r/test/review", reviewRequestsEnabled: true, reviewRequestDelayDays: 3,
});

// --- 4. Segment fixtures ------------------------------------------------------
// A: sent quote only -> IN. B: sent quote + job -> OUT. C: sent quote +
// invoice -> OUT. D: sent quote + accepted quote -> OUT. E: unsent quote
// only -> OUT. F: no quotes, has email -> all-mode only. G: sent quote,
// no email -> segment member but unusable. H: sent quote, suppressed.
async function seedClient(name: string, email: string) {
  const [row] = await db.insert(schema.clients).values({ companyId: 1, name, email }).returning({ id: schema.clients.id });
  return row!.id;
}
async function seedQuote(clientId: number, overrides: Record<string, unknown> = {}) {
  const [row] = await db.insert(schema.quotes).values({
    companyId: 1, clientId, clientName: "Fixture", lineItemsJson: "[]", total: "1000",
    sentAt: "2026-10-01", ...overrides,
  }).returning({ id: schema.quotes.id });
  return row!.id;
}
const clientA = await seedClient("Sent Sue", "sue@example.com");
await seedQuote(clientA);
const clientB = await seedClient("Booked Bob", "bob@example.com");
await seedQuote(clientB);
await db.insert(schema.jobs).values({ companyId: 1, clientId: clientB, clientName: "Booked Bob", clientEmail: "bob@example.com", jobAddress: "1 Oak St", jobType: "Remodel", jobDate: "2026-10-05" });
const clientC = await seedClient("Invoiced Ivy", "ivy@example.com");
await seedQuote(clientC);
await db.insert(schema.invoices).values({ companyId: 1, clientId: clientC, invoiceNumber: "INV-9001", clientName: "Invoiced Ivy", lineItemsJson: "[]", total: "900", status: "sent", issueDate: "2026-10-06" });
const clientD = await seedClient("Accepted Ann", "ann@example.com");
await seedQuote(clientD);
await seedQuote(clientD, { accepted: true });
const clientE = await seedClient("Draft Dan", "dan@example.com");
await seedQuote(clientE, { sentAt: "" });
const clientF = await seedClient("Plain Pam", "pam@example.com");
const clientG = await seedClient("Noemail Ned", "");
await seedQuote(clientG);
const clientH = await seedClient("Muted Meg", "meg@example.com");
await seedQuote(clientH);
await db.insert(schema.emailSuppressions).values({ companyId: 1, email: "meg@example.com", clientId: clientH, source: "unsubscribe", createdAt: new Date() });
const clientFail = await seedClient("Fail Fran", "fail@example.com");

// --- 5. Segment + suppression resolution --------------------------------------
const segPreview = await (BaseActions.previewCampaignRecipients as any).handler(ctx, { mode: "never_closed", clientIds: [] });
check("never-closed segment contains only the sent-quote-only client", segPreview.count === 1 && segPreview.recipients[0]?.clientId === clientA, JSON.stringify(segPreview.recipients));
check("never-closed preview reports the suppressed exclusion", segPreview.suppressedCount === 1, String(segPreview.suppressedCount));
check("never-closed preview reports the no-email skip", segPreview.noEmailCount === 1, String(segPreview.noEmailCount));

const allPreview = await (BaseActions.previewCampaignRecipients as any).handler(ctx, { mode: "all", clientIds: [] });
const allIds = (allPreview.recipients as Array<{ clientId: number }>).map((r) => r.clientId);
check("all-mode includes every emailable client except the suppressed one",
  allIds.includes(clientA) && allIds.includes(clientB) && allIds.includes(clientF) && !allIds.includes(clientH) && !allIds.includes(clientG),
  JSON.stringify(allIds));
check("all-mode reports the suppressed exclusion too", allPreview.suppressedCount === 1);

const pickPreview = await (BaseActions.previewCampaignRecipients as any).handler(ctx, { mode: "individual", clientIds: [clientB, clientD] });
check("individual mode sends to picked clients regardless of segment", pickPreview.count === 2, String(pickPreview.count));

// --- 6. Template composer -------------------------------------------------------
const promo = composeCampaignContent({ type: "promotion", prompt: "10% off bathroom remodels booked in November", companyName: "Promo Test Co", phone: "(813) 555-0100", website: "https://example.com", reviewUrl: "https://g.page/r/test/review", serviceArea: "Tampa Bay" });
check("composer surfaces the discount in the subject", promo.subject.includes("10%"), promo.subject);
check("composer builds an offer CTA", promo.ctaLabel === "Claim this offer" && promo.ctaUrl === "https://example.com", JSON.stringify(promo));
const blog = composeCampaignContent({ type: "blog", prompt: "5 signs your bathroom needs a remodel", companyName: "Promo Test Co", phone: "", website: "", reviewUrl: "", serviceArea: "" });
check("composer builds a numbered blog body from the topic", blog.bodyText.includes("1.") && blog.bodyText.includes("5.") && /bath/i.test(blog.bodyText), blog.bodyText.slice(0, 120));
const generated = await (BaseActions.generateCampaignContent as any).handler(ctx, { type: "promotion", prompt: "We now offer financing" });
check("generate action returns an editable draft mentioning financing", /financ/i.test(generated.bodyText) && generated.subject.length > 0);

// --- 7. Campaign lifecycle ------------------------------------------------------
const draft = await (BaseActions.saveCampaign as any).handler(ctx, {
  id: null, name: "November win-back", type: "promotion", subject: promo.subject, prompt: "10% off bathroom remodels booked in November",
  headline: promo.headline, bodyText: promo.bodyText, ctaLabel: promo.ctaLabel, ctaUrl: promo.ctaUrl,
  imageBlobKey: null, customHtml: "", recipientMode: "never_closed", recipientClientIds: [],
});
check("saveCampaign creates a draft", typeof draft.id === "number");
const before = sentEmails.length;
const sendResult = await (BaseActions.sendCampaign as any).handler(ctx, { id: draft.id });
check("campaign sends to the resolved segment", sendResult.total === 1 && sendResult.sent === 1 && sendResult.failed === 0, JSON.stringify(sendResult));
check("campaign email carries an unsubscribe link", sentEmails.slice(before).some((e) => e.to === "sue@example.com" && (e.html ?? "").includes("/u/")), JSON.stringify(sentEmails.slice(before).map((e) => e.to)));
const recipientRows = await db.select().from(schema.campaignRecipients).where(eq(schema.campaignRecipients.campaignId, draft.id));
check("per-recipient send record stored with a token", recipientRows.length === 1 && recipientRows[0]!.status === "sent" && recipientRows[0]!.unsubscribeToken.length >= 32);
const detail = await (BaseActions.getCampaign as any).handler(ctx, { id: draft.id });
check("sent campaign is marked sent with counts", detail.campaign?.status === "sent" && detail.campaign?.sentCount === 1 && detail.campaign?.recipientCount === 1);
await checkThrows("a sent campaign cannot be sent again", () => (BaseActions.sendCampaign as any).handler(ctx, { id: draft.id }));
await checkThrows("a sent campaign cannot be edited", () => (BaseActions.saveCampaign as any).handler(ctx, { id: draft.id, name: "Edit", type: "promotion", recipientMode: "all" }));
const dup = await (BaseActions.duplicateCampaign as any).handler(ctx, { id: draft.id });
const dupDetail = await (BaseActions.getCampaign as any).handler(ctx, { id: dup.id });
check("duplicate copies a sent campaign into a fresh draft", dupDetail.campaign?.status === "draft" && dupDetail.campaign?.recipientMode === "never_closed");

// Suppression added AFTER a send excludes the address from the next one.
const tokenRow = recipientRows[0]!;
await db.insert(schema.emailSuppressions).values({ companyId: 1, email: "sue@example.com", clientId: clientA, source: "unsubscribe", createdAt: new Date() });
const segAfter = await (BaseActions.previewCampaignRecipients as any).handler(ctx, { mode: "never_closed", clientIds: [] });
check("unsubscribing removes the client from the segment", segAfter.count === 0 && segAfter.suppressedCount === 2, JSON.stringify({ count: segAfter.count, suppressed: segAfter.suppressedCount }));
check("the stored unsubscribe token matches the emailed one", tokenRow.unsubscribeToken.length >= 32);

// Failed delivery is recorded, not fatal.
const failDraft = await (BaseActions.saveCampaign as any).handler(ctx, {
  id: null, name: "Fail check", type: "promotion", subject: "Hi", headline: "Hi", bodyText: "Body",
  ctaLabel: "", ctaUrl: "", imageBlobKey: null, customHtml: "", recipientMode: "individual", recipientClientIds: [clientFail, clientF],
});
const failSend = await (BaseActions.sendCampaign as any).handler(ctx, { id: failDraft.id });
check("a failed delivery is counted while others still send", failSend.sent === 1 && failSend.failed === 1 && failSend.total === 2, JSON.stringify(failSend));
const failRows = await db.select().from(schema.campaignRecipients).where(eq(schema.campaignRecipients.campaignId, failDraft.id));
check("the failed recipient row carries the failure", failRows.some((r) => r.status === "failed" && r.error.length > 0));

// --- 8. Review requests: manual send, resend, shared record ---------------------
const [jobDone] = await db.insert(schema.jobs).values({
  companyId: 1, clientId: clientF, clientName: "Plain Pam", clientEmail: "pam@example.com",
  jobAddress: "9 Pine St", jobType: "Bathroom", jobDate: "2026-10-20", completedAt: new Date(now - 1 * DAY),
}).returning({ id: schema.jobs.id });

const manual = await (BaseActions.sendReviewRequest as any).handler(ctx, { jobId: jobDone!.id });
check("manual review request sends", manual.emailed === true && sentEmails.some((e) => e.to === "pam@example.com"));
check("manual send returns reviewRequestedAt", typeof manual.reviewRequestedAt === "string" && manual.reviewRequestedAt.length > 0);
const manualAgain = await (BaseActions.sendReviewRequest as any).handler(ctx, { jobId: jobDone!.id });
check("plain re-call stays exactly-once", manualAgain.emailed === false);
const resend = await (BaseActions.sendReviewRequest as any).handler(ctx, { jobId: jobDone!.id, resend: true });
check("explicit resend sends again", resend.emailed === true);
const reviewLogs = await db.select().from(schema.automationLogs).where(and(eq(schema.automationLogs.kind, "review"), eq(schema.automationLogs.entityId, jobDone!.id)));
check("both sends are on the shared record", reviewLogs.length === 2, String(reviewLogs.length));
const jobEvents = await db.select().from(schema.jobEvents).where(eq(schema.jobEvents.jobId, jobDone!.id));
check("manual sends wrote job-timeline events", jobEvents.some((e) => e.title === "Review request sent") && jobEvents.some((e) => e.title === "Review request re-sent"));

const jobDetail = await (BaseActions.getJob as any).handler(ctx, { id: jobDone!.id });
check("getJob surfaces reviewRequestedAt", typeof jobDetail.reviewRequestedAt === "string");
const board = await (BaseActions.getProductionBoard as any).handler(ctx, {});
const boardJob = (board.jobs as Array<{ id: number; reviewRequestedAt: string | null }>).find((j) => j.id === jobDone!.id);
check("production board surfaces reviewRequestedAt", !!boardJob && typeof boardJob.reviewRequestedAt === "string");

// The scheduler must respect the manual record — no double-send, ever.
const tick = await runReviewRequestTick(ctx);
check("automation tick does not re-send after manual sends", !tick.emailed.includes(jobDone!.id), JSON.stringify(tick.emailed));
check("no third REVIEW email went to the client (a campaign email to her is separate)", sentEmails.filter((e) => e.to === "pam@example.com" && e.subject.startsWith("How did we do")).length === 2, String(sentEmails.filter((e) => e.to === "pam@example.com" && e.subject.startsWith("How did we do")).length));

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Promotions + review-request checks passed.");
