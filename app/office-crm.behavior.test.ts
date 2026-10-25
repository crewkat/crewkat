// Office CRM (0087) behavior tests.
//
// Covers: migration 0087 (leads.estimated_value + lead_activities table),
// lead estimatedValue round-trip through saveLead/listLeads, updateLead,
// stage moves writing stage activities, the activity timeline round-trip,
// getOfficeDashboard aggregates, getOfficeSearch, convertLeadToJob
// (client keeps the lead's real email + address), and deleteLead removing
// the lead and its activities.
//
// Run from app/:  bun office-crm.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";
import { eq } from "drizzle-orm";

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
check("newest migration tag is 0089_crew_tier2", last.tag === "0089_crew_tier2", last.tag);
check("newest migration idx is 88", last.idx === 88, String(last.idx));

// --- 2. Apply all migrations on a scratch DB ----------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-office-crm-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const tables = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
check("migrations applied: lead_activities table exists", tables.includes("lead_activities"));
const leadCols = (await sqlite.execute("PRAGMA table_info(leads)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: leads.estimated_value exists", leadCols.includes("estimated_value"));
const activityIndexes = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='lead_activities'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
check("migrations applied: lead_activities lead index exists", activityIndexes.includes("lead_activities_lead_idx"), activityIndexes.join(","));

// --- 3. Test context -----------------------------------------------------------
const ctx = {
  slug: "tradesign",
  invocationId: "office-crm-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => { throw new Error("unexpected privileged call"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;

const A = (BaseActions as any);
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

// --- 4. Create leads with estimatedValue --------------------------------------
const leadA = await A.saveLead.handler(ctx, { name: "Zelda Convert", phone: "813-555-0101", source: "google", notes: "Wants a full kitchen", projectSize: "large", engagement: "fast", serviceType: "Kitchen remodel", estimatedValue: "10000" });
const leadB = await A.saveLead.handler(ctx, { name: "Bravo Lead", phone: "813-555-0102", source: "referral", notes: "", projectSize: "medium", engagement: "normal", serviceType: "Bathroom", estimatedValue: "2500" });
const leadC = await A.saveLead.handler(ctx, { name: "Charley Lost", phone: "813-555-0103", source: "", notes: "", projectSize: "small", engagement: "slow", serviceType: "Painting", estimatedValue: "9999" });
check("saveLead returns ids", [leadA, leadB, leadC].every((r) => typeof r.id === "number"));

const listed1 = await A.listLeads.handler(ctx, {});
const rowA = listed1.leads.find((l: any) => l.id === leadA.id);
check("listLeads returns estimatedValue (normalized money)", rowA?.estimatedValue === "10000.00", rowA?.estimatedValue);

// saveLead logs a "Lead created" system activity.
const actsA0 = await A.getLeadActivities.handler(ctx, { leadId: leadA.id });
check("saveLead logs a system 'Lead created' activity", actsA0.activities.some((a: any) => a.kind === "system" && a.body === "Lead created"), JSON.stringify(actsA0.activities));

// --- 5. updateLead edits fields -------------------------------------------------
await A.updateLead.handler(ctx, { id: leadA.id, name: "Zelda Convert", phone: "813-555-0111", email: "zelda@example.com", address: "12 Palm Ave, Tampa, FL", serviceType: "Kitchen remodel", source: "google", notes: "Updated notes", projectSize: "large", engagement: "fast", estimatedValue: "12000" });
const listed2 = await A.listLeads.handler(ctx, {});
const rowA2 = listed2.leads.find((l: any) => l.id === leadA.id);
check("updateLead edits phone/email/address/notes", rowA2?.phone === "813-555-0111" && rowA2?.email === "zelda@example.com" && rowA2?.address === "12 Palm Ave, Tampa, FL" && rowA2?.notes === "Updated notes", JSON.stringify(rowA2));
check("updateLead edits estimatedValue", rowA2?.estimatedValue === "12000.00", rowA2?.estimatedValue);

// --- 6. Stage moves write stage activities --------------------------------------
await A.updateLeadStage.handler(ctx, { id: leadB.id, stage: "quoted" });
const actsB = await A.getLeadActivities.handler(ctx, { leadId: leadB.id });
check("updateLeadStage writes a stage activity", actsB.activities.some((a: any) => a.kind === "stage" && a.body === "Stage: new → quoted"), JSON.stringify(actsB.activities));
const listedB = (await A.listLeads.handler(ctx, {})).leads.find((l: any) => l.id === leadB.id);
check("updateLeadStage moved the stage", listedB?.stage === "quoted", listedB?.stage);

await A.updateLeadStage.handler(ctx, { id: leadC.id, stage: "lost" });

// --- 7. Activity round-trip, newest first ----------------------------------------
const added = await A.addLeadActivity.handler(ctx, { leadId: leadA.id, kind: "call", body: "Called about the start date" });
check("addLeadActivity returns an id", typeof added.id === "number");
const actsA = await A.getLeadActivities.handler(ctx, { leadId: leadA.id });
check("getLeadActivities returns the added activity", actsA.activities.some((a: any) => a.id === added.id && a.kind === "call" && a.body === "Called about the start date"));
check("getLeadActivities is newest-first", actsA.activities[0]?.id === added.id, JSON.stringify(actsA.activities.map((a: any) => a.id)));

// --- 8. Dashboard aggregates -------------------------------------------------------
// Seed one active job, two invoices (one overdue), one payment, one due follow-up.
await db.insert(schema.jobs).values({ clientName: "Seeded Job Client", clientPhone: "", clientEmail: "", jobAddress: "44 Seed Way", jobType: "Kitchen", notes: "", jobDate: today, createdAt: new Date(), updatedAt: new Date() });
const inv1 = await db.insert(schema.invoices).values({ invoiceNumber: "INV-100", clientName: "Seeded Job Client", lineItemsJson: "[]", total: "2000", issueDate: today, dueDate: "2999-01-01", status: "sent", createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.invoices.id });
const inv2 = await db.insert(schema.invoices).values({ invoiceNumber: "INV-101", clientName: "Late Payer", lineItemsJson: "[]", total: "500", issueDate: today, dueDate: yesterday, status: "sent", createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.invoices.id });
await db.insert(schema.payments).values({ invoiceId: inv1[0]!.id, amount: "750", paymentDate: today, createdAt: new Date() });
await db.insert(schema.internalNotes).values({ note: "Call the supplier", reminderDate: today, completed: false, createdAt: new Date(), updatedAt: new Date() });

const dash = await A.getOfficeDashboard.handler(ctx, {});
check("dashboard pipelineValue excludes won/lost", dash.pipelineValue === 14500, String(dash.pipelineValue));
check("dashboard openLeads counts non-won/lost", dash.openLeads === 2, String(dash.openLeads));
check("dashboard leadsByStage counts", dash.leadsByStage.new === 1 && dash.leadsByStage.quoted === 1 && dash.leadsByStage.lost === 1 && dash.leadsByStage.won === 0, JSON.stringify(dash.leadsByStage));
check("dashboard activeJobs counts uncompleted jobs", dash.activeJobs === 1, String(dash.activeJobs));
check("dashboard invoicedMonth sums this month's invoices", dash.invoicedMonth === 2500, String(dash.invoicedMonth));
check("dashboard collectedMonth sums this month's payments", dash.collectedMonth === 750, String(dash.collectedMonth));
check("dashboard outstanding nets payments", dash.outstanding === 1750, String(dash.outstanding));
check("dashboard overdueInvoices lists the overdue invoice", dash.overdueInvoices.length === 1 && dash.overdueInvoices[0].id === inv2[0]!.id && dash.overdueInvoices[0].invoiceNumber === "INV-101", JSON.stringify(dash.overdueInvoices));
check("dashboard followUps lists the due reminder", dash.followUps.some((f: any) => f.note === "Call the supplier" && f.reminderDate === today), JSON.stringify(dash.followUps));
check("dashboard recentActivity includes lead activity with lead name", dash.recentActivity.some((a: any) => a.leadId === leadA.id && a.leadName === "Zelda Convert"), JSON.stringify(dash.recentActivity));

// --- 9. convertLeadToJob ------------------------------------------------------------
const converted = await A.convertLeadToJob.handler(ctx, { id: leadA.id });
check("convertLeadToJob returns clientId + jobId", typeof converted.clientId === "number" && typeof converted.jobId === "number", JSON.stringify(converted));
const clientRow = (await db.select().from(schema.clients).where(eq(schema.clients.id, converted.clientId)))[0];
check("converted client keeps the lead's real email", clientRow?.email === "zelda@example.com", clientRow?.email);
check("converted client keeps the lead's real address", clientRow?.address === "12 Palm Ave, Tampa, FL", clientRow?.address);
const jobRow = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, converted.jobId)))[0];
check("converted job is linked to the client with lead fields", jobRow?.clientId === converted.clientId && jobRow?.clientName === "Zelda Convert" && jobRow?.clientEmail === "zelda@example.com" && jobRow?.jobAddress === "12 Palm Ave, Tampa, FL" && jobRow?.jobType === "Kitchen remodel" && jobRow?.jobDate === today, JSON.stringify(jobRow && { clientId: jobRow.clientId, jobAddress: jobRow.jobAddress, jobType: jobRow.jobType, jobDate: jobRow.jobDate }));
const leadAfter = (await A.listLeads.handler(ctx, {})).leads.find((l: any) => l.id === leadA.id);
check("converted lead is won with clientId set", leadAfter?.stage === "won" && leadAfter?.clientId === converted.clientId, JSON.stringify(leadAfter));
const actsAfter = await A.getLeadActivities.handler(ctx, { leadId: leadA.id });
check("conversion logs a system activity", actsAfter.activities.some((a: any) => a.kind === "system" && a.body === "Converted to client + job"));
await checkThrows("convertLeadToJob refuses a second conversion", () => A.convertLeadToJob.handler(ctx, { id: leadA.id }));

