// Signature placement + compositing for uploaded-PDF documents
// (DocuSign-style fields, Danny 2026-10-14).
//
// An uploaded document can carry up to four placed fields, stored as JSON
// on the document row: a signature box and a date box for each role
// (client / contractor). Coordinates are page-relative fractions measured
// from the page's TOP-LEFT corner, so they survive any page size:
//   { page: 1-based, xPct, yPct: top-left corner, wPct, hPct: box size }.
// When a party signs and no field was placed for them, the stamp falls
// back to the bottom area of the LAST page (signature left-of-center,
// contractor right-of-center, date beside its signature).
//
// The final signed PDF for an uploaded document is always the ORIGINAL
// pages with the stamps drawn on — never an appended summary page.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface SignatureFieldPlacement {
  page: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface SignatureFields {
  clientSignature?: SignatureFieldPlacement;
  clientDate?: SignatureFieldPlacement;
  contractorSignature?: SignatureFieldPlacement;
  contractorDate?: SignatureFieldPlacement;
}

export type SignatureRole = "client" | "contractor";

const PLACEMENT_KEYS = ["clientSignature", "clientDate", "contractorSignature", "contractorDate"] as const;

function cleanPlacement(value: unknown): SignatureFieldPlacement | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : NaN);
  const page = num(v.page);
  const xPct = num(v.xPct);
  const yPct = num(v.yPct);
  const wPct = num(v.wPct);
  const hPct = num(v.hPct);
  if (!Number.isInteger(page) || page < 1) return undefined;
  if ([xPct, yPct, wPct, hPct].some((n) => Number.isNaN(n))) return undefined;
  if (xPct < 0 || yPct < 0 || wPct <= 0 || hPct <= 0 || xPct + wPct > 1.02 || yPct + hPct > 1.02) return undefined;
  return { page, xPct, yPct, wPct, hPct };
}

