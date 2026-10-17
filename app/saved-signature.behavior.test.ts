// Saved signature + tap-to-sign behavior tests (0079, Danny 2026-10-14):
// the contractor draws a signature once in Settings; one tap applies it
// to any document — recorded exactly like a drawn signature. Uploaded
// PDFs get the contractor stamp composited at the contractor field, and
// whichever party signs second, the final PDF carries BOTH stamps.
//
// Covers:
//  1. Migration 0079: settings.signature_blob_key + journal entry.
//  2. Save / replace / clear the saved signature; getSettings exposes it.
//  3. Tap-to-sign requires a saved signature; on a generated document it
//     replaces the contractor signature with a copy of the saved PNG and
//     a fresh timestamp.
//  4. Tap-to-sign on an uploaded PDF rebuilds the final from the
//     ORIGINAL pages with the contractor stamp at the placed field.
//  5. Both signing orders converge: contractor-first then client, and
//     client-first then contractor — the final served PDF carries both
//     stamps, original page count, no appended stub.
//  6. Role separation: tap-to-sign / saved-signature / placement actions
//     are NOT in the public (unauthenticated) action set.
//
// Run from app/:  bun saved-signature.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { unzlibSync } from "fflate";
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
const throwsAsync = async (name: string, fn: () => Promise<unknown>, match = "") => {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (e) {
    check(name, !match || String((e as Error).message).includes(match), String((e as Error).message));
  }
};

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
      const text = Buffer.from(unzlibSync(Buffer.from(raw.slice(start, end), "latin1"))).toString("latin1");
      out += text;
      for (const hex of text.matchAll(/<([0-9A-Fa-f]{4,})>\s*Tj/g)) {
        out += Buffer.from(hex[1]!, "hex").toString("latin1");
      }
    } catch { /* not a flate stream */ }
  }
  return out;
}
async function pageImageCount(pdfBytes: Uint8Array, pageIndex: number): Promise<number> {
  try {
    const pdf = await PDFDocument.load(pdfBytes);
    const resources = pdf.getPage(pageIndex).node.Resources();
    const xobjects = resources?.lookup(PDFName.of("XObject"), PDFDict);
    if (!xobjects) return 0;
    let n = 0;
    for (const [, ref] of xobjects.entries()) {
      const obj = pdf.context.lookup(ref) as any;
      if (obj?.dict?.get(PDFName.of("Subtype"))?.toString() === "/Image") n++;
    }
    return n;
  } catch { return 0; }
}
const pageHasImage = async (pdfBytes: Uint8Array, pageIndex: number) => (await pageImageCount(pdfBytes, pageIndex)) > 0;

// --- 1. Migration ---------------------------------------------------------------
const journal = await import("./drizzle/meta/_journal.json");
const entries = (journal as any).entries ?? (journal as any).default.entries;
const byTag = Object.fromEntries(entries.map((e: any) => [e.tag, e]));
check("newest migration tag is 0083_job_files", entries[entries.length - 1].tag === "0083_job_files", entries[entries.length - 1].tag);
check("0079 when strictly greater than 0078", byTag["0079_saved_signature"].when > byTag["0078_signature_fields"].when);

const dir = await mkdtemp(join(tmpdir(), "crewkat-sig-c-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
const settingsCols = (await client.execute("PRAGMA table_info(settings)")).rows.map((r) => (r as any).name as string);
check("settings.signature_blob_key exists", settingsCols.includes("signature_blob_key"));

// --- Harness ----------------------------------------------------------------------
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
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const pngBase64 = pngBytes.toString("base64");
const todayLong = new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date());

async function makePdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = pdf.addPage([612, 792]);
    p.drawText(`Contract page ${i + 1}`, { x: 48, y: 720, size: 14 });
  }
  return pdf.save();
}
const twoPage = await makePdf(2);
const twoPageBase64 = Buffer.from(twoPage).toString("base64");

async function saveUploadedDoc(title: string): Promise<number> {
  const saved = await A.saveDocument.handler(ctx, {
    jobId, kind: "contract", title, bodyText: "",
    originalFilename: "contract.pdf", originalDataBase64: twoPageBase64,
    description: "", amount: "", signerName: "Denny",
    signatureDataBase64: pngBase64, signedAt: new Date(now.getTime() - 60_000).toISOString(),
  });
  return saved.id as number;
}

