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
  createStripeCheckout: {
    request: z.object({ userId: z.number().int().positive(), companyId: z.number().int().positive(), email: z.string().email().max(200), plan: z.enum(["monthly", "annual"]).default("monthly") }),
    response: z.object({ configured: z.boolean(), checkoutUrl: z.string().nullable(), missing: z.array(z.string()) }),
    capabilities: [],
    timeoutMs: 20_000,
  },
  verifyStripeWebhook: {
    request: z.object({ payload: z.string().min(1).max(1_000_000), signature: z.string().min(1).max(2000) }),
    response: z.object({
      eventId: z.string(),
      eventType: z.enum(["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted", "ignored"]),
      userId: z.number().int().positive().nullable(),
      customerId: z.string().nullable(),
      subscriptionId: z.string().nullable(),
      subscriptionStatus: z.string().nullable(),
      currentPeriodEnd: z.number().int().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      checkoutType: z.string().nullable(),
      listingId: z.number().int().positive().nullable(),
      companyId: z.number().int().positive().nullable(),
      stripeSessionId: z.string().nullable(),
    }),
    capabilities: [],
    timeoutMs: 20_000,
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
  issueStripeRefund: {
    request: z.object({ chargeId: z.string().min(1).max(200), amountCents: z.number().int().positive().max(10_000_000).optional(), reason: z.string().trim().max(500).default("") }),
    response: z.object({ id: z.string(), amount: z.number().int(), currency: z.string(), status: z.string() }),
    capabilities: [],
    timeoutMs: 20_000,
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
    const annual = args.plan === "annual";
    const priceId = (annual ? process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID?.trim() : process.env.STRIPE_PREMIUM_PRICE_ID?.trim());
    const publicUrl = process.env.CREWKAT_PUBLIC_URL?.trim().replace(/\/$/, "");
    const missing = [
      !publishableKey ? "STRIPE_PUBLISHABLE_KEY" : "",
      !secretKey ? "STRIPE_SECRET_KEY" : "",
      !priceId ? (annual ? "STRIPE_PREMIUM_ANNUAL_PRICE_ID" : "STRIPE_PREMIUM_PRICE_ID") : "",
      !publicUrl ? "CREWKAT_PUBLIC_URL" : "",
    ].filter(Boolean);
    if (missing.length || !secretKey || !priceId || !publicUrl) return { configured: false, checkoutUrl: null, missing };
    if (!/^https:\/\//i.test(publicUrl)) return { configured: false, checkoutUrl: null, missing: ["CREWKAT_PUBLIC_URL (must be HTTPS)"] };
    const body = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      customer_email: args.email,
      client_reference_id: String(args.userId),
      "metadata[user_id]": String(args.userId),
      "metadata[company_id]": String(args.companyId),
      "subscription_data[metadata][user_id]": String(args.userId),
      "subscription_data[metadata][company_id]": String(args.companyId),
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
    const parts = args.signature.split(",").map((part) => part.trim());
    const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2) ?? "";
    const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) throw new Error("Stripe webhook timestamp is invalid.");
    const expected = createHmac("sha256", secret).update(`${timestamp}.${args.payload}`).digest("hex");
    const expectedBytes = Buffer.from(expected, "hex");
    const valid = signatures.some((candidate) => {
      if (!/^[0-9a-f]{64}$/i.test(candidate)) return false;
      const candidateBytes = Buffer.from(candidate, "hex");
      return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
    });
    if (!valid) throw new Error("Stripe webhook signature is invalid.");
    const event = JSON.parse(args.payload) as { id?: unknown; type?: unknown; data?: { object?: Record<string, unknown> } };
    if (typeof event.id !== "string" || typeof event.type !== "string") throw new Error("Stripe webhook payload is invalid.");
    const object = event.data?.object ?? {};
    const metadata = object.metadata && typeof object.metadata === "object" ? object.metadata as Record<string, unknown> : {};
    const userIdValue = metadata.user_id ?? object.client_reference_id;
    const parsedUserId = typeof userIdValue === "string" ? Number(userIdValue) : null;
    const customerId = typeof object.customer === "string" ? object.customer : null;
    const subscriptionId = typeof object.subscription === "string" ? object.subscription : typeof object.id === "string" && event.type.startsWith("customer.subscription.") ? object.id : null;
    const subscriptionStatus = typeof object.status === "string" ? object.status : null;
    const currentPeriodEnd = typeof object.current_period_end === "number" ? object.current_period_end : null;
    const eventType: "checkout.session.completed" | "customer.subscription.updated" | "customer.subscription.deleted" | "ignored" = event.type === "checkout.session.completed" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted" ? event.type : "ignored";
    const listingIdValue = metadata.listing_id;
    const parsedListingId = typeof listingIdValue === "string" ? Number(listingIdValue) : null;
    const companyIdValue = metadata.company_id;
    const parsedCompanyId = typeof companyIdValue === "string" ? Number(companyIdValue) : null;
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
      listingId: parsedListingId && Number.isInteger(parsedListingId) && parsedListingId > 0 ? parsedListingId : null,
      companyId: parsedCompanyId && Number.isInteger(parsedCompanyId) && parsedCompanyId > 0 ? parsedCompanyId : null,
      stripeSessionId: event.type === "checkout.session.completed" && typeof object.id === "string" ? object.id : null,
    };
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
