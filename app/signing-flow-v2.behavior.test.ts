// Signing flow v2 (Danny 2026-10-17): the DocuSign-style signing rebuild.
// Commit 1 (compositor + server) coverage:
//  1. Date stamps width-fit: compositeSignatureStamps shrinks a long
//     date ("October 17, 2026") until it fits its box instead of letting
//     pdf-lib wrap it over the signature line; a wide box keeps the
//     full size.
//  2. Consent audit: submitDocumentSignature rejects a submission
//     without consented === true and accepts it with.
//  3. Signed-only public access: getDocumentLinkSignedPdf errors while
//     unsigned and serves the signed bytes (with a "-signed.pdf" name)
//     after the client signs.
//  4. Completion emails: on signing, every workspace owner is emailed
//     "<signer> signed <title>" with the signed PDF attached; the job's
//     client email gets "Your signed copy of <title>" with the same
//     attachment — and no client email goes out when the job has none.
//  5. "Email me a copy": emailDocumentLinkSignedCopy is signed-only,
//     validates the address, sends through the attachment email path,
//     and is rate-limited per link.
// Client source pins for commits 2 + 3 live at the bottom of this file.
//
// Run from app/:  bun signing-flow-v2.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { unzlibSync } from "fflate";

import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";
import { privileged } from "./server/src/privileged.ts";
import {
  compositeSignatureStamps,
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
const throwsAsync = async (name: string, fn: () => Promise<unknown>, match = "") => {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(name, !match || msg.includes(match), msg);
  }
};

// Inflate every stream in a PDF and return the concatenated content, so
// drawn operators (font size + text) can be inspected. Same trick as
// signature-placement's pdfText helper, kept raw here.
function pdfStreams(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  let out = "";
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    try {
      out += Buffer.from(unzlibSync(Buffer.from(raw.slice(start, end), "latin1"))).toString("latin1");
    } catch { /* not a flate stream */ }
  }
  return out;
}
// The font size (Tf) in effect where `text` is shown: pdf-lib writes the
// string as a hex Tj; the size operator sits just before it in the block.
function drawnFontSize(streams: string, text: string): number | null {
  const hex = Buffer.from(text, "latin1").toString("hex");
  const idx = streams.toLowerCase().indexOf(hex.toLowerCase());
  if (idx < 0) return null;
  const before = streams.slice(0, idx);
  // pdf-lib names embedded fonts "/Helvetica-<hash>", so match any
  // resource name in front of the size + Tf operator.
  const matches = [...before.matchAll(/\/[A-Za-z0-9-]+\s+([\d.]+)\s+Tf/g)];
  const last = matches[matches.length - 1];
  return last ? Number(last[1]) : null;
}

// --- 1. Date stamp width fitting -------------------------------------------------
const scratchPdf = await PDFDocument.create();
const helvetica = await scratchPdf.embedFont(StandardFonts.Helvetica);
async function makePdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = pdf.addPage([612, 792]);
    p.drawText(`Contract page ${i + 1}`, { x: 48, y: 720, size: 14 });
  }
  return pdf.save();
}
const onePage = await makePdf(1);
const LONG_DATE = "October 17, 2026";
const narrowFields: SignatureFields = {
  clientDate: { page: 1, xPct: 0.08, yPct: 0.3, wPct: 0.15, hPct: 0.05 },
};
const narrowOut = await compositeSignatureStamps(onePage, narrowFields, [
  { role: "client", dateText: LONG_DATE },
]);
const narrowSize = drawnFontSize(pdfStreams(narrowOut), LONG_DATE);
const narrowBoxW = 0.15 * 612;
check("narrow date box: the date was drawn", narrowSize !== null);
check("narrow date box: font shrank below the old fixed 14pt", narrowSize !== null && narrowSize < 14, String(narrowSize));
check(
  "narrow date box: drawn text fits the box width",
  narrowSize !== null && helvetica.widthOfTextAtSize(LONG_DATE, narrowSize) <= narrowBoxW - 2 + 0.75,
  narrowSize !== null ? `width ${helvetica.widthOfTextAtSize(LONG_DATE, narrowSize).toFixed(1)} vs box ${narrowBoxW}` : "no size",
);
check("narrow date box: font stayed at or above the 6pt floor", narrowSize !== null && narrowSize >= 6, String(narrowSize));
const wideFields: SignatureFields = {
  clientDate: { page: 1, xPct: 0.08, yPct: 0.3, wPct: 0.4, hPct: 0.05 },
};
const wideOut = await compositeSignatureStamps(onePage, wideFields, [
  { role: "client", dateText: LONG_DATE },
]);
const wideSize = drawnFontSize(pdfStreams(wideOut), LONG_DATE);
check("wide date box: full 14pt size kept", wideSize === 14, String(wideSize));

