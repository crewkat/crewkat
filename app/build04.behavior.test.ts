// Build 0.4 QA batch behavior tests (Danny 2026-10-01).
//
// Item 1 — contacts picker: direct navigator.contacts.select attempt; on
//   missing/failed API a brief "not available" toast, no fallback sheet.
//   (Covered in depth by contacts-fallback.behavior.test.ts.)
// Item 2 — client document link preview: GET /doc/:token/pdf serves a
//   server-rendered application/pdf (Content-Disposition: inline); the client
//   link embeds it with a visible "Open PDF" button. Includes a REAL
//   DB-backed integration test: create settings + invoice + link, call
//   getDocumentLinkPdf, assert the bytes are a genuine %PDF- stream.
// Item 3 — Send opens a bottom sheet: Send by Email / Send Link / Send PDF.
// Item 4 — master bottom tab bar hidden inside invoice/estimate views.
// Item 5 — recurring MANUAL/AUTOMATIC labels get 16px left padding.
//
// Run from app/:  bun build04.behavior.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
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
async function throwsAsync(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (error) {
    check(name, !match || match.test(error instanceof Error ? error.message : String(error)), error instanceof Error ? error.message : String(error));
  }
}

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");
const ACTIONS = readFileSync(join(import.meta.dir, "server/src/actions.ts"), "utf8");
const DOCPDF = readFileSync(join(import.meta.dir, "server/src/docPdf.ts"), "utf8");
const SERVERMJS = readFileSync(join(import.meta.dir, "..", "server.mjs"), "utf8");

// --- Item 2: server PDF endpoint (static) --------------------------------------
check("server.mjs routes GET|HEAD /doc/:token/pdf", SERVERMJS.includes('^\\/doc\\/') && SERVERMJS.includes('/pdf$/'));
check("server.mjs serves application/pdf for the doc endpoint", SERVERMJS.includes('"content-type": "application/pdf"') || SERVERMJS.includes("'content-type': 'application/pdf'"));
check("server.mjs sets Content-Disposition: inline", SERVERMJS.includes("inline; filename="));
check("server.mjs dispatches getDocumentLinkPdf", SERVERMJS.includes('dispatchAction("getDocumentLinkPdf"'));
check("getDocumentLinkPdf action exists", typeof (BaseActions as any).getDocumentLinkPdf?.handler === "function");
check("getDocumentLinkPayload shared by resolve + pdf (no duplicate logic)", ACTIONS.includes("async function getDocumentLinkPayload"));
check("resolveDocumentLink still counts views + notifies", ACTIONS.includes("viewCount: link.viewCount + 1") && ACTIONS.includes("notifyInvoiceViewed"));
check("docPdf.ts shims FileReader for bun", DOCPDF.includes("FileReaderShim"));
check("ClientDocumentScreen renders server PDF via PdfPageView (PDF.js)", APP.includes("<PdfPageView url={serverPdfUrl}") && APP.includes("function PdfPageView"));

// --- Item 2: server PDF endpoint (real DB integration) -------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-build04-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  db: () => db,
  unscopedDb: () => db,
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  invalidateQueries: () => {},
  blobs: {
    get: async (_key: string) => null,
    head: async (_key: string) => null,
    getUrl: async (key: string) => `/blobs/${key}`,
  },
} as any;
const actions = BaseActions as any;

await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Test Co", phone: "555-1234", email: "test@example.com", paymentInstructions: "Pay online." });
const invRows = await db.insert(schema.invoices).values({
  companyId: 1, invoiceNumber: "INV-9001", clientName: "Test Client",
  lineItemsJson: JSON.stringify([{ description: "Labor", amount: "100", quantity: 1 }]),
  subtotal: "100", total: "100", status: "sent", issueDate: "2026-09-01", dueDate: "2026-10-01",
}).returning({ id: schema.invoices.id });
const invoiceId = invRows[0].id;
const quoteRows = await db.insert(schema.quotes).values({
  companyId: 1, clientName: "Test Client",
  lineItemsJson: JSON.stringify([{ description: "Materials", amount: "200", quantity: 2 }]),
  subtotal: "200", total: "200", expiryDate: "2026-12-31",
}).returning({ id: schema.quotes.id });
const quoteId = quoteRows[0].id;

const isPdf = (b64: string) => Buffer.from(b64, "base64").subarray(0, 5).toString() === "%PDF-";

const invLink = await actions.createDocumentLink.handler(ctx, { kind: "invoice", id: invoiceId });
const invPdf = await actions.getDocumentLinkPdf.handler(ctx, { token: invLink.token, lang: "en" });
check("invoice link PDF is a genuine %PDF- stream", isPdf(invPdf.pdfBase64), invPdf.pdfBase64.slice(0, 12));
check("invoice link PDF filename ends with .pdf", invPdf.filename.endsWith(".pdf") && invPdf.kind === "invoice", invPdf.filename);

