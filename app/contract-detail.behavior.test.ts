// Job Contracts flow fix (Danny, 2026-10-15 — "Concrete pad" job report).
//
// Three defects, one root theme: signed documents had no detail surface.
//  1. Tapping a contract in JobDetail's Contracts section routed to the
//     generic "tool" screen ({ name: "tool", jobId, mode }) — the Screen
//     variant carried no documentId, so DocumentSigner (a create-only form
//     whose title merely defaults to "<jobType> contract") opened instead
//     of the tapped contract.
//  2. DocumentSigner doubled as form + list: it rendered a saved-section
//     with every document of the kind under the form, so the contracts
//     list appeared again at the bottom of the "signer" page.
//  3. No edit or delete existed for contracts: the server had NO update
//     action for document rows at all, and deleteDocument (used only by
//     the workspace Docs tab) never removed the stored blobs.
//
// Fix pinned here:
//  - New Screen variant { name: "document", jobId, documentId } + router
//    case + jobs-tab mapping; the Contracts row routes to it.
//  - DocumentDetailScreen shows the tapped document itself (uploaded PDF
//    pages via renderPdfPreview + ClientDocPageViewer, pasted text),
//    kind/status/signature facts, linked-job context, and every action
//    the old list carried (View document, tap-to-sign, Place signature,
//    View signed copy, DocumentLinkPanel) plus Edit and Delete.
//  - DocumentSigner is create-only again (no saved list under the form);
//    the "+" / New entrances still route to the blank tool form.
//  - NEW server updateDocument: title/bodyText/description/amount +
//    optional PDF replacement (new blob stored, replaced blob deleted,
//    placement reset — boxes belonged to the old file's pages). It never
//    touches signerName / signatures / client signature state.
//  - deleteDocument now also deletes the document's blobs (original,
//    contractor signature, client signature, client signed PDF),
//    best-effort like the sibling deletes.
//
// Run from app/:  bun contract-detail.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const throwsAsync = async (name: string, fn: () => Promise<unknown>) => {
  try { await fn(); check(name, false, "did not throw"); } catch { check(name, true); }
};

// --- Static pins: routing + composition --------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const actionsSrc = await readFile("server/src/actions.ts", "utf8");

check("Screen union carries a document detail variant with documentId",
  appSrc.includes('| { name: "document"; jobId: number; documentId: number }'));
check("document screen maps to the jobs tab",
  appSrc.includes('["jobs", "new", "detail", "proof", "tool", "document"]'));
check("router renders DocumentDetailScreen for the document screen",
  appSrc.includes('screen.name === "document"') && appSrc.includes("<DocumentDetailScreen"));
check("Contracts row tap routes to the document detail, not the signer form",
  appSrc.includes('onClick={() => setScreen({ name: "document", jobId, documentId: doc.id })}'));
check("the old contract-row -> tool-screen route is gone",
  !appSrc.includes('mode: doc.kind === "contract" ? "contract" : "change"'));

const signerStart = appSrc.indexOf("function DocumentSigner");
const signerEnd = appSrc.indexOf("async function buildSignedDocumentPdf", signerStart);
const SIGNER = appSrc.slice(signerStart, signerEnd);
check("create form is intact (saveDocument + signature pad + file upload)",
  SIGNER.includes("api.saveDocument") && SIGNER.includes("<SignaturePad") && SIGNER.includes('accept="application/pdf"'));
check("create screen renders NO contracts list (no saved-section)",
  !SIGNER.includes("saved-section") && !SIGNER.includes("t.signedDocuments"));
check("create screen holds no existing-document state (blank form)",
  !SIGNER.includes("data.documents") && !SIGNER.includes("documentId"));
check("create entrances still route to the signer form",
  appSrc.includes('setScreen({ name: "tool", jobId, mode: "contract" })')
  && appSrc.includes('setScreen({ name: "tool", jobId, mode: "change" })'));

