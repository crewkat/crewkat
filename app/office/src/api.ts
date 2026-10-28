// Office typed RPC client.
//
// Mirrors app/client/src/api.ts: types come straight from
// `server/src/actions.ts` (type-only import), and the session proof handling
// is the phone client's — a short-lived (15-minute) in-memory proof, a
// rotating HttpOnly refresh cookie handled by the `refreshSession` action,
// legacy pre-cookie bearer tokens still honored during the transition
// window, and a single-flight silent refresh on auth errors.
//
// One difference from the phone client: the phone app is served from /app and
// can use a relative endpoint, but Office is served from /office while the
// real endpoint is POST /actions at the domain root — so the endpoint here
// is the absolute "/actions" (createActionClient passes a custom endpoint
// through to fetch untouched).

import type { Actions } from "../../server/src/actions";
import { createActionClient } from "@hatch/space-sdk/client";
import type {
  AuthUser,
  Lead,
  LeadActivity,
  LeadStage,
  OfficeDashboardData,
  OfficeSearchResults,
} from "./types";

let activeSessionProof = "";

const LEGACY_TOKEN_STORAGE_KEY = "crewkat-session-token";
const COOKIE_SESSION_MARKER_KEY = "crewkat-cookie-session";
export const AUTH_SESSION_INVALID_EVENT = "crewkat:auth-session-invalid";

export function setActiveSessionToken(token: string) {
  activeSessionProof = token;
  try {
    window.localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    window.localStorage.setItem(COOKIE_SESSION_MARKER_KEY, "1");
  } catch { /* storage unavailable */ }
}

export function restoreLegacySessionToken(token: string) {
  activeSessionProof = token;
}

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

// Platform admin impersonation (mirrors the phone client): while active,
// every API call goes out with the impersonation proof instead of the
// admin's own, so Office behaves as the target user. Silent refresh is
// disabled in this mode (the admin's refresh cookie would otherwise
// silently restore the admin identity), and the admin's proof is parked
// in memory to be restored on End. Sessions last 30 minutes server-side.
let impersonationProof: string | null = null;
let parkedAdminProof = "";
let impersonationName = "";
export const IMPERSONATION_EVENT = "crewkat:impersonation";

export function startImpersonation(proof: string, userName: string) {
  parkedAdminProof = activeSessionProof;
  impersonationProof = proof;
  impersonationName = userName;
  window.dispatchEvent(new Event(IMPERSONATION_EVENT));
}

export function endImpersonationLocal() {
  impersonationProof = null;
  activeSessionProof = parkedAdminProof;
  parkedAdminProof = "";
  impersonationName = "";
  window.dispatchEvent(new Event(IMPERSONATION_EVENT));
}

export function isImpersonating() {
  return impersonationProof != null;
}

export function impersonationTargetName() {
  return impersonationName;
}

const AUTH_ERROR_PATTERN = /session has expired|sign in to continue|unusual sign-in activity/i;

function isAuthErrorBody(body: unknown): boolean {
  return !!body && typeof body === "object" && "error" in body &&
    typeof (body as { error?: unknown }).error === "string" &&
    AUTH_ERROR_PATTERN.test((body as { error: string }).error);
}

// Single-flight silent refresh: concurrent expired requests share one
// refreshSession call, so a rotation is never mistaken for token theft.
const ENDPOINT = "/actions";
let refreshPromise: Promise<boolean> | null = null;
export function trySilentRefresh(force = false): Promise<boolean> {
  if (isImpersonating()) return Promise.resolve(false);
  if (!force) {
    try {
      if (window.localStorage.getItem(COOKIE_SESSION_MARKER_KEY) !== "1") return Promise.resolve(false);
    } catch { return Promise.resolve(false); }
  }
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await globalThis.fetch(ENDPOINT, {
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
  if (await trySilentRefresh()) {
    response = await send(impersonationProof ?? activeSessionProof);
    try {
      if (!isAuthErrorBody(await response.clone().json())) return response;
    } catch { return response; }
  }
  clearActiveSessionToken();
  window.dispatchEvent(new Event(AUTH_SESSION_INVALID_EVENT));
  return response;
}) as typeof globalThis.fetch;

type BaseApi = ReturnType<typeof createActionClient<typeof Actions>>;

/** Editable lead fields accepted by saveLead (create) and updateLead. */
export interface LeadInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  serviceType: string;
  source: string;
  notes: string;
  estimatedValue: string;
  projectSize: "small" | "medium" | "large";
  engagement: "slow" | "normal" | "fast";
}

/**
 * Phase-1 office contract additions. These actions are being built on the
 * server in parallel; until they land in `Actions`, they are declared here
 * from the agreed contract. saveLead/listLeads are re-declared because the
 * office contract extends them (email/address/estimatedValue on save,
 * estimatedValue on list).
 */
interface OfficeApiExtension {
  saveLead: (args: LeadInput) => Promise<{ id: number; score: number }>;
  listLeads: (args: Record<string, never>) => Promise<{ leads: Lead[]; winRate: number }>;
  updateLead: (args: Partial<LeadInput> & { id: number; stage?: LeadStage }) => Promise<{ ok: true }>;
  deleteLead: (args: { id: number }) => Promise<{ ok: true }>;
  getLeadActivities: (args: { leadId: number }) => Promise<{ activities: LeadActivity[] }>;
  addLeadActivity: (args: { leadId: number; kind: string; body: string }) => Promise<{ id: number }>;
  convertLeadToJob: (args: { id: number }) => Promise<{ clientId: number; jobId: number }>;
  getOfficeDashboard: (args: Record<string, never>) => Promise<OfficeDashboardData>;
  getOfficeSearch: (args: { query: string }) => Promise<OfficeSearchResults>;
}

export type OfficeApi = Omit<BaseApi, "saveLead" | "listLeads"> & OfficeApiExtension;

const baseApi = createActionClient<typeof Actions>({ fetch: authenticatedFetch, endpoint: ENDPOINT });

export const api: OfficeApi = baseApi as unknown as OfficeApi;

export type { AuthUser };
