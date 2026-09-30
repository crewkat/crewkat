import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const clients = sqliteTable("clients", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  address: text("address").notNull().default(""),
  notes: text("notes").notNull().default(""),
  referredByClientId: integer("referred_by_client_id"),
  tags: text("tags").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const jobs = sqliteTable("jobs", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone").notNull().default(""),
  clientEmail: text("client_email").notNull().default(""),
  jobAddress: text("job_address").notNull(),
  jobType: text("job_type").notNull(),
  notes: text("notes").notNull().default(""),
  jobDate: text("job_date").notNull(),
  appointmentAt: text("appointment_at").notNull().default(""),
  amountDue: text("amount_due").notNull().default(""),
  dueDate: text("due_date").notNull().default(""),
  depositAmount: text("deposit_amount").notNull().default(""),
  paymentNotes: text("payment_notes").notNull().default(""),
  galleryPick: integer("gallery_pick", { mode: "boolean" }).notNull().default(false),
  maintenancePlanId: integer("maintenance_plan_id"),
  maintenanceDueDate: text("maintenance_due_date"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  requiredPhotoStages: text("required_photo_stages").notNull().default("before,during,after"),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  completionOverrideNote: text("completion_override_note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("jobs_maintenance_cycle_unique").on(table.maintenancePlanId, table.maintenanceDueDate),
]);

export const photos = sqliteTable("photos", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  stage: text("stage", { enum: ["before", "during", "after"] }).notNull(),
  caption: text("caption").notNull().default(""),
  blobKey: text("blob_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  galleryPick: integer("gallery_pick", { mode: "boolean" }).notNull().default(false),
  annotatedFromId: integer("annotated_from_id"),
  excludeFromSocial: integer("exclude_from_social", { mode: "boolean" }).notNull().default(false),
  capturedAt: integer("captured_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const documents = sqliteTable("documents", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["contract", "change_order"] }).notNull(),
  title: text("title").notNull(),
  bodyText: text("body_text").notNull().default(""),
  originalBlobKey: text("original_blob_key"),
  originalFilename: text("original_filename").notNull().default(""),
  description: text("description").notNull().default(""),
  amount: text("amount").notNull().default(""),
  signerName: text("signer_name").notNull(),
  signatureBlobKey: text("signature_blob_key").notNull(),
  clientSignerName: text("client_signer_name").notNull().default(""),
  clientSignatureBlobKey: text("client_signature_blob_key"),
  clientSignedAt: integer("client_signed_at", { mode: "timestamp_ms" }),
  clientSignedPdfBlobKey: text("client_signed_pdf_blob_key"),
  clientSignatureHash: text("client_signature_hash").notNull().default(""),
  clientSignedUserAgent: text("client_signed_user_agent").notNull().default(""),
  signedAt: integer("signed_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const quotes = sqliteTable("quotes", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone").notNull().default(""),
  clientEmail: text("client_email").notNull().default(""),
  jobAddress: text("job_address").notNull().default(""),
  shippingAddress: text("shipping_address").notNull().default(""),
  jobType: text("job_type").notNull().default(""),
  lineItemsJson: text("line_items_json").notNull(),
  subtotal: text("subtotal").notNull().default("0"),
  discountType: text("discount_type", { enum: ["percent", "fixed"] }).notNull().default("percent"),
  discountValue: text("discount_value").notNull().default("0"),
  taxType: text("tax_type", { enum: ["percent", "fixed"] }).notNull().default("percent"),
  taxValue: text("tax_value").notNull().default("0"),
  total: text("total").notNull(),
  footnote: text("footnote").notNull().default(""),
  expiryDate: text("expiry_date").notNull().default(""),
  sentAt: text("sent_at").notNull().default(""),
  automationStatus: text("automation_status", { enum: ["awaiting", "won", "lost"] }).notNull().default("awaiting"),
  lostReason: text("lost_reason", { enum: ["price", "timing", "competitor", "no_response", "other"] }),
  lostNote: text("lost_note").notNull().default(""),
  theme: text("theme", { enum: ["classic", "modern", "bold", "minimal"] }).notNull().default("classic"),
  font: text("font", { enum: ["helvetica", "times", "courier", "palatino"] }).notNull().default("helvetica"),
  accentColor: text("accent_color").notNull().default("#1f5a4a"),
  showTaxLine: integer("show_tax_line", { mode: "boolean" }).notNull().default(true),
  showDiscountLine: integer("show_discount_line", { mode: "boolean" }).notNull().default(true),
  showPaidLine: integer("show_paid_line", { mode: "boolean" }).notNull().default(true),
  showPaymentTerms: integer("show_payment_terms", { mode: "boolean" }).notNull().default(true),
  showFooterNotes: integer("show_footer_notes", { mode: "boolean" }).notNull().default(true),
  showLogo: integer("show_logo", { mode: "boolean" }).notNull().default(true),
  showCompanyInfo: integer("show_company_info", { mode: "boolean" }).notNull().default(true),
  customizeJson: text("customize_json").notNull().default("{}"),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "set null" }),
  seriesId: integer("series_id"),
  parentQuoteId: integer("parent_quote_id"),
  versionNumber: integer("version_number").notNull().default(1),
  superseded: integer("superseded", { mode: "boolean" }).notNull().default(false),
  estimateNudgeSentAt: integer("estimate_nudge_sent_at", { mode: "timestamp_ms" }),
  accepted: integer("accepted", { mode: "boolean" }).notNull().default(false),
  convertedToInvoiceId: integer("converted_to_invoice_id"), // FK to invoices.id in SQL migration (plain here to avoid a quotes<->invoices circular type inference)
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const invoices = sqliteTable("invoices", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceNumber: text("invoice_number").notNull().default(""),
  quoteId: integer("quote_id").references(() => quotes.id, { onDelete: "set null" }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "set null" }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone").notNull().default(""),
  clientEmail: text("client_email").notNull().default(""),
  jobAddress: text("job_address").notNull().default(""),
  shippingAddress: text("shipping_address").notNull().default(""),
  jobType: text("job_type").notNull().default(""),
  lineItemsJson: text("line_items_json").notNull(),
  subtotal: text("subtotal").notNull().default("0"),
  discountType: text("discount_type", { enum: ["percent", "fixed"] }).notNull().default("percent"),
  discountValue: text("discount_value").notNull().default("0"),
  taxType: text("tax_type", { enum: ["percent", "fixed"] }).notNull().default("percent"),
  taxValue: text("tax_value").notNull().default("0"),
  total: text("total").notNull(),
  footnote: text("footnote").notNull().default(""),
  issueDate: text("issue_date").notNull().default(""),
  dueDate: text("due_date").notNull().default(""),
  status: text("status", { enum: ["draft", "sent", "paid", "overdue"] }).notNull().default("draft"),
  recurringFrequency: text("recurring_frequency", { enum: ["none", "daily", "weekly", "monthly", "quarterly"] }).notNull().default("none"),
  nextDueDate: text("next_due_date").notNull().default(""),
  seriesId: integer("series_id"),
  parentInvoiceId: integer("parent_invoice_id"),
  recurringEndDate: text("recurring_end_date").notNull().default(""),
  recurringCancelled: integer("recurring_cancelled", { mode: "boolean" }).notNull().default(false),
  theme: text("theme", { enum: ["classic", "modern", "bold", "minimal"] }).notNull().default("classic"),
  font: text("font", { enum: ["helvetica", "times", "courier", "palatino"] }).notNull().default("helvetica"),
  accentColor: text("accent_color").notNull().default("#1f5a4a"),
  showTaxLine: integer("show_tax_line", { mode: "boolean" }).notNull().default(true),
  showDiscountLine: integer("show_discount_line", { mode: "boolean" }).notNull().default(true),
  showPaidLine: integer("show_paid_line", { mode: "boolean" }).notNull().default(true),
  showPaymentTerms: integer("show_payment_terms", { mode: "boolean" }).notNull().default(true),
  showFooterNotes: integer("show_footer_notes", { mode: "boolean" }).notNull().default(true),
  showLogo: integer("show_logo", { mode: "boolean" }).notNull().default(true),
  showCompanyInfo: integer("show_company_info", { mode: "boolean" }).notNull().default(true),
  customizeJson: text("customize_json").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const financialDocumentSignatures = sqliteTable("financial_document_signatures", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentKind: text("document_kind", { enum: ["invoice", "quote"] }).notNull(),
  documentId: integer("document_id").notNull(),
  signerName: text("signer_name").notNull(),
  signatureBlobKey: text("signature_blob_key").notNull(),
  signedAt: integer("signed_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("financial_document_signature_unique").on(table.documentKind, table.documentId),
]);

export const punchItems = sqliteTable("punch_items", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const punchSignoffs = sqliteTable("punch_signoffs", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  customerName: text("customer_name").notNull(),
  customerSignatureBlobKey: text("customer_signature_blob_key").notNull(),
  contractorName: text("contractor_name").notNull(),
  contractorSignatureBlobKey: text("contractor_signature_blob_key").notNull(),
  signedAt: integer("signed_at", { mode: "timestamp_ms" }).notNull(),
});

export const progressUpdates = sqliteTable("progress_updates", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  dayNumber: integer("day_number").notNull(),
  note: text("note").notNull().default(""),
  photoIdsJson: text("photo_ids_json").notNull().default("[]"),
  status: text("status", { enum: ["draft", "sent"] }).notNull().default("sent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const settings = sqliteTable("settings", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey(),
  companyName: text("company_name").notNull(),
  licenseNumber: text("license_number").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  website: text("website").notNull().default(""),
  address: text("address").notNull().default(""),
  profileDescription: text("profile_description").notNull().default(""),
  serviceArea: text("service_area").notNull().default(""),
  facebookUrl: text("facebook_url").notNull().default(""),
  instagramUrl: text("instagram_url").notNull().default(""),
  youtubeUrl: text("youtube_url").notNull().default(""),
  reviewUrl: text("review_url").notNull().default(""),
  paymentInstructions: text("payment_instructions").notNull().default(""),
  quoteFollowUpDays: integer("quote_follow_up_days").notNull().default(3),
  offersFreeEstimates: integer("offers_free_estimates", { mode: "boolean" }).notNull().default(true),
  socialWatermark: integer("social_watermark", { mode: "boolean" }).notNull().default(true),
  language: text("language", { enum: ["en", "es"] }).notNull().default("en"),
  accentColor: text("accent_color").notNull().default("#1f5a4a"),
  // App appearance follows the account, not the device (0055): the installed
  // app, the web app, and any other device always render the same theme.
  themeMode: text("theme_mode", { enum: ["light", "dark", "system"] }).notNull().default("system"),
  uiAccent: text("ui_accent", { enum: ["orange", "blue", "green", "purple", "red"] }).notNull().default("orange"),
  defaultQuoteTheme: text("default_quote_theme", { enum: ["classic", "modern", "bold", "minimal"] }).notNull().default("classic"),
  defaultDocumentFont: text("default_document_font", { enum: ["helvetica", "times", "courier", "palatino"] }).notNull().default("helvetica"),
  defaultShowTaxLine: integer("default_show_tax_line", { mode: "boolean" }).notNull().default(true),
  defaultShowDiscountLine: integer("default_show_discount_line", { mode: "boolean" }).notNull().default(true),
  defaultShowPaidLine: integer("default_show_paid_line", { mode: "boolean" }).notNull().default(true),
  defaultShowPaymentTerms: integer("default_show_payment_terms", { mode: "boolean" }).notNull().default(true),
  defaultShowFooterNotes: integer("default_show_footer_notes", { mode: "boolean" }).notNull().default(true),
  defaultShowLogo: integer("default_show_logo", { mode: "boolean" }).notNull().default(true),
  defaultShowCompanyInfo: integer("default_show_company_info", { mode: "boolean" }).notNull().default(true),
  defaultCustomizeJson: text("default_customize_json").notNull().default("{}"),
  defaultFootnote: text("default_footnote").notNull().default(""),
  warrantyTerms: text("warranty_terms").notNull().default(""),
  hourlyCostRate: text("hourly_cost_rate").notNull().default("0"),
  lateFeeType: text("late_fee_type", { enum: ["flat", "percent"] }).notNull().default("percent"),
  lateFeeValue: text("late_fee_value").notNull().default("0"),
  lateFeeGraceDays: integer("late_fee_grace_days").notNull().default(0),
  costAlertPercent: integer("cost_alert_percent").notNull().default(80),
  paymentRemindersEnabled: integer("payment_reminders_enabled", { mode: "boolean" }).notNull().default(true),
  onlineSignatureEnabled: integer("online_signature_enabled", { mode: "boolean" }).notNull().default(true),
  overdueInvoiceRemindersEnabled: integer("overdue_invoice_reminders_enabled", { mode: "boolean" }).notNull().default(true),
  overdueReminderDays: integer("overdue_reminder_days").notNull().default(3),
  invoiceGroupBy: text("invoice_group_by", { enum: ["creation_date", "due_date", "client"] }).notNull().default("creation_date"),
  addShippingAddress: integer("add_shipping_address", { mode: "boolean" }).notNull().default(false),
  addJobSiteAddress: integer("add_job_site_address", { mode: "boolean" }).notNull().default(true),
  convertToQuote: integer("convert_to_quote", { mode: "boolean" }).notNull().default(false),
  notificationsEnabled: integer("notifications_enabled", { mode: "boolean" }).notNull().default(true),  notifyNewMessage: integer("notify_new_message", { mode: "boolean" }).notNull().default(true),
  notifyDocSigned: integer("notify_doc_signed", { mode: "boolean" }).notNull().default(true),
  notifyInvoiceViewed: integer("notify_invoice_viewed", { mode: "boolean" }).notNull().default(true),
  notifyEstimateViewed: integer("notify_estimate_viewed", { mode: "boolean" }).notNull().default(true),
  reviewRequestsEnabled: integer("review_requests_enabled", { mode: "boolean" }).notNull().default(true),
  reviewRequestDelayDays: integer("review_request_delay_days").notNull().default(3),
  weeklyProgressEnabled: integer("weekly_progress_enabled", { mode: "boolean" }).notNull().default(true),
  simpleMode: integer("simple_mode", { mode: "boolean" }).notNull().default(true),
  logoBlobKey: text("logo_blob_key"),
  coverBlobKey: text("cover_blob_key"),
  listingBonus: integer("listing_bonus").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const timeEntries = sqliteTable("time_entries", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  crewMember: text("crew_member").notNull().default(""),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  clockInLatitude: text("clock_in_latitude"),
  clockInLongitude: text("clock_in_longitude"),
  clockOutLatitude: text("clock_out_latitude"),
  clockOutLongitude: text("clock_out_longitude"),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const receipts = sqliteTable("receipts", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  vendor: text("vendor").notNull().default(""),
  amount: text("amount").notNull().default("0"),
  purchaseDate: text("purchase_date").notNull().default(""),
  supplierId: integer("supplier_id"),
  note: text("note").notNull().default(""),
  blobKey: text("blob_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const crewTasks = sqliteTable("crew_tasks", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const voiceNotes = sqliteTable("voice_notes", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  blobKey: text("blob_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const payments = sqliteTable("payments", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  amount: text("amount").notNull(),
  paymentDate: text("payment_date").notNull(),
  method: text("method").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const completionCertificates = sqliteTable("completion_certificates", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  completionDate: text("completion_date").notNull(),
  warrantyTerms: text("warranty_terms").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const appointments = sqliteTable("appointments", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "set null" }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone").notNull().default(""),
  startsAt: text("starts_at").notNull(),
  notes: text("notes").notNull().default(""),
  exteriorWork: integer("exterior_work", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["scheduled", "confirmed", "on_my_way", "arrived", "completed", "cancelled"] }).notNull().default("scheduled"),
  crewMember: text("crew_member").notNull().default(""),
  etaMinutes: integer("eta_minutes"),
  shareTokenHash: text("share_token_hash").unique(),
  shareTokenHint: text("share_token_hint").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const leads = sqliteTable("leads", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  source: text("source").notNull().default(""),
  email: text("email").notNull().default(""),
  address: text("address").notNull().default(""),
  serviceType: text("service_type").notNull().default(""),
  preferredContactTime: text("preferred_contact_time").notNull().default(""),
  notes: text("notes").notNull().default(""),
  stage: text("stage", { enum: ["new", "contacted", "quoted", "won", "lost"] }).notNull().default("new"),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  quoteId: integer("quote_id").references(() => quotes.id, { onDelete: "set null" }),
  projectSize: text("project_size", { enum: ["small", "medium", "large"] }).notNull().default("medium"),
  engagement: text("engagement", { enum: ["slow", "normal", "fast"] }).notNull().default("normal"),
  score: integer("score").notNull().default(50),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const selections = sqliteTable("selections", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  item: text("item").notNull(),
  vendor: text("vendor").notNull().default(""),
  photoBlobKey: text("photo_blob_key"),
  photoFilename: text("photo_filename").notNull().default(""),
  photoContentType: text("photo_content_type").notNull().default(""),
  approvalStatus: text("approval_status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  leadTimeDays: integer("lead_time_days").notNull().default(0),
  estimatedCost: text("estimated_cost").notNull().default("0"),
  actualCost: text("actual_cost").notNull().default("0"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const dailyLogs = sqliteTable("daily_logs", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  logDate: text("log_date").notNull(),
  crew: text("crew").notNull().default(""),
  hours: text("hours").notNull().default("0"),
  photoIdsJson: text("photo_ids_json").notNull().default("[]"),
  notes: text("notes").notNull().default(""),
  blockers: text("blockers").notNull().default(""),
  clientSummary: text("client_summary").notNull().default(""),
  sharedWithClient: integer("shared_with_client", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const internalNotes = sqliteTable("internal_notes", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  reminderDate: text("reminder_date").notNull().default(""),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const paymentMilestones = sqliteTable("payment_milestones", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  amount: text("amount").notNull().default("0"),
  percentage: text("percentage").notNull().default(""),
  dueDate: text("due_date").notNull().default(""),
  status: text("status", { enum: ["pending", "paid"] }).notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const automationLogs = sqliteTable("automation_logs", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["quote_chase", "payment", "review", "reengagement", "quote_expiry", "crew", "weekly_progress"] }).notNull(),
  entityId: integer("entity_id").notNull(),
  stage: text("stage").notNull().default(""),
  channel: text("channel", { enum: ["sms", "email"] }).notNull().default("sms"),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
});

export const supportReports = sqliteTable("support_reports", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["support", "problem", "question", "general", "feature"] }).notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  language: text("language", { enum: ["en", "es"] }).notNull().default("en"),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  isUnread: integer("is_unread", { mode: "boolean" }).notNull().default(true),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const priceBookItems = sqliteTable("price_book_items", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(), description: text("description").notNull().default(""), unitPrice: text("unit_price").notNull().default("0"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const quoteTemplates = sqliteTable("quote_templates", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(), lineItemsJson: text("line_items_json").notNull(), isStarter: integer("is_starter", { mode: "boolean" }).notNull().default(false), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const mileageTrips = sqliteTable("mileage_trips", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), tripDate: text("trip_date").notNull(), fromLocation: text("from_location").notNull().default(""), toLocation: text("to_location").notNull().default(""), miles: text("miles").notNull().default("0"), jobId: integer("job_id").references(() => jobs.id, { onDelete: "set null" }), purpose: text("purpose").notNull().default(""), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const businessExpenses = sqliteTable("business_expenses", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), expenseDate: text("expense_date").notNull(), vendor: text("vendor").notNull().default(""), amount: text("amount").notNull().default("0"), category: text("category").notNull().default("other"), jobId: integer("job_id").references(() => jobs.id, { onDelete: "set null" }), supplierId: integer("supplier_id"), note: text("note").notNull().default(""), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const subcontractors = sqliteTable("subcontractors", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }), name: text("name").notNull(), trade: text("trade").notNull().default(""), phone: text("phone").notNull().default(""), agreedAmount: text("agreed_amount").notNull().default("0"), paidToDate: text("paid_to_date").notNull().default("0"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const shareImages = sqliteTable("share_images", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }), beforePhotoId: integer("before_photo_id").notNull(), afterPhotoId: integer("after_photo_id").notNull(), branded: integer("branded", { mode: "boolean" }).notNull().default(true), blobKey: text("blob_key").notNull(), filename: text("filename").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const warranties = sqliteTable("warranties", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }), clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }), terms: text("terms").notNull().default(""), startDate: text("start_date").notNull(), durationMonths: integer("duration_months").notNull().default(12), expiryDate: text("expiry_date").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const slideshowVideos = sqliteTable("slideshow_videos", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }), caption: text("caption").notNull().default(""), branded: integer("branded", { mode: "boolean" }).notNull().default(true), blobKey: text("blob_key").notNull(), filename: text("filename").notNull(), contentType: text("content_type").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const scannedDocuments = sqliteTable("scanned_documents", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }), expenseId: integer("expense_id").references(() => businessExpenses.id, { onDelete: "set null" }), title: text("title").notNull(), kind: text("kind", { enum: ["receipt", "contract", "other"] }).notNull().default("receipt"), blobKey: text("blob_key").notNull(), filename: text("filename").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const suppliers = sqliteTable("suppliers", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(), category: text("category").notNull().default(""), phone: text("phone").notNull().default(""), email: text("email").notNull().default(""), notes: text("notes").notNull().default(""), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const maintenancePlans = sqliteTable("maintenance_plans", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }), clientName: text("client_name").notNull(), clientPhone: text("client_phone").notNull().default(""), title: text("title").notNull(), tasks: text("tasks").notNull().default(""), startDate: text("start_date").notNull(), intervalMonths: integer("interval_months").notNull().default(12), nextDueDate: text("next_due_date").notNull(), lastJobId: integer("last_job_id").references(() => jobs.id, { onDelete: "set null" }), active: integer("active", { mode: "boolean" }).notNull().default(true), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const appUsers = sqliteTable("app_users", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role", { enum: ["owner", "crew"] }).notNull().default("crew"),
  isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const adminParameters = sqliteTable("admin_parameters", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey(),
  paymentDay1: integer("payment_day_1").notNull().default(3),
  paymentDay2: integer("payment_day_2").notNull().default(14),
  paymentDay3: integer("payment_day_3").notNull().default(30),
  reviewDelayDays: integer("review_delay_days").notNull().default(1),
  reengagementMonth1: integer("reengagement_month_1").notNull().default(6),
  reengagementMonth2: integer("reengagement_month_2").notNull().default(12),
  quoteExpiryWarningDays: integer("quote_expiry_warning_days").notNull().default(3),
  materialLeadTimeDays: integer("material_lead_time_days").notNull().default(14),
  defaultTaxRate: text("default_tax_rate").notNull().default("0"),
  hourlyLaborCost: text("hourly_labor_cost").notNull().default("0"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const portalTokens = sqliteTable("portal_tokens", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  tokenHint: text("token_hint").notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  viewCount: integer("view_count").notNull().default(0),
  firstViewedAt: integer("first_viewed_at", { mode: "timestamp_ms" }),
  lastViewedAt: integer("last_viewed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const portalLinkEvents = sqliteTable("portal_link_events", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  linkId: integer("link_id").notNull().references(() => portalTokens.id, { onDelete: "cascade" }),
  eventType: text("event_type", { enum: ["view", "approve_selection", "reject_selection", "sign"] }).notNull(),
  userAgent: text("user_agent").notNull().default(""),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const rateLimitEvents = sqliteTable("rate_limit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const documentLinks = sqliteTable("document_links", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentKind: text("document_kind", { enum: ["invoice", "quote", "contract", "change_order"] }).notNull(),
  documentId: integer("document_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenHint: text("token_hint").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  viewCount: integer("view_count").notNull().default(0),
  firstViewedAt: integer("first_viewed_at", { mode: "timestamp_ms" }),
  lastViewedAt: integer("last_viewed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const documentLinkEvents = sqliteTable("document_link_events", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  linkId: integer("link_id").notNull().references(() => documentLinks.id, { onDelete: "cascade" }),
  eventType: text("event_type", { enum: ["view", "sign"] }).notNull(),
  userAgent: text("user_agent").notNull().default(""),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const materialCostItems = sqliteTable("material_cost_items", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  nameEn: text("name_en").notNull(),
  nameEs: text("name_es").notNull(),
  unitEn: text("unit_en").notNull(),
  unitEs: text("unit_es").notNull(),
  price: text("price").notNull().default("0.00"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const supplierQuotes = sqliteTable("supplier_quotes", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), supplierId: integer("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }), jobId: integer("job_id").references(() => jobs.id, { onDelete: "set null" }), title: text("title").notNull(), lineItemsJson: text("line_items_json").notNull(), total: text("total").notNull().default("0.00"), selected: integer("selected", { mode: "boolean" }).notNull().default(false), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const purchaseOrders = sqliteTable("purchase_orders", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), supplierId: integer("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }), jobId: integer("job_id").references(() => jobs.id, { onDelete: "set null" }), supplierQuoteId: integer("supplier_quote_id").references(() => supplierQuotes.id, { onDelete: "set null" }), number: text("number").notNull(), status: text("status", { enum: ["draft", "sent", "partially_received", "received", "cancelled"] }).notNull().default("draft"), lineItemsJson: text("line_items_json").notNull(), total: text("total").notNull().default("0.00"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const equipment = sqliteTable("equipment", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(), category: text("category").notNull().default(""), purchaseDate: text("purchase_date").notNull().default(""), cost: text("cost").notNull().default("0.00"), serialNumber: text("serial_number").notNull().default(""), assignedTo: text("assigned_to").notNull().default("shop"), photoBlobKey: text("photo_blob_key"), maintenanceTask: text("maintenance_task").notNull().default(""), maintenanceEveryDays: integer("maintenance_every_days").notNull().default(90), nextMaintenanceDate: text("next_maintenance_date").notNull().default(""), checkedOutAt: integer("checked_out_at", { mode: "timestamp_ms" }), returnedAt: integer("returned_at", { mode: "timestamp_ms" }), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const safetyTalks = sqliteTable("safety_talks", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }), topicKey: text("topic_key").notNull(), talkDate: text("talk_date").notNull(), checklistJson: text("checklist_json").notNull().default("[]"), acknowledgementsJson: text("acknowledgements_json").notNull().default("[]"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const incidents = sqliteTable("incidents", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }), incidentDate: text("incident_date").notNull(), description: text("description").notNull(), severity: text("severity", { enum: ["near_miss", "minor", "serious"] }).notNull(), correctiveAction: text("corrective_action").notNull().default(""), photoBlobKey: text("photo_blob_key"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const credentials = sqliteTable("credentials", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), ownerType: text("owner_type", { enum: ["business", "subcontractor"] }).notNull(), subcontractorId: integer("subcontractor_id").references(() => subcontractors.id, { onDelete: "cascade" }), kind: text("kind").notNull(), identifier: text("identifier").notNull().default(""), expiresOn: text("expires_on").notNull(), renewedAt: integer("renewed_at", { mode: "timestamp_ms" }), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const crewPayRates = sqliteTable("crew_pay_rates", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), crewMember: text("crew_member").notNull().unique(), hourlyRate: text("hourly_rate").notNull().default("0.00"), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
export const completionOverrides = sqliteTable("completion_overrides", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }), jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }), missingStages: text("missing_stages").notNull(), note: text("note").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const marketplaceListings = sqliteTable("marketplace_listings", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  category: text("category", { enum: ["kitchens", "bathrooms", "plumbing", "electrical", "hvac", "roofing", "tile_flooring", "painting", "concrete", "landscaping", "handyman", "equipment", "materials", "other"] }).notNull(),
  listingType: text("listing_type", { enum: ["job", "project"] }).notNull().default("project"),
  employmentType: text("employment_type", { enum: ["full_time", "part_time", "temporary"] }).notNull().default("full_time"),
  payUnit: text("pay_unit", { enum: ["hourly", "salary"] }).notNull().default("hourly"),
  priceKind: text("price_kind", { enum: ["amount", "free", "contact"] }).notNull().default("contact"),
  price: text("price").notNull().default(""),
  originalPrice: text("original_price").notNull().default(""),
  description: text("description").notNull().default(""),
  serviceArea: text("service_area").notNull(),
  companyName: text("company_name").notNull(),
  companyPhone: text("company_phone").notNull().default(""),
  bookable: integer("bookable", { mode: "boolean" }).notNull().default(false),
  dailyRate: text("daily_rate").notNull().default(""),
  promoted: integer("promoted", { mode: "boolean" }).notNull().default(false),
  featuredUntil: integer("featured_until", { mode: "timestamp_ms" }),
  moderationStatus: text("moderation_status").notNull().default("active"),
  moderationReason: text("moderation_reason").notNull().default(""),
  flagCount: integer("flag_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const marketplaceListingPhotos = sqliteTable("marketplace_listing_photos", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingId: integer("listing_id").notNull().references(() => marketplaceListings.id, { onDelete: "cascade" }),
  blobKey: text("blob_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const marketplaceFlags = sqliteTable("marketplace_flags", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingId: integer("listing_id").notNull().references(() => marketplaceListings.id, { onDelete: "cascade" }),
  reporterCompanyId: integer("reporter_company_id").notNull().default(1),
  reporterUserId: integer("reporter_user_id").notNull(),
  reason: text("reason", { enum: ["spam", "explicit", "illegal", "scam", "misleading", "other"] }).notNull().default("other"),
  details: text("details").notNull().default(""),
  status: text("status", { enum: ["open", "reviewed_ok", "reviewed_removed"] }).notNull().default("open"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const marketplaceMessages = sqliteTable("marketplace_messages", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingId: integer("listing_id").notNull().references(() => marketplaceListings.id, { onDelete: "cascade" }),
  conversationId: integer("conversation_id").references(() => marketplaceConversations.id, { onDelete: "cascade" }),
  body: text("body").notNull().default(""),
  imageBlobKey: text("image_blob_key"),
  imageFilename: text("image_filename").notNull().default(""),
  imageContentType: text("image_content_type").notNull().default(""),
  sender: text("sender", { enum: ["me", "other"] }).notNull().default("me"),
  senderCompanyId: integer("sender_company_id"),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// One private thread per (listing, inquirer company). No company_id column on
// purpose: conversations are cross-company by design, so the workspace db
// proxy leaves this table unscoped and every action enforces participation
// in code. Read state is per-participant and never exposed to the other side.
export const marketplaceConversations = sqliteTable("marketplace_conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingId: integer("listing_id").notNull().references(() => marketplaceListings.id, { onDelete: "cascade" }),
  ownerCompanyId: integer("owner_company_id").notNull(),
  inquirerCompanyId: integer("inquirer_company_id").notNull(),
  inquirerReadAt: integer("inquirer_read_at", { mode: "timestamp_ms" }),
  ownerReadAt: integer("owner_read_at", { mode: "timestamp_ms" }),
  lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const marketplaceBookingRequests = sqliteTable("marketplace_booking_requests", {  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingId: integer("listing_id").notNull().references(() => marketplaceListings.id, { onDelete: "cascade" }),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  note: text("note").notNull().default(""),
  status: text("status", { enum: ["requested", "confirmed", "declined"] }).notNull().default("requested"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const marketplaceRequests = sqliteTable("marketplace_requests", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  category: text("category", { enum: ["kitchens", "bathrooms", "plumbing", "electrical", "hvac", "roofing", "tile_flooring", "painting", "concrete", "landscaping", "handyman", "equipment", "materials", "other"] }).notNull(),
  listingType: text("listing_type", { enum: ["job", "project"] }).notNull().default("project"),
  description: text("description").notNull().default(""),
  serviceArea: text("service_area").notNull(),
  neededBy: text("needed_by").notNull().default(""),
  companyName: text("company_name").notNull(),
  companyPhone: text("company_phone").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const authUsers = sqliteTable("auth_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull().default(210000),
  emailVerifiedAt: integer("email_verified_at", { mode: "timestamp_ms" }),
  companyId: integer("company_id").notNull().default(1),
  role: text("role", { enum: ["owner"] }).notNull().default("owner"),
  tier: text("tier", { enum: ["free", "premium"] }).notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Phase 4: Google Play Billing (TWA). Set when premium was granted via a
  // verified Play purchase; null for Stripe/manual/founder premium.
  playPurchaseToken: text("play_purchase_token"),
  playOrderId: text("play_order_id"),
  subscriptionStatus: text("subscription_status").notNull().default("inactive"),
  subscriptionCurrentPeriodEnd: integer("subscription_current_period_end", { mode: "timestamp_ms" }),
  cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
  dataClaimedAt: integer("data_claimed_at", { mode: "timestamp_ms" }),
  isPlatformAdmin: integer("is_platform_admin", { mode: "boolean" }).notNull().default(false),
  suspendedAt: integer("suspended_at", { mode: "timestamp_ms" }),
  marketplaceTermsAcceptedAt: integer("marketplace_terms_accepted_at", { mode: "timestamp_ms" }),
  marketplaceTermsVersion: text("marketplace_terms_version"),
  referralCode: text("referral_code"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// Phase 4: Google Play Billing — one row per verified Play purchase. The
// purchase_token unique index makes verification idempotent: re-verifying the
// same token never creates a second row or a second grant.
export const playBillingPurchases = sqliteTable("play_billing_purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  purchaseToken: text("purchase_token").notNull(),
  orderId: text("order_id"),
  sku: text("sku").notNull(),
  verifiedAt: integer("verified_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// Chunk D: referral loop — one row per successful referred signup.
export const referralEvents = sqliteTable("referral_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  referrerUserId: integer("referrer_user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  referredUserId: integer("referred_user_id").notNull().unique().references(() => authUsers.id, { onDelete: "cascade" }),
  rewarded: integer("rewarded", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// Build 4: marketplace paid bump — one-time Stripe purchase for 7-day featured placement.
export const listingBumpPurchases = sqliteTable("listing_bump_purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().default(1),
  listingId: integer("listing_id").notNull().references(() => marketplaceListings.id, { onDelete: "cascade" }),
  stripeSessionId: text("stripe_session_id").notNull().default(""),
  purchasedAt: integer("purchased_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

// Phase 1: first-run activation checklist — one row per auth user; the steps
// themselves are computed live from real data (clients, quotes, invoices,
// payments), so only dismissal/completion state is persisted.
export const onboardingChecklist = sqliteTable("onboarding_checklist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull().default(1),
  userId: integer("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" }),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("onboarding_checklist_user_unique").on(table.userId),
]);

// Chunk D: marketplace saved-search alerts (per user).
export const marketplaceAlerts = sqliteTable("marketplace_alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  keyword: text("keyword").notNull(),
  category: text("category"),
  serviceArea: text("service_area"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// Chunk D: in-app notifications (alert matches, etc.).
export const userNotifications = sqliteTable("user_notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("alert_match"),
  titleEn: text("title_en").notNull().default(""),
  titleEs: text("title_es").notNull().default(""),
  link: text("link").notNull().default(""),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// Chunk D: web push subscriptions (VAPID).
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const authSessions = sqliteTable("auth_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  // 'legacy' = pre-cookie 30-day sliding body token (dual-mode transition).
  // 'proof' = 15-minute in-memory session proof. 'refresh' = HttpOnly cookie token.
  tokenType: text("token_type", { enum: ["legacy", "proof", "refresh"] }).notNull().default("legacy"),
  familyId: text("family_id"),
  replacedBy: text("replaced_by"),
  absoluteExpiresAt: integer("absolute_expires_at", { mode: "timestamp_ms" }),
  userAgent: text("user_agent").notNull().default(""),
  ipHash: text("ip_hash").notNull().default(""),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const authTokens = sqliteTable("auth_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  purpose: text("purpose", { enum: ["verify_email", "reset_password"] }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const authLoginAttempts = sqliteTable("auth_login_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  attemptedAt: integer("attempted_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const stripeWebhookEvents = sqliteTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const backupRuns = sqliteTable("backup_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["daily-db", "weekly-full", "manual", "monthly-verify"] }).notNull(),
  status: text("status", { enum: ["running", "ok", "failed"] }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  dbBytes: integer("db_bytes"),
  blobBytes: integer("blob_bytes"),
  totalBytes: integer("total_bytes"),
  filePath: text("file_path"),
  offsiteSent: integer("offsite_sent", { mode: "boolean" }).notNull().default(false),
  integrityOk: integer("integrity_ok", { mode: "boolean" }),
  error: text("error"),
  notes: text("notes"),
}, (table) => [
  index("idx_backup_runs_started").on(table.startedAt),
]);

export const platformSettings = sqliteTable("platform_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const adminAuditLog = sqliteTable("admin_audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  adminUserId: integer("admin_user_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull().default(""),
  targetId: text("target_id").notNull().default(""),
  details: text("details").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const userHomePins = sqliteTable("user_home_pins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  toolId: text("tool_id").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("user_home_pins_user_tool_unique").on(table.userId, table.toolId),
  index("user_home_pins_user_idx").on(table.userId, table.position),
]);

export const recurringInvoiceSchedules = sqliteTable("recurring_invoice_schedules", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  frequency: text("frequency", { enum: ["weekly", "monthly"] }).notNull(),
  nextRunDate: text("next_run_date").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  lastGeneratedInvoiceId: integer("last_generated_invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("recurring_invoice_schedules_due_idx").on(table.active, table.nextRunDate),
]);


export const jobMessages = sqliteTable("job_messages", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  sender: text("sender", { enum: ["contractor", "client", "system"] }).notNull().default("contractor"),
  body: text("body").notNull().default(""),
  imageBlobKey: text("image_blob_key"),
  imageFilename: text("image_filename").notNull().default(""),
  imageContentType: text("image_content_type").notNull().default(""),
  voiceBlobKey: text("voice_blob_key"),
  voiceFilename: text("voice_filename").notNull().default(""),
  voiceContentType: text("voice_content_type").notNull().default(""),
  voiceDurationSeconds: integer("voice_duration_seconds").notNull().default(0),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("job_messages_job_idx").on(table.jobId),
]);

export const bidBoardItems = sqliteTable("bid_board_items", {
  companyId: integer("company_id").notNull().default(1),
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  listingId: integer("listing_id").references(() => marketplaceListings.id, { onDelete: "set null" }),
  requestId: integer("request_id").references(() => marketplaceRequests.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  stage: text("stage", { enum: ["interested", "estimating", "submitted", "won", "lost"] }).notNull().default("interested"),
  dueDate: text("due_date").notNull().default(""),
  remindAt: integer("remind_at", { mode: "timestamp_ms" }),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("bid_board_items_user_idx").on(table.userId),
]);

// Mission Control analytics: subscription lifecycle events. One row per
// meaningful billing transition, written by the Stripe webhook handler and
// Play Billing verification. Powers the platform admin analytics dashboard.
export const subscriptionEvents = sqliteTable("subscription_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  eventType: text("event_type", { enum: ["subscribed", "cancelled", "expired", "renewed", "founding_claimed", "play_subscribed"] }).notNull(),
  plan: text("plan", { enum: ["monthly", "annual", "lifetime", "play_monthly"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("subscription_events_user_idx").on(table.userId),
  index("subscription_events_created_idx").on(table.createdAt),
  index("subscription_events_type_idx").on(table.eventType),
]);

// Exit survey: why a customer left Premium. Shown once as a gentle prompt
// after a subscription ends; feeds the churn breakdown in Mission Control.
export const cancellationFeedback = sqliteTable("cancellation_feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  reason: text("reason", { enum: ["too_expensive", "not_using_enough", "missing_features", "switched_tool", "business_closed", "temporary_break", "other"] }).notNull(),
  details: text("details").notNull().default(""),
  plan: text("plan", { enum: ["monthly", "annual", "lifetime", "play_monthly"] }).notNull().default("monthly"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("cancellation_feedback_user_idx").on(table.userId),
  index("cancellation_feedback_created_idx").on(table.createdAt),
]);

// Platform support inbox: reports sent from Settings -> Customer support land
// here server-side so Danny sees them in the platform admin console. The local
// per-device `supportReports` table above stays for the contractor's own crew
// support flow and is untouched by this feature.
export const platformSupportReports = sqliteTable("platform_support_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  userName: text("user_name").notNull(),
  userEmail: text("user_email").notNull(),
  kind: text("kind", { enum: ["support", "problem", "question", "general", "feature"] }).notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  language: text("language", { enum: ["en", "es"] }).notNull().default("en"),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  isUnread: integer("is_unread", { mode: "boolean" }).notNull().default(true),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("platform_support_reports_user_idx").on(table.userId),
  index("platform_support_reports_created_idx").on(table.createdAt),
  index("platform_support_reports_status_idx").on(table.status),
]);

// Two-way replies on a support report. `sender` is who wrote it; there are
// deliberately no read receipts — only Danny's unread badge on the inbox.
export const platformSupportReplies = sqliteTable("platform_support_replies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportId: integer("report_id").notNull().references(() => platformSupportReports.id, { onDelete: "cascade" }),
  sender: text("sender", { enum: ["user", "admin"] }).notNull(),
  message: text("message").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("platform_support_replies_report_idx").on(table.reportId),
  index("platform_support_replies_created_idx").on(table.createdAt),
]);
