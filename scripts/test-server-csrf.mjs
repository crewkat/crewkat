// End-to-end CSRF + Set-Cookie plumbing test: boots the real server.mjs on a
// scratch DATA_DIR and POSTs to /actions with various Origin headers.
// Run: bun scripts/test-server-csrf.mjs
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

const workRoot = await mkdtemp(join(tmpdir(), "crewkat-csrf-test-"));
const DATA_DIR = join(workRoot, "data");
const PORT = 3210 + Math.floor(Math.random() * 1000);
const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const server = spawn("bun", ["server.mjs"], {
  cwd: REPO,
  env: { ...process.env, DATA_DIR, PORT: String(PORT), SESSION_IP_SALT: "test-salt" },
  stdio: ["ignore", "pipe", "pipe"],
});
const logs = [];
server.stdout.on("data", (d) => logs.push(d.toString()));
server.stderr.on("data", (d) => logs.push(d.toString()));

async function waitForHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start: " + logs.join("\n").slice(-2000));
}

try {
  await waitForHealth();
  const post = (origin, referer) =>
    fetch(`http://127.0.0.1:${PORT}/actions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
        ...(referer ? { referer } : {}),
      },
      body: JSON.stringify({ action: "login", args: { email: "nobody@test.com", password: "wrong-password-123" } }),
    });

  // 1. cross-origin POST -> 403, no dispatch
  const evil = await post("https://evil.example.com");
  check("cross-origin POST returns 403", evil.status === 403, `status ${evil.status}`);
  const evilBody = await evil.json().catch(() => ({}));
  check("cross-origin body names the problem", /cross-origin/i.test(evilBody.error ?? ""));

  // 2. no Origin/Referer (non-browser client) -> dispatched (login fails on creds, not on CSRF)
  const plain = await post();
  const plainBody = await plain.json().catch(() => ({}));
  check("no-origin POST is dispatched", plain.status === 200 && /incorrect|attempts/i.test(plainBody.error ?? ""), `status ${plain.status} body ${JSON.stringify(plainBody).slice(0, 80)}`);

  // 3. same-origin POST -> dispatched
  const same = await post(`http://127.0.0.1:${PORT}`);
  const sameBody = await same.json().catch(() => ({}));
  check("same-origin POST is dispatched", same.status === 200 && /incorrect|attempts/i.test(sameBody.error ?? ""));

  // 4. cross-origin Referer (no Origin) -> 403
  const refEvil = await post(undefined, "https://evil.example.com/page");
  check("cross-origin Referer returns 403", refEvil.status === 403, `status ${refEvil.status}`);

  // 5. same-origin Referer -> dispatched
  const refSame = await post(undefined, `http://127.0.0.1:${PORT}/`);
  check("same-origin Referer is dispatched", refSame.status === 200);
} finally {
  server.kill();
  await rm(workRoot, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} CSRF checks passed`);
