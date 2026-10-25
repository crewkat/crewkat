// Doc redesign (Danny approved 2026-10-24; mockup:
// crewkat-invoices-estimates-redesign-mockup) — the Invoices & Estimates
// hub drops the orange year-total carousel and the CREATE slab for a slim
// navy section switch, a navy money strip whose period total is the hero,
// Year | Month period filtering (Month narrows the feed), compact
// hairline rows with text-link actions on the expanded row, and an
// app-wide tab-bar indicator (navy tint + orange hairline, no dot).
// Static assertions in the repo's usual style.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

describe("section switch + money strip", () => {
  test("slim segmented switch with receipt/clipboard icons and navy active side", () => {
    expect(APP).toContain('className="document-tabs doc-seg"');
    expect(APP).toContain("M6 3.5h12V20l-2-1.4L14 20l-2-1.4L10 20l-2-1.4L6 20z");
    expect(APP).toContain('d="M9.5 4a2.5 2.5 0 0 1 5 0"');
    expect(CSS).toContain(".document-tabs.doc-seg button.active { background: var(--navy-800);");
    expect(CSS).toContain(".document-tabs.doc-seg button { min-height: 0; padding: 7px 0;");
  });

  test("navy strip: hero period total, subordinate stats per section", () => {
    expect(APP).toContain('className={`doc-strip${period === "month" ? " is-month" : ""}`}');
    expect(APP).toContain("doc-strip-num");
    expect(APP).toContain("tab === \"invoices\" ? periodInvoiced : periodEstimated");
    expect(APP).toContain("periodPaid");
    expect(APP).toContain("periodBalance");
    expect(APP).toContain("periodAccepted");
    expect(APP).toContain("<strong>{periodQuotes.length}</strong>");
    expect(CSS).toContain(".doc-strip {");
    expect(CSS).toContain("linear-gradient(120deg, var(--navy-900), var(--navy-700))");
    expect(CSS).toContain(".doc-strip-num { font-size: 27px;");
  });

  test("old carousel and slab are gone from the hub", () => {
    expect(APP).not.toContain("doc-months-track");
    expect(APP).not.toContain("doc-month-card");
    expect(APP).not.toContain("doc-balance-line");
    expect(APP).not.toContain('className="page-actions document-create"');
  });
});

describe("Year | Month period behavior", () => {
  test("period state, month stepper, and chips are wired", () => {
    expect(APP).toContain('useState<"year" | "month">("year")');
    expect(APP).toContain("doc-period-chips");
    expect(APP).toContain("doc-month-pick");
    expect(APP).toContain("onClick={() => shiftMonth(-1)}");
    expect(APP).toContain("disabled={monthKey >= month}");
    expect(APP).toContain('onClick={() => setPeriod("month")}');
  });

  test("document months come from issueDate / sentAt||createdAt (existing fields only)", () => {
    expect(APP).toContain("invoice.issueDate.slice(0, 7)");
    expect(APP).toContain("(quote.sentAt || quote.createdAt).slice(0, 7)");
  });

  test("month mode filters the feed; year mode leaves it unfiltered", () => {
    expect(APP).toContain(
      'const visibleInvoices = period === "month" ? searchedInvoices.filter((invoice) => invMonthKey(invoice) === monthKey) : searchedInvoices;',
    );
    expect(APP).toContain(
      'const visibleQuotes = period === "month" ? searchedQuotes.filter((quote) => quoteMonthKey(quote) === monthKey) : searchedQuotes;',
    );
    expect(APP).toContain("inPeriod(invMonthKey(invoice))");
    expect(APP).toContain("inPeriod(quoteMonthKey(quote))");
  });

  test("paid reconciles with the hero: paid = total - balance over the period set", () => {
    expect(APP).toContain(
      "sum + Math.max(0, money(invoice.totalWithLateFee) - money(invoice.balanceRemaining))",
    );
  });
});

