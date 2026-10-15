// Invoices tab restore fix (2026-10-14) — Danny's report:
//   Inside an invoice/estimate → Back → hub (correct) → wander to Home or
//   Marketplace → tap Invoices → thrown back INTO the invoice.
// The "Build 0.3" restore (openRoot rebuilds [{invoices}, remembered]) is a
// feature Danny wants to KEEP for the "left the tab mid-document" case; the
// bug was that lastFinancialScreenRef was never cleared when he backed out
// to the hub, so the stale document kept resurrecting.
// Fix: a watcher on the top of the screen stack clears the memory (ref +
// sessionStorage) whenever a document list — the Invoices hub ("invoices")
// or the standalone Estimates list ("quotes") — becomes the current screen.
// Run from app/:  bun invoices-tab-restore.behavior.test.ts
import { readFile } from "node:fs/promises";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok - ${name}`);
  else { failures++; console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`); }
}

const APP = await readFile("client/src/App.tsx", "utf8");

function sliceFrom(marker: string, length: number): string {
  const i = APP.indexOf(marker);
  return i < 0 ? "" : APP.slice(i, i + length);
}

// --- The memory write (feature) is intact -----------------------------------
const writeBlock = sliceFrom('if (destination.name === "invoicePreview" || destination.name === "quotePreview")', 400);
check("setScreen still remembers invoice/quote previews", writeBlock.length > 0);
check("setScreen writes the ref", writeBlock.includes("lastFinancialScreenRef.current = destination"));
check("setScreen persists to sessionStorage", writeBlock.includes('sessionStorage.setItem("crewkat-last-financial"'));

// --- The restore in openRoot (feature) is intact ----------------------------
const openRootBlock = sliceFrom("const openRoot = (tab: RootTab)", 700);
check("openRoot still restores a remembered financial screen",
  openRootBlock.includes('remembered ? [{ name: "invoices" }, remembered] : [{ name: tab }]'));
check("openRoot restore is gated to leaving a non-invoices root",
  openRootBlock.includes('tab === "invoices" && rootTabFor(screen) !== "invoices" ? lastFinancialScreenRef.current : null'));

// --- The clear (the fix) ------------------------------------------------------
const clearBlock = sliceFrom("Invoices restore fix (2026-10-14)", 1100);
check("clear watcher exists", clearBlock.length > 0);
check("clear watcher is an effect keyed on the top screen name",
  clearBlock.includes("useEffect(() => {") && clearBlock.includes("}, [screen.name]);"));
check("clear watcher fires on the Invoices hub", clearBlock.includes('screen.name !== "invoices"'));
check("clear watcher fires on the standalone Estimates list", clearBlock.includes('screen.name !== "quotes"'));
check("clear watcher empties the ref", clearBlock.includes("lastFinancialScreenRef.current = null"));
check("clear watcher removes the sessionStorage copy",
  clearBlock.includes('sessionStorage.removeItem("crewkat-last-financial")'));
check("clear watcher never fires on a document screen",
  !clearBlock.includes("invoicePreview") && !clearBlock.includes("quotePreview"));

// --- Logic-level simulation of the pinned rules ------------------------------
// A minimal model of the three source rules asserted above:
//   view(preview)  -> memory = screen            (setScreen)
//   top becomes a document list -> memory = null (the new watcher)
//   openRoot(tab)  -> stack = remembered ? [invoices, remembered] : [tab]
// It exists to assert the stack composition of Danny's two flows end to end;
// if the App.tsx rules change shape, the source checks above fail first.
type SimScreen = { name: string; id?: number };
const rootTabForSim = (s: SimScreen): string =>
  s.name === "today" ? "today"
  : ["invoices", "invoicePreview", "quotes", "quotePreview"].includes(s.name) ? "invoices"
  : s.name;
function simulate(events: Array<(sim: Sim) => void>): Sim {
  const sim = new Sim();
  for (const e of events) e(sim);
  return sim;
}
class Sim {
  stack: SimScreen[] = [{ name: "invoices" }];
  memory: SimScreen | null = null;
  top(): SimScreen { return this.stack[this.stack.length - 1]; }
  watch() { if (this.top().name === "invoices" || this.top().name === "quotes") this.memory = null; }
  view(s: SimScreen) {
    this.stack.push(s);
    if (s.name === "invoicePreview" || s.name === "quotePreview") this.memory = s;
    this.watch();
  }
  back() { if (this.stack.length > 1) this.stack.pop(); this.watch(); }
  openRoot(tab: string) {
    const remembered = tab === "invoices" && rootTabForSim(this.top()) !== "invoices" ? this.memory : null;
    this.stack = remembered ? [{ name: "invoices" }, remembered] : [{ name: tab }];
    this.watch();
  }
}

// Danny's bug flow: doc -> Back to hub -> Home -> Invoices  ==  HUB
{
  const sim = simulate([
    (s) => s.view({ name: "quotePreview", id: 7 }),
    (s) => s.back(),
    (s) => s.openRoot("today"),
    (s) => s.openRoot("invoices"),
  ]);
  check("bug flow lands on the hub, not the estimate",
    sim.stack.length === 1 && sim.top().name === "invoices", JSON.stringify(sim.stack));
  check("bug flow memory is empty at the end", sim.memory === null);
}
// Variant: doc -> Back to hub -> Marketplace -> Invoices  ==  HUB
{
  const sim = simulate([
    (s) => s.view({ name: "invoicePreview", id: 3 }),
    (s) => s.back(),
    (s) => s.openRoot("marketplace"),
    (s) => s.openRoot("invoices"),
  ]);
  check("bug flow (via Marketplace) lands on the hub",
    sim.stack.length === 1 && sim.top().name === "invoices", JSON.stringify(sim.stack));
}
// Danny's approved flow: doc -> switch tab directly -> Invoices  ==  DOC RESTORED
{
  const sim = simulate([
    (s) => s.view({ name: "invoicePreview", id: 3 }),
    (s) => s.openRoot("today"),
    (s) => s.openRoot("invoices"),
  ]);
  check("mid-document tab switch still restores the invoice",
    sim.stack.length === 2 && sim.top().name === "invoicePreview" && sim.top().id === 3,
    JSON.stringify(sim.stack));
}
// Restored doc, then backed out: the NEXT Invoices tap must land on the hub.
{
  const sim = simulate([
    (s) => s.view({ name: "quotePreview", id: 9 }),
    (s) => s.openRoot("marketplace"),
    (s) => s.openRoot("invoices"), // restored
    (s) => s.back(),               // now on the hub -> memory clears
    (s) => s.openRoot("today"),
    (s) => s.openRoot("invoices"),
  ]);
  check("after restoring then backing out, Invoices lands on the hub",
    sim.stack.length === 1 && sim.top().name === "invoices", JSON.stringify(sim.stack));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
