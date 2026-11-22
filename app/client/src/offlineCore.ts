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
    /** Account scoping (audit A3): keys carry the signed-in user's id so
     * one account's cached lists are never served to another account that
     * signs in on the same device. Null provider / null id = "anon". */
    private scopeProvider: (() => string | number | null) | null = null,
  ) {}

  private scope(): string {
    const value = this.scopeProvider?.();
    return value == null || value === "" ? "anon" : String(value);
  }

  key(action: string, args?: Record<string, unknown>): string {
    return `${READ_CACHE_PREFIX}${this.scope()}:${action}:${argsKey(args)}`;
  }

  /** Drop every cached read, across all account scopes (sign-out). */
  clearAll(): void {
    for (const key of this.storage.keys()) {
      if (!key.startsWith(READ_CACHE_PREFIX)) continue;
      try {
        this.storage.remove(key);
      } catch { /* ignore */ }
    }
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
/** Identical writes queued within this window are one double-tapped write,
 * not two deliberate ones (see Outbox.enqueue). */
const DOUBLE_TAP_MERGE_MS = 2_000;
/** A server record counts as "the queued create landed" when it was created
 * no earlier than this long before the user's attempt (clock skew slack). */
const PREFLIGHT_SKEW_MS = 5 * 60_000;
/** …and no later than this long AFTER the attempt (audit A2). The original
 * attempt reached the server within moments of being queued — its response
 * is what got lost — so a matching record created hours or days later is a
 * different create (possibly a teammate's) and must never absorb the queued
 * one. The bound is generous for device/server clock skew. */
const PREFLIGHT_UPPER_MS = 15 * 60_000;

function moneyKey(value: unknown): string {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, "") || 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function createdInWindow(createdAt: unknown, queuedAt: number): boolean {
  if (typeof createdAt !== "string" || !createdAt) return false;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  return t >= queuedAt - PREFLIGHT_SKEW_MS && t <= queuedAt + PREFLIGHT_UPPER_MS;
}

/**
 * Content hash of a document's line items (audit A1): client name + total
 * alone cannot tell two documents apart — same client, same total,
 * different work is routine (allowance pricing, repeat jobs, a revision at
 * the same price). The normalized shape mirrors the fields both the save
 * args and the list responses carry, so a queued create and its landed
 * server copy hash identically.
 */
function lineItemsHash(lineItems: unknown): string {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const normalized = items.map((item) => {
    const it = (item ?? {}) as Row;
    return [
      String(it.name ?? ""),
      String(it.description ?? ""),
      moneyKey(it.amount),
      it.quantity ?? null,
      it.optional === true,
      it.isTitle === true,
    ];
  });
  return fnv1a(stableStringify(normalized));
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
        (q) =>
          q.clientName === args.clientName &&
          moneyKey(q.total) === moneyKey(args.total) &&
          lineItemsHash(q.lineItems) === lineItemsHash(args.lineItems) &&
          createdInWindow(q.createdAt, queuedAt),
      ).length;
    }
    case "saveInvoice": {
      const list = (await run("listInvoices", {})) as { invoices?: unknown };
      return asRows(list.invoices).filter(
        (inv) =>
          inv.clientName === args.clientName &&
          moneyKey(inv.subtotal) === moneyKey(args.subtotal) &&
          inv.issueDate === args.issueDate &&
          lineItemsHash(inv.lineItems) === lineItemsHash(args.lineItems) &&
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
        (r) =>
          r.id !== args.id &&
          r.clientName === source.clientName &&
          moneyKey(r.total) === moneyKey(source.total) &&
          lineItemsHash(r.lineItems) === lineItemsHash(source.lineItems) &&
          createdInWindow(r.createdAt, queuedAt),
      ).length;
    }
    // Money-record creates (audit B2): receipts, expenses, and mileage are
    // job costs — a replayed duplicate double-counts them. Each reads back
    // through the same aggregate the screens use.
    case "addReceipt": {
      const job = (await run("getJob", { id: args.jobId })) as { receipts?: unknown };
      return asRows(job.receipts).filter(
        (r) =>
          r.vendor === args.vendor &&
          moneyKey(r.amount) === moneyKey(args.amount) &&
          r.purchaseDate === args.purchaseDate &&
          r.filename === args.filename &&
          createdInWindow(r.createdAt, queuedAt),
      ).length;
    }
    case "saveBusinessExpense": {
      if (args.id != null) return null; // update by id — replay directly
      const toolkit = (await run("getGrowthToolkit", {})) as { expenses?: unknown };
      return asRows(toolkit.expenses).filter(
        (e) =>
          e.expenseDate === args.expenseDate &&
          e.vendor === args.vendor &&
          moneyKey(e.amount) === moneyKey(args.amount) &&
          e.category === args.category &&
          (e.jobId ?? null) === (args.jobId ?? null) &&
          createdInWindow(e.createdAt, queuedAt),
      ).length;
    }
    case "saveMileageTrip": {
      if (args.id != null) return null; // update by id — replay directly
      const toolkit = (await run("getGrowthToolkit", {})) as { mileage?: unknown };
      return asRows(toolkit.mileage).filter(
        (m) =>
          m.tripDate === args.tripDate &&
          m.fromLocation === args.fromLocation &&
          m.toLocation === args.toLocation &&
          String(m.miles) === String(args.miles) &&
          (m.jobId ?? null) === (args.jobId ?? null) &&
          createdInWindow(m.createdAt, queuedAt),
      ).length;
    }
    case "saveLead": {
      const list = (await run("listLeads", {})) as { leads?: unknown };
      return asRows(list.leads).filter(
        (l) => l.name === args.name && l.phone === args.phone && createdInWindow(l.createdAt, queuedAt),
      ).length;
    }
    case "savePriceBookItem": {
      if (args.id != null) return null; // update by id — replay directly
      const toolkit = (await run("getGrowthToolkit", {})) as { priceBook?: unknown };
      return asRows(toolkit.priceBook).filter(
        (p) => p.name === args.name && moneyKey(p.unitPrice) === moneyKey(args.unitPrice) && createdInWindow(p.createdAt, queuedAt),
      ).length;
    }
    case "saveQuoteTemplate": {
      if (args.id != null) return null; // update by id — replay directly
      const toolkit = (await run("getGrowthToolkit", {})) as { templates?: unknown };
      return asRows(toolkit.templates).filter(
        (t) => t.name === args.name && lineItemsHash(t.lineItems) === lineItemsHash(args.lineItems) && createdInWindow(t.createdAt, queuedAt),
      ).length;
    }
    case "saveSubcontractor": {
      if (args.id != null) return null; // update by id — replay directly
      const list = (await run("listSubcontractors", { jobId: args.jobId })) as { subcontractors?: unknown };
      return asRows(list.subcontractors).filter(
        (s) => s.name === args.name && s.phone === args.phone && createdInWindow(s.createdAt, queuedAt),
      ).length;
    }
    case "createPurchaseOrder": {
      const today = new Date().toISOString().slice(0, 10);
      const data = (await run("getFieldIntelligence", { today, periodStart: "2000-01-01", periodEnd: today })) as { purchaseOrders?: unknown };
      return asRows(data.purchaseOrders).filter(
        (po) => po.supplierQuoteId === args.supplierQuoteId && createdInWindow(po.createdAt, queuedAt),
      ).length;
    }
    case "convertLeadToJob": {
      // A converted lead sits at stage "won" with its client linked — the
      // conversion landed, whatever happened to the response (audit B3).
      const list = (await run("listLeads", {})) as { leads?: unknown };
      const lead = asRows(list.leads).find((l) => l.id === args.id);
      if (!lead) return 0;
      return lead.stage === "won" ? 1 : 0;
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
      return `q|${args.clientName}|${moneyKey(args.total)}|${lineItemsHash(args.lineItems)}`;
    case "saveInvoice":
      return `i|${args.clientName}|${moneyKey(args.subtotal)}|${args.issueDate}|${lineItemsHash(args.lineItems)}`;
    case "addReceipt":
      return `r|${args.jobId}|${args.vendor}|${moneyKey(args.amount)}|${args.purchaseDate}|${args.filename}`;
    case "saveBusinessExpense":
      return args.id != null ? null : `e|${args.expenseDate}|${args.vendor}|${moneyKey(args.amount)}|${args.category}|${args.jobId ?? ""}`;
    case "saveMileageTrip":
      return args.id != null ? null : `m|${args.tripDate}|${args.fromLocation}|${args.toLocation}|${args.miles}|${args.jobId ?? ""}`;
    case "saveLead":
      return `l|${args.name}|${args.phone}`;
    case "savePriceBookItem":
      return args.id != null ? null : `pb|${args.name}|${moneyKey(args.unitPrice)}`;
    case "saveQuoteTemplate":
      return args.id != null ? null : `qt|${args.name}|${lineItemsHash(args.lineItems)}`;
    case "saveSubcontractor":
      return args.id != null ? null : `s|${args.jobId}|${args.name}|${args.phone}`;
    case "createPurchaseOrder":
      return `po|${args.supplierQuoteId}`;
    case "convertLeadToJob":
      return `cl|${args.id}`;
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
  "addReceipt",
  "saveBusinessExpense",
  "saveMileageTrip",
  "saveLead",
  "savePriceBookItem",
  "saveQuoteTemplate",
  "saveSubcontractor",
  "createPurchaseOrder",
  "convertLeadToJob",
]);

