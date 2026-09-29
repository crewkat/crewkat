// Regression test — 2026-09-29: Danny asked that every Home reminder card be
// tappable so it deep-links to the task it describes (e.g. the "Ask for
// review" card with "Add the client phone number first." should take him to
// the client record to add the missing phone number).
//
// This test statically asserts the mapping: each automation-card type on the
// Today/Home screen renders through TapArticle with the right destination,
// TapArticle ignores taps on nested links/buttons (SMS, Won/Lost, Renew…),
// the tap affordance CSS exists, and the server payloads carry clientId so
// the no-phone cards can reach the client record.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");
const SERVER = readFileSync(
  join(import.meta.dir, "server/src/actions.ts"),
  "utf8",
);

function extractFunction(src: string, name: string): string {
  const lines = src.split("\n");
  const startIdx = lines.findIndex((l) => l.startsWith(`function ${name}(`));
  if (startIdx === -1) throw new Error(`function ${name} not found`);
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^function \w+\(/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

const TODAY = extractFunction(APP, "TodayScreen");

describe("TapArticle component", () => {
  test("TapArticle is defined and guards nested interactive elements", () => {
    expect(APP).toContain("function TapArticle(");
    // Taps on nested links/buttons (SMS, Won/Lost, Renew…) must not navigate.
    expect(APP).toContain('closest("a, button, input, select, textarea")');
    expect(APP).toContain('role="button"');
  });

  test("tap affordance CSS exists (chevron + press state + reduced motion)", () => {
    expect(CSS).toContain(".automation-card.tap-target");
    expect(CSS).toContain(".automation-card.tap-target::after");
    expect(CSS).toContain("cursor: pointer");
  });
});

describe("reminder card deep links", () => {
  const tapCount = (TODAY.match(/<TapArticle/g) ?? []).length;
  test("all ten reminder card types render through TapArticle", () => {
    expect(tapCount).toBe(10);
  });

  const cardBlock = (marker: string): string => {
    const idx = TODAY.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    return TODAY.slice(idx, idx + 4000);
  };

  test("overdue invoice -> invoice preview", () => {
    expect(cardBlock("paymentEscalations.map")).toContain(
      'name: "invoicePreview"',
    );
  });
  test("materials to order -> job operations", () => {
    expect(cardBlock("d.materials.map")).toContain('name: "jobOps"');
  });
  test("appointment -> job detail", () => {
    expect(cardBlock("d.appointments.map")).toContain('name: "detail"');
  });
  test("quote expiry + quote chase -> estimate preview", () => {
    expect(cardBlock("d.quoteExpiry.map")).toContain('name: "quotePreview"');
    expect(cardBlock("quoteChase.map")).toContain('name: "quotePreview"');
  });
  test("note reminder -> job detail or client record", () => {
    const block = cardBlock("d.reminders.map");
    expect(block).toContain('name: "detail"');
    expect(block).toContain('name: "client"');
  });
  test("ask-for-review -> review SMS text, or client record to add the phone", () => {
    const block = cardBlock("d.reviews.map");
    expect(block).toContain("smsHref(");
    expect(block).toContain("reviewMessage(r)");
    expect(block).toContain('name: "client"');
  });
  test("re-engage -> re-engagement SMS text, or client record to add the phone", () => {
    const block = cardBlock("d.reengagement.map");
    expect(block).toContain("smsHref(");
    expect(block).toContain("reengageMessage(r)");
    expect(block).toContain('name: "client"');
  });
  test("warranty -> warranty SMS text, client record, or expansion screen", () => {
    const block = cardBlock("expansion.warranties");
    expect(block).toContain("warrantyMessage(w)");
    expect(block).toContain('name: "client"');
    expect(block).toContain('name: "expansion"');
  });
  test("equipment upkeep -> expansion screen", () => {
    expect(cardBlock("expansion.plans")).toContain('name: "expansion"');
  });
});

describe("server payloads carry clientId for no-phone cards", () => {
  test("reviews and reengagement schemas include clientId", () => {
    expect(SERVER).toContain(
      "reviews: z.array(z.object({ jobId:z.number(), clientId:z.number().nullable()",
    );
    expect(SERVER).toContain(
      "reengagement: z.array(z.object({ jobId:z.number(), clientId:z.number().nullable()",
    );
  });
  test("warranty schema includes clientId", () => {
    expect(SERVER).toContain("jobId:w.jobId,clientId:w.clientId??null");
  });
});
