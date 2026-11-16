// Offline mode core engine — pure logic, no DOM imports.
//
// Three pieces live here so behavior suites can exercise them in-memory:
//   1. Action-error classification (network vs transient vs auth vs rejected).
//      The whole offline design hinges on one distinction: a transport
//      failure (fetch threw, or the service worker's synthetic OFFLINE 503)
//      is NOT a server verdict. Only a response the server actually produced
//      can retire a session or reject a queued write.
//   2. ReadCache — last-good responses for the app's main reads, persisted
//      through an injected key/value store, keyed by action + args.
//   3. Outbox — an ordered, persisted queue of mutations that failed with a
//      network error, replayed in order on reconnect. Create-type entries
//      get a preflight fingerprint check before replay so a create whose
//      response was lost (but which the server applied) is never duplicated.
//
// Storage and the action runner are injected; offline.ts wires the browser
// implementations (localStorage + the typed action client).

export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export type ActionRunner = (action: string, args: Record<string, unknown>) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type ActionErrorKind = "network" | "transient" | "auth" | "rejected";

const AUTH_ERROR_PATTERN = /session has expired|sign in to continue|unusual sign-in activity/i;

export function classifyActionError(error: unknown): ActionErrorKind {
  // fetch() rejects with TypeError when no response ever arrived (airplane
  // mode, dead connection, DNS failure). That is a transport failure, never
  // a verdict about the session or the write.
  if (error instanceof TypeError) return "network";
  const e = error as { status?: unknown; message?: unknown } | null | undefined;
  const message = e && typeof e.message === "string" ? e.message : "";
  const status = e && typeof e.status === "number" ? e.status : null;
  // The app service worker answers /actions with a synthetic 503
  // {error:"OFFLINE"} when the network is down — same meaning as a throw.
  if (status === 503 && /OFFLINE/i.test(message)) return "network";
  if (status != null) {
    if (status === 401 || status === 403) return "auth";
    if (status === 429 || status >= 500) return "transient";
    return "rejected";
  }
  // Handler errors arrive as a plain Error ("action X error: <server msg>").
  if (AUTH_ERROR_PATTERN.test(message)) return "auth";
  return "rejected";
}

export function isNetworkFailure(error: unknown): boolean {
  return classifyActionError(error) === "network";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^action [^ ]+ error:\s*/i, "");
  return String(error ?? "Unknown error");
}

