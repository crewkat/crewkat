// Danny 2026-09-30: "Pick from contacts" must work for everyone, not just
// Chrome/Edge users — Samsung Internet (default on Galaxy phones) never
// exposes navigator.contacts. Static assertions: the button shows on all
// Android, the fallback sheet offers "Open in Chrome" (intent deep link)
// and .vcf import, and ?newClient=1 lands on the New Client form.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const VCARD = readFileSync(join(import.meta.dir, "client/src/vcard.ts"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

describe("contacts button visibility", () => {
  test("button shows on all Android via UA, not gated on navigator.contacts", () => {
    expect(APP).toContain("showContactsButton()");
    expect(APP).toMatch(/\/Android\/i\.test\(navigator\.userAgent/);
  });

  test("native picker path is still preferred when available", () => {
    expect(APP).toContain("hasNativeContactPicker");
    expect(APP).toContain("nav.contacts?.select");
  });
});

describe("contacts fallback sheet", () => {
  test("uses the shared BottomSheet with compact styling", () => {
    expect(APP).toContain("contactsFallbackOpen");
    expect(APP).toContain("<BottomSheet");
    expect(APP).toContain("t.contactsFallbackTitle");
    expect(APP).toContain("t.contactsFallbackBody");
    expect(CSS).toContain(".contacts-fallback");
  });

  test("Open in Chrome builds an intent:// URL from the live host", () => {
    expect(APP).toContain("t.openInChrome");
    expect(APP).toContain("package=com.android.chrome");
    expect(APP).toContain("window.location.host");
    expect(APP).toContain("#Intent;scheme=https;");
  });

  test("vCard file import is wired with .vcf accept", () => {
    expect(APP).toContain("t.chooseVCardFile");
    expect(APP).toContain('accept=".vcf,text/vcard"');
    expect(APP).toContain("parseVCard(await file.text())");
  });

  test("vcard parser module exposes parseVCard", () => {
    expect(VCARD).toContain("export function parseVCard");
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
  for (const [lang, title, chrome] of [
    ["en", "Add from contacts", "Open in Chrome"],
    ["es", "Agregar desde contactos", "Abrir en Chrome"],
  ] as const) {
    test(`${lang} copy present`, () => {
      expect(APP).toContain(`contactsFallbackTitle: "${title}"`);
      expect(APP).toContain(`openInChrome: "${chrome}"`);
      expect(APP).toContain("contactsFallbackBody:");
      expect(APP).toContain("chooseVCardFile:");
    });
  }
});
