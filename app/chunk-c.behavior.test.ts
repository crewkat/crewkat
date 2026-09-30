// Chunk C behavior tests.
//
// Covers: migration journal ordering + application, sample-data loading,
// quote->invoice conversion (idempotent, correct numbering, copies line
// items/client/job), the recurring-invoice scheduler tick, daily-log upsert,
// and photo-markup blob + row linkage.
//
// Run from app/:  bun chunk-c.behavior.test.ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import { BaseActions, runRecurringInvoiceTick } from "./server/src/actions.ts";
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
check("newest migration (0045) when is strictly greater than every earlier entry", last.when > maxBefore, `last=${last.when} maxBefore=${maxBefore}`);
check("newest migration tag is 0056_add_analytics_tables", last.tag === "0056_add_analytics_tables", last.tag);

// --- 2. Apply all migrations on a scratch DB --------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-chunkc-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });
const tables = await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'");
const tableNames = (tables.rows as Array<{ name: string }>).map((r) => r.name);
check("migrations applied: recurring_invoice_schedules exists", tableNames.includes("recurring_invoice_schedules"));
const quoteCols = await sqlite.execute("PRAGMA table_info(quotes)");
const quoteColNames = (quoteCols.rows as Array<{ name: string }>).map((r) => r.name);
check("migrations applied: quotes.converted_to_invoice_id exists", quoteColNames.includes("converted_to_invoice_id"));
check("migrations applied: job_daily_logs NOT created (existing daily_logs covers it)", !tableNames.includes("job_daily_logs"));

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
const ctx = {
  slug: "tradesign",
  invocationId: "chunk-c-test",
  spaceDir: dir,
  db: () => db,
  blobs,
  executePrivileged: async () => { throw new Error("privileged unavailable in test"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;

// --- 4. Sample data ----------------------------------------------------------
const sample = await (BaseActions.loadSampleData as any).handler(ctx, {});
check("loadSampleData returns ids", typeof sample.clientId === "number" && typeof sample.jobId === "number" && typeof sample.quoteId === "number");
const clients = await db.select().from(schema.clients);
const jobs = await db.select().from(schema.jobs);
const quotes = await db.select().from(schema.quotes);
check("sample creates exactly one client", clients.length === 1, `got ${clients.length}`);
check("sample creates exactly one job", jobs.length === 1, `got ${jobs.length}`);
check("sample creates exactly one estimate", quotes.length === 1, `got ${quotes.length}`);
check("sample records are [SAMPLE]-prefixed", clients[0]!.name.startsWith("[SAMPLE]") && jobs[0]!.jobType.startsWith("[SAMPLE]"));
await checkThrows("loadSampleData refuses when a job exists", () => (BaseActions.loadSampleData as any).handler(ctx, {}));

// --- 5. Quote -> invoice conversion ------------------------------------------
const converted = await (BaseActions.convertQuoteToInvoice as any).handler(ctx, { quoteId: sample.quoteId });
check("convertQuoteToInvoice returns an invoice id", typeof converted.invoiceId === "number");
const invoice = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, converted.invoiceId)).limit(1))[0]!;
check("converted invoice exists", !!invoice);
check("invoice number is a valid next INV-#### number", /^INV-\d{4}$/.test(invoice.invoiceNumber ?? ""), invoice.invoiceNumber);
check("invoice number is INV-0001 for the first invoice", invoice.invoiceNumber === "INV-0001", invoice.invoiceNumber);
check("conversion copies line items", invoice.lineItemsJson === quotes[0]!.lineItemsJson);
check("conversion copies client + job", invoice.clientName === quotes[0]!.clientName && invoice.jobId === quotes[0]!.jobId && invoice.total === quotes[0]!.total);
const quoteAfter = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, sample.quoteId)).limit(1))[0]!;
check("quote marked converted", quoteAfter.convertedToInvoiceId === invoice.id, String(quoteAfter.convertedToInvoiceId));
const convertedAgain = await (BaseActions.convertQuoteToInvoice as any).handler(ctx, { quoteId: sample.quoteId });
check("conversion is idempotent (same invoice id)", convertedAgain.invoiceId === invoice.id);
const invoiceCount = (await db.select({ id: schema.invoices.id }).from(schema.invoices)).length;
check("idempotent conversion creates no duplicate invoice", invoiceCount === 1, `got ${invoiceCount}`);

// --- 6. Recurring invoice scheduler tick -------------------------------------
const sched = await (BaseActions.createRecurringSchedule as any).handler(ctx, { invoiceId: invoice.id, frequency: "weekly" });
check("createRecurringSchedule returns a schedule id", typeof sched.id === "number");
await checkThrows("duplicate active schedule for same invoice is refused", () =>
  (BaseActions.createRecurringSchedule as any).handler(ctx, { invoiceId: invoice.id, frequency: "monthly" }));
