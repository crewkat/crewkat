// Admin panel Phase 2 — support tickets behavior tests.
//
// Covers:
//  1. Migration 0072: platform_support_reports gains priority/assigned_to;
//     platform_support_notes table exists and accepts rows.
//  2. Inbox filters: status / priority / assignedTo / search; response adds
//     priority, assignedTo {id,name}, noteCount.
//  3. adminSupportTicketAssign / adminSupportTicketPriority round-trips +
//     audit rows (support.assign, support.priority).
//  4. adminSupportNoteAdd / adminSupportNotesList round-trips + audit row
//     (support.note_add); author names and createdAt included.
//  5. Moderators are blocked from the support inbox/thread/reply/update and
//     from the new Phase 2 support actions.
//  6. Admin reply triggers a push via sendPushToUser (stubbed); a failing
//     push does not fail the reply.
//  7. Support role retains full access per the permission matrix.
//
// Run from app/:  bun admin-phase2-support.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "./server/src/schema.ts";

// --- Stub push BEFORE the actions modules load (they import ./push) ---------
const pushCalls: Array<{ userId: number; message: any }> = [];
mock.module("./server/src/push.ts", () => ({
  getVapidPublicKey: () => null,
  sendPushToCompany: async () => ({ sent: 0, removed: 0, skipped: true }),
  sendPushToUser: async (_db: any, userId: number, message: any) => {
    if (message?.bodyEn?.includes("PUSH-BOOM")) throw new Error("push transport down");
    pushCalls.push({ userId, message });
    return { sent: 1, removed: 0, skipped: false };
  },
}));

const { BaseActions } = await import("./server/src/actions.ts");
const { platformAdminPhase2SupportActions } = await import("./server/src/platform-admin-phase2-support.ts");
const actions = { ...(BaseActions as any), ...(platformAdminPhase2SupportActions as any) };

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

// --- Scratch DB + migrate -----------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-pa2-support-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

// --- 1. Migration 0072 tables/columns exist -----------------------------------
const reportCols = await client.execute("PRAGMA table_info(platform_support_reports)");
const colNames = reportCols.rows.map((r: any) => r.name);
check("0072: platform_support_reports has priority column", colNames.includes("priority"));
check("0072: platform_support_reports has assigned_to column", colNames.includes("assigned_to"));
const noteTables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_support_notes'");
check("0072: platform_support_notes table exists", noteTables.rows.length === 1);
const noteCols = await client.execute("PRAGMA table_info(platform_support_notes)");
const noteColNames = noteCols.rows.map((r: any) => r.name);
check("0072: platform_support_notes has report_id/author_id/note/created_at",
  ["report_id", "author_id", "note", "created_at"].every((c) => noteColNames.includes(c)));

// --- Users: admin / support / moderator / plain --------------------------------
const now = new Date();
const mkUser = (name: string, email: string, isAdmin: boolean) =>
  db.insert(schema.authUsers).values({ name, email, passwordHash: "x", passwordSalt: "y", isPlatformAdmin: isAdmin, createdAt: now });
await mkUser("Danny Admin", "admin@test.com", true);
await mkUser("Sofia Support", "support@test.com", false);
await mkUser("Mark Moderator", "moderator@test.com", false);
await mkUser("User One", "user1@test.com", false);
await mkUser("User Two", "user2@test.com", false);
const byEmail = async (email: string) =>
  (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, email)).limit(1))[0];
const admin = await byEmail("admin@test.com");
const supportUser = await byEmail("support@test.com");
const moderator = await byEmail("moderator@test.com");
const user1 = await byEmail("user1@test.com");
const user2 = await byEmail("user2@test.com");
await db.insert(schema.adminTeamRoles).values({ userId: supportUser.id, role: "support", grantedBy: admin.id, createdAt: now, updatedAt: now });
await db.insert(schema.adminTeamRoles).values({ userId: moderator.id, role: "moderator", grantedBy: admin.id, createdAt: now, updatedAt: now });

const ctxFor = (user: typeof admin) => ({
  db: () => db,
  unscopedDb: () => db,
  workspaceCompanyId: user.companyId,
  workspaceUserId: user.id,
  workspaceTier: user.tier,
  invalidateQueries: () => {},
}) as any;

const auditRows = async (action: string) =>
  db.select().from(schema.adminAuditLog).where(eq(schema.adminAuditLog.action, action));

