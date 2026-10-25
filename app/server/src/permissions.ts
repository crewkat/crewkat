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
//   management, the crew roster / admin console, backups, and the
//   destructive company-level deletes.
// - OFFICE_ACTIONS: the back-office working surface — pipeline,
//   purchasing, money views and money mutations, recurring billing,
//   client selections/milestones, marketplace management, and the
//   working-record deletes (documents, invoices, quotes, photos,
//   appointments...) that are normal doc ops. Admin + Office.
// - ALL_ROLE_ACTIONS: the field working surface — jobs, clients,
//   documents create/edit/send/sign, schedule, photos, job comms,
//   timers, safety, support. Any signed-in role.
// Field gets NO delete actions at all (the office-track1c behavior suite
// asserts every "delete*" action is outside Field's set), and no money
// views/mutations beyond the document totals its work already shows.

export type StoredRole = "owner" | "admin" | "office" | "field";
export type ProductRole = "admin" | "office" | "field";

export function productRoleOf(stored: string | null | undefined): ProductRole {
  if (stored === "office") return "office";
  if (stored === "field") return "field";
  return "admin"; // "owner" and "admin" (and any legacy value) are Admin.
}

export const ADMIN_ACTIONS: ReadonlySet<string> = new Set([
  "listTeamMembers", "createStaffAccount", "updateStaffMember",
  "addAppUser", "updateAppUser", "deleteAppUser",
  "getAdminConsole", "updateAdminParameters", "updateSupportReport",
  "saveCrewPayRate", "updateSettings", "uploadLogo",
  "uploadCompanyCover", "getBillingOverview", "getSubscription",
  "createBillingPortalSession", "startPremiumCheckout", "createCreditPackCheckout",
  "startListingBumpCheckout", "verifyPlaySubscription", "refreshPlaySubscription",
  "exportBackup", "restoreBackup", "verifyBackupRoundTrip",
  "getBackupStatus", "runAutomatedBackup", "deleteClient",
  "deleteLead", "deleteBusinessExpense", "deleteMaterialCost",
  "deletePriceBookItem", "deleteQuoteTemplate", "deleteSubcontractor",
  "deleteMileageTrip", "deleteFieldTestRecord", "loadSampleData",
]);

export const OFFICE_ACTIONS: ReadonlySet<string> = new Set([
  "acceptQuoteVersion", "addLeadActivity", "addPayment",
  "cancelRecurringInvoice", "cancelRecurringSchedule", "completeMaintenancePlan",
  "convertLeadToJob", "createMarketplaceListing", "createPortalLink",
  "createPurchaseOrder", "createQuoteVersion", "createRecurringSchedule",
  "deleteAppointment", "deleteBidBoardItem", "deleteCrewTask",
  "deleteDocument", "deleteDocumentAttachment", "deleteInvoice",
  "deleteJobFile", "deleteMarketplaceAlert", "deleteMarketplaceListing",
  "deletePayment", "deletePhoto", "deletePhotoPair",
  "deleteProgressUpdate", "deletePunchItem", "deleteQuote",
  "deleteReceipt", "deleteShareImage", "deleteTimeEntry",
  "deleteVoiceNote", "generateRecurringInvoice", "getCrewClockStatus",
  "getCrewDayView", "getDashboard", "getDocumentParameters",
  "getExpansionSuite", "getFieldIntelligence", "getGrowthToolkit",
  "getJobOperations", "getLeadActivities", "getListingBumpStatus",
  "getMarketplaceProProfile", "getOfficeDashboard", "getOfficeSearch",
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
  "duplicateQuote", "getAutomationCenter", "getClient",
  "getDocumentLinkInfo", "getDocumentPdf", "getDocumentTimeline",
  "getFinancialSignature", "getFoundingMemberAvailability", "getJob",
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
