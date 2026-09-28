// Platform admin round 2 verification: settings gating, free-listing limit,
// marketplace disable, user detail shape, tier + session actions, banner.
// Run: bun scripts/test-platform-admin-round2.mjs  (or node)
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const REPO = "/home/hatch/workspace/crewkat-app";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};
const expectErr = async (name, fn, want) => {
  try { await fn(); check(name, false, "expected an error but succeeded"); }
  catch (e) { check(name, String(e.message).includes(want), `got: ${String(e.message).slice(0, 120)}`); }
};

const workRoot = await mkdtemp(join(tmpdir(), "crewkat-pa2-test-"));
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
  blobs: { put: async () => {}, delete: async () => {} },
  invalidateQueries: () => {},
  executePrivileged: async (contract, args) => {
    if (contract.name === "sendAuthEmail") { sentEmails.push({ kind: "auth", ...args }); return { delivery: "sent" }; }
    throw new Error(`unexpected privileged call: ${contract.name}`);
  },
};
const { Actions } = await import(join(REPO, "app/server/dist/actions.js"));
const withMeta = (overrides = {}) => ({ ...ctx, ...overrides });
const call = (action, args, extra = {}) => {
  const parsed = action.request.safeParse(args ?? {});
  if (!parsed.success) throw new Error("Invalid request: " + JSON.stringify(parsed.error.issues).slice(0, 300));
  return action.handler(withMeta({ ...extra }), parsed.data);
};

async function createVerifiedUser(email, password, name = "Test Owner") {
  const c = withMeta();
  await call(Actions.signUp, { name, email, password, marketplaceTermsAccepted: true }, {});
  const code = sentEmails.find((e) => e.kind === "auth" && e.to === email)?.code;
  if (!code) throw new Error("no verification code captured for " + email);
  await call(Actions.verifyEmail, { email, code });
  const rows = await libsql.execute({ sql: "SELECT id FROM auth_users WHERE email = ?", args: [email.toLowerCase()] });
  return Number(rows.rows[0].id);
}

