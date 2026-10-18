// Contract opened notification (Danny 2026-10-18): when a client FIRST
// opens a contract or change-order link, the document's owner is notified
// (push + in-app) — first view only, never on reopens. Quote and invoice
// links do NOT fire it (they keep their pre-existing daily view notify).
// Coverage:
//  1. First resolve of a contract link creates exactly one owner
//     notification (kind "document-opened", link doc-opened:<id>) naming
//     the client + document title in EN and ES.
//  2. Reopens create none; viewCount still counts every resolve.
//  3. First resolve of a change-order link notifies the same way.
//  4. First resolve of quote / invoice links creates NO document-opened
//     notification.
//  5. The per-company notifyContractViewed preference gates the event:
//     off -> no notification, but the resolve still succeeds and counts.
// Run from app/:  bun contract-opened-notify.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";

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
const dir = await mkdtemp(join(tmpdir(), "crewkat-opened-"));
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
const owner = (await db.insert(schema.authUsers).values({ companyId: 1, name: "Danny Owner", email: "owner@test.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH", createdAt: now, updatedAt: now }).returning({ id: schema.authUsers.id }))[0]!;
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Stallions Construction Company LLC", updatedAt: now });
const jobId = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Eric Frantz", clientEmail: "eric@test.com", jobAddress: "2337 Eastwood Dr", jobType: "Garage conversion", jobDate: "2026-10-19", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;

const pngBase64 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64").toString("base64");
async function makeDoc(kind: "contract" | "change_order", title: string): Promise<number> {
  const saved = await A.saveDocument.handler(ctx, {
    jobId, kind, title, bodyText: "", originalFilename: "", originalDataBase64: "",
    description: "", amount: kind === "change_order" ? "250.00" : "", signerName: "Dennys Hernandez",
    signatureDataBase64: pngBase64, signedAt: now.toISOString(),
  });
  return saved.id as number;
}

const openedNotifs = async () =>
  db.select().from(schema.userNotifications).where(eq(schema.userNotifications.kind, "document-opened"));
const linkRow = async (kind: string, id: number) =>
  (await db.select().from(schema.documentLinks).where(and(eq(schema.documentLinks.documentKind, kind as never), eq(schema.documentLinks.documentId, id)))).at(-1)!;

// --- 1 + 2. Contract: first open notifies once; reopens never do ------------------
const contractId = await makeDoc("contract", "Garage conversion contract");
const contractLink = await A.createDocumentLink.handler(ctx, { kind: "contract", id: contractId });

const payload1 = await A.resolveDocumentLink.handler(ctx, { token: contractLink.token, userAgent: "test" });
check("contract resolve returns the payload", payload1.kind === "contract" && payload1.title === "Garage conversion contract");
let opened = await openedNotifs();
check("first contract open creates exactly one owner notification", opened.length === 1, String(opened.length));
check("notification belongs to the company owner", opened[0]?.userId === owner.id);
check("notification deep-links like the signed one (doc-opened:<id>)", opened[0]?.link === `doc-opened:${contractId}`, opened[0]?.link);
check("EN copy names the client + document", opened[0]?.titleEn === `Eric Frantz opened the contract "Garage conversion contract"`, opened[0]?.titleEn);
check("ES copy names the client + document", opened[0]?.titleEs === `Eric Frantz abrió el contrato "Garage conversion contract"`, opened[0]?.titleEs);

await A.resolveDocumentLink.handler(ctx, { token: contractLink.token, userAgent: "test" });
await A.resolveDocumentLink.handler(ctx, { token: contractLink.token, userAgent: "test" });
opened = await openedNotifs();
check("reopens create no further notifications", opened.length === 1, String(opened.length));
const contractRow = await linkRow("contract", contractId);
check("every resolve still counts as a view", contractRow.viewCount === 3, String(contractRow.viewCount));
check("firstViewedAt was recorded on the first open", contractRow.firstViewedAt !== null);

