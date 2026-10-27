// Crewkat Office Wave 1 helpers: production stages, the follow-up
// queue, automation recipes, budget-vs-actual, and the unified
// client/job timeline read-model.
//
// Design notes:
// - Everything here is a read-model or a small write over the existing
//   tables. The only new state is migration 0090's follow_ups,
//   job_events and office_automation_settings tables.
// - Automation recipes NEVER send external messages. They create
//   follow-up tasks (and, for the review recipe, reuse the existing
//   exactly-once review-request email when the job completes).
// - Money math matches the rest of the app: contract = job contract
//   sum + SIGNED change orders (changeOrders.ts), costs = receipts +
//   labor (time entries x settings.hourlyCostRate) + job expenses +
//   subcontractor agreed amounts — the same buckets getJobOperations
//   reports. Margin is only computed when costs exist; a job with no
//   logged costs reports marginPercent = null, never a fake 100%.

import { and, desc, eq, inArray } from "drizzle-orm";
import type { Ctx } from "@hatch/space-sdk";
import * as schema from "./schema";
import { contractSummaryForJob, jobDocumentsOrdered, moneyString, parseMoneyLoose } from "./changeOrders";

type Db = ReturnType<Ctx["db"]>;
type JobRow = typeof schema.jobs.$inferSelect;

