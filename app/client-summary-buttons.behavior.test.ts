// Regression test — 2026-10-15: on the client page (client "Denny": Jobs (1) ·
// Invoices (1) · Estimates (3)) the three summary buttons were hard-coded to
// the FIRST record, so "Estimates (3)" opened one estimate and never showed
// all three. The buttons now scroll to the matching history group on the same
// screen (which lists every record of that type) and flash it briefly.
//
// Static assertions: the first-record routes are gone from ClientDetail, each
// button is count-gated onto scrollToHistoryGroup with its own group ref, the
// scroll uses smooth + block:"start" (auto under reduced motion), the history
// groups carry the refs + flash class, rows still open their own record, and
// the zero-record fallbacks / counts are unchanged.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");
const DETAIL = APP.slice(
  APP.indexOf("function ClientDetail("),
  APP.indexOf("function FollowupsScreen("),
);

describe("client summary buttons no longer open the first record", () => {
  test("ClientDetail slice was found", () => {
    expect(DETAIL.length).toBeGreaterThan(1000);
    expect(DETAIL).toContain('className="client-links"');
  });

  test("jobs button does not route to the first job's detail", () => {
    expect(DETAIL).not.toContain("firstJob");
    expect(DETAIL).not.toContain("jobs.at(0)");
  });

  test("invoices button does not route to the first invoice's preview", () => {
    expect(DETAIL).not.toContain("clientInvoices[0]");
  });

  test("estimates button does not route to the first quote's preview", () => {
    expect(DETAIL).not.toContain("quotes[0]");
    expect(DETAIL).not.toContain("quoteId: query.data.quotes");
  });
});

describe("each summary button targets its history group when records exist", () => {
  test("jobs button is count-gated onto the jobs group", () => {
    expect(DETAIL).toContain(
      '(query.data?.jobs.length ?? 0) > 0 ? scrollToHistoryGroup("jobs", historyJobsRef)',
    );
  });

  test("invoices button is count-gated onto the invoices group", () => {
    expect(DETAIL).toContain(
      'clientInvoices.length > 0 ? scrollToHistoryGroup("invoices", historyInvoicesRef)',
    );
  });

  test("estimates button is count-gated onto the estimates group", () => {
    expect(DETAIL).toContain(
      '(query.data?.quotes.length ?? 0) > 0 ? scrollToHistoryGroup("quotes", historyQuotesRef)',
    );
  });

  test("the scroll helper smooth-scrolls to the group start (auto if reduced motion)", () => {
    expect(DETAIL).toContain("const scrollToHistoryGroup = ");
    expect(DETAIL).toContain('ref.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" })');
    expect(DETAIL).toContain('window.matchMedia?.("(prefers-reduced-motion: reduce)")');
  });

  test("the tapped group flashes briefly, then clears", () => {
    expect(DETAIL).toContain("setFlashGroup(group)");
    expect(DETAIL).toContain("window.setTimeout(() => setFlashGroup(null), 1800)");
  });

  test("history groups carry the refs and the flash class", () => {
    // Split pins: the className template tail (backtick/brace cluster) is
    // brittle as one literal, so pin the ref+class head and the flash
    // ternary separately.
    expect(DETAIL).toContain("ref={historyJobsRef} className={`client-history-group");
    expect(DETAIL).toContain("ref={historyInvoicesRef} className={`client-history-group");
    expect(DETAIL).toContain("ref={historyQuotesRef} className={`client-history-group");
    expect(DETAIL).toContain('flashGroup === "jobs" ? " is-flash" : ""');
    expect(DETAIL).toContain('flashGroup === "invoices" ? " is-flash" : ""');
    expect(DETAIL).toContain('flashGroup === "quotes" ? " is-flash" : ""');
  });
});

describe("history rows still open their own record", () => {
  test("job rows open that job", () => {
    expect(DETAIL).toContain("onClick={() => setScreen({ name: \"detail\", jobId: j.id })}");
  });

  test("estimate rows open that estimate", () => {
    expect(DETAIL).toContain("onClick={() => setScreen({ name: \"quotePreview\", quoteId: q.id })}");
  });

  test("invoice rows open that invoice", () => {
    expect(DETAIL).toContain("onClick={() => setScreen({ name: \"invoicePreview\", invoiceId: invoice.id })}");
  });
});

describe("zero-record fallbacks and counts are unchanged", () => {
  test("jobs fallback goes to the jobs list", () => {
    expect(DETAIL).toContain(': setScreen({ name: "jobs" })}>{t.jobs} ({query.data?.jobs.length ?? 0})');
  });

  test("invoices fallback goes to the invoices hub", () => {
    expect(DETAIL).toContain(': setScreen({ name: "invoices" })}>{t.invoices} ({clientInvoices.length})');
  });

  test("estimates fallback starts a new estimate for this client", () => {
    expect(DETAIL).toContain(': setScreen({ name: "quoteNew", clientId })}>{lang === "es" ? "Presupuestos" : "Estimates"} ({query.data?.quotes.length ?? 0})');
  });
});

describe("history group CSS supports the landing", () => {
  test("groups clear the sticky header when scrolled to", () => {
    expect(CSS).toContain(".client-history-group { scroll-margin-top: 72px;");
  });

  test("flash animation is defined and accent-tinted", () => {
    expect(CSS).toContain(".client-history-group.is-flash { animation: client-history-flash 1.8s ease-out; }");
    expect(CSS).toContain("@keyframes client-history-flash");
    expect(CSS).toContain("color-mix(in srgb, var(--accent) 13%, transparent)");
  });
});
