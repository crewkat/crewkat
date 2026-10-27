// Track 1c: company team roles — the single, explicit permission map.
//
// PRODUCT ROLES. Every login (auth_users row) carries a stored role:
// "owner" (the account that signed up — there is exactly one per company
// today), "admin", "office", or "field". The product roles used across
// the app are derived from it: owner and admin are both ADMIN (the owner
// IS the company's first admin — every pre-roles account keeps working
// exactly as before), office is OFFICE, field is FIELD.
//
// ENFORCEMENT. protectActions (server/src/actions.ts) resolves the
// session to a user on EVERY non-public action call and checks the
// caller's product role against this map BEFORE the handler runs. UI
// hiding (Office Team section, etc.) is cosmetic; this map + the wrapper
// are the real gate. A role check failure throws, so a Field or Office
// token calling a restricted action directly gets an error, never data.
//
// LAYERS.
// - PUBLIC_ACTIONS (in actions.ts) run without a session (portal links,
//   auth flows) and bypass this map entirely.
// - PLATFORM_ACTIONS are the platform-admin panel (Danny's team). They
//   sit on a different axis: each handler enforces platform membership
//   itself (requirePlatformAdmin / requireTeamRole in platform-admin.ts),
//   so at the company layer they are open to any signed-in role — a
//   company staff account is never a platform team member, and the
//   handlers reject it.
// - ADMIN_ACTIONS: billing, company settings + branding, team
//   management, the crew roster / admin console, backups, and EVERY
//   record delete — company-level records and working records alike
//   (Danny 2026-10-24: all deletes are Admin-only).
// - OFFICE_ACTIONS: the back-office working surface — pipeline,
//   purchasing, money views and money mutations, recurring billing,
//   client selections/milestones, marketplace management. Office
//   creates and edits freely but cannot delete anything. Admin + Office.
// - ALL_ROLE_ACTIONS: the field working surface — jobs, clients,
//   documents create/edit/send/sign, schedule, photos, job comms,
//   timers, safety, support. Any signed-in role.
// NEITHER Field nor Office gets any delete action (the office-track1c
// behavior suite asserts every "delete*" action is Admin-only), with
// ONE deliberate exception: deleteMyAccount, the code-confirmed
// self-service deletion of the caller's OWN login (a Play Store data-
// deletion requirement — it removes the caller's own rows, or the
// whole company only when the caller is its sole login; it is not a
// tool for deleting company records) stays open to any signed-in role.
// Actions that revoke links (revokePortalLink, revokeDocumentLink,
// revokeOnMyWay) or cancel schedules are state changes, not record
// removal, and stay where their feature lives. Field also gets no
// money views/mutations beyond the document totals its work shows.

export type StoredRole = "owner" | "admin" | "office" | "field";
export type ProductRole = "admin" | "office" | "field";

export function productRoleOf(stored: string | null | undefined): ProductRole {
  if (stored === "office") return "office";
  if (stored === "field") return "field";
  return "admin"; // "owner" and "admin" (and any legacy value) are Admin.
}

