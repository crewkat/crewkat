// Signatures Phase A behavior tests (Danny 2026-10-14): the two defects
// from his field repro — he uploaded a PDF contract, opened the public
// sign page, signed and saved, and (1) the in-app PDF printed
// "(Signature image unavailable)" with only name + timestamp, and (2) the
// uploaded document rendered as a blank page on the sign page.
//
// Root cause 1 (client): blob URLs are minted on the apex origin
// (crewkat.com) while the app is served from www.crewkat.com; the apex
// 301 has no CORS headers, so fetch() of signature/original blob bytes is
// rejected and the guarded PDF builders silently drop the image and the
// original pages. Fix: sameOriginBlobPath() rewrites blob URLs to the
// path-relative /blobs/<key> form before any fetch-based PDF embed.
// Root cause 2 (server): document-link payloads carried no reference to
// an uploaded original and every link-PDF action rejected contract /
// change-order kinds, so the signer only ever saw a generated stub.
// Fix: the payload exposes hasOriginalPdf, and the link PDF actions serve
// the real bytes (original before signing, signed final after).
//
// Covers:
//  1. sameOriginBlobPath unit behavior (apex/www/relative/data/non-blob).
//  2. Source wiring: buildSignedDocumentPdf + appendAttachmentsToBlob +
//     loadImageDataUrl fetch same-origin; generated-doc signature block
//     and its unavailable fallback survive (regression).
//  3. Uploaded contract end-to-end at the action layer: saveDocument with
//     an original PDF -> link payload hasOriginalPdf -> getDocumentLinkPdf
//     returns the exact original bytes -> getDocumentLinkPdfPages returns
//     real rasterized pages -> submitDocumentSignature -> the link then
//     serves the signed bytes and reports alreadySigned.
//  4. Text-only contract: no original -> link PDF actions stay web-only.
//
// Run from app/:  bun signature-documents.behavior.test.ts
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
import { privilegedHandlers } from "./server/src/privileged.ts";
import { sameOriginBlobPath } from "./client/src/financialPdf.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const throwsAsync = async (name: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch {
    check(name, true);
  }
};

// --- 1. sameOriginBlobPath ---------------------------------------------------
check("apex blob URL becomes path-relative", sameOriginBlobPath("https://crewkat.com/blobs/signatures/1/abc.png") === "/blobs/signatures/1/abc.png");
check("www blob URL becomes path-relative", sameOriginBlobPath("https://www.crewkat.com/blobs/documents/2/x.pdf") === "/blobs/documents/2/x.pdf");
check("already-relative blob path passes through", sameOriginBlobPath("/blobs/signatures/1/abc.png") === "/blobs/signatures/1/abc.png");
check("non-blob absolute URL is untouched", sameOriginBlobPath("https://example.com/images/logo.png") === "https://example.com/images/logo.png");
check("data URL is untouched", sameOriginBlobPath("data:image/png;base64,iVBORw0KGgo=") === "data:image/png;base64,iVBORw0KGgo=");
check("empty string is untouched", sameOriginBlobPath("") === "");

// --- 2. Source wiring ---------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const finSrc = await readFile("client/src/financialPdf.ts", "utf8");
check("loadImageDataUrl fetches the same-origin path", finSrc.includes("fetch(sameOriginBlobPath(url))"));
check("document PDF fetches the contractor signature same-origin", appSrc.includes("fetch(sameOriginBlobPath(document.signatureUrl))"));
check("document PDF fetches the uploaded original same-origin", appSrc.includes("fetch(sameOriginBlobPath(document.originalUrl))"));
check("attachment merge fetches same-origin", appSrc.includes("fetch(sameOriginBlobPath(a.url))"));
check("client page renders real pages for uploaded contracts", appSrc.includes("isUploadedContract") && appSrc.includes("doc.hasOriginalPdf"));
check("client signed PDF merges the original pages", appSrc.includes("mergePdfBytes(await res.arrayBuffer(), await stubBlob.arrayBuffer())"));
check("generated-doc signature block regression: fallback text kept", appSrc.includes('(Signature image unavailable)') && appSrc.includes("page.addImage(sigData, sigFormat, 42, y + 10, 230, 70)"));

// --- 3. Scratch DB + fixtures ---------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-sig-a-"));
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
    head: async (key: string) => ({ contentType: key.endsWith(".pdf") ? "application/pdf" : "image/png", size: blobStore.get(key)?.length ?? 0 }),
  },
  executePrivileged: async (contract: any, args: any) => {
    const entry = (privilegedHandlers as any).entries.find((e: any) => e.contract?.name === contract?.name);
    if (!entry) throw new Error(`Unknown privileged contract: ${contract?.name}`);
    return entry.handler(entry.contract.request.parse(args));
  },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
} as any;
const A = BaseActions as any;

const now = new Date();
await db.insert(schema.authUsers).values({ companyId: 1, name: "Danny Owner", email: "owner@test.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH", createdAt: now, updatedAt: now });
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Stallions Construction Company LLC", updatedAt: now });
const jobId = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Denny", jobAddress: "456 bgyu", jobType: "Concrete pad", jobDate: "2026-10-14", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;

// A real 2-page PDF stands in for Danny's uploaded contract.
const originalPdf = await PDFDocument.create();
const page1 = originalPdf.addPage([612, 792]);
page1.drawText("Concrete pad contract - page 1", { x: 48, y: 720, size: 16 });
const page2 = originalPdf.addPage([612, 792]);
page2.drawText("Sign here: ______________________", { x: 48, y: 120, size: 12 });
const originalBytes = await originalPdf.save();
const originalBase64 = Buffer.from(originalBytes).toString("base64");

