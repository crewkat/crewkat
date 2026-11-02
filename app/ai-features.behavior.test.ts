// AI features (0098, first AI hookup): the Promotions AI writer
// (generateCampaignContent mode "ai") and the work-summary polish
// (polishWorkSummary) share one provider integration, one entitlement
// rule, and one monthly usage counter.
//
// Covers: migration 0098 + journal pins; unconfigured behavior
// (templates byte-identical, summary creation identical, AI actions
// refuse cleanly); the entitlement rule (free refused with the
// upgrade error and NO provider call; Premium owner entitled; Office
// plan state active entitled with a free owner); successful EN + ES
// promo generation through the REAL privileged handlers with fetch
// faked at the provider boundary (wave2 §11 pattern) — the request
// carries the brief + language, the response parses into the composer
// shape; summary polish carries the source draft and returns the
// polished text; usage increments ONLY on success; provider failure
// (500 + network throw) surfaces the one clean error and never the
// provider body; the monthly cap refuses before any provider call;
// the API key appears only in the Authorization header.
//
// Run from app/:  bun ai-features.behavior.test.ts   (script-style suite)
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import { BaseActions, aiMonthKey, composeCampaignContent } from "./server/src/actions.ts";
import { privileged, privilegedHandlers } from "./server/src/privileged.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function checkThrows(name: string, fn: () => Promise<unknown>, ...needles: string[]) {
  try { await fn(); failures++; console.error(`FAIL ${name} — expected an error but none was thrown`); }
  catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    const missing = needles.filter((n) => !message.includes(n));
    if (missing.length === 0) console.log(`ok   ${name}`);
    else { failures++; console.error(`FAIL ${name} — error "${message}" is missing ${JSON.stringify(missing)}`); }
  }
}
const A = BaseActions as any;

// --- 1. Migration journal ---------------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
const last = entries[entries.length - 1]!;
check("newest migration tag is 0098_ai_usage", last.tag === "0098_ai_usage", last.tag);
check("0098 journal idx is 97", last.idx === 97, String(last.idx));
check("0098 when is 1791739000000", last.when === 1791739000000, String(last.when));
check("newest journal when exceeds every earlier entry", last.when > Math.max(...entries.slice(0, -1).map((e) => e.when)), `last=${last.when}`);

// --- 2. Scratch DB ------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-ai-features-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
const tables = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
check("table ai_usage exists", tables.includes("ai_usage"));
const aiCols = (await sqlite.execute("PRAGMA table_info(ai_usage)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
for (const col of ["company_id", "month", "count"]) check(`ai_usage.${col} exists`, aiCols.includes(col));

// --- 3. Seeds -------------------------------------------------------------------
// Company 1: Premium owner (entitled). Company 2: free owner (not
// entitled). Company 3: free owner but Office plan state "active"
// (entitled via the Office branch of the rule). Company 4: Premium
// owner whose usage is seeded at the cap.
const now = new Date();
async function seedUser(id: number, companyId: number, tier: string) {
  await db.insert(schema.authUsers).values({ id, companyId, name: `User ${id}`, email: `user${id}@test.com`, passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: `CODE${id}XYZ`, tier, role: "owner", createdAt: now, updatedAt: now } as any);
}
await seedUser(1, 1, "premium");
await seedUser(2, 2, "free");
await seedUser(3, 3, "free");
await seedUser(4, 4, "premium");
await db.insert(schema.companies).values({ id: 3, officePlanState: "active" } as any);
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "AI Test Co", phone: "(813) 555-0100", website: "https://example.com", serviceArea: "Tampa Bay", reviewUrl: "https://g.page/r/test/review", updatedAt: now });
await db.insert(schema.settings).values({ id: 2, companyId: 2, companyName: "Free Co", updatedAt: now });
await db.insert(schema.settings).values({ id: 3, companyId: 3, companyName: "Office Co", website: "https://office.example.com", updatedAt: now });
await db.insert(schema.settings).values({ id: 4, companyId: 4, companyName: "Capped Co", updatedAt: now });

