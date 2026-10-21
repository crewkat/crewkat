// Change orders as official documents (Danny 2026-10-21): a change
// order renders as a formal legal document — CO number, parties,
// reference to the original contract, scope, the contract-sum chain
// (sum before / this CO / new sum, computed server-side, only SIGNED
// COs advance the chain), schedule + payment + other-terms-unchanged
// lines, both signature blocks — and the same canonical PDF serves the
// document link, the portal, and the owner's copy. The portal lists
// COs by formal title + amount and opens the document (no quick-sign
// pad as the primary path); the job shows the revised contract total
// from signed COs only.
//
// Covers:
//  1. Numbering: derived per job in createdAt/id order, identical in
//     getJob, listDocuments, the link payload, and the portal; stable
//     when more COs are added later; per-job (another job restarts at 1).
//  2. Price math: before/after sums across multiple COs incl. a $0 CO
//     and a negative CO; an unsigned CO does not move the chain; the
//     original amount comes from the contract document (fallback:
//     job amountDue).
//  3. Legal lines in the rendered PDF, EN + ES (title, parties, job,
//     reference, scope, chain amounts, schedule, payment, terms,
//     "on behalf of" contractor block, both signer names).
//  4. Portal Documents list: CO row shows formal title + amount +
//     awaiting status, and the /d/ href when a link exists; portal
//     changeOrders carry number + chain + href.
//  5. Signing through the document path stores the canonical signed
//     PDF (getDocumentLinkSignedPdf serves the formal document) and
//     the job's revised total counts signed COs only; portal signing
//     builds the canonical formal PDF server-side; getJobOperations'
//     budgetTotal (quoted + ALL COs) keeps its meaning throughout.
//  6. Owner copy: getDocumentPdf serves the formal document for a
//     generated CO, unsigned and signed.
//  7. Isolation: job B's portal token cannot see, sign, or download
//     job A's COs; another company's CO never leaks into job A's
//     payloads.
//  8. An uploaded-PDF CO keeps the canonical-PDF behavior (hasOriginalPdf,
//     stored bytes served, formal title still derived).
//  9. Client + server source wiring.
//
// Run from app/:  bun change-order-documents.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";

