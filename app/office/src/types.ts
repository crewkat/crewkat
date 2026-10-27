// Office-side entity types. Existing entities mirror the response schemas in
// app/server/src/actions.ts (jobSchema / clientSchema / leadSchema /
// authUserSchema, verified against the server source). The NEW office actions
// (updateLead, getOfficeDashboard, ...) are typed here from the Phase-1
// server contract handed to this client; money fields are accepted as
// string | number because the codebase stores money as text ("0", "12500")
// while dashboard aggregates are numbers.

export type LeadStage = "new" | "contacted" | "quoted" | "won" | "lost";

export const LEAD_STAGES: LeadStage[] = ["new", "contacted", "quoted", "won", "lost"];

export const STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Estimate Sent",
  won: "Won",
  lost: "Lost",
};

export type Money = string | number | null | undefined;

export interface Lead {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  serviceType: string;
  preferredContactTime: string;
  source: string;
  notes: string;
  stage: LeadStage;
  projectSize: "small" | "medium" | "large";
  engagement: "slow" | "normal" | "fast";
  score: number;
  clientId: number | null;
  quoteId: number | null;
  /** Money-as-text per migration 0087 ("0" = not yet estimated). */
  estimatedValue: Money;
  createdAt: string;
  updatedAt?: string;
}

export interface ClientAddress {
  label: string;
  address: string;
  primary: boolean;
}

export interface Client {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  addresses: ClientAddress[];
  notes: string;
  tags: string[];
  referredByClientId: number | null;
  referredByName: string | null;
  referralCount: number;
  jobCount: number;
  quoteCount: number;
  totalInvoiced: number;
  totalPaid: number;
  balanceDue: number;
  invoiceCount: number;
  paymentPercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: number;
  clientId: number | null;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  jobAddress: string;
  jobType: string;
  notes: string;
  jobDate: string;
  appointmentAt: string;
  amountDue: Money;
  contractSum: Money;
  dueDate: string;
  depositAmount: Money;
  paymentNotes: string;
  galleryPick: boolean;
  photoCount: number;
  requiredPhotoStages: string[];
  photoCompleteness: number;
  completedAt: string | null;
  completionOverrideNote: string;
  /** Wave 1: Production Board stage (migration 0090). */
  productionStage: ProductionStage;
  createdAt: string;
  updatedAt: string;
}

/* ---------- Wave 1: Production Board, follow-ups, budgets, timelines ----------
   Mirrors the Wave 1 payloads in server/src/actions.ts (boardJobSchema /
   followUpItemSchema / jobBudgetSchema / timelineEventSchema). Money stays
   string-shaped; the server blanks it for members whose seeMoney switch is
   off, so "" / null means "hidden", never zero. */

export type ProductionStage = "scheduled" | "in_progress" | "punch_list" | "complete" | "paid_in_full";

export const PRODUCTION_STAGES: ProductionStage[] = ["scheduled", "in_progress", "punch_list", "complete", "paid_in_full"];

export const PRODUCTION_STAGE_LABELS: Record<ProductionStage, string> = {
  scheduled: "Scheduled",
  in_progress: "In Progress",
  punch_list: "Punch List",
  complete: "Complete",
  paid_in_full: "Paid in Full",
};

export interface BoardJob {
  id: number;
  clientId: number | null;
  clientName: string;
  jobType: string;
  jobAddress: string;
  jobDate: string;
  productionStage: ProductionStage;
  contractSum: string;
  invoiced: string;
  paid: string;
  marginPercent: number | null;
  lowMargin: boolean;
  hasCosts: boolean;
  lastActivityAt: string;
  idleDays: number;
  stuck: boolean;
}

