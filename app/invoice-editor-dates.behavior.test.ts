// Invoice editor dates (Danny 2026-10-20): the Edit screen for an
// EXISTING invoice had no date fields anywhere — a due date could only
// be set in the new-invoice builder, never changed after creation. The
// editor now opens with a Dates section (invoice-only: the server's
// updateQuoteDocument schema takes no date fields), bound to the
// document's stored issueDate/dueDate and saved through the editor's
// normal Save into updateInvoiceDocument, whose schema already accepted
// both fields.
//
// Covers:
//  1. updateInvoiceDocument with new issueDate/dueDate persists, and the
//     values read back through listInvoices (the detail screen's source).
//  2. Clearing the due date ("" — the stored form of "no due date",
//     the column is NOT NULL DEFAULT '') persists as no due date.
//  3. An update that omits the date fields leaves stored dates untouched
//     (the pre-fix payload shape still works).
//  4. Source wiring: Dates section in FinancialEditor gated to
//     kind === "invoice", above Line items, two date inputs bound to the
//     form state initialized from the document, dates in the invoice
//     save payload, EN/ES "Dates"/"Fechas" label, and updateQuoteDocument
//     still date-free (the reason quotes get no section).
//
// Run from app/:  bun invoice-editor-dates.behavior.test.ts
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
const dir = await mkdtemp(join(tmpdir(), "crewkat-inv-editor-dates-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  db: () => db,
  unscopedDb: () => db,
  blobs: {
    put: async () => {},
    get: async () => null,
    getUrl: async (key: string) => `https://crewkat.com/blobs/${key}`,
    delete: async () => {},
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

const inv = (await db.insert(schema.invoices).values({
  companyId: 1, invoiceNumber: "INV-0023", clientName: "Anthony Porreca",
  jobAddress: "2337 Eastwood Dr, Clearwater, FL", jobType: "Garage gym conversion",
  lineItemsJson: JSON.stringify([{ description: "Garage Gym Conversion", amount: "6060.00", quantity: 1 }]),
  subtotal: "6060.00", total: "6060.00", footnote: "",
  issueDate: "2026-10-20", dueDate: "", status: "sent",
  createdAt: now, updatedAt: now,
}).returning({ id: schema.invoices.id }))[0]!;
check("seeded invoice INV-0023 starts with no due date", inv.id > 0);

const readRow = async () => (await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id)).limit(1))[0]!;
const editPayload = (dates: Record<string, string>) => ({
  id: inv.id,
  lineItems: [{ description: "Garage Gym Conversion", amount: "6060.00" }],
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  subtotal: "6060.00", total: "6060.00", footnote: "",
  depositType: "none", depositValue: "0",
  ...dates,
});

// --- 1. Set dates, persist, read back -------------------------------------------
const setRes = await A.updateInvoiceDocument.handler(ctx, editPayload({ issueDate: "2026-10-21", dueDate: "2026-11-04" }));
check("update with new issue/due dates ok", setRes.ok === true);
let row = await readRow();
check("issue date persisted", row.issueDate === "2026-10-21", row.issueDate);
check("due date persisted", row.dueDate === "2026-11-04", row.dueDate);
const listed = await A.listInvoices.handler(ctx, {});
const listedInv = listed.invoices.find((i: any) => i.id === inv.id);
check("listInvoices (detail screen source) reads back the new dates",
  listedInv?.issueDate === "2026-10-21" && listedInv?.dueDate === "2026-11-04",
  JSON.stringify({ issueDate: listedInv?.issueDate, dueDate: listedInv?.dueDate }));

// --- 2. Clearing the due date persists as no due date ----------------------------
const clearRes = await A.updateInvoiceDocument.handler(ctx, editPayload({ issueDate: "2026-10-21", dueDate: "" }));
check("update clearing the due date ok", clearRes.ok === true);
row = await readRow();
check("cleared due date persists as empty (no due date)", row.dueDate === "", JSON.stringify(row.dueDate));
check("issue date survives the clear", row.issueDate === "2026-10-21", row.issueDate);

// --- 3. Omitting dates leaves them untouched --------------------------------------
const omitRes = await A.updateInvoiceDocument.handler(ctx, editPayload({ dueDate: "2026-12-01" }));
check("update setting only a due date ok", omitRes.ok === true);
const omitRes2 = await A.updateInvoiceDocument.handler(ctx, editPayload({}));
check("update with no date fields ok (pre-fix payload shape)", omitRes2.ok === true);
row = await readRow();
check("omitted dates leave stored values untouched",
  row.issueDate === "2026-10-21" && row.dueDate === "2026-12-01",
  JSON.stringify({ issueDate: row.issueDate, dueDate: row.dueDate }));

// --- 4. Source wiring ---------------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");
const editorStart = appSrc.indexOf("function FinancialEditor(");
const editorSrc = appSrc.slice(editorStart, appSrc.indexOf("\n}\n", editorStart));
check("FinancialEditor renders the Dates section", editorSrc.includes("editor-dates-section") && editorSrc.includes("{t.dates}"));
check("Dates section is invoice-only", editorSrc.includes('kind === "invoice" && <section className="editor-section editor-dates-section"'));
check("Dates section sits above Line items",
  editorSrc.indexOf("editor-dates-section") > -1 && editorSrc.indexOf("editor-dates-section") < editorSrc.indexOf("editor-items-section"));
check("issue date input bound to form.issueDate",
  editorSrc.includes('<input type="date" value={form.issueDate}') && editorSrc.includes("issueDate: e.target.value"));
check("due date input bound to form.dueDate",
  editorSrc.includes('<input type="date" value={form.dueDate}') && editorSrc.includes("dueDate: e.target.value"));
check("editor labels come from the string tables (t.issueDate / t.dueDate)",
  editorSrc.includes("{t.issueDate}") && editorSrc.includes("{t.dueDate}"));
check("form state initializes dates from the document",
  editorSrc.includes('issueDate: document.issueDate ?? ""') && editorSrc.includes('dueDate: document.dueDate ?? ""'));
check("invoice save payload always sends both dates",
  editorSrc.includes("api.updateInvoiceDocument({...payload,issueDate:form.issueDate,dueDate:form.dueDate})"));
check("quote save payload unchanged (no dates sent)",
  editorSrc.includes("await api.updateQuoteDocument(payload)"));
check("EN label added", appSrc.includes('dates: "Dates",'));
check("ES label added", appSrc.includes('dates: "Fechas",'));
const quoteAction = serverSrc.slice(serverSrc.indexOf("updateQuoteDocument: defineAction"), serverSrc.indexOf("updateQuoteDocument: defineAction") + 400);
check("updateQuoteDocument schema still takes no date fields (why quotes get no section)",
  !quoteAction.includes("issueDate") && !quoteAction.includes("dueDate") && !quoteAction.includes("expiryDate"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
