// Billing section behavior tests (Danny 2026-10-17).
//
// Covers:
//  1. getBillingOverview: auth-gated (throws without a workspace identity),
//     not in PUBLIC_ACTIONS / PREMIUM_ACTIONS (signed-in users only, free
//     users included).
//  2. Plan state per account type: stripe premium, free, founder, Play,
//     founding member; manage hint derivation (stripe customer wins).
//  3. Merged payment history: Stripe invoices (via stubbed privileged) +
//     marketplace bump purchases + credit packs from our own records,
//     newest first, capped, scoped to the caller's company only.
//  4. Stripe failure degrades the overview to local records (never throws).
//  5. createBillingPortalSession: typed errors — no_stripe_customer (and
//     the privileged fn is never called), portal_not_configured passthrough,
//     billing_unavailable on throw; success returns the portal URL with a
//     CREWKAT_PUBLIC_URL-based return_url.
//  6. The REAL privileged handlers with a stubbed fetch: invoice list
//     normalization (paid/due amounts, draft exclusion, description +
//     receipt fallbacks, Basic auth, unconfigured branch) and portal
//     session creation (Bearer POST, "configuration" error detection,
//     unconfigured branch, generic failure throws).
//  7. Static client pins: Settings Billing entry, screen routing, plan-card
//     states, manage routing, history rows + empty state, EN+ES strings,
//     billing CSS.
//
// Run from app/:  bun billing.behavior.test.ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { BaseActions } from "./server/src/actions.ts";
import { privileged, privilegedHandlers } from "./server/src/privileged.ts";
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
async function checkThrows(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    failures++;
    console.error(`FAIL ${name} — expected an error but none was thrown`);
  } catch {
    console.log(`ok   ${name}`);
  }
}

// --- 1. Scratch DB + migrate ---------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-billing-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

// --- 2. Test context with a shape-dispatching privileged stub ------------------
let invoiceBehavior: (customerId: string) => unknown = () => ({ configured: true, invoices: [] });
let portalBehavior: () => unknown = () => ({ url: "https://billing.stripe.com/p/session/default", errorCode: null });
let invoiceCalls: string[] = [];
let portalCalls: Array<Record<string, unknown>> = [];
const makeCtx = (workspaceUserId: number, workspaceCompanyId: number) => ({
  slug: "tradesign",
  invocationId: "billing-test",
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
    // NOTE: actions.ts imports the privileged contracts from the generated
    // @space/privileged module (a different instance), so dispatch on the
    // request shape rather than contract identity.
    if (args && typeof args.returnUrl === "string") {
      portalCalls.push(args);
      return portalBehavior();
    }
    if (args && typeof args.customerId === "string" && typeof args.limit === "number") {
      invoiceCalls.push(args.customerId);
      return invoiceBehavior(args.customerId);
    }
    throw new Error(`unexpected privileged call: ${JSON.stringify(args)}`);
  },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId,
  workspaceUserId,
  workspaceTier: "free",
} as any);

// --- 3. Seed users ---------------------------------------------------------------
const DAY = 86400000;
const now = Date.now();
const periodEnd = new Date("2026-11-17T00:00:00.000Z");
const mkUser = async (values: Record<string, unknown>) => (await db.insert(schema.authUsers).values({
  name: "Owner", email: `user${Math.random()}@example.com`, passwordHash: "x", passwordSalt: "y", passwordIterations: 1,
  referralCode: `CODE${Math.floor(Math.random() * 1e9)}`, ...values,
} as any).returning({ id: schema.authUsers.id }))[0]!.id;

