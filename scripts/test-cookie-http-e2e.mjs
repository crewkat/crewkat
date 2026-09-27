// HTTP end-to-end: login response must set the HttpOnly refresh cookie via the
// Set-Cookie header while the JSON body redacts the token value.
// Boots the real server.mjs (production cookie mode) on a scratch DATA_DIR.
// Run: bun scripts/test-cookie-http-e2e.mjs
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dataDir = await mkdtemp(join(tmpdir(), "crewkat-e2e-"));
const PORT = 31873;

const server = spawn("bun", ["server.mjs"], {
  cwd: REPO,
  env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), DATA_DIR: dataDir },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOut = "";
server.stdout.on("data", (d) => { serverOut += d.toString(); });
server.stderr.on("data", (d) => { serverOut += d.toString(); });

const kill = async () => { server.kill("SIGTERM"); await rm(dataDir, { recursive: true, force: true }); };
process.on("exit", () => { try { server.kill("SIGKILL"); } catch {} });

// Wait for the listening line (migrations run first).
const ready = await new Promise((resolve) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (/listening on/i.test(serverOut)) { clearInterval(iv); resolve(true); }
    else if (Date.now() - t0 > 60_000) { clearInterval(iv); resolve(false); }
    else if (server.exitCode !== null) { clearInterval(iv); resolve(false); }
  }, 200);
});
if (!ready) {
  console.log("server output:\n" + serverOut.slice(-2000));
  check("server booted", false);
  await kill();
  process.exit(1);
}
check("server booted (production mode)", true);

const call = async (action, args, cookie) => {
  const res = await fetch(`http://127.0.0.1:${PORT}/actions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ action, args }),
  });
  const rawBody = await res.text();
  return { res, body: JSON.parse(rawBody), rawBody, setCookie: res.headers.get("set-cookie") ?? "" };
};

try {
  // --- signup + verify over HTTP -------------------------------------------
  const su = await call("signUp", { name: "E2E", email: "e2e@test.com", password: "correct-horse-123" });
  const code = su.body?.data?.verificationCode;
  check("signup ok", su.body?.data?.ok === true, JSON.stringify(su.body).slice(0, 120));
  check("verification code available", typeof code === "string" && code.length === 6);
  const ve = await call("verifyEmail", { email: "e2e@test.com", code });
  check("verify ok", ve.body?.data?.ok === true);

  // --- login: the critical assertions ---------------------------------------
  const login = await call("login", { email: "e2e@test.com", password: "correct-horse-123" });
  check("login ok", !!login.body?.data?.sessionToken);
  const header = login.setCookie;
  check("login: Set-Cookie header present", header.length > 0, header.slice(0, 60));
  check("login: __Host- prefix (prod)", header.startsWith("__Host-crewkat_rt="), header.slice(0, 40));
  check("login: HttpOnly", /;\s*HttpOnly/i.test(header));
  check("login: Secure", /;\s*Secure/i.test(header));
  check("login: SameSite=Lax", /;\s*SameSite=Lax/i.test(header));
  check("login: Path=/", /;\s*Path=\//.test(header));
  check("login: Max-Age=2592000", /;\s*Max-Age=2592000/i.test(header));

  const tokenValue = header.split(";")[0].split("=").slice(1).join("=");
  check("login: header carries a token", tokenValue.length >= 32);
  check("login: JSON body does NOT contain the refresh token", !login.rawBody.includes(tokenValue), "token leaked into JSON!");
  check("login: JSON setCookies redacted", (login.body?.data?.setCookies?.[0] ?? "").includes("<redacted>"));
  check("login: JSON still signals a cookie login", (login.body?.data?.setCookies ?? []).length === 1);

  // --- refresh over HTTP with the cookie ------------------------------------
  const cookiePair = header.split(";")[0];
  const ref = await call("refreshSession", {}, cookiePair);
  check("refresh: ok with cookie", !!ref.body?.data?.sessionToken);
  check("refresh: JSON does not leak (no rotation, no cookie value)", !/crewkat_rt=[0-9a-f]{32}/.test(ref.rawBody));

  // --- proof authorizes an action --------------------------------------------
  const sess = await call("getAuthSession", { _sessionToken: ref.body.data.sessionToken });
  check("proof: authorizes getAuthSession", sess.body?.data?.user?.email === "e2e@test.com");

  // --- logout clears the cookie ----------------------------------------------
  const lo = await call("logout", { _sessionToken: ref.body.data.sessionToken }, cookiePair);
  const loHeader = lo.setCookie;
  check("logout: clear-cookie header", loHeader.includes("Max-Age=0"), loHeader.slice(0, 80));
  check("logout: JSON has no token value", !/crewkat_rt=[0-9a-f]{32}/.test(lo.rawBody));
  const refAfter = await call("refreshSession", {}, cookiePair);
  check("refresh after logout: refused", !!refAfter.body?.error, JSON.stringify(refAfter.body).slice(0, 80));
} finally {
  await kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} HTTP e2e checks passed`);
