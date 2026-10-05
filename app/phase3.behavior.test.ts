// Phase 3 behavior tests (server side).
//
// Covers: migration 0054 (appointments dispatch/on-my-way columns, selections
// cost columns), appointment CRUD with company scoping, the On My Way share
// flow (share → public status → update → revoke), selection cost fields +
// update path, and the budget integration in getJobOperations
// (changeOrdersTotal, selectionBudget/Actual, budgetTotal).
//
// Run from app/:  bun phase3.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
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
check("newest migration tag is 0065_marketplace_unlocks", last.tag === "0065_marketplace_unlocks", last.tag);

// --- 2. Apply all migrations on a scratch DB ----------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-phase3-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const apptCols = (await sqlite.execute("PRAGMA table_info(appointments)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
for (const col of ["status", "crew_member", "eta_minutes", "share_token_hash", "share_token_hint"]) {
  check(`migrations applied: appointments.${col} exists`, apptCols.includes(col));
}
const selCols = (await sqlite.execute("PRAGMA table_info(selections)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: selections.estimated_cost exists", selCols.includes("estimated_cost"));
check("migrations applied: selections.actual_cost exists", selCols.includes("actual_cost"));

// --- 3. Test contexts ----------------------------------------------------------
function makeCtx(companyId: number) {
  return {
    slug: "tradesign",
    invocationId: `phase3-test-c${companyId}`,
    spaceDir: dir,
    db: () => db,
    blobs: {
      put: async () => {},
      getUrl: async (key: string) => `blob://test/${key}`,
      get: async () => Buffer.alloc(0),
      delete: async () => {},
      head: async () => ({ contentType: "application/octet-stream", size: 0 }),
    },
    executePrivileged: async () => ({ delivery: "sent" }),
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

// --- 4. Seed -------------------------------------------------------------------
await db.insert(schema.authUsers).values([
  { companyId: 1, name: "Owner One", email: "owner1@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1 },
  { companyId: 2, name: "Owner Two", email: "owner2@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1 },
]);
await db.insert(schema.settings).values([
  { companyId: 1, companyName: "Test Co One" },
  { companyId: 2, companyName: "Test Co Two" },
] as any);
const job1 = await A.createJob.handler(ctx1, {
  clientId: null, clientName: "Maria Lopez", clientPhone: "8135550100",
  clientEmail: "maria@example.com", jobAddress: "123 Main St", jobType: "Kitchen remodel",
  notes: "", jobDate: "2026-09-20", appointmentAt: "", amountDue: "", dueDate: "",
  depositAmount: "", paymentNotes: "",
});

// --- 5. Appointment dispatch fields ---------------------------------------------
const appt = await A.saveAppointment.handler(ctx1, {
  id: null, jobId: job1.id, clientId: null, clientName: "Maria Lopez",
  clientPhone: "8135550100", startsAt: "2026-10-05T10:30:00", notes: "Cabinet install",
  exteriorWork: false, status: "confirmed", crewMember: "Danny", etaMinutes: null,
});
check("saveAppointment returns an id", typeof appt.id === "number");
let list = await A.listAppointments.handler(ctx1, {});
let saved = list.appointments.find((a: any) => a.id === appt.id);
check("appointment exposes status", saved?.status === "confirmed");
check("appointment exposes crewMember", saved?.crewMember === "Danny");
check("appointment exposes hasShareLink=false", saved?.hasShareLink === false);

// Reschedule + reassign via update.
await A.saveAppointment.handler(ctx1, {
  id: appt.id, jobId: job1.id, clientId: null, clientName: "Maria Lopez",
  clientPhone: "8135550100", startsAt: "2026-10-06T09:00:00", notes: "Cabinet install",
  exteriorWork: false, status: "scheduled", crewMember: "Mike", etaMinutes: null,
});
list = await A.listAppointments.handler(ctx1, {});
saved = list.appointments.find((a: any) => a.id === appt.id);
check("appointment reschedule persists", saved?.startsAt === "2026-10-06T09:00:00");
check("appointment reassignment persists", saved?.crewMember === "Mike");

// Tenant isolation.
await checkThrows("cross-company appointment update throws", () =>
  A.saveAppointment.handler(ctx2, {
    id: appt.id, jobId: null, clientId: null, clientName: "Hijack",
    clientPhone: "", startsAt: "2026-10-06T09:00:00", notes: "",
    exteriorWork: false, status: "scheduled", crewMember: "", etaMinutes: null,
  }));
await A.deleteAppointment.handler(ctx2, { id: appt.id });
list = await A.listAppointments.handler(ctx1, {});
check("company 2 delete did not remove company 1 appointment", list.appointments.some((a: any) => a.id === appt.id));
const ctx2List = await A.listAppointments.handler(ctx2, {});
check("company 2 sees no appointments", ctx2List.appointments.length === 0);

// --- 6. On My Way share flow ------------------------------------------------------
const shared = await A.shareOnMyWay.handler(ctx1, { appointmentId: appt.id });
check("shareOnMyWay returns a token", typeof shared.token === "string" && shared.token.length >= 32);
check("shareOnMyWay returns an #onmyway route", shared.route.startsWith("#onmyway="));
list = await A.listAppointments.handler(ctx1, {});
check("hasShareLink flips true after share", list.appointments.find((a: any) => a.id === appt.id)?.hasShareLink === true);

const status = await A.getOnMyWayStatus.handler(ctx1, { token: shared.token });
check("public status returns client name", status.clientName === "Maria Lopez");
check("public status returns job type", status.jobType === "Kitchen remodel");
check("public status returns job address", status.jobAddress === "123 Main St");
check("public status starts as scheduled", status.status === "scheduled");
await checkThrows("public status rejects bad token", () =>
  A.getOnMyWayStatus.handler(ctx1, { token: "bad-token-" + "q".repeat(40) }));

// Contractor updates status + ETA; job thread gets a system message.
await A.updateOnMyWay.handler(ctx1, { appointmentId: appt.id, status: "on_my_way", etaMinutes: 25 });
const status2 = await A.getOnMyWayStatus.handler(ctx1, { token: shared.token });
check("public status reflects on_my_way", status2.status === "on_my_way");
check("public status reflects ETA", status2.etaMinutes === 25);
const msgs = await A.listJobMessages.handler(ctx1, { jobId: job1.id });
check("on_my_way logs a system message to the job thread",
  msgs.messages.some((m: any) => m.sender === "system" && /way/i.test(m.body)));

await A.updateOnMyWay.handler(ctx1, { appointmentId: appt.id, status: "arrived", etaMinutes: null });
const status3 = await A.getOnMyWayStatus.handler(ctx1, { token: shared.token });
check("public status reflects arrived", status3.status === "arrived");

await checkThrows("cross-company updateOnMyWay throws", () =>
  A.updateOnMyWay.handler(ctx2, { appointmentId: appt.id, status: "cancelled", etaMinutes: null }));

// Revoke.
await A.revokeOnMyWay.handler(ctx1, { appointmentId: appt.id });
await checkThrows("revoked link is dead", () =>
  A.getOnMyWayStatus.handler(ctx1, { token: shared.token }));
list = await A.listAppointments.handler(ctx1, {});
check("hasShareLink flips false after revoke", list.appointments.find((a: any) => a.id === appt.id)?.hasShareLink === false);

// --- 7. Selection costs + budget integration ---------------------------------------
const sel = await A.saveSelection.handler(ctx1, {
  id: null, jobId: job1.id, category: "Tile", item: "Subway tile", vendor: "Floor & Decor",
  approvalStatus: "approved", leadTimeDays: 7, estimatedCost: "1200", actualCost: "1150",
  photoFilename: "", photoContentType: "", photoDataBase64: "",
});
check("saveSelection returns an id", typeof sel.id === "number");
// Update path.
await A.saveSelection.handler(ctx1, {
  id: sel.id, jobId: job1.id, category: "Tile", item: "Subway tile", vendor: "Floor & Decor",
  approvalStatus: "approved", leadTimeDays: 7, estimatedCost: "1200", actualCost: "1180",
  photoFilename: "", photoContentType: "", photoDataBase64: "",
});
const ops = await A.getJobOperations.handler(ctx1, { jobId: job1.id });
const savedSel = ops.selections.find((s: any) => s.id === sel.id);
check("selection exposes estimatedCost", savedSel?.estimatedCost === "1200.00");
check("selection update persists actualCost", savedSel?.actualCost === "1180.00");
check("profitability exposes selectionBudget", ops.profitability.selectionBudget === 1200);
check("profitability exposes selectionActual", ops.profitability.selectionActual === 1180);

// Change order budget: seed a signed change order document.
await db.insert(schema.documents).values({
  companyId: 1, jobId: job1.id, kind: "change_order", title: "Add backsplash",
  bodyText: "", amount: "850", signerName: "Danny", signatureBlobKey: "sig",
  signedAt: new Date(),
});
const ops2 = await A.getJobOperations.handler(ctx1, { jobId: job1.id });
check("profitability exposes changeOrdersTotal", ops2.profitability.changeOrdersTotal === 850);
check("profitability budgetTotal = quoted + change orders",
  ops2.profitability.budgetTotal === ops2.profitability.quoted + 850);

await checkThrows("cross-company saveSelection throws", () =>
  A.saveSelection.handler(ctx2, {
    id: null, jobId: job1.id, category: "X", item: "Y", vendor: "",
    approvalStatus: "pending", leadTimeDays: 0, estimatedCost: "0", actualCost: "0",
    photoFilename: "", photoContentType: "", photoDataBase64: "",
  }));

console.log(failures === 0 ? "\nALL PHASE 3 CHECKS PASSED" : `\n${failures} PHASE 3 CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