const jobId = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Summary Sue", clientEmail: "sue@example.com", jobAddress: "12 Oak St", jobType: "Kitchen remodel", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const freeJobId = (await db.insert(schema.jobs).values({ companyId: 2, clientName: "Free Fred", jobAddress: "9 Pine St", jobType: "Painting", jobDate: "2026-10-21", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
await db.insert(schema.dailyLogs).values([
  { companyId: 1, jobId, logDate: "2026-10-26", crew: "Crew A", hours: "8", notes: "Demo day", clientSummary: "We removed the old cabinets." },
  { companyId: 1, jobId, logDate: "2026-10-28", crew: "Crew B", hours: "6", notes: "framing went good today and the crew finished the west wall and cleaned up" },
]);
await db.insert(schema.internalNotes).values([
  { companyId: 1, jobId, note: "Client asked about tile ETA", createdAt: new Date("2026-10-27T15:00:00Z"), updatedAt: new Date("2026-10-27T15:00:00Z") },
]);

// --- 4. Context: real privileged handlers for the AI contracts only ------------
// Dispatch by contract NAME, exactly like wave2 §11: the actions import
// their contracts via the "@space/privileged" alias (a different module
// instance than this file's), so object identity never matches.
const handlerFor = (contract: unknown) => (privilegedHandlers.entries as Array<{ contract: unknown; handler: (args: any) => Promise<any> }>).find((e) => e.contract === contract)!.handler;
const realAiHandlers = new Map<string, (args: any) => Promise<any>>();
for (const name of ["getAiStatus", "aiComplete"] as const) realAiHandlers.set(name, handlerFor((privileged as any)[name]));
check("AI contracts carry dispatch names", [...realAiHandlers.keys()].every((n) => (privileged as any)[n]?.name === n), JSON.stringify([...realAiHandlers.keys()]));

function makeCtx(companyId: number, userId: number) {
  return {
    slug: "tradesign",
    invocationId: "ai-features-test",
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
    executePrivileged: async (fn: unknown, args: Record<string, unknown>) => {
      const handler = realAiHandlers.get((fn as any)?.name ?? "");
      if (handler) return handler(args);
      throw new Error(`unexpected privileged call: ${(fn as any)?.name ?? "?"}`);
    },
    emit: () => {},
    invalidateQueries: () => {},
    workspaceCompanyId: companyId,
    workspaceUserId: userId,
    workspaceTier: "free",
  } as any;
}
const ctx1 = makeCtx(1, 1);
const ctx2 = makeCtx(2, 2);
const ctx3 = makeCtx(3, 3);
const ctx4 = makeCtx(4, 4);

const usageOf = async (companyId: number) => {
  const row = (await db.select().from(schema.aiUsage).where(and(eq(schema.aiUsage.companyId, companyId), eq(schema.aiUsage.month, aiMonthKey()))))[0];
  return row?.count ?? 0;
};

// --- 5. Fake provider transport ---------------------------------------------------
const AI_KEY = "sk-test-ai-key-12345";
type ProviderCall = { url: string; authorization: string | null; body: string };
const providerCalls: ProviderCall[] = [];
let providerMode: "ok" | "http500" | "down" = "ok";
let providerReply = "";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
  providerCalls.push({ url: String(url), authorization: init?.headers?.Authorization ?? null, body: typeof init?.body === "string" ? init.body : "" });
  if (providerMode === "down") throw new Error("socket hangup");
  if (providerMode === "http500") return { ok: false, status: 500, json: async () => ({ error: { message: "PROVIDER_SECRET_BODY do not leak" } }) };
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: providerReply } }] }) };
}) as typeof fetch;

