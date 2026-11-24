// Document scanner standalone (2026-11-24): the scanner is its own Tools
// door again, every saved scan can be linked / re-linked / unlinked to a
// job, and multi-page captures save as one PDF.
//
// This suite covers the server half through the functional round-trip
// harness: setScannedDocumentJob's company scoping (mirrors
// linkQuoteToJob), the receipt-expense-follows-the-scan rule, and the
// action's permission classification (ALL_ROLE_ACTIONS — an unclassified
// action would fail closed to admin after audit C4). The client half is
// pinned by source checks: the standalone screen + tile exist, the form
// calls the relink action, and the PDF build adds a page per capture.
//
// Run from app/:  bun document-scanner.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";
import { minRoleForAction, roleCan } from "./server/src/permissions.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// --- Scratch DB + ctx -----------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-document-scanner-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  slug: "tradesign",
  invocationId: "document-scanner-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => { throw new Error("unexpected privileged call"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "premium",
} as any;
const A = BaseActions as any;

await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Scanner Co", updatedAt: new Date() });
await db.insert(schema.settings).values({ id: 2, companyId: 2, companyName: "Other Co", updatedAt: new Date() });

// --- Fixtures: two jobs -----------------------------------------------------------
const jobArgs = {
  clientId: null, clientPhone: "(813) 555-0100", clientEmail: "",
  jobAddress: "1 Scanner Way", jobType: "Remodel", notes: "", jobDate: "2026-11-24",
  appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "",
};
const jobA = await A.createJob.handler(ctx, { ...jobArgs, clientName: "Scanner Client A" });
const jobB = await A.createJob.handler(ctx, { ...jobArgs, clientName: "Scanner Client B" });
check("fixtures: two jobs created", jobA.id !== jobB.id);

const scanJobId = async (scanId: number) =>
  (await db.select().from(schema.scannedDocuments).where(eq(schema.scannedDocuments.id, scanId)).limit(1))[0]?.jobId;
const expenseJobId = async (expenseId: number) =>
  (await db.select().from(schema.businessExpenses).where(eq(schema.businessExpenses.id, expenseId)).limit(1))[0]?.jobId;

// --- A contract scan saved unlinked (General) --------------------------------------
const contractScan = await A.saveScannedDocument.handler(ctx, {
  jobId: null, expenseId: null, title: "Signed contract — Scanner Client A", kind: "contract",
  filename: "signed-contract.pdf", dataBase64: "JVBERi0xLjQK", expenseDate: "", vendor: "",
  amount: "", category: "materials", note: "",
});
check("contract scan saves with no expense", contractScan.id > 0 && contractScan.expenseId === null);
check("contract scan starts unlinked (General)", (await scanJobId(contractScan.id)) === null);

// --- setScannedDocumentJob: schema ---------------------------------------------------
check("setScannedDocumentJob schema accepts jobId: null (unlink)",
  A.setScannedDocumentJob.request.safeParse({ scanId: contractScan.id, jobId: null }).success === true);
check("setScannedDocumentJob schema accepts a job id",
  A.setScannedDocumentJob.request.safeParse({ scanId: contractScan.id, jobId: jobA.id }).success === true);
check("setScannedDocumentJob schema refuses a missing scanId",
  A.setScannedDocumentJob.request.safeParse({ jobId: null }).success === false);

// --- Link, re-link, unlink ------------------------------------------------------------
await A.setScannedDocumentJob.handler(ctx, { scanId: contractScan.id, jobId: jobA.id });
check("link: scan moves to job A", (await scanJobId(contractScan.id)) === jobA.id);
await A.setScannedDocumentJob.handler(ctx, { scanId: contractScan.id, jobId: jobB.id });
check("re-link: scan moves to job B", (await scanJobId(contractScan.id)) === jobB.id);
await A.setScannedDocumentJob.handler(ctx, { scanId: contractScan.id, jobId: null });
check("unlink: scan returns to General", (await scanJobId(contractScan.id)) === null);

