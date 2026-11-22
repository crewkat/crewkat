// Typed RPC client. Types come straight from `server/src/actions.ts` — no
// codegen. `createActionClient` returns a proxy that POSTs `{action, args}`
// to `./actions` and returns the typed response.
//
// `import type { Actions }` is type-only by design: the client bundle never
// pulls in any server runtime (bun:sqlite, file APIs, etc.). With
// `verbatimModuleSyntax: true`, dropping `type` is a compile error.

import type { Actions } from "../../server/src/actions";
import { createActionClient } from "@hatch/space-sdk/client";
import { isNetworkFailure } from "./offlineCore";
import {
  clearCachedUser,
  flushOutbox,
  noteNetworkResult,
  outbox,
  purgeOfflineAccountData,
  readCache,
  readCachedUser,
  registerOfflineActionRunner,
  setOfflineSession,
} from "./offline";

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

/** True when a cookie session was established on this device (the refresh
 * cookie itself is HttpOnly and unreadable — this marker is its witness). */
export function hasCookieSessionMarker(): boolean {
  try { return window.localStorage.getItem(COOKIE_SESSION_MARKER_KEY) === "1"; } catch { return false; }
}

export function clearActiveSessionToken() {
  activeSessionProof = "";
  try {
    window.localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(COOKIE_SESSION_MARKER_KEY);
  } catch { /* storage unavailable */ }
  // A genuine session end (sign-out, or the server's auth verdict) also
  // retires the cached profile used for offline restore — it must never
  // resurrect a session the server or the user has ended.
  clearCachedUser();
  // …and the account's offline data goes with it (audit A3): cached reads
  // and queued writes belong to the account that made them, so the next
  // account on this device never sees, retries, or discards them.
  purgeOfflineAccountData();
  setOfflineSession(false);
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
// Why the most recent refresh attempt failed. "network" means no response
// ever arrived (offline, server unreachable) — the stored session may still
// be perfectly valid and must be kept. "verdict" means the server answered
// and issued no proof — the session is genuinely over. null = no refresh
// has run yet, or the last one succeeded. The distinction is what keeps an
// airplane-mode cold start from looking exactly like a logout.
let lastRefreshFailure: "network" | "verdict" | null = null;
export function getLastRefreshFailure(): "network" | "verdict" | null {
  return lastRefreshFailure;
}
export function trySilentRefresh(force = false): Promise<boolean> {
  if (isImpersonating()) return Promise.resolve(false);
  if (!force) {
    try {
      if (window.localStorage.getItem(COOKIE_SESSION_MARKER_KEY) !== "1") return Promise.resolve(false);
    } catch { return Promise.resolve(false); }
  }
  if (!refreshPromise) {
    const endpoint = lastEndpoint;
    lastRefreshFailure = null;
    refreshPromise = (async () => {
      try {
        const response = await globalThis.fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "refreshSession", args: {} }),
        });
        noteNetworkResult(true);
        const body = (await response.json().catch(() => null)) as { data?: { sessionToken?: unknown } } | null;
        const token = body?.data?.sessionToken;
        if (typeof token === "string" && token) {
          lastRefreshFailure = null;
          setActiveSessionToken(token);
          return true;
        }
        lastRefreshFailure = "verdict";
        return false;
      } catch {
        lastRefreshFailure = "network";
        noteNetworkResult(false);
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
  const send = async (proof: string) => {
    try {
      const sent = await globalThis.fetch(input, {
        ...init,
        credentials: "same-origin",
        body: JSON.stringify({ ...payload, args: { ...(payload.args ?? {}), ...(proof ? { _sessionToken: proof } : {}) } }),
      });
      noteNetworkResult(true);
      return sent;
    } catch (error) {
      noteNetworkResult(false);
      throw error;
    }
  };
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
  // The refresh never reached the server (offline / unreachable): the auth
  // error above judged a stale proof, not the session itself. Keep the
  // session, and surface this call as the transport failure it is so the
  // read cache / write outbox engage instead of a logout.
  if (getLastRefreshFailure() === "network") {
    throw new TypeError("Network request failed while offline");
  }
  // Still unauthorized after the server judged the refresh cookie too:
  // drop the session and tell the app to show sign-in.
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

// Offline mode v2 (builds on Chunk D v1): three behaviors wrap the raw
// action client here, in one place, so every screen gets them for free.
//
// 1. READ CACHE — successful responses for the app's main reads are cached
//    in localStorage keyed by action + args (offlineCore.ReadCache). When a
//    read fails with a NETWORK error, the last-good response is served
//    instead of an empty screen, and its timestamp is recorded so screens
//    can render a "last updated" note (offlineCacheTimestamp).
// 2. WRITE OUTBOX — a mutation that fails with a NETWORK error is persisted
//    to the ordered outbox (offlineCore.Outbox) and the caller gets a clear
//    "saved on this device" error instead of a bare "Failed to fetch". The
//    queue replays automatically on reconnect (see offline.ts); create-type
//    entries are fingerprint-checked against the server first so a create
//    whose response was lost is never duplicated.
// 3. Everything else — server verdicts of any kind (validation, limits,
//    auth) — propagates exactly as before. Only transport failures engage
//    the offline machinery; that distinction is the whole design.
const READ_CACHE_ACTIONS: ReadonlySet<string> = new Set([
  // Core lists + details (Chunk D v1 set first — screens key off these).
  "listJobs", "listClients", "listInvoices", "listQuotes",
  "getJob", "getClient", "listDocuments", "listAppointments", "listRecurringSchedules",
  "listLeads", "listSubcontractors", "listPhotoPairs", "listShareImages", "listWorkSummaries",
  "listBidBoard", "listJobLoads", "listDocumentAttachments",
  // Home / schedule / settings aggregates. getGrowthToolkit carries the
  // price book the document builders read.
  "getDashboard", "getCrewDayView", "getGrowthToolkit", "getSettings", "getJobOperations",
  "getFinancialSignature", "globalSearch", "getOnboardingChecklist",
]);

// Mutations safe to queue offline: field-work saves keyed to records the
// user owns. Deliberately NOT here (they keep failing loudly offline):
// auth/session actions, Stripe checkout + payment-intent creation (a replay
// could double-charge), portal/public-link actions, admin actions, file
// uploads and photo adds (base64 payloads don't belong in localStorage),
// message sends, timers/clock punches (server-stamped times would be
// wrong on replay), account deletion, and backup restore.
const OUTBOX_ACTIONS: ReadonlySet<string> = new Set([
  // Documents
  "saveQuote", "saveInvoice", "saveDocument", "updateQuoteDocument", "updateInvoiceDocument",
  "updateDocument", "deleteQuote", "deleteInvoice", "duplicateQuote", "duplicateInvoice",
  "convertQuoteToInvoice", "convertQuoteToJob", "renewQuote", "saveQuoteMaterials",
  "updateQuoteDesign", "updateInvoiceDesign", "saveDocumentDesignDefault", "setDocumentImagesPerPage",
  "setInvoiceCardOptions", "updateInvoiceRecurrence", "cancelRecurringInvoice", "generateRecurringInvoice",
  "attachJobMediaToDocument", "deleteDocumentAttachment", "saveDocumentSignatureFields",
  "saveDocumentFillFields", "signDocumentWithDrawnSignature", "saveFinancialSignature",
  "linkDocumentToJob", "linkInvoiceToJob", "linkQuoteToJob", "updateQuoteAutomationStatus",
  // Clients
  "saveClient", "deleteClient", "mergeClients", "appendClientAddress", "renameClient",
  // Jobs and job sub-records
  "createJob", "updateJob", "updateJobInfo", "setJobClient", "setJobContractSum", "updateJobSiteLocation",
  "deleteJob", "completeJob", "reopenJob", "saveProgressUpdate", "deleteProgressUpdate", "saveDailyLog",
  "addPunchItem", "togglePunchItem", "deletePunchItem", "savePunchSignoff", "saveSelection",
  "updateSelectionStatus", "updateSelectionLeadTime", "saveInternalNote", "toggleInternalNote",
  "saveMilestone", "updateMilestoneStatus", "invoiceMilestone", "setJobProductionStage",
  "createJobLoad", "updateJobLoad", "deleteJobLoad", "saveCrewTask", "deleteCrewTask",
  // Payments
  "addPayment", "deletePayment", "toggleInvoicePaid", "updateInvoiceStatus",
  // Schedule
  "saveAppointment", "deleteAppointment", "bulkShiftAppointments", "createRecurringSchedule", "cancelRecurringSchedule",
  // Price book + templates
  "savePriceBookItem", "deletePriceBookItem", "saveQuoteTemplate", "deleteQuoteTemplate",
  // Money records, subs, misc field records
  "addReceipt", "deleteReceipt", "saveBusinessExpense", "deleteBusinessExpense", "saveMileageTrip",
  "deleteMileageTrip", "saveSubcontractor", "deleteSubcontractor", "saveSupplier", "saveSupplierQuote",
  "saveWarranty", "saveCertificate", "saveMaintenancePlan", "completeMaintenancePlan",
  "createPhotoPair", "updatePhotoPair", "deletePhotoPair", "togglePhotoSocial", "updatePhoto", "deletePhoto",
  "saveShareImage", "deleteShareImage", "addVoiceNote", "deleteVoiceNote", "deleteTimeEntry",
  // Leads / pipeline / follow-ups
  "saveLead", "updateLead", "updateLeadStage", "deleteLead", "addLeadActivity", "convertLeadToJob",
  "saveFollowUp", "completeFollowUp", "snoozeFollowUp", "updateAutomationSettings",
  "saveBidBoardItem", "deleteBidBoardItem", "moveBidBoardItem",
  // Company records + settings
  "saveEquipment", "createPurchaseOrder", "updatePurchaseOrderStatus", "receivePurchaseOrder",
  "saveSafetyTalk", "saveIncident", "saveCredential", "renewCredential", "saveCrewPayRate",
  "updateSettings", "updateAppearance",
]);

const offlineServedAt: Record<string, number> = {};

/** Unix-ms timestamp when `action` last served its data from the offline cache, or null. */
export function offlineCacheTimestamp(action: string): number | null {
  return offlineServedAt[action] ?? null;
}

/** Error thrown to the caller when a mutation was queued for offline sync.
 * The message is the user-facing explanation; `offlineQueued` lets call
 * sites special-case it later without string matching. */
export function offlineQueuedError(action: string): Error & { offlineQueued: boolean } {
  const error = new Error(
    "You're offline — this change was saved on this device and will sync when you reconnect.",
  ) as Error & { offlineQueued: boolean };
  error.name = "OfflineQueuedError";
  error.offlineQueued = true;
  void action;
  return error;
}

export const api: PortalHardenedApi = new Proxy(baseApi, {
  get(target: PortalHardenedApi, property: string | symbol, receiver: unknown) {
    const value = Reflect.get(target as object, property, receiver);
    if (typeof property !== "string" || typeof value !== "function") return value;
    const cacheable = READ_CACHE_ACTIONS.has(property);
    const queueable = OUTBOX_ACTIONS.has(property);
    if (!cacheable && !queueable) return value;
    const action = value as (...args: unknown[]) => Promise<unknown>;
    return async (...callArgs: unknown[]) => {
      const args = (callArgs[0] ?? {}) as Record<string, unknown>;
      try {
        const result = await action.apply(target, callArgs);
        if (cacheable) {
          readCache.put(property, args, result);
          delete offlineServedAt[property];
        }
        return result;
      } catch (error) {
        // Only a transport failure engages the offline machinery. A real
        // action error from the server propagates normally.
        if (!isNetworkFailure(error)) throw error;
        if (cacheable) {
          const cached = readCache.get(property, args);
          if (cached) {
            offlineServedAt[property] = cached.at;
            return cached.data;
          }
          throw error;
        }
        // Queueable mutation: persist it (args are JSON-safe by design —
        // they were about to be POSTed as JSON) and tell the user plainly
        // that the change is safe on this device. An oversized payload the
        // outbox refuses keeps the original network error instead.
        const entry = outbox.enqueue(property, args, { userId: readCachedUser()?.id ?? null });
        if (!entry) throw error;
        void flushOutbox();
        throw offlineQueuedError(property);
      }
    };
  },
});

// Auto-sync: replay goes through the RAW client (auth attaches inside
// authenticatedFetch, including the silent cookie refresh), so a flush
// right after an offline cold start revalidates the session as it syncs.
registerOfflineActionRunner(async (action, args) => {
  const fn = (baseApi as unknown as Record<string, (a: Record<string, unknown>) => Promise<unknown>>)[action];
  if (typeof fn !== "function") throw new Error(`Unknown action ${action}`);
  return fn(args);
});


// Re-exported for convenience so client code can do
//
//     import { api, type ApiResponse } from "./api";
//     type Article = ApiResponse<typeof api, "listArticles">["articles"][number];
//
// They are also available directly from "@hatch/space-sdk/client".
export type { ApiRequest, ApiResponse } from "@hatch/space-sdk/client";
