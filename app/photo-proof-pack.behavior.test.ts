// Photo Proof Pack behavior tests (Danny 2026-10-14, phase 2 of the
// 2→3→1 program — teardown opportunity #5: CompanyCam's core paid value
// folded into Crewkat's existing job flow).
//
// What existed before this build: job photos with stages + blob storage,
// a canvas markup editor (PhotoAnnotator: pen/circle/arrow/text, 3 ink
// colors, undo/clear) that saves a marked-up COPY via addPhoto with
// annotatedFromId, a static branded before/after composite for social
// (share_images), and a client portal that already lists job photos.
// What this build adds (migration 0080): persistent Before/After PAIRS
// (photo_pairs) rendered as a swipe-slider in the job's Photos surfaces
// and in the client portal.
//
// Covers:
//  1. Journal/migration: newest tag is 0080_photo_pairs, when strictly
//     increasing; photo_pairs table shape after migrate.
//  2. Pair CRUD: create + list (hydrated with both photos), label update,
//     unpair deletes only the pairing (photos survive).
//  3. Validation: same photo on both sides rejected; a photo from
//     another job rejected; list is scoped to the requested job.
//  4. Deleting a photo removes its pairs; the other photo survives.
//  5. Portal: getPortalData carries the pair for the token's job only,
//     and a pair touching a "Not for social" (excludeFromSocial) photo
//     is withheld from the portal while the contractor still sees it.
//  6. Markup regression: addPhoto with annotatedFromId creates a NEW
//     photo row (the marked-up copy); the original row is untouched,
//     and the copy itself can be used in a pair.
//  7. Static guards: slider + pair manager + portal render in App.tsx,
//     slider styles in theme.css, pair actions registered server-side,
//     and NO new public actions (pairs are contractor-side only).
//
// Run from app/:  bun photo-proof-pack.behavior.test.ts
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
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function checkThrows(name: string, fn: () => Promise<unknown>) {
  try { await fn(); check(name, false, "did not throw"); }
  catch { check(name, true); }
}

// --- 1. Journal + migration -----------------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
const byTag = Object.fromEntries(entries.map((e) => [e.tag, e]));
check("newest migration tag is 0090_office_wave1", entries[entries.length - 1]!.tag === "0090_office_wave1", entries[entries.length - 1]!.tag);
check("0080 when strictly greater than 0079", byTag["0080_photo_pairs"]!.when > byTag["0079_saved_signature"]!.when);
const sql80 = await readFile(join("drizzle", "0080_photo_pairs.sql"), "utf8");
check("0080 creates photo_pairs", sql80.includes("CREATE TABLE `photo_pairs`"));
check("0080 pair points at two photos of one job", sql80.includes("`before_photo_id`") && sql80.includes("`after_photo_id`") && sql80.includes("`job_id`"));