// --- A receipt scan's linked expense follows the scan ----------------------------------
const receiptScan = await A.saveScannedDocument.handler(ctx, {
  jobId: jobA.id, expenseId: null, title: "Home Depot receipt", kind: "receipt",
  filename: "home-depot-receipt.pdf", dataBase64: "JVBERi0xLjQK", expenseDate: "2026-11-24",
  vendor: "Home Depot", amount: "57.18", category: "materials", note: "",
});
check("receipt scan creates its linked expense", typeof receiptScan.expenseId === "number");
check("the expense starts on job A with the scan", (await expenseJobId(receiptScan.expenseId)) === jobA.id);
await A.setScannedDocumentJob.handler(ctx, { scanId: receiptScan.id, jobId: jobB.id });
check("re-link moves the scan to job B", (await scanJobId(receiptScan.id)) === jobB.id);
check("re-link moves the linked expense to job B too", (await expenseJobId(receiptScan.expenseId)) === jobB.id);
await A.setScannedDocumentJob.handler(ctx, { scanId: receiptScan.id, jobId: null });
check("unlink returns the expense to General with the scan", (await expenseJobId(receiptScan.expenseId)) === null);

// --- Not-found guards --------------------------------------------------------------------
let scanError = "";
try { await A.setScannedDocumentJob.handler(ctx, { scanId: 999999, jobId: jobA.id }); }
catch (error) { scanError = error instanceof Error ? error.message : String(error); }
check("a missing scan is refused", scanError.includes("not found"), scanError);

let jobError = "";
try { await A.setScannedDocumentJob.handler(ctx, { scanId: contractScan.id, jobId: 999999 }); }
catch (error) { jobError = error instanceof Error ? error.message : String(error); }
check("a missing job is refused", jobError.includes("not found"), jobError);
check("the scan's link survives the refused attempts", (await scanJobId(contractScan.id)) === null);

// --- Company scoping ----------------------------------------------------------------------
const ctx2 = { ...ctx, workspaceCompanyId: 2, workspaceUserId: 2 } as any;
let crossError = "";
try { await A.setScannedDocumentJob.handler(ctx2, { scanId: contractScan.id, jobId: null }); }
catch (error) { crossError = error instanceof Error ? error.message : String(error); }
check("another company cannot touch this company's scan", crossError.includes("not found"), crossError);

// A scan owned by company 2 (inserted directly — saveScannedDocument's
// own company stamping rides the server db layer, not this harness).
const foreignScan = (await db.insert(schema.scannedDocuments).values({
  companyId: 2, jobId: null, expenseId: null, title: "Other Co scan", kind: "other",
  blobKey: "scans/general/foreign.pdf", filename: "foreign.pdf", createdAt: new Date(),
}).returning({ id: schema.scannedDocuments.id }))[0]!;
let foreignJobError = "";
try { await A.setScannedDocumentJob.handler(ctx2, { scanId: foreignScan.id, jobId: jobA.id }); }
catch (error) { foreignJobError = error instanceof Error ? error.message : String(error); }
check("a scan cannot be linked to another company's job", foreignJobError.includes("not found"), foreignJobError);
check("the foreign scan stays unlinked", (await scanJobId(foreignScan.id)) === null);

// --- Classification: all company roles, like saveScannedDocument ---------------------------
check("setScannedDocumentJob resolves to the all-roles tier", minRoleForAction("setScannedDocumentJob") === "field");
check("field role can relink a scan", roleCan("field", "setScannedDocumentJob") === true);
check("office role can relink a scan", roleCan("office", "setScannedDocumentJob") === true);

// --- Source pins: registry, standalone door, multi-page build --------------------------------
const actionsSrc = await readFile("server/src/actions.ts", "utf8");
const appSrc = await readFile("client/src/App.tsx", "utf8");
check("the pin registry has the documentScanner door again",
  actionsSrc.includes('"documentScanner": { screen: "documentScanner"'));
check("the Screen union carries the standalone scanner screen",
  appSrc.includes('| { name: "documentScanner" }'));
check("the standalone screen renders the shared ScannerTool in standalone variant",
  appSrc.includes("function DocumentScannerScreen") && appSrc.includes('variant="standalone"'));
check("the Tools catalog has the Document scanner tile in both languages",
  appSrc.includes('title: "Document scanner"') && appSrc.includes('title: "Escáner de documentos"'));
check("the tile opens the standalone screen",
  appSrc.includes('screen: { name: "documentScanner" }'));
check("the scans list relinks through the new action",
  appSrc.includes("api.setScannedDocumentJob"));
check("multi-page: captures accumulate as draft pages",
  appSrc.includes("pagesDataUrls") && appSrc.includes("onAddPage") && appSrc.includes("removePage"));
check("multi-page: the PDF build adds one page per capture",
  appSrc.includes('pdf.addPage("letter"'));
check("the receipt OCR flow is untouched",
  appSrc.includes("runScan") && appSrc.includes("scanReceiptText") && appSrc.includes("api.saveScannedDocument"));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
