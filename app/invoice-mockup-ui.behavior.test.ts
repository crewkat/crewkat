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
      '<TapArticle baseClass="document-tap" className={`ck-invoice-row${expanded ? " expanded" : ""}`} onTap={() => setScreen({ name: "invoicePreview", invoiceId: invoice.id })}>',
    );
  });

  test("row has the mockup checkbox, title, client, pill, amount", () => {
    // Doc redesign (2026-10-24): the small status glyph replaced the ring
    // checkbox; it keeps the same one-tap paid toggle.
    expect(APP).toContain("ck-doc-glyph");
    expect(APP).toContain('invoice.status === "paid" ? "paid" : invoice.status === "overdue" ? "overdue"');
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
    expect(APP).toContain("doc-controls");
    expect(APP).toContain("ck-search");
    expect(APP).toContain("setInvSearch");
    expect(APP).toContain("setInvStatus");
    expect(APP).toContain("visibleInvoices.map((invoice)");
  });
});

describe("invoice detail mockup layout", () => {
  test("detail has the mockup header, items, totals, and money tiles", () => {
    expect(APP).toContain("ck-invoice-detail");
    expect(APP).toContain("ck-inv-number");
    expect(APP).toContain("INVOICE #{invoice.invoiceNumber.replace");
    expect(APP).toContain("ck-inv-items");
    expect(APP).toContain("ck-inv-totals");
    // Design overhaul (Danny approved 2026-10-12): the full-bleed TOTAL bar
    // and the giant in-page pay button are retired — Total / Paid / Balance
    // are three slim tiles now, and the bottom action bar is the only
    // action row.
    expect(APP).toContain("ck-money-tiles");
    expect(APP).not.toContain("ck-inv-total-bar");
    expect(APP).not.toContain("ck-inv-pay-btn");
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
    // The action bar's Paid button (label "Mark paid" when unpaid) opens the
    // same payment sheet the retired in-page pay button used to open.
    expect(APP).toContain("Mark paid");
  });
});

// Build 3.0 batch (items 7, 10, 12): fullscreen edit, compact invoice cards,
// smaller money-popup buttons + avatar contact rows.
describe("build 3.0 item 7: invoice edit is a full-screen window", () => {
  test("FinancialEditor opens full-screen via doc-fullscreen", () => {
    expect(APP).toContain(
      'className="sheet-backdrop floating-doc-backdrop doc-fullscreen"',
    );
    expect(CSS).toContain(
      ".floating-doc-backdrop.doc-fullscreen .more-sheet.editor-sheet",
    );
  });

  test("every edit line item has an X to delete it", () => {
    expect(APP).toContain(
      'aria-label={`${lang === "es" ? "Eliminar partida" : "Remove item"} ${index+1}`}',
    );
    expect(APP).toContain(
      "onClick={() => setForm({...form,lineItems:form.lineItems.filter((_,i)=>i!==index)})}",
    );
  });
});

describe("build 3.0 item 10: compact invoice cards", () => {
  test("row shows INV number + client, amount + pill on the right", () => {
    expect(APP).toContain("ck-invoice-row-side");
    expect(APP).toContain(
      "{invoice.invoiceNumber || `INV-${String(invoice.id).padStart(4, \"0\")}`}",
    );
    expect(APP).toContain("ck-invoice-row-amount");
    expect(APP).toContain("ck-pill-paid");
    expect(APP).toContain("ck-pill-pending");
  });

  test("\"Mark status | View\" action row with the status select behind Mark status", () => {
    expect(APP).toContain("ck-invoice-actions");
    expect(APP).toContain("ck-mark-status");
    expect(APP).toContain("ck-status-select");
    expect(APP).toContain("ck-actions-sep");
    expect(APP).toContain("ck-view-action");
    expect(APP).toContain("Mark status");
  });

  test("paid status circle renders green like the mockup", () => {
    expect(CSS).toContain(".ck-doc-glyph.paid { background: color-mix(in srgb, #22c55e 16%, var(--surface));");
  });
});

describe("build 3.0 item 12: money-to-collect popup", () => {
  test("action buttons are much smaller", () => {
    expect(CSS).toContain(".b06-money-actions .primary-button { min-height: 0;");
    expect(CSS).toContain(".b06-money-actions button:not(.primary-button) { padding: 9px 10px;");
  });

  test("contact rows show avatar circles with initials like the Contacts page", () => {
    expect(APP).toContain("b06-money-contact");
    expect(APP).toContain("client-avatar tone-${avatarTone(row.name)}");
    expect(APP).toContain("clientInitials(row.name)");
    expect(CSS).toContain(".b06-money-list .b06-money-contact .client-avatar");
  });
});
