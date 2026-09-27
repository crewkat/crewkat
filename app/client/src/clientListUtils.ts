// Pure helpers for the Phase 1 client list: initials, avatar colors, money
// formatting, sorting, and tag filtering/counting. No React imports so this
// module can be unit-tested directly with bun.

export type ClientSortKey = "name" | "balanceDue" | "totalPaid" | "invoiceCount";
export type SortDirection = "asc" | "desc";

export interface ClientListItem {
  id: number;
  name: string;
  tags: string[];
  invoiceCount: number;
  totalInvoiced: number;
  totalPaid: number;
  balanceDue: number;
  paymentPercent: number;
}

// Invoice Fly-style two-tone avatar palettes (background, text).
export const AVATAR_COLORS: Array<[string, string]> = [
  ["#e3f2fd", "#1565c0"],
  ["#e8f5e9", "#2e7d32"],
  ["#fff3e0", "#e65100"],
  ["#f3e5f5", "#6a1b9a"],
  ["#e0f2f1", "#00695c"],
  ["#fce4ec", "#ad1457"],
  ["#ede7f6", "#4527a0"],
  ["#fff8e1", "#f57f17"],
  ["#e1f5fe", "#0277bd"],
  ["#f1f8e9", "#558b2f"],
  ["#efebe9", "#4e342e"],
  ["#e8eaf6", "#283593"],
];

export function clientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

// Stable avatar color from the client name (same name -> same color).
export function avatarColorIndex(name: string): number {
  let hash = 0;
  for (const ch of name.toLowerCase()) {
    hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  }
  return hash % AVATAR_COLORS.length;
}

// Compact money: 1875 -> "$1.88K", 25000 -> "$25K", 999 -> "$999".
export function usdShort(value: number): string {
  const v = Math.round(value);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) {
    const m = v / 1_000_000;
    return `$${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (abs >= 10_000) return `$${Math.round(v / 1_000)}K`;
  if (abs >= 1_000) {
    const k = v / 1_000;
    return `$${Number.isInteger(k) ? k : k.toFixed(2)}K`;
  }
  return `$${v}`;
}

export function clientBalanceDue(totalInvoiced: number, totalPaid: number): number {
  return Math.max(0, Math.round((totalInvoiced - totalPaid) * 100) / 100);
}

export function sortClientList<T extends ClientListItem>(
  clients: readonly T[],
  key: ClientSortKey,
  direction: SortDirection,
): T[] {
  const dir = direction === "asc" ? 1 : -1;
  const sorted = [...clients];
  sorted.sort((a, b) => {
    let cmp = 0;
    if (key === "name") {
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    } else if (key === "balanceDue") {
      cmp = a.balanceDue - b.balanceDue;
    } else if (key === "totalPaid") {
      cmp = a.totalPaid - b.totalPaid;
    } else {
      cmp = a.invoiceCount - b.invoiceCount;
    }
    if (cmp === 0) cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    return cmp * dir;
  });
  return sorted;
}

// Tag filter: a client passes when it has ANY of the selected tags.
export function filterClientsByTags<T extends { tags: string[] }>(
  clients: readonly T[],
  selectedTags: readonly string[],
): T[] {
  if (selectedTags.length === 0) return [...clients];
  const wanted = new Set(selectedTags.map((t) => t.toLowerCase()));
  return clients.filter((c) => c.tags.some((t) => wanted.has(t.toLowerCase())));
}

// Tag counts across the given client list, sorted by count desc then name.
export function tagCounts<T extends { tags: string[] }>(
  clients: readonly T[],
): Array<{ tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const c of clients) {
    for (const raw of c.tags) {
      const tag = raw.trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }),
  );
}

// Tag editor input: normalize a free-text draft into a single tag value.
export function cleanTagValue(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 40);
}
