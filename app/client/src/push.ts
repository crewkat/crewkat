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

/** Registers the app service worker (also powers offline mode). Safe to call repeatedly. */
export async function registerAppServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  try {
    await navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" });
    return true;
  } catch {
    return false;
  }
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
