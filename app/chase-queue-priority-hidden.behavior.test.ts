// Chase queue: priority number hidden (Danny 2026-10-20).
//
// The Estimates chase queue card used to read
//   "6 days waiting · priority 81,120"
// where the number was the ranking score (estimate total × days
// waiting). Danny could not tell what the number meant and asked to
// hide it: the card now shows only "N days waiting". The ranking
// itself is unchanged — the server still computes
// score = total × daysWaiting, still sorts the queue by it
// descending, and the top card still carries the "Text first" badge.
//
// Covers:
//  1. getAutomationCenter still returns each chase entry WITH its
//     score (payload unchanged), score === total × daysWaiting.
//  2. The queue still comes back sorted by score descending, and
//     membership is unchanged (awaiting + sent + waiting > 0 only).
//  3. Source wiring: the chase card block in App.tsx no longer
//     renders the word "priority"/"prioridad" or the score value in
//     either language, while name, total, days waiting, the
//     "Text first" badge and all four actions remain; the server
//     source still computes and sorts by score.
//
// Run from app/:  bun chase-queue-priority-hidden.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { BaseActions } from "./server/src/actions.ts";
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

// --- Harness -------------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-chase-priority-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  db: () => db,
  unscopedDb: () => db,
  blobs: {
    put: async () => {},
    get: async () => null,
    getUrl: async (key: string) => `https://crewkat.com/blobs/${key}`,
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => { throw new Error("unexpected privileged call"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
} as any;
const A = BaseActions as any;
const now = new Date();
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Stallions Construction Company LLC", updatedAt: now });

// today for the payload below is 2026-10-20.
//  - Big:   $13,520 sent 2026-10-14 ->  6 days waiting -> score 81,120
//  - Small:    $580 sent 2026-10-05 -> 15 days waiting -> score  8,700
// Big must outrank Small even though it has waited fewer days.
const seedQuote = async (clientName: string, total: string, sentAt: string, automationStatus: "awaiting" | "won" = "awaiting") =>
  (await db.insert(schema.quotes).values({
    companyId: 1, clientName, clientPhone: "8135550100",
    lineItemsJson: "[]", subtotal: total, total,
    sentAt, automationStatus, expiryDate: "",
    createdAt: now, updatedAt: now,
  }).returning({ id: schema.quotes.id }))[0]!;

const big = await seedQuote("Sean C. Duclos", "13520.00", "2026-10-14");
const small = await seedQuote("Denny", "580.00", "2026-10-05");
const won = await seedQuote("Already Won", "99999.00", "2026-09-01", "won");
const unsent = await seedQuote("Never Sent", "99999.00", "");

// --- 1 + 2. Server payload: score still computed, sorted, membership unchanged ---
const payload = await A.getAutomationCenter.handler(ctx, { today: "2026-10-20" });
const chase: any[] = payload.quoteChase;
check("chase queue contains exactly the two awaiting sent quotes",
  chase.length === 2 && chase.some((q) => q.id === big.id) && chase.some((q) => q.id === small.id),
  JSON.stringify(chase.map((q) => q.id)));
check("won and unsent quotes stay out of the queue",
  !chase.some((q) => q.id === won.id) && !chase.some((q) => q.id === unsent.id));

const bigRow = chase.find((q) => q.id === big.id);
const smallRow = chase.find((q) => q.id === small.id);
check("payload still carries the score field",
  typeof bigRow?.score === "number" && typeof smallRow?.score === "number",
  JSON.stringify({ big: bigRow?.score, small: smallRow?.score }));
check("score is still total × daysWaiting (big)", bigRow?.score === 13520 * 6 && bigRow?.daysWaiting === 6,
  JSON.stringify({ score: bigRow?.score, days: bigRow?.daysWaiting }));
check("score is still total × daysWaiting (small)", smallRow?.score === 580 * 15 && smallRow?.daysWaiting === 15,
  JSON.stringify({ score: smallRow?.score, days: smallRow?.daysWaiting }));
check("queue still sorted by score descending (big first)",
  chase[0]?.id === big.id && chase.every((q, i) => i === 0 || chase[i - 1].score >= q.score),
  JSON.stringify(chase.map((q) => q.score)));

// --- 3. Source wiring -------------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");
const chaseStart = appSrc.indexOf("quoteChase.map");
check("chase card block found in App.tsx", chaseStart > -1);
const chaseBlock = appSrc.slice(chaseStart, chaseStart + 5000);

check("card no longer renders the word priority (EN)", !chaseBlock.includes('"priority"'));
check("card no longer renders the word prioridad (ES)", !chaseBlock.includes('"prioridad"'));
check("card no longer renders the score value", !chaseBlock.includes("score"));
check("card still shows days waiting (both languages)",
  chaseBlock.includes("{q.daysWaiting}") && chaseBlock.includes('"days waiting"') && chaseBlock.includes('"días esperando"'));
check("card still shows client name and total",
  chaseBlock.includes("{q.clientName}") && chaseBlock.includes("qc-amount") && chaseBlock.includes("usd(money(q.total))"));
check("top card still carries the Text first badge (ranking still surfaced)",
  chaseBlock.includes("text-first") && chaseBlock.includes('"Text first"'));
check("card actions unchanged (Open text / Won / Lost / View estimate)",
  chaseBlock.includes('"Open text"') && chaseBlock.includes('"Won"') && chaseBlock.includes('"Lost"') && chaseBlock.includes('"View estimate"') && chaseBlock.includes('"Ver presupuesto"'));
check("server still computes score = total × daysWaiting",
  serverSrc.includes("score: safeMoney(q.total) * days"));
check("server still sorts the queue by score descending",
  serverSrc.includes(".sort((a, b) => b.score - a.score)"));
check("server quoteChase schema still carries the score field",
  serverSrc.includes("daysWaiting:z.number(), score:z.number()"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
