// Work summaries (0094, SimplySub steals Item 1): stored client-ready
// snapshots of a job's daily logs, notes and photos over a date range,
// shared through the existing document_links token family
// (kind "work_summary").
//
// Covers: migration 0094, create/list/get, preset ranges (today /
// this_week / custom), range filtering of logs+notes+photos, snapshot
// frozen after source edits, the loads section filled from job_loads
// (Item 2, 0095 — in-range loads in, out-of-range loads out), token public read (valid token +
// short code render; revoked / expired / unknown / wrong-kind fail),
// company isolation, the job-timeline event, delete, and the
// permission classification of the new actions.
//
// Run from app/:  bun work-summaries.behavior.test.ts   (script-style suite)
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions, PUBLIC_ACTIONS } from "./server/src/actions.ts";
import { ADMIN_ACTIONS, ALL_ROLE_ACTIONS, minRoleForAction } from "./server/src/permissions.ts";
import { getJobLoadsInRange, resolveWorkSummaryRange } from "./server/src/workSummaries.ts";
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
const A = BaseActions as any;

// --- 1. Migration journal ---------------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
const last = entries[entries.length - 1]!;
check("newest migration tag is 0101_price_book_description_cleanup", last.tag === "0101_price_book_description_cleanup", last.tag);
check("0101 journal idx is 100", last.idx === 100, String(last.idx));
check("0101 when is 1791739300000", last.when === 1791739300000, String(last.when));
check("newest journal when exceeds every earlier entry", last.when > Math.max(...entries.slice(0, -1).map((e) => e.when)), `last=${last.when}`);

