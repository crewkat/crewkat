// Danny 2026-10-24: job-screens overhaul — compact chrome, honest
// Financials with the approved color key, photos-first completion,
// grouped appointment form, portal feature card + portal page color.
// Wave A (Danny approved 2026-11-03) supersedes the Financials shape:
// Profitability + Money summary + Contract merge into ONE Money card,
// the not-linked alarm becomes one quiet link line, and the contract
// progress bar lives only on the Overview strip. The Financials pins
// below assert the Wave A shapes; the honest-state principle (linkage,
// never the $0) is unchanged.
// Run from app/:  bun job-screens-overhaul.behavior.test.ts
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

describe("Financials: honest state keys off estimate linkage, not the $0", () => {
  const fin = slice("function WorkspaceFinancialsPanel", "function BeforeAfterSlider");
  test("linkage is derived from quotes linked to the job", () => {
    expect(fin).toContain("const hasLinkedEstimate = quotes.some((q) => q.jobId === jobId);");
  });
  test("no-estimate state is one quiet link line (Wave A — no alarm chip, no paragraph)", () => {
    expect(fin).toContain("fin-link-line");
    expect(fin).toContain("No estimate linked yet — margin needs it.");
    expect(fin).toContain("Aún no hay un estimado vinculado");
    expect(fin).toContain('onOpenJobSheet?.("estimates")');
    expect(fin).not.toContain("fin-chip-warn");
    expect(fin).not.toContain("fin-honest-note");
    expect(fin).not.toContain("Estimate not linked");
  });
  test("with-estimate state still shows real Profit and Margin %", () => {
    expect(fin).toContain("hasLinkedEstimate && p ?");
    expect(fin).toContain("usd(p.profit)");
    expect(fin).toContain("p.margin.toFixed(1)");
  });
  test("contract summary is threaded from getJob into the panel", () => {
    expect(APP).toContain("contractSummary={query.data.contractSummary}");
    expect(fin).toContain("contractSummary");
  });
});

describe("Financials: one Money card + Budget & costs (Wave A)", () => {
  const fin = slice("function WorkspaceFinancialsPanel", "function BeforeAfterSlider");
  test("the merged cards exist (the four old cards are gone)", () => {
    expect(fin).toContain("fin-card fin-money-card");
    expect(fin).toContain("fin-card fin-budget-card");
    expect(fin).toContain("fin-slim-card");
    expect(fin).not.toContain("fin-card fin-profit");
    expect(fin).not.toContain("fin-card fin-contract-card");
  });
  test("the Money card shows each figure once, as rows", () => {
    for (const row of ["money-row", "t.contractSum", "t.invoiced", "t.paid", "t.balanceDue", "t.costsSoFar", "t.margin"]) {
      expect(fin).toContain(row);
    }
    // Invoiced is derived once from the job's invoices, never re-summed per card.
    expect(fin).toContain("const totalInvoiced = mine.reduce");
    expect(fin).toContain("const totalPaid = mine.reduce");
  });
  test("CSS maps every tone to the exact mockup hex", () => {
    const tones: Array<[string, string]> = [
      ["f-invoiced", "#2f5fb3"],
      ["f-paid", "#1e7a46"],
      ["f-owed", "#b45309"],
      ["f-costs", "#b3392e"],
      ["f-deposit", "#0e7490"],
      ["f-budget", "#7c4d8f"],
      ["f-contract", "#0b1f4d"],
      ["f-co", "#c2570a"],
      ["f-subs", "#5b5ea6"],
    ];
    for (const [cls, hex] of tones) {
      expect(CSS).toMatch(new RegExp(`\\.${cls}\\s*\\{\\s*--fc:\\s*${hex};`));
    }
  });
  test("contract progress bar lives only on the Overview strip (not duplicated in Financials)", () => {
    expect(fin).not.toContain("fin-progress");
    expect(APP).toContain("ps-progress");
  });
});

describe("Overview: contract-progress money strip + change-orders row", () => {
  test("strip shows Contract / Invoiced / Balance with a progress bar", () => {
    expect(APP).toContain("ps-contract");
    expect(APP).toContain("ps-invoiced");
    expect(APP).toContain("ps-balance");
    expect(APP).toContain("ps-progress");
    expect(APP).toContain("overviewContractBase");
  });
  test("change-orders slim row jumps to the Docs tab", () => {
    expect(APP).toContain("job-co-row");
    expect(APP).toContain("pendingChangeOrders");
  });
  test("quick rail actions are compact (38px)", () => {
    expect(CSS).toMatch(/\.quick-rail-action\s*\{[^}]*min-height:\s*38px/);
  });
});

describe("Chrome: slim step bar + slim tab row", () => {
  test("done steps are a bare orange check in a 16px box", () => {
    expect(CSS).toMatch(/\.flow-dot\s*\{[^}]*width:\s*16px/);
    expect(CSS).toMatch(/\.flow-step\.done \.flow-dot\s*\{[^}]*color:\s*var\(--accent\)/);
  });
  test("tabs slim down to a 34px row", () => {
    expect(CSS).toMatch(/\.workspace-tabs button\s*\{[^}]*min-height:\s*34px/);
    expect(CSS).toMatch(/\.workspace-tabs button\s*\{[^}]*font-size:\s*12\.5px/);
  });
});

