// Push nudge behavior tests.
//
// Covers the pure decision logic behind the push opt-in surfaces:
// - shouldShowPushBanner: the Home nudge banner only appears for users who
//   dismissed the one-time sheet, still lack push, aren't browser-blocked,
//   and aren't inside the 7-day dismiss snooze.
// - snoozePushBannerUntil: dismissal snoozes exactly 7 days.
//
// Run from app/:  bun push-nudge.behavior.test.ts
import { PUSH_BANNER_SNOOZE_KEY, PUSH_BANNER_SNOOZE_MS, shouldShowPushBanner, snoozePushBannerUntil, type PushBannerSignal } from "./client/src/push-nudge.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = 1_791_566_400_000; // 2026-10-09T12:00:00Z
function signal(overrides: Partial<PushBannerSignal> = {}): PushBannerSignal {
  return {
    supported: true,
    vapidConfigured: true,
    permission: "default",
    subscribed: false,
    promptSeen: true,
    ...overrides,
  };
}

// --- 1. Happy path: eligible user sees the banner ---------------------------
check("banner shows for eligible user (no snooze)", shouldShowPushBanner(signal(), NOW, null) === true);
check("banner shows when snooze expired", shouldShowPushBanner(signal(), NOW, NOW - 1) === true);

// --- 2. Snooze honored -------------------------------------------------------
check("banner hidden inside 7-day snooze", shouldShowPushBanner(signal(), NOW, NOW + 60_000) === false);
check("snooze lasts exactly 7 days", snoozePushBannerUntil(NOW) === NOW + PUSH_BANNER_SNOOZE_MS);
check("snooze constant is 7 days in ms", PUSH_BANNER_SNOOZE_MS === 7 * 24 * 60 * 60 * 1000);
check("snooze key is namespaced", PUSH_BANNER_SNOOZE_KEY.startsWith("crewkat:"));

// --- 3. No nagging -----------------------------------------------------------
check("banner hidden when prompt sheet not yet seen", shouldShowPushBanner(signal({ promptSeen: false }), NOW, null) === false);
check("banner hidden when already subscribed", shouldShowPushBanner(signal({ subscribed: true }), NOW, null) === false);
check("banner hidden when permission granted but subscription lapsed still shows",
  shouldShowPushBanner(signal({ permission: "granted", subscribed: false }), NOW, null) === true);

// --- 4. Can't help cases stay quiet ------------------------------------------
check("banner hidden when browser denied permission", shouldShowPushBanner(signal({ permission: "denied" }), NOW, null) === false);
check("banner hidden when push unsupported", shouldShowPushBanner(signal({ supported: false }), NOW, null) === false);
check("banner hidden when VAPID not configured", shouldShowPushBanner(signal({ vapidConfigured: false }), NOW, null) === false);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll push-nudge behavior checks passed.");
