// Backup Phase 2 (S3 offsite) behavior tests.
//
// Covers the BACKUP_S3_* wiring added to performBackup (dev-briefs/
// automated-backups.md §2.5, Danny approved 2026-11-04, Cloudflare R2):
//  A. S3 unconfigured -> no fetch at all, run identical to pre-Phase-2.
//  B. S3 configured -> signed path-style PUT + HEAD size verification, the
//     SigV4 signature recomputed independently in this test, success noted
//     in the run row and in the completion email.
//  C. Partially configured -> no upload, ONE alert naming the missing env
//     vars (never values), backup still ok, note recorded.
//  D. S3 HTTP 500 -> backup run still ok (disk + email intact), failure
//     alert sent, failure noted on the run row.
//  E. Daily Tier-A runs upload the .db snapshot through the same helper.
//
// Run from app/:  bun backup-s3.behavior.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { desc } from "drizzle-orm";
import { performBackup } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- Scratch DB + fake ctx ----------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-backup-s3-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const sentEmails: Array<{ to: string; subject: string; text: string; attachments: number }> = [];
const ctx = {
  slug: "tradesign",
  invocationId: "backup-s3-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async (_fn: unknown, args: Record<string, unknown>) => {
    if (args && typeof args.to === "string" && typeof args.subject === "string") {
      sentEmails.push({
        to: args.to,
        subject: args.subject,
        text: String(args.text ?? ""),
        attachments: Array.isArray(args.attachments) ? args.attachments.length : 0,
      });
      return { delivery: "sent" };
    }
    throw new Error("unexpected privileged call");
  },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;

async function latestRun() {
  const rows = await db.select().from(schema.backupRuns).orderBy(desc(schema.backupRuns.id)).limit(1);
  return rows[0]!;
}

// --- Fetch interception ---------------------------------------------------------
interface FetchCall { url: string; method: string; headers: Record<string, string>; body: Buffer | null }
const realFetch = globalThis.fetch;
let fetchCalls: FetchCall[] = [];
let fetchImpl: (call: FetchCall) => Promise<unknown> = async () => ({ ok: false, status: 500, headers: new Headers(), text: async () => "unset fetch impl" });
globalThis.fetch = (async (url: unknown, init: Record<string, unknown> = {}) => {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries((init.headers as Record<string, unknown>) ?? {})) {
    headers[String(k).toLowerCase()] = String(v);
  }
  const call: FetchCall = {
    url: String(url),
    method: String(init.method ?? "GET"),
    headers,
    body: init.body ? Buffer.from(init.body as Uint8Array) : null,
  };
  fetchCalls.push(call);
  return fetchImpl(call);
}) as typeof fetch;

function okS3Impl(state: { putBodyLen: number }) {
  return async (call: FetchCall) => {
    if (call.method === "PUT") {
      state.putBodyLen = call.body?.length ?? 0;
      return { ok: true, status: 200, headers: new Headers(), text: async () => "" };
    }
    if (call.method === "HEAD") {
      return { ok: true, status: 200, headers: new Headers({ "content-length": String(state.putBodyLen) }), text: async () => "" };
    }
    throw new Error(`unexpected method ${call.method}`);
  };
}

// --- Env harness ------------------------------------------------------------------
const S3_ENV_KEYS = ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY", "BACKUP_S3_REGION", "BACKUP_S3_PREFIX"];
const savedEnv = new Map<string, string | undefined>();
for (const k of [...S3_ENV_KEYS, "BACKUP_ALERT_EMAIL"]) savedEnv.set(k, process.env[k]);
function clearS3Env() {
  for (const k of S3_ENV_KEYS) delete process.env[k];
}
function setFullS3Env() {
  process.env.BACKUP_S3_ENDPOINT = "https://acct123.r2.cloudflarestorage.com";
  process.env.BACKUP_S3_BUCKET = "crewkat-backups";
  process.env.BACKUP_S3_ACCESS_KEY_ID = "AKIDTESTEXAMPLE";
  process.env.BACKUP_S3_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.BACKUP_S3_REGION = "auto";
  process.env.BACKUP_S3_PREFIX = "backups/";
}
process.env.BACKUP_ALERT_EMAIL = "backups@test.local";

