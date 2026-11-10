// Document item titles are bold (Danny 2026-11-09).
//
// Danny, looking at the Phase 2 estimate preview for Mich Coffield:
// "Titles in estimates should be bold." The document rendered each line
// item as one plain paragraph — name and description joined with an em
// dash, all regular weight — so the section titles never stood out.
// Fix: in both renderers the item name leads in bold and the
// description follows in regular weight:
//   - PDF generator (financialPdf.ts): itemLabelRuns composes the rich
//     runs — bold name runs, a plain " — " separator, description runs
//     (** markers in either field still parse). Used by the main items
//     table and the options rows.
//   - On-screen paper (App.tsx QuotePaper): PaperItemLabel renders
//     <strong>{name}</strong> — description, used by the main items,
//     the accepted-options rows, and the options rows.
// Items with no name render their description exactly as before.
//
// Run from app/:  bun test document-title-bold.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const PDF = readFileSync(join(import.meta.dir, "client/src/financialPdf.ts"), "utf8");

describe("PDF generator bolds item titles", () => {
  test("itemLabelRuns composes bold name + plain separator + description runs", () => {
    const at = PDF.indexOf("export function itemLabelRuns");
    expect(at).toBeGreaterThan(-1);
    const helper = PDF.slice(at, at + 600);
    expect(helper).toContain("bold: true");
    expect(helper).toContain('" — "');
    expect(helper).toContain('parseRichRuns(item.description ?? "")');
  });

  test("main items table and options rows both use itemLabelRuns", () => {
    expect(PDF.split("itemLabelRuns(item)").length - 1).toBe(2);
    expect(PDF).not.toContain('const itemLabel = [item.name, item.description].filter(Boolean).join(" — ");');
  });
});

describe("on-screen paper bolds item titles", () => {
  test("PaperItemLabel renders the name in <strong>", () => {
    const at = APP.indexOf("function PaperItemLabel");
    expect(at).toBeGreaterThan(-1);
    const helper = APP.slice(at, at + 400);
    expect(helper).toContain("<strong>{item.name}</strong>");
  });

  test("all three paper item lists use PaperItemLabel", () => {
    expect(APP.split("<PaperItemLabel item={item} />").length - 1).toBe(3);
  });
});