const quoteLink = await actions.createDocumentLink.handler(ctx, { kind: "quote", id: quoteId });
const quotePdf = await actions.getDocumentLinkPdf.handler(ctx, { token: quoteLink.token, lang: "es" });
check("estimate link PDF (es) is a genuine %PDF- stream", isPdf(quotePdf.pdfBase64), quotePdf.pdfBase64.slice(0, 12));

await throwsAsync("bogus token is rejected", () => actions.getDocumentLinkPdf.handler(ctx, { token: "0".repeat(64), lang: "en" }), /no longer active/);

// Contract links are NOT rendered as PDF — they keep the HTML sign flow.
const jobRows = await db.insert(schema.jobs).values({ companyId: 1, clientName: "Test Client", jobAddress: "1 Main St", jobType: "Remodel", jobDate: "2026-09-01" }).returning({ id: schema.jobs.id });
const docRows = await db.insert(schema.documents).values({ jobId: jobRows[0].id, kind: "contract", title: "Contract", signerName: "Danny", signatureBlobKey: "sig.png", signedAt: new Date() }).returning({ id: schema.documents.id });
const contractLink = await actions.createDocumentLink.handler(ctx, { kind: "contract", id: docRows[0].id });
await throwsAsync("contract link PDF is rejected (HTML sign flow stays)", () => actions.getDocumentLinkPdf.handler(ctx, { token: contractLink.token, lang: "en" }), /web page/);

// getDocumentLinkPdf must NOT count views (resolveDocumentLink owns that).
const viewsBefore = (await db.select().from(schema.documentLinks)) as Array<{ viewCount: number }>;
await actions.getDocumentLinkPdf.handler(ctx, { token: invLink.token, lang: "en" });
const viewsAfter = (await db.select().from(schema.documentLinks)) as Array<{ viewCount: number }>;
check("PDF endpoint has no view-count side effect", viewsAfter.every((l, i) => l.viewCount === viewsBefore[i].viewCount));

// --- Item 3: Send bottom sheet (static) -----------------------------------------
check("SendSheet component exists with the three options", APP.includes("function SendSheet({") && APP.includes("Send by Email") && APP.includes("Send Link") && APP.includes("Send PDF"));
check("SendSheet ES labels present", APP.includes("Enviar por Email") && APP.includes("Enviar enlace") && APP.includes("Enviar PDF"));
check("SendSheet uses envelope / link / document icons", APP.includes("<MailIcon />") && APP.includes("<LinkIcon />") && APP.includes("const MailIcon =") && APP.includes("const LinkIcon ="));
check("Send by Email composes a mailto with the client link", APP.includes("mailto:${encodeURIComponent(clientEmail)}") && APP.includes("freshLinkUrl()"));
check("Send Link creates a client link and copies it", APP.includes("copyText(link)") && APP.includes("createDocumentLink({ kind, id })"));
check("Send PDF uses the build0.3 nativeShare chain", APP.includes("nativeShare(blob, filename, title)"));
check("each send option marks the document sent first", APP.includes("await markSent();"));
check("invoice Send opens the sheet (no direct share)", APP.includes("const sendInvoice=()=>{buzz(8);setSendSheetOpen(true);};"));
check("estimate Send opens the sheet", APP.includes("setSendSheetOpen(true);}}><ShareIcon/>{lang===\"es\"?`Enviar ${estTerms.singular}`"));
check("both previews render the SendSheet", (APP.match(/<SendSheet /g) ?? []).length === 2);

// --- Item 4: hide master bottom nav in invoice/estimate view (static) ------------
check("hideMasterNav covers invoicePreview + quotePreview", APP.includes('screen.name === "invoicePreview"') && APP.includes('screen.name === "quotePreview"') && APP.includes("const hideMasterNav ="));
check("BottomNav is skipped when the master nav is hidden", APP.includes('{screen.name !== "legal" && !hideMasterNav && <BottomNav'));
check("app-shell gets the master-nav-hidden modifier", APP.includes('master-nav-hidden'));
check("CSS drops the action bar to the true bottom", CSS.includes(".app-shell.master-nav-hidden .document-action-bar { inset: auto 0 env(safe-area-inset-bottom); }"));
check("CSS reduces page bottom padding when nav is hidden", CSS.includes(".app-shell.has-bottom-nav.master-nav-hidden .page"));

// --- Item 5: recurring label padding (static) ------------------------------------
check("recurring subsections get 16px horizontal padding", CSS.includes(".recurring-subsection { padding: 12px 16px; }"));

// --- Item 1: contacts picker (static cross-check; depth in contacts test) --------
check("contacts fallback sheet is gone", !APP.includes("contactsFallbackOpen") && !APP.includes("package=com.android.chrome"));
check("contacts unavailable toast copy (en + es)", APP.includes('contactsUnavailable: "Contacts aren\'t available here"') && APP.includes('contactsUnavailable: "Los contactos no están disponibles aquí"'));

await rm(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
} else {
  console.log("\nAll build0.4 checks passed.");
}
