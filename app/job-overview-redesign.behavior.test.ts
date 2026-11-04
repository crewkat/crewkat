// Danny 2026-10-11: job Overview redesign — six points from his screenshots:
// 1. compact 1-2-3-4 stepper, 2. Marketplace-style tab bar, 3. merged
// expandable client card, 4. full-width portal panel, 5. premium photo
// completeness, 6. distinct colored section icons. Plus Docs-tab expansion:
// tappable document rows with View / Send / Delete (Edit omitted —
// DocumentSigner has no existing-document load path).
// Wave A (Danny approved 2026-11-03) supersedes points 5 and 6: photo
// completeness is now an Overview strip with stage COUNTS + a stages
// card in Photos (no ring hero), and the accordion hub (with its toned
// section icons) is deleted — sections live in their tabs and the five
// tab-less tools form a compact grid. Points 5/6 below pin the Wave A
// shapes; the other points are unchanged.
// Run from app/:  bun job-overview-redesign.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");
const ACTIONS = readFileSync(join(import.meta.dir, "server/src/actions.ts"), "utf8");

describe("Point 1: compact stepper", () => {
  test("flow dots are compact (22px)", () => {
    expect(CSS).toMatch(/\.flow-dot\s*\{[^}]*width:\s*22px/);
  });
  test("stepper vertical padding reduced", () => {
    expect(CSS).toMatch(/\.flow-stepper\s*\{[^}]*padding:\s*4px 4px 0/);
  });
});

describe("Point 2: Marketplace-style tabs", () => {
  test("workspace tabs use the underline bar style, not pills", () => {
    expect(CSS).toMatch(/\.workspace-tabs\s*\{[^}]*border-bottom:/);
    expect(CSS).toMatch(/\.workspace-tabs button\.active::after/);
    expect(CSS).not.toMatch(/\.workspace-tabs button\s*\{[^}]*border-radius:\s*999px/);
  });
});

describe("Point 3: merged expandable client card", () => {
  test("single job-client-card with expand toggle", () => {
    expect(APP).toContain("job-client-card");
    expect(APP).toContain("clientCardOpen");
    expect(APP).toContain("setClientCardOpen");
    expect(APP).toContain('aria-expanded={clientCardOpen}');
  });
  test("old separate cards are gone", () => {
    expect(APP).not.toContain("job-client-selector");
    expect(APP).not.toContain('className="job-summary"');
  });
  test("client change + address + edit actions preserved", () => {
    expect(APP).toContain('setActiveJobSheet("client")');
    expect(APP).toContain('setActiveJobSheet("address")');
    expect(APP).toContain("setEditing(!editing)");
  });
});

describe("Point 4: full-width portal panel", () => {
  test("portal-owner has no horizontal margin", () => {
    expect(CSS).toMatch(/\.portal-owner\s*\{\s*margin:\s*12px 0\s*\}/);
  });
  test("PortalOwnerPanel still mounted (internals untouched)", () => {
    expect(APP).toContain("<PortalOwnerPanel lang={lang} jobId={jobId} />");
  });
});

describe("Point 5: photo completeness (Wave A shape)", () => {
  test("Overview carries a photos strip with stage counts, deep-linking to Photos", () => {
    expect(APP).toContain('className="job-photos-strip"');
    expect(APP).toContain("stage-count-chip");
    expect(APP).toContain("Stages for the proof packet");
    expect(APP).toContain('onClick={() => setWsTab("photos")}');
  });
  test("stages card markup present in the Photos tab workflow", () => {
    expect(APP).toContain("completion-v2");
    expect(APP).toContain("stage-chips");
    expect(APP).toContain("photos-alert-line");
    expect(APP).toContain("photos are still needed for the proof packet");
  });
  test("all controls preserved: stages, override note, mark complete, reopen, error", () => {
    expect(APP).toContain("requirements.mutate");
    expect(APP).toContain("setCompletionNote");
    expect(APP).toContain("complete.mutate()");
    expect(APP).toContain("reopen.mutate()");
    expect(APP).toContain("completionError");
  });
});

describe("Point 6: job hub replaced by tabs + tools grid (Wave A)", () => {
  test("the accordion hub and its toned sections are gone from the job screen", () => {
    expect(APP).not.toContain("job-accordion job-hub");
    expect(APP).not.toContain("<AccordionSection");
    expect(APP).not.toContain('? "Más herramientas" : "More job tools"');
  });
  test("the five tab-less tools form the Overview tools grid", () => {
    expect(APP).toContain("job-tools-grid");
    for (const mode of ["time", "crew", "punch", "subcontractors", "voice"]) {
      expect(APP).toContain(`name: "tool", jobId, mode: "${mode}"`);
    }
  });
});

describe("Docs tab expansion: tappable rows", () => {
  test("document rows are buttons opening an action sheet", () => {
    expect(APP).toContain('className="doc-row"');
    expect(APP).toContain("setSelected(d)");
  });
  test("view modal shows title, body, signatures", () => {
    expect(APP).toContain("doc-view-body");
    expect(APP).toContain("viewing.bodyText");
    expect(APP).toContain("viewing.signerName");
  });
  test("send uses createDocumentLink + navigator.share", () => {
    expect(APP).toContain("api.createDocumentLink({ kind: d.kind, id: d.id })");
    expect(APP).toContain("navigator.share");
  });
  test("deleteDocument server action exists with link cleanup", () => {
    expect(ACTIONS).toContain("deleteDocument: defineAction");
    expect(ACTIONS).toMatch(/deleteDocument[\s\S]{0,800}documentLinks/);
    expect(ACTIONS).toContain('"deleteDocument"');
  });
  test("delete has a confirm step", () => {
    expect(APP).toContain("setConfirmingDelete");
    expect(APP).toContain("Delete document?");
  });
  test("new contract / change order buttons preserved", () => {
    expect(APP).toContain("New contract");
    expect(APP).toContain("New change order");
  });
});