const appSrc = await readFile("client/src/App.tsx", "utf8");
const cssSrc = await readFile("client/src/theme.css", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");

// --- 2. Scratch DB + ctx -----------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-proof-pack-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
const pairCols = (await sqlite.execute("PRAGMA table_info(photo_pairs)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrated photo_pairs has the pair columns", ["company_id", "job_id", "before_photo_id", "after_photo_id", "label", "created_at"].every((c) => pairCols.includes(c)), pairCols.join(","));

const ctx = {
  slug: "tradesign",
  invocationId: "proof-pack-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "image/jpeg", size: 3 }),
  },
  executePrivileged: async () => { throw new Error("unexpected privileged call"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;
const A = BaseActions as any;

await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Proof Co", updatedAt: new Date() });

const jobArgs = { clientPhone: "", clientEmail: "", notes: "", jobDate: "2026-10-20", appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "" };
const job1 = await A.createJob.handler(ctx, { ...jobArgs, clientName: "Pair Client", jobAddress: "1 Proof Way", jobType: "Bathroom remodel" });
const job2 = await A.createJob.handler(ctx, { ...jobArgs, clientName: "Other Client", jobAddress: "9 Elsewhere St", jobType: "Kitchen remodel" });

const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
const addPhoto = (jobId: number, stage: string, caption: string, extra: Record<string, unknown> = {}) =>
  A.addPhoto.handler(ctx, { jobId, stage, caption, filename: `${stage}-${caption || "x"}.jpg`, contentType: "image/jpeg", capturedAt: new Date().toISOString(), dataBase64: tinyPng, annotatedFromId: null, ...extra });

const before1 = await addPhoto(job1.id, "before", "Bath before");
const after1 = await addPhoto(job1.id, "after", "Bath after");
const during1 = await addPhoto(job1.id, "during", "Bath during");
const otherBefore = await addPhoto(job2.id, "before", "Other job before");

// --- 3. Pair CRUD ------------------------------------------------------------------
const created = await A.createPhotoPair.handler(ctx, { jobId: job1.id, beforePhotoId: before1.id, afterPhotoId: after1.id, label: "Main bathroom" });
check("createPhotoPair returns an id", typeof created.id === "number" && created.id > 0);
const listed1 = await A.listPhotoPairs.handler(ctx, { jobId: job1.id });
check("list returns the pair for the job", listed1.pairs.length === 1 && listed1.pairs[0].id === created.id);
const pair = listed1.pairs[0];
check("pair is hydrated with both photos", pair.before.id === before1.id && pair.after.id === after1.id && pair.before.caption === "Bath before" && pair.after.caption === "Bath after");
check("pair photos carry blob urls for the slider", pair.before.url.startsWith("blob://test/") && pair.after.url.startsWith("blob://test/"), `${pair.before.url} / ${pair.after.url}`);
check("pair label round-trips", pair.label === "Main bathroom", pair.label);

const second = await A.createPhotoPair.handler(ctx, { jobId: job1.id, beforePhotoId: before1.id, afterPhotoId: during1.id, label: "" });
const listed2 = await A.listPhotoPairs.handler(ctx, { jobId: job1.id });
check("multiple pairs per job are allowed", listed2.pairs.length === 2);
check("pairs list in creation order", listed2.pairs[0].id === created.id && listed2.pairs[1].id === second.id);

await A.updatePhotoPair.handler(ctx, { id: second.id, label: "Vanity wall" });
const listed3 = await A.listPhotoPairs.handler(ctx, { jobId: job1.id });
check("label update persists", listed3.pairs.find((p: any) => p.id === second.id)?.label === "Vanity wall");

await A.deletePhotoPair.handler(ctx, { id: second.id });
const listed4 = await A.listPhotoPairs.handler(ctx, { jobId: job1.id });
check("unpair removes only the pairing", listed4.pairs.length === 1 && listed4.pairs[0].id === created.id);
const jobAfterUnpair = await A.getJob.handler(ctx, { id: job1.id });
check("unpair never deletes the photos", jobAfterUnpair.photos.length === 3, String(jobAfterUnpair.photos.length));

// --- 4. Validation -------------------------------------------------------------------
await checkThrows("same photo on both sides is rejected", () => A.createPhotoPair.handler(ctx, { jobId: job1.id, beforePhotoId: before1.id, afterPhotoId: before1.id, label: "" }));
await checkThrows("a photo from another job is rejected", () => A.createPhotoPair.handler(ctx, { jobId: job1.id, beforePhotoId: otherBefore.id, afterPhotoId: after1.id, label: "" }));
await checkThrows("a nonexistent photo is rejected", () => A.createPhotoPair.handler(ctx, { jobId: job1.id, beforePhotoId: 999999, afterPhotoId: after1.id, label: "" }));
const otherList = await A.listPhotoPairs.handler(ctx, { jobId: job2.id });
check("pair list is scoped to the requested job", otherList.pairs.length === 0);

// --- 5. Markup copy (existing annotator path) -----------------------------------------
const originalRow = (await db.select().from(schema.photos).where(eq(schema.photos.id, after1.id)))[0]!;
const copy = await addPhoto(job1.id, "after", "Bath after — Marked up", { annotatedFromId: after1.id });
check("markup save creates a NEW photo row", copy.id !== after1.id && typeof copy.id === "number");
const copyRow = (await db.select().from(schema.photos).where(eq(schema.photos.id, copy.id)))[0]!;
check("the copy records what it was annotated from", copyRow.annotatedFromId === after1.id);
const originalAfter = (await db.select().from(schema.photos).where(eq(schema.photos.id, after1.id)))[0]!;
check("the original photo is untouched by markup", originalAfter.blobKey === originalRow.blobKey && originalAfter.caption === originalRow.caption && originalAfter.annotatedFromId === null);
const copyPair = await A.createPhotoPair.handler(ctx, { jobId: job1.id, beforePhotoId: before1.id, afterPhotoId: copy.id, label: "Marked-up reveal" });
const listed5 = await A.listPhotoPairs.handler(ctx, { jobId: job1.id });
check("a marked-up copy can itself be used in a pair", listed5.pairs.some((p: any) => p.id === copyPair.id && p.after.id === copy.id));

// --- 6. Portal payload ------------------------------------------------------------------
const portal = await A.createPortalLink.handler(ctx, { jobId: job1.id, expiresInDays: 90 });
const portalData = await A.getPortalData.handler(ctx, { token: portal.token });
check("portal carries the job's pairs", Array.isArray(portalData.photoPairs) && portalData.photoPairs.length === 2, JSON.stringify(portalData.photoPairs?.length));
const portalPair = portalData.photoPairs.find((p: any) => p.id === created.id);
check("portal pair is slider-ready (label + both urls)", !!portalPair && portalPair.label === "Main bathroom" && portalPair.before.url.startsWith("blob://test/") && portalPair.after.url.startsWith("blob://test/"));
check("portal pair exposes no contractor internals", !!portalPair && !("beforePhotoId" in portalPair) && !("companyId" in portalPair));

// A pair touching a Not-for-social photo is withheld from the portal.
const hiddenPhoto = await addPhoto(job1.id, "after", "Hidden after");
await db.update(schema.photos).set({ excludeFromSocial: true }).where(eq(schema.photos.id, hiddenPhoto.id));
const hiddenPair = await A.createPhotoPair.handler(ctx, { jobId: job1.id, beforePhotoId: before1.id, afterPhotoId: hiddenPhoto.id, label: "Secret pair" });
const portalData2 = await A.getPortalData.handler(ctx, { token: portal.token });
check("portal withholds a pair touching an excluded photo", !portalData2.photoPairs.some((p: any) => p.id === hiddenPair.id));
const contractorList = await A.listPhotoPairs.handler(ctx, { jobId: job1.id });
check("contractor still sees the excluded-photo pair", contractorList.pairs.some((p: any) => p.id === hiddenPair.id));

// Another job's portal never sees job1 pairs.
const portal2 = await A.createPortalLink.handler(ctx, { jobId: job2.id, expiresInDays: 90 });
const portalDataOther = await A.getPortalData.handler(ctx, { token: portal2.token });
check("another job's portal has none of this job's pairs", portalDataOther.photoPairs.length === 0, JSON.stringify(portalDataOther.photoPairs?.length));

// --- 7. Deleting a photo removes its pairs ------------------------------------------------
await A.deletePhoto.handler(ctx, { id: hiddenPhoto.id, jobId: job1.id });
const listed6 = await A.listPhotoPairs.handler(ctx, { jobId: job1.id });
check("deleting a photo removes pairs that used it", !listed6.pairs.some((p: any) => p.id === hiddenPair.id) && listed6.pairs.length === 2, String(listed6.pairs.length));
const surviving = await A.getJob.handler(ctx, { id: job1.id });
check("the pair's other photo survives the delete", surviving.photos.some((p: any) => p.id === before1.id));

// --- 8. Static guards -----------------------------------------------------------------------
check("server registers the pair actions", ["createPhotoPair", "listPhotoPairs", "updatePhotoPair", "deletePhotoPair"].every((n) => serverSrc.includes(`${n}: defineAction`)));
check("portal payload includes photoPairs", serverSrc.includes("photoPairs:z.array") && serverSrc.includes("photoPairs:await"));
check("pair actions are NOT public actions", !serverSrc.slice(serverSrc.indexOf("const PUBLIC_ACTIONS"), serverSrc.indexOf("const PREMIUM_ACTIONS")).match(/createPhotoPair|listPhotoPairs|updatePhotoPair|deletePhotoPair/));
check("photo_pairs is in the backup table list", serverSrc.includes('"photo_pairs"'));
check("client has the BeforeAfterSlider component", appSrc.includes("function BeforeAfterSlider") && appSrc.includes("ba-frame") && appSrc.includes("clipPath"));
check("client has the pair manager", appSrc.includes("function JobPhotoPairs") && appSrc.includes("api.createPhotoPair") && appSrc.includes("api.deletePhotoPair"));
check("pair manager is mounted in the job photos surfaces", (appSrc.match(/<JobPhotoPairs/g) ?? []).length >= 2);
check("portal renders the pairs slider read-only", appSrc.includes("d.photoPairs") && appSrc.includes("portal-v2-pairs"));
check("slider styles exist", cssSrc.includes(".ba-frame") && cssSrc.includes(".ba-handle") && cssSrc.includes(".photo-pairs"));
check("markup editor still offers pen/arrow/text + 3 colors + undo/clear", appSrc.includes("MARKUP_COLORS = [\"#ef3d2f\", \"#ffc400\", \"#ffffff\"]") && appSrc.includes("function PhotoAnnotator"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
