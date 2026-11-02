import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { definePrivilegedContracts, definePrivilegedHandlers, z } from "@hatch/space-sdk";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_RESEND_FROM = "Crewkat <onboarding@resend.dev>";

export const privileged = definePrivilegedContracts({
  renderPdfPages: {
    request: z.object({ dataBase64: z.string().min(1).max(30_000_000) }),
    response: z.object({ pagesBase64: z.array(z.string()).max(20) }),
    capabilities: [],
    timeoutMs: 45_000,
  },
  sendAuthEmail: {
    request: z.object({
      to: z.string().email().max(200),
      code: z.string().regex(/^\d{6}$/),
      purpose: z.enum(["verify_email", "reset_password"]),
    }),
    response: z.object({ delivery: z.enum(["sent", "fallback", "failed"]) }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  sendBackupEmail: {
    request: z.object({
      to: z.string().email().max(200),
      subject: z.string().min(1).max(200),
      text: z.string().min(1).max(20_000),
      attachments: z.array(z.object({
        filename: z.string().min(1).max(240),
        contentType: z.string().min(1).max(120),
        dataBase64: z.string().min(1).max(60_000_000),
      })).max(3),
    }),
    response: z.object({ delivery: z.enum(["sent", "failed"]) }),
    capabilities: [],
    timeoutMs: 60_000,
  },
  sendSecurityAlert: {
    request: z.object({
      to: z.string().email().max(200),
      subject: z.string().min(1).max(200),
      text: z.string().min(1).max(20_000),
    }),
    response: z.object({ delivery: z.enum(["sent", "failed"]) }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  sendNudgeEmail: {
    request: z.object({
      to: z.string().email().max(200),
      subject: z.string().min(1).max(200),
      text: z.string().min(1).max(20_000),
      // Promotions (0092): optional pre-rendered HTML body (branded
      // campaign template). Text stays required as the fallback part.
      html: z.string().max(200_000).optional(),
    }),
    response: z.object({ delivery: z.enum(["sent", "failed"]) }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  createListingBumpCheckout: {
    request: z.object({
      userId: z.number().int().positive(),
      companyId: z.number().int().positive(),
      email: z.string().email().max(200),
      listingId: z.number().int().positive(),
    }),
    response: z.object({ configured: z.boolean(), checkoutUrl: z.string().nullable(), missing: z.array(z.string()) }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  // Build 3.0: display price for the marketplace listing-boost offer. Reads
  // the STRIPE_BUMP_PRICE_ID price object so the sheet always shows the real
  // amount Danny configured in the Stripe dashboard. Best-effort: null when
  // billing isn't configured or the lookup fails.
  getListingBumpPrice: {
    request: z.object({}),
    response: z.object({ priceDisplay: z.string().nullable() }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  createCreditPackCheckout: {
    request: z.object({
      userId: z.number().int().positive(),
      companyId: z.number().int().positive(),
      email: z.string().email().max(200),
      pack: z.enum(["5", "15"]),
    }),
    response: z.object({ configured: z.boolean(), checkoutUrl: z.string().nullable(), missing: z.array(z.string()) }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  createStripeCheckout: {
    request: z.object({ userId: z.number().int().positive(), companyId: z.number().int().positive(), email: z.string().email().max(200), plan: z.enum(["monthly", "annual", "lifetime"]).default("monthly") }),
    response: z.object({ configured: z.boolean(), checkoutUrl: z.string().nullable(), missing: z.array(z.string()) }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  verifyStripeWebhook: {
    request: z.object({ payload: z.string().min(1).max(1_000_000), signature: z.string().min(1).max(2000) }),
    response: z.object({
      eventId: z.string(),
      eventType: z.enum(["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "payment_intent.payment_failed", "customer.subscription.updated", "customer.subscription.deleted", "ignored"]),
      userId: z.number().int().positive().nullable(),
      customerId: z.string().nullable(),
      subscriptionId: z.string().nullable(),
      subscriptionStatus: z.string().nullable(),
      currentPeriodEnd: z.number().int().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      checkoutType: z.string().nullable(),
      plan: z.string().nullable(),
      listingId: z.number().int().positive().nullable(),
      companyId: z.number().int().positive().nullable(),
      packSize: z.number().int().nullable(),
      stripeSessionId: z.string().nullable(),
      // Wave 2 (Item 6): invoice payments on connected accounts.
      invoiceId: z.number().int().positive().nullable(),
      paymentIntentId: z.string().nullable(),
      amountTotalCents: z.number().int().nullable(),
      paymentMethodType: z.string().nullable(),
      paymentStatus: z.string().nullable(),
      connectAccountId: z.string().nullable(),
    }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  // Separate op, separate secret: Connect events verify ONLY against
  // STRIPE_CONNECT_WEBHOOK_SECRET (the Connect platform account is a
  // different Stripe account from the subscription account).
  verifyConnectWebhook: {
    request: z.object({ payload: z.string().min(1).max(1_000_000), signature: z.string().min(1).max(2000) }),
    response: z.object({
      eventId: z.string(),
      eventType: z.enum(["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "payment_intent.payment_failed", "customer.subscription.updated", "customer.subscription.deleted", "ignored"]),
      userId: z.number().int().positive().nullable(),
      customerId: z.string().nullable(),
      subscriptionId: z.string().nullable(),
      subscriptionStatus: z.string().nullable(),
      currentPeriodEnd: z.number().int().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      checkoutType: z.string().nullable(),
      plan: z.string().nullable(),
      listingId: z.number().int().positive().nullable(),
      companyId: z.number().int().positive().nullable(),
      packSize: z.number().int().nullable(),
      stripeSessionId: z.string().nullable(),
      // Wave 2 (Item 6): invoice payments on connected accounts.
      invoiceId: z.number().int().positive().nullable(),
      paymentIntentId: z.string().nullable(),
      amountTotalCents: z.number().int().nullable(),
      paymentMethodType: z.string().nullable(),
      paymentStatus: z.string().nullable(),
      connectAccountId: z.string().nullable(),
    }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  // Wave 2 (Item 6): Stripe Connect (Pay Now). TWO-ACCOUNT rule
  // (correction, Danny 2026-11-01): the original Stripe account
  // (STRIPE_SECRET_KEY) hosts Crewkat subscriptions and CANNOT host
  // Connect, so Pay Now runs on a SEPARATE platform account whose key
  // is STRIPE_CONNECT_SECRET_KEY. These ops must never fall back to
  // the subscription key. Without the Connect key every op degrades
  // to configured:false — a setup state, never an error.
  getStripePlatformStatus: {
    request: z.object({}),
    response: z.object({ configured: z.boolean() }),
    capabilities: [],
    timeoutMs: 10_000,
  },
  createConnectAccount: {
    request: z.object({ companyId: z.number().int().positive(), email: z.string().email().max(200), companyName: z.string().min(1).max(200) }),
    response: z.object({ configured: z.boolean(), accountId: z.string().nullable(), missing: z.array(z.string()) }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  createConnectAccountLink: {
    request: z.object({ accountId: z.string().min(1).max(200), refreshUrl: z.string().url().max(500), returnUrl: z.string().url().max(500) }),
    response: z.object({ configured: z.boolean(), url: z.string().nullable() }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  getConnectAccount: {
    request: z.object({ accountId: z.string().min(1).max(200) }),
    response: z.object({ configured: z.boolean(), chargesEnabled: z.boolean(), payoutsEnabled: z.boolean(), detailsSubmitted: z.boolean() }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  createInvoiceCheckout: {
    request: z.object({ accountId: z.string().min(1).max(200), companyId: z.number().int().positive(), invoiceId: z.number().int().positive(), amountCents: z.number().int().positive(), description: z.string().min(1).max(300), customerEmail: z.string().max(200), successUrl: z.string().url().max(1000), cancelUrl: z.string().url().max(1000), applicationFeeCents: z.number().int().min(0) }),
    response: z.object({ configured: z.boolean(), sessionId: z.string().nullable(), url: z.string().nullable(), missing: z.array(z.string()) }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  // Wave 2 (Item 7): QuickBooks Online. Intuit OAuth + a generic API
  // proxy; tokens live server-side (DB) and are passed per call, never
  // logged. Without QB_CLIENT_ID / QB_CLIENT_SECRET every op degrades
  // to configured:false — a setup state, never an error.
  qbPlatformStatus: {
    request: z.object({}),
    response: z.object({ configured: z.boolean(), environment: z.string() }),
    capabilities: [],
    timeoutMs: 10_000,
  },
  qbTokenExchange: {
    request: z.object({ code: z.string().min(1).max(2000), redirectUri: z.string().url().max(500) }),
    response: z.object({ configured: z.boolean(), accessToken: z.string().nullable(), refreshToken: z.string().nullable(), expiresInSeconds: z.number().int() }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  qbRefreshToken: {
    request: z.object({ refreshToken: z.string().min(1).max(2000) }),
    response: z.object({ configured: z.boolean(), accessToken: z.string().nullable(), refreshToken: z.string().nullable(), expiresInSeconds: z.number().int() }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  qbApiRequest: {
    request: z.object({ accessToken: z.string().min(1).max(4000), realmId: z.string().min(1).max(40), method: z.enum(["GET", "POST"]), path: z.string().min(1).max(1500), body: z.string().max(60000).default("") }),
    response: z.object({ configured: z.boolean(), status: z.number().int(), body: z.string() }),
    capabilities: [],
    timeoutMs: 30_000,
  },
  listStripeCharges: {
    request: z.object({ customerId: z.string().min(1).max(200), limit: z.number().int().min(1).max(25).default(10) }),
    response: z.object({
      charges: z.array(z.object({
        id: z.string(), amount: z.number().int(), amountRefunded: z.number().int(),
        currency: z.string(), created: z.number().int(), status: z.string(), description: z.string().nullable(),
      })),
    }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  // Billing section (2026-10-17): the signed-in user's OWN Stripe invoices
  // (subscription receipts) for the in-app payment history. Unconfigured ->
  // configured:false with an empty list (the overview degrades gracefully);
  // a Stripe API failure throws and the action layer degrades to local
  // records only.
  listStripeInvoices: {
    request: z.object({ customerId: z.string().min(1).max(200), limit: z.number().int().min(1).max(25).default(25) }),
    response: z.object({
      configured: z.boolean(),
      invoices: z.array(z.object({
        id: z.string(), created: z.number().int(), description: z.string().nullable(),
        amountCents: z.number().int(), currency: z.string(), status: z.string(),
        receiptUrl: z.string().nullable(),
      })),
    }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  // Billing section: Stripe Billing Portal session for the signed-in user's
  // own customer (card update / cancel / invoices live in Stripe's hosted
  // portal). A portal with no default configuration in the Stripe Dashboard
  // is reported as errorCode "portal_not_configured" (NOT a throw) so the
  // client can show "isn't set up yet" instead of a generic failure.
  createBillingPortalSession: {
    request: z.object({ customerId: z.string().min(1).max(200), returnUrl: z.string().url().max(500) }),
    response: z.object({ url: z.string().nullable(), errorCode: z.enum(["portal_not_configured", "stripe_unconfigured"]).nullable() }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  issueStripeRefund: {
    request: z.object({ chargeId: z.string().min(1).max(200), amountCents: z.number().int().positive().max(10_000_000).optional(), reason: z.string().trim().max(500).default("") }),
    response: z.object({ id: z.string(), amount: z.number().int(), currency: z.string(), status: z.string() }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  // Admin panel Phase 1: billing surfaces (all admin-gated at the action layer).
  listStripeSubscriptions: {
    request: z.object({ status: z.enum(["active", "trialing", "past_due", "canceled", "all"]).default("all"), limit: z.number().int().min(1).max(100).default(25), startingAfter: z.string().max(200).optional() }),
    response: z.object({
      configured: z.boolean(),
      subscriptions: z.array(z.object({
        id: z.string(), customerId: z.string(), customerEmail: z.string().nullable(),
        status: z.string(), amountCents: z.number().int(), interval: z.string(),
        currentPeriodEnd: z.number().int().nullable(), cancelAtPeriodEnd: z.boolean(),
      })),
      hasMore: z.boolean(),
    }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  listStripePayments: {
    request: z.object({ limit: z.number().int().min(1).max(100).default(25), startingAfter: z.string().max(200).optional() }),
    response: z.object({
      configured: z.boolean(),
      charges: z.array(z.object({
        id: z.string(), amount: z.number().int(), amountRefunded: z.number().int(),
        currency: z.string(), created: z.number().int(), status: z.string(),
        customerEmail: z.string().nullable(), description: z.string().nullable(),
      })),
      hasMore: z.boolean(),
    }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  listStripeFailedPayments: {
    request: z.object({}),
    response: z.object({
      configured: z.boolean(),
      failed: z.array(z.object({
        invoiceId: z.string(), customerEmail: z.string().nullable(), amountCents: z.number().int(),
        currency: z.string(), status: z.string(), attemptCount: z.number().int(),
        nextRetryAt: z.number().int().nullable(), created: z.number().int(),
      })),
    }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  createStripeCoupon: {
    request: z.object({
      code: z.string().trim().min(2).max(40),
      percentOff: z.number().min(1).max(100).optional(),
      amountOffCents: z.number().int().positive().max(10_000_000).optional(),
      duration: z.enum(["once", "repeating", "forever"]).default("once"),
      durationInMonths: z.number().int().min(1).max(36).optional(),
    }),
    response: z.object({ id: z.string(), code: z.string().nullable(), percentOff: z.number().nullable(), amountOff: z.number().nullable(), duration: z.string() }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  listStripeCoupons: {
    request: z.object({ limit: z.number().int().min(1).max(100).default(25) }),
    response: z.object({
      configured: z.boolean(),
      coupons: z.array(z.object({
        id: z.string(), code: z.string().nullable(), percentOff: z.number().nullable(),
        amountOff: z.number().nullable(), currency: z.string().nullable(),
        duration: z.string(), timesRedeemed: z.number().int(),
      })),
    }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  deleteStripeCoupon: {
    request: z.object({ couponId: z.string().min(1).max(200) }),
    response: z.object({ ok: z.literal(true), id: z.string() }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  // Platform admin suite: live revenue stats for the admin dashboard.
  // Unconfigured -> configured:false (graceful, no crash).
  getStripeRevenueStats: {
    request: z.object({}),
    response: z.object({
      configured: z.boolean(),
      mrrCents: z.number().nullable(),
      activeSubscriptions: z.number().nullable(),
      trialing: z.number().nullable(),
      failedPayments: z.number().nullable(),
    }),
    capabilities: [],
    timeoutMs: 30_000,
  },
  // Phase 4: Google Play Billing (TWA, package com.crewkat.app). Verifies a
  // subscription purchase token against the Play Developer API
  // (purchases.subscriptionsv2.get). Never grants anything itself — it only
  // reports what Google says; the action layer decides on entitlement.
  // Unconfigured -> configured:false (graceful, no crash, no grant).
  verifyPlayPurchase: {
    request: z.object({ purchaseToken: z.string().min(1).max(2000), sku: z.string().min(1).max(200) }),
    response: z.object({
      configured: z.boolean(),
      verified: z.boolean(),
      active: z.boolean(),
      orderId: z.string().nullable(),
      expiryTimeMillis: z.string().nullable(),
      autoRenewing: z.boolean(),
      error: z.string().nullable(),
    }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  // Phase 4: reports Play Billing server configuration without needing a
  // purchase token (drives the Upgrade screen's Play vs Stripe presentation).
  getPlayBillingStatus: {
    request: z.object({}),
    response: z.object({ configured: z.boolean(), sku: z.string(), packageName: z.string() }),
    capabilities: [],
    timeoutMs: 10_000,
  },
});

function stripeAdminAuthHeader(required: true): { Authorization: string };
function stripeAdminAuthHeader(required: false): { Authorization: string } | null;
function stripeAdminAuthHeader(required: boolean): { Authorization: string } | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    if (required) throw new Error("Stripe is not configured.");
    return null;
  }
  return { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}` };
}

// Build 3.0: in-process cache for the listing-boost price display (Stripe
// price objects change only when Danny edits the product in the dashboard).
let bumpPriceCache: { priceId: string; display: string | null; at: number } | null = null;

// Two-account Stripe architecture (correction, Danny 2026-11-01):
// subscriptions live on the ORIGINAL Stripe account and Connect /
// Pay Now on a SEPARATE platform account. Each webhook op verifies
// ONLY its own account's signing secret — never a fallback to the
// other account's secret.
function verifyAndParseStripeWebhook(secret: string, payload: string, signature: string) {
  const parts = signature.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2) ?? "";
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) throw new Error("Stripe webhook timestamp is invalid.");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const valid = signatures.some((candidate) => {
    if (!/^[0-9a-f]{64}$/i.test(candidate)) return false;
    const candidateBytes = Buffer.from(candidate, "hex");
    return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
  });
  if (!valid) throw new Error("Stripe webhook signature is invalid.");
  const event = JSON.parse(payload) as { id?: unknown; type?: unknown; account?: unknown; data?: { object?: Record<string, unknown> } };
  if (typeof event.id !== "string" || typeof event.type !== "string") throw new Error("Stripe webhook payload is invalid.");
  const object = event.data?.object ?? {};
  const metadata = object.metadata && typeof object.metadata === "object" ? object.metadata as Record<string, unknown> : {};
  const userIdValue = metadata.user_id ?? object.client_reference_id;
  const parsedUserId = typeof userIdValue === "string" ? Number(userIdValue) : null;
  const customerId = typeof object.customer === "string" ? object.customer : null;
  const subscriptionId = typeof object.subscription === "string" ? object.subscription : typeof object.id === "string" && event.type.startsWith("customer.subscription.") ? object.id : null;
  const subscriptionStatus = typeof object.status === "string" ? object.status : null;
  const currentPeriodEnd = typeof object.current_period_end === "number" ? object.current_period_end : null;
  const KNOWN_EVENT_TYPES = ["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "payment_intent.payment_failed", "customer.subscription.updated", "customer.subscription.deleted"] as const;
  const eventType: typeof KNOWN_EVENT_TYPES[number] | "ignored" = (KNOWN_EVENT_TYPES as readonly string[]).includes(event.type) ? event.type as typeof KNOWN_EVENT_TYPES[number] : "ignored";
  const listingIdValue = metadata.listing_id;
  const parsedListingId = typeof listingIdValue === "string" ? Number(listingIdValue) : null;
  const companyIdValue = metadata.company_id;
  const parsedCompanyId = typeof companyIdValue === "string" ? Number(companyIdValue) : null;
  const packSizeValue = metadata.pack_size;
  const parsedPackSize = typeof packSizeValue === "string" ? Number(packSizeValue) : null;
  const invoiceIdValue = metadata.invoice_id;
  const parsedInvoiceId = typeof invoiceIdValue === "string" ? Number(invoiceIdValue) : null;
  const paymentIntentId = typeof object.payment_intent === "string" ? object.payment_intent : (event.type.startsWith("payment_intent.") && typeof object.id === "string" ? object.id : null);
  const amountTotalCents = typeof object.amount_total === "number" ? Math.round(object.amount_total) : (typeof object.amount_received === "number" ? Math.round(object.amount_received) : (typeof object.amount === "number" ? Math.round(object.amount) : null));
  const pmTypes = Array.isArray(object.payment_method_types) ? object.payment_method_types.filter((t) => typeof t === "string") as string[] : [];
  return {
    eventId: event.id,
    eventType,
    userId: parsedUserId && Number.isInteger(parsedUserId) && parsedUserId > 0 ? parsedUserId : null,
    customerId,
    subscriptionId,
    subscriptionStatus,
    currentPeriodEnd,
    cancelAtPeriodEnd: object.cancel_at_period_end === true,
    checkoutType: typeof metadata.type === "string" ? metadata.type : null,
    plan: typeof metadata.plan === "string" ? metadata.plan : null,
    listingId: parsedListingId && Number.isInteger(parsedListingId) && parsedListingId > 0 ? parsedListingId : null,
    companyId: parsedCompanyId && Number.isInteger(parsedCompanyId) && parsedCompanyId > 0 ? parsedCompanyId : null,
    packSize: parsedPackSize === 5 || parsedPackSize === 15 ? parsedPackSize : null,
    stripeSessionId: event.type.startsWith("checkout.session.") && typeof object.id === "string" ? object.id : null,
    invoiceId: parsedInvoiceId && Number.isInteger(parsedInvoiceId) && parsedInvoiceId > 0 ? parsedInvoiceId : null,
    paymentIntentId,
    amountTotalCents,
    paymentMethodType: pmTypes[0] ?? null,
    paymentStatus: typeof object.payment_status === "string" ? object.payment_status : null,
    connectAccountId: typeof event.account === "string" ? event.account : null,
  };
}

// Builds the thrown error for a failed Stripe Connect call, carrying
// Stripe's own error text (error.message, plus error.code when present)
// so clients can show the real reason instead of a generic failure
// (Danny 2026-11-01: the app swallowed it and he couldn't tell why
// Connect failed). Stripe API error text never contains the secret key;
// request headers/authorization are never read or included here.
async function stripeConnectError(response: Response, fallback: string): Promise<Error> {
  let detail = "";
  try {
    const err = await response.json() as { error?: { message?: unknown; code?: unknown } };
    const message = typeof err.error?.message === "string" ? err.error.message : "";
    const code = typeof err.error?.code === "string" ? err.error.code : "";
    if (message) detail = code ? `${message} (${code})` : message;
  } catch { /* unparseable body — keep the fallback */ }
  // Join with ": " — strip the fallback's trailing period first so the
  // composed message never reads "…account.: You tried…" (Danny's
  // 2026-11-01 screenshot showed exactly that doubled punctuation).
  return new Error(detail ? `${fallback.replace(/\.+$/, "")}: ${detail}` : fallback);
}

// Accounts v2 (Danny 2026-11-01): the Crewkat Platform's Connect
// integration carries Stripe as the losses collector (Managed Risk —
// sellers are merchants of record, Stripe carries risk/loss), and
// Stripe REFUSES v1 account creation for that configuration ("You
// tried to create an Accounts v1 connected account using the legacy
// `type` field with your platform as the losses collector"). The
// Connect account ops below therefore use the Accounts v2 API
// (/v2/core/accounts, /v2/core/account_links): no `type`, dashboard
// "express" (the v1 Express equivalent), defaults.responsibilities
// fees_collector + losses_collector = "stripe", merchant configuration
// with card_payments requested. Per Stripe's Managed Risk doc,
// combining the Express dashboard with Managed Risk is in public
// preview and requires the current preview API version header — one
// version is used for every v2 Connect call so the surface stays
// coherent. (If Stripe ever rejects the express combination with
// account_controller_unsupported_configuration, the documented GA
// fallback is dashboard "full" with the same responsibilities.)
// Payment APIs (Checkout, webhooks) stay on v1 — they reference the
// connected account by id and are unchanged for v2 accounts.
// NOTE for restricted live keys: Stripe's doc says the key needs the
// `v2_account_storer_write` permission for v2 account creation.
const STRIPE_CONNECT_V2_VERSION = "2026-10-28.preview";

export const privilegedHandlers = definePrivilegedHandlers(privileged, {
  async renderPdfPages(args) {
    const directory = await mkdtemp(join(tmpdir(), "crewkat-pdf-"));
    const sourcePath = join(directory, "source.pdf");
    const outputPrefix = join(directory, "page");
    try {
      await writeFile(sourcePath, Buffer.from(args.dataBase64, "base64"));
      const process = Bun.spawn([
        "/usr/bin/pdftoppm",
        "-jpeg",
        "-r",
        "120",
        "-f",
        "1",
        "-l",
        "20",
        sourcePath,
        outputPrefix,
      ], { stdout: "pipe", stderr: "pipe" });
      const [exitCode, errorText] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ]);
      if (exitCode !== 0) throw new Error(errorText || "PDF preview conversion failed");
      const filenames = (await readdir(directory)).filter((name) => /^page-\d+\.jpg$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const pagesBase64 = await Promise.all(filenames.map(async (name) => (await readFile(join(directory, name))).toString("base64")));
      if (pagesBase64.length === 0) throw new Error("PDF has no viewable pages");
      return { pagesBase64 };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  async sendBackupEmail(args) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) return { delivery: "failed" as const };

    const configuredFrom = process.env.RESEND_FROM_EMAIL?.trim();
    const from = configuredFrom && !/[\r\n]/.test(configuredFrom) ? configuredFrom : DEFAULT_RESEND_FROM;
    const safeSubject = args.subject.replace(/[\r\n]/g, " ");

    try {
      const response = await fetch(RESEND_EMAIL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [args.to],
          subject: safeSubject,
          text: args.text,
          attachments: args.attachments.map((attachment) => ({
            content: attachment.dataBase64,
            filename: attachment.filename,
            content_type: attachment.contentType,
          })),
        }),
        redirect: "error",
        signal: AbortSignal.timeout(45_000),
      });
      return { delivery: response.ok ? "sent" as const : "failed" as const };
    } catch {
      return { delivery: "failed" as const };
    }
  },
  async sendSecurityAlert(args) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) return { delivery: "failed" as const };

    const configuredFrom = process.env.RESEND_FROM_EMAIL?.trim();
    const from = configuredFrom && !/[\r\n]/.test(configuredFrom) ? configuredFrom : DEFAULT_RESEND_FROM;
    const safeSubject = args.subject.replace(/[\r\n]/g, " ");

    try {
      const response = await fetch(RESEND_EMAIL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [args.to],
          subject: safeSubject,
          text: args.text,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      return { delivery: response.ok ? "sent" as const : "failed" as const };
    } catch {
      return { delivery: "failed" as const };
    }
  },
  async sendNudgeEmail(args) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) return { delivery: "failed" as const };

    const configuredFrom = process.env.RESEND_FROM_EMAIL?.trim();
    const from = configuredFrom && !/[\r\n]/.test(configuredFrom) ? configuredFrom : DEFAULT_RESEND_FROM;
    const safeSubject = args.subject.replace(/[\r\n]/g, " ");

    try {
      const response = await fetch(RESEND_EMAIL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [args.to],
          subject: safeSubject,
          text: args.text,
          ...(args.html ? { html: args.html } : {}),
        }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      return { delivery: response.ok ? "sent" as const : "failed" as const };
    } catch {
      return { delivery: "failed" as const };
    }
  },
  async createListingBumpCheckout(args) {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    const priceId = process.env.STRIPE_BUMP_PRICE_ID?.trim();
    const publicUrl = process.env.CREWKAT_PUBLIC_URL?.trim().replace(/\/$/, "");
    const missing = [
      !secretKey ? "STRIPE_SECRET_KEY" : "",
      !priceId ? "STRIPE_BUMP_PRICE_ID" : "",
      !publicUrl ? "CREWKAT_PUBLIC_URL" : "",
    ].filter(Boolean);
    if (missing.length || !secretKey || !priceId || !publicUrl) return { configured: false, checkoutUrl: null, missing };
    if (!/^https:\/\//i.test(publicUrl)) return { configured: false, checkoutUrl: null, missing: ["CREWKAT_PUBLIC_URL (must be HTTPS)"] };
    const body = new URLSearchParams({
      mode: "payment",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      customer_email: args.email,
      client_reference_id: String(args.userId),
      "metadata[type]": "listing_bump",
      "metadata[user_id]": String(args.userId),
      "metadata[company_id]": String(args.companyId),
      "metadata[listing_id]": String(args.listingId),
      success_url: `${publicUrl}/app/?bump=success`,
      cancel_url: `${publicUrl}/app/?bump=cancelled`,
      allow_promotion_codes: "true",
    });
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Stripe Checkout could not be started. Check the server billing configuration.");
    const result = await response.json() as { url?: unknown };
    if (typeof result.url !== "string" || !/^https:\/\/checkout\.stripe\.com\//.test(result.url)) throw new Error("Stripe did not return a valid checkout page.");
    return { configured: true, checkoutUrl: result.url, missing: [] };
  },
  // Build 3.0: display price for the listing-boost offer. Fetches the
  // STRIPE_BUMP_PRICE_ID price object and formats unit_amount/currency.
  // Cached in-process for 10 minutes; any failure resolves to null so the
  // sheet can fall back to price-less copy instead of breaking.
  async getListingBumpPrice() {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    const priceId = process.env.STRIPE_BUMP_PRICE_ID?.trim();
    if (!secretKey || !priceId) return { priceDisplay: null as string | null };
    const cached = bumpPriceCache;
    if (cached && cached.priceId === priceId && Date.now() - cached.at < 10 * 60_000) {
      return { priceDisplay: cached.display };
    }
    let display: string | null = null;
    try {
      const response = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${secretKey}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        const price = await response.json() as { unit_amount?: unknown; currency?: unknown };
        if (typeof price.unit_amount === "number" && typeof price.currency === "string") {
          const amount = price.unit_amount / 100;
          display = price.currency.toLowerCase() === "usd"
            ? `$${amount.toFixed(2)}`
            : `${amount.toFixed(2)} ${price.currency.toUpperCase()}`;
        }
      }
    } catch {
      display = null;
    }
    bumpPriceCache = { priceId, display, at: Date.now() };
    return { priceDisplay: display };
  },
  // Build 0.6 item 22: one-time Stripe purchase for marketplace contact-unlock
  // credit packs (5 for $9, 15 for $19). Credits never expire.
  async createCreditPackCheckout(args) {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    const priceId = args.pack === "5" ? process.env.STRIPE_CREDIT_PACK_5_PRICE_ID?.trim() : process.env.STRIPE_CREDIT_PACK_15_PRICE_ID?.trim();
    const publicUrl = process.env.CREWKAT_PUBLIC_URL?.trim().replace(/\/$/, "");
    const priceEnvVar = args.pack === "5" ? "STRIPE_CREDIT_PACK_5_PRICE_ID" : "STRIPE_CREDIT_PACK_15_PRICE_ID";
    const missing = [
      !secretKey ? "STRIPE_SECRET_KEY" : "",
      !priceId ? priceEnvVar : "",
      !publicUrl ? "CREWKAT_PUBLIC_URL" : "",
    ].filter(Boolean);
    if (missing.length || !secretKey || !priceId || !publicUrl) return { configured: false, checkoutUrl: null, missing };
    if (!/^https:\/\//i.test(publicUrl)) return { configured: false, checkoutUrl: null, missing: ["CREWKAT_PUBLIC_URL (must be HTTPS)"] };
    const body = new URLSearchParams({
      mode: "payment",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      customer_email: args.email,
      client_reference_id: String(args.userId),
      "metadata[type]": "credit_pack",
      "metadata[user_id]": String(args.userId),
      "metadata[company_id]": String(args.companyId),
      "metadata[pack_size]": args.pack,
      success_url: `${publicUrl}/app/?credits=success`,
      cancel_url: `${publicUrl}/app/?credits=cancelled`,
      allow_promotion_codes: "true",
    });
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Stripe Checkout could not be started. Check the server billing configuration.");
    const result = await response.json() as { url?: unknown };
    if (typeof result.url !== "string" || !/^https:\/\/checkout\.stripe\.com\//.test(result.url)) throw new Error("Stripe did not return a valid checkout page.");
    return { configured: true, checkoutUrl: result.url, missing: [] };
  },
  async sendAuthEmail(args) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) return { delivery: "fallback" as const };

    const configuredFrom = process.env.RESEND_FROM_EMAIL?.trim();
    const from = configuredFrom && !/[\r\n]/.test(configuredFrom) ? configuredFrom : DEFAULT_RESEND_FROM;
    const isVerification = args.purpose === "verify_email";
    const subject = isVerification ? "Verify your Crewkat email" : "Reset your Crewkat password";
    const heading = isVerification ? "Verify your email" : "Reset your password";
    const explanation = isVerification
      ? "Enter this code in Crewkat to finish setting up your account."
      : "Enter this code in Crewkat to choose a new password.";
    const text = `${heading}\n\n${args.code}\n\n${explanation}\nThis code expires in 30 minutes. If you did not request this, you can ignore this email.`;
    const html = `<!doctype html><html><body style="margin:0;background:#f4f3ef;font-family:Arial,sans-serif;color:#20231f"><div style="max-width:520px;margin:0 auto;padding:32px 18px"><div style="background:#fff;border:1px solid #deddd7;border-radius:16px;padding:28px"><p style="margin:0 0 18px;font-size:18px;font-weight:700">Crewkat</p><h1 style="margin:0 0 12px;font-size:26px;line-height:1.2">${heading}</h1><p style="margin:0 0 22px;line-height:1.55;color:#525650">${explanation}</p><div style="font-size:34px;font-weight:800;letter-spacing:8px;background:#f4f3ef;border-radius:12px;padding:18px;text-align:center">${args.code}</div><p style="margin:22px 0 0;font-size:14px;line-height:1.55;color:#666a64">This code expires in 30 minutes. If you did not request this, you can ignore this email.</p></div></div></body></html>`;

    try {
      const response = await fetch(RESEND_EMAIL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [args.to], subject, text, html }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      return { delivery: response.ok ? "sent" as const : "failed" as const };
    } catch {
      return { delivery: "failed" as const };
    }
  },
  async createStripeCheckout(args) {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY?.trim();
    const lifetime = args.plan === "lifetime";
    const annual = args.plan === "annual";
    const priceId = (lifetime ? process.env.STRIPE_FOUNDING_PRICE_ID?.trim() : annual ? process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID?.trim() : process.env.STRIPE_PREMIUM_PRICE_ID?.trim());
    const publicUrl = process.env.CREWKAT_PUBLIC_URL?.trim().replace(/\/$/, "");
    const missing = [
      !publishableKey ? "STRIPE_PUBLISHABLE_KEY" : "",
      !secretKey ? "STRIPE_SECRET_KEY" : "",
      !priceId ? (lifetime ? "STRIPE_FOUNDING_PRICE_ID" : annual ? "STRIPE_PREMIUM_ANNUAL_PRICE_ID" : "STRIPE_PREMIUM_PRICE_ID") : "",
      !publicUrl ? "CREWKAT_PUBLIC_URL" : "",
    ].filter(Boolean);
    if (missing.length || !secretKey || !priceId || !publicUrl) return { configured: false, checkoutUrl: null, missing };
    if (!/^https:\/\//i.test(publicUrl)) return { configured: false, checkoutUrl: null, missing: ["CREWKAT_PUBLIC_URL (must be HTTPS)"] };
    const body = new URLSearchParams({
      mode: lifetime ? "payment" : "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      customer_email: args.email,
      client_reference_id: String(args.userId),
      "metadata[user_id]": String(args.userId),
      "metadata[company_id]": String(args.companyId),
      "metadata[plan]": lifetime ? "founding_member" : args.plan,
      ...(lifetime ? {} : {
        "subscription_data[metadata][user_id]": String(args.userId),
        "subscription_data[metadata][company_id]": String(args.companyId),
      }),
      success_url: `${publicUrl}?checkout=success`,
      cancel_url: `${publicUrl}?checkout=cancelled`,
      allow_promotion_codes: "true",
    });
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Stripe Checkout could not be started. Check the server billing configuration.");
    const result = await response.json() as { url?: unknown };
    if (typeof result.url !== "string" || !/^https:\/\/checkout\.stripe\.com\//.test(result.url)) throw new Error("Stripe did not return a valid checkout page.");
    return { configured: true, checkoutUrl: result.url, missing: [] };
  },
  async verifyStripeWebhook(args) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) throw new Error("Stripe webhook verification is not configured.");
    return verifyAndParseStripeWebhook(secret, args.payload, args.signature);
  },
  async verifyConnectWebhook(args) {
    const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim();
    if (!secret) throw new Error("Stripe Connect webhook verification is not configured.");
    return verifyAndParseStripeWebhook(secret, args.payload, args.signature);
  },
  async getStripePlatformStatus() {
    return { configured: !!process.env.STRIPE_CONNECT_SECRET_KEY?.trim() };
  },
  async createConnectAccount(args) {
    const secretKey = process.env.STRIPE_CONNECT_SECRET_KEY?.trim();
    if (!secretKey) return { configured: false, accountId: null, missing: ["STRIPE_CONNECT_SECRET_KEY"] };
    // Accounts v2 create (see STRIPE_CONNECT_V2_VERSION note above).
    // v1 → v2 mapping: email → contact_email; business_profile[name] →
    // display_name (legal details are collected by hosted onboarding);
    // capabilities[card_payments] →
    // configuration.merchant.capabilities.card_payments.requested. The
    // v1 `transfers` capability is NOT requested: this platform only
    // makes direct charges (merchant configuration), and v2
    // auto-requests the merchant stripe_balance.payouts capability
    // alongside card_payments — that is the money-out path.
    const response = await fetch("https://api.stripe.com/v2/core/accounts", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json", "Stripe-Version": STRIPE_CONNECT_V2_VERSION },
      body: JSON.stringify({
        contact_email: args.email,
        display_name: args.companyName,
        dashboard: "express",
        identity: { country: "US" },
        defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
        metadata: { company_id: String(args.companyId), type: "crewkat_connect" },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw await stripeConnectError(response, "Stripe could not create the connected account.");
    const result = await response.json() as { id?: unknown };
    if (typeof result.id !== "string" || !result.id) throw new Error("Stripe did not return an account id.");
    return { configured: true, accountId: result.id, missing: [] };
  },
  async createConnectAccountLink(args) {
    const secretKey = process.env.STRIPE_CONNECT_SECRET_KEY?.trim();
    if (!secretKey) return { configured: false, url: null };
    // Account Links v2: the v1 flat shape (account / refresh_url /
    // return_url / type=account_onboarding) becomes a use_case object;
    // configurations must match the account's applied configurations —
    // ours carries "merchant" only.
    const response = await fetch("https://api.stripe.com/v2/core/account_links", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json", "Stripe-Version": STRIPE_CONNECT_V2_VERSION },
      body: JSON.stringify({
        account: args.accountId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["merchant"],
            refresh_url: args.refreshUrl,
            return_url: args.returnUrl,
          },
        },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw await stripeConnectError(response, "Stripe could not start onboarding.");
    const result = await response.json() as { url?: unknown };
    if (typeof result.url !== "string" || !/^https:\/\//.test(result.url)) throw new Error("Stripe did not return an onboarding link.");
    return { configured: true, url: result.url };
  },
  async getConnectAccount(args) {
    const secretKey = process.env.STRIPE_CONNECT_SECRET_KEY?.trim();
    if (!secretKey) return { configured: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false };
    // Accounts v2 read. v2 returns most sub-objects only when asked via
    // `include` — request the merchant configuration (capability
    // states) and the requirements (what the account holder still owes).
    const url = new URL(`https://api.stripe.com/v2/core/accounts/${encodeURIComponent(args.accountId)}`);
    url.searchParams.append("include[0]", "configuration.merchant");
    url.searchParams.append("include[1]", "requirements");
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}`, "Stripe-Version": STRIPE_CONNECT_V2_VERSION },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw await stripeConnectError(response, "Could not read the connected account from Stripe.");
    const result = await response.json() as {
      configuration?: { merchant?: { capabilities?: { card_payments?: { status?: unknown }; stripe_balance?: { payouts?: { status?: unknown } } } } };
      requirements?: { entries?: unknown };
    };
    // v1 → v2 status mapping (Stripe's own go-live readiness paths):
    // charges_enabled → merchant card_payments capability status
    // "active" (it gates the Pay buttons, so it must mean the account
    // can actually accept a card payment now — "restricted"/"pending"
    // do not count); payouts_enabled → the merchant configuration's
    // stripe_balance.payouts capability status "active" (auto-requested
    // with card_payments; it is v2's replacement for v1 payouts);
    // details_submitted → no requirements entry is still awaiting the
    // account holder ("user") at a currently-due or past-due deadline —
    // the v2 analogue of v1's details_submitted (everything currently
    // asked of the holder has been provided; Stripe-side verification
    // entries awaiting "stripe" don't unset it).
    const capabilities = result.configuration?.merchant?.capabilities;
    const entries = Array.isArray(result.requirements?.entries) ? result.requirements.entries as Array<{ awaiting_action_from?: unknown; minimum_deadline?: { status?: unknown } }> : [];
    const holderOwes = entries.some((e) => e?.awaiting_action_from === "user" && (e?.minimum_deadline?.status === "currently_due" || e?.minimum_deadline?.status === "past_due"));
    return {
      configured: true,
      chargesEnabled: capabilities?.card_payments?.status === "active",
      payoutsEnabled: capabilities?.stripe_balance?.payouts?.status === "active",
      detailsSubmitted: !holderOwes,
    };
  },
  async createInvoiceCheckout(args) {
    const secretKey = process.env.STRIPE_CONNECT_SECRET_KEY?.trim();
    if (!secretKey) return { configured: false, sessionId: null, url: null, missing: ["STRIPE_CONNECT_SECRET_KEY"] };
    const body = new URLSearchParams({
      mode: "payment",
      "payment_method_types[0]": "card",
      "payment_method_types[1]": "us_bank_account",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(args.amountCents),
      "line_items[0][price_data][product_data][name]": args.description,
      "metadata[type]": "invoice_payment",
      "metadata[invoice_id]": String(args.invoiceId),
      "metadata[company_id]": String(args.companyId),
      "payment_intent_data[metadata][type]": "invoice_payment",
      "payment_intent_data[metadata][invoice_id]": String(args.invoiceId),
      "payment_intent_data[metadata][company_id]": String(args.companyId),
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
    });
    if (args.customerEmail) body.set("customer_email", args.customerEmail);
    if (args.applicationFeeCents > 0) body.set("payment_intent_data[application_fee_amount]", String(args.applicationFeeCents));
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Account": args.accountId },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw await stripeConnectError(response, "Stripe Checkout could not be started for this invoice.");
    const result = await response.json() as { id?: unknown; url?: unknown };
    if (typeof result.url !== "string" || !/^https:\/\/checkout\.stripe\.com\//.test(result.url) || typeof result.id !== "string") throw new Error("Stripe did not return a valid checkout page.");
    return { configured: true, sessionId: result.id, url: result.url, missing: [] };
  },
  // ---- Wave 2 (Item 7): QuickBooks Online handlers ------------------
  async qbPlatformStatus() {
    const configured = !!(process.env.QB_CLIENT_ID?.trim() && process.env.QB_CLIENT_SECRET?.trim());
    return { configured, environment: process.env.QB_ENVIRONMENT?.trim() === "production" ? "production" : "sandbox" };
  },
  async qbTokenExchange(args) {
    const clientId = process.env.QB_CLIENT_ID?.trim();
    const clientSecret = process.env.QB_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return { configured: false, accessToken: null, refreshToken: null, expiresInSeconds: 0 };
    const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: args.code, redirect_uri: args.redirectUri }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Intuit did not accept the connection code. Try connecting again.");
    const result = await response.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (typeof result.access_token !== "string" || typeof result.refresh_token !== "string") throw new Error("Intuit did not return connection tokens.");
    return { configured: true, accessToken: result.access_token, refreshToken: result.refresh_token, expiresInSeconds: typeof result.expires_in === "number" ? result.expires_in : 3600 };
  },
  async qbRefreshToken(args) {
    const clientId = process.env.QB_CLIENT_ID?.trim();
    const clientSecret = process.env.QB_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return { configured: false, accessToken: null, refreshToken: null, expiresInSeconds: 0 };
    const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: args.refreshToken }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("The QuickBooks connection has expired. Reconnect in Settings.");
    const result = await response.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (typeof result.access_token !== "string") throw new Error("Intuit did not return a refreshed token.");
    return { configured: true, accessToken: result.access_token, refreshToken: typeof result.refresh_token === "string" ? result.refresh_token : args.refreshToken, expiresInSeconds: typeof result.expires_in === "number" ? result.expires_in : 3600 };
  },
  async qbApiRequest(args) {
    const configured = !!(process.env.QB_CLIENT_ID?.trim() && process.env.QB_CLIENT_SECRET?.trim());
    if (!configured) return { configured: false, status: 0, body: "" };
    const base = process.env.QB_ENVIRONMENT?.trim() === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
    const response = await fetch(`${base}/v3/company/${encodeURIComponent(args.realmId)}${args.path}`, {
      method: args.method,
      headers: { Authorization: `Bearer ${args.accessToken}`, Accept: "application/json", ...(args.method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: args.method === "POST" && args.body ? args.body : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(25_000),
    });
    const text = await response.text();
    return { configured: true, status: response.status, body: text.slice(0, 60_000) };
  },
  async listStripeCharges(args) {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) throw new Error("Stripe is not configured.");
    const params = new URLSearchParams({ customer: args.customerId, limit: String(args.limit) });
    const response = await fetch(`https://api.stripe.com/v1/charges?${params}`, {
      method: "GET",
      headers: { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Could not load Stripe charges.");
    const result = await response.json() as { data?: Array<{ id?: unknown; amount?: unknown; amount_refunded?: unknown; currency?: unknown; created?: unknown; status?: unknown; description?: unknown }> };
    const charges = (result.data ?? []).map((charge) => ({
      id: typeof charge.id === "string" ? charge.id : "",
      amount: typeof charge.amount === "number" ? Math.round(charge.amount) : 0,
      amountRefunded: typeof charge.amount_refunded === "number" ? Math.round(charge.amount_refunded) : 0,
      currency: typeof charge.currency === "string" ? charge.currency : "usd",
      created: typeof charge.created === "number" ? Math.round(charge.created) : 0,
      status: typeof charge.status === "string" ? charge.status : "unknown",
      description: typeof charge.description === "string" ? charge.description : null,
    })).filter((charge) => charge.id);
    return { charges };
  },
  // Billing section: normalize the customer's invoices for the in-app
  // payment history. Drafts are excluded (not yet a bill). amountCents is
  // what was actually paid, falling back to the amount due for open bills.
  async listStripeInvoices(args) {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) return { configured: false, invoices: [] as Array<{ id: string; created: number; description: string | null; amountCents: number; currency: string; status: string; receiptUrl: string | null }> };
    const params = new URLSearchParams({ customer: args.customerId, limit: String(args.limit) });
    const response = await fetch(`https://api.stripe.com/v1/invoices?${params}`, {
      method: "GET",
      headers: { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Could not load Stripe invoices.");
    const result = await response.json() as { data?: Array<{ id?: unknown; created?: unknown; status?: unknown; currency?: unknown; amount_paid?: unknown; amount_due?: unknown; description?: unknown; hosted_invoice_url?: unknown; invoice_pdf?: unknown; lines?: { data?: Array<{ description?: unknown }> } }> };
    const invoices = (result.data ?? []).map((invoice) => {
      const amountPaid = typeof invoice.amount_paid === "number" ? Math.round(invoice.amount_paid) : 0;
      const amountDue = typeof invoice.amount_due === "number" ? Math.round(invoice.amount_due) : 0;
      const lineDescription = invoice.lines?.data?.[0]?.description;
      return {
        id: typeof invoice.id === "string" ? invoice.id : "",
        created: typeof invoice.created === "number" ? Math.round(invoice.created) : 0,
        description: typeof invoice.description === "string" && invoice.description ? invoice.description : typeof lineDescription === "string" && lineDescription ? lineDescription : null,
        amountCents: amountPaid > 0 ? amountPaid : amountDue,
        currency: typeof invoice.currency === "string" ? invoice.currency : "usd",
        status: typeof invoice.status === "string" ? invoice.status : "unknown",
        receiptUrl: typeof invoice.hosted_invoice_url === "string" && invoice.hosted_invoice_url ? invoice.hosted_invoice_url : typeof invoice.invoice_pdf === "string" && invoice.invoice_pdf ? invoice.invoice_pdf : null,
      };
    }).filter((invoice) => invoice.id && invoice.status !== "draft");
    return { configured: true, invoices };
  },
  async createBillingPortalSession(args) {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) return { url: null as string | null, errorCode: "stripe_unconfigured" as const };
    const body = new URLSearchParams({ customer: args.customerId, return_url: args.returnUrl });
    const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      let message = "";
      try {
        const err = await response.json() as { error?: { message?: unknown } };
        if (typeof err.error?.message === "string") message = err.error.message;
      } catch { /* keep empty */ }
      // No default portal configuration in the Stripe Dashboard -> Stripe
      // answers with a "configuration" error. Surface it distinctly so the
      // client can say "isn't set up yet" (Danny: one Dashboard toggle).
      if (/configuration/i.test(message)) return { url: null as string | null, errorCode: "portal_not_configured" as const };
      throw new Error(message || "Stripe could not open the billing portal.");
    }
    const result = await response.json() as { url?: unknown };
    if (typeof result.url !== "string" || !/^https:\/\/billing\.stripe\.com\//.test(result.url)) throw new Error("Stripe did not return a valid billing portal page.");
    return { url: result.url, errorCode: null as null };
  },
  async issueStripeRefund(args) {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) throw new Error("Stripe is not configured.");
    const authHeader = { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}` };
    // Fetch the charge first so we can validate the requested amount against
    // what is actually refundable (Stripe rejects over-refunds anyway; this
    // gives a clearer error and a validated amount in the response).
    const chargeResponse = await fetch(`https://api.stripe.com/v1/charges/${encodeURIComponent(args.chargeId)}`, {
      method: "GET",
      headers: authHeader,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!chargeResponse.ok) throw new Error("Stripe could not find that charge.");
    const charge = await chargeResponse.json() as { amount?: unknown; amount_refunded?: unknown };
    const refundable = (typeof charge.amount === "number" ? Math.round(charge.amount) : 0) - (typeof charge.amount_refunded === "number" ? Math.round(charge.amount_refunded) : 0);
    if (args.amountCents && args.amountCents > refundable) throw new Error(`Only ${(refundable / 100).toFixed(2)} is refundable on this charge.`);
    const body = new URLSearchParams({ charge: args.chargeId });
    if (args.amountCents) body.set("amount", String(args.amountCents));
    if (args.reason) body.set("metadata[reason]", args.reason.slice(0, 500));
    const response = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      let detail = "Stripe could not issue this refund.";
      try {
        const err = await response.json() as { error?: { message?: unknown } };
        if (typeof err.error?.message === "string") detail = err.error.message;
      } catch { /* keep default */ }
      throw new Error(detail);
    }
    const result = await response.json() as { id?: unknown; amount?: unknown; currency?: unknown; status?: unknown };
    if (typeof result.id !== "string" || typeof result.amount !== "number") throw new Error("Stripe did not return a valid refund.");
    return {
      id: result.id,
      amount: Math.round(result.amount),
      currency: typeof result.currency === "string" ? result.currency : "usd",
      status: typeof result.status === "string" ? result.status : "unknown",
    };
  },
  // Admin panel Phase 1: billing surfaces. Unconfigured -> configured:false;
  // mutating calls throw when Stripe is not configured (action layer is admin-only).
  async listStripeSubscriptions(args) {
    const unconfigured = { configured: false, subscriptions: [] as never[], hasMore: false };
    const authHeader = stripeAdminAuthHeader(false);
    if (!authHeader) return unconfigured;
    const params = new URLSearchParams({ limit: String(args.limit), "expand[]": "data.customer" });
    if (args.status !== "all") params.set("status", args.status);
    if (args.startingAfter) params.set("starting_after", args.startingAfter);
    const response = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
      method: "GET", headers: authHeader, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Could not load Stripe subscriptions.");
    const result = await response.json() as {
      data?: Array<{
        id?: unknown; customer?: unknown; status?: unknown; cancel_at_period_end?: unknown;
        current_period_end?: unknown;
        items?: { data?: Array<{ price?: { unit_amount?: unknown; recurring?: { interval?: unknown } } }> };
      }>; has_more?: unknown;
    };
    const subscriptions = (result.data ?? []).map((sub) => {
      const item = sub.items?.data?.[0];
      const customer = sub.customer as { id?: unknown; email?: unknown } | string | undefined;
      return {
        id: typeof sub.id === "string" ? sub.id : "",
        customerId: typeof customer === "object" && customer && typeof customer.id === "string" ? customer.id : (typeof sub.customer === "string" ? sub.customer : ""),
        customerEmail: typeof customer === "object" && customer && typeof customer.email === "string" ? customer.email : null,
        status: typeof sub.status === "string" ? sub.status : "unknown",
        amountCents: typeof item?.price?.unit_amount === "number" ? Math.round(item.price.unit_amount) : 0,
        interval: typeof item?.price?.recurring?.interval === "string" ? item.price.recurring.interval : "month",
        currentPeriodEnd: typeof sub.current_period_end === "number" ? Math.round(sub.current_period_end) : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      };
    }).filter((s) => s.id);
    return { configured: true, subscriptions, hasMore: result.has_more === true };
  },
  async listStripePayments(args) {
    const unconfigured = { configured: false, charges: [] as never[], hasMore: false };
    const authHeader = stripeAdminAuthHeader(false);
    if (!authHeader) return unconfigured;
    const params = new URLSearchParams({ limit: String(args.limit), "expand[]": "data.customer" });
    if (args.startingAfter) params.set("starting_after", args.startingAfter);
    const response = await fetch(`https://api.stripe.com/v1/charges?${params}`, {
      method: "GET", headers: authHeader, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Could not load Stripe payments.");
    const result = await response.json() as {
      data?: Array<{
        id?: unknown; amount?: unknown; amount_refunded?: unknown; currency?: unknown;
        created?: unknown; status?: unknown; description?: unknown; customer?: unknown;
      }>; has_more?: unknown;
    };
    const charges = (result.data ?? []).map((charge) => {
      const customer = charge.customer as { email?: unknown } | string | undefined;
      return {
        id: typeof charge.id === "string" ? charge.id : "",
        amount: typeof charge.amount === "number" ? Math.round(charge.amount) : 0,
        amountRefunded: typeof charge.amount_refunded === "number" ? Math.round(charge.amount_refunded) : 0,
        currency: typeof charge.currency === "string" ? charge.currency : "usd",
        created: typeof charge.created === "number" ? Math.round(charge.created) : 0,
        status: typeof charge.status === "string" ? charge.status : "unknown",
        customerEmail: typeof customer === "object" && customer && typeof customer.email === "string" ? customer.email : null,
        description: typeof charge.description === "string" ? charge.description : null,
      };
    }).filter((c) => c.id);
    return { configured: true, charges, hasMore: result.has_more === true };
  },
  async listStripeFailedPayments() {
    const unconfigured = { configured: false, failed: [] as never[] };
    const authHeader = stripeAdminAuthHeader(false);
    if (!authHeader) return unconfigured;
    // Past-due + payment-failed open invoices carry the dunning state.
    const params = new URLSearchParams({ limit: "50", "expand[]": "data.customer" });
    const response = await fetch(`https://api.stripe.com/v1/invoices?${params}`, {
      method: "GET", headers: authHeader, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Could not load Stripe invoices.");
    const result = await response.json() as {
      data?: Array<{
        id?: unknown; customer?: unknown; amount_due?: unknown; currency?: unknown;
        status?: unknown; attempt_count?: unknown; next_payment_attempt?: unknown; created?: unknown;
      }>;
    };
    const failed = (result.data ?? [])
      .filter((inv) => inv.status === "open" && (inv.attempt_count as number) > 0)
      .map((inv) => {
        const customer = inv.customer as { email?: unknown } | string | undefined;
        return {
          invoiceId: typeof inv.id === "string" ? inv.id : "",
          customerEmail: typeof customer === "object" && customer && typeof customer.email === "string" ? customer.email : null,
          amountCents: typeof inv.amount_due === "number" ? Math.round(inv.amount_due) : 0,
          currency: typeof inv.currency === "string" ? inv.currency : "usd",
          status: typeof inv.status === "string" ? inv.status : "unknown",
          attemptCount: typeof inv.attempt_count === "number" ? Math.round(inv.attempt_count) : 0,
          nextRetryAt: typeof inv.next_payment_attempt === "number" ? Math.round(inv.next_payment_attempt) : null,
          created: typeof inv.created === "number" ? Math.round(inv.created) : 0,
        };
      }).filter((f) => f.invoiceId);
    return { configured: true, failed };
  },
  async createStripeCoupon(args) {
    const authHeader = stripeAdminAuthHeader(true);
    if (!args.percentOff && !args.amountOffCents) throw new Error("Set a percent or an amount off.");
    if (args.percentOff && args.amountOffCents) throw new Error("Set either percent or amount off, not both.");
    const body = new URLSearchParams({ duration: args.duration });
    body.set("id", `crewkat_${args.code.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`);
    if (args.percentOff) body.set("percent_off", String(args.percentOff));
    else body.set("amount_off", String(args.amountOffCents));
    if (!args.percentOff) body.set("currency", "usd");
    if (args.duration === "repeating") body.set("duration_in_months", String(args.durationInMonths ?? 3));
    const response = await fetch("https://api.stripe.com/v1/coupons", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/x-www-form-urlencoded" },
      body, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      let detail = "Stripe could not create this coupon.";
      try {
        const err = await response.json() as { error?: { message?: unknown } };
        if (typeof err.error?.message === "string") detail = err.error.message;
      } catch { /* keep default */ }
      throw new Error(detail);
    }
    const result = await response.json() as { id?: unknown; percent_off?: unknown; amount_off?: unknown; duration?: unknown };
    if (typeof result.id !== "string") throw new Error("Stripe did not return a valid coupon.");
    return {
      id: result.id,
      code: args.code.toUpperCase(),
      percentOff: typeof result.percent_off === "number" ? result.percent_off : null,
      amountOff: typeof result.amount_off === "number" ? Math.round(result.amount_off) : null,
      duration: typeof result.duration === "string" ? result.duration : args.duration,
    };
  },
  async listStripeCoupons(args) {
    const unconfigured = { configured: false, coupons: [] as never[] };
    const authHeader = stripeAdminAuthHeader(false);
    if (!authHeader) return unconfigured;
    const params = new URLSearchParams({ limit: String(args.limit) });
    const response = await fetch(`https://api.stripe.com/v1/coupons?${params}`, {
      method: "GET", headers: authHeader, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Could not load Stripe coupons.");
    const result = await response.json() as {
      data?: Array<{ id?: unknown; percent_off?: unknown; amount_off?: unknown; currency?: unknown; duration?: unknown; times_redeemed?: unknown }>;
    };
    const coupons = (result.data ?? []).map((c) => ({
      id: typeof c.id === "string" ? c.id : "",
      code: typeof c.id === "string" ? c.id.replace(/^crewkat_/, "").replace(/_/g, " ").toUpperCase() : null,
      percentOff: typeof c.percent_off === "number" ? c.percent_off : null,
      amountOff: typeof c.amount_off === "number" ? Math.round(c.amount_off) : null,
      currency: typeof c.currency === "string" ? c.currency : null,
      duration: typeof c.duration === "string" ? c.duration : "once",
      timesRedeemed: typeof c.times_redeemed === "number" ? Math.round(c.times_redeemed) : 0,
    })).filter((c) => c.id);
    return { configured: true, coupons };
  },
  async deleteStripeCoupon(args) {
    const authHeader = stripeAdminAuthHeader(true);
    const response = await fetch(`https://api.stripe.com/v1/coupons/${encodeURIComponent(args.couponId)}`, {
      method: "DELETE", headers: authHeader, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Stripe could not delete this coupon.");
    return { ok: true as const, id: args.couponId };
  },
  // Platform admin suite: live revenue stats for the admin dashboard.
  // Unconfigured -> configured:false (graceful, no crash, no throw).
  async getStripeRevenueStats() {
    const unconfigured = { configured: false, mrrCents: null, activeSubscriptions: null, trialing: null, failedPayments: null };
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) return unconfigured;
    const authHeader = { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}` };
    try {
      // Active subscriptions (paginated, capped) for MRR.
      let mrrCents = 0;
      let activeSubscriptions = 0;
      let startingAfter: string | null = null;
      for (let page = 0; page < 5; page++) {
        const params = new URLSearchParams({ status: "active", limit: "100", "expand[]": "data.items" });
        if (startingAfter) params.set("starting_after", startingAfter);
        const response = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
          method: "GET", headers: authHeader, redirect: "error", signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`Stripe subscriptions request failed: ${response.status}`);
        const result = await response.json() as {
          data?: Array<{ id?: unknown; items?: { data?: Array<{ quantity?: unknown; price?: { unit_amount?: unknown; recurring?: { interval?: unknown } } }> } }>;
          has_more?: unknown;
        };
        const subs = result.data ?? [];
        activeSubscriptions += subs.length;
        for (const sub of subs) {
          for (const item of sub.items?.data ?? []) {
            const qty = typeof item.quantity === "number" ? item.quantity : 1;
            const unit = typeof item.price?.unit_amount === "number" ? Math.round(item.price.unit_amount) : 0;
            const interval = item.price?.recurring?.interval;
            mrrCents += interval === "month" ? unit * qty : interval === "year" ? Math.round((unit * qty) / 12) : 0;
          }
        }
        if (result.has_more !== true || !subs.length) break;
        const lastId = subs[subs.length - 1]?.id;
        if (typeof lastId !== "string") break;
        startingAfter = lastId;
      }
      // Counts via total_count (limit=1 keeps these cheap).
      const count = async (path: string): Promise<number | null> => {
        const response = await fetch(`https://api.stripe.com${path}`, {
          method: "GET", headers: authHeader, redirect: "error", signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) return null;
        const result = await response.json() as { total_count?: unknown };
        return typeof result.total_count === "number" ? Math.round(result.total_count) : null;
      };
      const [trialing, failedPayments] = await Promise.all([
        count("/v1/subscriptions?status=trialing&limit=1"),
        count("/v1/invoices?status=open&limit=1"),
      ]);
      return { configured: true, mrrCents, activeSubscriptions, trialing, failedPayments };
    } catch (error) {
      console.error("[crewkat][platform-admin] Stripe revenue stats failed:", error);
      return unconfigured;
    }
  },
  // Phase 4: Google Play Billing verification. Reads the service-account
  // credential from PLAY_SERVICE_ACCOUNT_JSON (inline JSON) or
  // PLAY_SERVICE_ACCOUNT_JSON_PATH (file path). Never throws for
  // configuration or Google-side problems — it reports them in the result so
  // the action layer can fail gracefully without granting premium.
  async getPlayBillingStatus() {
    const sku = process.env.PLAY_PREMIUM_SKU?.trim() || "crewkat_premium_monthly";
    const packageName = process.env.PLAY_PACKAGE_NAME?.trim() || "com.crewkat.app";
    const configured = Boolean(process.env.PLAY_SERVICE_ACCOUNT_JSON?.trim() || process.env.PLAY_SERVICE_ACCOUNT_JSON_PATH?.trim());
    return { configured, sku, packageName };
  },
  async verifyPlayPurchase(args) {
    const failed = (error: string) => ({
      configured: true, verified: false, active: false,
      orderId: null as string | null, expiryTimeMillis: null as string | null,
      autoRenewing: false, error,
    });
    const unconfigured = {
      configured: false, verified: false, active: false,
      orderId: null as string | null, expiryTimeMillis: null as string | null,
      autoRenewing: false, error: "Google Play Billing verification is not configured.",
    };
    const sku = process.env.PLAY_PREMIUM_SKU?.trim() || "crewkat_premium_monthly";
    const packageName = process.env.PLAY_PACKAGE_NAME?.trim() || "com.crewkat.app";
    // Defense in depth: only our own Premium SKU may be verified here.
    if (args.sku !== sku) {
      console.error("[crewkat][play-billing] rejected unexpected SKU:", args.sku);
      return { ...failed("Unknown product."), error: "Unknown product." };
    }
    let serviceAccountJson = process.env.PLAY_SERVICE_ACCOUNT_JSON?.trim() || "";
    if (!serviceAccountJson) {
      const jsonPath = process.env.PLAY_SERVICE_ACCOUNT_JSON_PATH?.trim() || "";
      if (!jsonPath) return unconfigured;
      try {
        serviceAccountJson = (await readFile(jsonPath, "utf8")).trim();
      } catch (error) {
        console.error("[crewkat][play-billing] could not read service-account file:", error);
        return unconfigured;
      }
    }
    let serviceAccount: { client_email?: unknown; private_key?: unknown };
    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch {
      console.error("[crewkat][play-billing] service-account JSON is invalid.");
      return unconfigured;
    }
    if (typeof serviceAccount.client_email !== "string" || typeof serviceAccount.private_key !== "string") {
      console.error("[crewkat][play-billing] service-account JSON is missing client_email/private_key.");
      return unconfigured;
    }
    try {
      // OAuth2 service-account flow for the Android Publisher scope.
      const nowSeconds = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
      const claims = Buffer.from(JSON.stringify({
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/androidpublisher",
        aud: "https://oauth2.googleapis.com/token",
        iat: nowSeconds,
        exp: nowSeconds + 3600,
      })).toString("base64url");
      const signer = createSign("RSA-SHA256");
      signer.update(`${header}.${claims}`);
      const signature = signer.sign(serviceAccount.private_key, "base64url");
      const assertion = `${header}.${claims}.${signature}`;
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!tokenResponse.ok) {
        console.error("[crewkat][play-billing] Google OAuth token request failed:", tokenResponse.status);
        return failed("Google authentication failed.");
      }
      const tokenJson = await tokenResponse.json() as { access_token?: unknown };
      if (typeof tokenJson.access_token !== "string" || !tokenJson.access_token) return failed("Google authentication failed.");
      const apiUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/${encodeURIComponent(args.purchaseToken)}`;
      const purchaseResponse = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (purchaseResponse.status === 404) return failed("Purchase not found.");
      if (!purchaseResponse.ok) {
        console.error("[crewkat][play-billing] Play Developer API error:", purchaseResponse.status);
        return failed("Google Play verification failed.");
      }
      const purchase = await purchaseResponse.json() as {
        subscriptionState?: unknown;
        lineItems?: Array<{ productId?: unknown; expiryTime?: unknown; autoRenewing?: unknown; orderId?: unknown }>;
      };
      const lineItem = Array.isArray(purchase.lineItems) ? purchase.lineItems[0] : undefined;
      const productId = typeof lineItem?.productId === "string" ? lineItem.productId : "";
      if (productId !== sku) {
        console.error("[crewkat][play-billing] product mismatch:", productId);
        return failed("Purchase does not match this product.");
      }
      const state = typeof purchase.subscriptionState === "string" ? purchase.subscriptionState : "";
      const expiryTime = typeof lineItem?.expiryTime === "string" ? lineItem.expiryTime : "";
      const expiryMs = expiryTime ? Date.parse(expiryTime) : NaN;
      const notExpired = Number.isFinite(expiryMs) && expiryMs > Date.now();
      // Entitled while the subscription is active, in grace period, or
      // canceled-but-paid-through (Google reports CANCELED until expiry).
      const active = (state === "SUBSCRIPTION_STATE_ACTIVE" || state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" || state === "SUBSCRIPTION_STATE_CANCELED") && notExpired;
      return {
        configured: true,
        verified: true,
        active,
        orderId: typeof lineItem?.orderId === "string" ? lineItem.orderId : null,
        expiryTimeMillis: Number.isFinite(expiryMs) ? String(expiryMs) : null,
        autoRenewing: lineItem?.autoRenewing === true,
        error: null,
      };
    } catch (error) {
      console.error("[crewkat][play-billing] verification failed:", error);
      return failed("Google Play verification failed.");
    }
  },
});
