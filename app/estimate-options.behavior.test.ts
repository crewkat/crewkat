// Estimate Options behavior tests (0076, 2026-10-14).
//
// Covers: migration 0076 (quotes.option_selection_json), the line-item
// `optional` flag + stable ids through saveQuote, base-total exclusion math
// (financialTotals / lineItemsTotal), the PDF Options section, the public
// saveQuoteOptionSelection action over BOTH client tokens (document link +
// job portal), the accept snapshot (acceptQuoteVersion, the detail-page
// won toggle, unaccept clearing), quote versions carrying the live
// selection only, duplicate resetting it, and invoice conversion billing
// base lines + ACCEPTED options only.
//
// Run from app/:  bun estimate-options.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { BaseActions } from "./server/src/actions.ts";
import { buildQuotePdf, financialTotals, lineItemsTotal, type FinancialDocument } from "./client/src/financialPdf.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function checkThrows(name: string, fn: () => Promise<unknown>) {
  try { await fn(); check(name, false, "did not throw"); }
  catch { check(name, true); }
}

// --- 1. Journal + migration ----------------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
const last = entries[entries.length - 1]!;
check("newest migration tag is 0082_fill_fields", last.tag === "0082_fill_fields", last.tag);
const entry75 = entries.find((e) => e.tag === "0075_quote_materials")!;
check("0076 when is strictly greater than 0075", last.when > entry75.when, `${last.when} vs ${entry75.when}`);
const sql76 = await readFile(join("drizzle", "0076_quote_option_selection.sql"), "utf8");
check("0076 adds quotes.option_selection_json with a '{}' default", sql76.includes("option_selection_json") && sql76.includes("'{}'"));

