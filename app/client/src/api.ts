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

function isAuthErrorBody(body: unknown): boolean {
  return !!body && typeof body === "object" && "error" in body &&
    typeof (body as { error?: unknown }).error === "string" &&
    AUTH_ERROR_PATTERN.test((body as { error: string }).error);
}

// Single-flight silent refresh: concurrent expired requests share one
// refreshSession call, so a rotation is never mistaken for token theft.
let lastEndpoint: RequestInfo | URL = "/actions";
let refreshPromise: Promise<boolean> | null = null;
export function trySilentRefresh(force = false): Promise<boolean> {
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
  let response = await send(activeSessionProof);
  let authFailed = false;
  try {
    authFailed = isAuthErrorBody(await response.clone().json());
  } catch { /* non-JSON body: leave it to the caller */ }
  if (!authFailed) return response;
  // The proof expired or was revoked: one silent cookie refresh, then a
  // single retry with the fresh proof.
  if (await trySilentRefresh()) {
    response = await send(activeSessionProof);
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
export const api = createActionClient<typeof Actions>({ fetch: authenticatedFetch, endpoint: "/actions" }) as PortalHardenedApi;

// Re-exported for convenience so client code can do
//
//     import { api, type ApiResponse } from "./api";
//     type Article = ApiResponse<typeof api, "listArticles">["articles"][number];
//
// They are also available directly from "@hatch/space-sdk/client".
export type { ApiRequest, ApiResponse } from "@hatch/space-sdk/client";