try {
  // --- setup: platform admin + free user ---------------------------------
  const adminId = await createVerifiedUser("admin@test.com", "correct-horse-123", "Admin");
  await libsql.execute({ sql: "UPDATE auth_users SET is_platform_admin = 1 WHERE id = ?", args: [adminId] });
  const freeId = await createVerifiedUser("free@test.com", "correct-horse-123", "Free User");
  const adminLogin = await call(Actions.login, { email: "admin@test.com", password: "correct-horse-123" }, { userAgent: "t", clientIp: "10.0.0.1" });
  const freeLogin = await call(Actions.login, { email: "free@test.com", password: "correct-horse-123" }, { userAgent: "t", clientIp: "10.0.0.2" });
  const admin = (a, args) => call(a, { _sessionToken: adminLogin.sessionToken, ...args });
  const free = (a, args) => call(a, { _sessionToken: freeLogin.sessionToken, ...args });
  check("admin login ok", !!adminLogin.sessionToken);
  check("admin is platform admin", adminLogin.user.isPlatformAdmin === true);

  // --- 1. registration blocking -------------------------------------------
  await admin(Actions.adminSettingsSet, { key: "registration_enabled", value: "0" });
  await expectErr("signup blocked when registration closed", () => createVerifiedUser("blocked@test.com", "correct-horse-123"), "REGISTRATIONS_CLOSED");
  await admin(Actions.adminSettingsSet, { key: "registration_enabled", value: "1" });
  const newId = await createVerifiedUser("new@test.com", "correct-horse-123", "New User");
  check("signup works when registration open", newId > 0);

  // --- 2. free listing limit ----------------------------------------------
  await admin(Actions.adminSettingsSet, { key: "free_listing_limit", value: "2" });
  const mkListing = (n) => free(Actions.createMarketplaceListing, {
    title: `Handyman job ${n}`, category: "handyman", listingType: "job",
    employmentType: "full_time", payUnit: "hourly", priceKind: "contact", price: "", originalPrice: "",
    description: "Test listing for limit checks.", serviceArea: "Tampa Bay",
    companyName: "Free Co", companyPhone: "8135550100", bookable: false, dailyRate: "", photos: [],
  });
  const l1 = await mkListing(1); const l2 = await mkListing(2);
  check("two listings under limit", l1.id > 0 && l2.id > 0);
  await expectErr("third listing rejected at limit 2", () => mkListing(3), "includes 2 active");
  const gate = await free(Actions.marketplaceGate, {});
  check("gate reports limit + count", gate.freeListingLimit === 2 && gate.myActiveListingCount === 2 && gate.enabled === true, JSON.stringify(gate));

  // --- 3. marketplace disabling --------------------------------------------
  await admin(Actions.adminSettingsSet, { key: "marketplace_enabled", value: "0" });
  await expectErr("list blocked when disabled", () => free(Actions.listMarketplaceListings, {}), "MARKETPLACE_DISABLED");
  await expectErr("detail blocked when disabled", () => free(Actions.getMarketplaceListing, { id: l1.id }), "MARKETPLACE_DISABLED");
  await expectErr("create blocked when disabled", () => mkListing(9), "MARKETPLACE_DISABLED");
  await expectErr("flag blocked when disabled", () => free(Actions.marketplaceListingFlag, { listingId: l1.id, reason: "spam", details: "" }), "MARKETPLACE_DISABLED");
  const gateOff = await free(Actions.marketplaceGate, {});
  check("gate stays readable when disabled", gateOff.enabled === false);
  await admin(Actions.adminSettingsSet, { key: "marketplace_enabled", value: "1" });
  const back = await free(Actions.listMarketplaceListings, {});
  check("list works after re-enable", Array.isArray(back.listings));

  // --- 4. user detail shape -------------------------------------------------
  const detail = await admin(Actions.adminUserDetail, { userId: freeId });
  const u = detail.user;
  const userKeys = ["id","name","email","tier","subscriptionStatus","stripeCustomerId","stripeSubscriptionId","cancelAtPeriodEnd","subscriptionCurrentPeriodEnd","emailVerified","emailVerifiedAt","marketplaceTermsAcceptedAt","marketplaceTermsVersion","createdAt","updatedAt","suspendedAt","suspended","isPlatformAdmin","companyId","companyName","activeSessionCount"];
  check("detail has all user fields", userKeys.every((k) => k in u), "missing: " + userKeys.filter((k) => !(k in u)).join(","));
  check("detail values sane", u.email === "free@test.com" && u.tier === "free" && u.subscriptionStatus === "inactive" && u.emailVerified === true && u.suspended === false && u.isPlatformAdmin === false && u.activeSessionCount >= 1, JSON.stringify({ tier: u.tier, sub: u.subscriptionStatus, sessions: u.activeSessionCount }));
  check("detail listings + flag counts", detail.listings.length === 2 && detail.listings.every((l) => typeof l.flagCount === "number"));
  check("detail flags filed", detail.flagsFiled.count === 0 && Array.isArray(detail.flagsFiled.recent));
  check("detail sessions hide token hashes", detail.sessions.length >= 1 && detail.sessions.every((s) => !("tokenHash" in s) && !("token" in s)), `sessions: ${detail.sessions.length}`);
  check("detail audit is array", Array.isArray(detail.audit));
  await expectErr("detail rejects unknown user", () => admin(Actions.adminUserDetail, { userId: 999999 }), "User not found");
  await expectErr("non-admin cannot read detail", () => free(Actions.adminUserDetail, { userId: adminId }), "Platform admin");

  // --- 5. tier grant / revoke ----------------------------------------------
  const grant = await admin(Actions.adminUserSetTier, { userId: freeId, tier: "premium" });
  check("grant premium", grant.tier === "premium" && grant.subscriptionStatus === "manual");
  const l3 = await mkListing(3);
  check("premium bypasses listing limit", l3.id > 0);
  const revoke = await admin(Actions.adminUserSetTier, { userId: freeId, tier: "free" });
  check("revoke to free", revoke.tier === "free" && revoke.subscriptionStatus === "inactive");

  // --- 6. revoke sessions ----------------------------------------------------
  const rs = await admin(Actions.adminUserRevokeSessions, { userId: freeId });
  check("sessions revoked", rs.revoked >= 1, `revoked: ${rs.revoked}`);
  await expectErr("cannot revoke own sessions", () => admin(Actions.adminUserRevokeSessions, { userId: adminId }), "own sessions");
  const detail2 = await admin(Actions.adminUserDetail, { userId: freeId });
  check("audit captured admin actions", detail2.audit.some((a) => a.action === "user.tier_grant_premium") && detail2.audit.some((a) => a.action === "user.sessions_revoked"), `audit actions: ${detail2.audit.map((a) => a.action).join(",")}`);

  // --- 7. announcement banner in session payload ------------------------------
  await admin(Actions.adminSettingsSet, { key: "announcement_banner", value: "Crewkat update night!" });
  const login2 = await call(Actions.login, { email: "admin@test.com", password: "correct-horse-123" }, { userAgent: "t", clientIp: "10.0.0.3" });
  check("banner in login payload", login2.user.announcementBanner === "Crewkat update night!");
  const sess = await call(Actions.getAuthSession, { _sessionToken: login2.sessionToken });
  check("banner in session payload", sess.user?.announcementBanner === "Crewkat update night!");

  // --- 8. settings validation -------------------------------------------------
  await expectErr("limit below min rejected", () => admin(Actions.adminSettingsSet, { key: "free_listing_limit", value: "0" }), "expected 1");
  await expectErr("banner over max rejected", () => admin(Actions.adminSettingsSet, { key: "announcement_banner", value: "x".repeat(301) }), "under 300");
  await expectErr("boolean junk rejected", () => admin(Actions.adminSettingsSet, { key: "marketplace_enabled", value: "yes" }), "0 or 1");
  const got = await admin(Actions.adminSettingsGet, {});
  check("settings get returns 6 defs with labels", got.defs.length === 6 && got.defs.every((d) => d.labelEn && d.labelEs), `defs: ${got.defs.map((d) => d.key).join(",")}`);
} catch (e) { check("no unexpected exceptions", false, e.stack?.split("\n").slice(0, 4).join(" | ") ?? e.message); process.exitCode = 1; }

const p = results.filter((r) => r.ok).length;
console.log(`\n${p}/${results.length} passed`);
await rm(workRoot, { recursive: true, force: true });
