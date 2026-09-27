// Secure persistent login tests. Scratch DB + mocked email transport — no real
// email, nothing touches /data. Run: bun scripts/test-secure-login.mjs
import { createTestEnv, extractCookieToken } from "./secure-login-harness.mjs";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

const env = await createTestEnv();
const { Actions, libsql, sentEmails, withMeta } = env;
const DEV = { isProdCookie: false, userAgent: "test-agent", ipHash: "iph-1" };
const sha = async (t) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))).toString("hex");
const sessionRows = async (userId) =>
  (await libsql.execute({ sql: "SELECT id, token_type, family_id, replaced_by, revoked_at, expires_at, created_at, absolute_expires_at FROM auth_sessions WHERE user_id = ? ORDER BY id", args: [userId] })).rows;

try {
  // --- setup: verified user --------------------------------------------------
  const userId = await env.createVerifiedUser("owner@test.com", "correct-horse-123");
  check("setup: user created", userId > 0);

  // --- 1. login issues proof + dev refresh cookie -----------------------------
  const login = await Actions.login.handler(withMeta(DEV), { email: "owner@test.com", password: "correct-horse-123" });
  check("login: returns proof token", typeof login.sessionToken === "string" && login.sessionToken.length >= 32);
  check("login: returns user", login.user.email === "owner@test.com");
  const cookie = login.setCookies?.[0] ?? "";
  check("login: dev cookie name is crewkat_rt", cookie.startsWith("crewkat_rt=") && !cookie.startsWith("__Host-"));
  check("login: cookie is HttpOnly", /;\s*HttpOnly/i.test(cookie), cookie);
  check("login: cookie SameSite=Lax", /;\s*SameSite=Lax/i.test(cookie));
  check("login: cookie Path=/", /;\s*Path=\//.test(cookie));
  check("login: cookie Max-Age=2592000", /;\s*Max-Age=2592000/i.test(cookie));
  check("login: dev cookie omits Secure", !/;\s*Secure/i.test(cookie));
  const refreshToken = extractCookieToken(cookie);
  check("login: cookie carries a token", refreshToken.length >= 32);

  let rows = await sessionRows(userId);
  const proofRow = rows.find((r) => r.token_type === "proof");
  const refreshRow = rows.find((r) => r.token_type === "refresh");
  check("login: proof row created", !!proofRow);
  check("login: refresh row created", !!refreshRow);
  check("login: proof expires in 15 minutes", proofRow && Number(proofRow.expires_at) - Number(proofRow.created_at) === 15 * 60_000);
  check("login: refresh absolute expiry is 30 days", refreshRow && Number(refreshRow.absolute_expires_at) - Number(refreshRow.created_at) === 30 * 24 * 60 * 60_000);
  check("login: proof and refresh share a family", proofRow && refreshRow && proofRow.family_id === refreshRow.family_id && !!proofRow.family_id);

  // --- 2. proof authorizes normal actions ------------------------------------
  const authed = await Actions.getAuthSession.handler(withMeta(DEV), { _sessionToken: login.sessionToken });
  check("proof: authorizes getAuthSession", authed.user.email === "owner@test.com");

  // --- 3. refresh token must NOT authorize normal actions ----------------------
  // (getAuthSession swallows auth errors and returns { user: null })
  const refreshAsApi = await Actions.getAuthSession.handler(withMeta(DEV), { _sessionToken: refreshToken });
  check("refresh token rejected as API credential", refreshAsApi.user === null);

  // --- 4. refresh without rotation (row younger than 60 min) -------------------
  const r1 = await Actions.refreshSession.handler(withMeta({ ...DEV, refreshToken }), {});
  check("refresh: returns a new proof", typeof r1.sessionToken === "string" && r1.sessionToken !== login.sessionToken);
  check("refresh: no rotation within 60 min (no Set-Cookie)", r1.setCookies.length === 0);
  rows = await sessionRows(userId);
  check("refresh: still one refresh row (not rotated)", rows.filter((r) => r.token_type === "refresh" && !r.revoked_at).length === 1);

  // --- 5. rotation after 60 minutes -------------------------------------------
  await libsql.execute({
    sql: "UPDATE auth_sessions SET created_at = ? WHERE user_id = ? AND token_type = 'refresh' AND revoked_at IS NULL",
    args: [Date.now() - 61 * 60_000, userId],
  });
  const r2 = await Actions.refreshSession.handler(withMeta({ ...DEV, refreshToken }), {});
  check("rotation: returns a proof", typeof r2.sessionToken === "string");
  check("rotation: Set-Cookie issued", r2.setCookies.length === 1 && r2.setCookies[0].startsWith("crewkat_rt="));
  const newRefreshToken = extractCookieToken(r2.setCookies[0]);
  check("rotation: new refresh token differs", newRefreshToken !== refreshToken);
  rows = await sessionRows(userId);
  const oldRow = rows.find((r) => r.token_type === "refresh" && r.revoked_at);
  const newRow = rows.find((r) => r.token_type === "refresh" && !r.revoked_at);
  check("rotation: old row revoked", !!oldRow);
  check("rotation: old row replaced_by set", !!oldRow?.replaced_by);
  check("rotation: successor keeps the family", !!newRow && newRow.family_id === oldRow.family_id);
  check("rotation: successor keeps absolute expiry", !!newRow && Number(newRow.absolute_expires_at) === Number(oldRow.absolute_expires_at));

  // --- 6. grace window: replay rotated token within 120s -----------------------
  const r3 = await Actions.refreshSession.handler(withMeta({ ...DEV, refreshToken }), {});
  check("grace: replay within 120s succeeds", typeof r3.sessionToken === "string");
  check("grace: no theft alert sent", !sentEmails.some((e) => e.kind === "security"));

  // --- 7. theft: replay rotated token after grace ------------------------------
  await libsql.execute({
    sql: "UPDATE auth_sessions SET revoked_at = ? WHERE id = ?",
    args: [Date.now() - 130_000, oldRow.id],
  });
  let theftError = "";
  try {
    await Actions.refreshSession.handler(withMeta({ ...DEV, refreshToken }), {});
  } catch (e) {
    theftError = e.message;
  }
  check("theft: replay after grace throws security error", /unusual sign-in activity/i.test(theftError), theftError);
  rows = await sessionRows(userId);
  check("theft: entire family revoked", rows.every((r) => r.revoked_at));
  const alert = sentEmails.find((e) => e.kind === "security");
  check("theft: security alert email attempted", !!alert && alert.to === "owner@test.com", alert?.subject ?? "none");

  // --- 8. legacy dual-mode: old 30-day body token still works ------------------
  const legacyToken = "legacylegacylegacylegacylegacylegacylegacy01";
  await libsql.execute({
    sql: "INSERT INTO auth_sessions (user_id, token_hash, token_type, expires_at, last_seen_at, created_at) VALUES (?, ?, 'legacy', ?, ?, ?)",
    args: [userId, await sha(legacyToken), Date.now() + 30 * 24 * 60 * 60_000, Date.now(), Date.now()],
  });
  const legacyAuthed = await Actions.getAuthSession.handler(withMeta(DEV), { _sessionToken: legacyToken });
  check("legacy: old localStorage token still accepted", legacyAuthed.user.email === "owner@test.com");

  // --- 9. logout revokes family + clears cookie ---------------------------------
  const login2 = await Actions.login.handler(withMeta({ ...DEV, ipHash: "iph-2" }), { email: "owner@test.com", password: "correct-horse-123" });
  const cookie2 = extractCookieToken(login2.setCookies[0]);
  const out = await Actions.logout.handler(withMeta({ ...DEV, ipHash: "iph-2", refreshToken: cookie2 }), {});
  check("logout: ok", out.ok === true);
  check("logout: clears cookie (Max-Age=0)", out.setCookies.length === 1 && /Max-Age=0/.test(out.setCookies[0]) && out.setCookies[0].startsWith("crewkat_rt=;"));
  const famRows = (await libsql.execute({
    sql: "SELECT revoked_at FROM auth_sessions WHERE user_id = ? AND family_id = (SELECT family_id FROM auth_sessions WHERE user_id = ? AND token_type='refresh' ORDER BY id DESC LIMIT 1)",
    args: [userId, userId],
  })).rows;
  check("logout: whole family revoked", famRows.length > 0 && famRows.every((r) => r.revoked_at));
  let loggedOutRefreshFails = false;
  try {
    await Actions.refreshSession.handler(withMeta({ ...DEV, refreshToken: cookie2 }), {});
  } catch (e) {
    loggedOutRefreshFails = /sign in to continue/i.test(e.message);
  }
  check("logout: refresh after logout rejected", loggedOutRefreshFails);

  // --- 10. refresh rate limiting (10/min per IP) -------------------------------
  const login3 = await Actions.login.handler(withMeta({ ...DEV, ipHash: "iph-rl" }), { email: "owner@test.com", password: "correct-horse-123" });
  const rlToken = extractCookieToken(login3.setCookies[0]);
  let rateLimitedAt = -1;
  for (let i = 0; i < 12; i++) {
    try {
      await Actions.refreshSession.handler(withMeta({ ...DEV, ipHash: "iph-rl", refreshToken: rlToken }), {});
    } catch (e) {
      if (/too many requests/i.test(e.message)) { rateLimitedAt = i + 1; break; }
      throw e;
    }
  }
  check("rate limit: 11th refresh in a minute refused", rateLimitedAt === 11, `refused at attempt ${rateLimitedAt}`);

  // --- 11. password reset revokes proof + refresh + legacy ---------------------
  const login4 = await Actions.login.handler(withMeta({ ...DEV, ipHash: "iph-3" }), { email: "owner@test.com", password: "correct-horse-123" });
  sentEmails.length = 0;
  await Actions.requestPasswordReset.handler(withMeta(DEV), { email: "owner@test.com" });
  const resetCode = sentEmails.find((e) => e.kind === "auth" && e.purpose === "reset_password")?.code;
  check("reset: code issued", !!resetCode);
  await Actions.resetPassword.handler(withMeta(DEV), { email: "owner@test.com", code: resetCode, password: "new-correct-horse-456" });
  rows = await sessionRows(userId);
  check("reset: all session rows revoked (proof+refresh+legacy)", rows.length > 0 && rows.every((r) => r.revoked_at));
  const login5 = await Actions.login.handler(withMeta({ ...DEV, ipHash: "iph-4" }), { email: "owner@test.com", password: "new-correct-horse-456" });
  check("reset: can sign in with the new password", !!login5.sessionToken);

  // --- 12. expired refresh is rejected -----------------------------------------
  const rlRefresh = extractCookieToken(login5.setCookies[0]);
  await libsql.execute({
    sql: "UPDATE auth_sessions SET expires_at = ?, absolute_expires_at = ? WHERE user_id = ? AND token_type='refresh' AND revoked_at IS NULL",
    args: [Date.now() - 1000, Date.now() - 1000, userId],
  });
  let expiredError = "";
  try {
    await Actions.refreshSession.handler(withMeta({ ...DEV, ipHash: "iph-5", refreshToken: rlRefresh }), {});
  } catch (e) {
    expiredError = e.message;
  }
  check("expired refresh rejected", /session has expired/i.test(expiredError), expiredError);

  // --- 13. migration 0035 columns exist -----------------------------------------
  const cols = (await libsql.execute("PRAGMA table_info(auth_sessions)")).rows.map((r) => r.name);
  for (const c of ["token_type", "family_id", "replaced_by", "absolute_expires_at", "user_agent", "ip_hash"]) {
    check(`migration: column ${c} exists`, cols.includes(c));
  }
} finally {
  await env.cleanup();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