export const ADMIN_ACTIONS: ReadonlySet<string> = new Set([
  "listTeamMembers", "createStaffAccount", "updateStaffMember",
  // Tier 2 (0089): crew logins + per-member access switches are
  // Admin-only team management, same tier as the staff actions above.
  "createCrewLogin", "resetCrewPin", "setMemberAccess",
  "addAppUser", "updateAppUser", "deleteAppUser",
  "getAdminConsole", "updateAdminParameters", "updateSupportReport",
  "saveCrewPayRate", "updateSettings", "updateAutomationSettings", "uploadLogo",
  "uploadCompanyCover", "getBillingOverview", "getSubscription",
  "createBillingPortalSession", "startPremiumCheckout", "createCreditPackCheckout",
  "startListingBumpCheckout", "verifyPlaySubscription", "refreshPlaySubscription",
  "exportBackup", "restoreBackup", "verifyBackupRoundTrip",
  "getBackupStatus", "runAutomatedBackup", "deleteClient",
  "deleteLead", "deleteBusinessExpense", "deleteMaterialCost",
  "deletePriceBookItem", "deleteQuoteTemplate", "deleteSubcontractor",
  "deleteMileageTrip", "deleteFieldTestRecord", "loadSampleData",
  // All deletes are Admin-only (Danny 2026-10-24): the working-record
  // deletes that used to be Office doc ops live here now.
  "deleteAppointment", "deleteBidBoardItem", "deleteCrewTask",
  "deleteDocument", "deleteDocumentAttachment", "deleteInvoice",
  // Job swipe-to-delete shipped on main while this map lived on the
  // office branch (convergence): deleteJob is a record delete, and
  // getJobDeletePreview exists only to feed its confirm dialog, so
  // the whole delete flow is Admin-only end to end.
  "deleteJob", "getJobDeletePreview",
  "deleteJobFile", "deleteMarketplaceAlert", "deleteMarketplaceListing",
  "deletePayment", "deletePhoto", "deletePhotoPair",
  "deleteProgressUpdate", "deletePunchItem", "deleteQuote",
  "deleteReceipt", "deleteShareImage", "deleteTimeEntry",
  "deleteVoiceNote",
]);

export const OFFICE_ACTIONS: ReadonlySet<string> = new Set([
  "acceptQuoteVersion", "addLeadActivity", "addPayment",
  "cancelRecurringInvoice", "cancelRecurringSchedule", "completeMaintenancePlan",
  "convertLeadToJob", "createMarketplaceListing", "createPortalLink",
  "createPurchaseOrder", "createQuoteVersion", "createRecurringSchedule",
  "generateRecurringInvoice", "getCrewClockStatus",
  "getCrewDayView", "getDashboard", "getDocumentParameters",
  "getExpansionSuite", "getFieldIntelligence", "getGrowthToolkit",
  "getJobOperations", "getLeadActivities", "getListingBumpStatus",
  "getMarketplaceProProfile", "getOfficeDashboard", "getOfficeSearch",
  // Wave 1: Production Board, follow-up queue, automation recipe
  // switches (read), and budget-vs-actual. Office working surface —
  // Field never reaches these; money inside their payloads is still
  // stripped per-member by access shaping (seeMoney).
  "getProductionBoard", "setJobProductionStage", "getFollowUpQueue",
  "saveFollowUp", "completeFollowUp", "snoozeFollowUp",
  "getAutomationSettings", "getJobBudget",
  "getQuoteVersions", "getTaxExport", "invoiceMilestone",
  "listBidBoard", "listLeads", "listMaterialCosts",
  "listRecurringSchedules", "listShareImages", "listSubcontractors",
  "markMarketplaceConversationRead", "marketplaceConversation", "marketplaceConversations",
  "moveBidBoardItem", "prepareLeadQuote", "processRecurringInvoices",
  "receivePurchaseOrder", "renewCredential", "renewQuote",
  "reopenJob", "revokePortalLink", "rotatePortalLink",
  "saveBidBoardItem", "saveBusinessExpense", "saveCredential",
  "saveDocumentDesignDefault", "saveInternalNote", "saveLead",
  "saveMaintenancePlan", "saveMaterialCost", "saveMileageTrip",
  "saveMilestone", "savePriceBookItem", "saveQuoteTemplate",
  "saveSelection", "saveShareImage", "saveSlideshowVideo",
  "saveSubcontractor", "saveSupplier", "saveSupplierQuote",
  "saveWarranty", "sendMarketplaceMessage", "sendQuoteVersion",
  "sendReviewRequest", "setJobContractSum", "setJobPhotoRequirements",
  "startMarketplaceConversation", "toggleInternalNote", "toggleInvoicePaid",
  "unacceptQuote", "unlockMarketplaceContact", "updateAppearance",
  "updateInvoiceRecurrence", "updateInvoiceStatus", "updateLead",
  "updateLeadStage", "updateMarketplaceListing", "updateMilestoneStatus",
  "updatePurchaseOrderStatus", "updateQuoteAutomationStatus", "updateQuoteVersion",
  "updateSelectionLeadTime", "updateSelectionStatus", "verifyMarketplacePhone",
]);

