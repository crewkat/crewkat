// Document-builder client block consolidation (Danny, 2026-10-15).
//
// Danny's directive (screenshot of New estimate): the form head stacked
// THREE blocks for one concept — (1) "Choose an existing client" + search,
// (2) "Client name *" field, (3) "Client details" collapsible — wasting
// vertical space. They are now ONE compact row (label "Client", selection
// summary, chevron); tapping it opens a BottomSheet holding the picker and
// every document-level client field the three blocks carried.
//
// Pins: the trio is gone from BOTH builders' form heads; the row renders
// the selection state (name + address/phone/email summary, or the
// "No client selected" empty state with the required marker); the sheet
// contains the existing ClientPicker (same search + pick) and the doc-level
// fields with the same settings gates; the sheet writes into the builder
// form state only (no client-record API), so saveQuote/saveInvoice keep
// receiving the identical clientId + snapshot fields; the save-time
// client-name validation is unchanged; Escape on an open sheet does not
// fall through to the builder's exit-and-save.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

const rowStart = APP.indexOf("function DocClientRow");
const sheetStart = APP.indexOf("function DocClientSheet");
const sheetEnd = APP.indexOf("function JobDateSheet", sheetStart);
const ROW = APP.slice(rowStart, sheetStart);
const SHEET = APP.slice(sheetStart, sheetEnd);

const quoteStart = APP.indexOf("function QuoteBuilder");
const invoiceStart = APP.indexOf("function InvoiceBuilder");
const invoiceEnd = APP.indexOf("function PaymentSheet", invoiceStart);
const QUOTE = APP.slice(quoteStart, invoiceStart);
const INVOICE = APP.slice(invoiceStart, invoiceEnd);

describe("shared row + sheet components", () => {
  test("row and sheet components exist; the sheet is a BottomSheet holding the existing ClientPicker", () => {
    expect(rowStart).toBeGreaterThan(-1);
    expect(sheetStart).toBeGreaterThan(rowStart);
    expect(SHEET).toContain("<BottomSheet");
    expect(SHEET).toContain("<ClientPicker");
    // Same picker wiring contract as the old form heads: typing unlinks.
    expect(SHEET).toContain("onValueChange={onValueChange}");
    expect(SHEET).toContain("onPick={onPick}");
  });

  test("row summarizes the selection: name + first of address/phone/email, chevron", () => {
    expect(ROW).toContain('className="doc-client-row"');
    expect(ROW).toContain("[jobAddress, clientPhone, clientEmail]");
    expect(ROW).toContain("<strong>{clientName}</strong>");
    expect(ROW).toContain('className="doc-client-chevron"');
  });

  test("row empty state is explicit and carries the required marker, EN + ES", () => {
    expect(ROW).toContain('"No client selected"');
    expect(ROW).toContain('"Sin cliente seleccionado"');
    expect(ROW).toContain('className="doc-client-required"');
    expect(ROW).toContain('"Cliente" : "Client"');
  });

  test("sheet carries every document-level field the name field + details section had", () => {
    for (const field of ["clientName", "clientPhone", "clientEmail", "jobType", "jobAddress", "shippingAddress"]) {
      expect(SHEET).toContain(`onPatch({ ${field}:`);
    }
    expect(SHEET).toContain("{t.client} *");
    expect(SHEET).toContain("{t.phone}");
    expect(SHEET).toContain("{t.email}");
    expect(SHEET).toContain("{t.type}");
  });

  test("sheet keeps the settings gates for the two address fields, EN + ES labels", () => {
    expect(SHEET).toContain("settings?.addJobSiteAddress !== false");
    expect(SHEET).toContain("settings?.addShippingAddress &&");
    expect(SHEET).toContain('"Job site address"');
    expect(SHEET).toContain('"Dirección del trabajo"');
    expect(SHEET).toContain('"Shipping address"');
    expect(SHEET).toContain('"Dirección de envío"');
  });

  test("sheet never writes a client record — it only patches builder form state", () => {
    expect(SHEET).not.toContain("saveClient");
    expect(SHEET).not.toContain("updateClient");
    // 0081: the sheet READS the client list (api.listClients) to offer the
    // picked client's saved addresses, and the append opt-in lives in the
    // sheet as a checkbox — but the append call itself is fired by the
    // BUILDERS after a successful save, never from inside the sheet.
    expect(SHEET).not.toContain("appendClientAddress");
    expect(SHEET).toContain("api.listClients");
  });
});

