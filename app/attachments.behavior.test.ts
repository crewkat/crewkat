// Build 0.6: document attachments (images + PDFs) behavior tests.
//
// Covers:
//  1. Migration 0062 applies: document_attachments table + images_per_page on
//     quotes/invoices.
//  2. upload/list/delete round-trip on a quote, company-scoped.
//  3. Cross-company isolation: another company's docId is rejected.
//  4. setDocumentImagesPerPage accepts 1/2/4 and rejects other values.
//  5. Deleting a quote cascades its attachment rows.
//  6. Static guards: client compresses attachment images; PDF append helper
//     exists and is wired into the server PDF builder.
//
// Run from app/:  bun attachments.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq, and } from "drizzle-orm";
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

const clientSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");
const docPdfSrc = await readFile("server/src/docPdf.ts", "utf8");

// --- 1. Scratch DB + migrate -------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-attach-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const tables = await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='document_attachments'");
check("migration creates document_attachments", tables.rows.length === 1);
for (const t of ["quotes", "invoices"] as const) {
  const cols = await sqlite.execute(`PRAGMA table_info(${t})`);
  check(`${t}.images_per_page exists`, cols.rows.some((r) => (r as { name: string }).name === "images_per_page"));
}

const blobStore = new Map<string, Buffer>();
const ctx = {
  slug: "tradesign",
  invocationId: "attach-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async (key: string, data: Buffer) => { blobStore.set(key, data); },
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async (key: string) => blobStore.get(key) ?? null,
    delete: async (key: string) => { blobStore.delete(key); },
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => { throw new Error("not stubbed"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;

const now = new Date();
await db.insert(schema.authUsers).values({
  companyId: 1, name: "Owner", email: "owner@example.com",
  passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH",
});
await db.insert(schema.settings).values({ companyId: 1, companyName: "Test Co" });
const quoteId = (await db.insert(schema.quotes).values({
  companyId: 1, clientName: "Client", lineItemsJson: "[]", total: "100",
  createdAt: now, updatedAt: now,
}).returning({ id: schema.quotes.id }))[0]!.id;
// Another company's quote — must be invisible to company 1.
const otherQuoteId = (await db.insert(schema.quotes).values({
  companyId: 2, clientName: "Other", lineItemsJson: "[]", total: "50",
  createdAt: now, updatedAt: now,
}).returning({ id: schema.quotes.id }))[0]!.id;

// --- 2. upload/list/delete round-trip ----------------------------------------
const pngBase64 = Buffer.from("fake-png-bytes-1234567890").toString("base64");
const uploaded = await (BaseActions.uploadDocumentAttachment as any).handler(ctx, {
  docType: "quote", docId: quoteId, kind: "image",
  fileName: "site.jpg", contentType: "image/jpeg", dataBase64: pngBase64,
});
check("upload returns the attachment record", uploaded?.id > 0 && uploaded?.docId === quoteId && uploaded?.kind === "image");
check("upload stores the blob", blobStore.size === 1);

const listed = await (BaseActions.listDocumentAttachments as any).handler(ctx, { docType: "quote", docId: quoteId });
check("list returns the attachment", listed?.attachments?.length === 1);
check("list defaults imagesPerPage to 1", listed?.imagesPerPage === 1);

await (BaseActions.setDocumentImagesPerPage as any).handler(ctx, { docType: "quote", docId: quoteId, perPage: 4 });
const listed2 = await (BaseActions.listDocumentAttachments as any).handler(ctx, { docType: "quote", docId: quoteId });
check("setDocumentImagesPerPage persists", listed2?.imagesPerPage === 4);

let badPerPage = false;
try {
  await (BaseActions.setDocumentImagesPerPage as any).handler(ctx, { docType: "quote", docId: quoteId, perPage: 3 });
} catch { badPerPage = true; }
check("setDocumentImagesPerPage rejects 3", badPerPage);

await (BaseActions.deleteDocumentAttachment as any).handler(ctx, { id: uploaded.id });
const listed3 = await (BaseActions.listDocumentAttachments as any).handler(ctx, { docType: "quote", docId: quoteId });
check("delete removes the attachment", listed3?.attachments?.length === 0);
check("delete removes the blob", blobStore.size === 0);

// --- 3. cross-company isolation ----------------------------------------------
let crossRejected = false;
try {
  await (BaseActions.uploadDocumentAttachment as any).handler(ctx, {
    docType: "quote", docId: otherQuoteId, kind: "pdf",
    fileName: "x.pdf", contentType: "application/pdf", dataBase64: pngBase64,
  });
} catch { crossRejected = true; }
check("upload to another company's quote is rejected", crossRejected);

let crossListRejected = false;
try {
  await (BaseActions.listDocumentAttachments as any).handler(ctx, { docType: "quote", docId: otherQuoteId });
} catch { crossListRejected = true; }
check("list on another company's quote is rejected", crossListRejected);

// --- 4. kind/content-type validation ------------------------------------------
let badKind = false;
try {
  await (BaseActions.uploadDocumentAttachment as any).handler(ctx, {
    docType: "quote", docId: quoteId, kind: "image",
    fileName: "x.pdf", contentType: "application/pdf", dataBase64: pngBase64,
  });
} catch { badKind = true; }
check("image kind with pdf content-type is rejected", badKind);

// --- 5. quote delete cascades attachments -------------------------------------
const up2 = await (BaseActions.uploadDocumentAttachment as any).handler(ctx, {
  docType: "quote", docId: quoteId, kind: "pdf",
  fileName: "plan.pdf", contentType: "application/pdf", dataBase64: pngBase64,
});
await (BaseActions.deleteQuote as any).handler(ctx, { id: quoteId });
const remaining = await db.select().from(schema.documentAttachments).where(and(eq(schema.documentAttachments.docType, "quote"), eq(schema.documentAttachments.docId, quoteId)));
check("deleteQuote removes attachment rows", remaining.length === 0);
check("deleteQuote removes attachment blobs", blobStore.size === 0);
void up2;

// --- 6. static guards ----------------------------------------------------------
check("client compresses attachment images pre-upload", clientSrc.includes('compressImageFile(file, "attachment")'));
check("server PDF builder appends attachments", docPdfSrc.includes("appendAttachmentsToPdf"));
check("client preview appends attachments", clientSrc.includes("appendAttachmentsToBlob"));
check("attachments row is on quote + invoice previews", clientSrc.includes("DocumentAttachmentsRow"));

// --- 7. deposit request + conversion carryover ---------------------------------
const quoteCols = (await sqlite.execute("PRAGMA table_info(quotes)")).rows.map((r: any) => r[1] as string);
check("0064 adds deposit_type to quotes", quoteCols.includes("deposit_type"));
check("0064 adds deposit_value to quotes", quoteCols.includes("deposit_value"));
const invCols = (await sqlite.execute("PRAGMA table_info(invoices)")).rows.map((r: any) => r[1] as string);
check("0064 adds deposit_type to invoices", invCols.includes("deposit_type"));
check("0064 adds deposit_value to invoices", invCols.includes("deposit_value"));

// saveQuote with deposit
const depQuote = await (BaseActions.saveQuote as any).handler(ctx, {
  clientId: null, jobId: null, clientName: "Deposit Test", clientPhone: "", clientEmail: "",
  jobAddress: "", shippingAddress: "", jobType: "Remodel",
  lineItems: [{ name: "Work", description: "Bath remodel", amount: "6500" }],
  subtotal: "6500", discountType: "percent", discountValue: "0",
  taxType: "percent", taxValue: "0", total: "6500", footnote: "",
  expiryDate: "", sentAt: "", theme: "classic", font: "helvetica",
  accentColor: "#1f5a4a", customizeJson: "{}",
  showTaxLine: true, showDiscountLine: true, showPaidLine: true,
  showPaymentTerms: true, showFooterNotes: true, showLogo: true, showCompanyInfo: true,
  depositType: "percent", depositValue: "50",
});
check("saveQuote stores deposit fields", depQuote.id > 0);
const depRow = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, depQuote.id)).limit(1))[0];
check("depositType persisted on quote", depRow?.depositType === "percent", String(depRow?.depositType));
check("depositValue persisted on quote", depRow?.depositValue === "50.00", String(depRow?.depositValue));

