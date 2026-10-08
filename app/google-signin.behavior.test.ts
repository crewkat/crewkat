// Build 0.7: Sign in with Google (Google Identity Services ID tokens).
//
// Covers:
//  1. Migration 0068 applies: `google_sub` column exists, nullable; unique
//     index `auth_users_google_sub_unique` exists.
//  2. getGoogleClientId: null when GOOGLE_CLIENT_ID unset; the ID when set.
//  3. googleSignIn handler (verification stubbed — never hits Google):
//     - new Google user → account created (googleSub, verified email, name)
//     - existing google_sub → same user signed in (no duplicate)
//     - existing password account, verified email, no google_sub → linked
//     - bad token (stub throws) → rejected
//     - unverified email in payload → rejected
//     - unconfigured (no GOOGLE_CLIENT_ID) → rejected before verification
//     - suspended user → rejected
//     - per-IP rate limit on its own scope (30/15min), separate from login
//  4. Static guards: GIS script + button + actions wired in the client.
//
// Run from app/:  bun google-signin.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions, googleAuth } from "./server/src/actions.ts";
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
async function throwsError(fn: () => Promise<unknown>, match: RegExp): Promise<boolean> {
  try { await fn(); return false; }
  catch (e) { return match.test(e instanceof Error ? e.message : String(e)); }
}

const clientSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");

// --- 1. Migration 0068 --------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-google-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const cols = await sqlite.execute("PRAGMA table_info(auth_users)");
const subCol = cols.rows.find((r) => (r as { name: string }).name === "google_sub") as
  | { name: string; notnull: number }
  | undefined;
check("0068 adds google_sub column", Boolean(subCol), JSON.stringify(cols.rows.map((r) => (r as { name: string }).name)));
check("google_sub is nullable", subCol?.notnull === 0, JSON.stringify(subCol?.notnull));
const idxs = await sqlite.execute("PRAGMA index_list(auth_users)");
check("google_sub unique index exists", idxs.rows.some((r) => (r as { name: string }).name === "auth_users_google_sub_unique" && (r as { unique: number }).unique === 1));

// --- 2/3. Handler tests -------------------------------------------------------
const ctx: any = {
  slug: "tradesign",
  invocationId: "google-test",
  spaceDir: dir,
  db: () => db,
  blobs: { put: async () => {}, getUrl: async (k: string) => `blob://test/${k}`, get: async () => null, delete: async () => {}, head: async () => ({ contentType: "x", size: 0 }) },
  executePrivileged: async () => { throw new Error("no privileged in test"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
  clientIp: "10.9.9.9",
};

const realVerify = googleAuth.verifyIdToken;
googleAuth.verifyIdToken = async (idToken: string) => {
  if (idToken === "bad-token") throw new Error("Google sign-in failed. Try again.");
  if (idToken === "unverified-token") return { sub: "g-unv", email: "unv@example.com", emailVerified: false, name: "Unv" };
  if (idToken === "suspended-token") return { sub: "g-susp", email: "susp@example.com", emailVerified: true, name: "Susp" };
  return { sub: `g-${idToken}`, email: `${idToken}@example.com`, emailVerified: true, name: `G ${idToken}` };
};

const OLD_ENV = process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_ID;

// getGoogleClientId: unconfigured → null
const cfgNull = await (BaseActions.getGoogleClientId as any).handler(ctx, {});
check("getGoogleClientId: null when unconfigured", cfgNull?.clientId === null, JSON.stringify(cfgNull));
// googleSignIn: unconfigured → rejected before verification
check("googleSignIn: rejected when unconfigured", await throwsError(
  () => (BaseActions.googleSignIn as any).handler(ctx, { idToken: "newbie" }), /not configured/i));

process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const cfgSet = await (BaseActions.getGoogleClientId as any).handler(ctx, {});
check("getGoogleClientId: returns the ID when set", cfgSet?.clientId === "test-client-id.apps.googleusercontent.com");

// New Google user → created
const created = await (BaseActions.googleSignIn as any).handler(ctx, { idToken: "newbie" });
check("new Google user: session issued", typeof created?.sessionToken === "string" && created.sessionToken.length > 30);
check("new Google user: email from token", created?.user?.email === "newbie@example.com");
check("new Google user: name from token", created?.user?.name === "G newbie");
const row = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "newbie@example.com")).limit(1))[0];
check("new Google user: googleSub stored", row?.googleSub === "g-newbie", JSON.stringify(row?.googleSub));
check("new Google user: email marked verified", Boolean(row?.emailVerifiedAt));
check("new Google user: setCookies present", Array.isArray(created?.setCookies) && created.setCookies.length > 0);

// Existing google_sub → same user, no duplicate
const again = await (BaseActions.googleSignIn as any).handler(ctx, { idToken: "newbie" });
check("existing google_sub: same user signed in", again?.user?.id === created?.user?.id);
const dupes = await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.email, "newbie@example.com"));
check("existing google_sub: no duplicate account", dupes.length === 1);

