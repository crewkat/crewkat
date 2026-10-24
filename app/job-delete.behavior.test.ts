// Jobs swipe-to-delete (Danny 2026-10-24): sliding a job card reveals a
// red Delete button; a floating "Delete this job?" confirm names what is
// attached, and confirming deletes the job.
//
// Cascade model (follows the schema's FK design):
//  - Job-OWNED rows die with the job: documents (contracts + change
//    orders, signed included — only through this warned confirm),
//    photos + pairs, shared files, portal tokens (+ link events),
//    document links for those documents, job messages, notifications
//    pointing at the job/its documents, and the job's operational
//    records. Blobs are cleaned up best-effort.
//  - INDEPENDENT client documents survive, unlinked (schema: job_id
//    nullable, onDelete set null): estimates, invoices — and payments,
//    which hang off invoices, not jobs — plus appointments.
// The whole cascade runs as one atomic db.batch.
//
// Covers:
//  1. getJobDeletePreview counts (documents/signed/photos/files,
//     invoices/payments/estimates that survive, portal link flag).
//  2. deleteJob removes the job + every job-owned row, deletes blobs,
//     and leaves invoices/payments/quotes/appointments intact with
//     job_id null; the invoice-kind document link that shares a numeric
//     id with a deleted contract is NOT touched.
//  3. Empty job deletes cleanly; listJobs no longer returns either job.
//  4. Ownership: another company's job can be neither previewed nor
//     deleted ("Job not found."), and a missing job id errors too.
//  5. Client wiring: Jobs list rows are SwipeRows with a danger Delete,
//     controlled one-open state, tap-guard on open cards, FloatPopup
//     confirm copy EN + ES, and the delete CSS.
//
// Run from app/:  bun job-delete.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
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
const dir = await mkdtemp(join(tmpdir(), "crewkat-job-delete-"));
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
    head: async () => ({ contentType: "application/pdf", size: 0 }),
  },
  executePrivileged: async () => { throw new Error("unexpected privileged call"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
} as any;
const A = BaseActions as any;
const now = new Date();
await db.insert(schema.settings).values({
  id: 1, companyId: 1, companyName: "Stallions Construction Company LLC",
  phone: "(813) 516-5720", email: "stallionsconstructioncompany@gmail.com",
  website: "stallionsconstruction.com", licenseNumber: "FL License #CRC1335847",
  updatedAt: now,
});
await db.insert(schema.authUsers).values({ id: 1, name: "Danny", email: "danny@example.com", passwordHash: "x", passwordSalt: "y", companyId: 1, createdAt: now, updatedAt: now } as any);
const mkJob = async (clientName: string, companyId = 1) =>
  (await db.insert(schema.jobs).values({ companyId, clientName, clientEmail: "client@example.com", jobAddress: "1 Main St", jobType: "Remodel", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;

const jobA = await mkJob("Loaded Job");       // everything attached
const jobB = await mkJob("Empty Job");        // nothing attached
const jobC = await mkJob("Rival Job", 2);     // another company's job

// Job A attachments.
const putBlob = async (key: string) => { blobStore.set(key, Buffer.from("x")); return key; };
const photoKey1 = await putBlob(`jobs/${jobA}/p1`);
const photoKey2 = await putBlob(`jobs/${jobA}/p2`);
const photo1 = (await db.insert(schema.photos).values({ jobId: jobA, stage: "before", blobKey: photoKey1, filename: "p1.jpg", contentType: "image/jpeg", createdAt: now }).returning({ id: schema.photos.id }))[0]!.id;
const photo2 = (await db.insert(schema.photos).values({ jobId: jobA, stage: "after", blobKey: photoKey2, filename: "p2.jpg", contentType: "image/jpeg", createdAt: now }).returning({ id: schema.photos.id }))[0]!.id;
await db.insert(schema.photoPairs).values({ jobId: jobA, beforePhotoId: photo1, afterPhotoId: photo2, createdAt: now });
const contractSigKey = await putBlob(`docs/sig-contract`);
const contractPdfKey = await putBlob(`docs/signed-contract`);
const contractId = (await db.insert(schema.documents).values({ jobId: jobA, kind: "contract", title: "Main contract", signerName: "Danny", signatureBlobKey: contractSigKey, clientSignerName: "Loaded Job", clientSignedAt: now, clientSignedPdfBlobKey: contractPdfKey, signedAt: now, createdAt: now }).returning({ id: schema.documents.id }))[0]!.id;
await db.insert(schema.documents).values({ jobId: jobA, kind: "change_order", title: "CO 1", signerName: "Danny", signatureBlobKey: await putBlob("docs/sig-co"), signedAt: now, createdAt: now });
const fileKey = await putBlob(`files/permit`);
await db.insert(schema.jobFiles).values({ jobId: jobA, title: "Permit", filename: "permit.pdf", blobKey: fileKey, createdAt: now });
const tokenId = (await db.insert(schema.portalTokens).values({ jobId: jobA, tokenHash: "hash-a", tokenHint: "hint-a", createdAt: now }).returning({ id: schema.portalTokens.id }))[0]!.id;
await db.insert(schema.portalLinkEvents).values({ linkId: tokenId, eventType: "view", occurredAt: now });
// Document link for the contract (dies) + an INVOICE link reusing the
// same numeric document id (must survive — document_id is per-kind).
const contractLinkId = (await db.insert(schema.documentLinks).values({ documentKind: "contract", documentId: contractId, tokenHash: "link-contract", tokenHint: "lc", expiresAt: now, createdAt: now }).returning({ id: schema.documentLinks.id }))[0]!.id;
await db.insert(schema.documentLinkEvents).values({ linkId: contractLinkId, eventType: "view", occurredAt: now });
const invoiceLinkId = (await db.insert(schema.documentLinks).values({ documentKind: "invoice", documentId: contractId, tokenHash: "link-invoice", tokenHint: "li", expiresAt: now, createdAt: now }).returning({ id: schema.documentLinks.id }))[0]!.id;
await db.insert(schema.jobMessages).values({ jobId: jobA, sender: "contractor", body: "hi", createdAt: now });
await db.insert(schema.userNotifications).values({ userId: 1, kind: "job_message", titleEn: "New message", titleEs: "Mensaje nuevo", link: `job:${jobA}:messages`, createdAt: now });
await db.insert(schema.userNotifications).values({ userId: 1, kind: "doc_signed", titleEn: "Signed", titleEs: "Firmado", link: `doc-signed:${contractId}`, createdAt: now });
// Independent records linked to job A: estimate, invoice + payment, appointment.
const quoteId = (await db.insert(schema.quotes).values({ clientName: "Loaded Job", jobId: jobA, lineItemsJson: "[]", total: "100", createdAt: now, updatedAt: now }).returning({ id: schema.quotes.id }))[0]!.id;
const invoiceId = (await db.insert(schema.invoices).values({ clientName: "Loaded Job", jobId: jobA, lineItemsJson: "[]", total: "200", createdAt: now, updatedAt: now }).returning({ id: schema.invoices.id }))[0]!.id;
const paymentId = (await db.insert(schema.payments).values({ invoiceId, amount: "200", paymentDate: "2026-10-21", createdAt: now }).returning({ id: schema.payments.id }))[0]!.id;
const appointmentId = (await db.insert(schema.appointments).values({ jobId: jobA, clientName: "Loaded Job", startsAt: "2026-10-25T14:00:00", createdAt: now, updatedAt: now }).returning({ id: schema.appointments.id }))[0]!.id;
// Job C has a document of its own (must be untouchable from company 1).
const rivalDocId = (await db.insert(schema.documents).values({ companyId: 2, jobId: jobC, kind: "contract", title: "Rival contract", signerName: "Rival", signatureBlobKey: "rival-sig", signedAt: now, createdAt: now }).returning({ id: schema.documents.id }))[0]!.id;

// --- 1. Preview counts -----------------------------------------------------------
const previewA = await A.getJobDeletePreview.handler(ctx, { jobId: jobA });
check("preview: 2 documents (contract + CO)", previewA.documents === 2, JSON.stringify(previewA));
check("preview: 1 signed document", previewA.signedDocuments === 1);
check("preview: 2 photos", previewA.photos === 2);
check("preview: 1 shared file", previewA.files === 1);
check("preview: 1 invoice + 1 payment survive-counted", previewA.invoices === 1 && previewA.payments === 1);
check("preview: 1 estimate", previewA.estimates === 1);
check("preview: portal link flagged", previewA.portalLink === true);
const previewB = await A.getJobDeletePreview.handler(ctx, { jobId: jobB });
check("preview: empty job is all zeros", previewB.documents === 0 && previewB.photos === 0 && previewB.files === 0 && previewB.invoices === 0 && previewB.payments === 0 && previewB.estimates === 0 && previewB.portalLink === false, JSON.stringify(previewB));

// --- 4. Ownership ----------------------------------------------------------------
let previewError = "";
try { await A.getJobDeletePreview.handler(ctx, { jobId: jobC }); } catch (e) { previewError = e instanceof Error ? e.message : String(e); }
check("preview of another company's job is refused", previewError === "Job not found.", previewError);
let deleteError = "";
try { await A.deleteJob.handler(ctx, { jobId: jobC }); } catch (e) { deleteError = e instanceof Error ? e.message : String(e); }
check("delete of another company's job is refused", deleteError === "Job not found.", deleteError);
let missingError = "";
try { await A.deleteJob.handler(ctx, { jobId: 999999 }); } catch (e) { missingError = e instanceof Error ? e.message : String(e); }
check("delete of a missing job errors", missingError === "Job not found.", missingError);
check("rival job + document untouched after refused delete",
  (await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobC))).length === 1 &&
  (await db.select().from(schema.documents).where(eq(schema.documents.id, rivalDocId))).length === 1);

// --- 2. Delete the loaded job ------------------------------------------------------
const result = await A.deleteJob.handler(ctx, { jobId: jobA });
check("deleteJob reports the summary", result.ok === true && result.deletedDocuments === 2 && result.deletedPhotos === 2 && result.deletedFiles === 1 && result.unlinkedInvoices === 1 && result.unlinkedEstimates === 1, JSON.stringify(result));
const gone = async (rows: Promise<unknown[]>) => (await rows).length === 0;
check("job row gone", await gone(db.select().from(schema.jobs).where(eq(schema.jobs.id, jobA))));
check("documents gone (signed contract + CO)", await gone(db.select().from(schema.documents).where(eq(schema.documents.jobId, jobA))));
check("photos + pairs gone", await gone(db.select().from(schema.photos).where(eq(schema.photos.jobId, jobA))) && await gone(db.select().from(schema.photoPairs).where(eq(schema.photoPairs.jobId, jobA))));
check("shared files gone", await gone(db.select().from(schema.jobFiles).where(eq(schema.jobFiles.jobId, jobA))));
check("portal token + its events gone", await gone(db.select().from(schema.portalTokens).where(eq(schema.portalTokens.jobId, jobA))) && await gone(db.select().from(schema.portalLinkEvents).where(eq(schema.portalLinkEvents.linkId, tokenId))));
check("contract document link + its events gone", await gone(db.select().from(schema.documentLinks).where(eq(schema.documentLinks.id, contractLinkId))) && await gone(db.select().from(schema.documentLinkEvents).where(eq(schema.documentLinkEvents.linkId, contractLinkId))));
check("job messages gone", await gone(db.select().from(schema.jobMessages).where(eq(schema.jobMessages.jobId, jobA))));
check("job notifications gone", await gone(db.select().from(schema.userNotifications).where(eq(schema.userNotifications.link, `job:${jobA}:messages`))) && await gone(db.select().from(schema.userNotifications).where(eq(schema.userNotifications.link, `doc-signed:${contractId}`))));
check("blobs deleted (photos, signatures, signed pdf, file)", !blobStore.has(photoKey1) && !blobStore.has(photoKey2) && !blobStore.has(contractSigKey) && !blobStore.has(contractPdfKey) && !blobStore.has(fileKey));
const invoiceAfter = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)))[0];
check("invoice survives, unlinked", !!invoiceAfter && invoiceAfter.jobId === null);
check("payment survives on the invoice", (await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId))).length === 1);
const quoteAfter = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, quoteId)))[0];
check("estimate survives, unlinked", !!quoteAfter && quoteAfter.jobId === null);
const appointmentAfter = (await db.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId)))[0];
check("appointment survives, unlinked", !!appointmentAfter && appointmentAfter.jobId === null);
check("invoice document link with colliding numeric id survives", (await db.select().from(schema.documentLinks).where(eq(schema.documentLinks.id, invoiceLinkId))).length === 1);

