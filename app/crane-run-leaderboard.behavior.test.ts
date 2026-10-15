// Crane Run leaderboard behavior tests (2026-10-11 daily; weekly since
// 0077, 2026-10-14, Danny: global top-5 per America/New_York calendar
// week, opt-in default private, company name when the account has one
// else the user's name; a player's weekly score is their best daily row
// that week, and score rows are keyed by ET date).
//
// Covers:
//  1. Migration 0073: daily_game_scores table + indexes, auth_users.
//     leaderboard_opt_in; journal ordering (0077 newest, strictly
//     increasing `when`).
//  2. craneRunSetOptIn: default off, toggles on/off; opting out deletes
//     this week's rows.
//  3. craneRunSubmitScore: refuses when not opted in (nothing stored);
//     stores first score under today's ET date; keeps the max per day;
//     resolves display name (company name first, user name fallback);
//     rejects insane scores.
//  4. craneRunGetLeaderboard: top 5 of this week only, opted-in only,
//     score desc, isMe/myBest/optIn flags.
//
// Run from app/:  bun crane-run-leaderboard.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";
import { addDays, currentWeekStart, etDateString } from "./server/src/craneWeek.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
async function throwsAsync(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch {
    check(name, true);
  }
}

// --- 1. Scratch DB + migrate -------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-crane-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

// --- 2. Journal check ----------------------------------------------------------
const journal = await import("./drizzle/meta/_journal.json");
const entries = journal.entries;
const last = entries[entries.length - 1];
const prev = entries[entries.length - 2];
check("newest migration tag is 0081_client_addresses", last.tag === "0081_client_addresses", last.tag);
check("newest when is strictly newer than previous (drizzle skips older)", last.when > prev.when, `${last.when} vs ${prev.when}`);

