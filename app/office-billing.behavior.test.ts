// Office billing behavior tests (SimplySub steals Item 5, 0097).
//
// Covers:
//  1. Migration 0097: journal pins + the companies office_* columns.
//  2. Not-configured state: env prices unset -> getOfficeBilling reports
//     configured:false, startOfficeCheckout returns the setup state
//     (configured:false, missing names) and never throws; the REAL
//     privileged checkout handler also degrades without any fetch.
//  3. Founding rule: grandfathered company (pre-existing Office usage)
//     qualifies even at 100 grants; the counter boundary — 99 grants ->
//     the next company gets founding, 100 grants -> regular prices.
//     The counter is counted from companies data, never a constant.
//  4. The REAL createOfficeStripeCheckout handler with a stubbed fetch:
//     correct price per plan (monthly / annual / founding), metadata
//     carries plan + company_id (and subscription_data metadata), the
//     SUBSCRIPTIONS account key (STRIPE_SECRET_KEY) is used and the
//     Connect key (set as a decoy) never is.
//  5. Webhook: the extended handleStripeWebhook drives company Office
//     state active -> past_due -> canceled (and founding grant on the
//     founding checkout), while a Premium event still flows to the
//     user exactly as before. The REAL verifyStripeWebhook handler
//     parses a signed Office subscription payload (plan, company_id,
//     price id) — signature verification included.
//  6. Enforcement (through the real protected Actions surface with a
//     real login): flag OFF + canceled state -> Office mutation
//     succeeds (zero change). Flag ON + canceled -> Office-surface
//     mutation blocked with the upgrade error, Office read succeeds,
//     and a phone-surface (untagged) mutation for the same company
//     still succeeds. past_due inside the paid period is NOT lapsed;
//     past_due beyond the period end is.
//  7. Static pins: permissions classification (Admin-only), the Office
//     Settings plan card + surface tag, and no Connect key anywhere in
//     the Office checkout handler.
//
// Run from app/:  bun office-billing.behavior.test.ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { Actions, BaseActions } from "./server/src/actions.ts";
import { privileged, privilegedHandlers } from "./server/src/privileged.ts";
import { ADMIN_ACTIONS, minRoleForAction } from "./server/src/permissions.ts";
import { officeSubscriptionLapsed } from "./server/src/officeBilling.ts";
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
async function checkThrows(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    failures++;
    console.error(`FAIL ${name} — expected an error but none was thrown`);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (match && !match.test(msg)) {
      failures++;
      console.error(`FAIL ${name} — wrong error: ${msg.slice(0, 160)}`);
    } else {
      console.log(`ok   ${name}`);
    }
  }
}

// Env hygiene: everything this suite touches is saved + restored.
const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_CONNECT_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "CREWKAT_PUBLIC_URL", "STRIPE_OFFICE_PRICE_MONTHLY", "STRIPE_OFFICE_PRICE_ANNUAL", "STRIPE_OFFICE_PRICE_FOUNDING", "OFFICE_BILLING_ENABLED"];
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

// --- 1. Journal + scratch DB -----------------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
const last = entries[entries.length - 1]!;
check("newest migration tag is 0098_ai_usage", last.tag === "0098_ai_usage", last.tag);
check("newest migration idx is 96", last.idx === 97, String(last.idx));
check("0098 when is 1791739000000 (strictly after 0097)", last.when === 1791739000000 && last.when > Math.max(...entries.slice(0, -1).map((e) => e.when)), String(last.when));

