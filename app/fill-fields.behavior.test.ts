// Fill-in fields behavior tests (0082, Danny 2026-10-17): DocuSign-style
// TEXT / INITIALS / CHECKBOX fields the sender places on an uploaded-PDF
// document next to the 0078 signature fields. Client-role fields are
// filled on the public sign page; contractor-role fields carry a prefill;
// every value is drawn into the final signed PDF.
//
// Covers:
//  1. Migration 0082: documents.fill_fields_json + fill_values_json,
//     journal tag 0082_fill_fields, when strictly increasing.
//  2. parseFillFields / serializeFillFields cleaning (bad kind/role/id/
//     placement dropped, 30-field cap, label defaults) and
//     parseFillValues cleaning.
//  3. compositeFillFields: text + initials drawn into the PDF, checked
//     checkbox draws without error, out-of-range page skipped, page
//     count never grows, contractor prefill resolves.
//  4. Action layer: saveDocumentFillFields round-trips through
//     listDocuments and rejects text-only documents; the public link
//     payload exposes ONLY client-role definitions plus stored values;
//     a client sign missing a required value is rejected; a sign with
//     values stores them and the served signed PDF contains the filled
//     text; signDocumentWithDrawnSignature regenerates a PDF that still
//     contains the filled text.
//
// Run from app/:  bun fill-fields.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { unzlibSync } from "fflate";

// pdf-lib compresses the content streams it writes, so drawn text is
// searched after inflating every stream in the file. (Same helper as
// signature-placement.behavior.test.ts.)
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
  compositeFillFields,
  compositeSignatureStamps,
  parseFillFields,
  parseFillValues,
  serializeFillFields,
  type FillField,
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
check("newest migration tag is 0084_support_screenshots", entries[entries.length - 1].tag === "0084_support_screenshots", entries[entries.length - 1].tag);
check("0082 when strictly greater than 0081", byTag["0082_fill_fields"].when > byTag["0081_client_addresses"].when);
const sql82 = await readFile(join("drizzle", "0082_fill_fields.sql"), "utf8");
check("0082 adds fill_fields_json + fill_values_json", sql82.includes("ADD COLUMN `fill_fields_json`") && sql82.includes("ADD COLUMN `fill_values_json`"));