// --- 2. Scratch DB ------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-work-summaries-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
const tables = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
check("table work_summaries exists", tables.includes("work_summaries"));
const wsCols = (await sqlite.execute("PRAGMA table_info(work_summaries)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
for (const col of ["job_id", "company_id", "range_start", "range_end", "preset", "content_json", "created_by_user_id", "created_at"]) {
  check(`work_summaries.${col} exists`, wsCols.includes(col));
}

function makeCtx(companyId: number, userId: number) {
  return {
    slug: "tradesign",
    invocationId: "work-summaries-test",
    spaceDir: dir,
    db: () => db,
    unscopedDb: () => db,
    blobs: {
      put: async () => {},
      getUrl: async (key: string) => `blob://test/${key}`,
      get: async () => Buffer.alloc(0),
      delete: async () => {},
      head: async () => ({ contentType: "application/octet-stream", size: 0 }),
    },
    executePrivileged: async () => { throw new Error("no privileged calls expected"); },
    emit: () => {},
    invalidateQueries: () => {},
    workspaceCompanyId: companyId,
    workspaceUserId: userId,
    workspaceTier: "premium",
  } as any;
}
const ctx = makeCtx(1, 1);
const ctx2 = makeCtx(2, 2);

const now = new Date();
await db.insert(schema.authUsers).values({ id: 1, companyId: 1, name: "Danny Owner", email: "owner@test.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH", createdAt: now, updatedAt: now });
await db.insert(schema.authUsers).values({ id: 2, companyId: 2, name: "Other Owner", email: "other@test.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "HGFEDCBA", createdAt: now, updatedAt: now });
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Summary Test Co", phone: "(813) 555-0100", updatedAt: now });
await db.insert(schema.settings).values({ id: 2, companyId: 2, companyName: "Other Co", updatedAt: now });

const jobId = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Summary Sue", clientEmail: "sue@example.com", jobAddress: "12 Oak St", jobType: "Kitchen remodel", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const job2Id = (await db.insert(schema.jobs).values({ companyId: 2, clientName: "Other Ollie", jobAddress: "99 Elsewhere Ave", jobType: "Bathroom remodel", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;

// Source rows around a custom range of 2026-10-26 .. 2026-10-30.
await db.insert(schema.dailyLogs).values([
  { companyId: 1, jobId, logDate: "2026-10-25", crew: "Crew A", hours: "4", notes: "Before range" },
  { companyId: 1, jobId, logDate: "2026-10-26", crew: "Crew A", hours: "8", notes: "Demo day", clientSummary: "We removed the old cabinets." },
  { companyId: 1, jobId, logDate: "2026-10-28", crew: "Crew B", hours: "6", notes: "Framing", blockers: "Waiting on inspection" },
  { companyId: 1, jobId, logDate: "2026-10-31", crew: "Crew A", hours: "3", notes: "After range" },
]);
await db.insert(schema.internalNotes).values([
  { companyId: 1, jobId, note: "Note inside range", createdAt: new Date("2026-10-27T15:00:00Z"), updatedAt: new Date("2026-10-27T15:00:00Z") },
  { companyId: 1, jobId, note: "Note outside range", createdAt: new Date("2026-11-04T15:00:00Z"), updatedAt: new Date("2026-11-04T15:00:00Z") },
]);
await db.insert(schema.photos).values([
  { companyId: 1, jobId, stage: "before", caption: "Before shot", blobKey: "photos/before.jpg", filename: "before.jpg", contentType: "image/jpeg", createdAt: new Date("2026-10-26T14:00:00Z") },
  { companyId: 1, jobId, stage: "during", caption: "Framing shot", blobKey: "photos/during.jpg", filename: "during.jpg", contentType: "image/jpeg", createdAt: new Date("2026-10-29T14:00:00Z") },
  { companyId: 1, jobId, stage: "after", caption: "Outside range shot", blobKey: "photos/late.jpg", filename: "late.jpg", contentType: "image/jpeg", createdAt: new Date("2026-11-02T14:00:00Z") },
]);

// --- 3. Loads integration point (Item 2 landed: job_loads, 0095) ----------------
// One load inside the summary range (costed) and one outside it.
await A.createJobLoad.handler(ctx, { jobId, date: "2026-10-27", kind: "debris_haul", quantity: "2", unit: "loads", cost: "185.50", vendor: "County Dump", notes: "Demo debris", attested: true, photoFilename: "", photoContentType: "", photoDataBase64: "" });
await A.createJobLoad.handler(ctx, { jobId, date: "2026-11-03", kind: "dirt", quantity: "6", unit: "yards", cost: "90", vendor: "Dirt Works", notes: "Outside range", attested: false, photoFilename: "", photoContentType: "", photoDataBase64: "" });
const loadsNow = await getJobLoadsInRange(db as any, { companyId: 1, jobId, rangeStart: "2026-10-26", rangeEnd: "2026-10-30" });
check("getJobLoadsInRange returns the in-range loads", loadsNow.length === 1 && loadsNow[0]!.kind === "debris_haul" && loadsNow[0]!.cost === "185.50", JSON.stringify(loadsNow));
const loadsWide = await getJobLoadsInRange(db as any, { companyId: 1, jobId, rangeStart: "2026-10-26", rangeEnd: "2026-11-05" });
check("getJobLoadsInRange excludes out-of-range loads only", loadsWide.length === 2, JSON.stringify(loadsWide.map((l: any) => l.date)));

// --- 4. Create (custom range): filtering + snapshot shape ----------------------
const created = await A.createWorkSummary.handler(ctx, { jobId, preset: "custom", rangeStart: "2026-10-26", rangeEnd: "2026-10-30" });
const summary = created.summary;
const content = created.content;
check("create returns the stored summary", summary.jobId === jobId && summary.rangeStart === "2026-10-26" && summary.rangeEnd === "2026-10-30" && summary.preset === "custom", JSON.stringify(summary));
check("content carries the job snapshot", content.job.jobType === "Kitchen remodel" && content.job.clientName === "Summary Sue" && content.job.jobAddress === "12 Oak St");
check("logs filtered to the range", content.logs.length === 2 && content.logs[0].logDate === "2026-10-26" && content.logs[1].logDate === "2026-10-28", JSON.stringify(content.logs.map((l: any) => l.logDate)));
check("log entries carry crew/hours/notes/blockers/clientSummary", content.logs[0].crew === "Crew A" && content.logs[0].clientSummary === "We removed the old cabinets." && content.logs[1].blockers === "Waiting on inspection");
check("notes filtered to the range", content.notes.length === 1 && content.notes[0].note === "Note inside range", JSON.stringify(content.notes));
check("photos filtered to the range with storage URLs", content.photos.length === 2 && content.photos[0].url === "blob://test/photos/before.jpg" && content.photos[1].stage === "during", JSON.stringify(content.photos));
check("loads section carries the in-range load", content.loads.count === 1 && content.loads.items.length === 1 && content.loads.items[0]!.kind === "debris_haul" && content.loads.items[0]!.quantity === "2" && content.loads.totalCost === "185.50", JSON.stringify(content.loads));
check("summary counts come from the snapshot", summary.logCount === 2 && summary.photoCount === 2 && summary.loadCount === 1);
check("new summary has no link yet", summary.link === null);
const storedRow = (await db.select().from(schema.workSummaries).where(eq(schema.workSummaries.id, summary.id)))[0]!;
check("snapshot persisted on the row", storedRow.contentJson.includes("Demo day") && storedRow.createdByUserId === 1 && storedRow.companyId === 1);

// --- 5. Snapshot frozen after source edits --------------------------------------
await db.update(schema.dailyLogs).set({ notes: "EDITED AFTER THE FACT" }).where(eq(schema.dailyLogs.logDate, "2026-10-26"));
await db.delete(schema.photos).where(eq(schema.photos.blobKey, "photos/during.jpg"));
const fetched = await A.getWorkSummary.handler(ctx, { id: summary.id });
check("snapshot frozen: log edit does not leak in", fetched.content.logs[0].notes === "Demo day", fetched.content.logs[0].notes);
check("snapshot frozen: photo delete does not leak in", fetched.content.photos.length === 2);
check("get returns the same counts", fetched.summary.logCount === 2 && fetched.summary.photoCount === 2);

// --- 6. List ---------------------------------------------------------------------
const list = await A.listWorkSummaries.handler(ctx, { jobId });
check("list returns the job's summaries", list.summaries.length === 1 && list.summaries[0].id === summary.id);
const listEmpty = await A.listWorkSummaries.handler(ctx2, { jobId: job2Id });
check("other company's job lists empty", listEmpty.summaries.length === 0);

// --- 7. Presets --------------------------------------------------------------------
const todayKey = new Date().toISOString().slice(0, 10);
await db.insert(schema.dailyLogs).values({ companyId: 1, jobId, logDate: todayKey, crew: "Crew A", hours: "2", notes: "Today work" });
const todaySummary = await A.createWorkSummary.handler(ctx, { jobId, preset: "today", rangeStart: "", rangeEnd: "" });
check("today preset resolves to today only", todaySummary.summary.rangeStart === todayKey && todaySummary.summary.rangeEnd === todayKey, JSON.stringify(todaySummary.summary));
check("today preset includes only today's log", todaySummary.content.logs.length === 1 && todaySummary.content.logs[0].notes === "Today work");

const week = resolveWorkSummaryRange("this_week", "", "", now);
check("this_week resolves Monday..Sunday containing today", week.rangeStart <= todayKey && todayKey <= week.rangeEnd && (new Date(`${week.rangeStart}T12:00:00Z`).getUTCDay() === 1), JSON.stringify(week));
const prevSunday = new Date(new Date(`${week.rangeStart}T12:00:00Z`).getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
await db.insert(schema.dailyLogs).values([
  { companyId: 1, jobId, logDate: week.rangeStart, crew: "Crew A", hours: "5", notes: "Monday work" },
  { companyId: 1, jobId, logDate: prevSunday, crew: "Crew A", hours: "5", notes: "Last week work" },
]);
const weekSummary = await A.createWorkSummary.handler(ctx, { jobId, preset: "this_week", rangeStart: "", rangeEnd: "" });
const weekNotes = weekSummary.content.logs.map((l: any) => l.notes);
check("this_week includes the Monday log", weekNotes.includes("Monday work"), JSON.stringify(weekNotes));
check("this_week excludes last week's log", !weekNotes.includes("Last week work"), JSON.stringify(weekNotes));

await checkThrows("custom range without dates is rejected", () => A.createWorkSummary.handler(ctx, { jobId, preset: "custom", rangeStart: "", rangeEnd: "" }));
await checkThrows("reversed custom range is rejected", () => A.createWorkSummary.handler(ctx, { jobId, preset: "custom", rangeStart: "2026-10-30", rangeEnd: "2026-10-26" }));

// --- 8. Company isolation ------------------------------------------------------------
await checkThrows("other company cannot list this job's summaries", () => A.listWorkSummaries.handler(ctx2, { jobId }));
await checkThrows("other company cannot create on this job", () => A.createWorkSummary.handler(ctx2, { jobId, preset: "today", rangeStart: "", rangeEnd: "" }));
await checkThrows("other company cannot get this summary", () => A.getWorkSummary.handler(ctx2, { id: summary.id }));
await checkThrows("other company cannot delete this summary", () => A.deleteWorkSummary.handler(ctx2, { id: summary.id }));

// --- 9. Sharing through document_links --------------------------------------------------
const link = await A.createDocumentLink.handler(ctx, { kind: "work_summary", id: summary.id });
check("createDocumentLink mints a work_summary link", typeof link.token === "string" && link.token.length >= 32 && typeof link.shortCode === "string" && link.shortCode.length >= 8, JSON.stringify({ hint: link.hint }));
const listWithLink = await A.listWorkSummaries.handler(ctx, { jobId });
const linkedSummary = listWithLink.summaries.find((s: any) => s.id === summary.id);
check("list surfaces the active link state", !!linkedSummary?.link && linkedSummary.link.shortCode === link.shortCode && linkedSummary.link.viewCount === 0, JSON.stringify(linkedSummary?.link));

const pub = await A.resolveWorkSummaryLink.handler(ctx, { token: link.token, userAgent: "test-agent" });
check("public read renders the snapshot", pub.summaryId === summary.id && pub.content.logs.length === 2 && pub.content.logs[0].notes === "Demo day", JSON.stringify(pub.content?.logs?.length));
check("public read carries the company chrome", pub.company.name === "Summary Test Co" && pub.company.phone === "(813) 555-0100", JSON.stringify(pub.company));
check("public read carries the loads section", pub.content.loads.count === 1 && pub.content.loads.items[0]!.kind === "debris_haul" && pub.content.loads.totalCost === "185.50", JSON.stringify(pub.content.loads));
const info = await A.getDocumentLinkInfo.handler(ctx, { kind: "work_summary", id: summary.id });
check("view counted on the link", info.link?.viewCount === 1 && !!info.link?.firstViewedAt, JSON.stringify(info.link));
const pubByCode = await A.resolveWorkSummaryLink.handler(ctx, { token: link.shortCode, userAgent: "test-agent" });
check("short code resolves the same summary", pubByCode.summaryId === summary.id);
const viewEvents = await db.select().from(schema.documentLinkEvents).where(eq(schema.documentLinkEvents.eventType, "view"));
check("view events recorded like document links", viewEvents.length === 2, String(viewEvents.length));

await checkThrows("unknown token fails", () => A.resolveWorkSummaryLink.handler(ctx, { token: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", userAgent: "" }));
const docLink = await A.createDocumentLink.handler(ctx, { kind: "quote", id: 999999 }).catch(() => null);
check("quote link for a missing quote is refused (setup sanity)", docLink === null);
// A document link of another kind must not resolve as a summary.
const [anyQuote] = await db.insert(schema.quotes).values({ companyId: 1, clientName: "Q", lineItemsJson: "[]", total: "10.00" }).returning({ id: schema.quotes.id });
const quoteLink = await A.createDocumentLink.handler(ctx, { kind: "quote", id: anyQuote!.id });
await checkThrows("a quote link token does not resolve as a summary", () => A.resolveWorkSummaryLink.handler(ctx, { token: quoteLink.token, userAgent: "" }));

await A.revokeDocumentLink.handler(ctx, { kind: "work_summary", id: summary.id });
await checkThrows("revoked token fails", () => A.resolveWorkSummaryLink.handler(ctx, { token: link.token, userAgent: "" }));
const listAfterRevoke = await A.listWorkSummaries.handler(ctx, { jobId });
check("revoked summary shows no active link", listAfterRevoke.summaries.find((s: any) => s.id === summary.id)?.link === null);

const link2 = await A.createDocumentLink.handler(ctx, { kind: "work_summary", id: summary.id });
await db.update(schema.documentLinks).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.documentLinks.shortCode, link2.shortCode));
await checkThrows("expired token fails", () => A.resolveWorkSummaryLink.handler(ctx, { token: link2.token, userAgent: "" }));

// --- 10. Timeline event ------------------------------------------------------------------
const events = await db.select().from(schema.jobEvents).where(eq(schema.jobEvents.jobId, jobId));
const summaryEvents = events.filter((e) => e.title === "Work summary created");
check("job_events row written for summary creation", summaryEvents.length >= 3 && summaryEvents[0]!.kind === "note", JSON.stringify(summaryEvents.map((e) => e.kind)));
const timeline = await A.getJobTimeline.handler(ctx, { jobId });
check("unified timeline surfaces the summary creation", timeline.events.some((e: any) => e.title === "Work summary created"), JSON.stringify(timeline.events.map((e: any) => e.title).slice(0, 8)));

// --- 11. Delete -----------------------------------------------------------------------------
const delTarget = await A.createWorkSummary.handler(ctx, { jobId, preset: "custom", rangeStart: "2026-10-26", rangeEnd: "2026-10-27" });
const delLink = await A.createDocumentLink.handler(ctx, { kind: "work_summary", id: delTarget.summary.id });
await A.deleteWorkSummary.handler(ctx, { id: delTarget.summary.id });
check("delete removes the summary row", (await db.select().from(schema.workSummaries).where(eq(schema.workSummaries.id, delTarget.summary.id))).length === 0);
await checkThrows("deleted summary's link no longer resolves", () => A.resolveWorkSummaryLink.handler(ctx, { token: delLink.token, userAgent: "" }));
await checkThrows("deleted summary cannot be fetched", () => A.getWorkSummary.handler(ctx, { id: delTarget.summary.id }));

// --- 12. Permission classification -------------------------------------------------------------
check("resolveWorkSummaryLink is public (token is the credential)", PUBLIC_ACTIONS.has("resolveWorkSummaryLink"));
check("create/list/get are all-role actions", ["createWorkSummary", "listWorkSummaries", "getWorkSummary"].every((n) => ALL_ROLE_ACTIONS.has(n) && minRoleForAction(n) === "field"));
check("deleteWorkSummary is admin-only", ADMIN_ACTIONS.has("deleteWorkSummary") && minRoleForAction("deleteWorkSummary") === "admin");

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