// --- A. Unconfigured: zero behavior change -----------------------------------------
clearS3Env();
fetchCalls = [];
{
  const emailsBefore = sentEmails.length;
  const res = await performBackup(ctx, "manual");
  check("A: unconfigured backup ok", res.ok === true, res.error ?? "");
  check("A: no fetch attempted", fetchCalls.length === 0, `${fetchCalls.length} call(s)`);
  check("A: result reports no S3 activity", res.s3Uploaded === false && !res.s3Error);
  const run = await latestRun();
  check("A: run notes make no mention of S3", !(run.notes ?? "").includes("S3"), run.notes ?? "(null)");
  const fresh = sentEmails.slice(emailsBefore);
  check("A: completion email sent, no S3 line, no S3 alert",
    fresh.some((e) => /— full \(/.test(e.subject) && !e.text.includes("S3 offsite")) &&
    !fresh.some((e) => e.subject.includes("S3")));
}

// --- B. Configured: signed PUT + HEAD verify ---------------------------------------
setFullS3Env();
fetchCalls = [];
{
  const state = { putBodyLen: 0 };
  fetchImpl = okS3Impl(state);
  const emailsBefore = sentEmails.length;
  const res = await performBackup(ctx, "manual");
  check("B: configured backup ok", res.ok === true, res.error ?? "");
  check("B: exactly one PUT then one HEAD", fetchCalls.length === 2 && fetchCalls[0]!.method === "PUT" && fetchCalls[1]!.method === "HEAD",
    fetchCalls.map((c) => c.method).join(","));
  const put = fetchCalls[0]!;
  const tarName = res.filePath ? res.filePath.split("/").pop()! : "";
  check("B: PUT URL is path-style endpoint/bucket/prefix/name",
    put.url === `https://acct123.r2.cloudflarestorage.com/crewkat-backups/backups/${tarName}`, put.url);
  check("B: HEAD verified the same object URL", fetchCalls[1]!.url === put.url);
  check("B: PUT content-type is application/gzip", put.headers["content-type"] === "application/gzip", put.headers["content-type"] ?? "(none)");
  const bodyHash = createHash("sha256").update(put.body!).digest("hex");
  check("B: x-amz-content-sha256 is the payload hash", put.headers["x-amz-content-sha256"] === bodyHash);
  const auth = put.headers["authorization"] ?? "";
  check("B: Authorization header shape (AWS4-HMAC-SHA256, credential scope, signed headers)",
    /^AWS4-HMAC-SHA256 Credential=AKIDTESTEXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(auth), auth);
  // Independently recompute the signature from the captured request.
  const amzDate = put.headers["x-amz-date"]!;
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = new URL(put.url).pathname;
  const canonicalHeaders = `host:${put.headers["host"]}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, "host;x-amz-content-sha256;x-amz-date", bodyHash].join("\n");
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
  const kDate = createHmac("sha256", "AWS4test-secret-key").update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update("auto").digest();
  const kService = createHmac("sha256", kRegion).update("s3").digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  const expectedSignature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  check("B: SigV4 signature verifies against independent recomputation", auth.endsWith(`Signature=${expectedSignature}`));
  check("B: result reports the upload + key", res.s3Uploaded === true && res.s3Key === `backups/${tarName}`, String(res.s3Key));
  const run = await latestRun();
  check("B: run notes record the S3 upload", (run.notes ?? "").includes(`S3 offsite upload ok: backups/${tarName}`), run.notes ?? "(null)");
  check("B: completion email carries the S3 line",
    sentEmails.slice(emailsBefore).some((e) => e.text.includes(`Full snapshot also uploaded to S3 offsite: backups/${tarName}`)));
}

// --- C. Partially configured: alert + note, no upload, backup ok --------------------
clearS3Env();
process.env.BACKUP_S3_ENDPOINT = "https://acct123.r2.cloudflarestorage.com";
process.env.BACKUP_S3_BUCKET = "crewkat-backups";
fetchCalls = [];
fetchImpl = async () => { throw new Error("fetch must not be called for partial config"); };
{
  const emailsBefore = sentEmails.length;
  const res = await performBackup(ctx, "manual");
  check("C: partial-config backup still ok", res.ok === true, res.error ?? "");
  check("C: no fetch attempted", fetchCalls.length === 0, `${fetchCalls.length} call(s)`);
  const fresh = sentEmails.slice(emailsBefore);
  check("C: one alert naming the missing env vars",
    fresh.filter((e) => e.subject.includes("partially configured")).length === 1 &&
    fresh.some((e) => e.subject.includes("partially configured") && e.text.includes("BACKUP_S3_ACCESS_KEY_ID") && e.text.includes("BACKUP_S3_SECRET_ACCESS_KEY")));
  check("C: alert never prints secret values", !fresh.some((e) => e.text.includes("test-secret-key")));
  const run = await latestRun();
  check("C: run notes record the partial config", (run.notes ?? "").includes("S3 offsite partially configured"), run.notes ?? "(null)");
}

// --- D. S3 HTTP 500: backup ok, alert sent, failure noted ----------------------------
setFullS3Env();
fetchCalls = [];
fetchImpl = async () => ({ ok: false, status: 500, headers: new Headers(), text: async () => "InternalError: boom" });
{
  const emailsBefore = sentEmails.length;
  const res = await performBackup(ctx, "manual");
  check("D: backup still ok when S3 fails", res.ok === true, res.error ?? "");
  check("D: result reports the S3 failure", res.s3Uploaded === false && typeof res.s3Error === "string" && res.s3Error.includes("HTTP 500"), String(res.s3Error));
  const fresh = sentEmails.slice(emailsBefore);
  check("D: S3 failure alert sent", fresh.some((e) => e.subject === "[Crewkat backup] S3 offsite upload FAILED"));
  check("D: completion email still sent, without the S3 success line",
    fresh.some((e) => /— full \(/.test(e.subject)) && !fresh.some((e) => e.text.includes("also uploaded to S3 offsite")));
  const run = await latestRun();
  check("D: run row ok with the failure in notes", run.status === "ok" && (run.notes ?? "").includes("S3 offsite upload FAILED"), `${run.status} / ${run.notes ?? "(null)"}`);
}

// --- E. Daily Tier-A uploads the snapshot through the same helper ---------------------
setFullS3Env();
fetchCalls = [];
{
  const state = { putBodyLen: 0 };
  fetchImpl = okS3Impl(state);
  const emailsBefore = sentEmails.length;
  const res = await performBackup(ctx, "daily-db");
  check("E: daily backup ok", res.ok === true, res.error ?? "");
  check("E: daily run PUT the .db snapshot under the prefix",
    fetchCalls.length === 2 && fetchCalls[0]!.method === "PUT" && /\/crewkat-backups\/backups\/app-\d{8}-\d{6}-[0-9a-f]{6}\.db$/.test(fetchCalls[0]!.url),
    fetchCalls[0]?.url ?? "no calls");
  check("E: daily PUT content-type is the sqlite type", fetchCalls[0]!.headers["content-type"] === "application/x-sqlite3", fetchCalls[0]!.headers["content-type"] ?? "(none)");
  check("E: completion email notes the snapshot upload",
    sentEmails.slice(emailsBefore).some((e) => e.text.includes("Database snapshot also uploaded to S3 offsite:")));
}

// --- Cleanup ---------------------------------------------------------------------------
for (const [k, v] of savedEnv) {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}
globalThis.fetch = realFetch;
await rm(dir, { recursive: true, force: true });

console.log(failures === 0 ? "\nALL BACKUP S3 CHECKS PASSED" : `\n${failures} BACKUP S3 CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
