// Fresh-account fixes (2026-10-12) — Danny's second-device test round:
//   Fix 5:  Home "Couldn't load activity" on every FREE account —
//           getAutomationCenter/logAutomationSend were premium-gated while
//           Home (a free surface) depends on them.
//   Fix 10: estimate/invoice Send link + Send email were premium-gated via
//           createDocumentLink; sending is part of the free document flow
//           (creation is already allowance-capped). Portal links stay Pro.
//   Fix 3:  signUp persists the auth-screen EN/ES choice on the new
//           company's settings.
//   Fixes 1/2/4/6/7/8/9: static guards over the client/CSS/server sources.
// Run from app/:  bun fresh-account-fixes.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { Actions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok - ${name}`);
  else { failures++; console.error(`FAIL - ${name}${detail ? ` :: ${detail}` : ""}`); }
}
async function throwsPremium(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; }
  catch (e) { return /Premium required/.test(e instanceof Error ? e.message : String(e)); }
}

const APP = await readFile("client/src/App.tsx", "utf8");
const THEME = await readFile("client/src/theme.css", "utf8");
const PUSH = await readFile("client/src/push.ts", "utf8");
const SERVER_MJS = await readFile("../server.mjs", "utf8");

// --- Live flow setup ---------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-fresh-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx: any = {
  slug: "tradesign",
  invocationId: "fresh-fixes-test",
  spaceDir: dir,
  db: () => db,
  blobs: { put: async () => {}, getUrl: async (k: string) => `blob://test/${k}`, get: async () => null, delete: async () => {}, head: async () => null },
  executePrivileged: async () => ({ delivery: "fallback" }),
  emit: () => {},
  invalidateQueries: () => {},
  clientIp: "10.2.2.2",
  userAgent: "test",
  ipHash: "",
  isProdCookie: false,
};

async function signUpVerifyLogin(email: string, name: string, language?: "en" | "es") {
  const su = await (Actions.signUp as any).handler(ctx, { name, email, password: "password1234", marketplaceTermsAccepted: true, ...(language ? { language } : {}) });
  if (!su.verificationCode) throw new Error(`no fallback code for ${email}`);
  await (Actions.verifyEmail as any).handler(ctx, { email, code: su.verificationCode });
  const login = await (Actions.login as any).handler(ctx, { email, password: "password1234" });
  return login as { sessionToken: string; user: { id: number; tier: string; email: string } };
}

const founder = await signUpVerifyLogin("founder2@example.com", "Founder Two");
const fresh = await signUpVerifyLogin("fresh2@example.com", "Fresh Free");
check("setup: founder is premium", founder.user.tier === "premium");
check("setup: second account is free", fresh.user.tier === "free");

// --- Fix 5: free Home activity ----------------------------------------------
const empty = await (Actions.getAutomationCenter as any).handler(ctx, { today: "2026-10-12", _sessionToken: fresh.sessionToken });
check("fix5: free account getAutomationCenter returns (no Premium throw)", Boolean(empty) && Array.isArray(empty.appointments) && empty.appointments.length === 0);
const logRes = await (Actions.logAutomationSend as any).handler(ctx, { kind: "review", entityId: 1, stage: "next_day", _sessionToken: fresh.sessionToken }).catch(() => null);
check("fix5: free account logAutomationSend is not premium-gated", logRes !== null, JSON.stringify(logRes));
const premiumEmpty = await (Actions.getAutomationCenter as any).handler(ctx, { today: "2026-10-12", _sessionToken: founder.sessionToken });
check("fix5: premium account still gets the briefing", Boolean(premiumEmpty) && Array.isArray(premiumEmpty.reminders));

// --- Fix 10: free send link/email --------------------------------------------
const freshUserRow = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, "fresh2@example.com")))[0];
check("setup: fresh user row found", Boolean(freshUserRow));
const [inv] = await db.insert(schema.invoices).values({ companyId: freshUserRow!.companyId, invoiceNumber: "INV-9001", clientName: "Send Sue", lineItemsJson: "[]", total: "500" }).returning({ id: schema.invoices.id });
const link = await (Actions.createDocumentLink as any).handler(ctx, { kind: "invoice", id: inv!.id, _sessionToken: fresh.sessionToken }).catch(() => null);
check("fix10: free account can create a document link (Send link/email)", Boolean(link?.shortCode), JSON.stringify(link));
const info = await (Actions.getDocumentLinkInfo as any).handler(ctx, { kind: "invoice", id: inv!.id, _sessionToken: fresh.sessionToken }).catch(() => null);
check("fix10: free account can read document link info", Boolean(info?.link?.shortCode));
const revoked = await (Actions.revokeDocumentLink as any).handler(ctx, { kind: "invoice", id: inv!.id, _sessionToken: fresh.sessionToken }).then(() => true).catch(() => false);
check("fix10: free account can revoke its document link", revoked);
check("fix10: job portal links stay premium-gated for free", await throwsPremium(() => (Actions.createPortalLink as any).handler(ctx, { jobId: 1, expiresInDays: 30, _sessionToken: fresh.sessionToken })));
check("fix10: other Pro actions stay premium-gated for free", await throwsPremium(() => (Actions.getGrowthToolkit as any).handler(ctx, { _sessionToken: fresh.sessionToken })));

