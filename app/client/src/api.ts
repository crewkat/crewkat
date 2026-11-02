// Typed RPC client. Types come straight from `server/src/actions.ts` — no
// codegen. `createActionClient` returns a proxy that POSTs `{action, args}`
// to `./actions` and returns the typed response.
//
// `import type { Actions }` is type-only by design: the client bundle never
// pulls in any server runtime (bun:sqlite, file APIs, etc.). With
// `verbatimModuleSyntax: true`, dropping `type` is a compile error.

import type { Actions } from "../../server/src/actions";
import { createActionClient } from "@hatch/space-sdk/client";

// The session proof is a short-lived (15-minute) credential. It lives in
// memory only — never in localStorage — so a stolen token dump or storage
// scrape can't replay it later. A rotating HttpOnly refresh cookie (set and
// cleared by the server via Set-Cookie, attached automatically by the
// browser) keeps the owner signed in across restarts.
let activeSessionProof = "";

// Pre-cookie 30-day bearer tokens are still honored by the server during the
// transition window. This key is now read-only: fresh logins never write it.
const LEGACY_TOKEN_STORAGE_KEY = "crewkat-session-token";
const COOKIE_SESSION_MARKER_KEY = "crewkat-cookie-session";
export const AUTH_SESSION_INVALID_EVENT = "crewkat:auth-session-invalid";

// Adopt the proof from a fresh login or silent refresh. Memory-only: any
// legacy persisted token is dropped (dual-mode transition).
export function setActiveSessionToken(token: string) {
  activeSessionProof = token;
  try {
    window.localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    window.localStorage.setItem(COOKIE_SESSION_MARKER_KEY, "1");
  } catch { /* storage unavailable */ }
}

// Restore a legacy pre-cookie token during the transition window. The
// localStorage copy is left intact so it survives app restarts until it
// expires or the owner signs in fresh (which issues the cookie).
export function restoreLegacySessionToken(token: string) {
  activeSessionProof = token;
}

// Legacy servers (no Set-Cookie support) predate the cookie flow: their
// login response carries no `setCookies`. Keep the old
// persist-to-localStorage behavior there so the app keeps working.
export function persistLegacySessionToken(token: string) {
  activeSessionProof = token;
  try {
    window.localStorage.setItem(LEGACY_TOKEN_STORAGE_KEY, token);
    window.localStorage.removeItem(COOKIE_SESSION_MARKER_KEY);
  } catch { /* storage unavailable */ }
}

export function isCookieLoginResult(result: unknown): boolean {
  return !!result && typeof result === "object" && "setCookies" in result;
}

export function getStoredSessionToken(): string {
  try { return window.localStorage.getItem(LEGACY_TOKEN_STORAGE_KEY) ?? ""; } catch { return ""; }
}

export function clearActiveSessionToken() {
  activeSessionProof = "";
  try {
    window.localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(COOKIE_SESSION_MARKER_KEY);
  } catch { /* storage unavailable */ }
}

const AUTH_ERROR_PATTERN = /session has expired|sign in to continue|unusual sign-in activity/i;

// Admin panel Phase 1: impersonation. While active, every API call goes out
// with the impersonation proof instead of the admin's own, so the app behaves
// as the target user. Silent refresh is disabled in this mode (the admin's
// refresh cookie would otherwise silently restore the admin identity).
//
// The impersonation proof + target name are persisted in sessionStorage
// (per-tab, dies with the tab) so a reload mid-impersonation resumes the
// preview instead of silently dropping back to whatever identity the
// bootstrap finds first. The admin's own proof is only parked in memory
// as a fallback: it is short-lived (~15 min) and can be expired or gone
// (after a reload) by the time the admin ends the preview, so End
// restores the admin identity from the HttpOnly refresh cookie — which
// impersonation never touches — via restoreAdminSessionAfterImpersonation.
const IMPERSONATION_STORAGE_KEY = "crewkat-impersonation";
let impersonationProof: string | null = null;
let parkedAdminProof = "";
let impersonationName = "";
export const IMPERSONATION_EVENT = "crewkat:impersonation";

function persistImpersonation() {
  try {
    if (impersonationProof) {
      window.sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify({ proof: impersonationProof, name: impersonationName }));
    } else {
      window.sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
    }
  } catch { /* storage unavailable */ }
}

function clearPersistedImpersonation() {
  try { window.sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY); } catch { /* storage unavailable */ }
}

