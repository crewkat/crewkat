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
