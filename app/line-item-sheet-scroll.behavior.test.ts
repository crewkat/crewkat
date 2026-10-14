// LineItemEditSheet scroll-containment tests (2026-10-14).
//
// Field report (Danny, phone): with a long multi-paragraph description
// (Sean's EST0016 materials line) the Edit item sheet rendered taller than
// the screen — the Optional row was cut off at the bottom edge and builder
// content (Notes / Save / Delete estimate) bled through at the seam. Root
// cause: the sheet was rendered inline inside the builders (themselves
// scrolled/animated sheet containers) behind a bare position:fixed backdrop
// with a single content-sized scroll region — the same nested-fixed failure
// the Customize overlay was portaled to document.body for.
//
// Fix pinned here: (1) the sheet portals to document.body; (2) the sheet is
// a non-scrolling frame (pinned head + foot, grid rows
// auto / minmax(0,1fr) / auto, dvh height cap) with ONE internal scroll
// body (.line-item-sheet-body, overflow-y:auto).
//
// Run from app/:  bun line-item-sheet-scroll.behavior.test.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const appTsx = await readFile(join("client", "src", "App.tsx"), "utf8");
const css = await readFile(join("client", "src", "theme.css"), "utf8");

// Slice out the LineItemEditSheet function so checks can't be satisfied by
// unrelated code elsewhere in the (very large) App.tsx.
const fnStart = appTsx.indexOf("function LineItemEditSheet");
check("LineItemEditSheet exists", fnStart >= 0);
const fnSlice = appTsx.slice(fnStart, fnStart + 9000);

check("sheet portals to document.body", fnSlice.includes("createPortal(sheet, globalThis.document.body)"));
check("sheet keeps the SSR/no-document fallback", fnSlice.includes('typeof globalThis.document === "undefined" ? sheet : createPortal'));
check("sheet has a pinned head region", fnSlice.includes('className="line-item-sheet-head"'));
check("sheet has an internal scroll body region", fnSlice.includes('className="line-item-sheet-body"'));
check("sheet has a pinned foot region", fnSlice.includes('className="line-item-sheet-foot"'));
check("Remove action lives in the foot", fnSlice.indexOf('className="line-item-sheet-foot"') < fnSlice.indexOf('className="line-item-remove"'));
check("Save action lives in the foot", fnSlice.indexOf('className="line-item-sheet-foot"') < fnSlice.indexOf('className="primary-button"'));
check("Optional toggle still rendered (behavior unchanged)", fnSlice.includes('className="line-item-optional-row"') && fnSlice.includes("showOptional"));
check("all three editors still open the item sheet", (appTsx.match(/<LineItemEditSheet/g) ?? []).length === 3, String((appTsx.match(/<LineItemEditSheet/g) ?? []).length));

// CSS: extract the exact rule blocks (anchored so `.line-item-sheet label`
// et al. can't satisfy them).
const rule = (selector: string) => {
  const m = css.match(new RegExp(`\\${selector} \\{([^}]*)\\}`));
  return m?.[1] ?? "";
};
const sheetRule = rule(".line-item-sheet");
check("sheet frame does not scroll as a whole", sheetRule.includes("overflow: hidden"), sheetRule.trim());
check("sheet height is capped in dvh units", /max-height:\s*min\(88dvh/.test(sheetRule), sheetRule.trim());
check("sheet rows are head / scroll body / foot", sheetRule.includes("grid-template-rows: auto minmax(0, 1fr) auto"), sheetRule.trim());
const bodyRule = rule(".line-item-sheet-body");
check("sheet body scrolls internally (overflow-y: auto)", bodyRule.includes("overflow-y: auto"), bodyRule.trim());
check("sheet body can actually shrink (min-height: 0)", bodyRule.includes("min-height: 0"), bodyRule.trim());
check("sheet body traps overscroll", bodyRule.includes("overscroll-behavior: contain"), bodyRule.trim());
const footRule = rule(".line-item-sheet-foot");
check("sheet foot rule exists", footRule.includes("display: grid"), footRule.trim());
check("description textarea cap is in dvh", /\.line-item-sheet textarea \{[^}]*max-height: 38dvh/.test(css));

console.log(failures === 0 ? "\nALL LINE-ITEM SHEET SCROLL CHECKS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
