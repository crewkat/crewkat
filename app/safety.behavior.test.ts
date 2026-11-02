// Safety — toolbox talks + credential tracking (0096, SimplySub steals
// Item 3, OFFICE ONLY). Covers: migration 0096 + journal pins, talk
// library completeness (exactly 24 talks, EN + ES bullets non-empty),
// session create/list (company isolation, per-job and per-member
// listings, custom talks), presenter signature stored as a blob, the
// branded PDF export, member credential CRUD + attachment wiring,
// expiry bucket boundaries (expired / ≤30 / ≤90 / OK / no-expiry) via
// the dashboard, permission classification (ALL mutations Admin-only,
// reads Office+), and job-delete removing linked sessions.
//
// Run from app/:  bun safety.behavior.test.ts   (script-style suite)
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import { ADMIN_ACTIONS, OFFICE_ACTIONS, ALL_ROLE_ACTIONS, minRoleForAction, roleCan } from "./server/src/permissions.ts";
import { SAFETY_TALKS, credentialBucket, daysUntilExpiry, getSafetyTalk } from "./server/src/safety.ts";
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
const A = BaseActions as any;

// --- 1. Migration journal ---------------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
const last = entries[entries.length - 1]!;
check("newest migration tag is 0096_safety", last.tag === "0096_safety", last.tag);
check("newest migration idx is 95", last.idx === 95, String(last.idx));
check("0096 when is 1791738800000", last.when === 1791738800000, String(last.when));
check("newest journal when exceeds every earlier entry", last.when > Math.max(...entries.slice(0, -1).map((e) => e.when)), `last=${last.when}`);

// --- 2. Talk library completeness --------------------------------------------
const EXPECTED_SLUGS = [
  "ladder-safety", "fall-protection", "ppe", "heat-illness", "electrical-safety",
  "silica-dust", "housekeeping-trip-hazards", "power-tools", "hand-tools",
  "trenching-excavation", "driving-jobsite-vehicles", "lifting-back-safety",
  "scaffolding-awareness", "roofing-safety", "concrete-masonry",
  "painting-chemicals", "fire-safety-extinguishers", "first-aid-readiness",
  "weather-lightning-cold", "utility-locates-811", "demolition-awareness",
  "working-around-public", "fatigue", "incident-reporting",
];
check("library has exactly 24 talks", SAFETY_TALKS.length === 24, String(SAFETY_TALKS.length));
check("library slugs are exactly the 24 specified topics, in order", JSON.stringify(SAFETY_TALKS.map((t) => t.slug)) === JSON.stringify(EXPECTED_SLUGS), SAFETY_TALKS.map((t) => t.slug).join(","));
check("library slugs are unique", new Set(SAFETY_TALKS.map((t) => t.slug)).size === 24);
for (const talk of SAFETY_TALKS) {
  check(`talk ${talk.slug}: EN+ES titles and 6-9 non-empty bullets each`,
    talk.titleEn.trim().length > 0 && talk.titleEs.trim().length > 0 &&
    talk.bulletsEn.length >= 6 && talk.bulletsEn.length <= 9 &&
    talk.bulletsEs.length >= 6 && talk.bulletsEs.length <= 9 &&
    talk.bulletsEn.every((b) => b.trim().length > 10) && talk.bulletsEs.every((b) => b.trim().length > 10),
    `en=${talk.bulletsEn.length} es=${talk.bulletsEs.length}`);
  check(`talk ${talk.slug}: ES is a real translation, not a copy of EN`,
    talk.titleEs !== talk.titleEn && talk.bulletsEs[0] !== talk.bulletsEn[0]);
}
check("getSafetyTalk resolves and misses cleanly", getSafetyTalk("ppe")?.titleEn.includes("PPE") === true && getSafetyTalk("nope") === null);

