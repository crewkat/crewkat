// Chunk D: Web Push client plumbing.
// Service worker registration + PushManager subscription using the VAPID
// public key from `getVapidPublicKey()`. Everything no-ops gracefully when
// push isn't supported or the server key isn't configured yet (Danny does
// the Firebase console step himself — see FIREBASE_SETUP.md).

import { api } from "./api";

export type PushStatus = "subscribed" | "unavailable" | "denied" | "needs-permission" | "error";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob(base64.replace(/-/g, "+").replace(/_/g, "/") + padding);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Fired on window when a freshly deployed service worker takes control. */
export const SW_UPDATE_AVAILABLE_EVENT = "crewkat:sw-update";

/** Registers the app service worker (also powers offline mode). Safe to call repeatedly. */
export async function registerAppServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  try {
    await navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" });
    // Build 3: when a new worker (new build id) takes control, tell the app
    // so it can show the "Update available — refresh" toast. This fires once
    // per update; the toast only offers a manual refresh, so no reload loops.
    // (The first install also fires controllerchange via clients.claim() —
    // that is not an update, so it is ignored.)
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) window.dispatchEvent(new CustomEvent(SW_UPDATE_AVAILABLE_EVENT));
      hadController = true;
    });
    return true;
  } catch {
    return false;
  }
}

/** Tell the waiting service worker to activate now (update toast's Refresh button). */
export function activateWaitingServiceWorker(): void {
  try {
    void navigator.serviceWorker
      .getRegistration("/app/")
      .then((reg) => reg?.waiting?.postMessage({ type: "SKIP_WAITING" }));
  } catch {
    /* best-effort */
  }
}

/**
 * Proactively check for a newer service worker whenever the app comes back to
 * the foreground (throttled to ~30 min). The installed Play/TWA app can
 * otherwise sit on a stale build for days: it has no tab-reload habit and the
 * browser only re-checks sw.js on its own schedule. When a newer worker is
 * found, the existing controllerchange -> SW_UPDATE_AVAILABLE_EVENT flow shows
 * the "Update available" toast.
 */
let proactiveSwChecksStarted = false;
let lastProactiveSwCheck = 0;
export function startProactiveSwUpdateChecks(): void {
  if (proactiveSwChecksStarted) return;
  proactiveSwChecksStarted = true;
  const check = () => {
    try {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastProactiveSwCheck < 30 * 60 * 1000) return;
      lastProactiveSwCheck = now;
      void navigator.serviceWorker
        .getRegistration("/app/")
        .then((reg) => reg?.update().catch(() => {}));
    } catch {
      /* best-effort */
    }
  };
  document.addEventListener("visibilitychange", check);
  window.addEventListener("focus", check);
  check();
}

/**
 * Ensures a push subscription exists and is stored server-side.
 * Never prompts: if Notification.permission isn't already "granted" this
 * returns "needs-permission" so the UI can ask from a real user gesture.
 */
export async function ensurePushSubscription(): Promise<PushStatus> {
  try {
    if (!pushSupported()) return "unavailable";
    const { publicKey } = await api.getVapidPublicKey({});
    if (!publicKey) return "unavailable";
    if (Notification.permission === "denied") return "denied";
    if (Notification.permission !== "granted") return "needs-permission";
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as ArrayBuffer,
      });
    }
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "error";
    await api.savePushSubscription({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
    return "subscribed";
  } catch {
    return "error";
  }
}

/** Call from a user gesture (Settings toggle). Prompts for permission, then subscribes. */
export async function requestPushPermissionAndSubscribe(): Promise<PushStatus> {
  try {
    if (!pushSupported()) return "unavailable";
    const { publicKey } = await api.getVapidPublicKey({});
    if (!publicKey) return "unavailable";
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    return ensurePushSubscription();
  } catch {
    return "error";
  }
}

/** Removes the local subscription and deletes it server-side. */
export async function disablePushSubscription(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      try {
        await api.removePushSubscription({ endpoint: subscription.endpoint });
      } catch { /* server cleanup is best-effort */ }
      await subscription.unsubscribe().catch(() => {});
    }
  } catch { /* best-effort */ }
}

/**
 * Read-only push readiness check. Never prompts and never subscribes — safe
 * to call on any screen to decide whether a nudge UI should appear.
 */
export type PushReadiness = {
  supported: boolean;
  vapidConfigured: boolean;
  permission: "default" | "granted" | "denied";
  subscribed: boolean;
};
export async function getPushReadiness(): Promise<PushReadiness> {
  const base: PushReadiness = { supported: false, vapidConfigured: false, permission: "default", subscribed: false };
  try {
    if (!pushSupported()) return base;
    base.supported = true;
    base.permission = Notification.permission;
    const { publicKey } = await api.getVapidPublicKey({});
    if (!publicKey) return base;
    base.vapidConfigured = true;
    if (Notification.permission !== "granted") return base;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    base.subscribed = Boolean(subscription);
    return base;
  } catch {
    return base;
  }
}