const dir = await mkdtemp(join(tmpdir(), "crewkat-office-billing-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });
const companyCols = (await sqlite.execute("PRAGMA table_info(companies)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("0097 columns exist on companies", ["office_plan_state", "office_founding_granted_at", "office_stripe_customer_id", "office_stripe_subscription_id", "office_current_period_end"].every((c) => companyCols.includes(c)), companyCols.join(","));

// --- 2. BaseActions context with a shape-dispatching privileged stub --------------
const cannedWebhookEvents: Array<Record<string, unknown>> = [];
const officeCheckoutCalls: Array<Record<string, unknown>> = [];
const portalCalls: Array<Record<string, unknown>> = [];
let portalBehavior: () => unknown = () => ({ url: "https://billing.stripe.com/p/session/office", errorCode: null });
const makeCtx = (workspaceUserId: number, workspaceCompanyId: number) => ({
  slug: "tradesign",
  invocationId: "office-billing-test",
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
    if (args && typeof args.payload === "string" && typeof args.signature === "string") {
      const event = cannedWebhookEvents.shift();
      if (!event) throw new Error("no canned webhook event");
      return event;
    }
    if (args && typeof args.returnUrl === "string" && typeof args.customerId === "string") {
      portalCalls.push(args);
      return portalBehavior();
    }
    // Office checkout: companyId + email + plan, and NO userId (that is
    // what keeps it separate from the Premium checkout shape).
    if (args && typeof args.companyId === "number" && typeof args.email === "string" && typeof args.plan === "string" && !("userId" in args)) {
      officeCheckoutCalls.push(args);
      return { configured: true, checkoutUrl: "https://checkout.stripe.com/c/pay/office", missing: [] };
    }
    throw new Error(`unexpected privileged call: ${JSON.stringify(args)}`);
  },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId,
  workspaceUserId,
  workspaceTier: "free",
} as any);

const mkCompany = async (id: number, values: Record<string, unknown> = {}) => {
  await db.insert(schema.companies).values({ id, ...values } as any);
};
const mkUser = async (companyId: number, values: Record<string, unknown> = {}) => (await db.insert(schema.authUsers).values({
  name: "Owner", email: `user${Math.random()}@example.com`, passwordHash: "x", passwordSalt: "y", passwordIterations: 1,
  referralCode: `CODE${Math.floor(Math.random() * 1e9)}`, companyId, ...values,
} as any).returning({ id: schema.authUsers.id }))[0]!.id;
const companyRow = async (id: number) => (await db.select().from(schema.companies).where(eq(schema.companies.id, id)).limit(1))[0]!;

// --- 3. Not-configured state -------------------------------------------------------
for (const key of ["STRIPE_OFFICE_PRICE_MONTHLY", "STRIPE_OFFICE_PRICE_ANNUAL", "STRIPE_OFFICE_PRICE_FOUNDING"]) delete process.env[key];
delete process.env.OFFICE_BILLING_ENABLED;
await mkCompany(1);
const u1 = await mkUser(1);
const ob1 = await (BaseActions.getOfficeBilling as any).handler(makeCtx(u1, 1), {});
check("not configured: getOfficeBilling reports configured:false", ob1.configured === false, JSON.stringify(ob1));
check("not configured: state none, enforcement flag off, founding counter at 0", ob1.state === "none" && ob1.billingEnabled === false && ob1.foundingGrantsUsed === 0 && ob1.foundingGrantsTotal === 100, JSON.stringify(ob1));

// The REAL privileged handler with env unset: setup state, no fetch, no throw.
const officeCheckoutEntry = privilegedHandlers.entries.find((e: { contract: unknown }) => e.contract === privileged.createOfficeStripeCheckout);
check("createOfficeStripeCheckout handler is registered", !!officeCheckoutEntry);
const realFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => { fetchCalls++; throw new Error("fetch must not be called"); }) as typeof fetch;
try {
  const unconfigured = await (officeCheckoutEntry as any).handler({ companyId: 1, email: "a@b.co", plan: "monthly" });
  check("real checkout handler: unconfigured -> setup state, no fetch, no throw", unconfigured.configured === false && unconfigured.checkoutUrl === null && unconfigured.missing.includes("STRIPE_OFFICE_PRICE_MONTHLY") && fetchCalls === 0, JSON.stringify(unconfigured));
} finally {
  globalThis.fetch = realFetch;
}

// --- 4. Founding counter boundary ----------------------------------------------------
process.env.STRIPE_OFFICE_PRICE_MONTHLY = "price_office_monthly";
process.env.STRIPE_OFFICE_PRICE_ANNUAL = "price_office_annual";
process.env.STRIPE_OFFICE_PRICE_FOUNDING = "price_office_founding";
// 99 companies already hold founding grants.
for (let i = 0; i < 99; i++) await mkCompany(100 + i, { officePlanState: "founding", officeFoundingGrantedAt: new Date(Date.now() - 86400000) });
await mkCompany(500); // the next company: brand new, NO Office usage
const u500 = await mkUser(500);
const ob500a = await (BaseActions.getOfficeBilling as any).handler(makeCtx(u500, 500), {});
check("counter reads 99 grants from company data", ob500a.foundingGrantsUsed === 99 && ob500a.configured === true, JSON.stringify(ob500a));
check("99 grants: the next company qualifies for founding", ob500a.qualifiesForFounding === true && ob500a.grandfathered === false, JSON.stringify(ob500a));
officeCheckoutCalls.length = 0;
const co500a = await (BaseActions.startOfficeCheckout as any).handler(makeCtx(u500, 500), { cadence: "annual" });
check("99 grants: checkout picks the FOUNDING plan (even on the annual cadence)", co500a.plan === "founding" && officeCheckoutCalls[0]?.plan === "founding" && co500a.checkoutUrl !== null, JSON.stringify(co500a));
// The 100th grant lands -> the founding offer is over for new companies.
await mkCompany(501, { officePlanState: "founding", officeFoundingGrantedAt: new Date() });
const ob500b = await (BaseActions.getOfficeBilling as any).handler(makeCtx(u500, 500), {});
check("counter reads 100 grants", ob500b.foundingGrantsUsed === 100, JSON.stringify(ob500b));
check("100 grants: a new company no longer qualifies", ob500b.qualifiesForFounding === false, JSON.stringify(ob500b));
officeCheckoutCalls.length = 0;
const co500b = await (BaseActions.startOfficeCheckout as any).handler(makeCtx(u500, 500), { cadence: "annual" });
check("100 grants: checkout falls back to the picked cadence (annual)", co500b.plan === "annual" && officeCheckoutCalls[0]?.plan === "annual", JSON.stringify(co500b));

// --- 5. Grandfathering -----------------------------------------------------------------
await mkCompany(600);
await db.insert(schema.leads).values({ companyId: 600, name: "Old Office Lead" } as any);
const u600 = await mkUser(600);
const ob600 = await (BaseActions.getOfficeBilling as any).handler(makeCtx(u600, 600), {});
check("grandfathered: pre-existing Office usage qualifies even at 100 grants", ob600.grandfathered === true && ob600.qualifiesForFounding === true, JSON.stringify(ob600));
officeCheckoutCalls.length = 0;
const co600 = await (BaseActions.startOfficeCheckout as any).handler(makeCtx(u600, 600), { cadence: "monthly" });
check("grandfathered: checkout picks the founding plan", co600.plan === "founding" && officeCheckoutCalls[0]?.plan === "founding", JSON.stringify(co600));

// --- 6. Real privileged checkout handler with a stubbed Stripe transport ----------------
const savedSecret = process.env.STRIPE_SECRET_KEY;
let lastUrl = "";
let lastInit: any = null;
globalThis.fetch = (async (url: any, init: any) => {
  lastUrl = String(url); lastInit = init;
  return { ok: true, json: async () => ({ url: "https://checkout.stripe.com/c/pay/cs_office" }) };
}) as typeof fetch;
try {
  process.env.STRIPE_SECRET_KEY = "sk_test_subscriptions";
  process.env.STRIPE_CONNECT_SECRET_KEY = "sk_connect_decoy_must_never_be_used";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_subscriptions";
  process.env.CREWKAT_PUBLIC_URL = "https://crewkat.com";
  const monthly = await (officeCheckoutEntry as any).handler({ companyId: 42, email: "boss@acme.test", plan: "monthly" });
  check("checkout handler: monthly returns a checkout url", monthly.configured === true && monthly.checkoutUrl === "https://checkout.stripe.com/c/pay/cs_office", JSON.stringify(monthly));
  check("checkout handler: POSTs to the subscriptions-account checkout API with ITS key", lastUrl === "https://api.stripe.com/v1/checkout/sessions" && lastInit?.headers?.Authorization === "Bearer sk_test_subscriptions", `${lastUrl} ${lastInit?.headers?.Authorization}`);
  check("checkout handler: the Connect key is never used", !String(lastInit?.headers?.Authorization ?? "").includes("sk_connect_decoy"));
  const monthlyBody = new URLSearchParams(String(lastInit?.body));
  check("checkout handler: monthly price + subscription mode", monthlyBody.get("line_items[0][price]") === "price_office_monthly" && monthlyBody.get("mode") === "subscription", String(lastInit?.body));
  check("checkout handler: metadata carries plan=office + company_id", monthlyBody.get("metadata[plan]") === "office" && monthlyBody.get("metadata[company_id]") === "42" && monthlyBody.get("metadata[type]") === "office_subscription", String(lastInit?.body));
  check("checkout handler: subscription metadata carries plan + company_id, and NO user identity rides along", monthlyBody.get("subscription_data[metadata][plan]") === "office" && monthlyBody.get("subscription_data[metadata][company_id]") === "42" && monthlyBody.get("metadata[user_id]") === null && monthlyBody.get("client_reference_id") === null, String(lastInit?.body));
  check("checkout handler: success returns to Office", monthlyBody.get("success_url") === "https://crewkat.com/office?officeBilling=success", monthlyBody.get("success_url") ?? "");
  await (officeCheckoutEntry as any).handler({ companyId: 42, email: "boss@acme.test", plan: "annual" });
  check("checkout handler: annual price chosen", new URLSearchParams(String(lastInit?.body)).get("line_items[0][price]") === "price_office_annual");
  const founding = await (officeCheckoutEntry as any).handler({ companyId: 42, email: "boss@acme.test", plan: "founding" });
  const foundingBody = new URLSearchParams(String(lastInit?.body));
  check("checkout handler: founding price + office_founding plan tag", founding.configured === true && foundingBody.get("line_items[0][price]") === "price_office_founding" && foundingBody.get("metadata[plan]") === "office_founding" && foundingBody.get("subscription_data[metadata][plan]") === "office_founding", String(lastInit?.body));
} finally {
  globalThis.fetch = realFetch;
  if (savedSecret === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = savedSecret;
  delete process.env.STRIPE_CONNECT_SECRET_KEY;
}

// --- 7. Webhook state transitions ---------------------------------------------------------
const baseEvent = {
  userId: null, customerId: null, subscriptionId: null, subscriptionStatus: null,
  currentPeriodEnd: null, cancelAtPeriodEnd: false, checkoutType: null, plan: null,
  listingId: null, companyId: null, packSize: null, stripeSessionId: null,
  invoiceId: null, paymentIntentId: null, amountTotalCents: null,
  paymentMethodType: null, paymentStatus: null, connectAccountId: null, priceId: null,
};
const whCtx = makeCtx(0, 0);
const feedEvent = (event: Record<string, unknown>) => {
  cannedWebhookEvents.push({ ...baseEvent, ...event });
  return (BaseActions.handleStripeWebhook as any).handler(whCtx, { payload: "x", signature: "y" });
};
await mkCompany(700);
await mkCompany(701);
const periodSec = Math.floor(Date.now() / 1000) + 30 * 86400;
// Regular Office checkout completes -> active, ids recorded.
const wh1 = await feedEvent({ eventId: "evt_ob_1", eventType: "checkout.session.completed", plan: "office", companyId: 700, customerId: "cus_office_700", subscriptionId: "sub_office_700", stripeSessionId: "cs_ob_1" });
const c700a = await companyRow(700);
check("webhook: office checkout completed -> processed, company active", wh1.processed === true && c700a.officePlanState === "active" && c700a.officeStripeCustomerId === "cus_office_700" && c700a.officeStripeSubscriptionId === "sub_office_700" && c700a.officeFoundingGrantedAt === null, JSON.stringify(c700a));
// Subscription goes past_due (attributed by the stored subscription id, no plan tag).
await feedEvent({ eventId: "evt_ob_2", eventType: "customer.subscription.updated", subscriptionId: "sub_office_700", subscriptionStatus: "past_due", currentPeriodEnd: periodSec });
const c700b = await companyRow(700);
check("webhook: subscription.updated past_due -> company past_due + period end recorded", c700b.officePlanState === "past_due" && c700b.officeCurrentPeriodEnd?.getTime() === periodSec * 1000, JSON.stringify(c700b));
// Recovers -> active again.
await feedEvent({ eventId: "evt_ob_3", eventType: "customer.subscription.updated", subscriptionId: "sub_office_700", subscriptionStatus: "active", currentPeriodEnd: periodSec + 30 * 86400 });
check("webhook: subscription.updated active -> company active again", (await companyRow(700)).officePlanState === "active");
// Deleted -> canceled.
await feedEvent({ eventId: "evt_ob_4", eventType: "customer.subscription.deleted", subscriptionId: "sub_office_700", subscriptionStatus: "canceled", currentPeriodEnd: periodSec + 60 * 86400 });
check("webhook: subscription.deleted -> company canceled", (await companyRow(700)).officePlanState === "canceled");
// Founding checkout completes -> founding state + grant timestamp (the counter source).
await feedEvent({ eventId: "evt_ob_5", eventType: "checkout.session.completed", plan: "office_founding", companyId: 701, customerId: "cus_office_701", subscriptionId: "sub_office_701", stripeSessionId: "cs_ob_5" });
const c701 = await companyRow(701);
check("webhook: founding checkout -> state founding + grant recorded", c701.officePlanState === "founding" && c701.officeFoundingGrantedAt !== null, JSON.stringify(c701));
// Founding subscription lapsing then reactivating keeps the founding state.
await feedEvent({ eventId: "evt_ob_6", eventType: "customer.subscription.updated", subscriptionId: "sub_office_701", subscriptionStatus: "past_due", currentPeriodEnd: periodSec });
check("webhook: founding subscription past_due -> past_due", (await companyRow(701)).officePlanState === "past_due");
await feedEvent({ eventId: "evt_ob_7", eventType: "customer.subscription.updated", subscriptionId: "sub_office_701", subscriptionStatus: "active", currentPeriodEnd: periodSec + 30 * 86400 });
check("webhook: founding subscription active again -> founding (grant kept)", (await companyRow(701)).officePlanState === "founding");
// Premium flow untouched: a Premium checkout event still lands on the USER.
const uPrem = await mkUser(1, { tier: "free", subscriptionStatus: "inactive" });
const whPrem = await feedEvent({ eventId: "evt_ob_8", eventType: "checkout.session.completed", plan: "monthly", userId: uPrem, companyId: 1, customerId: "cus_prem_1", subscriptionId: "sub_prem_1", currentPeriodEnd: periodSec });
const premRow = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, uPrem)).limit(1))[0]!;
check("webhook: premium checkout still grants the user premium (office branch does not swallow it)", whPrem.processed === true && premRow.tier === "premium" && premRow.subscriptionStatus === "active", JSON.stringify(premRow));
check("webhook: premium event did not touch company 1's office state", (await companyRow(1)).officePlanState === "none");

