// Invoice create landing (Danny 2026-11-07) — his report:
//   "When I create a new invoice and hit save it drops me in the home page
//   where I was when I tapped the plus button. But instead it should drop
//   me off inside invoices page and the invoice that was just created
//   should do a little animation like for example glow in orange for a
//   fraction of a second, that way the user sees the just created invoice
//   right away in case they want to open it to send it to a client."
// Fix shape:
//   - InvoiceBuilder's save reports the created id via onCreated; the shell
//     lands on the Invoices & Estimates hub (Invoices tab) carrying the id
//     on the screen entry — pop-with-rewrite when the hub is already under
//     the form, replaceScreen otherwise (closeQuoteBuilder's shape).
//   - The save awaits the ["invoices"] invalidation before navigating, so
//     the landing list already holds the new invoice (the shared query
//     client holds data 30s — crawl round 2's jobs lesson).
//   - The hub takes the id into glow state, strips it from its screen
//     entry at once (no replay on later visits), applies the
//     .invoice-row-glow class to the matching row only, and clears the
//     glow on a ~1.7s timer.
//   - Scope: invoice CREATION only. Editing an existing invoice (the
//     preview's FinancialEditor / updateInvoiceDocument) is untouched, as
//     are jobs and clients. (Estimates were excluded here on Nov 7; Danny
//     extended the same landing + glow to them on 2026-11-09 — see
//     estimate-create-landing.behavior.test.ts.)
// Run from app/:  bun invoice-create-landing.behavior.test.ts
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

// --- The screen entry can carry the highlight --------------------------------
check("invoices screen entry carries an optional highlightInvoiceId",
  APP.includes('{ name: "invoices"; highlightInvoiceId?: number; highlightQuoteId?: number }'));

// --- The shell landing helper --------------------------------------------------
const landBlock = sliceFrom(APP, "const closeInvoiceBuilder = (invoiceId: number)", 1300);
check("closeInvoiceBuilder exists", landBlock.length > 0);
check("landing builds the hub entry with the created id",
  landBlock.includes('{ name: "invoices", highlightInvoiceId: invoiceId }'));
check("from the hub itself it rewrites the entry under the form and pops to it",
  landBlock.includes('below.name === "invoices"') && landBlock.includes("stack.slice(0, -2)"));
check("from anywhere else it swaps the form for the hub (replaceScreen)",
  landBlock.includes('replaceScreen({ name: "invoices", highlightInvoiceId: invoiceId })'));
check("landing scrolls to the top, where the newest invoice sits",
  landBlock.includes('requestNavigationScroll({ mode: "top" })'));

// --- The consume helper (no replay) --------------------------------------------
const consumeBlock = sliceFrom(APP, "const consumeInvoiceHighlight = () => {", 700);
check("consumeInvoiceHighlight exists", consumeBlock.length > 0);
check("consume only acts on a hub entry still carrying a highlight",
  consumeBlock.includes('top.name !== "invoices"') && consumeBlock.includes("top.highlightInvoiceId == null"));
check("consume rewrites the entry without the highlight",
  consumeBlock.includes('[{ name: "invoices" }]') || consumeBlock.includes('{ name: "invoices" }'));
check("consume has no scroll side effects",
  !consumeBlock.includes("requestNavigationScroll"));

// --- Render wiring ---------------------------------------------------------------
check("hub receives the highlight id from its screen entry",
  APP.includes("highlightInvoiceId={screen.highlightInvoiceId}"));
check("hub receives the consume callback",
  APP.includes("onConsumeHighlight={consumeInvoiceHighlight}"));
check("invoice builder receives onCreated wired to the landing helper",
  APP.includes("onCreated={closeInvoiceBuilder}"));

// --- The builder's save path ------------------------------------------------------
check("InvoiceBuilder declares onCreated with the created id",
  APP.includes("onCreated?: (invoiceId: number) => void"));
// Anchor inside InvoiceBuilder specifically: QuoteBuilder's save also
// uses "onSuccess: async (saved)" since the 2026-11-09 parity build and
// sits earlier in the file — slicing from the invoice save's own
// Create-landing comment keeps this block pointed at the invoice save.
const saveBlock = sliceFrom(APP, "/* Create landing (Danny 2026-11-07)", 900);
check("builder save onSuccess receives the save result", saveBlock.length > 0);
check("save awaits the invoices invalidation before navigating",
  saveBlock.includes('await qc.invalidateQueries({ queryKey: ["invoices"] })'));
check("save lands via onCreated with the created id",
  saveBlock.includes("onCreated(saved.id)"));
check("invalidation is awaited before the landing call",
  saveBlock.indexOf('await qc.invalidateQueries({ queryKey: ["invoices"] })') >= 0 &&
  saveBlock.indexOf('await qc.invalidateQueries({ queryKey: ["invoices"] })') < saveBlock.indexOf("onCreated(saved.id)"));
check("builder keeps the plain onBack fallback when no onCreated is wired",
  saveBlock.includes(": onBack()"));