// Existing password account + verified Google email → linked
await db.insert(schema.authUsers).values({ companyId: 99, name: "Pw Owner", email: "linkme@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "LINKME01" });
googleAuth.verifyIdToken = async () => ({ sub: "g-linkme", email: "linkme@example.com", emailVerified: true, name: "Link Me" });
const linked = await (BaseActions.googleSignIn as any).handler(ctx, { idToken: "link-token" });
const linkedRow = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "linkme@example.com")).limit(1))[0];
check("email link: returns the existing account", linked?.user?.email === "linkme@example.com" && linked?.user?.id === linkedRow?.id);
check("email link: googleSub stored", linkedRow?.googleSub === "g-linkme");
check("email link: email marked verified", Boolean(linkedRow?.emailVerifiedAt));

// Restore the dispatching stub for the rejection cases below
googleAuth.verifyIdToken = async (idToken: string) => {
  if (idToken === "bad-token") throw new Error("Google sign-in failed. Try again.");
  if (idToken === "unverified-token") return { sub: "g-unv", email: "unv@example.com", emailVerified: false, name: "Unv" };
  if (idToken === "suspended-token") return { sub: "g-susp", email: "susp@example.com", emailVerified: true, name: "Susp" };
  return { sub: `g-${idToken}`, email: `${idToken}@example.com`, emailVerified: true, name: `G ${idToken}` };
};

// Bad token → rejected
check("bad token: rejected", await throwsError(
  () => (BaseActions.googleSignIn as any).handler({ ...ctx, clientIp: "10.9.9.10" }, { idToken: "bad-token" }), /Google sign-in failed/i));
// Unverified email → rejected
check("unverified email: rejected", await throwsError(
  () => (BaseActions.googleSignIn as any).handler({ ...ctx, clientIp: "10.9.9.11" }, { idToken: "unverified-token" }), /not verified/i));

// Suspended user → rejected
await db.insert(schema.authUsers).values({ companyId: 100, name: "Susp", email: "susp@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, googleSub: "g-susp", suspendedAt: new Date(), referralCode: "SUSP0001" });
check("suspended user: rejected", await throwsError(
  () => (BaseActions.googleSignIn as any).handler({ ...ctx, clientIp: "10.9.9.12" }, { idToken: "suspended-token" }), /suspended/i));

// Rate limit: own scope, 30 per 15 min
googleAuth.verifyIdToken = async (t: string) => ({ sub: `g-rl-${t}`, email: `rl-${t}@example.com`, emailVerified: true, name: "RL" });
const rlCtx = { ...ctx, clientIp: "10.9.9.99" };
let okCount = 0;
for (let i = 0; i < 30; i++) {
  await (BaseActions.googleSignIn as any).handler(rlCtx, { idToken: `rl${i}` });
  okCount++;
}
check("rate limit: 30 attempts allowed", okCount === 30);
check("rate limit: 31st rejected", await throwsError(
  () => (BaseActions.googleSignIn as any).handler(rlCtx, { idToken: "rl30" }), /Too many sign-in attempts/i));
const scopes = await sqlite.execute("SELECT DISTINCT scope FROM rate_limit_events");
check("rate limit: own scope (not login:ip)", scopes.rows.some((r) => (r as { scope: string }).scope === "google-signin:ip"));

// Restore
googleAuth.verifyIdToken = realVerify;
if (OLD_ENV === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = OLD_ENV;

// --- 4. Static guards -----------------------------------------------------------
check("server: googleSignIn action defined", serverSrc.includes("googleSignIn: defineAction"));
check("server: getGoogleClientId action defined", serverSrc.includes("getGoogleClientId: defineAction"));
check("server: uses google-auth-library", serverSrc.includes('from "google-auth-library"'));
check("server: rejects when unconfigured", serverSrc.includes("Google sign-in is not configured."));
check("client: GIS script loaded", clientSrc.includes("https://accounts.google.com/gsi/client"));
check("client: GoogleSignInButton component", clientSrc.includes("function GoogleSignInButton"));
check("client: calls api.googleSignIn", clientSrc.includes("api.googleSignIn({ idToken:"));
check("client: calls api.getGoogleClientId", clientSrc.includes("api.getGoogleClientId({})"));
check("client: button hidden without client ID", clientSrc.includes("googleCfg.data?.clientId &&"));
check("client: G logo inline", clientSrc.includes("GoogleGLogo"));

// Regression: the login screen has no session, so both actions must be
// public in the protected Actions export (no _sessionToken required).
// 2026-10-07: they were missing from PUBLIC_ACTIONS and the button could
// never appear for logged-out users.
import { Actions } from "./server/src/actions.ts";
const pubCfg = (Actions as any).getGoogleClientId.request.safeParse({});
check("prod: getGoogleClientId is public (no session required)", pubCfg.success, JSON.stringify(pubCfg.success ? null : pubCfg.error.issues));
const pubSignIn = (Actions as any).googleSignIn.request.safeParse({ idToken: "x" });
check("prod: googleSignIn is public (no session required)", pubSignIn.success, JSON.stringify(pubSignIn.success ? null : pubSignIn.error.issues));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
