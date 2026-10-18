// Portal shared files behavior tests (0083, Danny 2026-10-17): view-only
// files a contractor uploads to a job (scope sheets, plans, permits) that
// the client sees in the client portal. NOT signature documents — a
// separate job_files table, no placement/fill fields, visibility driven
// only by shared_with_client.
//
// Covers:
//  1. Migration 0083: job_files table, journal tag 0083_job_files, when
//     strictly increasing.
//  2. uploadJobFile stores the blob + row (title falls back to filename,
//     shared by default, size recorded); wrong content type and oversized
//     payloads are rejected.
//  3. getJob lists the job's files newest first with urls + shared flags.
//  4. getPortalData carries shared files only; setJobFileShared toggles
//     portal visibility without removing the contractor's row.
//  5. deleteJobFile removes the row and the blob.
//  6. A portal token for a different job never returns the file.
//
// Run from app/:  bun portal-shared-files.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
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
const throwsAsync = async (name: string, fn: () => Promise<unknown>, messagePart = "") => {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(name, !messagePart || msg.includes(messagePart), messagePart ? `threw "${msg}"` : "");
  }
};

// --- 1. Migration ---------------------------------------------------------------
const journal = await import("./drizzle/meta/_journal.json");
const entries = (journal as any).entries ?? (journal as any).default.entries;
const byTag = Object.fromEntries(entries.map((e: any) => [e.tag, e]));
check("newest migration tag is 0084_support_screenshots", entries[entries.length - 1].tag === "0084_support_screenshots", entries[entries.length - 1].tag);
check("0083 when strictly greater than 0082", byTag["0083_job_files"].when > byTag["0082_fill_fields"].when);
const sql83 = await readFile(join("drizzle", "0083_job_files.sql"), "utf8");
check("0083 creates job_files", sql83.includes("CREATE TABLE `job_files`"));
check("0083 job_files points at jobs", sql83.includes("REFERENCES `jobs`(`id`)"));

// --- 2. Scratch DB + ctx -----------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-shared-files-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
const fileCols = (await sqlite.execute("PRAGMA table_info(job_files)")).rows.map((r) => (r as any).name as string);
check("migrated job_files has the file columns", ["company_id", "job_id", "title", "filename", "blob_key", "content_type", "size_bytes", "shared_with_client", "created_at"].every((c) => fileCols.includes(c)), fileCols.join(","));

