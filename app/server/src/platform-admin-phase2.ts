// Platform admin Phase 2 (2026-10-09): aggregator for the three workstream
// modules — support tickets, marketplace analytics + growth metrics, and
// platform settings (maintenance, branding, policy versions, admin TOTP 2FA).
// Spread once into BaseActions in actions.ts.
import { platformAdminPhase2SupportActions } from "./platform-admin-phase2-support";
import { platformAdminPhase2AnalyticsActions } from "./platform-admin-phase2-analytics";
import { platformAdminPhase2SettingsActions } from "./platform-admin-phase2-settings";

export const platformAdminPhase2Actions = {
  ...platformAdminPhase2SupportActions,
  ...platformAdminPhase2AnalyticsActions,
  ...platformAdminPhase2SettingsActions,
};