// ---------------------------------------------------------------------------
// Stable arg keying (cache keys + outbox dedupe)
// ---------------------------------------------------------------------------

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      // _sessionToken is transport plumbing, not data identity.
      .filter((k) => k !== "_sessionToken" && record[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function argsKey(args: Record<string, unknown> | undefined): string {
  return fnv1a(stableStringify(args ?? {}));
}

// ---------------------------------------------------------------------------
// Read cache
// ---------------------------------------------------------------------------

export interface CachedRead<T = unknown> {
  at: number;
  data: T;
}

const READ_CACHE_PREFIX = "crewkat-offline-cache:";
const READ_CACHE_MAX_ENTRY_BYTES = 400_000;

export class ReadCache {
  constructor(
    private storage: KeyValueStorage,
    private maxEntryBytes: number = READ_CACHE_MAX_ENTRY_BYTES,
  ) {}

  key(action: string, args?: Record<string, unknown>): string {
    return `${READ_CACHE_PREFIX}${action}:${argsKey(args)}`;
  }

  get<T = unknown>(action: string, args?: Record<string, unknown>): CachedRead<T> | null {
    try {
      const raw = this.storage.get(this.key(action, args));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedRead<T>;
      if (!parsed || typeof parsed.at !== "number" || !("data" in parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  put(action: string, args: Record<string, unknown> | undefined, data: unknown): void {
    let payload: string;
    try {
      payload = JSON.stringify({ at: Date.now(), data } satisfies CachedRead);
    } catch {
      return; // unserializable payload — nothing safe to cache
    }
    // One oversized payload (a huge dashboard) must not evict everything
    // else or blow the storage quota; it just isn't cached.
    if (payload.length > this.maxEntryBytes) return;
    const key = this.key(action, args);
    try {
      this.storage.set(key, payload);
    } catch {
      // Quota pressure: evict the oldest cache entries and retry once.
      this.evictOldest(3);
      try {
        this.storage.set(key, payload);
      } catch { /* storage full/unavailable — caching is best-effort */ }
    }
  }

  private evictOldest(count: number): void {
    const entries: Array<{ key: string; at: number }> = [];
    for (const key of this.storage.keys()) {
      if (!key.startsWith(READ_CACHE_PREFIX)) continue;
      try {
        const parsed = JSON.parse(this.storage.get(key) ?? "") as { at?: unknown };
        entries.push({ key, at: typeof parsed.at === "number" ? parsed.at : 0 });
      } catch {
        entries.push({ key, at: 0 });
      }
    }
    entries.sort((a, b) => a.at - b.at);
    for (const entry of entries.slice(0, count)) {
      try {
        this.storage.remove(entry.key);
      } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export interface OutboxEntry {
  key: string;
  action: string;
  args: Record<string, unknown>;
  /** When the user originally attempted the write (ms epoch). */
  queuedAt: number;
  /** Account that made the write; replay holds entries for other accounts. */
  userId: number | null;
  attempts: number;
  state: "pending" | "rejected";
  error?: string;
}

export interface FlushReport {
  applied: string[];
  alreadyApplied: string[];
  rejected: Array<{ key: string; action: string; error: string }>;
  /** Why the flush stopped early, or null when the queue drained. */
  stopped: "network" | "transient" | "auth" | null;
  remaining: number;
}

const DEFAULT_MAX_ENTRY_BYTES = 1_500_000;
/** A server record counts as "the queued create landed" when it was created
 * no earlier than this long before the user's attempt (clock skew slack). */
const PREFLIGHT_SKEW_MS = 5 * 60_000;

function moneyKey(value: unknown): string {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, "") || 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function createdInWindow(createdAt: unknown, queuedAt: number): boolean {
  if (typeof createdAt !== "string" || !createdAt) return false;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  return t >= queuedAt - PREFLIGHT_SKEW_MS;
}

type Row = Record<string, unknown>;
const asRows = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : []);

/**
 * Preflight fingerprint checks for create-type actions. Each returns how
 * many server records already match the queued create, or null when the
 * action has no safe fingerprint (updates/deletes by id replay directly —
 * they are idempotent or surface a real rejection).
 *
 * The flush compares the match count against how many identical creates are
 * queued ahead of (and including) this entry: matches >= expected means the
 * write already landed and must not be sent again.
 */
async function countServerMatches(entry: OutboxEntry, run: ActionRunner): Promise<number | null> {
  const { action, args, queuedAt } = entry;
  switch (action) {
    case "saveQuote": {
      const list = (await run("listQuotes", {})) as { quotes?: unknown };
      return asRows(list.quotes).filter(
        (q) => q.clientName === args.clientName && moneyKey(q.total) === moneyKey(args.total) && createdInWindow(q.createdAt, queuedAt),
      ).length;
    }
    case "saveInvoice": {
      const list = (await run("listInvoices", {})) as { invoices?: unknown };
      return asRows(list.invoices).filter(
        (inv) =>
          inv.clientName === args.clientName &&
          moneyKey(inv.subtotal) === moneyKey(args.subtotal) &&
          inv.issueDate === args.issueDate &&
          createdInWindow(inv.createdAt, queuedAt),
      ).length;
    }
    case "createJob": {
      const list = (await run("listJobs", { search: String(args.clientName ?? "") })) as { jobs?: unknown };
      return asRows(list.jobs).filter(
        (j) => j.clientName === args.clientName && j.jobAddress === args.jobAddress && j.jobDate === args.jobDate && createdInWindow(j.createdAt, queuedAt),
      ).length;
    }
    case "saveClient": {
      if (args.id != null) return null; // update by id — replay directly
      const list = (await run("listClients", {})) as { clients?: unknown };
      return asRows(list.clients).filter(
        (c) => c.name === args.name && c.phone === args.phone && createdInWindow(c.createdAt, queuedAt),
      ).length;
    }
    case "addPayment": {
      const list = (await run("listInvoices", {})) as { invoices?: unknown };
      const invoice = asRows(list.invoices).find((inv) => inv.id === args.invoiceId);
      if (!invoice) return 0;
      return asRows(invoice.payments).filter(
        (p) => moneyKey(p.amount) === moneyKey(args.amount) && p.paymentDate === args.paymentDate && p.method === args.method && createdInWindow(p.createdAt, queuedAt),
      ).length;
    }
    case "duplicateQuote":
    case "duplicateInvoice": {
      const isQuote = action === "duplicateQuote";
      const list = (await run(isQuote ? "listQuotes" : "listInvoices", {})) as Record<string, unknown>;
      const rows = asRows(isQuote ? list.quotes : list.invoices);
      const source = rows.find((r) => r.id === args.id);
      if (!source) return 0;
      return rows.filter(
        (r) => r.id !== args.id && r.clientName === source.clientName && moneyKey(r.total) === moneyKey(source.total) && createdInWindow(r.createdAt, queuedAt),
      ).length;
    }
    case "convertQuoteToInvoice": {
      const list = (await run("listInvoices", {})) as { invoices?: unknown };
      return asRows(list.invoices).filter((inv) => inv.quoteId === args.quoteId && createdInWindow(inv.createdAt, queuedAt)).length;
    }
    case "convertQuoteToJob": {
      const quotes = (await run("listQuotes", {})) as { quotes?: unknown };
      const quote = asRows(quotes.quotes).find((q) => q.id === args.id);
      if (!quote) return 0;
      const jobs = (await run("listJobs", { search: String(quote.clientName ?? "") })) as { jobs?: unknown };
      return asRows(jobs.jobs).filter(
        (j) => j.clientName === quote.clientName && j.jobAddress === quote.jobAddress && createdInWindow(j.createdAt, queuedAt),
      ).length;
    }
    default:
      return null;
  }
}

/**
 * The identity a preflight check actually compares, per action — mirrors
 * the fields countServerMatches matches on. Queued creates are grouped by
 * THIS (not by their full args): two saves of the same document that differ
 * only in a note still share one fingerprint, so the Nth one needs N
 * matching server records before it counts as already applied. Grouping by
 * full args instead would let a second, genuinely different create be
 * silently dropped whenever a same-fingerprint record already existed.
 */
function createFingerprintKey(entry: OutboxEntry): string | null {
  const { action, args } = entry;
  switch (action) {
    case "saveQuote":
      return `q|${args.clientName}|${moneyKey(args.total)}`;
    case "saveInvoice":
      return `i|${args.clientName}|${moneyKey(args.subtotal)}|${args.issueDate}`;
    case "createJob":
      return `j|${args.clientName}|${args.jobAddress}|${args.jobDate}`;
    case "saveClient":
      return args.id != null ? null : `c|${args.name}|${args.phone}`;
    case "addPayment":
      return `p|${args.invoiceId}|${moneyKey(args.amount)}|${args.paymentDate}|${args.method}`;
    case "duplicateQuote":
    case "duplicateInvoice":
      return `d|${args.id}`;
    case "convertQuoteToInvoice":
      return `cq|${args.quoteId}`;
    case "convertQuoteToJob":
      return `cj|${args.id}`;
    default:
      return null;
  }
}

/** Actions whose replay runs a preflight fingerprint check first. */
const PREFLIGHT_ACTIONS: ReadonlySet<string> = new Set([
  "saveQuote",
  "saveInvoice",
  "createJob",
  "saveClient",
  "addPayment",
  "duplicateQuote",
  "duplicateInvoice",
  "convertQuoteToInvoice",
  "convertQuoteToJob",
]);

export class Outbox {
  private entries: OutboxEntry[] = [];
  private flushPromise: Promise<FlushReport> | null = null;
  onChange: (() => void) | null = null;

  constructor(
    private storage: KeyValueStorage,
    private storageKey: string = "crewkat-outbox-v1",
    private maxEntryBytes: number = DEFAULT_MAX_ENTRY_BYTES,
  ) {
    this.load();
  }

  private load(): void {
    try {
      const raw = this.storage.get(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as OutboxEntry[];
      if (Array.isArray(parsed)) {
        this.entries = parsed.filter(
          (e) => e && typeof e.key === "string" && typeof e.action === "string" && e.args && typeof e.args === "object",
        );
      }
    } catch {
      this.entries = [];
    }
  }

  private persist(): void {
    try {
      this.storage.set(this.storageKey, JSON.stringify(this.entries));
    } catch { /* storage unavailable — queue survives in memory for this session */ }
    this.onChange?.();
  }

  list(): OutboxEntry[] {
    return [...this.entries];
  }

  pendingCount(): number {
    return this.entries.filter((e) => e.state === "pending").length;
  }

  rejectedEntries(): OutboxEntry[] {
    return this.entries.filter((e) => e.state === "rejected");
  }

  /**
   * Queue a mutation that just failed with a network error. Returns the
   * entry, or null when the payload is too large to persist safely (the
   * caller then surfaces the original network error instead — the write is
   * never silently swallowed). An identical pending entry (same action +
   * args, e.g. a double-tapped save) is returned instead of duplicated.
   */
  enqueue(action: string, args: Record<string, unknown>, opts: { userId?: number | null; queuedAt?: number } = {}): OutboxEntry | null {
    const cleanArgs = { ...args };
    delete cleanArgs._sessionToken;
    let serialized: string;
    try {
      serialized = stableStringify(cleanArgs);
    } catch {
      return null;
    }
    if (serialized.length > this.maxEntryBytes) return null;
    const existing = this.entries.find(
      (e) => e.state === "pending" && e.action === action && stableStringify(e.args) === serialized,
    );
    if (existing) return existing;
    const entry: OutboxEntry = {
      key: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `ob-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      action,
      args: cleanArgs,
      queuedAt: opts.queuedAt ?? Date.now(),
      userId: opts.userId ?? null,
      attempts: 0,
      state: "pending",
    };
    this.entries.push(entry);
    this.persist();
    return entry;
  }

  remove(key: string): void {
    this.entries = this.entries.filter((e) => e.key !== key);
    this.persist();
  }

  /** User-controlled retry of a server-rejected entry. */
  retryRejected(key: string): void {
    const entry = this.entries.find((e) => e.key === key);
    if (entry && entry.state === "rejected") {
      entry.state = "pending";
      delete entry.error;
      this.persist();
    }
  }

  /** User-controlled discard of a queued entry (the only way one is dropped
   * without the server accepting it). */
  discard(key: string): void {
    this.remove(key);
  }

  /**
   * Replay pending entries in order. Stops at the first network/transient/
   * auth failure (later entries may depend on earlier ones, and the server
   * has not given a verdict yet). A server rejection marks just that entry
   * and the flush continues — the entry is kept and surfaced, never dropped.
   */
  flush(run: ActionRunner, opts: { currentUserId?: number | null } = {}): Promise<FlushReport> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.runFlush(run, opts).finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  private async runFlush(run: ActionRunner, opts: { currentUserId?: number | null }): Promise<FlushReport> {
    const report: FlushReport = { applied: [], alreadyApplied: [], rejected: [], stopped: null, remaining: 0 };
    const queue = this.entries.filter((e) => e.state === "pending");
    // Expected server-match counts for create fingerprints: the Nth queued
    // entry with a given fingerprint needs at least N matching server
    // records before it counts as already applied.
    const expectedByKey = new Map<string, number>();
    const groupCounts = new Map<string, number>();
    for (const entry of queue) {
      if (!PREFLIGHT_ACTIONS.has(entry.action)) continue;
      const fingerprint = createFingerprintKey(entry);
      const group = `${entry.action}:${fingerprint ?? stableStringify(entry.args)}`;
      const n = (groupCounts.get(group) ?? 0) + 1;
      groupCounts.set(group, n);
      expectedByKey.set(entry.key, n);
    }

    for (const entry of queue) {
      const live = this.entries.find((e) => e.key === entry.key);
      if (!live || live.state !== "pending") continue;
      // Account guard: a write made under one account never replays under
      // another account's session on a shared device.
      if (live.userId != null && opts.currentUserId != null && live.userId !== opts.currentUserId) continue;
      live.attempts += 1;

      if (PREFLIGHT_ACTIONS.has(live.action)) {
        let matches: number | null;
        try {
          matches = await countServerMatches(live, run);
        } catch (error) {
          const kind = classifyActionError(error);
          if (kind === "rejected") {
            matches = 0; // the read failed oddly; let the write itself be judged
          } else {
            report.stopped = kind;
            this.persist();
            break;
          }
        }
        if (matches != null && matches >= (expectedByKey.get(live.key) ?? 1)) {
          this.entries = this.entries.filter((e) => e.key !== live.key);
          report.alreadyApplied.push(live.key);
          this.persist();
          continue;
        }
      }

      try {
        await run(live.action, live.args);
        this.entries = this.entries.filter((e) => e.key !== live.key);
        report.applied.push(live.key);
        this.persist();
      } catch (error) {
        const kind = classifyActionError(error);
        if (kind === "rejected") {
          live.state = "rejected";
          live.error = errorMessage(error);
          report.rejected.push({ key: live.key, action: live.action, error: live.error });
          this.persist();
          continue;
        }
        report.stopped = kind;
        this.persist();
        break;
      }
    }
    report.remaining = this.pendingCount();
    return report;
  }
}
