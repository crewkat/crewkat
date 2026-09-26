import { createHmac, timingSafeEqual } from "node:crypto";
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
  createStripeCheckout: {
    request: z.object({ userId: z.number().int().positive(), companyId: z.number().int().positive(), email: z.string().email().max(200) }),
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
    }),
    capabilities: [],
    timeoutMs: 20_000,
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
    const priceId = process.env.STRIPE_PREMIUM_PRICE_ID?.trim();
    const publicUrl = process.env.CREWKAT_PUBLIC_URL?.trim().replace(/\/$/, "");
    const missing = [
      !publishableKey ? "STRIPE_PUBLISHABLE_KEY" : "",
      !secretKey ? "STRIPE_SECRET_KEY" : "",
      !priceId ? "STRIPE_PREMIUM_PRICE_ID" : "",
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
    return {
      eventId: event.id,
      eventType,
      userId: parsedUserId && Number.isInteger(parsedUserId) && parsedUserId > 0 ? parsedUserId : null,
      customerId,
      subscriptionId,
      subscriptionStatus,
      currentPeriodEnd,
      cancelAtPeriodEnd: object.cancel_at_period_end === true,
    };
  },
});
