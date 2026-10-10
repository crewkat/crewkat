// Push nudge decision logic — pure, no DOM access, safe to unit-test in bun.
// The one-time sheet (PushPromptSheet) handles first contact; the slim Home
// banner only appears for users who dismissed the sheet and still don't have
// push enabled. Dismissing the banner snoozes it for 7 days. No nagging.
export const PUSH_BANNER_SNOOZE_KEY = "crewkat:push-banner-snoozed-until";
export const PUSH_BANNER_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export type PushReadiness = {
  supported: boolean;
  vapidConfigured: boolean;
  permission: "default" | "granted" | "denied";
  subscribed: boolean;
};

export type PushBannerSignal = PushReadiness & {
  /** The one-time prompt sheet already had its turn on this device. */
  promptSeen: boolean;
};

/** True when the Home nudge banner should be shown. */
export function shouldShowPushBanner(
  signal: PushBannerSignal,
  nowMs: number,
  snoozedUntilMs: number | null,
): boolean {
  if (!signal.supported || !signal.vapidConfigured) return false;
  // Browser-level block: nothing we can do from the banner; the Settings
  // toggle already explains how to unblock. Don't nag.
  if (signal.permission === "denied") return false;
  if (signal.subscribed) return false;
  // First contact belongs to the one-time sheet, not the banner.
  if (!signal.promptSeen) return false;
  if (snoozedUntilMs != null && nowMs < snoozedUntilMs) return false;
  return true;
}

/** Timestamp (ms) at which a banner dismissal stops snoozing. */
export function snoozePushBannerUntil(nowMs: number): number {
  return nowMs + PUSH_BANNER_SNOOZE_MS;
}
