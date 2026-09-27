// Client auth-logic tests for the secure persistent login (artifact's api.ts).
// Mocks globalThis.fetch + window; drives the real client/src/api.ts.
// Run: bun scripts/test-login-client.mjs
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

// --- window stub (localStorage + event capture) ------------------------------
const store = new Map();
const dispatched = [];
// @ts-ignore
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  dispatchEvent: (e) => { dispatched.push(e.type); return true; },
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: (...a) => setTimeout(...a),
  clearTimeout: (...a) => clearTimeout(...a),
};

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// --- controllable fetch mock -------------------------------------------------
let routes = [];
let calls = [];
function mockFetch(input, init) {
  const payload = JSON.parse(init?.body ?? "{}");
  const call = { url: String(input), payload, credentials: init?.credentials };
  calls.push(call);
  const route = routes.find((r) => r.match(payload, call));
  const body = route ? route.respond(payload, call) : { error: "no mock route matched" };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
}
// @ts-ignore
globalThis.fetch = mockFetch;

const api = await import(join(REPO, "app/client/src/api.ts"));

const AUTH_ERR = { error: "Your session has expired. Sign in again." };
const userData = { data: { user: { id: 1, name: "T", email: "t@t.com", companyId: 1, role: "owner", tier: "premium" } } };
const reset = () => { routes = []; calls = []; dispatched.length = 0; store.clear(); };
const LEGACY_KEY = "crewkat-session-token";
const MARKER_KEY = "crewkat-cookie-session";

// --- 1. cookie login: memory-only, legacy key dropped, marker set -------------
reset();
api.setActiveSessionToken("proof-1");
check("login: proof not written to localStorage", (store.get(LEGACY_KEY) ?? null) === null);
check("login: legacy key removed on new login", !store.has(LEGACY_KEY));
check("login: cookie-session marker set", store.get(MARKER_KEY) === "1");

// --- 2. legacy restore keeps the localStorage copy -----------------------------
reset();
store.set(LEGACY_KEY, "legacy-abc");
api.restoreLegacySessionToken("legacy-abc");
check("legacy: localStorage copy preserved", store.get(LEGACY_KEY) === "legacy-abc");
check("legacy: getStoredSessionToken reads it", api.getStoredSessionToken() === "legacy-abc");

// --- 3. expired proof -> single silent refresh -> one retry --------------------
reset();
api.setActiveSessionToken("proof-old");
routes = [
  { match: (p) => p.action === "refreshSession", respond: () => ({ data: { sessionToken: "proof-new" } }) },
  { match: (p, c) => p.action === "getAuthSession" && p.args._sessionToken === "proof-old", respond: () => AUTH_ERR },
  { match: (p) => p.action === "getAuthSession", respond: () => userData },
];
const r3 = await api.api.getAuthSession({ _sessionToken: "active" });
check("retry: recovers after silent refresh", r3.user?.email === "t@t.com");
check("retry: refresh called exactly once", calls.filter((c) => c.payload.action === "refreshSession").length === 1, `${calls.length} total calls`);
check("retry: second attempt used the new proof", calls.some((c) => c.payload.action === "getAuthSession" && c.payload.args._sessionToken === "proof-new"));
check("retry: no invalid-session event", !dispatched.includes("crewkat:auth-session-invalid"));
check("retry: refresh used same-origin credentials", calls.find((c) => c.payload.action === "refreshSession")?.credentials === "same-origin");
check("retry: refreshed proof kept in memory only (no localStorage write)", !store.has(LEGACY_KEY));

// --- 4. single-flight: 3 concurrent expiries -> 1 refresh -----------------------
reset();
api.setActiveSessionToken("proof-old");
let refreshCalls = 0;
routes = [
  { match: (p) => p.action === "refreshSession", respond: () => { refreshCalls++; return { data: { sessionToken: "proof-new2" } }; } },
  { match: (p, c) => p.action === "getAuthSession" && p.args._sessionToken === "proof-old", respond: () => AUTH_ERR },
  { match: (p) => p.action === "getAuthSession", respond: () => userData },
];
const [a, b, c] = await Promise.all([
  api.api.getAuthSession({ _sessionToken: "active" }),
  api.api.getAuthSession({ _sessionToken: "active" }),
  api.api.getAuthSession({ _sessionToken: "active" }),
]);
check("single-flight: all three recover", a.user && b.user && c.user);
check("single-flight: one refresh for three expiries", refreshCalls === 1, `${refreshCalls} refresh calls`);
check("single-flight: memory-only after refresh", !store.has(LEGACY_KEY));

// --- 5. refresh failure -> session dropped + event ------------------------------
reset();
store.set(LEGACY_KEY, "legacy-dead");
api.setActiveSessionToken("proof-dead");
routes = [
  { match: (p) => p.action === "refreshSession", respond: () => ({ error: "Sign in to continue." }) },
  { match: () => true, respond: () => AUTH_ERR },
];
await api.api.getAuthSession({ _sessionToken: "active" }).catch(() => {});
check("dead session: invalid-session event dispatched", dispatched.includes("crewkat:auth-session-invalid"));
check("dead session: legacy key cleared", !store.has(LEGACY_KEY));
check("dead session: marker cleared", !store.has(MARKER_KEY));

// --- 6. cookie vs legacy result detection ---------------------------------------
reset();
check("fallback: detects cookie login result", api.isCookieLoginResult({ sessionToken: "x", setCookies: ["__Host-crewkat_rt=<redacted>; Path=/; HttpOnly"] }) === true);
check("fallback: missing setCookies is not a cookie result", api.isCookieLoginResult({ sessionToken: "x", user: {} }) === false);
api.persistLegacySessionToken("legacy-server-token");
check("fallback: legacy server token persisted", store.get(LEGACY_KEY) === "legacy-server-token");
check("fallback: legacy persist clears marker", !store.has(MARKER_KEY));

// --- 7. theft message also triggers refresh+retry ---------------------------------
reset();
api.setActiveSessionToken("proof-old");
routes = [
  { match: (p) => p.action === "refreshSession", respond: () => ({ data: { sessionToken: "proof-n3" } }) },
  { match: (p) => p.action === "getAuthSession" && p.args._sessionToken === "proof-old", respond: () => ({ error: "We spotted unusual sign-in activity and signed you out on all devices. Sign in again." }) },
  { match: (p) => p.action === "getAuthSession", respond: () => userData },
];
const r7 = await api.api.getAuthSession({ _sessionToken: "active" });
check("theft message: triggers refresh+retry", r7.user?.email === "t@t.com");

// --- 8. trySilentRefresh without marker does not hit the network ------------------
reset();
routes = [{ match: () => true, respond: () => ({ data: { sessionToken: "x" } }) }];
const sr = await api.trySilentRefresh();
check("silent refresh: no marker -> no network call", sr === false && calls.length === 0);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} client checks passed`);