export interface FollowUpItem {
  id: number;
  title: string;
  body: string;
  dueDate: string;
  status: "open" | "done";
  source: "manual" | "automation";
  recipe: string;
  assigneeUserId: number | null;
  assigneeName: string;
  leadId: number | null;
  leadName: string;
  jobId: number | null;
  jobLabel: string;
  clientId: number | null;
  clientName: string;
  invoiceId: number | null;
  invoiceNumber: string;
  amount: string | null;
  overdue: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface JobBudget {
  contract: string;
  invoiced: string;
  paid: string;
  costs: string;
  materials: string;
  labor: string;
  expenses: string;
  subcontractors: string;
  hasCosts: boolean;
  marginPercent: number | null;
  lowMargin: boolean;
}

export interface TimelineEvent {
  id: string;
  kind: string;
  title: string;
  body: string;
  at: string;
}

export interface AutomationRecipe {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  companyId: number;
  /** Stored role: "owner" is the account that signed up; staff logins are "admin" | "office" | "field". */
  role: "owner" | "admin" | "office" | "field";
  /** Product role (Track 1c): owner and admin are both "admin". Drives cosmetic UI gating only — the server enforces. */
  teamRole: TeamRole;
  tier: "free" | "premium";
  isPlatformAdmin: boolean;
  marketplaceTermsAcceptedAt: string | null;
  marketplaceTermsVersion: string | null;
  announcementBanner: string;
  createdAt: string;
}

/* ---------- Team & roles (Track 1c) ----------
   Mirrors teamMemberSchema in server/src/actions.ts. Roles are enforced
   server-side in the action layer (server/src/permissions.ts); Office
   only shows/hides surfaces. */

export type TeamRole = "admin" | "office" | "field";
export type StaffRole = TeamRole;

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  admin: "Admin",
  office: "Office",
  field: "Field",
};

export const TEAM_ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  admin: "Everything — billing, company settings, and managing this team. Only Admins can delete records.",
  office: "Back office — pipeline, schedule, documents, and money. Creates and edits freely, but only Admins can delete records. No billing changes, no team management.",
  field: "Phone-first — their jobs, appointments, photos, and documents. No money views, no billing, and no deletes — only Admins can delete records.",
};

export interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: "owner" | "admin" | "office" | "field";
  teamRole: TeamRole;
  active: boolean;
  isSelf: boolean;
  createdAt: string;
  /* Tier 2: "crew_pin" members sign in with the company crew code +
     a PIN (no email — the email field holds a synthetic placeholder
     the UI never shows). overrides are the admin-set switches (absent
     key = role preset); access is the server-resolved effective set. */
  credentialType: "email" | "crew_pin";
  overrides: AccessOverrides;
  access: EffectiveAccess;
}

/* ---------- Access switches (Tier 2) ----------
   Mirrors server/src/permissions.ts. Roles are presets; an admin can
   flip these five switches per member. The server enforces them in
   the action layer — this is only the panel that sets them. */

export type AccessSwitch = "seeMoney" | "seeClientContact" | "sendDocuments" | "seeAllJobs" | "recordPayments";
export type AccessOverrides = Partial<Record<AccessSwitch, boolean>>;
export type EffectiveAccess = Record<AccessSwitch, boolean>;

export const ACCESS_SWITCH_DEFS: Array<{ key: AccessSwitch; label: string; hint: string }> = [
  { key: "seeMoney", label: "See money totals", hint: "Invoice, estimate, and job amounts on the documents and lists they can open." },
  { key: "seeClientContact", label: "See client contact info", hint: "Client phone numbers and email addresses." },
  { key: "sendDocuments", label: "Send documents to clients", hint: "Create and share document and portal links, and send estimate versions." },
  { key: "seeAllJobs", label: "See all company jobs", hint: "Off = only jobs they're scheduled on (named crew on an appointment) or have clocked time on." },
  { key: "recordPayments", label: "Record payments", hint: "Add payments and mark invoices paid." },
];

/** Role presets — the switch values a member gets with no overrides. */
export const ROLE_ACCESS_PRESETS: Record<TeamRole, EffectiveAccess> = {
  admin: { seeMoney: true, seeClientContact: true, sendDocuments: true, seeAllJobs: true, recordPayments: true },
  office: { seeMoney: true, seeClientContact: true, sendDocuments: true, seeAllJobs: true, recordPayments: true },
  field: { seeMoney: true, seeClientContact: true, sendDocuments: true, seeAllJobs: true, recordPayments: false },
};

