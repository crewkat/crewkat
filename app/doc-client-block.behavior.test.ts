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
    // 2026-10-18: the class became a template string so the missing-field
    // ring can append (" field-missing"); the base class is unchanged.
    expect(ROW).toContain('className={`doc-client-row');
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
    // Danny 2026-10-18: the old combined check (one generic message) is now
    // per-field flagMissing checks; the exit-and-save submittable checks are
    // untouched.
    expect(QUOTE).toContain("if (!form.clientName.trim()) { flagMissing(\"client\", t.builderNeedClient); return; }");
    expect(QUOTE).toContain("if (validLineItems().length === 0) { flagMissing(\"items\", t.builderNeedLine); return; }");
    expect(QUOTE).toContain("form.clientName.trim().length > 0");
    expect(INVOICE).toContain("if (!form.clientName.trim()) { flagMissing(\"client\", t.builderNeedClient); return; }");
    expect(INVOICE).toContain("if (!validItems.length) { flagMissing(\"items\", t.builderNeedLine); return; }");
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

// Client picker results readability (Danny, 2026-10-17, phone screenshots of
// the New Job form): each option's detail line (phone · email · address) was
// forced onto ONE nowrap line and clipped mid-word at the right edge, and the
// results box was short enough that rows sat half-cut at its edge. The shared
// ClientPicker renders in the New Job form and in DocClientSheet above, so
// these base-rule pins cover both.
describe("client picker results readability", () => {
  const pickerRule = (selector: string) => {
    const start = CSS.indexOf(selector);
    expect(start).toBeGreaterThan(-1);
    return CSS.slice(start, CSS.indexOf("}", start) + 1);
  };

  test("detail line wraps to two lines instead of the single-line squeeze", () => {
    const small = pickerRule(".client-picker-results small {");
    expect(small).toContain("-webkit-line-clamp: 2");
    expect(small).toContain("-webkit-box-orient: vertical");
    expect(small).toContain("line-height: 1.35");
    expect(small).toContain("overflow-wrap: anywhere");
    expect(small).not.toContain("white-space: nowrap");
  });

  test("results box is taller (60dvh) so more clients are visible at once", () => {
    const results = pickerRule(".client-picker-results {");
    expect(results).toContain("max-height:min(420px,60dvh)");
    expect(results).toContain("overflow-y:auto");
  });

  test("rows grow past the 58px floor; no fixed height caps them", () => {
    const button = pickerRule(".client-picker-results button {");
    expect(button).toContain("min-height: 58px");
    expect(button).toContain("align-content: start");
    expect(button).not.toMatch(/[;{]\s*height:/);
  });

  test("name line-height keeps the name from clipping", () => {
    expect(pickerRule(".client-picker-results strong {")).toContain("line-height: 1.25");
  });
});

// Builder missing-field marks (Danny, 2026-10-18, screenshot of New invoice):
// tapping Save with something missing showed only a generic pink bar —
// "Complete the required fields." — and nothing marked WHICH field. Both
// builders now mirror the contract signer's flagMissing pattern (d6610a8):
// the error bar names the first missing field, that field gets the red
// .field-missing ring, and it is scrolled into view. Marks exist only after
// a failed save and clear live from form state. The flagged set is exactly
// what can block a save: client name, a malformed client email (the server
// schemas reject it), and zero lines with a name/description — a blank line
// price never blocks (2026-10-12 rule; server amount has no minimum).
describe("builder missing-field marks (Danny 2026-10-18)", () => {
  test("specific messages exist for each blocking field, EN + ES", () => {
    expect(APP).toContain('builderNeedClient: "Add a client to continue."');
    expect(APP).toContain('builderNeedEmail: "That email doesn\'t look right."');
    expect(APP).toContain('builderNeedLine: "Give Item 1 a title."');
    expect(APP).toContain('builderNeedClient: "Agrega un cliente para continuar."');
    expect(APP).toContain('builderNeedEmail: "Ese correo no se ve bien."');
    expect(APP).toContain('builderNeedLine: "Ponle un título a la partida 1."');
  });

  test("the generic-only save gate is gone from both builders", () => {
    expect(QUOTE).not.toContain("setError(t.required)");
    expect(INVOICE).not.toContain("setError(t.required)");
    // The generic string itself survives for other forms (job, marketplace…).
    expect(APP).toContain('required: "Complete the required fields."');
  });

  test("flagMissing (mark + message + scroll) is wired in both builders", () => {
    for (const slice of [QUOTE, INVOICE]) {
      expect(slice).toContain("setMissing(field)");
      expect(slice).toContain('scrollIntoView({ behavior: "smooth", block: "center" })');
      expect(slice).toContain('flagMissing("email", t.builderNeedEmail)');
      expect(slice).toContain("clientRowRef");
      expect(slice).toContain("firstLineRef");
    }
  });

  test("the ring is applied from the missing-field state: client row + first line card", () => {
    expect(ROW).toContain('missing ? " field-missing" : ""');
    expect(ROW).toContain("rowRef");
    expect(QUOTE).toContain('missing={missing === "client" || missing === "email"}');
    expect(INVOICE).toContain('missing={missing === "client" || missing === "email"}');
    expect(QUOTE).toContain('missing === "items" && i === 0 ? " field-missing"');
    expect(INVOICE).toContain('missing === "items" && index === 0 ? " field-missing"');
    expect(QUOTE).toContain("ref={i === 0 ? firstLineRef : undefined}");
    expect(INVOICE).toContain("ref={index === 0 ? firstLineRef : undefined}");
  });

  test("marks clear live from form state once the field is fixed", () => {
    expect(QUOTE).toContain('if (missing === "client" && form.clientName.trim()) { setMissing(""); setError(""); }');
    expect(QUOTE).toContain('else if (missing === "items" && validLineItems().length > 0) { setMissing(""); setError(""); }');
    expect(INVOICE).toContain('if (missing === "client" && form.clientName.trim()) { setMissing(""); setError(""); }');
    expect(INVOICE).toContain('else if (missing === "items" && validItems.length > 0) { setMissing(""); setError(""); }');
    // Email mark clears when the address is emptied or made valid.
    expect(QUOTE).toContain('else if (missing === "email" && clientEmailValid)');
    expect(INVOICE).toContain('else if (missing === "email" && clientEmailValid)');
  });

  test("a blank line price is not part of the gate (title/description only)", () => {
    // The usable-line rule stays name-or-description; amount is never read
    // by either builder's missing-field checks.
    expect(QUOTE).toContain("i.description.trim() || (i.name ?? \"\").trim()");
    expect(INVOICE).toContain("item.name.trim() || item.description.trim()");
    expect(QUOTE).not.toContain('flagMissing("amount"');
    expect(INVOICE).not.toContain('flagMissing("amount"');
  });

  test("the ring style matches the signer's danger ring", () => {
    const start = CSS.indexOf(".doc-client-row.field-missing");
    expect(start).toBeGreaterThan(-1);
    const rule = CSS.slice(start, CSS.indexOf("}", start) + 1);
    expect(rule).toContain(".doc-line-card.field-missing");
    expect(rule).toContain("border-color: var(--danger)");
    expect(rule).toContain("box-shadow: 0 0 0 3px");
  });
});