// --- 2. Scratch DB + ctx ---------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-options-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });
const quoteCols = (await sqlite.execute("PRAGMA table_info(quotes)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrated quotes table has option_selection_json", quoteCols.includes("option_selection_json"));

const ctx = {
  slug: "tradesign",
  invocationId: "options-test",
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
  clientId: null, jobId: null, clientName: "Options Client", clientPhone: "", clientEmail: "",
  jobAddress: "1 Option Way", shippingAddress: "", jobType: "Bathroom remodel",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", expiryDate: "", sentAt: "", theme: "classic", font: "helvetica",
  accentColor: "#1f5a4a", depositType: "none", depositValue: "0",
};
// Base lines total $1,000. Options: grout sealer $250 (id given), heated
// floor $400 x1 (id minted server-side), towel warmer $150 (never picked).
const baseLine = { name: "Tile install", description: "Install floor tile", amount: "1000.00", quantity: 1 };
const optSealer = { name: "Grout sealer", description: "Premium grout sealer", amount: "250.00", quantity: 1, optional: true, id: "opt-sealer" };
const optHeated = { name: "Heated floor", description: "Radiant heated floor mat", amount: "400.00", quantity: 1, optional: true };
const optWarmer = { name: "Towel warmer", description: "Wall towel warmer", amount: "150.00", quantity: 1, optional: true, id: "opt-warmer" };
const quoteTotalArgs = { subtotal: "1000.00", total: "1000.00" };

// --- 3. Schema flag default: plain lines keep their exact stored shape -----------
const plain = await A.saveQuote.handler(ctx, { ...quoteArgs, ...quoteTotalArgs, lineItems: [{ description: "Scope only", amount: "1000.00" }] });
const listedPlain = await A.listQuotes.handler(ctx, {});
const plainQuote = listedPlain.quotes.find((q: any) => q.id === plain.id);
check("plain line stores no optional/id keys", plainQuote.lineItems.every((i: any) => !("optional" in i) && !("id" in i)), JSON.stringify(plainQuote.lineItems));
check("new quote optionSelection is empty", Array.isArray(plainQuote.optionSelection.selectedKeys) && plainQuote.optionSelection.selectedKeys.length === 0 && plainQuote.optionSelection.accepted === null);

// --- 4. Optional lines: flag + stable ids persist -------------------------------
const saved = await A.saveQuote.handler(ctx, { ...quoteArgs, ...quoteTotalArgs, lineItems: [baseLine, optSealer, optHeated, optWarmer] });
const listed = await A.listQuotes.handler(ctx, {});
const quote = listed.quotes.find((q: any) => q.id === saved.id);
check("stored base total excludes options (client-computed base)", quote.total === "1000.00", quote.total);
const storedOptionals = quote.lineItems.filter((i: any) => i.optional);
check("three optional lines stored with the flag", storedOptionals.length === 3, JSON.stringify(quote.lineItems));
check("explicit option id is preserved", storedOptionals.some((i: any) => i.id === "opt-sealer"));
const heated = storedOptionals.find((i: any) => i.description.includes("Radiant"));
check("optional line without an id gets one minted", typeof heated.id === "string" && heated.id.length >= 8, JSON.stringify(heated));
check("base line carries no optional flag", quote.lineItems.filter((i: any) => !i.optional).length === 1);

// --- 5. Base-total exclusion math (shared financialTotals) -----------------------
const mixed = [
  { amount: "1000.00", quantity: 1 },
  { amount: "250.00", quantity: 1, optional: true },
  { amount: "400.00", quantity: 1, optional: true },
];
const totals = financialTotals(mixed, "percent", "0", "percent", "0");
check("financialTotals excludes optional lines from subtotal/total", totals.subtotal === 1000 && totals.total === 1000, JSON.stringify(totals));
check("lineItemsTotal sums the option subset separately", lineItemsTotal(mixed.filter((i) => i.optional)) === 650);
const taxed = financialTotals(mixed, "percent", "0", "percent", "10");
check("tax applies to the base only, never to options", taxed.tax === 100 && taxed.total === 1100, JSON.stringify(taxed));

// --- 6. PDF: Options section renders; absent without optionals ------------------
const settings = {
  companyName: "Stallions Construction Company LLC", phone: "(813) 516-5720",
  email: "stallionsconstructioncompany@gmail.com", website: "stallionsconstruction.com",
  address: "Trinity, FL", licenseNumber: "CRC1335847", paymentInstructions: "Zelle",
  accentColor: "#1f5a4a", logoUrl: null, defaultDocumentFont: "helvetica",
} as any;
const strings = { discount: "Discount", tax: "Tax", paymentInstructions: "Payment instructions" };
const stringsEs = { discount: "Descuento", tax: "Impuesto", paymentInstructions: "Instrucciones de pago" };
function sampleQuote(lineItems: FinancialDocument["lineItems"]): FinancialDocument {
  return {
    id: 7, invoiceNumber: "", clientName: "Options Client", jobAddress: "1 Option Way", shippingAddress: "",
    jobType: "Bathroom remodel", lineItems, subtotal: "1000.00", discountType: "percent", discountValue: "0",
    taxType: "percent", taxValue: "0", total: "1000.00", footnote: "", theme: "classic", font: "helvetica",
    accentColor: "#1f5a4a", showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true,
    showFooterNotes: true, showLogo: false, showCompanyInfo: true, customizeJson: "{}", issueDate: "2026-10-14", dueDate: "",
  } as FinancialDocument;
}
const pdfRaw = Buffer.from(await (await buildQuotePdf(sampleQuote([
  { name: "Tile install", description: "Install floor tile", amount: "1000.00", quantity: 1, discount: "0", unit: "none" },
  { name: "Grout sealer", description: "Premium grout sealer", amount: "250.00", quantity: 1, discount: "0", unit: "none", optional: true },
]), settings, "en", strings)).arrayBuffer()).toString("latin1");
check("quote PDF renders the OPTIONS section header", pdfRaw.includes("OPTIONS"));
check("quote PDF prints the not-included note", pdfRaw.includes("not included in the estimate total unless selected"));
check("quote PDF lists the optional item", pdfRaw.includes("Premium grout sealer"));
check("quote PDF prints the options total", pdfRaw.includes("Options total"));
const pdfRawEs = Buffer.from(await (await buildQuotePdf(sampleQuote([
  { name: "Tile install", description: "Install floor tile", amount: "1000.00", quantity: 1, discount: "0", unit: "none" },
  { name: "Sellador", description: "Sellador premium", amount: "250.00", quantity: 1, discount: "0", unit: "none", optional: true },
]), settings, "es", stringsEs)).arrayBuffer()).toString("latin1");
check("quote PDF renders OPCIONES in Spanish", pdfRawEs.includes("OPCIONES"));
const pdfPlain = Buffer.from(await (await buildQuotePdf(sampleQuote([
  { name: "Tile install", description: "Install floor tile", amount: "1000.00", quantity: 1, discount: "0", unit: "none" },
]), settings, "en", strings)).arrayBuffer()).toString("latin1");
check("quote PDF without optionals has no options section", !pdfPlain.includes("Options total"));

// --- 7. Public action registration ----------------------------------------------
const actionsSrc = await readFile(join("server", "src", "actions.ts"), "utf8");
check("saveQuoteOptionSelection is in PUBLIC_ACTIONS", /PUBLIC_ACTIONS[\s\S]*?"saveQuoteOptionSelection"/.test(actionsSrc));

// --- 8. Document-link flow: payload, save, reload --------------------------------
const link = await A.createDocumentLink.handler(ctx, { kind: "quote", id: saved.id });
const payload1 = await A.resolveDocumentLink.handler(ctx, { token: link.token, userAgent: "test" });
check("doc payload exposes the tickable options", payload1.options.length === 3 && payload1.options.every((o: any) => typeof o.key === "string" && o.key.length > 0), JSON.stringify(payload1.options));
check("doc payload starts with no selection", payload1.selectedOptionKeys.length === 0 && payload1.acceptedOptions === null);
check("doc payload lineItems keep the optional flags for the PDF path", payload1.lineItems.filter((i: any) => i.optional).length === 3);
const heatedKey = payload1.options.find((o: any) => o.description.includes("Radiant")).key;
const saveRes = await A.saveQuoteOptionSelection.handler(ctx, { token: link.token, quoteId: saved.id, selectedKeys: ["opt-sealer", heatedKey] });
check("save returns the picked options total", saveRes.optionsTotal === "650.00", saveRes.optionsTotal);
check("save returns base + selected as the with-options total", saveRes.totalWithOptions === "1650.00", saveRes.totalWithOptions);
const payload2 = await A.resolveDocumentLink.handler(ctx, { token: link.token, userAgent: "test" });
check("selection persists across payload loads", JSON.stringify([...payload2.selectedOptionKeys].sort()) === JSON.stringify(["opt-sealer", heatedKey].sort()), JSON.stringify(payload2.selectedOptionKeys));
check("payload optionsTotal reflects the selection", payload2.optionsTotal === "650.00" && payload2.totalWithOptions === "1650.00");
const bogus = await A.saveQuoteOptionSelection.handler(ctx, { token: link.token, quoteId: saved.id, selectedKeys: ["opt-sealer", "not-a-line"] });
check("unknown selection keys are dropped, not stored", JSON.stringify(bogus.selectedOptionKeys) === JSON.stringify(["opt-sealer"]));
await A.saveQuoteOptionSelection.handler(ctx, { token: link.token, quoteId: saved.id, selectedKeys: ["opt-sealer", heatedKey] });
await checkThrows("a bogus token cannot save a selection", () => A.saveQuoteOptionSelection.handler(ctx, { token: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", quoteId: saved.id, selectedKeys: [] }));
await checkThrows("a doc link for another quote cannot save this selection", () => A.saveQuoteOptionSelection.handler(ctx, { token: link.token, quoteId: plain.id, selectedKeys: [] }));

// --- 9. Portal flow: same action via the job portal token -------------------------
const job = await A.createJob.handler(ctx, { clientName: "Portal Client", clientPhone: "", clientEmail: "", jobAddress: "2 Portal Ct", jobType: "Bathroom remodel", notes: "", jobDate: "2026-10-20", appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "" });
const portalQuoteSaved = await A.saveQuote.handler(ctx, { ...quoteArgs, ...quoteTotalArgs, jobId: job.id, lineItems: [baseLine, optSealer, optWarmer] });
const portal = await A.createPortalLink.handler(ctx, { jobId: job.id, expiresInDays: 90 });
const portalData1 = await A.getPortalData.handler(ctx, { token: portal.token });
const portalEstimate = portalData1.estimates.find((e: any) => e.id === portalQuoteSaved.id);
check("portal payload lists base lines only in lineItems", portalEstimate.lineItems.length === 1, JSON.stringify(portalEstimate.lineItems));
check("portal payload exposes options separately", portalEstimate.options.length === 2 && portalEstimate.selectedOptionKeys.length === 0);
const portalSave = await A.saveQuoteOptionSelection.handler(ctx, { token: portal.token, quoteId: portalQuoteSaved.id, selectedKeys: ["opt-warmer"] });
check("portal token saves a selection", portalSave.optionsTotal === "150.00" && portalSave.totalWithOptions === "1150.00", JSON.stringify(portalSave));
const portalData2 = await A.getPortalData.handler(ctx, { token: portal.token });
check("portal reload reflects the saved selection", JSON.stringify(portalData2.estimates.find((e: any) => e.id === portalQuoteSaved.id).selectedOptionKeys) === JSON.stringify(["opt-warmer"]));
await checkThrows("portal token cannot touch another job's quote", () => A.saveQuoteOptionSelection.handler(ctx, { token: portal.token, quoteId: saved.id, selectedKeys: [] }));

// --- 10. Accept snapshot -----------------------------------------------------------
await A.acceptQuoteVersion.handler(ctx, { id: saved.id });
const listedAccepted = await A.listQuotes.handler(ctx, {});
const acceptedQuote = listedAccepted.quotes.find((q: any) => q.id === saved.id);
check("acceptance marks the quote accepted", acceptedQuote.accepted === true);
const snap = acceptedQuote.optionSelection.accepted;
check("accept snapshot exists", !!snap);
check("snapshot holds exactly the selected options", snap.items.map((i: any) => i.key).sort().join(",") === ["opt-sealer", heatedKey].sort().join(","), JSON.stringify(snap?.items));
check("snapshot prices are the client's prices", snap.optionsTotal === "650.00" && snap.totalWithOptions === "1650.00", JSON.stringify(snap));
check("snapshot carries a timestamp", typeof snap.acceptedAt === "string" && snap.acceptedAt.length >= 10);
await A.unacceptQuote.handler(ctx, { id: saved.id });
const listedUn = await A.listQuotes.handler(ctx, {});
const unQuote = listedUn.quotes.find((q: any) => q.id === saved.id);
check("unaccept clears the snapshot but keeps the live selection", unQuote.optionSelection.accepted === null && unQuote.optionSelection.selectedKeys.length === 2);

// --- 11. Detail-page accept path (won toggle) also snapshots -----------------------
const wonSaved = await A.saveQuote.handler(ctx, { ...quoteArgs, ...quoteTotalArgs, lineItems: [baseLine, optWarmer] });
const wonLink = await A.createDocumentLink.handler(ctx, { kind: "quote", id: wonSaved.id });
await A.saveQuoteOptionSelection.handler(ctx, { token: wonLink.token, quoteId: wonSaved.id, selectedKeys: ["opt-warmer"] });
await A.updateQuoteAutomationStatus.handler(ctx, { id: wonSaved.id, status: "won", lostReason: null, lostNote: "" });
const listedWon = await A.listQuotes.handler(ctx, {});
const wonQuote = listedWon.quotes.find((q: any) => q.id === wonSaved.id);
check("won toggle snapshots the selection", wonQuote.optionSelection.accepted?.optionsTotal === "150.00", JSON.stringify(wonQuote.optionSelection));

// --- 12. Versions carry the live selection, never the snapshot ----------------------
await A.acceptQuoteVersion.handler(ctx, { id: saved.id });
const version = await A.createQuoteVersion.handler(ctx, { id: saved.id });
const versionsRes = await A.getQuoteVersions.handler(ctx, { id: saved.id });
const newVersion = versionsRes.versions.find((v: any) => v.id === version.id);
check("new version keeps the client's live selection", newVersion.optionSelection.selectedKeys.length === 2, JSON.stringify(newVersion.optionSelection));
check("new version starts without an accepted snapshot", newVersion.optionSelection.accepted === null);

// --- 13. Duplicate resets the selection ----------------------------------------------
const dup = await A.duplicateQuote.handler(ctx, { id: saved.id });
const listedDup = await A.listQuotes.handler(ctx, {});
const dupQuote = listedDup.quotes.find((q: any) => q.id === dup.id);
check("duplicate starts with an empty selection", dupQuote.optionSelection.selectedKeys.length === 0 && dupQuote.optionSelection.accepted === null);

// --- 14. Conversion: base + ACCEPTED options only --------------------------------------
const converted = await A.convertQuoteToInvoice.handler(ctx, { quoteId: saved.id, today: "2026-10-14" });
const invList = await A.listInvoices.handler(ctx, {});
const invoice = invList.invoices.find((i: any) => i.id === converted.invoiceId);
check("invoice exists from conversion", !!invoice);
const invDescriptions = invoice.lineItems.map((i: any) => i.description);
check("invoice carries the base line", invDescriptions.includes("Install floor tile"));
check("invoice carries accepted options", invDescriptions.includes("Premium grout sealer") && invDescriptions.includes("Radiant heated floor mat"), JSON.stringify(invDescriptions));
check("invoice drops the unaccepted option", !invDescriptions.includes("Wall towel warmer"));
check("converted option lines are regular lines (no optional flag)", invoice.lineItems.every((i: any) => !i.optional));
check("invoice total = base + accepted options", invoice.total === "1650.00", invoice.total);
check("invoice subtotal = base + accepted options", invoice.subtotal === "1650.00", invoice.subtotal);

// --- 15. Client wiring (source) ---------------------------------------------------------
const appTsx = await readFile(join("client", "src", "App.tsx"), "utf8");
check("LineItemEditSheet is still instantiated exactly 3 times", (appTsx.match(/<LineItemEditSheet/g) ?? []).length === 3);
check("edit sheet has the Optional toggle (EN/ES)", appTsx.includes("showOptional") && appTsx.includes("\"Opcional\"") && appTsx.includes("\"Optional\""));
check("FinancialEditor only offers the toggle for quotes", appTsx.includes("showOptional={kind === \"quote\"}"));
check("client doc page renders the options picker", appTsx.includes("doc.kind === \"quote\" && doc.options.length > 0"));
check("portal renders the options picker", appTsx.includes("e.options.length > 0"));
check("contractor detail shows the client options summary", appTsx.includes("<QuoteOptionsSummary"));
check("picker saves through the public action", appTsx.includes("api.saveQuoteOptionSelection"));
check("materials prefill excludes unaccepted optional lines", appTsx.includes("quote.lineItems.filter((item) => !item.optional)"));
check("materials prefill includes accepted option lines", appTsx.includes("quote.optionSelection.accepted?.items.map"));
check("materials text parser still skips add-on/optional text lines", appTsx.includes("/add-on|optional/i"));
const pdfSrc = await readFile(join("client", "src", "financialPdf.ts"), "utf8");
check("financialTotals skips optional items at the source", pdfSrc.includes("items.filter((item) => !item.optional)"));

console.log(failures === 0 ? "\nALL ESTIMATE OPTIONS CHECKS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