// Direct .handler() calls bypass zod request defaults, so spell them out.
const allFilters = { status: "all", priority: "all", assignedTo: "all", search: "" } as const;

// --- Seed three reports via the user entry point ------------------------------
const r1 = await actions.submitPlatformSupportReport.handler(ctxFor(user1), {
  kind: "problem", subject: "Zebra invoice crash", message: "The invoice screen crashes.", language: "en",
});
const r2 = await actions.submitPlatformSupportReport.handler(ctxFor(user1), {
  kind: "question", subject: "How do estimates work", message: "Question about estimates.", language: "en",
});
const r3 = await actions.submitPlatformSupportReport.handler(ctxFor(user2), {
  kind: "support", subject: "Login help", message: "Can't sign in on my phone.", language: "en",
});

// --- 2. Inbox filters ---------------------------------------------------------
const inboxAll = await actions.platformSupportInbox.handler(ctxFor(admin), { ...allFilters });
check("inbox {} defaults return all reports", inboxAll.reports.length === 3, String(inboxAll.reports.length));
check("inbox adds priority (default normal)", inboxAll.reports.every((r: any) => r.priority === "normal"));
check("inbox adds assignedTo null + noteCount 0",
  inboxAll.reports.every((r: any) => r.assignedTo === null && r.noteCount === 0));

await actions.updatePlatformSupportReport.handler(ctxFor(admin), { id: r2.id, status: "resolved", isUnread: false });
const openOnly = await actions.platformSupportInbox.handler(ctxFor(admin), { status: "open" });
check("status=open filters resolved out", openOnly.reports.length === 2 && openOnly.reports.every((r: any) => r.status === "open"));
const resolvedOnly = await actions.platformSupportInbox.handler(ctxFor(admin), { status: "resolved" });
check("status=resolved returns only resolved", resolvedOnly.reports.length === 1 && resolvedOnly.reports[0].id === r2.id);

await actions.adminSupportTicketPriority.handler(ctxFor(admin), { reportId: r1.id, priority: "urgent" });
const urgentOnly = await actions.platformSupportInbox.handler(ctxFor(admin), { priority: "urgent" });
check("priority=urgent filters", urgentOnly.reports.length === 1 && urgentOnly.reports[0].id === r1.id, JSON.stringify(urgentOnly.reports.map((r: any) => r.id)));

const searchSubject = await actions.platformSupportInbox.handler(ctxFor(admin), { search: "zebra" });
check("search matches subject (case-insensitive)", searchSubject.reports.length === 1 && searchSubject.reports[0].id === r1.id);
const searchMsg = await actions.platformSupportInbox.handler(ctxFor(admin), { search: "estimates" });
check("search matches message", searchMsg.reports.length === 1 && searchMsg.reports[0].id === r2.id);
const searchEmail = await actions.platformSupportInbox.handler(ctxFor(admin), { search: "user2@test" });
check("search matches userEmail", searchEmail.reports.length === 1 && searchEmail.reports[0].id === r3.id);
const searchName = await actions.platformSupportInbox.handler(ctxFor(admin), { search: "User One" });
check("search matches userName", searchName.reports.length === 2, String(searchName.reports.length));

const unassigned = await actions.platformSupportInbox.handler(ctxFor(admin), { assignedTo: null });
check("assignedTo=null returns unassigned", unassigned.reports.length === 3);

// --- 3. Assign round-trip + audit ----------------------------------------------
const assign = await actions.adminSupportTicketAssign.handler(ctxFor(admin), { reportId: r1.id, userId: supportUser.id });
check("assign returns ok", assign.ok === true);
const inboxAfterAssign = await actions.platformSupportInbox.handler(ctxFor(admin), { ...allFilters });
const assignedRow = inboxAfterAssign.reports.find((r: any) => r.id === r1.id);
check("inbox shows assignedTo {id,name}", assignedRow?.assignedTo?.id === supportUser.id && assignedRow?.assignedTo?.name === "Sofia Support", JSON.stringify(assignedRow?.assignedTo));
const mineOnly = await actions.platformSupportInbox.handler(ctxFor(admin), { assignedTo: supportUser.id });
check("assignedTo=<id> filters", mineOnly.reports.length === 1 && mineOnly.reports[0].id === r1.id);
const unassignedNow = await actions.platformSupportInbox.handler(ctxFor(admin), { assignedTo: null });
check("assignedTo=null excludes assigned", unassignedNow.reports.length === 2 && unassignedNow.reports.every((r: any) => r.id !== r1.id));
const assignAudits = await auditRows("support.assign");
check("support.assign audit row written", assignAudits.length === 1 && assignAudits[0].adminUserId === admin.id, String(assignAudits.length));