// --- 3. Empty job + list ------------------------------------------------------------
const resultB = await A.deleteJob.handler(ctx, { jobId: jobB });
check("empty job deletes with zero counts", resultB.ok === true && resultB.deletedDocuments === 0 && resultB.deletedPhotos === 0 && resultB.deletedFiles === 0, JSON.stringify(resultB));
const listed = await A.listJobs.handler(ctx, { search: "" });
check("listJobs no longer returns the deleted jobs", !listed.jobs.some((j: { id: number }) => j.id === jobA || j.id === jobB));

// --- 5. Client wiring -----------------------------------------------------------------
const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");
function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  return src.slice(a, b === -1 ? undefined : b);
}
const jobsScreen = slice(APP, "function JobsScreen(", "const emptyJob =");
check("jobs list rows are SwipeRows with a danger Delete action", jobsScreen.includes("<SwipeRow") && jobsScreen.includes('kind: "danger"') && jobsScreen.includes('lang === "es" ? "Eliminar" : "Delete"') && jobsScreen.includes("<TrashIcon />"));
check("swipe state is controlled one-open-at-a-time", jobsScreen.includes("open={openSwipeJobId === job.id}") && jobsScreen.includes("onOpenChange=") && jobsScreen.includes("setOpenSwipeJobId"));
check("tap on a swiped-open card closes it instead of navigating", jobsScreen.includes("if (openSwipeJobId === job.id) { setOpenSwipeJobId(null); return; }"));
check("clean tap still opens the job detail", jobsScreen.includes('setScreen({ name: "detail", jobId: job.id })'));
check("confirm fetches the attachment preview before deleting", jobsScreen.includes("api.getJobDeletePreview({ jobId: deleteTarget!.id })"));
check("confirm calls deleteJob and invalidates the jobs list", jobsScreen.includes("api.deleteJob({ jobId })") && jobsScreen.includes('invalidateQueries({ queryKey: ["jobs"] })'));
check("confirm is the floating popup, titled EN + ES", jobsScreen.includes("<FloatPopup") && jobsScreen.includes('"Delete this job?"') && jobsScreen.includes('"¿Eliminar este trabajo?"'));
check("confirm warns with counts + can't-be-undone, EN + ES", jobsScreen.includes("These will be deleted too. This can't be undone.") && jobsScreen.includes("También se eliminará todo esto. Esto no se puede deshacer."));
check("confirm notes survivors stay, EN + ES", jobsScreen.includes("stay in your records — just unlinked from this job.") && jobsScreen.includes("se conservan en tus registros — solo se desvinculan de este trabajo."));
check("no browser confirm() in the jobs delete flow", !jobsScreen.includes("window.confirm") && !jobsScreen.includes("confirm("));
const swipeRow = slice(APP, "function SwipeRow(", "function EmptyState(");
check("SwipeRow: vertical scroll wins (horizontal must dominate)", swipeRow.includes("Math.abs(dy) > Math.abs(dx) * 1.2"));
check("SwipeRow: snap threshold + controlled open reporting", swipeRow.includes("current < -56") && swipeRow.includes("onOpenChange?.(snapped !== 0)"));
check("SwipeRow: action tap never falls through to the row", swipeRow.includes("event.stopPropagation()"));
check("CSS: danger swipe action is the red Crewkat button", CSS.includes(".swipe-action.danger { background: var(--danger, #c0392b); }"));
check("CSS: jobs swipe wrapper + floating confirm styles exist", CSS.includes(".jobs-page .job-list .swipe-row") && CSS.includes(".job-delete-warn") && CSS.includes(".job-delete-actions"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
