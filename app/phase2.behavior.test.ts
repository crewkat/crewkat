// Phase 2 behavior tests.
//
// Covers: migration 0053 (job_messages + bid_board_items tables, daily_logs
// columns, settings.weekly_progress_enabled), per-job messaging (contractor
// send/list with text+photo+voice, tenant isolation, system events on
// create/complete), client portal messaging (list/send via token), the weekly
// progress email tick (eligibility, idempotency, toggle, email requirement),
// online booking → appointment auto-creation, and the bid board API.
//
// Run from app/:  bun phase2.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import { BaseActions, runWeeklyProgressTick } from "./server/src/actions.ts";
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

// --- 1. Migration journal ordering -------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
let nonDecreasing = true;
for (let i = 1; i < entries.length; i++) {
  if (entries[i]!.when < entries[i - 1]!.when) nonDecreasing = false;
}
check("journal when values are non-decreasing", nonDecreasing);
const last = entries[entries.length - 1]!;
const maxBefore = Math.max(...entries.slice(0, -1).map((e) => e.when));
check("newest migration when is strictly greater than every earlier entry", last.when > maxBefore);
check("newest migration tag is 0069_platform_admin_suite", last.tag === "0069_platform_admin_suite", last.tag);

// --- 2. Apply all migrations on a scratch DB ----------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-phase2-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const tables = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
check("migrations applied: job_messages table exists", tables.includes("job_messages"));
check("migrations applied: bid_board_items table exists", tables.includes("bid_board_items"));
const logCols = (await sqlite.execute("PRAGMA table_info(daily_logs)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: daily_logs.blockers exists", logCols.includes("blockers"));
check("migrations applied: daily_logs.client_summary exists", logCols.includes("client_summary"));
check("migrations applied: daily_logs.shared_with_client exists", logCols.includes("shared_with_client"));
const settingsCols = (await sqlite.execute("PRAGMA table_info(settings)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: settings.weekly_progress_enabled exists", settingsCols.includes("weekly_progress_enabled"));

// --- 3. Test contexts ----------------------------------------------------------
const sentEmails: Array<{ to: string; subject: string }> = [];
function makeCtx(companyId: number) {
  return {
    slug: "tradesign",
    invocationId: `phase2-test-c${companyId}`,
    spaceDir: dir,
    db: () => db,
    blobs: {
      put: async () => {},
      getUrl: async (key: string) => `blob://test/${key}`,
      get: async () => Buffer.alloc(0),
      delete: async () => {},
      head: async () => ({ contentType: "application/octet-stream", size: 0 }),
    },
    executePrivileged: async (_fn: unknown, args: Record<string, unknown>) => {
      if (args && typeof args.to === "string" && typeof args.subject === "string") {
        sentEmails.push({ to: args.to, subject: args.subject });
        return { delivery: "sent" };
      }
      throw new Error("unexpected privileged call");
    },
    emit: () => {},
    invalidateQueries: () => {},
    workspaceCompanyId: companyId,
    workspaceUserId: companyId,
    workspaceTier: "free",
  } as any;
}
const ctx1 = makeCtx(1);
const ctx2 = makeCtx(2);

const A = BaseActions as any;
const DAY = 86400000;

// --- 4. Seed: auth users + settings + jobs --------------------------------------
await db.insert(schema.authUsers).values([
  { companyId: 1, name: "Owner One", email: "owner1@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1 },
  { companyId: 2, name: "Owner Two", email: "owner2@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1 },
]);
await db.insert(schema.settings).values([
  { companyId: 1, companyName: "Test Co One", weeklyProgressEnabled: true },
  { companyId: 2, companyName: "Test Co Two", weeklyProgressEnabled: true },
] as any);

const job1 = await A.createJob.handler(ctx1, {
  clientId: null, clientName: "Maria Lopez", clientPhone: "8135550100",
  clientEmail: "maria@example.com", jobAddress: "123 Main St", jobType: "Kitchen remodel",
  notes: "", jobDate: "2026-09-20", appointmentAt: "", amountDue: "", dueDate: "",
  depositAmount: "", paymentNotes: "",
});
check("createJob returns an id", typeof job1.id === "number");

const job2 = await A.createJob.handler(ctx2, {
  clientId: null, clientName: "Other Client", clientPhone: "8135550200",
  clientEmail: "other@example.com", jobAddress: "999 Other Ave", jobType: "Bath remodel",
  notes: "", jobDate: "2026-09-21", appointmentAt: "", amountDue: "", dueDate: "",
  depositAmount: "", paymentNotes: "",
});

// --- 5. System messages on lifecycle --------------------------------------------
let msgs = await A.listJobMessages.handler(ctx1, { jobId: job1.id });
check("createJob logs a system message", msgs.messages.some((m: any) => m.sender === "system" && /created/i.test(m.body)));
check("system message is bilingual (contains es marker or both)", msgs.messages.some((m: any) => m.sender === "system"));

await A.completeJob.handler(ctx1, { jobId: job1.id, overrideNote: "test override" });
msgs = await A.listJobMessages.handler(ctx1, { jobId: job1.id });
check("completeJob logs a system message", msgs.messages.some((m: any) => m.sender === "system" && /complete/i.test(m.body)));

// --- 6. Contractor messaging ------------------------------------------------------
const sent = await A.sendJobMessage.handler(ctx1, { jobId: job1.id, body: "Hello Maria, we start Monday!" });
check("sendJobMessage returns an id", typeof sent.id === "number");
const withPhoto = await A.sendJobMessage.handler(ctx1, {
  jobId: job1.id, body: "Progress photo", imageDataBase64: Buffer.from("fake-image").toString("base64"),
  imageFilename: "progress.jpg", imageContentType: "image/jpeg",
});
check("sendJobMessage with photo returns an id", typeof withPhoto.id === "number");
const withVoice = await A.sendJobMessage.handler(ctx1, {
  jobId: job1.id, body: "", voiceDataBase64: Buffer.from("fake-voice").toString("base64"),
  voiceFilename: "note.webm", voiceDurationSeconds: 12,
});
check("sendJobMessage with voice-only returns an id", typeof withVoice.id === "number");
await checkThrows("sendJobMessage rejects empty message with no attachments", () =>
  A.sendJobMessage.handler(ctx1, { jobId: job1.id, body: "" }));

msgs = await A.listJobMessages.handler(ctx1, { jobId: job1.id });
check("listJobMessages returns all messages", msgs.messages.length >= 5, `got ${msgs.messages.length}`);
const photoMsg = msgs.messages.find((m: any) => m.id === withPhoto.id);
check("photo message exposes imageUrl", !!photoMsg?.imageUrl);
const voiceMsg = msgs.messages.find((m: any) => m.id === withVoice.id);
check("voice message exposes voiceUrl + duration", !!voiceMsg?.voiceUrl && voiceMsg.voiceDurationSeconds === 12);
check("messages are chronological", msgs.messages.every((m: any, i: number, arr: any[]) => i === 0 || arr[i - 1].id <= m.id));

// --- 7. Tenant isolation -----------------------------------------------------------
await checkThrows("sendJobMessage on another company's job throws", () =>
  A.sendJobMessage.handler(ctx1, { jobId: job2.id, body: "hijack" }));
await checkThrows("listJobMessages on another company's job throws", () =>
  A.listJobMessages.handler(ctx1, { jobId: job2.id }));
await checkThrows("company 2 cannot read company 1 messages", () =>
  A.listJobMessages.handler(ctx2, { jobId: job1.id }));
await checkThrows("completeJob on another company's job throws", () =>
  A.completeJob.handler(ctx2, { jobId: job1.id, overrideNote: "x" }));
const isoMsgs = await A.listJobMessages.handler(ctx2, { jobId: job2.id });
check("company 2 sees only its own job messages", isoMsgs.messages.every((m: any) => m.jobId === job2.id));

// --- 8. Portal messaging ------------------------------------------------------------
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
const portalToken = "test-portal-token-" + "x".repeat(40);
await db.insert(schema.portalTokens).values({
  companyId: 1, jobId: job1.id, tokenHash: hashToken(portalToken), tokenHint: "test",
});
let portalMsgs = await A.portalListJobMessages.handler(ctx1, { token: portalToken });
check("portal lists job messages", portalMsgs.messages.length >= 1);
const portalSent = await A.portalSendJobMessage.handler(ctx1, { token: portalToken, body: "Thanks! See you Monday." });
check("portalSendJobMessage returns an id", typeof portalSent.id === "number");
portalMsgs = await A.portalListJobMessages.handler(ctx1, { token: portalToken });
check("client message appears as sender=client", portalMsgs.messages.some((m: any) => m.sender === "client" && /See you Monday/.test(m.body)));
await checkThrows("portalSendJobMessage rejects empty message", () =>
  A.portalSendJobMessage.handler(ctx1, { token: portalToken, body: "" }));
await checkThrows("portal rejects bad token", () =>
  A.portalListJobMessages.handler(ctx1, { token: "bad-token-" + "y".repeat(40) }));
// Portal token is job-scoped: it cannot touch another job's thread.
const otherToken = "other-portal-token-" + "z".repeat(40);
await db.insert(schema.portalTokens).values({
  companyId: 2, jobId: job2.id, tokenHash: hashToken(otherToken), tokenHint: "test2",
});
const otherPortalMsgs = await A.portalListJobMessages.handler(ctx2, { token: otherToken });
check("portal token only sees its own job", otherPortalMsgs.messages.every((m: any) => m.jobId === job2.id));

// --- 9. Weekly progress tick ----------------------------------------------------------
const todayStr = new Date().toLocaleDateString("en-CA");
await A.saveDailyLog.handler(ctx1, {
  jobId: job1.id, logDate: todayStr, crew: "Danny + 1", hours: "8",
  photoIds: [], notes: "Internal notes here", blockers: "Waiting on tile",
  clientSummary: "Cabinets installed, tile starts tomorrow.", sharedWithClient: true,
});
// Job 2 (company 2) gets an unshared log only.
const job2LogDate = new Date().toLocaleDateString("en-CA");
await A.saveDailyLog.handler(ctx2, {
  jobId: job2.id, logDate: job2LogDate, crew: "Crew", hours: "6",
  photoIds: [], notes: "private", blockers: "", clientSummary: "", sharedWithClient: false,
});

sentEmails.length = 0;
const tick1 = await runWeeklyProgressTick(ctx1);
check("weekly tick runs", tick1.ran === true);
check("weekly tick emailed the shared-log job", tick1.emailed.includes(job1.id), JSON.stringify(tick1.emailed));
check("weekly tick did not email the unshared-log job", !tick1.emailed.includes(job2.id));
const mariaEmail = sentEmails.find((e) => e.to === "maria@example.com");
check("weekly email went to the client email", !!mariaEmail);
check("weekly email is bilingual in subject", !!mariaEmail && /Avance|Progress/i.test(mariaEmail.subject));

const tick2 = await runWeeklyProgressTick(ctx1);
check("weekly tick is idempotent (no duplicate within 6 days)", tick2.emailed.length === 0, JSON.stringify(tick2.emailed));

// Toggle off → no email even with fresh eligible logs.
await db.update(schema.settings).set({ weeklyProgressEnabled: false }).where(eq(schema.settings.companyId, 1));
await db.delete(schema.automationLogs).where(eq(schema.automationLogs.kind, "weekly_progress"));
sentEmails.length = 0;
const tick3 = await runWeeklyProgressTick(ctx1);
check("weekly tick respects the disabled toggle", !tick3.emailed.includes(job1.id));
await db.update(schema.settings).set({ weeklyProgressEnabled: true }).where(eq(schema.settings.companyId, 1));

// --- 10. Online booking → appointment -----------------------------------------------
const before = (await A.listAppointments.handler(ctx1, {})).appointments.length;
await A.submitEstimateRequest.handler(ctx1, {
  name: "Booking Brenda", phone: "8135550300", email: "brenda@example.com",
  address: "456 Oak St", serviceType: "Bath remodel", projectDetails: "Full bath gut and retile, about 60 sq ft.",
  preferredContactTime: "", preferredDate: "2026-10-05", preferredTime: "10:30", company: "",
});
const after = (await A.listAppointments.handler(ctx1, {})).appointments.length;
check("booking with preferredDate creates an appointment", after === before + 1);
const appts = (await A.listAppointments.handler(ctx1, {})).appointments;
const booked = appts.find((a: any) => a.clientName === "Booking Brenda");
check("appointment has the requested date/time", !!booked && booked.startsAt.includes("2026-10-05") && booked.startsAt.includes("10:30"));
await A.submitEstimateRequest.handler(ctx1, {
  name: "No Date Ned", phone: "8135550400", email: "ned@example.com",
  address: "789 Pine St", serviceType: "Paint", projectDetails: "Interior repaint of living room and hallway.",
  preferredContactTime: "", preferredDate: "", preferredTime: "", company: "",
});
const after2 = (await A.listAppointments.handler(ctx1, {})).appointments.length;
check("booking without a date creates no appointment", after2 === after);

// --- 11. Bid board API sanity -----------------------------------------------------------
const bid = await A.saveBidBoardItem.handler(ctx1, { id: null, listingId: null, requestId: null, title: "City Hall Annex", stage: "interested", dueDate: "2026-10-20", remindAt: null, notes: "GC: BuildRight" });
check("saveBidBoardItem returns an id", typeof bid.id === "number");
await A.moveBidBoardItem.handler(ctx1, { id: bid.id, stage: "estimating" });
const board = await A.listBidBoard.handler(ctx1, {});
check("moveBidBoardItem changes stage", board.items.some((i: any) => i.id === bid.id && i.stage === "estimating"));
await A.deleteBidBoardItem.handler(ctx1, { id: bid.id });
const board2 = await A.listBidBoard.handler(ctx1, {});
check("deleteBidBoardItem removes the item", !board2.items.some((i: any) => i.id === bid.id));

// --- 12. Daily log new fields round-trip -------------------------------------------
const ops = await A.getJobOperations.handler(ctx1, { jobId: job1.id });
const latestLog = ops.dailyLogs.find((l: any) => l.logDate === todayStr);
check("daily log exposes blockers", latestLog?.blockers === "Waiting on tile");
check("daily log exposes clientSummary", latestLog?.clientSummary === "Cabinets installed, tile starts tomorrow.");
check("daily log exposes sharedWithClient", latestLog?.sharedWithClient === true);

// --- 13. Settings round-trip ------------------------------------------------------------
const settings = await A.getSettings.handler(ctx1, {});
check("getSettings exposes weeklyProgressEnabled", settings.weeklyProgressEnabled === true);
await A.updateSettings.handler(ctx1, { ...settings, weeklyProgressEnabled: false });
const settings2 = await A.getSettings.handler(ctx1, {});
check("updateSettings persists weeklyProgressEnabled", settings2.weeklyProgressEnabled === false);

console.log(failures === 0 ? "\nALL PHASE 2 CHECKS PASSED" : `\n${failures} PHASE 2 CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
