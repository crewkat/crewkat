// Signed-docs auto-file behavior tests (Phase D, Danny 2026-10-14):
// a document belongs to exactly one job (documents.jobId), so the job's
// Docs section — the listDocuments / getJob feed filtered by jobId —
// shows the document from the moment it exists, and every signing event
// (contractor drawn save, client link signing, contractor tap-to-sign,
// portal countersign) updates that SAME single entry to the latest
// signed state. No per-event duplicates; nothing files to another job;
// and the Docs view opens the REAL signed PDF (the stored final), not
// just metadata.
//
// Run from app/:  bun signed-docs-autofile.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { PDFDocument } from "pdf-lib";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";
import { compositeSignatureStamps } from "./client/src/signatureComposite.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const dir = await mkdtemp(join(tmpdir(), "crewkat-sig-d-"));
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
  executePrivileged: async () => { throw new Error("not stubbed"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
} as any;
const A = BaseActions as any;
const now = new Date();
await db.insert(schema.authUsers).values({ companyId: 1, name: "Danny Owner", email: "owner@test.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH", createdAt: now, updatedAt: now });
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Stallions Construction Company LLC", updatedAt: now });
async function makeJob(clientName: string): Promise<number> {
  return (await db.insert(schema.jobs).values({ companyId: 1, clientName, jobAddress: "1 Main St", jobType: "Remodel", jobDate: "2026-10-14", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
}
const jobA = await makeJob("Denny");
const jobB = await makeJob("Other Client");
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const pngBase64 = pngBytes.toString("base64");
async function makePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText("Pad contract", { x: 48, y: 720, size: 14 });
  return pdf.save();
}
const pdfBase64 = Buffer.from(await makePdf()).toString("base64");

const docsFor = async (jobId: number) => (await A.listDocuments.handler(ctx, {})).documents.filter((d: any) => d.jobId === jobId);
const entriesFor = async (jobId: number, docId: number) => (await docsFor(jobId)).filter((d: any) => d.id === docId);

// 1. The contractor's drawn save IS the first signing event: the
// document files itself to its job immediately, exactly once.
const saved = await A.saveDocument.handler(ctx, {
  jobId: jobA, kind: "contract", title: "Concrete pad contract", bodyText: "",
  originalFilename: "pad.pdf", originalDataBase64: pdfBase64,
  description: "", amount: "", signerName: "Denny",
  signatureDataBase64: pngBase64, signedAt: now.toISOString(),
});
check("signed document appears in its job's Docs", (await entriesFor(jobA, saved.id)).length === 1);
check("nothing files to the other job", (await entriesFor(jobB, saved.id)).length === 0 && (await docsFor(jobB)).length === 0);
const jobView = await A.getJob.handler(ctx, { id: jobA });
check("getJob hydration agrees (same single entry)", jobView.documents.filter((d: any) => d.id === saved.id).length === 1);
const filedOnce = (await entriesFor(jobA, saved.id))[0];
check("fresh entry is contractor-signed only (no client signature yet)", !filedOnce.clientSignedAt && !!filedOnce.signedAt);

// 2. The client signs through the public link: SAME entry updates to
// the fully signed state — still one entry, now with the real final.
const link = await A.createDocumentLink.handler(ctx, { kind: "contract", id: saved.id });
const payload = await A.resolveDocumentLink.handler(ctx, { token: link.token, userAgent: "test" });
const clientFinal = await compositeSignatureStamps(Buffer.from(pdfBase64, "base64"), payload.signatureFields ?? {}, [
  { role: "client", imageBytes: pngBytes, imageFormat: "png", dateText: "October 14, 2026" },
]);
await A.submitDocumentSignature.handler(ctx, {
  token: link.token, signerName: "Denny", signatureDataBase64: pngBase64,
  signedPdfDataBase64: Buffer.from(clientFinal).toString("base64"), userAgent: "test", consented: true,
});
const afterClient = await entriesFor(jobA, saved.id);
check("client signing updates the SAME entry (still exactly one)", afterClient.length === 1);
check("updated entry reflects the fully signed state", !!afterClient[0].clientSignedAt && afterClient[0].clientSignerName === "Denny");
check("updated entry opens the real signed PDF", !!afterClient[0].signedPdfUrl);

// 3. A second signing event (contractor draw-to-sign) still doesn't
// duplicate the entry.
await A.signDocumentWithDrawnSignature.handler(ctx, { documentId: saved.id, signatureDataBase64: pngBase64 });
check("draw-to-sign keeps the single Docs entry", (await entriesFor(jobA, saved.id)).length === 1);
check("total document rows for the job stay at one per document", (await docsFor(jobA)).length === 1);

// 4. Unlinked documents cannot exist in this model (jobId is required
// and NOT NULL), so nothing can file "nowhere" or to the wrong job.
let rejected = false;
try {
  await A.saveDocument.handler(ctx, {
    jobId: 999999, kind: "contract", title: "Orphan", bodyText: "",
    originalFilename: "", originalDataBase64: "",
    description: "", amount: "", signerName: "X",
    signatureDataBase64: pngBase64, signedAt: now.toISOString(),
  });
} catch { rejected = true; }
check("a document for a nonexistent job is rejected (no orphan filings)", rejected);
check("no stray rows were created", (await A.listDocuments.handler(ctx, {})).documents.length === 1);

// 5. Docs panel wiring: filter by job + truthful status + real-PDF open.
const appSrc = await readFile("client/src/App.tsx", "utf8");
const panelSrc = appSrc.slice(appSrc.indexOf("function WorkspaceDocumentsPanel"), appSrc.indexOf("type FinData"));
check("Docs panel filters documents by the job", panelSrc.includes("documents.filter((d) => d.jobId === jobId)"));
check("Docs panel opens the stored signed PDF", panelSrc.includes("d.signedPdfUrl ?? d.originalUrl") && panelSrc.includes("Open signed PDF"));
check("Docs panel status is truthful (contractor vs fully signed)", panelSrc.includes('"Contractor signed"') && panelSrc.includes('"Fully signed"'));
check("Docs list rows carry the same status", panelSrc.includes("statusLabel(d)"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
