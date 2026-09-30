// Unit tests for the vCard contact-import fallback parser (client/src/vcard.ts).
// Covers vCard 2.1 bare-param style, 3.0 TYPE= style, quoted-printable
// decoding, line unfolding, and missing/empty input.
import { describe, expect, test } from "bun:test";
import { parseVCard } from "./client/src/vcard";

const VCARD_30 = `BEGIN:VCARD
VERSION:3.0
FN:Maria Lopez
N:Lopez;Maria;;;
TEL;TYPE=CELL,VOICE:+18135550199
TEL;TYPE=HOME:+18135550100
EMAIL:maria.lopez@example.com
ADR;TYPE=HOME:;;123 Palm Ave;Tampa;FL;33602;USA
END:VCARD`;

const VCARD_21 = `BEGIN:VCARD
VERSION:2.1
N:Doe;John;;;
TEL;CELL:+18135550288
TEL;HOME;VOICE:+18135550289
EMAIL;HOME:john.doe@example.com
ADR;HOME:;;456 Oak St;Clearwater;FL;33755;
END:VCARD`;

describe("parseVCard — vCard 3.0", () => {
  test("extracts name, mobile phone, email, and address", () => {
    const c = parseVCard(VCARD_30);
    expect(c).not.toBeNull();
    expect(c!.name).toBe("Maria Lopez");
    expect(c!.phone).toBe("+18135550199");
    expect(c!.email).toBe("maria.lopez@example.com");
    expect(c!.address).toBe("123 Palm Ave, Tampa, FL, 33602");
  });
});

describe("parseVCard — vCard 2.1 bare params", () => {
  test("handles TEL;CELL style and falls back to N for the name", () => {
    const c = parseVCard(VCARD_21);
    expect(c).not.toBeNull();
    expect(c!.name).toBe("John Doe");
    expect(c!.phone).toBe("+18135550288");
    expect(c!.email).toBe("john.doe@example.com");
    expect(c!.address).toBe("456 Oak St, Clearwater, FL, 33755");
  });
});

describe("parseVCard — quoted-printable", () => {
  test("decodes a QP-encoded FN", () => {
    const vcard = `BEGIN:VCARD
VERSION:2.1
FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=4A=6F=68=6E=20=44=6F=65
TEL;CELL:+18135550377
END:VCARD`;
    const c = parseVCard(vcard);
    expect(c).not.toBeNull();
    expect(c!.name).toBe("John Doe");
    expect(c!.phone).toBe("+18135550377");
  });

  test("decodes non-ASCII QP bytes as UTF-8", () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Garc=C3=ADa
END:VCARD`;
    expect(parseVCard(vcard)?.name).toBe("José García");
  });
});

describe("parseVCard — unfolding and edge cases", () => {
  test("unfolds folded lines", () => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:Alexandria Constanti
 nople-Smith
TEL:+18135550466
END:VCARD`;
    expect(parseVCard(vcard)?.name).toBe("Alexandria Constantinople-Smith");
  });

  test("keeps partial fields and leaves the rest empty", () => {
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:Solo Name\nEND:VCARD`;
    const c = parseVCard(vcard);
    expect(c).not.toBeNull();
    expect(c!.name).toBe("Solo Name");
    expect(c!.phone).toBe("");
    expect(c!.email).toBe("");
    expect(c!.address).toBe("");
  });

  test("returns null for non-vCard text and empty vCards", () => {
    expect(parseVCard("hello world")).toBeNull();
    expect(parseVCard("")).toBeNull();
    expect(parseVCard("BEGIN:VCARD\nVERSION:3.0\nEND:VCARD")).toBeNull();
  });
});
