// Danny 2026-10-11: the 2026-10-01 decision is reversed — "Pick from contacts"
// was a dead end (toast only) on browsers without the Contact Picker API
// (installed TWA / Samsung Internet). Now a missing API opens a shared
// fallback bottom sheet: Open in Chrome (intent:// + ?newClient=1),
// Import vCard (.vcf), Type manually. Static assertions on the new behavior.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

describe("contacts button visibility", () => {
  test("button shows on all Android via UA, not gated on navigator.contacts", () => {
    expect(APP).toContain("showContactsButton()");
    expect(APP).toMatch(/\/Android\/i\.test\(navigator\.userAgent/);
  });
});

describe("contacts picker — native first, fallback sheet when API missing", () => {
  test("pickFromContacts calls navigator.contacts.select directly when available", () => {
    expect(APP).toContain("const pickFromContacts = async () => {");
    expect(APP).toContain("contacts?.select");
    expect(APP).toContain('await selectContact(["name", "email", "tel", "address"]');
  });

  test("missing API opens the shared fallback sheet instead of the dead-end toast", () => {
    expect(APP).toContain("function ContactFallbackSheet(");
    expect(APP).toContain("setFallbackOpen(true)");
    // The sheet is rendered once, inside ClientForm, wired to the form.
    expect(APP).toContain("<ContactFallbackSheet");
    expect(APP).toContain("onImport={importContact}");
  });

  test("sheet offers Open in Chrome via intent link with ?newClient=1", () => {
    expect(APP).toContain("package=com.android.chrome");
    expect(APP).toContain("intent://crewkat.com/app?newClient=1");
    expect(APP).toContain("t.openInChrome");
  });

  test("sheet offers vCard import backed by the shared parser", () => {
    expect(APP).toContain('import { parseVCard, type VCardContact } from "./vcard"');
    expect(APP).toContain('accept=".vcf,text/vcard"');
    expect(APP).toContain("parseVCard(text)");
    expect(APP).toContain("t.importVCard");
  });

  test("vCard import fills the form and notes multi-contact files", () => {
    expect(APP).toContain("const importContact = (contact: VCardContact, multiple: boolean) => {");
    expect(APP).toContain("t.vcardFirstUsed");
    expect(APP).toContain("t.contactImported");
  });

  test("sheet offers type-manually which just dismisses", () => {
    expect(APP).toContain("t.typeManually");
  });

  test("user dismissing the native picker (AbortError) stays silent", () => {
    expect(APP).toContain('"AbortError"');
  });

  test("genuine picker failures still show the brief toast", () => {
    expect(APP).toContain("showUndoToast(t.contactsUnavailable, t.close, () => {}, 3500)");
  });

  test("fallback sheet has dialog semantics and backdrop dismiss", () => {
    expect(APP).toContain("contacts-fallback-sheet");
    expect(APP).toContain('role="dialog"');
  });

  test("sheet styles present in theme", () => {
    expect(CSS).toContain(".contacts-fallback-sheet");
    expect(CSS).toContain(".opt-sub");
  });
});

describe("newClient deep link", () => {
  test("?newClient=1 opens the New Client form and clears the param", () => {
    expect(APP).toContain('params.get("newClient") === "1"');
    expect(APP).toContain('{ name: "clients" }, { name: "clientNew" }');
    expect(APP).toContain('params.delete("newClient")');
    expect(APP).toContain("window.history.replaceState");
  });
});

describe("contacts fallback copy (en + es)", () => {
  for (const [lang, key, text] of [
    ["en", "contactsSheetTitle", "Add from contacts"],
    ["es", "contactsSheetTitle", "Agregar desde contactos"],
    ["en", "openInChrome", "Open in Chrome"],
    ["es", "openInChrome", "Abrir en Chrome"],
    ["en", "importVCard", "Import vCard (.vcf)"],
    ["es", "importVCard", "Importar vCard (.vcf)"],
    ["en", "typeManually", "Type it manually"],
    ["es", "typeManually", "Escribir manualmente"],
    ["en", "contactImported", "Contact imported"],
    ["es", "contactImported", "Contacto importado"],
    ["en", "vcardReadFailed", "Couldn't read that contact file"],
    ["es", "vcardReadFailed", "No se pudo leer ese archivo"],
  ] as const) {
    test(`${lang} ${key} present`, () => {
      expect(APP).toContain(`${key}: "${text}"`);
    });
  }
});
