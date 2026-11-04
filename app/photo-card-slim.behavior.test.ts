// Danny 2026-10-11: slim the Overview photo card — the full photo-completeness
// workflow moves to the Photos tab; the Overview keeps only a compact summary
// card that deep-links to the Photos tab.
// Wave A (Danny approved 2026-11-03) supersedes the shape: the Overview
// summary is now a strip with per-stage COUNTS (no ring), the Photos
// workflow is a stages card (chips + one alert line + collapsed
// override note + required-stages fieldset), and Mark complete /
// Reopen moved OUT of Photos onto Overview's next-step card.
// Run from app/:  bun photo-card-slim.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

// The Overview's photos strip block (button.job-photos-strip).
function overviewSummaryBlock(): string {
  const start = APP.indexOf('className="job-photos-strip"');
  expect(start).toBeGreaterThan(-1);
  // The button opens right before its onClick handler (~40 lines above).
  const open = APP.lastIndexOf("{settings?.simpleMode", start);
  const end = APP.indexOf("</button>", start);
  return APP.slice(open, end);
}

describe("Overview: photos strip only (Wave A)", () => {
  test("strip exists, shows stage counts, and deep-links to the photos tab", () => {
    const block = overviewSummaryBlock();
    expect(block).toContain('onClick={() => setWsTab("photos")}');
    expect(block).toContain("stage-count-chip");
    expect(block).toContain("Stages for the proof packet");
    expect(block).toContain("Etapas para el paquete de evidencia");
  });

  test("strip carries no workflow controls", () => {
    const block = overviewSummaryBlock();
    expect(block).not.toContain("requirement-checks");
    expect(block).not.toContain("completion-stages");
    expect(block).not.toContain("<textarea");
    expect(block).not.toContain("Mark job complete");
    expect(block).not.toContain("Marcar trabajo completo");
  });

  test("strip styling exists", () => {
    expect(CSS).toMatch(/\.job-photos-strip\s*\{/);
    expect(CSS).toMatch(/\.stage-count-chip/);
  });
});

describe("Photos tab: stages workflow lives here (Wave A)", () => {
  test("JobCompletionWorkflow is the stages card — no completion buttons", () => {
    const start = APP.indexOf("function JobCompletionWorkflow");
    expect(start).toBeGreaterThan(-1);
    const end = APP.indexOf("function FlowStepper", start);
    const body = APP.slice(start, end);
    expect(body).toContain('id="job-completion"');
    expect(body).toContain("requirement-checks");
    expect(body).toContain("completion-stages");
    expect(body).toContain("Required stages");
    expect(body).toContain("Override note if required photos are missing");
    expect(body).toContain("stage-chips");
    expect(body).toContain("photos-alert-line");
    expect(body).toContain("Add a note instead");
    expect(body).toContain("requirements.mutate(");
    expect(body).toContain("completionError");
    // Wave A: Mark complete / Reopen live on Overview's next-step card.
    expect(body).not.toContain("Mark job complete");
    expect(body).not.toContain("complete.mutate()");
    expect(body).not.toContain("reopen.mutate()");
  });

  test("mark complete + reopen live on Overview's next-step card", () => {
    expect(APP).toContain("onClick: () => complete.mutate()");
    expect(APP).toContain("next-step-card");
    expect(APP).toContain("reopen.mutate()");
  });

  test("workflow is passed to the Photos tab above the gallery", () => {
    expect(APP).toContain("completionWorkflow={");
    expect(APP).toContain("<JobCompletionWorkflow");
    const photosStart = APP.indexOf("function WorkspacePhotosPanel");
    const photosEnd = APP.indexOf("type ActivityItem", photosStart);
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
  test("only one completion-stages fieldset; the completion action lives in one place", () => {
    const fieldsets = APP.match(/className="completion-stages"/g) ?? [];
    expect(fieldsets.length).toBe(1);
    // Wave A: no "Mark job complete" button anywhere — the Overview
    // next-step card owns the single "Mark complete" action.
    const buttons = APP.match(/Mark job complete/g) ?? [];
    expect(buttons.length).toBe(0);
    expect(APP).toContain('"Mark complete"');
    expect(APP).toContain('"Marcar completo"');
  });
});
