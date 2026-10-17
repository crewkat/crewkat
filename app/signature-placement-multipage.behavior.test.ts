// Signature placement MULTI-PAGE behavior tests (fix round, Danny
// 2026-10-14): he uploaded a 4-page PDF contract and opened "Place
// signature" — only page 1 was usable. Pages 2–4 existed (the server
// rasterizer returns up to 20 pages and the editor maps them all) but
// were UNREACHABLE on his phone: .sig-place-page carried
// `touch-action: none`, so no touch-scroll could start on the page
// surface (which fills the screen), and placement fired on pointer
// DOWN, so even a scroll attempt first re-placed the field.
//
// Fix proven here:
//  1. Editor payload: renderPdfPreview returns every page of a real
//     4-page PDF (the exact payload SignaturePlacementEditor renders).
//  2. Sign page payload: getDocumentLinkPdfPages returns all 4 pages
//     for a multi-page uploaded contract (no single-page cap there).
//  3. Persistence: fields saved on page 3 / page 4 hydrate back through
//     listDocuments (the editor's reopen path) on their own pages.
//  4. Compositing: the hydrated fields stamp page 3 (client) and
//     page 4 (contractor) only; page count never grows.
//  5. Gesture model (source + CSS): the page surface allows vertical
//     touch scroll (pan-y), placed boxes keep touch-action:none so
//     dragging a field never scrolls, placement happens on a tap
//     (pointer up after a near-still press), and each page carries a
//     "Page N of M" badge.
//
// Run from app/:  bun signature-placement-multipage.behavior.test.ts
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
import { privilegedHandlers } from "./server/src/privileged.ts";
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

// pdf-lib compresses the content streams it writes, so drawn text is
// searched after inflating every stream in the file (same helper as the
// placement suite).
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

// --- Fixture: a REAL 4-page PDF, mirroring Danny's uploaded contract ----------
// (scope pages up front, the signatures block on the LAST page — the page
// he could not reach).
const fixture = await PDFDocument.create();
for (let i = 1; i <= 4; i++) {
  const p = fixture.addPage([612, 792]);
  p.drawText(`Garage Conversion - Scope and Contract - page ${i}`, { x: 48, y: 720, size: 14 });
  if (i === 4) {
    p.drawText("6. Signatures", { x: 48, y: 640, size: 13 });
    p.drawText("Client: ______________________________    Date: ______________", { x: 48, y: 200, size: 11 });
    p.drawText("Contractor: __________________________    Date: ______________", { x: 48, y: 120, size: 11 });
  }
}
const fourPageBytes = await fixture.save();
check("fixture PDF has 4 pages", (await PDFDocument.load(fourPageBytes)).getPageCount() === 4);
const fourPageBase64 = Buffer.from(fourPageBytes).toString("base64");

// --- Scratch DB + action harness (mirrors the Phase A suite) -------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-sig-mp-"));
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
await db.insert(schema.settings).values({ id: 1, companyName: "Stallions Construction Company LLC", updatedAt: now });
const jobId = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Anthony Porreca", jobAddress: "Clearwater, FL 33765", jobType: "Garage conversion", jobDate: "2026-10-16", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const pngBytes = Buffer.from(pngBase64, "base64");

// --- 1. Editor payload: every page of the 4-page PDF ---------------------------
const preview = await A.renderPdfPreview.handler(ctx, { dataBase64: fourPageBase64 });
check("editor payload carries all 4 pages", preview.pagesBase64.length === 4, String(preview.pagesBase64.length));
check("editor payload pages are real JPEGs", preview.pagesBase64.every((p: string) => { const b = Buffer.from(p, "base64"); return b[0] === 0xff && b[1] === 0xd8; }));

// --- 2. Sign page payload: all 4 pages for the multi-page contract -------------
const savedDoc = await A.saveDocument.handler(ctx, {
  jobId, kind: "contract", title: "Garage Conversion - Scope and Contract", bodyText: "",
  originalFilename: "anthony-garage-conversion-scope-and-contract.pdf", originalDataBase64: fourPageBase64,
  description: "", amount: "18500", signerName: "Anthony Porreca",
  signatureDataBase64: pngBase64, signedAt: now.toISOString(),
});
const link = await A.createDocumentLink.handler(ctx, { kind: "contract", id: savedDoc.id });
const signPages = await A.getDocumentLinkPdfPages.handler(ctx, { token: link.token, lang: "en" });
check("sign page receives all 4 rasterized pages", signPages.pagesBase64.length === 4, String(signPages.pagesBase64.length));
check("sign page pages are real JPEGs", signPages.pagesBase64.every((p: string) => { const b = Buffer.from(p, "base64"); return b[0] === 0xff && b[1] === 0xd8; }));

// --- 3. Fields on later pages persist + hydrate (the editor reopen path) -------
const fieldsToSave: SignatureFields = {
  clientSignature: { page: 3, xPct: 0.08, yPct: 0.72, wPct: 0.34, hPct: 0.075 },
  clientDate: { page: 3, xPct: 0.55, yPct: 0.72, wPct: 0.22, hPct: 0.05 },
  contractorSignature: { page: 4, xPct: 0.08, yPct: 0.78, wPct: 0.34, hPct: 0.075 },
  contractorDate: { page: 4, xPct: 0.55, yPct: 0.78, wPct: 0.22, hPct: 0.05 },
};
await A.saveDocumentSignatureFields.handler(ctx, { documentId: savedDoc.id, fields: fieldsToSave });
const listed = await A.listDocuments.handler(ctx, {});
const hydrated: SignatureFields = listed.documents.find((d: any) => d.id === savedDoc.id)?.signatureFields ?? {};
check("client signature persists on page 3", hydrated.clientSignature?.page === 3, JSON.stringify(hydrated.clientSignature));
check("client date persists on page 3", hydrated.clientDate?.page === 3);
check("contractor signature persists on page 4", hydrated.contractorSignature?.page === 4);
check("contractor date persists on page 4", hydrated.contractorDate?.page === 4);