const thread = await actions.platformSupportThread.handler(ctxFor(admin), { reportId: r1.id });
check("thread carries priority + assignedTo", thread.report.priority === "urgent" && thread.report.assignedTo?.name === "Sofia Support", JSON.stringify(thread.report));

await actions.adminSupportTicketAssign.handler(ctxFor(admin), { reportId: r1.id, userId: null });
const afterUnassign = await actions.platformSupportInbox.handler(ctxFor(admin), { ...allFilters });
check("unassign clears assignedTo", afterUnassign.reports.find((r: any) => r.id === r1.id)?.assignedTo === null);
await throwsAsync("assign to missing user throws", () => actions.adminSupportTicketAssign.handler(ctxFor(admin), { reportId: r1.id, userId: 99999 }));
await throwsAsync("assign to missing report throws", () => actions.adminSupportTicketAssign.handler(ctxFor(admin), { reportId: 99999, userId: supportUser.id }));

// --- Priority round-trip + audit ------------------------------------------------
await actions.adminSupportTicketPriority.handler(ctxFor(admin), { reportId: r3.id, priority: "high" });
const highOnly = await actions.platformSupportInbox.handler(ctxFor(admin), { priority: "high" });
check("priority=high round-trips", highOnly.reports.length === 1 && highOnly.reports[0].id === r3.id);
const priAudits = await auditRows("support.priority");
check("support.priority audit row written", priAudits.length === 2, String(priAudits.length));
await throwsAsync("invalid priority rejected by request schema", () => { actions.adminSupportTicketPriority.request.parse({ reportId: r3.id, priority: "mega" }); return Promise.resolve(); });

// --- 4. Notes round-trip + audit ------------------------------------------------
const noteAdd = await actions.adminSupportNoteAdd.handler(ctxFor(supportUser), { reportId: r1.id, note: "Called the user — needs a follow-up tomorrow." });
check("note add returns id + createdAt", typeof noteAdd.id === "number" && typeof noteAdd.createdAt === "string");
const noteAdd2 = await actions.adminSupportNoteAdd.handler(ctxFor(admin), { reportId: r1.id, note: "Escalated to engineering." });
check("second note add works", typeof noteAdd2.id === "number" && noteAdd2.id !== noteAdd.id);
const notes = await actions.adminSupportNotesList.handler(ctxFor(admin), { reportId: r1.id });
check("notes list returns both, oldest first", notes.notes.length === 2 && notes.notes[0].id === noteAdd.id && notes.notes[1].id === noteAdd2.id);
check("notes carry author name + createdAt",
  notes.notes[0].authorName === "Sofia Support" && notes.notes[1].authorName === "Danny Admin" && typeof notes.notes[0].createdAt === "string",
  JSON.stringify(notes.notes.map((n: any) => n.authorName)));
const notesOther = await actions.adminSupportNotesList.handler(ctxFor(admin), { reportId: r3.id });
check("notes scoped per report", notesOther.notes.length === 0);
const inboxWithNotes = await actions.platformSupportInbox.handler(ctxFor(admin), { ...allFilters });
check("inbox noteCount reflects notes", inboxWithNotes.reports.find((r: any) => r.id === r1.id)?.noteCount === 2);
const noteAudits = await auditRows("support.note_add");
check("support.note_add audit rows written", noteAudits.length === 2, String(noteAudits.length));
await throwsAsync("empty note rejected by request schema", () => { actions.adminSupportNoteAdd.request.parse({ reportId: r1.id, note: "   " }); return Promise.resolve(); });
await throwsAsync("overlong note rejected by request schema", () => { actions.adminSupportNoteAdd.request.parse({ reportId: r1.id, note: "x".repeat(2001) }); return Promise.resolve(); });
await throwsAsync("note on missing report throws", () => actions.adminSupportNoteAdd.handler(ctxFor(admin), { reportId: 99999, note: "hi" }));
await throwsAsync("notes list on missing report throws", () => actions.adminSupportNotesList.handler(ctxFor(admin), { reportId: 99999 }));