// ---------------------------------------------------------------------------
// Dates (the codebase keys dates as UTC YYYY-MM-DD strings)
// ---------------------------------------------------------------------------

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function shiftDateKey(key: string, days: number): string {
  const base = new Date(`${key}T12:00:00Z`);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function daysBetweenKeys(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T12:00:00Z`).getTime();
  const to = new Date(`${toKey}T12:00:00Z`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function dateKeyToDate(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

// ---------------------------------------------------------------------------
// Production stages
// ---------------------------------------------------------------------------

export const PRODUCTION_STAGES = ["scheduled", "in_progress", "punch_list", "complete", "paid_in_full"] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

export const PRODUCTION_STAGE_LABELS: Record<ProductionStage, string> = {
  scheduled: "Scheduled",
  in_progress: "In Progress",
  punch_list: "Punch List",
  complete: "Complete",
  paid_in_full: "Paid in Full",
};

export function isProductionStage(value: string): value is ProductionStage {
  return (PRODUCTION_STAGES as readonly string[]).includes(value);
}

/** Stages that mean the job is finished (completedAt stays in sync). */
export function stageIsComplete(stage: ProductionStage): boolean {
  return stage === "complete" || stage === "paid_in_full";
}

// ---------------------------------------------------------------------------
// Job events (stage moves + automation firings, for the timeline)
// ---------------------------------------------------------------------------

export async function recordJobEvent(
  db: Db,
  args: {
    companyId: number;
    jobId: number;
    kind: "stage" | "automation" | "note";
    title: string;
    body?: string;
    userId?: number | null;
  },
): Promise<void> {
  await db.insert(schema.jobEvents).values({
    companyId: args.companyId,
    jobId: args.jobId,
    kind: args.kind,
    title: args.title,
    body: args.body ?? "",
    createdByUserId: args.userId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Follow-up queue
// ---------------------------------------------------------------------------

export type FollowUpInput = {
  companyId: number;
  title: string;
  body?: string;
  dueDate: string;
  source?: "manual" | "automation";
  sourceKey?: string;
  recipe?: string;
  assigneeUserId?: number | null;
  leadId?: number | null;
  jobId?: number | null;
  clientId?: number | null;
  invoiceId?: number | null;
  createdByUserId?: number | null;
};

/**
 * Insert a follow-up. Automation items carry a sourceKey and are
 * deduped: if a row with the same company + sourceKey already exists
 * (open OR done), nothing is inserted and null is returned — an
 * automation never re-nags about the same trigger.
 */
export async function createFollowUp(db: Db, args: FollowUpInput): Promise<number | null> {
  const sourceKey = args.sourceKey ?? "";
  if (sourceKey) {
    const existing = await db
      .select({ id: schema.followUps.id })
      .from(schema.followUps)
      .where(and(eq(schema.followUps.companyId, args.companyId), eq(schema.followUps.sourceKey, sourceKey)))
      .limit(1);
    if (existing[0]) return null;
  }
  try {
    const rows = await db
      .insert(schema.followUps)
      .values({
        companyId: args.companyId,
        title: args.title,
        body: args.body ?? "",
        dueDate: args.dueDate,
        source: args.source ?? "manual",
        sourceKey,
        recipe: args.recipe ?? "",
        assigneeUserId: args.assigneeUserId ?? null,
        leadId: args.leadId ?? null,
        jobId: args.jobId ?? null,
        clientId: args.clientId ?? null,
        invoiceId: args.invoiceId ?? null,
        createdByUserId: args.createdByUserId ?? null,
      })
      .returning({ id: schema.followUps.id });
    return rows[0]?.id ?? null;
  } catch {
    // The partial unique index raced us — treat as already queued.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Automation recipes
// ---------------------------------------------------------------------------

export type AutomationRecipeKey =
  | "proposal_follow_up"
  | "contract_welcome"
  | "job_review"
  | "invoice_overdue"
  | "lead_stale";

export const AUTOMATION_RECIPES: Array<{ key: AutomationRecipeKey; label: string; description: string }> = [
  {
    key: "proposal_follow_up",
    label: "Estimate follow-up",
    description: "When an estimate is sent, queue a follow-up task due in 2 days so no proposal goes unanswered.",
  },
  {
    key: "contract_welcome",
    label: "Contract welcome",
    description: "When a client signs a contract, queue a welcome-message task for the office (nothing is sent automatically).",
  },
  {
    key: "job_review",
    label: "Review request on completion",
    description: "When a job is marked Complete on the Production Board, send the review request through the existing review email (if enabled in Settings) or queue a task to ask for one.",
  },
  {
    key: "invoice_overdue",
    label: "Overdue invoice follow-up",
    description: "When an invoice goes past due with a balance, queue an office follow-up and client nudge task.",
  },
  {
    key: "lead_stale",
    label: "Stale lead alert",
    description: "When an open lead has no activity for 7 days, surface it in the follow-up queue before it goes cold.",
  },
];

/** Recipe switches for a company. Missing row / key = ON. */
export async function getRecipeSettings(db: Db, companyId: number): Promise<Record<AutomationRecipeKey, boolean>> {
  const out = Object.fromEntries(AUTOMATION_RECIPES.map((r) => [r.key, true])) as Record<AutomationRecipeKey, boolean>;
  const row = (await db.select().from(schema.officeAutomationSettings).where(eq(schema.officeAutomationSettings.companyId, companyId)).limit(1))[0];
  if (row) {
    try {
      const parsed = JSON.parse(row.recipesJson || "{}") as Record<string, unknown>;
      for (const recipe of AUTOMATION_RECIPES) {
        if (typeof parsed[recipe.key] === "boolean") out[recipe.key] = parsed[recipe.key] as boolean;
      }
    } catch { /* a corrupt map falls back to all-on */ }
  }
  return out;
}

export async function automationEnabled(db: Db, companyId: number, key: AutomationRecipeKey): Promise<boolean> {
  const settings = await getRecipeSettings(db, companyId);
  return settings[key];
}

// ---------------------------------------------------------------------------
// Budget vs actual
// ---------------------------------------------------------------------------

export type JobBudget = {
  contract: number;
  invoiced: number;
  paid: number;
  costs: number;
  costBreakdown: { materials: number; labor: number; expenses: number; subcontractors: number };
  hasCosts: boolean;
  /** (contract - costs) / contract * 100, 1 decimal. Null when the
   * job has no contract value or no costs logged yet. */
  marginPercent: number | null;
  lowMargin: boolean;
};

export async function jobCosts(db: Db, job: JobRow): Promise<JobBudget["costBreakdown"]> {
  const [receiptRows, timeRows, expenseRows, subRows, settingsRow] = await Promise.all([
    db.select().from(schema.receipts).where(eq(schema.receipts.jobId, job.id)),
    db.select().from(schema.timeEntries).where(eq(schema.timeEntries.jobId, job.id)),
    db.select().from(schema.businessExpenses).where(eq(schema.businessExpenses.jobId, job.id)),
    db.select().from(schema.subcontractors).where(eq(schema.subcontractors.jobId, job.id)),
    db.select().from(schema.settings).where(eq(schema.settings.companyId, job.companyId)).limit(1),
  ]);
  const hourlyCostRate = parseMoneyLoose(settingsRow[0]?.hourlyCostRate);
  const materials = receiptRows.reduce((sum, r) => sum + parseMoneyLoose(r.amount), 0);
  // Labor matches getJobOperations: clocked time (endedAt - startedAt;
  // a still-running timer counts up to now) x the settings cost rate.
  const nowMs = Date.now();
  const laborHours = timeRows.reduce((sum, t) => sum + Math.max(0, ((t.endedAt?.getTime() ?? nowMs) - t.startedAt.getTime()) / 3_600_000), 0);
  const labor = laborHours * hourlyCostRate;
  const expenses = expenseRows.reduce((sum, e) => sum + parseMoneyLoose(e.amount), 0);
  const subcontractors = subRows.reduce((sum, s) => sum + parseMoneyLoose(s.agreedAmount), 0);
  return { materials, labor, expenses, subcontractors };
}

export async function jobBudget(db: Db, job: JobRow): Promise<JobBudget> {
  const docs = await jobDocumentsOrdered(db, job.id);
  const contract = parseMoneyLoose(contractSummaryForJob(job, docs).revisedTotal);
  const invoiceRows = await db.select().from(schema.invoices).where(eq(schema.invoices.jobId, job.id));
  const invoiced = invoiceRows.reduce((sum, inv) => sum + parseMoneyLoose(inv.total), 0);
  let paid = 0;
  if (invoiceRows.length > 0) {
    const paymentRows = await db.select().from(schema.payments).where(inArray(schema.payments.invoiceId, invoiceRows.map((i) => i.id)));
    paid = paymentRows.reduce((sum, p) => sum + parseMoneyLoose(p.amount), 0);
  }
  const costBreakdown = await jobCosts(db, job);
  const costs = costBreakdown.materials + costBreakdown.labor + costBreakdown.expenses + costBreakdown.subcontractors;
  const hasCosts = costs > 0;
  const marginPercent = hasCosts && contract > 0
    ? Math.round(((contract - costs) / contract) * 1000) / 10
    : null;
  return {
    contract,
    invoiced,
    paid,
    costs,
    costBreakdown,
    hasCosts,
    marginPercent,
    lowMargin: marginPercent !== null && marginPercent < 15,
  };
}

// ---------------------------------------------------------------------------
// Job activity (for the Production Board "stuck" highlight)
// ---------------------------------------------------------------------------

/**
 * Last-activity timestamp per job: the newest touch across the job row
 * itself, stage events, photos, daily logs, time entries, receipts,
 * documents, invoices + their payments, internal notes and follow-ups.
 */
export async function jobLastActivity(db: Db, companyId: number, jobIds: number[]): Promise<Map<number, Date>> {
  const out = new Map<number, Date>();
  if (jobIds.length === 0) return out;
  const idSet = new Set(jobIds);
  const touch = (jobId: number | null, at: Date | null | undefined) => {
    if (jobId == null || !at || !idSet.has(jobId)) return;
    const current = out.get(jobId);
    if (!current || at.getTime() > current.getTime()) out.set(jobId, at);
  };
  const jobs = await db.select({ id: schema.jobs.id, updatedAt: schema.jobs.updatedAt, createdAt: schema.jobs.createdAt })
    .from(schema.jobs).where(eq(schema.jobs.companyId, companyId));
  for (const j of jobs) { touch(j.id, j.updatedAt); touch(j.id, j.createdAt); }
  const [events, photos, logs, times, receipts, docs, notes, followUps, invoices] = await Promise.all([
    db.select({ jobId: schema.jobEvents.jobId, at: schema.jobEvents.createdAt }).from(schema.jobEvents).where(eq(schema.jobEvents.companyId, companyId)),
    db.select({ jobId: schema.photos.jobId, at: schema.photos.createdAt }).from(schema.photos).where(eq(schema.photos.companyId, companyId)),
    db.select({ jobId: schema.dailyLogs.jobId, at: schema.dailyLogs.createdAt }).from(schema.dailyLogs).where(eq(schema.dailyLogs.companyId, companyId)),
    db.select({ jobId: schema.timeEntries.jobId, at: schema.timeEntries.createdAt }).from(schema.timeEntries).where(eq(schema.timeEntries.companyId, companyId)),
    db.select({ jobId: schema.receipts.jobId, at: schema.receipts.createdAt }).from(schema.receipts).where(eq(schema.receipts.companyId, companyId)),
    db.select({ jobId: schema.documents.jobId, at: schema.documents.createdAt }).from(schema.documents).where(eq(schema.documents.companyId, companyId)),
    db.select({ jobId: schema.internalNotes.jobId, at: schema.internalNotes.updatedAt }).from(schema.internalNotes).where(eq(schema.internalNotes.companyId, companyId)),
    db.select({ jobId: schema.followUps.jobId, at: schema.followUps.updatedAt }).from(schema.followUps).where(eq(schema.followUps.companyId, companyId)),
    db.select({ id: schema.invoices.id, jobId: schema.invoices.jobId, at: schema.invoices.createdAt }).from(schema.invoices).where(eq(schema.invoices.companyId, companyId)),
  ]);
  for (const r of [...events, ...photos, ...logs, ...times, ...receipts, ...docs, ...notes, ...followUps]) touch(r.jobId, r.at);
  const invoiceJob = new Map(invoices.map((i) => [i.id, i.jobId]));
  for (const inv of invoices) touch(inv.jobId, inv.at);
  if (invoices.length > 0) {
    const payments = await db.select({ invoiceId: schema.payments.invoiceId, at: schema.payments.createdAt })
      .from(schema.payments).where(inArray(schema.payments.invoiceId, invoices.map((i) => i.id)));
    for (const p of payments) touch(invoiceJob.get(p.invoiceId) ?? null, p.at);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Automation sweep (time-based recipes: overdue invoices + stale leads)
// ---------------------------------------------------------------------------

/**
 * Runs the two sweep recipes for one company. Deduped by sourceKey, so
 * it is safe to call on every queue load and from the hourly tick.
 * Returns how many follow-ups were created.
 */
export async function runAutomationSweep(db: Db, companyId: number, now = new Date()): Promise<{ created: number }> {
  const recipes = await getRecipeSettings(db, companyId);
  const today = todayKey(now);
  let created = 0;

  if (recipes.invoice_overdue) {
    const invoiceRows = await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, companyId));
    const open = invoiceRows.filter((inv) => inv.status !== "paid" && inv.dueDate && inv.dueDate < today);
    if (open.length > 0) {
      const paymentRows = await db.select().from(schema.payments).where(inArray(schema.payments.invoiceId, open.map((i) => i.id)));
      const paidByInvoice = new Map<number, number>();
      for (const p of paymentRows) paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) ?? 0) + parseMoneyLoose(p.amount));
      for (const inv of open) {
        const balance = parseMoneyLoose(inv.total) - (paidByInvoice.get(inv.id) ?? 0);
        if (balance <= 0) continue;
        const days = daysBetweenKeys(inv.dueDate, today);
        const id = await createFollowUp(db, {
          companyId,
          title: `Invoice ${inv.invoiceNumber || `#${inv.id}`} is overdue — follow up with ${inv.clientName}`,
          body: `Balance of ${moneyString(balance)} is ${days} day${days === 1 ? "" : "s"} past due (due ${inv.dueDate}). Nudge the client, then confirm a payment date.`,
          dueDate: today,
          source: "automation",
          sourceKey: `overdue-invoice:${inv.id}`,
          recipe: "invoice_overdue",
          jobId: inv.jobId,
          clientId: inv.clientId,
          invoiceId: inv.id,
        });
        if (id !== null) {
          created++;
          if (inv.jobId) {
            const job = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, inv.jobId)).limit(1))[0];
            if (job) {
              await recordJobEvent(db, {
                companyId,
                jobId: inv.jobId,
                kind: "automation",
                title: "Overdue invoice follow-up queued",
                body: `Invoice ${inv.invoiceNumber || `#${inv.id}`} is ${days} days past due with a balance of ${moneyString(balance)}.`,
              });
            }
          }
        }
      }
    }
  }

  if (recipes.lead_stale) {
    const leadRows = await db.select().from(schema.leads).where(eq(schema.leads.companyId, companyId));
    const openLeads = leadRows.filter((lead) => lead.stage === "new" || lead.stage === "contacted" || lead.stage === "quoted");
    if (openLeads.length > 0) {
      const activityRows = await db.select({ leadId: schema.leadActivities.leadId, at: schema.leadActivities.createdAt })
        .from(schema.leadActivities).where(inArray(schema.leadActivities.leadId, openLeads.map((l) => l.id)));
      const lastActivity = new Map<number, Date>();
      for (const a of activityRows) {
        const current = lastActivity.get(a.leadId);
        if (!current || a.at.getTime() > current.getTime()) lastActivity.set(a.leadId, a.at);
      }
      const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
      for (const lead of openLeads) {
        const lastTouch = lastActivity.get(lead.id) ?? lead.updatedAt;
        const last = lastTouch.getTime() > lead.updatedAt.getTime() ? lastTouch : lead.updatedAt;
        if (last.getTime() > cutoff) continue;
        const idleDays = Math.floor((now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000));
        const id = await createFollowUp(db, {
          companyId,
          title: `Lead ${lead.name} has gone quiet`,
          body: `No activity for ${idleDays} days (stage: ${lead.stage}). Reach out before it goes cold.`,
          dueDate: today,
          source: "automation",
          sourceKey: `stale-lead:${lead.id}:${todayKey(last)}`,
          recipe: "lead_stale",
          leadId: lead.id,
          clientId: lead.clientId,
        });
        if (id !== null) created++;
      }
    }
  }

  return { created };
}

// ---------------------------------------------------------------------------
// Unified timeline read-model
// ---------------------------------------------------------------------------

export type TimelineEvent = {
  id: string;
  kind: string;
  title: string;
  body: string;
  at: string; // ISO timestamp
};

const TIMELINE_CAP = 200;

function sortTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return events
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, TIMELINE_CAP);
}

export async function buildJobTimeline(db: Db, job: JobRow): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];
  const push = (id: string, kind: string, title: string, at: Date | null | undefined, body = "") => {
    if (!at) return;
    events.push({ id, kind, title, body, at: at.toISOString() });
  };

  push(`job-created:${job.id}`, "job", "Job created", job.createdAt, job.jobType || "");

  const [eventRows, docs, quoteRows, invoiceRows, logRows, photoRows, noteRows, followUpRows, messageRows] = await Promise.all([
    db.select().from(schema.jobEvents).where(eq(schema.jobEvents.jobId, job.id)).orderBy(desc(schema.jobEvents.createdAt)),
    jobDocumentsOrdered(db, job.id),
    db.select().from(schema.quotes).where(eq(schema.quotes.jobId, job.id)),
    db.select().from(schema.invoices).where(eq(schema.invoices.jobId, job.id)),
    db.select().from(schema.dailyLogs).where(eq(schema.dailyLogs.jobId, job.id)),
    db.select().from(schema.photos).where(eq(schema.photos.jobId, job.id)),
    db.select().from(schema.internalNotes).where(eq(schema.internalNotes.jobId, job.id)),
    db.select().from(schema.followUps).where(eq(schema.followUps.jobId, job.id)),
    db.select().from(schema.jobMessages).where(and(eq(schema.jobMessages.jobId, job.id), eq(schema.jobMessages.sender, "system"))),
  ]);

  for (const row of eventRows) {
    push(`event:${row.id}`, row.kind, row.title, row.createdAt, row.body);
  }
  for (const msg of messageRows) {
    push(`sysmsg:${msg.id}`, "system", msg.body, msg.createdAt);
  }

  // Documents + their client-link lifecycle (shared / opened / signed).
  const docIds = docs.map((d) => d.id);
  const quoteIds = quoteRows.map((q) => q.id);
  const invoiceIds = invoiceRows.map((i) => i.id);
  const linkRows = (docIds.length + quoteIds.length + invoiceIds.length) > 0
    ? await db.select().from(schema.documentLinks).where(
        and(
          eq(schema.documentLinks.companyId, job.companyId),
        ),
      )
    : [];
  // document_links is unified: (documentKind, documentId) points at a
  // documents row ("contract" / "change_order"), a quote ("quote"), or
  // an invoice ("invoice").
  const docTitle = new Map(docs.map((d) => [d.id, d.title]));
  const linksFor = linkRows.filter((l) =>
    ((l.documentKind === "contract" || l.documentKind === "change_order") && docIds.includes(l.documentId)) ||
    (l.documentKind === "quote" && quoteIds.includes(l.documentId)) ||
    (l.documentKind === "invoice" && invoiceIds.includes(l.documentId)));
  const linkLabel = (l: (typeof linkRows)[number]): string => {
    if (l.documentKind === "contract" || l.documentKind === "change_order") return docTitle.get(l.documentId) ?? "Document";
    if (l.documentKind === "quote") return `Estimate #${l.documentId}`;
    const inv = invoiceRows.find((i) => i.id === l.documentId);
    return inv ? `Invoice ${inv.invoiceNumber || `#${inv.id}`}` : "Invoice";
  };
  for (const link of linksFor) {
    push(`link:${link.id}:shared`, "shared", `Shared with client: ${linkLabel(link)}`, link.createdAt);
    if (link.firstViewedAt) {
      push(`link:${link.id}:viewed`, "viewed", `Client opened ${linkLabel(link)}`, link.firstViewedAt, link.viewCount > 1 ? `Opened ${link.viewCount} times` : "");
    }
  }

  for (const doc of docs) {
    push(`doc:${doc.id}:created`, "document", `${doc.title} created`, doc.createdAt, doc.kind === "change_order" ? "Change order" : "Contract");
    if (doc.clientSignedAt) {
      push(`doc:${doc.id}:signed`, "signed", `${doc.title} signed`, doc.clientSignedAt, doc.clientSignerName ? `Signed by ${doc.clientSignerName}` : "");
    }
  }
  for (const quote of quoteRows) {
    push(`quote:${quote.id}:created`, "estimate", `Estimate #${quote.id} created`, quote.createdAt, `$${moneyString(parseMoneyLoose(quote.total))}`);
    if (quote.sentAt) {
      push(`quote:${quote.id}:sent`, "estimate", `Estimate #${quote.id} sent`, dateKeyToDate(quote.sentAt));
    }
    if (quote.accepted) {
      push(`quote:${quote.id}:accepted`, "estimate", `Estimate #${quote.id} accepted`, quote.updatedAt);
    }
  }
  for (const inv of invoiceRows) {
    push(`invoice:${inv.id}:issued`, "invoice", `Invoice ${inv.invoiceNumber || `#${inv.id}`} issued`, inv.createdAt, `$${moneyString(parseMoneyLoose(inv.total))}`);
  }
  if (invoiceIds.length > 0) {
    const paymentRows = await db.select().from(schema.payments).where(inArray(schema.payments.invoiceId, invoiceIds));
    const invById = new Map(invoiceRows.map((i) => [i.id, i]));
    for (const p of paymentRows) {
      const inv = invById.get(p.invoiceId);
      push(`payment:${p.id}`, "payment", `Payment received — $${moneyString(parseMoneyLoose(p.amount))}`, p.createdAt,
        `${inv ? `Invoice ${inv.invoiceNumber || `#${inv.id}`}` : ""}${p.method ? ` · ${p.method}` : ""} · ${p.paymentDate}`);
    }
  }
  for (const log of logRows) {
    push(`log:${log.id}`, "log", `Daily log — ${log.logDate}`, log.createdAt, log.notes.slice(0, 160));
  }
  // Photos grouped by day + stage so a big upload doesn't flood the feed.
  const photoGroups = new Map<string, { count: number; at: Date; stage: string }>();
  for (const photo of photoRows) {
    const key = `${photo.createdAt.toISOString().slice(0, 10)}:${photo.stage}`;
    const group = photoGroups.get(key);
    if (group) { group.count++; if (photo.createdAt.getTime() > group.at.getTime()) group.at = photo.createdAt; }
    else photoGroups.set(key, { count: 1, at: photo.createdAt, stage: photo.stage });
  }
  for (const [key, group] of photoGroups) {
    push(`photos:${job.id}:${key}`, "photo", `${group.count} photo${group.count === 1 ? "" : "s"} added (${group.stage})`, group.at);
  }
  for (const note of noteRows) {
    push(`note:${note.id}`, "note", "Note added", note.createdAt, note.note.slice(0, 160));
  }
  for (const fu of followUpRows) {
    push(`followup:${fu.id}:created`, "follow_up", `Follow-up queued: ${fu.title}`, fu.createdAt);
    if (fu.completedAt) {
      push(`followup:${fu.id}:done`, "follow_up", `Follow-up completed: ${fu.title}`, fu.completedAt);
    }
  }

  return sortTimeline(events);
}

export async function buildClientTimeline(db: Db, client: typeof schema.clients.$inferSelect): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];
  events.push({ id: `client-created:${client.id}`, kind: "client", title: "Client added", body: "", at: client.createdAt.toISOString() });

  const clientJobs = await db.select().from(schema.jobs).where(eq(schema.jobs.clientId, client.id));
  for (const job of clientJobs) {
    const jobEvents = await buildJobTimeline(db, job);
    for (const e of jobEvents) {
      if (e.kind === "job") continue; // the job's own creation is noise at client level
      events.push({ ...e, body: [job.jobType || "Job", e.body].filter(Boolean).join(" · ") });
    }
    events.push({
      id: `job-created:${job.id}`,
      kind: "job",
      title: `Job started: ${job.jobType || "Job"}`,
      body: job.jobAddress || "",
      at: job.createdAt.toISOString(),
    });
  }

  // Quotes / invoices attached to the client but not to one of their jobs.
  const jobIds = new Set(clientJobs.map((j) => j.id));
  const [quoteRows, invoiceRows, noteRows, followUpRows] = await Promise.all([
    db.select().from(schema.quotes).where(eq(schema.quotes.clientId, client.id)),
    db.select().from(schema.invoices).where(eq(schema.invoices.clientId, client.id)),
    db.select().from(schema.internalNotes).where(eq(schema.internalNotes.clientId, client.id)),
    db.select().from(schema.followUps).where(eq(schema.followUps.clientId, client.id)),
  ]);
  for (const quote of quoteRows) {
    if (quote.jobId != null && jobIds.has(quote.jobId)) continue;
    events.push({ id: `quote:${quote.id}:created`, kind: "estimate", title: `Estimate #${quote.id} created`, body: `$${moneyString(parseMoneyLoose(quote.total))}`, at: quote.createdAt.toISOString() });
    if (quote.sentAt) {
      events.push({ id: `quote:${quote.id}:sent`, kind: "estimate", title: `Estimate #${quote.id} sent`, body: "", at: dateKeyToDate(quote.sentAt).toISOString() });
    }
  }
  const looseInvoices = invoiceRows.filter((inv) => inv.jobId == null || !jobIds.has(inv.jobId));
  for (const inv of looseInvoices) {
    events.push({ id: `invoice:${inv.id}:issued`, kind: "invoice", title: `Invoice ${inv.invoiceNumber || `#${inv.id}`} issued`, body: `$${moneyString(parseMoneyLoose(inv.total))}`, at: inv.createdAt.toISOString() });
  }
  if (looseInvoices.length > 0) {
    const paymentRows = await db.select().from(schema.payments).where(inArray(schema.payments.invoiceId, looseInvoices.map((i) => i.id)));
    const invById = new Map(looseInvoices.map((i) => [i.id, i]));
    for (const p of paymentRows) {
      const inv = invById.get(p.invoiceId);
      events.push({ id: `payment:${p.id}`, kind: "payment", title: `Payment received — $${moneyString(parseMoneyLoose(p.amount))}`, body: inv ? `Invoice ${inv.invoiceNumber || `#${inv.id}`}` : "", at: p.createdAt.toISOString() });
    }
  }
  for (const note of noteRows) {
    if (note.jobId != null && jobIds.has(note.jobId)) continue;
    events.push({ id: `note:${note.id}`, kind: "note", title: "Note added", body: note.note.slice(0, 160), at: note.createdAt.toISOString() });
  }
  for (const fu of followUpRows) {
    if (fu.jobId != null && jobIds.has(fu.jobId)) continue;
    events.push({ id: `followup:${fu.id}:created`, kind: "follow_up", title: `Follow-up queued: ${fu.title}`, body: "", at: fu.createdAt.toISOString() });
    if (fu.completedAt) {
      events.push({ id: `followup:${fu.id}:done`, kind: "follow_up", title: `Follow-up completed: ${fu.title}`, body: "", at: fu.completedAt.toISOString() });
    }
  }

  return sortTimeline(events);
}
