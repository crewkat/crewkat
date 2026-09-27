// Integration test for automated backups. Uses a scratch DATA_DIR and a mocked
// privileged email transport — no real email is sent, nothing touches /data.
// Run: bun scripts/test-automated-backups.mjs
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

// --- setup: scratch data dir + migrated DB ---------------------------------
const workRoot = await mkdtemp(join(tmpdir(), "crewkat-backup-test-"));
const DATA_DIR = join(workRoot, "data");
await mkdir(join(DATA_DIR, "blobs"), { recursive: true });
const DB_PATH = join(DATA_DIR, "app.db");

const libsql = createClient({ url: `file:${DB_PATH}` });
await libsql.execute("PRAGMA journal_mode = WAL");
const db = drizzle(libsql);
await migrate(db, { migrationsFolder: join(REPO, "app/drizzle") });

// seed minimal rows the backup worker spot-checks
await libsql.execute("INSERT INTO auth_users (name, email, password_hash, password_salt, tier, role, created_at, updated_at) VALUES ('Test Owner','owner@test.com','x','y','premium','owner',1735689600000,1735689600000)");
await libsql.execute("INSERT INTO clients (name, created_at, updated_at) VALUES ('Test Client',1735689600000,1735689600000)");
await libsql.execute("INSERT INTO jobs (client_name, job_address, job_type, job_date, created_at, updated_at) VALUES ('Test Client','1 Main St','Bathroom','2025-01-01',1735689600000,1735689600000)");
await libsql.execute("INSERT INTO invoices (client_name, line_items_json, total, created_at, updated_at) VALUES ('Test Client','[]','100.00',1735689600000,1735689600000)");
await libsql.execute("INSERT INTO photos (job_id, stage, blob_key, filename, content_type, created_at) VALUES (1,'during','test/photo1.jpg','photo1.jpg','image/jpeg',1735689600000)");
await libsql.execute("INSERT INTO photos (job_id, stage, blob_key, filename, content_type, created_at) VALUES (1,'during','test/photo2.jpg','photo2.jpg','image/jpeg',1735689600000)");
await mkdir(join(DATA_DIR, "blobs", "test"), { recursive: true });
await writeFile(join(DATA_DIR, "blobs", "test/photo1.jpg"), "fake-jpeg-1");
await writeFile(join(DATA_DIR, "blobs", "test/photo2.jpg"), "fake-jpeg-2");

// --- mock context -----------------------------------------------------------
const sentEmails = [];
const ctx = {
  spaceDir: DATA_DIR,
  db: () => db,
  invalidateQueries: () => {},
  executePrivileged: async (contract, args) => {
    if (contract.name === "sendBackupEmail") {
      sentEmails.push(args);
      return { delivery: "sent" };
    }
    throw new Error(`unexpected privileged call: ${contract.name}`);
  },
};

process.env.BACKUP_ALERT_EMAIL = "owner@test.com";
process.env.BACKUP_HOUR = "0";
process.env.BACKUP_DISK_CAP_MB = "1024";

const { performBackup, performMonthlyVerify, recoverStaleBackupRuns, runScheduledBackup } =
  await import(join(REPO, "app/server/dist/actions.js"));
const backupDir = join(DATA_DIR, "backups");
const listBackups = async () => (await readdir(backupDir)).sort();

// --- 1. daily backup ---------------------------------------------------------
sentEmails.length = 0;
const daily = await performBackup(ctx, "daily-db");
check("daily: ok", daily.ok === true, daily.error ?? "");
check("daily: snapshot file exists", (await listBackups()).some((n) => /^app-\d{8}-\d{6}-[0-9a-f]{6}\.db$/.test(n)));
check("daily: no tar.gz created", !(await listBackups()).some((n) => n.endsWith(".tar.gz")));
check("daily: integrity ok", daily.integrityOk === true);
check("daily: offsite email sent", daily.offsiteSent === true && sentEmails.length === 1);
check("daily: email has db attachment", sentEmails[0]?.attachments?.length === 1 && sentEmails[0].attachments[0].filename.endsWith(".db"));
const rows = await libsql.execute("SELECT status, offsite_sent, integrity_ok FROM backup_runs ORDER BY id DESC LIMIT 1");
check("daily: run row recorded ok", rows.rows[0].status === "ok" && Number(rows.rows[0].offsite_sent) === 1 && Number(rows.rows[0].integrity_ok) === 1);

// --- 2. weekly backup (tar.gz with blobs) ------------------------------------
sentEmails.length = 0;
const weekly = await performBackup(ctx, "weekly-full");
const files = await listBackups();
const tarName = files.find((n) => n.endsWith(".tar.gz"));
check("weekly: ok", weekly.ok === true, weekly.error ?? "");
check("weekly: tar.gz created", Boolean(tarName), tarName ?? "none");
if (tarName) {
  const { stdout } = await Bun.$`tar -tzf ${join(backupDir, tarName)}`.quiet();
  const contents = stdout.toString();
  check("weekly: tar contains snapshot db", /app-\d{8}-\d{6}-[0-9a-f]{6}\.db/.test(contents));
  check("weekly: tar contains blobs", contents.includes("blobs/test/photo1.jpg") && contents.includes("blobs/test/photo2.jpg"));
}
check("weekly: email has 2 attachments", sentEmails[0]?.attachments?.length === 2);

