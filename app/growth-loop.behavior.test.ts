// Client-link growth loop (Phases 1+2, 2026-10-27): the whisper
// PlatformStrip standardized on every client surface, the /paperwork
// landing page + sample estimate, signup attribution (signup_source,
// migration 0091), the public recordLoopLanding beacon action, and the
// platform-admin Loop stats. PDFs stay clean; the strip has no tier gate.
//
// Run from app/:  bun growth-loop.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions, PUBLIC_ACTIONS } from "./server/src/actions.ts";
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

const SURFACES = ["estimate", "invoice", "contract", "changeorder", "portal", "receipt", "photo"];
const appSrc = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const themeSrc = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");
const serverMjs = readFileSync(join(import.meta.dir, "..", "server.mjs"), "utf8");

// --- 1. Source pins: one shared strip, every surface, no tier gate -------
check("shared PlatformStrip component exists", appSrc.includes("function PlatformStrip"));
check("strip links to the landing page with the surface ref", appSrc.includes("/paperwork?ref=${surface}"));
check("strip ships the signable + view-only labels (EN)", appSrc.includes('"Sign with Crewkat"') && appSrc.includes('"Doc by Crewkat"'));
check("strip ships the signable + view-only labels (ES)", appSrc.includes('"Firma con Crewkat"') && appSrc.includes('"Documento con Crewkat"'));
const stripSlice = appSrc.slice(appSrc.indexOf("function PlatformStrip"), appSrc.indexOf("function PlatformStrip") + 900);
check("strip itself has no tier/premium gate (identical for all tiers)", !/tier|premium/i.test(stripSlice));
check("strip is rendered exactly once per surface (6 render sites)", (appSrc.match(/<PlatformStrip/g) ?? []).length === 6, String((appSrc.match(/<PlatformStrip/g) ?? []).length));
check("document surfaces map kinds to loop surfaces", appSrc.includes('doc.kind === "quote" ? "estimate"') && appSrc.includes('doc.kind === "change_order" ? "changeorder"') && appSrc.includes("surface={docLoopSurface}"));
check("portal foot strip", appSrc.includes('<PlatformStrip lang={lang} surface="portal" />'));
check("receipt strip inside the receipt view", appSrc.includes('<PlatformStrip lang={lang} surface="receipt" />'));
check("photo strip inside the lightbox (on-dark)", appSrc.includes('<PlatformStrip lang={lang} surface="photo" onDark'));
check("strip styles ship muted + hairline", themeSrc.includes(".platform-strip {") && themeSrc.includes(".platform-strip img {"));
check("auth screen captures the ref and replays it on signup", appSrc.includes("captureSignupRef()") && appSrc.includes("signupSource: readSignupRef()"));

// --- 2. Landing page + sample + routes ------------------------------------
const paperwork = readFileSync(join(import.meta.dir, "client/marketing/paperwork.html"), "utf8");
const sample = readFileSync(join(import.meta.dir, "client/marketing/sample-estimate.html"), "utf8");
const sitemap = readFileSync(join(import.meta.dir, "client/marketing/sitemap.xml"), "utf8");
check("landing H1 is the quiet headline", paperwork.includes("<h1 data-i18n=\"h1\">The app behind paperwork like this.</h1>") || paperwork.includes("The app behind paperwork like this."));
check("landing fires the recordLoopLanding beacon", paperwork.includes("recordLoopLanding"));
check("landing whitelist matches the surface contract", SURFACES.every((s) => paperwork.includes(`"${s}"`)));
check("landing rewrites signup CTAs with the ref", paperwork.includes("js-cta") && paperwork.includes("/app?ref="));
check("landing is canonical + in the sitemap", paperwork.includes('href="https://crewkat.com/paperwork"') && sitemap.includes("https://crewkat.com/paperwork"));
check("landing links the sample estimate", paperwork.includes("/paperwork/sample-estimate"));
check("sample estimate is fictional + carries the whisper strip", sample.includes("Sample document — fictional") && sample.includes("/paperwork?ref=estimate") && sample.includes("Doc by Crewkat"));
check("server routes the landing + sample without touching the pinned marketing regex",
  serverMjs.includes('join(MARKETING_DIST, "paperwork.html")') && serverMjs.includes('join(MARKETING_DIST, "sample-estimate.html")') && serverMjs.includes("(pricing|invoicing|estimates|contracts|jobs|clients|marketplace)"));
check("google callback forwards a validated ck_signup_ref cookie", serverMjs.includes('parseCookies(req.headers.cookie)["ck_signup_ref"]') && serverMjs.includes("signupSource: source"));

// --- 3. PDFs stay clean -----------------------------------------------------
const docPdfSrc = readFileSync(join(import.meta.dir, "server/src/docPdf.ts"), "utf8");
check("server PDF builder carries no growth mark", !docPdfSrc.includes("paperwork") && !docPdfSrc.includes("PlatformStrip") && !docPdfSrc.includes("Doc by Crewkat"));

// --- 4. DB + actions ---------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-loop-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  slug: "tradesign",
  invocationId: "growth-loop-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {}, getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0), delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => ({ delivery: "fallback" }),
  emit: () => {},
  invalidateQueries: () => {},
} as any;

const A = BaseActions as any;
check("recordLoopLanding is a public action", PUBLIC_ACTIONS.has("recordLoopLanding"));
check("adminLoopStats action exists", typeof A.adminLoopStats?.handler === "function");