import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";
import { buildChangeOrderPdf } from "./client/src/financialPdf.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// PDF text extraction: jsPDF content streams are plain here — pull the
// (string) Tj operands out of the raw bytes, decode PDF escapes, and
// join so wrapped lines recombine into phrases.
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const parts: string[] = [];
  const re = /\((?:\\.|[^\\()])*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) parts.push(m[0].slice(1, -1));
  return parts
    .join(" ")
    .replace(/\\([0-7]{1,3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ");
}

// --- Harness -------------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-co-docs-"));
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
const mkJob = async (clientName: string, jobAddress: string, companyId = 1, amountDue = "") =>
  (await db.insert(schema.jobs).values({ companyId, clientName, clientEmail: "client@example.com", jobAddress, jobType: "Garage conversion", jobDate: "2026-10-19", amountDue, createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const jobA = await mkJob("Anthony Porreca", "2337 Eastwood Dr, Clearwater, FL 33765");
const jobB = await mkJob("Other Client", "9 Elsewhere St");
const jobC2 = await mkJob("Rival Client", "1 Competitor Way", 2, "5000");

const pngBase64 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64").toString("base64");
async function makeDoc(jobId: number, kind: "contract" | "change_order", fields: { title: string; description?: string; amount?: string; originalDataBase64?: string }): Promise<number> {
  const saved = await A.saveDocument.handler(ctx, {
    jobId, kind, title: fields.title, bodyText: kind === "contract" ? "Garage conversion agreement body." : "",
    originalFilename: fields.originalDataBase64 ? "uploaded.pdf" : "", originalDataBase64: fields.originalDataBase64 ?? "",
    description: fields.description ?? "", amount: fields.amount ?? "", signerName: "Dennys Hernandez",
    signatureDataBase64: pngBase64, signedAt: now.toISOString(),
  });
  return saved.id as number;
}

// --- Seed job A: contract ($18,180) + four COs --------------------------------
const contractA = await makeDoc(jobA, "contract", { title: "Garage conversion contract", amount: "18180.00" });
const co1 = await makeDoc(jobA, "change_order", { title: "Change order", description: "Replace door to water heater closet, new hardware, painted black.", amount: "480" });
const co2 = await makeDoc(jobA, "change_order", { title: "Change order", description: "Arcade outlet on its own circuit", amount: "140" });
const co3 = await makeDoc(jobA, "change_order", { title: "Change order", description: "Carpet swap — no price change", amount: "0" });
const co4 = await makeDoc(jobA, "change_order", { title: "Change order", description: "Credit for owner-supplied flooring", amount: "-200" });

// --- 1. Numbering + hydration ----------------------------------------------------
const jobDataA = await A.getJob.handler(ctx, { id: jobA });
const docById = new Map(jobDataA.documents.map((d: any) => [d.id, d]));
check("CO numbers follow creation order", [co1, co2, co3, co4].every((id, i) => docById.get(id)?.coNumber === i + 1), JSON.stringify([co1, co2, co3, co4].map((id) => docById.get(id)?.coNumber)));
check("display title carries number + scope label", docById.get(co2)?.displayTitle === "Change Order #2 — Arcade outlet on its own circuit", docById.get(co2)?.displayTitle);
check("contract keeps its plain title + null number", docById.get(contractA)?.displayTitle === "Garage conversion contract" && docById.get(contractA)?.coNumber === null);
const allDocs = await A.listDocuments.handler(ctx, {});
const listedCo3 = allDocs.documents.find((d: any) => d.id === co3);
check("listDocuments agrees on numbering", listedCo3?.coNumber === 3 && listedCo3?.displayTitle.startsWith("Change Order #3"), listedCo3?.displayTitle);

// --- 2. Price math (all unsigned) --------------------------------------------------
const linkCo2 = await A.createDocumentLink.handler(ctx, { kind: "change_order", id: co2 });
const payloadCo2 = await A.resolveDocumentLink.handler(ctx, { token: linkCo2.shortCode, userAgent: "test" });
check("link payload title is the formal CO title", payloadCo2.title === "Change Order #2 — Arcade outlet on its own circuit", payloadCo2.title);
check("CO2 chain: before = original contract sum", payloadCo2.changeOrder?.contractSumBefore === "18180.00", payloadCo2.changeOrder?.contractSumBefore);
check("CO2 chain: amount normalized", payloadCo2.changeOrder?.amount === "140.00", payloadCo2.changeOrder?.amount);
check("CO2 chain: new sum", payloadCo2.changeOrder?.newContractSum === "18320.00", payloadCo2.changeOrder?.newContractSum);
check("CO2 payload names the reference contract", payloadCo2.changeOrder?.referenceContract === "Garage conversion contract", payloadCo2.changeOrder?.referenceContract);
const summary0 = jobDataA.contractSummary;
check("summary starts at the original contract", summary0?.baseAmount === "18180.00" && summary0?.revisedTotal === "18180.00" && summary0?.signedChangeOrdersTotal === "0.00", JSON.stringify(summary0));
check("summary pending = all four COs (480+140+0-200)", summary0?.pendingChangeOrdersTotal === "420.00", summary0?.pendingChangeOrdersTotal);
const ops0 = await A.getJobOperations.handler(ctx, { jobId: jobA });
check("profitability keeps quoted + ALL COs semantics", ops0.profitability.changeOrdersTotal === 420 && ops0.profitability.budgetTotal === 420, JSON.stringify(ops0.profitability));

// --- 3. Legal lines in the rendered PDF (EN + ES) -----------------------------------
const linkCo1 = await A.createDocumentLink.handler(ctx, { kind: "change_order", id: co1 });
const pdfResEn = await A.getDocumentLinkPdf.handler(ctx, { token: linkCo1.token, lang: "en" });
const textEn = pdfText(Buffer.from(pdfResEn.pdfBase64, "base64"));
check("EN PDF: formal title", textEn.includes("Change Order #1"), textEn.slice(0, 200));
check("EN PDF: company + client + job named", textEn.includes("Stallions Construction Company LLC") && textEn.includes("Anthony Porreca") && textEn.includes("2337 Eastwood Dr"), "");
check("EN PDF: reference to the original contract", textEn.includes("Garage conversion contract") && textEn.includes("modifies the original contract"), "");
check("EN PDF: scope rendered", textEn.includes("Replace door to water heater closet"), "");
check("EN PDF: price chain amounts", textEn.includes("$18,180.00") && textEn.includes("$480.00") && textEn.includes("$18,660.00"), "");
check("EN PDF: schedule line", textEn.includes("No change to the contract time"), "");
check("EN PDF: payment line", textEn.includes("due in accordance with the payment terms of the original contract"), "");
check("EN PDF: other-terms-unchanged clause", textEn.includes("All other terms and conditions of the original contract remain unchanged and in full effect."), "");
check("EN PDF: contractor signs on behalf of the company", textEn.includes("on behalf of Stallions Construction Company LLC") && textEn.includes("Dennys Hernandez"), "");
const pdfResEs = await A.getDocumentLinkPdf.handler(ctx, { token: linkCo1.token, lang: "es" });
const textEs = pdfText(Buffer.from(pdfResEs.pdfBase64, "base64"));
check("ES PDF: formal title", textEs.includes("Orden de cambio #1"), textEs.slice(0, 200));
check("ES PDF: terms clause", textEs.includes("permanecen sin cambios y en pleno vigor"), "");
check("ES PDF: schedule line", textEs.includes("Sin cambio al plazo del contrato"), "");
check("ES PDF: on-behalf line", textEs.includes("en nombre de Stallions Construction Company LLC"), "");

// --- 4. Portal list ------------------------------------------------------------------
const portalA = await A.createPortalLink.handler(ctx, { jobId: jobA, expiresInDays: 90 });
const dataA = await A.getPortalData.handler(ctx, { token: portalA.token });
const rowCo1 = dataA.jobDocuments.find((d: any) => d.id === co1);
check("portal Documents row shows the formal CO title", rowCo1?.displayTitle?.startsWith("Change Order #1"), rowCo1?.displayTitle);
check("portal Documents row shows the amount", rowCo1?.amount === "480.00" && rowCo1?.coNumber === 1, JSON.stringify(rowCo1));
check("portal Documents row is awaiting (no signed date)", rowCo1?.clientSignedAt === null);
check("portal CO row href is its /d/ page when a link exists", rowCo1?.href === `/d/${linkCo1.shortCode}`, rowCo1?.href);
const portalCo2 = dataA.changeOrders.find((o: any) => o.id === co2);
check("portal changeOrders carry number + chain", portalCo2?.coNumber === 2 && portalCo2?.contractSumBefore === "18180.00" && portalCo2?.newContractSum === "18320.00", JSON.stringify(portalCo2));
check("portal changeOrders href matches the document link", portalCo2?.href === `/d/${linkCo2.shortCode}`, portalCo2?.href);
const portalCo4 = dataA.changeOrders.find((o: any) => o.id === co4);
check("portal negative CO carries its chain", portalCo4?.contractSumBefore === "18180.00" && portalCo4?.newContractSum === "17980.00", JSON.stringify(portalCo4));

// --- 5. Signing through the document path ----------------------------------------------
const formalBlob = await buildChangeOrderPdf({
  coNumber: 2, dateIso: "2026-10-21", clientName: "Anthony Porreca", jobType: "Garage conversion",
  jobAddress: "2337 Eastwood Dr, Clearwater, FL 33765", referenceContract: "Garage conversion contract",
  scope: "Arcade outlet on its own circuit", bodyText: "", contractSumBefore: "18180.00", amount: "140.00",
  newContractSum: "18320.00", contractorSignerName: "Dennys Hernandez", contractorSignatureDataUrl: null,
  contractorSignedAtIso: now.toISOString(), clientSignerName: "Anthony Porreca",
  clientSignatureDataUrl: `data:image/png;base64,${pngBase64}`, clientSignedAtIso: now.toISOString(), logoDataUrl: null,
}, { companyName: "Stallions Construction Company LLC" } as never, "en");
const formalB64 = Buffer.from(new Uint8Array(await formalBlob.arrayBuffer())).toString("base64");
await A.submitDocumentSignature.handler(ctx, {
  token: linkCo2.token, signerName: "Anthony Porreca", signatureDataBase64: pngBase64,
  signedPdfDataBase64: formalB64, userAgent: "test", consented: true,
});
const signedPdf = await A.getDocumentLinkSignedPdf.handler(ctx, { token: linkCo2.token, lang: "en" });
const signedText = pdfText(Buffer.from(signedPdf.pdfBase64, "base64"));
check("signed copy is the formal document", signedText.includes("Change Order #2") && signedText.includes("$18,320.00"), signedText.slice(0, 160));
const afterSign = await A.getJob.handler(ctx, { id: jobA });
check("revised total counts the signed CO only", afterSign.contractSummary?.signedChangeOrdersTotal === "140.00" && afterSign.contractSummary?.revisedTotal === "18320.00", JSON.stringify(afterSign.contractSummary));
check("pending now excludes the signed CO", afterSign.contractSummary?.pendingChangeOrdersTotal === "280.00", afterSign.contractSummary?.pendingChangeOrdersTotal);
const payloadCo3 = await A.resolveDocumentLink.handler(ctx, { token: (await A.createDocumentLink.handler(ctx, { kind: "change_order", id: co3 })).shortCode, userAgent: "test" });
check("chain advances past the signed CO2 for CO3", payloadCo3.changeOrder?.contractSumBefore === "18320.00" && payloadCo3.changeOrder?.newContractSum === "18320.00", JSON.stringify(payloadCo3.changeOrder));
const payloadCo1 = await A.resolveDocumentLink.handler(ctx, { token: linkCo1.shortCode, userAgent: "test" });
check("CO1 (earlier, still unsigned) chain is unchanged", payloadCo1.changeOrder?.contractSumBefore === "18180.00" && payloadCo1.changeOrder?.newContractSum === "18660.00", JSON.stringify(payloadCo1.changeOrder));

// Portal signing: CO3 ($0) — server builds the canonical formal PDF.
await A.portalSignChangeOrder.handler(ctx, { token: portalA.token, documentId: co3, signerName: "Anthony Porreca", signatureDataBase64: pngBase64, lang: "en" });
const co3Row = (await db.select().from(schema.documents).where(eq(schema.documents.id, co3)))[0]!;
check("portal signing stores a canonical PDF", !!co3Row.clientSignedPdfBlobKey, "");
const portalPdf = await A.getPortalChangeOrderPdf.handler(ctx, { token: portalA.token, documentId: co3, lang: "en" });
const portalPdfText = pdfText(Buffer.from(portalPdf.pdfBase64, "base64"));
check("portal download is the formal signed document", portalPdfText.includes("Change Order #3") && portalPdfText.includes("Anthony Porreca") && portalPdfText.includes("$0.00"), portalPdfText.slice(0, 160));
check("portal download bytes are the stored canonical bytes", Buffer.from(portalPdf.pdfBase64, "base64").equals(blobStore.get(co3Row.clientSignedPdfBlobKey!)!), "");
const afterPortalSign = await A.getJob.handler(ctx, { id: jobA });
check("revised total after portal sign (140 + 0)", afterPortalSign.contractSummary?.revisedTotal === "18320.00" && afterPortalSign.contractSummary?.pendingChangeOrdersTotal === "280.00", JSON.stringify(afterPortalSign.contractSummary));
const ops1 = await A.getJobOperations.handler(ctx, { jobId: jobA });
check("profitability semantics unchanged after signing", ops1.profitability.changeOrdersTotal === 420 && ops1.profitability.budgetTotal === 420, JSON.stringify(ops1.profitability));

// --- 6. Owner copy ----------------------------------------------------------------------
const ownerUnsigned = await A.getDocumentPdf.handler(ctx, { documentId: co4 });
const ownerText = pdfText(Buffer.from(ownerUnsigned.pdfBase64, "base64"));
check("owner copy of an unsigned CO is the formal document", ownerText.includes("Change Order #4") && ownerText.includes("-$200.00"), ownerText.slice(0, 160));
check("owner CO4 chain reflects signed CO2+CO3 before it", ownerText.includes("$18,320.00") && ownerText.includes("$18,120.00"), "");
const ownerSigned = await A.getDocumentPdf.handler(ctx, { documentId: co2 });
check("owner copy of a signed CO is the signed canonical file", Buffer.from(ownerSigned.pdfBase64, "base64").equals(Buffer.from(formalB64, "base64")), "");

// --- 7. Isolation ----------------------------------------------------------------------------
const portalB = await A.createPortalLink.handler(ctx, { jobId: jobB, expiresInDays: 90 });
const dataB = await A.getPortalData.handler(ctx, { token: portalB.token });
check("job B portal lists no change orders", dataB.changeOrders.length === 0 && dataB.jobDocuments.length === 0);
let signThrew = false;
try { await A.portalSignChangeOrder.handler(ctx, { token: portalB.token, documentId: co4, signerName: "Mallory", signatureDataBase64: pngBase64 }); } catch { signThrew = true; }
check("job B token cannot sign job A's CO", signThrew);
let pdfThrew = false;
try { await A.getPortalChangeOrderPdf.handler(ctx, { token: portalB.token, documentId: co4, lang: "en" }); } catch { pdfThrew = true; }
check("job B token cannot download job A's CO", pdfThrew);
const co4RowAfter = (await db.select().from(schema.documents).where(eq(schema.documents.id, co4)))[0]!;
check("job A's CO4 stayed unsigned through the attacks", !co4RowAfter.clientSignedAt);

// Another company's job: numbering restarts, base falls back to amountDue.
const coC2 = await makeDoc(jobC2, "change_order", { title: "Change order", description: "Rival scope", amount: "250" });
const payloadC2 = await A.resolveDocumentLink.handler(ctx, { token: (await A.createDocumentLink.handler(ctx, { kind: "change_order", id: coC2 })).shortCode, userAgent: "test" });
check("other company's CO numbers from 1 on its own job", payloadC2.changeOrder?.number === 1, JSON.stringify(payloadC2.changeOrder?.number));
check("base falls back to the job's amountDue", payloadC2.changeOrder?.contractSumBefore === "5000.00" && payloadC2.changeOrder?.newContractSum === "5250.00", JSON.stringify(payloadC2.changeOrder));
const dataA2 = await A.getPortalData.handler(ctx, { token: portalA.token });
check("job A payload never contains the other company's CO", !JSON.stringify(dataA2).includes("Rival scope") && !dataA2.jobDocuments.some((d: any) => d.id === coC2));

// --- 8. Uploaded-PDF CO keeps canonical behavior ------------------------------------------------
const uploadedPdfB64 = formalB64; // any valid PDF bytes stand in for the upload
const co5 = await makeDoc(jobA, "change_order", { title: "Change order", description: "Uploaded CO scope", amount: "75", originalDataBase64: uploadedPdfB64 });
const linkCo5 = await A.createDocumentLink.handler(ctx, { kind: "change_order", id: co5 });
const payloadCo5 = await A.resolveDocumentLink.handler(ctx, { token: linkCo5.shortCode, userAgent: "test" });
check("uploaded CO still exposes its original PDF", payloadCo5.hasOriginalPdf === true);
check("uploaded CO still gets its number + formal title", payloadCo5.changeOrder?.number === 5 && payloadCo5.title.startsWith("Change Order #5"), payloadCo5.title);
const co5Row = (await db.select().from(schema.documents).where(eq(schema.documents.id, co5)))[0]!;
check("uploaded CO has the composited canonical stored", !!co5Row.clientSignedPdfBlobKey);
const numberingAfter = await A.getJob.handler(ctx, { id: jobA });
check("numbering of earlier COs is stable after adding CO5", [co1, co2, co3, co4].every((id, i) => numberingAfter.documents.find((d: any) => d.id === id)?.coNumber === i + 1));

// --- 9. Source wiring ------------------------------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");
const pdfSrc = await readFile("client/src/financialPdf.ts", "utf8");
check("PDF builder exports the formal CO renderer", pdfSrc.includes("export async function buildChangeOrderPdf") && pdfSrc.includes("changeOrderStrings"));
check("server renders + serves the formal CO PDF", serverSrc.includes("buildChangeOrderPdfForDocument") && serverSrc.includes("getPortalChangeOrderPdf"));
check("document page renders the formal CO paper", appSrc.includes("ChangeOrderPaper") && appSrc.includes("doc.changeOrder"));
check("link signing builds the formal CO PDF", appSrc.includes("buildClientSignedChangeOrderPdf"));
check("portal attention opens the document, no quick-sign details pad", !appSrc.includes('<details className="action-details portal-v2-co">') && appSrc.includes("setCoDocId(o.id)"));
check("portal documents rows use the formal title + amount", appSrc.includes("doc.displayTitle || doc.title") && appSrc.includes("usd(money(doc.amount))"));
check("job screen shows the revised contract total block", appSrc.includes("job-contract-summary") && appSrc.includes("contractSummary.revisedTotal"));
check("portal CO overlay downloads the canonical PDF", appSrc.includes("downloadCoPdf") && appSrc.includes("api.getPortalChangeOrderPdf"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
