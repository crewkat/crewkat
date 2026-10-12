// Danny 2026-10-11: slim the Overview photo card — the full photo-completeness
// workflow moves to the Photos tab; the Overview keeps only a compact summary
// card (ring + % + stages text + "Photos →") that deep-links to the Photos tab.
// Run from app/:  bun photo-card-slim.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

// The Overview's compact summary card block (button.completion-summary-card).
function overviewSummaryBlock(): string {
  const start = APP.indexOf('className="completion-summary-card"');
  expect(start).toBeGreaterThan(-1);
  // The button opens right before its onClick handler (~40 lines above).
  const open = APP.lastIndexOf("{settings?.simpleMode", start);
  const end = APP.indexOf("</button>", start);
  return APP.slice(open, end);
}

describe("Overview: compact summary card only", () => {
  test("summary card exists and deep-links to the photos tab", () => {
    const block = overviewSummaryBlock();
    expect(block).toContain('onClick={() => setWsTab("photos")}');
    expect(block).toContain("ProgressRing");
    expect(block).toContain("completion-summary-cta");
    expect(block).toContain("Photos \\u2192");
    expect(block).toContain("Fotos \\u2192");
  });

  test("summary card carries no workflow controls", () => {
    const block = overviewSummaryBlock();
    expect(block).not.toContain("requirement-checks");
    expect(block).not.toContain("completion-stages");
    expect(block).not.toContain("<textarea");
    expect(block).not.toContain("Mark job complete");
    expect(block).not.toContain("Marcar trabajo completo");
  });

  test("summary card styling exists", () => {
    expect(CSS).toMatch(/\.completion-summary-card\s*\{/);
    expect(CSS).toMatch(/\.completion-summary-cta\s*\{/);
  });
});

describe("Photos tab: full workflow lives here", () => {
  test("JobCompletionWorkflow component has the full workflow", () => {
    const start = APP.indexOf("function JobCompletionWorkflow");
    expect(start).toBeGreaterThan(-1);
    const end = APP.indexOf("function FlowStepper", start);
    const body = APP.slice(start, end);
    expect(body).toContain('id="job-completion"');
    expect(body).toContain("requirement-checks");
    expect(body).toContain("completion-stages");
    expect(body).toContain("Required stages");
    expect(body).toContain("Override note if required photos are missing");
    expect(body).toContain("Mark job complete");
    expect(body).toContain("Marcar trabajo completo");
    expect(body).toContain("Reopen");
    expect(body).toContain("reopen.mutate()");
    expect(body).toContain("requirements.mutate(");
    expect(body).toContain("complete.mutate()");
    expect(body).toContain("completionError");
  });

  test("workflow is passed to the Photos tab above the gallery", () => {
    expect(APP).toContain("completionWorkflow={");
    expect(APP).toContain("<JobCompletionWorkflow");
    const photosStart = APP.indexOf("function WorkspacePhotosPanel");
    const photosEnd = APP.indexOf("function WorkspaceActivityPanel", photosStart);
    const photosBody = APP.slice(photosStart, photosEnd);
    expect(photosBody).toContain("{completionWorkflow}");
    // Workflow renders before the stage gallery cards.
    const wfIdx = photosBody.indexOf("{completionWorkflow}");
    const galleryIdx = photosBody.indexOf("panel-card");
    expect(wfIdx).toBeGreaterThan(-1);
    expect(galleryIdx).toBeGreaterThan(-1);
    expect(wfIdx).toBeLessThan(galleryIdx);
  });

  test("completion error switches to the photos tab where the note lives", () => {
    expect(APP).toContain("The override note lives in the Photos tab");
    // The onError handler sits between the complete mutation and the reopen mutation.
    const completeIdx = APP.indexOf("const complete = useMutation({");
    const reopenIdx = APP.indexOf("const reopen = useMutation({", completeIdx);
    const body = APP.slice(completeIdx, reopenIdx);
    expect(body).toContain('setWsTab("photos")');
    expect(body).toContain('getElementById("job-completion")');
  });
});

describe("No duplication", () => {
  test("only one completion-stages fieldset and one mark-complete button in source", () => {
    const fieldsets = APP.match(/className="completion-stages"/g) ?? [];
    expect(fieldsets.length).toBe(1);
    const buttons = APP.match(/Mark job complete/g) ?? [];
    // Component definition + test-file-free source: exactly 1 in the workflow.
    expect(buttons.length).toBe(1);
  });
});