// --- 3. Migration 0073 schema ----------------------------------------------------
const tables = (await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map((r) => (r as any).name as string);
check("table exists: daily_game_scores", tables.includes("daily_game_scores"));
const userCols = (await client.execute("PRAGMA table_info(auth_users)")).rows.map((r) => (r as any).name as string);
check("auth_users.leaderboard_opt_in exists", userCols.includes("leaderboard_opt_in"));
const idxs = (await client.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='daily_game_scores'")).rows.map((r) => (r as any).name as string);
check("unique index daily_game_scores_user_date_unique exists", idxs.includes("daily_game_scores_user_date_unique"));
check("index daily_game_scores_date_score_idx exists", idxs.includes("daily_game_scores_date_score_idx"));

// --- 4. Fixtures -------------------------------------------------------------------
const now = new Date();
const today = etDateString(now);
const lastSunday = addDays(currentWeekStart(), -1);

await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Stallions Construction", updatedAt: now });
await db.insert(schema.settings).values({ id: 2, companyId: 2, companyName: "", updatedAt: now });

const mkUser = async (name: string, email: string, companyId: number) => {
  const rows = await db.insert(schema.authUsers).values({ name, email, passwordHash: "x", passwordSalt: "y", companyId, createdAt: now, updatedAt: now }).returning({ id: schema.authUsers.id });
  return rows[0]!.id;
};
const dannyId = await mkUser("Danny Hernandez", "danny@test.com", 1);
const anaId = await mkUser("Ana Torres", "ana@test.com", 2);

const ctxFor = (userId: number, companyId: number) => ({
  db: () => db,
  unscopedDb: () => db,
  workspaceCompanyId: companyId,
  workspaceUserId: userId,
  invalidateQueries: () => {},
}) as any;
const actions = BaseActions as any;
const optInOf = async (id: number) =>
  (await db.select({ v: schema.authUsers.leaderboardOptIn }).from(schema.authUsers).where(eq(schema.authUsers.id, id)).limit(1))[0]!.v;

// --- 5. Opt-in default + toggle ----------------------------------------------------
check("leaderboard_opt_in defaults to false", (await optInOf(dannyId)) === false);
await actions.craneRunSetOptIn.handler(ctxFor(dannyId, 1), { optIn: true });
check("setOptIn(true) flips the flag", (await optInOf(dannyId)) === true);
await actions.craneRunSetOptIn.handler(ctxFor(dannyId, 1), { optIn: false });
check("setOptIn(false) flips the flag back", (await optInOf(dannyId)) === false);

// --- 6. Submit requires opt-in ------------------------------------------------------
await actions.craneRunSetOptIn.handler(ctxFor(dannyId, 1), { optIn: false });
const refused = await actions.craneRunSubmitScore.handler(ctxFor(dannyId, 1), { score: 500 });
check("not opted in: returns ok:false", refused.ok === false && refused.stored === false);
check("not opted in: nothing stored", (await db.select().from(schema.dailyGameScores).where(eq(schema.dailyGameScores.userId, dannyId))).length === 0);

// --- 7. Submit stores, keeps max, resolves company name --------------------------------
await actions.craneRunSetOptIn.handler(ctxFor(dannyId, 1), { optIn: true });
const r1 = await actions.craneRunSubmitScore.handler(ctxFor(dannyId, 1), { score: 500 });
check("opted in: stored", r1.ok === true && r1.stored === true);
let row = (await db.select().from(schema.dailyGameScores).where(and(eq(schema.dailyGameScores.userId, dannyId), eq(schema.dailyGameScores.scoreDate, today))))[0]!;
check("display name prefers company name", row.displayName === "Stallions Construction", row.displayName);
await actions.craneRunSubmitScore.handler(ctxFor(dannyId, 1), { score: 200 });
row = (await db.select().from(schema.dailyGameScores).where(and(eq(schema.dailyGameScores.userId, dannyId), eq(schema.dailyGameScores.scoreDate, today))))[0]!;
check("lower score does not overwrite the best", row.score === 500, String(row.score));
await actions.craneRunSubmitScore.handler(ctxFor(dannyId, 1), { score: 800 });
row = (await db.select().from(schema.dailyGameScores).where(and(eq(schema.dailyGameScores.userId, dannyId), eq(schema.dailyGameScores.scoreDate, today))))[0]!;
check("higher score replaces the best", row.score === 800, String(row.score));

// --- 8. Display name falls back to the user's name --------------------------------------
await actions.craneRunSetOptIn.handler(ctxFor(anaId, 2), { optIn: true });
await actions.craneRunSubmitScore.handler(ctxFor(anaId, 2), { score: 300 });
const anaRow = (await db.select().from(schema.dailyGameScores).where(and(eq(schema.dailyGameScores.userId, anaId), eq(schema.dailyGameScores.scoreDate, today))))[0]!;
check("empty company name falls back to user name", anaRow.displayName === "Ana Torres", anaRow.displayName);

// --- 9. Insane scores rejected -----------------------------------------------------------
await throwsAsync("score > 999999 throws", () => actions.craneRunSubmitScore.handler(ctxFor(dannyId, 1), { score: 1000000 }));
await throwsAsync("negative score throws", () => actions.craneRunSubmitScore.handler(ctxFor(dannyId, 1), { score: -5 }));

// --- 10. Leaderboard: top 5 today, opted-in only -------------------------------------------
const extraIds: number[] = [];
for (let i = 0; i < 6; i++) extraIds.push(await mkUser(`Player ${i}`, `p${i}@test.com`, 1));
for (const [i, id] of extraIds.entries()) {
  await actions.craneRunSetOptIn.handler(ctxFor(id, 1), { optIn: true });
  await actions.craneRunSubmitScore.handler(ctxFor(id, 1), { score: 100 * (i + 1) });
}
// One opted-OUT user with a giant score must not appear.
const ghostId = await mkUser("Ghost", "ghost@test.com", 1);
await db.insert(schema.dailyGameScores).values({ userId: ghostId, displayName: "Ghost", score: 99999, scoreDate: today, createdAt: now });
// One opted-in user whose only row is last week must not appear this week.
const oldId = await mkUser("Old Timer", "old@test.com", 1);
await actions.craneRunSetOptIn.handler(ctxFor(oldId, 1), { optIn: true });
await db.insert(schema.dailyGameScores).values({ userId: oldId, displayName: "Old Timer", score: 77777, scoreDate: lastSunday, createdAt: now });

const board = await actions.craneRunGetLeaderboard.handler(ctxFor(dannyId, 1), {});
check("board returns exactly 5 entries", board.entries.length === 5, String(board.entries.length));
check("board is score-desc", board.entries.every((e: any, i: number, a: any[]) => i === 0 || a[i - 1].score >= e.score));
check("opted-out ghost excluded", !board.entries.some((e: any) => e.displayName === "Ghost"));
check("last week's row excluded", !board.entries.some((e: any) => e.displayName === "Old Timer"));
check("ranks are 1..5", board.entries.map((e: any) => e.rank).join(",") === "1,2,3,4,5");
const dannyEntry = board.entries.find((e: any) => e.isMe);
check("isMe marks the caller's row", !!dannyEntry && dannyEntry.displayName === "Stallions Construction");
check("optIn flag returned true", board.optIn === true);
check("myBest returned", board.myBest === 800, String(board.myBest));
const anaBoard = await actions.craneRunGetLeaderboard.handler(ctxFor(anaId, 2), {});
check("opted-in caller sees optIn true", anaBoard.optIn === true);

// --- 11. Opting out removes today's row ------------------------------------------------------
await actions.craneRunSetOptIn.handler(ctxFor(dannyId, 1), { optIn: false });
const after = await db.select().from(schema.dailyGameScores).where(and(eq(schema.dailyGameScores.userId, dannyId), eq(schema.dailyGameScores.scoreDate, today)));
check("opt-out deletes today's row", after.length === 0);
const board2 = await actions.craneRunGetLeaderboard.handler(ctxFor(dannyId, 1), {});
check("opted-out caller sees optIn false", board2.optIn === false);
check("opted-out caller gone from board", !board2.entries.some((e: any) => e.isMe));

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Crane Run leaderboard checks passed.");