// --- 8. Office billing portal action -------------------------------------------------------
portalCalls.length = 0;
const portalOk = await (BaseActions.createOfficeBillingPortalSession as any).handler(makeCtx(u1, 700), {});
check("portal: company's office customer opens the portal", portalOk.url === "https://billing.stripe.com/p/session/office" && portalOk.error === null && portalCalls[0]?.customerId === "cus_office_700", JSON.stringify(portalOk));
check("portal: return_url lands back in Office", String(portalCalls[0]?.returnUrl).endsWith("/office?billing=return"), String(portalCalls[0]?.returnUrl));
portalCalls.length = 0;
const portalNone = await (BaseActions.createOfficeBillingPortalSession as any).handler(makeCtx(u1, 1), {});
check("portal: no office customer -> typed error, privileged never called", portalNone.url === null && portalNone.error === "no_stripe_customer" && portalCalls.length === 0, JSON.stringify(portalNone));

// --- 9. Real webhook signature verification + Office payload parsing ----------------------------
const verifyEntry = privilegedHandlers.entries.find((e: { contract: unknown }) => e.contract === privileged.verifyStripeWebhook);
check("verifyStripeWebhook handler is registered", !!verifyEntry);
process.env.STRIPE_WEBHOOK_SECRET = "whsec_office_test";
try {
  const payload = JSON.stringify({ id: "evt_ob_parse", type: "customer.subscription.updated", data: { object: { id: "sub_office_701", customer: "cus_office_701", status: "past_due", current_period_end: periodSec, cancel_at_period_end: false, metadata: { plan: "office_founding", company_id: "701" }, items: { data: [{ price: { id: "price_office_founding" } }] } } } });
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", "whsec_office_test").update(`${ts}.${payload}`).digest("hex");
  const parsed = await (verifyEntry as any).handler({ payload, signature: `t=${ts},v1=${sig}` });
  check("verify: signed office subscription payload parses plan + company + price id", parsed.plan === "office_founding" && parsed.companyId === 701 && parsed.priceId === "price_office_founding" && parsed.subscriptionId === "sub_office_701" && parsed.subscriptionStatus === "past_due", JSON.stringify(parsed));
  await checkThrows("verify: a bad signature is still rejected", () => (verifyEntry as any).handler({ payload, signature: `t=${ts},v1=${"0".repeat(64)}` }));
} finally {
  delete process.env.STRIPE_WEBHOOK_SECRET;
}