const u1 = await mkUser({ companyId: 1, tier: "premium", subscriptionStatus: "active", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", subscriptionCurrentPeriodEnd: periodEnd, cancelAtPeriodEnd: false });
const u2 = await mkUser({ companyId: 2, tier: "free", subscriptionStatus: "inactive" });
const u3 = await mkUser({ companyId: 3, tier: "premium", subscriptionStatus: "founder" });
const u4 = await mkUser({ companyId: 4, tier: "premium", subscriptionStatus: "active", playPurchaseToken: "play-token-4", subscriptionCurrentPeriodEnd: periodEnd });
const u5 = await mkUser({ companyId: 5, tier: "premium", subscriptionStatus: "founding_member", stripeCustomerId: "cus_5" });

const mkListing = async (companyId: number, title: string) => (await db.insert(schema.marketplaceListings).values({
  companyId, title, category: "roofing", serviceArea: "Tampa, FL 34691",
  companyName: "Test Co", companyPhone: "8135550100",
  moderationStatus: "active", createdAt: new Date(now - 30 * DAY), updatedAt: new Date(now - 30 * DAY),
} as any).returning({ id: schema.marketplaceListings.id }))[0]!.id;

const listing1 = await mkListing(1, "Roofing crew available");
const listing2 = await mkListing(2, "Other company listing");
await db.insert(schema.listingBumpPurchases).values({ companyId: 1, listingId: listing1, stripeSessionId: "cs-bump-1", purchasedAt: new Date(now - 20 * DAY), expiresAt: new Date(now - 13 * DAY) });
await db.insert(schema.listingBumpPurchases).values({ companyId: 2, listingId: listing2, stripeSessionId: "cs-bump-2", purchasedAt: new Date(now - 2 * DAY), expiresAt: new Date(now + 5 * DAY) });
await db.insert(schema.marketplaceCreditPurchases).values({ companyId: 1, stripeSessionId: "cs-pack-1", packSize: 5, amountCents: 900, status: "completed", createdAt: new Date(now - 5 * DAY) });

// --- 4. Auth gating ---------------------------------------------------------------
await checkThrows("overview throws without a workspace identity", () => (BaseActions.getBillingOverview as any).handler(makeCtx(0, 0), {}));
await checkThrows("portal throws without a workspace identity", () => (BaseActions.createBillingPortalSession as any).handler(makeCtx(0, 0), {}));

// --- 5. Overview: stripe premium user, merged history ------------------------------
invoiceBehavior = (customerId: string) => {
  if (customerId !== "cus_1") return { configured: true, invoices: [] };
  return {
    configured: true,
    invoices: [
      { id: "in_new", created: Math.floor((now - 1 * DAY) / 1000), description: "Crewkat Premium — monthly", amountCents: 1900, currency: "usd", status: "paid", receiptUrl: "https://invoice.stripe.com/i/new" },
      { id: "in_open", created: Math.floor((now - 10 * DAY) / 1000), description: null, amountCents: 1900, currency: "usd", status: "open", receiptUrl: "https://invoice.stripe.com/i/open" },
    ],
  };
};
const ov1 = await (BaseActions.getBillingOverview as any).handler(makeCtx(u1, 1), {});
check("plan: premium/stripe with period end", ov1.plan.tier === "premium" && ov1.plan.status === "active" && ov1.plan.provider === "stripe" && ov1.plan.currentPeriodEnd === periodEnd.toISOString() && ov1.plan.cancelAtPeriodEnd === false, JSON.stringify(ov1.plan));
check("manage hint: stripe when a Stripe customer exists", ov1.manage.kind === "stripe");
check("history merges invoices + pack + bump, newest first", JSON.stringify(ov1.payments.map((p: any) => p.id)) === JSON.stringify(["stripe:in_new", ov1.payments[1].id, "stripe:in_open", ov1.payments[3].id]) && ov1.payments[1].id.startsWith("credits:") && ov1.payments[3].id.startsWith("bump:"), JSON.stringify(ov1.payments.map((p: any) => p.id)));
check("history sources alternate subscription/promotion", JSON.stringify(ov1.payments.map((p: any) => p.source)) === JSON.stringify(["subscription", "promotion", "subscription", "promotion"]));
check("stripe row keeps receipt url + amount", ov1.payments[0].receiptUrl === "https://invoice.stripe.com/i/new" && ov1.payments[0].amountCents === 1900 && ov1.payments[0].status === "paid");
check("null invoice description falls back to the plan name", ov1.payments[2].description === "Crewkat Premium" && ov1.payments[2].status === "open");
check("credit pack row carries its recorded amount", ov1.payments[1].amountCents === 900 && ov1.payments[1].status === "completed" && ov1.payments[1].description.includes("5"));
check("bump row: listing title, null amount, completed", ov1.payments[3].description === "Roofing crew available" && ov1.payments[3].amountCents === null && ov1.payments[3].status === "completed" && ov1.payments[3].receiptUrl === null);
check("foreign company purchases never leak in", ov1.payments.every((p: any) => p.description !== "Other company listing"));

// --- 6. Overview: Stripe failure degrades to local records -------------------------
invoiceBehavior = () => { throw new Error("stripe down"); };
const ov1b = await (BaseActions.getBillingOverview as any).handler(makeCtx(u1, 1), {});
check("stripe failure: overview still returns plan + local history", ov1b.plan.tier === "premium" && ov1b.payments.length === 2 && ov1b.payments.every((p: any) => p.source === "promotion"), JSON.stringify(ov1b.payments.map((p: any) => p.id)));

// --- 7. Overview: free / founder / play / founding member ---------------------------
invoiceCalls = [];
const ov2 = await (BaseActions.getBillingOverview as any).handler(makeCtx(u2, 2), {});
check("free plan: provider none, manage none", ov2.plan.tier === "free" && ov2.plan.provider === "none" && ov2.manage.kind === "none" && ov2.plan.currentPeriodEnd === null);
check("free user sees only their own company purchases", ov2.payments.length === 1 && ov2.payments[0].description === "Other company listing", JSON.stringify(ov2.payments));
check("no Stripe customer -> invoices privileged fn never called", invoiceCalls.length === 0, JSON.stringify(invoiceCalls));
const ov3 = await (BaseActions.getBillingOverview as any).handler(makeCtx(u3, 3), {});
check("founder: status founder, manage none, empty history", ov3.plan.status === "founder" && ov3.manage.kind === "none" && ov3.payments.length === 0);
const ov4 = await (BaseActions.getBillingOverview as any).handler(makeCtx(u4, 4), {});
check("play: provider play, manage play", ov4.plan.provider === "play" && ov4.manage.kind === "play" && ov4.plan.tier === "premium");
const ov5 = await (BaseActions.getBillingOverview as any).handler(makeCtx(u5, 5), {});
check("founding member: manage stripe via customer, status founding_member", ov5.plan.status === "founding_member" && ov5.manage.kind === "stripe");

// --- 8. Portal action -----------------------------------------------------------------
const savedPublicUrl = process.env.CREWKAT_PUBLIC_URL;
process.env.CREWKAT_PUBLIC_URL = "https://crewkat.com";
try {
  portalCalls = [];
  const noCustomer = await (BaseActions.createBillingPortalSession as any).handler(makeCtx(u2, 2), {});
  check("portal: no Stripe customer -> typed error, privileged never called", noCustomer.url === null && noCustomer.error === "no_stripe_customer" && portalCalls.length === 0, JSON.stringify(noCustomer));
  portalBehavior = () => ({ url: "https://billing.stripe.com/p/session/abc", errorCode: null });
  const okPortal = await (BaseActions.createBillingPortalSession as any).handler(makeCtx(u1, 1), {});
  check("portal: success returns the url", okPortal.url === "https://billing.stripe.com/p/session/abc" && okPortal.error === null, JSON.stringify(okPortal));
  check("portal: return_url is built from CREWKAT_PUBLIC_URL", portalCalls.length === 1 && portalCalls[0]!.returnUrl === "https://crewkat.com/app/?billing=return" && portalCalls[0]!.customerId === "cus_1", JSON.stringify(portalCalls));
  portalBehavior = () => ({ url: null, errorCode: "portal_not_configured" });
  const notConfigured = await (BaseActions.createBillingPortalSession as any).handler(makeCtx(u1, 1), {});
  check("portal: portal_not_configured passes through", notConfigured.url === null && notConfigured.error === "portal_not_configured");
  portalBehavior = () => { throw new Error("boom"); };
  const unavailable = await (BaseActions.createBillingPortalSession as any).handler(makeCtx(u1, 1), {});
  check("portal: privileged throw -> billing_unavailable", unavailable.url === null && unavailable.error === "billing_unavailable");
} finally {
  if (savedPublicUrl === undefined) delete process.env.CREWKAT_PUBLIC_URL; else process.env.CREWKAT_PUBLIC_URL = savedPublicUrl;
}

// --- 9. Real privileged handlers with a stubbed fetch ----------------------------------
const invoicesEntry = privilegedHandlers.entries.find((e: { contract: unknown }) => e.contract === privileged.listStripeInvoices);
const portalEntry = privilegedHandlers.entries.find((e: { contract: unknown }) => e.contract === privileged.createBillingPortalSession);
check("listStripeInvoices handler is registered", !!invoicesEntry);
check("createBillingPortalSession handler is registered", !!portalEntry);

const realFetch = globalThis.fetch;
const savedSecret = process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY;
try {
  let fetchCalls = 0;
  let lastUrl = "";
  let lastInit: any = null;
  let fetchImpl: (url: any, init: any) => Promise<any> = async () => { throw new Error("unset fetch impl"); };
  globalThis.fetch = (async (url: any, init: any) => { fetchCalls++; lastUrl = String(url); lastInit = init; return fetchImpl(url, init); }) as typeof fetch;

  const noEnvInvoices = await (invoicesEntry as any).handler({ customerId: "cus_9", limit: 25 });
  check("invoices handler: unconfigured without STRIPE_SECRET_KEY (no fetch)", noEnvInvoices.configured === false && noEnvInvoices.invoices.length === 0 && fetchCalls === 0);
  const noEnvPortal = await (portalEntry as any).handler({ customerId: "cus_9", returnUrl: "https://crewkat.com/app/?billing=return" });
  check("portal handler: stripe_unconfigured without STRIPE_SECRET_KEY (no fetch)", noEnvPortal.url === null && noEnvPortal.errorCode === "stripe_unconfigured" && fetchCalls === 0);

  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      data: [
        { id: "in_paid", created: 1760000000, status: "paid", currency: "usd", amount_paid: 1900, amount_due: 0, description: null, hosted_invoice_url: "https://invoice.stripe.com/i/paid", invoice_pdf: "https://pay.stripe.com/invoice/pdf-paid", lines: { data: [{ description: "1 × Crewkat Premium (at $19.00 / month)" }] } },
        { id: "in_open", created: 1759000000, status: "open", currency: "usd", amount_paid: 0, amount_due: 1900, description: "Crewkat Premium — monthly", hosted_invoice_url: null, invoice_pdf: "https://pay.stripe.com/invoice/pdf-open", lines: { data: [] } },
        { id: "in_draft", created: 1758000000, status: "draft", currency: "usd", amount_paid: 0, amount_due: 1900, description: null, hosted_invoice_url: null, invoice_pdf: null, lines: { data: [] } },
      ],
    }),
  });
  const listed = await (invoicesEntry as any).handler({ customerId: "cus_9", limit: 25 });
  check("invoices handler: hits the Stripe invoices API with Basic auth", lastUrl === "https://api.stripe.com/v1/invoices?customer=cus_9&limit=25" && lastInit?.headers?.Authorization === `Basic ${Buffer.from("sk_test_123:").toString("base64")}`, `${lastUrl}`);
  check("invoices handler: drafts excluded, 2 remain", listed.configured === true && listed.invoices.length === 2, JSON.stringify(listed.invoices.map((i: any) => i.id)));
  check("invoices handler: paid row uses amount_paid + line description + hosted url", listed.invoices[0].amountCents === 1900 && listed.invoices[0].description === "1 × Crewkat Premium (at $19.00 / month)" && listed.invoices[0].receiptUrl === "https://invoice.stripe.com/i/paid", JSON.stringify(listed.invoices[0]));
  check("invoices handler: open row uses amount_due + pdf receipt fallback", listed.invoices[1].amountCents === 1900 && listed.invoices[1].description === "Crewkat Premium — monthly" && listed.invoices[1].receiptUrl === "https://pay.stripe.com/invoice/pdf-open", JSON.stringify(listed.invoices[1]));
  fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await checkThrows("invoices handler: Stripe API failure throws (action degrades)", () => (invoicesEntry as any).handler({ customerId: "cus_9", limit: 25 }));

  fetchImpl = async () => ({ ok: true, json: async () => ({ url: "https://billing.stripe.com/p/session/test_123" }) });
  const portalOk = await (portalEntry as any).handler({ customerId: "cus_9", returnUrl: "https://crewkat.com/app/?billing=return" });
  check("portal handler: returns the session url", portalOk.url === "https://billing.stripe.com/p/session/test_123" && portalOk.errorCode === null, JSON.stringify(portalOk));
  check("portal handler: POSTs customer + return_url form-encoded with Bearer auth", lastUrl === "https://api.stripe.com/v1/billing_portal/sessions" && lastInit?.method === "POST" && lastInit?.headers?.Authorization === "Bearer sk_test_123" && String(lastInit?.body).includes("customer=cus_9") && String(lastInit?.body).includes(encodeURIComponent("https://crewkat.com/app/?billing=return")), `${lastUrl} ${String(lastInit?.body)}`);
  fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "No configuration provided and your test mode default configuration has not been created. Please create a default configuration in the Stripe Dashboard." } }) });
  const portalMissing = await (portalEntry as any).handler({ customerId: "cus_9", returnUrl: "https://crewkat.com/app/?billing=return" });
  check("portal handler: missing default configuration -> portal_not_configured", portalMissing.url === null && portalMissing.errorCode === "portal_not_configured", JSON.stringify(portalMissing));
  fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "No such customer: cus_9" } }) });
  await checkThrows("portal handler: generic Stripe error throws", () => (portalEntry as any).handler({ customerId: "cus_9", returnUrl: "https://crewkat.com/app/?billing=return" }));
} finally {
  globalThis.fetch = realFetch;
  if (savedSecret === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = savedSecret;
}

// --- 10. Static pins ---------------------------------------------------------------------
const actionsSrc = await readFile("server/src/actions.ts", "utf8");
const publicSet = actionsSrc.slice(actionsSrc.indexOf("const PUBLIC_ACTIONS"), actionsSrc.indexOf("]);", actionsSrc.indexOf("const PUBLIC_ACTIONS")));
const premiumSet = actionsSrc.slice(actionsSrc.indexOf("const PREMIUM_ACTIONS"), actionsSrc.indexOf("]);", actionsSrc.indexOf("const PREMIUM_ACTIONS")));
check("billing actions are NOT public", !publicSet.includes("getBillingOverview") && !publicSet.includes("createBillingPortalSession"));
check("billing actions are NOT premium-gated (free users included)", !premiumSet.includes("getBillingOverview") && !premiumSet.includes("createBillingPortalSession"));
check("overview action is privileged-wired to listStripeInvoices", actionsSrc.includes("privileged: [privileged.listStripeInvoices]") && actionsSrc.includes("privileged: [privileged.createBillingPortalSession]"));

const appSrc = await readFile("client/src/App.tsx", "utf8");
const themeSrc = await readFile("client/src/theme.css", "utf8");
check("screen union has billing", appSrc.includes('| { name: "billing" }'));
check("root routes the billing screen", appSrc.includes('screen.name === "billing"') && appSrc.includes("<BillingScreen"));
check("settings has a Billing entry that opens the screen", appSrc.includes('? "Facturación" : "Billing"') && appSrc.includes('setScreen({ name: "billing" })'));
const billingSlice = appSrc.slice(appSrc.indexOf("function BillingScreen"), appSrc.indexOf("function JobsScreen"));
check("billing screen reads the overview + portal actions", billingSlice.includes("api.getBillingOverview") && billingSlice.includes("api.createBillingPortalSession"));
check("plan states: founder line EN+ES", billingSlice.includes("Founder plan — no billing.") && billingSlice.includes("Plan fundador — sin facturación."));
check("plan states: renews/ends from cancelAtPeriodEnd", billingSlice.includes("cancelAtPeriodEnd") && billingSlice.includes("Renews") && billingSlice.includes("Se renueva el") && billingSlice.includes("Ends"));
check("plan states: free upsell routes to the Premium screen", billingSlice.includes('setScreen({ name: "upgrade" })') && billingSlice.includes("See Premium plans") && billingSlice.includes("Ver planes Premium"));
check("manage: stripe portal button + typed portal errors", billingSlice.includes("Manage subscription") && billingSlice.includes("portal_not_configured") && billingSlice.includes("The billing portal isn't set up yet."));
check("manage: play note points at the Play Store app", billingSlice.includes("manage it in the Play Store app"));
check("history: rows link receipts in a new tab", billingSlice.includes("receiptUrl") && billingSlice.includes('target="_blank"'));
check("history: source labels + status chip + empty state EN+ES", billingSlice.includes("Subscription") && billingSlice.includes("Promotion") && billingSlice.includes("billing-status-chip") && billingSlice.includes("No payments yet.") && billingSlice.includes("Aún no hay pagos.") && billingSlice.includes("Payment history") && billingSlice.includes("Historial de pagos"));
check("billing CSS ships", themeSrc.includes(".billing-plan-card") && themeSrc.includes(".billing-row") && themeSrc.includes(".billing-history"));

await rm(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nAll billing behavior tests passed.");
