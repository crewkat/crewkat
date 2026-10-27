// Office Wave 1 behavior tests: Production Board (stages + stuck),
// follow-up queue (manual CRUD + automation sweep), the five
// automation recipes, budget-vs-actual, unified timelines, recipe
// settings, and the role/access-shaping rules around all of it.
//
// Exercised through the real protected `Actions` surface with real
// logins (same harness style as office-track1c), plus direct DB seeds
// for invoices/payments/receipts/leads.
//
// Run from app/:  bun office-wave1.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { Actions, runOfficeAutomationTick } from "./server/src/actions.ts";
import { minRoleForAction } from "./server/src/permissions.ts";
import * as schema from "./server/src/schema.ts";
import { eq } from "drizzle-orm";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function checkThrows(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    failures++;
    console.error(`FAIL ${name} — expected an error but none was thrown`);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (match && !match.test(msg)) { failures++; console.error(`FAIL ${name} — wrong error: ${msg.slice(0, 140)}`); }
    else console.log(`ok   ${name}`);
  }
}

// --- 1. Migration journal + schema ---------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
const last = entries[entries.length - 1]!;
const maxBefore = Math.max(...entries.slice(0, -1).map((e) => e.when));
check("newest migration when is strictly greater than every earlier entry", last.when > maxBefore, `last=${last.when} maxBefore=${maxBefore}`);
check("newest migration tag is 0090_office_wave1", last.tag === "0090_office_wave1", last.tag);
check("newest migration idx is 89", last.idx === 89, String(last.idx));