// --- 3. Expiry bucket boundaries (pure) ---------------------------------------
const T = "2026-11-01";
check("bucket: yesterday is expired", credentialBucket("2026-10-31", T) === "expired");
check("bucket: today is due30", credentialBucket("2026-11-01", T) === "due30");
check("bucket: +30 days is due30", credentialBucket("2026-12-01", T) === "due30");
check("bucket: +31 days is due90", credentialBucket("2026-12-02", T) === "due90");
check("bucket: +90 days is due90", credentialBucket("2027-01-30", T) === "due90");
check("bucket: +91 days is ok", credentialBucket("2027-01-31", T) === "ok");
check("bucket: empty expiry is no_expiry", credentialBucket("", T) === "no_expiry");
check("daysUntilExpiry math", daysUntilExpiry("2026-12-01", T) === 30 && daysUntilExpiry("2026-10-31", T) === -1 && daysUntilExpiry("", T) === null);

// --- 4. Scratch DB --------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-safety-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
const tables = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
check("table safety_sessions exists", tables.includes("safety_sessions"));
check("table safety_session_attendees exists", tables.includes("safety_session_attendees"));
check("table member_credentials exists", tables.includes("member_credentials"));
const backupSrc = await readFile(join("server", "src", "actions.ts"), "utf8");
check("new tables are in BACKUP_TABLES", ["safety_sessions", "safety_session_attendees", "member_credentials"].every((t) => backupSrc.includes(`"${t}"`)));

const blobStore = new Map<string, Buffer>();
function makeCtx(companyId: number, userId: number) {
  return {
    slug: "tradesign",
    invocationId: "safety-test",
    spaceDir: dir,
    db: () => db,
    unscopedDb: () => db,
    blobs: {
      put: async (key: string, bytes: Buffer) => { blobStore.set(key, Buffer.from(bytes)); },
      getUrl: async (key: string) => `blob://test/${key}`,
      get: async (key: string) => blobStore.get(key) ?? null,
      delete: async (key: string) => { blobStore.delete(key); },
      head: async () => ({ contentType: "image/png", size: 0 }),
    },
    executePrivileged: async () => { throw new Error("no privileged calls expected"); },
    emit: () => {},
    invalidateQueries: () => {},
    workspaceCompanyId: companyId,
    workspaceUserId: userId,
    workspaceTier: "premium",
  } as any;
}
const ctx = makeCtx(1, 1);
const ctx2 = makeCtx(2, 90);

const now = new Date();
async function addUser(id: number, companyId: number, name: string) {
  await db.insert(schema.authUsers).values({ id, companyId, name, email: `user${id}@test.com`, passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: `CODE${id}XYZ`, createdAt: now, updatedAt: now });
}
await addUser(1, 1, "Danny Owner");
await addUser(2, 1, "Maria Lead");
await addUser(3, 1, "Joe Helper");
await addUser(90, 2, "Other Owner");
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Safety Test Co", updatedAt: now });
await db.insert(schema.settings).values({ id: 2, companyId: 2, companyName: "Other Co", updatedAt: now });
const jobId = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Client One", jobAddress: "1 Safe Way", jobType: "Kitchen remodel", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const job2Id = (await db.insert(schema.jobs).values({ companyId: 2, clientName: "Other Client", jobAddress: "9 Elsewhere Ave", jobType: "Bathroom remodel", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;

// --- 5. Library through the action ----------------------------------------------
const lib = await A.listSafetyTalks.handler(ctx, {});
check("listSafetyTalks returns the 24-talk library", lib.talks.length === 24 && lib.talks[0].slug === "ladder-safety");

