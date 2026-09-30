// Danny 2026-09-30: invoice UI matches the AI mockup look — compact rows,
// small status pills, small buttons, mockup-style detail screen.
// Static assertions: reusable compact classes exist, list rows use them,
// search/filter bar is wired, detail has the mockup layout pieces.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

describe("reusable compact language", () => {
  test("ck-compact-card, ck-pill variants, ck-btn-sm exist in CSS", () => {
    expect(CSS).toContain(".ck-compact-card");
    expect(CSS).toContain(".ck-pill-pending");
    expect(CSS).toContain(".ck-pill-paid");
    expect(CSS).toContain(".ck-pill-completed");
    expect(CSS).toContain(".ck-pill-overdue");
    expect(CSS).toContain(".ck-pill-draft");
    expect(CSS).toContain(".ck-btn-sm");
  });

  test("pills use the orange/green/blue family from the mockup", () => {
    expect(CSS).toContain("#f97316");
    expect(CSS).toContain("#22c55e");
    expect(CSS).toContain("#3b82f6");
  });
});

describe("invoice list compact rows", () => {
  test("invoice card still taps through to the preview (TapArticle preserved)", () => {
    expect(APP).toContain(
      '<TapArticle baseClass="document-tap" className="ck-invoice-row" onTap={() => setScreen({ name: "invoicePreview", invoiceId: invoice.id })}>',
    );
  });

  test("row has the mockup checkbox, title, client, pill, amount", () => {
    expect(APP).toContain('className={`ck-check${invoice.status === "paid" ? " done" : ""}`}');
    expect(APP).toContain("ck-invoice-row-copy");
    expect(APP).toContain("ck-invoice-row-amount");
    expect(APP).toContain("ck-pill-paid");
    expect(APP).toContain("ck-pill-pending");
    expect(APP).toContain("ck-pill-draft");
    expect(APP).toContain("ck-pill-overdue");
  });

  test("checkbox toggles paid status without navigating", () => {
    expect(APP).toContain(
      'status: invoice.status === "paid" ? "sent" : "paid"',
    );
  });

  test("search + status filter bar exists and filters the list", () => {
    expect(APP).toContain("ck-invoice-toolbar");
    expect(APP).toContain("ck-search");
    expect(APP).toContain("setInvSearch");
    expect(APP).toContain("setInvStatus");
    expect(APP).toContain("visibleInvoices.map((invoice)");
  });
});

describe("invoice detail mockup layout", () => {
  test("detail has the mockup header, items, totals, TOTAL bar, pay button", () => {
    expect(APP).toContain("ck-invoice-detail");
    expect(APP).toContain("ck-inv-number");
    expect(APP).toContain("INVOICE #{invoice.invoiceNumber.replace");
    expect(APP).toContain("ck-inv-items");
    expect(APP).toContain("ck-inv-totals");
    expect(APP).toContain("ck-inv-total-bar");
    expect(APP).toContain("ck-inv-pay-btn");
  });

  test("pencil edit icon opens the financial editor", () => {
    expect(APP).toContain("ck-icon-btn");
    expect(APP).toContain("onClick={() => setEditing(true)}");
  });

  test("PDF preview stays reachable from the detail", () => {
    expect(APP).toContain("onClick={() => setFullScreen(true)}");
    expect(APP).toContain("{t.previewPdf}</button>");
  });

  test("mark-paid flow goes through the payment sheet", () => {
    expect(APP).toContain("onClick={openPaymentSheet}");
    expect(APP).toContain("Mark as Paid");
  });
});