// --- 3. Change order: first open notifies ------------------------------------------
const coId = await makeDoc("change_order", "Change Order #1 — extra outlet");
const coLink = await A.createDocumentLink.handler(ctx, { kind: "change_order", id: coId });
await A.resolveDocumentLink.handler(ctx, { token: coLink.token, userAgent: "test" });
opened = await openedNotifs();
const coNotif = opened.find((n) => n.link === `doc-opened:${coId}`);
check("first change-order open notifies", !!coNotif && opened.length === 2, String(opened.length));
check("change-order EN copy uses the change-order noun", coNotif?.titleEn === `Eric Frantz opened the change order "Change Order #1 — extra outlet"`, coNotif?.titleEn);
check("change-order ES copy uses orden de cambio", coNotif?.titleEs === `Eric Frantz abrió la orden de cambio "Change Order #1 — extra outlet"`, coNotif?.titleEs);
await A.resolveDocumentLink.handler(ctx, { token: coLink.token, userAgent: "test" });
check("change-order reopen does not notify again", (await openedNotifs()).length === 2);

// --- 4. Quote + invoice links: no document-opened notification ----------------------
const docFields = {
  jobId: null, clientPhone: "", clientEmail: "", shippingAddress: "", jobType: "Garage conversion",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a",
};
const line = [{ name: "Paneling", description: "Walnut-look wall paneling", amount: "1000.00", quantity: 1 }];
const quote = await A.saveQuote.handler(ctx, {
  ...docFields, clientId: null, clientName: "Eric Frantz", jobAddress: "2337 Eastwood Dr",
  lineItems: line, subtotal: "1000.00", total: "1000.00",
  expiryDate: "", sentAt: "", depositType: "none", depositValue: "0", materials: [],
});
const quoteLink = await A.createDocumentLink.handler(ctx, { kind: "quote", id: quote.id });
await A.resolveDocumentLink.handler(ctx, { token: quoteLink.token, userAgent: "test" });
check("first quote open creates NO document-opened notification", (await openedNotifs()).length === 2);

const invoice = await A.saveInvoice.handler(ctx, {
  ...docFields, clientId: null, clientName: "Eric Frantz", jobAddress: "2337 Eastwood Dr",
  invoiceNumber: "", quoteId: null, lineItems: line, subtotal: "1000.00", total: "1000.00",
  issueDate: "2026-10-18", dueDate: "", status: "draft",
  recurringFrequency: "none", nextDueDate: "", recurringEndDate: "",
});
const invoiceLink = await A.createDocumentLink.handler(ctx, { kind: "invoice", id: invoice.id });
await A.resolveDocumentLink.handler(ctx, { token: invoiceLink.token, userAgent: "test" });
check("first invoice open creates NO document-opened notification", (await openedNotifs()).length === 2);

// --- 5. Preference gate ----------------------------------------------------------------
await db.update(schema.settings).set({ notifyContractViewed: false }).where(eq(schema.settings.companyId, 1));
const quietId = await makeDoc("contract", "Quiet contract");
const quietLink = await A.createDocumentLink.handler(ctx, { kind: "contract", id: quietId });
const quietPayload = await A.resolveDocumentLink.handler(ctx, { token: quietLink.token, userAgent: "test" });
check("pref off: resolve still succeeds and returns the payload", quietPayload.kind === "contract" && quietPayload.title === "Quiet contract");
check("pref off: no notification is created", (await openedNotifs()).length === 2);
check("pref off: the view still counts", (await linkRow("contract", quietId)).viewCount === 1);

await db.update(schema.settings).set({ notifyContractViewed: true }).where(eq(schema.settings.companyId, 1));
const loudId = await makeDoc("contract", "Loud contract");
const loudLink = await A.createDocumentLink.handler(ctx, { kind: "contract", id: loudId });
await A.resolveDocumentLink.handler(ctx, { token: loudLink.token, userAgent: "test" });
check("pref back on: first open notifies again", (await openedNotifs()).length === 3);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