// --- 6. Sessions ------------------------------------------------------------------
const sigB64 = Buffer.from("fake-png-signature-bytes").toString("base64");
const s1 = await A.createSafetySession.handler(ctx, {
  date: "2026-10-27", talkSlug: "ladder-safety", lang: "en", customTitle: "", customBody: "",
  presenterUserId: 2, attendeeUserIds: [1, 3], jobId, signatureDataBase64: sigB64,
});
check("session created from library talk (EN snapshot)", s1.session.title === "Ladder safety" && s1.session.talkSlug === "ladder-safety" && s1.session.bullets.length >= 6, JSON.stringify(s1.session.title));
check("session presenter snapshot", s1.session.presenterUserId === 2 && s1.session.presenterName === "Maria Lead");
check("session attendees recorded", s1.session.attendees.length === 2 && s1.session.attendees.map((a: any) => a.name).join(",") === "Danny Owner,Joe Helper", JSON.stringify(s1.session.attendees));
check("session linked to job with label", s1.session.jobId === jobId && typeof s1.session.jobLabel === "string" && s1.session.jobLabel.includes("Client One"));
check("presenter signature stored as blob", typeof s1.session.signatureUrl === "string" && s1.session.signatureUrl.startsWith("blob://test/safety-sessions/") && [...blobStore.keys()].some((k) => k.startsWith("safety-sessions/")), String(s1.session.signatureUrl));
const sigRow = (await db.select().from(schema.safetySessions).where(eq(schema.safetySessions.id, s1.session.id)))[0]!;
check("signature blob key persisted on the row", !!sigRow.signatureBlobKey && blobStore.has(sigRow.signatureBlobKey));

const s2 = await A.createSafetySession.handler(ctx, {
  date: "2026-10-28", talkSlug: "heat-illness", lang: "es", customTitle: "", customBody: "",
  presenterUserId: 1, attendeeUserIds: [2], jobId: null, signatureDataBase64: "",
});
check("session created in Spanish snapshots ES title + bullets", s2.session.title === "Enfermedades por calor" && s2.session.bulletsEs.length >= 6 && s2.session.bullets[0] === s2.session.bulletsEs[0], s2.session.title);
check("unsigned session has no signature url", s2.session.signatureUrl === null);

const s3 = await A.createSafetySession.handler(ctx, {
  date: "2026-10-29", talkSlug: "", lang: "en", customTitle: "Crane hand signals refresher", customBody: "Reviewed stop / hoist / lower signals with the crew.",
  presenterUserId: 1, attendeeUserIds: [2, 3], jobId: null, signatureDataBase64: "",
});
check("custom talk session keeps its title + body", s3.session.talkSlug === null && s3.session.title === "Crane hand signals refresher" && s3.session.customBody.includes("stop / hoist / lower"), JSON.stringify(s3.session.title));
await checkThrows("session with neither talk nor custom title fails", () => A.createSafetySession.handler(ctx, { date: "2026-10-29", talkSlug: "", lang: "en", customTitle: "", customBody: "", presenterUserId: 1, attendeeUserIds: [], jobId: null, signatureDataBase64: "" }));
await checkThrows("session with unknown talk slug fails", () => A.createSafetySession.handler(ctx, { date: "2026-10-29", talkSlug: "made-up-talk", lang: "en", customTitle: "", customBody: "", presenterUserId: 1, attendeeUserIds: [], jobId: null, signatureDataBase64: "" }));
await checkThrows("session with a presenter from another company fails", () => A.createSafetySession.handler(ctx, { date: "2026-10-29", talkSlug: "ppe", lang: "en", customTitle: "", customBody: "", presenterUserId: 90, attendeeUserIds: [], jobId: null, signatureDataBase64: "" }));
await checkThrows("session on another company's job fails", () => A.createSafetySession.handler(ctx2, { date: "2026-10-29", talkSlug: "ppe", lang: "en", customTitle: "", customBody: "", presenterUserId: 90, attendeeUserIds: [], jobId, signatureDataBase64: "" }));