export interface LeadActivity {
  id: number;
  leadId: number;
  kind: string; // note | call | email | text (server may add more)
  body: string;
  createdAt: string;
  authorName?: string;
}

/** One row of getOfficeDashboard().leadsByStage — normalized client-side. */
export interface StageBucket {
  stage: LeadStage;
  count: number;
  value: number;
}

export interface OfficeDashboardData {
  pipelineValue: number;
  openLeads: number;
  leadsByStage: StageBucket[];
  activeJobs: number;
  invoicedMonth: number;
  collectedMonth: number;
  outstanding: number;
  overdueInvoices: Record<string, unknown>[];
  followUps: Record<string, unknown>[];
  recentActivity: Record<string, unknown>[];
}

/** getOfficeSearch returns compact shapes (verified against the server). */
export interface OfficeSearchResults {
  leads: { id: number; name: string; phone: string; stage: LeadStage }[];
  clients: { id: number; name: string; phone: string; email: string }[];
  jobs: { id: number; clientName: string; jobAddress: string; jobType: string }[];
}

export type ViewKey = "dashboard" | "pipeline" | "followups" | "clients" | "jobs" | "documents" | "schedule" | "marketplace" | "money" | "settings" | "team";

/* ---------- Schedule (Track 1b) ----------
   Mirrors the server appointmentSchema — the same records the phone
   Operations / Dispatch screens read and write. */

export type AppointmentStatus = "scheduled" | "confirmed" | "on_my_way" | "arrived" | "completed" | "cancelled";

export const APPOINTMENT_STATUSES: AppointmentStatus[] = ["scheduled", "confirmed", "on_my_way", "arrived", "completed", "cancelled"];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  on_my_way: "On the way",
  arrived: "Arrived",
  completed: "Completed",
  cancelled: "Cancelled",
};

export interface Appointment {
  id: number;
  jobId: number | null;
  clientId: number | null;
  clientName: string;
  clientPhone: string;
  startsAt: string;
  notes: string;
  exteriorWork: boolean;
  status: AppointmentStatus;
  crewMember: string;
  etaMinutes: number | null;
  hasShareLink: boolean;
}

/* ---------- Job photos (Track 1b) ----------
   Mirrors photoSchema / photoPairSchema from getJob + listPhotoPairs. */

export type PhotoStage = "before" | "during" | "after";

export const PHOTO_STAGE_LABELS: Record<PhotoStage, string> = {
  before: "Before",
  during: "During",
  after: "After",
};

export interface JobPhoto {
  id: number;
  jobId: number;
  stage: PhotoStage;
  caption: string;
  filename: string;
  contentType: string;
  url: string;
  galleryPick: boolean;
  excludeFromSocial: boolean;
  annotatedFromId: number | null;
  capturedAt: string;
  createdAt: string;
}

export interface PhotoPairPhoto {
  id: number;
  stage: PhotoStage;
  caption: string;
  url: string;
}

export interface PhotoPair {
  id: number;
  jobId: number;
  label: string;
  before: PhotoPairPhoto;
  after: PhotoPairPhoto;
  createdAt: string;
}

/* ---------- Money & billing (Track 1b) ----------
   Mirrors getBillingOverview — the account's own plan + billing payment
   history. Amounts arrive as integer cents from the server. */

export interface BillingPayment {
  id: string;
  source: "subscription" | "promotion";
  date: string;
  description: string;
  amountCents: number | null;
  currency: string;
  status: string;
  receiptUrl: string | null;
}

