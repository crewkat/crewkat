// Work summaries (0094, SimplySub steals Item 1): the generator behind
// the client-ready "Work summary" a contractor shares from a job.
//
// A summary is a SNAPSHOT: buildWorkSummaryContent reads the job's
// daily-log entries, internal notes and photos inside the requested
// range ONCE, at creation, and the result is stored verbatim on the
// work_summaries row. Later edits to the source logs/photos never
// change what a shared summary link shows.
//
// LOADS INTEGRATION POINT (Item 2, landed with 0095): the content shape
// carries a `loads` section (count / kind / quantity / cost per record,
// plus totals), filled by getJobLoadsInRange below from the job_loads
// table; the stored snapshot shape is unchanged from Item 1.

import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { Ctx } from "@hatch/space-sdk";
import * as schema from "./schema";
import { shiftDateKey, todayKey } from "./wave1";

type Db = ReturnType<Ctx["db"]>;
type JobRow = typeof schema.jobs.$inferSelect;

export type WorkSummaryPreset = "today" | "this_week" | "custom";

export type WorkSummaryLogEntry = {
  logDate: string;
  crew: string;
  hours: string;
  notes: string;
  blockers: string;
  clientSummary: string;
};

export type WorkSummaryNote = {
  note: string;
  at: string; // ISO timestamp
};

export type WorkSummaryPhoto = {
  id: number;
  stage: "before" | "during" | "after";
  caption: string;
  url: string;
  capturedAt: string; // ISO timestamp
};

// One load / dump-run record inside a summary's loads section. Item 2's
// data source produces these (kind e.g. "debris_haul" / "concrete" /
// "dirt" / "delivery" / "other"; quantity + unit like 2 "loads" or
// 12.5 "yards"; cost as a money string, "" when proof-only).
export type WorkSummaryLoad = {
  date: string; // YYYY-MM-DD
  kind: string;
  quantity: string;
  unit: string;
  cost: string;
  vendor: string;
  notes: string;
};

export type WorkSummaryContent = {
  version: 1;
  job: { id: number; jobType: string; clientName: string; jobAddress: string };
  rangeStart: string; // YYYY-MM-DD
  rangeEnd: string; // YYYY-MM-DD
  generatedAt: string; // ISO timestamp
  logs: WorkSummaryLogEntry[];
  notes: WorkSummaryNote[];
  photos: WorkSummaryPhoto[];
  loads: {
    items: WorkSummaryLoad[];
    count: number;
    totalCost: string; // money string, summed from item costs
  };
};

/**
 * ITEM 2 INTEGRATION POINT (landed with 0095): return the job's load /
 * dump-run records whose date falls inside [rangeStart, rangeEnd]
 * (YYYY-MM-DD keys, inclusive), read from the job_loads table. Cost is
 * the load's money string, "" when the load is proof-only (cost NULL) —
 * matching the WorkSummaryLoad contract documented above; the summary
 * builder's moneyTotal treats "" as 0.
 */
export async function getJobLoadsInRange(
  db: Db,
  args: { companyId: number; jobId: number; rangeStart: string; rangeEnd: string },
): Promise<WorkSummaryLoad[]> {
  const rows = await db.select().from(schema.jobLoads)
    .where(and(
      eq(schema.jobLoads.companyId, args.companyId),
      eq(schema.jobLoads.jobId, args.jobId),
      gte(schema.jobLoads.loadDate, args.rangeStart),
      lte(schema.jobLoads.loadDate, args.rangeEnd),
    ))
    .orderBy(asc(schema.jobLoads.loadDate), asc(schema.jobLoads.id));
  return rows.map((row) => ({
    date: row.loadDate,
    kind: row.kind,
    quantity: row.quantity,
    unit: row.unit,
    cost: row.cost ?? "",
    vendor: row.vendor,
    notes: row.notes,
  }));
}

/** Resolve a preset to concrete YYYY-MM-DD range keys (UTC, codebase convention). */
export function resolveWorkSummaryRange(
  preset: WorkSummaryPreset,
  start: string,
  end: string,
  now = new Date(),
): { rangeStart: string; rangeEnd: string } {
  if (preset === "today") {
    const today = todayKey(now);
    return { rangeStart: today, rangeEnd: today };
  }
  if (preset === "this_week") {
    const today = todayKey(now);
    // Monday-start week containing today (UTC date keys).
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
    const sinceMonday = (dow + 6) % 7;
    const rangeStart = shiftDateKey(today, -sinceMonday);
    return { rangeStart, rangeEnd: shiftDateKey(rangeStart, 6) };
  }
  return { rangeStart: start, rangeEnd: end };
}

