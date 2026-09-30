// vCard contact-import fallback — used by the "Pick from contacts" fallback
// sheet on browsers without the Contact Picker API (e.g. Samsung Internet,
// which does not expose navigator.contacts). Pure parser: no DOM, no React.
// Handles vCard 2.1 bare-param style (TEL;CELL:) and 3.0/4.0 style
// (TEL;TYPE=CELL:), line unfolding, and quoted-printable decoding.

export interface VCardContact {
  name: string;
  phone: string;
  email: string;
  address: string;
}

interface VCardProp {
  value: string;
  types: Set<string>;
}

/** Merge folded lines (continuation lines start with a space or tab). */
function unfold(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const out: string[] = [];
  for (const line of normalized.split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function decodeQuotedPrintable(value: string, charset: string): string {
  const noSoftBreaks = value.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  let text = "";
  const flush = () => {
    if (bytes.length === 0) return;
    try {
      text += new TextDecoder(charset || "utf-8", { fatal: false }).decode(new Uint8Array(bytes));
    } catch {
      text += new TextDecoder("utf-8").decode(new Uint8Array(bytes));
    }
    bytes.length = 0;
  };
  for (let i = 0; i < noSoftBreaks.length; i++) {
    const ch = noSoftBreaks[i];
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(noSoftBreaks.slice(i + 1, i + 3))) {
      bytes.push(parseInt(noSoftBreaks.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    flush();
    text += ch;
  }
  flush();
  return text;
}

interface ParsedLine {
  name: string;
  types: Set<string>;
  quotedPrintable: boolean;
  charset: string;
  value: string;
}

function parseLine(line: string): ParsedLine | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const rawValue = line.slice(colon + 1);
  const parts = left.split(";");
  const name = (parts[0] ?? "").trim().toUpperCase();
  if (!name) return null;
  const types = new Set<string>();
  let quotedPrintable = false;
  let charset = "";
  for (const raw of parts.slice(1)) {
    const token = raw.trim();
    if (!token) continue;
    const eq = token.indexOf("=");
    if (eq >= 0) {
      const key = token.slice(0, eq).trim().toUpperCase();
      const vals = token
        .slice(eq + 1)
        .split(",")
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean);
      if (key === "TYPE") {
        vals.forEach((v) => types.add(v));
      } else if (key === "ENCODING") {
        if (vals.includes("QUOTED-PRINTABLE") || vals.includes("QP")) quotedPrintable = true;
      } else if (key === "CHARSET") {
        charset = vals[0] ?? "";
      } else if (key.length > 0 && vals.length === 0) {
        types.add(key);
      }
    } else {
      const up = token.toUpperCase();
      if (up === "QUOTED-PRINTABLE" || up === "QP") {
        quotedPrintable = true;
      } else {
        // vCard 2.1 bare style: TEL;CELL: / TEL;HOME;VOICE:
        types.add(up);
      }
    }
  }
  return { name, types, quotedPrintable, charset, value: rawValue };
}

/** Unescape vCard text escapes (\n, \, \; and \\). */
function unescapeText(value: string): string {
  return value
    .replace(/\\\\/g, "\u0000")
    .replace(/\\[nN]/g, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\u0000/g, "\\");
}

/**
 * Parse the first vCard found in `text`. Returns null when the text is not a
 * vCard or yields no usable contact fields.
 */
export function parseVCard(text: string): VCardContact | null {
  if (!text || !/BEGIN:VCARD/i.test(text)) return null;
  const props = new Map<string, VCardProp[]>();
  for (const line of unfold(text)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    let value = parsed.value;
    if (parsed.quotedPrintable) value = decodeQuotedPrintable(value, parsed.charset);
    value = unescapeText(value).trim();
    const list = props.get(parsed.name) ?? [];
    list.push({ value, types: parsed.types });
    props.set(parsed.name, list);
  }
  const first = (name: string): string => props.get(name)?.[0]?.value ?? "";

  // Name: FN, falling back to N (Family;Given;Middle;Prefix;Suffix).
  let name = first("FN");
  if (!name) {
    const n = first("N");
    if (n) {
      const parts = n.split(";");
      name = [parts[1] ?? "", parts[0] ?? ""].map((s) => s.trim()).filter(Boolean).join(" ");
    }
  }

  // Phone: prefer CELL/MOBILE, otherwise the first number.
  const tels = props.get("TEL") ?? [];
  const mobile = tels.find((t) => t.types.has("CELL") || t.types.has("MOBILE"));
  const phone = (mobile ?? tels[0])?.value ?? "";

  const email = first("EMAIL");

  // ADR: POBox;Extended;Street;Locality;Region;Postal;Country.
  let address = "";
  const adr = first("ADR");
  if (adr) {
    const fields = adr.split(";");
    address = [fields[2] ?? "", fields[3] ?? "", fields[4] ?? "", fields[5] ?? ""]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");
  }

  const contact: VCardContact = {
    name: name.trim(),
    phone: phone.trim(),
    email: email.trim(),
    address: address.trim(),
  };
  if (!contact.name && !contact.phone && !contact.email && !contact.address) return null;
  return contact;
}