// --- Save-flow fix (Danny 2026-10-17): the signer form dead-ended after
// Sign & save (blanked form, no navigation -> duplicate documents on
// retry), and submit validation failed invisibly (error at the bottom of
// the form, below the fold from the sticky submit bar).
const themeSrc = await readFile("client/src/theme.css", "utf8");
check("saveDocument returns the created id (the navigation target)",
  actionsSrc.includes("return { id: made.id }"));
check("signer save success awaits the job refetch, then opens the created document",
  SIGNER.includes("onSuccess: async (result)") && SIGNER.includes("await client.invalidateQueries")
  && SIGNER.includes("onSaved(result.id)"));
check("tool screen threads the open-document callback to both signer variants",
  (appSrc.match(/onSaved=\{onOpenDocument\}/g) ?? []).length === 2);
check("app root lands a saved document on its detail via replace, never push",
  appSrc.includes('onOpenDocument={(createdId) => replaceScreen({ name: "document", jobId: screen.jobId, documentId: createdId })}'));
const submitBarSlice = SIGNER.slice(SIGNER.indexOf('className="signer-submit-bar"'));
check("validation error renders inside the sticky submit bar",
  submitBarSlice.includes('className="status error signer-submit-error"'));
check("the old below-the-fold error render is gone",
  !SIGNER.includes('{error && <p className="status error">{error}</p>}'));
check("missing-field feedback hooks exist (ring class + aria-invalid + scroll/focus)",
  SIGNER.includes("field-missing") && SIGNER.includes("aria-invalid")
  && SIGNER.includes("scrollIntoView") && SIGNER.includes("flagMissing("));
check("each missing field gets its own short message (EN + ES)",
  appSrc.includes("Add your PDF or paste the contract text first.")
  && appSrc.includes("Primero agrega tu PDF o pega el texto del contrato.")
  && appSrc.includes("Draw your signature first.")
  && appSrc.includes("Primero dibuja tu firma."));
check("submit-bar error + missing-field ring styles ship",
  themeSrc.includes(".signer-submit-error {") && themeSrc.includes(".signer-form .field-missing"));

const detailStart = appSrc.indexOf("function DocumentDetailScreen");
const detailEnd = appSrc.indexOf("function PunchList", detailStart);
const DETAIL = appSrc.slice(detailStart, detailEnd);
check("detail screen exists and loads the tapped document by id",
  detailStart > -1 && DETAIL.includes("data?.documents.find((d) => d.id === documentId)"));
check("detail shows signature state (signed / awaiting / fully signed)",
  DETAIL.includes("Signed by you — awaiting client") && DETAIL.includes("Fully signed") && DETAIL.includes("doc.clientSignedAt"));
check("detail renders the document text and the uploaded PDF pages",
  DETAIL.includes("doc.bodyText") && DETAIL.includes("<DocumentPdfPages"));
const pagesStart = appSrc.indexOf("function DocumentPdfPages");
const PAGES = appSrc.slice(pagesStart, appSrc.indexOf("function DocumentEditForm", pagesStart));
check("PDF pages render through renderPdfPreview and open the zoom viewer",
  PAGES.includes("api.renderPdfPreview") && PAGES.includes("<ClientDocPageViewer") && PAGES.includes("sameOriginBlobPath(originalUrl)"));
check("detail keeps View document (canonical PDF builder + preview modal)",
  DETAIL.includes("buildCanonicalDocumentPdf") && DETAIL.includes("<PdfFrame"));
check("canonical builder serves the stored canonical via getDocumentPdf (no fabricated record page)",
  appSrc.includes("api.getDocumentPdf({ documentId: document.id })") && appSrc.includes("buildCanonicalDocumentPdf"));
check("detail keeps draw-to-sign, placement, signed copy and the send-link panel",
  DETAIL.includes("api.signDocumentWithDrawnSignature") && DETAIL.includes("DocumentSignSheet")
  && DETAIL.includes("<SignaturePlacementEditor")
  && DETAIL.includes("doc.signedPdfUrl")
  && DETAIL.includes("<DocumentLinkPanel"));
