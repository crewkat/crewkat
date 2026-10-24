// Danny 2026-10-24 (later the same day, live review of the overhaul):
// A. Financials tab form modules (Client selections, Daily log,
//    Internal notes, Payment schedule) → tap-to-expand, collapsed by
//    default. Header row = colored dot + title + count + chevron;
//    body stays mounted (hidden) so in-progress form input survives.
// B. Overview Client portal card → tap-to-dropdown: the navy feature
//    head (C mark + title + live status pill + chevron) is the whole
//    card at rest; the link panel drops down on tap, still mounted.
// C. FlowStepper coherence: exactly ONE "current" step (the first
//    unachieved stage after the furthest reached), no tint halo,
//    connectors span the gaps as centered hairlines, one rule set.
// Run from app/:  bun job-cards-dropdown.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

function slice(from: string, to: string): string {
  const start = APP.indexOf(from);
  expect(start).toBeGreaterThan(-1);
  const end = APP.indexOf(to, start);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
}

describe("A. FinModuleShell: one collapsible shell for the Financials form modules", () => {
  const shell = slice("function FinModuleShell", "function FinSelectionsSection");
  test("collapsed by default, header button toggles with aria-expanded", () => {
    expect(shell).toContain("const [open, setOpen] = useState(false);");
    expect(shell).toContain('className="fin-module-trigger"');
    expect(shell).toContain("aria-expanded={open}");
    expect(shell).toContain("setOpen((value) => !value)");
  });
  test("header keeps the settled identity: colored dot + title + count bubble + chevron", () => {
    expect(shell).toContain("pa-chart-dot");
    expect(shell).toContain("fin-module-count");
    expect(shell).toContain("fin-module-chevron");
    expect(shell).toContain("fin-collapsible");
  });
  test("body stays mounted via hidden (form input survives collapse)", () => {
    expect(shell).toContain('className="fin-module-body" hidden={!open}');
    expect(CSS).toMatch(/\.fin-module-body\[hidden\]\s*\{\s*display:\s*none/);
    expect(CSS).toMatch(/\.fin-module-chevron\.open\s*\{\s*transform:\s*rotate\(90deg\)/);
  });
});

describe("A. All four form modules converted, with counts from data already in hand", () => {
  const cases: Array<[string, string, string, string]> = [
    // section fn, dot, title EN, count expression
    ["function FinSelectionsSection", "#a855f7", "Client selections", "data.selections.length"],
    ["function FinDailyLogSection", "#22c55e", "Daily log", "data.dailyLogs.length"],
    ["function FinPrivateNotesSection", "#64748b", "Internal notes", "data.internalNotes.length"],
    ["function FinPaymentsSection", "#14b8a6", "Payment schedule", "data.milestones.length"],
  ];
  for (const [fn, dot, title, countExpr] of cases) {
    test(`${title} renders through FinModuleShell`, () => {
      const start = APP.indexOf(fn);
      expect(start).toBeGreaterThan(-1);
      const body = APP.slice(start, start + 2600);
      expect(body).toContain("<FinModuleShell");
      expect(body).toContain(`dot="${dot}"`);
      expect(body).toContain(title);
      expect(body).toContain(`count={${countExpr}}`);
    });
  }
  test("ES titles ride along (parity for the converted headers)", () => {
    expect(APP).toContain("Selecciones del cliente");
    expect(APP).toContain("Registro diario");
    expect(APP).toContain("Notas internas");
    expect(APP).toContain("Programa de pagos");
  });
  test("selections keep their Share summary header action", () => {
    const sel = slice("function FinSelectionsSection", "function FinDailyLogSection");
    expect(sel).toContain("headerAction");
    expect(sel).toContain("shareSelections");
    expect(sel).toContain("Share summary");
    expect(sel).toContain("Compartir resumen");
  });
  test("no Fin module still renders the old always-open section root", () => {
    const region = slice("function FinSelectionsSection", "function WorkspaceFinancialsPanel");
    expect(region).not.toContain('<section className="pa-chart-section fin-module">');
  });
});

describe("B. Portal card: navy head is the dropdown toggle", () => {
  const panel = slice("function PortalOwnerPanel", "type ClientDoc");
  test("collapsed by default; head is a button with aria-expanded", () => {
    expect(panel).toContain("const [open, setOpen] = useState(false);");
    expect(panel).toContain("portal-feature-head portal-feature-toggle");
    expect(panel).toContain("aria-expanded={open}");
    expect(panel).toContain("setOpen((value) => !value)");
  });
  test("collapsed card = mark + title + live status pill + chevron, pill ahead of the body", () => {
    expect(panel).toContain("portal-feature-mark");
    expect(panel).toContain("portal-status-pill");
    expect(panel).toContain("portal-feature-chevron");
    expect(panel.indexOf("portal-status-pill")).toBeLessThan(panel.indexOf("portal-link-panel"));
  });
  test("body stays mounted via hidden (issued one-time code survives collapse)", () => {
    expect(panel).toContain('className="compact-form portal-link-panel" hidden={!open}');
    expect(CSS).toMatch(/\.portal-link-panel\[hidden\]\s*\{\s*display:\s*none/);
    expect(CSS).toMatch(/\.portal-feature-chevron\.open\s*\{\s*transform:\s*rotate\(90deg\)/);
  });
  test("every existing action and state preserved in the dropdown", () => {
    for (const pin of [
      "create.mutate()", "rotate.mutate()", "revoke.mutate()",
      "shareVia", "copyText(shareUrl)", "issuedToken", "expiryDays",
      "portal-issued-code", "neverConfirmed",
    ]) {
      expect(panel).toContain(pin);
    }
  });
});

describe("C. FlowStepper derivation: exactly one current, skipped stages read todo", () => {
  const flow = slice("const flowQuote", "const closeJobSheet");
  test("states derive from achieved stages + furthest-reached frontier", () => {
    expect(flow).toContain("const flowAchieved = [");
    expect(flow).toContain("const flowFurthest = flowAchieved.lastIndexOf(true);");
    expect(flow).toContain("flowCurrent");
    expect(flow).toContain("const flowState = (idx: number): FlowStepState =>");
  });
  test("the old hardcoded double-current is gone from the job derivation", () => {
    expect(flow).not.toContain('state: "current" as FlowStepState');
    expect(flow).toContain("state: flowState(0)");
    expect(flow).toContain("state: flowState(1)");
    expect(flow).toContain("state: flowState(2)");
    expect(flow).toContain("state: flowState(3)");
  });
  test("achieved keys off artifacts: quote, invoice, paid invoice", () => {
    expect(flow).toContain("!!(flowQuote || flowInvoice)");
    expect(flow).toContain("!!flowQuote");
    expect(flow).toContain("!!flowInvoice");
    expect(flow).toContain('flowInvoice?.status === "paid"');
  });
  test("step taps unchanged (preview / create / convert)", () => {
    expect(flow).toContain('setScreen({ name: "quotePreview", quoteId: flowQuote.id })');
    expect(flow).toContain('setScreen({ name: "quoteNew", jobId })');
    expect(flow).toContain("convertFlowQuote.mutate(flowQuote.id)");
    expect(flow).toContain('setScreen({ name: "invoicePreview", invoiceId: flowInvoice.id })');
  });
});

describe("C. Stepper CSS: one coherent rule set", () => {
  const overhaul = CSS.slice(CSS.indexOf("Job screens overhaul (Danny 2026-10-24)"));
  test("current step is a clean ink box — halo removed", () => {
    expect(overhaul).toMatch(/\.flow-step\.current \.flow-dot\s*\{[^}]*box-shadow:\s*none/);
  });
  test("scoped detail-page overrides are gone (they fought the slim set)", () => {
    expect(CSS).not.toContain(".financial-detail-page .flow-dot");
    expect(CSS).not.toContain(".financial-detail-page .flow-step.current");
    expect(CSS).not.toContain(".detail-page .flow-dot");
    expect(CSS).not.toContain(".detail-page .flow-step.current");
    expect(CSS).not.toContain(".detail-page .flow-link");
  });
  test("connectors span the gaps evenly as centered hairlines", () => {
    expect(overhaul).toMatch(/\.flow-link\s*\{[^}]*flex:\s*1 1 auto/);
    expect(overhaul).toMatch(/\.flow-link\s*\{[^}]*height:\s*1\.5px/);
    expect(overhaul).toMatch(/\.flow-link\s*\{[^}]*align-self:\s*center/);
  });
  test("steps size to content; label + box centered as one row", () => {
    expect(overhaul).toMatch(/\.flow-step\s*\{[^}]*flex:\s*0 1 auto/);
    expect(overhaul).toMatch(/\.flow-stepper\s*\{[^}]*align-items:\s*center/);
    expect(overhaul).toMatch(/\.flow-step\s*\{[^}]*flex-direction:\s*row/);
  });
  test("done still reads as a bare orange check in the 16px box", () => {
    expect(overhaul).toMatch(/\.flow-dot\s*\{[^}]*width:\s*16px/);
    expect(overhaul).toMatch(/\.flow-step\.done \.flow-dot\s*\{[^}]*color:\s*var\(--accent\)/);
  });
});