function moneyTotal(values: string[]): string {
  const sum = values.reduce((acc, v) => acc + (Number(String(v).replace(/[^0-9.-]/g, "")) || 0), 0);
  return sum.toFixed(2);
}

/**
 * Build the frozen content snapshot for one job + range. `getUrl`
 * resolves a photo blob key to its public URL (ctx.blobs.getUrl) so
 * the snapshot references the existing job photo storage — no new
 * file system.
 */
export async function buildWorkSummaryContent(
  db: Db,
  getUrl: (blobKey: string) => Promise<string>,
  job: JobRow,
  rangeStart: string,
  rangeEnd: string,
): Promise<WorkSummaryContent> {
  const [logRows, noteRows, photoRows, loads] = await Promise.all([
    db.select().from(schema.dailyLogs)
      .where(and(eq(schema.dailyLogs.jobId, job.id), gte(schema.dailyLogs.logDate, rangeStart), lte(schema.dailyLogs.logDate, rangeEnd)))
      .orderBy(asc(schema.dailyLogs.logDate), asc(schema.dailyLogs.id)),
    db.select().from(schema.internalNotes)
      .where(eq(schema.internalNotes.jobId, job.id))
      .orderBy(asc(schema.internalNotes.createdAt), asc(schema.internalNotes.id)),
    db.select().from(schema.photos)
      .where(eq(schema.photos.jobId, job.id))
      .orderBy(asc(schema.photos.createdAt), asc(schema.photos.id)),
    getJobLoadsInRange(db, { companyId: job.companyId, jobId: job.id, rangeStart, rangeEnd }),
  ]);

  const notes = noteRows
    .filter((n) => {
      const key = n.createdAt.toISOString().slice(0, 10);
      return key >= rangeStart && key <= rangeEnd;
    })
    .map((n) => ({ note: n.note, at: n.createdAt.toISOString() }));

  const photos: WorkSummaryPhoto[] = [];
  for (const p of photoRows) {
    const at = p.capturedAt ?? p.createdAt;
    const key = at.toISOString().slice(0, 10);
    if (key < rangeStart || key > rangeEnd) continue;
    photos.push({ id: p.id, stage: p.stage, caption: p.caption, url: await getUrl(p.blobKey), capturedAt: at.toISOString() });
  }

  return {
    version: 1,
    job: { id: job.id, jobType: job.jobType, clientName: job.clientName, jobAddress: job.jobAddress },
    rangeStart,
    rangeEnd,
    generatedAt: new Date().toISOString(),
    logs: logRows.map((l) => ({
      logDate: l.logDate,
      crew: l.crew,
      hours: l.hours,
      notes: l.notes,
      blockers: l.blockers,
      clientSummary: l.clientSummary,
    })),
    notes,
    photos,
    loads: {
      items: loads,
      count: loads.length,
      totalCost: moneyTotal(loads.map((l) => l.cost)),
    },
  };
}

/** Parse a stored snapshot back into the content shape (defensive: a
 * corrupt snapshot yields an empty-but-valid shape, never a throw). */
export function parseWorkSummaryContent(json: string): WorkSummaryContent {
  const empty: WorkSummaryContent = {
    version: 1,
    job: { id: 0, jobType: "", clientName: "", jobAddress: "" },
    rangeStart: "",
    rangeEnd: "",
    generatedAt: "",
    logs: [],
    notes: [],
    photos: [],
    loads: { items: [], count: 0, totalCost: "0.00" },
  };
  try {
    const parsed = JSON.parse(json) as Partial<WorkSummaryContent>;
    if (!parsed || typeof parsed !== "object") return empty;
    return {
      ...empty,
      ...parsed,
      job: { ...empty.job, ...(parsed.job ?? {}) },
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      photos: Array.isArray(parsed.photos) ? parsed.photos : [],
      loads: {
        items: Array.isArray(parsed.loads?.items) ? parsed.loads.items : [],
        count: typeof parsed.loads?.count === "number" ? parsed.loads.count : (Array.isArray(parsed.loads?.items) ? parsed.loads.items.length : 0),
        totalCost: typeof parsed.loads?.totalCost === "string" ? parsed.loads.totalCost : "0.00",
      },
    };
  } catch {
    return empty;
  }
}