// invalid deposit rejected
let badDep = false;
try {
  await (BaseActions.saveQuote as any).handler(ctx, {
    clientId: null, jobId: null, clientName: "Bad Dep", clientPhone: "", clientEmail: "",
    jobAddress: "", shippingAddress: "", jobType: "",
    lineItems: [{ name: "W", description: "d", amount: "100" }],
    subtotal: "100", discountType: "percent", discountValue: "0",
    taxType: "percent", taxValue: "0", total: "100", footnote: "",
    expiryDate: "", sentAt: "", theme: "classic", font: "helvetica",
    accentColor: "#1f5a4a", customizeJson: "{}",
    showTaxLine: true, showDiscountLine: true, showPaidLine: true,
    showPaymentTerms: true, showFooterNotes: true, showLogo: true, showCompanyInfo: true,
    depositType: "percent", depositValue: "150",
  });
} catch { badDep = true; }
check("deposit percent > 100 is rejected", badDep);

// conversion carries attachments + deposit
await (BaseActions.uploadDocumentAttachment as any).handler(ctx, {
  docType: "quote", docId: depQuote.id, kind: "image",
  fileName: "photo.jpg", contentType: "image/jpeg", dataBase64: pngBase64,
});
const conv = await (BaseActions.convertQuoteToInvoice as any).handler(ctx, { quoteId: depQuote.id, today: "2026-10-05" });
check("conversion creates invoice", conv.invoiceId > 0);
const invRow = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, conv.invoiceId)).limit(1))[0];
check("conversion copies depositType", invRow?.depositType === "percent", String(invRow?.depositType));
check("conversion copies depositValue", invRow?.depositValue === "50.00", String(invRow?.depositValue));
check("conversion copies imagesPerPage", invRow?.imagesPerPage === 1);
const invAtts = await db.select().from(schema.documentAttachments).where(and(eq(schema.documentAttachments.docType, "invoice"), eq(schema.documentAttachments.docId, conv.invoiceId)));
check("conversion copies attachments", invAtts.length === 1, String(invAtts.length));

// static guards for new UI
check("in-app lightbox exists", clientSrc.includes("lightbox-backdrop") && clientSrc.includes("setLightboxIndex"));
check("shared gallery exists", clientSrc.includes("client-doc-gallery") && clientSrc.includes("attachedImages"));
check("deposit PDF line exists", (await readFile("client/src/financialPdf.ts", "utf8")).includes("Deposit due"));

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nAll attachment behavior tests passed.");
