// Danny 2026-10-01 (build0.4): "Pick from contacts" directly attempts the
// native Contact Picker. The "Open in Chrome" / vCard fallback sheet is gone:
// if the API is missing or fails, a brief toast says contacts aren't
// available and nothing else happens. Static assertions on the new behavior.
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

describe("contacts picker — direct attempt, no fallback sheet", () => {
  test("pickFromContacts calls navigator.contacts.select directly", () => {
    expect(APP).toContain("const pickFromContacts = async () => {");
    expect(APP).toContain("contacts?.select");
    expect(APP).toContain('await selectContact(["name", "email", "tel", "address"]');
  });

  test("missing API or failure shows a brief 'not available' toast and nothing else", () => {
    expect(APP).toContain("showUndoToast(t.contactsUnavailable, t.close, () => {}, 3500)");
    // The old fallback-sheet wiring is gone.
    expect(APP).not.toContain("contactsFallbackOpen");
    expect(APP).not.toContain("openInChrome");
    expect(APP).not.toContain("importVCardFile");
    expect(APP).not.toContain("hasNativeContactPicker");
    expect(APP).not.toContain("package=com.android.chrome");
  });

  test("user dismissing the picker (AbortError) stays silent", () => {
    expect(APP).toContain('"AbortError"');
  });

  test("fallback sheet styles removed from theme", () => {
    expect(CSS).not.toContain(".contacts-fallback");
    expect(CSS).not.toContain(".contacts-vcard-label");
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

describe("contacts unavailable copy (en + es)", () => {
  for (const [lang, text] of [
    ["en", "Contacts aren't available here"],
    ["es", "Los contactos no están disponibles aquí"],
  ] as const) {
    test(`${lang} copy present`, () => {
      expect(APP).toContain(`contactsUnavailable: "${text}"`);
    });
  }
});
