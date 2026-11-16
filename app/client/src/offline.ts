// Offline mode — browser wiring around the pure engine in offlineCore.ts.
//
// Owns: the localStorage-backed read cache + outbox singletons, the shared
// connectivity store (navigator online/offline events PLUS real fetch
// outcomes reported by the API layer — navigator.onLine alone misses
// "browser thinks it's online but the server is unreachable"), the cached
// signed-in profile that lets a cold start offline restore the session UI,
// and the auto-sync triggers (reconnect, app start, periodic retry).

import { useSyncExternalStore } from "react";
import { spaceQueryClient } from "@hatch/space-sdk/client";
import {
  Outbox,
  ReadCache,
  type ActionRunner,
  type KeyValueStorage,
  type OutboxEntry,
} from "./offlineCore";

const localStorageAdapter: KeyValueStorage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    // May throw on quota — ReadCache/Outbox handle that themselves.
    window.localStorage.setItem(key, value);
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch { /* ignore */ }
  },
  keys() {
    try {
      return Object.keys(window.localStorage);
    } catch {
      return [];
    }
  },
};

export const readCache = new ReadCache(localStorageAdapter);
export const outbox = new Outbox(localStorageAdapter);

// ---------------------------------------------------------------------------
// Connectivity store
// ---------------------------------------------------------------------------

let networkDown = false;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function getOfflineSnapshot(): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return networkDown;
}

export function subscribeConnectivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the API layer after every fetch outcome. A resolved fetch —
 * any HTTP response at all — proves the network path works; a transport
 * failure proves it doesn't, whatever navigator.onLine claims. */
export function noteNetworkResult(ok: boolean) {
  const was = networkDown;
  networkDown = !ok;
  if (was !== networkDown) emit();
  if (ok) void flushOutbox();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    emit();
    void flushOutbox();
  });
  window.addEventListener("offline", () => emit());
  outbox.onChange = () => emit();
}

/** Offline === no connectivity right now. Pending/rejected describe the
 * outbox so the banner can show sync state even after reconnecting. */
export interface OfflineState {
  offline: boolean;
  pendingCount: number;
  rejected: OutboxEntry[];
}

export function useOfflineState(): OfflineState {
  const snap = useSyncExternalStore(subscribeConnectivity, () => version, () => version);
  void snap;
  return {
    offline: getOfflineSnapshot(),
    pendingCount: outbox.pendingCount(),
    rejected: outbox.rejectedEntries(),
  };
}

// ---------------------------------------------------------------------------
// Cached signed-in profile (offline session restore)
// ---------------------------------------------------------------------------

const CACHED_USER_KEY = "crewkat-cached-user";

/** The last user profile the server confirmed. Stored so a cold start with
 * no network can restore the signed-in UI from cache instead of bouncing
 * to sign-in; the server revalidates on reconnect. Cleared whenever the
 * session genuinely ends (sign-out or a server auth verdict). */
export function persistCachedUser(user: unknown): void {
  try {
    if (user) window.localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  } catch { /* storage unavailable */ }
}

export function readCachedUser<T = { id?: number }>(): T | null {
  try {
    const raw = window.localStorage.getItem(CACHED_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function clearCachedUser(): void {
  try {
    window.localStorage.removeItem(CACHED_USER_KEY);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Offline-session flag: set when the current sign-in was restored from the
// cached profile without server confirmation. The shell revalidates (and
// clears this) as soon as connectivity returns.
// ---------------------------------------------------------------------------

let offlineSession = false;
export function setOfflineSession(value: boolean): void {
  offlineSession = value;
}
export function isOfflineSession(): boolean {
  return offlineSession;
}

// ---------------------------------------------------------------------------
// Auto-sync: replay the outbox through the registered action runner.
// ---------------------------------------------------------------------------

let actionRunner: ActionRunner | null = null;
let timersStarted = false;

export function registerOfflineActionRunner(runner: ActionRunner): void {
  actionRunner = runner;
  if (!timersStarted && typeof window !== "undefined") {
    timersStarted = true;
    // globalThis timers, not window.*: this module loads in test
    // environments whose window stub may not carry the full timer set.
    // Both timers are unref'd where the runtime supports it (Node/Bun —
    // browsers return plain numbers) so they never hold a test process
    // open; in the browser the page lifetime governs them anyway.
    const startTimer = globalThis.setTimeout(() => void flushOutbox(), 4_000) as { unref?: () => void } | number;
    if (typeof startTimer === "object") startTimer.unref?.();
    // Periodic retry while the app stays open.
    const retryTimer = globalThis.setInterval(() => {
      if (!getOfflineSnapshot()) void flushOutbox();
    }, 60_000) as { unref?: () => void } | number;
    if (typeof retryTimer === "object") retryTimer.unref?.();
  }
}

export async function flushOutbox(): Promise<void> {
  if (!actionRunner) return;
  if (outbox.pendingCount() === 0) return;
  if (getOfflineSnapshot()) return;
  const cached = readCachedUser();
  const report = await outbox.flush(actionRunner, { currentUserId: cached?.id ?? null });
  if (report.applied.length > 0 || report.alreadyApplied.length > 0) {
    // Fresh server state now exists for whatever the replay touched —
    // refetch the visible queries instead of leaving cached lists stale.
    void spaceQueryClient.invalidateQueries();
  }
  emit();
}
