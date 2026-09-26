// Typed RPC client. Types come straight from `server/src/actions.ts` — no
// codegen. `createActionClient` returns a proxy that POSTs `{action, args}`
// to `./actions` and returns the typed response.
//
// `import type { Actions }` is type-only by design: the client bundle never
// pulls in any server runtime (bun:sqlite, file APIs, etc.). With
// `verbatimModuleSyntax: true`, dropping `type` is a compile error.

import type { Actions } from "../../server/src/actions";
import { createActionClient } from "@hatch/space-sdk/client";

let activeSessionToken = "";

// The session token is a long random bearer token. It is kept in memory for
// the active page and mirrored to localStorage so the owner stays signed in
// across app restarts; the server still owns the 30-day sliding expiry and
// revocation. It is cleared on sign-out.
const SESSION_TOKEN_STORAGE_KEY = "crewkat-session-token";
export const AUTH_SESSION_INVALID_EVENT = "crewkat:auth-session-invalid";

export function setActiveSessionToken(token: string) {
  activeSessionToken = token;
  try { window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token); } catch { /* storage unavailable */ }
}

export function getStoredSessionToken(): string {
  try { return window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) ?? ""; } catch { return ""; }
}

export function clearActiveSessionToken() {
  activeSessionToken = "";
  try { window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY); } catch { /* storage unavailable */ }
}

const authenticatedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!init?.body || typeof init.body !== "string") return globalThis.fetch(input, init);
  const payload = JSON.parse(init.body) as { action?: string; args?: Record<string, unknown>; actionCallId?: string };
  const response = await globalThis.fetch(input, {
    ...init,
    body: JSON.stringify({ ...payload, args: { ...(payload.args ?? {}), ...(activeSessionToken ? { _sessionToken: activeSessionToken } : {}) } }),
  });
  if (!response.ok && activeSessionToken) {
    const body = await response.clone().text().catch(() => "");
    if (/session has expired|sign in to continue/i.test(body)) {
      clearActiveSessionToken();
      window.dispatchEvent(new Event(AUTH_SESSION_INVALID_EVENT));
    }
  }
  return response;
}) as typeof globalThis.fetch;

export const api = createActionClient<typeof Actions>({ fetch: authenticatedFetch });

// Re-exported for convenience so client code can do
//
//     import { api, type ApiResponse } from "./api";
//     type Article = ApiResponse<typeof api, "listArticles">["articles"][number];
//
// They are also available directly from "@hatch/space-sdk/client".
export type { ApiRequest, ApiResponse } from "@hatch/space-sdk/client";