// --- Fix 3: signUp language ---------------------------------------------------
const esUser = await signUpVerifyLogin("es@example.com", "Usuario Es", "es");
const esSettings = await (Actions.getSettings as any).handler(ctx, { _sessionToken: esUser.sessionToken });
check("fix3: signUp language 'es' persists to company settings", esSettings?.language === "es", JSON.stringify(esSettings?.language));
const enUser = await signUpVerifyLogin("en@example.com", "User En");
const enSettings = await (Actions.getSettings as any).handler(ctx, { _sessionToken: enUser.sessionToken });
check("fix3: signUp without language defaults to 'en'", enSettings?.language === "en", JSON.stringify(enSettings?.language));
check("fix3: client passes the toggle choice to signUp", APP.includes("language: authLang"));
check("fix3: auth screen has an EN/ES toggle", APP.includes("crewkat-auth-lang") && APP.includes("chooseAuthLang"));
check("fix3: signed-in app applies a pending auth language once", APP.includes("authLangAppliedRef"));

// --- Fix 1: Google redirect flow ----------------------------------------------
check("fix1: client uses GIS redirect mode", APP.includes('ux_mode: "redirect"') && APP.includes("renderButton"));
check("fix1: callback handled in server.mjs", SERVER_MJS.includes('path === "/auth/google/callback"') && SERVER_MJS.includes('dispatchAction("googleSignIn"'));
check("fix1: auth screen handles the #google landing flags", APP.includes('hash.get("google")') && APP.includes("googleOkLanding"));
check("fix1: blocked-browser message is gone", !APP.includes("Google sign-in was blocked by your browser"));

// --- Fix 2: auth screens scroll ------------------------------------------------
const authPageRule = THEME.match(/\.auth-page \{[^}]*\}/)?.[0] ?? "";
check("fix2: .auth-page is height-capped and scrolls internally", authPageRule.includes("height:100%") && authPageRule.includes("overflow-y:auto"), authPageRule);
check("fix2: .auth-panel centers via margin auto", /\.auth-panel \{[^}]*margin:auto/.test(THEME));

// --- Fix 4: push enable always settles -----------------------------------------
check("fix4: push flow has a hard timeout", PUSH.includes("PUSH_ENABLE_TIMEOUT_MS") && PUSH.includes("withPushTimeout"));
check("fix4: serviceWorker.ready is timeout-raced", PUSH.includes("readyRegistration"));
check("fix4: onboarding sheet explains failure instead of hanging", APP.includes("Couldn't turn them on here") && APP.includes("dismissTimerRef"));

// --- Fix 6: shrink-to-fit Home labels -------------------------------------------
check("fix6: FitLabel component exists", APP.includes("function FitLabel"));
check("fix6: glance/money/quick-access labels use FitLabel", (APP.match(/<FitLabel/g) ?? []).length >= 8, String((APP.match(/<FitLabel/g) ?? []).length));
check("fix6: quick-access no longer ellipsizes titles/subtitles", !THEME.includes(".home-quick-access strong, .home-quick-access small"));
check("fix6: fit-label CSS keeps text on one line, full width", THEME.includes(".fit-label { display: block; max-width: 100%; white-space: nowrap; }"));

// --- Fix 7: tools groups ---------------------------------------------------------
check("fix7: groups render distinctive icons", APP.includes("tool-group-icon") && APP.includes("icon: <Icon size={19}>"));
check("fix7: Pro groups dropped the prefix and wear the badge", !APP.includes("Pro — Money & office") && /group\.pro && <span className=\{`pro-badge/.test(APP));
// Superseded 2026-10-12 (Tools group restyle): groups are floating cards
// now — card separation replaced the hairline, and the two are not stacked.
check("fix7: groups are floating cards, no hairline separator", /\.tool-group \{[^}]*border-radius: 16px/.test(THEME) && /\.tool-group \{[^}]*box-shadow:/.test(THEME) && !/\.tool-group \{[^}]*border-bottom:/.test(THEME));

// --- Fix 8: header actions on the loaded Home header ------------------------------
check("fix8: MainTabHeaderActions on both Home header variants + all main tabs", (APP.match(/<MainTabHeaderActions lang=\{lang\} setScreen=\{setScreen\} \/>/g) ?? []).length >= 6, String((APP.match(/<MainTabHeaderActions/g) ?? []).length));

// --- Fix 9: navigation loop -------------------------------------------------------
check("fix9: estimate builder closes via pop/replace, not push", APP.includes("onSaved={closeQuoteBuilder}") && !APP.includes('onSaved={() => setScreen({ name: "quotes" })}'));
check("fix9: replaceScreen helper exists and marketplace form uses it", APP.includes("const replaceScreen") && APP.includes("onSaved={(listingId) => replaceScreen({ name: \"marketplaceDetail\", listingId })}"));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall fresh-account fix checks passed");