// --- 2/3. Saved signature lifecycle + tap-to-sign guard -----------------------------
const textDoc = await A.saveDocument.handler(ctx, {
  jobId, kind: "contract", title: "Text-only contract", bodyText: "Terms.",
  originalFilename: "", originalDataBase64: "",
  description: "", amount: "", signerName: "Denny",
  signatureDataBase64: pngBase64, signedAt: new Date(now.getTime() - 60_000).toISOString(),
});
await throwsAsync("tap-to-sign without a saved signature is rejected", () => A.signDocumentWithSavedSignature.handler(ctx, { documentId: textDoc.id }), "Save your signature in Settings first");

await A.saveContractorSignature.handler(ctx, { signatureDataBase64: pngBase64 });
const settingsAfter = await A.getSettings.handler(ctx, {});
check("getSettings exposes the saved signature URL", typeof settingsAfter.savedSignatureUrl === "string" && settingsAfter.savedSignatureUrl.includes("/blobs/branding/signatures/"));
const firstKey = (await db.select().from(schema.settings).limit(1))[0]!.signatureBlobKey!;
await A.saveContractorSignature.handler(ctx, { signatureDataBase64: pngBase64 });
const secondKey = (await db.select().from(schema.settings).limit(1))[0]!.signatureBlobKey!;
check("replacing the saved signature swaps the blob", secondKey !== firstKey && !blobStore.has(firstKey) && blobStore.has(secondKey));

const tap = await A.signDocumentWithSavedSignature.handler(ctx, { documentId: textDoc.id });
const textRow = (await db.select().from(schema.documents)).find((d) => d.id === textDoc.id)!;
check("tap-to-sign stores a copy of the saved signature on the document", blobStore.get(textRow.signatureBlobKey!)?.equals(pngBytes) === true && textRow.signatureBlobKey !== secondKey);
check("tap-to-sign refreshes the signing timestamp", new Date(tap.signedAt).getTime() > now.getTime() - 60_000 && textRow.signedAt.getTime() === new Date(tap.signedAt).getTime());

// --- 4. Contractor-first on an uploaded PDF ------------------------------------------
const docA = await saveUploadedDoc("Contractor-first pad contract");
await A.saveDocumentSignatureFields.handler(ctx, {
  documentId: docA,
  fields: {
    contractorSignature: { page: 2, xPct: 0.55, yPct: 0.82, wPct: 0.3, hPct: 0.075 },
    clientSignature: { page: 2, xPct: 0.08, yPct: 0.82, wPct: 0.3, hPct: 0.075 },
  },
});
await A.signDocumentWithSavedSignature.handler(ctx, { documentId: docA });
const rowA1 = (await db.select().from(schema.documents)).find((d) => d.id === docA)!;
check("contractor tap-to-sign builds the final PDF", !!rowA1.clientSignedPdfBlobKey);
const finalA1 = blobStore.get(rowA1.clientSignedPdfBlobKey!)!;
check("contractor-only final keeps the original pages", (await PDFDocument.load(finalA1)).getPageCount() === 2);
check("contractor stamp is composited on the placed page", (await pageImageCount(finalA1, 1)) === 1);
check("contractor date stamp is drawn", pdfText(finalA1).includes(todayLong));

// Client signs second, exactly like the sign page: base = bytes the link
// serves now (already contractor-stamped), composite the client stamp.
const linkA = await A.createDocumentLink.handler(ctx, { kind: "contract", id: docA });
const beforeClient = await A.getDocumentLinkPdf.handler(ctx, { token: linkA.token, lang: "en" });
const clientFinal = await compositeSignatureStamps(Buffer.from(beforeClient.pdfBase64, "base64"), { clientSignature: { page: 2, xPct: 0.08, yPct: 0.82, wPct: 0.3, hPct: 0.075 } }, [
  { role: "client", imageBytes: pngBytes, imageFormat: "png", dateText: "October 20, 2026" },
]);
await A.submitDocumentSignature.handler(ctx, {
  token: linkA.token, signerName: "Denny", signatureDataBase64: pngBase64,
  signedPdfDataBase64: Buffer.from(clientFinal).toString("base64"), userAgent: "test",
});
const servedA = await A.getDocumentLinkPdf.handler(ctx, { token: linkA.token, lang: "en" });
const servedABytes = Buffer.from(servedA.pdfBase64, "base64");
check("contractor-first flow: final still has the original page count", (await PDFDocument.load(servedABytes)).getPageCount() === 2);
check("contractor-first flow: both stamps present in the final", (await pageImageCount(servedABytes, 1)) === 2 && pdfText(servedABytes).includes(todayLong) && pdfText(servedABytes).includes("October 20, 2026"));