const dir = await mkdtemp(join(tmpdir(), "crewkat-fill-b-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
const docCols = (await client.execute("PRAGMA table_info(documents)")).rows.map((r) => (r as any).name as string);
check("documents.fill_fields_json exists", docCols.includes("fill_fields_json"));
check("documents.fill_values_json exists", docCols.includes("fill_values_json"));

// --- 2. Parse / serialize ---------------------------------------------------------
const goodField: FillField = { id: "f-name", kind: "text", role: "client", label: "Full name", required: true, page: 1, xPct: 0.1, yPct: 0.5, wPct: 0.34, hPct: 0.045 };
check("serialize/parse round-trips", JSON.stringify(parseFillFields(serializeFillFields([goodField]))) === JSON.stringify([goodField]));
check("garbage JSON parses to empty array", parseFillFields("not json").length === 0);
check("non-array JSON parses to empty array", parseFillFields("{}").length === 0);
const mixed = parseFillFields(JSON.stringify([
  goodField,
  { ...goodField, id: "f-bad-kind", kind: "signature" },
  { ...goodField, id: "f-bad-role", role: "admin" },
  { ...goodField, id: "BAD ID!" },
  { ...goodField, id: "f-bad-place", xPct: 0.95, wPct: 0.5 },
  { ...goodField, id: "f-bad-page", page: 0 },
]));
check("invalid kind/role/id/placement entries are dropped", mixed.length === 1 && mixed[0]!.id === "f-name", JSON.stringify(mixed.map((f) => f.id)));
const many = parseFillFields(JSON.stringify(Array.from({ length: 35 }, (_, i) => ({ ...goodField, id: `f-${i}` }))));
check("field count caps at 30", many.length === 30, String(many.length));
const unlabeled = parseFillFields(JSON.stringify([{ ...goodField, id: "f-nolabel", label: "   " }]));
check("empty label defaults to the kind label", unlabeled[0]?.label === "Text field", unlabeled[0]?.label);
const longLabel = parseFillFields(JSON.stringify([{ ...goodField, id: "f-longlabel", label: "x".repeat(120) }]));
check("label truncates at 80 chars", longLabel[0]?.label.length === 80);
check("duplicate ids keep the first field", parseFillFields(JSON.stringify([goodField, { ...goodField, label: "Other" }])).length === 1);

const values = parseFillValues(JSON.stringify({ a: "hello", b: true, c: 42, d: "x".repeat(501), ["k".repeat(41)]: "v" }));
check("parseFillValues keeps strings + booleans only", values.a === "hello" && values.b === true && !("c" in values));
check("parseFillValues drops oversized values + keys", !("d" in values) && Object.keys(values).length === 2);
check("parseFillValues garbage -> {}", Object.keys(parseFillValues("nope")).length === 0 && Object.keys(parseFillValues("[1]")).length === 0);

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
const twoPage = await makePdf(2);
const fillDefs: FillField[] = [
  { id: "f-name", kind: "text", role: "client", label: "Full name", required: true, page: 2, xPct: 0.08, yPct: 0.6, wPct: 0.4, hPct: 0.045 },
  { id: "f-init", kind: "initials", role: "client", label: "Initials", required: true, page: 2, xPct: 0.55, yPct: 0.6, wPct: 0.16, hPct: 0.045 },
  { id: "f-agree", kind: "checkbox", role: "client", label: "I agree", required: false, page: 2, xPct: 0.08, yPct: 0.68, wPct: 0.05, hPct: 0.035 },
  { id: "f-scope", kind: "text", role: "contractor", label: "Scope note", required: false, page: 1, xPct: 0.08, yPct: 0.3, wPct: 0.5, hPct: 0.045, value: "Prefilled by sender" },
  { id: "f-far", kind: "text", role: "client", label: "Beyond pages", required: false, page: 9, xPct: 0.08, yPct: 0.3, wPct: 0.4, hPct: 0.045 },
];
const filledOut = await compositeFillFields(twoPage, fillDefs, { "f-name": "Denny Client", "f-init": "DC", "f-agree": true, "f-far": "Nowhere" });
check("fill composite keeps the original page count", (await PDFDocument.load(filledOut)).getPageCount() === 2);
check("filled text value is drawn into the PDF", pdfText(filledOut).includes("Denny Client"));
check("filled initials are drawn into the PDF", pdfText(filledOut).includes("DC"));
check("contractor prefill resolves without a signer value", pdfText(filledOut).includes("Prefilled by sender"));
const uncheckedOut = await compositeFillFields(twoPage, fillDefs, { "f-name": "Denny Client", "f-agree": false });
check("unchecked checkbox composites without error", (await PDFDocument.load(uncheckedOut)).getPageCount() === 2);

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
const jobId = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Denny", jobAddress: "456 bgyu", jobType: "Concrete pad", jobDate: "2026-10-17", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const originalBase64 = Buffer.from(twoPage).toString("base64");
const pngBase64 = pngBytes.toString("base64");

const savedDoc = await A.saveDocument.handler(ctx, {
  jobId, kind: "contract", title: "Concrete pad contract", bodyText: "",
  originalFilename: "concrete-pad-contract.pdf", originalDataBase64: originalBase64,
  description: "", amount: "", signerName: "Denny",
  signatureDataBase64: pngBase64, signedAt: now.toISOString(),
});
await A.saveDocumentFillFields.handler(ctx, { documentId: savedDoc.id, fields: fillDefs });
const listed = await A.listDocuments.handler(ctx, {});
const listedDoc = listed.documents.find((d: any) => d.id === savedDoc.id);
check("fill fields hydrate through listDocuments", listedDoc?.fillFields?.length === 5 && listedDoc?.fillFields?.find((f: any) => f.id === "f-scope")?.value === "Prefilled by sender");
check("stored values start empty", Object.keys(listedDoc?.fillValues ?? {}).length === 0);

// Fill fields require an uploaded PDF.
const textDoc = await A.saveDocument.handler(ctx, {
  jobId, kind: "contract", title: "Text-only", bodyText: "Terms.",
  originalFilename: "", originalDataBase64: "",
  description: "", amount: "", signerName: "Denny",
  signatureDataBase64: pngBase64, signedAt: now.toISOString(),
});
await throwsAsync("fill fields on a text-only document are rejected", () => A.saveDocumentFillFields.handler(ctx, { documentId: textDoc.id, fields: fillDefs }));

const link = await A.createDocumentLink.handler(ctx, { kind: "contract", id: savedDoc.id });
const payload = await A.resolveDocumentLink.handler(ctx, { token: link.token, userAgent: "test" });
check("public payload carries client-role fill fields", Array.isArray(payload.fillFields) && payload.fillFields.length === 4 && payload.fillFields.every((f: any) => f.role === "client"));
check("public payload never leaks contractor fill fields", !(payload.fillFields ?? []).some((f: any) => f.id === "f-scope"));
check("public payload values start empty", Object.keys(payload.fillValues ?? {}).length === 0);

// The client signs exactly as the sign page does: signature stamps are
// composited in the browser; fill values travel with the submission and
// the server draws them into the stored PDF.
const clientSignedBytes = await compositeSignatureStamps(twoPage, payload.signatureFields ?? {}, [
  { role: "client", imageBytes: pngBytes, imageFormat: "png", dateText: "October 17, 2026" },
]);
const signArgs = {
  token: link.token, signerName: "Denny Client", signatureDataBase64: pngBase64,
  signedPdfDataBase64: Buffer.from(clientSignedBytes).toString("base64"), userAgent: "test", consented: true,
};
await throwsAsync("sign without the required fill values is rejected", () =>
  A.submitDocumentSignature.handler(ctx, { ...signArgs, fillValues: { "f-init": "DC" } }));
await A.submitDocumentSignature.handler(ctx, {
  ...signArgs,
  fillValues: { "f-name": "Denny Client", "f-init": "DC", "f-agree": true, "f-scope": "MUST BE IGNORED" },
});
const afterSign = await A.listDocuments.handler(ctx, {});
const signedDoc = afterSign.documents.find((d: any) => d.id === savedDoc.id);
check("signer values are stored on the document", signedDoc?.fillValues?.["f-name"] === "Denny Client" && signedDoc?.fillValues?.["f-init"] === "DC" && signedDoc?.fillValues?.["f-agree"] === true);
check("contractor-role values in a submission are ignored", signedDoc?.fillValues?.["f-scope"] === undefined);
const served = await A.getDocumentLinkPdf.handler(ctx, { token: link.token, lang: "en" });
const servedBytes = Buffer.from(served.pdfBase64, "base64");
check("served signed PDF keeps the original page count", (await PDFDocument.load(servedBytes)).getPageCount() === 2);
check("served signed PDF contains the filled text value", pdfText(servedBytes).includes("Denny Client"));
check("served signed PDF contains the filled initials", pdfText(servedBytes).includes("DC"));
check("served signed PDF contains the contractor prefill", pdfText(servedBytes).includes("Prefilled by sender"));
const signedPayload = await A.resolveDocumentLink.handler(ctx, { token: link.token, userAgent: "test" });
check("signed payload exposes the stored values for the read-only view", signedPayload.fillValues?.["f-name"] === "Denny Client");

// Contractor re-signs with a freshly drawn signature: the regenerated
// final PDF must still carry the client's filled values.
await A.signDocumentWithDrawnSignature.handler(ctx, { documentId: savedDoc.id, signatureDataBase64: pngBase64 });
const docRow = (await db.select().from(schema.documents).where(eq(schema.documents.id, savedDoc.id)))[0]!;
const regenBytes = blobStore.get(docRow.clientSignedPdfBlobKey!);
check("drawn-signature re-sign produced a final PDF", !!regenBytes);
check("regenerated PDF still contains the filled text", regenBytes ? pdfText(regenBytes).includes("Denny Client") : false);
check("regenerated PDF still contains the contractor prefill", regenBytes ? pdfText(regenBytes).includes("Prefilled by sender") : false);

// --- 5. Source wiring -----------------------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
check("editor saves fill fields through the action", appSrc.includes("api.saveDocumentFillFields"));
check("sign page passes fill values with the signature", appSrc.includes("fillValues: submittedFill"));
check("detail screen shows the filled-in block", appSrc.includes("Filled in") && appSrc.includes("Datos completados"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
