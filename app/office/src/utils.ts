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
