// Offline mode v2 — behavior tests for the pure engine in
// client/src/offlineCore.ts (error classification, read cache, write
// outbox) plus light source-wiring checks for api.ts / App.tsx.
//
// The engine is storage- and runner-injected, so these tests exercise the
// real queue logic end to end without a DOM or a server: an in-memory
// KeyValueStorage stands in for localStorage and a scripted ActionRunner
// stands in for the action client.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  Outbox,
  ReadCache,
  argsKey,
  classifyActionError,
  isNetworkFailure,
  stableStringify,
  type ActionRunner,
  type KeyValueStorage,
  type OutboxEntry,
} from "./client/src/offlineCore";

class MemoryStorage implements KeyValueStorage {
  map = new Map<string, string>();
  constructor(private maxTotalChars = Number.POSITIVE_INFINITY) {}
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    let total = value.length;
    for (const [k, v] of this.map) if (k !== key) total += v.length;
    if (total > this.maxTotalChars) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

function scriptedRunner(handlers: Record<string, (args: Record<string, unknown>) => unknown>): {
  runner: ActionRunner;
  calls: Array<{ action: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ action: string; args: Record<string, unknown> }> = [];
  const runner: ActionRunner = async (action, args) => {
    calls.push({ action, args });
    const handler = handlers[action];
    if (!handler) throw new Error(`no scripted handler for ${action}`);
    return handler(args);
  };
  return { runner, calls };
}

const pendingOf = (outbox: Outbox): OutboxEntry[] => outbox.list().filter((e) => e.state === "pending");

const QUOTE_ARGS = {
  clientName: "Ada Lovelace",
  clientEmail: "ada@example.com",
  items: [{ title: "Deck repair", qty: 1, price: 1250 }],
  subtotal: 1250,
  total: 1250,
  status: "draft",
};

describe("error classification", () => {
  test("transport failures are network", () => {
    expect(classifyActionError(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyActionError(Object.assign(new Error("action listJobs error: OFFLINE"), { status: 503 }))).toBe("network");
    expect(isNetworkFailure(new TypeError("Load failed"))).toBe(true);
  });
  test("auth verdicts are auth", () => {
    expect(classifyActionError(Object.assign(new Error("nope"), { status: 401 }))).toBe("auth");
    expect(classifyActionError(Object.assign(new Error("nope"), { status: 403 }))).toBe("auth");
    expect(classifyActionError(new Error("action getJob error: Sign in to continue."))).toBe("auth");
    expect(classifyActionError(new Error("Your session has expired — sign in again"))).toBe("auth");
  });
  test("rate limits and 5xx are transient, plain action errors are rejected", () => {
    expect(classifyActionError(Object.assign(new Error("slow down"), { status: 429 }))).toBe("transient");
    expect(classifyActionError(Object.assign(new Error("boom"), { status: 502 }))).toBe("transient");
    expect(classifyActionError(new Error("action saveQuote error: Quote total must be positive"))).toBe("rejected");
    expect(isNetworkFailure(new Error("action saveQuote error: Quote total must be positive"))).toBe(false);
  });
});

describe("stable args keying", () => {
  test("key order and session proof do not change the key", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
    expect(argsKey({ ...QUOTE_ARGS, _sessionToken: "secret" })).toBe(argsKey(QUOTE_ARGS));
    expect(argsKey(QUOTE_ARGS)).not.toBe(argsKey({ ...QUOTE_ARGS, total: 999 }));
  });
  test("the read cache separates entries by action as well as args", () => {
    const cache = new ReadCache(new MemoryStorage());
    expect(cache.key("saveQuote", QUOTE_ARGS)).not.toBe(cache.key("saveInvoice", QUOTE_ARGS));
    expect(cache.key("listJobs", {})).not.toBe(cache.key("listJobs", { search: "ada" }));
  });
});

describe("read cache", () => {
  test("serves per action+args and misses on different args", () => {
    const cache = new ReadCache(new MemoryStorage());
    cache.put("listJobs", {}, [{ id: 1 }]);
    cache.put("getJob", { id: 7 }, { id: 7, title: "Roof" });
    expect(cache.get("listJobs", {})?.data).toEqual([{ id: 1 }]);
    expect(cache.get("getJob", { id: 7 })?.data).toEqual({ id: 7, title: "Roof" });
    expect(cache.get("getJob", { id: 8 })).toBeNull();
    expect(cache.get("listClients", {})).toBeNull();
  });
  test("evicts oldest entries when storage is full", () => {
    const storage = new MemoryStorage(600);
    const cache = new ReadCache(storage);
    cache.put("listJobs", {}, "x".repeat(300));
    cache.put("listClients", {}, "y".repeat(300));
    expect(cache.get("listJobs", {})).toBeNull();
    expect(cache.get("listClients", {})?.data).toBe("y".repeat(300));
  });
  test("oversized payloads are skipped, not fatal", () => {
    const cache = new ReadCache(new MemoryStorage());
    cache.put("listJobs", {}, "z".repeat(500_000));
    expect(cache.get("listJobs", {})).toBeNull();
  });
});

describe("outbox queue", () => {
  test("persists across instances and dedupes identical pending writes", () => {
    const storage = new MemoryStorage();
    const outbox = new Outbox(storage);
    const first = outbox.enqueue("saveQuote", QUOTE_ARGS, { userId: 42 });
    const again = outbox.enqueue("saveQuote", { ...QUOTE_ARGS }, { userId: 42 });
    expect(first).not.toBeNull();
    expect(again?.key).toBe(first?.key);
    expect(outbox.pendingCount()).toBe(1);
    const revived = new Outbox(storage);
    expect(revived.pendingCount()).toBe(1);
    expect(revived.list()[0]?.action).toBe("saveQuote");
  });

  test("oversized payloads are refused so the caller can surface the real error", () => {
    const outbox = new Outbox(new MemoryStorage());
    expect(outbox.enqueue("saveQuote", { blob: "q".repeat(2_000_000) })).toBeNull();
    expect(outbox.pendingCount()).toBe(0);
  });

  test("flush replays in order and removes entries only on success", async () => {
    const outbox = new Outbox(new MemoryStorage());
    outbox.enqueue("saveClient", { name: "Ada" });
    outbox.enqueue("updateJobInfo", { id: 3, jobNotes: "gate code 4411" });
    const { runner, calls } = scriptedRunner({
      listClients: () => ({ clients: [] }),
      saveClient: () => ({ id: 9 }),
      updateJobInfo: () => ({ ok: true }),
    });
    const report = await outbox.flush(runner);
    expect(report.applied).toHaveLength(2);
    expect(report.stopped).toBeNull();
    const mutations = calls.filter((c) => !c.action.startsWith("list")).map((c) => c.action);
    expect(mutations).toEqual(["saveClient", "updateJobInfo"]);
    expect(outbox.pendingCount()).toBe(0);
  });

  test("flush stops at a network failure and keeps the rest queued", async () => {
    const outbox = new Outbox(new MemoryStorage());
    outbox.enqueue("saveClient", { name: "Ada" });
    outbox.enqueue("saveClient", { name: "Grace" });
    const { runner, calls } = scriptedRunner({
      listClients: () => ({ clients: [] }),
      saveClient: () => { throw new TypeError("Failed to fetch"); },
    });
    const report = await outbox.flush(runner);
    expect(report.stopped).toBe("network");
    expect(calls.filter((c) => c.action === "saveClient")).toHaveLength(1);
    expect(outbox.pendingCount()).toBe(2);
  });

  test("a server rejection is kept, marked, and does not block later entries", async () => {
    const outbox = new Outbox(new MemoryStorage());
    outbox.enqueue("saveQuote", QUOTE_ARGS);
    outbox.enqueue("saveClient", { name: "Grace" });
    const { runner } = scriptedRunner({
      listQuotes: () => ({ quotes: [] }),
      listClients: () => ({ clients: [] }),
      saveQuote: () => { throw new Error("action saveQuote error: Quote total must be positive"); },
      saveClient: () => ({ id: 10 }),
    });
    const report = await outbox.flush(runner);
    expect(report.applied).toHaveLength(1);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0]?.error).toContain("Quote total must be positive");
    expect(report.stopped).toBeNull();
    const rejected = outbox.rejectedEntries();
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error).toContain("Quote total must be positive");
    // Retry returns it to pending; discard is the only other way out.
    outbox.retryRejected(rejected[0]!.key);
    expect(outbox.pendingCount()).toBe(1);
    expect(outbox.rejectedEntries()).toHaveLength(0);
    outbox.discard(pendingOf(outbox)[0]!.key);
    expect(outbox.pendingCount()).toBe(0);
  });

  test("an auth failure stops the flush without rejecting entries", async () => {
    const outbox = new Outbox(new MemoryStorage());
    outbox.enqueue("saveClient", { name: "Ada" });
    const { runner } = scriptedRunner({
      listClients: () => ({ clients: [] }),
      saveClient: () => { throw Object.assign(new Error("Sign in to continue."), { status: 401 }); },
    });
    const report = await outbox.flush(runner);
    expect(report.stopped).toBe("auth");
    expect(outbox.pendingCount()).toBe(1);
    expect(outbox.rejectedEntries()).toHaveLength(0);
  });

  test("entries queued under another account are held, never replayed", async () => {
    const outbox = new Outbox(new MemoryStorage());
    outbox.enqueue("saveClient", { name: "Ada" }, { userId: 1 });
    const { runner, calls } = scriptedRunner({
      listClients: () => ({ clients: [] }),
      saveClient: () => ({ id: 1 }),
    });
    const held = await outbox.flush(runner, { currentUserId: 2 });
    expect(held.applied).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(outbox.pendingCount()).toBe(1);
    const own = await outbox.flush(runner, { currentUserId: 1 });
    expect(own.applied).toHaveLength(1);
    expect(outbox.pendingCount()).toBe(0);
  });
});

