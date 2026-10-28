// Receipt OCR text parsing — deterministic heuristics that turn raw OCR
// text from a receipt photo into the fields the expense forms already use
// (vendor / amount / date). Pure and side-effect free so it can be unit
// tested in bun and reused by any OCR source (client or server) — the OCR
// engine lives in receiptOcr.ts; this module only reads text.
//
// Rules (kept deliberately simple and predictable):
//  - AMOUNT: a currency value on a line labelled total / amount due /
//    balance due wins (largest such value; "subtotal" and "total savings"
//    style lines don't count, cash/change lines never count). Otherwise
//    the largest currency value on the receipt. A "currency value" must
//    carry cents (57.18) so phone numbers, quantities and gallon counts
//    (12.483) never match.
//  - DATE: the first valid calendar date in the text — MM/DD/YYYY,
//    M/D/YY, MM-DD-YYYY, or "Oct 27, 2026" / "27 Oct 2026". Null when
//    none; the forms keep their own default (today) in that case.
//  - VENDOR: the first non-empty line that isn't a date line, an
//    amount-only line, a phone line, or an address/city line.

export interface ReceiptFields {
  amount: string | null;
  /** ISO yyyy-mm-dd, or null when the receipt shows no usable date. */
  date: string | null;
  vendor: string | null;
  /** Length of the trimmed raw OCR text — the UI's "couldn't read" cue. */
  rawLength: number;
}

/** The exact shape the expense/receipt forms hold before save. */
export interface ReceiptPrefill {
  vendor: string;
  amount: string;
  date: string;
}

const CURRENCY_RE = /(?<![\d.,])\$?\s*(\d{1,3}(?:,\d{3})+|\d{1,7})\.(\d{2})(?!\d)/g;
const TOTAL_LABEL_RE = /\b(grand\s+total|total\s+due|amount\s+due|balance\s+due|total)\b/i;
const TOTAL_EXCLUDE_RE = /subtotal|total\s+(savings|saved|items?|qty|quantity|discount|tax)/i;
const MONEY_LINE_EXCLUDE_RE = /\b(cash|change|tendered)\b/i;

function currencyValues(line: string): number[] {
  const values: number[] = [];
  for (const match of line.matchAll(CURRENCY_RE)) {
    const whole = (match[1] ?? "0").replace(/,/g, "");
    const value = Number(`${whole}.${match[2] ?? "00"}`);
    if (Number.isFinite(value) && value > 0) values.push(value);
  }
  return values;
}

function extractAmount(lines: string[]): string | null {
  let bestTotal: number | null = null;
  let bestAny: number | null = null;
  for (const line of lines) {
    if (MONEY_LINE_EXCLUDE_RE.test(line)) continue;
    const values = currencyValues(line);
    if (!values.length) continue;
    const lineMax = Math.max(...values);
    if (bestAny === null || lineMax > bestAny) bestAny = lineMax;
    if (TOTAL_LABEL_RE.test(line) && !TOTAL_EXCLUDE_RE.test(line)) {
      if (bestTotal === null || lineMax > bestTotal) bestTotal = lineMax;
    }
  }
  const picked = bestTotal ?? bestAny;
  return picked === null ? null : picked.toFixed(2);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const NUMERIC_DATE_RE = /(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?!\d)/;
const MONTH_FIRST_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i;
const DAY_FIRST_RE = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/i;

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const now = new Date();
  if (year < 2015 || year > now.getFullYear() + 1) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function dateInLine(line: string): string | null {
  const numeric = NUMERIC_DATE_RE.exec(line);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;
    const iso = toIso(year, month, day);
    if (iso) return iso;
  }
  const monthFirst = MONTH_FIRST_RE.exec(line);
  if (monthFirst) {
    const iso = toIso(Number(monthFirst[3]), MONTHS[(monthFirst[1] ?? "").toLowerCase()] ?? 0, Number(monthFirst[2]));
    if (iso) return iso;
  }
  const dayFirst = DAY_FIRST_RE.exec(line);
  if (dayFirst) {
    const iso = toIso(Number(dayFirst[3]), MONTHS[(dayFirst[2] ?? "").toLowerCase()] ?? 0, Number(dayFirst[1]));
    if (iso) return iso;
  }
  return null;
}

function extractDate(lines: string[]): string | null {
  for (const line of lines) {
    const iso = dateInLine(line);
    if (iso) return iso;
  }
  return null;
}

const PHONE_LINE_RE = /\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const ZIP_RE = /\b\d{5}(-\d{4})?\b/;
const STREET_RE = /^\d+\s+.*\b(st|street|ave|avenue|blvd|rd|road|dr|drive|ln|lane|hwy|highway|ct|court|trl|way)\b/i;
const CITY_STATE_RE = /,\s*[A-Z]{2}(\s+\d{5}(-\d{4})?)?\s*$/;
const PO_BOX_RE = /\bp\.?\s?o\.?\s+box\b/i;

function isVendorLine(line: string): boolean {
  if (line.length < 2) return false;
  if (!/[a-zA-Z]{2,}/.test(line)) return false; // amount/number-only line
  if (dateInLine(line)) return false;
  if (PHONE_LINE_RE.test(line)) return false;
  if (ZIP_RE.test(line) || STREET_RE.test(line) || CITY_STATE_RE.test(line)) return false;
  if (PO_BOX_RE.test(line)) return false;
  return true;
}

function extractVendor(lines: string[]): string | null {
  for (const line of lines) {
    const trimmed = line.replace(/^[^a-zA-Z0-9]+/, "").trim();
    if (!isVendorLine(trimmed)) continue;
    return trimmed.replace(/\s+/g, " ").slice(0, 60);
  }
  return null;
}

/**
 * Parse raw receipt OCR text into form candidates. Anything not found is
 * null — callers keep the form's current value for that field.
 */
export function parseReceiptText(rawText: string): ReceiptFields {
  const raw = (rawText ?? "").trim();
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return {
    amount: extractAmount(lines),
    date: extractDate(lines),
    vendor: extractVendor(lines),
    rawLength: raw.length,
  };
}

/**
 * True when the scan didn't produce anything worth prefilling — the UI
 * still opens the form with the photo attached, plus a quiet note.
 */
export function receiptLooksUnreadable(fields: ReceiptFields): boolean {
  return fields.rawLength < 20 || fields.amount === null;
}

/**
 * Merge parsed fields into the form's current values: a found value wins,
 * a missing one leaves the form exactly as the user left it (the date
 * fields already default to today).
 */
export function receiptPrefill(
  fields: ReceiptFields,
  current: ReceiptPrefill,
): ReceiptPrefill {
  return {
    vendor: fields.vendor ?? current.vendor,
    amount: fields.amount ?? current.amount,
    date: fields.date ?? current.date,
  };
}