const savedEnv = { key: process.env.AI_API_KEY, model: process.env.AI_MODEL, base: process.env.AI_BASE_URL, cap: process.env.AI_MONTHLY_CAP };
try {
  // --- 6. Unconfigured: everything non-AI is byte-identical --------------------
  delete process.env.AI_API_KEY;
  delete process.env.AI_MONTHLY_CAP;
  const availOff = await A.getAiAvailability.handler(ctx1, {});
  check("unconfigured availability reports configured:false + default cap 200", availOff.configured === false && availOff.monthlyCap === 200, JSON.stringify(availOff));
  const templateViaAction = await A.generateCampaignContent.handler(ctx1, { type: "promotion", prompt: "We now offer financing" });
  const templateDirect = composeCampaignContent({ type: "promotion", prompt: "We now offer financing", companyName: "AI Test Co", phone: "(813) 555-0100", website: "https://example.com", reviewUrl: "https://g.page/r/test/review", serviceArea: "Tampa Bay" });
  check("unconfigured template generation is byte-identical to the composer", JSON.stringify(templateViaAction) === JSON.stringify(templateDirect), JSON.stringify(templateViaAction));
  await checkThrows("unconfigured AI promo refuses cleanly", () => A.generateCampaignContent.handler(ctx1, { type: "promotion", prompt: "10% off kitchens", mode: "ai", lang: "en", audience: "all" }), "isn't set up");
  await checkThrows("unconfigured polish refuses cleanly", () => A.polishWorkSummary.handler(ctx1, { jobId, text: "Some draft text", lang: "en" }), "isn't set up");
  const plainSummary = await A.createWorkSummary.handler(ctx1, { jobId, preset: "custom", rangeStart: "2026-10-26", rangeEnd: "2026-10-30" });
  check("unconfigured summary creation stores no narrative (identical to before)", plainSummary.content.narrative === "" && plainSummary.content.polishedWithAi === false, JSON.stringify({ n: plainSummary.content.narrative, p: plainSummary.content.polishedWithAi }));
  check("unconfigured flow never calls the provider", providerCalls.length === 0, String(providerCalls.length));

  // --- 7. Configured but free: refused before any provider call ------------------
  process.env.AI_API_KEY = AI_KEY;
  const availFree = await A.getAiAvailability.handler(ctx2, {});
  check("free company availability: configured, not entitled", availFree.configured === true && availFree.entitled === false && availFree.usedThisMonth === 0, JSON.stringify(availFree));
  await checkThrows("free company AI promo is refused with the upgrade error", () => A.generateCampaignContent.handler(ctx2, { type: "promotion", prompt: "10% off kitchens", mode: "ai", lang: "en", audience: "all" }), "Premium", "templates still work");
  await checkThrows("free company polish is refused with the upgrade error", () => A.polishWorkSummary.handler(ctx2, { jobId: freeJobId, text: "Draft", lang: "en" }), "Premium");
  const freeTemplate = await A.generateCampaignContent.handler(ctx2, { type: "promotion", prompt: "We now offer financing" });
  check("free company templates still work", typeof freeTemplate.subject === "string" && freeTemplate.subject.length > 0);
  check("free refusals never reach the provider", providerCalls.length === 0, String(providerCalls.length));
  check("free refusals consume no usage", (await usageOf(2)) === 0);

  // --- 8. Entitled (Premium owner): promo EN + ES, polish -------------------------
  const availPro = await A.getAiAvailability.handler(ctx1, {});
  check("premium owner availability: configured + entitled", availPro.configured === true && availPro.entitled === true, JSON.stringify(availPro));

  providerReply = JSON.stringify({ subject: "Save 10% on bathroom remodels in November", headline: "10% off bathroom remodels booked in November", body: "Thinking about a new bathroom?\n\nBook in November and save 10% on your remodel with AI Test Co." });
  const promoEn = await A.generateCampaignContent.handler(ctx1, { type: "promotion", prompt: "10% off bathroom remodels booked in November", mode: "ai", lang: "en", audience: "never_closed" });
  check("AI promo returns the model's subject + body in the composer shape", promoEn.subject === "Save 10% on bathroom remodels in November" && promoEn.bodyText.includes("save 10% on your remodel"), JSON.stringify(promoEn));
  check("AI promo keeps the company's CTA", promoEn.ctaUrl === "https://example.com" && promoEn.ctaLabel === "Claim this offer", JSON.stringify({ label: promoEn.ctaLabel, url: promoEn.ctaUrl }));
  check("promo generation increments usage by 1", (await usageOf(1)) === 1, String(await usageOf(1)));
  const callEn = providerCalls.at(-1)!;
  const bodyEn = JSON.parse(callEn.body) as { model: string; messages: Array<{ role: string; content: string }> };
  check("provider call hits the default OpenAI-compatible endpoint", callEn.url === "https://api.openai.com/v1/chat/completions", callEn.url);
  check("provider call uses the default model", bodyEn.model === "gpt-4o-mini", bodyEn.model);
  check("provider payload carries the brief + audience + company context", bodyEn.messages[1]!.content.includes("10% off bathroom remodels booked in November") && bodyEn.messages[1]!.content.includes("never booked") && bodyEn.messages[1]!.content.includes("AI Test Co"), bodyEn.messages[1]!.content.slice(0, 200));
  check("provider payload carries the no-invention rule", bodyEn.messages[0]!.content.includes("Never invent"), bodyEn.messages[0]!.content.slice(0, 120));

  providerReply = JSON.stringify({ subject: "Ahorra en tu baño este noviembre", headline: "Remodelaciones de baño en noviembre", body: "¿Pensando en un baño nuevo?\n\nReserva en noviembre y ahorra en tu remodelación con AI Test Co." });
  const promoEs = await A.generateCampaignContent.handler(ctx1, { type: "promotion", prompt: "Descuento en remodelaciones de baño reservadas en noviembre", mode: "ai", lang: "es", audience: "all" });
  const callEs = providerCalls.at(-1)!;
  const bodyEs = JSON.parse(callEs.body) as { messages: Array<{ role: string; content: string }> };
  check("ES promo returns Spanish content with a Spanish CTA label", promoEs.subject === "Ahorra en tu baño este noviembre" && promoEs.ctaLabel === "Pedir mi estimado gratis", JSON.stringify({ s: promoEs.subject, cta: promoEs.ctaLabel }));
  check("ES payload asks for Spanish output", bodyEs.messages[0]!.content.includes("español") && bodyEs.messages[1]!.content.includes("Descuento en remodelaciones"), bodyEs.messages[0]!.content.slice(0, 120));
  check("ES generation increments usage", (await usageOf(1)) === 2, String(await usageOf(1)));

  // Draft → polish → create with the polished narrative.
  const preview = await A.previewWorkSummary.handler(ctx1, { jobId, preset: "custom", rangeStart: "2026-10-26", rangeEnd: "2026-10-30" });
  check("preview assembles the draft narrative from logs + notes (client summary preferred)", preview.narrative.includes("We removed the old cabinets.") && preview.narrative.includes("framing went good today") && preview.narrative.includes("Client asked about tile ETA"), preview.narrative);
  providerReply = "We removed the old cabinets.\n\nFraming went well today, and the crew finished the west wall and cleaned up.\n\nThe client asked about the tile ETA.";
  const polished = await A.polishWorkSummary.handler(ctx1, { jobId, text: preview.narrative, lang: "en", rangeStart: "2026-10-26", rangeEnd: "2026-10-30" });
  check("polish returns the provider's polished text", polished.text === providerReply, polished.text);
  const polishCall = providerCalls.at(-1)!;
  const polishBody = JSON.parse(polishCall.body) as { messages: Array<{ role: string; content: string }> };
  check("polish payload carries the source draft", polishBody.messages[1]!.content.includes("framing went good today"), polishBody.messages[1]!.content.slice(0, 200));
  check("polish payload carries the same-facts rule", polishBody.messages[0]!.content.includes("SAME facts"), polishBody.messages[0]!.content.slice(0, 120));
  check("polish increments usage", (await usageOf(1)) === 3, String(await usageOf(1)));
  await checkThrows("polish on another company's job is refused (isolation)", () => A.polishWorkSummary.handler(ctx2, { jobId, text: "Draft", lang: "en" }));
  const createdPolished = await A.createWorkSummary.handler(ctx1, { jobId, preset: "custom", rangeStart: "2026-10-26", rangeEnd: "2026-10-30", narrative: polished.text, polishedWithAi: true });
  check("create stores the final narrative + polishedWithAi flag in the frozen snapshot", createdPolished.content.narrative === providerReply && createdPolished.content.polishedWithAi === true, JSON.stringify({ n: createdPolished.content.narrative.slice(0, 40), p: createdPolished.content.polishedWithAi }));
  const fetched = await A.getWorkSummary.handler(ctx1, { id: createdPolished.summary.id });
  check("stored snapshot round-trips the narrative", fetched.content.narrative === providerReply && fetched.content.polishedWithAi === true);

  // --- 9. Entitled via Office plan state (free owner) ------------------------------
  providerReply = JSON.stringify({ subject: "Office Co news", headline: "A note from Office Co", body: "Hello from Office Co." });
  const promoOffice = await A.generateCampaignContent.handler(ctx3, { type: "promotion", prompt: "A friendly hello to past clients", mode: "ai", lang: "en", audience: "all" });
  check("Office-active company (free owner) is AI-entitled", promoOffice.subject === "Office Co news", JSON.stringify(promoOffice));
  check("Office generation counted on its own company row", (await usageOf(3)) === 1, String(await usageOf(3)));

  // --- 10. Provider failure: clean error, no leak, no usage --------------------------
  providerMode = "http500";
  await checkThrows("provider 500 surfaces the one clean error", () => A.generateCampaignContent.handler(ctx1, { type: "promotion", prompt: "Spring special", mode: "ai", lang: "en", audience: "all" }), "AI is unavailable right now.");
  try { await A.generateCampaignContent.handler(ctx1, { type: "promotion", prompt: "Spring special", mode: "ai", lang: "en", audience: "all" }); } catch (e) {
    check("provider error body never leaks into the client error", !(e instanceof Error ? e.message : "").includes("PROVIDER_SECRET_BODY"), e instanceof Error ? e.message : "");
  }
  providerMode = "down";
  await checkThrows("provider network failure surfaces the same clean error", () => A.polishWorkSummary.handler(ctx1, { jobId, text: "Draft text", lang: "en" }), "AI is unavailable right now.");
  providerMode = "ok";
  check("failed generations consume no usage", (await usageOf(1)) === 3, String(await usageOf(1)));

  // --- 11. Cap: seeded at the cap + env override --------------------------------------
  await db.insert(schema.aiUsage).values({ companyId: 4, month: aiMonthKey(), count: 200, createdAt: now, updatedAt: now });
  const callsBeforeCap = providerCalls.length;
  await checkThrows("company at the cap is refused with the limit error", () => A.generateCampaignContent.handler(ctx4, { type: "promotion", prompt: "Spring special", mode: "ai", lang: "en", audience: "all" }), "monthly AI limit", "200");
  check("cap refusal never calls the provider", providerCalls.length === callsBeforeCap, `${callsBeforeCap} -> ${providerCalls.length}`);
  const availCapped = await A.getAiAvailability.handler(ctx4, {});
  check("capped company availability shows used = cap", availCapped.usedThisMonth === 200 && availCapped.monthlyCap === 200, JSON.stringify(availCapped));
  process.env.AI_MONTHLY_CAP = "1";
  await checkThrows("env cap override applies (company 3 already used 1)", () => A.generateCampaignContent.handler(ctx3, { type: "promotion", prompt: "Another one", mode: "ai", lang: "en", audience: "all" }), "monthly AI limit", "(1 generations)");
  delete process.env.AI_MONTHLY_CAP;

  // --- 12. Key hygiene ------------------------------------------------------------------
  check("every provider call carried the key only in the Authorization header", providerCalls.length > 0 && providerCalls.every((c) => c.authorization === `Bearer ${AI_KEY}` && !c.url.includes(AI_KEY) && !c.body.includes(AI_KEY)), JSON.stringify(providerCalls.map((c) => c.url)));
  check("no action result contains the key", !JSON.stringify(promoEn).includes(AI_KEY) && !JSON.stringify(promoEs).includes(AI_KEY) && !JSON.stringify(availPro).includes(AI_KEY));
} finally {
  globalThis.fetch = realFetch;
  if (savedEnv.key === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = savedEnv.key;
  if (savedEnv.model === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = savedEnv.model;
  if (savedEnv.base === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = savedEnv.base;
  if (savedEnv.cap === undefined) delete process.env.AI_MONTHLY_CAP; else process.env.AI_MONTHLY_CAP = savedEnv.cap;
}

console.log(failures === 0 ? "\nALL AI FEATURES CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