// --- 4. Compositing with the hydrated fields stamps the right pages ------------
const clientOut = await compositeSignatureStamps(fourPageBytes, hydrated, [
  { role: "client", imageBytes: pngBytes, imageFormat: "png", dateText: "October 16, 2026" },
]);
check("client composite keeps 4 pages", (await PDFDocument.load(clientOut)).getPageCount() === 4);
check("client stamp lands on page 3", await pageHasImage(clientOut, 2));
check("client stamp is NOT on page 1", !(await pageHasImage(clientOut, 0)));
check("client stamp is NOT on page 2", !(await pageHasImage(clientOut, 1)));
check("client stamp is NOT on page 4", !(await pageHasImage(clientOut, 3)));
check("client date text is drawn", pdfText(clientOut).includes("October 16, 2026"));

const bothOut = await compositeSignatureStamps(fourPageBytes, hydrated, [
  { role: "client", imageBytes: pngBytes, imageFormat: "png", dateText: "October 16, 2026" },
  { role: "contractor", imageBytes: pngBytes, imageFormat: "png", dateText: "October 16, 2026" },
]);
check("both-role composite stamps page 3 AND page 4", (await pageHasImage(bothOut, 2)) && (await pageHasImage(bothOut, 3)));
check("both-role composite leaves pages 1-2 clean", !(await pageHasImage(bothOut, 0)) && !(await pageHasImage(bothOut, 1)));

// --- 5. Gesture model: editor + CSS source checks -------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const themeCss = await readFile("client/src/theme.css", "utf8");
const cssRule = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  const end = css.indexOf("}", start);
  return css.slice(start, end);
};
const fnBody = (src: string, from: string, to: string) => {
  const start = src.indexOf(from);
  if (start < 0) return "";
  const end = src.indexOf(to, start);
  return src.slice(start, end < 0 ? undefined : end);
};

const pageRule = cssRule(themeCss, ".sig-place-page");
check("page surface allows vertical touch scroll (pan-y)", pageRule.includes("touch-action: pan-y"), pageRule);
check("page surface no longer blocks touch scroll", !pageRule.includes("touch-action: none"), pageRule);
check("placed boxes still block scroll (drag never scrolls)", cssRule(themeCss, ".sig-place-box").includes("touch-action: none"));

const pointerDownBody = fnBody(appSrc, "const onPagePointerDown", "const onPagePointerUp");
check("pointer down only records a tap candidate", pointerDownBody.includes("tapRef.current") && !pointerDownBody.includes("placeAt("), pointerDownBody.slice(0, 200));
const pointerUpBody = fnBody(appSrc, "const onPagePointerUp", "const onPagePointerCancel");
check("placement fires on pointer up", pointerUpBody.includes("placeAt(pageIndex, tap.x, tap.y)"), pointerUpBody.slice(0, 200));
check("a travelled press is not a tap (scroll guard)", pointerUpBody.includes("Math.hypot"));
check("pointer cancel clears the tap candidate", fnBody(appSrc, "const onPagePointerCancel", "const onBoxPointerDown").includes("tapRef.current = null"));
check("editor renders every payload page", appSrc.includes("pages.map((page, pageIndex)"));
check("editor shows a Page N of M badge", appSrc.includes("sig-place-pageno") && appSrc.includes("of ${pages.length}"));
check("editor renders placed fields only on their own page", appSrc.includes("fields[key]!.page === pageIndex + 1"));
// 2026-10-17 design overhaul: the old two-line instruction (with its scroll
// hint) became one dynamic line naming the selected field, and page
// navigation moved to the slim bottom page bar. Same intent — the editor
// still tells the user how placement works and how to reach later pages.
check("placement hint + page bar are in the editor copy",
  appSrc.includes("placeTapHint") && appSrc.includes("placeDragHint") && appSrc.includes("sig-place-pagenav") && appSrc.includes("goToPage"));

// 2026-10-17 (Danny): the selected-field strips (signature "Field
// width" slider + Remove, and the fill-field config strip) dock INSIDE
// the sticky head, so they stay visible while the pages scroll beneath
// them — the width slider can be dragged while watching the field on a
// later page resize.
const headBlock = fnBody(appSrc, 'className="sig-place-head"', 'className="sig-place-body"');
check("selected-field strips are docked in the sticky head",
  headBlock.includes("sig-place-controls") && headBlock.includes("sig-place-fill-editor"));
check("the sticky head carries the strips (sticky + solid surface + hairline)",
  cssRule(themeCss, ".sig-place-head").includes("position: sticky") && cssRule(themeCss, ".sig-place-head").includes("background") && cssRule(themeCss, ".sig-place-head").includes("border-bottom"));
const bodyBlock = fnBody(appSrc, 'className="sig-place-body"', 'className="sig-place-pagenav"');
check("pages body no longer carries the strips", !bodyBlock.includes("sig-place-controls"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