describe("builders use the row, not the trio", () => {
  test("QuoteBuilder: row + sheet mounted, trio gone from the form head", () => {
    expect(QUOTE).toContain("<DocClientRow");
    expect(QUOTE).toContain("<DocClientSheet");
    expect(QUOTE).not.toContain("<ClientPicker");
    expect(QUOTE).not.toContain("Client details");
    expect(QUOTE).not.toContain("Detalles del cliente");
  });

  test("InvoiceBuilder: row + sheet mounted, trio gone from the form head", () => {
    expect(INVOICE).toContain("<DocClientRow");
    expect(INVOICE).toContain("<DocClientSheet");
    expect(INVOICE).not.toContain("<ClientPicker");
    expect(INVOICE).not.toContain("Client details");
    expect(INVOICE).not.toContain("Detalles del cliente");
  });

  test("both builders gate the exit-and-save Escape handler on the sheet being closed", () => {
    expect(QUOTE).toContain("!previewOpen && !clientSheetOpen, exitAndSave");
    expect(INVOICE).toContain("editingItem === null && !clientSheetOpen, exitAndSave");
  });
});

describe("save semantics preserved bit-for-bit", () => {
  test("picking still snapshots id + name/phone/email/address into the form (both builders)", () => {
    expect(QUOTE).toContain("clientId: c.id");
    expect(QUOTE).toContain("clientPhone: c.phone");
    expect(QUOTE).toContain("clientEmail: c.email");
    expect(QUOTE).toContain("jobAddress: c.address");
    expect(INVOICE).toContain("clientId: client.id");
    expect(INVOICE).toContain("clientPhone: client.phone");
    expect(INVOICE).toContain("clientEmail: client.email");
    expect(INVOICE).toContain("jobAddress: client.address");
  });

  test("typing a name still unlinks (clientId: null) in both builders", () => {
    // 0081: typing also resets the sheet's save-to-profile opt-in.
    expect(QUOTE).toContain("onValueChange={(clientName) => { setSaveAddrToClient(false); setForm({ ...form, clientId: null, clientName }); }}");
    expect(INVOICE).toContain("onValueChange={(clientName) => { setSaveAddrToClient(false); setForm({ ...form, clientId: null, clientName }); }}");
  });

  test("saves still send the whole form (clientId + snapshot fields ride along)", () => {
    expect(QUOTE).toContain("api.saveQuote({");
    expect(QUOTE).toContain("...form,");
    expect(INVOICE).toContain("api.saveInvoice({ ...form,");
  });

  test("required client-name validation still fires at save time in both builders", () => {
    expect(QUOTE).toContain("if (!form.clientName.trim() || validLineItems().length === 0)");
    expect(QUOTE).toContain("form.clientName.trim().length > 0");
    expect(INVOICE).toContain("if (!form.clientName.trim() || !validItems.length)");
    expect(INVOICE).toContain("if (form.clientName.trim() && validItems.length)");
  });
});

describe("row styling", () => {
  test("the row is a real tappable card in the app's card language", () => {
    const ruleStart = CSS.indexOf(".doc-client-row {");
    expect(ruleStart).toBeGreaterThan(-1);
    const rule = CSS.slice(ruleStart, CSS.indexOf("}", ruleStart));
    expect(rule).toContain("border: 1px solid var(--border)");
    expect(rule).toContain("background: var(--surface)");
    expect(rule).toContain("border-radius: 14px");
    expect(rule).toContain("cursor: pointer");
  });

  test("sheet form reset mirrors the other builder sheets", () => {
    expect(CSS).toContain(".doc-client-sheet .compact-form { border: 0; margin: 0; padding: 0; }");
  });
});
