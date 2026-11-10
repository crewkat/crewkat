// Headline line items — FUNCTIONAL round trip through the production
// path (Danny 2026-11-09). Source pins alone can't prove this feature:
// the flag has to survive the request refine (a headline's description
// is empty by design), normalizeLineItems' field-by-field rebuild,
// storage, the response safeParse (zod strips undeclared keys — the
// client only ever sees parsed data), and the quote -> invoice
// conversion rebuild. This suite drives the real action registry
// against a scratch database, parsing requests and responses exactly
// as server.mjs's dispatch does.
//
// Run from app/:  bun headline-roundtrip.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
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
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const dir = await mkdtemp(join(tmpdir(), "crewkat-headlines-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  slug: "tradesign",
  invocationId: "headline-test",
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

await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Headline Co", updatedAt: new Date() });

const docFields = {
  clientId: null, jobId: null, clientName: "Mich Coffield", clientPhone: "", clientEmail: "",
  jobAddress: "9519 Colony Dr, Odessa, FL 33556", shippingAddress: "", jobType: "Floor",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "bold", font: "Inter", accentColor: "#174f7a", customizeJson: "{}",
  depositType: "none", depositValue: "0", materials: [],
  showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true,
  showFooterNotes: true, showLogo: true, showCompanyInfo: true,
};
const lines = [
  { name: "Materials", description: "", amount: "0", quantity: 1, discount: "0", unit: "none", isTitle: true },
  { name: "Tile", description: "Client-supplied tile install", amount: "1000.00", quantity: 1, discount: "0", unit: "none" },
  { name: "Labor", description: "Grinding and prep", amount: "500.00", quantity: 1, discount: "0", unit: "none", optional: true },
];

// --- 1. Request validation: a headline (empty description) is accepted,
//        a fully blank line is still rejected. -------------------------------
let quoteArgs: any = null;
try {
  quoteArgs = A.saveQuote.request.parse({ ...docFields, lineItems: lines, subtotal: "1000.00", total: "1000.00", expiryDate: "", sentAt: "" });
  check("request parse accepts a headline line with an empty description", true);
} catch (e) {
  check("request parse accepts a headline line with an empty description", false, String(e).slice(0, 200));
}
let blankRejected = false;
try {
  A.saveQuote.request.parse({ ...docFields, lineItems: [{ name: "", description: "", amount: "0", quantity: 1 }], subtotal: "0", total: "0", expiryDate: "", sentAt: "" });
} catch { blankRejected = true; }
check("request parse still rejects a fully blank line", blankRejected);

// --- 2. Save + stored shape ---------------------------------------------------
const saved = await A.saveQuote.handler(ctx, quoteArgs);
const quoteRow = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, saved.id)).limit(1))[0]!;
const stored = JSON.parse(quoteRow.lineItemsJson) as Array<Record<string, unknown>>;
check("stored headline keeps isTitle", stored[0]!.isTitle === true, JSON.stringify(stored[0]));
check("stored headline description is empty", stored[0]!.description === "", JSON.stringify(stored[0]));
check("stored headline name carries the text", stored[0]!.name === "Materials");
check("plain stored line has NO isTitle key (pre-feature shape)", !("isTitle" in stored[1]!), JSON.stringify(stored[1]));
check("optional line still carries its flag + minted id", stored[2]!.optional === true && typeof stored[2]!.id === "string");

// --- 3. Read path through the production response parse -----------------------
const listResult = await A.listQuotes.handler(ctx);
const parsed = A.listQuotes.response.safeParse(listResult);
check("listQuotes response parses", parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues?.slice(0, 2)).slice(0, 300));
const readQuote = parsed.success ? parsed.data.quotes.find((q: any) => q.id === saved.id) : null;
check("read-back headline still flagged (not stripped by the response schema)", readQuote?.lineItems[0]?.isTitle === true, JSON.stringify(readQuote?.lineItems[0]));
check("read-back total excludes the headline", readQuote?.total === "1000.00", String(readQuote?.total));

// --- 4. Conversion with an optional line present (the rebuild path) -----------
const converted = await A.convertQuoteToInvoice.handler(ctx, { quoteId: saved.id, today: "2026-11-09" });
const invRow = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, converted.invoiceId)).limit(1))[0]!;
const invLines = JSON.parse(invRow.lineItemsJson) as Array<Record<string, unknown>>;
const invTitle = invLines.find((l) => l.name === "Materials");
check("converted invoice keeps the headline flag through the line rebuild", invTitle?.isTitle === true, JSON.stringify(invLines.map((l) => l.name)));
const invList = A.listInvoices.response.safeParse(await A.listInvoices.handler(ctx));
check("listInvoices response parses with a headline aboard", invList.success, invList.success ? "" : JSON.stringify(invList.error.issues?.slice(0, 2)).slice(0, 300));
const readInv = invList.success ? invList.data.invoices.find((i: any) => i.id === converted.invoiceId) : null;
check("invoice read-back headline still flagged", readInv?.lineItems.find((l: any) => l.name === "Materials")?.isTitle === true);

// --- 5. Edit-save (FinancialEditor's action) keeps the headline ---------------
const updateArgs = A.updateQuoteDocument.request.parse({
  id: saved.id,
  lineItems: [
    { name: "Materials", description: "", amount: "0", quantity: 1, discount: "0", unit: "none", isTitle: true },
    { name: "Tile", description: "Client-supplied tile install", amount: "1200.00", quantity: 1, discount: "0", unit: "none" },
  ],
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  subtotal: "1200.00", total: "1200.00", footnote: "", depositType: "none", depositValue: "0",
});
await A.updateQuoteDocument.handler(ctx, updateArgs);
const afterEdit = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, saved.id)).limit(1))[0]!;
const editedLines = JSON.parse(afterEdit.lineItemsJson) as Array<Record<string, unknown>>;
check("edit-save keeps the headline flagged and text-only", editedLines[0]!.isTitle === true && editedLines[0]!.description === "", JSON.stringify(editedLines[0]));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