export const PLATFORM_ACTIONS: ReadonlySet<string> = new Set([
  "adminAbuseCapSet", "adminAbuseDefaultsSet", "adminAbuseOverview",
  "adminAnalyticsCharts", "adminAnalyticsOverview", "adminAuditLog",
  "adminAuditLogSearch", "adminAutomodCapSet", "adminBlockUser",
  "adminBrandLogoUpload", "adminBrandingColorSet", "adminBroadcastHistory",
  "adminBroadcastSend", "adminCancellationStats", "adminContentHide",
  "adminContentUnhide", "adminFailedPayments", "adminFeatureFlagSet",
  "adminFeatureFlags", "adminGrowthMetrics", "adminImpersonateEnd",
  "adminImpersonateStart", "adminKeywordRuleAdd", "adminKeywordRuleDelete",
  "adminKeywordRulesList", "adminListingDecision", "adminMaintenanceSet",
  "adminMarketplaceOverview", "adminModerationQueue", "adminMyTeamRole",
  "adminPaymentsList", "adminPlansGet", "adminPlansUpdate",
  "adminPolicyVersionPublish", "adminPolicyVersionsList", "adminPromoCodeCreate",
  "adminPromoCodeDelete", "adminPromoCodesList", "adminRecentActivity",
  "adminRefund", "adminRefundPreview", "adminRevenueDashboard",
  "adminSettingsGet", "adminSettingsSet", "adminSubscriptionsList",
  "adminSupportNoteAdd", "adminSupportNotesList", "adminSupportTicketAssign",
  "adminSupportTicketPriority", "adminSupportView", "adminTeamList",
  "adminTeamRemoveRole", "adminTeamSetRole", "adminTotpDisable",
  "adminTotpRequiredSet", "adminTotpSetupStart", "adminTotpSetupVerify",
  "adminTotpStatus", "adminUnblockUser", "adminUserDelete",
  "adminUserDetail", "adminUserGrantFounder", "adminUserReportDecide",
  "adminUserReports", "adminUserRevokeFounder", "adminUserRevokeSessions",
  "adminUserSetTier", "adminUserSuspend", "adminUserUnsuspend",
  "adminUsersList", "adminVerificationList", "adminVerificationSet",
  "platformSupportInbox", "platformSupportThread", "updatePlatformSupportReport",
  "replyToSupportReport",
]);