// Backdate next_run_date to yesterday so the tick picks it up.
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
await db.update(schema.recurringInvoiceSchedules).set({ nextRunDate: yesterday }).where(eq(schema.recurringInvoiceSchedules.id, sched.id));
const tick = await runRecurringInvoiceTick(ctx as any);
check("tick ran and generated exactly one invoice", tick.ran && tick.generated.length === 1, JSON.stringify(tick));
const generated = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, tick.generated[0]!)).limit(1))[0]!;
check("generated invoice clones line items + client + job", generated.lineItemsJson === invoice.lineItemsJson && generated.clientName === invoice.clientName && generated.jobId === invoice.jobId);
check("generated invoice gets the next INV number (INV-0002)", generated.invoiceNumber === "INV-0002", generated.invoiceNumber);
check("generated invoice keeps the template issue->due offset", generated.issueDate === yesterday && generated.dueDate === invoice.dueDate, `${generated.issueDate} / ${generated.dueDate}`);
const schedAfter = (await db.select().from(schema.recurringInvoiceSchedules).where(eq(schema.recurringInvoiceSchedules.id, sched.id)).limit(1))[0]!;
const expectedNext = new Date(`${yesterday}T12:00:00`);
expectedNext.setDate(expectedNext.getDate() + 7);
check("schedule next_run_date advanced one week", schedAfter.nextRunDate === expectedNext.toISOString().slice(0, 10), schedAfter.nextRunDate);
check("schedule records last generated invoice id", schedAfter.lastGeneratedInvoiceId === generated.id, String(schedAfter.lastGeneratedInvoiceId));
check("schedule keeps its company id", schedAfter.companyId === 1, String(schedAfter.companyId));
const tick2 = await runRecurringInvoiceTick(ctx as any);
check("tick with nothing due generates nothing", !tick2.ran && tick2.generated.length === 0);
const cancelled = await (BaseActions.cancelRecurringSchedule as any).handler(ctx, { id: sched.id });
check("cancelRecurringSchedule ok", cancelled.ok === true);
const schedCancelled = (await db.select().from(schema.recurringInvoiceSchedules).where(eq(schema.recurringInvoiceSchedules.id, sched.id)).limit(1))[0]!;
check("schedule deactivated", schedCancelled.active === false);

// --- 7. Daily log upsert ------------------------------------------------------
const todayStr = new Date().toISOString().slice(0, 10);
const log1 = await (BaseActions.saveDailyLog as any).handler(ctx, { jobId: sample.jobId, logDate: todayStr, crew: "Danny + 1", hours: "8", photoIds: [], notes: "First note" });
const log2 = await (BaseActions.saveDailyLog as any).handler(ctx, { jobId: sample.jobId, logDate: todayStr, crew: "Danny + 2", hours: "9", photoIds: [], notes: "Updated note" });
check("daily log upsert returns the same id", log1.id === log2.id, `${log1.id} vs ${log2.id}`);
const dayLogs = await db.select().from(schema.dailyLogs).where(and(eq(schema.dailyLogs.jobId, sample.jobId), eq(schema.dailyLogs.logDate, todayStr)));
check("daily log upsert keeps a single row per job+date", dayLogs.length === 1, `got ${dayLogs.length}`);
check("daily log upsert applies the update", dayLogs[0]!.notes === "Updated note" && dayLogs[0]!.crew === "Danny + 2");

// --- 8. Photo markup linkage ----------------------------------------------------
const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const basePhoto = await (BaseActions.addPhoto as any).handler(ctx, {
  jobId: sample.jobId, stage: "during", caption: "Base", filename: "base.png",
  contentType: "image/png", capturedAt: new Date().toISOString(), dataBase64: tinyPngBase64, annotatedFromId: null,
});
const markupPhoto = await (BaseActions.addPhoto as any).handler(ctx, {
  jobId: sample.jobId, stage: "during", caption: "Base — Marked up", filename: "markup-base.png",
  contentType: "image/png", capturedAt: new Date().toISOString(), dataBase64: tinyPngBase64, annotatedFromId: basePhoto.id,
});
const markupRow = (await db.select().from(schema.photos).where(eq(schema.photos.id, markupPhoto.id)).limit(1))[0]!;
check("markup photo row links to the source photo", markupRow.annotatedFromId === basePhoto.id, String(markupRow.annotatedFromId));
const stored = await blobs.get(markupRow.blobKey);
check("markup blob is stored", stored.length > 0, `bytes=${stored.length}`);
const storedHead = await blobs.head(markupRow.blobKey);
check("markup blob has image/png content type", storedHead.contentType === "image/png", storedHead.contentType);

// --- 9. Sample records are normal deletable rows; reload works after delete ----
await db.delete(schema.dailyLogs).where(eq(schema.dailyLogs.jobId, sample.jobId));
await db.delete(schema.photos).where(eq(schema.photos.jobId, sample.jobId));
await db.delete(schema.recurringInvoiceSchedules).where(eq(schema.recurringInvoiceSchedules.invoiceId, invoice.id));
await db.delete(schema.invoices).where(eq(schema.invoices.id, invoice.id));
await db.delete(schema.invoices).where(eq(schema.invoices.id, generated.id));
await db.delete(schema.quotes).where(eq(schema.quotes.id, sample.quoteId));
await db.delete(schema.jobs).where(eq(schema.jobs.id, sample.jobId));
const jobsAfterDelete = await db.select({ id: schema.jobs.id }).from(schema.jobs);
check("sample job deleted via normal row delete", jobsAfterDelete.length === 0);
const reloaded = await (BaseActions.loadSampleData as any).handler(ctx, {});
check("sample data reloads after all jobs deleted", typeof reloaded.jobId === "number" && reloaded.jobId !== sample.jobId);

await sqlite.close();
await rm(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll Chunk C behavior checks passed.");