const all = await A.listSafetySessions.handler(ctx, { jobId: null, memberUserId: null });
check("company session list returns all 3, newest first", all.sessions.length === 3 && all.sessions[0].id === s3.session.id, String(all.sessions.length));
const perJob = await A.listSafetySessions.handler(ctx, { jobId, memberUserId: null });
check("per-job listing returns only the linked session", perJob.sessions.length === 1 && perJob.sessions[0].id === s1.session.id);
const perMember2 = await A.listSafetySessions.handler(ctx, { jobId: null, memberUserId: 2 });
check("per-member listing covers presenter + attendee roles", perMember2.sessions.length === 3, String(perMember2.sessions.length));
const perMember3 = await A.listSafetySessions.handler(ctx, { jobId: null, memberUserId: 3 });
check("per-member listing for attendee-only member", perMember3.sessions.length === 2 && perMember3.sessions.every((s: any) => s.attendees.some((a: any) => a.userId === 3)));
const got = await A.getSafetySession.handler(ctx, { id: s1.session.id });
check("getSafetySession round-trips the session", got.session.id === s1.session.id && got.session.attendees.length === 2);

// Company isolation
const otherList = await A.listSafetySessions.handler(ctx2, { jobId: null, memberUserId: null });
check("other company sees no sessions", otherList.sessions.length === 0);
await checkThrows("other company cannot read this session", () => A.getSafetySession.handler(ctx2, { id: s1.session.id }));
await checkThrows("other company cannot delete this session", () => A.deleteSafetySession.handler(ctx2, { id: s1.session.id }));
await checkThrows("other company cannot export this session's PDF", () => A.getSafetySessionPdf.handler(ctx2, { id: s1.session.id }));

// --- 7. PDF export ------------------------------------------------------------------
const pdf = await A.getSafetySessionPdf.handler(ctx, { id: s1.session.id });
const pdfBytes = Buffer.from(pdf.pdfBase64, "base64");
check("PDF export produces a real PDF document", pdfBytes.length > 1000 && pdfBytes.subarray(0, 5).toString() === "%PDF-", `${pdfBytes.length} bytes`);
check("PDF filename is branded to the talk + date", pdf.filename.startsWith("toolbox-talk-ladder-safety-") && pdf.filename.endsWith("2026-10-27.pdf"), pdf.filename);

// --- 8. Member credentials ------------------------------------------------------------
const photoB64 = Buffer.from("fake-card-photo").toString("base64");
const c1 = await A.saveMemberCredential.handler(ctx, { id: null, userId: 2, type: "osha_30", customLabel: "", number: "OSHA30-1234", expiresOn: "2026-10-15", attachmentFilename: "card.jpg", attachmentContentType: "image/jpeg", attachmentDataBase64: photoB64, removeAttachment: false });
check("credential created with member snapshot + label", c1.credential.memberName === "Maria Lead" && c1.credential.typeLabel === "OSHA 30" && c1.credential.number === "OSHA30-1234", JSON.stringify(c1.credential));
check("credential attachment stored as blob", typeof c1.credential.attachmentUrl === "string" && c1.credential.attachmentUrl.startsWith("blob://test/member-credentials/") && [...blobStore.keys()].some((k) => k.startsWith("member-credentials/")), String(c1.credential.attachmentUrl));

const c2 = await A.saveMemberCredential.handler(ctx, { id: null, userId: 2, type: "cpr_first_aid", customLabel: "", number: "", expiresOn: "2027-06-01", attachmentFilename: "", attachmentContentType: "", attachmentDataBase64: "", removeAttachment: false });
check("second credential for the same member", c2.credential.type === "cpr_first_aid" && c2.credential.attachmentUrl === null);
const c3 = await A.saveMemberCredential.handler(ctx, { id: null, userId: 3, type: "custom", customLabel: "Forklift operator", number: "FL-88", expiresOn: "", attachmentFilename: "", attachmentContentType: "", attachmentDataBase64: "", removeAttachment: false });
check("custom credential uses its custom label", c3.credential.typeLabel === "Forklift operator" && c3.credential.bucket === "no_expiry");
await checkThrows("custom credential without a label fails", () => A.saveMemberCredential.handler(ctx, { id: null, userId: 3, type: "custom", customLabel: "", number: "", expiresOn: "", attachmentFilename: "", attachmentContentType: "", attachmentDataBase64: "", removeAttachment: false }));
await checkThrows("credential for another company's member fails", () => A.saveMemberCredential.handler(ctx, { id: null, userId: 90, type: "osha_10", customLabel: "", number: "", expiresOn: "", attachmentFilename: "", attachmentContentType: "", attachmentDataBase64: "", removeAttachment: false }));