// Resume an impersonation that was active before a reload. Runs at module
// load so the proof is in place before any component mounts or any query
// fires. The AuthScreen bootstrap validates the proof against the server;
// an already-expired one fails cleanly into the cookie restore there.
try {
  if (typeof window !== "undefined" && window.sessionStorage) {
    const raw = window.sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { proof?: unknown; name?: unknown };
      if (typeof parsed.proof === "string" && parsed.proof) {
        impersonationProof = parsed.proof;
        impersonationName = typeof parsed.name === "string" ? parsed.name : "";
      }
    }
  }
} catch { /* storage unavailable or corrupt — start clean */ }

export function startImpersonation(proof: string, userName: string) {
  parkedAdminProof = activeSessionProof;
  impersonationProof = proof;
  impersonationName = userName;
  persistImpersonation();
  window.dispatchEvent(new Event(IMPERSONATION_EVENT));
}

export function endImpersonationLocal() {
  impersonationProof = null;
  activeSessionProof = parkedAdminProof;
  parkedAdminProof = "";
  impersonationName = "";
  clearPersistedImpersonation();
  window.dispatchEvent(new Event(IMPERSONATION_EVENT));
}

/**
 * End-of-impersonation restore: drop the impersonation state, then bring
 * back the admin identity from the HttpOnly refresh cookie (forced
 * trySilentRefresh — refreshSession authenticates by cookie only, and
 * impersonation never touched the cookie). The parked in-memory proof is
 * kept only as a fallback for legacy (pre-cookie) admin sessions; if
 * neither path yields a proof the session is left empty and the app
 * lands on the sign-in screen — never on a stored legacy identity.
 * Dispatches IMPERSONATION_EVENT when done so the shell reloads the user.
 * Call AFTER adminImpersonateEnd has revoked the session server-side.
 */
export async function restoreAdminSessionAfterImpersonation(): Promise<boolean> {
  const parked = parkedAdminProof;
  impersonationProof = null;
  impersonationName = "";
  parkedAdminProof = "";
  clearPersistedImpersonation();
  activeSessionProof = parked;
  const refreshed = await trySilentRefresh(true).catch(() => false);
  if (!refreshed && !parked) activeSessionProof = "";
  window.dispatchEvent(new Event(IMPERSONATION_EVENT));
  return refreshed || !!parked;
}

export function isImpersonating() {
  return impersonationProof != null;
}

export function impersonationTargetName() {
  return impersonationName;
}

function isAuthErrorBody(body: unknown): boolean {
  return !!body && typeof body === "object" && "error" in body &&
    typeof (body as { error?: unknown }).error === "string" &&
    AUTH_ERROR_PATTERN.test((body as { error: string }).error);
}

// Single-flight silent refresh: concurrent expired requests share one
// refreshSession call, so a rotation is never mistaken for token theft.
// Disabled while impersonating (the admin's cookie would restore the admin
// identity and silently drop the impersonation session).
let lastEndpoint: RequestInfo | URL = "/actions";
let refreshPromise: Promise<boolean> | null = null;
export function trySilentRefresh(force = false): Promise<boolean> {
  if (isImpersonating()) return Promise.resolve(false);
  if (!force) {
    try {
      if (window.localStorage.getItem(COOKIE_SESSION_MARKER_KEY) !== "1") return Promise.resolve(false);
    } catch { return Promise.resolve(false); }
  }
  if (!refreshPromise) {
    const endpoint = lastEndpoint;
    refreshPromise = (async () => {
      try {
        const response = await globalThis.fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "refreshSession", args: {} }),
        });
        const body = (await response.json().catch(() => null)) as { data?: { sessionToken?: unknown } } | null;
        const token = body?.data?.sessionToken;
        if (typeof token === "string" && token) {
          setActiveSessionToken(token);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

const authenticatedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  lastEndpoint = input;
  if (!init?.body || typeof init.body !== "string") return globalThis.fetch(input, init);
  const payload = JSON.parse(init.body) as { action?: string; args?: Record<string, unknown>; actionCallId?: string };
  // The refresh call authenticates via the HttpOnly cookie; never attach a proof to it.
  if (payload.action === "refreshSession") return globalThis.fetch(input, { ...init, credentials: "same-origin" });
  const send = (proof: string) => globalThis.fetch(input, {
    ...init,
    credentials: "same-origin",
    body: JSON.stringify({ ...payload, args: { ...(payload.args ?? {}), ...(proof ? { _sessionToken: proof } : {}) } }),
  });
  let response = await send(impersonationProof ?? activeSessionProof);
  let authFailed = false;
  try {
    authFailed = isAuthErrorBody(await response.clone().json());
  } catch { /* non-JSON body: leave it to the caller */ }
  if (!authFailed) return response;
  // The proof expired or was revoked: one silent cookie refresh, then a
  // single retry with the fresh proof.
  if (await trySilentRefresh()) {
    response = await send(impersonationProof ?? activeSessionProof);
    try {
      if (!isAuthErrorBody(await response.clone().json())) return response;
    } catch { return response; }
  }
  // Still unauthorized: drop the session and tell the app to show sign-in.
  clearActiveSessionToken();
  window.dispatchEvent(new Event(AUTH_SESSION_INVALID_EVENT));
  return response;
}) as typeof globalThis.fetch;