describe("create replay dedupe (fingerprint preflight)", () => {
  const INVOICE_ARGS = {
    clientName: "Ada Lovelace",
    subtotal: 900,
    total: 900,
    issueDate: "2026-11-15",
    items: [{ title: "Labor", qty: 1, price: 900 }],
  };

  test("a create whose response was lost is not duplicated", async () => {
    const outbox = new Outbox(new MemoryStorage());
    const entry = outbox.enqueue("saveInvoice", INVOICE_ARGS)!;
    const serverInvoice = {
      clientName: "Ada Lovelace",
      subtotal: 900,
      issueDate: "2026-11-15",
      quoteId: null,
      payments: [],
      createdAt: new Date(entry.queuedAt + 1000).toISOString(),
    };
    const { runner, calls } = scriptedRunner({
      listInvoices: () => ({ invoices: [serverInvoice] }),
      saveInvoice: () => { throw new Error("must not be called"); },
    });
    const report = await outbox.flush(runner);
    expect(report.applied).toHaveLength(0);
    expect(report.alreadyApplied).toHaveLength(1);
    expect(calls.filter((c) => c.action === "saveInvoice")).toHaveLength(0);
    expect(outbox.pendingCount()).toBe(0);
  });

  test("a create with no matching server record is replayed", async () => {
    const outbox = new Outbox(new MemoryStorage());
    outbox.enqueue("saveInvoice", INVOICE_ARGS);
    const { runner, calls } = scriptedRunner({
      listInvoices: () => ({ invoices: [] }),
      saveInvoice: () => ({ id: 55 }),
    });
    const report = await outbox.flush(runner);
    expect(report.applied).toHaveLength(1);
    expect(calls.filter((c) => c.action === "saveInvoice")).toHaveLength(1);
  });

  test("two queued creates sharing a fingerprint: one server copy covers only the first", async () => {
    const outbox = new Outbox(new MemoryStorage());
    const first = outbox.enqueue("saveQuote", QUOTE_ARGS)!;
    // A second save of the same document with an extra note: a distinct
    // outbox entry (full-args dedupe key differs) but the SAME create
    // fingerprint (client + total). The fingerprint-ordinal rule must let
    // the first entry match the one server record and still replay the
    // second as a real create — never silently drop it.
    outbox.enqueue("saveQuote", { ...QUOTE_ARGS, notes: "second save" });
    const serverQuote = {
      clientName: "Ada Lovelace",
      total: 1250,
      createdAt: new Date(first.queuedAt + 500).toISOString(),
    };
    let saveCalls = 0;
    const { runner } = scriptedRunner({
      listQuotes: () => ({ quotes: [serverQuote] }),
      saveQuote: () => { saveCalls += 1; return { id: 100 + saveCalls }; },
    });
    const report = await outbox.flush(runner);
    expect(report.alreadyApplied).toHaveLength(1);
    expect(report.applied).toHaveLength(1);
    expect(saveCalls).toBe(1);
    expect(outbox.pendingCount()).toBe(0);
  });

  test("job creates dedupe by client + address + date", async () => {
    const outbox = new Outbox(new MemoryStorage());
    const entry = outbox.enqueue("createJob", {
      clientName: "Ada Lovelace",
      jobAddress: "12 Analytical Way",
      jobDate: "2026-11-20",
      title: "Deck",
    })!;
    const { runner, calls } = scriptedRunner({
      listJobs: () => ({
        jobs: [{
          clientName: "Ada Lovelace",
          jobAddress: "12 Analytical Way",
          jobDate: "2026-11-20",
          createdAt: new Date(entry.queuedAt + 2000).toISOString(),
        }],
      }),
      createJob: () => { throw new Error("must not be called"); },
    });
    const report = await outbox.flush(runner);
    expect(report.alreadyApplied).toHaveLength(1);
    expect(calls.filter((c) => c.action === "createJob")).toHaveLength(0);
  });

  test("payments dedupe against the invoice's recorded payments", async () => {
    const outbox = new Outbox(new MemoryStorage());
    outbox.enqueue("addPayment", {
      invoiceId: 77,
      amount: 250,
      method: "Cash",
      paymentDate: "2026-11-15",
    });
    const { runner, calls } = scriptedRunner({
      listInvoices: () => ({
        invoices: [{
          id: 77,
          clientName: "Ada Lovelace",
          subtotal: 900,
          issueDate: "2026-11-15",
          payments: [{ amount: 250, method: "Cash", paymentDate: "2026-11-15", createdAt: new Date().toISOString() }],
        }],
      }),
      addPayment: () => { throw new Error("must not be called"); },
    });
    const report = await outbox.flush(runner);
    expect(report.alreadyApplied).toHaveLength(1);
    expect(calls.filter((c) => c.action === "addPayment")).toHaveLength(0);
  });
});

