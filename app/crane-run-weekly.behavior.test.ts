// Crane Run WEEKLY leaderboard + champion spotlight behavior tests
// (0077, Danny 2026-10-14): the board runs on America/New_York calendar
// weeks (Mon 00:00–Sun 23:59 ET); a player's weekly score is their best
// daily row that week. When a week finishes, its #1 opted-in player is
// snapshotted as champion and gets the next week as a free brand
// spotlight (Crane Run card + Marketplace "Featured Pro" card).
//
// Covers:
//  1. Migration 0077: weekly_game_champions table + unique week index;
//     journal newest tag 0077_crane_run_weekly with `when` > 0076.
//  2. ET week math: Sunday 23:59 ET counts in the old week, Monday
//     00:00 ET starts the new one (EDT and EST), Monday week-start,
//     week date lists, day shifting across month boundaries.
//  3. Weekly window + aggregation: Mon and Sun rows count, last Sunday
//     and next Monday rows don't; weekly score = best day; opting out
//     removes the player from this week's board (all week rows gone).
//  4. Champion: null when last week had no opted-in scores; winner is
//     the highest weekly best among opted-in players (an opted-out 950
//     loses to an opted-in 900; ties go to the earliest achievement);
//     business name = company name, falling back to the user's name;
//     the snapshot is frozen once taken; payload is exposed by both
//     craneRunGetChampion and craneRunGetLeaderboard; the Marketplace
//     card's profile target is the champion's company id (v2 — the card
//     opens their Pro Profile, not a listing).
//
// Run from app/:  bun crane-run-weekly.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq, inArray } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";
import { addDays, currentWeekStart, etDateString, lastWeekStart, weekDates, weekStartOf } from "./server/src/craneWeek.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- 1. ET week math (pure) ---------------------------------------------------
// Oct 2026 is EDT (UTC-4) until Nov 1; Jan 2026 is EST (UTC-5).
check("Sun 23:59:59 EDT is still Sunday ET", etDateString(new Date("2026-10-19T03:59:59.000Z")) === "2026-10-18", etDateString(new Date("2026-10-19T03:59:59.000Z")));
check("Mon 00:00:00 EDT starts Monday ET", etDateString(new Date("2026-10-19T04:00:00.000Z")) === "2026-10-19");
check("Sun 23:59:59 EST is still Sunday ET", etDateString(new Date("2026-01-05T04:59:59.000Z")) === "2026-01-04");
check("Mon 00:00:00 EST starts Monday ET", etDateString(new Date("2026-01-05T05:00:00.000Z")) === "2026-01-05");
check("weekStartOf(Sunday) is the Monday 6 days earlier", weekStartOf("2026-10-18") === "2026-10-12", weekStartOf("2026-10-18"));
check("weekStartOf(Monday) is itself", weekStartOf("2026-10-19") === "2026-10-19");
check("weekStartOf(next Sunday) is that week's Monday", weekStartOf("2026-10-25") === "2026-10-19");
check("weekDates lists Mon..Sun", weekDates("2026-10-19").join(",") === "2026-10-19,2026-10-20,2026-10-21,2026-10-22,2026-10-23,2026-10-24,2026-10-25");
check("addDays crosses a month boundary", addDays("2026-11-01", -1) === "2026-10-31" && addDays("2026-10-31", 1) === "2026-11-01");
check("lastWeekStart is currentWeekStart minus 7", lastWeekStart() === addDays(currentWeekStart(), -7));

