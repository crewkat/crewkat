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
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  companyId: number;
  role: "owner";
  tier: "free" | "premium";
  isPlatformAdmin: boolean;
  marketplaceTermsAcceptedAt: string | null;
  marketplaceTermsVersion: string | null;
  announcementBanner: string;
  createdAt: string;
}

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

export type ViewKey = "dashboard" | "pipeline" | "clients" | "jobs" | "documents" | "schedule" | "marketplace" | "money" | "settings";

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
