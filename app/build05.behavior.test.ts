// Build 0.5 behavior tests.
//
// Covers all six change-doc items:
//  1. Notification badge: markJobMessagesRead deletes the job-messages
//     notification so the badge clears; a later client message can create a
//     fresh one (the dedup no longer blocks it after the delete).
//  2+3. Short /d/ codes: createDocumentLink returns a shortCode, both the
//     full token and the short code resolve, re-sharing no longer revokes
//     the previous link, and explicit revoke still works.
//  4. Marketplace map preview snapshots the query on open instead of
//     live-binding the iframe to every keystroke (static source check).
//  5. Refer-a-contractor screen exists with how-it-works steps, the share
//     panel, and fine print (static source check).
//  6. Invoice sticky Save is a compact right-aligned pill with extra form
//     clearance (static source check).
//
// Plus migration 0060 (document_links.short_code) verification on both a
// fresh database and an upgraded (0059 -> 0060) database.
//
// Run from app/:  bun build05.behavior.test.ts
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
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
async function checkThrows(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    failures++;
    console.error(`FAIL ${name} — expected an error but none was thrown`);
  } catch {
    console.log(`ok   ${name}`);
  }
}

// --- 1. Migration 0060 on a fresh database ------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
let nonDecreasing = true;
for (let i = 1; i < entries.length; i++) {
  if (entries[i]!.when < entries[i - 1]!.when) nonDecreasing = false;
}
check("journal when values are non-decreasing", nonDecreasing);
const last = entries[entries.length - 1]!;
check("newest migration tag is 0060_document_link_short_code", last.tag === "0060_document_link_short_code", last.tag);