/**
 * Server rejections that actually mean "the write already landed" (audit
 * B3): a replayed convertLeadToJob whose first attempt succeeded but whose
 * response was lost comes back as this error. Classifying it as a
 * rejection would show the user a failed sync for work that succeeded.
 * (The preflight above normally catches it first; this is the backstop
 * for when the preflight read itself couldn't run.)
 */
const ALREADY_APPLIED_ERRORS: Record<string, RegExp> = {
  convertLeadToJob: /already been converted/i,
};

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

  /**
   * Counts/lists, optionally scoped to one account (audit A3): entries a
   * different account queued on this device are not the signed-in user's
   * to see, retry, or discard. Entries with no recorded owner (queued
   * before account scoping existed) count as the device's own.
   */
  pendingCount(userId?: number | null): number {
    return this.entries.filter(
      (e) => e.state === "pending" && (userId == null || e.userId == null || e.userId === userId),
    ).length;
  }

  rejectedEntries(userId?: number | null): OutboxEntry[] {
    return this.entries.filter(
      (e) => e.state === "rejected" && (userId == null || e.userId == null || e.userId === userId),
    );
  }

  /** Drop every queued entry without sending any of them (sign-out). */
  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.persist();
  }

  /**
   * Queue a mutation that just failed with a network error. Returns the
   * entry, or null when the payload is too large to persist safely (the
   * caller then surfaces the original network error instead — the write is
   * never silently swallowed). An identical pending entry queued within
   * the double-tap window (same action + args, moments apart) is returned
   * instead of duplicated — that is one write fired twice. The same write
   * queued again LATER is a distinct entry (audit B1): two identical cash
   * payments recorded minutes apart are two payments, and both replay.
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
    const queuedAt = opts.queuedAt ?? Date.now();
    const existing = this.entries.find(
      (e) =>
        e.state === "pending" &&
        e.action === action &&
        stableStringify(e.args) === serialized &&
        Math.abs(queuedAt - e.queuedAt) <= DOUBLE_TAP_MERGE_MS,
    );
    if (existing) return existing;
    const entry: OutboxEntry = {
      key: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `ob-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      action,
      args: cleanArgs,
      queuedAt,
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
        if (kind === "rejected" && ALREADY_APPLIED_ERRORS[live.action]?.test(errorMessage(error))) {
          // The server's "rejection" is proof the first attempt landed
          // (audit B3) — retire the entry as applied, never as failed.
          this.entries = this.entries.filter((e) => e.key !== live.key);
          report.alreadyApplied.push(live.key);
          this.persist();
          continue;
        }
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