const blobStore = new Map<string, Buffer>();
const ctx = {
  slug: "tradesign",
  invocationId: "shared-files-test",
  spaceDir: dir,
  db: () => db,
  unscopedDb: () => db,
  blobs: {
    put: async (key: string, data: Buffer) => { blobStore.set(key, Buffer.from(data)); },
    get: async (key: string) => blobStore.get(key) ?? null,
    getUrl: async (key: string) => `blob://test/${key}`,
    delete: async (key: string) => { blobStore.delete(key); },
    head: async () => ({ contentType: "application/pdf", size: 0 }),
  },
  executePrivileged: async () => { throw new Error("unexpected privileged call"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;
const A = BaseActions as any;

const now = new Date();
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Stallions Construction Company LLC", updatedAt: now });
const jobArgs = { clientPhone: "", clientEmail: "", notes: "", jobDate: "2026-10-20", appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "" };
const job1 = await A.createJob.handler(ctx, { ...jobArgs, clientName: "Anthony Porreca", jobAddress: "2337 Eastwood Dr", jobType: "Garage conversion" });
const job2 = await A.createJob.handler(ctx, { ...jobArgs, clientName: "Other Client", jobAddress: "9 Elsewhere St", jobType: "Kitchen remodel" });

// --- 3. Upload -----------------------------------------------------------------------
const pdfBytes = Buffer.from("%PDF-1.4 fake scope sheet bytes for the test", "utf8");
const up1 = await A.uploadJobFile.handler(ctx, { jobId: job1.id, title: "", filename: "garage-scope.pdf", contentType: "application/pdf", dataBase64: pdfBytes.toString("base64") });
check("uploadJobFile returns an id", typeof up1.id === "number" && up1.id > 0);
const up2 = await A.uploadJobFile.handler(ctx, { jobId: job1.id, title: "Permit set", filename: "permits.png", contentType: "image/png", dataBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6]).toString("base64") });
check("second upload returns a distinct id", typeof up2.id === "number" && up2.id !== up1.id);

const job1Data = await A.getJob.handler(ctx, { id: job1.id });
check("getJob lists both files", job1Data.jobFiles.length === 2, String(job1Data.jobFiles.length));
check("getJob lists files newest first", job1Data.jobFiles[0].id === up2.id && job1Data.jobFiles[1].id === up1.id);
const row1 = job1Data.jobFiles.find((f: any) => f.id === up1.id);
check("empty title falls back to the filename", row1?.title === "garage-scope.pdf", row1?.title);
check("explicit title is kept", job1Data.jobFiles.find((f: any) => f.id === up2.id)?.title === "Permit set");
check("file row carries filename + content type", row1?.filename === "garage-scope.pdf" && row1?.contentType === "application/pdf");
check("file row records the decoded size", row1?.sizeBytes === pdfBytes.length, String(row1?.sizeBytes));
check("files are shared with the client by default", row1?.sharedWithClient === true);
check("file row url resolves from the blob key", typeof row1?.url === "string" && row1.url.startsWith("blob://test/job-files/"), row1?.url);
check("the blob was stored under job-files/<jobId>/", [...blobStore.keys()].some((k) => k.startsWith(`job-files/${job1.id}/`) && k.endsWith("-garage-scope.pdf")), [...blobStore.keys()].join(","));

const missingJob = await A.getJob.handler(ctx, { id: 999999 });
check("getJob for a missing job returns jobFiles: []", missingJob.job === null && Array.isArray(missingJob.jobFiles) && missingJob.jobFiles.length === 0);

// --- 4. Portal visibility ---------------------------------------------------------------
const portal = await A.createPortalLink.handler(ctx, { jobId: job1.id, expiresInDays: 90 });
const portalData = await A.getPortalData.handler(ctx, { token: portal.token });
check("portal carries the shared files", Array.isArray(portalData.files) && portalData.files.length === 2, JSON.stringify(portalData.files?.length));
check("portal files are newest first", portalData.files[0].id === up2.id && portalData.files[1].id === up1.id);
const portalFile = portalData.files.find((f: any) => f.id === up1.id);
check("portal file is view-ready (title + filename + url)", !!portalFile && portalFile.title === "garage-scope.pdf" && portalFile.filename === "garage-scope.pdf" && portalFile.url.startsWith("blob://test/"));
check("portal file exposes no contractor internals", !!portalFile && !("sharedWithClient" in portalFile) && !("blobKey" in portalFile) && !("companyId" in portalFile));

await A.setJobFileShared.handler(ctx, { id: up1.id, shared: false });
const afterHide = await A.getPortalData.handler(ctx, { token: portal.token });
check("portal excludes the unshared file", afterHide.files.length === 1 && afterHide.files[0].id === up2.id);
const jobAfterHide = await A.getJob.handler(ctx, { id: job1.id });
check("contractor still sees the hidden file, flagged", jobAfterHide.jobFiles.find((f: any) => f.id === up1.id)?.sharedWithClient === false && jobAfterHide.jobFiles.length === 2);

await A.setJobFileShared.handler(ctx, { id: up1.id, shared: true });
const afterReshare = await A.getPortalData.handler(ctx, { token: portal.token });
check("portal includes the file again after re-sharing", afterReshare.files.length === 2 && afterReshare.files.some((f: any) => f.id === up1.id));

// --- 5. Delete ----------------------------------------------------------------------------
const up2Key = [...blobStore.keys()].find((k) => k.endsWith("-permits.png"));
check("second file's blob exists before delete", !!up2Key);
await A.deleteJobFile.handler(ctx, { id: up2.id });
const jobAfterDelete = await A.getJob.handler(ctx, { id: job1.id });
check("getJob no longer lists the deleted file", jobAfterDelete.jobFiles.length === 1 && jobAfterDelete.jobFiles[0].id === up1.id);
const portalAfterDelete = await A.getPortalData.handler(ctx, { token: portal.token });
check("portal no longer lists the deleted file", portalAfterDelete.files.length === 1 && portalAfterDelete.files[0].id === up1.id);
check("delete removes the blob too", up2Key ? !blobStore.has(up2Key) : false);
await throwsAsync("deleting a missing file is rejected", () => A.deleteJobFile.handler(ctx, { id: up2.id }), "File not found.");

// --- 6. Cross-job isolation -------------------------------------------------------------------
const portal2 = await A.createPortalLink.handler(ctx, { jobId: job2.id, expiresInDays: 90 });
const portalDataOther = await A.getPortalData.handler(ctx, { token: portal2.token });
check("another job's portal has none of this job's files", portalDataOther.files.length === 0, JSON.stringify(portalDataOther.files?.length));
const upOther = await A.uploadJobFile.handler(ctx, { jobId: job2.id, title: "Kitchen plans", filename: "kitchen-plans.pdf", contentType: "application/pdf", dataBase64: pdfBytes.toString("base64") });
const portalDataOther2 = await A.getPortalData.handler(ctx, { token: portal2.token });
check("the other job's portal sees only its own file", portalDataOther2.files.length === 1 && portalDataOther2.files[0].id === upOther.id);
const portalDataAgain = await A.getPortalData.handler(ctx, { token: portal.token });
check("the first job's portal never gains the other job's file", !portalDataAgain.files.some((f: any) => f.id === upOther.id));

// --- 7. Validation -----------------------------------------------------------------------------
await throwsAsync("a wrong content type is rejected", () => A.uploadJobFile.handler(ctx, { jobId: job1.id, title: "", filename: "notes.txt", contentType: "text/plain", dataBase64: pdfBytes.toString("base64") }), "Only PDF, JPEG, PNG, or WebP");
await throwsAsync("an oversized payload is rejected", () => A.uploadJobFile.handler(ctx, { jobId: job1.id, title: "", filename: "huge.pdf", contentType: "application/pdf", dataBase64: Buffer.alloc(15_000_001, 7).toString("base64") }), "File is too large (max 15 MB).");
await throwsAsync("an upload to a missing job is rejected", () => A.uploadJobFile.handler(ctx, { jobId: 999999, title: "", filename: "x.pdf", contentType: "application/pdf", dataBase64: pdfBytes.toString("base64") }), "Job not found.");
const jobAfterRejects = await A.getJob.handler(ctx, { id: job1.id });
check("rejected uploads stored nothing", jobAfterRejects.jobFiles.length === 1, String(jobAfterRejects.jobFiles.length));

// --- 8. Source wiring ----------------------------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");
check("job page renders the shared-files group", appSrc.includes("Shared files") && appSrc.includes("Archivos compartidos"));
check("job page uploads through the action", appSrc.includes("api.uploadJobFile"));
check("job page toggles sharing through the action", appSrc.includes("api.setJobFileShared"));
check("job page deletes through the action", appSrc.includes("api.deleteJobFile"));
check("job page shows the client-visibility chip", appSrc.includes("Client can see") && appSrc.includes("El cliente lo ve") && appSrc.includes("Hidden") && appSrc.includes("Oculto"));
check("portal page renders the files section", appSrc.includes("(d.files ?? []).length > 0") && appSrc.includes("t.documents"));
check("job + portal file lists are stale-cache safe (guarded reads)", appSrc.includes("(query.data.jobFiles ?? []).length") && appSrc.includes("(d.files ?? []).map"));
check("server registers uploadJobFile", serverSrc.includes("uploadJobFile: defineAction"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
