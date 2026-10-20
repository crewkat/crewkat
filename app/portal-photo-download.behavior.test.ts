// Portal photo downloads (Danny 2026-10-20): clients viewing job photos
// in the client portal can save them. The lightbox gains a Download /
// Descargar button; the bytes come from a new PUBLIC action,
// getPortalPhotoDownload, whose only credential is the portal token.
//
// Covers:
//  1. The token's own job photo downloads: original filename, content
//     type, and the EXACT full-size blob bytes (not a thumbnail).
//  2. Cross-job isolation: job B's token cannot download job A's photo
//     by id, and a made-up photo id is refused the same way.
//  3. A photo the portal never lists (excludeFromSocial) is refused too.
//  4. A revoked portal token cannot download anything.
//  5. Source wiring: action registered public, lightbox button + handler,
//     EN/ES label, CSS.
//
// Run from app/:  bun portal-photo-download.behavior.test.ts
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

// --- Harness -------------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-portal-photo-dl-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const blobStore = new Map<string, Buffer>();
const ctx = {
  db: () => db,
  unscopedDb: () => db,
  blobs: {
    put: async (key: string, data: Buffer) => { blobStore.set(key, Buffer.from(data)); },
    get: async (key: string) => blobStore.get(key) ?? null,
    getUrl: async (key: string) => `https://crewkat.com/blobs/${key}`,
    delete: async (key: string) => { blobStore.delete(key); },
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
const mkJob = async (clientName: string, jobAddress: string) =>
  (await db.insert(schema.jobs).values({ companyId: 1, clientName, clientEmail: "", jobAddress, jobType: "Garage conversion", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const jobA = await mkJob("Anthony Porreca", "2337 Eastwood Dr");
const jobB = await mkJob("Other Client", "9 Elsewhere St");

// Distinctive "full-size" bytes so a thumbnail substitution would fail.
const fullBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("FULL-SIZE-ORIGINAL-".repeat(64)), Buffer.from([0xff, 0xd9])]);
async function mkPhoto(jobId: number, filename: string, opts: { excludeFromSocial?: boolean } = {}): Promise<number> {
  const blobKey = `photos/${jobId}/${filename}`;
  await ctx.blobs.put(blobKey, fullBytes);
  const row = (await db.insert(schema.photos).values({
    companyId: 1, jobId, stage: "during", caption: "Progress", blobKey, filename,
    contentType: "image/jpeg", excludeFromSocial: opts.excludeFromSocial ?? false, createdAt: now,
  }).returning({ id: schema.photos.id }))[0]!;
  return row.id;
}
const photoA = await mkPhoto(jobA, "garage-progress.jpg");
const photoAhidden = await mkPhoto(jobA, "internal-only.jpg", { excludeFromSocial: true });
const photoB = await mkPhoto(jobB, "other-job.jpg");

const portalA = await A.createPortalLink.handler(ctx, { jobId: jobA, expiresInDays: 90 });
const portalB = await A.createPortalLink.handler(ctx, { jobId: jobB, expiresInDays: 90 });

// --- 1. Own photo downloads with the exact bytes ----------------------------------
const dl = await A.getPortalPhotoDownload.handler(ctx, { token: portalA.token, photoId: photoA });
check("download returns the original filename", dl.filename === "garage-progress.jpg", dl.filename);
check("download returns the photo content type", dl.contentType === "image/jpeg", dl.contentType);
check("download returns the exact full-size blob bytes", Buffer.from(dl.dataBase64, "base64").equals(fullBytes), `decoded ${Buffer.from(dl.dataBase64, "base64").length} of ${fullBytes.length} bytes`);

// Portal payload sanity: the listed photo is the downloadable one.
const dataA = await A.getPortalData.handler(ctx, { token: portalA.token });
check("portal lists the visible photo (and only it)", dataA.photos.length === 1 && dataA.photos[0].id === photoA, JSON.stringify(dataA.photos?.map((p: any) => p.id)));

// --- 2. Cross-job + guessed ids ------------------------------------------------------
let crossThrew = false;
try { await A.getPortalPhotoDownload.handler(ctx, { token: portalB.token, photoId: photoA }); } catch { crossThrew = true; }
check("job B's token cannot download job A's photo", crossThrew);
const dlB = await A.getPortalPhotoDownload.handler(ctx, { token: portalB.token, photoId: photoB });
check("job B's token downloads its own photo", dlB.filename === "other-job.jpg" && Buffer.from(dlB.dataBase64, "base64").equals(fullBytes));
let guessThrew = false;
try { await A.getPortalPhotoDownload.handler(ctx, { token: portalA.token, photoId: 999999 }); } catch { guessThrew = true; }
check("a made-up photo id is refused", guessThrew);

// --- 3. Portal-hidden photo is refused -------------------------------------------------
let hiddenThrew = false;
try { await A.getPortalPhotoDownload.handler(ctx, { token: portalA.token, photoId: photoAhidden }); } catch { hiddenThrew = true; }
check("an excludeFromSocial photo of the same job is refused", hiddenThrew);

// --- 4. Revoked token --------------------------------------------------------------------
const rowB = (await db.select().from(schema.portalTokens)).find((t: any) => t.jobId === jobB);
if (rowB) await db.update(schema.portalTokens).set({ revokedAt: new Date() }).where(eq(schema.portalTokens.id, rowB.id));
let revokedThrew = false;
try { await A.getPortalPhotoDownload.handler(ctx, { token: portalB.token, photoId: photoB }); } catch { revokedThrew = true; }
check("a revoked portal token cannot download", revokedThrew);

// --- 5. Source wiring ----------------------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");
const cssSrc = await readFile("client/src/theme.css", "utf8");
check("action is registered public (no session needed)", serverSrc.includes('"getPortalData", "getPortalPhotoDownload"'));
check("action scopes the photo to the token's job", serverSrc.includes("photo.jobId !== access.jobId"));
check("lightbox renders the download button", appSrc.includes("portal-v2-lightbox-download") && appSrc.includes("downloadPortalPhoto(lightbox.id)"));
check("lightbox button label is bilingual", appSrc.includes('download: lang === "es" ? "Descargar" : "Download"'));
check("grid opens the lightbox with the photo id", appSrc.includes("setLightbox({ id: p.id, url: p.url })"));
check("download button styling exists", cssSrc.includes(".portal-v2-lightbox-download"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
