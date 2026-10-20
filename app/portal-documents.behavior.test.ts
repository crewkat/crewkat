// Portal documents + linked rows (Danny 2026-10-20): the client portal
// gains a Documents section listing the job's contracts and change
// orders with their signature status, and portal invoice / estimate
// rows link to the document's EXISTING /d/ page when it has an active
// document link (revoked/expired links do not count). Rows without an
// active link render unlinked, exactly as before. No new links are
// minted by the portal — hrefs come only from document_links rows the
// owner already created.
//
// Covers:
//  1. Signed contract appears with clientSignedAt + /d/ href; unsigned
//     contract appears with null date + null href; a contract whose
//     only link is expired is listed but unlinked.
//  2. Change order with an active link appears as Awaiting + href.
//  3. Invoice with a link -> href; invoice without -> null; invoice
//     whose link was revoked -> null. Quote with/without link likewise.
//  4. The /d/ hrefs resolve through resolveDocumentLink (real targets).
//  5. A job with no documents/invoices/quotes returns empty arrays
//     (the client renders no Documents section).
//  6. Cross-job isolation: job B's portal lists only job B's documents
//     and never carries job A's short codes anywhere in the payload.
//  7. Client + server source wiring for the section and the row links.
//
// Run from app/:  bun portal-documents.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";

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