describe("controls row + compact rows", () => {
  test("search row holds search, the status filter chip, and a compact New button", () => {
    expect(APP).toContain('className="doc-controls"');
    expect(APP).toContain('className="ck-btn-sm doc-filter-chip"');
    expect(APP).toContain('className="doc-new-btn"');
    expect(CSS).toContain(".doc-new-btn { display: inline-flex;");
    expect(CSS).toContain("background: var(--navy-700);");
  });

  test("estimates gained the matching search field", () => {
    expect(APP).toContain("const [estSearch, setEstSearch] = useState(\"\");");
    expect(APP).toContain("searchedQuotes");
    expect(APP).toContain("setEstSearch(e.target.value)");
  });

  test("one hairline card, ~64px rows, small glyph + pill, no ring", () => {
    expect(APP).toContain("doc-list-v2 stagger-children");
    expect(CSS).toContain(".doc-list-v2 { gap: 0;");
    expect(CSS).toContain("border-bottom: 1px solid var(--border);");
    expect(CSS).toContain("min-height: 64px;");
    expect(APP).toContain("ck-doc-glyph");
    expect(APP).not.toContain("ck-check${");
  });

  test("expanded row exposes the existing actions as text links", () => {
    expect(APP).toContain("ck-doc-chev");
    expect(APP).toContain("expanded && <span className=\"ck-invoice-actions\">");
    expect(APP).toContain("ck-doc-subrow");
    expect(APP).toContain("isExpanded(rowKey, invoice === visibleInvoices[0])");
    expect(APP).toContain("isExpanded(rowKey, quote === visibleQuotes[0])");
    expect(CSS).toContain(".doc-list-v2 .ck-doc-subrow button:not(.primary-button)");
  });
});

describe("swipe panels hidden at rest (regression: Danny 2026-10-24 screenshots)", () => {
  test("the swipe-content cover stays opaque in the doc list", () => {
    // .swipe-actions is an absolutely-positioned underlay; the ONLY thing
    // hiding it at rest is the opaque background of the .swipe-content
    // layer above it. The redesign briefly made that layer transparent
    // (the card white lives on the section), so the orange panel showed
    // through on every row that has a swipe action.
    expect(CSS).toContain(".doc-list-v2 .swipe-content { background: var(--surface); }");
    expect(CSS).not.toContain(".doc-list-v2 .swipe-content { background: transparent; }");
    // base mechanism intact: content is positioned above the underlay
    expect(CSS).toContain(".swipe-content { position: relative; background: var(--bg);");
    expect(CSS).toContain(".swipe-actions { position: absolute; inset: 0 0 0 auto;");
    // the underlay renders before the cover in SwipeRow's DOM
    expect(APP.indexOf('className="swipe-actions"')).toBeLessThan(APP.indexOf('className="swipe-content"'));
    // no doc-list override restyles the underlay itself into view
    expect(CSS).not.toContain(".doc-list-v2 .swipe-actions");
  });

  test("section / period switch remounts the list, resetting every row's swipe state", () => {
    // both sections are keyed by tab + period + month: a switch unmounts
    // the old list and every SwipeRow is recreated with offset 0
    expect(APP).toContain("key={`inv-${period}-${monthKey}`}");
    expect(APP).toContain("key={`est-${period}-${monthKey}`}");
    expect(APP).toContain("const [offset, setOffset] = useState(0);");
    // resting state carries no transform — the panel appears only after
    // a real swipe moves the cover
    expect(APP).toContain("style={{ transform: offset ? `translateX(${offset}px)` : undefined }}");
  });

  test("the first-row expansion does not expose the swipe panel", () => {
    // expanded actions render inside the article (above the cover layer),
    // independent of the swipe underlay; expansion state is per row key
    expect(APP).toContain("expanded && <span className=\"ck-invoice-actions\">");
    expect(APP).toContain("ck-doc-subrow");
    expect(APP).toContain("isExpanded(rowKey, invoice === visibleInvoices[0])");
    expect(APP).toContain("isExpanded(rowKey, quote === visibleQuotes[0])");
  });
});

describe("tab bar indicator (app-wide)", () => {
  test("orange dot retired; tint pill + orange hairline under the active icon", () => {
    expect(CSS).toContain(
      ".bottom-nav > button.active .bottom-nav-icon::after { content: none; }",
    );
    expect(CSS).toContain(
      ".bottom-nav > button.active { background: color-mix(in srgb, var(--navy-700) 9%, transparent); }",
    );
    expect(CSS).toContain(
      ".bottom-nav > button.active .bottom-nav-icon { border-bottom-color: var(--accent-orange); }",
    );
  });
});