// --- 10. Office search ---------------------------------------------------------------
const search = await A.getOfficeSearch.handler(ctx, { query: "zelda" });
check("search finds the lead", search.leads.some((l: any) => l.id === leadA.id), JSON.stringify(search.leads));
check("search finds the converted client", search.clients.some((c: any) => c.id === converted.clientId), JSON.stringify(search.clients));
check("search finds the converted job", search.jobs.some((j: any) => j.id === converted.jobId), JSON.stringify(search.jobs));
const searchJob = await A.getOfficeSearch.handler(ctx, { query: "SEED WAY" });
check("search matches job address case-insensitively", searchJob.jobs.some((j: any) => j.jobAddress === "44 Seed Way"), JSON.stringify(searchJob.jobs));

// --- 11. deleteLead removes the lead and its activities --------------------------------
await A.deleteLead.handler(ctx, { id: leadB.id });
const listedAfterDelete = await A.listLeads.handler(ctx, {});
check("deleteLead removes the lead", !listedAfterDelete.leads.some((l: any) => l.id === leadB.id));
const orphanActs = await db.select().from(schema.leadActivities).where(eq(schema.leadActivities.leadId, leadB.id));
check("deleteLead removes the lead's activities", orphanActs.length === 0, String(orphanActs.length));

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Office CRM behavior checks passed.");