// --- The hub's glow handling -------------------------------------------------------
const glowStateBlock = sliceFrom(APP, "const [glowInvoiceId, setGlowInvoiceId]", 1100);
check("hub keeps a glow id state", glowStateBlock.length > 0);
check("hub takes the highlight into glow state",
  glowStateBlock.includes("setGlowInvoiceId(highlightInvoiceId)"));
check("hub consumes the highlight as it takes it",
  glowStateBlock.includes("consumeHighlightRef.current?.()"));
check("hub clears the glow on a timer",
  glowStateBlock.includes("setTimeout(() => setGlowInvoiceId(null), 1700)"));
check("the hub still opens on the Invoices tab",
  APP.includes('useState<"invoices" | "estimates">("invoices")'));
check("only the matching invoice row gets the glow class",
  APP.includes('${glowInvoiceId === invoice.id ? " invoice-row-glow" : ""}'));

// --- The glow CSS -------------------------------------------------------------------
const glowCss = sliceFrom(CSS, "@keyframes invoice-row-glow", 500);
check("invoice-row-glow keyframes exist", glowCss.length > 0);
check("glow uses the brand orange #f97316",
  glowCss.includes("#f97316") && glowCss.includes("249, 115, 22"));
check("glow animation runs 1.5s on the invoice row",
  CSS.includes(".document-tap.ck-invoice-row.invoice-row-glow { animation: invoice-row-glow 1.5s ease-out; }"));

// --- Scope guards ---------------------------------------------------------------------
// Danny 2026-11-09 reversed the Nov 7 scope call: estimates now land and
// glow with full parity (estimate-create-landing.behavior.test.ts). The
// guards below pin that the INVOICE path itself is unchanged by it and
// that the estimate glow runs on its own highlight channel.
check("invoice landing still uses closeInvoiceBuilder with its own id channel",
  APP.includes("const closeInvoiceBuilder = (invoiceId: number)") && APP.includes("highlightInvoiceId: invoiceId"));
check("estimate glow uses the separate highlightQuoteId channel",
  APP.includes("highlightQuoteId: quoteId") && APP.includes("glowQuoteId === quote.id"));
const editBlock = sliceFrom(APP, "await api.updateInvoiceDocument", 500);
check("existing-invoice editing still saves via updateInvoiceDocument", editBlock.length > 0);
check("the edit-save path does not land or glow",
  !editBlock.includes("onCreated") && !editBlock.includes("highlightInvoiceId") && !editBlock.includes("invoice-row-glow"));

// --- Logic-level simulation of the pinned rules ---------------------------------------
// A minimal model of the three source rules asserted above:
//   create-save -> land(stack, id): below is the hub ? rewrite+pop : replace
//   hub takes id -> glow = id and the entry is stripped at once
//   later visits see a stripped entry -> no glow
type SimScreen = { name: string; highlightInvoiceId?: number };
function land(stack: SimScreen[], id: number): SimScreen[] {
  const below = stack[stack.length - 2];
  if (below && below.name === "invoices") return [...stack.slice(0, -2), { name: "invoices", highlightInvoiceId: id }];
  return [...stack.slice(0, -1), { name: "invoices", highlightInvoiceId: id }];
}
function takeHighlight(top: SimScreen): { glow: number | null; stripped: SimScreen } {
  if (top.name !== "invoices" || top.highlightInvoiceId == null) return { glow: null, stripped: top };
  return { glow: top.highlightInvoiceId, stripped: { name: "invoices" } };
}

// Danny's flow: Home -> + -> New invoice -> Save == hub, new invoice glowing.
{
  const stack = land([{ name: "today" }, { name: "invoiceNew" }], 42);
  check("create from Home lands on the hub",
    stack.length === 2 && stack[1].name === "invoices", JSON.stringify(stack));
  check("the landing entry carries the new invoice id", stack[1].highlightInvoiceId === 42);
  const { glow, stripped } = takeHighlight(stack[1]);
  check("the hub glows exactly the created invoice", glow === 42);
  check("the entry is stripped once taken", stripped.highlightInvoiceId === undefined);
  const again = takeHighlight(stripped);
  check("returning to the list later never replays the glow", again.glow === null);
}
// From the hub itself: New -> Save pops back to the same hub, highlighted.
{
  const stack = land([{ name: "today" }, { name: "invoices" }, { name: "invoiceNew" }], 7);
  check("create from the hub pops back to the hub (no duplicate hub entry)",
    stack.length === 2 && stack[1].name === "invoices" && stack[1].highlightInvoiceId === 7,
    JSON.stringify(stack));
}
// From a job detail: the form is swapped for the hub above the job.
{
  const stack = land([{ name: "today" }, { name: "detail" }, { name: "invoiceNew" }], 9);
  check("create from a job swaps the form for the hub",
    stack.length === 3 && stack[2].name === "invoices" && stack[2].highlightInvoiceId === 9,
    JSON.stringify(stack));
}
// A plain hub visit (no create) never glows.
{
  const { glow } = takeHighlight({ name: "invoices" });
  check("a plain hub visit has no glow", glow === null);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
