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

export type ViewKey = "dashboard" | "pipeline" | "clients" | "jobs";