// --- 5. Moderator blocked (tightened per the Phase 2 matrix) --------------------
await throwsAsync("moderator blocked from platformSupportInbox", () => actions.platformSupportInbox.handler(ctxFor(moderator), { ...allFilters }));
await throwsAsync("moderator blocked from platformSupportThread", () => actions.platformSupportThread.handler(ctxFor(moderator), { reportId: r1.id }));
await throwsAsync("moderator blocked from replyToSupportReport", () => actions.replyToSupportReport.handler(ctxFor(moderator), { reportId: r1.id, message: "hi" }));
await throwsAsync("moderator blocked from updatePlatformSupportReport", () => actions.updatePlatformSupportReport.handler(ctxFor(moderator), { id: r1.id, status: "open", isUnread: true }));
await throwsAsync("moderator blocked from adminSupportTicketAssign", () => actions.adminSupportTicketAssign.handler(ctxFor(moderator), { reportId: r1.id, userId: null }));
await throwsAsync("moderator blocked from adminSupportTicketPriority", () => actions.adminSupportTicketPriority.handler(ctxFor(moderator), { reportId: r1.id, priority: "low" }));
await throwsAsync("moderator blocked from adminSupportNoteAdd", () => actions.adminSupportNoteAdd.handler(ctxFor(moderator), { reportId: r1.id, note: "hi" }));
await throwsAsync("moderator blocked from adminSupportNotesList", () => actions.adminSupportNotesList.handler(ctxFor(moderator), { reportId: r1.id }));

// Plain users stay blocked from everything team-side.
await throwsAsync("plain user blocked from inbox", () => actions.platformSupportInbox.handler(ctxFor(user1), { ...allFilters }));
await throwsAsync("plain user blocked from notes list", () => actions.adminSupportNotesList.handler(ctxFor(user1), { reportId: r1.id }));

// --- 6. Admin reply triggers push (stubbed) --------------------------------------
const reply = await actions.replyToSupportReport.handler(ctxFor(admin), { reportId: r1.id, message: "We pushed a fix — let me know if it still crashes." });
check("admin reply succeeds", reply.sender === "admin");
check("push sent to the report's user", pushCalls.length === 1 && pushCalls[0].userId === user1.id, JSON.stringify(pushCalls.map((c) => c.userId)));
check("push body is the reply (truncated to 120)",
  pushCalls[0].message.titleEn === "Crewkat support" && pushCalls[0].message.bodyEn.startsWith("We pushed a fix"), JSON.stringify(pushCalls[0].message));

// A failing push must not fail the reply.
const reply2 = await actions.replyToSupportReport.handler(ctxFor(admin), { reportId: r1.id, message: "PUSH-BOOM test of failure tolerance" });
check("reply survives push failure", reply2.sender === "admin" && pushCalls.length === 1);
const replyAudits = await auditRows("support.reply");
check("support.reply audit still written", replyAudits.length === 2, String(replyAudits.length));

// --- 7. Support role keeps full access -------------------------------------------
const supportInbox = await actions.platformSupportInbox.handler(ctxFor(supportUser), {});
check("support role can read the inbox", supportInbox.reports.length === 3);
const supportThread = await actions.platformSupportThread.handler(ctxFor(supportUser), { reportId: r1.id });
check("support role can read a thread", supportThread.report.id === r1.id);
await actions.adminSupportTicketAssign.handler(ctxFor(supportUser), { reportId: r3.id, userId: supportUser.id });
check("support role can assign", true);
await actions.adminSupportTicketPriority.handler(ctxFor(supportUser), { reportId: r3.id, priority: "low" });
check("support role can set priority", true);
await actions.updatePlatformSupportReport.handler(ctxFor(supportUser), { id: r3.id, status: "open", isUnread: true });
check("support role can update status", true);

// --- User entry point still works ------------------------------------------------
const mine = await actions.userSupportThreads.handler(ctxFor(user1), {});
check("user sees own threads", mine.threads.length === 2);
const userThread = await actions.userSupportThread.handler(ctxFor(user1), { reportId: r1.id });
check("user thread loads own report", userThread.report.id === r1.id && userThread.replies.length === 2);
await throwsAsync("user cannot read another user's report", () => actions.userSupportThread.handler(ctxFor(user2), { reportId: r1.id }));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
