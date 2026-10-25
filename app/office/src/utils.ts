import type { Money } from "./types";

/** Parse a money value stored as text ("$12,500", "12500") or a number. */
export function parseMoney(value: Money): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const moneyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const moneyFmtCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Money is always shown in full, never truncated (house rule). */
export function formatMoney(value: Money): string {
  const n = parseMoney(value);
  return Number.isInteger(n) ? moneyFmt.format(n) : moneyFmtCents.format(n);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export function ageInDays(createdAt: string): number {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function ageLabel(createdAt: string): string {
  const days = ageInDays(createdAt);
  if (days <= 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

/** Turn an SDK action error into a short human message. */
export function cleanError(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : String(caught ?? "Something went wrong.");
  // SDK wraps server errors as `action <name> error: <message>` or
  // `action <name> failed: <status> <body-json>`.
  const bodyMatch = raw.match(/failed: \d+ (\{.*\})\s*$/s);
  if (bodyMatch?.[1]) {
    try {
      const parsed = JSON.parse(bodyMatch[1]) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error) return parsed.error;
    } catch { /* fall through */ }
  }
  return raw.replace(/^action \S+ (?:error: |failed: \d+ )/, "").trim() || "Something went wrong.";
}

/* ---------- Document money math ----------
   Mirrors app/client/src/financialPdf.ts (money / lineItemsTotal /
   financialTotals) line for line, so a document written from Office
   carries exactly the subtotal/total the phone editor would compute. */

export function moneyOf(value: string | null | undefined): number {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface TotalsItem {
  amount: string;
  quantity?: number;
  discount?: string;
  optional?: boolean;
}

export function lineTotal(item: TotalsItem): number {
  return Math.max(0, moneyOf(item.amount) * (item.quantity ?? 1) - moneyOf(item.discount ?? "0"));
}

export function lineItemsTotal(items: TotalsItem[]): number {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

export interface FinancialTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/** Optional lines never enter the base subtotal (estimate options, 0076). */
export function financialTotals(
  items: TotalsItem[],
  discountType: "percent" | "fixed",
  discountValue: string,
  taxType: "percent" | "fixed",
  taxValue: string,
): FinancialTotals {
  const subtotal = lineItemsTotal(items.filter((item) => !item.optional));
  const discountRaw = Math.max(0, moneyOf(discountValue));
  const discount = Math.min(subtotal, discountType === "percent" ? (subtotal * discountRaw) / 100 : discountRaw);
  const taxable = Math.max(0, subtotal - discount);
  const taxRaw = Math.max(0, moneyOf(taxValue));
  const tax = taxType === "percent" ? (taxable * taxRaw) / 100 : taxRaw;
  return { subtotal, discount, tax, total: taxable + tax };
}

/** Plain "1234.56" money string — the server's normalizeMoney stores this form. */
export function moneyString(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isoPlusDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Read a File as raw base64 (no data: prefix) — the actions' expected form. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

/** Trigger a browser download for base64 bytes (canonical PDFs from getDocumentPdf). */
export function downloadBase64(base64: string, filename: string, contentType = "application/pdf") {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Defensive field pickers for the loosely-typed office dashboard rows. */
export function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

export function pickNumber(row: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = parseMoney(v);
      if (n !== 0 || v.trim() === "0") return n;
    }
  }
  return 0;
}

export function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object");
}