// --- 2. Scratch DB + migrate ---------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-crane-weekly-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const journal = await import("./drizzle/meta/_journal.json");
const entries = journal.entries;
const byTag = Object.fromEntries(entries.map((e: any) => [e.tag, e]));
check("newest migration tag is 0090_office_wave1", entries[entries.length - 1].tag === "0090_office_wave1", entries[entries.length - 1].tag);
check("0077 when strictly greater than 0076", byTag["0077_crane_run_weekly"].when > byTag["0076_quote_option_selection"].when);
const tables = (await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map((r) => (r as any).name as string);
check("table exists: weekly_game_champions", tables.includes("weekly_game_champions"));
const champIdx = (await client.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='weekly_game_champions'")).rows.map((r) => (r as any).name as string);
check("unique index weekly_game_champions_week_unique exists", champIdx.includes("weekly_game_champions_week_unique"));

// --- 3. Fixtures ------------------------------------------------------------------
const now = new Date();
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Alpha Builders", updatedAt: now });
await db.insert(schema.settings).values({ id: 2, companyId: 2, companyName: "", updatedAt: now });
const mkUser = async (name: string, email: string, companyId: number) => {
  const rows = await db.insert(schema.authUsers).values({ name, email, passwordHash: "x", passwordSalt: "y", companyId, createdAt: now, updatedAt: now }).returning({ id: schema.authUsers.id });
  return rows[0]!.id;
};
const alphaId = await mkUser("Andy Alpha", "alpha@test.com", 1);
const betaId = await mkUser("Beth Beta", "beta@test.com", 1);
const gammaId = await mkUser("Gamma Lopez", "gamma@test.com", 2);
const deltaId = await mkUser("Dan Delta", "delta@test.com", 1);
const ctxFor = (userId: number, companyId: number) => ({
  db: () => db,
  unscopedDb: () => db,
  workspaceCompanyId: companyId,
  workspaceUserId: userId,
  invalidateQueries: () => {},
}) as any;
const actions = BaseActions as any;
const insertScore = async (userId: number, displayName: string, score: number, scoreDate: string, createdAt: Date) => {
  await db.insert(schema.dailyGameScores).values({ userId, displayName, score, scoreDate, createdAt });
};

const weekStart = currentWeekStart();
const dates = weekDates(weekStart);
const lastWeek = lastWeekStart();
const lastDates = weekDates(lastWeek);

// --- 4. No champion when last week had no opted-in scores ---------------------------
const champEmpty = await actions.craneRunGetChampion.handler(ctxFor(alphaId, 1), {});
check("no scores last week: champion is null", champEmpty.champion === null);
const boardEmpty = await actions.craneRunGetLeaderboard.handler(ctxFor(alphaId, 1), {});
check("leaderboard payload also carries champion null", boardEmpty.champion === null);
check("no champion snapshot rows written", (await db.select().from(schema.weeklyGameChampions)).length === 0);

// --- 5. Weekly window + best-of-week aggregation -------------------------------------
await actions.craneRunSetOptIn.handler(ctxFor(alphaId, 1), { optIn: true });
const submitted = await actions.craneRunSubmitScore.handler(ctxFor(alphaId, 1), { score: 500 });
check("submit stores", submitted.ok === true && submitted.stored === true);
const todayRow = (await db.select().from(schema.dailyGameScores).where(eq(schema.dailyGameScores.userId, alphaId)))[0]!;
check("score row is keyed by ET date", todayRow.scoreDate === etDateString(new Date()), todayRow.scoreDate);
await insertScore(alphaId, "Alpha Builders", 700, dates[0]!, new Date()); // Monday
await insertScore(alphaId, "Alpha Builders", 650, dates[6]!, new Date()); // Sunday
await insertScore(alphaId, "Alpha Builders", 9999, addDays(weekStart, -1), new Date()); // last Sunday — outside
await insertScore(alphaId, "Alpha Builders", 9998, addDays(weekStart, 7), new Date()); // next Monday — outside
await actions.craneRunSetOptIn.handler(ctxFor(betaId, 1), { optIn: true });
await actions.craneRunSubmitScore.handler(ctxFor(betaId, 1), { score: 720 });

const board = await actions.craneRunGetLeaderboard.handler(ctxFor(alphaId, 1), {});
const alphaEntry = board.entries.find((e: any) => e.isMe);
check("weekly score is the best day of the week (Mon 700 beats Sun 650)", alphaEntry?.score === 700, String(alphaEntry?.score));
check("rows outside the week never surface (9999/9998 ignored)", board.entries.every((e: any) => e.score <= 720));
check("board leader is beta's 720", board.entries[0]?.score === 720 && board.entries[0]?.isMe === false, JSON.stringify(board.entries[0]));
check("myBest is the caller's weekly best", board.myBest === 700, String(board.myBest));

// --- 6. Opting out removes the player from this week's board ---------------------------
await actions.craneRunSetOptIn.handler(ctxFor(betaId, 1), { optIn: false });
const betaWeekRows = await db.select().from(schema.dailyGameScores).where(and(eq(schema.dailyGameScores.userId, betaId), inArray(schema.dailyGameScores.scoreDate, dates)));
check("opt-out deletes all of this week's rows", betaWeekRows.length === 0, String(betaWeekRows.length));
const boardAfterOptOut = await actions.craneRunGetLeaderboard.handler(ctxFor(alphaId, 1), {});
check("opted-out player gone from this week's board", !boardAfterOptOut.entries.some((e: any) => e.displayName === "Alpha Builders" && e.score === 720));

// --- 7. Champion snapshot: opted-in only, best score, earliest tie-break ----------------
await db.delete(schema.dailyGameScores);
await db.delete(schema.weeklyGameChampions);
await actions.craneRunSetOptIn.handler(ctxFor(alphaId, 1), { optIn: true });
await actions.craneRunSetOptIn.handler(ctxFor(deltaId, 1), { optIn: true });
await actions.craneRunSetOptIn.handler(ctxFor(gammaId, 2), { optIn: true });
// beta stays opted OUT with the highest raw score — must not win.
await insertScore(betaId, "Alpha Builders", 950, lastDates[2]!, new Date(`${lastDates[2]}T12:00:00.000Z`));
await insertScore(alphaId, "Alpha Builders", 300, lastDates[0]!, new Date(`${lastDates[0]}T12:00:00.000Z`));
await insertScore(alphaId, "Alpha Builders", 900, lastDates[2]!, new Date(`${lastDates[2]}T10:00:00.000Z`)); // best 900, Wed 10:00Z
await insertScore(deltaId, "Alpha Builders", 900, lastDates[4]!, new Date(`${lastDates[4]}T10:00:00.000Z`)); // best 900, Fri — later, loses the tie
await insertScore(gammaId, "Gamma Lopez", 800, lastDates[3]!, new Date(`${lastDates[3]}T12:00:00.000Z`));

const champ = await actions.craneRunGetChampion.handler(ctxFor(gammaId, 2), {});
check("champion exists after a scored week", champ.champion !== null);
check("champion is the opted-in 900 (opted-out 950 excluded)", champ.champion?.score === 900, String(champ.champion?.score));
check("champion business name is the company name", champ.champion?.businessName === "Alpha Builders", champ.champion?.businessName);
check("champion weekStart is last week's Monday", champ.champion?.weekStart === lastWeek, champ.champion?.weekStart);
const snap = (await db.select().from(schema.weeklyGameChampions).where(eq(schema.weeklyGameChampions.weekStart, lastWeek)))[0];
check("snapshot row persisted for last week", !!snap && snap.businessName === "Alpha Builders" && snap.score === 900);
check("tie at 900 goes to the earliest achievement (alpha Wed, not delta Fri)", snap?.userId === alphaId, String(snap?.userId));
const boardWithChamp = await actions.craneRunGetLeaderboard.handler(ctxFor(alphaId, 1), {});
check("leaderboard payload exposes the same champion", boardWithChamp.champion?.businessName === "Alpha Builders" && boardWithChamp.champion?.score === 900);

// Snapshot is frozen: a bigger last-week score arriving later changes nothing.
await insertScore(gammaId, "Gamma Lopez", 5000, lastDates[5]!, new Date(`${lastDates[5]}T12:00:00.000Z`));
const champFrozen = await actions.craneRunGetChampion.handler(ctxFor(gammaId, 2), {});
check("snapshot is frozen once taken", champFrozen.champion?.businessName === "Alpha Builders" && champFrozen.champion?.score === 900);

// --- 8. Champion Marketplace profile target ---------------------------------------------------
check("champion payload carries the champion's company id (Pro Profile target)", champFrozen.champion?.companyId === 1, String(champFrozen.champion?.companyId));
check("champion payload no longer carries a listing link", (champFrozen.champion as any)?.listingId === undefined);
await db.insert(schema.marketplaceListings).values({ companyId: 1, title: "Alpha crane services", category: "equipment", intent: "offer", serviceArea: "Tampa, FL", companyName: "Alpha Builders", moderationStatus: "active", createdAt: now, updatedAt: now });
await db.insert(schema.marketplaceListings).values({ companyId: 1, title: "Removed listing", category: "equipment", intent: "offer", serviceArea: "Tampa, FL", companyName: "Alpha Builders", moderationStatus: "removed", createdAt: new Date(now.getTime() + 60000), updatedAt: now });
const champLinked = await actions.craneRunGetChampion.handler(ctxFor(alphaId, 1), {});
check("profile target stays the company id once listings exist", champLinked.champion?.companyId === 1, String(champLinked.champion?.companyId));

// --- 9. Champion name fallback + profile target -------------------------------------------------
await db.delete(schema.weeklyGameChampions);
await db.delete(schema.dailyGameScores);
await insertScore(gammaId, "Gamma Lopez", 600, lastDates[1]!, new Date(`${lastDates[1]}T12:00:00.000Z`));
const champFallback = await actions.craneRunGetChampion.handler(ctxFor(alphaId, 1), {});
check("empty company name falls back to the user's name", champFallback.champion?.businessName === "Gamma Lopez", champFallback.champion?.businessName);
check("fallback champion's profile target is their own company", champFallback.champion?.companyId === 2, String(champFallback.champion?.companyId));

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Crane Run weekly + champion checks passed.");
