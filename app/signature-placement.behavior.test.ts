// Signature placement behavior tests (0078, Danny 2026-10-14):
// DocuSign-style fields on uploaded-PDF documents. The contractor places
// a signature box + date box per role; when the client signs, the final
// PDF is the ORIGINAL pages with the signature image + date composited
// at the placed fields — or at the bottom of the last page when nothing
// was placed. No appended summary page for uploaded documents.
//
// Covers:
//  1. Migration 0078: documents.signature_fields_json + journal entry
//     (tag 0078_signature_fields, when > 0077).
//  2. parse/serialize: round-trip, invalid placements dropped.
//  3. Compositing: placed field puts the image XObject on that page only;
//     defaults put it on the last page; page count never grows; the date
//     stamp is drawn; two roles can stamp the same document.
//  4. Action layer: saveDocumentSignatureFields persists + hydrates via
//     listDocuments; rejects documents without an uploaded PDF; the
//     public link payload exposes ONLY the client fields; a client sign
//     built with the shared compositor (what the sign page runs) is what
//     the link then serves.
//
// Run from app/:  bun signature-placement.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { unzlibSync } from "fflate";

// pdf-lib compresses the content streams it writes, so drawn text is
// searched after inflating every stream in the file.
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  let out = raw;
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    try {
      const inflated = unzlibSync(Buffer.from(raw.slice(start, end), "latin1"));
      const text = Buffer.from(inflated).toString("latin1");
      out += text;
      // pdf-lib writes drawn text as hex strings: <4F6374...> Tj.
      for (const hex of text.matchAll(/<([0-9A-Fa-f]{4,})>\s*Tj/g)) {
        out += Buffer.from(hex[1]!, "hex").toString("latin1");
      }
    } catch { /* not a flate stream */ }
  }
  return out;
}
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";
import {
  compositeSignatureStamps,
  parseSignatureFields,
  serializeSignatureFields,
  resolveSignatureField,
  defaultSignatureField,
  type SignatureFields,
} from "./client/src/signatureComposite.ts";

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

// --- 1. Migration ---------------------------------------------------------------
const journal = await import("./drizzle/meta/_journal.json");
const entries = (journal as any).entries ?? (journal as any).default.entries;
const byTag = Object.fromEntries(entries.map((e: any) => [e.tag, e]));
check("newest migration tag is 0079_saved_signature", entries[entries.length - 1].tag === "0079_saved_signature", entries[entries.length - 1].tag);
check("0078 when strictly greater than 0077", byTag["0078_signature_fields"].when > byTag["0077_crane_run_weekly"].when);

const dir = await mkdtemp(join(tmpdir(), "crewkat-sig-b-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
const docCols = (await client.execute("PRAGMA table_info(documents)")).rows.map((r) => (r as any).name as string);
check("documents.signature_fields_json exists", docCols.includes("signature_fields_json"));

// --- 2. Parse / serialize ---------------------------------------------------------
const sample: SignatureFields = {
  clientSignature: { page: 2, xPct: 0.1, yPct: 0.8, wPct: 0.3, hPct: 0.075 },
  contractorDate: { page: 1, xPct: 0.6, yPct: 0.9, wPct: 0.22, hPct: 0.05 },
};
check("serialize/parse round-trips", JSON.stringify(parseSignatureFields(serializeSignatureFields(sample))) === JSON.stringify(sample));
check("garbage JSON parses to empty", Object.keys(parseSignatureFields("not json")).length === 0);
check("out-of-range placement is dropped", parseSignatureFields(JSON.stringify({ clientSignature: { page: 1, xPct: 0.9, yPct: 0.5, wPct: 0.5, hPct: 0.1 } })).clientSignature === undefined);
check("page 0 placement is dropped", parseSignatureFields(JSON.stringify({ clientDate: { page: 0, xPct: 0.1, yPct: 0.1, wPct: 0.2, hPct: 0.05 } })).clientDate === undefined);
check("default signature field is the last page, bottom area", (() => { const d = defaultSignatureField(3, "client"); return d.page === 3 && d.yPct >= 0.8; })());
check("placed field wins over the default", resolveSignatureField(sample, "client", 5).page === 2);

// --- 3. Compositing ------------------------------------------------------------------
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
async function makePdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = pdf.addPage([612, 792]);
    p.drawText(`Contract page ${i + 1}`, { x: 48, y: 720, size: 14 });
  }
  return pdf.save();
}
async function pageHasImage(pdfBytes: Uint8Array, pageIndex: number): Promise<boolean> {
  try {
    const pdf = await PDFDocument.load(pdfBytes);
    const resources = pdf.getPage(pageIndex).node.Resources();
    const xobjects = resources?.lookup(PDFName.of("XObject"), PDFDict);
    if (!xobjects) return false;
    for (const [, ref] of xobjects.entries()) {
      const obj = pdf.context.lookup(ref) as any;
      if (obj?.dict?.get(PDFName.of("Subtype"))?.toString() === "/Image") return true;
    }
  } catch { /* fall through */ }
  return false;
}

const twoPage = await makePdf(2);
const placedFields: SignatureFields = { clientSignature: { page: 2, xPct: 0.08, yPct: 0.82, wPct: 0.3, hPct: 0.075 } };
const placedOut = await compositeSignatureStamps(twoPage, placedFields, [
  { role: "client", imageBytes: pngBytes, imageFormat: "png", dateText: "October 14, 2026" },
]);
check("placed composite keeps the original page count", (await PDFDocument.load(placedOut)).getPageCount() === 2);
check("placed composite draws the signature on the placed page (2)", await pageHasImage(placedOut, 1));
check("placed composite draws nothing on page 1", !(await pageHasImage(placedOut, 0)));
check("date stamp text is drawn into the PDF", pdfText(placedOut).includes("October 14, 2026"));

