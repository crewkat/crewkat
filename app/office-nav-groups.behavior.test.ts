// Office grouped sidebar (Danny 2026-11-09): sections that belong
// together live under a group header. Tapping Dashboard opens its
// sub-menu (Overview, Pipeline, Follow-ups, Promotions, Reputation,
// Money) instead of those standing as top-level items; Documents
// groups Estimates / Invoices / All documents the same way. Money also
// keeps an overview panel on the dashboard that clicks through to the
// full page. Run from app/: bun test office-nav-groups.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync("office/src/App.tsx", "utf8");
const DASH = readFileSync("office/src/views/Dashboard.tsx", "utf8");
const DOCS = readFileSync("office/src/views/Documents.tsx", "utf8");
const CSS = readFileSync("office/src/office.css", "utf8");

describe("Office grouped sidebar (Danny 2026-11-09)", () => {
  test("Dashboard is a group containing Pipeline, Follow-ups, Promotions, Reputation and Money", () => {
    expect(APP).toContain('id: "dashboard-group", label: "Dashboard", icon: "▦", home: "dashboard"');
    for (const label of ["Overview", "Pipeline", "Follow-ups", "Promotions", "Reputation", "Money"]) {
      expect(APP).toContain(`label: "${label}"`);
    }
    // None of the grouped pages stand as top-level items anymore.
    expect(APP).not.toContain('{ id: "pipeline", key: "pipeline", label: "Pipeline", icon:');
    expect(APP).not.toContain('{ id: "money", key: "money", label: "Money", icon:');
  });

  test("Documents is a group with Estimates / Invoices / All documents presets", () => {
    expect(APP).toContain('id: "documents-group", label: "Documents", icon: "📄", home: "documents"');
    expect(APP).toContain('{ id: "estimates", key: "documents", label: "Estimates", docKind: "quote" }');
    expect(APP).toContain('{ id: "invoices", key: "documents", label: "Invoices", docKind: "invoice" }');
    expect(APP).toContain('{ id: "documents", key: "documents", label: "All documents", docKind: "" }');
    // The documents view takes the preset and App remounts it per kind.
    expect(DOCS).toContain('useState<"" | DocKind>(initialKind ?? "")');
    expect(APP).toContain("key={docKind}");
  });

  test("group headers expand a sub-menu; the follow-up badge rides the sub-item", () => {
    expect(APP).toContain("nav-item nav-sub-item");
    expect(APP).toContain('child.key === "followups" && followUpBadge > 0');
    expect(APP).toContain('aria-expanded={expanded}');
    expect(CSS).toContain(".nav-sub-item");
    expect(CSS).toContain(".nav-chevron.open");
  });

  test("the grouped pages are still real views, reached from nav and dashboard shortcuts", () => {
    expect(APP).toContain('{view === "followups" ? (');
    expect(APP).toContain('{view === "promotions" ? <PromotionsView canSend={user.teamRole === "admin"} /> : null}');
    expect(APP).toContain('{view === "reputation" ? <ReputationView canDelete={user.teamRole === "admin"} /> : null}');
    expect(APP).toContain('{view === "money" ? <MoneyView onOpenDocument={openDocument} /> : null}');
    expect(APP).toContain('onGoFollowUps={() => setView("followups")}');
    expect(APP).toContain('onGoMoney={() => setView("money")}');
  });

  test("every nav highlight is the same size: full width, one shared box", () => {
    expect(CSS).toContain(".nav-item { width: 100%; box-sizing: border-box; }");
    expect(CSS).toContain(".nav-sub-item { padding: 9px 10px 9px 41px; font-size: 13.5px; font-weight: 600; }");
  });

  test("the document detail opens as a large popup drawer over the full-width list", () => {
    const docs = readFileSync("office/src/views/Documents.tsx", "utf8");
    expect(docs).toContain('className="doc-drawer-backdrop"');
    expect(docs).toContain("doc-detail-drawer");
    expect(CSS).toContain(".doc-detail-drawer");
    expect(CSS).toContain("width: min(880px, 96vw)");
  });

  test("the dashboard carries the Money overview with the Money page's own definitions", () => {
    expect(DASH).toContain('className="panel money-overview"');
    expect(DASH).toContain("moneyToReceive");
    expect(DASH).toContain("i.status !== \"paid\" && parseMoney(i.balanceRemaining) > 0");
    expect(DASH).toContain("parseMoney(i.paidApplied ?? i.paidToDate)");
    expect(DASH).toContain("Open money →");
  });
});