export interface BillingOverview {
  plan: {
    tier: "free" | "premium";
    status: string;
    provider: "stripe" | "play" | "none";
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
  payments: BillingPayment[];
  manage: { kind: "stripe" | "play" | "none" };
}

/* ---------- Marketplace (Track 1b, read-only) ----------
   Mirrors marketplaceListingSchema / marketplaceInboxRowSchema /
   marketplaceMessageSchema / marketplaceBookingSchema. */

export type MarketplaceCategory =
  | "kitchens" | "bathrooms" | "plumbing" | "electrical" | "hvac" | "roofing"
  | "tile_flooring" | "painting" | "concrete" | "landscaping" | "handyman"
  | "equipment" | "materials" | "other";

export const MARKETPLACE_CATEGORY_LABELS: Record<MarketplaceCategory, string> = {
  kitchens: "Kitchens",
  bathrooms: "Bathrooms",
  plumbing: "Plumbing",
  electrical: "Electrical",
  hvac: "HVAC",
  roofing: "Roofing",
  tile_flooring: "Tile & flooring",
  painting: "Painting",
  concrete: "Concrete",
  landscaping: "Landscaping",
  handyman: "Handyman",
  equipment: "Equipment",
  materials: "Materials",
  other: "Other",
};

export interface MarketplaceListing {
  id: number;
  title: string;
  category: MarketplaceCategory;
  intent: "need" | "offer";
  neededBy: string;
  employmentType: "full_time" | "part_time" | "temporary";
  payUnit: "hourly" | "salary";
  priceKind: "amount" | "free" | "contact";
  price: string;
  originalPrice: string;
  description: string;
  serviceArea: string;
  zipCode: string;
  companyName: string;
  companyPhone: string;
  contactUnlocked: boolean;
  verified: boolean;
  bookable: boolean;
  dailyRate: string;
  promoted: boolean;
  featured: boolean;
  featuredUntil: string | null;
  isMine: boolean;
  moderationStatus: "active" | "auto_rejected" | "pending_review" | "removed";
  photos: { id: number; url: string; filename: string }[];
  justListed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceConversationRow {
  id: number;
  listingId: number;
  listingTitle: string;
  otherPartyName: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  isInquiry: boolean;
}

export interface MarketplaceMessage {
  id: number;
  conversationId: number;
  body: string;
  imageUrl: string | null;
  imageFilename: string;
  outgoing: boolean;
  senderName: string;
  createdAt: string;
}

export interface MarketplaceBooking {
  id: number;
  listingId: number;
  startDate: string;
  endDate: string;
  note: string;
  status: "requested" | "confirmed" | "declined";
  createdAt: string;
}

/* ---------- Documents (Track 1a) ----------
   Shapes mirror the server response schemas in server/src/actions.ts
   (quoteSchema / invoiceSchema / documentSchema) exactly — Office reads
   and writes the SAME records the phone app does. */

export type DocKind = "quote" | "invoice" | "contract" | "change_order";

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  quote: "Estimate",
  invoice: "Invoice",
  contract: "Contract",
  change_order: "Change order",
};

export interface LineItem {
  description: string;
  amount: string;
  name?: string;
  quantity?: number;
  discount?: string;
  unit?: "none" | "days" | "hours";
  id?: string;
  optional?: boolean;
}

export interface MaterialItem {
  name: string;
  qty: string;
  unit: string;
  checked: boolean;
}

export interface AcceptedOptions {
  items: { key: string; name: string; description: string; amount: string; quantity: number; discount: string; unit: string }[];
  optionsTotal: string;
  totalWithOptions: string;
  acceptedAt: string;
}

export interface Quote {
  id: number;
  clientId: number | null;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  jobAddress: string;
  shippingAddress: string;
  jobType: string;
  lineItems: LineItem[];
  optionSelection: { selectedKeys: string[]; accepted: AcceptedOptions | null };
  materials: MaterialItem[];
  subtotal: string;
  discountType: "percent" | "fixed";
  discountValue: string;
  taxType: "percent" | "fixed";
  taxValue: string;
  total: string;
  footnote: string;
  theme: string;
  font: string;
  accentColor: string;
  customizeJson: string;
  showTaxLine: boolean;
  showDiscountLine: boolean;
  showPaidLine: boolean;
  showPaymentTerms: boolean;
  showFooterNotes: boolean;
  showLogo: boolean;
  showCompanyInfo: boolean;
  expiryDate: string;
  sentAt: string;
  automationStatus: "awaiting" | "won" | "lost";
  lostReason: string | null;
  lostNote: string;
  jobId: number | null;
  seriesId: number;
  parentQuoteId: number | null;
  versionNumber: number;
  superseded: boolean;
  accepted: boolean;
  convertedToInvoiceId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoicePayment {
  id: number;
  invoiceId: number;
  amount: string;
  paymentDate: string;
  method: string;
  note: string;
  createdAt: string;
}

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

export interface Invoice {
  id: number;
  invoiceNumber: string;
  quoteId: number | null;
  jobId: number | null;
  clientId: number | null;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  jobAddress: string;
  shippingAddress: string;
  jobType: string;
  lineItems: LineItem[];
  subtotal: string;
  discountType: "percent" | "fixed";
  discountValue: string;
  taxType: "percent" | "fixed";
  taxValue: string;
  total: string;
  footnote: string;
  theme: string;
  font: string;
  accentColor: string;
  customizeJson: string;
  showTaxLine: boolean;
  showDiscountLine: boolean;
  showPaidLine: boolean;
  showPaymentTerms: boolean;
  showFooterNotes: boolean;
  showLogo: boolean;
  showCompanyInfo: boolean;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  recurringFrequency: "none" | "daily" | "weekly" | "monthly" | "quarterly";
  nextDueDate: string;
  seriesId: number;
  parentInvoiceId: number | null;
  recurringEndDate: string;
  recurringCancelled: boolean;
  paidToDate: string;
  balanceRemaining: string;
  lateFeeAccrued: string;
  totalWithLateFee: string;
  payments: InvoicePayment[];
  createdAt: string;
  updatedAt: string;
}

export interface SignaturePlacement {
  page: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface SignatureFields {
  clientSignature?: SignaturePlacement;
  clientDate?: SignaturePlacement;
  contractorSignature?: SignaturePlacement;
  contractorDate?: SignaturePlacement;
}

export type SignatureFieldKey = keyof SignatureFields;

export interface FillField {
  id: string;
  kind: "text" | "initials" | "checkbox";
  role: "client" | "contractor";
  label: string;
  required: boolean;
  page: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  value?: string;
  checked?: boolean;
}

/** A contract or change order (server `documents` table row shape). */
export interface SignableDocument {
  id: number;
  jobId: number;
  kind: "contract" | "change_order";
  title: string;
  bodyText: string;
  originalFilename: string;
  originalUrl: string | null;
  description: string;
  amount: string;
  signerName: string;
  signatureUrl: string;
  signedAt: string;
  clientSignerName: string;
  clientSignedAt: string | null;
  clientSignatureHash: string;
  signedPdfUrl: string | null;
  coNumber: number | null;
  displayTitle: string;
  contractSumBefore: string;
  newContractSum: string;
  signatureFields: SignatureFields;
  fillFields: FillField[];
  fillValues: Record<string, string | boolean>;
  linkView: { viewCount: number; firstViewedAt: string | null } | null;
}

export interface DocumentLinkInfo {
  hint: string;
  shortCode: string | null;
  expiresAt: string;
  expired: boolean;
  viewCount: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  createdAt: string;
}

export interface PortalLinkInfo {
  hint: string;
  shortCode: string | null;
  expiresAt: string | null;
  expired: boolean;
  viewCount: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  createdAt: string;
}

/** Settings fields the document editors seed new documents from. */
export interface DocSettings {
  companyName: string;
  accentColor: string;
  defaultQuoteTheme: string;
  defaultDocumentFont: string;
  defaultShowTaxLine: boolean;
  defaultShowDiscountLine: boolean;
  defaultShowPaidLine: boolean;
  defaultShowPaymentTerms: boolean;
  defaultShowFooterNotes: boolean;
  defaultShowLogo: boolean;
  defaultShowCompanyInfo: boolean;
  defaultCustomizeJson: string;
  defaultFootnote: string;
}