const defaultOut = await compositeSignatureStamps(twoPage, {}, [
  { role: "client", imageBytes: pngBytes, imageFormat: "png", dateText: "October 14, 2026" },
]);
check("default composite keeps the original page count", (await PDFDocument.load(defaultOut)).getPageCount() === 2);
check("default composite stamps the LAST page", await pageHasImage(defaultOut, 1) && !(await pageHasImage(defaultOut, 0)));

const bothOut = await compositeSignatureStamps(twoPage, {
  clientSignature: { page: 2, xPct: 0.08, yPct: 0.82, wPct: 0.3, hPct: 0.075 },
  contractorSignature: { page: 2, xPct: 0.55, yPct: 0.82, wPct: 0.3, hPct: 0.075 },
}, [
  { role: "contractor", imageBytes: pngBytes, imageFormat: "png", dateText: "October 14, 2026" },
  { role: "client", imageBytes: pngBytes, imageFormat: "png", dateText: "October 15, 2026" },
]);
check("both-role composite keeps the page count and stamps page 2", (await PDFDocument.load(bothOut)).getPageCount() === 2 && (await pageHasImage(bothOut, 1)));
check("both date stamps are present", pdfText(bothOut).includes("October 15, 2026"));

// --- 4. Action layer ---------------------------------------------------------------------
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
const jobId = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Denny", jobAddress: "456 bgyu", jobType: "Concrete pad", jobDate: "2026-10-14", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const originalBase64 = Buffer.from(twoPage).toString("base64");
const pngBase64 = pngBytes.toString("base64");

const savedDoc = await A.saveDocument.handler(ctx, {
  jobId, kind: "contract", title: "Concrete pad contract", bodyText: "",
  originalFilename: "concrete-pad-contract.pdf", originalDataBase64: originalBase64,
  description: "", amount: "", signerName: "Denny",
  signatureDataBase64: pngBase64, signedAt: now.toISOString(),
});

const fieldsToSave: SignatureFields = {
  clientSignature: { page: 2, xPct: 0.08, yPct: 0.82, wPct: 0.3, hPct: 0.075 },
  clientDate: { page: 2, xPct: 0.42, yPct: 0.82, wPct: 0.22, hPct: 0.05 },
  contractorSignature: { page: 2, xPct: 0.08, yPct: 0.68, wPct: 0.3, hPct: 0.075 },
};
await A.saveDocumentSignatureFields.handler(ctx, { documentId: savedDoc.id, fields: fieldsToSave });
const listed = await A.listDocuments.handler(ctx, {});
const listedDoc = listed.documents.find((d: any) => d.id === savedDoc.id);
check("placed fields hydrate through listDocuments", listedDoc?.signatureFields?.clientSignature?.page === 2 && listedDoc?.signatureFields?.contractorSignature?.yPct === 0.68);

const link = await A.createDocumentLink.handler(ctx, { kind: "contract", id: savedDoc.id });
const payload = await A.resolveDocumentLink.handler(ctx, { token: link.token, userAgent: "test" });
check("public payload carries the client signature field", payload.signatureFields?.clientSignature?.page === 2);
check("public payload carries the client date field", payload.signatureFields?.clientDate?.xPct === 0.42);
check("public payload never leaks the contractor field", payload.signatureFields?.contractorSignature === undefined);

// Client signs exactly as the sign page does: composite onto the original
// at the payload's fields, then submit.
const signedBytes = await compositeSignatureStamps(twoPage, payload.signatureFields ?? {}, [
  { role: "client", imageBytes: pngBytes, imageFormat: "png", dateText: "October 14, 2026" },
]);
await A.submitDocumentSignature.handler(ctx, {
  token: link.token, signerName: "Denny", signatureDataBase64: pngBase64,
  signedPdfDataBase64: Buffer.from(signedBytes).toString("base64"), userAgent: "test",
});
const served = await A.getDocumentLinkPdf.handler(ctx, { token: link.token, lang: "en" });
check("link serves the composited signed PDF", Buffer.from(served.pdfBase64, "base64").equals(Buffer.from(signedBytes)));
check("served signed PDF is the original 2 pages (no appended stub)", (await PDFDocument.load(Buffer.from(served.pdfBase64, "base64"))).getPageCount() === 2);

// Placement requires an uploaded PDF.
const textDoc = await A.saveDocument.handler(ctx, {
  jobId, kind: "contract", title: "Text-only", bodyText: "Terms.",
  originalFilename: "", originalDataBase64: "",
  description: "", amount: "", signerName: "Denny",
  signatureDataBase64: pngBase64, signedAt: now.toISOString(),
});
await throwsAsync("placement on a text-only document is rejected", () => A.saveDocumentSignatureFields.handler(ctx, { documentId: textDoc.id, fields: fieldsToSave }));

// Clearing fields returns the document to defaults.
await A.saveDocumentSignatureFields.handler(ctx, { documentId: savedDoc.id, fields: {} });
const relisted = await A.listDocuments.handler(ctx, {});
check("clearing fields empties the placement", Object.keys(relisted.documents.find((d: any) => d.id === savedDoc.id)?.signatureFields ?? {}).length === 0);

// --- 5. Source wiring -----------------------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
check("placement editor exists in the app", appSrc.includes("function SignaturePlacementEditor"));
check("sign flow composites uploaded docs", appSrc.includes("buildUploadedDocSignedPdf") && appSrc.includes("compositeSignatureStamps(baseBytes, doc.signatureFields ?? {}"));
check("editor saves through the action", appSrc.includes("api.saveDocumentSignatureFields"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