describe("Photos: slim status line, conditional override field", () => {
  const wf = slice("function JobCompletionWorkflow", "function FlowStepper");
  test("ring hero replaced by stage chips + one slim alert line (Wave A)", () => {
    expect(wf).toContain("completion-status-line");
    expect(wf).not.toContain("completion-hero");
    expect(wf).toContain("All stages covered");
    expect(wf).toContain("Todas las etapas cubiertas");
    expect(wf).toContain("stage-chips");
    expect(wf).toContain("photos-alert-line");
    expect(wf).toContain("photos are still needed for the proof packet");
    expect(wf).toContain("para el paquete de evidencia");
  });
  test("status is driven by covered stages passed from the job photos", () => {
    expect(wf).toContain("coveredStages");
    expect(wf).toContain("missingRequired");
    expect(APP).toContain("coveredStages={");
  });
  test("override field renders only when a required stage is missing", () => {
    expect(wf).toContain("missingRequired.length > 0 || completionError");
    expect(wf).toContain("Override note if required photos are missing");
  });
});

describe("Portal: prominent feature card on the Overview", () => {
  const panel = slice("function PortalOwnerPanel", "type ClientDoc");
  test("navy feature head with the Crewkat C mark and a status pill", () => {
    expect(panel).toContain("portal-feature");
    expect(panel).toContain("portal-feature-head");
    expect(panel).toContain("portal-feature-mark");
    expect(panel).toContain("crewkatC");
    expect(panel).toContain("portal-status-pill");
  });
  test("status tiers: not sent / sent / opened / contract signed", () => {
    expect(panel).toContain("Link not sent");
    expect(panel).toContain("Enlace no enviado");
    expect(panel).toContain("Contract signed");
    expect(panel).toContain("Contrato firmado");
    expect(panel).toContain("link.viewCount > 0");
    expect(panel).toContain("doc.clientSignedAt");
  });
  test("existing actions are all still there (share = resend, copy, rotate, revoke)", () => {
    expect(panel).toContain("shareVia");
    expect(panel).toContain("copyText(shareUrl)");
    expect(panel).toContain("rotate.mutate()");
    expect(panel).toContain("revoke.mutate()");
    expect(panel).toContain("create.mutate()");
  });
  test("panel dropdown: navy head is the toggle, body rests hidden (Danny 2026-10-24, later direction)", () => {
    // Supersedes the morning's always-open shape: Danny's live review
    // made the card a tap-to-dropdown. Still a button toggle, never a
    // <details> element; the machinery stays mounted (hidden) so an
    // issued one-time code survives a collapse. Full contract pinned
    // in job-cards-dropdown.behavior.test.ts.
    expect(panel).not.toContain("<details");
    expect(panel).toContain("portal-feature-toggle");
    expect(panel).toContain("hidden={!open}");
    expect(APP).toContain("<PortalOwnerPanel lang={lang} jobId={jobId} />");
  });
  test("feature card CSS: navy gradient head + pill colors", () => {
    expect(CSS).toMatch(/\.portal-feature-head\s*\{[^}]*linear-gradient\(120deg, #0b1f4d/);
    expect(CSS).toMatch(/\.portal-status-pill\.is-signed\s*\{[^}]*background:\s*#1e7a46/);
    expect(CSS).toMatch(/\.portal-status-pill\.is-opened\s*\{[^}]*background:\s*#2f5fb3/);
    expect(CSS).toMatch(/\.portal-status-pill\.is-sent\s*\{[^}]*background:\s*#c2570a/);
  });
});

describe("Client portal page: same color system, company stays the brand", () => {
  test("section cards carry accent classes", () => {
    for (const cls of ["pc-docs", "pc-photos", "pc-files", "pc-visits", "pc-messages", "pc-attention", "pc-estimates", "pc-invoices"]) {
      expect(APP).toContain(`portal-v2-card ${cls}`);
      expect(CSS).toContain(`.portal-v2-card.${cls}`);
    }
  });
  test("hero is a navy band; company brand header untouched above it", () => {
    expect(CSS).toMatch(/\.portal-v2-hero\s*\{[^}]*linear-gradient\(135deg, #0b1f4d/);
    expect(APP).toContain('className="portal-v2-brand"');
    expect(APP).toContain("company.logoUrl");
  });
  test("section headings get the colored marker; doc rows keep the official sheet classes", () => {
    expect(CSS).toMatch(/\.portal-v2-card > h2::before\s*\{[^}]*background:\s*var\(--pc\)/);
    expect(APP).toContain("portal-v2-co-sheet");
    expect(APP).toContain("portal-v2-doc-close");
  });
});

describe("Appointment form: grouped card, client toggle, switch, sticky bar", () => {
  test("toolbar collapses to one row", () => {
    expect(APP).toContain("calendar-toolbar appt-toolbar");
    expect(CSS).toMatch(/\.calendar-toolbar\.appt-toolbar\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto/);
  });
  test("client Existing/New toggle swaps picker vs name+phone pair", () => {
    expect(APP).toContain("appt-client-toggle");
    expect(APP).toContain("apptClientMode");
    expect(APP).toContain('setApptClientMode("existing")');
    expect(APP).toContain('setApptClientMode("new")');
  });
  test("forecast is a slim switch row and notes shrink to 2 lines", () => {
    expect(APP).toContain("appt-switch-row");
    expect(APP).toContain("checked={appointment.exteriorWork}");
    expect(APP).toMatch(/rows=\{2\}\s+value=\{appointment\.notes\}/);
  });
  test("Cancel/Save live in a sticky bottom bar", () => {
    expect(APP).toContain("appt-form-bar");
    expect(CSS).toMatch(/\.appt-form-bar\s*\{[^}]*position:\s*sticky/);
  });
});
