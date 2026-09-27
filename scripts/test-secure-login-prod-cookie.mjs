// Production cookie probe: verifies the __Host- prefixed Secure cookie.
// Run: NODE_ENV=production bun scripts/test-secure-login-prod-cookie.mjs
// (server.mjs passes isProdCookie from its own runtime NODE_ENV read.)
import { createTestEnv } from "./secure-login-harness.mjs";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = 1;
};

const env = await createTestEnv();
try {
  const { Actions, withMeta } = env;
  // Mirror what server.mjs does in production: isProdCookie from runtime env.
  const PROD = { isProdCookie: process.env.NODE_ENV === "production", userAgent: "probe", ipHash: "iph-prod" };
  check("probe running as production", process.env.NODE_ENV === "production");

  await env.createVerifiedUser("prod@test.com", "correct-horse-123");
  const login = await Actions.login.handler(withMeta(PROD), { email: "prod@test.com", password: "correct-horse-123" });
  const cookie = login.setCookies?.[0] ?? "";
  check("prod cookie uses __Host-crewkat_rt", cookie.startsWith("__Host-crewkat_rt="), cookie);
  check("prod cookie has Secure", /;\s*Secure/i.test(cookie));
  check("prod cookie is HttpOnly", /;\s*HttpOnly/i.test(cookie));
  check("prod cookie SameSite=Lax", /;\s*SameSite=Lax/i.test(cookie));
  check("prod cookie Path=/", /;\s*Path=\//.test(cookie));
  check("prod cookie Max-Age=2592000", /;\s*Max-Age=2592000/i.test(cookie));

  const out = await Actions.logout.handler(withMeta(PROD), {});
  check("prod logout clears __Host- cookie", out.setCookies[0].startsWith("__Host-crewkat_rt=;") && /Max-Age=0/.test(out.setCookies[0]));
} finally {
  await env.cleanup();
}
process.exitCode = failed;
console.log(failed ? "\nPROD COOKIE PROBE FAILED" : "\nprod cookie probe passed");