const editStart = appSrc.indexOf("function DocumentEditForm");
const EDIT = appSrc.slice(editStart, detailStart);
check("edit form saves through updateDocument (title, text/description, amount, file replacement)",
  EDIT.includes("api.updateDocument") && EDIT.includes("args.originalDataBase64")
  && EDIT.includes("doc.kind === \"change_order\""));
check("detail exposes Delete behind the standard confirm sheet",
  DETAIL.includes("api.deleteDocument")
  && DETAIL.includes("Delete document?") && DETAIL.includes("<BottomSheet")
  && DETAIL.includes("danger-button") && DETAIL.includes("setEditing(true)"));
check("delete returns to the job (pop, not push)",
  DETAIL.includes("onSuccess: () => {\n      invalidate();\n      onBack();\n    }"));

const updateStart = actionsSrc.indexOf("updateDocument: defineAction");
const updateEnd = actionsSrc.indexOf("saveDocumentSignatureFields: defineAction", updateStart);
const UPDATE = actionsSrc.slice(updateStart, updateEnd);
check("server updateDocument exists", updateStart > -1);
check("updateDocument edits content fields only — never signer/signature state",
  UPDATE.includes("patch.title") && UPDATE.includes("patch.bodyText")
  && !UPDATE.includes("patch.signerName") && !UPDATE.includes("patch.signatureBlobKey")
  && !UPDATE.includes("clientSignerName") && !UPDATE.includes("clientSignedAt"));
check("updateDocument replacement stores a new blob, resets placement, deletes the old blob",
  UPDATE.includes("ctx.blobs.put") && UPDATE.includes('patch.signatureFieldsJson = "{}"') && UPDATE.includes("ctx.blobs.delete(replacedBlobKey)"));
const deleteLine = actionsSrc.split("\n").find((line) => line.includes("deleteDocument: defineAction")) ?? "";
check("deleteDocument removes links, the row, and all four blobs",
  deleteLine.includes("documentLinks") && deleteLine.includes("ctx.blobs.delete(key)")
  && deleteLine.includes("doc.originalBlobKey") && deleteLine.includes("doc.signatureBlobKey")
  && deleteLine.includes("doc.clientSignatureBlobKey") && deleteLine.includes("doc.clientSignedPdfBlobKey"));

// --- Contractor printed-name seeding (Danny 2026-10-17): the creation
// form prefilled "Printed name" with the JOB's CLIENT name ("Anthony
// Porreca") and the detail sign sheet inherited that stored value, so the
// contractor was prompted to sign AS the client — and re-signing looked
// mandatory because no already-signed state was explained. Both fields
// now seed from the owner's account name -> the device-remembered signer
// name -> blank, and the sheet says when the doc is already signed.
const sheetStart = appSrc.indexOf("function DocumentSignSheet");
const SHEET = appSrc.slice(sheetStart, appSrc.indexOf("// ONE canonical PDF", sheetStart));
check("creation signer name never seeds from the job's client name",
  !SIGNER.includes("useState(job?.clientName")
  && SIGNER.includes("useState(() => ownerSignerName(auth?.user.name))"));
check("owner-name seed chain ships (account name -> localStorage -> blank)",
  appSrc.includes('const SIGNER_NAME_STORAGE_KEY = "crewkat.signerName"')
  && appSrc.includes("function ownerSignerName(") && appSrc.includes("function rememberedSignerName()")
  && appSrc.includes("window.localStorage.getItem(SIGNER_NAME_STORAGE_KEY)"));
check("detail sign sheet initialName comes from the owner chain — never doc.signerName / companyName",
  DETAIL.includes("initialName={ownerSignerName(auth?.user.name)}")
  && !DETAIL.includes("doc.signerName || settings?.companyName"));