// A real 1x1 PNG stands in for the drawn signature.
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const saved = await A.saveDocument.handler(ctx, {
  jobId, kind: "contract", title: "Concrete pad contract", bodyText: "",
  originalFilename: "concrete-pad-contract.pdf", originalDataBase64: originalBase64,
  description: "", amount: "", signerName: "Denny",
  signatureDataBase64: pngBase64, signedAt: now.toISOString(),
});
check("saveDocument stores the uploaded contract", saved.id > 0);
const docRow = (await db.select().from(schema.documents).where(eq(schema.documents.id, saved.id)))[0]!;
check("original PDF blob stored", !!docRow.originalBlobKey && blobStore.has(docRow.originalBlobKey!));
check("contractor signature blob stored", blobStore.has(docRow.signatureBlobKey));

// --- 4. Link payload + PDF endpoints --------------------------------------------
const link = await A.createDocumentLink.handler(ctx, { kind: "contract", id: saved.id });
const payload = await A.resolveDocumentLink.handler(ctx, { token: link.token, userAgent: "test" });
check("link payload flags the uploaded PDF", payload.hasOriginalPdf === true && payload.originalFilename === "concrete-pad-contract.pdf");
check("link payload is signable and unsigned", payload.signable === true && payload.alreadySigned === false);

const pdfBefore = await A.getDocumentLinkPdf.handler(ctx, { token: link.token, lang: "en" });
check("link PDF before signing returns the exact original bytes", Buffer.from(pdfBefore.pdfBase64, "base64").equals(Buffer.from(originalBytes)));
check("link PDF filename is the uploaded filename", pdfBefore.filename === "concrete-pad-contract.pdf", pdfBefore.filename);

const pages = await A.getDocumentLinkPdfPages.handler(ctx, { token: link.token, lang: "en" });
check("sign page receives 2 rasterized pages", pages.pagesBase64.length === 2, String(pages.pagesBase64.length));
check("rasterized pages are real JPEGs", pages.pagesBase64.every((p: string) => { const b = Buffer.from(p, "base64"); return b[0] === 0xff && b[1] === 0xd8; }));

const probe = await A.validateDocumentLinkPdf.handler(ctx, { token: link.token });
check("HEAD probe accepts the uploaded contract", probe.ok === true && probe.kind === "contract");

// --- 5. Client signs --------------------------------------------------------------
// Simulate the client-built signed PDF: original pages + a signature page
// with the signature image embedded (what the fixed client produces).
const clientPdf = await PDFDocument.load(originalBytes);
const sigPage = clientPdf.addPage([612, 792]);
const pngImage = await clientPdf.embedPng(Buffer.from(pngBase64, "base64"));
sigPage.drawImage(pngImage, { x: 42, y: 640, width: 150, height: 46 });
sigPage.drawText("Denny", { x: 42, y: 620, size: 11 });
const signedBytes = await clientPdf.save();
const signedBase64 = Buffer.from(signedBytes).toString("base64");

const submit = await A.submitDocumentSignature.handler(ctx, {
  token: link.token, signerName: "Denny", signatureDataBase64: pngBase64,
  signedPdfDataBase64: signedBase64, userAgent: "test", consented: true,
});
check("submitDocumentSignature accepts the signature", submit.ok === true);
const afterRow = (await db.select().from(schema.documents).where(eq(schema.documents.id, saved.id)))[0]!;
check("client signature image stored server-side", !!afterRow.clientSignatureBlobKey && blobStore.has(afterRow.clientSignatureBlobKey!));
check("client signed PDF stored server-side", !!afterRow.clientSignedPdfBlobKey && blobStore.has(afterRow.clientSignedPdfBlobKey!));

const payloadAfter = await A.resolveDocumentLink.handler(ctx, { token: link.token, userAgent: "test" });
check("link reports alreadySigned after signing", payloadAfter.alreadySigned === true);
const pdfAfter = await A.getDocumentLinkPdf.handler(ctx, { token: link.token, lang: "en" });
check("link PDF after signing serves the signed bytes, not the original", Buffer.from(pdfAfter.pdfBase64, "base64").equals(Buffer.from(signedBytes)));
const reloaded = await PDFDocument.load(Buffer.from(pdfAfter.pdfBase64, "base64"));
check("signed PDF has the original 2 pages + signature page", reloaded.getPageCount() === 3, String(reloaded.getPageCount()));
check("signed PDF embeds an image XObject (the signature)", Buffer.from(pdfAfter.pdfBase64, "base64").toString("latin1").includes("/Subtype /Image"));

// --- 6. Text-only contract stays web-only ------------------------------------------
const textSaved = await A.saveDocument.handler(ctx, {
  jobId, kind: "contract", title: "Text-only contract", bodyText: "Terms go here.",
  originalFilename: "", originalDataBase64: "",
  description: "", amount: "", signerName: "Denny",
  signatureDataBase64: pngBase64, signedAt: now.toISOString(),
});
const textLink = await A.createDocumentLink.handler(ctx, { kind: "contract", id: textSaved.id });
const textPayload = await A.resolveDocumentLink.handler(ctx, { token: textLink.token, userAgent: "test" });
check("text-only contract has no original flag", textPayload.hasOriginalPdf === false);
await throwsAsync("text-only contract PDF stays web-only", () => A.getDocumentLinkPdf.handler(ctx, { token: textLink.token, lang: "en" }));
await throwsAsync("text-only contract probe stays web-only", () => A.validateDocumentLinkPdf.handler(ctx, { token: textLink.token }));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