const upd = await A.saveMemberCredential.handler(ctx, { id: c1.credential.id, userId: 2, type: "osha_30", customLabel: "", number: "OSHA30-9999", expiresOn: "2028-01-01", attachmentFilename: "", attachmentContentType: "", attachmentDataBase64: "", removeAttachment: false });
check("credential update changes number/expiry, keeps attachment", upd.credential.number === "OSHA30-9999" && upd.credential.expiresOn === "2028-01-01" && upd.credential.attachmentUrl === c1.credential.attachmentUrl);
const upd2 = await A.saveMemberCredential.handler(ctx, { id: c1.credential.id, userId: 2, type: "osha_30", customLabel: "", number: "OSHA30-9999", expiresOn: "2028-01-01", attachmentFilename: "", attachmentContentType: "", attachmentDataBase64: "", removeAttachment: true });
check("credential attachment can be removed", upd2.credential.attachmentUrl === null && upd2.credential.attachmentFilename === "");

const credList = await A.listMemberCredentials.handler(ctx, { userId: null });
check("credential list returns the company's credentials", credList.credentials.length === 3, String(credList.credentials.length));
const credPerMember = await A.listMemberCredentials.handler(ctx, { userId: 2 });
check("per-member credential list filters", credPerMember.credentials.length === 2 && credPerMember.credentials.every((c: any) => c.userId === 2));
const credOther = await A.listMemberCredentials.handler(ctx2, { userId: null });
check("other company sees no credentials", credOther.credentials.length === 0);
await checkThrows("other company cannot update this credential", () => A.saveMemberCredential.handler(ctx2, { id: c2.credential.id, userId: 90, type: "osha_10", customLabel: "", number: "", expiresOn: "", attachmentFilename: "", attachmentContentType: "", attachmentDataBase64: "", removeAttachment: false }));
await checkThrows("other company cannot delete this credential", () => A.deleteMemberCredential.handler(ctx2, { id: c2.credential.id }));

// --- 9. Dashboard buckets ---------------------------------------------------------------
// Seed one credential per bucket against a fixed "today" (2026-11-01).
async function seedCred(userId: number, expiresOn: string) {
  return A.saveMemberCredential.handler(ctx, { id: null, userId, type: "osha_10", customLabel: "", number: "", expiresOn, attachmentFilename: "", attachmentContentType: "", attachmentDataBase64: "", removeAttachment: false });
}
await seedCred(1, "2026-10-31"); // expired (-1)
await seedCred(1, "2026-11-15"); // due30 (+14)
await seedCred(1, "2026-12-01"); // due30 boundary (+30)
await seedCred(3, "2026-12-02"); // due90 boundary (+31)
await seedCred(3, "2027-01-30"); // due90 boundary (+90)
await seedCred(2, "2027-01-31"); // ok boundary (+91) — joins c1 (2028) + c2 (2027-06) in ok
const dash = await A.getSafetyDashboard.handler(ctx, { today: "2026-11-01" });
check("dashboard counts: expired bucket", dash.counts.expired === 1, JSON.stringify(dash.counts));
check("dashboard counts: due30 bucket incl. +30 boundary", dash.counts.due30 === 2, JSON.stringify(dash.counts));
check("dashboard counts: due90 bucket incl. +31 and +90 boundaries", dash.counts.due90 === 2, JSON.stringify(dash.counts));
check("dashboard counts: ok bucket incl. +91 boundary", dash.counts.ok === 3, JSON.stringify(dash.counts));
check("dashboard counts: no-expiry bucket", dash.counts.noExpiry === 1, JSON.stringify(dash.counts));
check("dashboard bucket member lists carry names", dash.buckets.expired[0].memberName === "Danny Owner" && dash.buckets.due30.every((c: any) => c.bucket === "due30"));
check("dashboard session stats", dash.sessionCount === 3 && dash.sessionsThisMonth === 0 && dash.recentSessions.length === 3, JSON.stringify({ n: dash.sessionCount, m: dash.sessionsThisMonth }));
check("dashboard credential total", dash.credentialCount === 9, String(dash.credentialCount));

