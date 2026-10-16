// Job sections design pass (Danny, 2026-10-15 — "New construct" screenshots).
//
// The eight job-detail accordion sections each improvised their own
// spacing: bodies started flush under the title bar, empty states were
// loose text, and list rows did not read as tappable. Danny approved a
// mockup with ONE design system, pinned here:
//  1. .accordion-panel padding gives every section body 14px of air
//     under the header hairline, 16px on the sides.
//  2. List items are inset tappable rows (hairline border, ~12px radius)
//     with a status chip where the data supports one — invoices reuse
//     the ck-pill mapping from the invoice screens, contracts show
//     Signed/Awaiting from doc.clientSignedAt.
//  3. Empty states render inside a dashed placeholder box
//     (.accordion-panel .job-section-empty), not loose text.
//  4. Heading label + orange + / Add / Record actions sit on one
//     baseline: small-caps muted sub-label, 40px round add button.
// Presentation only — routes, handlers, and counts must be untouched.
//
// Run from app/:  bun test job-sections-ui.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

function rule(selector: string): string {
  const idx = CSS.indexOf(selector);
  if (idx === -1) return "";
  const open = CSS.indexOf("{", idx);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open, close + 1);
}

function slice(from: string, to: string): string {
  const a = APP.indexOf(from);
  const b = APP.indexOf(to, a + from.length);
  return APP.slice(a, b === -1 ? undefined : b);
}

describe("one spacing system for all eight sections", () => {
  test("accordion panel body has 14px top / 16px side breathing room", () => {
    expect(rule(".accordion-panel {")).toContain("padding:14px 16px 16px");
  });

  test("all eight AccordionSection usages survive in JobDetail", () => {
    const uses = APP.match(/<AccordionSection title=/g) ?? [];
    expect(uses.length).toBe(8);
  });

  test("share-to-social action no longer double-pads the panel top", () => {
    expect(rule(".accordion-actions {")).toContain("padding-top:0");
  });

  test("voice notes panel drops its own 18px/40px frame padding inside the accordion", () => {
    expect(rule(".accordion-panel .operations-panel")).toContain("padding: 0");
  });
});

describe("inset tappable rows with status chips", () => {
  test("linked-list rows are 12px-radius inset cards", () => {
    expect(rule(".job-accordion .job-linked-list article")).toContain("border-radius: 12px");
  });

  test("invoice rows carry the shared ck-pill status mapping and keep their route", () => {
    const seg = slice('title={lang === "es" ? "Facturas" : "Invoices"}', 'title={lang === "es" ? "Contratos" : "Contracts"}');
    expect(seg).toContain('setScreen({ name: "invoicePreview", invoiceId: invoice.id })');
    expect(seg).toContain("ck-pill-paid");
    expect(seg).toContain("ck-pill-overdue");
    expect(seg).toContain("ck-pill-draft");
    expect(seg).toContain("ck-pill-pending");
    // Status moved into the chip — the small line no longer duplicates it.
    expect(seg).not.toContain("· {t[invoice.status]}");
    // Unlink behavior untouched.
    expect(seg).toContain("linkInvoice.mutate({ invoiceId: invoice.id, linkedJobId: null })");
  });

  test("contract rows show Signed/Awaiting from clientSignedAt and keep the document route", () => {
    const seg = slice('title={lang === "es" ? "Contratos" : "Contracts"}', 'title={lang === "es" ? "Notas de pago" : "Payment notes"}');
    expect(seg).toContain('setScreen({ name: "document", jobId, documentId: doc.id })');
    expect(seg).toContain("doc.clientSignedAt ? \"ck-pill-paid\" : \"ck-pill-pending\"");
    expect(seg).toContain('"Firmado" : "Signed"');
    expect(seg).toContain('"En espera" : "Awaiting"');
  });

  test("related estimates become inset rows too", () => {
    const r = rule(".job-accordion .related-estimates button");
    expect(r).toContain("border: 1px solid var(--border)");
    expect(r).toContain("border-radius: 12px");
    expect(r).toContain("background: var(--surface)");
  });

  test("more-tools grid renders as separated inset rows inside the panel", () => {
    const r = rule(".accordion-panel .tool-grid button");
    expect(r).toContain("border: 1px solid var(--border)");
    expect(r).toContain("border-radius: 12px");
    expect(rule(".accordion-panel .tool-grid {")).toContain("margin-top:0");
  });

  test("voice note entries become inset rows inside the panel", () => {
    const r = rule(".accordion-panel .operation-list article");
    expect(r).toContain("border: 1px solid var(--border)");
    expect(r).toContain("border-radius: 12px");
    expect(r).toContain("background: var(--surface)");
  });
});

describe("dashed empty states", () => {
  test("job-section-empty inside a panel is a dashed placeholder box", () => {
    const r = rule(".accordion-panel .job-section-empty");
    expect(r).toContain("border: 1.5px dashed var(--border)");
    expect(r).toContain("border-radius: 12px");
    expect(r).toContain("text-align: center");
  });

  test("invoices + contracts empties still render through job-section-empty", () => {
    expect(APP).toContain('<p className="job-section-empty">{lang === "es" ? "No hay facturas vinculadas." : "No linked invoices yet."}</p>');
    expect(APP).toContain('<p className="job-section-empty">{lang === "es" ? "No hay contratos vinculados." : "No linked contracts yet."}</p>');
  });

  test("photo stage empty state gets the dashed box inside the panel", () => {
    expect(rule(".accordion-panel .stage-empty")).toContain("border: 1.5px dashed var(--border)");
  });

  test("photo pairs empty copy renders through job-section-empty", () => {
    expect(APP).toContain('<p className="job-section-empty">{lang === "es" ? "Aún no hay pares.');
  });
});

describe("actions on one baseline", () => {
  test("section heading label is the small-caps muted sub-label", () => {
    const r = rule(".job-accordion .job-section-heading p");
    expect(r).toContain("text-transform: uppercase");
    expect(r).toContain("letter-spacing: .06em");
    expect(r).toContain("font-size: 12px");
  });

  test("round add button is the shared 40px circle in job sections", () => {
    expect(rule(".job-accordion .job-round-add")).toContain("width: 40px; height: 40px");
  });

  test("add buttons keep their sheet handlers", () => {
    expect(APP).toContain('setActiveJobSheet("invoices")');
    expect(APP).toContain('setActiveJobSheet("contracts")');
    expect(APP).toContain('setActiveJobSheet("payment")');
    expect(APP).toContain('setActiveJobSheet("deposit")');
  });

  test("value rows (payment notes / deposits) end flush with the panel bottom", () => {
    expect(rule(".job-accordion .job-value-row")).toContain("margin-bottom: 0");
  });
});
