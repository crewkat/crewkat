// Phase 4: Google Play Billing (Digital Goods API) for the TWA.
//
// The Android app is a Trusted Web Activity (package com.crewkat.app) wrapping
// this PWA. Google Play policy requires digital goods sold inside the Play
// app to use Play Billing — so inside the Play-installed app, Premium is sold
// exclusively through the Digital Goods API + Payment Request API here, and
// the purchase token is verified server-side (purchases.subscriptionsv2).
// The regular web keeps Stripe; the two paths never link to each other.
//
// Detection: document.referrer starts with "android-app://com.crewkat.app"
// when the TWA is launched from the Play-installed app. Standalone
// display-mode is a secondary signal (installed app). If the Digital Goods
// API is missing (desktop browser, iOS, plain Chrome tab), the Play option is
// hidden and the caller falls back to the web/Stripe presentation.

export const PLAY_PACKAGE_NAME = "com.crewkat.app";
export const PLAY_BILLING_METHOD = "https://play.google.com/billing";

export interface PlaySkuPrice {
  currency: string;
  value: string;
}

export interface PlaySkuDetails {
  itemId: string;
  title: string;
  description: string;
  price: PlaySkuPrice;
}

interface DigitalGoodsService {
  getDetails(itemIds: string[]): Promise<PlaySkuDetails[]>;
}

declare global {
  interface Window {
    getDigitalGoodsService?: (serviceUrl: string) => Promise<DigitalGoodsService | null>;
  }
}

/** True when the page is running inside the Play-installed TWA (or an installed app shell). */
export function isPlayAppContext(): boolean {
  try {
    const referrer = typeof document !== "undefined" ? document.referrer || "" : "";
    if (referrer.startsWith(`android-app://${PLAY_PACKAGE_NAME}`)) return true;
    // Secondary signal: installed-app display mode.
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(display-mode: standalone)").matches;
    }
    return false;
  } catch {
    return false;
  }
}

/** The Play Billing purchase flow can be offered only in the Play app with the Digital Goods API present. */
export function canUsePlayBilling(): boolean {
  try {
    return isPlayAppContext() && typeof window !== "undefined" && typeof window.getDigitalGoodsService === "function";
  } catch {
    return false;
  }
}

/** Localized price/title for a Play SKU (for display before purchase). Null when unavailable. */
export async function getPlaySkuDetails(sku: string): Promise<PlaySkuDetails | null> {
  try {
    if (typeof window === "undefined" || typeof window.getDigitalGoodsService !== "function") return null;
    const service = await window.getDigitalGoodsService(PLAY_BILLING_METHOD);
    if (!service) return null;
    const details = await service.getDetails([sku]);
    return details?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Runs the Play Billing purchase sheet for a subscription SKU and resolves
 * with the purchase token. Rejects with DOMException AbortError when the user
 * cancels; rejects otherwise on failure.
 */
export async function purchasePlaySku(sku: string): Promise<string> {
  if (typeof window === "undefined" || typeof window.getDigitalGoodsService !== "function") {
    throw new Error("Google Play Billing is not available here.");
  }
  const details = await getPlaySkuDetails(sku);
  const price: PlaySkuPrice = details?.price ?? { currency: "USD", value: "19.00" };
  const request = new PaymentRequest(
    [{ supportedMethods: PLAY_BILLING_METHOD, data: { sku } }],
    { total: { label: details?.title ?? "Crewkat Premium", amount: price } },
  );
  const response = await request.show();
  try {
    const purchaseToken = (response.details as { purchaseToken?: unknown } | undefined)?.purchaseToken;
    if (typeof purchaseToken !== "string" || !purchaseToken) throw new Error("Google Play did not return a purchase token.");
    await response.complete("success");
    return purchaseToken;
  } catch (error) {
    try {
      await response.complete("fail");
    } catch {
      // Ignore: the sheet is already gone.
    }
    throw error;
  }
}

/** True when the user dismissed the Play purchase sheet (not a real failure). */
export function isPlayPurchaseCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