// --- Harness -------------------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-portal-docs-"));
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
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => { throw new Error("unexpected privileged call"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
} as any;
const A = BaseActions as any;
const now = new Date();
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Stallions Construction Company LLC", updatedAt: now });
const mkJob = async (clientName: string, jobAddress: string) =>
  (await db.insert(schema.jobs).values({ companyId: 1, clientName, clientEmail: "", jobAddress, jobType: "Garage conversion", jobDate: "2026-10-20", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const jobA = await mkJob("Anthony Porreca", "2337 Eastwood Dr");
const jobB = await mkJob("Other Client", "9 Elsewhere St");
const jobC = await mkJob("Empty Client", "1 Blank Ave");

const pngBase64 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64").toString("base64");
async function makeDoc(jobId: number, kind: "contract" | "change_order", title: string): Promise<number> {
  const saved = await A.saveDocument.handler(ctx, {
    jobId, kind, title, bodyText: "", originalFilename: "", originalDataBase64: "",
    description: "", amount: kind === "change_order" ? "250.00" : "", signerName: "Dennys Hernandez",
    signatureDataBase64: pngBase64, signedAt: now.toISOString(),
  });
  return saved.id as number;
}
const docFields = {
  clientPhone: "", clientEmail: "", shippingAddress: "", jobType: "Garage conversion",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a",
};
const line = [{ name: "Paneling", description: "Walnut-look wall paneling", amount: "1000.00", quantity: 1 }];
async function makeQuote(jobId: number): Promise<number> {
  const q = await A.saveQuote.handler(ctx, {
    ...docFields, jobId, clientId: null, clientName: "Anthony Porreca", jobAddress: "2337 Eastwood Dr",
    lineItems: line, subtotal: "1000.00", total: "1000.00",
    expiryDate: "", sentAt: "", depositType: "none", depositValue: "0", materials: [],
  });
  return q.id as number;
}
async function makeInvoice(jobId: number): Promise<number> {
  const inv = await A.saveInvoice.handler(ctx, {
    ...docFields, jobId, clientId: null, clientName: "Anthony Porreca", jobAddress: "2337 Eastwood Dr",
    invoiceNumber: "", quoteId: null, lineItems: line, subtotal: "1000.00", total: "1000.00",
    issueDate: "2026-10-20", dueDate: "2026-11-19", status: "sent",
    recurringFrequency: "none", nextDueDate: "", recurringEndDate: "",
  });
  return inv.id as number;
}

// --- Seed job A -------------------------------------------------------------------
const signedAt = new Date("2026-10-19T15:00:00.000Z");
const contractSigned = await makeDoc(jobA, "contract", "Garage conversion contract");
await db.update(schema.documents).set({ clientSignedAt: signedAt, clientSignerName: "Anthony Porreca" }).where(eq(schema.documents.id, contractSigned));
const contractSignedLink = await A.createDocumentLink.handler(ctx, { kind: "contract", id: contractSigned });

const contractPlain = await makeDoc(jobA, "contract", "Unsigned contract");
const contractExpired = await makeDoc(jobA, "contract", "Expired link contract");
const contractExpiredLink = await A.createDocumentLink.handler(ctx, { kind: "contract", id: contractExpired });
await db.update(schema.documentLinks).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.documentLinks.shortCode, contractExpiredLink.shortCode));

const coLinked = await makeDoc(jobA, "change_order", "Change Order #1 — arcade outlet");
const coLink = await A.createDocumentLink.handler(ctx, { kind: "change_order", id: coLinked });

const quoteLinked = await makeQuote(jobA);
const quoteLink = await A.createDocumentLink.handler(ctx, { kind: "quote", id: quoteLinked });
const quotePlain = await makeQuote(jobA);

const invLinked = await makeInvoice(jobA);
const invLink = await A.createDocumentLink.handler(ctx, { kind: "invoice", id: invLinked });
const invPlain = await makeInvoice(jobA);
const invRevoked = await makeInvoice(jobA);
const invRevokedLink = await A.createDocumentLink.handler(ctx, { kind: "invoice", id: invRevoked });
await db.update(schema.documentLinks).set({ revokedAt: new Date() }).where(eq(schema.documentLinks.shortCode, invRevokedLink.shortCode));

// --- Seed job B (isolation) ----------------------------------------------------------
const contractB = await makeDoc(jobB, "contract", "Other job contract");
const contractBLink = await A.createDocumentLink.handler(ctx, { kind: "contract", id: contractB });
const invB = await makeInvoice(jobB);
const invBLink = await A.createDocumentLink.handler(ctx, { kind: "invoice", id: invB });

// --- 1-3. Job A portal payload ---------------------------------------------------------
const portalA = await A.createPortalLink.handler(ctx, { jobId: jobA, expiresInDays: 90 });
const dataA = await A.getPortalData.handler(ctx, { token: portalA.token });

check("job A documents list all four signable documents", Array.isArray(dataA.jobDocuments) && dataA.jobDocuments.length === 4, JSON.stringify(dataA.jobDocuments?.length));
const rowSigned = dataA.jobDocuments.find((d: any) => d.id === contractSigned);
check("signed contract row carries its kind + title", rowSigned?.kind === "contract" && rowSigned?.title === "Garage conversion contract");
check("signed contract row carries the signed date", rowSigned?.clientSignedAt === signedAt.toISOString(), rowSigned?.clientSignedAt);
check("signed contract row href is its existing /d/ page", rowSigned?.href === `/d/${contractSignedLink.shortCode}`, rowSigned?.href);
const rowPlain = dataA.jobDocuments.find((d: any) => d.id === contractPlain);
check("unsigned contract row is awaiting (no date)", rowPlain?.clientSignedAt === null, JSON.stringify(rowPlain));
check("unsigned contract without a link has no href", rowPlain?.href === null, rowPlain?.href);
const rowExpired = dataA.jobDocuments.find((d: any) => d.id === contractExpired);
check("expired-link contract is still listed", !!rowExpired);
check("expired link does NOT produce an href", rowExpired?.href === null, rowExpired?.href);
const rowCo = dataA.jobDocuments.find((d: any) => d.id === coLinked);
check("change order row carries the change_order kind", rowCo?.kind === "change_order", rowCo?.kind);
check("change order row is awaiting with a working href", rowCo?.clientSignedAt === null && rowCo?.href === `/d/${coLink.shortCode}`, JSON.stringify(rowCo));

const invRowLinked = dataA.invoices.find((i: any) => i.id === invLinked);
const invRowPlain = dataA.invoices.find((i: any) => i.id === invPlain);
const invRowRevoked = dataA.invoices.find((i: any) => i.id === invRevoked);
check("invoice with a link carries its /d/ href", invRowLinked?.href === `/d/${invLink.shortCode}`, invRowLinked?.href);
check("invoice without a link renders unlinked (href null)", invRowPlain?.href === null, JSON.stringify(invRowPlain?.href));
check("invoice whose link was revoked renders unlinked", invRowRevoked?.href === null, invRowRevoked?.href);
const estRowLinked = dataA.estimates.find((e: any) => e.id === quoteLinked);
const estRowPlain = dataA.estimates.find((e: any) => e.id === quotePlain);
check("estimate with a link carries its /d/ href", estRowLinked?.href === `/d/${quoteLink.shortCode}`, estRowLinked?.href);
check("estimate without a link carries no href", estRowPlain?.href === null, JSON.stringify(estRowPlain?.href));
check("estimates/invoices themselves are unchanged in count", dataA.invoices.length === 3 && dataA.estimates.length === 2);

// --- 4. Hrefs resolve through the real document machinery --------------------------------
const resolved = await A.resolveDocumentLink.handler(ctx, { token: contractSignedLink.shortCode, userAgent: "test" });
check("the portal href target resolves as the signed contract", resolved.kind === "contract" && resolved.title === "Garage conversion contract");
const resolvedInv = await A.resolveDocumentLink.handler(ctx, { token: invLink.shortCode, userAgent: "test" });
check("the invoice href target resolves as the invoice", resolvedInv.kind === "invoice");

// --- 5. Empty job ---------------------------------------------------------------------------
const portalC = await A.createPortalLink.handler(ctx, { jobId: jobC, expiresInDays: 90 });
const dataC = await A.getPortalData.handler(ctx, { token: portalC.token });
check("job with no documents returns an empty documents list", Array.isArray(dataC.jobDocuments) && dataC.jobDocuments.length === 0);
check("job with no invoices/quotes returns empty lists", dataC.invoices.length === 0 && dataC.estimates.length === 0);

// --- 6. Cross-job isolation -------------------------------------------------------------------
const portalB = await A.createPortalLink.handler(ctx, { jobId: jobB, expiresInDays: 90 });
const dataB = await A.getPortalData.handler(ctx, { token: portalB.token });
check("job B documents list only its own contract", dataB.jobDocuments.length === 1 && dataB.jobDocuments[0].id === contractB, JSON.stringify(dataB.jobDocuments?.length));
check("job B contract href is job B's own link", dataB.jobDocuments[0]?.href === `/d/${contractBLink.shortCode}`);
check("job B invoice href is job B's own link", dataB.invoices.length === 1 && dataB.invoices[0]?.href === `/d/${invBLink.shortCode}`);
const payloadB = JSON.stringify(dataB);
check("job B payload contains none of job A's short codes", ![contractSignedLink, coLink, quoteLink, invLink].some((l: any) => payloadB.includes(l.shortCode)));
check("job A payload contains none of job B's short codes", !JSON.stringify(dataA).includes(contractBLink.shortCode) && !JSON.stringify(dataA).includes(invBLink.shortCode));

// --- 7. Source wiring ----------------------------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");
check("portal renders the documents section only when rows exist", appSrc.includes("(d.jobDocuments ?? []).length > 0") && appSrc.includes("(d.jobDocuments ?? []).map"));
check("portal document rows link through the row href", appSrc.includes("portal-v2-doc-row") && appSrc.includes("href={doc.href}"));
check("portal strings cover signed/awaiting in EN + ES", appSrc.includes('"Signed"') && appSrc.includes('"Firmado"') && appSrc.includes("Awaiting signature") && appSrc.includes("En espera de firma"));
check("portal strings cover kind labels in EN + ES", appSrc.includes('"Contract"') && appSrc.includes('"Contrato"') && appSrc.includes('"Change order"') && appSrc.includes('"Orden de cambio"'));
check("invoice rows link when an href exists", appSrc.includes("inv.href") && appSrc.includes("href={inv.href}"));
check("estimate rows offer the document page when an href exists", appSrc.includes("e.href") && appSrc.includes("href={e.href}") && appSrc.includes("View estimate") && appSrc.includes("Ver presupuesto"));
check("server adds jobDocuments to the portal payload", serverSrc.includes("jobDocuments:z.array") && serverSrc.includes("jobDocuments:documents.map"));
check("server derives hrefs from document_links only", serverSrc.includes("docHref(\"invoice\",inv.id)") && serverSrc.includes("docHref(\"quote\",q.id)") && serverSrc.includes("schema.documentLinks"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