describe("audit fixes 2026-11-21: fingerprints, windows, scoping, payments", () => {
  const QUOTE_LI = {
    clientName: "Ada Lovelace",
    lineItems: [{ description: "Deck repair", amount: 1250 }],
    subtotal: 1250,
    total: 1250,
    status: "draft",
  };

  test("A1: same client + total but different line items is NOT a duplicate", async () => {
    const outbox = new Outbox(new MemoryStorage());
    const entry = outbox.enqueue("saveQuote", QUOTE_LI)!;
    const serverQuote = {
      clientName: "Ada Lovelace",
      total: 1250,
      lineItems: [{ description: "Fence repair", amount: 1250 }],
      createdAt: new Date(entry.queuedAt + 1000).toISOString(),
    };
    let saved = 0;
    const { runner } = scriptedRunner({
      listQuotes: () => ({ quotes: [serverQuote] }),
      saveQuote: () => { saved += 1; return { id: 1 }; },
    });
    const report = await outbox.flush(runner);
    expect(report.alreadyApplied).toHaveLength(0);
    expect(report.applied).toHaveLength(1);
    expect(saved).toBe(1);
  });

  test("A1: identical line items still dedupe", async () => {
    const outbox = new Outbox(new MemoryStorage());
    const entry = outbox.enqueue("saveQuote", QUOTE_LI)!;
    const serverQuote = {
      clientName: "Ada Lovelace",
      total: 1250,
      lineItems: [{ description: "Deck repair", amount: 1250 }],
      createdAt: new Date(entry.queuedAt + 1000).toISOString(),
    };
    const { runner, calls } = scriptedRunner({
      listQuotes: () => ({ quotes: [serverQuote] }),
      saveQuote: () => { throw new Error("must not be called"); },
    });
    const report = await outbox.flush(runner);
    expect(report.alreadyApplied).toHaveLength(1);
    expect(calls.filter((c) => c.action === "saveQuote")).toHaveLength(0);
  });

  test("A2: a server record created days after the queue time does not absorb the create", async () => {
    const outbox = new Outbox(new MemoryStorage());
    const entry = outbox.enqueue("saveQuote", QUOTE_LI)!;
    const serverQuote = {
      clientName: "Ada Lovelace",
      total: 1250,
      lineItems: [{ description: "Deck repair", amount: 1250 }],
      createdAt: new Date(entry.queuedAt + 7 * 24 * 3600_000).toISOString(),
    };
    const { runner } = scriptedRunner({
      listQuotes: () => ({ quotes: [serverQuote] }),
      saveQuote: () => ({ id: 2 }),
    });
    const report = await outbox.flush(runner);
    expect(report.alreadyApplied).toHaveLength(0);
    expect(report.applied).toHaveLength(1);
  });

  test("B(a): two identical payments queued minutes apart both replay", async () => {
    const outbox = new Outbox(new MemoryStorage());
    const t0 = Date.now();
    const payment = { invoiceId: 77, amount: 250, method: "Cash", paymentDate: "2026-11-15" };
    outbox.enqueue("addPayment", payment, { queuedAt: t0 });
    outbox.enqueue("addPayment", { ...payment }, { queuedAt: t0 + 5 * 60_000 });
    expect(outbox.pendingCount()).toBe(2);
    const { runner, calls } = scriptedRunner({
      listInvoices: () => ({ invoices: [{ id: 77, payments: [] }] }),
      addPayment: () => ({ ok: true }),
    });
    const report = await outbox.flush(runner);
    expect(report.applied).toHaveLength(2);
    expect(calls.filter((c) => c.action === "addPayment")).toHaveLength(2);
  });

  test("B(a): a true double-tap (same write within seconds) still merges", () => {
    const outbox = new Outbox(new MemoryStorage());
    const t0 = Date.now();
    const payment = { invoiceId: 77, amount: 250, method: "Cash", paymentDate: "2026-11-15" };
    outbox.enqueue("addPayment", payment, { queuedAt: t0 });
    outbox.enqueue("addPayment", { ...payment }, { queuedAt: t0 + 500 });
    expect(outbox.pendingCount()).toBe(1);
  });

  test("B(b): a queued expense whose create already landed is retired, not duplicated", async () => {
    const outbox = new Outbox(new MemoryStorage());
    const entry = outbox.enqueue("saveBusinessExpense", {
      expenseDate: "2026-11-15",
      vendor: "Lowe's",
      amount: 84.2,
      category: "Materials",
      jobId: null,
    })!;
    const { runner, calls } = scriptedRunner({
      getGrowthToolkit: () => ({
        expenses: [{
          expenseDate: "2026-11-15",
          vendor: "Lowe's",
          amount: 84.2,
          category: "Materials",
          jobId: null,
          createdAt: new Date(entry.queuedAt + 60_000).toISOString(),
        }],
      }),
      saveBusinessExpense: () => { throw new Error("must not be called"); },
    });
    const report = await outbox.flush(runner);
    expect(report.alreadyApplied).toHaveLength(1);
    expect(calls.filter((c) => c.action === "saveBusinessExpense")).toHaveLength(0);
  });

  test("B(b): a queued receipt already recorded on the job is retired", async () => {
    const outbox = new Outbox(new MemoryStorage());
    const entry = outbox.enqueue("addReceipt", {
      jobId: 5,
      vendor: "Home Depot",
      amount: 51.32,
      purchaseDate: "2026-11-15",
      filename: "receipt.jpg",
      note: "",
    })!;
    const { runner, calls } = scriptedRunner({
      getJob: () => ({
        receipts: [{
          vendor: "Home Depot",
          amount: 51.32,
          purchaseDate: "2026-11-15",
          filename: "receipt.jpg",
          createdAt: new Date(entry.queuedAt + 30_000).toISOString(),
        }],
      }),
      addReceipt: () => { throw new Error("must not be called"); },
    });
    const report = await outbox.flush(runner);
    expect(report.alreadyApplied).toHaveLength(1);
    expect(calls.filter((c) => c.action === "addReceipt")).toHaveLength(0);
  });

  test("B(c): convertLeadToJob retires when the lead already shows as converted", async () => {
    const outbox = new Outbox(new MemoryStorage());
    outbox.enqueue("convertLeadToJob", { id: 9 });
    const { runner, calls } = scriptedRunner({
      listLeads: () => ({ leads: [{ id: 9, name: "Won Lead", stage: "won" }] }),
      convertLeadToJob: () => { throw new Error("must not be called"); },
    });
    const report = await outbox.flush(runner);
    expect(report.alreadyApplied).toHaveLength(1);
    expect(calls.filter((c) => c.action === "convertLeadToJob")).toHaveLength(0);
  });

  test("B(c): an 'already converted' server answer retires the entry instead of rejecting it", async () => {
    const outbox = new Outbox(new MemoryStorage());
    outbox.enqueue("convertLeadToJob", { id: 10 });
    const { runner } = scriptedRunner({
      listLeads: () => ({ leads: [{ id: 10, name: "Race Lead", stage: "new" }] }),
      convertLeadToJob: () => { throw new Error("action convertLeadToJob error: This lead has already been converted to a job."); },
    });
    const report = await outbox.flush(runner);
    expect(report.alreadyApplied).toHaveLength(1);
    expect(report.rejected).toHaveLength(0);
    expect(outbox.pendingCount()).toBe(0);
    expect(outbox.rejectedEntries()).toHaveLength(0);
  });

  test("A3: read cache entries are scoped per account and purgeable", () => {
    let scope: number | null = 7;
    const cache = new ReadCache(new MemoryStorage(), undefined, () => scope);
    cache.put("listJobs", {}, [{ id: 1 }]);
    scope = 8;
    expect(cache.get("listJobs", {})).toBeNull();
    scope = 7;
    expect(cache.get("listJobs", {})?.data).toEqual([{ id: 1 }]);
    cache.clearAll();
    expect(cache.get("listJobs", {})).toBeNull();
  });

  test("A3: outbox counts only cover the signed-in account; clear empties all", () => {
    const outbox = new Outbox(new MemoryStorage());
    outbox.enqueue("saveClient", { name: "Ada" }, { userId: 1 });
    outbox.enqueue("saveClient", { name: "Grace" }, { userId: 2 });
    expect(outbox.pendingCount(1)).toBe(1);
    expect(outbox.pendingCount(2)).toBe(1);
    expect(outbox.pendingCount()).toBe(2);
    outbox.clear();
    expect(outbox.pendingCount()).toBe(0);
  });
});

