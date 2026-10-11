// Danny 2026-10-11: Web Share Target ("share into Crewkat") — sharing a
// contact from the phone's Contacts app should surface Crewkat in the Android
// share menu and land on the New Client form prefilled. The Contact Picker API
// doesn't exist inside the installed TWA, and Danny rejected the Google People
// API, so the share target is the no-permission, no-native-code path.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseVCard } from "./client/src/vcard";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const SW = readFileSync(join(import.meta.dir, "client/pwa/sw.js"), "utf8");
const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dir, "client/pwa/manifest.webmanifest"), "utf8")
);

describe("manifest share_target", () => {
  test("declares a POST share target within the /app/ scope", () => {
    const st = MANIFEST.share_target;
    expect(st).toBeDefined();
    expect(st.action).toBe("/app/share-contact");
    expect(st.method).toBe("POST");
    expect(st.enctype).toBe("multipart/form-data");
  });

  test("accepts vCard files plus plain-text shares", () => {
    const st = MANIFEST.share_target;
    const files = st.params.files ?? [];
    expect(files.length).toBeGreaterThan(0);
    const accept = files[0].accept.join(" ").toLowerCase();
    expect(accept).toContain("text/vcard");
    expect(accept).toContain(".vcf");
    expect(st.params.text).toBeDefined();
  });
});

describe("service worker share interception", () => {
  test("intercepts POST /app/share-contact before the GET-only gate", () => {
    expect(SW).toContain('"/app/share-contact"');
    expect(SW).toContain('request.method === "POST"');
    // The interception must be registered before the early return for
    // non-GET requests, or the share POST would fall through.
    const interceptAt = SW.indexOf('"/app/share-contact"');
    const getGateAt = SW.indexOf('if (request.method !== "GET") return;');
    expect(interceptAt).toBeGreaterThan(-1);
    expect(getGateAt).toBeGreaterThan(-1);
    expect(interceptAt).toBeLessThan(getGateAt);
  });

  test("stashes the vCard and 303-redirects into the app without network", () => {
    expect(SW).toContain("crewkat-share-contact");
    expect(SW).toContain('Response.redirect("/app/?sharedContact=1", 303)');
    expect(SW).toContain("request.formData()");
  });
});

describe("app boot ?sharedContact=1 handler", () => {
  test("reads the stash, parses the vCard, and opens the New Client form", () => {
    expect(APP).toContain('params.get("sharedContact")');
    expect(APP).toContain("crewkat-share-contact");
    expect(APP).toContain("parseVCard(text)");
    expect(APP).toContain('setScreenStack([{ name: "clients" }, { name: "clientNew" }])');
  });

  test("clears the stash and the URL param so refreshes don't reopen it", () => {
    expect(APP).toContain('stash.delete("/app/__shared-contact__")');
    expect(APP).toContain('params.delete("sharedContact")');
  });

  test("parse failure shows a toast (EN+ES) and still opens the blank form", () => {
    expect(APP).toContain("t.vcardReadFailed");
    // The navigation happens regardless of parse success.
    const handler = APP.slice(APP.indexOf('params.get("sharedContact")'));
    expect(handler).toContain("setScreenStack");
  });
});

describe("New Client prefill", () => {
  test("ClientForm consumes the shared contact once via lazy state init", () => {
    expect(APP).toContain("function consumeSharedContact()");
    expect(APP).toContain("crewkat-shared-contact");
    expect(APP).toContain("const shared = consumeSharedContact();");
  });

  test("shared fields prefill without clobbering user-typed values", () => {
    expect(APP).toContain("name: shared.name || initial.name");
    expect(APP).toContain("phone: shared.phone || initial.phone");
  });
});

describe("android-shared vCard parses end to end", () => {
  test("typical Contacts-app share (text/x-vcard 3.0) yields the client fields", () => {
    const shared = `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Bob Carter\r\nN:Carter;Bob;;;\r\nTEL;TYPE=CELL:+18135550377\r\nEMAIL;TYPE=HOME:bob.carter@example.com\r\nADR;TYPE=HOME:;;456 Oak St;Clearwater;FL;33755;USA\r\nEND:VCARD\r\n`;
    const contact = parseVCard(shared);
    expect(contact).not.toBeNull();
    expect(contact!.name).toBe("Bob Carter");
    expect(contact!.phone).toBe("+18135550377");
    expect(contact!.email).toBe("bob.carter@example.com");
    expect(contact!.address).toBe("456 Oak St, Clearwater, FL, 33755");
  });
});