const dir = await mkdtemp(join(tmpdir(), "crewkat-office-wave1-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });
const jobCols = (await sqlite.execute("PRAGMA table_info(jobs)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: jobs.production_stage exists", jobCols.includes("production_stage"));
const tableNames = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: follow_ups table exists", tableNames.includes("follow_ups"));
check("migrations applied: job_events table exists", tableNames.includes("job_events"));
check("migrations applied: office_automation_settings table exists", tableNames.includes("office_automation_settings"));

// --- 2. Permission classification ------------------------------------------------
check("board + queue + budget are office+", minRoleForAction("getProductionBoard") === "office" && minRoleForAction("setJobProductionStage") === "office" && minRoleForAction("getFollowUpQueue") === "office" && minRoleForAction("saveFollowUp") === "office" && minRoleForAction("completeFollowUp") === "office" && minRoleForAction("snoozeFollowUp") === "office" && minRoleForAction("getJobBudget") === "office" && minRoleForAction("getAutomationSettings") === "office");
check("automation settings writes are admin-only", minRoleForAction("updateAutomationSettings") === "admin");
check("timelines are open to all roles", minRoleForAction("getJobTimeline") === "field" && minRoleForAction("getClientTimeline") === "field");

// --- 3. Test context + accounts ----------------------------------------------------
const blobStore = new Map<string, Buffer>();
const ctx = {
  slug: "tradesign",
  invocationId: "office-wave1-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async (key: string, data: Buffer) => { blobStore.set(key, Buffer.from(data)); },
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async (key: string) => blobStore.get(key) ?? Buffer.alloc(0),
    delete: async (key: string) => { blobStore.delete(key); },
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => ({ delivery: "fallback" }),
  emit: () => {},
  invalidateQueries: () => {},
} as any;

const A = Actions as any;
const today = new Date().toISOString().slice(0, 10);
const shift = (key: string, days: number) => new Date(new Date(`${key}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

async function signUpOwner(name: string, email: string, password: string) {
  const res = await A.signUp.handler(ctx, { name, email, password, marketplaceTermsAccepted: true });
  await A.verifyEmail.handler(ctx, { email, code: res.verificationCode });
  return A.login.handler(ctx, { email, password }) as Promise<{ sessionToken: string; user: { id: number; companyId: number } }>;
}

const owner = await signUpOwner("Olivia Owner", "owner@wave1.test", "owner-pass-123");
const ownerToken = owner.sessionToken;
const companyId = owner.user.companyId;
const officeMade = await A.createStaffAccount.handler(ctx, { _sessionToken: ownerToken, name: "Oscar Office", email: "office@wave1.test", password: "office-pass-123", role: "office" });
const fieldMade = await A.createStaffAccount.handler(ctx, { _sessionToken: ownerToken, name: "Fred Field", email: "field@wave1.test", password: "field-pass-123", role: "field" });
const officeLogin = await A.login.handler(ctx, { email: "office@wave1.test", password: "office-pass-123" });
const fieldLogin = await A.login.handler(ctx, { email: "field@wave1.test", password: "field-pass-123" });
const officeToken = officeLogin.sessionToken as string;
const fieldToken = fieldLogin.sessionToken as string;
check("staff accounts created", typeof officeMade.id === "number" && typeof fieldMade.id === "number");

// --- 4. Production Board + stage moves ----------------------------------------------
const job1 = { id: (await A.createJob.handler(ctx, { _sessionToken: ownerToken, clientId: null, clientName: "Board Client", clientPhone: "", clientEmail: "board@example.com", jobAddress: "9 Board Way, Tampa, FL", jobType: "Kitchen remodel", notes: "", jobDate: today, appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "" })).id as number };
const job1Initial = await A.getJob.handler(ctx, { _sessionToken: ownerToken, id: job1.id });
check("created job starts in the scheduled stage", job1Initial.job.productionStage === "scheduled", job1Initial.job.productionStage);

const board0 = await A.getProductionBoard.handler(ctx, { _sessionToken: officeToken });
check("office can read the board", board0.stages.length === 5 && board0.jobs.some((j: any) => j.id === job1.id && j.productionStage === "scheduled"));
await checkThrows("field is denied the board", () => A.getProductionBoard.handler(ctx, { _sessionToken: fieldToken }));

const moved = await A.setJobProductionStage.handler(ctx, { _sessionToken: officeToken, jobId: job1.id, stage: "in_progress" });
check("office can move a job's stage", moved.ok === true && moved.stage === "in_progress");
const job1After = await A.getJob.handler(ctx, { _sessionToken: ownerToken, id: job1.id });
check("getJob reflects the new stage", job1After.job.productionStage === "in_progress", job1After.job.productionStage);
const stageEvents = await db.select().from(schema.jobEvents).where(eq(schema.jobEvents.jobId, job1.id));
check("stage move recorded a job event", stageEvents.some((e) => e.kind === "stage" && e.title.includes("In Progress")), JSON.stringify(stageEvents.map((e) => e.title)));
await checkThrows("field cannot move stages", () => A.setJobProductionStage.handler(ctx, { _sessionToken: fieldToken, jobId: job1.id, stage: "punch_list" }));

// Stuck highlight: a second job with no activity for 10 days.
const jobStale = { id: (await A.createJob.handler(ctx, { _sessionToken: ownerToken, clientId: null, clientName: "Stale Client", clientPhone: "", clientEmail: "", jobAddress: "3 Quiet Ct", jobType: "Bathroom", notes: "", jobDate: today, appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "" })).id as number };
const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
await db.update(schema.jobs).set({ createdAt: tenDaysAgo, updatedAt: tenDaysAgo }).where(eq(schema.jobs.id, jobStale.id));
const board1 = await A.getProductionBoard.handler(ctx, { _sessionToken: ownerToken });
const staleCard = board1.jobs.find((j: any) => j.id === jobStale.id);
check("idle 10 days reads stuck", staleCard?.stuck === true && staleCard.idleDays >= 7, JSON.stringify(staleCard));
const freshCard = board1.jobs.find((j: any) => j.id === job1.id);
check("recently touched job is not stuck", freshCard?.stuck === false);

// Completing the job: completedAt syncs + the review recipe queues a task
// (no review URL is configured, so the email path cannot run).
const completed = await A.setJobProductionStage.handler(ctx, { _sessionToken: ownerToken, jobId: job1.id, stage: "complete" });
check("completing queues the review follow-up when email can't run", completed.reviewFollowUp === "queued", completed.reviewFollowUp);
const job1Row = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, job1.id)).limit(1))[0]!;
check("complete stage sets completedAt", job1Row.completedAt !== null && job1Row.productionStage === "complete");
const reviewTasks = await db.select().from(schema.followUps).where(eq(schema.followUps.sourceKey, `review-task:job:${job1.id}`));
check("review task is in the follow-up queue", reviewTasks.length === 1 && reviewTasks[0]!.recipe === "job_review" && reviewTasks[0]!.status === "open");
const reopened = await A.setJobProductionStage.handler(ctx, { _sessionToken: ownerToken, jobId: job1.id, stage: "in_progress" });
check("moving back out of complete clears completedAt", reopened.ok === true && (await db.select().from(schema.jobs).where(eq(schema.jobs.id, job1.id)).limit(1))[0]!.completedAt === null);

// --- 5. Budget vs actual --------------------------------------------------------------
await db.update(schema.jobs).set({ contractSum: "10000.00" }).where(eq(schema.jobs.id, job1.id));
// Signed CO counts toward the contract; the unsigned one must not.
const docBase = { jobId: job1.id, bodyText: "", originalFilename: "", description: "", signerName: "Olivia Owner", signatureBlobKey: "sig/test.png", signedAt: new Date(), createdAt: new Date() };
await db.insert(schema.documents).values({ ...docBase, kind: "change_order", title: "CO signed", amount: "2000.00", clientSignerName: "Board Client", clientSignedAt: new Date() });
await db.insert(schema.documents).values({ ...docBase, kind: "change_order", title: "CO pending", amount: "500.00" });
const budgetInvoice = await db.insert(schema.invoices).values({ companyId, jobId: job1.id, invoiceNumber: "INV-900", clientName: "Board Client", lineItemsJson: "[]", total: "8000.00", issueDate: today, dueDate: "", status: "sent", createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.invoices.id });
await db.insert(schema.payments).values({ companyId, invoiceId: budgetInvoice[0]!.id, amount: "3000.00", paymentDate: today, method: "Card" });
await db.insert(schema.receipts).values({ companyId, jobId: job1.id, vendor: "Depot", amount: "1000.00", purchaseDate: today, blobKey: "receipts/test-1.pdf", filename: "r1.pdf", contentType: "application/pdf" });

const budget = await A.getJobBudget.handler(ctx, { _sessionToken: officeToken, jobId: job1.id });
check("budget contract = sum + signed COs only", budget.budget.contract === "12000.00", budget.budget.contract);
check("budget invoiced/paid", budget.budget.invoiced === "8000.00" && budget.budget.paid === "3000.00", `${budget.budget.invoiced}/${budget.budget.paid}`);
check("budget costs from receipts", budget.budget.costs === "1000.00" && budget.budget.hasCosts === true, budget.budget.costs);
check("margin math", budget.budget.marginPercent === 91.7 && budget.budget.lowMargin === false, String(budget.budget.marginPercent));
const boardBudget = (await A.getProductionBoard.handler(ctx, { _sessionToken: ownerToken })).jobs.find((j: any) => j.id === job1.id);
check("board card carries the budget chip data", boardBudget?.contractSum === "12000.00" && boardBudget?.marginPercent === 91.7);

const emptyBudget = await A.getJobBudget.handler(ctx, { _sessionToken: ownerToken, jobId: jobStale.id });
check("no costs logged -> margin is null, never a fake 100%", emptyBudget.budget.marginPercent === null && emptyBudget.budget.hasCosts === false);
await db.insert(schema.receipts).values({ companyId, jobId: job1.id, vendor: "Depot", amount: "9500.00", purchaseDate: today, blobKey: "receipts/test-2.pdf", filename: "r2.pdf", contentType: "application/pdf" });
const thinBudget = await A.getJobBudget.handler(ctx, { _sessionToken: ownerToken, jobId: job1.id });
check("margin under 15% is flagged", thinBudget.budget.marginPercent === 12.5 && thinBudget.budget.lowMargin === true, String(thinBudget.budget.marginPercent));
await checkThrows("field is denied the budget", () => A.getJobBudget.handler(ctx, { _sessionToken: fieldToken, jobId: job1.id }));

// --- 6. Follow-up queue: manual CRUD ---------------------------------------------------
const manual = await A.saveFollowUp.handler(ctx, { _sessionToken: officeToken, title: "Call the supplier", body: "Confirm the cabinet ETA.", dueDate: today, assigneeUserId: officeMade.id, jobId: job1.id });
const queue1 = await A.getFollowUpQueue.handler(ctx, { _sessionToken: ownerToken, includeDone: false });
const manualItem = queue1.items.find((i: any) => i.id === manual.id);
check("manual follow-up listed with assignee + job label", !!manualItem && manualItem.assigneeName === "Oscar Office" && manualItem.jobLabel === "Kitchen remodel", JSON.stringify(manualItem));
const snoozed = await A.snoozeFollowUp.handler(ctx, { _sessionToken: officeToken, id: manual.id, days: 3 });
check("snooze pushes the due date out", snoozed.dueDate === shift(today, 3), snoozed.dueDate);
const openBefore = (await A.getFollowUpQueue.handler(ctx, { _sessionToken: ownerToken, includeDone: false })).openCount;
await A.completeFollowUp.handler(ctx, { _sessionToken: officeToken, id: manual.id, completed: true });
const queue2 = await A.getFollowUpQueue.handler(ctx, { _sessionToken: ownerToken, includeDone: false });
check("completing removes it from the open queue", queue2.openCount === openBefore - 1 && !queue2.items.some((i: any) => i.id === manual.id));
const queueDone = await A.getFollowUpQueue.handler(ctx, { _sessionToken: ownerToken, includeDone: true });
check("completed items remain visible with includeDone", queueDone.items.some((i: any) => i.id === manual.id && i.status === "done" && i.completedAt !== null));
await checkThrows("field cannot create follow-ups", () => A.saveFollowUp.handler(ctx, { _sessionToken: fieldToken, title: "Nope" }));

// --- 7. Sweep recipes: overdue invoice + stale lead ---------------------------------------
const overdueInvoice = await db.insert(schema.invoices).values({ companyId, jobId: job1.id, invoiceNumber: "INV-LATE", clientName: "Board Client", lineItemsJson: "[]", total: "500.00", issueDate: shift(today, -20), dueDate: shift(today, -5), status: "sent", createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.invoices.id });
const staleLead = await db.insert(schema.leads).values({ companyId, name: "Quiet Lead", phone: "", email: "", address: "", serviceType: "Kitchen", source: "Web", notes: "", estimatedValue: "", stage: "new", createdAt: tenDaysAgo, updatedAt: tenDaysAgo }).returning({ id: schema.leads.id });
const queue3 = await A.getFollowUpQueue.handler(ctx, { _sessionToken: ownerToken, includeDone: false });
const overdueItem = queue3.items.find((i: any) => i.invoiceId === overdueInvoice[0]!.id);
check("overdue invoice sweep queued a task with the balance", !!overdueItem && overdueItem.source === "automation" && overdueItem.recipe === "invoice_overdue" && overdueItem.amount === "500.00", JSON.stringify(overdueItem));
const staleItem = queue3.items.find((i: any) => i.leadId === staleLead[0]!.id);
check("stale lead sweep queued a task", !!staleItem && staleItem.recipe === "lead_stale" && staleItem.leadName === "Quiet Lead", JSON.stringify(staleItem));
const tick = await runOfficeAutomationTick(ctx);
const overdueRows = await db.select().from(schema.followUps).where(eq(schema.followUps.sourceKey, `overdue-invoice:${overdueInvoice[0]!.id}`));
check("sweep is deduped (tick creates no duplicates)", tick.created === 0 && overdueRows.length === 1, `tick=${tick.created} rows=${overdueRows.length}`);

// --- 8. Proposal recipe ---------------------------------------------------------------------
const docFields = {
  jobId: null, clientPhone: "", clientEmail: "", shippingAddress: "", jobType: "Kitchen remodel",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a",
  showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true, showFooterNotes: true, showLogo: true, showCompanyInfo: true,
  customizeJson: "{}",
};
const line = [{ name: "Cabinets", description: "Cabinet install", amount: "4000.00", quantity: 1 }];
const quote1 = await A.saveQuote.handler(ctx, { _sessionToken: ownerToken, ...docFields, clientId: null, clientName: "Board Client", jobAddress: "9 Board Way", lineItems: line, subtotal: "4000.00", total: "4000.00", expiryDate: "", sentAt: "", depositType: "none", depositValue: "0", materials: [] });
await A.sendQuoteVersion.handler(ctx, { _sessionToken: ownerToken, id: quote1.id });
const proposalTasks = await db.select().from(schema.followUps).where(eq(schema.followUps.recipe, "proposal_follow_up"));
check("estimate send queues a 2-day follow-up", proposalTasks.length === 1 && proposalTasks[0]!.dueDate === shift(today, 2), JSON.stringify(proposalTasks.map((t) => t.dueDate)));
const quote2 = await A.saveQuote.handler(ctx, { _sessionToken: ownerToken, ...docFields, clientId: null, clientName: "Board Client", jobAddress: "9 Board Way", lineItems: line, subtotal: "4000.00", total: "4000.00", expiryDate: "", sentAt: today, depositType: "none", depositValue: "0", materials: [] });
const proposalTasks2 = await db.select().from(schema.followUps).where(eq(schema.followUps.recipe, "proposal_follow_up"));
check("quote saved already-sent also queues the follow-up", proposalTasks2.length === 2, String(proposalTasks2.length));
void quote2;

// --- 9. Contract welcome recipe ---------------------------------------------------------------
const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const contract = await A.saveDocument.handler(ctx, { _sessionToken: ownerToken, jobId: job1.id, kind: "contract", title: "Kitchen Contract", bodyText: "Terms...", originalFilename: "", originalDataBase64: "", description: "", amount: "12000.00", signerName: "Olivia Owner", signatureDataBase64: pngBase64, signedAt: new Date().toISOString() });
const link = await A.createDocumentLink.handler(ctx, { _sessionToken: ownerToken, kind: "contract", id: contract.id });
const fakePdf = Buffer.alloc(240, 7).toString("base64");
await A.submitDocumentSignature.handler(ctx, { token: link.token, signerName: "Board Client", signatureDataBase64: pngBase64, signedPdfDataBase64: fakePdf, userAgent: "test", consented: true });
const welcomeTasks = await db.select().from(schema.followUps).where(eq(schema.followUps.sourceKey, `welcome:doc:${contract.id}`));
check("contract signing queues the welcome task", welcomeTasks.length === 1 && welcomeTasks[0]!.recipe === "contract_welcome" && welcomeTasks[0]!.jobId === job1.id);
const automationEvents = await db.select().from(schema.jobEvents).where(eq(schema.jobEvents.jobId, job1.id));
check("automation firings land on the job timeline events", automationEvents.some((e) => e.kind === "automation" && e.title.includes("Welcome")) && automationEvents.some((e) => e.kind === "automation" && e.title.includes("Review")));

// --- 10. Recipe switches -------------------------------------------------------------------------
const settings0 = await A.getAutomationSettings.handler(ctx, { _sessionToken: officeToken });
check("recipes default to on", settings0.recipes.length === 5 && settings0.recipes.every((r: any) => r.enabled === true), JSON.stringify(settings0.recipes.map((r: any) => r.enabled)));
await checkThrows("office cannot change recipe switches", () => A.updateAutomationSettings.handler(ctx, { _sessionToken: officeToken, recipes: { proposal_follow_up: false } }));
await A.updateAutomationSettings.handler(ctx, { _sessionToken: ownerToken, recipes: { proposal_follow_up: false } });
const settings1 = await A.getAutomationSettings.handler(ctx, { _sessionToken: ownerToken });
check("switch persists", settings1.recipes.find((r: any) => r.key === "proposal_follow_up")?.enabled === false && settings1.recipes.filter((r: any) => r.enabled).length === 4);
const quote3 = await A.saveQuote.handler(ctx, { _sessionToken: ownerToken, ...docFields, clientId: null, clientName: "Board Client", jobAddress: "9 Board Way", lineItems: line, subtotal: "4000.00", total: "4000.00", expiryDate: "", sentAt: "", depositType: "none", depositValue: "0", materials: [] });
await A.sendQuoteVersion.handler(ctx, { _sessionToken: ownerToken, id: quote3.id });
const proposalTasks3 = await db.select().from(schema.followUps).where(eq(schema.followUps.recipe, "proposal_follow_up"));
check("disabled recipe creates no follow-up", proposalTasks3.length === 2, String(proposalTasks3.length));

// --- 11. Timelines ----------------------------------------------------------------------------------
const jobTimeline = await A.getJobTimeline.handler(ctx, { _sessionToken: ownerToken, jobId: job1.id });
const kinds = new Set(jobTimeline.events.map((e: any) => e.kind));
check("job timeline aggregates stage/invoice/payment/signed events", kinds.has("stage") && kinds.has("invoice") && kinds.has("payment") && kinds.has("signed") && kinds.has("automation"), [...kinds].join(","));
check("job timeline is newest-first", jobTimeline.events.length > 1 && jobTimeline.events[0].at >= jobTimeline.events[jobTimeline.events.length - 1].at);

const job1FinalRow = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, job1.id)).limit(1))[0]!;
check("createJob linked the client record", job1FinalRow.clientId !== null, String(job1FinalRow.clientId));
const clientTimeline = await A.getClientTimeline.handler(ctx, { _sessionToken: ownerToken, clientId: job1FinalRow.clientId! });
check("client timeline rolls up the client's jobs", clientTimeline.events.some((e: any) => e.kind === "stage") && clientTimeline.events.some((e: any) => e.kind === "job"), `${clientTimeline.events.length} events`);

// --- 12. Access shaping: seeMoney off ------------------------------------------------------------------
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: officeMade.id, overrides: { seeMoney: false } });
const shapedBudget = await A.getJobBudget.handler(ctx, { _sessionToken: officeToken, jobId: job1.id });
check("seeMoney off: budget values never leave the server", shapedBudget.budget.contract === "" && shapedBudget.budget.marginPercent === null && shapedBudget.budget.costs === "", JSON.stringify(shapedBudget.budget));
const shapedBoard = await A.getProductionBoard.handler(ctx, { _sessionToken: officeToken });
const shapedCard = shapedBoard.jobs.find((j: any) => j.id === job1.id);
check("seeMoney off: board card money blanked", shapedCard?.contractSum === "" && shapedCard?.marginPercent === null);
const shapedQueue = await A.getFollowUpQueue.handler(ctx, { _sessionToken: officeToken, includeDone: false });
check("seeMoney off: queue amounts stripped", shapedQueue.items.every((i: any) => i.amount === null));
const shapedTimeline = await A.getJobTimeline.handler(ctx, { _sessionToken: officeToken, jobId: job1.id });
check("seeMoney off: timeline amounts scrubbed", shapedTimeline.events.every((e: any) => !/\$[\d]/.test(e.title) && !/\$[\d]/.test(e.body)), JSON.stringify(shapedTimeline.events.filter((e: any) => /\$[\d]/.test(e.title + e.body)).map((e: any) => e.title)));
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: officeMade.id, overrides: { seeMoney: true } });
const unshapedBudget = await A.getJobBudget.handler(ctx, { _sessionToken: officeToken, jobId: job1.id });
check("seeMoney restored: budget values return", unshapedBudget.budget.contract === "12000.00");

console.log(failures === 0 ? "\nALL WAVE 1 CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