export const ALL_ROLE_ACTIONS: ReadonlySet<string> = new Set([
  "acceptMarketplaceTerms", "addPhoto", "addPunchItem",
  "addReceipt", "addVoiceNote", "appendClientAddress",
  "checkSmsCap", "clockInCrew", "clockOutCrew",
  "completeEquipmentMaintenance", "completeJob", "convertQuoteToInvoice",
  "convertQuoteToJob", "craneRunGetChampion", "craneRunGetLeaderboard",
  "craneRunSetOptIn", "craneRunSubmitScore", "createDocumentLink",
  "createJob", "createMarketplaceBooking", "createPhotoPair",
  "deleteMyAccount", "dismissOnboardingChecklist", "duplicateInvoice",
  "duplicateQuote", "getAutomationCenter", "getClient", "getClientTimeline",
  "getDocumentLinkInfo", "getDocumentPdf", "getDocumentTimeline",
  "getFinancialSignature", "getFoundingMemberAvailability", "getJob", "getJobTimeline",
  "getMarketplaceListing", "getMarketplaceUnlockStatus", "getOnMyWayStatus",
  "getOnboardingChecklist", "getPlayBillingConfig", "getPortalLinkInfo",
  "getReferralStats", "getSettings", "getUsageLimits",
  "getVapidPublicKey", "getWeatherOutlook", "globalSearch",
  "linkDocumentToJob", "linkInvoiceToJob", "listAppointments",
  "listClients", "listDocumentAttachments", "listDocuments",
  "listInvoices", "listJobMessages", "listJobs",
  "listMarketplaceAlerts", "listMarketplaceBookings", "listMarketplaceListings",
  "listNotifications", "listPhotoPairs", "listPinnedTools",
  "listPunchItems", "listQuotes", "logAutomationSend",
  "markJobMessagesRead", "markNotificationsRead", "marketplaceGate",
  "marketplaceListingFlag", "pendingCancellationFeedback", "pinTool",
  "removePushSubscription", "renderPdfPreview", "replyToOwnSupportReport",
  "requestAccountDeletion", "revokeDocumentLink", "revokeOnMyWay",
  "saveAppointment", "saveCertificate", "saveClient",
  "saveCrewTask", "saveDailyLog", "saveDocument",
  "saveDocumentFillFields", "saveDocumentSignatureFields", "saveEquipment",
  "saveFinancialSignature", "saveIncident", "saveInvoice",
  "saveMarketplaceAlert", "saveProgressUpdate", "savePunchSignoff",
  "savePushSubscription", "saveQuote", "saveQuoteMaterials",
  "saveSafetyTalk", "saveScannedDocument", "sendJobMessage",
  "setDocumentImagesPerPage", "setEquipmentCheckout", "setJobClient",
  "setJobFileShared", "shareOnMyWay", "signDocumentWithDrawnSignature",
  "startTimer", "stopTimer", "submitCancellationFeedback",
  "submitPlatformSupportReport", "submitSupportReport", "suggestJobsByLocation",
  "togglePhotoSocial", "togglePunchItem", "unpinTool",
  "updateDocument", "updateInvoiceDesign", "updateInvoiceDocument",
  "updateJob", "updateJobInfo", "updateJobSiteLocation",
  "updateOnMyWay", "updatePhoto", "updatePhotoPair",
  "updateProfileName", "updateQuoteDesign", "updateQuoteDocument",
  "uploadDocumentAttachment", "uploadJobFile", "uploadSupportScreenshot",
  "userSupportThread", "userSupportThreads",
]);

const ROLE_RANK: Record<ProductRole, number> = { field: 0, office: 1, admin: 2 };

// Minimum product role an action requires at the company layer. Actions
// in no set default to "field" (any signed-in role) — the behavior suite
// asserts every registered action is classified in exactly one set, so
// this default only ever covers actions added after the suite's list is
// refreshed, and the suite fails until they are classified.
export function minRoleForAction(actionName: string): ProductRole {
  if (ADMIN_ACTIONS.has(actionName)) return "admin";
  if (OFFICE_ACTIONS.has(actionName)) return "office";
  return "field";
}

export function roleCan(role: ProductRole, actionName: string): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRoleForAction(actionName)];
}

export function assertRoleCan(role: ProductRole, actionName: string): void {
  if (!roleCan(role, actionName)) {
    throw new Error(
      role === "field"
        ? "Your Field role doesn't include that. Ask an admin or office teammate if it should have gone through."
        : "Your Office role doesn't include that — it's an admin action. Ask your company's admin.",
    );
  }
}

// ---------------------------------------------------------------------
// Tier 2 (0089): per-member access switches, layered ON TOP of the role
// presets above. Danny's model: roles stay coarse presets (Admin /
// Office / Field); an Admin can flip a small set of sensitive switches
// per individual staff member from the Office Team section. This is
// deliberately NOT a per-action matrix: five switches, stored sparsely
// on the member's auth_users row (access_overrides JSON — an absent key
// means "inherit the preset"), consulted inside protectActions next to
// assertRoleCan. Effective access = override ?? preset. Admins are
// never limited by switches (their preset is all-on and overrides on
// an admin row are ignored), so a company can never lock its own admin
// out of money, contacts, or payments.
//
// How each switch is enforced (see actions.ts protectActions):
// - seeMoney: money VALUES are stripped from the list/detail payloads
//   a member can already reach (listInvoices, listQuotes, listJobs,
//   getJob, listClients totals, getClient) — blanked/zeroed, never
//   sent. Pure money views Field never had stay role-gated as before.
// - seeClientContact: client phone/email blanked on listClients,
//   getClient, listJobs, getJob, listAppointments payloads.
// - sendDocuments: the send/link actions below are REFUSED outright.
// - seeAllJobs: listJobs / listAppointments are filtered to the jobs
//   the member is scheduled on (appointment crewMember = their name)
//   or has clocked time on, and getJob for any other job is refused.
// - recordPayments: the payment-recording actions below are REFUSED
//   (matters for Office members — the role map already keeps Field
//   out of them).