check("submitted signer names are remembered on this device (creation save + drawn sign)",
  SIGNER.includes("rememberSignerName(signerName);") && DETAIL.includes("rememberSignerName(signerName);"));
check("sign sheet shows the already-signed note only when a signed date is passed (EN + ES)",
  SHEET.includes("alreadySignedDate?: string | null") && SHEET.includes("{alreadySignedDate && (")
  && SHEET.includes("You already signed this document on ${alreadySignedDate}. Signing again replaces your signature.")
  && SHEET.includes("Ya firmaste este documento el ${alreadySignedDate}. Firmar de nuevo reemplaza tu firma."));
check("detail passes the recorded signing date to the sheet (note stays hidden pre-signing)",
  DETAIL.includes("alreadySignedDate={doc.signedAt && doc.signerName ? formatDate(doc.signedAt, lang) : null}"));
check("the recorded signer name still displays in the detail facts (audit line untouched)",
  DETAIL.includes("{doc.signerName} · {formatDate(doc.signedAt, lang)}"));

// --- Server behavior ------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-contract-detail-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const blobStore = new Map<string, Buffer>();
const ctx = {
  slug: "tradesign",
  invocationId: "contract-detail-test",
  spaceDir: dir,
  db: () => db,
  unscopedDb: () => db,
  blobs: {
    put: async (key: string, data: Buffer) => { blobStore.set(key, Buffer.from(data)); },
    get: async (key: string) => blobStore.get(key) ?? null,
    getUrl: async (key: string) => `https://crewkat.com/blobs/${key}`,
    delete: async (key: string) => { blobStore.delete(key); },
    head: async (key: string) => ({ contentType: key.endsWith(".pdf") ? "application/pdf" : "image/png", size: blobStore.get(key)?.length ?? 0 }),
  },
  executePrivileged: async () => { throw new Error("not stubbed"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
} as any;
const A = BaseActions as any;
const now = new Date();
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Stallions Construction Company LLC", updatedAt: now });
const jobId = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Denny", jobAddress: "1 Main St", jobType: "Concrete pad", jobDate: "2026-10-15", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;

const pngBase64 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64").toString("base64");
async function makePdf(text: string): Promise<string> {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText(text, { x: 48, y: 720, size: 14 });
  return Buffer.from(await pdf.save()).toString("base64");
}
const pdfV1 = await makePdf("Concrete pad contract v1");
const pdfV2 = await makePdf("Concrete pad contract v2");

const saved = await A.saveDocument.handler(ctx, {
  jobId, kind: "contract", title: "Concrete pad contract", bodyText: "Original terms.",
  originalFilename: "pad.pdf", originalDataBase64: pdfV1,
  description: "", amount: "", signerName: "Denny",
  signatureDataBase64: pngBase64, signedAt: now.toISOString(),
});
const docRow = async (id: number) => (await db.select().from(schema.documents).where(eq(schema.documents.id, id)).limit(1))[0];
const before = await docRow(saved.id);
check("fixture: contract saved with original + signature blobs",
  !!before?.originalBlobKey && !!before?.signatureBlobKey && blobStore.has(before!.originalBlobKey!) && blobStore.has(before!.signatureBlobKey));

// Edit: title + text change; signature state untouched.
await A.updateDocument.handler(ctx, { id: saved.id, title: "Repair contract", bodyText: "Revised terms." });
const edited = await docRow(saved.id);
check("edit saves the new title and text", edited?.title === "Repair contract" && edited?.bodyText === "Revised terms.");
check("edit leaves signer + signature state untouched",
  edited?.signerName === before?.signerName && edited?.signatureBlobKey === before?.signatureBlobKey
  && edited?.signedAt.getTime() === before?.signedAt.getTime() && edited?.originalBlobKey === before?.originalBlobKey);
const listed = (await A.listDocuments.handler(ctx, {})).documents.find((d: any) => d.id === saved.id);
check("list payload reflects the edit (detail reads the same shape)", listed?.title === "Repair contract" && listed?.bodyText === "Revised terms.");

// Placement set, then PDF replacement: new blob in, old blob out, placement reset.
await A.saveDocumentSignatureFields.handler(ctx, { documentId: saved.id, fields: { clientSignature: { page: 1, xPct: 0.1, yPct: 0.8, wPct: 0.3, hPct: 0.06 } } });
check("fixture: placement saved before replacement", (await docRow(saved.id))?.signatureFieldsJson.includes("clientSignature") === true);
await A.updateDocument.handler(ctx, { id: saved.id, originalDataBase64: pdfV2, originalFilename: "pad-v2.pdf" });
const replaced = await docRow(saved.id);
check("replacement stores the new PDF blob and filename",
  !!replaced?.originalBlobKey && replaced.originalBlobKey !== before?.originalBlobKey
  && blobStore.has(replaced!.originalBlobKey!) && replaced?.originalFilename === "pad-v2.pdf");
check("replacement deletes the replaced blob", !blobStore.has(before!.originalBlobKey!));
check("replacement resets the saved placement", replaced?.signatureFieldsJson === "{}");

// Change order edit: description + amount normalization.
const change = await A.saveDocument.handler(ctx, {
  jobId, kind: "change_order", title: "Extra outlet", bodyText: "",
  originalFilename: "", originalDataBase64: "",
  description: "Add one outlet", amount: "250", signerName: "Denny",
  signatureDataBase64: pngBase64, signedAt: now.toISOString(),
});
await A.updateDocument.handler(ctx, { id: change.id, description: "Add two outlets", amount: "475.5" });
const changeEdited = await docRow(change.id);
check("change-order edit saves description + normalized amount",
  changeEdited?.description === "Add two outlets" && changeEdited?.amount === "475.50", changeEdited?.amount);

await throwsAsync("updateDocument on a missing document throws", () => A.updateDocument.handler(ctx, { id: 999999, title: "Nope" }));

// Delete: row, links and every blob go away; the job's list updates.
const link = await A.createDocumentLink.handler(ctx, { kind: "contract", id: saved.id });
check("fixture: share link row exists before delete",
  (await db.select().from(schema.documentLinks).where(eq(schema.documentLinks.documentId, saved.id))).length === 1 && !!link?.token);
// Simulate the client-signed artifacts so all four blob keys exist.
const rowNow = await docRow(saved.id);
await db.update(schema.documents).set({ clientSignatureBlobKey: "signatures/test/client.png", clientSignedPdfBlobKey: "documents/test/final.pdf", clientSignerName: "Denny", clientSignedAt: now }).where(eq(schema.documents.id, saved.id));
blobStore.set("signatures/test/client.png", Buffer.from("client-sig"));
blobStore.set("documents/test/final.pdf", Buffer.from("final-pdf"));
const allKeys = [rowNow!.originalBlobKey!, rowNow!.signatureBlobKey, "signatures/test/client.png", "documents/test/final.pdf"];
check("fixture: all four blobs present before delete", allKeys.every((k) => blobStore.has(k)));
await A.deleteDocument.handler(ctx, { id: saved.id });
check("delete removes the document row", (await docRow(saved.id)) === undefined);
check("delete removes the share links",
  (await db.select().from(schema.documentLinks).where(eq(schema.documentLinks.documentId, saved.id))).length === 0);
check("delete removes all four blobs", allKeys.every((k) => !blobStore.has(k)));
check("the job's document list no longer shows the deleted contract",
  (await A.getJob.handler(ctx, { id: jobId })).documents.every((d: any) => d.id !== saved.id)
  && (await A.listDocuments.handler(ctx, {})).documents.every((d: any) => d.id !== saved.id));
check("the other document survives the delete", (await docRow(change.id)) !== undefined);
await throwsAsync("deleteDocument on a missing document still throws", () => A.deleteDocument.handler(ctx, { id: 999999 }));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll contract-detail checks passed.");