export function parseSignatureFields(json: string | null | undefined): SignatureFields {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const out: SignatureFields = {};
    for (const key of PLACEMENT_KEYS) {
      const placement = cleanPlacement(raw[key]);
      if (placement) out[key] = placement;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeSignatureFields(fields: SignatureFields): string {
  const out: SignatureFields = {};
  for (const key of PLACEMENT_KEYS) {
    const placement = fields[key] ? cleanPlacement(fields[key]) : undefined;
    if (placement) out[key] = placement;
  }
  return JSON.stringify(out);
}

export const SIGNATURE_FIELD_DEFAULTS = {
  signature: { wPct: 0.3, hPct: 0.075 },
  date: { wPct: 0.22, hPct: 0.05 },
} as const;

/** Fallback signature box: bottom area of the last page. The two roles sit
 * side by side so unplaced dual signatures never overlap. */
export function defaultSignatureField(pageCount: number, role: SignatureRole): SignatureFieldPlacement {
  return {
    page: Math.max(1, pageCount),
    xPct: role === "client" ? 0.07 : 0.56,
    yPct: 0.85,
    wPct: SIGNATURE_FIELD_DEFAULTS.signature.wPct,
    hPct: SIGNATURE_FIELD_DEFAULTS.signature.hPct,
  };
}

/** Fallback date box: directly under its signature box. */
export function defaultDateField(signatureField: SignatureFieldPlacement): SignatureFieldPlacement {
  return {
    page: signatureField.page,
    xPct: signatureField.xPct,
    yPct: Math.min(0.95, signatureField.yPct + signatureField.hPct + 0.012),
    wPct: SIGNATURE_FIELD_DEFAULTS.date.wPct,
    hPct: SIGNATURE_FIELD_DEFAULTS.date.hPct,
  };
}

/** The date box that pairs with a signature box: the placed one if any,
 * otherwise under a placed signature, otherwise the pair default. */
export function resolveDateField(
  fields: SignatureFields,
  role: SignatureRole,
  pageCount: number,
): SignatureFieldPlacement {
  const placed = role === "client" ? fields.clientDate : fields.contractorDate;
  if (placed) return { ...placed, page: Math.min(placed.page, Math.max(1, pageCount)) };
  const signature = resolveSignatureField(fields, role, pageCount);
  return defaultDateField(signature);
}

export function resolveSignatureField(
  fields: SignatureFields,
  role: SignatureRole,
  pageCount: number,
): SignatureFieldPlacement {
  const placed = role === "client" ? fields.clientSignature : fields.contractorSignature;
  if (placed) return { ...placed, page: Math.min(placed.page, Math.max(1, pageCount)) };
  return defaultSignatureField(pageCount, role);
}

export interface SignatureStamp {
  role: SignatureRole;
  /** Drawn signature image bytes (PNG or JPEG). */
  imageBytes?: Uint8Array;
  imageFormat?: "png" | "jpg";
  /** Pre-formatted date text stamped in the role's date box. */
  dateText?: string;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Draw every stamp onto the original PDF pages and return the new bytes.
 * A stamp draws its signature image (aspect preserved, fitted inside the
 * box) and/or its date text. Pages referenced past the end clamp to the
 * last page. Throws only when the source is not a loadable PDF.
 */
export async function compositeSignatureStamps(
  originalBytes: Uint8Array | ArrayBuffer,
  fields: SignatureFields,
  stamps: SignatureStamp[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(originalBytes);
  const pageCount = pdf.getPageCount();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const stamp of stamps) {
    const field = resolveSignatureField(fields, stamp.role, pageCount);
    const page = pdf.getPage(field.page - 1);
    const { width: pageW, height: pageH } = page.getSize();
    const boxX = clamp01(field.xPct) * pageW;
    const boxW = clamp01(field.wPct) * pageW;
    const boxH = clamp01(field.hPct) * pageH;
    // pdf-lib's origin is bottom-left; placements are measured from the top.
    const boxTopY = pageH - clamp01(field.yPct) * pageH;
    if (stamp.imageBytes && stamp.imageBytes.length > 0) {
      const image = stamp.imageFormat === "jpg"
        ? await pdf.embedJpg(stamp.imageBytes)
        : await pdf.embedPng(stamp.imageBytes);
      const scale = Math.min(boxW / image.width, boxH / image.height);
      const drawW = image.width * scale;
      const drawH = image.height * scale;
      page.drawImage(image, {
        x: boxX + (boxW - drawW) / 2,
        y: boxTopY - boxH + (boxH - drawH) / 2,
        width: drawW,
        height: drawH,
      });
    }
    if (stamp.dateText) {
      const dateField = resolveDateField(fields, stamp.role, pageCount);
      const datePage = pdf.getPage(dateField.page - 1);
      const size = datePage.getSize();
      const dW = clamp01(dateField.wPct) * size.width;
      const dH = clamp01(dateField.hPct) * size.height;
      const dX = clamp01(dateField.xPct) * size.width;
      const dTopY = size.height - clamp01(dateField.yPct) * size.height;
      const fontSize = Math.max(6, Math.min(14, dH * 0.55));
      datePage.drawText(stamp.dateText, {
        x: dX,
        y: dTopY - dH + (dH - fontSize) / 2,
        size: fontSize,
        font,
        color: rgb(0.09, 0.13, 0.12),
        maxWidth: dW,
      });
    }
  }
  return pdf.save();
}

// ---------------------------------------------------------------------------
// Fill-in fields (0082, Danny 2026-10-17): DocuSign-style TEXT / INITIALS /
// CHECKBOX fields the sender places on an uploaded PDF alongside the
// signature fields. Definitions live on the document row as a JSON array
// (documents.fill_fields_json); the values a signer enters live in
// documents.fill_values_json. Contractor-role fields carry their answer as
// a prefill ON the definition (value / checked) — the sender fills them in
// the placement editor; client-role fields are filled on the public sign
// page and their values arrive with the signature submission.
// Coordinates use the same page-relative, top-left-origin fractions as the
// signature placements above.

export type FillFieldKind = "text" | "initials" | "checkbox";
export type FillFieldRole = "client" | "contractor";

export interface FillField {
  id: string;
  kind: FillFieldKind;
  role: FillFieldRole;
  label: string;
  required: boolean;
  page: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  /** Contractor prefill for text / initials fields. */
  value?: string;
  /** Contractor prefill for checkbox fields. */
  checked?: boolean;
}

/** Signer-supplied values, keyed by field id. */
export type FillValues = Record<string, string | boolean>;

export const MAX_FILL_FIELDS = 30;
const FILL_FIELD_ID_RE = /^[a-z0-9-]{1,40}$/;
const FILL_KINDS: readonly FillFieldKind[] = ["text", "initials", "checkbox"];
const FILL_ROLES: readonly FillFieldRole[] = ["client", "contractor"];

export const FILL_KIND_DEFAULT_LABELS: Record<FillFieldKind, string> = {
  text: "Text field",
  initials: "Initials",
  checkbox: "Checkbox",
};

function cleanFillField(value: unknown): FillField | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === "string" ? v.id : "";
  if (!FILL_FIELD_ID_RE.test(id)) return undefined;
  const kind = FILL_KINDS.includes(v.kind as FillFieldKind) ? (v.kind as FillFieldKind) : undefined;
  if (!kind) return undefined;
  const role = FILL_ROLES.includes(v.role as FillFieldRole) ? (v.role as FillFieldRole) : undefined;
  if (!role) return undefined;
  const placement = cleanPlacement(v);
  if (!placement) return undefined;
  const labelRaw = typeof v.label === "string" ? v.label.trim().slice(0, 80) : "";
  const label = labelRaw || FILL_KIND_DEFAULT_LABELS[kind];
  const required = typeof v.required === "boolean" ? v.required : kind !== "checkbox";
  const out: FillField = { id, kind, role, label, required, ...placement };
  if (typeof v.value === "string" && v.value.length > 0) out.value = v.value.slice(0, 500);
  if (typeof v.checked === "boolean") out.checked = v.checked;
  return out;
}

export function parseFillFields(json: string | null | undefined): FillField[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    const out: FillField[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
      const field = cleanFillField(entry);
      if (!field || seen.has(field.id)) continue;
      seen.add(field.id);
      out.push(field);
      if (out.length >= MAX_FILL_FIELDS) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeFillFields(fields: FillField[]): string {
  const out: FillField[] = [];
  const seen = new Set<string>();
  for (const entry of fields ?? []) {
    const field = cleanFillField(entry);
    if (!field || seen.has(field.id)) continue;
    seen.add(field.id);
    out.push(field);
    if (out.length >= MAX_FILL_FIELDS) break;
  }
  return JSON.stringify(out);
}

export function parseFillValues(json: string | null | undefined): FillValues {
  if (!json) return {};
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: FillValues = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key.length > 40) continue;
      if (typeof value === "string") {
        if (value.length > 500) continue;
        out[key] = value;
      } else if (typeof value === "boolean") {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** The value a field effectively carries: the signer's stored value when
 * present, otherwise the sender's prefill on the definition. */
export function resolveFillValue(field: FillField, values: FillValues): string | boolean | undefined {
  if (Object.prototype.hasOwnProperty.call(values, field.id)) return values[field.id];
  return field.kind === "checkbox" ? field.checked : field.value;
}

// pdf-lib's standard Helvetica encodes WinAnsi only; drawing a character
// outside it throws. Keep the WinAnsi-printable set and drop the rest so a
// pasted emoji in a fill value can never break the signed PDF.
function winAnsiSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      [0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2013, 0x2014, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122].includes(code)
    ) {
      out += ch;
    }
  }
  return out;
}

/**
 * Draw fill-field values onto PDF pages and return the new bytes.
 * Text/initials render in Helvetica, sized to the box and shrunk to fit;
 * a checked checkbox gets a two-stroke check mark. Fields pointing past
 * the last page are skipped (mirrors the sign page's page count safety).
 */
export async function compositeFillFields(
  pdfBytes: Uint8Array | ArrayBuffer,
  fields: FillField[],
  values: FillValues,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  const pageCount = pdf.getPageCount();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.09, 0.13, 0.12);
  for (const field of fields) {
    if (field.page < 1 || field.page > pageCount) continue;
    const effective = resolveFillValue(field, values);
    if (effective === undefined || effective === "") continue;
    const page = pdf.getPage(field.page - 1);
    const { width: pageW, height: pageH } = page.getSize();
    const boxX = clamp01(field.xPct) * pageW;
    const boxW = clamp01(field.wPct) * pageW;
    const boxH = clamp01(field.hPct) * pageH;
    // pdf-lib's origin is bottom-left; placements are measured from the top.
    const boxBottomY = pageH - (clamp01(field.yPct) + clamp01(field.hPct)) * pageH;
    if (field.kind === "checkbox") {
      if (effective !== true) continue;
      const thickness = Math.max(1.5, boxW * 0.06);
      const x1 = boxX + boxW * 0.2;
      const y1 = boxBottomY + boxH * 0.42;
      const x2 = boxX + boxW * 0.42;
      const y2 = boxBottomY + boxH * 0.18;
      const x3 = boxX + boxW * 0.82;
      const y3 = boxBottomY + boxH * 0.8;
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color: ink });
      page.drawLine({ start: { x: x2, y: y2 }, end: { x: x3, y: y3 }, thickness, color: ink });
      continue;
    }
    const text = winAnsiSafe(String(effective)).trim();
    if (!text) continue;
    let fontSize = Math.min(boxH * 0.62, 16);
    const maxWidth = Math.max(1, boxW - 4);
    while (fontSize > 6 && font.widthOfTextAtSize(text, fontSize) > maxWidth) fontSize -= 0.5;
    if (font.widthOfTextAtSize(text, fontSize) > maxWidth) {
      // Extremely long value in a tiny box: draw at the floor size and let
      // pdf-lib clip via maxWidth rather than dropping the value entirely.
    }
    page.drawText(text, {
      x: boxX + 2,
      y: boxBottomY + boxH * 0.28,
      size: fontSize,
      font,
      color: ink,
      maxWidth,
    });
  }
  return pdf.save();
}
