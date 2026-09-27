// Client-portal share-link hardening tests (migration 0036).
// Scratch DB + mocked blobs — nothing touches /data.
// Run: bun scripts/test-portal-hardening.mjs
import { readFileSync } from "node:fs";
import { createTestEnv } from "./secure-login-harness.mjs";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};
const expectThrow = async (name, fn, match) => {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (e) {
    check(name, String(e.message).includes(match), `got: ${e.message.slice(0, 80)}`);
  }
};

const env = await createTestEnv();
const { Actions, libsql, withMeta } = env;
const blobs = {
  getUrl: async (key) => `https://blobs.test/${key}`,
  put: async () => {},
  delete: async () => {},
};
let blobPuts = 0;
const blobsSpy = { ...blobs, put: async (...a) => { blobPuts++; return blobs.put(...a); } };
const M = (overrides = {}) => withMeta({ blobs, userAgent: "portal-test/1.0", clientIp: "10.9.0.1", ...overrides });
const sha = async (t) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))).toString("hex");
const q = async (sql, args = []) => (await libsql.execute({ sql, args })).rows;
const DAY = 86400000;

try {
  // --- setup -----------------------------------------------------------------
  await env.createVerifiedUser("owner@test.com", "correct-horse-123");
  const login = await Actions.login.handler(withMeta({ userAgent: "t", clientIp: "10.9.0.1" }), { email: "owner@test.com", password: "correct-horse-123" });
  const S = login.sessionToken;
// Mirror production: server.mjs parses args with action.request before the handler.
const call = (action, ip, args, extra = {}) => {
  const parsed = action.request.safeParse(args ?? {});
  if (!parsed.success) throw new Error("Invalid request for this action.");
  return action.handler(M({ clientIp: ip, ...extra }), parsed.data);
};
const callOwn = (action, ip, args, extra = {}) => call(action, ip, { _sessionToken: S, ...args }, extra);
  const now = Date.now();
  const jobA = Number((await q("INSERT INTO jobs (company_id, client_name, job_address, job_type, job_date, created_at, updated_at) VALUES (1,'A Client','1 Main St','Kitchen','2026-09-27',?,?) RETURNING id", [now, now]))[0].id);
  const jobB = Number((await q("INSERT INTO jobs (company_id, client_name, job_address, job_type, job_date, created_at, updated_at) VALUES (1,'B Client','2 Main St','Bath','2026-09-27',?,?) RETURNING id", [now, now]))[0].id);
  const selA = Number((await q("INSERT INTO selections (company_id, job_id, category, item, created_at, updated_at) VALUES (1,?, 'Cabinets','Shaker',?,?) RETURNING id", [jobA, now, now]))[0].id);
  const selB = Number((await q("INSERT INTO selections (company_id, job_id, category, item, created_at, updated_at) VALUES (1,?, 'Tile','Hex',?,?) RETURNING id", [jobB, now, now]))[0].id);
  const docA = Number((await q("INSERT INTO documents (company_id, job_id, kind, title, signer_name, signature_blob_key, signed_at, created_at) VALUES (1,?, 'change_order','CO-1','Danny','sig/k.png',?,?) RETURNING id", [jobA, now, now]))[0].id);
  const docContract = Number((await q("INSERT INTO documents (company_id, job_id, kind, title, signer_name, signature_blob_key, signed_at, created_at) VALUES (1,?, 'contract','CTR-1','Danny','sig/k2.png',?,?) RETURNING id", [jobA, now, now]))[0].id);
  check("setup: jobs/selections/documents created", jobA > 0 && selA > 0 && docA > 0);

  const createLink = (ip, jobId, expiresInDays) =>
    callOwn(Actions.createPortalLink, ip, { jobId, ...(expiresInDays === undefined ? {} : { expiresInDays }) });

  // --- A. create + info -------------------------------------------------------
  const t0 = Date.now();
  const link90 = await createLink("10.9.0.1", jobA);
  check("create: default 90-day expiry", Math.abs(new Date(link90.expiresAt).getTime() - (t0 + 90 * DAY)) < 60_000, link90.expiresAt);
  check("create: route uses #portal fragment", link90.route.startsWith("#portal="));
  const info = await callOwn(Actions.getPortalLinkInfo, "10.9.0.1", { jobId: jobA });
  check("info: hint matches token tail", info.link?.hint === link90.token.slice(-6));
  check("info: viewCount 0, not expired", info.link?.viewCount === 0 && info.link?.expired === false);
  check("info: expiresAt matches", info.link?.expiresAt === link90.expiresAt);

  const link30 = await createLink("10.9.0.1", jobB, 30);
  check("create: 30-day choice", Math.abs(new Date(link30.expiresAt).getTime() - (Date.now() + 30 * DAY)) < 60_000);
  const link365 = await createLink("10.9.0.1", jobB, 365);
  check("create: 365-day choice", Math.abs(new Date(link365.expiresAt).getTime() - (Date.now() + 365 * DAY)) < 60_000);
  const linkNever = await createLink("10.9.0.1", jobB, 0);
  check("create: never (0) -> null expiry", linkNever.expiresAt === null);
  const infoNever = await callOwn(Actions.getPortalLinkInfo, "10.9.0.1", { jobId: jobB });
  check("info: never-expiry link not expired", infoNever.link?.expiresAt === null && infoNever.link?.expired === false);
  await expectThrow("create: invalid expiresInDays rejected", () => createLink("10.9.0.1", jobB, 7), "Invalid request");
  // re-create on jobA revokes the first link (pre-existing behavior)
  const link90b = await createLink("10.9.0.1", jobA);
  await expectThrow("create: superseded link is dead", () => call(Actions.getPortalData, "10.9.0.2", { token: link90.token }), "no longer active");
  check("create: newest link works", (await call(Actions.getPortalData, "10.9.0.2", { token: link90b.token })).job.id === jobA);
  const token = link90b.token;

  // --- B. getPortalData + view logging/throttle --------------------------------
  const d1 = await call(Actions.getPortalData, "10.9.0.3", { token });
  check("portalData: returns job", d1.job.clientName === "A Client");
  let prow = (await q("SELECT view_count FROM portal_tokens WHERE token_hash = ?", [await sha(token)]))[0];
  check("portalData: view_count = 2 (incl. earlier works check)", Number(prow.view_count) === 2);
  let vevents = await q("SELECT COUNT(*) c FROM portal_link_events WHERE event_type = 'view'");
  check("portalData: one view event", Number(vevents[0].c) === 1);
  const ev0 = (await q("SELECT user_agent FROM portal_link_events WHERE event_type='view' LIMIT 1"))[0];
  check("portalData: view event has user agent", (ev0.user_agent || "").length > 0, ev0.user_agent);
  for (let i = 0; i < 20; i++) await call(Actions.getPortalData, "10.9.0.3", { token });
  prow = (await q("SELECT view_count FROM portal_tokens WHERE token_hash = ?", [await sha(token)]))[0];
  vevents = await q("SELECT COUNT(*) c FROM portal_link_events WHERE event_type = 'view'");
  check("throttle: 20 rapid views -> view_count +20", Number(prow.view_count) === 22, String(prow.view_count));
  check("throttle: view events capped (<=2)", Number(vevents[0].c) <= 2, String(vevents[0].c));

  // --- C. writes + events + isolation -------------------------------------------
  await call(Actions.portalUpdateSelection, "10.9.0.4", { token, selectionId: selA, status: "approved" });
  let ev = await q("SELECT event_type FROM portal_link_events WHERE event_type LIKE '%selection%' ORDER BY id DESC LIMIT 1");
  check("write: approval logs approve_selection", ev[0]?.event_type === "approve_selection");
  await call(Actions.portalUpdateSelection, "10.9.0.4", { token, selectionId: selA, status: "rejected" });
  ev = await q("SELECT event_type FROM portal_link_events WHERE event_type LIKE '%selection%' ORDER BY id DESC LIMIT 1");
  check("write: rejection logs reject_selection", ev[0]?.event_type === "reject_selection");
  await expectThrow("isolation: token A + selection B rejected", () => call(Actions.portalUpdateSelection, "10.9.0.4", { token, selectionId: selB, status: "approved" }), "Selection not found");
  blobPuts = 0;
  const signRes = await call(Actions.portalSignChangeOrder, "10.9.0.5", { token, documentId: docA, signerName: "Client", signatureDataBase64: Buffer.from("png").toString("base64") }, { blobs: blobsSpy });
  check("sign: ok + blob stored", signRes.ok === true && blobPuts === 1);
  ev = await q("SELECT event_type, user_agent FROM portal_link_events WHERE event_type='sign' ORDER BY id DESC LIMIT 1");
  check("sign: logs sign event with UA", ev[0]?.event_type === "sign" && (ev[0]?.user_agent || "").includes("portal-test"));
  await expectThrow("sign: non-change_order doc rejected", () => call(Actions.portalSignChangeOrder, "10.9.0.5", { token, documentId: docContract, signerName: "Client", signatureDataBase64: Buffer.from("x").toString("base64") }), "Change order not found");

  // --- D. expiry + revocation ----------------------------------------------------
  const expLink = await createLink("10.9.0.6", jobB);
  await q("UPDATE portal_tokens SET expires_at = ? WHERE token_hash = ?", [Date.now() - 1000, await sha(expLink.token)]);
  await expectThrow("expired: getPortalData rejected", () => call(Actions.getPortalData, "10.9.0.7", { token: expLink.token }), "has expired");
  await expectThrow("expired: write rejected", () => call(Actions.portalUpdateSelection, "10.9.0.7", { token: expLink.token, selectionId: selB, status: "approved" }), "has expired");
  const expInfo = await callOwn(Actions.getPortalLinkInfo, "10.9.0.7", { jobId: jobB });
  check("info: expired flag true", expInfo.link?.expired === true);
  const revLink = await createLink("10.9.0.6", jobB);
  await callOwn(Actions.revokePortalLink, "10.9.0.6", { jobId: jobB });
  await expectThrow("revoked: token dead", () => call(Actions.getPortalData, "10.9.0.7", { token: revLink.token }), "no longer active");

  // --- E. rotation ----------------------------------------------------------------
  const rotOld = await createLink("10.9.0.8", jobA);
  await call(Actions.getPortalData, "10.9.0.8", { token: rotOld.token }); // one view event on old row
  const oldRowId = Number((await q("SELECT id FROM portal_tokens WHERE token_hash = ?", [await sha(rotOld.token)]))[0].id);
  const rotated = await callOwn(Actions.rotatePortalLink, "10.9.0.8", { jobId: jobA });
  check("rotate: returns new token + 90d expiry", rotated.token !== rotOld.token && Math.abs(new Date(rotated.expiresAt).getTime() - (Date.now() + 90 * DAY)) < 60_000);
  await expectThrow("rotate: old token dead immediately", () => call(Actions.getPortalData, "10.9.0.8", { token: rotOld.token }), "no longer active");
  check("rotate: new token works", (await call(Actions.getPortalData, "10.9.0.8", { token: rotated.token })).job.id === jobA);
  const oldEvents = await q("SELECT COUNT(*) c FROM portal_link_events WHERE link_id = ?", [oldRowId]);
  check("rotate: old row events preserved", Number(oldEvents[0].c) >= 1, String(oldEvents[0].c));
  const newToken = rotated.token;

  // --- F. rate limiting --------------------------------------------------------------
  const rlLink = await createLink("10.9.1.1", jobB);
  let okCount = 0, threw429 = false;
  for (let i = 0; i < 31; i++) {
    try { await call(Actions.getPortalData, "10.9.1.1", { token: rlLink.token }); okCount++; }
    catch (e) { if (String(e.message).includes("Too many requests")) threw429 = true; else throw e; }
  }
  check("ratelimit: 30/min per IP then 429", okCount === 30 && threw429, `${okCount} ok, 429=${threw429}`);
  // recovery: backdate the window rows
  await q("UPDATE rate_limit_events SET occurred_at = ? WHERE scope='portal:ip' AND key='10.9.1.1'", [Date.now() - 61_000]);
  await call(Actions.getPortalData, "10.9.1.1", { token: rlLink.token });
  check("ratelimit: recovers after 60s window", true);
  // per-token limit across IPs: 120 ok, 121st 429s
  const tokLink = await createLink("10.9.2.1", jobB);
  let tokOk = 0, tok429 = false;
  for (let i = 0; i < 121; i++) {
    const ip = `10.9.2.${1 + (i % 6)}`; // 6 IPs, ~20 calls each (under IP limit)
    try { await call(Actions.getPortalData, ip, { token: tokLink.token }); tokOk++; }
    catch (e) { if (String(e.message).includes("Too many requests")) tok429 = true; else throw e; }
  }
  check("ratelimit: 120/min per token then 429", tokOk === 120 && tok429, `${tokOk} ok, 429=${tok429}`);
  // prune: stale rows removed on check
  await q("INSERT INTO rate_limit_events (scope, key, occurred_at) VALUES ('portal:ip','stale-test',?)", [Date.now() - 2 * 3600_000]);
  await call(Actions.getPortalData, "10.9.3.9", { token: tokLink.token }).catch(() => {});
  const staleLeft = await q("SELECT COUNT(*) c FROM rate_limit_events WHERE key='stale-test'");
  check("ratelimit: hourly prune removes stale rows", Number(staleLeft[0].c) === 0);

  // --- G. migration backfill ------------------------------------------------------------
  const migSql = readFileSync(new URL("../app/drizzle/0036_portal_link_hardening.sql", import.meta.url), "utf8");
  const legacyLink = await createLink("10.9.4.1", jobB);
  const legacyCreated = Date.now() - 100 * DAY;
  await q("UPDATE portal_tokens SET created_at = ?, expires_at = NULL WHERE token_hash = ?", [legacyCreated, await sha(legacyLink.token)]);
  const upd = migSql.split("--> statement-breakpoint").find((s) => s.trim().startsWith("UPDATE `portal_tokens`"));
  await libsql.execute(upd);
  const bf = (await q("SELECT expires_at FROM portal_tokens WHERE token_hash = ?", [await sha(legacyLink.token)]))[0];
  check("backfill: legacy link gets created_at + 180d", Math.abs(Number(bf.expires_at) - (legacyCreated + 180 * DAY)) < 60_000, String(bf.expires_at));
  check("backfill: legacy link still works", (await call(Actions.getPortalData, "10.9.4.2", { token: legacyLink.token })).job.id === jobB);
  const revLegacy = await createLink("10.9.4.1", jobB);
  await callOwn(Actions.revokePortalLink, "10.9.4.1", { jobId: jobB });
  await q("UPDATE portal_tokens SET created_at = ?, expires_at = NULL WHERE token_hash = ?", [legacyCreated, await sha(revLegacy.token)]);
  await libsql.execute(upd);
  const bfRev = (await q("SELECT expires_at FROM portal_tokens WHERE token_hash = ?", [await sha(revLegacy.token)]))[0];
  check("backfill: revoked rows untouched", bfRev.expires_at === null);

  // --- H. load: 500 views, table stays bounded --------------------------------------------
  // 5 tokens (one per job) x 100 views each — stays under both rate limits.
  const loadJobs = [jobA, jobB];
  for (let j = 0; j < 3; j++) loadJobs.push(Number((await q("INSERT INTO jobs (company_id, client_name, job_address, job_type, job_date, created_at, updated_at) VALUES (1,'Load','3 Main','Paint','2026-09-27',?,?) RETURNING id", [now, now]))[0].id));
  const rlBefore = Number((await q("SELECT COUNT(*) c FROM rate_limit_events"))[0].c);
  const loadTokens = [];
  for (let j = 0; j < 5; j++) loadTokens.push((await createLink("10.9.5.1", loadJobs[j])).token);
  for (let i = 0; i < 500; i++) {
    await call(Actions.getPortalData, `10.9.5.${1 + (i % 25)}`, { token: loadTokens[i % 5] });
  }
  const rlCount = Number((await q("SELECT COUNT(*) c FROM rate_limit_events"))[0].c) - rlBefore;
  check("load: 500 views -> exactly 2 rows each, table bounded", rlCount === 1000, `${rlCount} rows`);

  // --- I. static: no token logging ----------------------------------------------------------
  const serverSrc = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const actionsBlock = serverSrc.slice(serverSrc.indexOf('"/actions"') > -1 ? serverSrc.indexOf("POST") : 0);
  check("static: server never logs request payload/token", !/console\.(log|error)\([^)]*(payload|args\.token|rawBody)/.test(serverSrc));
  check("static: token travels in POST body, not URL", /token:\s*z\.string\(\)/.test(readFileSync(new URL("../app/server/src/actions.ts", import.meta.url), "utf8")));

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} portal hardening tests passed`);
} finally {
  await env.cleanup();
}
