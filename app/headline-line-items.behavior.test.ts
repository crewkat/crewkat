// Headline line items + editor line order (Danny 2026-11-09, from his
// reference recording): a headline is a text-only section line inside the
// items list — it groups the priced lines under it, carries no price,
// and never adds to the total. Storage discipline mirrors Estimate
// Options (0076): the isTitle flag rides ONLY on headline lines, so plain
// lines keep their exact stored shape, and the flag survives every
// serializer (normalize, quote->invoice conversion, the canonical-PDF
// payload) instead of being rebuilt away.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync("client/src/App.tsx", "utf8");
const PDF = readFileSync("client/src/financialPdf.ts", "utf8");
const SERVER = readFileSync("server/src/actions.ts", "utf8");
const DOCPDF = readFileSync("server/src/docPdf.ts", "utf8");
const CSS = readFileSync("client/src/theme.css", "utf8");
const OFFICE_EDITOR = readFileSync("office/src/views/FinancialEditor.tsx", "utf8");
const OFFICE_DOCS = readFileSync("office/src/views/Documents.tsx", "utf8");

describe("headline line items (Danny 2026-11-09)", () => {
  test("server schema carries isTitle; the content check rides the request schemas only", () => {
    expect(SERVER).toContain("optional: z.boolean().optional(), isTitle: z.boolean().optional() });");
    expect(SERVER).toContain("const quoteItemRequestSchema = quoteItemSchema.superRefine(lineItemContentCheck);");
    expect(SERVER).toContain("const invoiceItemRequestSchema = invoiceItemSchema.superRefine(lineItemContentCheck);");
    expect(SERVER).toContain('if ((item.name ?? "").trim() || item.description.trim()) return;');
    // All six save/update/template/version request sites use the checked schema.
    expect(SERVER.split("z.array(quoteItemRequestSchema)").length - 1).toBe(4);
    expect(SERVER.split("z.array(invoiceItemRequestSchema)").length - 1).toBe(2);
  });

  test("normalize stores headlines with an empty description and the flag only on title lines", () => {
    expect(SERVER).toContain('description: item.isTitle ? "" : item.description.trim(),');
    expect(SERVER).toContain("...(item.isTitle ? { isTitle: true as const } : {}),");
    expect(SERVER).toContain("isTitle?: boolean };");
    // Quote -> invoice conversion keeps headlines when it rebuilds lines.
    expect(SERVER).toContain("...(line.isTitle?{isTitle:true as const}:{})");
  });

  test("the canonical (server) PDF payload forwards isTitle into the shared renderer", () => {
    expect(DOCPDF).toContain("isTitle?: boolean;");
    expect(DOCPDF).toContain("isTitle: li.isTitle === true,");
  });

  test("the PDF draws a headline as a banded bold row with no amount", () => {
    expect(PDF).toContain("if (item.isTitle) {");
    expect(PDF).toContain("const titleText = (item.name ?? \"\").trim() || item.description.trim();");
    expect(PDF).toContain("optional?: boolean; isTitle?: boolean }>");
  });

  test("the paper renderer gives headlines their own header row", () => {
    expect(APP).toContain('if (item.isTitle) return <div className="quote-line paper-title-line" key={i}>');
    expect(CSS).toContain(".quote-line.paper-title-line");
  });

  test("the item sheet has the Headline toggle and it clears the priced fields", () => {
    expect(APP).toContain("isTitle?: boolean };");
    expect(APP).toContain('set(next ? { isTitle: true, optional: false, description: "", amount: "0", quantity: 1, discount: "0", unit: "none" } : { isTitle: false })');
    expect(APP).toContain("{!draft.isTitle && <label>");
    expect(APP).toContain("showOptional && !draft.isTitle");
  });

  test("all three phone editors can add a headline and serialize it without the name-fallback", () => {
    expect(APP.split('"Add headline"').length - 1).toBeGreaterThanOrEqual(3);
    expect(APP).toContain('i.isTitle ? { ...i, description: "", amount: i.amount || "0" }');
    expect(APP).toContain('item.isTitle?"":(item.description.trim()||(item.name??"").trim())');
    expect(APP).toContain("...(item.isTitle?{isTitle:true}:{})");
    // Rows mark headlines with the chip and hide the $0.00 total.
    expect(CSS).toContain(".doc-line-title-chip");
    expect(APP).toContain('{!item.isTitle && <span className="doc-line-total">');
  });

  test("the invoice builder has the same drag-grip reorder as the estimate builder", () => {
    // Two full grip implementations (QuoteBuilder + InvoiceBuilder).
    expect(APP.split("const onGripPointerDown = (e: PointerEvent<HTMLSpanElement>, index: number)").length - 1).toBe(2);
    expect(APP.split('querySelectorAll<HTMLElement>("[data-b06-line]")').length - 1).toBeGreaterThanOrEqual(1);
  });

  test("Office never drops or strips a headline on save, and its table renders it as a header", () => {
    expect(OFFICE_EDITOR).toContain("|| (i.isTitle && (i.name ?? \"\").trim())");
    expect(OFFICE_EDITOR).toContain("...(i.isTitle ? { isTitle: true } : {}),");
    expect(OFFICE_DOCS).toContain("item.isTitle ? <strong>");
  });

  test("the Office editor is a near-fullscreen popup with headline rows and readable descriptions", () => {
    expect(OFFICE_EDITOR).toContain('className="modal modal-editor"');
    expect(OFFICE_EDITOR).toContain('className="lt-title-row"');
    expect(OFFICE_EDITOR).toContain("+ Add headline");
    expect(OFFICE_EDITOR).toContain("<textarea rows={2} value={item.description}");
  });

  test("the zoom viewer is portaled to the body so it takes the full screen inside sheets", () => {
    expect(APP).toContain("const viewer = (");
    expect(APP).toContain('return typeof globalThis.document === "undefined" ? viewer : createPortal(viewer, globalThis.document.body);');
  });
});