export type AccessSwitch = "seeMoney" | "seeClientContact" | "sendDocuments" | "seeAllJobs" | "recordPayments";
export type AccessOverrides = Partial<Record<AccessSwitch, boolean>>;
export type EffectiveAccess = Record<AccessSwitch, boolean>;

export const ACCESS_SWITCHES: readonly AccessSwitch[] = [
  "seeMoney", "seeClientContact", "sendDocuments", "seeAllJobs", "recordPayments",
];

// Role presets: the behavior a member gets with NO overrides stored.
// Field matches what the phone already showed a Field login before
// Tier 2 (document totals and client contact visible on its own work,
// every company job listed, document links sendable) EXCEPT recording
// payments, which the role map has always kept Office+. Office and
// Admin presets are all-on: an override is the only way to narrow an
// Office member, and Admins ignore overrides entirely.
export const ROLE_ACCESS_PRESETS: Record<ProductRole, EffectiveAccess> = {
  admin: { seeMoney: true, seeClientContact: true, sendDocuments: true, seeAllJobs: true, recordPayments: true },
  office: { seeMoney: true, seeClientContact: true, sendDocuments: true, seeAllJobs: true, recordPayments: true },
  field: { seeMoney: true, seeClientContact: true, sendDocuments: true, seeAllJobs: true, recordPayments: false },
};

export function parseAccessOverrides(json: string | null | undefined): AccessOverrides {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: AccessOverrides = {};
    for (const key of ACCESS_SWITCHES) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeAccessOverrides(overrides: AccessOverrides): string | null {
  const clean: AccessOverrides = {};
  for (const key of ACCESS_SWITCHES) {
    if (typeof overrides[key] === "boolean") clean[key] = overrides[key];
  }
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

export function effectiveAccess(role: ProductRole, overrides: AccessOverrides): EffectiveAccess {
  const preset = ROLE_ACCESS_PRESETS[role];
  if (role === "admin") return { ...preset };
  const out = { ...preset };
  for (const key of ACCESS_SWITCHES) {
    if (typeof overrides[key] === "boolean") out[key] = overrides[key] as boolean;
  }
  return out;
}

// Actions a member may only call with sendDocuments ON: creating/sharing
// the links a client uses to view + sign documents, and sending a quote
// version to a client. (revoke* stay available — pulling a link back is
// a safety valve, not a send.)
export const SEND_DOCUMENT_ACTIONS: ReadonlySet<string> = new Set([
  "createDocumentLink", "createPortalLink", "rotatePortalLink", "sendQuoteVersion",
]);

// Actions a member may only call with recordPayments ON.
export const RECORD_PAYMENT_ACTIONS: ReadonlySet<string> = new Set([
  "addPayment", "toggleInvoicePaid",
]);

const SWITCH_LABELS: Record<AccessSwitch, string> = {
  seeMoney: "seeing money totals",
  seeClientContact: "seeing client contact details",
  sendDocuments: "sending documents to clients",
  seeAllJobs: "seeing every company job",
  recordPayments: "recording payments",
};

// Refusal gate for the two switch-gated action families. Runs in
// protectActions AFTER assertRoleCan (a role denial keeps its own
// message); a member who passes the role map but has the switch off
// gets this switch-specific error instead.
export function assertAccessAllowed(access: EffectiveAccess, actionName: string): void {
  if (SEND_DOCUMENT_ACTIONS.has(actionName) && !access.sendDocuments) {
    throw new Error(`Your access doesn't include ${SWITCH_LABELS.sendDocuments}. Ask your company's admin to turn it on for you.`);
  }
  if (RECORD_PAYMENT_ACTIONS.has(actionName) && !access.recordPayments) {
    throw new Error(`Your access doesn't include ${SWITCH_LABELS.recordPayments}. Ask your company's admin to turn it on for you.`);
  }
}
