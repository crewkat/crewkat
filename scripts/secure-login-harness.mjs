// Shared harness for secure-login tests: scratch DATA_DIR, migrated DB, mocked
// privileged email transport. Imported by test-secure-login.mjs (dev cookie)
// and test-secure-login-prod-cookie.mjs (NODE_ENV=production cookie).
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

export async function createTestEnv() {
  const workRoot = await mkdtemp(join(tmpdir(), "crewkat-login-test-"));
  const DATA_DIR = join(workRoot, "data");
  await mkdir(join(DATA_DIR, "blobs"), { recursive: true });
  const libsql = createClient({ url: `file:${join(DATA_DIR, "app.db")}` });
  await libsql.execute("PRAGMA journal_mode = WAL");
  const db = drizzle(libsql);
  await migrate(db, { migrationsFolder: join(REPO, "app/drizzle") });

  const sentEmails = [];
  const ctx = {
    spaceDir: DATA_DIR,
    db: () => db,
    invalidateQueries: () => {},
    executePrivileged: async (contract, args) => {
      if (contract.name === "sendAuthEmail") {
        sentEmails.push({ kind: "auth", ...args });
        return { delivery: "sent" };
      }
      if (contract.name === "sendSecurityAlert") {
        sentEmails.push({ kind: "security", ...args });
        return { delivery: "sent" };
      }
      throw new Error(`unexpected privileged call: ${contract.name}`);
    },
  };

  const { Actions } = await import(join(REPO, "app/server/dist/actions.js"));

  const withMeta = (overrides = {}) => ({ ...ctx, ...overrides });

  // Create a verified user via the real signup flow (captures the email code).
  async function createVerifiedUser(email, password, name = "Test Owner") {
    const c = withMeta();
    await Actions.signUp.handler(c, { name, email, password });
    const code = sentEmails.find((e) => e.kind === "auth" && e.to === email)?.code;
    if (!code) throw new Error("no verification code captured");
    await Actions.verifyEmail.handler(c, { email, code });
    const rows = await libsql.execute({ sql: "SELECT id FROM auth_users WHERE email = ?", args: [email.toLowerCase()] });
    return Number(rows.rows[0].id);
  }

  async function cleanup() {
    await rm(workRoot, { recursive: true, force: true });
  }

  return { ctx, withMeta, libsql, db, sentEmails, Actions, createVerifiedUser, cleanup };
}

export function extractCookieToken(setCookieHeader) {
  const m = /^[^=]+=(?<token>[^;]*)/.exec(setCookieHeader ?? "");
  return m?.groups?.token ?? "";
}
