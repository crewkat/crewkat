// Materials buy list (0075) + converted-invoice headline fix — behavior tests.
//
// Covers: migration 0075 (quotes.materials_json), saveQuote materials
// round-trip, saveQuoteMaterials (synced check-offs), duplicate carrying the
// list, convert-to-invoice rewriting a stock "ESTIMATE" headline to
// "INVOICE" in the copied customizeJson, parseDocumentCustomize healing the
// wrong kind's stock headline at render time (custom headlines preserved),
// and the client wiring (synced checklist, collapsed line-item cards with a
// floating edit sheet in all three editors).
//
// Run from app/:  bun materials-list.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { BaseActions } from "./server/src/actions.ts";
import { parseDocumentCustomize } from "./client/src/financialPdf.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function checkThrows(name: string, fn: () => Promise<unknown>) {
  try { await fn(); failures++; console.error(`FAIL ${name} — expected an error but none was thrown`); }
  catch { console.log(`ok   ${name}`); }
}

// --- 1. Journal + migration ----------------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
const last = entries[entries.length - 1]!;
check("newest migration tag is 0089_crew_tier2", last.tag === "0089_crew_tier2", last.tag);
const entry75 = entries.find((e) => e.tag === "0075_quote_materials")!;
const entry74 = entries.find((e) => e.tag === "0074_portal_short_codes")!;
check("0075 when is strictly greater than 0074", entry75.when > entry74.when);
const sql75 = await readFile(join("drizzle", "0075_quote_materials.sql"), "utf8");
check("0075 adds quotes.materials_json with a '[]' default", sql75.includes("materials_json") && sql75.includes("'[]'"));

