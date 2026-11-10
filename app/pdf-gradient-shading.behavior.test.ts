// PDF gradient smoothness (Danny 2026-11-09: "The gradient should be
// smoother. I see differences in color" — 255% zoom on the estimate
// header). The header/section bands used to be painted as 48 flat
// strips; every strip edge read as a color step. fillBand now paints a
// TRUE axial shading (native PDF gradient, jsPDF ShadingPattern inside
// advancedAPI) so viewers interpolate the color continuously. This
// suite pins the approach and proves — through the production action
// path — that a gradient-mode estimate PDF really contains
// ShadingType-2 objects and still renders its content.
//
// Run from app/:  bun pdf-gradient-shading.behavior.test.ts
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { PDFDocument } from "pdf-lib";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const GEN = readFileSync("client/src/financialPdf.ts", "utf8");
check("gradient bands paint a true axial shading pattern",
  GEN.includes('doc.ShadingPattern("axial"') && GEN.includes("doc.addShadingPattern(key, pattern)") && GEN.includes("doc.fill({ key, matrix: doc.unitMatrix })"));
check("shading is painted inside advancedAPI (jsPDF's pattern mode)", GEN.includes("doc.advancedAPI(() => {"));
check("strip fallback survives if the shading API ever disappears",
  GEN.includes('typeof doc.addShadingPattern === "function"') && GEN.includes("Math.ceil(len / 0.75)"));
check("solid mode is untouched", GEN.includes('if (custom.colorMode !== "gradient") {'));

const dir = await mkdtemp(join(tmpdir(), "crewkat-shading-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
const ctx = {
  slug: "tradesign", invocationId: "shading-test", spaceDir: dir, db: () => db,
  blobs: { put: async () => {}, getUrl: async (k: string) => `blob://test/${k}`, get: async () => Buffer.alloc(0), delete: async () => {}, head: async () => ({ contentType: "application/octet-stream", size: 0 }) },
  executePrivileged: async () => { throw new Error("unexpected privileged call"); },
  emit: () => {}, invalidateQueries: () => {},
  workspaceCompanyId: 1, workspaceUserId: 1, workspaceTier: "premium",
} as any;
const A = BaseActions as any;
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Shading Co", updatedAt: new Date() });
const docFields = {
  clientId: null, jobId: null, clientName: "Mich Coffield", clientPhone: "", clientEmail: "",
  jobAddress: "9519 Colony Dr, Odessa, FL 33556", shippingAddress: "", jobType: "Floor",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "bold", font: "Inter", accentColor: "#174f7a",
  customizeJson: JSON.stringify({ colorMode: "gradient" }),
  depositType: "none", depositValue: "0", materials: [],
  showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true,
  showFooterNotes: true, showLogo: true, showCompanyInfo: true,
};
const saved = await A.saveQuote.handler(ctx, A.saveQuote.request.parse({
  ...docFields, subtotal: "3175", total: "3175", expiryDate: "", sentAt: "",
  lineItems: [{ name: "Section 1 — Concrete Grinding", description: "Grind down high areas.", amount: "3175", quantity: 1 }],
}));
const pdf = await A.getFinancialDocumentPdf.handler(ctx, A.getFinancialDocumentPdf.request.parse({ kind: "quote", documentId: saved.id }));
const bytes = Buffer.from(pdf.pdfBase64, "base64");
check("PDF renders", bytes.subarray(0, 4).toString() === "%PDF" && bytes.length > 2000, `${bytes.length} bytes`);

const doc = await PDFDocument.load(bytes);
let shadingObjects = 0;
for (const [, obj] of doc.context.enumerateIndirectObjects()) {
  if (obj.toString().includes("ShadingType")) shadingObjects++;
}
check("PDF contains true axial shading objects (not flat strips)", shadingObjects >= 1, `${shadingObjects} found`);
const pageText = (await Promise.all(doc.getPages().map(async (p) => {
  // pdf-lib has no text extraction; presence of pages + parse is the
  // structural check here — content rendering is covered by the
  // doc-link parity suites.
  return p.getSize().width > 0 ? "ok" : "";
}))).join("");
check("pages intact after advanced-mode blocks", pageText.length > 0 && doc.getPageCount() >= 1);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