// --- 5. Client-first, contractor second ----------------------------------------------
const docB = await saveUploadedDoc("Client-first pad contract");
await A.saveDocumentSignatureFields.handler(ctx, {
  documentId: docB,
  fields: {
    contractorSignature: { page: 2, xPct: 0.55, yPct: 0.82, wPct: 0.3, hPct: 0.075 },
    clientSignature: { page: 2, xPct: 0.08, yPct: 0.82, wPct: 0.3, hPct: 0.075 },
  },
});
const linkB = await A.createDocumentLink.handler(ctx, { kind: "contract", id: docB });
const payloadB = await A.resolveDocumentLink.handler(ctx, { token: linkB.token, userAgent: "test" });
const clientFirstBytes = await compositeSignatureStamps(twoPage, payloadB.signatureFields ?? {}, [
  { role: "client", imageBytes: pngBytes, imageFormat: "png", dateText: "October 18, 2026" },
]);
await A.submitDocumentSignature.handler(ctx, {
  token: linkB.token, signerName: "Denny", signatureDataBase64: pngBase64,
  signedPdfDataBase64: Buffer.from(clientFirstBytes).toString("base64"), userAgent: "test",
});
await A.signDocumentWithSavedSignature.handler(ctx, { documentId: docB });
const servedB = await A.getDocumentLinkPdf.handler(ctx, { token: linkB.token, lang: "en" });
const servedBBytes = Buffer.from(servedB.pdfBase64, "base64");
check("client-first flow: rebuilt final keeps the original page count", (await PDFDocument.load(servedBBytes)).getPageCount() === 2);
// The rebuild re-stamps the client from the ORIGINAL pages using the
// recorded clientSignedAt, so both stamps carry the recorded signing
// dates — two distinct embedded signature images on the placed page.
check("client-first flow: final carries BOTH signature stamps", (await pageImageCount(servedBBytes, 1)) === 2 && pdfText(servedBBytes).includes(todayLong));
const rowB = (await db.select().from(schema.documents)).find((d) => d.id === docB)!;
check("client-first flow: the client signature record survives the rebuild", !!rowB.clientSignedAt && !!rowB.clientSignatureHash);

// --- 6. Role separation ------------------------------------------------------------------
const actionsSrc = await readFile("server/src/actions.ts", "utf8");
const publicBlock = actionsSrc.slice(actionsSrc.indexOf("const PUBLIC_ACTIONS"), actionsSrc.indexOf("]);", actionsSrc.indexOf("const PUBLIC_ACTIONS")));
check("client signing stays public", publicBlock.includes('"submitDocumentSignature"'));
check("tap-to-sign is NOT public", !publicBlock.includes("signDocumentWithSavedSignature"));
check("saved-signature actions are NOT public", !publicBlock.includes("saveContractorSignature") && !publicBlock.includes("clearContractorSignature"));
check("placement saving is NOT public", !publicBlock.includes("saveDocumentSignatureFields"));

// Clear at the end (after every flow that needed the saved signature).
await A.clearContractorSignature.handler(ctx, {});
const settingsCleared = await A.getSettings.handler(ctx, {});
check("clearing removes the saved signature", settingsCleared.savedSignatureUrl === null && !blobStore.has(secondKey));

// Source wiring.
const appSrc = await readFile("client/src/App.tsx", "utf8");
check("Settings offers draw/save/clear for the saved signature", appSrc.includes("api.saveContractorSignature") && appSrc.includes("api.clearContractorSignature"));
check("documents offer tap-to-sign", appSrc.includes("api.signDocumentWithSavedSignature"));
check("the no-saved-signature notice links to Settings (Danny 2026-10-17)",
  appSrc.includes('message.includes("Save your signature in Settings")') && appSrc.includes('className="status error status-link"') && appSrc.includes('setScreen({ name: "settings" })'));
check("placement editor offers contractor fields", appSrc.includes('"contractorSignature"') || appSrc.includes('key: "contractorSignature"'));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
