// Estimate create landing (Danny 2026-11-09) — his report:
//   "After saving an estimate it drops me off in the invoices page. It
//   should drop me off in the estimates page and an animated glow around
//   the saved estimate should happen for a fraction of time like we
//   discussed previously."
// The Nov 7 build shipped the landing + glow for invoice creation only
// and deliberately left estimates out; Danny reversed that after saving
// an estimate and landing on the hub's Invoices tab. Full parity now:
//   - QuoteBuilder's save reports the created id via onSaved(id) and
//     awaits the ["quotes"] invalidation before navigating, so the
//     landing list already holds the new estimate.
//   - The shell lands on the Estimates list carrying the id: pop-with-
//     rewrite when the list (hub or standalone Estimates) is under the
//     form, replaceScreen to the hub otherwise. A close without a save
//     keeps the old pop/replace shape and carries no highlight.
//   - The hub flips to its Estimates tab, takes the id into glow state,
//     strips it from its screen entry at once (no replay), applies the
//     .invoice-row-glow class to the matching estimate row only, and
//     clears the glow on a ~1.7s timer. The standalone Estimates list
//     does the same minus the tab flip.
// Run from app/:  bun estimate-create-landing.behavior.test.ts
import { readFile } from "node:fs/promises";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok - ${name}`);
  else { failures++; console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`); }
}

const APP = await readFile("client/src/App.tsx", "utf8");
const CSS = await readFile("client/src/theme.css", "utf8");

function sliceFrom(src: string, marker: string, length: number): string {
  const i = src.indexOf(marker);
  return i < 0 ? "" : src.slice(i, i + length);
}

// --- The screen entries can carry the highlight -------------------------------
check("quotes screen entry carries an optional highlightQuoteId",
  APP.includes('{ name: "quotes"; highlightQuoteId?: number }'));
check("invoices (hub) screen entry carries an optional highlightQuoteId",
  APP.includes('{ name: "invoices"; highlightInvoiceId?: number; highlightQuoteId?: number }'));

// --- The shell landing helper ---------------------------------------------------
const landBlock = sliceFrom(APP, "const closeQuoteBuilder = (quoteId?: number)", 1900);
check("closeQuoteBuilder takes an optional quote id", landBlock.length > 0);
check("plain close (no id) keeps the old pop-to-list-below shape",
  landBlock.includes('if (below && (below.name === "quotes" || below.name === "invoices")) popScreenStack();'));
check("plain close from elsewhere still swaps the form for the quotes list",
  landBlock.includes('else replaceScreen({ name: "quotes" });'));
check("create-save rewrites the hub entry under the form with the highlight",
  landBlock.includes('{ name: "invoices", highlightQuoteId: quoteId }'));
check("create-save rewrites the standalone estimates entry the same way",
  landBlock.includes('{ name: "quotes", highlightQuoteId: quoteId }'));
check("create-save from anywhere else swaps the form for the hub",
  landBlock.includes('replaceScreen({ name: "invoices", highlightQuoteId: quoteId })'));
check("create-save landing scrolls to the top, where the newest estimate sits",
  landBlock.includes('requestNavigationScroll({ mode: "top" })'));

// --- The consume helper (no replay) ---------------------------------------------
const consumeBlock = sliceFrom(APP, "const consumeQuoteHighlight = () => {", 800);
check("consumeQuoteHighlight exists", consumeBlock.length > 0);
check("consume acts on hub or quotes entries still carrying a highlight",
  consumeBlock.includes('top.name !== "invoices" && top.name !== "quotes"') && consumeBlock.includes("top.highlightQuoteId == null"));
check("consume strips the id from the entry",
  consumeBlock.includes("const nextStack: Screen[] = [...stack.slice(0, -1), clean];"));

// --- The builder reports the created id ------------------------------------------
const saveBlock = sliceFrom(APP, "onSuccess: async (saved) => {", 1500);
check("quote save onSuccess receives the saved document", saveBlock.length > 0);
check("quote save awaits the quotes invalidation before navigating",
  saveBlock.includes('await client.invalidateQueries({ queryKey: ["quotes"] })'));
check("quote save navigates with the created id",
  saveBlock.includes("navigateAfterClose(saved.id)"));
check("builder onSaved signature carries the optional id",
  APP.includes("onSaved?: (quoteId?: number) => void;"));

// --- The hub consumes it: Estimates tab + glow ------------------------------------
// Slice from the hub component itself (QuotesScreen holds a glowQuoteId
// state too and sits earlier in the file).
const hubStart = APP.indexOf("function InvoicesScreen");
const hubBlock = hubStart < 0 ? "" : APP.slice(hubStart, hubStart + 6500);
check("hub holds estimate glow state", hubBlock.includes("const [glowQuoteId, setGlowQuoteId]"));
const hubGlowAt = APP.indexOf("if (highlightQuoteId == null) return;", hubStart);
const hubGlowBlock = hubGlowAt < 0 ? "" : APP.slice(hubGlowAt, hubGlowAt + 700);
check("hub flips to the Estimates tab when a quote highlight arrives",
  hubGlowBlock.includes('setTab("estimates")') && hubGlowBlock.includes("setGlowQuoteId(highlightQuoteId)"));
check("hub consumes the highlight through the ref-stable callback",
  hubGlowBlock.includes("consumeQuoteHighlightRef.current?.()"));
check("hub clears the estimate glow on a ~1.7s timer",
  hubBlock.includes("window.setTimeout(() => setGlowQuoteId(null), 1700)"));
check("only the matching estimate row gets the glow class",
  APP.includes('${glowQuoteId === quote.id ? " invoice-row-glow" : ""}'));

// --- The standalone Estimates list consumes it too ---------------------------------
const listAt = APP.indexOf("quote-card-compact");
check("standalone estimates card gets the glow class on the matching id",
  listAt > -1 && APP.slice(Math.max(0, listAt - 200), listAt + 60).includes("glowQuoteId === q.id"));

// --- The glow CSS -------------------------------------------------------------------
check("estimate rows in the hub share the invoice glow animation",
  CSS.includes(".doc-list-v2 .document-tap.ck-est-row.invoice-row-glow { animation: invoice-row-glow 1.5s ease-out; }"));
check("standalone estimate cards share the invoice glow animation",
  CSS.includes(".quote-card-compact.invoice-row-glow { animation: invoice-row-glow 1.5s ease-out; }"));

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
if (failures > 0) process.exit(1);