// --- Harness -----------------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-signv2-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const blobStore = new Map<string, Buffer>();
const sentEmails: Array<{ to: string; subject: string; text: string; attachments: Array<{ filename: string; contentType: string; dataBase64: string }> }> = [];
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
  executePrivileged: async (contract: unknown, args: any) => {
    // Match by contract name, not object identity: actions.ts imports
    // the contracts extensionlessly, which can yield a second module
    // instance under Bun — the descriptor's `name` is the stable seam.
    if ((contract as { name?: string } | null)?.name === privileged.sendBackupEmail.name) {
      sentEmails.push(args);
      return { delivery: "sent" };
    }
    throw new Error("not stubbed");
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
const jobWithEmail = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Denny", clientEmail: "client@test.com", jobAddress: "456 bgyu", jobType: "Concrete pad", jobDate: "2026-10-17", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const jobNoEmail = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Noemail Client", clientEmail: "", jobAddress: "1 Nowhere Ln", jobType: "Deck", jobDate: "2026-10-18", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;

const twoPage = await makePdf(2);
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const originalBase64 = Buffer.from(twoPage).toString("base64");
const pngBase64 = pngBytes.toString("base64");

async function makeDoc(jobId: number, title: string): Promise<number> {
  const saved = await A.saveDocument.handler(ctx, {
    jobId, kind: "contract", title, bodyText: "",
    originalFilename: "contract.pdf", originalDataBase64: originalBase64,
    description: "", amount: "", signerName: "Denny",
    signatureDataBase64: pngBase64, signedAt: now.toISOString(),
  });
  return saved.id as number;
}
const docA = await makeDoc(jobWithEmail, "Concrete pad contract");
const docB = await makeDoc(jobNoEmail, "Deck contract");
const linkA = await A.createDocumentLink.handler(ctx, { kind: "contract", id: docA });
const linkB = await A.createDocumentLink.handler(ctx, { kind: "contract", id: docB });

// The signed bytes the browser would upload: original pages + client stamp.
const clientSignedBytes = await compositeSignatureStamps(twoPage, {}, [
  { role: "client", imageBytes: pngBytes, imageFormat: "png", dateText: LONG_DATE },
]);
const signArgsFor = (token: string) => ({
  token, signerName: "Denny Client", signatureDataBase64: pngBase64,
  signedPdfDataBase64: Buffer.from(clientSignedBytes).toString("base64"), userAgent: "test",
});

// --- 2. Consent ----------------------------------------------------------------------
await throwsAsync("signing without consent is rejected", () =>
  A.submitDocumentSignature.handler(ctx, { ...signArgsFor(linkA.token) }), "agree to sign electronically");
await throwsAsync("signing with consented:false is rejected", () =>
  A.submitDocumentSignature.handler(ctx, { ...signArgsFor(linkA.token), consented: false }), "agree to sign electronically");
const unsignedPayload = await A.resolveDocumentLink.handler(ctx, { token: linkA.token, userAgent: "test" });
check("rejected signings left the document unsigned", unsignedPayload.alreadySigned === false);

// --- 3. Signed-only access while unsigned ---------------------------------------------
await throwsAsync("signed PDF fetch errors while unsigned", () =>
  A.getDocumentLinkSignedPdf.handler(ctx, { token: linkA.token, lang: "en" }), "not been signed yet");
await throwsAsync("email-a-copy errors while unsigned", () =>
  A.emailDocumentLinkSignedCopy.handler(ctx, { token: linkA.token, email: "copy@me.com", lang: "en" }), "not been signed yet");
check("no emails went out for the unsigned document", sentEmails.length === 0, String(sentEmails.length));

// --- Sign doc A (job WITH a client email) ----------------------------------------------
await A.submitDocumentSignature.handler(ctx, { ...signArgsFor(linkA.token), consented: true });
check("owner got the signed notification with the PDF attached",
  sentEmails.some((m) => m.to === "owner@test.com" && m.subject === `Denny Client signed "Concrete pad contract"` && m.attachments?.[0]?.filename === "Concrete_pad_contract-signed.pdf" && m.attachments?.[0]?.contentType === "application/pdf"),
  JSON.stringify(sentEmails.map((m) => [m.to, m.subject])));
check("client got their signed copy at the job email",
  sentEmails.some((m) => m.to === "client@test.com" && m.subject === `Your signed copy of "Concrete pad contract"` && (m.attachments?.[0]?.dataBase64?.length ?? 0) > 100),
  JSON.stringify(sentEmails.map((m) => [m.to, m.subject])));
check("exactly the two completion emails went out", sentEmails.length === 2, String(sentEmails.length));

const signedPayload = await A.resolveDocumentLink.handler(ctx, { token: linkA.token, userAgent: "test" });
check("payload names the client signer for the completion panel", signedPayload.clientSignerName === "Denny Client", signedPayload.clientSignerName);
check("payload carries the client signed timestamp", typeof signedPayload.clientSignedAt === "string" && signedPayload.clientSignedAt.length > 0);

// --- 3b. Signed PDF fetch after signing ---------------------------------------------------
const servedSigned = await A.getDocumentLinkSignedPdf.handler(ctx, { token: linkA.token, lang: "en" });
check("signed PDF filename ends in -signed.pdf", servedSigned.filename === "Concrete_pad_contract-signed.pdf", servedSigned.filename);
check("signed PDF serves the signed bytes", (await PDFDocument.load(Buffer.from(servedSigned.pdfBase64, "base64"))).getPageCount() === 2);
await throwsAsync("signed PDF fetch rejects a bad token", () =>
  A.getDocumentLinkSignedPdf.handler(ctx, { token: "z".repeat(32), lang: "en" }));

// --- 5. Email me a copy ---------------------------------------------------------------------
const beforeCopy = sentEmails.length;
await A.emailDocumentLinkSignedCopy.handler(ctx, { token: linkA.token, email: "copy@me.com", lang: "es" });
check("email-a-copy sends the signed PDF to the requested address",
  sentEmails.length === beforeCopy + 1 && sentEmails[sentEmails.length - 1]!.to === "copy@me.com"
  && sentEmails[sentEmails.length - 1]!.subject.includes("copia firmada")
  && sentEmails[sentEmails.length - 1]!.attachments?.[0]?.filename === "Concrete_pad_contract-signed.pdf");
await throwsAsync("email-a-copy rejects a malformed address", () =>
  A.emailDocumentLinkSignedCopy.handler(ctx, { token: linkA.token, email: "not-an-email", lang: "en" }), "valid email");
check("malformed address sent nothing", sentEmails.length === beforeCopy + 1);
await throwsAsync("email-a-copy rejects a bad token", () =>
  A.emailDocumentLinkSignedCopy.handler(ctx, { token: "z".repeat(32), email: "copy@me.com", lang: "en" }));

// --- 4b. Sign doc B (job WITHOUT a client email) ----------------------------------------------
const beforeB = sentEmails.length;
await A.submitDocumentSignature.handler(ctx, { ...signArgsFor(linkB.token), consented: true });
check("owner still notified for the no-client-email job",
  sentEmails.slice(beforeB).some((m) => m.to === "owner@test.com" && m.subject === `Denny Client signed "Deck contract"`));
check("no client copy email when the job has no client email",
  sentEmails.slice(beforeB).length === 1 && !sentEmails.slice(beforeB).some((m) => m.subject.startsWith("Your signed copy")),
  JSON.stringify(sentEmails.slice(beforeB).map((m) => [m.to, m.subject])));

// --- 5b. Rate limit ------------------------------------------------------------------------------
for (let i = 0; i < 5; i++) {
  await A.emailDocumentLinkSignedCopy.handler(ctx, { token: linkB.token, email: "copy@me.com", lang: "en" });
}
await throwsAsync("email-a-copy is rate-limited per link", () =>
  A.emailDocumentLinkSignedCopy.handler(ctx, { token: linkB.token, email: "copy@me.com", lang: "en" }), "Too many email requests");

// --- Source pins (commit 1) -------------------------------------------------------------------------
const serverSrc = await readFile("server/src/actions.ts", "utf8");
const compositeSrc = await readFile("client/src/signatureComposite.ts", "utf8");
check("signed-only PDF action exists", serverSrc.includes("getDocumentLinkSignedPdf: defineAction"));
check("email-a-copy action exists", serverSrc.includes("emailDocumentLinkSignedCopy: defineAction"));
check("both new actions are public", serverSrc.includes('"getDocumentLinkSignedPdf"') && serverSrc.includes('"emailDocumentLinkSignedCopy"'));
check("consent is required by the signing schema", serverSrc.includes("consented: z.literal(true)"));
const stampSlice = compositeSrc.slice(compositeSrc.indexOf("export async function compositeSignatureStamps"), compositeSrc.indexOf("export async function compositeSignatureStamps") + 4000);
check("date stamp fits by measured text width", stampSlice.includes("font.widthOfTextAtSize(stamp.dateText"));
check("date stamp no longer relies on pdf-lib maxWidth wrapping", !stampSlice.includes("maxWidth: dW"));

// --- Source pins (commit 2: public sign page) ------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const themeSrc = await readFile("client/src/theme.css", "utf8");
check("sign page has the Review & sign hero (EN/ES)", appSrc.includes('"Review & sign"') && appSrc.includes('"Revisa y firma"'));
check("sign page asks who sent it (company from payload)", appSrc.includes("sent you this document to sign") && appSrc.includes("te envió este documento para tu firma"));
check("consent checkbox copy ships in EN and ES", appSrc.includes("I agree to sign this document electronically.") && appSrc.includes("Acepto firmar este documento electrónicamente."));
check("sign button is gated on consent", appSrc.includes("fillMissingRequired || !consented"));
check("sign submission sends the consent assertion", appSrc.includes("consented: true,"));
check("sticky sign bar exists with its status + jump button", appSrc.includes('className="client-sign-bar"') && appSrc.includes('className="client-sign-bar-status"') && appSrc.includes("scrollIntoView"));
check("sticky bar counts down required fields (EN/ES)", appSrc.includes("required ${signRemaining === 1 ? \"field\" : \"fields\"} left") && appSrc.includes("Listo para firmar") && appSrc.includes("Ready to sign"));
check("sign panel carries the scroll anchor id", appSrc.includes('id="client-sign-panel"'));
check("completion panel renders the signed pages", appSrc.includes('variant="signed"'));
check("completion panel downloads via the signed-only action", appSrc.includes("api.getDocumentLinkSignedPdf") && appSrc.includes("Download signed PDF") && appSrc.includes("Descargar PDF firmado"));
check("completion panel emails a copy via the new action", appSrc.includes("api.emailDocumentLinkSignedCopy") && appSrc.includes("Email me a copy") && appSrc.includes("Enviarme una copia por correo"));
check("unsigned pages stop rendering once signed", appSrc.includes("{!doc.alreadySigned && <PdfPageView token={token} lang={lang} title={doc.title} />}"));
check("sticky bar styles ship", themeSrc.includes(".client-sign-bar {") && themeSrc.includes(".client-sign-hero {"));

// --- Source pins (commit 3: in-app signed-first document view) ---------------------------
const pdfPagesSlice = appSrc.slice(appSrc.indexOf("function DocumentPdfPages"), appSrc.indexOf("function DocumentPdfPages") + 700);
check("detail pages render signed-first once client-signed", pdfPagesSlice.includes("doc.clientSignedAt && doc.signedPdfUrl ? doc.signedPdfUrl : doc.originalUrl"));
check("detail screen labels the signed copy (EN/ES)", appSrc.includes('"Signed copy"') && appSrc.includes('"Copia firmada"'));
check("redundant View signed copy anchor is gone", !appSrc.includes("View signed copy") && !appSrc.includes("Ver copia firmada"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