// --- 3. retention pruning ----------------------------------------------------
for (let i = 0; i < 9; i++) {
  const name = `app-202509${String(10 + i).padStart(2, "0")}-030000-aaaa0${i}.db`;
  await writeFile(join(backupDir, name), "x");
  const t = new Date(Date.UTC(2025, 8, 10 + i, 3)).getTime() / 1000;
  await utimes(join(backupDir, name), t, t);
}
for (let i = 0; i < 6; i++) {
  const name = `crewkat-full-202508${String(10 + i).padStart(2, "0")}-030000.tar.gz`;
  await writeFile(join(backupDir, name), "x");
  const t = new Date(Date.UTC(2025, 7, 10 + i, 3)).getTime() / 1000;
  await utimes(join(backupDir, name), t, t);
}
await performBackup(ctx, "daily-db");
const after = await listBackups();
const dailies = after.filter((n) => /^app-\d{8}-\d{6}-[0-9a-f]{6}\.db$/.test(n));
const weeklies = after.filter((n) => n.endsWith(".tar.gz"));
check("retention: 7 daily snapshots kept", dailies.length === 7, `got ${dailies.length}`);
check("retention: 4 weekly archives kept", weeklies.length === 4, `got ${weeklies.length}`);

// --- 4. monthly restore verification -----------------------------------------
sentEmails.length = 0;
const verifyRows0 = await libsql.execute("SELECT count(*) AS n FROM backup_runs WHERE kind='monthly-verify' AND status='ok'");
await performMonthlyVerify(ctx, { alertEmail: "owner@test.com" });
const verifyRows = await libsql.execute("SELECT status, notes FROM backup_runs WHERE kind='monthly-verify' ORDER BY id DESC LIMIT 1");
check("monthly-verify: row recorded ok", verifyRows.rows[0]?.status === "ok", String(verifyRows.rows[0]?.notes ?? "").slice(0, 60));
check("monthly-verify: no failure alert", sentEmails.length === 0);
const verifyRows1 = await libsql.execute("SELECT count(*) AS n FROM backup_runs WHERE kind='monthly-verify' AND status='ok'");
await performMonthlyVerify(ctx, { alertEmail: "owner@test.com" });
const verifyRows2 = await libsql.execute("SELECT count(*) AS n FROM backup_runs WHERE kind='monthly-verify' AND status='ok'");
check("monthly-verify: skipped when recent", Number(verifyRows2.rows[0].n) === Number(verifyRows1.rows[0].n));

// --- 5. stale run recovery ---------------------------------------------------
await libsql.execute("INSERT INTO backup_runs (kind, status, started_at) VALUES ('daily-db','running',1735689600000)");
const marked = await recoverStaleBackupRuns(ctx);
const staleRow = await libsql.execute("SELECT status FROM backup_runs WHERE error LIKE 'Server restarted mid-run%'");
check("stale recovery: marked failed", marked === 1 && staleRow.rows[0]?.status === "failed");

// --- 6. failure path: row-count mismatch -------------------------------------
sentEmails.length = 0;
await libsql.execute("DROP TABLE jobs");
const failed = await performBackup(ctx, "daily-db");
const failedRow = await libsql.execute("SELECT status, error FROM backup_runs ORDER BY id DESC LIMIT 1");
check("failure: run not ok", failed.ok === false);
check("failure: row marked failed", failedRow.rows[0]?.status === "failed");
check("failure: alert email sent", sentEmails.length === 1 && sentEmails[0].subject.includes("FAILED"));
await libsql.execute("CREATE TABLE jobs (id integer PRIMARY KEY AUTOINCREMENT, client_id integer, client_name text, created_at integer, updated_at integer)");

// --- 7. scheduler due logic --------------------------------------------------
await libsql.execute("DELETE FROM backup_runs");
sentEmails.length = 0;
process.env.BACKUP_HOUR = "0";
const first = await runScheduledBackup(ctx);
check("scheduler: runs when due", first.ran === true && first.ok === true, JSON.stringify(first));
const second = await runScheduledBackup(ctx);
check("scheduler: skips when already ran today", second.ran === false);
process.env.BACKUP_HOUR = "23";
await libsql.execute("DELETE FROM backup_runs");
const early = await runScheduledBackup(ctx);
const nowHour = new Date().getUTCHours();
check("scheduler: skips before backup hour", nowHour < 23 ? early.ran === false : true, `utc hour=${nowHour}`);
process.env.BACKUP_HOUR = "0";

// --- 8. no email config: scheduler disabled ----------------------------------
delete process.env.BACKUP_ALERT_EMAIL;
await libsql.execute("DELETE FROM backup_runs");
const disabled = await runScheduledBackup(ctx);
check("scheduler: disabled without BACKUP_ALERT_EMAIL", disabled.ran === false);

// --- cleanup -----------------------------------------------------------------
libsql.close();
await rm(workRoot, { recursive: true, force: true });

const failedCount = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} checks passed.`);