describe("source wiring", () => {
  const apiSource = readFileSync(new URL("./client/src/api.ts", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("./client/src/App.tsx", import.meta.url), "utf8");
  const coreSource = readFileSync(new URL("./client/src/offlineCore.ts", import.meta.url), "utf8");

  test("api wraps reads and writes for offline mode", () => {
    expect(apiSource).toContain("READ_CACHE_ACTIONS");
    expect(apiSource).toContain("OUTBOX_ACTIONS");
    expect(apiSource).toContain('"saveQuote"');
    expect(apiSource).toContain('"saveInvoice"');
    expect(apiSource).toContain('"addPayment"');
    expect(apiSource).toContain('"listJobs"');
    expect(apiSource).toContain("offlineCacheTimestamp");
    expect(apiSource).toContain("registerOfflineActionRunner");
  });

  test("session is cleared only on a server verdict, never on transport failure", () => {
    expect(apiSource).toContain("getLastRefreshFailure");
    expect(apiSource).toContain('lastRefreshFailure = "network"');
    expect(apiSource).toContain('lastRefreshFailure = "verdict"');
    // The invalid-session dispatch must sit AFTER the network guard.
    const guardAt = apiSource.indexOf('getLastRefreshFailure() === "network"');
    const dispatchAt = apiSource.indexOf("AUTH_SESSION_INVALID_EVENT));", guardAt);
    expect(guardAt).toBeGreaterThan(-1);
    expect(dispatchAt).toBeGreaterThan(guardAt);
  });

  test("app restores from the cached profile and banners every shell", () => {
    expect(appSource).toContain("readCachedUser");
    expect(appSource).toContain("setOfflineSession(true)");
    expect(appSource).toContain("persistCachedUser");
    // In-shell, auth screen (x2), terms gate, maintenance, crew home.
    expect(appSource.split("<OfflineBanner").length - 1).toBeGreaterThanOrEqual(5);
    expect(appSource).toContain("You're offline — you're seeing your last synced data");
  });

  test("rejected entries are marked and kept, never silently dropped", () => {
    expect(coreSource).toContain('state: "pending" | "rejected"');
    expect(coreSource).toContain('live.state = "rejected"');
    expect(coreSource).toContain("retryRejected");
    expect(coreSource).toContain("discard(key: string)");
  });
});