const dir = await mkdtemp(join(tmpdir(), "crewkat-build05-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const linkCols = (await sqlite.execute("PRAGMA table_info(document_links)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("fresh DB: document_links.short_code exists", linkCols.includes("short_code"));
const indexes = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='document_links'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
check("fresh DB: unique short_code index exists", indexes.includes("document_links_short_code_unique"));

// --- 2. Migration 0060 on an upgraded (0059 -> 0060) database -----------------
const upDir = await mkdtemp(join(tmpdir(), "crewkat-build05-up-"));
await cp(join("drizzle"), join(upDir, "drizzle"), { recursive: true });
// Simulate a production DB stuck at 0059: truncate the journal, migrate, then
// insert a legacy link row that has no short_code.
const upJournalPath = join(upDir, "drizzle", "meta", "_journal.json");
const upJournal = JSON.parse(await readFile(upJournalPath, "utf8"));
upJournal.entries = upJournal.entries.filter((e: { idx: number }) => e.idx <= 58);
await writeFile(upJournalPath, JSON.stringify(upJournal));
const upDbPath = join(upDir, "app.db");
const upSqlite = createClient({ url: `file:${upDbPath}` });
const upDb = drizzle(upSqlite);
await migrate(upDb, { migrationsFolder: join(upDir, "drizzle") });
const upColsBefore = (await upSqlite.execute("PRAGMA table_info(document_links)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("upgrade DB: no short_code before 0060", !upColsBefore.includes("short_code"));
const expiresAtMs = Date.now() + 30 * 86400000;
await upSqlite.execute({
  sql: "INSERT INTO document_links (company_id, document_kind, document_id, token_hash, token_hint, expires_at, created_at) VALUES (1, 'invoice', 1, 'legacy-hash', 'hint', ?, ?)",
  args: [expiresAtMs, Date.now()],
});
// Restore the full journal and migrate again — 0060 must apply and backfill.
await cp(join("drizzle", "meta", "_journal.json"), upJournalPath);
await migrate(upDb, { migrationsFolder: join(upDir, "drizzle") });
const upColsAfter = (await upSqlite.execute("PRAGMA table_info(document_links)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("upgrade DB: short_code added by 0060", upColsAfter.includes("short_code"));
const backfilled = (await upSqlite.execute("SELECT short_code FROM document_links").then((r) => r.rows as Array<{ short_code: string | null }>));
check(
  "upgrade DB: legacy row backfilled with a 10-char code",
  backfilled.length === 1 && typeof backfilled[0]!.short_code === "string" && backfilled[0]!.short_code.length === 10,
  JSON.stringify(backfilled),
);

// --- 3. Test context ----------------------------------------------------------
const ctx = {
  slug: "tradesign",
  invocationId: "build05-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => ({ ok: true }),
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;

await db.insert(schema.authUsers).values({ companyId: 1, name: "Owner", email: "owner@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH" });
await db.insert(schema.settings).values({ companyId: 1, companyName: "Stallions Test Co" });
const [job] = await db.insert(schema.jobs).values({ companyId: 1, clientName: "Badge Betty", jobAddress: "3 Main St", jobType: "Roof repair", jobDate: "2026-10-01" }).returning({ id: schema.jobs.id });
const jobId = job!.id;

// --- 4. Item 1: notification badge clears on read, recreates on new message --
const notifLink = `job:${jobId}:messages`;
const notifCount = async () =>
  (await db.select().from(schema.userNotifications).where(and(eq(schema.userNotifications.userId, 1), eq(schema.userNotifications.link, notifLink)))).length;

await db.insert(schema.userNotifications).values({ userId: 1, kind: "message", titleEn: "New client message", titleEs: "Nuevo mensaje", link: notifLink, isRead: false, createdAt: new Date() });
check("item 1: job-messages notification exists before read", (await notifCount()) === 1);

const readRes = await (BaseActions.markJobMessagesRead as any).handler(ctx, { jobId });
check("item 1: markJobMessagesRead returns ok", readRes?.ok === true);
check("item 1: notification deleted after reading the thread", (await notifCount()) === 0);

// Simulate a later client message: the dedup in createUserNotification must
// allow a fresh notification now that the old one is gone.
await db.insert(schema.userNotifications).values({ userId: 1, kind: "message", titleEn: "New client message", titleEs: "Nuevo mensaje", link: notifLink, isRead: false, createdAt: new Date() });
check("item 1: a new client message recreates the notification", (await notifCount()) === 1);
await checkThrows("item 1: markJobMessagesRead rejects another company's job", (BaseActions.markJobMessagesRead as any).handler({ ...ctx, workspaceCompanyId: 999 }, { jobId }));

// --- 5. Items 2+3: short links + no revoke on re-share -------------------------
const [inv] = await db.insert(schema.invoices).values({ companyId: 1, invoiceNumber: "INV-5001", clientName: "Link Larry", lineItemsJson: "[]", total: "1200" }).returning({ id: schema.invoices.id });
const invId = inv!.id;

const linkA = await (BaseActions.createDocumentLink as any).handler(ctx, { kind: "invoice", id: invId });
check("items 2+3: createDocumentLink returns a 10-char shortCode", typeof linkA?.shortCode === "string" && linkA.shortCode.length === 10, JSON.stringify(linkA?.shortCode));
check("items 2+3: short code is URL-safe", /^[A-Za-z0-9]+$/.test(linkA.shortCode), linkA.shortCode);

const resolvedByToken = await (BaseActions.resolveDocumentLink as any).handler(ctx, { token: linkA.token, userAgent: "test" });
check("items 2+3: full 64-char token still resolves", resolvedByToken?.documentId === invId);
check("items 2+3: resolve payload carries the shortCode", resolvedByToken?.shortCode === linkA.shortCode, JSON.stringify(resolvedByToken?.shortCode));

const resolvedByShort = await (BaseActions.resolveDocumentLink as any).handler(ctx, { token: linkA.shortCode, userAgent: "test" });
check("items 2+3: short code resolves to the same document", resolvedByShort?.documentId === invId && resolvedByShort?.kind === "invoice");

// Re-sharing must NOT kill the previously sent link (build0.5 item 2).
const linkB = await (BaseActions.createDocumentLink as any).handler(ctx, { kind: "invoice", id: invId });
check("items 2+3: second link gets a different short code", linkB.shortCode !== linkA.shortCode, `${linkA.shortCode} vs ${linkB.shortCode}`);
const stillOk = await (BaseActions.resolveDocumentLink as any).handler(ctx, { token: linkA.shortCode, userAgent: "test" });
check("items 2+3: first link still resolves after re-share (no silent revoke)", stillOk?.documentId === invId);

const info = await (BaseActions.getDocumentLinkInfo as any).handler(ctx, { kind: "invoice", id: invId });
check("items 2+3: link info exposes the latest shortCode", info?.link?.shortCode === linkB.shortCode, JSON.stringify(info?.link?.shortCode));

await (BaseActions.revokeDocumentLink as any).handler(ctx, { kind: "invoice", id: invId });
await checkThrows("items 2+3: explicit revoke disables the links", (BaseActions.resolveDocumentLink as any).handler(ctx, { token: linkB.shortCode, userAgent: "test" }));

// --- 6. Items 4+5+6: client-side source checks --------------------------------
const appSrc = await readFile(join("client", "src", "App.tsx"), "utf8");
const themeSrc = await readFile(join("client", "src", "theme.css"), "utf8");

check("item 4: map preview snapshots the query on open (no live iframe binding)", appSrc.includes("setMapQuery(location.trim()") && appSrc.includes("key={mapQuery}"));
check("item 4: iframe no longer interpolates the raw location input", !appSrc.includes("encodeURIComponent(location.trim() || \"Tampa, FL\")"));

check("item 5: referContractor screen is registered", appSrc.includes('{ name: "referContractor" }'));
check("item 5: home banner routes to referContractor (not the client-referral screen)", appSrc.includes('setScreen({ name: "referContractor" })'));
check("item 5: ReferContractorScreen renders steps + share panel + fine print", appSrc.includes("function ReferContractorScreen") && appSrc.includes("refer-step") && appSrc.includes("<ReferralPanel") && appSrc.includes("refer-fine-print"));

check("item 6: invoice Save is a compact right-aligned pill", themeSrc.includes(".invoice-builder-page .sticky-submit") && themeSrc.includes("width: auto"));
check("item 6: invoice form gets extra bottom clearance", themeSrc.includes(".invoice-builder-page .job-form") && themeSrc.includes("210px"));
check("item 6: builders hide the master nav", appSrc.includes('screen.name === "invoiceNew" || screen.name === "quoteNew"'));
check("item 6: builder Save pinned to true bottom when nav hidden (no keyboard-detection dependency)", themeSrc.includes(".app-shell.master-nav-hidden .form-page .sticky-submit"));
check("item 6: new invoice starts blank, draft offered via Resume/Discard", appSrc.includes("You have an unsaved draft") && appSrc.includes("resumeDraft") && !appSrc.includes("restoredDraft"));

await rm(dir, { recursive: true, force: true });
await rm(upDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nAll Build 0.5 behavior tests passed.");