// --- 2. Scratch DB + ctx ---------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-materials-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });
const quoteCols = (await sqlite.execute("PRAGMA table_info(quotes)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrated quotes table has materials_json", quoteCols.includes("materials_json"));

const ctx = {
  slug: "tradesign",
  invocationId: "materials-test",
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
  workspaceTier: "free",
} as any;
const A = BaseActions as any;

const quoteArgs = {
  clientId: null, jobId: null, clientName: "Sean C. Duclos", clientPhone: "", clientEmail: "",
  jobAddress: "1446 Sail Harbor Cir", shippingAddress: "", jobType: "Porch tile",
  subtotal: "11660.00", discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  total: "11660.00", footnote: "", expiryDate: "", sentAt: "", theme: "classic", font: "helvetica",
  accentColor: "#1f5a4a", depositType: "none", depositValue: "0",
};
const scopeLine = { description: "SCOPE OF WORK\n1. Protect surrounding areas.", amount: "11660.00" };

// --- 3. saveQuote: default + explicit materials ----------------------------------
const plain = await A.saveQuote.handler(ctx, { ...quoteArgs, lineItems: [scopeLine] });
const listed1 = await A.listQuotes.handler(ctx, {});
const plainQuote = listed1.quotes.find((q: any) => q.id === plain.id);
check("a quote saved without materials reads back an empty list", Array.isArray(plainQuote.materials) && plainQuote.materials.length === 0);

const buyList = [
  { name: "Cappadocia travertine tile", qty: "432", unit: "sq ft", checked: false },
  { name: "Premium exterior thinset", qty: "9", unit: "bags", checked: false },
  { name: "Color-matched silicone", qty: "15", unit: "tubes", checked: true },
];
const withMats = await A.saveQuote.handler(ctx, { ...quoteArgs, lineItems: [scopeLine], materials: buyList });
const listed2 = await A.listQuotes.handler(ctx, {});
const matsQuote = listed2.quotes.find((q: any) => q.id === withMats.id);
check("materials round-trip through saveQuote + listQuotes", JSON.stringify(matsQuote.materials) === JSON.stringify(buyList), JSON.stringify(matsQuote.materials));

// --- 4. saveQuoteMaterials: check-offs + edits persist ----------------------------
const updated = buyList.map((m, i) => (i === 0 ? { ...m, checked: true } : m));
await A.saveQuoteMaterials.handler(ctx, { id: withMats.id, materials: updated });
const listed3 = await A.listQuotes.handler(ctx, {});
const after = listed3.quotes.find((q: any) => q.id === withMats.id);
check("saveQuoteMaterials persists check-offs", after.materials[0].checked === true && after.materials[1].checked === false && after.materials[2].checked === true);
await checkThrows("saveQuoteMaterials on a missing quote throws", () => A.saveQuoteMaterials.handler(ctx, { id: 999999, materials: [] }));

// --- 5. Duplicate carries the list --------------------------------------------------
const dup = await A.duplicateQuote.handler(ctx, { id: withMats.id });
const listed4 = await A.listQuotes.handler(ctx, {});
const dupQuote = listed4.quotes.find((q: any) => q.id === dup.id);
check("duplicateQuote carries the materials list", JSON.stringify(dupQuote.materials) === JSON.stringify(updated));

// --- 6. Convert to invoice: stock headline rewritten --------------------------------
const estCustomize = JSON.stringify({ headline: "ESTIMATE", showThankYou: true });
const conv = await A.saveQuote.handler(ctx, { ...quoteArgs, lineItems: [scopeLine], customizeJson: estCustomize });
const converted = await A.convertQuoteToInvoice.handler(ctx, { quoteId: conv.id, today: "2026-10-14" });
const invList = await A.listInvoices.handler(ctx, {});
const invoice = invList.invoices.find((i: any) => i.id === converted.invoiceId);
const invCustom = JSON.parse(invoice.customizeJson);
check("converted invoice customize headline becomes INVOICE", invCustom.headline === "INVOICE", String(invCustom.headline));
check("converted invoice keeps the rest of the customize blob", invCustom.showThankYou === true);

// --- 7. Render-time healing in parseDocumentCustomize ----------------------------------
const storedEstimate = JSON.stringify({ headline: "ESTIMATE" });
check("invoice render heals a stored ESTIMATE headline", parseDocumentCustomize(storedEstimate, "invoice", "en").headline === "INVOICE");
check("invoice render heals a stored ESTIMADO headline", parseDocumentCustomize(JSON.stringify({ headline: "ESTIMADO" }), "invoice", "es").headline === "FACTURA");
check("quote render heals a stored INVOICE headline", parseDocumentCustomize(JSON.stringify({ headline: "INVOICE" }), "quote", "en").headline === "ESTIMATE");
check("custom headlines pass through untouched", parseDocumentCustomize(JSON.stringify({ headline: "Proposal" }), "invoice", "en").headline === "Proposal");
check("a correct stock headline is left alone", parseDocumentCustomize(JSON.stringify({ headline: "FACTURA" }), "invoice", "es").headline === "FACTURA");

// --- 8. Client wiring ------------------------------------------------------------------
const appTsx = await readFile(join("client", "src", "App.tsx"), "utf8");
check("checklist saves through the synced action", appTsx.includes("api.saveQuoteMaterials"));
check("checklist no longer persists to localStorage", !appTsx.includes("crewkat-materials-"));
check("text prefill parser exists", appTsx.includes("parseMaterialsFromLines"));
check("small copy-list button is wired", appTsx.includes("materials-copy-btn") && appTsx.includes("copyList"));
check("checklist receives the quote's materials", appTsx.includes("materials={quote.materials ?? []}"));
check("line-item edit sheet exists", appTsx.includes("function LineItemEditSheet"));
check("all three editors render collapsed item cards", (appTsx.match(/doc-line-card collapsed/g) ?? []).length >= 2 && appTsx.includes("invoice-line-card doc-line-card collapsed"));
check("all three editors open the item sheet", (appTsx.match(/<LineItemEditSheet/g) ?? []).length === 3, String((appTsx.match(/<LineItemEditSheet/g) ?? []).length));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