type BaseApi = ReturnType<typeof createActionClient<typeof Actions>>;
export type PortalExpiryDays = 30 | 90 | 365 | 0;
type PortalLinkResult = { token: string; route: string; expiresAt: string | null };
type PortalLinkInfoResult = {
  link: {
    hint: string;
    expiresAt: string | null;
    expired: boolean;
    viewCount: number;
    firstViewedAt: string | null;
    lastViewedAt: string | null;
    createdAt: string;
  } | null;
};
type PortalHardenedApi = Omit<BaseApi, "createPortalLink"> & {
  createPortalLink: (args: { jobId: number; expiresInDays?: PortalExpiryDays }) => Promise<PortalLinkResult>;
  getPortalLinkInfo: (args: { jobId: number }) => Promise<PortalLinkInfoResult>;
  rotatePortalLink: (args: { jobId: number; expiresInDays?: PortalExpiryDays }) => Promise<PortalLinkResult>;
};

// The hosted Crewkat server has the hardened portal action contracts. They are
// declared here while this artifact's client remains type-linked to its local
// action module; requests still cross the normal typed actions boundary.
const baseApi = createActionClient<typeof Actions>({ fetch: authenticatedFetch, endpoint: "/actions" }) as PortalHardenedApi;

// Chunk D offline mode v1: the last successful Jobs/Clients/Invoices/Estimates
// list responses are cached in localStorage. When the network fails (fetch
// throws TypeError), the cached list is served instead and its timestamp is
// recorded so screens can render a "last updated" note. Mutations are NOT
// queued — they fail loudly while offline.
const OFFLINE_CACHED_ACTIONS: ReadonlySet<string> = new Set(["listJobs", "listClients", "listInvoices", "listQuotes"]);
const offlineServedAt: Record<string, number> = {};

/** Unix-ms timestamp when `action` last served its list from the offline cache, or null. */
export function offlineCacheTimestamp(action: string): number | null {
  return offlineServedAt[action] ?? null;
}

function offlineCacheKey(action: string): string {
  return `crewkat-offline-cache:${action}`;
}

export const api: PortalHardenedApi = new Proxy(baseApi, {
  get(target: PortalHardenedApi, property: string | symbol, receiver: unknown) {
    const value = Reflect.get(target as object, property, receiver);
    if (typeof property !== "string" || !OFFLINE_CACHED_ACTIONS.has(property) || typeof value !== "function") return value;
    const action = value as (...args: unknown[]) => Promise<unknown>;
    return async (...callArgs: unknown[]) => {
      try {
        const result = await action.apply(target, callArgs);
        try {
          window.localStorage.setItem(offlineCacheKey(property), JSON.stringify({ at: Date.now(), data: result }));
          delete offlineServedAt[property];
        } catch { /* storage unavailable */ }
        return result;
      } catch (error) {
        // fetch() throws TypeError on network failure. Anything else (a real
        // action error from the server) must propagate normally.
        if (!(error instanceof TypeError)) throw error;
        try {
          const raw = window.localStorage.getItem(offlineCacheKey(property));
          if (raw) {
            const parsed = JSON.parse(raw) as { at: number; data: unknown };
            if (parsed && typeof parsed.at === "number" && parsed.data) {
              offlineServedAt[property] = parsed.at;
              return parsed.data;
            }
          }
        } catch { /* fall through to the original error */ }
        throw error;
      }
    };
  },
});

// Re-exported for convenience so client code can do
//
//     import { api, type ApiResponse } from "./api";
//     type Article = ApiResponse<typeof api, "listArticles">["articles"][number];
//
// They are also available directly from "@hatch/space-sdk/client".
export type { ApiRequest, ApiResponse } from "@hatch/space-sdk/client";