// --- 10. Enforcement through the real protected Actions surface ----------------------------------
const actx = {
  slug: "tradesign",
  invocationId: "office-billing-enforcement-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => ({ delivery: "fallback" }),
  emit: () => {},
  invalidateQueries: () => {},
} as any;
const A = Actions as any;
const signup = await A.signUp.handler(actx, { name: "Enforce Owner", email: "enforce@acme.test", password: "enforce-pass-123", marketplaceTermsAccepted: true });
await A.verifyEmail.handler(actx, { email: "enforce@acme.test", code: signup.verificationCode });
const login = await A.login.handler(actx, { email: "enforce@acme.test", password: "enforce-pass-123" });
const token = login.sessionToken as string;
const enforceCompanyId = login.user.companyId as number;
check("enforcement fixture: owner signed up + logged in", typeof token === "string" && token.length >= 32 && typeof enforceCompanyId === "number");
// The company's Office subscription is CANCELED (lapsed by definition).
await db.update(schema.companies).set({ officePlanState: "canceled" }).where(eq(schema.companies.id, enforceCompanyId));
const leadArgs = { name: "Enforcement Lead", phone: "813-555-0100", email: "", address: "", serviceType: "Bathroom", source: "web", notes: "", estimatedValue: "", projectSize: "small", engagement: "normal" };
// Flag OFF (env unset): zero behavior change — the Office mutation succeeds.
delete process.env.OFFICE_BILLING_ENABLED;
const leadOff = await A.saveLead.handler(actx, { _sessionToken: token, _surface: "office", ...leadArgs });
check("flag OFF + canceled: office mutation succeeds (zero change)", typeof leadOff.id === "number");
// Flag ON: Office-surface mutation blocked with the upgrade error...
process.env.OFFICE_BILLING_ENABLED = "1";
await checkThrows("flag ON + canceled: office mutation blocked with the upgrade error", () => A.saveLead.handler(actx, { _sessionToken: token, _surface: "office", ...leadArgs, name: "Blocked Lead" }), /read-only/);
// ...Office reads still work...
const leadsOn = await A.listLeads.handler(actx, { _sessionToken: token, _surface: "office" });
check("flag ON + canceled: office read succeeds", Array.isArray(leadsOn.leads) && leadsOn.leads.some((l: any) => l.id === leadOff.id), JSON.stringify(leadsOn?.leads?.length));
// ...the billing actions themselves stay open (the upgrade path)...
const obEnforce = await A.getOfficeBilling.handler(actx, { _sessionToken: token, _surface: "office" });
check("flag ON + canceled: getOfficeBilling stays open and reports canceled + enabled", obEnforce.state === "canceled" && obEnforce.billingEnabled === true, JSON.stringify(obEnforce));
// ...and the PHONE surface (no _surface tag) is never blocked.
const leadPhone = await A.saveLead.handler(actx, { _sessionToken: token, ...leadArgs, name: "Phone Lead" });
check("flag ON + canceled: untagged (phone) mutation for the same company still succeeds", typeof leadPhone.id === "number");
// past_due inside the paid period is NOT lapsed; beyond the period end it is.
await db.update(schema.companies).set({ officePlanState: "past_due", officeCurrentPeriodEnd: new Date(Date.now() + 86400000) }).where(eq(schema.companies.id, enforceCompanyId));
const leadGrace = await A.saveLead.handler(actx, { _sessionToken: token, _surface: "office", ...leadArgs, name: "Grace Lead" });
check("flag ON + past_due within the paid period: office mutation still succeeds", typeof leadGrace.id === "number");
await db.update(schema.companies).set({ officePlanState: "past_due", officeCurrentPeriodEnd: new Date(Date.now() - 86400000) }).where(eq(schema.companies.id, enforceCompanyId));
await checkThrows("flag ON + past_due beyond the period end: office mutation blocked", () => A.saveLead.handler(actx, { _sessionToken: token, _surface: "office", ...leadArgs, name: "Lapsed Lead" }), /read-only/);
// A never-subscribed company (state none) is not lapsed either.
await db.update(schema.companies).set({ officePlanState: "none", officeCurrentPeriodEnd: null }).where(eq(schema.companies.id, enforceCompanyId));
const leadNone = await A.saveLead.handler(actx, { _sessionToken: token, _surface: "office", ...leadArgs, name: "Free Lead" });
check("flag ON + never subscribed (state none): office mutation succeeds", typeof leadNone.id === "number");
delete process.env.OFFICE_BILLING_ENABLED;
// Lapsed-definition unit pins.
check("lapsed: canceled is lapsed", officeSubscriptionLapsed({ officePlanState: "canceled", officeCurrentPeriodEnd: null }) === true);
check("lapsed: active / founding / none never lapsed", officeSubscriptionLapsed({ officePlanState: "active", officeCurrentPeriodEnd: null }) === false && officeSubscriptionLapsed({ officePlanState: "founding", officeCurrentPeriodEnd: null }) === false && officeSubscriptionLapsed({ officePlanState: "none", officeCurrentPeriodEnd: null }) === false);
check("lapsed: past_due needs the period to have ended", officeSubscriptionLapsed({ officePlanState: "past_due", officeCurrentPeriodEnd: new Date(Date.now() + 1000) }) === false && officeSubscriptionLapsed({ officePlanState: "past_due", officeCurrentPeriodEnd: new Date(Date.now() - 1000) }) === true && officeSubscriptionLapsed({ officePlanState: "past_due", officeCurrentPeriodEnd: null }) === false);

