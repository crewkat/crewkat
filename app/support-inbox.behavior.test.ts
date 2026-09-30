// Platform support inbox behavior tests.
//
// Covers:
//  1. Migration 0057 creates platform_support_reports + platform_support_replies.
//  2. The eight support actions exist on BaseActions.
//  3. submit -> inbox (admin) -> thread -> admin reply -> user reply round-trip.
//  4. Ownership: a user cannot read or reply to another user's report.
//  5. Non-admins are blocked from the admin-only actions.
//
// Run from app/:  bun support-inbox.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
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
async function throwsAsync(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch {
    check(name, true);
  }
}

// --- 1. Scratch DB + migrate -------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-support-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

// --- 2. Journal check ----------------------------------------------------------
const journal = await import("./drizzle/meta/_journal.json");
const entries = journal.entries;
const last = entries[entries.length - 1];
const prev = entries[entries.length - 2];
check("newest migration tag is 0058_marketplace_conversations", last.tag === "0058_marketplace_conversations", last.tag);
check("0058 when is strictly newer than 0057 (drizzle skips older)", last.when > prev.when, `${last.when} vs ${prev.when}`);

// --- 3. Tables accept inserts --------------------------------------------------
const now = new Date();
const mkUser = (name: string, email: string, isAdmin: boolean) =>
  db.insert(schema.authUsers).values({ name, email, passwordHash: "x", passwordSalt: "y", isPlatformAdmin: isAdmin, createdAt: now });
await mkUser("Danny", "admin@test.com", true);
await mkUser("User One", "user1@test.com", false);
await mkUser("User Two", "user2@test.com", false);
const admin = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "admin@test.com")).limit(1))[0];
const user1 = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "user1@test.com")).limit(1))[0];
const user2 = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "user2@test.com")).limit(1))[0];

const ctxFor = (user: typeof admin) => ({
  db: () => db,
  unscopedDb: () => db,
  workspaceCompanyId: user.companyId,
  workspaceUserId: user.id,
  workspaceTier: user.tier,
  invalidateQueries: () => {},
}) as any;

const actions = BaseActions as any;
for (const name of ["submitPlatformSupportReport", "platformSupportInbox", "platformSupportThread", "replyToSupportReport", "updatePlatformSupportReport", "userSupportThreads", "userSupportThread", "replyToOwnSupportReport"]) {
  check(`action exists: ${name}`, typeof actions[name]?.handler === "function");
}

// --- 4. Submit + inbox round-trip ----------------------------------------------
const submitted = await actions.submitPlatformSupportReport.handler(ctxFor(user1), {
  kind: "problem", subject: "App crashes on open", message: "It crashes every time.", language: "en",
});
check("submit returns id + sentAt", typeof submitted.id === "number" && typeof submitted.sentAt === "string", JSON.stringify(submitted));
const reportId = submitted.id;

const inbox = await actions.platformSupportInbox.handler(ctxFor(admin), {});
check("inbox lists the report", inbox.reports.length === 1, String(inbox.reports.length));
check("inbox reports caller identity", inbox.reports[0].userName === "User One" && inbox.reports[0].userEmail === "user1@test.com");
check("inbox flags unread", inbox.reports[0].isUnread === true && inbox.unreadCount === 1, String(inbox.unreadCount));

await throwsAsync("non-admin blocked from platformSupportInbox", () => actions.platformSupportInbox.handler(ctxFor(user1), {}));
await throwsAsync("non-admin blocked from platformSupportThread", () => actions.platformSupportThread.handler(ctxFor(user1), { reportId }));
await throwsAsync("non-admin blocked from replyToSupportReport", () => actions.replyToSupportReport.handler(ctxFor(user1), { reportId, message: "hi" }));
await throwsAsync("non-admin blocked from updatePlatformSupportReport", () => actions.updatePlatformSupportReport.handler(ctxFor(user1), { id: reportId, status: "resolved", isUnread: false }));

// --- 5. Admin thread + reply ----------------------------------------------------
const thread = await actions.platformSupportThread.handler(ctxFor(admin), { reportId });
check("admin thread loads report + zero replies", thread.report.id === reportId && thread.replies.length === 0);

const adminReply = await actions.replyToSupportReport.handler(ctxFor(admin), { reportId, message: "Sorry about that — which phone are you on?" });
check("admin reply returns sender admin", adminReply.sender === "admin", adminReply.sender);
const thread2 = await actions.platformSupportThread.handler(ctxFor(admin), { reportId });
check("admin thread shows the reply", thread2.replies.length === 1 && thread2.replies[0].message.includes("which phone"));
check("replies are oldest-first", thread2.replies[0].id === adminReply.id);
const inbox2 = await actions.platformSupportInbox.handler(ctxFor(admin), {});
check("admin reply clears unread", inbox2.unreadCount === 0 && inbox2.reports[0].replyCount === 1);

// --- 6. User side: threads + reply ----------------------------------------------
const mine = await actions.userSupportThreads.handler(ctxFor(user1), {});
check("user sees own thread", mine.threads.length === 1 && mine.threads[0].replyCount === 1);
check("thread previews latest reply", mine.threads[0].lastReply?.sender === "admin" && (mine.threads[0].lastReply?.message.length ?? 0) > 0);
const other = await actions.userSupportThreads.handler(ctxFor(user2), {});
check("other user sees no threads", other.threads.length === 0);

const userThread = await actions.userSupportThread.handler(ctxFor(user1), { reportId });
check("user thread loads own report + replies", userThread.report.id === reportId && userThread.replies.length === 1);

await throwsAsync("user cannot read another user's report", () => actions.userSupportThread.handler(ctxFor(user2), { reportId }));
await throwsAsync("user cannot reply to another user's report", () => actions.replyToOwnSupportReport.handler(ctxFor(user2), { reportId, message: "hijack" }));

const userReply = await actions.replyToOwnSupportReport.handler(ctxFor(user1), { reportId, message: "Galaxy S25 Ultra." });
check("user reply returns sender user", userReply.sender === "user", userReply.sender);
const inbox3 = await actions.platformSupportInbox.handler(ctxFor(admin), {});
check("user reply flags report unread for Danny", inbox3.unreadCount === 1);

// --- 7. Resolve / reopen ---------------------------------------------------------
await actions.updatePlatformSupportReport.handler(ctxFor(admin), { id: reportId, status: "resolved", isUnread: false });
const resolved = (await db.select().from(schema.platformSupportReports).where(eq(schema.platformSupportReports.id, reportId)).limit(1))[0];
check("resolve sets status + resolvedAt", resolved.status === "resolved" && resolved.resolvedAt instanceof Date);
await actions.updatePlatformSupportReport.handler(ctxFor(admin), { id: reportId, status: "open", isUnread: true });
const reopened = (await db.select().from(schema.platformSupportReports).where(eq(schema.platformSupportReports.id, reportId)).limit(1))[0];
check("reopen clears resolvedAt", reopened.status === "open" && reopened.resolvedAt === null);

// --- Done ------------------------------------------------------------------------
await client.close();
if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nAll support inbox behavior tests passed.");