// Delete flows
await A.deleteMemberCredential.handler(ctx, { id: c3.credential.id });
check("credential delete removes the row", (await A.listMemberCredentials.handler(ctx, { userId: 3 })).credentials.every((c: any) => c.id !== c3.credential.id));
await A.deleteSafetySession.handler(ctx, { id: s3.session.id });
check("session delete removes session + attendees", (await db.select().from(schema.safetySessions).where(eq(schema.safetySessions.id, s3.session.id))).length === 0 && (await db.select().from(schema.safetySessionAttendees).where(eq(schema.safetySessionAttendees.sessionId, s3.session.id))).length === 0);

// --- 10. Job delete removes linked sessions ----------------------------------------------
const doomedJobId = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Doomed Dan", jobAddress: "1 Gone Way", jobType: "Demo", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const doomed = await A.createSafetySession.handler(ctx, { date: "2026-10-30", talkSlug: "ppe", lang: "en", customTitle: "", customBody: "", presenterUserId: 1, attendeeUserIds: [2], jobId: doomedJobId, signatureDataBase64: sigB64 });
await A.deleteJob.handler(ctx, { jobId: doomedJobId });
check("job delete removes the job's safety sessions", (await db.select().from(schema.safetySessions).where(eq(schema.safetySessions.jobId, doomedJobId))).length === 0);
check("job delete removes the sessions' attendee rows", (await db.select().from(schema.safetySessionAttendees).where(eq(schema.safetySessionAttendees.sessionId, doomed.session.id))).length === 0);
check("job delete leaves unlinked sessions alone", (await db.select().from(schema.safetySessions).where(eq(schema.safetySessions.id, s1.session.id))).length === 1);

// --- 11. Permission classification ---------------------------------------------------------
const MUTATIONS = ["createSafetySession", "deleteSafetySession", "saveMemberCredential", "deleteMemberCredential"];
const READS = ["listSafetyTalks", "listSafetySessions", "getSafetySession", "getSafetySessionPdf", "listMemberCredentials", "getSafetyDashboard"];
check("all safety mutations are Admin-only", MUTATIONS.every((n) => ADMIN_ACTIONS.has(n) && minRoleForAction(n) === "admin"), MUTATIONS.map((n) => `${n}:${minRoleForAction(n)}`).join(","));
check("non-admin roles are denied every safety mutation", MUTATIONS.every((n) => !roleCan("office", n) && !roleCan("field", n)));
check("safety reads are Office+", READS.every((n) => OFFICE_ACTIONS.has(n) && minRoleForAction(n) === "office"), READS.map((n) => `${n}:${minRoleForAction(n)}`).join(","));
check("field role gets no safety surface at all (no crew self-view in v1)", [...MUTATIONS, ...READS].every((n) => !roleCan("field", n)));
check("safety actions are not in the all-role set", [...MUTATIONS, ...READS].every((n) => !ALL_ROLE_ACTIONS.has(n)));
check("every safety action is registered", [...MUTATIONS, ...READS].every((n) => typeof (A as any)[n] === "object"));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