// --- 11. Static pins ----------------------------------------------------------------------------
check("office billing actions are Admin-only", ["getOfficeBilling", "startOfficeCheckout", "createOfficeBillingPortalSession"].every((n) => ADMIN_ACTIONS.has(n) && minRoleForAction(n) === "admin"));
const actionsSrc = await readFile("server/src/actions.ts", "utf8");
const publicSet = actionsSrc.slice(actionsSrc.indexOf("const PUBLIC_ACTIONS"), actionsSrc.indexOf("]);", actionsSrc.indexOf("const PUBLIC_ACTIONS")));
const premiumSet = actionsSrc.slice(actionsSrc.indexOf("const PREMIUM_ACTIONS"), actionsSrc.indexOf("]);", actionsSrc.indexOf("const PREMIUM_ACTIONS")));
check("office billing actions are NOT public and NOT premium-gated", !publicSet.includes("getOfficeBilling") && !publicSet.includes("startOfficeCheckout") && !premiumSet.includes("getOfficeBilling") && !premiumSet.includes("startOfficeCheckout"));
check("webhook routes office events before the premium user flow", actionsSrc.indexOf("office_founding") < actionsSrc.indexOf("let user = event.userId") && actionsSrc.includes("officeStripeSubscriptionId"));
check("enforcement gate sits in protectActions behind the surface tag", actionsSrc.includes('envelope._surface === "office"') && actionsSrc.includes("assertOfficeBillingAllows"));
const privilegedSrc = await readFile("server/src/privileged.ts", "utf8");
const officeHandlerSlice = privilegedSrc.slice(privilegedSrc.indexOf("async createOfficeStripeCheckout"), privilegedSrc.indexOf("async verifyStripeWebhook"));
check("office checkout handler uses ONLY the subscriptions account key", officeHandlerSlice.includes("STRIPE_SECRET_KEY") && officeHandlerSlice.includes("STRIPE_OFFICE_PRICE_") && !officeHandlerSlice.includes("CONNECT"), officeHandlerSlice.slice(0, 120));
const officeApiSrc = await readFile("office/src/api.ts", "utf8");
check("office client tags every call with the office surface", officeApiSrc.includes('_surface: "office"'));
const settingsSrc = await readFile("office/src/views/Settings.tsx", "utf8");
check("office Settings renders the Office plan card with all states", settingsSrc.includes("OfficePlanCard") && settingsSrc.includes("api.getOfficeBilling") && settingsSrc.includes("api.startOfficeCheckout") && settingsSrc.includes("api.createOfficeBillingPortalSession") && settingsSrc.includes("Founding rate — $39/mo for life") && settingsSrc.includes("isn't switched on for Crewkat yet") && settingsSrc.includes("Unlimited") || settingsSrc.includes("unlimited team logins"));
check("office plan card carries the locked pricing + guarantee copy", settingsSrc.includes("$49/mo") && settingsSrc.includes("$490/yr") && settingsSrc.includes("100-day money-back guarantee"));

for (const key of ENV_KEYS) {
  if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
}
await rm(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nAll office billing behavior tests passed.");