// Signup attribution: with a source, without a source.
await A.signUp.handler(ctx, { name: "Loop Estimate", email: "est@loop.test", password: "loop-pass-123", marketplaceTermsAccepted: true, signupSource: "estimate" });
await A.signUp.handler(ctx, { name: "Loop Invoice", email: "inv@loop.test", password: "loop-pass-123", marketplaceTermsAccepted: true, signupSource: "invoice" });
await A.signUp.handler(ctx, { name: "Loop Organic", email: "org@loop.test", password: "loop-pass-123", marketplaceTermsAccepted: true });
const estUser = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "est@loop.test")))[0];
const orgUser = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "org@loop.test")))[0];
check("signup stores the source surface (migration 0091 column)", estUser?.signupSource === "estimate", String(estUser?.signupSource));
check("organic signup stores null source", orgUser?.signupSource === null, String(orgUser?.signupSource));

// Landing beacon rows.
await A.recordLoopLanding.handler(ctx, { surface: "invoice" });
await A.recordLoopLanding.handler(ctx, { surface: "invoice" });
await A.recordLoopLanding.handler(ctx, { surface: "portal" });
const clickRows = await db.select().from(schema.growthLoopEvents);
check("beacon inserts growth_loop_events rows", clickRows.length === 3, String(clickRows.length));
// Zod validation runs at dispatch; assert the request schema itself
// rejects a surface outside the contract (and accepts a valid one).
let schemaRejects = false;
try { A.recordLoopLanding.request.parse({ surface: "billboard" }); } catch { schemaRejects = true; }
check("beacon request schema rejects an unknown surface", schemaRejects);
let schemaAccepts = true;
try { A.recordLoopLanding.request.parse({ surface: "invoice" }); } catch { schemaAccepts = false; }
check("beacon request schema accepts a contract surface", schemaAccepts);

// Link-open seeds: document links by kind + one portal token.
const jobRows = await db.insert(schema.jobs).values({ companyId: 1, clientName: "Loop Client", jobAddress: "1 Loop Way", jobType: "Remodel", jobDate: "2026-10-27" }).returning({ id: schema.jobs.id });
const jobId = jobRows[0]!.id;
const exp = new Date(Date.now() + 86400000);
await db.insert(schema.documentLinks).values([
  { companyId: 1, documentKind: "quote", documentId: 101, tokenHash: "h-quote", tokenHint: "q", expiresAt: exp, viewCount: 3 },
  { companyId: 1, documentKind: "invoice", documentId: 102, tokenHash: "h-invoice", tokenHint: "i", expiresAt: exp, viewCount: 2 },
  { companyId: 1, documentKind: "change_order", documentId: 103, tokenHash: "h-co", tokenHint: "c", expiresAt: exp, viewCount: 4 },
]);
await db.insert(schema.portalTokens).values({ companyId: 1, jobId, tokenHash: "h-portal", tokenHint: "p", viewCount: 5 });

// Platform admin + a non-admin ctx (pattern from platform-admin suite).
const now = new Date();
await db.insert(schema.authUsers).values({ name: "Loop Admin", email: "admin@loop.test", passwordHash: "x", passwordSalt: "y", isPlatformAdmin: true, tier: "free", createdAt: now });
const admin = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "admin@loop.test")))[0];
const ctxFor = (user: { id: number; companyId: number; tier: string }) => ({
  db: () => db, unscopedDb: () => db, workspaceCompanyId: user.companyId, workspaceUserId: user.id, workspaceTier: user.tier,
  invalidateQueries: () => {}, executePrivileged: async () => ({ delivery: "fallback" }),
}) as any;

const stats = await A.adminLoopStats.handler(ctxFor(admin), {});
check("loop link opens total across doc links + portal", stats.linkOpens.total === 14, JSON.stringify(stats.linkOpens));
const opens = Object.fromEntries(stats.linkOpens.bySurface.map((r: any) => [r.surface, r.opens]));
check("link opens map kinds to surfaces (quote->estimate, change_order->changeorder)", opens.estimate === 3 && opens.invoice === 2 && opens.contract === 0 && opens.changeorder === 4 && opens.portal === 5, JSON.stringify(opens));
check("receipt/photo opens honestly zero (counted under portal)", opens.receipt === 0 && opens.photo === 0);
check("all seven surfaces present in every bySurface array",
  [stats.linkOpens.bySurface, stats.landingClicks.bySurface, stats.signups.bySurface].every((arr: any[]) => arr.length === 7 && SURFACES.every((s, i) => arr[i].surface === s)));
check("landing clicks aggregate by surface", stats.landingClicks.total === 3 && stats.landingClicks.bySurface.find((r: any) => r.surface === "invoice")?.count === 2 && stats.landingClicks.bySurface.find((r: any) => r.surface === "portal")?.count === 1, JSON.stringify(stats.landingClicks));
check("attributed signups aggregate by surface", stats.signups.total === 2 && stats.signups.bySurface.find((r: any) => r.surface === "estimate")?.count === 1 && stats.signups.bySurface.find((r: any) => r.surface === "invoice")?.count === 1, JSON.stringify(stats.signups));
await checkThrows("loop stats are platform-admin gated", () => A.adminLoopStats.handler(ctxFor(orgUser), {}));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
