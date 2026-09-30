import { defineAction, z, type ActionDefinition, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, desc, eq, gte, inArray, isNull, like, lt, lte, ne, or, sql } from "drizzle-orm";
import { gzipSync, gunzipSync, strFromU8, strToU8 } from "fflate";
import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import * as schema from "./schema";
import { authCodeClientResult } from "./auth-email";
import { privileged } from "@space/privileged";
import { playBillingActions } from "./play-billing";
import { scanListingText } from "./moderation";
import { MARKETPLACE_TERMS_VERSION } from "./marketplace-terms";
import { getVapidPublicKey, sendPushToCompany, sendPushToUser } from "./push";

const stageSchema = z.enum(["before", "during", "after"]);
const languageSchema = z.enum(["en", "es"]);
const quoteThemeSchema = z.enum(["classic", "modern", "bold", "minimal"]);
const documentFontSchema = z.enum(["helvetica", "times", "courier", "palatino"]);
const adjustmentTypeSchema = z.enum(["percent", "fixed"]);
const invoiceStatusSchema = z.enum(["draft", "sent", "paid", "overdue"]);
const documentKindSchema = z.enum(["invoice", "quote", "contract", "change_order"]);
const clientSchema = z.object({ id: z.number(), name: z.string(), phone: z.string(), email: z.string(), address: z.string(), notes: z.string(), tags: z.array(z.string()), referredByClientId: z.number().nullable(), referredByName: z.string().nullable(), referralCount: z.number(), jobCount: z.number(), quoteCount: z.number(), totalInvoiced: z.number(), totalPaid: z.number(), balanceDue: z.number(), invoiceCount: z.number(), paymentPercent: z.number(), createdAt: z.string(), updatedAt: z.string() });
const jobSchema = z.object({
  id: z.number(), clientId: z.number().nullable(), clientName: z.string(), clientPhone: z.string(), clientEmail: z.string(), jobAddress: z.string(), jobType: z.string(), notes: z.string(), jobDate: z.string(), appointmentAt: z.string(), amountDue: z.string(), dueDate: z.string(), depositAmount: z.string(), paymentNotes: z.string(), galleryPick: z.boolean(), photoCount: z.number(), requiredPhotoStages: z.array(stageSchema), photoCompleteness: z.number(), completedAt: z.string().nullable(), completionOverrideNote: z.string(), createdAt: z.string(), updatedAt: z.string(),
});
const photoSchema = z.object({
  id: z.number(), jobId: z.number(), stage: stageSchema, caption: z.string(), filename: z.string(), contentType: z.string(), url: z.string(), galleryPick: z.boolean(), excludeFromSocial: z.boolean(), annotatedFromId: z.number().nullable(), capturedAt: z.string(), createdAt: z.string(),
});
const documentSchema = z.object({
  id: z.number(), jobId: z.number(), kind: z.enum(["contract", "change_order"]), title: z.string(), bodyText: z.string(), originalFilename: z.string(), originalUrl: z.string().nullable(), description: z.string(), amount: z.string(), signerName: z.string(), signatureUrl: z.string(), signedAt: z.string(), clientSignerName: z.string(), clientSignedAt: z.string().nullable(), clientSignatureHash: z.string(), signedPdfUrl: z.string().nullable(),
});
const punchItemSchema = z.object({ id: z.number(), jobId: z.number(), text: z.string(), completed: z.boolean() });
const punchSignoffSchema = z.object({ id: z.number(), jobId: z.number(), customerName: z.string(), customerSignatureUrl: z.string(), contractorName: z.string(), contractorSignatureUrl: z.string(), signedAt: z.string() });
const progressSchema = z.object({ id: z.number(), jobId: z.number(), dayNumber: z.number(), note: z.string(), photoIds: z.array(z.number()), status: z.enum(["draft", "sent"]), createdAt: z.string(), updatedAt: z.string() });
const quoteItemSchema = z.object({ description: z.string().trim().min(1).max(300), amount: z.string().trim().min(1).max(80) });
const invoiceItemSchema = quoteItemSchema.extend({
  name: z.string().trim().max(160).default(""),
  quantity: z.number().min(0).max(100000).default(1),
  discount: z.string().trim().max(80).default("0"),
  unit: z.enum(["none", "days", "hours"]).default("none"),
});
const documentVisibilitySchema = z.object({ showTaxLine: z.boolean(), showDiscountLine: z.boolean(), showPaidLine: z.boolean(), showPaymentTerms: z.boolean(), showFooterNotes: z.boolean(), showLogo: z.boolean(), showCompanyInfo: z.boolean() });
const customizeJsonSchema = z.string().max(5_000_000).refine((value) => { try { JSON.parse(value); return true; } catch { return false; } }, "Invalid document customization.");
const financialFieldsSchema = z.object({ subtotal: z.string(), discountType: adjustmentTypeSchema, discountValue: z.string(), taxType: adjustmentTypeSchema, taxValue: z.string(), total: z.string(), footnote: z.string(), theme: quoteThemeSchema, font: documentFontSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), customizeJson: customizeJsonSchema }).extend(documentVisibilitySchema.shape);
const quoteSchema = z.object({ id: z.number(), clientId: z.number().nullable(), clientName: z.string(), clientPhone: z.string(), clientEmail: z.string(), jobAddress: z.string(), shippingAddress: z.string(), jobType: z.string(), lineItems: z.array(quoteItemSchema), expiryDate: z.string(), sentAt: z.string(), automationStatus: z.enum(["awaiting", "won", "lost"]), lostReason: z.enum(["price", "timing", "competitor", "no_response", "other"]).nullable(), lostNote: z.string(), jobId: z.number().nullable(), seriesId: z.number(), parentQuoteId: z.number().nullable(), versionNumber: z.number(), superseded: z.boolean(), accepted: z.boolean(), convertedToInvoiceId: z.number().nullable(), createdAt: z.string(), updatedAt: z.string() }).extend(financialFieldsSchema.shape);
const paymentSchema = z.object({ id: z.number(), invoiceId: z.number(), amount: z.string(), paymentDate: z.string(), method: z.string(), note: z.string(), createdAt: z.string() });
const invoiceSchema = z.object({ id: z.number(), invoiceNumber: z.string(), quoteId: z.number().nullable(), jobId: z.number().nullable(), clientId: z.number().nullable(), clientName: z.string(), clientPhone: z.string(), clientEmail: z.string(), jobAddress: z.string(), shippingAddress: z.string(), jobType: z.string(), lineItems: z.array(invoiceItemSchema), issueDate: z.string(), dueDate: z.string(), status: invoiceStatusSchema, recurringFrequency: z.enum(["none", "daily", "weekly", "monthly", "quarterly"]), nextDueDate: z.string(), seriesId: z.number(), parentInvoiceId: z.number().nullable(), recurringEndDate: z.string(), recurringCancelled: z.boolean(), paidToDate: z.string(), balanceRemaining: z.string(), lateFeeAccrued: z.string(), totalWithLateFee: z.string(), payments: z.array(paymentSchema), createdAt: z.string(), updatedAt: z.string() }).extend(financialFieldsSchema.shape);
const timeEntrySchema = z.object({ id: z.number(), jobId: z.number(), crewMember: z.string(), startedAt: z.string(), endedAt: z.string().nullable(), note: z.string(), durationSeconds: z.number() });
const receiptSchema = z.object({ id: z.number(), jobId: z.number(), vendor: z.string(), amount: z.string(), purchaseDate: z.string(), note: z.string(), filename: z.string(), url: z.string(), createdAt: z.string() });
const crewTaskSchema = z.object({ id: z.number(), jobId: z.number(), text: z.string(), completed: z.boolean(), createdAt: z.string(), updatedAt: z.string() });
const voiceNoteSchema = z.object({ id: z.number(), jobId: z.number(), title: z.string(), url: z.string(), durationSeconds: z.number(), createdAt: z.string() });
const certificateSchema = z.object({ id: z.number(), jobId: z.number(), completionDate: z.string(), warrantyTerms: z.string(), createdAt: z.string(), updatedAt: z.string() });
const settingsInputSchema = z.object({ companyName: z.string().trim().max(180), licenseNumber: z.string().trim().max(80), phone: z.string().trim().max(80), email: z.string().trim().email().max(200).or(z.literal("")), website: z.string().trim().max(300), address: z.string().trim().max(500), profileDescription: z.string().trim().max(3000), serviceArea: z.string().trim().max(500), facebookUrl: z.string().trim().max(600), instagramUrl: z.string().trim().max(600), youtubeUrl: z.string().trim().max(600), reviewUrl: z.string().trim().max(600), paymentInstructions: z.string().trim().max(1500), quoteFollowUpDays: z.number().int().min(1).max(60), offersFreeEstimates: z.boolean(), socialWatermark: z.boolean(), language: languageSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), themeMode: z.enum(["light", "dark", "system"]), uiAccent: z.enum(["orange", "blue", "green", "purple", "red"]), defaultQuoteTheme: quoteThemeSchema, defaultDocumentFont: documentFontSchema, defaultShowTaxLine: z.boolean(), defaultShowDiscountLine: z.boolean(), defaultShowPaidLine: z.boolean(), defaultShowPaymentTerms: z.boolean(), defaultShowFooterNotes: z.boolean(), defaultShowLogo: z.boolean(), defaultShowCompanyInfo: z.boolean(), defaultCustomizeJson: customizeJsonSchema, defaultFootnote: z.string().trim().max(3000), warrantyTerms: z.string().trim().max(5000), hourlyCostRate: z.string().trim().max(80), lateFeeType: z.enum(["flat","percent"]), lateFeeValue: z.string().trim().max(80), lateFeeGraceDays: z.number().int().min(0).max(365), costAlertPercent: z.number().int().min(50).max(100), paymentRemindersEnabled: z.boolean(), onlineSignatureEnabled: z.boolean(), overdueInvoiceRemindersEnabled: z.boolean(), overdueReminderDays: z.number().int().min(1).max(90), invoiceGroupBy: z.enum(["creation_date", "due_date", "client"]), addShippingAddress: z.boolean(), addJobSiteAddress: z.boolean(), convertToQuote: z.boolean(), notificationsEnabled: z.boolean(), notifyNewMessage: z.boolean().default(true), notifyDocSigned: z.boolean().default(true), notifyInvoiceViewed: z.boolean().default(true), notifyEstimateViewed: z.boolean().default(true), reviewRequestsEnabled: z.boolean().default(true), reviewRequestDelayDays: z.number().int().min(0).max(30).default(3), weeklyProgressEnabled: z.boolean().default(true), simpleMode: z.boolean() });
const settingsSchema = settingsInputSchema.extend({ logoUrl: z.string().nullable(), coverUrl: z.string().nullable() });
const clientInputSchema = z.object({ name: z.string().trim().min(1).max(160), phone: z.string().trim().max(80), email: z.string().trim().email().max(200).or(z.literal("")), address: z.string().trim().max(240), notes: z.string().trim().max(2000), tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]), referredByClientId: z.number().int().positive().nullable().default(null) });

// Client tags are stored as a JSON array in clients.tags. Normalizes to
// unique, trimmed tags (case-insensitive dedupe, first-seen casing kept).
function normalizeClientTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim();
    if (!tag || tag.length > 40) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 12) break;
  }
  return out;
}
function parseClientTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return normalizeClientTags(raw);
  if (typeof raw !== "string" || !raw) return [];
  try { return normalizeClientTags(JSON.parse(raw)); } catch { return []; }
}
function clientBalanceDue(totalInvoiced: number, totalPaid: number): number {
  return Math.max(0, Math.round((totalInvoiced - totalPaid) * 100) / 100);
}
const leadStageSchema = z.enum(["new", "contacted", "quoted", "won", "lost"]);
const appointmentSchema = z.object({ id: z.number(), jobId: z.number().nullable(), clientId: z.number().nullable(), clientName: z.string(), clientPhone: z.string(), startsAt: z.string(), notes: z.string(), exteriorWork: z.boolean(), status: z.enum(["scheduled", "confirmed", "on_my_way", "arrived", "completed", "cancelled"]), crewMember: z.string(), etaMinutes: z.number().nullable(), hasShareLink: z.boolean() });
const priceBookSchema = z.object({ id: z.number(), name: z.string(), description: z.string(), unitPrice: z.string(), createdAt: z.string() });
const templateSchema = z.object({ id: z.number(), name: z.string(), lineItems: z.array(quoteItemSchema), isStarter: z.boolean(), createdAt: z.string() });
const mileageSchema = z.object({ id: z.number(), tripDate: z.string(), fromLocation: z.string(), toLocation: z.string(), miles: z.string(), jobId: z.number().nullable(), jobName: z.string().nullable(), purpose: z.string(), createdAt: z.string() });
const expenseSchema = z.object({ id: z.number(), expenseDate: z.string(), vendor: z.string(), amount: z.string(), category: z.string(), jobId: z.number().nullable(), jobName: z.string().nullable(), supplierId: z.number().nullable(), note: z.string(), createdAt: z.string() });
const subcontractorSchema = z.object({ id: z.number(), jobId: z.number(), name: z.string(), trade: z.string(), phone: z.string(), agreedAmount: z.string(), paidToDate: z.string(), balance: z.number(), createdAt: z.string() });
const shareImageSchema = z.object({ id: z.number(), jobId: z.number(), beforePhotoId: z.number(), afterPhotoId: z.number(), branded: z.boolean(), filename: z.string(), url: z.string(), createdAt: z.string() });
const leadSchema = z.object({ id: z.number(), name: z.string(), phone: z.string(), email: z.string(), address: z.string(), serviceType: z.string(), preferredContactTime: z.string(), source: z.string(), notes: z.string(), stage: leadStageSchema, projectSize: z.enum(["small","medium","large"]), engagement: z.enum(["slow","normal","fast"]), score: z.number(), clientId: z.number().nullable(), quoteId: z.number().nullable(), createdAt: z.string() });
const selectionSchema = z.object({ id: z.number(), jobId: z.number(), category: z.string(), item: z.string(), vendor: z.string(), photoUrl: z.string().nullable(), approvalStatus: z.enum(["pending", "approved", "rejected"]), leadTimeDays: z.number(), estimatedCost: z.string(), actualCost: z.string(), createdAt: z.string() });
const dailyLogSchema = z.object({ id: z.number(), jobId: z.number(), logDate: z.string(), crew: z.string(), hours: z.string(), photoIds: z.array(z.number()), notes: z.string(), blockers: z.string(), clientSummary: z.string(), sharedWithClient: z.boolean(), createdAt: z.string() });
const internalNoteSchema = z.object({ id: z.number(), jobId: z.number().nullable(), clientId: z.number().nullable(), note: z.string(), reminderDate: z.string(), completed: z.boolean(), createdAt: z.string() });
const milestoneSchema = z.object({ id: z.number(), jobId: z.number(), invoiceId: z.number().nullable(), label: z.string(), amount: z.string(), percentage: z.string(), dueDate: z.string(), status: z.enum(["pending", "paid"]), createdAt: z.string() });
const marketplaceCategorySchema = z.enum(["kitchens", "bathrooms", "plumbing", "electrical", "hvac", "roofing", "tile_flooring", "painting", "concrete", "landscaping", "handyman", "equipment", "materials", "other"]);
const moderationStatusSchema = z.enum(["active", "auto_rejected", "pending_review", "removed"]);
type ModerationStatus = z.infer<typeof moderationStatusSchema>;
const marketplacePhotoSchema = z.object({ id: z.number(), url: z.string(), filename: z.string() });
const marketplaceListingSchema = z.object({ id: z.number(), title: z.string(), category: marketplaceCategorySchema, listingType: z.enum(["job", "project"]), employmentType: z.enum(["full_time", "part_time", "temporary"]), payUnit: z.enum(["hourly", "salary"]), priceKind: z.enum(["amount", "free", "contact"]), price: z.string(), originalPrice: z.string(), description: z.string(), serviceArea: z.string(), companyName: z.string(), companyPhone: z.string(), bookable: z.boolean(), dailyRate: z.string(), promoted: z.boolean(), featured: z.boolean(), featuredUntil: z.string().nullable(), isMine: z.boolean(), moderationStatus: moderationStatusSchema, photos: z.array(marketplacePhotoSchema), justListed: z.boolean(), createdAt: z.string(), updatedAt: z.string() });
const marketplaceRequestSchema = z.object({ id: z.number(), title: z.string(), category: marketplaceCategorySchema, listingType: z.enum(["job", "project"]), description: z.string(), serviceArea: z.string(), neededBy: z.string(), companyName: z.string(), companyPhone: z.string(), createdAt: z.string(), updatedAt: z.string() });
const marketplaceMessageSchema = z.object({ id: z.number(), conversationId: z.number(), body: z.string(), imageUrl: z.string().nullable(), imageFilename: z.string(), outgoing: z.boolean(), senderName: z.string(), createdAt: z.string() });
const marketplaceInboxRowSchema = z.object({ id: z.number(), listingId: z.number(), listingTitle: z.string(), otherPartyName: z.string(), lastMessage: z.string(), lastMessageAt: z.string(), unreadCount: z.number(), isInquiry: z.boolean().default(false) });
const marketplaceBookingSchema = z.object({ id: z.number(), listingId: z.number(), startDate: z.string(), endDate: z.string(), note: z.string(), status: z.enum(["requested", "confirmed", "declined"]), createdAt: z.string() });

function jobShape(row: typeof schema.jobs.$inferSelect, photoCount = 0, photoStages: string[] = []) {
  const requiredPhotoStages = row.requiredPhotoStages.split(",").filter((stage): stage is "before"|"during"|"after" => stage === "before" || stage === "during" || stage === "after");
  const complete = requiredPhotoStages.filter((stage) => photoStages.includes(stage)).length;
  return { id: row.id, clientId: row.clientId, clientName: row.clientName, clientPhone: row.clientPhone, clientEmail: row.clientEmail, jobAddress: row.jobAddress, jobType: row.jobType, notes: row.notes, jobDate: row.jobDate, appointmentAt: row.appointmentAt, amountDue: row.amountDue, dueDate: row.dueDate, depositAmount: row.depositAmount, paymentNotes: row.paymentNotes, galleryPick: row.galleryPick, photoCount, requiredPhotoStages, photoCompleteness: requiredPhotoStages.length ? Math.round(complete / requiredPhotoStages.length * 100) : 100, completedAt: row.completedAt?.toISOString() ?? null, completionOverrideNote: row.completionOverrideNote, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function normalizedPhone(value: string) { return value.replace(/\D/g, ""); }
function normalizeMoney(value: string, emptyValue = "") {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned) return emptyValue;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) throw new Error("Enter a valid amount.");
  return amount.toFixed(2);
}

// Defensive coercions for reporting queries: legacy or hand-edited rows can
// carry nulls or full ISO timestamps where the client expects plain strings.
// Used by getAutomationCenter so Home can never fail on odd row shapes.
function safeText(value: unknown): string { return value == null ? "" : String(value); }
function safeMoney(value: unknown): number { const n = Number(safeText(value).replace(/[^0-9.-]/g, "") || 0); return Number.isFinite(n) ? n : 0; }
function dateOnlyString(value: unknown): string { const m = /^(\d{4}-\d{2}-\d{2})/.exec(safeText(value)); return m?.[1] ?? ""; }
// Optional client-supplied calendar day (YYYY-MM-DD in the user's timezone)
// for actions that stamp user-visible dates. Falls back to the server UTC day
// only when the client does not send one.
const clientTodaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
function clientToday(args: { today?: string }): string {
  return args.today ?? new Date().toISOString().slice(0, 10);
}
function normalizeLineItems(items: Array<{ name?: string; description: string; amount: string; quantity?: number; discount?: string; unit?: "none" | "days" | "hours" }>) {
  return items.map((item) => ({
    name: item.name?.trim() ?? "",
    description: item.description.trim(),
    amount: normalizeMoney(item.amount, "0.00"),
    quantity: Number.isFinite(item.quantity) ? Math.max(0, item.quantity ?? 1) : 1,
    discount: normalizeMoney(item.discount ?? "0", "0.00"),
    unit: item.unit ?? "none",
  }));
}
async function upsertClient(ctx: Ctx, input: { clientId?: number | null; name: string; phone: string; email: string; address: string }) {
  const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.clients); const phone = normalizedPhone(input.phone); const match = rows.find((c) => input.clientId ? c.id === input.clientId : (phone && normalizedPhone(c.phone) === phone) || c.name.trim().toLowerCase() === input.name.trim().toLowerCase()); const now = new Date();
  if (match) { await db.update(schema.clients).set({ name: input.name, phone: input.phone, email: input.email, address: input.address, updatedAt: now }).where(eq(schema.clients.id, match.id)); return match.id; }
  const made = await db.insert(schema.clients).values({ name: input.name, phone: input.phone, email: input.email, address: input.address, notes: "", createdAt: now, updatedAt: now }).returning({ id: schema.clients.id }); return made[0]?.id ?? null;
}
async function hashPortalToken(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, "0")).join("");
}
async function hashLinkToken(token: string) {
  return hashPortalToken(token);
}
async function documentLinkTargetExists(ctx: Ctx, kind: "invoice" | "quote" | "contract" | "change_order", id: number) {
  const db = ctx.db<typeof schema>();
  if (kind === "invoice") return !!(await db.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1))[0];
  if (kind === "quote") return !!(await db.select({ id: schema.quotes.id }).from(schema.quotes).where(eq(schema.quotes.id, id)).limit(1))[0];
  const doc = (await db.select({ kind: schema.documents.kind }).from(schema.documents).where(eq(schema.documents.id, id)).limit(1))[0];
  return !!doc && doc.kind === kind;
}
async function getActiveDocumentLinkRow(ctx: Ctx, kind: "invoice" | "quote" | "contract" | "change_order", id: number) {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.documentLinks).where(and(eq(schema.documentLinks.documentKind, kind), eq(schema.documentLinks.documentId, id), isNull(schema.documentLinks.revokedAt))).orderBy(desc(schema.documentLinks.createdAt));
  return rows[0] ?? null;
}
async function resolveDocumentLinkToken(ctx: Ctx, token: string) {
  const db = ctx.db<typeof schema>();
  const hash = await hashLinkToken(token);
  const link = (await db.select().from(schema.documentLinks).where(eq(schema.documentLinks.tokenHash, hash)).limit(1))[0];
  if (!link || link.revokedAt) throw new Error("This link is no longer active.");
  if (link.expiresAt.getTime() < Date.now()) throw new Error("This link has expired. Please ask for a new one.");
  return link;
}

// ---- Client-portal share-link hardening (migration 0036) ----
const PORTAL_RATE_LIMIT_IP_PER_MIN = 30;
const PORTAL_RATE_LIMIT_TOKEN_PER_MIN = 120;
const PORTAL_VIEW_EVENT_THROTTLE_MS = 60 * 60_000;

type PortalMetaCtx = Ctx & { clientIp?: string; userAgent?: string };
function portalMeta(ctx: Ctx): PortalMetaCtx {
  return ctx as PortalMetaCtx;
}

async function checkPortalRateLimit(ctx: Ctx, tokenHash: string): Promise<void> {
  const db = ctx.db<typeof schema>();
  const now = Date.now();
  const ip = (portalMeta(ctx).clientIp ?? "").trim() || "unknown";
  // Prune rows older than 1 hour so the table stays bounded.
  await db.delete(schema.rateLimitEvents).where(lt(schema.rateLimitEvents.occurredAt, new Date(now - 3_600_000)));
  const windowStart = new Date(now - 60_000);
  const [ipHits, tokenHits] = await Promise.all([
    db.select({ id: schema.rateLimitEvents.id }).from(schema.rateLimitEvents).where(and(eq(schema.rateLimitEvents.scope, "portal:ip"), eq(schema.rateLimitEvents.key, ip), gte(schema.rateLimitEvents.occurredAt, windowStart))),
    db.select({ id: schema.rateLimitEvents.id }).from(schema.rateLimitEvents).where(and(eq(schema.rateLimitEvents.scope, "portal:token"), eq(schema.rateLimitEvents.key, tokenHash), gte(schema.rateLimitEvents.occurredAt, windowStart))),
  ]);
  if (ipHits.length >= PORTAL_RATE_LIMIT_IP_PER_MIN || tokenHits.length >= PORTAL_RATE_LIMIT_TOKEN_PER_MIN) {
    throw new Error("Too many requests. Try again shortly.");
  }
  await db.batch([
    db.insert(schema.rateLimitEvents).values({ scope: "portal:ip", key: ip, occurredAt: new Date() }),
    db.insert(schema.rateLimitEvents).values({ scope: "portal:token", key: tokenHash, occurredAt: new Date() }),
  ]);
}

type PortalTokenRow = typeof schema.portalTokens.$inferSelect;

async function requirePortalAccess(ctx: Ctx, token: string, opts: { logView: boolean }): Promise<PortalTokenRow> {
  const db = ctx.db<typeof schema>();
  const hash = await hashPortalToken(token);
  await checkPortalRateLimit(ctx, hash);
  const access = (await db.select().from(schema.portalTokens).where(eq(schema.portalTokens.tokenHash, hash)).limit(1))[0];
  if (!access || access.revokedAt) throw new Error("This portal link is no longer active.");
  if (access.expiresAt && access.expiresAt.getTime() < Date.now()) throw new Error("This portal link has expired. Ask your contractor for a new one.");
  if (opts.logView) {
    const now = new Date();
    await db.update(schema.portalTokens).set({ viewCount: access.viewCount + 1, firstViewedAt: access.firstViewedAt ?? now, lastViewedAt: now }).where(eq(schema.portalTokens.id, access.id));
    // Throttle view events: at most one per token per hour (getPortalData polls).
    const lastView = (await db.select({ occurredAt: schema.portalLinkEvents.occurredAt }).from(schema.portalLinkEvents).where(and(eq(schema.portalLinkEvents.linkId, access.id), eq(schema.portalLinkEvents.eventType, "view"))).orderBy(desc(schema.portalLinkEvents.occurredAt)).limit(1))[0];
    if (!lastView || now.getTime() - lastView.occurredAt.getTime() >= PORTAL_VIEW_EVENT_THROTTLE_MS) {
      await db.insert(schema.portalLinkEvents).values({ linkId: access.id, eventType: "view", userAgent: (portalMeta(ctx).userAgent ?? "").slice(0, 300), occurredAt: now });
      // Chunk D push: a client viewed the portal (throttled to 1/hour per link).
      try {
        const job = (await db.select({ companyId: schema.jobs.companyId, jobType: schema.jobs.jobType, jobAddress: schema.jobs.jobAddress }).from(schema.jobs).where(eq(schema.jobs.id, access.jobId)).limit(1))[0];
        if (job) {
          await sendPushToCompany(db, job.companyId, {
            titleEn: "Client viewed your portal", titleEs: "Un cliente vio tu portal",
            bodyEn: `${job.jobType} — ${job.jobAddress}`, bodyEs: `${job.jobType} — ${job.jobAddress}`,
            url: "/app/",
          });
        }
      } catch { /* push is best-effort */ }
    }
  }
  return access;
}

async function logPortalEvent(ctx: Ctx, linkId: number, eventType: "view" | "approve_selection" | "reject_selection" | "sign"): Promise<void> {
  const db = ctx.db<typeof schema>();
  await db.insert(schema.portalLinkEvents).values({ linkId, eventType, userAgent: (portalMeta(ctx).userAgent ?? "").slice(0, 300), occurredAt: new Date() });
}
function advanceRecurringDate(value: string, frequency: "daily" | "weekly" | "monthly" | "quarterly") {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) throw new Error("Enter a valid recurring date.");
  if (frequency === "daily") date.setDate(date.getDate() + 1);
  else if (frequency === "weekly") date.setDate(date.getDate() + 7);
  else date.setMonth(date.getMonth() + (frequency === "quarterly" ? 3 : 1));
  return date.toISOString().slice(0, 10);
}
function quoteDiff(previous: typeof schema.quotes.$inferSelect, next: typeof schema.quotes.$inferSelect) {
  const before = JSON.parse(previous.lineItemsJson) as Array<{ description: string; amount: string }>;
  const after = JSON.parse(next.lineItemsJson) as Array<{ description: string; amount: string }>;
  const beforeMap = new Map(before.map((item) => [item.description.trim().toLowerCase(), Number(item.amount)]));
  const afterMap = new Map(after.map((item) => [item.description.trim().toLowerCase(), Number(item.amount)]));
  const added = after.filter((item) => !beforeMap.has(item.description.trim().toLowerCase())).map((item) => item.description);
  const removed = before.filter((item) => !afterMap.has(item.description.trim().toLowerCase())).map((item) => item.description);
  const priceChanges = after.flatMap((item) => { const old = beforeMap.get(item.description.trim().toLowerCase()); return old !== undefined && old !== Number(item.amount) ? [`${item.description}: ${old.toFixed(2)} → ${Number(item.amount).toFixed(2)}`] : []; });
  return { added, removed, priceChanges, totalChange: (Number(next.total) - Number(previous.total)).toFixed(2) };
}
function quoteShape(q: typeof schema.quotes.$inferSelect) { return { id: q.id, clientId: q.clientId, clientName: q.clientName, clientPhone: q.clientPhone, clientEmail: q.clientEmail, jobAddress: q.jobAddress, shippingAddress: q.shippingAddress, jobType: q.jobType, lineItems: JSON.parse(q.lineItemsJson) as Array<{ description: string; amount: string }>, subtotal: q.subtotal, discountType: q.discountType, discountValue: q.discountValue, taxType: q.taxType, taxValue: q.taxValue, total: q.total, footnote: q.footnote, expiryDate: q.expiryDate, sentAt: q.sentAt, automationStatus: q.automationStatus, lostReason: q.lostReason, lostNote: q.lostNote, theme: q.theme, font: q.font, accentColor: q.accentColor, showTaxLine: q.showTaxLine, showDiscountLine: q.showDiscountLine, showPaidLine: q.showPaidLine, showPaymentTerms: q.showPaymentTerms, showFooterNotes: q.showFooterNotes, showLogo: q.showLogo, showCompanyInfo: q.showCompanyInfo, customizeJson: q.customizeJson, jobId: q.jobId, seriesId: q.seriesId ?? q.id, parentQuoteId: q.parentQuoteId, versionNumber: q.versionNumber, superseded: q.superseded, accepted: q.accepted, convertedToInvoiceId: q.convertedToInvoiceId, createdAt: q.createdAt.toISOString(), updatedAt: q.updatedAt.toISOString() }; }
function invoiceShape(row: typeof schema.invoices.$inferSelect, paymentRows: Array<typeof schema.payments.$inferSelect> = [], fee: {type:"flat"|"percent";value:number;graceDays:number} = {type:"flat",value:0,graceDays:0}) { const paid = paymentRows.reduce((sum, p) => sum + Number(p.amount.replace(/[^0-9.-]/g, "") || 0), 0); const total = Number(row.total.replace(/[^0-9.-]/g, "") || 0); const due=row.dueDate?new Date(`${row.dueDate}T12:00:00`).getTime():0; const daysLate=due?Math.floor((Date.now()-due)/86400000)-fee.graceDays:0; const monthsLate=Math.max(0,Math.ceil(daysLate/30)); const lateFee=row.status!=="paid"&&monthsLate>0?(fee.type==="percent"?total*fee.value/100*monthsLate:fee.value):0; return { id: row.id, invoiceNumber: row.invoiceNumber || `INV-${String(row.id).padStart(4, "0")}`, quoteId: row.quoteId, jobId: row.jobId, clientId: row.clientId, clientName: row.clientName, clientPhone: row.clientPhone, clientEmail: row.clientEmail, jobAddress: row.jobAddress, shippingAddress: row.shippingAddress, jobType: row.jobType, lineItems: normalizeLineItems(JSON.parse(row.lineItemsJson) as Array<{ name?: string; description: string; amount: string; quantity?: number; discount?: string; unit?: "none" | "days" | "hours" }>), subtotal: row.subtotal, discountType: row.discountType, discountValue: row.discountValue, taxType: row.taxType, taxValue: row.taxValue, total: row.total, footnote: row.footnote, issueDate: row.issueDate, dueDate: row.dueDate, status: row.status, recurringFrequency: row.recurringFrequency, nextDueDate: row.nextDueDate, seriesId: row.seriesId ?? row.id, parentInvoiceId: row.parentInvoiceId, recurringEndDate: row.recurringEndDate, recurringCancelled: row.recurringCancelled, paidToDate: paid.toFixed(2), balanceRemaining: Math.max(0, total + lateFee - paid).toFixed(2), lateFeeAccrued: lateFee.toFixed(2), totalWithLateFee:(total+lateFee).toFixed(2), payments: paymentRows.map((p) => ({ id: p.id, invoiceId: p.invoiceId, amount: p.amount, paymentDate: p.paymentDate, method: p.method, note: p.note, createdAt: p.createdAt.toISOString() })), theme: row.theme, font: row.font, accentColor: row.accentColor, showTaxLine: row.showTaxLine, showDiscountLine: row.showDiscountLine, showPaidLine: row.showPaidLine, showPaymentTerms: row.showPaymentTerms, showFooterNotes: row.showFooterNotes, showLogo: row.showLogo, showCompanyInfo: row.showCompanyInfo, customizeJson: row.customizeJson, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
async function marketplaceListingShape(ctx: Ctx, row: typeof schema.marketplaceListings.$inferSelect, photoRows: Array<typeof schema.marketplaceListingPhotos.$inferSelect>) {
  const photos = await Promise.all(photoRows.filter((photo) => photo.listingId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map(async (photo) => ({ id: photo.id, url: await ctx.blobs.getUrl(photo.blobKey), filename: photo.filename })));
  const featuredUntil = row.featuredUntil && row.featuredUntil.getTime() > Date.now() ? row.featuredUntil : null;
  return { id: row.id, title: row.title, category: row.category, listingType: row.listingType, employmentType: row.employmentType, payUnit: row.payUnit, priceKind: row.priceKind, price: row.price, originalPrice: row.originalPrice, description: row.description, serviceArea: row.serviceArea, companyName: row.companyName, companyPhone: row.companyPhone, bookable: row.bookable, dailyRate: row.dailyRate, promoted: row.promoted, featured: featuredUntil !== null, featuredUntil: featuredUntil?.toISOString() ?? null, isMine: row.companyId === workspaceIdentity(ctx).workspaceCompanyId, moderationStatus: row.moderationStatus as ModerationStatus, photos, justListed: Date.now() - row.createdAt.getTime() < 7 * 86400000, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function marketplaceRequestShape(row: typeof schema.marketplaceRequests.$inferSelect) {
  return { id: row.id, title: row.title, category: row.category, listingType: row.listingType, description: row.description, serviceArea: row.serviceArea, neededBy: row.neededBy, companyName: row.companyName, companyPhone: row.companyPhone, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

type BackupScalar = string | number | null;
type BackupRow = Record<string, BackupScalar>;
type BackupPayload = {
  format: "crewkat-backup" | "fieldhq-backup";
  version: 1;
  createdAt: string;
  tables: Record<string, BackupRow[]>;
  blobs: Record<string, { contentType: string; dataBase64: string }>;
};

const BACKUP_TABLES = [
  "clients", "jobs", "photos", "documents", "quotes", "invoices", "financial_document_signatures",
  "punch_items", "punch_signoffs", "progress_updates", "settings", "time_entries", "receipts", "crew_tasks",
  "voice_notes", "payments", "completion_certificates", "appointments", "leads", "selections", "daily_logs",
  "internal_notes", "payment_milestones", "automation_logs", "support_reports", "price_book_items", "quote_templates",
  "mileage_trips", "business_expenses", "subcontractors", "share_images", "warranties", "slideshow_videos",
  "scanned_documents", "suppliers", "maintenance_plans", "app_users", "admin_parameters", "portal_tokens",
  "material_cost_items", "supplier_quotes", "purchase_orders", "equipment", "safety_talks", "incidents",
  "credentials", "crew_pay_rates", "completion_overrides", "marketplace_listings", "marketplace_listing_photos",
  "marketplace_requests", "marketplace_messages", "marketplace_booking_requests",
  "document_links", "document_link_events"
] as const;

function sqlValue(value: BackupScalar) {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Backup contains an invalid number.");
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function validBackup(value: unknown): value is BackupPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BackupPayload>;
  return (candidate.format === "crewkat-backup" || candidate.format === "fieldhq-backup") && candidate.version === 1 && typeof candidate.tables === "object" && candidate.tables !== null && typeof candidate.blobs === "object" && candidate.blobs !== null;
}

async function createBackup(ctx: Ctx): Promise<BackupPayload> {
  const db = ctx.db<typeof schema>();
  const tables: Record<string, BackupRow[]> = {};
  const blobKeys = new Set<string>();
  for (const table of BACKUP_TABLES) {
    const rows = await db.all(sql.raw(`SELECT * FROM "${table}"`)) as BackupRow[];
    tables[table] = rows;
    for (const row of rows) for (const [column, value] of Object.entries(row)) {
      if (column.endsWith("_blob_key") && typeof value === "string" && value) blobKeys.add(value);
    }
  }
  return { format: "crewkat-backup", version: 1, createdAt: new Date().toISOString(), tables, blobs: {} };
}

async function restoreBackup(ctx: Ctx, backup: BackupPayload) {
  const db = ctx.db<typeof schema>();
  const allowedTables = new Set<string>(BACKUP_TABLES);
  for (const table of Object.keys(backup.tables)) if (!allowedTables.has(table)) throw new Error("This backup contains an unknown data section.");
  for (const table of BACKUP_TABLES) if (!Array.isArray(backup.tables[table])) throw new Error("This backup is incomplete.");

  const allowedColumns = new Map<string, Set<string>>();
  for (const table of BACKUP_TABLES) {
    const columns = await db.all(sql.raw(`PRAGMA table_info("${table}")`)) as Array<{ name: string }>;
    allowedColumns.set(table, new Set(columns.map((column) => column.name)));
    for (const row of backup.tables[table] ?? []) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("This backup contains an invalid record.");
      for (const [column, value] of Object.entries(row)) {
        if (!allowedColumns.get(table)?.has(column)) throw new Error("This backup was made by an incompatible version.");
        if (value !== null && typeof value !== "string" && typeof value !== "number") throw new Error("This backup contains an invalid value.");
      }
    }
  }
  for (const [key, blob] of Object.entries(backup.blobs)) {
    if (!key || typeof blob?.dataBase64 !== "string" || typeof blob?.contentType !== "string") throw new Error("This backup contains an invalid attachment.");
    await ctx.blobs.put(key, Buffer.from(blob.dataBase64, "base64"), { contentType: blob.contentType });
  }

  await db.run(sql.raw("PRAGMA foreign_keys = OFF"));
  await db.run(sql.raw("BEGIN IMMEDIATE"));
  try {
    for (const table of [...BACKUP_TABLES].reverse()) await db.run(sql.raw(`DELETE FROM "${table}"`));
    for (const table of BACKUP_TABLES) {
      for (const row of backup.tables[table] ?? []) {
        const entries = Object.entries(row);
        if (!entries.length) continue;
        const columns = entries.map(([column]) => `"${column}"`).join(",");
        const values = entries.map(([, value]) => sqlValue(value)).join(",");
        await db.run(sql.raw(`INSERT INTO "${table}" (${columns}) VALUES (${values})`));
      }
    }
    await db.run(sql.raw("COMMIT"));
  } catch (error) {
    await db.run(sql.raw("ROLLBACK"));
    throw error;
  } finally {
    await db.run(sql.raw("PRAGMA foreign_keys = ON"));
  }
  ctx.invalidateQueries();
}

const AUTH_SESSION_DAYS = 30;
const AUTH_CODE_MINUTES = 30;
const AUTH_PASSWORD_ITERATIONS = 210_000;
// Secure persistent login: 15-minute in-memory session proof + 30-day absolute
// HttpOnly refresh-token cookie with rotation + reuse theft detection.
const AUTH_PROOF_MINUTES = 15;
const AUTH_REFRESH_DAYS = 30;
const AUTH_REFRESH_ROTATE_MINUTES = 60; // rotate a refresh token at most once per hour
const AUTH_REFRESH_REUSE_GRACE_MS = 120_000; // concurrent-refresh race window
const AUTH_REFRESH_RATE_LIMIT = 10; // max refresh attempts per IP per minute
const authEnvelopeSchema = z.object({ _sessionToken: z.string().min(32).max(300) });
const authUserSchema = z.object({ id: z.number(), name: z.string(), email: z.string(), companyId: z.number(), role: z.literal("owner"), tier: z.enum(["free", "premium"]), isPlatformAdmin: z.boolean(), marketplaceTermsAcceptedAt: z.string().nullable(), marketplaceTermsVersion: z.string().nullable(), announcementBanner: z.string(), createdAt: z.string() });
const authCodeDeliverySchema = z.enum(["sent", "fallback", "failed"]);
// The standalone harness (server.mjs) attaches these to the action context:
// refreshToken = raw refresh token from the HttpOnly cookie (if present).
type AuthCtx = Ctx & { refreshToken?: string; userAgent?: string; ipHash?: string; isProdCookie?: boolean };
function authMeta(ctx: Ctx): AuthCtx {
  return ctx as AuthCtx;
}

function cookieSecure(ctx: Ctx): boolean {
  // server.mjs (unbundled, so process.env reads happen at runtime) passes
  // isProdCookie in the request metadata. NOTE: do NOT read
  // process.env.NODE_ENV directly here — `bun build` inlines it at build
  // time, which would bake the wrong cookie mode into the shipped bundle.
  return authMeta(ctx).isProdCookie === true;
}
const REFRESH_COOKIE_NAME_DEV = "crewkat_rt";
const REFRESH_COOKIE_NAME_PROD = "__Host-crewkat_rt"; // __Host- blocks subdomain cookie tossing
function refreshCookieName(secure: boolean): string {
  return secure ? REFRESH_COOKIE_NAME_PROD : REFRESH_COOKIE_NAME_DEV;
}
function refreshCookieHeader(secure: boolean, token: string): string {
  // Secure is omitted outside production so http://localhost dev keeps working.
  return `${refreshCookieName(secure)}=${token}; Path=/; Max-Age=${AUTH_REFRESH_DAYS * 24 * 60 * 60}; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax`;
}
function clearRefreshCookieHeader(secure: boolean): string {
  return `${refreshCookieName(secure)}=; Path=/; Max-Age=0; HttpOnly${secure ? "; Secure" : ""}; SameSite=Lax`;
}

// In-memory sliding-window rate limiter for refreshSession (single instance).
const refreshAttempts = new Map<string, number[]>();
function refreshRateLimited(key: string): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const times = (refreshAttempts.get(key) ?? []).filter((t) => t >= windowStart);
  times.push(now);
  refreshAttempts.set(key, times);
  if (refreshAttempts.size > 10_000) refreshAttempts.clear();
  return times.length > AUTH_REFRESH_RATE_LIMIT;
}

async function issueSession(ctx: Ctx, userId: number) {
  const meta = authMeta(ctx);
  const db = ctx.db<typeof schema>();
  const now = new Date();
  const familyId = crypto.randomUUID();
  // Short-lived proof: returned in the JSON body, kept in client memory only.
  const proof = randomHex(48);
  const proofExpiresAt = new Date(now.getTime() + AUTH_PROOF_MINUTES * 60_000);
  await db.insert(schema.authSessions).values({
    userId, tokenHash: await sha256(proof), tokenType: "proof", familyId,
    expiresAt: proofExpiresAt, lastSeenAt: now, createdAt: now,
    userAgent: (meta.userAgent ?? "").slice(0, 300), ipHash: meta.ipHash ?? "",
  });
  // Long-lived refresh token: HttpOnly cookie, 30-day absolute cap.
  const refreshToken = randomHex(48);
  const absoluteExpiresAt = new Date(now.getTime() + AUTH_REFRESH_DAYS * 24 * 60 * 60_000);
  await db.insert(schema.authSessions).values({
    userId, tokenHash: await sha256(refreshToken), tokenType: "refresh", familyId,
    absoluteExpiresAt, expiresAt: absoluteExpiresAt, lastSeenAt: now, createdAt: now,
    userAgent: (meta.userAgent ?? "").slice(0, 300), ipHash: meta.ipHash ?? "",
  });
  return { proof, proofExpiresAt, setCookies: [refreshCookieHeader(cookieSecure(ctx), refreshToken)] };
}
async function requireSession(ctx: Ctx, token: string) {
  const db = ctx.db<typeof schema>();
  const session = (await db.select().from(schema.authSessions).where(eq(schema.authSessions.tokenHash, await sha256(token))).limit(1))[0];
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new Error("Your session has expired. Sign in again.");
  // Refresh tokens are never valid as general API credentials (cookie-only).
  if (session.tokenType === "refresh") throw new Error("Sign in to continue.");
  const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, session.userId)).limit(1))[0];
  if (!user?.emailVerifiedAt) throw new Error("Sign in to continue.");
  if (user.suspendedAt) throw new Error("This account has been suspended. Contact support for help.");
  // Dual-mode: legacy 30-day tokens keep their sliding renewal. Proof tokens
  // have a hard 15-minute expiry and are never extended.
  const stale = Date.now() - session.lastSeenAt.getTime() > 5 * 60_000;
  if (stale && session.tokenType === "legacy") {
    await db.update(schema.authSessions).set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + AUTH_SESSION_DAYS * 24 * 60 * 60_000) }).where(eq(schema.authSessions.id, session.id));
  } else if (stale) {
    await db.update(schema.authSessions).set({ lastSeenAt: new Date() }).where(eq(schema.authSessions.id, session.id));
  }
  return user;
}
async function revokeSessionFamily(db: ReturnType<Ctx["db"]>, familyId: string | null, userId: number) {
  const now = new Date();
  if (familyId) {
    await db.update(schema.authSessions).set({ revokedAt: now }).where(and(eq(schema.authSessions.familyId, familyId), isNull(schema.authSessions.revokedAt)));
  } else {
    // Legacy rows have no family: revoke the user's legacy rows.
    await db.update(schema.authSessions).set({ revokedAt: now }).where(and(eq(schema.authSessions.userId, userId), eq(schema.authSessions.tokenType, "legacy"), isNull(schema.authSessions.revokedAt)));
  }
}
async function issueProofForRefresh(
  ctx: Ctx,
  db: ReturnType<Ctx["db"]>,
  refreshRow: typeof schema.authSessions.$inferSelect,
  rotate: boolean,
): Promise<{ proof: string; proofExpiresAt: Date; setCookies: string[] }> {
  const meta = authMeta(ctx);
  const now = new Date();
  const proof = randomHex(48);
  const proofExpiresAt = new Date(now.getTime() + AUTH_PROOF_MINUTES * 60_000);
  await db.insert(schema.authSessions).values({
    userId: refreshRow.userId, tokenHash: await sha256(proof), tokenType: "proof",
    familyId: refreshRow.familyId, expiresAt: proofExpiresAt, lastSeenAt: now, createdAt: now,
    userAgent: (meta.userAgent ?? "").slice(0, 300), ipHash: meta.ipHash ?? "",
  });
  if (!rotate) return { proof, proofExpiresAt, setCookies: [] };
  const successor = randomHex(48);
  await db.batch([
    db.update(schema.authSessions).set({ revokedAt: now, replacedBy: await sha256(successor) }).where(eq(schema.authSessions.id, refreshRow.id)),
    db.insert(schema.authSessions).values({
      userId: refreshRow.userId, tokenHash: await sha256(successor), tokenType: "refresh",
      familyId: refreshRow.familyId, absoluteExpiresAt: refreshRow.absoluteExpiresAt,
      expiresAt: refreshRow.absoluteExpiresAt ?? new Date(now.getTime() + AUTH_REFRESH_DAYS * 24 * 60 * 60_000),
      lastSeenAt: now, createdAt: now,
      userAgent: (meta.userAgent ?? "").slice(0, 300), ipHash: meta.ipHash ?? "",
    }),
  ]);
  return { proof, proofExpiresAt, setCookies: [refreshCookieHeader(cookieSecure(ctx), successor)] };
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}
function randomHex(bytes = 32) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values).map((value) => value.toString(16).padStart(2, "0")).join("");
}
function randomCode() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return String(value % 1_000_000).padStart(6, "0");
}
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((item) => item.toString(16).padStart(2, "0")).join("");
}
async function derivePassword(password: string, saltHex: string, iterations: number) {
  const salt = Uint8Array.from(saltHex.match(/.{1,2}/g) ?? [], (value) => Number.parseInt(value, 16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256);
  return Array.from(new Uint8Array(bits)).map((item) => item.toString(16).padStart(2, "0")).join("");
}
function authUserShape(row: typeof schema.authUsers.$inferSelect, announcementBanner: string) {
  return { id: row.id, name: row.name, email: row.email, companyId: row.companyId, role: "owner" as const, tier: row.tier, isPlatformAdmin: row.isPlatformAdmin, marketplaceTermsAcceptedAt: row.marketplaceTermsAcceptedAt ? row.marketplaceTermsAcceptedAt.toISOString() : null, marketplaceTermsVersion: row.marketplaceTermsVersion, announcementBanner, createdAt: row.createdAt.toISOString() };
}
async function issueAuthCode(ctx: Ctx, userId: number, purpose: "verify_email" | "reset_password") {
  const db = ctx.db<typeof schema>();
  const now = new Date();
  const recent = (await db.select({ createdAt: schema.authTokens.createdAt }).from(schema.authTokens).where(and(eq(schema.authTokens.userId, userId), eq(schema.authTokens.purpose, purpose))).orderBy(desc(schema.authTokens.createdAt)).limit(1))[0];
  if (recent && now.getTime() - recent.createdAt.getTime() < 60_000) throw new Error("Please wait one minute before requesting another code.");
  const code = randomCode();
  await db.update(schema.authTokens).set({ consumedAt: now }).where(and(eq(schema.authTokens.userId, userId), eq(schema.authTokens.purpose, purpose), isNull(schema.authTokens.consumedAt)));
  await db.insert(schema.authTokens).values({ userId, purpose, tokenHash: await sha256(code), expiresAt: new Date(now.getTime() + AUTH_CODE_MINUTES * 60_000), createdAt: now });
  return code;
}
async function deliverAuthCode(ctx: Ctx, email: string, code: string, purpose: "verify_email" | "reset_password") {
  const result = await ctx.executePrivileged(privileged.sendAuthEmail, { to: email, code, purpose });
  return authCodeClientResult(code, result.delivery);
}

// ---------------------------------------------------------------------------
// Chunk D: referral loop. Each user gets an 8-char referral code; when a
// referred user completes email verification, the referrer's company earns
// +5 bonus marketplace listings (settings.listing_bonus, added on top of
// the free_listing_limit platform setting).
// ---------------------------------------------------------------------------

const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeReferralCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  return code;
}

async function uniqueReferralCode(db: ReturnType<Ctx["db"]>): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const code = makeReferralCode();
    const existing = (await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.referralCode, code)).limit(1))[0];
    if (!existing) return code;
  }
  throw new Error("Could not generate a referral code. Try again.");
}

function normalizeReferralCode(raw: string | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{8}$/.test(code) ? code : null;
}

async function getCompanyListingBonus(db: ReturnType<Ctx["db"]>): Promise<number> {
  const row = (await db.select({ listingBonus: schema.settings.listingBonus }).from(schema.settings).limit(1))[0];
  return row?.listingBonus ?? 0;
}

async function getEffectiveListingLimit(db: ReturnType<Ctx["db"]>): Promise<{ base: number; bonus: number; effective: number }> {
  const base = await getIntPlatformSetting(db, "free_listing_limit");
  const bonus = await getCompanyListingBonus(db);
  return { base, bonus, effective: base + bonus };
}

function appPublicUrl(): string {
  const configured = (process.env.CREWKAT_PUBLIC_URL ?? "").trim().replace(/\/$/, "");
  return configured || "https://crewkat.com";
}

type WorkspaceCtx = Ctx & { workspaceCompanyId: number; workspaceUserId: number; workspaceTier: "free" | "premium"; unscopedDb?: () => ReturnType<Ctx["db"]> };
const GLOBAL_MARKETPLACE_READ_TABLES = new Set<unknown>([
  schema.marketplaceListings,
  schema.marketplaceListingPhotos,
  schema.marketplaceRequests,
  schema.marketplaceMessages,
]);

function wrapScopedQuery(target: any, scope: unknown, state = { applied: false }): any {
  return new Proxy(target, {
    get(current, property) {
      if (property === "where") return (condition: unknown) => {
        state.applied = true;
        return wrapScopedQuery(current.where(and(scope as any, condition as any)), scope, state);
      };
      if (property === "then" || property === "execute" || property === "all" || property === "get") {
        const scoped = state.applied ? current : current.where(scope);
        state.applied = true;
        const value = Reflect.get(scoped, property);
        return typeof value === "function" ? value.bind(scoped) : value;
      }
      const value = Reflect.get(current, property);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => wrapScopedQuery(value.apply(current, args), scope, state);
    },
  });
}

function workspaceDb(rawDb: any, companyId: number): any {
  return new Proxy(rawDb, {
    get(target, property) {
      if (property === "select") return (...selectionArgs: unknown[]) => {
        const selectBuilder = target.select(...selectionArgs);
        return new Proxy(selectBuilder, {
          get(selectTarget, selectProperty) {
            if (selectProperty !== "from") {
              const value = Reflect.get(selectTarget, selectProperty);
              return typeof value === "function" ? value.bind(selectTarget) : value;
            }
            return (table: any) => {
              const query = selectTarget.from(table);
              const companyColumn = table?.companyId;
              if (!companyColumn || GLOBAL_MARKETPLACE_READ_TABLES.has(table)) return query;
              return wrapScopedQuery(query, eq(companyColumn, companyId));
            };
          },
        });
      };
      if (property === "insert") return (table: any) => {
        const insertBuilder = target.insert(table);
        const companyColumn = table?.companyId;
        if (!companyColumn) return insertBuilder;
        return new Proxy(insertBuilder, {
          get(insertTarget, insertProperty) {
            if (insertProperty !== "values") {
              const value = Reflect.get(insertTarget, insertProperty);
              return typeof value === "function" ? value.bind(insertTarget) : value;
            }
            return (values: Record<string, unknown> | Array<Record<string, unknown>>) => insertTarget.values(
              Array.isArray(values)
                ? values.map((value) => ({ companyId, ...value }))
                : { companyId, ...values },
            );
          },
        });
      };
      if (property === "update" || property === "delete") return (table: any) => {
        const builder = target[property](table);
        const companyColumn = table?.companyId;
        return companyColumn ? wrapScopedQuery(builder, eq(companyColumn, companyId)) : builder;
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function withWorkspace(ctx: Ctx, user: typeof schema.authUsers.$inferSelect): WorkspaceCtx {
  const scoped = Object.create(ctx) as WorkspaceCtx;
  const rawDb = () => ctx.db<typeof schema>();
  Object.defineProperties(scoped, {
    db: { value: () => workspaceDb(rawDb(), user.companyId) },
    unscopedDb: { value: rawDb },
    workspaceCompanyId: { value: user.companyId },
    workspaceUserId: { value: user.id },
    workspaceTier: { value: user.tier },
  });
  return scoped;
}

export function workspaceIdentity(ctx: Ctx) {
  const scoped = ctx as WorkspaceCtx;
  if (!scoped.workspaceCompanyId || !scoped.workspaceUserId) throw new Error("Sign in to continue.");
  return scoped;
}

// ---------------------------------------------------------------------------
// Platform admin (Danny): guard + audit log + platform settings.
// ---------------------------------------------------------------------------

async function requirePlatformAdmin(ctx: Ctx) {
  const identity = workspaceIdentity(ctx);
  const db = ctx.db<typeof schema>();
  const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
  if (!user?.isPlatformAdmin) throw new Error("Platform admin access required.");
  return { identity, admin: user };
}

// Platform-admin actions must see and change rows across ALL companies.
// The workspace ctx's `db` proxy auto-filters every table that has a
// company_id column down to the admin's own company, so admin handlers
// use this unscoped db instead.
function platformDb(ctx: Ctx): ReturnType<Ctx["db"]> {
  const scoped = ctx as WorkspaceCtx;
  if (typeof scoped.unscopedDb === "function") return scoped.unscopedDb();
  return ctx.db<typeof schema>();
}

async function logAdminAction(db: ReturnType<Ctx["db"]>, adminUserId: number, action: string, targetType: string, targetId: string, details: string) {
  await db.insert(schema.adminAuditLog).values({ adminUserId, action, targetType, targetId, details, createdAt: new Date() });
}

async function getPlatformSetting(db: ReturnType<Ctx["db"]>, key: string, fallback: string): Promise<string> {
  const row = (await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, key)).limit(1))[0];
  return row?.value ?? fallback;
}

async function getFlagThreshold(db: ReturnType<Ctx["db"]>): Promise<number> {
  const raw = await getPlatformSetting(db, "flag_threshold", "3");
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 10 ? parsed : 3;
}

type PlatformSettingType = "boolean" | "int" | "text";
interface PlatformSettingDef { type: PlatformSettingType; labelEn: string; labelEs: string; min?: number; max?: number; maxLength?: number; fallback: string }
const PLATFORM_SETTING_DEFS: Record<string, PlatformSettingDef> = {
  auto_moderation_enabled: { type: "boolean", labelEn: "Automatic listing moderation", labelEs: "Moderación automática de publicaciones", fallback: "1" },
  flag_threshold: { type: "int", labelEn: "Flags before review", labelEs: "Reportes antes de revisión", min: 1, max: 10, fallback: "3" },
  registration_enabled: { type: "boolean", labelEn: "New registrations", labelEs: "Nuevos registros", fallback: "1" },
  marketplace_enabled: { type: "boolean", labelEn: "Marketplace", labelEs: "Marketplace", fallback: "1" },
  free_listing_limit: { type: "int", labelEn: "Free plan active listings", labelEs: "Publicaciones activas del plan gratis", min: 1, max: 100, fallback: "3" },
  announcement_banner: { type: "text", labelEn: "Announcement banner", labelEs: "Anuncio (banner)", maxLength: 300, fallback: "" },
};

function normalizePlatformSetting(key: string, raw: string): string {
  const def = PLATFORM_SETTING_DEFS[key];
  if (!def) throw new Error(`Unknown platform setting: ${key}`);
  if (def.type === "boolean") {
    if (raw !== "0" && raw !== "1") throw new Error(`Invalid value for ${key}: expected 0 or 1.`);
    return raw;
  }
  if (def.type === "int") {
    const trimmed = raw.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || String(parsed) !== trimmed) throw new Error(`Invalid value for ${key}: expected a whole number.`);
    if (parsed < (def.min ?? 0) || parsed > (def.max ?? Number.MAX_SAFE_INTEGER)) throw new Error(`Invalid value for ${key}: expected ${def.min}–${def.max}.`);
    return String(parsed);
  }
  const text = raw.trim();
  if (text.length > (def.maxLength ?? 1000)) throw new Error(`Invalid value for ${key}: keep it under ${def.maxLength} characters.`);
  return text;
}

async function getBooleanPlatformSetting(db: ReturnType<Ctx["db"]>, key: string): Promise<boolean> {
  return (await getPlatformSetting(db, key, PLATFORM_SETTING_DEFS[key]?.fallback ?? "0")) === "1";
}

async function getIntPlatformSetting(db: ReturnType<Ctx["db"]>, key: string): Promise<number> {
  const fallback = Number.parseInt(PLATFORM_SETTING_DEFS[key]?.fallback ?? "0", 10);
  const parsed = Number.parseInt(await getPlatformSetting(db, key, String(fallback)), 10);
  if (!Number.isFinite(parsed)) return fallback;
  const def = PLATFORM_SETTING_DEFS[key];
  if (def?.min !== undefined && parsed < def.min) return def.min;
  if (def?.max !== undefined && parsed > def.max) return def.max;
  return parsed;
}

async function requireMarketplaceEnabled(db: ReturnType<Ctx["db"]>): Promise<void> {
  if (!(await getBooleanPlatformSetting(db, "marketplace_enabled"))) throw new Error("MARKETPLACE_DISABLED");
}

async function isAutoModerationEnabled(db: ReturnType<Ctx["db"]>): Promise<boolean> {
  return (await getPlatformSetting(db, "auto_moderation_enabled", "1")) === "1";
}

// ---------------------------------------------------------------------------
// Automated backups (in-process scheduler; Tier A snapshots + Tier B weekly
// full archives, offsite via Resend email attachments, monthly restore test).
// ---------------------------------------------------------------------------

const BACKUP_DIR_NAME = "backups";
const BACKUP_RESEND_LIMIT_BYTES = 40_000_000; // Resend total email size ceiling
const execFileAsync = promisify(execFile);

type BackupKind = "daily-db" | "weekly-full" | "manual";

interface BackupConfig {
  alertEmail: string;
  hour: number;
  diskCapMB: number;
  fullSizeAlertMB: number;
}

function backupConfig(): BackupConfig {
  const int = (value: string | undefined, fallback: number) => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    alertEmail: (process.env.BACKUP_ALERT_EMAIL || "").trim(),
    hour: Math.min(23, Math.max(0, int(process.env.BACKUP_HOUR, 3))),
    diskCapMB: Math.max(128, int(process.env.BACKUP_DISK_CAP_MB, 1024)),
    fullSizeAlertMB: Math.max(5, int(process.env.BACKUP_FULL_SIZE_ALERT_MB, 30)),
  };
}

function utcStamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sendBackupAlert(ctx: Ctx, cfg: BackupConfig, subject: string, text: string) {
  if (!cfg.alertEmail) {
    console.error(`[crewkat][backup] ALERT (no BACKUP_ALERT_EMAIL configured): ${subject}\n${text}`);
    return;
  }
  try {
    await ctx.executePrivileged(privileged.sendBackupEmail, { to: cfg.alertEmail, subject, text, attachments: [] });
  } catch (error) {
    console.error("[crewkat][backup] alert email failed:", error);
  }
}

async function pruneBackups(dir: string, cfg: BackupConfig, notes: string[]) {
  let entries: Array<{ name: string; path: string; mtimeMs: number; size: number }> = [];
  try {
    const names = await readdir(dir);
    for (const name of names) {
      if (!/^app-\d{8}-\d{6}-[0-9a-f]{6}\.db$/.test(name) && !/^crewkat-full-\d{8}-\d{6}\.tar\.gz$/.test(name)) continue;
      const path = join(dir, name);
      const st = await stat(path);
      if (st.isFile()) entries.push({ name, path, mtimeMs: st.mtimeMs, size: st.size });
    }
  } catch {
    return;
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
  const dailies = entries.filter((e) => e.name.endsWith(".db"));
  const weeklies = entries.filter((e) => e.name.endsWith(".tar.gz"));
  const keep = new Set<string>([...dailies.slice(0, 7), ...weeklies.slice(0, 4)].map((e) => e.path));
  // Never delete the newest daily or newest weekly, even under disk pressure.
  const protectedPaths = new Set<string>([...dailies.slice(0, 1), ...weeklies.slice(0, 1)].map((e) => e.path));
  const cap = cfg.diskCapMB * 1024 * 1024;
  let total = entries.filter((e) => keep.has(e.path)).reduce((sum, e) => sum + e.size, 0);
  const capVictims = entries.filter((e) => keep.has(e.path) && !protectedPaths.has(e.path)).sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const victim of capVictims) {
    if (total <= cap) break;
    await rm(victim.path, { force: true });
    keep.delete(victim.path);
    total -= victim.size;
    notes.push(`Pruned ${victim.name} (disk cap).`);
  }
  for (const entry of entries) {
    if (keep.has(entry.path)) continue;
    await rm(entry.path, { force: true });
    notes.push(`Pruned ${entry.name} (retention).`);
  }
}

interface BackupResult {
  ok: boolean;
  runId: number | null;
  kind: BackupKind;
  filePath: string | null;
  totalBytes: number | null;
  offsiteSent: boolean;
  integrityOk: boolean;
  error: string | null;
}

export async function performBackup(ctx: Ctx, kind: BackupKind, notes = ""): Promise<BackupResult> {
  const cfg = backupConfig();
  const db = ctx.db<typeof schema>();
  const dir = join(ctx.spaceDir, BACKUP_DIR_NAME);
  const startedAt = new Date();
  let runId: number | null = null;

  const fail = async (error: string): Promise<BackupResult> => {
    if (runId) {
      await db.update(schema.backupRuns).set({ status: "failed", finishedAt: new Date(), error: error.slice(0, 2000) }).where(eq(schema.backupRuns.id, runId));
    }
    await sendBackupAlert(ctx, cfg, `[Crewkat backup] backup FAILED (${kind})`, `An automated Crewkat backup failed.\n\nKind: ${kind}\nTime: ${new Date().toISOString()}\nError: ${error}\nBackup run row: ${runId ?? "n/a"}\n\nOpen Crewkat → Settings → Backups to retry manually.`);
    return { ok: false, runId, kind, filePath: null, totalBytes: null, offsiteSent: false, integrityOk: false, error };
  };

  try {
    await mkdir(dir, { recursive: true });
    const claimed = await db.insert(schema.backupRuns).values({ kind, status: "running", startedAt, notes: notes || null }).returning({ id: schema.backupRuns.id });
    runId = claimed[0]?.id ?? null;
    if (!runId) throw new Error("Could not claim a backup run row.");

    // Tier A: consistent SQLite snapshot via VACUUM INTO.
    const stamp = utcStamp(startedAt);
    const snapshotName = `app-${stamp}-${crypto.randomUUID().slice(0, 6)}.db`;
    if (!/^app-\d{8}-\d{6}-[0-9a-f]{6}\.db$/.test(snapshotName)) throw new Error("Invalid snapshot name.");
    const snapshotPath = join(dir, snapshotName);
    const escapedSnapshot = snapshotPath.replace(/'/g, "''");
    await db.run(sql.raw(`VACUUM INTO '${escapedSnapshot}'`));
    const dbBytes = (await stat(snapshotPath)).size;

    // Verify the snapshot: ATTACH + integrity_check + row counts vs live.
    let integrityOk = false;
    await db.run(sql.raw(`ATTACH DATABASE '${escapedSnapshot}' AS __snap`));
    try {
      const check = await db.all(sql.raw(`PRAGMA __snap.integrity_check`));
      integrityOk = (check ?? []).every((row) => String((row as Record<string, unknown>).integrity_check).toLowerCase() === "ok");
      const counts = await db.all(sql.raw(
        `SELECT 'jobs' AS t, (SELECT count(*) FROM main.jobs) AS live, (SELECT count(*) FROM __snap.jobs) AS snap ` +
        `UNION ALL SELECT 'invoices', (SELECT count(*) FROM main.invoices), (SELECT count(*) FROM __snap.invoices) ` +
        `UNION ALL SELECT 'auth_users', (SELECT count(*) FROM main.auth_users), (SELECT count(*) FROM __snap.auth_users)`
      ));
      const mismatched = (counts ?? []).filter((row) => Number((row as Record<string, unknown>).live) !== Number((row as Record<string, unknown>).snap));
      if (!integrityOk) throw new Error("Snapshot integrity_check did not return ok.");
      if (mismatched.length > 0) throw new Error(`Row-count mismatch in snapshot: ${mismatched.map((row) => String((row as Record<string, unknown>).t)).join(", ")}.`);
    } finally {
      await db.run(sql.raw(`DETACH DATABASE __snap`));
    }

    // Tier B: weekly-full (or manual) also ships a tar.gz of the snapshot + blobs.
    let totalBytes = dbBytes;
    let blobBytes: number | null = null;
    let tarPath: string | null = null;
    let filePath = snapshotPath;
    if (kind === "weekly-full" || kind === "manual") {
      const tarName = `crewkat-full-${stamp}.tar.gz`;
      tarPath = join(dir, tarName);
      await mkdir(join(ctx.spaceDir, "blobs"), { recursive: true });
      await execFileAsync("tar", ["-czf", tarPath, "-C", dir, snapshotName, "-C", ctx.spaceDir, "blobs"]);
      totalBytes = (await stat(tarPath)).size;
      blobBytes = Math.max(0, totalBytes - dbBytes);
      filePath = tarPath;
    }

    // Retention + disk-cap pruning.
    const pruneNotes: string[] = [];
    await pruneBackups(dir, cfg, pruneNotes);

    // Offsite: email the snapshot (always) and the full archive when it fits.
    let offsiteSent = false;
    const dateLabel = startedAt.toISOString().slice(0, 10);
    if (cfg.alertEmail) {
      const attachments = [{
        filename: snapshotName,
        contentType: "application/x-sqlite3",
        dataBase64: (await readFile(snapshotPath)).toString("base64"),
      }];
      let subject = `[Crewkat backup] ${dateLabel} — app.db (${formatBytes(dbBytes)}) OK`;
      let text =
        `Automated Crewkat backup completed.\n\n` +
        `Kind: ${kind}\n` +
        `Snapshot: ${snapshotName} (${formatBytes(dbBytes)})\n` +
        `Integrity check: ok\n` +
        `Row counts: jobs / invoices / auth_users match the live database.\n` +
        `\nRestore: extract the attachment, verify it with PRAGMA integrity_check, and copy it over /data/app.db while the service is suspended. Full procedure: DEPLOY-RUNBOOK.md section 10.`;
      if (tarPath && totalBytes < BACKUP_RESEND_LIMIT_BYTES) {
        attachments.push({
          filename: basename(tarPath),
          contentType: "application/gzip",
          dataBase64: (await readFile(tarPath)).toString("base64"),
        });
        subject = `[Crewkat backup] ${dateLabel} — full (${formatBytes(totalBytes)}) OK`;
        text += `\nFull snapshot: ${basename(tarPath)} (${formatBytes(totalBytes)}) — database plus all job photos/blobs.`;
      } else if (tarPath) {
        text += `\nFull snapshot: ${basename(tarPath)} (${formatBytes(totalBytes)}) was NOT emailed (over the ${formatBytes(BACKUP_RESEND_LIMIT_BYTES)} email limit) — it is retained on the server disk.`;
      }
      const delivery = await ctx.executePrivileged(privileged.sendBackupEmail, { to: cfg.alertEmail, subject, text, attachments });
      offsiteSent = delivery.delivery === "sent";
      if (!offsiteSent) pruneNotes.push("Offsite email failed to send.");
    }

    // Warn as the weekly full approaches the email size ceiling.
    if (tarPath && totalBytes >= cfg.fullSizeAlertMB * 1024 * 1024) {
      await sendBackupAlert(ctx, cfg,
        `[Crewkat backup] weekly full is ${formatBytes(totalBytes)}`,
        `The weekly full snapshot has reached ${formatBytes(totalBytes)} (alert threshold ${cfg.fullSizeAlertMB} MB).\nEmail offsite stops working at ${formatBytes(BACKUP_RESEND_LIMIT_BYTES)}.\nSet up the S3 offsite option (see dev-briefs/automated-backups.md section 2.5) before then.`);
      pruneNotes.push(`Size alert sent (${formatBytes(totalBytes)}).`);
    }

    await db.update(schema.backupRuns).set({
      status: "ok", finishedAt: new Date(), dbBytes, blobBytes, totalBytes,
      filePath, offsiteSent, integrityOk: true, notes: pruneNotes.join(" ") || null,
    }).where(eq(schema.backupRuns.id, runId));
    return { ok: true, runId, kind, filePath, totalBytes, offsiteSent, integrityOk: true, error: null };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export async function performMonthlyVerify(ctx: Ctx, cfg: BackupConfig) {
  const db = ctx.db<typeof schema>();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const recent = await db.select({ id: schema.backupRuns.id }).from(schema.backupRuns)
    .where(and(eq(schema.backupRuns.kind, "monthly-verify"), eq(schema.backupRuns.status, "ok"), gte(schema.backupRuns.startedAt, thirtyDaysAgo)))
    .limit(1);
  if (recent.length > 0) return;

  const claimed = await db.insert(schema.backupRuns).values({ kind: "monthly-verify", status: "running", startedAt: new Date() }).returning({ id: schema.backupRuns.id });
  const runId = claimed[0]?.id ?? null;
  const fail = async (error: string) => {
    if (runId) await db.update(schema.backupRuns).set({ status: "failed", finishedAt: new Date(), error: error.slice(0, 2000) }).where(eq(schema.backupRuns.id, runId));
    await sendBackupAlert(ctx, cfg, "[Crewkat backup] monthly restore test FAILED",
      `The automated monthly restore test failed — backups may not be restorable.\n\nTime: ${new Date().toISOString()}\nError: ${error}\n\nInvestigate before the next weekly run.`);
  };

  let workDir: string | null = null;
  try {
    const latest = await db.select().from(schema.backupRuns)
      .where(and(eq(schema.backupRuns.kind, "weekly-full"), eq(schema.backupRuns.status, "ok")))
      .orderBy(desc(schema.backupRuns.startedAt)).limit(1);
    const tarPath = latest[0]?.filePath;
    if (!tarPath) throw new Error("No successful weekly full backup found to verify.");

    workDir = await mkdtemp(join(tmpdir(), "crewkat-restore-test-"));
    await execFileAsync("tar", ["-xzf", tarPath, "-C", workDir]);
    const dbName = (await readdir(workDir)).find((n) => /^app-\d{8}-\d{6}-[0-9a-f]{6}\.db$/.test(n));
    if (!dbName) throw new Error("Extracted archive is missing the database snapshot.");
    const escapedDb = join(workDir, dbName).replace(/'/g, "''");

    await db.run(sql.raw(`ATTACH DATABASE '${escapedDb}' AS __verify`));
    try {
      const check = await db.all(sql.raw(`PRAGMA __verify.integrity_check`));
      const ok = (check ?? []).every((row) => String((row as Record<string, unknown>).integrity_check).toLowerCase() === "ok");
      if (!ok) throw new Error("Restored snapshot integrity_check failed.");
      const counts = await db.all(sql.raw(
        `SELECT 'jobs' AS t, (SELECT count(*) FROM main.jobs) AS live, (SELECT count(*) FROM __verify.jobs) AS snap ` +
        `UNION ALL SELECT 'invoices', (SELECT count(*) FROM main.invoices), (SELECT count(*) FROM __verify.invoices)`
      ));
      const mismatched = (counts ?? []).filter((row) => Number((row as Record<string, unknown>).live) !== Number((row as Record<string, unknown>).snap));
      if (mismatched.length > 0) throw new Error("Row counts differ between the live DB and the restored snapshot.");
      // Spot-check 5 random blob keys exist in the extracted blobs dir.
      const keys = await db.all(sql.raw(`SELECT blob_key AS k FROM main.photos WHERE blob_key IS NOT NULL AND blob_key != '' ORDER BY RANDOM() LIMIT 5`));
      const missing: string[] = [];
      for (const row of (keys ?? [])) {
        const key = String((row as Record<string, unknown>).k);
        if (!key || key.includes("..")) continue;
        try { await stat(join(workDir, "blobs", key)); } catch { missing.push(key); }
      }
      if (missing.length > 0) throw new Error(`Restored archive is missing ${missing.length} blob file(s).`);
    } finally {
      await db.run(sql.raw(`DETACH DATABASE __verify`));
    }

    if (runId) {
      await db.update(schema.backupRuns).set({ status: "ok", finishedAt: new Date(), integrityOk: true, notes: "Monthly restore test passed: latest weekly full extracts, integrity_check ok, row counts match, 5 random blob keys present." }).where(eq(schema.backupRuns.id, runId));
    }
  } catch (error) {
    await fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  }
}

let backupInProgress = false;
let lastMissedRunAlertAt = 0;

async function checkMissedRuns(ctx: Ctx, cfg: BackupConfig) {
  const db = ctx.db<typeof schema>();
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000);
  const recentOk = await db.select({ id: schema.backupRuns.id }).from(schema.backupRuns)
    .where(and(eq(schema.backupRuns.status, "ok"), gte(schema.backupRuns.startedAt, cutoff))).limit(1);
  if (recentOk.length === 0 && Date.now() - lastMissedRunAlertAt > 24 * 3600 * 1000) {
    lastMissedRunAlertAt = Date.now();
    await sendBackupAlert(ctx, cfg, "[Crewkat backup] no successful backup in 48h",
      "The backup scheduler is running but no backup has succeeded in the last 48 hours.\nCheck Crewkat → Settings → Backups for failed runs and investigate.");
  }
}

/**
 * Scheduler entry point (called from server.mjs). Runs at most once per UTC
 * day, at/after BACKUP_HOUR (default 03:00 UTC). Sundays take a weekly-full
 * tar.gz; other days a daily-db VACUUM INTO snapshot. Triggers the monthly
 * restore test after a weekly run when one is due.
 */
export async function runScheduledBackup(ctx: Ctx): Promise<{ ran: boolean; kind?: BackupKind; ok?: boolean }> {
  const cfg = backupConfig();
  if (!cfg.alertEmail) {
    console.error("[crewkat][backup] BACKUP_ALERT_EMAIL is not set — automated backups are disabled. Set it in the Render env vars.");
    return { ran: false };
  }
  if (backupInProgress) return { ran: false };
  const db = ctx.db<typeof schema>();
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todays = await db.select({ id: schema.backupRuns.id }).from(schema.backupRuns)
    .where(gte(schema.backupRuns.startedAt, dayStart)).limit(1);
  if (todays.length > 0) return { ran: false };
  if (now.getUTCHours() < cfg.hour) return { ran: false };

  backupInProgress = true;
  try {
    const kind: BackupKind = now.getUTCDay() === 0 ? "weekly-full" : "daily-db";
    const result = await performBackup(ctx, kind);
    if (result.ok && kind === "weekly-full") await performMonthlyVerify(ctx, cfg);
    await checkMissedRuns(ctx, cfg);
    return { ran: true, kind, ok: result.ok };
  } finally {
    backupInProgress = false;
  }
}

/** Marks runs left in "running" by a crashed/restarted process as failed. */
export async function recoverStaleBackupRuns(ctx: Ctx): Promise<number> {
  const db = ctx.db<typeof schema>();
  const stale = await db.select({ id: schema.backupRuns.id }).from(schema.backupRuns).where(eq(schema.backupRuns.status, "running"));
  for (const row of stale) {
    await db.update(schema.backupRuns).set({ status: "failed", finishedAt: new Date(), error: "Server restarted mid-run; marked failed at startup." }).where(eq(schema.backupRuns.id, row.id));
  }
  return stale.length;
}

/**
 * Recurring-invoice scheduler entry point (called from server.mjs alongside
 * the backup tick). Uses the UNSCOPED db: the tick runs without a session and
 * must process schedules for every company. Finds active schedules with
 * next_run_date <= today (UTC), clones each template invoice with a fresh
 * INV number + new issue/due dates (same client, job, line items, amounts),
 * links the clone via parentInvoiceId/seriesId, notes the generated id on the
 * schedule, and advances next_run_date by one period. Never throws for a
 * single bad schedule: failures are logged and skipped.
 */
export async function runRecurringInvoiceTick(ctx: Ctx): Promise<{ ran: boolean; generated: number[] }> {
  const db = ctx.db<typeof schema>();
  const today = new Date().toISOString().slice(0, 10);
  const due = await db.select().from(schema.recurringInvoiceSchedules)
    .where(and(eq(schema.recurringInvoiceSchedules.active, true), lte(schema.recurringInvoiceSchedules.nextRunDate, today)));
  const generated: number[] = [];
  for (const schedule of due) {
    try {
      const template = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, schedule.invoiceId)).limit(1))[0];
      if (!template) {
        await db.update(schema.recurringInvoiceSchedules).set({ active: false }).where(eq(schema.recurringInvoiceSchedules.id, schedule.id));
        console.error(`[crewkat][recurring] schedule ${schedule.id}: template invoice ${schedule.invoiceId} missing; deactivating.`);
        continue;
      }
      const now = new Date();
      const invoiceNumber = await nextInvoiceNumber(db);
      const issueDate = schedule.nextRunDate;
      const dueDate = shiftDateByTemplateOffset(template.dueDate, template.issueDate, issueDate);
      const madeRows = await db.insert(schema.invoices).values({
        quoteId: template.quoteId, jobId: template.jobId, clientId: template.clientId,
        clientName: template.clientName, clientPhone: template.clientPhone, clientEmail: template.clientEmail,
        jobAddress: template.jobAddress, shippingAddress: template.shippingAddress, jobType: template.jobType,
        lineItemsJson: template.lineItemsJson, subtotal: template.subtotal,
        discountType: template.discountType, discountValue: template.discountValue,
        taxType: template.taxType, taxValue: template.taxValue, total: template.total, footnote: template.footnote,
        invoiceNumber, issueDate, dueDate, status: "draft",
        parentInvoiceId: template.id, seriesId: template.seriesId ?? template.id,
        theme: template.theme, font: template.font, accentColor: template.accentColor,
        showTaxLine: template.showTaxLine, showDiscountLine: template.showDiscountLine,
        showPaidLine: template.showPaidLine, showPaymentTerms: template.showPaymentTerms,
        showFooterNotes: template.showFooterNotes, showLogo: template.showLogo,
        showCompanyInfo: template.showCompanyInfo, customizeJson: template.customizeJson,
        createdAt: now, updatedAt: now,
      }).returning({ id: schema.invoices.id });
      const made = madeRows[0];
      if (!made) continue;
      await db.update(schema.recurringInvoiceSchedules).set({
        nextRunDate: advanceRecurringDate(schedule.nextRunDate, schedule.frequency),
        lastGeneratedInvoiceId: made.id,
      }).where(eq(schema.recurringInvoiceSchedules.id, schedule.id));
      generated.push(made.id);
      console.log(`[crewkat][recurring] schedule ${schedule.id}: generated invoice ${made.id} (${invoiceNumber}) for company ${schedule.companyId}.`);
    } catch (error) {
      console.error(`[crewkat][recurring] schedule ${schedule.id} failed:`, error);
    }
  }
  return { ran: generated.length > 0, generated };
}

// ---------------------------------------------------------------------------
// Estimate nudge scheduler entry point (called from server.mjs alongside the
// other ticks). Finds estimates that were sent, VIEWED (document link
// first_viewed_at), but not accepted within 3 days, and nudges exactly once
// per quote: a polite Resend email to the client when an email address is on
// file, otherwise an in-app notification telling the contractor to follow up.
// Never throws for a single bad quote: failures are logged and skipped.
// ---------------------------------------------------------------------------
export async function runEstimateNudgeTick(ctx: Ctx): Promise<{ ran: boolean; nudged: number[] }> {
  const db = ctx.db<typeof schema>();
  const cutoff = Date.now() - 3 * 86400000;
  const candidates = await db.select().from(schema.quotes).where(
    and(
      ne(schema.quotes.sentAt, ""),
      eq(schema.quotes.accepted, false),
      eq(schema.quotes.superseded, false),
      isNull(schema.quotes.estimateNudgeSentAt),
    ),
  );
  const nudged: number[] = [];
  for (const quote of candidates) {
    try {
      // Viewed? The client-facing document link for this quote tracks views.
      const link = (await db.select({ firstViewedAt: schema.documentLinks.firstViewedAt })
        .from(schema.documentLinks)
        .where(and(eq(schema.documentLinks.documentKind, "quote"), eq(schema.documentLinks.documentId, quote.id), isNull(schema.documentLinks.revokedAt)))
        .orderBy(desc(schema.documentLinks.createdAt))
        .limit(1))[0];
      const viewedAt = link?.firstViewedAt?.getTime() ?? null;
      if (!viewedAt || viewedAt > cutoff) continue;
      const now = new Date();
      const clientName = quote.clientName || "there";
      const companyName = await companyNameForNudge(db, quote.companyId);
      if (quote.clientEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(quote.clientEmail)) {
        const subject = `Still interested? Your estimate from ${companyName}`;
        const text = `Hi ${clientName},\n\nJust checking in — you viewed your estimate of $${quote.total} on ${new Date(viewedAt).toLocaleDateString()} and we wanted to make sure you had everything you need.\n\nReply to this email or give us a call and we'll take care of the rest.\n\nThanks!`;
        try {
          const result = await ctx.executePrivileged(privileged.sendNudgeEmail, { to: quote.clientEmail, subject, text });
          if (result.delivery !== "sent") throw new Error("email not sent");
        } catch (error) {
          console.error(`[crewkat][nudge] quote ${quote.id}: email failed, falling back to in-app notice:`, error);
          await notifyNudgeFallback(db, quote);
        }
      } else {
        await notifyNudgeFallback(db, quote);
      }
      await db.update(schema.quotes).set({ estimateNudgeSentAt: now }).where(eq(schema.quotes.id, quote.id));
      nudged.push(quote.id);
      console.log(`[crewkat][nudge] quote ${quote.id}: reminder sent.`);
    } catch (error) {
      console.error(`[crewkat][nudge] quote ${quote.id} failed:`, error);
    }
  }
  return { ran: nudged.length > 0, nudged };
}

async function companyNameForNudge(db: ReturnType<Ctx["db"]>, companyId: number): Promise<string> {
  try {
    const row = (await db.select({ companyName: schema.settings.companyName }).from(schema.settings).where(eq(schema.settings.companyId, companyId)).limit(1))[0];
    return row?.companyName?.trim() || "Crewkat";
  } catch {
    return "Crewkat";
  }
}

async function notifyNudgeFallback(db: ReturnType<Ctx["db"]>, quote: typeof schema.quotes.$inferSelect): Promise<void> {
  const users = await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.companyId, quote.companyId));
  for (const user of users) {
    try {
      await createUserNotification(db, user.id, "estimate-nudge", `Estimate viewed, no reply — follow up with ${quote.clientName}`, `Presupuesto visto sin respuesta — haz seguimiento con ${quote.clientName}`, `estimate:${quote.id}`);
    } catch { /* best-effort */ }
  }
}

// ---------------------------------------------------------------------------
// Phase 1: review-request scheduler entry point (called from server.mjs
// alongside the estimate-nudge tick). For jobs completed at least
// `reviewRequestDelayDays` ago (Settings, default 3), with review requests
// enabled and a review URL configured, emails the client a polite review ask
// exactly once per job — tracked in automation_logs (kind "review", channel
// "email"). Email-only: no SMS/Twilio. One bad job never throws the tick.
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendJobReviewEmail(ctx: Ctx, db: ReturnType<Ctx["db"]>, job: typeof schema.jobs.$inferSelect, stage: "auto" | "manual"): Promise<boolean> {
  const setting = (await db.select().from(schema.settings).where(eq(schema.settings.companyId, job.companyId)).limit(1))[0];
  const reviewUrl = (setting?.reviewUrl || "").trim();
  if (!reviewUrl) throw new Error("Add your review link in Settings first.");
  if (!job.clientEmail || !EMAIL_RE.test(job.clientEmail)) throw new Error("No client email on file for this job.");
  const already = (await db.select({ id: schema.automationLogs.id }).from(schema.automationLogs)
    .where(and(eq(schema.automationLogs.kind, "review"), eq(schema.automationLogs.channel, "email"), eq(schema.automationLogs.entityId, job.id)))
    .limit(1))[0];
  if (already) return false;
  const companyName = await companyNameForNudge(db, job.companyId);
  const clientName = job.clientName || "there";
  const subject = `How did we do? A quick review helps ${companyName}`;
  const text = `Hi ${clientName},\n\nThanks for trusting ${companyName} with your project. If you were happy with the work, a quick Google review would mean a lot to us — it takes less than a minute:\n\n${reviewUrl}\n\nThanks so much,\n${companyName}`;
  try {
    const result = await ctx.executePrivileged(privileged.sendNudgeEmail, { to: job.clientEmail, subject, text });
    if (result.delivery !== "sent") throw new Error("email not sent");
  } catch (error) {
    console.error(`[crewkat][reviews] job ${job.id}: email failed:`, error);
    throw error;
  }
  await db.insert(schema.automationLogs).values({ kind: "review", entityId: job.id, stage, channel: "email", sentAt: new Date() });
  return true;
}

export async function runReviewRequestTick(ctx: Ctx): Promise<{ ran: boolean; emailed: number[] }> {
  const db = ctx.db<typeof schema>();
  const emailed: number[] = [];
  const settingsRows = await db.select().from(schema.settings).where(eq(schema.settings.reviewRequestsEnabled, true));
  for (const setting of settingsRows) {
    try {
      if (!(setting.reviewUrl || "").trim()) continue;
      const delayDays = setting.reviewRequestDelayDays ?? 3;
      const cutoff = Date.now() - Math.max(0, delayDays) * 86400000;
      const jobs = await db.select().from(schema.jobs).where(
        and(
          eq(schema.jobs.companyId, setting.companyId),
          lte(schema.jobs.completedAt, new Date(cutoff)),
        ),
      );
      for (const job of jobs) {
        try {
          if (await sendJobReviewEmail(ctx, db, job, "auto")) {
            emailed.push(job.id);
            console.log(`[crewkat][reviews] job ${job.id}: review request emailed.`);
          }
        } catch (error) {
          console.error(`[crewkat][reviews] job ${job.id} failed:`, error);
        }
      }
    } catch (error) {
      console.error("[crewkat][reviews] company tick failed:", error);
    }
  }
  return { ran: emailed.length > 0, emailed };
}

const listingModerationResultSchema = z.object({ flagged: z.boolean(), status: moderationStatusSchema, reasons: z.array(z.string()) });

async function scanListingForModeration(db: ReturnType<Ctx["db"]>, input: { title: string; description: string; companyName: string; serviceArea: string }) {
  if (!(await isAutoModerationEnabled(db))) return { clean: true, reasons: [] as string[] };
  return scanListingText(input);
}

// ---------------------------------------------------------------------------
// Pinnable tools registry: tool ids match the Tools screen directory
// (ToolsHomeScreen). toolId format is `<screenName>` or `<screenName>:<tab>`.
// ---------------------------------------------------------------------------

type ToolRegistryEntry = { screen: string; tab: string | null; titleEn: string; titleEs: string; iconPath: string };

const TOOL_REGISTRY: Record<string, ToolRegistryEntry> = {
  "toolbox:loan": { screen: "toolbox", tab: "loan", titleEn: "Loan payment", titleEs: "Pago de préstamo", iconPath: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" },
  "toolbox:materials": { screen: "toolbox", tab: "materials", titleEn: "Material guide", titleEs: "Guía de materiales", iconPath: "M4 18h16M6 18V7h12v11M9 7V4h6v3" },
  "toolbox:angle": { screen: "toolbox", tab: "angle", titleEn: "Angles", titleEs: "Ángulos", iconPath: "M4 19h16L4 5zM8 15h5" },
  "toolbox:convert": { screen: "toolbox", tab: "convert", titleEn: "Unit converter", titleEs: "Convertidor de unidades", iconPath: "M5 8h13M15 5l3 3-3 3M19 16H6M9 13l-3 3 3 3" },
  "toolbox:area": { screen: "toolbox", tab: "area", titleEn: "Measurements", titleEs: "Medidas", iconPath: "M4 4h16v16H4zM8 4v16M4 10h16" },
  "toolbox:yards": { screen: "toolbox", tab: "yards", titleEn: "Concrete", titleEs: "Concreto", iconPath: "M4 8h16v10H4zM4 12h16M9 8v10M15 8v10" },
  "toolbox:board": { screen: "toolbox", tab: "board", titleEn: "Lumber", titleEs: "Madera", iconPath: "M4 7h16v10H4zM8 7v10M13 7v10" },
  "toolbox:drywall": { screen: "toolbox", tab: "drywall", titleEn: "Drywall sheets", titleEs: "Paneles de yeso", iconPath: "M5 4h14v16H5zM9 4v16M5 10h14" },
  "toolbox:roofing": { screen: "toolbox", tab: "roofing", titleEn: "Roofing squares", titleEs: "Techos", iconPath: "M3 13 12 4l9 9M6 11v9h12v-9" },
  "toolbox:tile": { screen: "toolbox", tab: "tile", titleEn: "Tile boxes", titleEs: "Cajas de loseta", iconPath: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" },
  "toolbox:margin": { screen: "toolbox", tab: "margin", titleEn: "Markup & margin", titleEs: "Margen y recargo", iconPath: "M6 18 18 6M7 7h.01M17 17h.01" },
  "toolbox:paint": { screen: "toolbox", tab: "paint", titleEn: "Paint estimator", titleEs: "Estimador de pintura", iconPath: "M4 4h13v4H4zM17 6v5h3M7 10v10h3V10" },
  "toolbox:flooring": { screen: "toolbox", tab: "flooring", titleEn: "Flooring boxes", titleEs: "Cajas de piso", iconPath: "M4 4h16v16H4zM4 9h16M4 14h16M9 4v16M14 4v16" },
  "toolbox:fence": { screen: "toolbox", tab: "fence", titleEn: "Fence & deck", titleEs: "Cerca y deck", iconPath: "M4 20V6M8 20V6M12 20V6M16 20V6M20 20V6M3 10h18M3 15h18" },
  "toolbox:block": { screen: "toolbox", tab: "block", titleEn: "Block & pavers", titleEs: "Bloques y adoquines", iconPath: "M4 10h7V4H4zM13 10h7V4h-7zM4 20h7v-6H4zM13 20h7v-6h-7z" },
  "toolbox:gravel": { screen: "toolbox", tab: "gravel", titleEn: "Gravel & soil", titleEs: "Grava y tierra", iconPath: "M4 15 9 6l5 6 3-4 3 7zM4 20h16" },
  "toolbox:stairs": { screen: "toolbox", tab: "stairs", titleEn: "Stair stringer", titleEs: "Zanca de escalera", iconPath: "M4 20h4v-4h4v-4h4V8h4V4" },
  "toolbox:insulation": { screen: "toolbox", tab: "insulation", titleEn: "Insulation batts", titleEs: "Aislante en rollos", iconPath: "M5 20c3-2 3-6 0-8 3-2 3-6 0-8M12 20c3-2 3-6 0-8 3-2 3-6 0-8M19 20c3-2 3-6 0-8 3-2 3-6 0-8" },
  "toolbox:gutter": { screen: "toolbox", tab: "gutter", titleEn: "Gutter & downspouts", titleEs: "Canalones y bajantes", iconPath: "M4 6h16v4H4zM17 10v8h-4M17 18H6" },
  "toolbox:rate": { screen: "toolbox", tab: "rate", titleEn: "Billable rate", titleEs: "Tarifa facturable", iconPath: "M12 3v18M7 7h7a2 2 0 0 1 0 4H9a2 2 0 0 0 0 4h8" },
  "toolbox:punchlist": { screen: "toolbox", tab: "punchlist", titleEn: "Punch list", titleEs: "Lista de pendientes", iconPath: "M4 5h16M4 12h16M4 19h16M18 3l3 3-3 3" },
  "businessTools:price": { screen: "businessTools", tab: "price", titleEn: "Saved prices", titleEs: "Precios guardados", iconPath: "M5 5h14v14H5zM8 9h8M8 13h5" },
  "businessTools:templates": { screen: "businessTools", tab: "templates", titleEn: "Quote templates", titleEs: "Plantillas de presupuestos", iconPath: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" },
  "businessTools:mileage": { screen: "businessTools", tab: "mileage", titleEn: "Mileage", titleEs: "Millaje", iconPath: "M5 18c4-8 10-8 14-12M5 18h5M19 6h-5" },
  "businessTools:expenses": { screen: "businessTools", tab: "expenses", titleEn: "Expenses & receipts", titleEs: "Gastos y recibos", iconPath: "M4 6h16v14H4zM8 3v6M16 3v6" },
  "expansion:warranties": { screen: "expansion", tab: "warranties", titleEn: "Warranties", titleEs: "Garantías", iconPath: "M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-5" },
  "expansion:scanner": { screen: "expansion", tab: "scanner", titleEn: "Document scanner", titleEs: "Escáner de documentos", iconPath: "M6 3h12v18H6zM9 7h6M4 16h16" },
  "reports": { screen: "reports", tab: null, titleEn: "Reports", titleEs: "Informes", iconPath: "M4 20V10M10 20V4M16 20v-7M22 20V7" },
  "operations:calendar": { screen: "operations", tab: "calendar", titleEn: "Schedule", titleEs: "Calendario", iconPath: "M5 5h14v15H5zM8 3v4M16 3v4M8 11h3M13 11h3" },
  "followups": { screen: "followups", tab: null, titleEn: "Collections & follow-ups", titleEs: "Cobros y seguimientos", iconPath: "M12 7v5l3 2M4 12a8 8 0 1 0 2-5" },
  "fieldIntelligence:purchasing": { screen: "fieldIntelligence", tab: "purchasing", titleEn: "Orders waiting on suppliers", titleEs: "Pedidos esperando proveedores", iconPath: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" },
  "fieldIntelligence:equipment": { screen: "fieldIntelligence", tab: "equipment", titleEn: "Equipment", titleEs: "Equipo", iconPath: "M7 7h10v10H7zM4 10h3M17 10h3M10 4v3M10 17v3" },
  "expansion:plans": { screen: "expansion", tab: "plans", titleEn: "Equipment upkeep", titleEs: "Cuidado del equipo", iconPath: "M4 18h16M7 18v-5l5-4 5 4v5M9 8V4h6v4" },
  "fieldIntelligence:safety": { screen: "fieldIntelligence", tab: "safety", titleEn: "Safety & incidents", titleEs: "Seguridad e incidentes", iconPath: "M12 3l8 4v5c0 5-3 8-8 10-5-2-8-5-8-10V7zM9 12l2 2 4-5" },
  "fieldIntelligence:credentials": { screen: "fieldIntelligence", tab: "credentials", titleEn: "Licenses & certificates", titleEs: "Licencias y certificados", iconPath: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" },
  "fieldIntelligence:payroll": { screen: "fieldIntelligence", tab: "payroll", titleEn: "Payroll", titleEs: "Nómina", iconPath: "M4 7h16v12H4zM8 11h8M8 15h5" },
  "expansion:crew": { screen: "expansion", tab: "crew", titleEn: "Crew hours", titleEs: "Horas del equipo", iconPath: "M12 7v5l3 2M4 12a8 8 0 1 0 2-5" },
};

// INV-0001+ sequence (migration 0038): the next invoice number is derived
// from max(existing invoice id) + 1, shared by manual invoice creation,
// quote→invoice conversion, and the recurring-invoice scheduler.
async function nextInvoiceNumber(db: ReturnType<Ctx["db"]>): Promise<string> {
  const existing = await db.select({ id: schema.invoices.id }).from(schema.invoices);
  return `INV-${String(Math.max(0, ...existing.map((row) => row.id)) + 1).padStart(4, "0")}`;
}


// Keep the template's issue→due offset when cloning an invoice for a new run.
function shiftDateByTemplateOffset(templateDue: string, templateIssue: string, newIssue: string): string {
  if (!templateDue || !templateIssue) return "";
  const offsetMs = new Date(`${templateDue}T12:00:00`).getTime() - new Date(`${templateIssue}T12:00:00`).getTime();
  if (!Number.isFinite(offsetMs)) return "";
  return new Date(new Date(`${newIssue}T12:00:00`).getTime() + offsetMs).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Chunk D: marketplace alerts, in-app notifications, web push triggers.
// ---------------------------------------------------------------------------

interface AlertListingInfo {
  id: number;
  title: string;
  description: string;
  category: string;
  serviceArea: string;
  authorUserId: number;
}

/** True when an alert matches a listing (keyword substring, case-insensitive). */
export function alertMatchesListing(alert: { keyword: string; category: string | null; serviceArea: string | null }, listing: { title: string; description: string; category: string; serviceArea: string }): boolean {
  const keyword = alert.keyword.trim().toLowerCase();
  if (!keyword) return false;
  const haystack = `${listing.title}\n${listing.description}`.toLowerCase();
  if (!haystack.includes(keyword)) return false;
  if (alert.category && alert.category !== listing.category) return false;
  if (alert.serviceArea && !listing.serviceArea.toLowerCase().includes(alert.serviceArea.trim().toLowerCase())) return false;
  return true;
}

async function createUserNotification(db: ReturnType<Ctx["db"]>, userId: number, kind: string, titleEn: string, titleEs: string, link: string): Promise<number | null> {
  const existing = (await db.select({ id: schema.userNotifications.id }).from(schema.userNotifications)
    .where(and(eq(schema.userNotifications.userId, userId), eq(schema.userNotifications.kind, kind), eq(schema.userNotifications.link, link))).limit(1))[0];
  if (existing) return null;
  const rows = await db.insert(schema.userNotifications).values({ userId, kind, titleEn, titleEs, link, isRead: false, createdAt: new Date() }).returning({ id: schema.userNotifications.id });
  return rows[0]?.id ?? null;
}

// ---- Build 2: per-company notification preferences ----
// Reads the company's settings row; every event defaults to enabled so
// existing behavior is preserved for companies that never touch the toggles.
type NotifyPrefKey = "notifyNewMessage" | "notifyDocSigned" | "notifyInvoiceViewed" | "notifyEstimateViewed";

async function getNotifyPrefs(db: ReturnType<Ctx["db"]>, companyId: number): Promise<Record<NotifyPrefKey, boolean> & { language: "en" | "es" }> {
  const row = (await db.select().from(schema.settings).where(eq(schema.settings.companyId, companyId)).limit(1))[0];
  return {
    notifyNewMessage: row?.notifyNewMessage ?? true,
    notifyDocSigned: row?.notifyDocSigned ?? true,
    notifyInvoiceViewed: row?.notifyInvoiceViewed ?? true,
    notifyEstimateViewed: row?.notifyEstimateViewed ?? true,
    language: row?.language === "es" ? "es" : "en",
  };
}

// Notifies every user of a company about an event: in-app notification +
// web push. Gated on the company's notification preference. Best-effort:
// never throws, and push no-ops when VAPID keys aren't configured.
async function notifyCompanyEvent(
  ctx: Ctx,
  companyId: number,
  pref: NotifyPrefKey,
  kind: string,
  titleEn: string,
  titleEs: string,
  link: string,
): Promise<void> {
  try {
    const db = ctx.db<typeof schema>();
    const prefs = await getNotifyPrefs(db, companyId);
    if (!prefs[pref]) return;
    const users = await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.companyId, companyId));
    for (const user of users) {
      try { await createUserNotification(db, user.id, kind, titleEn, titleEs, link); } catch { /* best-effort */ }
    }
    await sendPushToCompany(db, companyId, { titleEn: "Crewkat", titleEs: "Crewkat", bodyEn: titleEn, bodyEs: titleEs, url: "/" });
  } catch { /* best-effort: notification failures must never break the triggering action */ }
}

/**
 * Matches a newly-visible listing against every user's saved alerts and
 * notifies matches: in-app notification + web push + Resend email.
 * Only `approved`/visible listings trigger — callers gate on that.
 * Best-effort: never throws.
 */
export async function notifyAlertMatches(ctx: Ctx, listing: AlertListingInfo): Promise<void> {
  try {
    const db = ctx.db<typeof schema>();
    const alerts = await db.select().from(schema.marketplaceAlerts);
    const matched = alerts.filter((alert) => alert.userId !== listing.authorUserId && alertMatchesListing(alert, listing));
    if (!matched.length) return;
    const link = `marketplace:${listing.id}`;
    const userIds = [...new Set(matched.map((alert) => alert.userId))];
    for (const userId of userIds) {
      try {
        const titleEn = `New match: ${listing.title}`;
        const titleEs = `Nueva coincidencia: ${listing.title}`;
        const created = await createUserNotification(db, userId, "alert_match", titleEn, titleEs, link);
        if (!created) continue;
        await sendPushToUser(db, userId, {
          titleEn, titleEs,
          bodyEn: listing.serviceArea, bodyEs: listing.serviceArea,
          url: "/app/", listingId: listing.id,
        });
        const user = (await db.select({ email: schema.authUsers.email }).from(schema.authUsers).where(eq(schema.authUsers.id, userId)).limit(1))[0];
        if (user?.email) {
          await ctx.executePrivileged(privileged.sendSecurityAlert, {
            to: user.email,
            subject: titleEn,
            text: `${titleEn}\n${titleEs}\n\n${listing.title}\n${listing.serviceArea}\n\nView it in Crewkat: ${appPublicUrl()}/app`,
          });
        }
      } catch { /* per-user notification is best-effort */ }
    }
  } catch { /* alert matching never fails the listing flow */ }
}

// ---------------------------------------------------------------------------
// Phase 2: per-job messaging + Bid Board helpers.
// ---------------------------------------------------------------------------
const bidBoardStageSchema = z.enum(["interested", "estimating", "submitted", "won", "lost"]);

async function requireJobCompany(ctx: Ctx, db: ReturnType<Ctx["db"]>, jobId: number) {
  const identity = workspaceIdentity(ctx);
  const job = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1))[0];
  if (!job || job.companyId !== identity.workspaceCompanyId) throw new Error("Job not found.");
  return { identity, job };
}

// Free tier usage ceilings — the conversion engine. Free users get a complete
// experience for a small operation; the paywall hits exactly when they're busy.
const FREE_TIER_LIMITS = { maxActiveJobs: 3, maxInvoicesPerMonth: 5 } as const;

async function getFreeTierUsage(db: ReturnType<Ctx["db"]>, companyId: number) {
  const now = new Date();
  // Month boundary is UTC (server time). Simple, deterministic, and documented.
  // A per-company business timezone can replace this later without changing callers.
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [activeJobs, monthlyInvoices] = await Promise.all([
    db.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.companyId, companyId), isNull(schema.jobs.completedAt), eq(schema.jobs.isSample, false))),
    db.select({ id: schema.invoices.id }).from(schema.invoices).where(and(eq(schema.invoices.companyId, companyId), gte(schema.invoices.createdAt, monthStart))),
  ]);
  return {
    activeJobs: activeJobs.length,
    invoicesThisMonth: monthlyInvoices.length,
    maxActiveJobs: FREE_TIER_LIMITS.maxActiveJobs,
    maxInvoicesPerMonth: FREE_TIER_LIMITS.maxInvoicesPerMonth,
  };
}

function assertFreeTierLimit(usage: { activeJobs: number; invoicesThisMonth: number }, kind: "job" | "invoice") {
  if (kind === "job" && usage.activeJobs >= FREE_TIER_LIMITS.maxActiveJobs) {
    throw new Error("FREE_JOB_LIMIT:You've reached 3 active jobs on the free plan. Upgrade to Pro for unlimited jobs.");
  }
  if (kind === "invoice" && usage.invoicesThisMonth >= FREE_TIER_LIMITS.maxInvoicesPerMonth) {
    throw new Error("FREE_INVOICE_LIMIT:You've sent 5 invoices this month on the free plan. Upgrade to Pro for unlimited invoicing.");
  }
}

// Reusable: throws for free-tier users at their invoice ceiling. Used by every
// user-initiated invoice creation path (save, convert, duplicate). The recurring
// scheduler is deliberately excluded — it fulfills existing commitments.
async function assertInvoiceLimit(ctx: Ctx, db: ReturnType<Ctx["db"]>) {
  const identity = workspaceIdentity(ctx);
  const tierRow = (await db.select({ tier: schema.authUsers.tier }).from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
  if ((tierRow?.tier ?? "free") !== "premium") {
    assertFreeTierLimit(await getFreeTierUsage(db, identity.workspaceCompanyId), "invoice");
  }
}

async function assertJobLimit(ctx: Ctx, db: ReturnType<Ctx["db"]>) {
  const identity = workspaceIdentity(ctx);
  const tierRow = (await db.select({ tier: schema.authUsers.tier }).from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
  if ((tierRow?.tier ?? "free") !== "premium") {
    assertFreeTierLimit(await getFreeTierUsage(db, identity.workspaceCompanyId), "job");
  }
}

async function jobMessageShape(ctx: Ctx, m: typeof schema.jobMessages.$inferSelect) {
  return {
    id: m.id,
    jobId: m.jobId,
    sender: m.sender,
    body: m.body,
    imageUrl: m.imageBlobKey ? await ctx.blobs.getUrl(m.imageBlobKey) : null,
    voiceUrl: m.voiceBlobKey ? await ctx.blobs.getUrl(m.voiceBlobKey) : null,
    voiceDurationSeconds: m.voiceDurationSeconds,
    createdAt: m.createdAt.toISOString(),
  };
}

// Server-side helper: append a system row to a job's message thread. Used on
// lifecycle events (job created/completed, estimate sent). Never throws.
async function logJobSystemMessage(db: ReturnType<Ctx["db"]>, jobId: number, bodyEn: string, bodyEs: string) {
  try {
    await db.insert(schema.jobMessages).values({ jobId, sender: "system", body: `${bodyEn} / ${bodyEs}`, createdAt: new Date() });
  } catch { /* system events are best-effort */ }
}

// ---------------------------------------------------------------------------
// Phase 2: weekly progress email tick (called from server.mjs alongside the
// review-request tick). For companies with weekly_progress_enabled, emails the
// client a digest of the past 7 days of client-shared daily logs, exactly once
// per job per week — tracked in automation_logs (kind "weekly_progress").
// Email-only. One bad job never throws the tick.
// ---------------------------------------------------------------------------
export async function runWeeklyProgressTick(ctx: Ctx): Promise<{ ran: boolean; emailed: number[] }> {
  const db = ctx.db<typeof schema>();
  const emailed: number[] = [];
  const settingsRows = await db.select().from(schema.settings).where(eq(schema.settings.weeklyProgressEnabled, true));
  const weekAgo = Date.now() - 7 * 86400000;
  const sentCutoff = new Date(Date.now() - 6 * 86400000);
  for (const setting of settingsRows) {
    try {
      const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.companyId, setting.companyId));
      for (const job of jobs) {
        try {
          if (!job.clientEmail || !EMAIL_RE.test(job.clientEmail)) continue;
          const already = (await db.select({ id: schema.automationLogs.id }).from(schema.automationLogs)
            .where(and(eq(schema.automationLogs.kind, "weekly_progress"), eq(schema.automationLogs.entityId, job.id), gte(schema.automationLogs.sentAt, sentCutoff)))
            .limit(1))[0];
          if (already) continue;
          const logs = (await db.select().from(schema.dailyLogs).where(eq(schema.dailyLogs.jobId, job.id)))
            .filter((l) => l.sharedWithClient && l.createdAt.getTime() >= weekAgo)
            .sort((a, b) => a.logDate.localeCompare(b.logDate));
          if (!logs.length) continue;
          const companyName = await companyNameForNudge(db, job.companyId);
          const lines = logs.map((l) => {
            const parts = [`${l.logDate}: ${l.clientSummary || l.notes || ""}`.trim()];
            if (l.hours && l.hours !== "0") parts.push(`(${l.hours}h)`);
            return `- ${parts.join(" ")}`;
          });
          const subject = `Weekly progress update — ${job.jobType} at ${job.jobAddress}`;
          const text = `Hi ${job.clientName || "there"},\n\nHere's what happened on your project this week with ${companyName}:\n\n${lines.join("\n")}\n\nQuestions? Just reply to this email.\n\nThanks,\n${companyName}`;
          const result = await ctx.executePrivileged(privileged.sendNudgeEmail, { to: job.clientEmail, subject, text });
          if (result.delivery !== "sent") throw new Error("email not sent");
          await db.insert(schema.automationLogs).values({ kind: "weekly_progress", entityId: job.id, stage: "auto", channel: "email", sentAt: new Date() });
          emailed.push(job.id);
          console.log(`[crewkat][progress] job ${job.id}: weekly digest emailed.`);
        } catch (error) {
          console.error(`[crewkat][progress] job ${job.id} failed:`, error);
        }
      }
    } catch (error) {
      console.error("[crewkat][progress] company tick failed:", error);
    }
  }
  return { ran: emailed.length > 0, emailed };
}

// ---------------------------------------------------------------------------
// Marketplace private conversations.
// One thread per (listing, inquirer company). Participants are the listing's
// owner company and the inquiring company; anyone else gets a generic
// "not found" so conversation ids can't be probed. Read state is
// per-participant on the conversation row and is never exposed to the other
// party — there are deliberately no read receipts anywhere in this flow.
// ---------------------------------------------------------------------------
type MarketplaceConversationRow = typeof schema.marketplaceConversations.$inferSelect;

async function marketplaceConversationOrThrow(db: ReturnType<Ctx["db"]>, conversationId: number, myCompanyId: number): Promise<MarketplaceConversationRow> {
  const conversation = (await db.select().from(schema.marketplaceConversations).where(eq(schema.marketplaceConversations.id, conversationId)).limit(1))[0];
  if (!conversation || (conversation.ownerCompanyId !== myCompanyId && conversation.inquirerCompanyId !== myCompanyId)) {
    throw new Error("Conversation not found.");
  }
  return conversation;
}

async function marketplaceCompanyNames(db: ReturnType<Ctx["db"]>, companyIds: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(companyIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return new Map();
  const rows = await db.select({ companyId: schema.settings.companyId, companyName: schema.settings.companyName }).from(schema.settings).where(inArray(schema.settings.companyId, unique));
  return new Map(rows.map((row) => [row.companyId, row.companyName || `Company ${row.companyId}`]));
}

export const BaseActions = {
  // Phase 4: Google Play Billing (TWA). Spread first so the core actions below
  // keep their existing order and names unchanged.
  ...playBillingActions,
  getAuthBootstrap: defineAction({
    request: z.object({}),
    response: z.object({ hasAccount: z.boolean(), ownerClaimAvailable: z.boolean(), recordCounts: z.object({ jobs: z.number(), clients: z.number(), invoices: z.number() }) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const users = await db.select({ id: schema.authUsers.id }).from(schema.authUsers).limit(1);
      if (users.length) return { hasAccount: true, ownerClaimAvailable: false, recordCounts: { jobs: 0, clients: 0, invoices: 0 } };
      const [jobRows, clientRows, invoiceRows] = await Promise.all([
        db.select({ id: schema.jobs.id }).from(schema.jobs),
        db.select({ id: schema.clients.id }).from(schema.clients),
        db.select({ id: schema.invoices.id }).from(schema.invoices),
      ]);
      return { hasAccount: false, ownerClaimAvailable: true, recordCounts: { jobs: jobRows.length, clients: clientRows.length, invoices: invoiceRows.length } };
    },
  }),
  signUp: defineAction({
    request: z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200), password: z.string().min(10).max(200), marketplaceTermsAccepted: z.literal(true, { error: "You must agree to the Marketplace Terms of Use to create an account." }), referralCode: z.string().trim().max(16).optional() }),
    response: z.object({ ok: z.literal(true), email: z.string(), verificationCode: z.string().length(6).nullable(), emailDelivery: authCodeDeliverySchema, existingDataClaimed: z.boolean() }),
    privileged: [privileged.sendAuthEmail],
    async handler(ctx, args): Promise<{ ok: true; email: string; verificationCode: string | null; emailDelivery: "sent" | "fallback" | "failed"; existingDataClaimed: boolean }> {
      const db = ctx.db<typeof schema>();
      if (!(await getBooleanPlatformSetting(db, "registration_enabled"))) throw new Error("REGISTRATIONS_CLOSED");
      const users = await db.select({ id: schema.authUsers.id, companyId: schema.authUsers.companyId }).from(schema.authUsers);
      const email = normalizedEmail(args.email);
      const duplicate = (await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.email, email)).limit(1))[0];
      if (duplicate) throw new Error("An account with this email already exists. Sign in instead.");
      const salt = randomHex(16);
      const now = new Date();
      const firstAccount = users.length === 0;
      const companyId = firstAccount ? 1 : Math.max(1, ...users.map((user) => user.companyId)) + 1;
      const counts = firstAccount ? await Promise.all([db.select({ id: schema.jobs.id }).from(schema.jobs), db.select({ id: schema.clients.id }).from(schema.clients), db.select({ id: schema.invoices.id }).from(schema.invoices)]) : [[], [], []];
      const referralCode = await uniqueReferralCode(db);
      const made = (await db.insert(schema.authUsers).values({ name: args.name.trim(), email, passwordHash: await derivePassword(args.password, salt, AUTH_PASSWORD_ITERATIONS), passwordSalt: salt, passwordIterations: AUTH_PASSWORD_ITERATIONS, companyId, role: "owner", tier: firstAccount ? "premium" : "free", subscriptionStatus: firstAccount ? "founder" : "inactive", marketplaceTermsAcceptedAt: now, marketplaceTermsVersion: MARKETPLACE_TERMS_VERSION, referralCode, createdAt: now, updatedAt: now }).returning({ id: schema.authUsers.id }))[0];
      if (!made) throw new Error("The account could not be created.");
      // Referral loop: record the event now (rewarded=false); the +5 listing
      // bonus lands when the referred user completes email verification.
      const referrerCode = normalizeReferralCode(args.referralCode);
      if (referrerCode) {
        try {
          const referrer = (await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.referralCode, referrerCode)).limit(1))[0];
          if (referrer && referrer.id !== made.id) {
            await db.insert(schema.referralEvents).values({ referrerUserId: referrer.id, referredUserId: made.id, rewarded: false, createdAt: now });
          }
        } catch { /* referral tracking is best-effort; never fail signup */ }
      }
      const code = await issueAuthCode(ctx, made.id, "verify_email");
      const delivery = await deliverAuthCode(ctx, email, code, "verify_email");
      return { ok: true, email, verificationCode: delivery.displayCode, emailDelivery: delivery.emailDelivery, existingDataClaimed: counts.some((rows) => rows.length > 0) };
    },
  }),
  verifyEmail: defineAction({
    request: z.object({ email: z.string().trim().email().max(200), code: z.string().regex(/^\d{6}$/) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>(); const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, normalizedEmail(args.email))).limit(1))[0];
      if (!user) throw new Error("That verification code is not valid.");
      const tokens = await db.select().from(schema.authTokens).where(and(eq(schema.authTokens.userId, user.id), eq(schema.authTokens.purpose, "verify_email"), isNull(schema.authTokens.consumedAt))).orderBy(desc(schema.authTokens.createdAt));
      const token = tokens[0];
      if (!token || token.expiresAt.getTime() <= Date.now() || token.tokenHash !== await sha256(args.code)) throw new Error("That verification code is invalid or expired.");
      const now = new Date();
      await db.batch([db.update(schema.authTokens).set({ consumedAt: now }).where(eq(schema.authTokens.id, token.id)), db.update(schema.authUsers).set({ emailVerifiedAt: now, dataClaimedAt: now, updatedAt: now }).where(eq(schema.authUsers.id, user.id))]);
      // Referral reward: the account is now active, so credit the referrer's
      // company with +5 bonus marketplace listings (once per referred user).
      try {
        const event = (await db.select().from(schema.referralEvents).where(and(eq(schema.referralEvents.referredUserId, user.id), eq(schema.referralEvents.rewarded, false))).limit(1))[0];
        if (event) {
          const referrer = (await db.select({ companyId: schema.authUsers.companyId }).from(schema.authUsers).where(eq(schema.authUsers.id, event.referrerUserId)).limit(1))[0];
          if (referrer) {
            const row = (await db.select({ id: schema.settings.id }).from(schema.settings).where(eq(schema.settings.companyId, referrer.companyId)).limit(1))[0];
            if (row) {
              await db.update(schema.settings).set({ listingBonus: sql`${schema.settings.listingBonus} + 5`, updatedAt: now }).where(eq(schema.settings.id, row.id));
            } else {
              await db.insert(schema.settings).values({ companyId: referrer.companyId, companyName: "", listingBonus: 5, updatedAt: now });
            }
          }
          await db.update(schema.referralEvents).set({ rewarded: true }).where(eq(schema.referralEvents.id, event.id));
        }
      } catch { /* referral reward is best-effort; never fail verification */ }
      return { ok: true };
    },
  }),
  resendVerification: defineAction({
    request: z.object({ email: z.string().trim().email().max(200) }),
    response: z.object({ ok: z.literal(true), verificationCode: z.string().length(6).nullable(), emailDelivery: authCodeDeliverySchema }),
    privileged: [privileged.sendAuthEmail],
    async handler(ctx, args): Promise<{ ok: true; verificationCode: string | null; emailDelivery: "sent" | "fallback" | "failed" }> {
      const email = normalizedEmail(args.email);
      const user = (await ctx.db<typeof schema>().select().from(schema.authUsers).where(eq(schema.authUsers.email, email)).limit(1))[0];
      if (!user || user.emailVerifiedAt) return { ok: true, verificationCode: null, emailDelivery: "sent" };
      const code = await issueAuthCode(ctx, user.id, "verify_email");
      const delivery = await deliverAuthCode(ctx, email, code, "verify_email");
      return { ok: true, verificationCode: delivery.displayCode, emailDelivery: delivery.emailDelivery };
    },
  }),
  login: defineAction({
    request: z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) }),
    response: z.object({ sessionToken: z.string(), expiresAt: z.string(), user: authUserSchema, setCookies: z.array(z.string()) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>(); const email = normalizedEmail(args.email); const cutoff = Date.now() - 15 * 60_000;
      const attempts = await db.select().from(schema.authLoginAttempts).where(eq(schema.authLoginAttempts.email, email)).orderBy(desc(schema.authLoginAttempts.attemptedAt));
      if (attempts.filter((row) => row.attemptedAt.getTime() >= cutoff).length >= 5) throw new Error("Too many sign-in attempts. Try again in 15 minutes.");
      const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, email)).limit(1))[0];
      const valid = user ? (await derivePassword(args.password, user.passwordSalt, user.passwordIterations)) === user.passwordHash : false;
      if (!user || !valid) { await db.insert(schema.authLoginAttempts).values({ email, attemptedAt: new Date() }); throw new Error("Email or password is incorrect."); }
      if (!user.emailVerifiedAt) throw new Error("Verify your email before signing in.");
      if (user.suspendedAt) throw new Error("This account has been suspended. Contact support for help.");
      await db.delete(schema.authLoginAttempts).where(eq(schema.authLoginAttempts.email, email));
      const session = await issueSession(ctx, user.id);
      return { sessionToken: session.proof, expiresAt: session.proofExpiresAt.toISOString(), user: authUserShape(user, await getPlatformSetting(db, "announcement_banner", "")), setCookies: session.setCookies };
    },
  }),
  // Exchanges the HttpOnly refresh cookie for a fresh 15-minute proof. Public:
  // authenticated by the cookie, not the request body.
  refreshSession: defineAction({
    request: z.object({}),
    response: z.object({ sessionToken: z.string(), expiresAt: z.string(), user: authUserSchema, setCookies: z.array(z.string()) }),
    async handler(ctx) {
      const meta = authMeta(ctx);
      const db = ctx.db<typeof schema>();
      if (refreshRateLimited(meta.ipHash ?? "unknown")) throw new Error("Too many requests. Try again in a minute.");
      const presented = meta.refreshToken;
      if (!presented) throw new Error("Sign in to continue.");
      const presentedHash = await sha256(presented);
      const row = (await db.select().from(schema.authSessions).where(eq(schema.authSessions.tokenHash, presentedHash)).limit(1))[0];
      if (!row || row.tokenType !== "refresh") throw new Error("Sign in to continue.");
      const now = Date.now();
      if (row.revokedAt) {
        if (row.replacedBy && now - row.revokedAt.getTime() <= AUTH_REFRESH_REUSE_GRACE_MS) {
          // Concurrent refresh race: the successor already exists; rotate from it.
          const successor = (await db.select().from(schema.authSessions).where(eq(schema.authSessions.tokenHash, row.replacedBy)).limit(1))[0];
          if (successor && !successor.revokedAt && successor.expiresAt.getTime() > now) {
            const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, successor.userId)).limit(1))[0];
            if (!user?.emailVerifiedAt) throw new Error("Sign in to continue.");
            if (user.suspendedAt) throw new Error("This account has been suspended. Contact support for help.");
            const issued = await issueProofForRefresh(ctx, db, successor, false);
            return { sessionToken: issued.proof, expiresAt: issued.proofExpiresAt.toISOString(), user: authUserShape(user, await getPlatformSetting(db, "announcement_banner", "")), setCookies: issued.setCookies };
          }
        }
        if (row.replacedBy) {
          // Reuse of a rotated token outside the grace window: token theft.
          await revokeSessionFamily(db, row.familyId, row.userId);
          const user = (await db.select({ id: schema.authUsers.id, email: schema.authUsers.email, name: schema.authUsers.name }).from(schema.authUsers).where(eq(schema.authUsers.id, row.userId)).limit(1))[0];
          if (user?.email) {
            const when = new Date(now).toISOString();
            try {
              await ctx.executePrivileged(privileged.sendSecurityAlert, {
                to: user.email,
                subject: "Crewkat security alert: signed out everywhere",
                text: `Hi ${user.name || "there"},\n\nWe spotted activity that looked like a stolen sign-in token for your Crewkat account (${when}). As a precaution we've signed you out on all devices.\n\nIf that was you, just sign in again. If not, we recommend changing your password right away.\n\n— The Crewkat team`,
              });
            } catch { /* alert best-effort; family is already revoked */ }
          }
          throw new Error("We spotted unusual sign-in activity and signed you out on all devices. Sign in again.");
        }
        // Revoked without replacement (logout / password reset): session is over.
        throw new Error("Sign in to continue.");
      }
      if (row.expiresAt.getTime() <= now || (row.absoluteExpiresAt && row.absoluteExpiresAt.getTime() <= now)) throw new Error("Your session has expired. Sign in again.");
      const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, row.userId)).limit(1))[0];
      if (!user?.emailVerifiedAt) throw new Error("Sign in to continue.");
      if (user.suspendedAt) throw new Error("This account has been suspended. Contact support for help.");
      const rotate = now - row.createdAt.getTime() >= AUTH_REFRESH_ROTATE_MINUTES * 60_000;
      const issued = await issueProofForRefresh(ctx, db, row, rotate);
      return { sessionToken: issued.proof, expiresAt: issued.proofExpiresAt.toISOString(), user: authUserShape(user, await getPlatformSetting(db, "announcement_banner", "")), setCookies: issued.setCookies };
    },
  }),
  logout: defineAction({
    request: z.object({ _sessionToken: z.string().min(32).max(300).optional() }),
    response: z.object({ ok: z.literal(true), setCookies: z.array(z.string()) }),
    async handler(ctx, args): Promise<{ ok: true; setCookies: string[] }> {
      const db = ctx.db<typeof schema>(); const meta = authMeta(ctx);
      // Revoke via the cookie refresh token when present (primary), else via
      // the body proof/legacy token (transition compat).
      let revoked = false;
      if (meta.refreshToken) {
        const row = (await db.select().from(schema.authSessions).where(eq(schema.authSessions.tokenHash, await sha256(meta.refreshToken))).limit(1))[0];
        if (row?.tokenType === "refresh") { await revokeSessionFamily(db, row.familyId, row.userId); revoked = true; }
      }
      if (!revoked && args._sessionToken) {
        const row = (await db.select().from(schema.authSessions).where(eq(schema.authSessions.tokenHash, await sha256(args._sessionToken))).limit(1))[0];
        if (row) { await revokeSessionFamily(db, row.familyId, row.userId); revoked = true; }
      }
      return { ok: true as const, setCookies: [clearRefreshCookieHeader(cookieSecure(ctx))] };
    },
  }),
  getAuthSession: defineAction({
    request: authEnvelopeSchema,
    response: z.object({ user: authUserSchema.nullable() }),
    async handler(ctx, args) {
      try {
        const user = await requireSession(ctx, args._sessionToken);
        return { user: authUserShape(user, await getPlatformSetting(ctx.db(), "announcement_banner", "")) };
      } catch {
        return { user: null };
      }
    },
  }),
  // Records acceptance of the Marketplace Terms of Use. Existing users who
  // signed up before the terms existed accept here; the client shows a
  // blocking screen until acceptedAt is set and the version is current.
  acceptMarketplaceTerms: defineAction({
    request: z.object({ version: z.string().trim().min(1).max(20) }),
    response: z.object({ ok: z.literal(true), acceptedAt: z.string(), version: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; acceptedAt: string; version: string }> {
      if (args.version !== MARKETPLACE_TERMS_VERSION) throw new Error("These Marketplace Terms are out of date. Please review the latest version.");
      const db = ctx.db<typeof schema>(); const now = new Date();
      const identity = workspaceIdentity(ctx);
      await db.update(schema.authUsers).set({ marketplaceTermsAcceptedAt: now, marketplaceTermsVersion: MARKETPLACE_TERMS_VERSION, updatedAt: now }).where(eq(schema.authUsers.id, identity.workspaceUserId));
      ctx.invalidateQueries();
      return { ok: true, acceptedAt: now.toISOString(), version: MARKETPLACE_TERMS_VERSION };
    },
  }),
  // Mission Control exit survey: a churned user tells us why they left.
  // Shown once as a gentle prompt after their subscription ends.
  submitCancellationFeedback: defineAction({
    request: z.object({
      reason: z.enum(["too_expensive", "not_using_enough", "missing_features", "switched_tool", "business_closed", "temporary_break", "other"]),
      details: z.string().trim().max(1000).default(""),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
      if (!user) throw new Error("Sign in to continue.");
      // Only accept feedback if they actually churned (have a cancelled event
      // and haven't already given feedback).
      const cancelled = await db.select({ id: schema.subscriptionEvents.id }).from(schema.subscriptionEvents).where(and(eq(schema.subscriptionEvents.userId, user.id), eq(schema.subscriptionEvents.eventType, "cancelled"))).limit(1);
      if (!cancelled[0]) throw new Error("No cancelled subscription found.");
      const existing = await db.select({ id: schema.cancellationFeedback.id }).from(schema.cancellationFeedback).where(eq(schema.cancellationFeedback.userId, user.id)).limit(1);
      if (existing[0]) return { ok: true as const };
      const lastSub = await db.select({ plan: schema.subscriptionEvents.plan }).from(schema.subscriptionEvents).where(and(eq(schema.subscriptionEvents.userId, user.id), inArray(schema.subscriptionEvents.eventType, ["subscribed", "play_subscribed"]))).orderBy(desc(schema.subscriptionEvents.createdAt)).limit(1);
      await db.insert(schema.cancellationFeedback).values({ userId: user.id, reason: args.reason, details: args.details, plan: lastSub[0]?.plan ?? "monthly", createdAt: new Date() });
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),
  pendingCancellationFeedback: defineAction({
    request: z.object({}),
    response: z.object({ pending: z.boolean() }),
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const user = (await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
      if (!user) return { pending: false };
      const cancelled = await db.select({ id: schema.subscriptionEvents.id }).from(schema.subscriptionEvents).where(and(eq(schema.subscriptionEvents.userId, user.id), eq(schema.subscriptionEvents.eventType, "cancelled"))).limit(1);
      if (!cancelled[0]) return { pending: false };
      const existing = await db.select({ id: schema.cancellationFeedback.id }).from(schema.cancellationFeedback).where(eq(schema.cancellationFeedback.userId, user.id)).limit(1);
      return { pending: !existing[0] };
    },
  }),
  getSubscription: defineAction({
    request: z.object({}),
    // Phase 4: provider tells the Upgrade screen which billing path granted
    // premium ("play" = Google Play Billing in the TWA, "stripe" = web).
    response: z.object({ tier: z.enum(["free", "premium"]), status: z.string(), cancelAtPeriodEnd: z.boolean(), currentPeriodEnd: z.string().nullable(), provider: z.enum(["stripe", "play", "manual", "founder", "none"]) }),
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const user = (await ctx.db<typeof schema>().select().from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
      if (!user) throw new Error("Sign in to continue.");
      const provider: "stripe" | "play" | "manual" | "founder" | "none" = user.playPurchaseToken ? "play" : user.stripeSubscriptionId ? "stripe" : user.subscriptionStatus === "founder" ? "founder" : user.subscriptionStatus === "manual" ? "manual" : "none";
      return { tier: user.tier, status: user.subscriptionStatus, cancelAtPeriodEnd: user.cancelAtPeriodEnd, currentPeriodEnd: user.subscriptionCurrentPeriodEnd?.toISOString() ?? null, provider };
    },
  }),
  getUsageLimits: defineAction({
    request: z.object({}),
    response: z.object({ tier: z.enum(["free", "premium"]), activeJobs: z.number(), maxActiveJobs: z.number(), invoicesThisMonth: z.number(), maxInvoicesPerMonth: z.number() }),
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const user = (await db.select({ tier: schema.authUsers.tier }).from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
      const tier = user?.tier ?? "free";
      if (tier === "premium") {
        const usage = await getFreeTierUsage(db, identity.workspaceCompanyId);
        return { tier: "premium" as const, activeJobs: usage.activeJobs, maxActiveJobs: -1, invoicesThisMonth: usage.invoicesThisMonth, maxInvoicesPerMonth: -1 };
      }
      const usage = await getFreeTierUsage(db, identity.workspaceCompanyId);
      return { tier: "free" as const, ...usage };
    },
  }),
  getFoundingMemberAvailability: defineAction({
    request: z.object({}),
    response: z.object({ totalSpots: z.number(), claimed: z.number(), remaining: z.number(), available: z.boolean(), configured: z.boolean(), annualConfigured: z.boolean() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const claimed = (await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.subscriptionStatus, "founding_member"))).length;
      const configured = Boolean(process.env.STRIPE_FOUNDING_PRICE_ID?.trim());
      const annualConfigured = Boolean(process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID?.trim());
      return { totalSpots: 100, claimed, remaining: Math.max(0, 100 - claimed), available: claimed < 100, configured, annualConfigured };
    },
  }),
  startPremiumCheckout: defineAction({
    request: z.object({ plan: z.enum(["monthly", "annual", "lifetime"]).default("monthly") }),
    response: z.object({ configured: z.boolean(), checkoutUrl: z.string().nullable(), missing: z.array(z.string()) }),
    privileged: [privileged.createStripeCheckout],
    async handler(ctx, args) {
      const identity = workspaceIdentity(ctx);
      const user = (await ctx.db<typeof schema>().select().from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
      if (!user) throw new Error("Sign in to continue.");
      if (user.tier === "premium") return { configured: true, checkoutUrl: null, missing: [] };
      if (args.plan === "lifetime") {
        const db = ctx.db<typeof schema>();
        const foundingCount = await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.subscriptionStatus, "founding_member"));
        if (foundingCount.length >= 100) throw new Error("The founding member offer has ended — all 100 spots are taken.");
      }
      return await ctx.executePrivileged(privileged.createStripeCheckout, { userId: user.id, companyId: user.companyId, email: user.email, plan: args.plan });
    },
  }),
  handleStripeWebhook: defineAction({
    request: z.object({ payload: z.string().min(1).max(1_000_000), signature: z.string().min(1).max(2000) }),
    response: z.object({ ok: z.literal(true), duplicate: z.boolean(), processed: z.boolean() }),
    privileged: [privileged.verifyStripeWebhook],
    async handler(ctx, args): Promise<{ ok: true; duplicate: boolean; processed: boolean }> {
      const event = await ctx.executePrivileged(privileged.verifyStripeWebhook, args);
      const db = ctx.db<typeof schema>();
      if ((await db.select({ id: schema.stripeWebhookEvents.id }).from(schema.stripeWebhookEvents).where(eq(schema.stripeWebhookEvents.id, event.eventId)).limit(1))[0]) return { ok: true, duplicate: true, processed: false };
      if (event.eventType === "ignored") {
        await db.insert(schema.stripeWebhookEvents).values({ id: event.eventId, type: event.eventType, processedAt: new Date() });
        return { ok: true, duplicate: false, processed: false };
      }
      // Build 4: marketplace paid bump — one-time purchase, 7-day featured placement.
      if (event.eventType === "checkout.session.completed" && event.checkoutType === "listing_bump" && event.listingId) {
        const listing = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, event.listingId)).limit(1))[0];
        if (!listing) throw new Error("Bump purchase did not match a Marketplace listing.");
        // Security: the listing must belong to the company that paid (defense in
        // depth — metadata is Stripe-signed, but never feature a foreign listing).
        if (!event.companyId || listing.companyId !== event.companyId) throw new Error("Bump purchase did not match the listing's company.");
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 86400000);
        await db.batch([
          db.update(schema.marketplaceListings).set({ featuredUntil: expiresAt, updatedAt: now }).where(eq(schema.marketplaceListings.id, listing.id)),
          db.insert(schema.listingBumpPurchases).values({ companyId: listing.companyId, listingId: listing.id, stripeSessionId: event.stripeSessionId ?? "", purchasedAt: now, expiresAt }),
          db.insert(schema.stripeWebhookEvents).values({ id: event.eventId, type: event.eventType, processedAt: now }),
        ]);
        ctx.invalidateQueries();
        return { ok: true, duplicate: false, processed: true };
      }
      let user = event.userId ? (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, event.userId)).limit(1))[0] : undefined;
      if (!user && event.subscriptionId) user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.stripeSubscriptionId, event.subscriptionId)).limit(1))[0];
      if (!user && event.customerId) user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.stripeCustomerId, event.customerId)).limit(1))[0];
      if (!user) throw new Error("Stripe event did not match a Crewkat account.");
      // Founding member: one-time $149 payment grants permanent Premium.
      // Idempotent: already-founding users succeed without re-counting.
      // Cap-safe: the UPDATE only applies when fewer than 100 founding members
      // exist, in a single atomic statement — simultaneous completions cannot
      // overshoot the cap.
      if (event.eventType === "checkout.session.completed" && event.plan === "founding_member") {
        const now = new Date();
        if (user.subscriptionStatus === "founding_member" && user.tier === "premium") {
          await db.insert(schema.stripeWebhookEvents).values({ id: event.eventId, type: event.eventType, processedAt: now });
          ctx.invalidateQueries();
          return { ok: true, duplicate: false, processed: true };
        }
        const granted = await db.update(schema.authUsers).set({ tier: "premium", subscriptionStatus: "founding_member", stripeCustomerId: event.customerId ?? user.stripeCustomerId, updatedAt: now }).where(and(eq(schema.authUsers.id, user.id), sql`(SELECT COUNT(*) FROM ${schema.authUsers} WHERE ${schema.authUsers.subscriptionStatus} = 'founding_member') < 100`));
        const affected = Number((granted as unknown as { rowsAffected?: number }).rowsAffected ?? 0);
        if (affected === 0) {
          const count = (await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.subscriptionStatus, "founding_member"))).length;
          throw new Error(count >= 100 ? "Founding member cap reached — payment received after all 100 spots were taken." : "Founding member grant failed; user not found.");
        }
        await db.insert(schema.stripeWebhookEvents).values({ id: event.eventId, type: event.eventType, processedAt: now });
        // Mission Control: log the founding claim for analytics.
        await db.insert(schema.subscriptionEvents).values({ userId: user.id, eventType: "founding_claimed", plan: "lifetime", createdAt: now });
        ctx.invalidateQueries();
        return { ok: true, duplicate: false, processed: true };
      }
      const end = event.currentPeriodEnd ? new Date(event.currentPeriodEnd * 1000) : null;
      const now = new Date();
      if (event.eventType === "customer.subscription.deleted") {
        await db.update(schema.authUsers).set({ tier: "free", subscriptionStatus: event.subscriptionStatus ?? "canceled", cancelAtPeriodEnd: false, subscriptionCurrentPeriodEnd: end, stripeCustomerId: event.customerId ?? user.stripeCustomerId, stripeSubscriptionId: event.subscriptionId ?? user.stripeSubscriptionId, updatedAt: new Date() }).where(eq(schema.authUsers.id, user.id));
        // Mission Control: log the cancellation. The exit survey prompt is
        // shown to the user on next app open (see pendingCancellationFeedback).
        const plan = user.subscriptionStatus === "founding_member" ? "lifetime" : "monthly";
        await db.insert(schema.subscriptionEvents).values({ userId: user.id, eventType: "cancelled", plan, createdAt: now });
      } else {
        const active = event.eventType === "checkout.session.completed" || ["active", "trialing", "past_due"].includes(event.subscriptionStatus ?? "");
        await db.update(schema.authUsers).set({ tier: active ? "premium" : "free", subscriptionStatus: event.subscriptionStatus ?? (active ? "active" : user.subscriptionStatus), cancelAtPeriodEnd: event.cancelAtPeriodEnd, subscriptionCurrentPeriodEnd: end ?? user.subscriptionCurrentPeriodEnd, stripeCustomerId: event.customerId ?? user.stripeCustomerId, stripeSubscriptionId: event.subscriptionId ?? user.stripeSubscriptionId, updatedAt: new Date() }).where(eq(schema.authUsers.id, user.id));
        // Mission Control: log new subscriptions from checkout completion.
        if (event.eventType === "checkout.session.completed" && active) {
          const plan = event.plan === "annual" ? "annual" : "monthly";
          await db.insert(schema.subscriptionEvents).values({ userId: user.id, eventType: "subscribed", plan, createdAt: now });
        }
      }
      await db.insert(schema.stripeWebhookEvents).values({ id: event.eventId, type: event.eventType, processedAt: new Date() });
      ctx.invalidateQueries();
      return { ok: true, duplicate: false, processed: true };
    },
  }),
  requestPasswordReset: defineAction({
    request: z.object({ email: z.string().trim().email().max(200) }),
    response: z.object({ ok: z.literal(true), resetCode: z.string().length(6).nullable(), emailDelivery: authCodeDeliverySchema }),
    privileged: [privileged.sendAuthEmail],
    async handler(ctx, args): Promise<{ ok: true; resetCode: string | null; emailDelivery: "sent" | "fallback" | "failed" }> {
      const email = normalizedEmail(args.email);
      const user = (await ctx.db<typeof schema>().select().from(schema.authUsers).where(eq(schema.authUsers.email, email)).limit(1))[0];
      if (!user) return { ok: true, resetCode: null, emailDelivery: "sent" };
      const code = await issueAuthCode(ctx, user.id, "reset_password");
      const delivery = await deliverAuthCode(ctx, email, code, "reset_password");
      return { ok: true, resetCode: delivery.displayCode, emailDelivery: delivery.emailDelivery };
    },
  }),
  resetPassword: defineAction({
    request: z.object({ email: z.string().trim().email().max(200), code: z.string().regex(/^\d{6}$/), password: z.string().min(10).max(200) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>(); const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, normalizedEmail(args.email))).limit(1))[0];
      if (!user) throw new Error("That reset code is invalid or expired.");
      const tokens = await db.select().from(schema.authTokens).where(and(eq(schema.authTokens.userId, user.id), eq(schema.authTokens.purpose, "reset_password"), isNull(schema.authTokens.consumedAt))).orderBy(desc(schema.authTokens.createdAt));
      const token = tokens[0];
      if (!token || token.expiresAt.getTime() <= Date.now() || token.tokenHash !== await sha256(args.code)) throw new Error("That reset code is invalid or expired.");
      const now = new Date(); const salt = randomHex(16);
      await db.batch([db.update(schema.authTokens).set({ consumedAt: now }).where(eq(schema.authTokens.id, token.id)), db.update(schema.authUsers).set({ passwordHash: await derivePassword(args.password, salt, AUTH_PASSWORD_ITERATIONS), passwordSalt: salt, passwordIterations: AUTH_PASSWORD_ITERATIONS, updatedAt: now }).where(eq(schema.authUsers.id, user.id)), db.update(schema.authSessions).set({ revokedAt: now }).where(and(eq(schema.authSessions.userId, user.id), isNull(schema.authSessions.revokedAt)))]);
      return { ok: true };
    },
  }),
  listClients: defineAction({ request: z.object({ search: z.string().max(120).default("") }), response: z.object({ clients: z.array(clientSchema) }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.clients).orderBy(sql`"clients"."name" COLLATE NOCASE ASC`); const jobs = await db.select({ clientId: schema.jobs.clientId }).from(schema.jobs); const quotes = await db.select({ clientId: schema.quotes.clientId }).from(schema.quotes); const invoices = await db.select({ id: schema.invoices.id, clientId: schema.invoices.clientId, total: schema.invoices.total }).from(schema.invoices); const payments = await db.select({ invoiceId: schema.payments.invoiceId, amount: schema.payments.amount }).from(schema.payments); const term = args.search.trim().toLowerCase(); return { clients: rows.filter((c) => !term || [c.name, c.phone, c.email, c.address, parseClientTags(c.tags).join(" ")].some((v) => v.toLowerCase().includes(term))).map((c) => { const clientInvoices = invoices.filter((invoice) => invoice.clientId === c.id); const invoiceIds = new Set(clientInvoices.map((invoice) => invoice.id)); const totalInvoiced = clientInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0); const totalPaid = payments.filter((payment) => invoiceIds.has(payment.invoiceId)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0); return { id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, notes: c.notes, tags: parseClientTags(c.tags), referredByClientId: c.referredByClientId, referredByName: rows.find((r) => r.id === c.referredByClientId)?.name ?? null, referralCount: rows.filter((r) => r.referredByClientId === c.id).length, jobCount: jobs.filter((j) => j.clientId === c.id).length, quoteCount: quotes.filter((q) => q.clientId === c.id).length, totalInvoiced, totalPaid, balanceDue: clientBalanceDue(totalInvoiced, totalPaid), invoiceCount: clientInvoices.length, paymentPercent: totalInvoiced > 0 ? Math.min(100, Math.round(totalPaid / totalInvoiced * 100)) : 0, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() }; }) }; }}),
  getClient: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ client: clientSchema.nullable(), jobs: z.array(jobSchema), quotes: z.array(quoteSchema) }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.clients); const c = rows.find((row) => row.id === args.id); if (!c) return { client: null, jobs: [], quotes: [] }; const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.clientId, c.id)).orderBy(desc(schema.jobs.jobDate)); const photos = await db.select().from(schema.photos); const quotes = await db.select().from(schema.quotes).where(eq(schema.quotes.clientId, c.id)).orderBy(desc(schema.quotes.createdAt)); const invoices = await db.select({ id: schema.invoices.id, total: schema.invoices.total }).from(schema.invoices).where(eq(schema.invoices.clientId, c.id)); const invoiceIds = new Set(invoices.map((invoice) => invoice.id)); const payments = await db.select({ invoiceId: schema.payments.invoiceId, amount: schema.payments.amount }).from(schema.payments); const totalInvoiced = invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0); const totalPaid = payments.filter((payment) => invoiceIds.has(payment.invoiceId)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0); return { client: { id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, notes: c.notes, tags: parseClientTags(c.tags), referredByClientId: c.referredByClientId, referredByName: rows.find((r) => r.id === c.referredByClientId)?.name ?? null, referralCount: rows.filter((r) => r.referredByClientId === c.id).length, jobCount: jobs.length, quoteCount: quotes.length, totalInvoiced, totalPaid, balanceDue: clientBalanceDue(totalInvoiced, totalPaid), invoiceCount: invoices.length, paymentPercent: totalInvoiced > 0 ? Math.min(100, Math.round(totalPaid / totalInvoiced * 100)) : 0, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() }, jobs: jobs.map((j) => { const jobPhotos = photos.filter((p) => p.jobId === j.id); return jobShape(j, jobPhotos.length, jobPhotos.map((p) => p.stage)); }), quotes: quotes.map(quoteShape) }; }}),
  saveClient: defineAction({ request: clientInputSchema.extend({ id: z.number().int().positive().nullable() }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const now = new Date(); const tags = JSON.stringify(normalizeClientTags(args.tags)); if (args.id) { await db.update(schema.clients).set({ name: args.name, phone: args.phone, email: args.email, address: args.address, notes: args.notes, tags, referredByClientId: args.referredByClientId, updatedAt: now }).where(eq(schema.clients.id, args.id)); ctx.invalidateQueries(); return { id: args.id }; } const rows = await db.insert(schema.clients).values({ name: args.name, phone: args.phone, email: args.email, address: args.address, notes: args.notes, tags, referredByClientId: args.referredByClientId, createdAt: now, updatedAt: now }).returning({ id: schema.clients.id }); const made = rows[0]; if (!made) throw new Error("Could not save client."); ctx.invalidateQueries(); return { id: made.id }; }}),
  deleteClient: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().delete(schema.clients).where(eq(schema.clients.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),

  listJobs: defineAction({ request: z.object({ search: z.string().max(120).default("") }), response: z.object({ jobs: z.array(jobSchema) }), async handler(ctx, args) {
    const db = ctx.db<typeof schema>(); const term = args.search.trim();
    const rows = await db.select().from(schema.jobs).where(term ? or(like(schema.jobs.clientName, `%${term}%`), like(schema.jobs.jobAddress, `%${term}%`), like(schema.jobs.jobType, `%${term}%`)) : undefined).orderBy(desc(schema.jobs.jobDate), desc(schema.jobs.id));
    const counts = await db.select({ jobId: schema.photos.jobId, id: schema.photos.id, stage: schema.photos.stage }).from(schema.photos); const map = new Map<number, number>(); const stages = new Map<number,string[]>(); for (const item of counts) { map.set(item.jobId, (map.get(item.jobId) ?? 0) + 1); stages.set(item.jobId,[...(stages.get(item.jobId)??[]),item.stage]); }
    return { jobs: rows.map((row) => jobShape(row, map.get(row.id) ?? 0, stages.get(row.id) ?? [])) };
  }}),

  getJob: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ job: jobSchema.nullable(), photos: z.array(photoSchema), documents: z.array(documentSchema), punchItems: z.array(punchItemSchema), punchSignoff: punchSignoffSchema.nullable(), progressUpdates: z.array(progressSchema), timeEntries: z.array(timeEntrySchema), receipts: z.array(receiptSchema), crewTasks: z.array(crewTaskSchema), voiceNotes: z.array(voiceNoteSchema), certificate: certificateSchema.nullable() }), async handler(ctx, args) {
    const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.jobs).where(eq(schema.jobs.id, args.id)).limit(1); const row = rows[0];
    if (!row) return { job: null, photos: [], documents: [], punchItems: [], punchSignoff: null, progressUpdates: [], timeEntries: [], receipts: [], crewTasks: [], voiceNotes: [], certificate: null };
    const [photoRows, documentRows, punchRows, signoffRows, progressRows, timeRows, receiptRows, crewRows, voiceRows, certificateRows] = await Promise.all([
      db.select().from(schema.photos).where(eq(schema.photos.jobId, args.id)).orderBy(schema.photos.createdAt, schema.photos.id),
      db.select().from(schema.documents).where(eq(schema.documents.jobId, args.id)).orderBy(desc(schema.documents.signedAt)),
      db.select().from(schema.punchItems).where(eq(schema.punchItems.jobId, args.id)).orderBy(schema.punchItems.id),
      db.select().from(schema.punchSignoffs).where(eq(schema.punchSignoffs.jobId, args.id)).orderBy(desc(schema.punchSignoffs.signedAt)).limit(1),
      db.select().from(schema.progressUpdates).where(eq(schema.progressUpdates.jobId, args.id)).orderBy(desc(schema.progressUpdates.createdAt)),
      db.select().from(schema.timeEntries).where(eq(schema.timeEntries.jobId, args.id)).orderBy(desc(schema.timeEntries.startedAt)),
      db.select().from(schema.receipts).where(eq(schema.receipts.jobId, args.id)).orderBy(desc(schema.receipts.createdAt)),
      db.select().from(schema.crewTasks).where(eq(schema.crewTasks.jobId, args.id)).orderBy(schema.crewTasks.id),
      db.select().from(schema.voiceNotes).where(eq(schema.voiceNotes.jobId, args.id)).orderBy(desc(schema.voiceNotes.createdAt)),
      db.select().from(schema.completionCertificates).where(eq(schema.completionCertificates.jobId, args.id)).orderBy(desc(schema.completionCertificates.createdAt)).limit(1),
    ]);
    const hydratedPhotos = await Promise.all(photoRows.map(async (p) => ({ id: p.id, jobId: p.jobId, stage: p.stage, caption: p.caption, filename: p.filename, contentType: p.contentType, url: await ctx.blobs.getUrl(p.blobKey), galleryPick: p.galleryPick, excludeFromSocial: p.excludeFromSocial, annotatedFromId: p.annotatedFromId, capturedAt: (p.capturedAt ?? p.createdAt).toISOString(), createdAt: p.createdAt.toISOString() })));
    const hydratedDocs = await Promise.all(documentRows.map(async (d) => ({ id: d.id, jobId: d.jobId, kind: d.kind, title: d.title, bodyText: d.bodyText, originalFilename: d.originalFilename, originalUrl: d.originalBlobKey ? await ctx.blobs.getUrl(d.originalBlobKey) : null, description: d.description, amount: d.amount, signerName: d.signerName, signatureUrl: await ctx.blobs.getUrl(d.signatureBlobKey), signedAt: d.signedAt.toISOString(), clientSignerName: d.clientSignerName, clientSignedAt: d.clientSignedAt?.toISOString() ?? null, clientSignatureHash: d.clientSignatureHash, signedPdfUrl: d.clientSignedPdfBlobKey ? await ctx.blobs.getUrl(d.clientSignedPdfBlobKey) : null })));
    const signoff = signoffRows[0];
    const receiptData = await Promise.all(receiptRows.map(async (p) => ({ id: p.id, jobId: p.jobId, vendor: p.vendor, amount: p.amount, purchaseDate: p.purchaseDate, note: p.note, filename: p.filename, url: await ctx.blobs.getUrl(p.blobKey), createdAt: p.createdAt.toISOString() })));
    const voiceData = await Promise.all(voiceRows.map(async (p) => ({ id: p.id, jobId: p.jobId, title: p.title, url: await ctx.blobs.getUrl(p.blobKey), durationSeconds: p.durationSeconds, createdAt: p.createdAt.toISOString() })));
    const cert = certificateRows[0];
    return { job: jobShape(row, hydratedPhotos.length, photoRows.map((photo) => photo.stage)), photos: hydratedPhotos, documents: hydratedDocs, punchItems: punchRows.map((p) => ({ id: p.id, jobId: p.jobId, text: p.text, completed: p.completed })), punchSignoff: signoff ? { id: signoff.id, jobId: signoff.jobId, customerName: signoff.customerName, customerSignatureUrl: await ctx.blobs.getUrl(signoff.customerSignatureBlobKey), contractorName: signoff.contractorName, contractorSignatureUrl: await ctx.blobs.getUrl(signoff.contractorSignatureBlobKey), signedAt: signoff.signedAt.toISOString() } : null, progressUpdates: progressRows.map((p) => ({ id: p.id, jobId: p.jobId, dayNumber: p.dayNumber, note: p.note, photoIds: JSON.parse(p.photoIdsJson) as number[], status: p.status, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.getTime() > 0 ? p.updatedAt.toISOString() : p.createdAt.toISOString() })), timeEntries: timeRows.map((p) => ({ id: p.id, jobId: p.jobId, crewMember: p.crewMember, startedAt: p.startedAt.toISOString(), endedAt: p.endedAt?.toISOString() ?? null, note: p.note, durationSeconds: Math.max(0, Math.floor(((p.endedAt ?? new Date()).getTime() - p.startedAt.getTime()) / 1000)) })), receipts: receiptData, crewTasks: crewRows.map((p) => ({ id: p.id, jobId: p.jobId, text: p.text, completed: p.completed, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() })), voiceNotes: voiceData, certificate: cert ? { id: cert.id, jobId: cert.jobId, completionDate: cert.completionDate, warrantyTerms: cert.warrantyTerms, createdAt: cert.createdAt.toISOString(), updatedAt: cert.updatedAt.toISOString() } : null };
  }}),

  createJob: defineAction({ request: z.object({ clientId: z.number().int().positive().nullable().default(null), clientName: z.string().trim().min(1).max(160), clientPhone: z.string().trim().max(80).default(""), clientEmail: z.string().trim().email().max(200).or(z.literal("")).default(""), jobAddress: z.string().trim().min(1).max(240), jobType: z.string().trim().min(1).max(120), notes: z.string().trim().max(3000).default(""), jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), appointmentAt: z.string().max(40).default(""), amountDue: z.string().trim().max(80).default(""), dueDate: z.string().max(10).default(""), depositAmount: z.string().trim().max(80).default(""), paymentNotes: z.string().trim().max(1000).default("") }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const now = new Date(); await assertJobLimit(ctx, db); const clientId = await upsertClient(ctx, { clientId: args.clientId, name: args.clientName, phone: args.clientPhone, email: args.clientEmail, address: args.jobAddress }); const rows = await db.insert(schema.jobs).values({ ...args, companyId: workspaceIdentity(ctx).workspaceCompanyId, clientId, amountDue: normalizeMoney(args.amountDue), depositAmount: normalizeMoney(args.depositAmount), createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }); const made = rows[0]; if (!made) throw new Error("The job could not be saved."); await logJobSystemMessage(db, made.id, "Job created", "Trabajo creado"); ctx.invalidateQueries(); return { id: made.id }; }}),

  updateJob: defineAction({ request: z.object({ id: z.number().int().positive(), clientId: z.number().int().positive().nullable(), clientName: z.string().trim().min(1).max(160), clientPhone: z.string().trim().max(80), clientEmail: z.string().trim().email().max(200).or(z.literal("")), jobAddress: z.string().trim().min(1).max(240), jobType: z.string().trim().min(1).max(120), notes: z.string().trim().max(3000), jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), appointmentAt: z.string().max(40), amountDue: z.string().trim().max(80), dueDate: z.string().max(10), depositAmount: z.string().trim().max(80), paymentNotes: z.string().trim().max(1000), galleryPick: z.boolean() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const { id, ...values } = args; const clientId = await upsertClient(ctx, { clientId: args.clientId, name: args.clientName, phone: args.clientPhone, email: args.clientEmail, address: args.jobAddress }); await ctx.db<typeof schema>().update(schema.jobs).set({ ...values, clientId, amountDue: normalizeMoney(args.amountDue), depositAmount: normalizeMoney(args.depositAmount), updatedAt: new Date() }).where(eq(schema.jobs.id, id)); ctx.invalidateQueries(); return { ok: true }; }}),
setJobClient: defineAction({ request: z.object({ jobId: z.number().int().positive(), clientId: z.number().int().positive().nullable() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); if (args.clientId === null) { await db.update(schema.jobs).set({ clientId: null, updatedAt: new Date() }).where(eq(schema.jobs.id, args.jobId)); } else { const selected = (await db.select().from(schema.clients).where(eq(schema.clients.id, args.clientId)).limit(1))[0]; if (!selected) throw new Error("Client not found."); await db.update(schema.jobs).set({ clientId: selected.id, clientName: selected.name, clientPhone: selected.phone, clientEmail: selected.email, updatedAt: new Date() }).where(eq(schema.jobs.id, args.jobId)); } ctx.invalidateQueries(); return { ok: true }; }}),
  updateJobInfo: defineAction({ request: z.object({ jobId: z.number().int().positive(), notes: z.string().trim().max(3000), jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), appointmentAt: z.string().max(40), depositAmount: z.string().trim().max(80), paymentNotes: z.string().trim().max(1000) }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const { jobId, ...values } = args; await ctx.db<typeof schema>().update(schema.jobs).set({ ...values, depositAmount: normalizeMoney(args.depositAmount), updatedAt: new Date() }).where(eq(schema.jobs.id, jobId)); ctx.invalidateQueries(); return { ok: true }; }}),
  linkInvoiceToJob: defineAction({ request: z.object({ invoiceId: z.number().int().positive(), jobId: z.number().int().positive().nullable() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const invoice = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, args.invoiceId)).limit(1))[0]; if (!invoice) throw new Error("Invoice not found."); if (args.jobId === null) { await db.update(schema.invoices).set({ jobId: null, updatedAt: new Date() }).where(eq(schema.invoices.id, args.invoiceId)); } else { const job = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, args.jobId)).limit(1))[0]; if (!job) throw new Error("Job not found."); await db.update(schema.invoices).set({ jobId: job.id, clientId: job.clientId, clientName: job.clientName, clientPhone: job.clientPhone, clientEmail: job.clientEmail, jobAddress: job.jobAddress, jobType: job.jobType, updatedAt: new Date() }).where(eq(schema.invoices.id, args.invoiceId)); } ctx.invalidateQueries(); return { ok: true }; }}),
  listDocuments: defineAction({ request: z.object({}), response: z.object({ documents: z.array(documentSchema) }), async handler(ctx) { const rows = await ctx.db<typeof schema>().select().from(schema.documents).orderBy(desc(schema.documents.signedAt)); const documents = await Promise.all(rows.map(async (d) => ({ id: d.id, jobId: d.jobId, kind: d.kind, title: d.title, bodyText: d.bodyText, originalFilename: d.originalFilename, originalUrl: d.originalBlobKey ? await ctx.blobs.getUrl(d.originalBlobKey) : null, description: d.description, amount: d.amount, signerName: d.signerName, signatureUrl: await ctx.blobs.getUrl(d.signatureBlobKey), signedAt: d.signedAt.toISOString(), clientSignerName: d.clientSignerName, clientSignedAt: d.clientSignedAt?.toISOString() ?? null, clientSignatureHash: d.clientSignatureHash, signedPdfUrl: d.clientSignedPdfBlobKey ? await ctx.blobs.getUrl(d.clientSignedPdfBlobKey) : null }))); return { documents }; }}),
  linkDocumentToJob: defineAction({ request: z.object({ documentId: z.number().int().positive(), jobId: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const job = (await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.id, args.jobId)).limit(1))[0]; if (!job) throw new Error("Job not found."); await db.update(schema.documents).set({ jobId: args.jobId }).where(eq(schema.documents.id, args.documentId)); ctx.invalidateQueries(); return { ok: true }; }}),

  addPhoto: defineAction({ request: z.object({ jobId: z.number().int().positive(), stage: stageSchema, caption: z.string().trim().max(500).default(""), filename: z.string().min(1).max(240), contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]), capturedAt: z.string().datetime(), dataBase64: z.string().min(1).max(30_000_000), annotatedFromId: z.number().int().positive().nullable().default(null) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const key = `jobs/${args.jobId}/${crypto.randomUUID()}`; await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType }); const rows = await db.insert(schema.photos).values({ jobId: args.jobId, stage: args.stage, caption: args.caption, blobKey: key, filename: args.filename, contentType: args.contentType, capturedAt: new Date(args.capturedAt), annotatedFromId: args.annotatedFromId }).returning({ id: schema.photos.id }); const made = rows[0]; if (!made) { await ctx.blobs.delete(key); throw new Error("The photo could not be saved."); } await db.update(schema.jobs).set({ updatedAt: new Date() }).where(eq(schema.jobs.id, args.jobId)); ctx.invalidateQueries(); return { id: made.id }; }}),

  updatePhoto: defineAction({ request: z.object({ id: z.number().int().positive(), caption: z.string().trim().max(500), stage: stageSchema, galleryPick: z.boolean() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.photos).set({ caption: args.caption, stage: args.stage, galleryPick: args.galleryPick }).where(eq(schema.photos.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  togglePhotoSocial: defineAction({ request: z.object({ id: z.number().int().positive(), excludeFromSocial: z.boolean() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.photos).set({ excludeFromSocial: args.excludeFromSocial }).where(eq(schema.photos.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  deletePhoto: defineAction({ request: z.object({ id: z.number().int().positive(), jobId: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const rows = await db.select({ blobKey: schema.photos.blobKey }).from(schema.photos).where(and(eq(schema.photos.id, args.id), eq(schema.photos.jobId, args.jobId))).limit(1); const row = rows[0]; if (row) { await db.delete(schema.photos).where(eq(schema.photos.id, args.id)); await ctx.blobs.delete(row.blobKey); } ctx.invalidateQueries(); return { ok: true }; }}),

  saveDocument: defineAction({ request: z.object({ jobId: z.number().int().positive(), kind: z.enum(["contract", "change_order"]), title: z.string().trim().min(1).max(200), bodyText: z.string().max(100_000).default(""), originalFilename: z.string().max(240).default(""), originalDataBase64: z.string().max(30_000_000).default(""), description: z.string().max(3000).default(""), amount: z.string().max(80).default(""), signerName: z.string().trim().min(1).max(160), signatureDataBase64: z.string().min(1).max(5_000_000), signedAt: z.string().datetime() }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); let originalBlobKey: string | null = null; if (args.originalDataBase64) { originalBlobKey = `documents/${args.jobId}/${crypto.randomUUID()}.pdf`; await ctx.blobs.put(originalBlobKey, Buffer.from(args.originalDataBase64, "base64"), { contentType: "application/pdf" }); } const signatureBlobKey = `signatures/${args.jobId}/${crypto.randomUUID()}.png`; await ctx.blobs.put(signatureBlobKey, Buffer.from(args.signatureDataBase64, "base64"), { contentType: "image/png" }); const rows = await db.insert(schema.documents).values({ jobId: args.jobId, kind: args.kind, title: args.title, bodyText: args.bodyText, originalBlobKey, originalFilename: args.originalFilename, description: args.description, amount: normalizeMoney(args.amount), signerName: args.signerName, signatureBlobKey, signedAt: new Date(args.signedAt), createdAt: new Date() }).returning({ id: schema.documents.id }); const made = rows[0]; if (!made) throw new Error("Could not save document."); ctx.invalidateQueries(); return { id: made.id }; }}),

  addPunchItem: defineAction({ request: z.object({ jobId: z.number().int().positive(), text: z.string().trim().min(1).max(500) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const rows = await ctx.db<typeof schema>().insert(schema.punchItems).values(args).returning({ id: schema.punchItems.id }); const made = rows[0]; if (!made) throw new Error("Could not save item."); ctx.invalidateQueries(); return { id: made.id }; }}),
  togglePunchItem: defineAction({ request: z.object({ id: z.number().int().positive(), completed: z.boolean() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.punchItems).set({ completed: args.completed }).where(eq(schema.punchItems.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  deletePunchItem: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().delete(schema.punchItems).where(eq(schema.punchItems.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  listPunchItems: defineAction({ request: z.object({ jobId: z.number().int().positive() }), response: z.object({ items: z.array(punchItemSchema) }), async handler(ctx, args) { workspaceIdentity(ctx); const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.punchItems).where(eq(schema.punchItems.jobId, args.jobId)).orderBy(schema.punchItems.id); return { items: rows.map((p) => ({ id: p.id, jobId: p.jobId, text: p.text, completed: p.completed })) }; }}),
  savePunchSignoff: defineAction({ request: z.object({ jobId: z.number().int().positive(), customerName: z.string().trim().min(1).max(160), customerSignatureDataBase64: z.string().min(1).max(5_000_000), contractorName: z.string().trim().min(1).max(160), contractorSignatureDataBase64: z.string().min(1).max(5_000_000), signedAt: z.string().datetime() }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const customerKey = `punch/${args.jobId}/${crypto.randomUUID()}-customer.png`; const contractorKey = `punch/${args.jobId}/${crypto.randomUUID()}-contractor.png`; await Promise.all([ctx.blobs.put(customerKey, Buffer.from(args.customerSignatureDataBase64, "base64"), { contentType: "image/png" }), ctx.blobs.put(contractorKey, Buffer.from(args.contractorSignatureDataBase64, "base64"), { contentType: "image/png" })]); const rows = await db.insert(schema.punchSignoffs).values({ jobId: args.jobId, customerName: args.customerName, customerSignatureBlobKey: customerKey, contractorName: args.contractorName, contractorSignatureBlobKey: contractorKey, signedAt: new Date(args.signedAt) }).returning({ id: schema.punchSignoffs.id }); const made = rows[0]; if (!made) throw new Error("Could not save sign-off."); ctx.invalidateQueries(); return { id: made.id }; }}),
  saveProgressUpdate: defineAction({ request: z.object({ id: z.number().int().positive().nullable().default(null), jobId: z.number().int().positive(), dayNumber: z.number().int().min(1).max(999), note: z.string().trim().max(3000), photoIds: z.array(z.number().int().positive()).max(12), status: z.enum(["draft", "sent"]) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); if(args.status==="sent"&&args.photoIds.length){const rows=await db.select().from(schema.photos);const selected=rows.filter(p=>args.photoIds.includes(p.id)&&p.jobId===args.jobId);if(selected.length!==args.photoIds.length||selected.some(p=>p.excludeFromSocial))throw new Error("A photo marked Not for social cannot be shared.");} const now = new Date(); if (args.id) { await db.update(schema.progressUpdates).set({ dayNumber: args.dayNumber, note: args.note, photoIdsJson: JSON.stringify(args.photoIds), status: args.status, updatedAt: now }).where(and(eq(schema.progressUpdates.id, args.id), eq(schema.progressUpdates.jobId, args.jobId))); ctx.invalidateQueries(); return { id: args.id }; } const rows = await db.insert(schema.progressUpdates).values({ jobId: args.jobId, dayNumber: args.dayNumber, note: args.note, photoIdsJson: JSON.stringify(args.photoIds), status: args.status, createdAt: now, updatedAt: now }).returning({ id: schema.progressUpdates.id }); const made = rows[0]; if (!made) throw new Error("Could not save update."); ctx.invalidateQueries(); return { id: made.id }; }}),
  deleteProgressUpdate: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().delete(schema.progressUpdates).where(eq(schema.progressUpdates.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),

  listQuotes: defineAction({ request: z.object({}), response: z.object({ quotes: z.array(quoteSchema) }), async handler(ctx) { const rows = await ctx.db<typeof schema>().select().from(schema.quotes).orderBy(desc(schema.quotes.createdAt)); return { quotes: rows.map(quoteShape) }; }}),
  saveQuote: defineAction({ request: z.object({ clientId: z.number().int().positive().nullable().default(null), jobId: z.number().int().positive().nullable().default(null), clientName: z.string().trim().min(1).max(160), clientPhone: z.string().trim().max(80), clientEmail: z.string().trim().email().max(200).or(z.literal("")), jobAddress: z.string().trim().max(240), shippingAddress: z.string().trim().max(240).default(""), jobType: z.string().trim().max(120), lineItems: z.array(quoteItemSchema).min(1).max(50), subtotal: z.string().max(80), discountType: adjustmentTypeSchema, discountValue: z.string().max(80), taxType: adjustmentTypeSchema, taxValue: z.string().max(80), total: z.string().max(80), footnote: z.string().max(3000), expiryDate: z.string().max(10), sentAt: z.string().max(10), theme: quoteThemeSchema, font: documentFontSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), customizeJson: customizeJsonSchema }).extend(documentVisibilitySchema.shape), response: z.object({ id: z.number() }), async handler(ctx, args) { const now = new Date(); const clientId = await upsertClient(ctx, { clientId: args.clientId, name: args.clientName, phone: args.clientPhone, email: args.clientEmail, address: args.jobAddress }); const rows = await ctx.db<typeof schema>().insert(schema.quotes).values({ ...args, clientId, lineItemsJson: JSON.stringify(normalizeLineItems(args.lineItems)), subtotal: normalizeMoney(args.subtotal, "0.00"), discountValue: normalizeMoney(args.discountValue, "0.00"), taxValue: normalizeMoney(args.taxValue, "0.00"), total: normalizeMoney(args.total, "0.00"), createdAt: now, updatedAt: now }).returning({ id: schema.quotes.id }); const made = rows[0]; if (!made) throw new Error("Could not save quote."); ctx.invalidateQueries(); return { id: made.id }; }}),
  convertQuoteToJob: defineAction({ request: z.object({ id: z.number().int().positive(), today: clientTodaySchema }), response: z.object({ jobId: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.quotes).where(eq(schema.quotes.id, args.id)).limit(1); const q = rows[0]; if (!q) throw new Error("Quote not found."); if (q.jobId) return { jobId: q.jobId }; const now = new Date(); const madeRows = await db.insert(schema.jobs).values({ clientId: q.clientId, clientName: q.clientName, clientPhone: q.clientPhone, clientEmail: q.clientEmail, jobAddress: q.jobAddress || "Address pending", jobType: q.jobType || "Quoted work", notes: `Converted from quote #${q.id}`, jobDate: clientToday(args), amountDue: q.total, createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }); const made = madeRows[0]; if (!made) throw new Error("Could not create job."); await db.update(schema.quotes).set({ jobId: made.id, updatedAt: now }).where(eq(schema.quotes.id, q.id)); ctx.invalidateQueries(); return { jobId: made.id }; }}),

  listInvoices: defineAction({ request: z.object({}), response: z.object({ invoices: z.array(invoiceSchema) }), async handler(ctx) { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.invoices).orderBy(desc(schema.invoices.createdAt)); const payments = await db.select().from(schema.payments).orderBy(desc(schema.payments.paymentDate)); const setting=(await db.select().from(schema.settings).where(eq(schema.settings.id,1)).limit(1))[0]; const fee={type:setting?.lateFeeType??"flat",value:Number(setting?.lateFeeValue??0),graceDays:setting?.lateFeeGraceDays??0}; return { invoices: rows.map((row) => invoiceShape(row, payments.filter((p) => p.invoiceId === row.id), fee)) }; }}),

  // Build 3: global search across clients, jobs, estimates, and invoices.
  globalSearch: defineAction({ request: z.object({ term: z.string().max(120) }), response: z.object({ clients: z.array(z.object({ id: z.number(), title: z.string(), detail: z.string() })), jobs: z.array(z.object({ id: z.number(), title: z.string(), detail: z.string() })), quotes: z.array(z.object({ id: z.number(), title: z.string(), detail: z.string() })), invoices: z.array(z.object({ id: z.number(), title: z.string(), detail: z.string() })) }), async handler(ctx, args) {
    const db = ctx.db<typeof schema>(); const term = args.term.trim(); const pattern = `%${term}%`;
    if (!term) return { clients: [], jobs: [], quotes: [], invoices: [] };
    const clientRows = await db.select({ id: schema.clients.id, name: schema.clients.name, phone: schema.clients.phone }).from(schema.clients).where(or(like(schema.clients.name, pattern), like(schema.clients.phone, pattern), like(schema.clients.email, pattern))).orderBy(sql`"clients"."name" COLLATE NOCASE ASC`).limit(6);
    const jobRows = await db.select({ id: schema.jobs.id, clientName: schema.jobs.clientName, jobType: schema.jobs.jobType, jobAddress: schema.jobs.jobAddress }).from(schema.jobs).where(or(like(schema.jobs.clientName, pattern), like(schema.jobs.jobType, pattern), like(schema.jobs.jobAddress, pattern))).orderBy(desc(schema.jobs.jobDate)).limit(6);
    const quoteRows = await db.select({ id: schema.quotes.id, clientName: schema.quotes.clientName, total: schema.quotes.total }).from(schema.quotes).where(or(like(schema.quotes.clientName, pattern), like(schema.quotes.jobType, pattern))).orderBy(desc(schema.quotes.createdAt)).limit(6);
    const invoiceRows = await db.select({ id: schema.invoices.id, clientName: schema.invoices.clientName, total: schema.invoices.total }).from(schema.invoices).where(or(like(schema.invoices.clientName, pattern), like(schema.invoices.jobType, pattern))).orderBy(desc(schema.invoices.createdAt)).limit(6);
    return {
      clients: clientRows.map((c) => ({ id: c.id, title: c.name, detail: c.phone })),
      jobs: jobRows.map((j) => ({ id: j.id, title: `${j.clientName} · ${j.jobType}`, detail: j.jobAddress })),
      quotes: quoteRows.map((q) => ({ id: q.id, title: `${q.clientName} · ${q.total}`, detail: `EST-${q.id}` })),
      invoices: invoiceRows.map((i) => ({ id: i.id, title: `${i.clientName} · ${i.total}`, detail: `INV-${i.id}` })),
    };
  }}),
  saveInvoice: defineAction({ request: z.object({ invoiceNumber: z.string().trim().max(40).default(""), quoteId: z.number().int().positive().nullable().default(null), jobId: z.number().int().positive().nullable().default(null), clientId: z.number().int().positive().nullable().default(null), clientName: z.string().trim().min(1).max(160), clientPhone: z.string().trim().max(80), clientEmail: z.string().trim().email().max(200).or(z.literal("")), jobAddress: z.string().trim().max(240), shippingAddress: z.string().trim().max(240).default(""), jobType: z.string().trim().max(120), lineItems: z.array(invoiceItemSchema).min(1).max(50), subtotal: z.string().max(80), discountType: adjustmentTypeSchema, discountValue: z.string().max(80), taxType: adjustmentTypeSchema, taxValue: z.string().max(80), total: z.string().max(80), footnote: z.string().max(3000), issueDate: z.string().max(10), dueDate: z.string().max(10), status: invoiceStatusSchema, recurringFrequency: z.enum(["none", "daily", "weekly", "monthly", "quarterly"]).default("none"), nextDueDate: z.string().max(10).default(""), recurringEndDate: z.string().max(10).default(""), theme: quoteThemeSchema, font: documentFontSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), customizeJson: customizeJsonSchema }).extend(documentVisibilitySchema.shape), response: z.object({ id: z.number() }), async handler(ctx, args) { const now = new Date(); const db = ctx.db<typeof schema>(); await assertInvoiceLimit(ctx, db); const clientId = await upsertClient(ctx, { clientId: args.clientId, name: args.clientName, phone: args.clientPhone, email: args.clientEmail, address: args.jobAddress }); const nextNumber = await nextInvoiceNumber(db); const rows = await db.insert(schema.invoices).values({ ...args, companyId: workspaceIdentity(ctx).workspaceCompanyId, invoiceNumber: args.invoiceNumber || nextNumber, clientId, lineItemsJson: JSON.stringify(normalizeLineItems(args.lineItems)), subtotal: normalizeMoney(args.subtotal, "0.00"), discountValue: normalizeMoney(args.discountValue, "0.00"), taxValue: normalizeMoney(args.taxValue, "0.00"), total: normalizeMoney(args.total, "0.00"), createdAt: now, updatedAt: now }).returning({ id: schema.invoices.id }); const made = rows[0]; if (!made) throw new Error("Could not save invoice."); ctx.invalidateQueries(); return { id: made.id }; }}),
  // One-tap estimate -> invoice: copies line items, client, and job from the
  // (accepted, or latest) version of the quote series into a new invoice using
  // the shared INV-0001+ numbering. Marks the quote via
  // quotes.converted_to_invoice_id (migration 0045). Idempotent: a second call
  // returns the invoice created by the first.
  convertQuoteToInvoice: defineAction({ request: z.object({ quoteId: z.number().int().positive(), today: clientTodaySchema }), response: z.object({ invoiceId: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const requested=(await db.select().from(schema.quotes).where(eq(schema.quotes.id,args.quoteId)).limit(1))[0];if(!requested)throw new Error("Quote not found.");if(requested.convertedToInvoiceId)return{invoiceId:requested.convertedToInvoiceId};await assertInvoiceLimit(ctx, db);const seriesId=requested.seriesId??requested.id;const versions=(await db.select().from(schema.quotes)).filter(q=>(q.seriesId??q.id)===seriesId);const q=[...versions].filter(v=>v.accepted).sort((a,b)=>b.versionNumber-a.versionNumber)[0]??[...versions].sort((a,b)=>b.versionNumber-a.versionNumber)[0];if(!q)throw new Error("Quote not found.");if(q.convertedToInvoiceId)return{invoiceId:q.convertedToInvoiceId};const prior=(await db.select().from(schema.invoices).where(eq(schema.invoices.quoteId,q.id)).limit(1))[0];const now=new Date();if(prior){await db.update(schema.quotes).set({convertedToInvoiceId:prior.id,updatedAt:now}).where(eq(schema.quotes.id,q.id));return{invoiceId:prior.id};} const invoiceNumber=await nextInvoiceNumber(db); const madeRows = await db.insert(schema.invoices).values({ companyId: workspaceIdentity(ctx).workspaceCompanyId, quoteId: q.id, jobId: q.jobId, clientId: q.clientId, clientName: q.clientName, clientPhone: q.clientPhone, clientEmail: q.clientEmail, jobAddress: q.jobAddress, shippingAddress: q.shippingAddress, jobType: q.jobType, lineItemsJson: q.lineItemsJson, subtotal: q.subtotal, discountType: q.discountType, discountValue: q.discountValue, taxType: q.taxType, taxValue: q.taxValue, total: q.total, footnote: q.footnote, invoiceNumber, issueDate: clientToday(args), dueDate: "", status: "draft", theme: q.theme, font: q.font, accentColor: q.accentColor, showTaxLine: q.showTaxLine, showDiscountLine: q.showDiscountLine, showPaidLine: q.showPaidLine, showPaymentTerms: q.showPaymentTerms, showFooterNotes: q.showFooterNotes, showLogo: q.showLogo, showCompanyInfo: q.showCompanyInfo, customizeJson: q.customizeJson, createdAt: now, updatedAt: now }).returning({ id: schema.invoices.id }); const made = madeRows[0]; if (!made) throw new Error("Could not create invoice."); await db.update(schema.quotes).set({ convertedToInvoiceId: made.id, updatedAt: now }).where(eq(schema.quotes.id, q.id)); ctx.invalidateQueries(); return { invoiceId: made.id }; }}),
  // Onboarding sample data. Idempotent-ish rule (deliberately simple and safe):
  // refuses when the company already has ANY jobs (real or sample); deleting
  // all jobs re-arms the action. Everything is prefixed "[SAMPLE]" and
  // deletable through the normal UI (Clients / Jobs / Estimates).
  loadSampleData: defineAction({ request: z.object({}), response: z.object({ clientId: z.number(), jobId: z.number(), quoteId: z.number() }), async handler(ctx) { const db = ctx.db<typeof schema>(); const identity = workspaceIdentity(ctx); const existingJobs = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.companyId, identity.workspaceCompanyId)).limit(1); if (existingJobs.length > 0) throw new Error("Sample data can only be loaded into an empty account. Delete your existing jobs first (sample records included) to reload it."); const now = new Date(); const today = now.toISOString().slice(0, 10); const marker = "[SAMPLE]"; const clientRows = await db.insert(schema.clients).values({ name: `${marker} Maria Garcia`, phone: "(555) 010-2233", email: "sample.client@example.com", address: "123 Sample St, Tampa, FL 33601", notes: "Sample client created by the onboarding tour. Safe to delete.", tags: JSON.stringify(["sample"]), createdAt: now, updatedAt: now }).returning({ id: schema.clients.id }); const clientId = clientRows[0]?.id; if (!clientId) throw new Error("Could not create the sample client."); const jobRows = await db.insert(schema.jobs).values({ clientId, clientName: `${marker} Maria Garcia`, clientPhone: "(555) 010-2233", clientEmail: "sample.client@example.com", jobAddress: "123 Sample St, Tampa, FL 33601", jobType: `${marker} Kitchen remodel`, notes: "Sample job created by the onboarding tour. Safe to delete.", isSample: true, jobDate: today, createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }); const jobId = jobRows[0]?.id; if (!jobId) throw new Error("Could not create the sample job."); const lineItems = [{ description: `${marker} Cabinet and hardware installation`, amount: "4800.00" }, { description: `${marker} Countertop replacement`, amount: "2200.00" }]; const quoteRows = await db.insert(schema.quotes).values({ clientId, clientName: `${marker} Maria Garcia`, clientPhone: "(555) 010-2233", clientEmail: "sample.client@example.com", jobAddress: "123 Sample St, Tampa, FL 33601", jobType: `${marker} Kitchen remodel`, jobId, lineItemsJson: JSON.stringify(lineItems), subtotal: "7000.00", discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0", total: "7000.00", footnote: "Sample estimate created by the onboarding tour. Safe to delete.", createdAt: now, updatedAt: now }).returning({ id: schema.quotes.id }); const quoteId = quoteRows[0]?.id; if (!quoteId) throw new Error("Could not create the sample estimate."); ctx.invalidateQueries(); return { clientId, jobId, quoteId }; }}),
  // Recurring invoice schedules: a template invoice + weekly/monthly cadence.
  // The in-process scheduler (runRecurringInvoiceTick, called from server.mjs)
  // clones due templates with fresh INV numbers and advances nextRunDate.
  createRecurringSchedule: defineAction({ request: z.object({ invoiceId: z.number().int().positive(), frequency: z.enum(["weekly", "monthly"]), today: clientTodaySchema }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const template = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, args.invoiceId)).limit(1))[0]; if (!template) throw new Error("Invoice not found."); const active = (await db.select().from(schema.recurringInvoiceSchedules).where(and(eq(schema.recurringInvoiceSchedules.invoiceId, args.invoiceId), eq(schema.recurringInvoiceSchedules.active, true))).limit(1))[0]; if (active) throw new Error("This invoice already has an active recurring schedule."); const today = clientToday(args); const rows = await db.insert(schema.recurringInvoiceSchedules).values({ companyId: workspaceIdentity(ctx).workspaceCompanyId, invoiceId: args.invoiceId, frequency: args.frequency, nextRunDate: advanceRecurringDate(today, args.frequency), active: true, createdAt: new Date() }).returning({ id: schema.recurringInvoiceSchedules.id }); const made = rows[0]; if (!made) throw new Error("Could not create the recurring schedule."); ctx.invalidateQueries(); return { id: made.id }; }}),
  listRecurringSchedules: defineAction({ request: z.object({}), response: z.object({ schedules: z.array(z.object({ id: z.number(), invoiceId: z.number(), invoiceNumber: z.string(), clientName: z.string(), total: z.string(), frequency: z.enum(["weekly", "monthly"]), nextRunDate: z.string(), active: z.boolean(), lastGeneratedInvoiceId: z.number().nullable(), createdAt: z.string() })) }), async handler(ctx) { const db = ctx.db<typeof schema>(); const companyId = workspaceIdentity(ctx).workspaceCompanyId; const rows = await db.select().from(schema.recurringInvoiceSchedules).where(eq(schema.recurringInvoiceSchedules.companyId, companyId)).orderBy(desc(schema.recurringInvoiceSchedules.nextRunDate)); const invoices = await db.select().from(schema.invoices); const byId = new Map(invoices.map((row) => [row.id, row])); return { schedules: rows.map((s) => { const template = byId.get(s.invoiceId); return { id: s.id, invoiceId: s.invoiceId, invoiceNumber: template?.invoiceNumber || `INV-${String(s.invoiceId).padStart(4, "0")}`, clientName: template?.clientName ?? "", total: template?.total ?? "0", frequency: s.frequency, nextRunDate: s.nextRunDate, active: s.active, lastGeneratedInvoiceId: s.lastGeneratedInvoiceId, createdAt: s.createdAt.toISOString() }; }) }; }}),
  cancelRecurringSchedule: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const companyId = workspaceIdentity(ctx).workspaceCompanyId; await db.update(schema.recurringInvoiceSchedules).set({ active: false }).where(and(eq(schema.recurringInvoiceSchedules.id, args.id), eq(schema.recurringInvoiceSchedules.companyId, companyId))); ctx.invalidateQueries(); return { ok: true }; }}),
  // Daily job log: one entry per job per day (upsert on (job_id, log_date)).
      updateInvoiceStatus: defineAction({ request: z.object({ id: z.number().int().positive(), status: invoiceStatusSchema }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.invoices).set({ status: args.status, updatedAt: new Date() }).where(eq(schema.invoices.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  toggleInvoicePaid: defineAction({ request: z.object({ id: z.number().int().positive(), paid: z.boolean(), today: clientTodaySchema }), response: z.object({ ok: z.literal(true) }), async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const row=(await db.select().from(schema.invoices).where(eq(schema.invoices.id,args.id)).limit(1))[0];if(!row)throw new Error("Invoice not found.");const auto=(await db.select().from(schema.payments).where(eq(schema.payments.invoiceId,args.id))).filter(p=>p.note==="__paid_toggle__");if(args.paid){if(!auto.length){const all=await db.select().from(schema.payments).where(eq(schema.payments.invoiceId,args.id));const paid=all.reduce((sum,p)=>sum+Number(p.amount||0),0);const balance=Math.max(0,Number(row.total||0)-paid);if(balance>0)await db.insert(schema.payments).values({invoiceId:args.id,amount:balance.toFixed(2),paymentDate:clientToday(args),method:"Marked paid",note:"__paid_toggle__",createdAt:new Date()});}await db.update(schema.invoices).set({status:"paid",updatedAt:new Date()}).where(eq(schema.invoices.id,args.id));
      // Chunk D push: invoice marked paid.
      if (row.status !== "paid") {
        try {
          const label = row.invoiceNumber || `INV-${row.id}`;
          await sendPushToCompany(db, row.companyId, {
            titleEn: `Invoice ${label} paid`, titleEs: `Factura ${label} pagada`,
            bodyEn: `${row.clientName}`, bodyEs: `${row.clientName}`,
            url: "/app/",
          });
        } catch { /* push is best-effort */ }
      }
    }else{for(const payment of auto)await db.delete(schema.payments).where(eq(schema.payments.id,payment.id));await db.update(schema.invoices).set({status:"draft",updatedAt:new Date()}).where(eq(schema.invoices.id,args.id));}ctx.invalidateQueries();return{ok:true};} }),
  duplicateInvoice: defineAction({ request:z.object({id:z.number().int().positive()}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const row=(await db.select().from(schema.invoices).where(eq(schema.invoices.id,args.id)).limit(1))[0];if(!row)throw new Error("Invoice not found.");await assertInvoiceLimit(ctx, db);const now=new Date();const made=await db.insert(schema.invoices).values({...row,id:undefined,quoteId:null,status:"draft",issueDate:now.toISOString().slice(0,10),dueDate:"",recurringFrequency:"none",nextDueDate:"",seriesId:null,parentInvoiceId:row.id,recurringEndDate:"",recurringCancelled:false,createdAt:now,updatedAt:now}).returning({id:schema.invoices.id});const next=made[0];if(!next)throw new Error("Could not duplicate invoice.");ctx.invalidateQueries();return{id:next.id};} }),
  duplicateQuote: defineAction({ request:z.object({id:z.number().int().positive()}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const row=(await db.select().from(schema.quotes).where(eq(schema.quotes.id,args.id)).limit(1))[0];if(!row)throw new Error("Estimate not found.");const now=new Date();const made=await db.insert(schema.quotes).values({...row,id:undefined,jobId:null,seriesId:null,parentQuoteId:row.id,versionNumber:1,superseded:false,accepted:false,sentAt:"",automationStatus:"awaiting",lostReason:null,lostNote:"",createdAt:now,updatedAt:now}).returning({id:schema.quotes.id});const next=made[0];if(!next)throw new Error("Could not duplicate estimate.");ctx.invalidateQueries();return{id:next.id};} }),
  updateInvoiceDocument: defineAction({ request:z.object({id:z.number().int().positive(),invoiceNumber:z.string().trim().min(1).max(40).optional(),issueDate:z.string().max(10).optional(),dueDate:z.string().max(10).optional(),lineItems:z.array(invoiceItemSchema).min(1).max(50),discountType:adjustmentTypeSchema,discountValue:z.string().max(80),taxType:adjustmentTypeSchema,taxValue:z.string().max(80),subtotal:z.string().max(80),total:z.string().max(80),footnote:z.string().max(3000)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const {id,...values}=args;await ctx.db<typeof schema>().update(schema.invoices).set({...values,lineItemsJson:JSON.stringify(normalizeLineItems(args.lineItems)),subtotal:normalizeMoney(args.subtotal,"0.00"),discountValue:normalizeMoney(args.discountValue,"0.00"),taxValue:normalizeMoney(args.taxValue,"0.00"),total:normalizeMoney(args.total,"0.00"),updatedAt:new Date()}).where(eq(schema.invoices.id,id));ctx.invalidateQueries();return{ok:true};} }),
  updateQuoteDocument: defineAction({ request:z.object({id:z.number().int().positive(),lineItems:z.array(quoteItemSchema).min(1).max(50),discountType:adjustmentTypeSchema,discountValue:z.string().max(80),taxType:adjustmentTypeSchema,taxValue:z.string().max(80),subtotal:z.string().max(80),total:z.string().max(80),footnote:z.string().max(3000)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const {id,...values}=args;await ctx.db<typeof schema>().update(schema.quotes).set({...values,lineItemsJson:JSON.stringify(normalizeLineItems(args.lineItems)),subtotal:normalizeMoney(args.subtotal,"0.00"),discountValue:normalizeMoney(args.discountValue,"0.00"),taxValue:normalizeMoney(args.taxValue,"0.00"),total:normalizeMoney(args.total,"0.00"),updatedAt:new Date()}).where(eq(schema.quotes.id,id));ctx.invalidateQueries();return{ok:true};} }),
  deleteInvoice: defineAction({request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const sigs=await db.select().from(schema.financialDocumentSignatures).where(and(eq(schema.financialDocumentSignatures.documentKind,"invoice"),eq(schema.financialDocumentSignatures.documentId,args.id)));for(const sig of sigs)await ctx.blobs.delete(sig.signatureBlobKey);await db.delete(schema.financialDocumentSignatures).where(and(eq(schema.financialDocumentSignatures.documentKind,"invoice"),eq(schema.financialDocumentSignatures.documentId,args.id)));await db.delete(schema.invoices).where(eq(schema.invoices.id,args.id));ctx.invalidateQueries();return{ok:true};} }),
  deleteQuote: defineAction({request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const sigs=await db.select().from(schema.financialDocumentSignatures).where(and(eq(schema.financialDocumentSignatures.documentKind,"quote"),eq(schema.financialDocumentSignatures.documentId,args.id)));for(const sig of sigs)await ctx.blobs.delete(sig.signatureBlobKey);await db.delete(schema.financialDocumentSignatures).where(and(eq(schema.financialDocumentSignatures.documentKind,"quote"),eq(schema.financialDocumentSignatures.documentId,args.id)));await db.delete(schema.quotes).where(eq(schema.quotes.id,args.id));ctx.invalidateQueries();return{ok:true};} }),
  getFinancialSignature: defineAction({request:z.object({kind:z.enum(["invoice","quote"]),id:z.number().int().positive()}),response:z.object({signature:z.object({signerName:z.string(),signedAt:z.string(),url:z.string()}).nullable()}),async handler(ctx,args){const rows=await ctx.db<typeof schema>().select().from(schema.financialDocumentSignatures).where(and(eq(schema.financialDocumentSignatures.documentKind,args.kind),eq(schema.financialDocumentSignatures.documentId,args.id))).limit(1);const row=rows[0];return{signature:row?{signerName:row.signerName,signedAt:row.signedAt.toISOString(),url:await ctx.blobs.getUrl(row.signatureBlobKey)}:null};} }),
  saveFinancialSignature: defineAction({request:z.object({kind:z.enum(["invoice","quote"]),id:z.number().int().positive(),signerName:z.string().trim().min(1).max(160),signatureDataBase64:z.string().min(1).max(5_000_000)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const exists=args.kind==="invoice"?(await db.select({id:schema.invoices.id}).from(schema.invoices).where(eq(schema.invoices.id,args.id)).limit(1))[0]:(await db.select({id:schema.quotes.id}).from(schema.quotes).where(eq(schema.quotes.id,args.id)).limit(1))[0];if(!exists)throw new Error("Document not found.");const prior=(await db.select().from(schema.financialDocumentSignatures).where(and(eq(schema.financialDocumentSignatures.documentKind,args.kind),eq(schema.financialDocumentSignatures.documentId,args.id))).limit(1))[0];if(prior){await db.delete(schema.financialDocumentSignatures).where(eq(schema.financialDocumentSignatures.id,prior.id));await ctx.blobs.delete(prior.signatureBlobKey);}const key=`financial-signatures/${args.kind}/${args.id}/${crypto.randomUUID()}.png`;await ctx.blobs.put(key,Buffer.from(args.signatureDataBase64,"base64"),{contentType:"image/png"});await db.insert(schema.financialDocumentSignatures).values({documentKind:args.kind,documentId:args.id,signerName:args.signerName,signatureBlobKey:key,signedAt:new Date()});ctx.invalidateQueries();return{ok:true};} }),

  updateQuoteDesign: defineAction({ request: z.object({ id: z.number().int().positive(), theme: quoteThemeSchema, font: documentFontSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), customizeJson: customizeJsonSchema }).extend(documentVisibilitySchema.shape), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const { id, customizeJson, ...design } = args; await ctx.db<typeof schema>().update(schema.quotes).set({ ...design, customizeJson, updatedAt: new Date() }).where(eq(schema.quotes.id, id)); ctx.invalidateQueries(); return { ok: true }; }}),
  updateInvoiceDesign: defineAction({ request: z.object({ id: z.number().int().positive(), theme: quoteThemeSchema, font: documentFontSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), customizeJson: customizeJsonSchema }).extend(documentVisibilitySchema.shape), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const { id, customizeJson, ...design } = args; await ctx.db<typeof schema>().update(schema.invoices).set({ ...design, customizeJson, updatedAt: new Date() }).where(eq(schema.invoices.id, id)); ctx.invalidateQueries(); return { ok: true }; }}),
  saveDocumentDesignDefault: defineAction({ request: z.object({ theme: quoteThemeSchema, font: documentFontSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), customizeJson: customizeJsonSchema }).extend(documentVisibilitySchema.shape), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const values = { defaultQuoteTheme: args.theme, defaultDocumentFont: args.font, accentColor: args.accentColor, defaultShowTaxLine: args.showTaxLine, defaultShowDiscountLine: args.showDiscountLine, defaultShowPaidLine: args.showPaidLine, defaultShowPaymentTerms: args.showPaymentTerms, defaultShowFooterNotes: args.showFooterNotes, defaultShowLogo: args.showLogo, defaultShowCompanyInfo: args.showCompanyInfo, defaultCustomizeJson: args.customizeJson, updatedAt: new Date() }; const current = await db.select({ id: schema.settings.id }).from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1); if (current[0]) await db.update(schema.settings).set(values).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)); else await db.insert(schema.settings).values({ companyName: "", ...values }); ctx.invalidateQueries(); return { ok: true }; }}),

  startTimer: defineAction({ request: z.object({ jobId: z.number().int().positive(), crewMember: z.string().trim().max(160).default(""), note: z.string().trim().max(500).default("") }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const active = await db.select().from(schema.timeEntries).where(and(eq(schema.timeEntries.jobId, args.jobId))).orderBy(desc(schema.timeEntries.startedAt)); const existing = active.find((row) => !row.endedAt); if (existing) return { id: existing.id }; const rows = await db.insert(schema.timeEntries).values({ jobId: args.jobId, crewMember: args.crewMember, startedAt: new Date(), note: args.note, createdAt: new Date() }).returning({ id: schema.timeEntries.id }); const made = rows[0]; if (!made) throw new Error("Could not start timer."); ctx.invalidateQueries(); return { id: made.id }; }}),
  stopTimer: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.timeEntries).set({ endedAt: new Date() }).where(eq(schema.timeEntries.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  deleteTimeEntry: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().delete(schema.timeEntries).where(eq(schema.timeEntries.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  addReceipt: defineAction({ request: z.object({ jobId: z.number().int().positive(), vendor: z.string().trim().max(160), amount: z.string().trim().min(1).max(80), purchaseDate: z.string().max(10), note: z.string().trim().max(1000), filename: z.string().min(1).max(240), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), dataBase64: z.string().min(1).max(20_000_000) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const key = `receipts/${args.jobId}/${crypto.randomUUID()}`; await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType }); const rows = await ctx.db<typeof schema>().insert(schema.receipts).values({ jobId: args.jobId, vendor: args.vendor, amount: normalizeMoney(args.amount, "0.00"), purchaseDate: args.purchaseDate, note: args.note, blobKey: key, filename: args.filename, contentType: args.contentType, createdAt: new Date() }).returning({ id: schema.receipts.id }); const made = rows[0]; if (!made) throw new Error("Could not save receipt."); ctx.invalidateQueries(); return { id: made.id }; }}),
  deleteReceipt: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.receipts).where(eq(schema.receipts.id, args.id)).limit(1); const row = rows[0]; if (row) { await db.delete(schema.receipts).where(eq(schema.receipts.id, args.id)); await ctx.blobs.delete(row.blobKey); } ctx.invalidateQueries(); return { ok: true }; }}),
  saveCrewTask: defineAction({ request: z.object({ id: z.number().int().positive().nullable().default(null), jobId: z.number().int().positive(), text: z.string().trim().min(1).max(500), completed: z.boolean().default(false) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); if (args.id) { await db.update(schema.crewTasks).set({ text: args.text, completed: args.completed, updatedAt: new Date() }).where(eq(schema.crewTasks.id, args.id)); ctx.invalidateQueries(); return { id: args.id }; } const rows = await db.insert(schema.crewTasks).values({ jobId: args.jobId, text: args.text, completed: args.completed, createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.crewTasks.id }); const made = rows[0]; if (!made) throw new Error("Could not save task."); ctx.invalidateQueries(); return { id: made.id }; }}),
  deleteCrewTask: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().delete(schema.crewTasks).where(eq(schema.crewTasks.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  addVoiceNote: defineAction({ request: z.object({ jobId: z.number().int().positive(), title: z.string().trim().max(160), filename: z.string().min(1).max(240), contentType: z.string().min(1).max(100), durationSeconds: z.number().int().min(0).max(600), dataBase64: z.string().min(1).max(20_000_000) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const key = `voice/${args.jobId}/${crypto.randomUUID()}`; await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType }); const rows = await ctx.db<typeof schema>().insert(schema.voiceNotes).values({ jobId: args.jobId, title: args.title, blobKey: key, filename: args.filename, contentType: args.contentType, durationSeconds: args.durationSeconds, createdAt: new Date() }).returning({ id: schema.voiceNotes.id }); const made = rows[0]; if (!made) throw new Error("Could not save voice note."); ctx.invalidateQueries(); return { id: made.id }; }}),
  deleteVoiceNote: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.voiceNotes).where(eq(schema.voiceNotes.id, args.id)).limit(1); const row = rows[0]; if (row) { await db.delete(schema.voiceNotes).where(eq(schema.voiceNotes.id, args.id)); await ctx.blobs.delete(row.blobKey); } ctx.invalidateQueries(); return { ok: true }; }}),
  addPayment: defineAction({ request: z.object({ invoiceId: z.number().int().positive(), amount: z.string().trim().min(1).max(80), paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), method: z.string().trim().max(80), note: z.string().trim().max(500) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const rows = await db.insert(schema.payments).values({ ...args, amount: normalizeMoney(args.amount, "0.00"), createdAt: new Date() }).returning({ id: schema.payments.id }); const made = rows[0]; if (!made) throw new Error("Could not save payment."); const invoiceRows = await db.select().from(schema.invoices).where(eq(schema.invoices.id, args.invoiceId)).limit(1); const inv = invoiceRows[0]; if (inv) { const wasPaid = inv.status === "paid"; const payments = await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, inv.id)); const paid = payments.reduce((sum, p) => sum + Number(p.amount.replace(/[^0-9.-]/g, "") || 0), 0); const total = Number(inv.total.replace(/[^0-9.-]/g, "") || 0); const nowPaid = paid >= total && total > 0; if (nowPaid) await db.update(schema.invoices).set({ status: "paid", updatedAt: new Date() }).where(eq(schema.invoices.id, inv.id));
      // Chunk D push: invoice just paid in full.
      if (nowPaid && !wasPaid) {
        try {
          const label = inv.invoiceNumber || `INV-${inv.id}`;
          const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total);
          await sendPushToCompany(db, inv.companyId, {
            titleEn: `Invoice ${label} paid`, titleEs: `Factura ${label} pagada`,
            bodyEn: `${inv.clientName} — ${amount}`, bodyEs: `${inv.clientName} — ${amount}`,
            url: "/app/",
          });
        } catch { /* push is best-effort */ }
      }
    } ctx.invalidateQueries(); return { id: made.id }; }}),
  deletePayment: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().delete(schema.payments).where(eq(schema.payments.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  updateInvoiceRecurrence: defineAction({ request: z.object({ id: z.number().int().positive(), recurringFrequency: z.enum(["none", "daily", "weekly", "monthly", "quarterly"]), nextDueDate: z.string().max(10), recurringEndDate: z.string().max(10).default("") }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db=ctx.db<typeof schema>(); const row=(await db.select().from(schema.invoices).where(eq(schema.invoices.id,args.id)).limit(1))[0]; if(!row)throw new Error("Invoice not found."); await db.update(schema.invoices).set({ recurringFrequency: args.recurringFrequency, nextDueDate: args.recurringFrequency === "none" ? "" : args.nextDueDate, recurringEndDate: args.recurringFrequency === "none" ? "" : args.recurringEndDate, recurringCancelled: args.recurringFrequency === "none", seriesId: row.seriesId ?? row.id, parentInvoiceId: null, updatedAt: new Date() }).where(eq(schema.invoices.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  cancelRecurringInvoice: defineAction({request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().update(schema.invoices).set({recurringCancelled:true,recurringFrequency:"none",nextDueDate:"",updatedAt:new Date()}).where(eq(schema.invoices.id,args.id));ctx.invalidateQueries();return{ok:true};}}),
  generateRecurringInvoice: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ invoiceId: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const row=(await db.select().from(schema.invoices).where(eq(schema.invoices.id,args.id)).limit(1))[0]; if(!row||row.recurringFrequency==="none"||row.recurringCancelled)throw new Error("Recurring invoice not found."); const issue=row.nextDueDate||new Date().toISOString().slice(0,10); if(row.recurringEndDate&&issue>row.recurringEndDate)throw new Error("Recurring series has ended."); const seriesId=row.seriesId??row.id; const existing=(await db.select().from(schema.invoices)).find(i=>i.seriesId===seriesId&&i.issueDate===issue&&i.parentInvoiceId===row.id); if(existing)return{invoiceId:existing.id}; const next=advanceRecurringDate(issue,row.recurringFrequency); const madeRows=await db.insert(schema.invoices).values({companyId:row.companyId,quoteId:null,jobId:row.jobId,clientId:row.clientId,clientName:row.clientName,clientPhone:row.clientPhone,clientEmail:row.clientEmail,jobAddress:row.jobAddress,jobType:row.jobType,lineItemsJson:row.lineItemsJson,subtotal:row.subtotal,discountType:row.discountType,discountValue:row.discountValue,taxType:row.taxType,taxValue:row.taxValue,total:row.total,footnote:row.footnote,issueDate:issue,dueDate:issue,status:"draft",recurringFrequency:"none",nextDueDate:"",seriesId,parentInvoiceId:row.id,theme:row.theme,font:row.font,accentColor:row.accentColor,customizeJson:row.customizeJson,createdAt:new Date(),updatedAt:new Date()}).returning({id:schema.invoices.id}); const made=madeRows[0];if(!made)throw new Error("Could not generate invoice.");const ended=Boolean(row.recurringEndDate&&next>row.recurringEndDate);await db.update(schema.invoices).set({nextDueDate:ended?"":next,recurringCancelled:ended,recurringFrequency:ended?"none":row.recurringFrequency,updatedAt:new Date()}).where(eq(schema.invoices.id,row.id));ctx.invalidateQueries();return{invoiceId:made.id};} }),
  processRecurringInvoices: defineAction({request:z.object({runDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("")}),response:z.object({generated:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const today=args.runDate||new Date().toISOString().slice(0,10);const rows=await db.select().from(schema.invoices);let generated=0;for(const row of rows.filter(i=>i.parentInvoiceId===null&&i.recurringFrequency!=="none"&&!i.recurringCancelled&&i.nextDueDate&&i.nextDueDate<=today)){const issue=row.nextDueDate;if(row.recurringEndDate&&issue>row.recurringEndDate){await db.update(schema.invoices).set({recurringFrequency:"none",recurringCancelled:true,nextDueDate:"",updatedAt:new Date()}).where(eq(schema.invoices.id,row.id));continue;}const seriesId=row.seriesId??row.id;const existing=rows.find(i=>i.seriesId===seriesId&&i.issueDate===issue&&i.parentInvoiceId===row.id);if(!existing){await db.insert(schema.invoices).values({companyId:row.companyId,quoteId:null,jobId:row.jobId,clientId:row.clientId,clientName:row.clientName,clientPhone:row.clientPhone,clientEmail:row.clientEmail,jobAddress:row.jobAddress,jobType:row.jobType,lineItemsJson:row.lineItemsJson,subtotal:row.subtotal,discountType:row.discountType,discountValue:row.discountValue,taxType:row.taxType,taxValue:row.taxValue,total:row.total,footnote:row.footnote,issueDate:issue,dueDate:issue,status:"draft",recurringFrequency:"none",nextDueDate:"",seriesId,parentInvoiceId:row.id,theme:row.theme,font:row.font,accentColor:row.accentColor,customizeJson:row.customizeJson,createdAt:new Date(),updatedAt:new Date()});generated++;}const next=advanceRecurringDate(issue,row.recurringFrequency === "none" ? "monthly" : row.recurringFrequency);const ended=Boolean(row.recurringEndDate&&next>row.recurringEndDate);await db.update(schema.invoices).set({nextDueDate:ended?"":next,recurringCancelled:ended,recurringFrequency:ended?"none":row.recurringFrequency,updatedAt:new Date()}).where(eq(schema.invoices.id,row.id));}if(generated)ctx.invalidateQueries();return{generated};} }),
  saveCertificate: defineAction({ request: z.object({ jobId: z.number().int().positive(), completionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), warrantyTerms: z.string().trim().max(5000) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.completionCertificates).where(eq(schema.completionCertificates.jobId, args.jobId)).limit(1); const row = rows[0]; let id:number; if (row) { await db.update(schema.completionCertificates).set({ completionDate: args.completionDate, warrantyTerms: args.warrantyTerms, updatedAt: new Date() }).where(eq(schema.completionCertificates.id, row.id)); id=row.id; } else { const madeRows = await db.insert(schema.completionCertificates).values({ ...args, createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.completionCertificates.id }); const made = madeRows[0]; if (!made) throw new Error("Could not save certificate."); id=made.id; } const job=(await db.select().from(schema.jobs).where(eq(schema.jobs.id,args.jobId)).limit(1))[0]; const existing=(await db.select().from(schema.warranties).where(eq(schema.warranties.jobId,args.jobId)).limit(1))[0]; const expiry=new Date(`${args.completionDate}T12:00:00`);expiry.setMonth(expiry.getMonth()+12);const warranty={clientId:job?.clientId??null,terms:args.warrantyTerms,startDate:args.completionDate,durationMonths:12,expiryDate:expiry.toISOString().slice(0,10),updatedAt:new Date()};if(existing)await db.update(schema.warranties).set(warranty).where(eq(schema.warranties.id,existing.id));else await db.insert(schema.warranties).values({jobId:args.jobId,...warranty,createdAt:new Date()});ctx.invalidateQueries();return { id }; }}),
  listAppointments: defineAction({ request: z.object({}), response: z.object({ appointments: z.array(appointmentSchema) }), async handler(ctx) { const rows = await ctx.db<typeof schema>().select().from(schema.appointments).where(eq(schema.appointments.companyId, workspaceIdentity(ctx).workspaceCompanyId)).orderBy(schema.appointments.startsAt); return { appointments: rows.map((row) => ({ id: row.id, jobId: row.jobId, clientId: row.clientId, clientName: row.clientName, clientPhone: row.clientPhone, startsAt: row.startsAt, notes: row.notes, exteriorWork: row.exteriorWork, status: row.status, crewMember: row.crewMember, etaMinutes: row.etaMinutes, hasShareLink: !!row.shareTokenHash })) }; }}),
  saveAppointment: defineAction({ request: z.object({ id: z.number().int().positive().nullable().default(null), jobId: z.number().int().positive().nullable().default(null), clientId: z.number().int().positive().nullable().default(null), clientName: z.string().trim().min(1).max(160), clientPhone: z.string().trim().max(80), startsAt: z.string().min(1).max(40), notes: z.string().trim().max(2000), exteriorWork: z.boolean().default(false), status: z.enum(["scheduled", "confirmed", "on_my_way", "arrived", "completed", "cancelled"]).default("scheduled"), crewMember: z.string().trim().max(120).default(""), etaMinutes: z.number().int().min(1).max(480).nullable().default(null) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const companyId = workspaceIdentity(ctx).workspaceCompanyId; const now = new Date(); if (args.id) { const existing = (await db.select().from(schema.appointments).where(and(eq(schema.appointments.id, args.id), eq(schema.appointments.companyId, companyId))).limit(1))[0]; if (!existing) throw new Error("Appointment not found."); await db.update(schema.appointments).set({ jobId: args.jobId, clientId: args.clientId, clientName: args.clientName, clientPhone: args.clientPhone, startsAt: args.startsAt, notes: args.notes, exteriorWork: args.exteriorWork, status: args.status, crewMember: args.crewMember, etaMinutes: args.etaMinutes, updatedAt: now }).where(eq(schema.appointments.id, args.id)); ctx.invalidateQueries(); return { id: args.id }; } const rows = await db.insert(schema.appointments).values({ companyId, jobId: args.jobId, clientId: args.clientId, clientName: args.clientName, clientPhone: args.clientPhone, startsAt: args.startsAt, notes: args.notes, exteriorWork: args.exteriorWork, status: args.status, crewMember: args.crewMember, etaMinutes: args.etaMinutes, createdAt: now, updatedAt: now }).returning({ id: schema.appointments.id }); const made = rows[0]; if (!made) throw new Error("Could not save appointment."); ctx.invalidateQueries(); return { id: made.id }; }}),
  deleteAppointment: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().delete(schema.appointments).where(and(eq(schema.appointments.id, args.id), eq(schema.appointments.companyId, workspaceIdentity(ctx).workspaceCompanyId))); ctx.invalidateQueries(); return { ok: true }; }}),
  // Phase 3: On My Way — shareable ETA/status page (no live maps).
  shareOnMyWay: defineAction({ request: z.object({ appointmentId: z.number().int().positive() }), response: z.object({ token: z.string(), route: z.string() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const companyId = workspaceIdentity(ctx).workspaceCompanyId; const appt = (await db.select().from(schema.appointments).where(and(eq(schema.appointments.id, args.appointmentId), eq(schema.appointments.companyId, companyId))).limit(1))[0]; if (!appt) throw new Error("Appointment not found."); const token = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`; const hash = await hashPortalToken(token); await db.update(schema.appointments).set({ shareTokenHash: hash, shareTokenHint: token.slice(-6), updatedAt: new Date() }).where(eq(schema.appointments.id, appt.id)); ctx.invalidateQueries(); return { token, route: `#onmyway=${encodeURIComponent(token)}` }; } }),
  revokeOnMyWay: defineAction({ request: z.object({ appointmentId: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const companyId = workspaceIdentity(ctx).workspaceCompanyId; await db.update(schema.appointments).set({ shareTokenHash: null, shareTokenHint: "", updatedAt: new Date() }).where(and(eq(schema.appointments.id, args.appointmentId), eq(schema.appointments.companyId, companyId))); ctx.invalidateQueries(); return { ok: true }; } }),
  getOnMyWayStatus: defineAction({ request: z.object({ token: z.string().min(32).max(200) }), response: z.object({ clientName: z.string(), jobType: z.string(), jobAddress: z.string(), status: z.string(), etaMinutes: z.number().nullable(), crewMember: z.string(), updatedAt: z.string() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const hash = await hashPortalToken(args.token); const appt = (await db.select().from(schema.appointments).where(eq(schema.appointments.shareTokenHash, hash)).limit(1))[0]; if (!appt) throw new Error("This link is no longer active."); const job = appt.jobId ? (await db.select({ jobType: schema.jobs.jobType, jobAddress: schema.jobs.jobAddress }).from(schema.jobs).where(eq(schema.jobs.id, appt.jobId)).limit(1))[0] : null; return { clientName: appt.clientName, jobType: job?.jobType ?? "", jobAddress: job?.jobAddress ?? "", status: appt.status, etaMinutes: appt.etaMinutes, crewMember: appt.crewMember, updatedAt: appt.updatedAt.toISOString() }; } }),
  updateOnMyWay: defineAction({ request: z.object({ appointmentId: z.number().int().positive(), status: z.enum(["scheduled", "confirmed", "on_my_way", "arrived", "completed", "cancelled"]), etaMinutes: z.number().int().min(1).max(480).nullable().default(null) }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const companyId = workspaceIdentity(ctx).workspaceCompanyId; const appt = (await db.select().from(schema.appointments).where(and(eq(schema.appointments.id, args.appointmentId), eq(schema.appointments.companyId, companyId))).limit(1))[0]; if (!appt) throw new Error("Appointment not found."); await db.update(schema.appointments).set({ status: args.status, etaMinutes: args.etaMinutes, updatedAt: new Date() }).where(eq(schema.appointments.id, appt.id)); if (appt.jobId && (args.status === "on_my_way" || args.status === "arrived")) { const etaText = args.etaMinutes ? ` (~${args.etaMinutes} min)` : ""; const en = args.status === "on_my_way" ? `On the way${etaText}` : "Arrived on site"; const es = args.status === "on_my_way" ? `En camino${etaText}` : "Llegó al sitio"; await logJobSystemMessage(db, appt.jobId, en, es); } ctx.invalidateQueries(); return { ok: true }; } }),
  listLeads: defineAction({ request: z.object({}), response: z.object({ leads: z.array(leadSchema), winRate: z.number() }), async handler(ctx) { const rows = await ctx.db<typeof schema>().select().from(schema.leads).orderBy(desc(schema.leads.score), desc(schema.leads.updatedAt)); const decided = rows.filter((row) => row.stage === "won" || row.stage === "lost"); const won = decided.filter((row) => row.stage === "won").length; return { leads: rows.map((row) => ({ id: row.id, name: row.name, phone: row.phone, email: row.email, address: row.address, serviceType: row.serviceType, preferredContactTime: row.preferredContactTime, source: row.source, notes: row.notes, stage: row.stage, projectSize: row.projectSize, engagement: row.engagement, score: row.score, clientId: row.clientId, quoteId: row.quoteId, createdAt: row.createdAt.toISOString() })), winRate: decided.length ? Math.round((won / decided.length) * 100) : 0 }; }}),
  saveLead: defineAction({ request: z.object({ name: z.string().trim().min(1).max(160), phone: z.string().trim().max(80), source: z.string().trim().max(160), notes: z.string().trim().max(2000), projectSize: z.enum(["small","medium","large"]).default("medium"), engagement: z.enum(["slow","normal","fast"]).default("normal"), serviceType: z.string().trim().max(120).default("") }), response: z.object({ id: z.number(), score: z.number() }), async handler(ctx, args) { const source=args.source.toLowerCase(); const service=args.serviceType.toLowerCase(); const score=Math.min(100,(args.projectSize==="large"?35:args.projectSize==="medium"?24:12)+(args.engagement==="fast"?30:args.engagement==="normal"?18:8)+(/referral|google|website/.test(source)?20:10)+(/kitchen|bath|addition|remodel|paint/.test(service)?15:8)); const rows = await ctx.db<typeof schema>().insert(schema.leads).values({ ...args, score, stage: "new", createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.leads.id }); const made = rows[0]; if (!made) throw new Error("Could not save lead."); ctx.invalidateQueries(); return { id: made.id, score }; }}),
  updateLeadStage: defineAction({ request: z.object({ id: z.number().int().positive(), stage: leadStageSchema }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.leads).set({ stage: args.stage, updatedAt: new Date() }).where(eq(schema.leads.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  prepareLeadQuote: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ clientId: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.leads).where(eq(schema.leads.id, args.id)).limit(1); const lead = rows[0]; if (!lead) throw new Error("Lead not found."); const clientId = await upsertClient(ctx, { clientId: lead.clientId, name: lead.name, phone: lead.phone, email: "", address: "" }); if (!clientId) throw new Error("Could not create client."); await db.update(schema.leads).set({ clientId, stage: "quoted", updatedAt: new Date() }).where(eq(schema.leads.id, lead.id)); ctx.invalidateQueries(); return { clientId }; }}),
  getJobOperations: defineAction({ request: z.object({ jobId: z.number().int().positive() }), response: z.object({ selections: z.array(selectionSchema), dailyLogs: z.array(dailyLogSchema), internalNotes: z.array(internalNoteSchema), milestones: z.array(milestoneSchema), profitability: z.object({ quoted: z.number(), invoiced: z.number(), variance: z.number(), variancePercent: z.number().nullable(), materials: z.number(), expenses: z.number(), subcontractors: z.number(), laborHours: z.number(), laborCost: z.number(), profit: z.number(), margin: z.number(), changeOrdersTotal: z.number(), selectionBudget: z.number(), selectionActual: z.number(), budgetTotal: z.number() }) }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const { job } = await requireJobCompany(ctx, db, args.jobId); const jobId = job.id; const [selectionRows, logRows, noteRows, milestoneRows, invoiceRows, receiptRows, timeRows, settingRows, expenseRows, subcontractorRows, jobQuoteRows, documentRows] = await Promise.all([db.select().from(schema.selections).where(eq(schema.selections.jobId, jobId)).orderBy(desc(schema.selections.createdAt)), db.select().from(schema.dailyLogs).where(eq(schema.dailyLogs.jobId, jobId)).orderBy(desc(schema.dailyLogs.logDate)), db.select().from(schema.internalNotes).where(eq(schema.internalNotes.jobId, jobId)).orderBy(desc(schema.internalNotes.createdAt)), db.select().from(schema.paymentMilestones).where(eq(schema.paymentMilestones.jobId, jobId)).orderBy(schema.paymentMilestones.id), db.select().from(schema.invoices).where(eq(schema.invoices.jobId, jobId)), db.select().from(schema.receipts).where(eq(schema.receipts.jobId, jobId)), db.select().from(schema.timeEntries).where(eq(schema.timeEntries.jobId, jobId)), db.select().from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1), db.select().from(schema.businessExpenses).where(eq(schema.businessExpenses.jobId, jobId)), db.select().from(schema.subcontractors).where(eq(schema.subcontractors.jobId, jobId)), db.select().from(schema.quotes).where(eq(schema.quotes.jobId, jobId)), db.select().from(schema.documents).where(and(eq(schema.documents.jobId, jobId), eq(schema.documents.kind, "change_order")))]); const now = Date.now(); const invoiced = invoiceRows.reduce((sum, row) => sum + Number(row.total.replace(/[^0-9.-]/g, "") || 0), 0); const quoted = jobQuoteRows.reduce((sum,row)=>sum+Number(row.total.replace(/[^0-9.-]/g,"")||0),0); const materials = receiptRows.reduce((sum, row) => sum + Number(row.amount.replace(/[^0-9.-]/g, "") || 0), 0); const laborHours = timeRows.reduce((sum, row) => sum + Math.max(0, ((row.endedAt?.getTime() ?? now) - row.startedAt.getTime()) / 3600000), 0); const laborCost = laborHours * Number(settingRows[0]?.hourlyCostRate.replace(/[^0-9.-]/g, "") || 0); const expenses = expenseRows.reduce((sum,row)=>sum+Number(row.amount.replace(/[^0-9.-]/g,"")||0),0); const subcontractors = subcontractorRows.reduce((sum,row)=>sum+Number(row.agreedAmount.replace(/[^0-9.-]/g,"")||0),0); const profit = invoiced - materials - laborCost - expenses - subcontractors; const changeOrdersTotal = documentRows.reduce((sum,row)=>sum+Number(String(row.amount).replace(/[^0-9.-]/g,"")||0),0); const selectionBudget = selectionRows.reduce((sum,row)=>sum+Number(String(row.estimatedCost).replace(/[^0-9.-]/g,"")||0),0); const selectionActual = selectionRows.reduce((sum,row)=>sum+Number(String(row.actualCost).replace(/[^0-9.-]/g,"")||0),0); return { selections: await Promise.all(selectionRows.map(async (row) => ({ id: row.id, jobId: row.jobId, category: row.category, item: row.item, vendor: row.vendor, photoUrl: row.photoBlobKey ? await ctx.blobs.getUrl(row.photoBlobKey) : null, approvalStatus: row.approvalStatus, leadTimeDays: row.leadTimeDays, estimatedCost: row.estimatedCost, actualCost: row.actualCost, createdAt: row.createdAt.toISOString() }))), dailyLogs: logRows.map((row) => ({ id: row.id, jobId: row.jobId, logDate: row.logDate, crew: row.crew, hours: row.hours, photoIds: JSON.parse(row.photoIdsJson) as number[], notes: row.notes, blockers: row.blockers, clientSummary: row.clientSummary, sharedWithClient: row.sharedWithClient, createdAt: row.createdAt.toISOString() })), internalNotes: noteRows.map((row) => ({ id: row.id, jobId: row.jobId, clientId: row.clientId, note: row.note, reminderDate: row.reminderDate, completed: row.completed, createdAt: row.createdAt.toISOString() })), milestones: milestoneRows.map((row) => ({ id: row.id, jobId: row.jobId, invoiceId: row.invoiceId, label: row.label, amount: row.amount, percentage: row.percentage, dueDate: row.dueDate, status: row.status, createdAt: row.createdAt.toISOString() })), profitability: { quoted, invoiced, variance: invoiced-quoted, variancePercent: quoted>0?(invoiced-quoted)/quoted*100:null, materials, expenses, subcontractors, laborHours, laborCost, profit, margin: invoiced > 0 ? (profit / invoiced) * 100 : 0, changeOrdersTotal, selectionBudget, selectionActual, budgetTotal: quoted + changeOrdersTotal } }; }}),
  saveSelection: defineAction({ request: z.object({ id: z.number().int().positive().nullable().default(null), jobId: z.number().int().positive(), category: z.string().trim().min(1).max(160), item: z.string().trim().min(1).max(300), vendor: z.string().trim().max(160), approvalStatus: z.enum(["pending", "approved", "rejected"]), leadTimeDays: z.number().int().min(0).max(730).default(0), estimatedCost: z.string().trim().max(80).default("0"), actualCost: z.string().trim().max(80).default("0"), photoFilename: z.string().max(240).default(""), photoContentType: z.enum(["", "image/jpeg", "image/png", "image/webp"]), photoDataBase64: z.string().max(20_000_000).default("") }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const { job } = await requireJobCompany(ctx, db, args.jobId); let photoBlobKey: string | null = null; if (args.photoDataBase64 && args.photoContentType) { photoBlobKey = `selections/${job.id}/${crypto.randomUUID()}`; await ctx.blobs.put(photoBlobKey, Buffer.from(args.photoDataBase64, "base64"), { contentType: args.photoContentType }); } if (args.id) { const existing = (await db.select().from(schema.selections).where(and(eq(schema.selections.id, args.id), eq(schema.selections.jobId, job.id))).limit(1))[0]; if (!existing) throw new Error("Selection not found."); await db.update(schema.selections).set({ category: args.category, item: args.item, vendor: args.vendor, approvalStatus: args.approvalStatus, leadTimeDays: args.leadTimeDays, estimatedCost: normalizeMoney(args.estimatedCost), actualCost: normalizeMoney(args.actualCost), ...(photoBlobKey ? { photoBlobKey, photoFilename: args.photoFilename, photoContentType: args.photoContentType } : {}), updatedAt: new Date() }).where(eq(schema.selections.id, args.id)); ctx.invalidateQueries(); return { id: args.id }; } const rows = await db.insert(schema.selections).values({ companyId: workspaceIdentity(ctx).workspaceCompanyId, jobId: job.id, category: args.category, item: args.item, vendor: args.vendor, approvalStatus: args.approvalStatus, leadTimeDays: args.leadTimeDays, estimatedCost: normalizeMoney(args.estimatedCost), actualCost: normalizeMoney(args.actualCost), photoBlobKey, photoFilename: args.photoFilename, photoContentType: args.photoContentType, createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.selections.id }); const made = rows[0]; if (!made) throw new Error("Could not save selection."); ctx.invalidateQueries(); return { id: made.id }; }}),
  updateSelectionStatus: defineAction({ request: z.object({ id: z.number().int().positive(), approvalStatus: z.enum(["pending", "approved", "rejected"]) }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.selections).set({ approvalStatus: args.approvalStatus, updatedAt: new Date() }).where(eq(schema.selections.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  saveDailyLog: defineAction({ request: z.object({ jobId: z.number().int().positive(), logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), crew: z.string().trim().max(1000), hours: z.string().trim().max(80), photoIds: z.array(z.number().int().positive()).max(24), notes: z.string().trim().max(5000), blockers: z.string().trim().max(2000).default(""), clientSummary: z.string().trim().max(2000).default(""), sharedWithClient: z.boolean().default(false) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const existing = (await db.select({ id: schema.dailyLogs.id }).from(schema.dailyLogs).where(and(eq(schema.dailyLogs.jobId, args.jobId), eq(schema.dailyLogs.logDate, args.logDate))).limit(1))[0]; if (existing) { await db.update(schema.dailyLogs).set({ crew: args.crew, hours: args.hours, photoIdsJson: JSON.stringify(args.photoIds), notes: args.notes, blockers: args.blockers, clientSummary: args.clientSummary, sharedWithClient: args.sharedWithClient, updatedAt: new Date() }).where(eq(schema.dailyLogs.id, existing.id)); ctx.invalidateQueries(); return { id: existing.id }; } const rows = await db.insert(schema.dailyLogs).values({ jobId: args.jobId, logDate: args.logDate, crew: args.crew, hours: args.hours, photoIdsJson: JSON.stringify(args.photoIds), notes: args.notes, blockers: args.blockers, clientSummary: args.clientSummary, sharedWithClient: args.sharedWithClient, createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.dailyLogs.id }); const made = rows[0]; if (!made) throw new Error("Could not save daily log."); ctx.invalidateQueries(); return { id: made.id }; }}),
  saveInternalNote: defineAction({ request: z.object({ jobId: z.number().int().positive().nullable().default(null), clientId: z.number().int().positive().nullable().default(null), note: z.string().trim().min(1).max(5000), reminderDate: z.string().max(10) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const rows = await ctx.db<typeof schema>().insert(schema.internalNotes).values({ ...args, completed: false, createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.internalNotes.id }); const made = rows[0]; if (!made) throw new Error("Could not save note."); ctx.invalidateQueries(); return { id: made.id }; }}),
  toggleInternalNote: defineAction({ request: z.object({ id: z.number().int().positive(), completed: z.boolean() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.internalNotes).set({ completed: args.completed, updatedAt: new Date() }).where(eq(schema.internalNotes.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  saveMilestone: defineAction({ request: z.object({ jobId: z.number().int().positive(), label: z.string().trim().min(1).max(160), amount: z.string().trim().max(80), percentage: z.string().trim().max(80), dueDate: z.string().max(10) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const rows = await ctx.db<typeof schema>().insert(schema.paymentMilestones).values({ ...args, amount: normalizeMoney(args.amount, "0.00"), status: "pending", createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.paymentMilestones.id }); const made = rows[0]; if (!made) throw new Error("Could not save milestone."); ctx.invalidateQueries(); return { id: made.id }; }}),
  updateMilestoneStatus: defineAction({ request: z.object({ id: z.number().int().positive(), status: z.enum(["pending", "paid"]) }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.paymentMilestones).set({ status: args.status, updatedAt: new Date() }).where(eq(schema.paymentMilestones.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  invoiceMilestone: defineAction({ request: z.object({ id: z.number().int().positive(), today: clientTodaySchema }), response: z.object({ invoiceId: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const milestones = await db.select().from(schema.paymentMilestones).where(eq(schema.paymentMilestones.id, args.id)).limit(1); const milestone = milestones[0]; if (!milestone) throw new Error("Milestone not found."); if (milestone.invoiceId) return { invoiceId: milestone.invoiceId }; const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.id, milestone.jobId)).limit(1); const job = jobs[0]; if (!job) throw new Error("Job not found."); const settingRows = await db.select().from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1); const setting = settingRows[0]; const amount = milestone.amount || "0"; const now = new Date(); const rows = await db.insert(schema.invoices).values({ companyId: job.companyId, jobId: job.id, clientId: job.clientId, clientName: job.clientName, clientPhone: job.clientPhone, clientEmail: job.clientEmail, jobAddress: job.jobAddress, jobType: job.jobType, lineItemsJson: JSON.stringify([{ description: milestone.label, amount }]), subtotal: amount, total: amount, issueDate: clientToday(args), dueDate: milestone.dueDate, status: "draft", theme: setting?.defaultQuoteTheme ?? "classic", font: setting?.defaultDocumentFont ?? "helvetica", accentColor: setting?.accentColor ?? "#1f5a4a", createdAt: now, updatedAt: now }).returning({ id: schema.invoices.id }); const made = rows[0]; if (!made) throw new Error("Could not create invoice."); await db.update(schema.paymentMilestones).set({ invoiceId: made.id, updatedAt: now }).where(eq(schema.paymentMilestones.id, milestone.id)); ctx.invalidateQueries(); return { invoiceId: made.id }; }}),
  // Build 4: crew day-view — one screen for today's schedule: today's jobs,
  // today's appointments, who's assigned (from daily logs crew field), and
  // what's overdue.
  getCrewDayView: defineAction({
    request: z.object({}),
    response: z.object({
      date: z.string(),
      jobsToday: z.array(z.object({ id: z.number(), clientName: z.string(), jobType: z.string(), jobAddress: z.string(), jobDate: z.string(), appointmentAt: z.string() })),
      appointmentsToday: z.array(z.object({ id: z.number(), jobId: z.number().nullable(), clientName: z.string(), clientPhone: z.string(), startsAt: z.string(), notes: z.string() })),
      crewToday: z.array(z.string()),
      overdueInvoices: z.array(z.object({ id: z.number(), invoiceNumber: z.string(), clientName: z.string(), total: z.string(), dueDate: z.string() })),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const today = new Date().toISOString().slice(0, 10);
      const [jobRows, appointmentRows, invoiceRows, logRows] = await Promise.all([
        db.select().from(schema.jobs),
        db.select().from(schema.appointments).orderBy(schema.appointments.startsAt),
        db.select().from(schema.invoices),
        db.select({ crew: schema.dailyLogs.crew, logDate: schema.dailyLogs.logDate }).from(schema.dailyLogs),
      ]);
      const jobsToday = jobRows
        .filter((j) => j.jobDate === today || (j.appointmentAt && j.appointmentAt.slice(0, 10) === today))
        .map((j) => ({ id: j.id, clientName: j.clientName, jobType: j.jobType, jobAddress: j.jobAddress, jobDate: j.jobDate, appointmentAt: j.appointmentAt }));
      const appointmentsToday = appointmentRows
        .filter((a) => a.startsAt.slice(0, 10) === today)
        .map((a) => ({ id: a.id, jobId: a.jobId, clientName: a.clientName, clientPhone: a.clientPhone, startsAt: a.startsAt, notes: a.notes }));
      const crewToday = [...new Set(logRows.filter((l) => l.logDate === today).flatMap((l) => String(l.crew || "").split(",").map((s) => s.trim()).filter(Boolean)))];
      const overdueInvoices = invoiceRows
        .filter((inv) => inv.status !== "paid" && inv.dueDate && inv.dueDate < today)
        .map((inv) => ({ id: inv.id, invoiceNumber: inv.invoiceNumber, clientName: inv.clientName, total: inv.total, dueDate: inv.dueDate }));
      return { date: today, jobsToday, appointmentsToday, crewToday, overdueInvoices };
    },
  }),
  getDashboard: defineAction({ request: z.object({}), response: z.object({ revenueMonth: z.number(), expensesMonth: z.number(), actualProfitMonth: z.number(), outstanding: z.number(), hoursWeek: z.number(), winRate: z.number(), appointments: z.array(appointmentSchema), overdueCount: z.number(), quoteFollowupCount: z.number(), reminders: z.array(internalNoteSchema) }), async handler(ctx) { const db = ctx.db<typeof schema>(); const [invoiceRows, paymentRows, timeRows, leadRows, appointmentRows, noteRows, quoteRows, settingRows, expenseRows] = await Promise.all([db.select().from(schema.invoices), db.select().from(schema.payments), db.select().from(schema.timeEntries), db.select().from(schema.leads), db.select().from(schema.appointments).orderBy(schema.appointments.startsAt), db.select().from(schema.internalNotes).orderBy(schema.internalNotes.reminderDate), db.select().from(schema.quotes), db.select().from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1), db.select().from(schema.businessExpenses)]); const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); const revenueMonth = paymentRows.filter((p) => new Date(`${p.paymentDate}T12:00:00`).getTime() >= monthStart).reduce((sum, p) => sum + Number(p.amount.replace(/[^0-9.-]/g, "") || 0), 0); const expensesMonth = expenseRows.filter((row) => new Date(`${row.expenseDate}T12:00:00`).getTime() >= monthStart).reduce((sum,row)=>sum+Number(row.amount.replace(/[^0-9.-]/g,"")||0),0); const outstanding = invoiceRows.reduce((sum, invoice) => { const paid = paymentRows.filter((p) => p.invoiceId === invoice.id).reduce((s, p) => s + Number(p.amount.replace(/[^0-9.-]/g, "") || 0), 0); return sum + Math.max(0, Number(invoice.total.replace(/[^0-9.-]/g, "") || 0) - paid); }, 0); const day = now.getDay(); const weekStart = new Date(now); weekStart.setDate(now.getDate() - ((day + 6) % 7)); weekStart.setHours(0,0,0,0); const hoursWeek = timeRows.filter((row) => row.startedAt >= weekStart).reduce((sum, row) => sum + Math.max(0, ((row.endedAt?.getTime() ?? now.getTime()) - row.startedAt.getTime()) / 3600000), 0); const decided = leadRows.filter((row) => row.stage === "won" || row.stage === "lost"); const winRate = decided.length ? Math.round(decided.filter((row) => row.stage === "won").length / decided.length * 100) : 0; const today = now.toISOString().slice(0,10); const followDays = settingRows[0]?.quoteFollowUpDays ?? 3; const quoteFollowupCount = quoteRows.filter((q) => !q.jobId && q.sentAt && Math.floor((now.getTime() - new Date(`${q.sentAt}T00:00:00`).getTime()) / 86400000) >= followDays).length; return { revenueMonth, expensesMonth, actualProfitMonth: revenueMonth - expensesMonth, outstanding, hoursWeek, winRate, appointments: appointmentRows.filter((row) => row.startsAt.slice(0,10) >= today).slice(0,6).map((row) => ({ id: row.id, jobId: row.jobId, clientId: row.clientId, clientName: row.clientName, clientPhone: row.clientPhone, startsAt: row.startsAt, notes: row.notes, exteriorWork: row.exteriorWork, status: row.status, crewMember: row.crewMember, etaMinutes: row.etaMinutes, hasShareLink: !!row.shareTokenHash })), overdueCount: invoiceRows.filter((row) => row.status !== "paid" && row.dueDate && row.dueDate < today).length, quoteFollowupCount, reminders: noteRows.filter((row) => !row.completed && row.reminderDate && row.reminderDate <= today).map((row) => ({ id: row.id, jobId: row.jobId, clientId: row.clientId, note: row.note, reminderDate: row.reminderDate, completed: row.completed, createdAt: row.createdAt.toISOString() })) }; }}),

  getAutomationCenter: defineAction({
    request: z.object({ today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    response: z.object({
      appointments: z.array(appointmentSchema),
      quoteChase: z.array(z.object({ id:z.number(), clientName:z.string(), clientPhone:z.string(), total:z.string(), daysWaiting:z.number(), score:z.number(), expiryDate:z.string() })),
      paymentEscalations: z.array(z.object({ id:z.number(), clientName:z.string(), clientPhone:z.string(), balance:z.number(), dueDate:z.string(), daysOverdue:z.number(), stage:z.number(), lastSentAt:z.string().nullable() })),
      materials: z.array(z.object({ selectionId:z.number(), jobId:z.number(), clientName:z.string(), category:z.string(), item:z.string(), jobDate:z.string(), orderByDate:z.string(), daysUntil:z.number(), leadTimeDays:z.number() })),
      quoteExpiry: z.array(z.object({ id:z.number(), clientName:z.string(), clientPhone:z.string(), total:z.string(), expiryDate:z.string(), daysUntil:z.number() })),
      reviews: z.array(z.object({ jobId:z.number(), clientId:z.number().nullable(), clientName:z.string(), clientPhone:z.string(), jobType:z.string(), dueDate:z.string() })),
      reengagement: z.array(z.object({ jobId:z.number(), clientId:z.number().nullable(), clientName:z.string(), clientPhone:z.string(), jobType:z.string(), months:z.number(), dueDate:z.string() })),
      reminders: z.array(internalNoteSchema),
      crew: z.array(z.object({ jobId:z.number(), clientName:z.string(), jobType:z.string(), jobAddress:z.string(), startsAt:z.string(), tasks:z.array(z.string()) })),
    }),
        async handler(ctx, args) {
      // Today/Home hardening: legacy or hand-edited rows can carry nulls or
      // full ISO timestamps where date strings are expected. Coerce
      // defensively and never throw — an error here used to surface as an
      // endless "Loading home" spinner with no retry.
      try {
        const db = ctx.db<typeof schema>();
        const [appointmentRows, quoteRows, invoiceRows, paymentRows, selectionRows, jobRows, certificateRows, noteRows, crewRows, logRows, parameterRows, clientRows] = await Promise.all([
          db.select().from(schema.appointments), db.select().from(schema.quotes), db.select().from(schema.invoices), db.select().from(schema.payments), db.select().from(schema.selections), db.select().from(schema.jobs), db.select().from(schema.completionCertificates), db.select().from(schema.internalNotes), db.select().from(schema.crewTasks), db.select().from(schema.automationLogs), db.select().from(schema.adminParameters).where(eq(schema.adminParameters.id, 1)).limit(1), db.select().from(schema.clients),
        ]);
        // Review/re-engagement cards deep-link to the client record to add a
        // missing phone number. The job row carries a snapshot that can lag
        // behind the client record, so fall back to the live client phone —
        // otherwise the card keeps saying "add the phone" after it was added.
        const liveClientPhone = new Map<number, string>();
        for (const c of clientRows) {
          const phone = safeText((c as { phone?: unknown }).phone);
          if (phone) liveClientPhone.set((c as { id: number }).id, phone);
        }
        const jobClientPhone = (job: { clientId?: number | null; clientPhone?: unknown }) =>
          safeText(job.clientPhone) || (job.clientId != null ? (liveClientPhone.get(job.clientId) ?? "") : "");
        const parameter = parameterRows[0];
        const paymentDay1 = parameter?.paymentDay1 ?? 3; const paymentDay2 = parameter?.paymentDay2 ?? 14; const paymentDay3 = parameter?.paymentDay3 ?? 30;
        const reviewDelay = parameter?.reviewDelayDays ?? 1;
        const reengagementMonths = [parameter?.reengagementMonth1 ?? 6, parameter?.reengagementMonth2 ?? 12];
        const expiryWarning = parameter?.quoteExpiryWarningDays ?? 3;
        const defaultLeadTime = parameter?.materialLeadTimeDays ?? 14;
        const base = new Date(`${args.today}T12:00:00`).getTime();
        const dayMs = 86400000;
        const dayDiff = (date: unknown) => {
          const d = dateOnlyString(date);
          if (!d) return Number.NaN;
          return Math.floor((new Date(`${d}T12:00:00`).getTime() - base) / dayMs);
        };
        const addMonths = (date: unknown, months: number) => {
          const d = dateOnlyString(date);
          if (!d) return "";
          const dt = new Date(`${d}T12:00:00`);
          dt.setMonth(dt.getMonth() + months);
          return dt.toISOString().slice(0, 10);
        };
        const wasSent = (kind: typeof schema.automationLogs.$inferSelect["kind"], entityId: number, stage: string) => logRows.some((l) => l.kind === kind && l.entityId === entityId && l.stage === stage);
        const quoteChase = quoteRows
          .filter((q) => q.automationStatus === "awaiting" && Boolean(dateOnlyString(q.sentAt)))
          .map((q) => {
            const diff = dayDiff(q.sentAt);
            const days = Number.isFinite(diff) ? Math.max(0, -diff) : 0;
            return { id: q.id, clientName: safeText(q.clientName), clientPhone: safeText(q.clientPhone), total: safeText(q.total), daysWaiting: days, score: safeMoney(q.total) * days, expiryDate: dateOnlyString(q.expiryDate) };
          })
          .filter((q) => q.daysWaiting > 0)
          .sort((a, b) => b.score - a.score);
        const paymentEscalations = invoiceRows
          .filter((i) => {
            const diff = dayDiff(i.dueDate);
            return i.status !== "paid" && Boolean(dateOnlyString(i.dueDate)) && Number.isFinite(diff) && (diff as number) <= -paymentDay1;
          })
          .map((i) => {
            const paid = paymentRows.filter((p) => p.invoiceId === i.id).reduce((sum, p) => sum + safeMoney(p.amount), 0);
            const days = -dayDiff(i.dueDate);
            const stage = days >= paymentDay3 ? paymentDay3 : days >= paymentDay2 ? paymentDay2 : paymentDay1;
            const latest = logRows.filter((l) => l.kind === "payment" && l.entityId === i.id && l.stage === String(stage)).sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
            return { id: i.id, clientName: safeText(i.clientName), clientPhone: safeText(i.clientPhone), balance: Math.max(0, safeMoney(i.total) - paid), dueDate: dateOnlyString(i.dueDate), daysOverdue: days, stage, lastSentAt: latest?.sentAt?.toISOString?.() ?? null };
          })
          .filter((i) => i.balance > 0)
          .sort((a, b) => b.daysOverdue - a.daysOverdue);
        const materials = selectionRows
          .map((s) => {
            const job = jobRows.find((j) => j.id === s.jobId);
            if (!job) return null;
            const jobDate = dateOnlyString(job.jobDate);
            if (!jobDate) return null;
            const leadTimeDays = s.leadTimeDays > 0 ? s.leadTimeDays : defaultLeadTime;
            const order = new Date(`${jobDate}T12:00:00`);
            order.setDate(order.getDate() - leadTimeDays);
            const orderByDate = order.toISOString().slice(0, 10);
            const daysUntil = dayDiff(orderByDate);
            if (!Number.isFinite(daysUntil)) return null;
            return { selectionId: s.id, jobId: s.jobId, clientName: safeText(job.clientName), category: safeText(s.category), item: safeText(s.item), jobDate, orderByDate, daysUntil, leadTimeDays };
          })
          .filter((v): v is NonNullable<typeof v> => v !== null)
          .filter((v) => v.daysUntil <= 14)
          .sort((a, b) => a.daysUntil - b.daysUntil);
        const quoteExpiry = quoteRows
          .filter((q) => q.automationStatus === "awaiting" && Boolean(dateOnlyString(q.expiryDate)))
          .map((q) => ({ id: q.id, clientName: safeText(q.clientName), clientPhone: safeText(q.clientPhone), total: safeText(q.total), expiryDate: dateOnlyString(q.expiryDate), daysUntil: dayDiff(q.expiryDate) }))
          .filter((q) => Number.isFinite(q.daysUntil) && q.daysUntil <= expiryWarning)
          .sort((a, b) => a.daysUntil - b.daysUntil);
        const reviews = certificateRows
          .map((c) => {
            const job = jobRows.find((j) => j.id === c.jobId);
            if (!job) return null;
            const completion = dateOnlyString(c.completionDate);
            if (!completion) return null;
            const d = new Date(`${completion}T12:00:00`);
            d.setDate(d.getDate() + reviewDelay);
            const dueDate = d.toISOString().slice(0, 10);
            return { jobId: job.id, clientId: job.clientId ?? null, clientName: safeText(job.clientName), clientPhone: jobClientPhone(job), jobType: safeText(job.jobType), dueDate };
          })
          .filter((v): v is NonNullable<typeof v> => v !== null)
          .filter((v) => v.dueDate <= args.today && !wasSent("review", v.jobId, "next_day"));
        const reengagement = certificateRows
          .flatMap((c) => {
            const job = jobRows.find((j) => j.id === c.jobId);
            if (!job) return [];
            return reengagementMonths.map((months) => ({ jobId: job.id, clientId: job.clientId ?? null, clientName: safeText(job.clientName), clientPhone: jobClientPhone(job), jobType: safeText(job.jobType), months, dueDate: addMonths(c.completionDate, months) }));
          })
          .filter((v) => v.dueDate !== "" && v.dueDate <= args.today && !wasSent("reengagement", v.jobId, String(v.months)));
        const appointments = appointmentRows
          .filter((a) => dateOnlyString(a.startsAt) === args.today)
          .sort((a, b) => safeText(a.startsAt).localeCompare(safeText(b.startsAt)))
          .map((a) => ({ id: a.id, jobId: a.jobId, clientId: a.clientId, clientName: safeText(a.clientName), clientPhone: safeText(a.clientPhone), startsAt: safeText(a.startsAt), notes: safeText(a.notes), exteriorWork: Boolean(a.exteriorWork), status: a.status, crewMember: safeText(a.crewMember), etaMinutes: a.etaMinutes, hasShareLink: !!a.shareTokenHash }));
        const crew = appointments.flatMap((a) => {
          const job = jobRows.find((j) => j.id === a.jobId);
          if (!job) return [];
          return [{ jobId: job.id, clientName: safeText(job.clientName), jobType: safeText(job.jobType), jobAddress: safeText(job.jobAddress), startsAt: a.startsAt, tasks: crewRows.filter((t) => t.jobId === job.id && !t.completed).map((t) => safeText(t.text)) }];
        });
        const reminders = noteRows
          .filter((n) => !n.completed && Boolean(n.reminderDate) && safeText(n.reminderDate) <= args.today)
          .map((n) => ({ id: n.id, jobId: n.jobId, clientId: n.clientId, note: safeText(n.note), reminderDate: safeText(n.reminderDate), completed: Boolean(n.completed), createdAt: (n.createdAt as unknown as Date | null)?.toISOString?.() ?? "" }));
        return { appointments, quoteChase, paymentEscalations, materials, quoteExpiry, reviews, reengagement, reminders, crew };
      } catch (error) {
        console.error("getAutomationCenter failed; returning empty payload so Home can render:", error);
        return { appointments: [], quoteChase: [], paymentEscalations: [], materials: [], quoteExpiry: [], reviews: [], reengagement: [], reminders: [], crew: [] };
      }
    }

  }),
  logAutomationSend: defineAction({ request:z.object({kind:z.enum(["quote_chase","payment","review","reengagement","quote_expiry","crew"]),entityId:z.number().int().positive(),stage:z.string().max(40)}), response:z.object({ok:z.literal(true)}), async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().insert(schema.automationLogs).values({...args,channel:"sms",sentAt:new Date()});ctx.invalidateQueries();return{ok:true};} }),
  updateQuoteAutomationStatus: defineAction({ request:z.object({id:z.number().int().positive(),status:z.enum(["awaiting","won","lost"]),lostReason:z.enum(["price","timing","competitor","no_response","other"]).nullable().default(null),lostNote:z.string().trim().max(1000).default("")}), response:z.object({ok:z.literal(true)}), async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().update(schema.quotes).set({automationStatus:args.status,lostReason:args.status==="lost"?args.lostReason:null,lostNote:args.status==="lost"?args.lostNote:"",updatedAt:new Date()}).where(eq(schema.quotes.id,args.id));ctx.invalidateQueries();return{ok:true};} }),
  updateSelectionLeadTime: defineAction({ request:z.object({id:z.number().int().positive(),leadTimeDays:z.number().int().min(0).max(730)}), response:z.object({ok:z.literal(true)}), async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().update(schema.selections).set({leadTimeDays:args.leadTimeDays,updatedAt:new Date()}).where(eq(schema.selections.id,args.id));ctx.invalidateQueries();return{ok:true};} }),

  renewQuote: defineAction({ request:z.object({id:z.number().int().positive(),today:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}), response:z.object({ok:z.literal(true),expiryDate:z.string()}), async handler(ctx,args):Promise<{ok:true;expiryDate:string}>{const d=new Date(`${args.today}T12:00:00`);d.setDate(d.getDate()+30);const expiryDate=d.toISOString().slice(0,10);await ctx.db<typeof schema>().update(schema.quotes).set({expiryDate,automationStatus:"awaiting",updatedAt:new Date()}).where(eq(schema.quotes.id,args.id));ctx.invalidateQueries();return{ok:true,expiryDate};} }),

  getGrowthToolkit: defineAction({
    request: z.object({}),
    response: z.object({ priceBook: z.array(priceBookSchema), templates: z.array(templateSchema), mileage: z.array(mileageSchema), expenses: z.array(expenseSchema), jobs: z.array(z.object({ id: z.number(), label: z.string() })), monthlyMileage: z.number(), monthlyExpenses: z.number(), estimateActual: z.array(z.object({ jobId: z.number(), clientName: z.string(), jobType: z.string(), quoted: z.number(), invoiced: z.number(), variance: z.number(), variancePercent: z.number().nullable() })) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      let templateRows = await db.select().from(schema.quoteTemplates).orderBy(schema.quoteTemplates.name);
      if (templateRows.length === 0) {
        const now = new Date();
        await db.insert(schema.quoteTemplates).values([
          { name: "Kitchen remodel", isStarter: true, lineItemsJson: JSON.stringify([{ description: "Demolition and site protection", amount: "" }, { description: "Cabinet installation", amount: "" }, { description: "Countertop installation", amount: "" }, { description: "Plumbing and electrical finish", amount: "" }, { description: "Final cleanup", amount: "" }]), createdAt: now, updatedAt: now },
          { name: "Bathroom remodel", isStarter: true, lineItemsJson: JSON.stringify([{ description: "Demolition and waterproofing", amount: "" }, { description: "Tile installation", amount: "" }, { description: "Vanity and fixture installation", amount: "" }, { description: "Plumbing and electrical finish", amount: "" }, { description: "Final cleanup", amount: "" }]), createdAt: now, updatedAt: now },
          { name: "Painting", isStarter: true, lineItemsJson: JSON.stringify([{ description: "Surface preparation and protection", amount: "" }, { description: "Primer where required", amount: "" }, { description: "Two finish coats", amount: "" }, { description: "Touch-ups and cleanup", amount: "" }]), createdAt: now, updatedAt: now },
        ]);
        templateRows = await db.select().from(schema.quoteTemplates).orderBy(schema.quoteTemplates.name);
      }
      const [priceRows, mileageRows, expenseRows, jobRows, quoteRows, invoiceRows] = await Promise.all([db.select().from(schema.priceBookItems).orderBy(schema.priceBookItems.name), db.select().from(schema.mileageTrips).orderBy(desc(schema.mileageTrips.tripDate)), db.select().from(schema.businessExpenses).orderBy(desc(schema.businessExpenses.expenseDate)), db.select().from(schema.jobs).orderBy(desc(schema.jobs.jobDate)), db.select().from(schema.quotes), db.select().from(schema.invoices)]);
      const month = new Date().toISOString().slice(0, 7);
      const jobLabel = (id: number | null) => id ? (jobRows.find((job) => job.id === id)?.clientName ?? null) : null;
      const estimateActual = jobRows.map((job) => { const quoted = quoteRows.filter((q) => q.jobId === job.id).reduce((sum, q) => sum + Number(q.total.replace(/[^0-9.-]/g, "") || 0), 0); const invoiced = invoiceRows.filter((i) => i.jobId === job.id).reduce((sum, i) => sum + Number(i.total.replace(/[^0-9.-]/g, "") || 0), 0); const variance = invoiced - quoted; return { jobId: job.id, clientName: job.clientName, jobType: job.jobType, quoted, invoiced, variance, variancePercent: quoted > 0 ? variance / quoted * 100 : null }; }).filter((row) => row.quoted > 0 || row.invoiced > 0);
      return { priceBook: priceRows.map((row) => ({ id: row.id, name: row.name, description: row.description, unitPrice: row.unitPrice, createdAt: row.createdAt.toISOString() })), templates: templateRows.map((row) => ({ id: row.id, name: row.name, lineItems: JSON.parse(row.lineItemsJson) as Array<{ description: string; amount: string }>, isStarter: row.isStarter, createdAt: row.createdAt.toISOString() })), mileage: mileageRows.map((row) => ({ id: row.id, tripDate: row.tripDate, fromLocation: row.fromLocation, toLocation: row.toLocation, miles: row.miles, jobId: row.jobId, jobName: jobLabel(row.jobId), purpose: row.purpose, createdAt: row.createdAt.toISOString() })), expenses: expenseRows.map((row) => ({ id: row.id, expenseDate: row.expenseDate, vendor: row.vendor, amount: row.amount, category: row.category, jobId: row.jobId, jobName: jobLabel(row.jobId), supplierId: row.supplierId, note: row.note, createdAt: row.createdAt.toISOString() })), jobs: jobRows.map((job) => ({ id: job.id, label: `${job.clientName} · ${job.jobType}` })), monthlyMileage: mileageRows.filter((row) => row.tripDate.startsWith(month)).reduce((sum, row) => sum + Number(row.miles.replace(/[^0-9.-]/g, "") || 0), 0), monthlyExpenses: expenseRows.filter((row) => row.expenseDate.startsWith(month)).reduce((sum, row) => sum + Number(row.amount.replace(/[^0-9.-]/g, "") || 0), 0), estimateActual };
    }
  }),
  savePriceBookItem: defineAction({ request: z.object({ id: z.number().int().positive().nullable().default(null), name: z.string().trim().min(1).max(160), description: z.string().trim().max(500), unitPrice: z.string().trim().max(80) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db=ctx.db<typeof schema>(); const now=new Date(); if(args.id){await db.update(schema.priceBookItems).set({name:args.name,description:args.description,unitPrice:normalizeMoney(args.unitPrice, "0.00"),updatedAt:now}).where(eq(schema.priceBookItems.id,args.id));ctx.invalidateQueries();return{id:args.id};} const rows=await db.insert(schema.priceBookItems).values({name:args.name,description:args.description,unitPrice:normalizeMoney(args.unitPrice, "0.00"),createdAt:now,updatedAt:now}).returning({id:schema.priceBookItems.id});const made=rows[0];if(!made)throw new Error("Could not save price book item.");ctx.invalidateQueries();return{id:made.id};} }),
  deletePriceBookItem: defineAction({ request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().delete(schema.priceBookItems).where(eq(schema.priceBookItems.id,args.id));ctx.invalidateQueries();return{ok:true};} }),
  saveQuoteTemplate: defineAction({ request:z.object({id:z.number().int().positive().nullable().default(null),name:z.string().trim().min(1).max(160),lineItems:z.array(quoteItemSchema).min(1).max(50)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const now=new Date();const name=args.name.trim();if(!name)throw new Error("Template name is required.");if(args.id){await db.update(schema.quoteTemplates).set({name,lineItemsJson:JSON.stringify(normalizeLineItems(args.lineItems)),isStarter:false,updatedAt:now}).where(eq(schema.quoteTemplates.id,args.id));ctx.invalidateQueries();return{id:args.id};}const rows=await db.insert(schema.quoteTemplates).values({name,lineItemsJson:JSON.stringify(normalizeLineItems(args.lineItems)),isStarter:false,createdAt:now,updatedAt:now}).returning({id:schema.quoteTemplates.id});const made=rows[0];if(!made)throw new Error("Could not save template.");ctx.invalidateQueries();return{id:made.id};} }),
  deleteQuoteTemplate: defineAction({ request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().delete(schema.quoteTemplates).where(eq(schema.quoteTemplates.id,args.id));ctx.invalidateQueries();return{ok:true};} }),
  saveMileageTrip: defineAction({ request:z.object({id:z.number().int().positive().nullable().default(null),tripDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),fromLocation:z.string().trim().max(240),toLocation:z.string().trim().max(240),miles:z.string().trim().min(1).max(40),jobId:z.number().int().positive().nullable().default(null),purpose:z.string().trim().max(500)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();if(args.id){await db.update(schema.mileageTrips).set({tripDate:args.tripDate,fromLocation:args.fromLocation,toLocation:args.toLocation,miles:args.miles,jobId:args.jobId,purpose:args.purpose}).where(eq(schema.mileageTrips.id,args.id));ctx.invalidateQueries();return{id:args.id};}const rows=await db.insert(schema.mileageTrips).values({tripDate:args.tripDate,fromLocation:args.fromLocation,toLocation:args.toLocation,miles:args.miles,jobId:args.jobId,purpose:args.purpose,createdAt:new Date()}).returning({id:schema.mileageTrips.id});const made=rows[0];if(!made)throw new Error("Could not save trip.");ctx.invalidateQueries();return{id:made.id};} }),
  deleteMileageTrip: defineAction({ request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().delete(schema.mileageTrips).where(eq(schema.mileageTrips.id,args.id));ctx.invalidateQueries();return{ok:true};} }),
  saveBusinessExpense: defineAction({ request:z.object({id:z.number().int().positive().nullable().default(null),expenseDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),vendor:z.string().trim().max(160),amount:z.string().trim().min(1).max(80),category:z.string().trim().min(1).max(80),jobId:z.number().int().positive().nullable().default(null),supplierId:z.number().int().positive().nullable().default(null),note:z.string().trim().max(1000)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();if(args.id){await db.update(schema.businessExpenses).set({expenseDate:args.expenseDate,vendor:args.vendor,amount:normalizeMoney(args.amount, "0.00"),category:args.category,jobId:args.jobId,supplierId:args.supplierId,note:args.note}).where(eq(schema.businessExpenses.id,args.id));ctx.invalidateQueries();return{id:args.id};}const rows=await db.insert(schema.businessExpenses).values({expenseDate:args.expenseDate,vendor:args.vendor,amount:normalizeMoney(args.amount, "0.00"),category:args.category,jobId:args.jobId,supplierId:args.supplierId,note:args.note,createdAt:new Date()}).returning({id:schema.businessExpenses.id});const made=rows[0];if(!made)throw new Error("Could not save expense.");ctx.invalidateQueries();return{id:made.id};} }),
  deleteBusinessExpense: defineAction({ request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().delete(schema.businessExpenses).where(eq(schema.businessExpenses.id,args.id));ctx.invalidateQueries();return{ok:true};} }),
  listSubcontractors: defineAction({ request:z.object({jobId:z.number().int().positive()}),response:z.object({subcontractors:z.array(subcontractorSchema),totalAgreed:z.number(),totalPaid:z.number(),totalBalance:z.number()}),async handler(ctx,args){const rows=await ctx.db<typeof schema>().select().from(schema.subcontractors).where(eq(schema.subcontractors.jobId,args.jobId)).orderBy(schema.subcontractors.name);const subcontractors=rows.map((row)=>{const agreed=Number(row.agreedAmount.replace(/[^0-9.-]/g,"")||0);const paid=Number(row.paidToDate.replace(/[^0-9.-]/g,"")||0);return{id:row.id,jobId:row.jobId,name:row.name,trade:row.trade,phone:row.phone,agreedAmount:row.agreedAmount,paidToDate:row.paidToDate,balance:Math.max(0,agreed-paid),createdAt:row.createdAt.toISOString()}});return{subcontractors,totalAgreed:subcontractors.reduce((s,r)=>s+Number(r.agreedAmount.replace(/[^0-9.-]/g,"")||0),0),totalPaid:subcontractors.reduce((s,r)=>s+Number(r.paidToDate.replace(/[^0-9.-]/g,"")||0),0),totalBalance:subcontractors.reduce((s,r)=>s+r.balance,0)};} }),
  saveSubcontractor: defineAction({ request:z.object({id:z.number().int().positive().nullable().default(null),jobId:z.number().int().positive(),name:z.string().trim().min(1).max(160),trade:z.string().trim().max(120),phone:z.string().trim().max(80),agreedAmount:z.string().trim().max(80),paidToDate:z.string().trim().max(80)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const now=new Date();if(args.id){await db.update(schema.subcontractors).set({name:args.name,trade:args.trade,phone:args.phone,agreedAmount:normalizeMoney(args.agreedAmount, "0.00"),paidToDate:normalizeMoney(args.paidToDate, "0.00"),updatedAt:now}).where(eq(schema.subcontractors.id,args.id));ctx.invalidateQueries();return{id:args.id};}const rows=await db.insert(schema.subcontractors).values({jobId:args.jobId,name:args.name,trade:args.trade,phone:args.phone,agreedAmount:normalizeMoney(args.agreedAmount, "0.00"),paidToDate:normalizeMoney(args.paidToDate, "0.00"),createdAt:now,updatedAt:now}).returning({id:schema.subcontractors.id});const made=rows[0];if(!made)throw new Error("Could not save subcontractor.");ctx.invalidateQueries();return{id:made.id};} }),
  deleteSubcontractor: defineAction({ request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().delete(schema.subcontractors).where(eq(schema.subcontractors.id,args.id));ctx.invalidateQueries();return{ok:true};} }),
  saveShareImage: defineAction({ request:z.object({jobId:z.number().int().positive(),beforePhotoId:z.number().int().positive(),afterPhotoId:z.number().int().positive(),branded:z.boolean(),filename:z.string().min(1).max(240),dataBase64:z.string().min(1).max(30_000_000)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const photoRows=await db.select().from(schema.photos);const requested=photoRows.filter(p=>p.jobId===args.jobId&&(p.id===args.beforePhotoId||p.id===args.afterPhotoId));if(requested.length!==2||requested.some(p=>p.excludeFromSocial))throw new Error("A photo marked Not for social cannot be exported.");const key=`share-images/${args.jobId}/${crypto.randomUUID()}.jpg`;await ctx.blobs.put(key,Buffer.from(args.dataBase64,"base64"),{contentType:"image/jpeg"});const rows=await ctx.db<typeof schema>().insert(schema.shareImages).values({jobId:args.jobId,beforePhotoId:args.beforePhotoId,afterPhotoId:args.afterPhotoId,branded:args.branded,blobKey:key,filename:args.filename,createdAt:new Date()}).returning({id:schema.shareImages.id});const made=rows[0];if(!made)throw new Error("Could not save comparison.");ctx.invalidateQueries();return{id:made.id};} }),
  deleteShareImage: defineAction({request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const row=(await db.select().from(schema.shareImages).where(eq(schema.shareImages.id,args.id)).limit(1))[0];if(row){await db.delete(schema.shareImages).where(eq(schema.shareImages.id,row.id));await ctx.blobs.delete(row.blobKey);}ctx.invalidateQueries();return{ok:true};}}),
  listShareImages: defineAction({ request:z.object({jobId:z.number().int().positive()}),response:z.object({images:z.array(shareImageSchema)}),async handler(ctx,args){const rows=await ctx.db<typeof schema>().select().from(schema.shareImages).where(eq(schema.shareImages.jobId,args.jobId)).orderBy(desc(schema.shareImages.createdAt));return{images:await Promise.all(rows.map(async(row)=>({id:row.id,jobId:row.jobId,beforePhotoId:row.beforePhotoId,afterPhotoId:row.afterPhotoId,branded:row.branded,filename:row.filename,url:await ctx.blobs.getUrl(row.blobKey),createdAt:row.createdAt.toISOString()})))};} }),
  getWeatherOutlook: defineAction({ request:z.object({appointmentId:z.number().int().positive()}),response:z.object({available:z.boolean(),location:z.string(),date:z.string(),summary:z.string(),precipitationChance:z.number().nullable(),high:z.number().nullable(),low:z.number().nullable(),unit:z.string(),rainLikely:z.boolean(),asOf:z.string(),source:z.string()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const appointments=await db.select().from(schema.appointments).where(eq(schema.appointments.id,args.appointmentId)).limit(1);const appointment=appointments[0];if(!appointment||!appointment.exteriorWork)return{available:false,location:"",date:"",summary:"",precipitationChance:null,high:null,low:null,unit:"°F",rainLikely:false,asOf:new Date().toISOString(),source:""};const jobs=appointment.jobId?await db.select().from(schema.jobs).where(eq(schema.jobs.id,appointment.jobId)).limit(1):[];const location=jobs[0]?.jobAddress||appointment.clientName;try{const result=await ctx.tool.weather(`${location} weather forecast for ${appointment.startsAt.slice(0,10)}`,{since:appointment.startsAt.slice(0,10),until:appointment.startsAt.slice(0,10),language_code:"en"});const day=result.content.forecast_days.find((item)=>item.date===appointment.startsAt.slice(0,10))??result.content.forecast_days[0];const chance=day?.precipitation_chance??null;const summary=day?.summary??result.content.summary;return{available:Boolean(day),location:result.content.location||location,date:appointment.startsAt.slice(0,10),summary,precipitationChance:chance,high:day?.high??null,low:day?.low??null,unit:result.content.conditions.unit,rainLikely:(chance??0)>=40||/rain|storm|shower/i.test(summary),asOf:new Date().toISOString(),source:result.content.sources[0]?.title??"Weather forecast"};}catch{return{available:false,location,date:appointment.startsAt.slice(0,10),summary:"",precipitationChance:null,high:null,low:null,unit:"°F",rainLikely:false,asOf:new Date().toISOString(),source:""};}} }),

  getExpansionSuite: defineAction({ request:z.object({today:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}), response:z.object({
    jobs:z.array(z.object({id:z.number(),label:z.string(),clientId:z.number().nullable(),clientName:z.string(),clientPhone:z.string()})), clients:z.array(z.object({id:z.number(),name:z.string(),phone:z.string()})),
    warranties:z.array(z.object({id:z.number(),jobId:z.number(),clientId:z.number().nullable(),jobLabel:z.string(),clientName:z.string(),clientPhone:z.string(),terms:z.string(),startDate:z.string(),durationMonths:z.number(),expiryDate:z.string(),status:z.enum(["active","expiring","expired"])})),
    lossReport:z.array(z.object({reason:z.string(),count:z.number(),value:z.number()})),
    crewHours:z.array(z.object({crewMember:z.string(),jobId:z.number(),jobLabel:z.string(),hours:z.number()})),
    suppliers:z.array(z.object({id:z.number(),name:z.string(),category:z.string(),phone:z.string(),email:z.string(),notes:z.string(),orderCount:z.number(),orderTotal:z.number()})),
    plans:z.array(z.object({id:z.number(),clientId:z.number().nullable(),clientName:z.string(),clientPhone:z.string(),title:z.string(),tasks:z.string(),startDate:z.string(),intervalMonths:z.number(),nextDueDate:z.string(),lastJobId:z.number().nullable(),active:z.boolean()})),
    scans:z.array(z.object({id:z.number(),jobId:z.number().nullable(),expenseId:z.number().nullable(),title:z.string(),kind:z.enum(["receipt","contract","other"]),filename:z.string(),url:z.string(),createdAt:z.string()})),
    videos:z.array(z.object({id:z.number(),jobId:z.number(),jobLabel:z.string(),caption:z.string(),branded:z.boolean(),filename:z.string(),contentType:z.string(),url:z.string(),createdAt:z.string()}))
  }), async handler(ctx,args){const db=ctx.db<typeof schema>();const [jobRows,clientRows,warrantyRows,quoteRows,timeRows,supplierRows,expenseRows,receiptRows,planRows,scanRows,videoRows]=await Promise.all([db.select().from(schema.jobs),db.select().from(schema.clients),db.select().from(schema.warranties),db.select().from(schema.quotes),db.select().from(schema.timeEntries),db.select().from(schema.suppliers),db.select().from(schema.businessExpenses),db.select().from(schema.receipts),db.select().from(schema.maintenancePlans),db.select().from(schema.scannedDocuments),db.select().from(schema.slideshowVideos)]);const jobLabel=(id:number)=>{const j=jobRows.find(x=>x.id===id);return j?`${j.clientName} · ${j.jobType}`:`Job #${id}`};const today=new Date(`${args.today}T12:00:00`).getTime();const lossKeys=["price","timing","competitor","no_response","other"] as const;const weekStart=new Date(`${args.today}T12:00:00`);weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));weekStart.setHours(0,0,0,0);return{jobs:jobRows.map(j=>({id:j.id,label:jobLabel(j.id),clientId:j.clientId,clientName:j.clientName,clientPhone:j.clientPhone})),clients:clientRows.map(c=>({id:c.id,name:c.name,phone:c.phone})),warranties:warrantyRows.map(w=>{const j=jobRows.find(x=>x.id===w.jobId);const days=Math.ceil((new Date(`${w.expiryDate}T12:00:00`).getTime()-today)/86400000);return{id:w.id,jobId:w.jobId,clientId:w.clientId??null,jobLabel:jobLabel(w.jobId),clientName:j?.clientName??"",clientPhone:j?.clientPhone??"",terms:w.terms,startDate:w.startDate,durationMonths:w.durationMonths,expiryDate:w.expiryDate,status:(days<0?"expired":days<=60?"expiring":"active") as "active"|"expiring"|"expired"}}),lossReport:lossKeys.map(reason=>{const rows=quoteRows.filter(q=>q.automationStatus==="lost"&&q.lostReason===reason);return{reason,count:rows.length,value:rows.reduce((s,q)=>s+Number(q.total.replace(/[^0-9.-]/g,"")||0),0)}}),crewHours:timeRows.filter(t=>t.startedAt>=weekStart).map(t=>({crewMember:t.crewMember||"Unassigned",jobId:t.jobId,jobLabel:jobLabel(t.jobId),hours:Math.max(0,((t.endedAt?.getTime()??Date.now())-t.startedAt.getTime())/3600000)})),suppliers:supplierRows.map(s=>{const orders=[...expenseRows.filter(e=>e.supplierId===s.id).map(e=>e.amount),...receiptRows.filter(r=>r.supplierId===s.id).map(r=>r.amount)];return{id:s.id,name:s.name,category:s.category,phone:s.phone,email:s.email,notes:s.notes,orderCount:orders.length,orderTotal:orders.reduce((n,v)=>n+Number(v.replace(/[^0-9.-]/g,"")||0),0)}}),plans:planRows.map(p=>({id:p.id,clientId:p.clientId,clientName:p.clientName,clientPhone:p.clientPhone,title:p.title,tasks:p.tasks,startDate:p.startDate,intervalMonths:p.intervalMonths,nextDueDate:p.nextDueDate,lastJobId:p.lastJobId,active:p.active})),scans:await Promise.all(scanRows.map(async s=>({id:s.id,jobId:s.jobId,expenseId:s.expenseId,title:s.title,kind:s.kind,filename:s.filename,url:await ctx.blobs.getUrl(s.blobKey),createdAt:s.createdAt.toISOString()}))),videos:await Promise.all(videoRows.map(async v=>({id:v.id,jobId:v.jobId,jobLabel:jobLabel(v.jobId),caption:v.caption,branded:v.branded,filename:v.filename,contentType:v.contentType,url:await ctx.blobs.getUrl(v.blobKey),createdAt:v.createdAt.toISOString()})))};} }),
  saveWarranty: defineAction({request:z.object({id:z.number().int().positive().nullable().default(null),jobId:z.number().int().positive(),terms:z.string().trim().max(5000),startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),durationMonths:z.number().int().min(1).max(240)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const job=(await db.select().from(schema.jobs).where(eq(schema.jobs.id,args.jobId)).limit(1))[0];const d=new Date(`${args.startDate}T12:00:00`);d.setMonth(d.getMonth()+args.durationMonths);const values={jobId:args.jobId,clientId:job?.clientId??null,terms:args.terms,startDate:args.startDate,durationMonths:args.durationMonths,expiryDate:d.toISOString().slice(0,10),updatedAt:new Date()};if(args.id){await db.update(schema.warranties).set(values).where(eq(schema.warranties.id,args.id));ctx.invalidateQueries();return{id:args.id};}const rows=await db.insert(schema.warranties).values({...values,createdAt:new Date()}).returning({id:schema.warranties.id});const made=rows[0];if(!made)throw new Error("Could not save warranty.");ctx.invalidateQueries();return{id:made.id};}}),
  saveSupplier: defineAction({request:z.object({id:z.number().int().positive().nullable().default(null),name:z.string().trim().min(1).max(160),category:z.string().trim().max(120),phone:z.string().trim().max(80),email:z.string().trim().email().or(z.literal("")),notes:z.string().trim().max(2000)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const now=new Date();if(args.id){await db.update(schema.suppliers).set({name:args.name,category:args.category,phone:args.phone,email:args.email,notes:args.notes,updatedAt:now}).where(eq(schema.suppliers.id,args.id));ctx.invalidateQueries();return{id:args.id};}const rows=await db.insert(schema.suppliers).values({...args,id:undefined,createdAt:now,updatedAt:now}).returning({id:schema.suppliers.id});const made=rows[0];if(!made)throw new Error("Could not save supplier.");ctx.invalidateQueries();return{id:made.id};}}),
  saveMaintenancePlan: defineAction({request:z.object({id:z.number().int().positive().nullable().default(null),clientId:z.number().int().positive().nullable().default(null),clientName:z.string().trim().min(1).max(160),clientPhone:z.string().trim().max(80),title:z.string().trim().min(1).max(200),tasks:z.string().trim().max(3000),startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),intervalMonths:z.number().int().min(1).max(120),active:z.boolean().default(true)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const d=new Date(`${args.startDate}T12:00:00`);d.setMonth(d.getMonth()+args.intervalMonths);const values={clientId:args.clientId,clientName:args.clientName,clientPhone:args.clientPhone,title:args.title,tasks:args.tasks,startDate:args.startDate,intervalMonths:args.intervalMonths,nextDueDate:d.toISOString().slice(0,10),active:args.active,updatedAt:new Date()};if(args.id){await db.update(schema.maintenancePlans).set(values).where(eq(schema.maintenancePlans.id,args.id));ctx.invalidateQueries();return{id:args.id};}const rows=await db.insert(schema.maintenancePlans).values({...values,lastJobId:null,createdAt:new Date()}).returning({id:schema.maintenancePlans.id});const made=rows[0];if(!made)throw new Error("Could not save plan.");ctx.invalidateQueries();return{id:made.id};}}),
  completeMaintenancePlan: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ jobId: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const plan = (await db.select().from(schema.maintenancePlans).where(eq(schema.maintenancePlans.id, args.id)).limit(1))[0];
      if (!plan) throw new Error("Plan not found.");
      const today = new Date().toISOString().slice(0, 10);
      if (plan.lastJobId && plan.nextDueDate > today) return { jobId: plan.lastJobId };

      const cycleDueDate = plan.nextDueDate;
      const existing = (await db.select().from(schema.jobs).where(and(eq(schema.jobs.maintenancePlanId, plan.id), eq(schema.jobs.maintenanceDueDate, cycleDueDate))).limit(1))[0];
      const now = new Date();
      const inserted = existing ? [] : await db.insert(schema.jobs).values({
        clientId: plan.clientId,
        clientName: plan.clientName,
        clientPhone: plan.clientPhone,
        jobAddress: "Address pending",
        jobType: plan.title,
        notes: plan.tasks,
        jobDate: cycleDueDate,
        maintenancePlanId: plan.id,
        maintenanceDueDate: cycleDueDate,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing().returning({ id: schema.jobs.id });
      const made = existing ?? inserted[0] ?? (await db.select().from(schema.jobs).where(and(eq(schema.jobs.maintenancePlanId, plan.id), eq(schema.jobs.maintenanceDueDate, cycleDueDate))).limit(1))[0];
      if (!made) throw new Error("Could not create maintenance job.");

      const next = new Date(`${cycleDueDate}T12:00:00`);
      next.setMonth(next.getMonth() + plan.intervalMonths);
      await db.update(schema.maintenancePlans).set({ lastJobId: made.id, nextDueDate: next.toISOString().slice(0, 10), updatedAt: now }).where(and(eq(schema.maintenancePlans.id, plan.id), eq(schema.maintenancePlans.nextDueDate, cycleDueDate)));
      ctx.invalidateQueries();
      return { jobId: made.id };
    }
  }),
  saveScannedDocument: defineAction({
    request: z.object({
      jobId: z.number().int().positive().nullable().default(null),
      expenseId: z.number().int().positive().nullable().default(null),
      title: z.string().trim().min(1).max(200),
      kind: z.enum(["receipt", "contract", "other"]),
      filename: z.string().min(1).max(240),
      dataBase64: z.string().min(1).max(30_000_000),
      expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),
      vendor: z.string().trim().max(160).default(""),
      amount: z.string().trim().max(80).default(""),
      category: z.string().trim().max(80).default("materials"),
      note: z.string().trim().max(1000).default(""),
    }),
    response: z.object({ id: z.number(), expenseId: z.number().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let expenseId = args.kind === "receipt" ? args.expenseId : null;
      let createdExpenseId: number | null = null;
      if (args.kind === "receipt" && !expenseId) {
        if (!args.expenseDate || !args.amount) throw new Error("Receipt date and amount are required.");
        const expenseRows = await db.insert(schema.businessExpenses).values({
          expenseDate: args.expenseDate,
          vendor: args.vendor || args.title,
          amount: normalizeMoney(args.amount, "0.00"),
          category: args.category || "materials",
          jobId: args.jobId,
          supplierId: null,
          note: args.note,
          createdAt: new Date(),
        }).returning({ id: schema.businessExpenses.id });
        createdExpenseId = expenseRows[0]?.id ?? null;
        expenseId = createdExpenseId;
        if (!expenseId) throw new Error("Could not create expense from receipt.");
      }
      if (expenseId) {
        const expense = (await db.select({ id: schema.businessExpenses.id }).from(schema.businessExpenses).where(eq(schema.businessExpenses.id, expenseId)).limit(1))[0];
        if (!expense) throw new Error("Expense not found.");
      }

      const key = `scans/${args.jobId ?? "general"}/${crypto.randomUUID()}.pdf`;
      await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: "application/pdf" });
      try {
        const rows = await db.insert(schema.scannedDocuments).values({ jobId: args.jobId, expenseId, title: args.title, kind: args.kind, blobKey: key, filename: args.filename, createdAt: new Date() }).returning({ id: schema.scannedDocuments.id });
        const made = rows[0];
        if (!made) throw new Error("Could not save scan.");
        ctx.invalidateQueries();
        return { id: made.id, expenseId };
      } catch (error) {
        await ctx.blobs.delete(key);
        if (createdExpenseId) await db.delete(schema.businessExpenses).where(eq(schema.businessExpenses.id, createdExpenseId));
        throw error;
      }
    }
  }),
  saveSlideshowVideo: defineAction({request:z.object({jobId:z.number().int().positive(),caption:z.string().trim().max(2000),branded:z.boolean(),filename:z.string().min(1).max(240),contentType:z.string().max(100),dataBase64:z.string().min(1).max(80_000_000),photoIds:z.array(z.number().int().positive()).min(1).max(100)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const {job}=await requireJobCompany(ctx,db,args.jobId);const photoRows=await db.select().from(schema.photos);const requested=photoRows.filter(p=>args.photoIds.includes(p.id)&&p.jobId===job.id);if(requested.length!==args.photoIds.length||requested.some(p=>p.excludeFromSocial))throw new Error("A photo marked Not for social cannot be exported.");const key=`slideshows/${job.id}/${crypto.randomUUID()}`;await ctx.blobs.put(key,Buffer.from(args.dataBase64,"base64"),{contentType:args.contentType});const rows=await ctx.db<typeof schema>().insert(schema.slideshowVideos).values({jobId:job.id,caption:args.caption,branded:args.branded,blobKey:key,filename:args.filename,contentType:args.contentType,createdAt:new Date()}).returning({id:schema.slideshowVideos.id});const made=rows[0];if(!made)throw new Error("Could not save video.");ctx.invalidateQueries();return{id:made.id};}}),
  getTaxExport: defineAction({request:z.object({year:z.number().int().min(2000).max(2100)}),response:z.object({rows:z.array(z.object({month:z.string(),type:z.enum(["revenue","expense","materials"]),category:z.string(),date:z.string(),description:z.string(),amount:z.number()}))}),async handler(ctx,args){const db=ctx.db<typeof schema>();const [payments,invoices,expenses,receipts,jobs]=await Promise.all([db.select().from(schema.payments),db.select().from(schema.invoices),db.select().from(schema.businessExpenses),db.select().from(schema.receipts),db.select().from(schema.jobs)]);const prefix=String(args.year);const rows=[...payments.filter(p=>p.paymentDate.startsWith(prefix)).map(p=>{const inv=invoices.find(i=>i.id===p.invoiceId);return{month:p.paymentDate.slice(0,7),type:"revenue" as const,category:p.method||"payment",date:p.paymentDate,description:inv?`${inv.clientName} · ${inv.jobType}`:`Invoice #${p.invoiceId}`,amount:Number(p.amount.replace(/[^0-9.-]/g,"")||0)}}),...expenses.filter(e=>e.expenseDate.startsWith(prefix)).map(e=>({month:e.expenseDate.slice(0,7),type:"expense" as const,category:e.category,date:e.expenseDate,description:[e.vendor,e.note].filter(Boolean).join(" · "),amount:Number(e.amount.replace(/[^0-9.-]/g,"")||0)})),...receipts.filter(r=>r.purchaseDate.startsWith(prefix)).map(r=>({month:r.purchaseDate.slice(0,7),type:"materials" as const,category:"job materials",date:r.purchaseDate,description:`${r.vendor}${jobs.find(j=>j.id===r.jobId)?` · ${jobs.find(j=>j.id===r.jobId)?.clientName}`:""}`,amount:Number(r.amount.replace(/[^0-9.-]/g,"")||0)}))];return{rows:rows.sort((a,b)=>a.date.localeCompare(b.date))};}}),


  getDocumentParameters: defineAction({ request:z.object({}), response:z.object({defaultTaxRate:z.string()}), async handler(ctx){const row=(await ctx.db<typeof schema>().select().from(schema.adminParameters).where(eq(schema.adminParameters.id,1)).limit(1))[0];return{defaultTaxRate:row?.defaultTaxRate??"0"};} }),
  getAdminConsole: defineAction({
    request: z.object({ table: z.string().max(80).default("jobs") }),
    response: z.object({
      allowed: z.boolean(),
      currentUser: z.object({ id: z.number(), name: z.string(), role: z.enum(["owner", "crew"]) }).nullable(),
      inbox: z.array(z.object({ id: z.number(), kind: z.enum(["support", "problem", "question", "general", "feature"]), subject: z.string(), message: z.string(), language: languageSchema, status: z.enum(["open", "resolved"]), isUnread: z.boolean(), createdAt: z.string(), resolvedAt: z.string().nullable() })),
      users: z.array(z.object({ id: z.number(), name: z.string(), role: z.enum(["owner", "crew"]), isCurrent: z.boolean(), active: z.boolean(), createdAt: z.string() })),
      parameters: z.object({ paymentDay1: z.number(), paymentDay2: z.number(), paymentDay3: z.number(), reviewDelayDays: z.number(), reengagementMonth1: z.number(), reengagementMonth2: z.number(), quoteExpiryWarningDays: z.number(), materialLeadTimeDays: z.number(), defaultTaxRate: z.string(), hourlyLaborCost: z.string() }),
      tables: z.array(z.object({ key: z.string(), count: z.number() })),
      recentRows: z.array(z.object({ id: z.string(), title: z.string(), detail: z.string(), date: z.string() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let userRows = await db.select().from(schema.appUsers).orderBy(schema.appUsers.id);
      if (userRows.length === 0) {
        await db.insert(schema.appUsers).values({ name: "Danny", role: "owner", isCurrent: true, active: true, createdAt: new Date(), updatedAt: new Date() });
        userRows = await db.select().from(schema.appUsers).orderBy(schema.appUsers.id);
      }
      const current = userRows.find((user) => user.isCurrent && user.active) ?? null;
      if (!current || current.role !== "owner") return { allowed: false, currentUser: current ? { id: current.id, name: current.name, role: current.role } : null, inbox: [], users: [], parameters: { paymentDay1: 3, paymentDay2: 14, paymentDay3: 30, reviewDelayDays: 1, reengagementMonth1: 6, reengagementMonth2: 12, quoteExpiryWarningDays: 3, materialLeadTimeDays: 14, defaultTaxRate: "0", hourlyLaborCost: "0" }, tables: [], recentRows: [] };
      let parameter = (await db.select().from(schema.adminParameters).where(eq(schema.adminParameters.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1))[0];
      if (!parameter) {
        await db.insert(schema.adminParameters).values({ updatedAt: new Date() });
        parameter = (await db.select().from(schema.adminParameters).where(eq(schema.adminParameters.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1))[0];
      }
      if (!parameter) throw new Error("Admin parameters are unavailable.");
      const collections = await Promise.all([
        db.select().from(schema.clients), db.select().from(schema.jobs), db.select().from(schema.photos), db.select().from(schema.documents), db.select().from(schema.quotes), db.select().from(schema.invoices), db.select().from(schema.punchItems), db.select().from(schema.punchSignoffs), db.select().from(schema.progressUpdates), db.select().from(schema.settings), db.select().from(schema.timeEntries), db.select().from(schema.receipts), db.select().from(schema.crewTasks), db.select().from(schema.voiceNotes), db.select().from(schema.payments), db.select().from(schema.completionCertificates), db.select().from(schema.appointments), db.select().from(schema.leads), db.select().from(schema.selections), db.select().from(schema.dailyLogs), db.select().from(schema.internalNotes), db.select().from(schema.paymentMilestones), db.select().from(schema.automationLogs), db.select().from(schema.supportReports), db.select().from(schema.priceBookItems), db.select().from(schema.quoteTemplates), db.select().from(schema.mileageTrips), db.select().from(schema.businessExpenses), db.select().from(schema.subcontractors), db.select().from(schema.shareImages), db.select().from(schema.warranties), db.select().from(schema.slideshowVideos), db.select().from(schema.scannedDocuments), db.select().from(schema.suppliers), db.select().from(schema.maintenancePlans), db.select().from(schema.appUsers), db.select().from(schema.adminParameters),
      ]);
      const keys = ["clients","jobs","photos","documents","quotes","invoices","punch_items","punch_signoffs","progress_updates","settings","time_entries","receipts","crew_tasks","voice_notes","payments","completion_certificates","appointments","leads","selections","daily_logs","internal_notes","payment_milestones","automation_logs","support_reports","price_book_items","quote_templates","mileage_trips","business_expenses","subcontractors","share_images","warranties","slideshow_videos","scanned_documents","suppliers","maintenance_plans","app_users","admin_parameters"];
      const tables = keys.map((key, index) => ({ key, count: collections[index]?.length ?? 0 }));
      const selectedIndex = keys.indexOf(args.table);
      const selected = selectedIndex >= 0 ? collections[selectedIndex] ?? [] : [];
      const recentRows = selected.slice(-8).reverse().map((value, index) => {
        const row = value as unknown as Record<string, unknown>;
        const id = String(row.id ?? index + 1);
        const title = String(row.name ?? row.clientName ?? row.title ?? row.subject ?? row.item ?? row.label ?? row.jobType ?? `${args.table.replaceAll("_", " ")} #${id}`);
        const detail = String(row.status ?? row.stage ?? row.kind ?? row.role ?? row.vendor ?? row.category ?? row.phone ?? row.email ?? "Stored record");
        const rawDate = row.updatedAt ?? row.createdAt ?? row.paymentDate ?? row.issueDate ?? row.jobDate ?? row.startsAt ?? row.expenseDate ?? row.tripDate ?? "";
        const date = rawDate instanceof Date ? rawDate.toISOString() : String(rawDate);
        return { id, title, detail, date };
      });
      const inboxRows = await db.select().from(schema.supportReports).orderBy(desc(schema.supportReports.createdAt));
      return {
        allowed: true,
        currentUser: { id: current.id, name: current.name, role: current.role },
        inbox: inboxRows.map((row) => ({ id: row.id, kind: row.kind, subject: row.subject, message: row.message, language: row.language, status: row.status, isUnread: row.isUnread, createdAt: row.createdAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null })),
        users: userRows.map((row) => ({ id: row.id, name: row.name, role: row.role, isCurrent: row.isCurrent, active: row.active, createdAt: row.createdAt.toISOString() })),
        parameters: { paymentDay1: parameter.paymentDay1, paymentDay2: parameter.paymentDay2, paymentDay3: parameter.paymentDay3, reviewDelayDays: parameter.reviewDelayDays, reengagementMonth1: parameter.reengagementMonth1, reengagementMonth2: parameter.reengagementMonth2, quoteExpiryWarningDays: parameter.quoteExpiryWarningDays, materialLeadTimeDays: parameter.materialLeadTimeDays, defaultTaxRate: parameter.defaultTaxRate, hourlyLaborCost: parameter.hourlyLaborCost },
        tables,
        recentRows,
      };
    },
  }),
  updateSupportReport: defineAction({ request: z.object({ id: z.number().int().positive(), status: z.enum(["open", "resolved"]), isUnread: z.boolean() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db=ctx.db<typeof schema>(); const current=(await db.select().from(schema.appUsers).where(eq(schema.appUsers.isCurrent,true)).limit(1))[0]; if(!current||current.role!=="owner") throw new Error("Owner access required."); await db.update(schema.supportReports).set({status:args.status,isUnread:args.isUnread,resolvedAt:args.status==="resolved"?new Date():null,updatedAt:new Date()}).where(eq(schema.supportReports.id,args.id)); ctx.invalidateQueries(); return{ok:true}; } }),
  addAppUser: defineAction({ request: z.object({ name: z.string().trim().min(1).max(160), role: z.enum(["owner", "crew"]) }), response: z.object({ id: z.number() }), async handler(ctx,args){const db=ctx.db<typeof schema>();const current=(await db.select().from(schema.appUsers).where(eq(schema.appUsers.isCurrent,true)).limit(1))[0];if(!current||current.role!=="owner")throw new Error("Owner access required.");const rows=await db.insert(schema.appUsers).values({name:args.name,role:args.role,isCurrent:false,active:true,createdAt:new Date(),updatedAt:new Date()}).returning({id:schema.appUsers.id});const made=rows[0];if(!made)throw new Error("Could not add user.");ctx.invalidateQueries();return{id:made.id};} }),
  updateAppUser: defineAction({ request: z.object({ id: z.number().int().positive(), role: z.enum(["owner", "crew"]), active: z.boolean() }), response:z.object({ok:z.literal(true)}), async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const current=(await db.select().from(schema.appUsers).where(eq(schema.appUsers.isCurrent,true)).limit(1))[0];if(!current||current.role!=="owner")throw new Error("Owner access required.");await db.update(schema.appUsers).set({role:args.role,active:args.active,updatedAt:new Date()}).where(eq(schema.appUsers.id,args.id));ctx.invalidateQueries();return{ok:true};} }),
  updateAdminParameters: defineAction({ request: z.object({ paymentDay1:z.number().int().min(1).max(365),paymentDay2:z.number().int().min(1).max(365),paymentDay3:z.number().int().min(1).max(365),reviewDelayDays:z.number().int().min(0).max(90),reengagementMonth1:z.number().int().min(1).max(120),reengagementMonth2:z.number().int().min(1).max(120),quoteExpiryWarningDays:z.number().int().min(0).max(90),materialLeadTimeDays:z.number().int().min(0).max(730),defaultTaxRate:z.string().trim().max(20),hourlyLaborCost:z.string().trim().max(80) }), response:z.object({ok:z.literal(true)}), async handler(ctx,args):Promise<{ok:true}>{if(!(args.paymentDay1<args.paymentDay2&&args.paymentDay2<args.paymentDay3))throw new Error("Payment days must increase.");if(!(args.reengagementMonth1<args.reengagementMonth2))throw new Error("Re-engagement months must increase.");const db=ctx.db<typeof schema>();const current=(await db.select().from(schema.appUsers).where(eq(schema.appUsers.isCurrent,true)).limit(1))[0];if(!current||current.role!=="owner")throw new Error("Owner access required.");const exists=(await db.select().from(schema.adminParameters).where(eq(schema.adminParameters.id,1)).limit(1))[0];if(exists)await db.update(schema.adminParameters).set({...args,updatedAt:new Date()}).where(eq(schema.adminParameters.id,1));else await db.insert(schema.adminParameters).values({id:1,...args,updatedAt:new Date()});const setting=(await db.select().from(schema.settings).where(eq(schema.settings.id,1)).limit(1))[0];if(setting)await db.update(schema.settings).set({hourlyCostRate:args.hourlyLaborCost,updatedAt:new Date()}).where(eq(schema.settings.id,1));ctx.invalidateQueries();return{ok:true};} }),

  createPortalLink: defineAction({ request: z.object({ jobId: z.number().int().positive(), expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.literal(0)]).default(90) }), response: z.object({ token: z.string(), route: z.string(), expiresAt: z.string().nullable() }), async handler(ctx, args) { const db=ctx.db<typeof schema>(); const job=(await db.select().from(schema.jobs).where(eq(schema.jobs.id,args.jobId)).limit(1))[0]; if(!job) throw new Error("Job not found."); const token=`${crypto.randomUUID().replace(/-/g,"")}${crypto.randomUUID().replace(/-/g,"")}`; const hash=await hashPortalToken(token); await db.update(schema.portalTokens).set({revokedAt:new Date()}).where(and(eq(schema.portalTokens.jobId,args.jobId),isNull(schema.portalTokens.revokedAt))); const expiresAt=args.expiresInDays===0?null:new Date(Date.now()+args.expiresInDays*86400000); await db.insert(schema.portalTokens).values({jobId:args.jobId,tokenHash:hash,tokenHint:token.slice(-6),expiresAt,createdAt:new Date()}); ctx.invalidateQueries(); return{token,route:`#portal=${encodeURIComponent(token)}`,expiresAt:expiresAt?.toISOString()??null}; } }),
  revokePortalLink: defineAction({ request:z.object({jobId:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().update(schema.portalTokens).set({revokedAt:new Date()}).where(and(eq(schema.portalTokens.jobId,args.jobId),isNull(schema.portalTokens.revokedAt)));ctx.invalidateQueries();return{ok:true};} }),
  getPortalLinkInfo: defineAction({ request: z.object({ jobId: z.number().int().positive() }), response: z.object({ link: z.object({ hint: z.string(), expiresAt: z.string().nullable(), expired: z.boolean(), viewCount: z.number(), firstViewedAt: z.string().nullable(), lastViewedAt: z.string().nullable(), createdAt: z.string() }).nullable() }), async handler(ctx, args) { const db=ctx.db<typeof schema>(); const link=(await db.select().from(schema.portalTokens).where(and(eq(schema.portalTokens.jobId,args.jobId),isNull(schema.portalTokens.revokedAt))).orderBy(desc(schema.portalTokens.createdAt)).limit(1))[0]; if(!link) return{link:null}; return{link:{hint:link.tokenHint,expiresAt:link.expiresAt?.toISOString()??null,expired:link.expiresAt?link.expiresAt.getTime()<Date.now():false,viewCount:link.viewCount,firstViewedAt:link.firstViewedAt?.toISOString()??null,lastViewedAt:link.lastViewedAt?.toISOString()??null,createdAt:link.createdAt.toISOString()}}; } }),
  rotatePortalLink: defineAction({ request: z.object({ jobId: z.number().int().positive(), expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.literal(0)]).default(90) }), response: z.object({ token: z.string(), route: z.string(), expiresAt: z.string().nullable() }), async handler(ctx, args): Promise<{token:string;route:string;expiresAt:string|null}> { const db=ctx.db<typeof schema>(); const job=(await db.select().from(schema.jobs).where(eq(schema.jobs.id,args.jobId)).limit(1))[0]; if(!job) throw new Error("Job not found."); const token=`${crypto.randomUUID().replace(/-/g,"")}${crypto.randomUUID().replace(/-/g,"")}`; const hash=await hashPortalToken(token); const now=new Date(); const expiresAt=args.expiresInDays===0?null:new Date(now.getTime()+args.expiresInDays*86400000); await db.batch([db.update(schema.portalTokens).set({revokedAt:now}).where(and(eq(schema.portalTokens.jobId,args.jobId),isNull(schema.portalTokens.revokedAt))),db.insert(schema.portalTokens).values({jobId:args.jobId,tokenHash:hash,tokenHint:token.slice(-6),expiresAt,createdAt:now})]); ctx.invalidateQueries(); return{token,route:`#portal=${encodeURIComponent(token)}`,expiresAt:expiresAt?.toISOString()??null}; } }),
  getPortalData: defineAction({ request:z.object({token:z.string().min(32).max(200)}),response:z.object({job:z.object({id:z.number(),clientName:z.string(),jobType:z.string(),jobAddress:z.string()}),photos:z.array(z.object({id:z.number(),stage:stageSchema,caption:z.string(),url:z.string()})),appointments:z.array(z.object({id:z.number(),startsAt:z.string(),notes:z.string()})),selections:z.array(selectionSchema),changeOrders:z.array(z.object({id:z.number(),title:z.string(),description:z.string(),amount:z.string(),originalUrl:z.string().nullable(),clientSignerName:z.string(),clientSignedAt:z.string().nullable()})),estimates:z.array(z.object({id:z.number(),total:z.string(),sentAt:z.string(),accepted:z.boolean(),lineItems:z.array(z.object({description:z.string(),amount:z.string()}))})),invoices:z.array(z.object({id:z.number(),invoiceNumber:z.string(),total:z.string(),status:z.string(),dueDate:z.string(),balanceDue:z.string()}))}),async handler(ctx,args){const db=ctx.db<typeof schema>();const access=await requirePortalAccess(ctx,args.token,{logView:true});const job=(await db.select().from(schema.jobs).where(eq(schema.jobs.id,access.jobId)).limit(1))[0];if(!job)throw new Error("Job not found.");const [photos,appointments,selections,documents,quotes,invoices,payments]=await Promise.all([db.select().from(schema.photos).where(eq(schema.photos.jobId,job.id)).orderBy(schema.photos.createdAt),db.select().from(schema.appointments).where(eq(schema.appointments.jobId,job.id)).orderBy(schema.appointments.startsAt),db.select().from(schema.selections).where(eq(schema.selections.jobId,job.id)).orderBy(schema.selections.id),db.select().from(schema.documents).where(eq(schema.documents.jobId,job.id)).orderBy(desc(schema.documents.createdAt)),db.select().from(schema.quotes).where(and(eq(schema.quotes.jobId,job.id),eq(schema.quotes.superseded,false))).orderBy(desc(schema.quotes.createdAt)),db.select().from(schema.invoices).where(eq(schema.invoices.jobId,job.id)).orderBy(desc(schema.invoices.createdAt)),db.select().from(schema.payments)]);const today=new Date().toISOString();return{job:{id:job.id,clientName:job.clientName,jobType:job.jobType,jobAddress:job.jobAddress},photos:await Promise.all(photos.filter(p=>!p.excludeFromSocial).map(async p=>({id:p.id,stage:p.stage,caption:p.caption,url:await ctx.blobs.getUrl(p.blobKey)}))),appointments:appointments.filter(a=>a.startsAt>=today).map(a=>({id:a.id,startsAt:a.startsAt,notes:a.notes})),selections:await Promise.all(selections.map(async s=>({id:s.id,jobId:s.jobId,category:s.category,item:s.item,vendor:s.vendor,photoUrl:s.photoBlobKey?await ctx.blobs.getUrl(s.photoBlobKey):null,approvalStatus:s.approvalStatus,leadTimeDays:s.leadTimeDays,estimatedCost:s.estimatedCost,actualCost:s.actualCost,createdAt:s.createdAt.toISOString()}))),changeOrders:await Promise.all(documents.filter(d=>d.kind==="change_order").map(async d=>({id:d.id,title:d.title,description:d.description,amount:d.amount,originalUrl:d.originalBlobKey?await ctx.blobs.getUrl(d.originalBlobKey):null,clientSignerName:d.clientSignerName,clientSignedAt:d.clientSignedAt?.toISOString()??null}))),estimates:quotes.map(q=>({id:q.id,total:q.total,sentAt:q.sentAt,accepted:q.accepted,lineItems:(JSON.parse(q.lineItemsJson) as Array<{description:string;amount:string}>).map(i=>({description:i.description,amount:i.amount}))})),invoices:invoices.map(inv=>{const paid=payments.filter(p=>p.invoiceId===inv.id).reduce((s,p)=>s+Number(String(p.amount).replace(/[^0-9.-]/g,"")||0),0);const total=Number(String(inv.total).replace(/[^0-9.-]/g,"")||0);return{id:inv.id,invoiceNumber:inv.invoiceNumber,total:inv.total,status:inv.status,dueDate:inv.dueDate,balanceDue:Math.max(0,total-paid).toFixed(2)};}) };} }),
  portalUpdateSelection: defineAction({request:z.object({token:z.string().min(32).max(200),selectionId:z.number().int().positive(),status:z.enum(["approved","rejected"])}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const access=await requirePortalAccess(ctx,args.token,{logView:false});const selection=(await db.select().from(schema.selections).where(eq(schema.selections.id,args.selectionId)).limit(1))[0];if(!selection||selection.jobId!==access.jobId)throw new Error("Selection not found.");await db.update(schema.selections).set({approvalStatus:args.status}).where(eq(schema.selections.id,selection.id));await logPortalEvent(ctx,access.id,args.status==="approved"?"approve_selection":"reject_selection");ctx.invalidateQueries();return{ok:true};} }),
  portalSignChangeOrder: defineAction({request:z.object({token:z.string().min(32).max(200),documentId:z.number().int().positive(),signerName:z.string().trim().min(1).max(160),signatureDataBase64:z.string().min(1).max(5_000_000)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const access=await requirePortalAccess(ctx,args.token,{logView:false});const document=(await db.select().from(schema.documents).where(eq(schema.documents.id,args.documentId)).limit(1))[0];if(!document||document.jobId!==access.jobId||document.kind!=="change_order")throw new Error("Change order not found.");if(document.clientSignedAt)return{ok:true};const key=`client-signatures/${access.jobId}/${crypto.randomUUID()}.png`;await ctx.blobs.put(key,Buffer.from(args.signatureDataBase64,"base64"),{contentType:"image/png"});await db.update(schema.documents).set({clientSignerName:args.signerName,clientSignatureBlobKey:key,clientSignedAt:new Date()}).where(eq(schema.documents.id,document.id));await logPortalEvent(ctx,access.id,"sign");const jobCompany=(await db.select({companyId:schema.jobs.companyId}).from(schema.jobs).where(eq(schema.jobs.id,document.jobId)).limit(1))[0];if(jobCompany)await notifyCompanyEvent(ctx,jobCompany.companyId,"notifyDocSigned","document-signed",`Client signed "${document.title}"`,"Un cliente firmó tu documento",`doc-signed:${document.id}`);ctx.invalidateQueries();return{ok:true};} }),
  createDocumentLink: defineAction({ request: z.object({ kind: documentKindSchema, id: z.number().int().positive() }), response: z.object({ token: z.string(), hint: z.string(), expiresAt: z.string() }), async handler(ctx, args) { const db=ctx.db<typeof schema>(); if(!await documentLinkTargetExists(ctx,args.kind,args.id)) throw new Error("Document not found."); const token=`${crypto.randomUUID().replace(/-/g,"")}${crypto.randomUUID().replace(/-/g,"")}`; const hash=await hashLinkToken(token); const now=new Date(); const expiresAt=new Date(now.getTime()+30*86400000); await db.update(schema.documentLinks).set({revokedAt:now}).where(and(eq(schema.documentLinks.documentKind,args.kind),eq(schema.documentLinks.documentId,args.id),isNull(schema.documentLinks.revokedAt))); await db.insert(schema.documentLinks).values({documentKind:args.kind,documentId:args.id,tokenHash:hash,tokenHint:token.slice(-6),expiresAt,createdAt:now}); ctx.invalidateQueries(); return{token,hint:token.slice(-6),expiresAt:expiresAt.toISOString()}; } }),
  getDocumentLinkInfo: defineAction({ request: z.object({ kind: documentKindSchema, id: z.number().int().positive() }), response: z.object({ link: z.object({ hint: z.string(), expiresAt: z.string(), expired: z.boolean(), viewCount: z.number(), firstViewedAt: z.string().nullable(), lastViewedAt: z.string().nullable(), createdAt: z.string() }).nullable() }), async handler(ctx, args) { const link=await getActiveDocumentLinkRow(ctx,args.kind,args.id); if(!link) return{link:null}; return{link:{hint:link.tokenHint,expiresAt:link.expiresAt.toISOString(),expired:link.expiresAt.getTime()<Date.now(),viewCount:link.viewCount,firstViewedAt:link.firstViewedAt?.toISOString()??null,lastViewedAt:link.lastViewedAt?.toISOString()??null,createdAt:link.createdAt.toISOString()}}; } }),
  revokeDocumentLink: defineAction({ request: z.object({ kind: documentKindSchema, id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx,args): Promise<{ok:true}> { await ctx.db<typeof schema>().update(schema.documentLinks).set({revokedAt:new Date()}).where(and(eq(schema.documentLinks.documentKind,args.kind),eq(schema.documentLinks.documentId,args.id),isNull(schema.documentLinks.revokedAt))); ctx.invalidateQueries(); return{ok:true}; } }),
  resolveDocumentLink: defineAction({ request: z.object({ token: z.string().min(64).max(200), userAgent: z.string().max(500).default("") }), response: z.object({ kind: documentKindSchema, documentId: z.number(), signable: z.boolean(), alreadySigned: z.boolean(), company: z.object({ name: z.string(), phone: z.string(), email: z.string(), website: z.string(), licenseNumber: z.string(), logoUrl: z.string().nullable() }), title: z.string(), clientName: z.string(), jobAddress: z.string(), jobType: z.string(), lineItems: z.array(z.object({ description: z.string(), amount: z.string() })), subtotal: z.string(), total: z.string(), dateLabel: z.string(), dateValue: z.string(), footnote: z.string(), bodyText: z.string(), description: z.string(), amount: z.string(), contractorSignerName: z.string(), linkExpiresAt: z.string() }), async handler(ctx, args) {
    const db=ctx.db<typeof schema>(); const link=await resolveDocumentLinkToken(ctx,args.token);
    const now=new Date();
    // Build 2: notify the company the first time a shared invoice/estimate is viewed each day (avoids spam from repeat opens).
    const dayAgo=new Date(now.getTime()-24*3600_000);
    const recentView=(await db.select({id:schema.documentLinkEvents.id}).from(schema.documentLinkEvents).where(and(eq(schema.documentLinkEvents.linkId,link.id),eq(schema.documentLinkEvents.eventType,"view"),gte(schema.documentLinkEvents.occurredAt,dayAgo))).limit(1))[0];
    const notifyView=!recentView&&(link.documentKind==="invoice"||link.documentKind==="quote");
    await db.update(schema.documentLinks).set({viewCount:link.viewCount+1,firstViewedAt:link.firstViewedAt??now,lastViewedAt:now}).where(eq(schema.documentLinks.id,link.id));
    await db.insert(schema.documentLinkEvents).values({linkId:link.id,eventType:"view",userAgent:args.userAgent.slice(0,300),occurredAt:now});
    const settings=(await db.select().from(schema.settings).where(eq(schema.settings.id,1)).limit(1))[0];
    const company={name:settings?.companyName??"",phone:settings?.phone??"",email:settings?.email??"",website:settings?.website??"",licenseNumber:settings?.licenseNumber??"",logoUrl:settings?.logoBlobKey?await ctx.blobs.getUrl(settings.logoBlobKey):null};
    const base={kind:link.documentKind,documentId:link.documentId,signable:false,alreadySigned:false,company,title:"",clientName:"",jobAddress:"",jobType:"",lineItems:[] as Array<{description:string;amount:string}>,subtotal:"",total:"",dateLabel:"",dateValue:"",footnote:"",bodyText:"",description:"",amount:"",contractorSignerName:"",linkExpiresAt:link.expiresAt.toISOString()};
    if(link.documentKind==="invoice"){const row=(await db.select().from(schema.invoices).where(eq(schema.invoices.id,link.documentId)).limit(1))[0];if(!row)throw new Error("This document is no longer available.");if(notifyView)await notifyCompanyEvent(ctx,link.companyId,"notifyInvoiceViewed","document-viewed",`Client viewed invoice #${row.id}`,"Un cliente vio tu factura",`invoice:${row.id}`);return{...base,title:`Invoice #${row.id}`,clientName:row.clientName,jobAddress:row.jobAddress,jobType:row.jobType,lineItems:JSON.parse(row.lineItemsJson),subtotal:row.subtotal,total:row.total,dateLabel:"Due date",dateValue:row.dueDate,footnote:row.footnote};}
    if(link.documentKind==="quote"){const row=(await db.select().from(schema.quotes).where(eq(schema.quotes.id,link.documentId)).limit(1))[0];if(!row)throw new Error("This document is no longer available.");if(notifyView)await notifyCompanyEvent(ctx,link.companyId,"notifyEstimateViewed","document-viewed",`Client viewed estimate #${row.id}`,"Un cliente vio tu estimado",`quote:${row.id}`);return{...base,title:`Estimate #${row.id}`,clientName:row.clientName,jobAddress:row.jobAddress,jobType:row.jobType,lineItems:JSON.parse(row.lineItemsJson),subtotal:row.subtotal,total:row.total,dateLabel:"Valid until",dateValue:row.expiryDate,footnote:row.footnote};}
    const doc=(await db.select().from(schema.documents).where(eq(schema.documents.id,link.documentId)).limit(1))[0];if(!doc||doc.kind!==link.documentKind)throw new Error("This document is no longer available.");
    const job=(await db.select().from(schema.jobs).where(eq(schema.jobs.id,doc.jobId)).limit(1))[0];
    return{...base,signable:true,alreadySigned:!!doc.clientSignedAt,title:doc.title,clientName:job?.clientName??"",jobAddress:job?.jobAddress??"",jobType:job?.jobType??"",bodyText:doc.bodyText,description:doc.description,amount:doc.amount,contractorSignerName:doc.signerName,dateLabel:"Signed",dateValue:doc.signedAt.toISOString().slice(0,10)};
  } }),
  submitDocumentSignature: defineAction({ request: z.object({ token: z.string().min(64).max(200), signerName: z.string().trim().min(1).max(160), signatureDataBase64: z.string().min(1).max(5_000_000), signedPdfDataBase64: z.string().min(1).max(30_000_000), userAgent: z.string().max(500).default("") }), response: z.object({ ok: z.literal(true), signedAt: z.string() }), async handler(ctx,args): Promise<{ok:true;signedAt:string}> {
    const db=ctx.db<typeof schema>(); const link=await resolveDocumentLinkToken(ctx,args.token);
    if(link.documentKind!=="contract"&&link.documentKind!=="change_order")throw new Error("This document cannot be signed.");
    const doc=(await db.select().from(schema.documents).where(eq(schema.documents.id,link.documentId)).limit(1))[0];if(!doc||doc.kind!==link.documentKind)throw new Error("This document is no longer available.");
    if(doc.clientSignedAt)throw new Error("This document was already signed.");
    const pdfBytes=Buffer.from(args.signedPdfDataBase64,"base64"); if(pdfBytes.length<100)throw new Error("The signed file looks invalid.");
    const digest=await crypto.subtle.digest("SHA-256",pdfBytes); const hash=Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,"0")).join("");
    const now=new Date(); const sigKey=`client-signatures/${doc.jobId}/${crypto.randomUUID()}.png`; const pdfKey=`client-signed-pdfs/${doc.jobId}/${crypto.randomUUID()}.pdf`;
    await ctx.blobs.put(sigKey,Buffer.from(args.signatureDataBase64,"base64"),{contentType:"image/png"});
    await ctx.blobs.put(pdfKey,pdfBytes,{contentType:"application/pdf"});
    await db.update(schema.documents).set({clientSignerName:args.signerName,clientSignatureBlobKey:sigKey,clientSignedAt:now,clientSignedPdfBlobKey:pdfKey,clientSignatureHash:hash,clientSignedUserAgent:args.userAgent.slice(0,300)}).where(eq(schema.documents.id,doc.id));
    await db.insert(schema.documentLinkEvents).values({linkId:link.id,eventType:"sign",userAgent:args.userAgent.slice(0,300),occurredAt:now});
    // Build 2: tell the company a client signed their document (in-app + push, preference-gated).
    await notifyCompanyEvent(ctx,link.companyId,"notifyDocSigned","document-signed",`Client signed "${doc.title}"`,"Un cliente firmó tu documento",`doc-signed:${doc.id}`);
    ctx.invalidateQueries(); return{ok:true,signedAt:now.toISOString()};
  } }),
  // Phase 1: per-document activity timeline (estimate / invoice). Derived
  // from existing authoritative data — no new table: quote sent/accepted/
  // converted, document-link shared/viewed, payment-reminder automation logs,
  // recorded payments, and signatures.
  getDocumentTimeline: defineAction({
    request: z.object({ kind: z.enum(["quote", "invoice"]), id: z.number().int().positive() }),
    response: z.object({ events: z.array(z.object({ type: z.string(), at: z.string().nullable(), detail: z.string().default("") })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const events: Array<{ type: string; at: string | null; detail: string }> = [];
      const push = (type: string, at: Date | string | null | undefined, detail = "") => {
        let iso: string | null = null;
        if (at instanceof Date && !Number.isNaN(at.getTime())) iso = at.toISOString();
        else if (typeof at === "string" && at.trim()) {
          const d = new Date(/T/.test(at) ? at : `${at}T12:00:00`);
          if (!Number.isNaN(d.getTime())) iso = d.toISOString();
        }
        events.push({ type, at: iso, detail });
      };
      const pushLinkEvents = async (kind: "quote" | "invoice", id: number) => {
        const links = await db.select().from(schema.documentLinks)
          .where(and(eq(schema.documentLinks.documentKind, kind), eq(schema.documentLinks.documentId, id)))
          .orderBy(schema.documentLinks.createdAt);
        for (const link of links) push("shared", link.createdAt, "Link shared");
        const firstViews = links.map((l) => l.firstViewedAt).filter((d): d is Date => !!d);
        const totalViews = links.reduce((s, l) => s + l.viewCount, 0);
        if (firstViews.length) push("viewed", new Date(Math.min(...firstViews.map((d) => d.getTime()))), totalViews > 1 ? `${totalViews} views` : "First view");
        return links;
      };
      if (args.kind === "quote") {
        const quote = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, args.id)).limit(1))[0];
        if (!quote) throw new Error("Estimate not found.");
        push("created", quote.createdAt);
        if (quote.sentAt) push("sent", quote.sentAt, "Sent to client");
        await pushLinkEvents("quote", quote.id);
        if (quote.estimateNudgeSentAt) push("reminder", quote.estimateNudgeSentAt, "Follow-up reminder sent");
        if (quote.accepted) push("approved", quote.updatedAt, "Estimate approved");
        if (quote.convertedToInvoiceId) push("converted", quote.updatedAt, "Converted to invoice");
      } else {
        const invoice = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, args.id)).limit(1))[0];
        if (!invoice) throw new Error("Invoice not found.");
        push("created", invoice.createdAt);
        if (invoice.status !== "draft") push("sent", invoice.updatedAt, "Sent to client");
        await pushLinkEvents("invoice", invoice.id);
        const reminders = await db.select().from(schema.automationLogs)
          .where(and(eq(schema.automationLogs.kind, "payment"), eq(schema.automationLogs.entityId, invoice.id)))
          .orderBy(schema.automationLogs.sentAt);
        for (const r of reminders) push("reminder", r.sentAt, r.stage || "Payment reminder");
        const paymentRows = await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, invoice.id)).orderBy(schema.payments.paymentDate);
        for (const p of paymentRows) push("paid", p.paymentDate, `Payment ${p.amount}${p.method ? ` · ${p.method}` : ""}`);
      }
      events.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
      return { events };
    },
  }),
  // Phase 1: first-run activation checklist. Steps are computed live from real
  // data; only dismissal is persisted per user.
  getOnboardingChecklist: defineAction({
    request: z.object({}),
    response: z.object({
      steps: z.array(z.object({ key: z.string(), titleEn: z.string(), titleEs: z.string(), done: z.boolean() })),
      dismissed: z.boolean(),
      allDone: z.boolean(),
    }),
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const [clients, jobs, quotes, invoices, payments] = await Promise.all([
        db.select({ id: schema.clients.id }).from(schema.clients).limit(1),
        db.select({ id: schema.jobs.id }).from(schema.jobs).limit(1),
        db.select({ sentAt: schema.quotes.sentAt }).from(schema.quotes).where(ne(schema.quotes.sentAt, "")).limit(1),
        db.select({ id: schema.invoices.id }).from(schema.invoices).limit(1),
        db.select({ id: schema.payments.id }).from(schema.payments).limit(1),
      ]);
      const steps = [
        { key: "add_client", titleEn: "Add your first client", titleEs: "Agrega tu primer cliente", done: clients.length > 0 },
        { key: "create_job", titleEn: "Create a job", titleEs: "Crea un trabajo", done: jobs.length > 0 },
        { key: "send_estimate", titleEn: "Send an estimate", titleEs: "Envía un presupuesto", done: quotes.length > 0 },
        { key: "send_invoice", titleEn: "Send an invoice", titleEs: "Envía una factura", done: invoices.length > 0 },
        { key: "receive_payment", titleEn: "Record a payment", titleEs: "Registra un pago", done: payments.length > 0 },
      ];
      const row = (await db.select().from(schema.onboardingChecklist).where(eq(schema.onboardingChecklist.userId, identity.workspaceUserId)).limit(1))[0];
      const dismissed = !!row?.dismissedAt;
      const allDone = steps.every((s) => s.done);
      if (allDone && row && !row.completedAt) {
        await db.update(schema.onboardingChecklist).set({ completedAt: new Date(), updatedAt: new Date() }).where(eq(schema.onboardingChecklist.id, row.id));
      }
      return { steps, dismissed, allDone };
    },
  }),
  dismissOnboardingChecklist: defineAction({
    request: z.object({}),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx): Promise<{ ok: true }> {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const row = (await db.select().from(schema.onboardingChecklist).where(eq(schema.onboardingChecklist.userId, identity.workspaceUserId)).limit(1))[0];
      const now = new Date();
      if (row) await db.update(schema.onboardingChecklist).set({ dismissedAt: now, updatedAt: now }).where(eq(schema.onboardingChecklist.id, row.id));
      else await db.insert(schema.onboardingChecklist).values({ userId: identity.workspaceUserId, dismissedAt: now });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  // Phase 1: undo for job completion — reopens a completed job.
  reopenJob: defineAction({
    request: z.object({ jobId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const job = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, args.jobId)).limit(1))[0];
      if (!job) throw new Error("Job not found.");
      if (!job.completedAt) return { ok: true };
      await db.update(schema.jobs).set({ completedAt: null, completionOverrideNote: "", updatedAt: new Date() }).where(eq(schema.jobs.id, args.jobId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  // Phase 1: undo for estimate approval — clears the accepted flag across the series.
  unacceptQuote: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const quote = (await db.select().from(schema.quotes).where(eq(schema.quotes.id, args.id)).limit(1))[0];
      if (!quote) throw new Error("Estimate not found.");
      const seriesId = quote.seriesId ?? quote.id;
      const versions = (await db.select().from(schema.quotes)).filter((q) => (q.seriesId ?? q.id) === seriesId);
      for (const version of versions) {
        if (version.accepted) await db.update(schema.quotes).set({ accepted: false, automationStatus: "awaiting", lostReason: null, lostNote: "", updatedAt: new Date() }).where(eq(schema.quotes.id, version.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  // Phase 1: manual review-request send for one job (the scheduler covers the
  // automatic path). Idempotent — already-requested jobs return emailed:false.
  sendReviewRequest: defineAction({
    request: z.object({ jobId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true), emailed: z.boolean() }),
    async handler(ctx, args): Promise<{ ok: true; emailed: boolean }> {
      const db = ctx.db<typeof schema>();
      const job = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, args.jobId)).limit(1))[0];
      if (!job) throw new Error("Job not found.");
      const emailed = await sendJobReviewEmail(ctx, db, job, "manual");
      ctx.invalidateQueries();
      return { ok: true, emailed };
    },
  }),
  submitEstimateRequest: defineAction({request:z.object({name:z.string().trim().min(2).max(160),phone:z.string().trim().min(7).max(40),email:z.string().trim().email().max(200),address:z.string().trim().min(5).max(240),serviceType:z.string().trim().min(2).max(120),projectDetails:z.string().trim().min(10).max(3000),preferredContactTime:z.string().trim().max(120),preferredDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""),preferredTime:z.string().regex(/^\d{2}:\d{2}$/).or(z.literal("")).default(""),company:z.string().max(0).default("")}),response:z.object({id:z.number()}),async handler(ctx,args){if(args.company)throw new Error("Request rejected.");const db=ctx.db<typeof schema>();const digits=normalizedPhone(args.phone);if(digits.length<10)throw new Error("Enter a valid phone number.");const recent=await db.select().from(schema.leads).orderBy(desc(schema.leads.createdAt));const cutoff=Date.now()-86400000;const duplicates=recent.filter(l=>l.source==="website form"&&l.createdAt.getTime()>=cutoff&&(normalizedPhone(l.phone)===digits||l.email.toLowerCase()===args.email.toLowerCase()));if(duplicates.length>=3)throw new Error("Too many recent requests. Please call the office.");const rows=await db.insert(schema.leads).values({name:args.name,phone:args.phone,email:args.email,address:args.address,serviceType:args.serviceType,preferredContactTime:args.preferredContactTime,source:"website form",notes:args.projectDetails,stage:"new",createdAt:new Date(),updatedAt:new Date()}).returning({id:schema.leads.id});const made=rows[0];if(!made)throw new Error("Could not submit request.");if(args.preferredDate){const startsAt=`${args.preferredDate}T${args.preferredTime||"09:00"}:00`;await db.insert(schema.appointments).values({clientName:args.name,clientPhone:args.phone,startsAt,notes:`Online booking — ${args.serviceType}. ${args.projectDetails}`.slice(0,1000),createdAt:new Date(),updatedAt:new Date()});}ctx.invalidateQueries();return{id:made.id};} }),
  updateJobSiteLocation: defineAction({request:z.object({jobId:z.number().int().positive(),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().update(schema.jobs).set({latitude:String(args.latitude),longitude:String(args.longitude),updatedAt:new Date()}).where(eq(schema.jobs.id,args.jobId));ctx.invalidateQueries();return{ok:true};} }),
  suggestJobsByLocation: defineAction({request:z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}),response:z.object({jobs:z.array(z.object({id:z.number(),label:z.string(),distanceMiles:z.number()}))}),async handler(ctx,args){const rows=await ctx.db<typeof schema>().select().from(schema.jobs);const rad=(value:number)=>value*Math.PI/180;const miles=(lat:number,lon:number)=>{const dLat=rad(lat-args.latitude),dLon=rad(lon-args.longitude);const a=Math.sin(dLat/2)**2+Math.cos(rad(args.latitude))*Math.cos(rad(lat))*Math.sin(dLon/2)**2;return 3958.8*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));};return{jobs:rows.flatMap(j=>{const lat=Number(j.latitude),lon=Number(j.longitude);return Number.isFinite(lat)&&Number.isFinite(lon)?[{id:j.id,label:`${j.clientName} · ${j.jobType}`,distanceMiles:Math.round(miles(lat,lon)*10)/10}]:[]}).sort((a,b)=>a.distanceMiles-b.distanceMiles).slice(0,5)};} }),
  clockInCrew: defineAction({request:z.object({jobId:z.number().int().positive(),crewMember:z.string().trim().min(1).max(160),latitude:z.number().min(-90).max(90).nullable(),longitude:z.number().min(-180).max(180).nullable(),note:z.string().trim().max(500).default("")}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const {job}=await requireJobCompany(ctx,db,args.jobId);const active=(await db.select().from(schema.timeEntries).orderBy(desc(schema.timeEntries.startedAt))).find(t=>!t.endedAt&&t.crewMember.toLowerCase()===args.crewMember.toLowerCase());if(active)return{id:active.id};const rows=await db.insert(schema.timeEntries).values({jobId:job.id,crewMember:args.crewMember,startedAt:new Date(),clockInLatitude:args.latitude===null?null:String(args.latitude),clockInLongitude:args.longitude===null?null:String(args.longitude),note:args.note,createdAt:new Date()}).returning({id:schema.timeEntries.id});const made=rows[0];if(!made)throw new Error("Could not clock in.");ctx.invalidateQueries();return{id:made.id};} }),
  clockOutCrew: defineAction({request:z.object({id:z.number().int().positive(),latitude:z.number().min(-90).max(90).nullable(),longitude:z.number().min(-180).max(180).nullable()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().update(schema.timeEntries).set({endedAt:new Date(),clockOutLatitude:args.latitude===null?null:String(args.latitude),clockOutLongitude:args.longitude===null?null:String(args.longitude)}).where(eq(schema.timeEntries.id,args.id));ctx.invalidateQueries();return{ok:true};} }),
  getCrewClockStatus: defineAction({request:z.object({}),response:z.object({active:z.array(z.object({id:z.number(),jobId:z.number(),jobLabel:z.string(),crewMember:z.string(),startedAt:z.string(),hours:z.number(),missingGps:z.boolean(),overTwelveHours:z.boolean()})),flagged:z.array(z.object({id:z.number(),jobId:z.number(),jobLabel:z.string(),crewMember:z.string(),startedAt:z.string(),hours:z.number(),missingGps:z.boolean(),overTwelveHours:z.boolean()}))}),async handler(ctx){const db=ctx.db<typeof schema>();const [entries,jobs]=await Promise.all([db.select().from(schema.timeEntries).orderBy(desc(schema.timeEntries.startedAt)),db.select().from(schema.jobs)]);const now=Date.now();const shape=(entry:typeof schema.timeEntries.$inferSelect)=>{const hours=Math.max(0,((entry.endedAt?.getTime()??now)-entry.startedAt.getTime())/3600000);const job=jobs.find(j=>j.id===entry.jobId);return{id:entry.id,jobId:entry.jobId,jobLabel:job?`${job.clientName} · ${job.jobType}`:`Job #${entry.jobId}`,crewMember:entry.crewMember||"Unassigned",startedAt:entry.startedAt.toISOString(),hours,missingGps:!entry.clockInLatitude||!entry.clockInLongitude,overTwelveHours:hours>12};};return{active:entries.filter(e=>!e.endedAt).map(shape),flagged:entries.filter(e=>((e.endedAt?.getTime()??now)-e.startedAt.getTime())>43200000).map(shape).slice(0,20)};} }),
  updateQuoteVersion: defineAction({request:z.object({id:z.number().int().positive(),lineItems:z.array(quoteItemSchema),subtotal:z.string().max(80),total:z.string().max(80)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const row=(await db.select().from(schema.quotes).where(eq(schema.quotes.id,args.id)).limit(1))[0];if(!row)throw new Error("Quote not found.");if(row.superseded||row.accepted||row.sentAt)throw new Error("Only an unsent version can be edited.");await db.update(schema.quotes).set({lineItemsJson:JSON.stringify(normalizeLineItems(args.lineItems)),subtotal:normalizeMoney(args.subtotal),total:normalizeMoney(args.total),updatedAt:new Date()}).where(eq(schema.quotes.id,args.id));ctx.invalidateQueries();return{ok:true};}}),
  createQuoteVersion: defineAction({request:z.object({id:z.number().int().positive()}),response:z.object({id:z.number(),versionNumber:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const source=(await db.select().from(schema.quotes).where(eq(schema.quotes.id,args.id)).limit(1))[0];if(!source)throw new Error("Quote not found.");const seriesId=source.seriesId??source.id;const versions=(await db.select().from(schema.quotes)).filter(q=>(q.seriesId??q.id)===seriesId);const versionNumber=Math.max(...versions.map(q=>q.versionNumber),0)+1;const now=new Date();const rows=await db.insert(schema.quotes).values({clientId:source.clientId,clientName:source.clientName,clientPhone:source.clientPhone,clientEmail:source.clientEmail,jobAddress:source.jobAddress,jobType:source.jobType,lineItemsJson:source.lineItemsJson,subtotal:source.subtotal,discountType:source.discountType,discountValue:source.discountValue,taxType:source.taxType,taxValue:source.taxValue,total:source.total,footnote:source.footnote,expiryDate:source.expiryDate,sentAt:"",automationStatus:"awaiting",lostReason:null,lostNote:"",theme:source.theme,font:source.font,accentColor:source.accentColor,showTaxLine:source.showTaxLine,showDiscountLine:source.showDiscountLine,showPaidLine:source.showPaidLine,showPaymentTerms:source.showPaymentTerms,showFooterNotes:source.showFooterNotes,showLogo:source.showLogo,showCompanyInfo:source.showCompanyInfo,jobId:source.jobId,seriesId,parentQuoteId:source.id,versionNumber,superseded:false,accepted:false,createdAt:now,updatedAt:now}).returning({id:schema.quotes.id});const made=rows[0];if(!made)throw new Error("Could not create quote version.");ctx.invalidateQueries();return{id:made.id,versionNumber};} }),
  sendQuoteVersion: defineAction({request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const quote=(await db.select().from(schema.quotes).where(eq(schema.quotes.id,args.id)).limit(1))[0];if(!quote)throw new Error("Quote not found.");const seriesId=quote.seriesId??quote.id;const versions=(await db.select().from(schema.quotes)).filter(q=>(q.seriesId??q.id)===seriesId);for(const version of versions)await db.update(schema.quotes).set({superseded:version.id!==quote.id,updatedAt:new Date()}).where(eq(schema.quotes.id,version.id));await db.update(schema.quotes).set({sentAt:new Date().toISOString().slice(0,10),superseded:false,updatedAt:new Date()}).where(eq(schema.quotes.id,quote.id));ctx.invalidateQueries();return{ok:true};} }),
  acceptQuoteVersion: defineAction({request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const quote=(await db.select().from(schema.quotes).where(eq(schema.quotes.id,args.id)).limit(1))[0];if(!quote)throw new Error("Quote not found.");const seriesId=quote.seriesId??quote.id;const versions=(await db.select().from(schema.quotes)).filter(q=>(q.seriesId??q.id)===seriesId);for(const version of versions)await db.update(schema.quotes).set({accepted:version.id===quote.id,superseded:version.id!==quote.id,updatedAt:new Date()}).where(eq(schema.quotes.id,version.id));ctx.invalidateQueries();return{ok:true};} }),
  getQuoteVersions: defineAction({request:z.object({id:z.number().int().positive()}),response:z.object({versions:z.array(quoteSchema),diffs:z.array(z.object({fromVersion:z.number(),toVersion:z.number(),added:z.array(z.string()),removed:z.array(z.string()),priceChanges:z.array(z.string()),totalChange:z.string()}))}),async handler(ctx,args){const db=ctx.db<typeof schema>();const quote=(await db.select().from(schema.quotes).where(eq(schema.quotes.id,args.id)).limit(1))[0];if(!quote)return{versions:[],diffs:[]};const seriesId=quote.seriesId??quote.id;const versions=(await db.select().from(schema.quotes)).filter(q=>(q.seriesId??q.id)===seriesId).sort((a,b)=>a.versionNumber-b.versionNumber);return{versions:versions.map(quoteShape),diffs:versions.slice(1).map((next,index)=>{const previous=versions[index];if(!previous)return{fromVersion:next.versionNumber-1,toVersion:next.versionNumber,added:[],removed:[],priceChanges:[],totalChange:"0.00"};return{fromVersion:previous.versionNumber,toVersion:next.versionNumber,...quoteDiff(previous,next)};})};} }),

  listMaterialCosts: defineAction({request:z.object({}),response:z.object({items:z.array(z.object({id:z.number(),nameEn:z.string(),nameEs:z.string(),unitEn:z.string(),unitEs:z.string(),price:z.string(),updatedAt:z.string()})),lastUpdated:z.string().nullable()}),async handler(ctx){const rows=await ctx.db<typeof schema>().select().from(schema.materialCostItems).orderBy(schema.materialCostItems.nameEn);return{items:rows.map(r=>({id:r.id,nameEn:r.nameEn,nameEs:r.nameEs,unitEn:r.unitEn,unitEs:r.unitEs,price:r.price,updatedAt:r.updatedAt.toISOString()})),lastUpdated:rows.length?new Date(Math.max(...rows.map(r=>r.updatedAt.getTime()))).toISOString():null};}}),
  saveMaterialCost: defineAction({request:z.object({id:z.number().int().positive().nullable().default(null),nameEn:z.string().trim().min(1).max(160),nameEs:z.string().trim().min(1).max(160),unitEn:z.string().trim().min(1).max(80),unitEs:z.string().trim().min(1).max(80),price:z.string().trim().min(1).max(80)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const now=new Date();const price=normalizeMoney(args.price,"0.00");if(args.id){await db.update(schema.materialCostItems).set({nameEn:args.nameEn,nameEs:args.nameEs,unitEn:args.unitEn,unitEs:args.unitEs,price,updatedAt:now}).where(eq(schema.materialCostItems.id,args.id));ctx.invalidateQueries();return{id:args.id};}const rows=await db.insert(schema.materialCostItems).values({nameEn:args.nameEn,nameEs:args.nameEs,unitEn:args.unitEn,unitEs:args.unitEs,price,createdAt:now,updatedAt:now}).returning({id:schema.materialCostItems.id});const made=rows[0];if(!made)throw new Error("Could not save material.");ctx.invalidateQueries();return{id:made.id};}}),
  deleteMaterialCost: defineAction({request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().delete(schema.materialCostItems).where(eq(schema.materialCostItems.id,args.id));ctx.invalidateQueries();return{ok:true};}}),

  getFieldIntelligence: defineAction({ request:z.object({today:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),periodStart:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),periodEnd:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}), response:z.object({
    jobs:z.array(z.object({id:z.number(),label:z.string()})), suppliers:z.array(z.object({id:z.number(),name:z.string()})),
    supplierQuotes:z.array(z.object({id:z.number(),supplierId:z.number(),supplierName:z.string(),jobId:z.number().nullable(),title:z.string(),lineItems:z.array(z.object({description:z.string(),qty:z.number(),unitPrice:z.string()})),total:z.string(),selected:z.boolean()})),
    purchaseOrders:z.array(z.object({id:z.number(),supplierId:z.number(),supplierName:z.string(),jobId:z.number().nullable(),jobLabel:z.string().nullable(),number:z.string(),status:z.enum(["draft","sent","partially_received","received","cancelled"]),lineItems:z.array(z.object({description:z.string(),qty:z.number(),unitPrice:z.string(),receivedQty:z.number()})),total:z.string()})),
    equipment:z.array(z.object({id:z.number(),name:z.string(),category:z.string(),purchaseDate:z.string(),cost:z.string(),serialNumber:z.string(),assignedTo:z.string(),photoUrl:z.string().nullable(),maintenanceTask:z.string(),maintenanceEveryDays:z.number(),nextMaintenanceDate:z.string(),checkedOutAt:z.string().nullable(),returnedAt:z.string().nullable(),maintenanceDue:z.boolean()})),
    safetyTalks:z.array(z.object({id:z.number(),jobId:z.number(),jobLabel:z.string(),topicKey:z.string(),talkDate:z.string(),checklist:z.array(z.string()),acknowledgements:z.array(z.string())})), incidents:z.array(z.object({id:z.number(),jobId:z.number(),jobLabel:z.string(),incidentDate:z.string(),description:z.string(),severity:z.enum(["near_miss","minor","serious"]),correctiveAction:z.string(),photoUrl:z.string().nullable()})), safetyStreak:z.number(),
    credentials:z.array(z.object({id:z.number(),ownerType:z.enum(["business","subcontractor"]),subcontractorId:z.number().nullable(),ownerLabel:z.string(),kind:z.string(),identifier:z.string(),expiresOn:z.string(),daysRemaining:z.number()})),
    payroll:z.array(z.object({crewMember:z.string(),hours:z.number(),hourlyRate:z.string(),grossPay:z.string()})),
    costAlerts:z.array(z.object({jobId:z.number(),jobLabel:z.string(),quoted:z.number(),cost:z.number(),percent:z.number(),level:z.enum(["warning","urgent"])})),
    today:z.object({poAwaiting:z.number(),maintenanceDue:z.number(),credentialWarnings:z.number(),hotLeads:z.number(),costAlerts:z.number()})
  }), async handler(ctx,args){const db=ctx.db<typeof schema>();const [jobs,suppliers,quotes,pos,equipment,talks,incidents,credentials,rates,times,receipts,expenses,subs,jobQuotes,leads,settings]=await Promise.all([db.select().from(schema.jobs),db.select().from(schema.suppliers),db.select().from(schema.supplierQuotes).orderBy(desc(schema.supplierQuotes.createdAt)),db.select().from(schema.purchaseOrders).orderBy(desc(schema.purchaseOrders.createdAt)),db.select().from(schema.equipment).orderBy(schema.equipment.name),db.select().from(schema.safetyTalks).orderBy(desc(schema.safetyTalks.talkDate)),db.select().from(schema.incidents).orderBy(desc(schema.incidents.incidentDate)),db.select().from(schema.credentials).orderBy(schema.credentials.expiresOn),db.select().from(schema.crewPayRates),db.select().from(schema.timeEntries),db.select().from(schema.receipts),db.select().from(schema.businessExpenses),db.select().from(schema.subcontractors),db.select().from(schema.quotes),db.select().from(schema.leads),db.select().from(schema.settings).where(eq(schema.settings.id,1)).limit(1)]);const jobLabel=(id:number|null)=>{const j=jobs.find(x=>x.id===id);return j?`${j.clientName} · ${j.jobType}`:null};const parseItems=(value:string)=>JSON.parse(value) as Array<{description:string;qty:number;unitPrice:string;receivedQty?:number}>;const day=(value:string)=>Math.ceil((new Date(`${value}T12:00:00`).getTime()-new Date(`${args.today}T12:00:00`).getTime())/86400000);const payroll=Array.from(new Set(times.map(t=>t.crewMember.trim()).filter(Boolean))).map(crewMember=>{const hours=times.filter(t=>t.crewMember.trim()===crewMember&&t.startedAt.toISOString().slice(0,10)>=args.periodStart&&t.startedAt.toISOString().slice(0,10)<=args.periodEnd).reduce((sum,t)=>sum+Math.max(0,((t.endedAt?.getTime()??Date.now())-t.startedAt.getTime())/3600000),0);const hourlyRate=rates.find(r=>r.crewMember.toLowerCase()===crewMember.toLowerCase())?.hourlyRate??"0.00";return{crewMember,hours,hourlyRate,grossPay:(hours*Number(hourlyRate)).toFixed(2)}});const threshold=settings[0]?.costAlertPercent??80;const costAlerts=jobs.flatMap(job=>{const latest=[...jobQuotes].filter(q=>q.jobId===job.id&&(!q.superseded||q.accepted)).sort((a,b)=>b.versionNumber-a.versionNumber)[0];const quoted=Number(latest?.total??job.amountDue??0);const labor=times.filter(t=>t.jobId===job.id).reduce((s,t)=>s+Math.max(0,((t.endedAt?.getTime()??Date.now())-t.startedAt.getTime())/3600000)*Number(settings[0]?.hourlyCostRate??0),0);const cost=receipts.filter(r=>r.jobId===job.id).reduce((s,r)=>s+Number(r.amount),0)+expenses.filter(e=>e.jobId===job.id).reduce((s,e)=>s+Number(e.amount),0)+subs.filter(s=>s.jobId===job.id).reduce((a,s)=>a+Number(s.agreedAmount),0)+labor;const percent=quoted>0?cost/quoted*100:0;return percent>=threshold?[{jobId:job.id,jobLabel:jobLabel(job.id)??`Job #${job.id}`,quoted,cost,percent,level:percent>=100?"urgent" as const:"warning" as const}]:[]});const lastIncident=incidents.map(i=>new Date(`${i.incidentDate}T12:00:00`).getTime()).sort((a,b)=>b-a)[0];const firstTalk=talks.map(t=>new Date(`${t.talkDate}T12:00:00`).getTime()).sort((a,b)=>a-b)[0];const streakStart=lastIncident??firstTalk;const safetyStreak=streakStart===undefined?0:Math.max(0,Math.floor((new Date(`${args.today}T12:00:00`).getTime()-streakStart)/86400000));const credentialData=credentials.map(c=>({id:c.id,ownerType:c.ownerType,subcontractorId:c.subcontractorId,ownerLabel:c.ownerType==="business"?"Business":subs.find(s=>s.id===c.subcontractorId)?.name??"Subcontractor",kind:c.kind,identifier:c.identifier,expiresOn:c.expiresOn,daysRemaining:day(c.expiresOn)}));return{jobs:jobs.map(j=>({id:j.id,label:jobLabel(j.id)??`Job #${j.id}`})),suppliers:suppliers.map(s=>({id:s.id,name:s.name})),supplierQuotes:quotes.map(q=>({id:q.id,supplierId:q.supplierId,supplierName:suppliers.find(s=>s.id===q.supplierId)?.name??"Supplier",jobId:q.jobId,title:q.title,lineItems:parseItems(q.lineItemsJson).map(i=>({description:i.description,qty:i.qty,unitPrice:i.unitPrice})),total:q.total,selected:q.selected})),purchaseOrders:pos.map(p=>({id:p.id,supplierId:p.supplierId,supplierName:suppliers.find(s=>s.id===p.supplierId)?.name??"Supplier",jobId:p.jobId,jobLabel:jobLabel(p.jobId),number:p.number,status:p.status,lineItems:parseItems(p.lineItemsJson).map(i=>({...i,receivedQty:i.receivedQty??0})),total:p.total})),equipment:await Promise.all(equipment.map(async e=>({id:e.id,name:e.name,category:e.category,purchaseDate:e.purchaseDate,cost:e.cost,serialNumber:e.serialNumber,assignedTo:e.assignedTo,photoUrl:e.photoBlobKey?await ctx.blobs.getUrl(e.photoBlobKey):null,maintenanceTask:e.maintenanceTask,maintenanceEveryDays:e.maintenanceEveryDays,nextMaintenanceDate:e.nextMaintenanceDate,checkedOutAt:e.checkedOutAt?.toISOString()??null,returnedAt:e.returnedAt?.toISOString()??null,maintenanceDue:Boolean(e.nextMaintenanceDate&&e.nextMaintenanceDate<=args.today)}))),safetyTalks:talks.map(t=>({id:t.id,jobId:t.jobId,jobLabel:jobLabel(t.jobId)??`Job #${t.jobId}`,topicKey:t.topicKey,talkDate:t.talkDate,checklist:JSON.parse(t.checklistJson) as string[],acknowledgements:JSON.parse(t.acknowledgementsJson) as string[]})),incidents:await Promise.all(incidents.map(async i=>({id:i.id,jobId:i.jobId,jobLabel:jobLabel(i.jobId)??`Job #${i.jobId}`,incidentDate:i.incidentDate,description:i.description,severity:i.severity,correctiveAction:i.correctiveAction,photoUrl:i.photoBlobKey?await ctx.blobs.getUrl(i.photoBlobKey):null}))),safetyStreak,credentials:credentialData,payroll,costAlerts,today:{poAwaiting:pos.filter(p=>p.status==="sent"||p.status==="partially_received").length,maintenanceDue:equipment.filter(e=>e.nextMaintenanceDate&&e.nextMaintenanceDate<=args.today).length,credentialWarnings:credentialData.filter(c=>c.daysRemaining<=60).length,hotLeads:leads.filter(l=>l.stage!=="won"&&l.stage!=="lost"&&l.score>=75).length,costAlerts:costAlerts.length}};} }),
  saveSupplierQuote: defineAction({request:z.object({supplierId:z.number().int().positive(),jobId:z.number().int().positive().nullable(),title:z.string().trim().min(1).max(160),lineItems:z.array(z.object({description:z.string().trim().min(1).max(300),qty:z.number().positive().max(100000),unitPrice:z.string().max(80)})).min(1).max(100)}),response:z.object({id:z.number()}),async handler(ctx,args){const items=args.lineItems.map(i=>({...i,unitPrice:normalizeMoney(i.unitPrice,"0.00")}));const total=items.reduce((s,i)=>s+i.qty*Number(i.unitPrice),0).toFixed(2);const rows=await ctx.db<typeof schema>().insert(schema.supplierQuotes).values({supplierId:args.supplierId,jobId:args.jobId,title:args.title,lineItemsJson:JSON.stringify(items),total,createdAt:new Date()}).returning({id:schema.supplierQuotes.id});const made=rows[0];if(!made)throw new Error("Could not save supplier quote.");ctx.invalidateQueries();return{id:made.id};}}),
  createPurchaseOrder: defineAction({request:z.object({supplierQuoteId:z.number().int().positive()}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const quote=(await db.select().from(schema.supplierQuotes).where(eq(schema.supplierQuotes.id,args.supplierQuoteId)).limit(1))[0];if(!quote)throw new Error("Supplier quote not found.");const competing=(await db.select().from(schema.supplierQuotes)).filter(candidate=>candidate.jobId===quote.jobId&&candidate.title.trim().toLowerCase()===quote.title.trim().toLowerCase());for(const candidate of competing)await db.update(schema.supplierQuotes).set({selected:false}).where(eq(schema.supplierQuotes.id,candidate.id));await db.update(schema.supplierQuotes).set({selected:true}).where(eq(schema.supplierQuotes.id,quote.id));const items=(JSON.parse(quote.lineItemsJson) as Array<{description:string;qty:number;unitPrice:string}>).map(i=>({...i,receivedQty:0}));const rows=await db.insert(schema.purchaseOrders).values({supplierId:quote.supplierId,jobId:quote.jobId,supplierQuoteId:quote.id,number:`PO-${Date.now().toString().slice(-8)}`,status:"draft",lineItemsJson:JSON.stringify(items),total:quote.total,createdAt:new Date(),updatedAt:new Date()}).returning({id:schema.purchaseOrders.id});const made=rows[0];if(!made)throw new Error("Could not create purchase order.");ctx.invalidateQueries();return{id:made.id};}}),
  updatePurchaseOrderStatus: defineAction({request:z.object({id:z.number().int().positive(),status:z.enum(["draft","sent","cancelled"])}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().update(schema.purchaseOrders).set({status:args.status,updatedAt:new Date()}).where(eq(schema.purchaseOrders.id,args.id));ctx.invalidateQueries();return{ok:true};}}),
  receivePurchaseOrder: defineAction({request:z.object({id:z.number().int().positive(),received:z.array(z.number().min(0).max(100000))}),response:z.object({status:z.enum(["partially_received","received"]),expenseAmount:z.string()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const po=(await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id,args.id)).limit(1))[0];if(!po)throw new Error("Purchase order not found.");if(po.status==="cancelled")throw new Error("Cancelled purchase orders cannot be received.");const items=JSON.parse(po.lineItemsJson) as Array<{description:string;qty:number;unitPrice:string;receivedQty:number}>;let delta=0;const next=items.map((item,index)=>{const target=Math.min(item.qty,args.received[index]??item.receivedQty??0);delta+=Math.max(0,target-(item.receivedQty??0))*Number(item.unitPrice);return{...item,receivedQty:target}});const complete=next.every(i=>i.receivedQty>=i.qty);const status=complete?"received" as const:"partially_received" as const;await db.update(schema.purchaseOrders).set({status,lineItemsJson:JSON.stringify(next),updatedAt:new Date()}).where(eq(schema.purchaseOrders.id,po.id));if(delta>0&&po.jobId){const supplier=(await db.select().from(schema.suppliers).where(eq(schema.suppliers.id,po.supplierId)).limit(1))[0];await db.insert(schema.businessExpenses).values({expenseDate:new Date().toISOString().slice(0,10),vendor:supplier?.name??"Supplier",amount:delta.toFixed(2),category:"materials",jobId:po.jobId,supplierId:po.supplierId,note:`Received ${po.number}`,createdAt:new Date()});}ctx.invalidateQueries();return{status,expenseAmount:delta.toFixed(2)};}}),
  saveEquipment: defineAction({request:z.object({name:z.string().trim().min(1).max(160),category:z.string().trim().max(120),purchaseDate:z.string().max(10),cost:z.string().max(80),serialNumber:z.string().trim().max(160),assignedTo:z.string().trim().max(160),maintenanceTask:z.string().trim().max(300),maintenanceEveryDays:z.number().int().min(1).max(3650),nextMaintenanceDate:z.string().max(10),photoFilename:z.string().max(240).default(""),photoContentType:z.enum(["","image/jpeg","image/png","image/webp"]).default(""),photoDataBase64:z.string().max(20_000_000).default("")}),response:z.object({id:z.number()}),async handler(ctx,args){let photoBlobKey:null|string=null;if(args.photoDataBase64&&args.photoContentType){photoBlobKey=`equipment/${crypto.randomUUID()}`;await ctx.blobs.put(photoBlobKey,Buffer.from(args.photoDataBase64,"base64"),{contentType:args.photoContentType});}const {photoFilename:_f,photoContentType:_t,photoDataBase64:_d,...values}=args;const rows=await ctx.db<typeof schema>().insert(schema.equipment).values({...values,cost:normalizeMoney(args.cost,"0.00"),photoBlobKey,createdAt:new Date(),updatedAt:new Date()}).returning({id:schema.equipment.id});const made=rows[0];if(!made)throw new Error("Could not save equipment.");ctx.invalidateQueries();return{id:made.id};}}),
  setEquipmentCheckout: defineAction({request:z.object({id:z.number().int().positive(),assignedTo:z.string().trim().min(1).max(160),returned:z.boolean()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().update(schema.equipment).set(args.returned?{assignedTo:"shop",returnedAt:new Date(),updatedAt:new Date()}:{assignedTo:args.assignedTo,checkedOutAt:new Date(),returnedAt:null,updatedAt:new Date()}).where(eq(schema.equipment.id,args.id));ctx.invalidateQueries();return{ok:true};}}),
  completeEquipmentMaintenance: defineAction({request:z.object({id:z.number().int().positive()}),response:z.object({nextMaintenanceDate:z.string()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const item=(await db.select().from(schema.equipment).where(eq(schema.equipment.id,args.id)).limit(1))[0];if(!item)throw new Error("Equipment not found.");const next=new Date();next.setDate(next.getDate()+item.maintenanceEveryDays);const nextMaintenanceDate=next.toISOString().slice(0,10);await db.update(schema.equipment).set({nextMaintenanceDate,updatedAt:new Date()}).where(eq(schema.equipment.id,args.id));ctx.invalidateQueries();return{nextMaintenanceDate};}}),
  saveSafetyTalk: defineAction({request:z.object({jobId:z.number().int().positive(),topicKey:z.enum(["ladder","ppe","electrical","heat","silica","fall"]),talkDate:z.string().max(10),checklist:z.array(z.string().max(300)).max(20),acknowledgements:z.array(z.string().trim().min(1).max(160)).min(1).max(30)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const {job}=await requireJobCompany(ctx,db,args.jobId);const rows=await db.insert(schema.safetyTalks).values({jobId:job.id,topicKey:args.topicKey,talkDate:args.talkDate,checklistJson:JSON.stringify(args.checklist),acknowledgementsJson:JSON.stringify(args.acknowledgements),createdAt:new Date()}).returning({id:schema.safetyTalks.id});const made=rows[0];if(!made)throw new Error("Could not save safety talk.");ctx.invalidateQueries();return{id:made.id};}}),
  saveIncident: defineAction({request:z.object({jobId:z.number().int().positive(),incidentDate:z.string().max(10),description:z.string().trim().min(1).max(3000),severity:z.enum(["near_miss","minor","serious"]),correctiveAction:z.string().trim().max(3000),photoContentType:z.enum(["","image/jpeg","image/png","image/webp"]).default(""),photoDataBase64:z.string().max(20_000_000).default("")}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const {job}=await requireJobCompany(ctx,db,args.jobId);let photoBlobKey:null|string=null;if(args.photoDataBase64&&args.photoContentType){photoBlobKey=`incidents/${crypto.randomUUID()}`;await ctx.blobs.put(photoBlobKey,Buffer.from(args.photoDataBase64,"base64"),{contentType:args.photoContentType});}const {photoContentType:_t,photoDataBase64:_d,jobId:_j,...values}=args;const rows=await db.insert(schema.incidents).values({...values,jobId:job.id,photoBlobKey,createdAt:new Date()}).returning({id:schema.incidents.id});const made=rows[0];if(!made)throw new Error("Could not save incident.");ctx.invalidateQueries();return{id:made.id};}}),
  saveCredential: defineAction({request:z.object({ownerType:z.enum(["business","subcontractor"]),subcontractorId:z.number().int().positive().nullable(),kind:z.string().trim().min(1).max(160),identifier:z.string().trim().max(160),expiresOn:z.string().max(10)}),response:z.object({id:z.number()}),async handler(ctx,args){const rows=await ctx.db<typeof schema>().insert(schema.credentials).values({...args,createdAt:new Date(),updatedAt:new Date()}).returning({id:schema.credentials.id});const made=rows[0];if(!made)throw new Error("Could not save credential.");ctx.invalidateQueries();return{id:made.id};}}),
  renewCredential: defineAction({request:z.object({id:z.number().int().positive(),expiresOn:z.string().max(10)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().update(schema.credentials).set({expiresOn:args.expiresOn,renewedAt:new Date(),updatedAt:new Date()}).where(eq(schema.credentials.id,args.id));ctx.invalidateQueries();return{ok:true};}}),
  saveCrewPayRate: defineAction({request:z.object({crewMember:z.string().trim().min(1).max(160),hourlyRate:z.string().max(80)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const current=(await db.select().from(schema.crewPayRates).where(eq(schema.crewPayRates.crewMember,args.crewMember)).limit(1))[0];if(current)await db.update(schema.crewPayRates).set({hourlyRate:normalizeMoney(args.hourlyRate,"0.00"),updatedAt:new Date()}).where(eq(schema.crewPayRates.id,current.id));else await db.insert(schema.crewPayRates).values({crewMember:args.crewMember,hourlyRate:normalizeMoney(args.hourlyRate,"0.00"),updatedAt:new Date()});ctx.invalidateQueries();return{ok:true};}}),
  setJobPhotoRequirements: defineAction({request:z.object({jobId:z.number().int().positive(),requiredStages:z.array(stageSchema).max(3)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const ordered=(['before','during','after'] as const).filter(stage=>args.requiredStages.includes(stage));await ctx.db<typeof schema>().update(schema.jobs).set({requiredPhotoStages:ordered.join(','),updatedAt:new Date()}).where(eq(schema.jobs.id,args.jobId));ctx.invalidateQueries();return{ok:true};}}),
  completeJob: defineAction({request:z.object({jobId:z.number().int().positive(),overrideNote:z.string().trim().max(1000).default("")}),response:z.object({ok:z.literal(true),missingStages:z.array(stageSchema)}),async handler(ctx,args):Promise<{ok:true;missingStages:Array<"before"|"during"|"after">}>{const db=ctx.db<typeof schema>();const { job } = await requireJobCompany(ctx, db, args.jobId);const photos=await db.select().from(schema.photos).where(eq(schema.photos.jobId,job.id));const required=job.requiredPhotoStages.split(",").filter((s):s is "before"|"during"|"after"=>s==="before"||s==="during"||s==="after");const missingStages=required.filter(s=>!photos.some(p=>p.stage===s));if(missingStages.length&&!args.overrideNote)throw new Error("Add an override note for missing required photos.");await db.update(schema.jobs).set({completedAt:new Date(),completionOverrideNote:args.overrideNote,updatedAt:new Date()}).where(eq(schema.jobs.id,job.id));if(missingStages.length)await db.insert(schema.completionOverrides).values({jobId:job.id,missingStages:missingStages.join(","),note:args.overrideNote,createdAt:new Date()});await logJobSystemMessage(db,job.id,"Job marked complete","Trabajo marcado como completado");ctx.invalidateQueries();return{ok:true,missingStages};}}),
  deleteFieldTestRecord: defineAction({request:z.object({kind:z.enum(["supplier_quote","purchase_order","equipment","safety_talk","incident","credential","lead","crew_pay_rate","supplier"]),id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();if(args.kind==="supplier_quote")await db.delete(schema.supplierQuotes).where(eq(schema.supplierQuotes.id,args.id));else if(args.kind==="purchase_order"){const row=(await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id,args.id)).limit(1))[0];if(row)await db.delete(schema.businessExpenses).where(eq(schema.businessExpenses.note,`Received ${row.number}`));await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id,args.id));}else if(args.kind==="equipment")await db.delete(schema.equipment).where(eq(schema.equipment.id,args.id));else if(args.kind==="safety_talk")await db.delete(schema.safetyTalks).where(eq(schema.safetyTalks.id,args.id));else if(args.kind==="incident")await db.delete(schema.incidents).where(eq(schema.incidents.id,args.id));else if(args.kind==="lead")await db.delete(schema.leads).where(eq(schema.leads.id,args.id));else if(args.kind==="crew_pay_rate")await db.delete(schema.crewPayRates).where(eq(schema.crewPayRates.id,args.id));else if(args.kind==="supplier")await db.delete(schema.suppliers).where(eq(schema.suppliers.id,args.id));else await db.delete(schema.credentials).where(eq(schema.credentials.id,args.id));ctx.invalidateQueries();return{ok:true};}}),

  renderPdfPreview: defineAction({
    request: z.object({ dataBase64: z.string().min(1).max(30_000_000) }),
    response: z.object({ pagesBase64: z.array(z.string()).max(20) }),
    privileged: [privileged.renderPdfPages],
    async handler(ctx, args) {
      return ctx.executePrivileged(privileged.renderPdfPages, args);
    },
  }),

  exportBackup: defineAction({
    request: z.object({}),
    response: z.object({ filename: z.string(), dataBase64: z.string(), tableCount: z.number(), recordCount: z.number(), attachments: z.array(z.object({ key: z.string(), url: z.string(), contentType: z.string() })), createdAt: z.string() }),
    async handler(ctx) {
      const backup = await createBackup(ctx);
      const attachments: Array<{ key: string; url: string; contentType: string }> = [];
      const seen = new Set<string>();
      for (const rows of Object.values(backup.tables)) for (const row of rows) for (const [column, value] of Object.entries(row)) {
        if (!column.endsWith("_blob_key") || typeof value !== "string" || !value || seen.has(value)) continue;
        seen.add(value);
        const metadata = await ctx.blobs.head(value);
        if (metadata) attachments.push({ key: value, url: await ctx.blobs.getUrl(value), contentType: metadata.contentType || "application/octet-stream" });
      }
      const compressed = gzipSync(strToU8(JSON.stringify(backup)), { level: 6 });
      const date = backup.createdAt.slice(0, 10);
      return { filename: `crewkat-backup-${date}.crewkat`, dataBase64: Buffer.from(compressed).toString("base64"), tableCount: BACKUP_TABLES.length, recordCount: Object.values(backup.tables).reduce((sum, rows) => sum + rows.length, 0), attachments, createdAt: backup.createdAt };
    },
  }),
  restoreBackup: defineAction({
    request: z.object({ dataBase64: z.string().min(1).max(200_000_000) }),
    response: z.object({ ok: z.literal(true), recordCount: z.number(), attachmentCount: z.number(), restoredAt: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; recordCount: number; attachmentCount: number; restoredAt: string }> {
      let parsed: unknown;
      try {
        const compressed = Buffer.from(args.dataBase64, "base64");
        if (compressed.byteLength > 150_000_000) throw new Error("Backup is too large.");
        const text = strFromU8(gunzipSync(compressed));
        if (text.length > 300_000_000) throw new Error("Backup is too large.");
        parsed = JSON.parse(text);
      } catch {
        throw new Error("This is not a valid Crewkat backup file.");
      }
      if (!validBackup(parsed)) throw new Error("This is not a compatible Crewkat backup file.");
      await restoreBackup(ctx, parsed);
      return { ok: true, recordCount: Object.values(parsed.tables).reduce((sum, rows) => sum + rows.length, 0), attachmentCount: Object.keys(parsed.blobs).length, restoredAt: new Date().toISOString() };
    },
  }),
  verifyBackupRoundTrip: defineAction({
    request: z.object({}),
    response: z.object({ ok: z.literal(true), restored: z.literal(true), testRecordRemoved: z.literal(true) }),
    async handler(ctx): Promise<{ ok: true; restored: true; testRecordRemoved: true }> {
      const db = ctx.db<typeof schema>();
      const marker = `Crewkat backup test ${crypto.randomUUID()}`;
      const blobKey = `backup-test/${crypto.randomUUID()}.txt`;
      const testBytes = Buffer.from("Crewkat backup attachment test", "utf8");
      const inserted = await db.insert(schema.clients).values({ name: marker, notes: "Automatic backup test", createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.clients.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error("Could not create the temporary backup test record.");
      try {
        const backup = await createBackup(ctx);
        backup.blobs[blobKey] = { contentType: "text/plain", dataBase64: testBytes.toString("base64") };
        await db.delete(schema.clients).where(eq(schema.clients.id, id));
        await restoreBackup(ctx, backup);
        const restored = (await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, id)).limit(1))[0];
        const restoredBlob = await ctx.blobs.head(blobKey);
        if (!restored || restoredBlob?.sizeBytes !== testBytes.byteLength) throw new Error("Backup restore did not recover the test data and attachment.");
        await db.delete(schema.clients).where(eq(schema.clients.id, id));
        await ctx.blobs.delete(blobKey);
        ctx.invalidateQueries();
        return { ok: true, restored: true, testRecordRemoved: true };
      } catch (error) {
        await db.delete(schema.clients).where(eq(schema.clients.id, id));
        await ctx.blobs.delete(blobKey).catch(() => {});
        throw error;
      }
    },
  }),
  runAutomatedBackup: defineAction({
    request: z.object({ note: z.string().trim().max(500).default("") }),
    response: z.object({
      ok: z.boolean(),
      runId: z.number().nullable(),
      kind: z.string(),
      filePath: z.string().nullable(),
      totalBytes: z.number().nullable(),
      offsiteSent: z.boolean(),
      integrityOk: z.boolean(),
      error: z.string().nullable(),
    }),
    async handler(ctx, args) {
      if (backupInProgress) throw new Error("A backup is already running. Try again in a few minutes.");
      backupInProgress = true;
      try {
        const result = await performBackup(ctx, "manual", args.note);
        if (!result.ok) throw new Error(result.error || "Backup failed.");
        ctx.invalidateQueries();
        return {
          ok: true, runId: result.runId, kind: result.kind, filePath: result.filePath,
          totalBytes: result.totalBytes, offsiteSent: result.offsiteSent, integrityOk: result.integrityOk, error: null,
        };
      } finally {
        backupInProgress = false;
      }
    },
  }),
  getBackupStatus: defineAction({
    request: z.object({}),
    response: z.object({
      configured: z.boolean(),
      backupHourUtc: z.number(),
      runs: z.array(z.object({
        id: z.number(),
        kind: z.string(),
        status: z.string(),
        startedAt: z.string(),
        finishedAt: z.string().nullable(),
        totalBytes: z.number().nullable(),
        offsiteSent: z.boolean(),
        integrityOk: z.boolean().nullable(),
        error: z.string().nullable(),
        notes: z.string().nullable(),
      })),
    }),
    async handler(ctx) {
      const cfg = backupConfig();
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.backupRuns).orderBy(desc(schema.backupRuns.startedAt)).limit(10);
      return {
        configured: Boolean(cfg.alertEmail),
        backupHourUtc: cfg.hour,
        runs: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          status: row.status,
          startedAt: row.startedAt.toISOString(),
          finishedAt: row.finishedAt?.toISOString() ?? null,
          totalBytes: row.totalBytes,
          offsiteSent: row.offsiteSent,
          integrityOk: row.integrityOk,
          error: row.error,
          notes: row.notes,
        })),
      };
    },
  }),

  // Lightweight gate for the marketplace UI: whether the marketplace is
  // enabled, the current free-plan active-listing limit, and this company's
  // active listing count. Always available (even when disabled) so the client
  // can show the right notice instead of an error.
  marketplaceGate: defineAction({
    request: z.object({}),
    response: z.object({ enabled: z.boolean(), freeListingLimit: z.number(), bonusListings: z.number(), effectiveListingLimit: z.number(), myActiveListingCount: z.number() }),
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db();
      const enabled = await getBooleanPlatformSetting(db, "marketplace_enabled");
      const { base, bonus, effective } = await getEffectiveListingLimit(db);
      const mine = await db.select({ id: schema.marketplaceListings.id }).from(schema.marketplaceListings).where(and(eq(schema.marketplaceListings.companyId, identity.workspaceCompanyId), eq(schema.marketplaceListings.moderationStatus, "active")));
      return { enabled, freeListingLimit: base, bonusListings: bonus, effectiveListingLimit: effective, myActiveListingCount: mine.length };
    },
  }),

  listMarketplaceListings: defineAction({
    request: z.object({ search: z.string().trim().max(120).default(""), category: marketplaceCategorySchema.nullable().default(null), serviceArea: z.string().trim().max(120).default("") }),
    response: z.object({ listings: z.array(marketplaceListingSchema) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await requireMarketplaceEnabled(db);
      const rows = await db.select().from(schema.marketplaceListings).orderBy(desc(schema.marketplaceListings.promoted), desc(schema.marketplaceListings.createdAt));
      const now = Date.now();
      // Featured (paid bump, unexpired) floats above everything else.
      rows.sort((a, b) => Number(Boolean(b.featuredUntil && b.featuredUntil.getTime() > now)) - Number(Boolean(a.featuredUntil && a.featuredUntil.getTime() > now)));
      const photoRows = await db.select().from(schema.marketplaceListingPhotos).orderBy(schema.marketplaceListingPhotos.sortOrder);
      const search = args.search.toLowerCase();
      const area = args.serviceArea.toLowerCase();
      const categoryTerms: Record<z.infer<typeof marketplaceCategorySchema>, string> = { kitchens: "kitchen cabinet carpenter", bathrooms: "bathroom shower", plumbing: "plumbing plumber", electrical: "electrical electrician", hvac: "hvac air conditioning", roofing: "roof roofers roofing", tile_flooring: "tile flooring floor installer", painting: "painting painter", concrete: "concrete masonry", landscaping: "landscaping lawn", handyman: "handyman repair", equipment: "equipment trailer rental", materials: "materials supplies", other: "other" };
      const filtered = rows.filter((row) => row.moderationStatus === "active" && (!args.category || row.category === args.category) && (!search || [row.title, row.description, row.companyName, row.serviceArea, categoryTerms[row.category]].some((value) => value.toLowerCase().includes(search))) && (!area || row.serviceArea.toLowerCase().includes(area)));
      return { listings: await Promise.all(filtered.map((row) => marketplaceListingShape(ctx, row, photoRows))) };
    },
  }),
  getMarketplaceListing: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ listing: marketplaceListingSchema.nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await requireMarketplaceEnabled(db);
      const row = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, args.id)).limit(1))[0];
      if (!row) return { listing: null };
      // Non-active listings are only visible to their owner (so the owner can
      // see the "under review" state); everyone else gets a not-found.
      if (row.moderationStatus !== "active" && row.companyId !== workspaceIdentity(ctx).workspaceCompanyId) return { listing: null };
      const photoRows = await db.select().from(schema.marketplaceListingPhotos).where(eq(schema.marketplaceListingPhotos.listingId, row.id)).orderBy(schema.marketplaceListingPhotos.sortOrder);
      return { listing: await marketplaceListingShape(ctx, row, photoRows) };
    },
  }),
  createMarketplaceListing: defineAction({
    request: z.object({
      title: z.string().trim().min(1).max(180), category: marketplaceCategorySchema,
      listingType: z.enum(["job", "project"]), employmentType: z.enum(["full_time", "part_time", "temporary"]), payUnit: z.enum(["hourly", "salary"]),
      priceKind: z.enum(["amount", "free", "contact"]), price: z.string().trim().max(80), originalPrice: z.string().trim().max(80),
      description: z.string().trim().max(5000), serviceArea: z.string().trim().min(1).max(160),
      companyName: z.string().trim().min(1).max(180), companyPhone: z.string().trim().max(80),
      bookable: z.boolean().default(false), dailyRate: z.string().trim().max(80).default(""),
      photos: z.array(z.object({ filename: z.string().min(1).max(240), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), dataBase64: z.string().min(1).max(30_000_000) })).max(8),
    }),
    response: z.object({ id: z.number(), moderation: listingModerationResultSchema }),
    async handler(ctx, args) {
      if (args.priceKind === "amount" && !args.price.trim()) throw new Error("Enter a price or choose Contact for price.");
      if (args.bookable && !args.dailyRate.trim()) throw new Error("Enter a daily rate for this bookable listing.");
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>(); const now = new Date();
      await requireMarketplaceEnabled(db);
      if (identity.workspaceTier === "free") {
        const { effective, bonus } = await getEffectiveListingLimit(db);
        const mine = await db.select({ id: schema.marketplaceListings.id }).from(schema.marketplaceListings).where(and(eq(schema.marketplaceListings.companyId, identity.workspaceCompanyId), eq(schema.marketplaceListings.moderationStatus, "active")));
        if (mine.length >= effective) throw new Error(`Your free plan includes ${effective} active Marketplace listing${effective === 1 ? "" : "s"}${bonus > 0 ? ` (${bonus} bonus from referrals)` : ""}. Upgrade to Premium for unlimited listings.`);
      }
      const scan = await scanListingForModeration(db, { title: args.title, description: args.description, companyName: args.companyName, serviceArea: args.serviceArea });
      const moderationStatus: ModerationStatus = scan.clean ? "active" : "auto_rejected";
      const moderationReason = scan.clean ? "" : scan.reasons.join("; ");
      const made = (await db.insert(schema.marketplaceListings).values({ title: args.title, category: args.category, listingType: args.listingType, employmentType: args.employmentType, payUnit: args.payUnit, priceKind: args.priceKind, price: args.priceKind === "amount" ? normalizeMoney(args.price) : "", originalPrice: args.priceKind === "amount" ? normalizeMoney(args.originalPrice) : "", description: args.description, serviceArea: args.serviceArea, companyName: args.companyName, companyPhone: args.companyPhone, bookable: args.bookable, dailyRate: args.bookable ? normalizeMoney(args.dailyRate) : "", moderationStatus, moderationReason, createdAt: now, updatedAt: now }).returning({ id: schema.marketplaceListings.id }))[0];
      if (!made) throw new Error("The listing could not be saved.");
      const storedKeys: string[] = [];
      try {
        for (const [index, photo] of args.photos.entries()) {
          const key = `marketplace/${made.id}/${crypto.randomUUID()}-${photo.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
          await ctx.blobs.put(key, Buffer.from(photo.dataBase64, "base64"), { contentType: photo.contentType });
          storedKeys.push(key);
          await db.insert(schema.marketplaceListingPhotos).values({ listingId: made.id, blobKey: key, filename: photo.filename, contentType: photo.contentType, sortOrder: index, createdAt: now });
        }
      } catch (error) {
        await db.delete(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, made.id));
        await Promise.all(storedKeys.map((key) => ctx.blobs.delete(key).catch(() => {})));
        throw error;
      }
      ctx.invalidateQueries();
      // Chunk D: only approved/visible listings trigger saved-search alerts.
      if (moderationStatus === "active") {
        await notifyAlertMatches(ctx, { id: made.id, title: args.title, description: args.description, category: args.category, serviceArea: args.serviceArea, authorUserId: identity.workspaceUserId });
      }
      return { id: made.id, moderation: { flagged: !scan.clean, status: moderationStatus, reasons: scan.reasons } };
    },
    privileged: [privileged.sendSecurityAlert],
  }),
  updateMarketplaceListing: defineAction({
    request: z.object({
      id: z.number().int().positive(),
      title: z.string().trim().min(1).max(180), category: marketplaceCategorySchema,
      listingType: z.enum(["job", "project"]), employmentType: z.enum(["full_time", "part_time", "temporary"]), payUnit: z.enum(["hourly", "salary"]),
      priceKind: z.enum(["amount", "free", "contact"]), price: z.string().trim().max(80), originalPrice: z.string().trim().max(80),
      description: z.string().trim().max(5000), serviceArea: z.string().trim().min(1).max(160),
      companyName: z.string().trim().min(1).max(180), companyPhone: z.string().trim().max(80),
      bookable: z.boolean().default(false), dailyRate: z.string().trim().max(80).default(""),
      replacePhotos: z.boolean().default(false),
      photos: z.array(z.object({ filename: z.string().min(1).max(240), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), dataBase64: z.string().min(1).max(30_000_000) })).max(8),
    }),
    response: z.object({ id: z.number(), moderation: listingModerationResultSchema }),
    async handler(ctx, args) {
      if (args.priceKind === "amount" && !args.price.trim()) throw new Error("Enter a price or choose Contact for price.");
      if (args.bookable && !args.dailyRate.trim()) throw new Error("Enter a daily rate for this bookable listing.");
      const db = ctx.db<typeof schema>();
      await requireMarketplaceEnabled(db);
      const existing = (await db.select().from(schema.marketplaceListings).where(and(eq(schema.marketplaceListings.id, args.id), eq(schema.marketplaceListings.companyId, workspaceIdentity(ctx).workspaceCompanyId))).limit(1))[0];
      if (!existing) throw new Error("You can only edit your own listings.");
      // Re-scan on every edit. Flagged edits go to auto_rejected; clean edits
      // never self-promote a listing out of review — only an admin can do that.
      const scan = await scanListingForModeration(db, { title: args.title, description: args.description, companyName: args.companyName, serviceArea: args.serviceArea });
      const moderationStatus: ModerationStatus = scan.clean ? (existing.moderationStatus as ModerationStatus) : "auto_rejected";
      const moderationReason = scan.clean ? existing.moderationReason : scan.reasons.join("; ");
      const oldPhotos = args.replacePhotos ? await db.select().from(schema.marketplaceListingPhotos).where(eq(schema.marketplaceListingPhotos.listingId, args.id)) : [];
      const now = new Date();
      const newPhotos: Array<{ blobKey: string; filename: string; contentType: "image/jpeg" | "image/png" | "image/webp"; sortOrder: number }> = [];
      try {
        if (args.replacePhotos) {
          for (const [index, photo] of args.photos.entries()) {
            const key = `marketplace/${args.id}/${crypto.randomUUID()}-${photo.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
            await ctx.blobs.put(key, Buffer.from(photo.dataBase64, "base64"), { contentType: photo.contentType });
            newPhotos.push({ blobKey: key, filename: photo.filename, contentType: photo.contentType, sortOrder: index });
          }
        }
        await db.update(schema.marketplaceListings).set({ title: args.title, category: args.category, listingType: args.listingType, employmentType: args.employmentType, payUnit: args.payUnit, priceKind: args.priceKind, price: args.priceKind === "amount" ? normalizeMoney(args.price) : "", originalPrice: args.priceKind === "amount" ? normalizeMoney(args.originalPrice) : "", description: args.description, serviceArea: args.serviceArea, companyName: args.companyName, companyPhone: args.companyPhone, bookable: args.bookable, dailyRate: args.bookable ? normalizeMoney(args.dailyRate) : "", moderationStatus, moderationReason, updatedAt: now }).where(eq(schema.marketplaceListings.id, args.id));
        if (args.replacePhotos) {
          await db.delete(schema.marketplaceListingPhotos).where(eq(schema.marketplaceListingPhotos.listingId, args.id));
          for (const photo of newPhotos) await db.insert(schema.marketplaceListingPhotos).values({ listingId: args.id, ...photo, createdAt: now });
          await Promise.all(oldPhotos.map((photo) => ctx.blobs.delete(photo.blobKey).catch(() => {})));
        }
      } catch (error) {
        await Promise.all(newPhotos.map((photo) => ctx.blobs.delete(photo.blobKey).catch(() => {})));
        throw error;
      }
      ctx.invalidateQueries();
      return { id: args.id, moderation: { flagged: !scan.clean, status: moderationStatus, reasons: scan.reasons } };
    },
  }),
  deleteMarketplaceListing: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await requireMarketplaceEnabled(db);
      const listing = (await db.select({ id: schema.marketplaceListings.id }).from(schema.marketplaceListings).where(and(eq(schema.marketplaceListings.id, args.id), eq(schema.marketplaceListings.companyId, workspaceIdentity(ctx).workspaceCompanyId))).limit(1))[0];
      if (!listing) throw new Error("You can only delete your own listings.");
      const photos = await db.select({ blobKey: schema.marketplaceListingPhotos.blobKey }).from(schema.marketplaceListingPhotos).where(eq(schema.marketplaceListingPhotos.listingId, args.id));
      const messages = await db.select({ blobKey: schema.marketplaceMessages.imageBlobKey }).from(schema.marketplaceMessages).where(eq(schema.marketplaceMessages.listingId, args.id));
      await db.delete(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, args.id));
      await Promise.all([...photos.map((item) => item.blobKey), ...messages.map((item) => item.blobKey).filter((key): key is string => Boolean(key))].map((key) => ctx.blobs.delete(key).catch(() => {})));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  marketplaceListingFlag: defineAction({
    request: z.object({
      listingId: z.number().int().positive(),
      reason: z.enum(["spam", "explicit", "illegal", "scam", "misleading", "other"]),
      details: z.string().trim().max(1000).default(""),
    }),
    response: z.object({ ok: z.literal(true), status: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; status: string }> {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>(); const now = new Date();
      await requireMarketplaceEnabled(db);
      const listing = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, args.listingId)).limit(1))[0];
      if (!listing) throw new Error("This listing could not be found.");
      if (listing.moderationStatus === "removed") throw new Error("This listing is no longer available.");
      if (listing.companyId === identity.workspaceCompanyId) throw new Error("You can't report your own listing.");
      const existing = (await db.select({ id: schema.marketplaceFlags.id }).from(schema.marketplaceFlags).where(and(eq(schema.marketplaceFlags.listingId, args.listingId), eq(schema.marketplaceFlags.reporterUserId, identity.workspaceUserId))).limit(1))[0];
      if (existing) throw new Error("You've already reported this listing. Our team will review it.");
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
      const recentFlags = await db.select({ id: schema.marketplaceFlags.id }).from(schema.marketplaceFlags).where(and(eq(schema.marketplaceFlags.reporterUserId, identity.workspaceUserId), gte(schema.marketplaceFlags.createdAt, dayAgo)));
      if (recentFlags.length >= 10) throw new Error("You've reached the daily report limit. Try again tomorrow.");
      await db.insert(schema.marketplaceFlags).values({ listingId: args.listingId, reporterCompanyId: identity.workspaceCompanyId, reporterUserId: identity.workspaceUserId, reason: args.reason, details: args.details, status: "open", createdAt: now });
      await db.update(schema.marketplaceListings).set({ flagCount: sql`flag_count + 1`, updatedAt: now }).where(eq(schema.marketplaceListings.id, args.listingId));
      const updated = (await db.select({ flagCount: schema.marketplaceListings.flagCount, moderationStatus: schema.marketplaceListings.moderationStatus }).from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, args.listingId)).limit(1))[0];
      let status = updated?.moderationStatus ?? "active";
      const threshold = await getFlagThreshold(db);
      if (status === "active" && (updated?.flagCount ?? 0) >= threshold) {
        await db.update(schema.marketplaceListings).set({ moderationStatus: "pending_review", updatedAt: now }).where(eq(schema.marketplaceListings.id, args.listingId));
        status = "pending_review";
      }
      ctx.invalidateQueries();
      return { ok: true, status };
    },
  }),
  // Build 4: marketplace paid bump — one-time Stripe payment for 7-day featured placement.
  startListingBumpCheckout: defineAction({
    request: z.object({ listingId: z.number().int().positive() }),
    response: z.object({ configured: z.boolean(), checkoutUrl: z.string().nullable(), missing: z.array(z.string()) }),
    privileged: [privileged.createListingBumpCheckout],
    async handler(ctx, args) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const listing = (await db.select().from(schema.marketplaceListings).where(and(eq(schema.marketplaceListings.id, args.listingId), eq(schema.marketplaceListings.companyId, identity.workspaceCompanyId))).limit(1))[0];
      if (!listing) throw new Error("Listing not found.");
      if (listing.moderationStatus !== "active") throw new Error("Only active listings can be featured.");
      const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
      if (!user) throw new Error("Sign in to continue.");
      return await ctx.executePrivileged(privileged.createListingBumpCheckout, { userId: user.id, companyId: user.companyId, email: user.email, listingId: listing.id });
    },
  }),
  getListingBumpStatus: defineAction({
    request: z.object({ listingId: z.number().int().positive() }),
    response: z.object({ featured: z.boolean(), featuredUntil: z.string().nullable(), configured: z.boolean() }),
    async handler(ctx, args) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const listing = (await db.select({ featuredUntil: schema.marketplaceListings.featuredUntil, companyId: schema.marketplaceListings.companyId }).from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, args.listingId)).limit(1))[0];
      if (!listing || listing.companyId !== identity.workspaceCompanyId) throw new Error("Listing not found.");
      const until = listing.featuredUntil && listing.featuredUntil.getTime() > Date.now() ? listing.featuredUntil : null;
      return { featured: until !== null, featuredUntil: until?.toISOString() ?? null, configured: Boolean(process.env.STRIPE_BUMP_PRICE_ID?.trim()) };
    },
  }),
  startMarketplaceConversation: defineAction({
    request: z.object({ listingId: z.number().int().positive() }),
    response: z.object({ conversationId: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const identity = workspaceIdentity(ctx);
      const myCompanyId = identity.workspaceCompanyId;
      const listing = (await db.select({ id: schema.marketplaceListings.id, companyId: schema.marketplaceListings.companyId }).from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, args.listingId)).limit(1))[0];
      if (!listing) throw new Error("This listing is no longer available.");
      if (listing.companyId === myCompanyId) throw new Error("You can't message your own listing.");
      const existing = (await db.select({ id: schema.marketplaceConversations.id }).from(schema.marketplaceConversations).where(and(eq(schema.marketplaceConversations.listingId, args.listingId), eq(schema.marketplaceConversations.inquirerCompanyId, myCompanyId))).limit(1))[0];
      if (existing) { ctx.invalidateQueries(); return { conversationId: existing.id }; }
      try {
        const made = (await db.insert(schema.marketplaceConversations).values({ listingId: args.listingId, ownerCompanyId: listing.companyId, inquirerCompanyId: myCompanyId, lastMessageAt: new Date(), createdAt: new Date() }).returning({ id: schema.marketplaceConversations.id }))[0];
        if (!made) throw new Error("The conversation could not be started.");
        ctx.invalidateQueries();
        return { conversationId: made.id };
      } catch (error) {
        // Lost a get-or-create race: the unique (listing, inquirer) index
        // fired, so the winner's row is the one to return.
        const winner = (await db.select({ id: schema.marketplaceConversations.id }).from(schema.marketplaceConversations).where(and(eq(schema.marketplaceConversations.listingId, args.listingId), eq(schema.marketplaceConversations.inquirerCompanyId, myCompanyId))).limit(1))[0];
        if (winner) { ctx.invalidateQueries(); return { conversationId: winner.id }; }
        throw error;
      }
    },
  }),
  marketplaceConversations: defineAction({
    request: z.object({}),
    response: z.object({ unreadCount: z.number(), conversations: z.array(marketplaceInboxRowSchema) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const identity = workspaceIdentity(ctx);
      const myCompanyId = identity.workspaceCompanyId;
      const convos = await db.select().from(schema.marketplaceConversations).where(or(eq(schema.marketplaceConversations.ownerCompanyId, myCompanyId), eq(schema.marketplaceConversations.inquirerCompanyId, myCompanyId))).orderBy(desc(schema.marketplaceConversations.lastMessageAt));
      if (!convos.length) return { unreadCount: 0, conversations: [] };
      const convoIds = convos.map((c) => c.id);
      const listingIds = [...new Set(convos.map((c) => c.listingId))];
      const listings = await db.select({ id: schema.marketplaceListings.id, title: schema.marketplaceListings.title, companyName: schema.marketplaceListings.companyName }).from(schema.marketplaceListings).where(inArray(schema.marketplaceListings.id, listingIds));
      const listingById = new Map(listings.map((listing) => [listing.id, listing]));
      const companyIds: number[] = [];
      for (const c of convos) companyIds.push(c.ownerCompanyId === myCompanyId ? c.inquirerCompanyId : c.ownerCompanyId);
      // Company names are public (shown on every listing), so read them
      // unscoped; the workspace proxy would only return the caller's own row.
      const names = await marketplaceCompanyNames(platformDb(ctx), companyIds);
      const messages = await db.select().from(schema.marketplaceMessages).where(inArray(schema.marketplaceMessages.conversationId, convoIds)).orderBy(desc(schema.marketplaceMessages.createdAt));
      const latestByConvo = new Map<number, typeof messages[number]>();
      const messagesByConvo = new Map<number, typeof messages>();
      for (const message of messages) {
        if (message.conversationId == null) continue;
        if (!latestByConvo.has(message.conversationId)) latestByConvo.set(message.conversationId, message);
        const list = messagesByConvo.get(message.conversationId) ?? [];
        list.push(message);
        messagesByConvo.set(message.conversationId, list);
      }
      const rows = convos.map((convo) => {
        const isInquiry = convo.ownerCompanyId !== myCompanyId;
        const listing = listingById.get(convo.listingId);
        const otherCompanyId = isInquiry ? convo.ownerCompanyId : convo.inquirerCompanyId;
        const otherPartyName = isInquiry ? (listing?.companyName || "Unknown company") : (names.get(otherCompanyId) || `Company ${otherCompanyId}`);
        const latest = latestByConvo.get(convo.id);
        const readAt = isInquiry ? convo.inquirerReadAt : convo.ownerReadAt;
        // Unread for the CALLER only: messages from the other party newer
        // than the caller's own read timestamp. Never leaks the other side.
        const unreadCount = (messagesByConvo.get(convo.id) ?? []).filter((m) => m.senderCompanyId !== myCompanyId && (!readAt || m.createdAt.getTime() > readAt.getTime())).length;
        return {
          id: convo.id,
          listingId: convo.listingId,
          listingTitle: listing?.title || "Listing",
          otherPartyName,
          lastMessage: latest ? (latest.body || (latest.imageBlobKey ? "Photo" : "Message")) : "",
          lastMessageAt: (latest?.createdAt || convo.lastMessageAt).toISOString(),
          unreadCount,
          isInquiry,
        };
      });
      return { unreadCount: rows.reduce((sum, row) => sum + row.unreadCount, 0), conversations: rows };
    },
  }),
  marketplaceConversation: defineAction({
    request: z.object({ conversationId: z.number().int().positive() }),
    response: z.object({ id: z.number(), listingId: z.number(), listingTitle: z.string(), otherPartyName: z.string(), isInquiry: z.boolean(), messages: z.array(marketplaceMessageSchema) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const identity = workspaceIdentity(ctx);
      const myCompanyId = identity.workspaceCompanyId;
      const convo = await marketplaceConversationOrThrow(db, args.conversationId, myCompanyId);
      const isInquiry = convo.ownerCompanyId !== myCompanyId;
      const listing = (await db.select({ title: schema.marketplaceListings.title, companyName: schema.marketplaceListings.companyName }).from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, convo.listingId)).limit(1))[0];
      const otherCompanyId = isInquiry ? convo.ownerCompanyId : convo.inquirerCompanyId;
      const names = await marketplaceCompanyNames(platformDb(ctx), [myCompanyId, otherCompanyId]);
      const otherPartyName = isInquiry ? (listing?.companyName || "Unknown company") : (names.get(otherCompanyId) || `Company ${otherCompanyId}`);
      const myName = names.get(myCompanyId) || "";
      const rows = await db.select().from(schema.marketplaceMessages).where(eq(schema.marketplaceMessages.conversationId, convo.id)).orderBy(schema.marketplaceMessages.createdAt);
      const messages = await Promise.all(rows.map(async (row) => {
        const outgoing = row.senderCompanyId === myCompanyId;
        return { id: row.id, conversationId: convo.id, body: row.body, imageUrl: row.imageBlobKey ? await ctx.blobs.getUrl(row.imageBlobKey) : null, imageFilename: row.imageFilename, outgoing, senderName: outgoing ? myName : otherPartyName, createdAt: row.createdAt.toISOString() };
      }));
      return { id: convo.id, listingId: convo.listingId, listingTitle: listing?.title || "Listing", otherPartyName, isInquiry, messages };
    },
  }),
  markMarketplaceConversationRead: defineAction({
    request: z.object({ conversationId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const identity = workspaceIdentity(ctx);
      const myCompanyId = identity.workspaceCompanyId;
      const convo = await marketplaceConversationOrThrow(db, args.conversationId, myCompanyId);
      const now = new Date();
      // Only the caller's own read timestamp is ever written; the other
      // party's timestamp is untouched and never returned to anyone.
      if (convo.ownerCompanyId === myCompanyId) {
        await db.update(schema.marketplaceConversations).set({ ownerReadAt: now }).where(eq(schema.marketplaceConversations.id, convo.id));
      } else {
        await db.update(schema.marketplaceConversations).set({ inquirerReadAt: now }).where(eq(schema.marketplaceConversations.id, convo.id));
      }
      // Also clear any in-app notifications pointing at this listing so the
      // inbox badge can't get stuck.
      await db.update(schema.userNotifications).set({ isRead: true }).where(and(eq(schema.userNotifications.userId, identity.workspaceUserId), like(schema.userNotifications.link, `%${convo.listingId}%`), eq(schema.userNotifications.isRead, false)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  sendMarketplaceMessage: defineAction({
    request: z.object({ conversationId: z.number().int().positive(), body: z.string().trim().max(3000), image: z.object({ filename: z.string().min(1).max(240), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), dataBase64: z.string().min(1).max(30_000_000) }).nullable() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      if (!args.body && !args.image) throw new Error("Write a message or add a photo.");
      const db = ctx.db<typeof schema>();
      const identity = workspaceIdentity(ctx);
      const myCompanyId = identity.workspaceCompanyId;
      const convo = await marketplaceConversationOrThrow(db, args.conversationId, myCompanyId);
      const isOwner = convo.ownerCompanyId === myCompanyId;
      const listing = (await db.select({ id: schema.marketplaceListings.id, title: schema.marketplaceListings.title }).from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, convo.listingId)).limit(1))[0];
      if (!listing) throw new Error("This listing is no longer available.");
      const key = args.image ? `marketplace/messages/${convo.listingId}/${crypto.randomUUID()}-${args.image.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}` : null;
      if (args.image && key) await ctx.blobs.put(key, Buffer.from(args.image.dataBase64, "base64"), { contentType: args.image.contentType });
      try {
        // companyId follows the old convention (listing owner's company) so
        // the listing owner's delete flow keeps working unchanged.
        const made = (await db.insert(schema.marketplaceMessages).values({ companyId: convo.ownerCompanyId, listingId: convo.listingId, conversationId: convo.id, body: args.body, imageBlobKey: key, imageFilename: args.image?.filename ?? "", imageContentType: args.image?.contentType ?? "", sender: isOwner ? "me" : "other", senderCompanyId: myCompanyId, readAt: null, createdAt: new Date() }).returning({ id: schema.marketplaceMessages.id }))[0];
        if (!made) throw new Error("The message could not be saved.");
        const now = new Date();
        // Bump the thread; the recipient's own read timestamp is left alone
        // so their unread count is exactly the messages newer than their
        // last read — no read state is ever fabricated or leaked.
        await db.update(schema.marketplaceConversations).set({ lastMessageAt: now }).where(eq(schema.marketplaceConversations.id, convo.id));
        // Chunk D push: notify ONLY the other participant in this
        // conversation (previously every inquirer on the listing was pinged).
        try {
          const recipientCompanyId = isOwner ? convo.inquirerCompanyId : convo.ownerCompanyId;
          const titleEn = isOwner ? `New reply: ${listing.title}` : `New inquiry: ${listing.title}`;
          const titleEs = isOwner ? `Nueva respuesta: ${listing.title}` : `Nueva consulta: ${listing.title}`;
          const preview = args.body.length > 120 ? `${args.body.slice(0, 120)}…` : args.body;
          if ((await getNotifyPrefs(db, recipientCompanyId)).notifyNewMessage) {
            await sendPushToCompany(db, recipientCompanyId, { titleEn, titleEs, bodyEn: preview, bodyEs: preview, url: "/app/", listingId: listing.id }, identity.workspaceUserId);
          }
        } catch { /* push is best-effort */ }
        ctx.invalidateQueries(); return { id: made.id };
      } catch (error) { if (key) await ctx.blobs.delete(key).catch(() => {}); throw error; }
    },
  }),

  createMarketplaceBooking: defineAction({
    request: z.object({ listingId: z.number().int().positive(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().max(2000) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      if (args.endDate < args.startDate) throw new Error("End date must be on or after the start date.");
      const db = ctx.db<typeof schema>(); const listing = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, args.listingId)).limit(1))[0];
      if (!listing?.bookable) throw new Error("This listing is not available for booking.");
      const made = (await db.insert(schema.marketplaceBookingRequests).values({ ...args, status: "requested", createdAt: new Date() }).returning({ id: schema.marketplaceBookingRequests.id }))[0];
      if (!made) throw new Error("The booking request could not be saved.");
      ctx.invalidateQueries(); return { id: made.id };
    },
  }),
  listMarketplaceBookings: defineAction({
    request: z.object({ listingId: z.number().int().positive().nullable().default(null) }),
    response: z.object({ bookings: z.array(marketplaceBookingSchema) }),
    async handler(ctx, args) { const rows = await ctx.db<typeof schema>().select().from(schema.marketplaceBookingRequests).orderBy(desc(schema.marketplaceBookingRequests.createdAt)); return { bookings: rows.filter((row) => !args.listingId || row.listingId === args.listingId).map((row) => ({ id: row.id, listingId: row.listingId, startDate: row.startDate, endDate: row.endDate, note: row.note, status: row.status, createdAt: row.createdAt.toISOString() })) }; },
  }),
  listMarketplaceRequests: defineAction({ request: z.object({}), response: z.object({ requests: z.array(marketplaceRequestSchema) }), async handler(ctx) { const rows = await ctx.db<typeof schema>().select().from(schema.marketplaceRequests).orderBy(desc(schema.marketplaceRequests.createdAt)); return { requests: rows.map(marketplaceRequestShape) }; }}),
  createMarketplaceRequest: defineAction({
    request: z.object({ title: z.string().trim().min(1).max(180), category: marketplaceCategorySchema, listingType: z.enum(["job", "project"]), description: z.string().trim().max(5000), serviceArea: z.string().trim().min(1).max(160), neededBy: z.string().trim().max(80), companyName: z.string().trim().min(1).max(180), companyPhone: z.string().trim().max(80) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) { const now = new Date(); const made = (await ctx.db<typeof schema>().insert(schema.marketplaceRequests).values({ ...args, createdAt: now, updatedAt: now }).returning({ id: schema.marketplaceRequests.id }))[0]; if (!made) throw new Error("The request could not be saved."); ctx.invalidateQueries(); return { id: made.id }; },
  }),

  // -------------------------------------------------------------------------
  // Chunk D: referral loop, marketplace alerts, notifications, web push.
  // -------------------------------------------------------------------------

  getReferralStats: defineAction({
    request: z.object({}),
    response: z.object({ referralCode: z.string(), joinedCount: z.number(), bonusListings: z.number(), baseLimit: z.number(), effectiveLimit: z.number() }),
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      let code = (await db.select({ referralCode: schema.authUsers.referralCode }).from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0]?.referralCode ?? null;
      if (!code) {
        code = await uniqueReferralCode(db);
        await db.update(schema.authUsers).set({ referralCode: code, updatedAt: new Date() }).where(eq(schema.authUsers.id, identity.workspaceUserId));
      }
      const events = await db.select({ id: schema.referralEvents.id }).from(schema.referralEvents).where(eq(schema.referralEvents.referrerUserId, identity.workspaceUserId));
      const { base, bonus, effective } = await getEffectiveListingLimit(db);
      return { referralCode: code, joinedCount: events.length, bonusListings: bonus, baseLimit: base, effectiveLimit: effective };
    },
  }),

  saveMarketplaceAlert: defineAction({
    request: z.object({ keyword: z.string().trim().min(2).max(80), category: marketplaceCategorySchema.nullable().default(null), serviceArea: z.string().trim().max(120).default("") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      await requireMarketplaceEnabled(db);
      const existing = await db.select({ id: schema.marketplaceAlerts.id }).from(schema.marketplaceAlerts).where(eq(schema.marketplaceAlerts.userId, identity.workspaceUserId));
      if (existing.length >= 20) throw new Error("You can save up to 20 alerts.");
      const duplicate = (await db.select({ id: schema.marketplaceAlerts.id }).from(schema.marketplaceAlerts).where(and(
        eq(schema.marketplaceAlerts.userId, identity.workspaceUserId),
        eq(schema.marketplaceAlerts.keyword, args.keyword),
      )).limit(1))[0];
      if (duplicate) throw new Error("You already have an alert for that keyword.");
      const made = (await db.insert(schema.marketplaceAlerts).values({
        userId: identity.workspaceUserId,
        keyword: args.keyword,
        category: args.category,
        serviceArea: args.serviceArea.trim() || null,
        createdAt: new Date(),
      }).returning({ id: schema.marketplaceAlerts.id }))[0];
      if (!made) throw new Error("The alert could not be saved.");
      return { id: made.id };
    },
  }),

  listMarketplaceAlerts: defineAction({
    request: z.object({}),
    response: z.object({ alerts: z.array(z.object({ id: z.number(), keyword: z.string(), category: z.string().nullable(), serviceArea: z.string().nullable(), createdAt: z.string() })) }),
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.marketplaceAlerts).where(eq(schema.marketplaceAlerts.userId, identity.workspaceUserId)).orderBy(desc(schema.marketplaceAlerts.createdAt));
      return { alerts: rows.map((row) => ({ id: row.id, keyword: row.keyword, category: row.category, serviceArea: row.serviceArea, createdAt: row.createdAt.toISOString() })) };
    },
  }),

  deleteMarketplaceAlert: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const identity = workspaceIdentity(ctx);
      await ctx.db<typeof schema>().delete(schema.marketplaceAlerts).where(and(eq(schema.marketplaceAlerts.id, args.id), eq(schema.marketplaceAlerts.userId, identity.workspaceUserId)));
      return { ok: true };
    },
  }),

  listNotifications: defineAction({
    request: z.object({}),
    response: z.object({ unreadCount: z.number(), notifications: z.array(z.object({ id: z.number(), kind: z.string(), titleEn: z.string(), titleEs: z.string(), link: z.string(), isRead: z.boolean(), createdAt: z.string() })) }),
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.userNotifications).where(eq(schema.userNotifications.userId, identity.workspaceUserId)).orderBy(desc(schema.userNotifications.createdAt)).limit(50);
      return {
        unreadCount: rows.filter((row) => !row.isRead).length,
        notifications: rows.map((row) => ({ id: row.id, kind: row.kind, titleEn: row.titleEn, titleEs: row.titleEs, link: row.link, isRead: row.isRead, createdAt: row.createdAt.toISOString() })),
      };
    },
  }),

  markNotificationsRead: defineAction({
    request: z.object({ ids: z.array(z.number().int().positive()).max(100).default([]) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const condition = args.ids.length
        ? and(eq(schema.userNotifications.userId, identity.workspaceUserId), inArray(schema.userNotifications.id, args.ids))
        : eq(schema.userNotifications.userId, identity.workspaceUserId);
      await db.update(schema.userNotifications).set({ isRead: true }).where(condition);
      return { ok: true };
    },
  }),

  getVapidPublicKey: defineAction({
    request: z.object({}),
    response: z.object({ publicKey: z.string().nullable() }),
    async handler() {
      return { publicKey: getVapidPublicKey() };
    },
  }),

  savePushSubscription: defineAction({
    request: z.object({ endpoint: z.string().url().max(500), p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const existing = (await db.select({ id: schema.pushSubscriptions.id }).from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, args.endpoint)).limit(1))[0];
      if (existing) {
        await db.update(schema.pushSubscriptions).set({ userId: identity.workspaceUserId, p256dh: args.p256dh, auth: args.auth }).where(eq(schema.pushSubscriptions.id, existing.id));
      } else {
        await db.insert(schema.pushSubscriptions).values({ userId: identity.workspaceUserId, endpoint: args.endpoint, p256dh: args.p256dh, auth: args.auth, createdAt: new Date() });
      }
      return { ok: true };
    },
  }),

  removePushSubscription: defineAction({
    request: z.object({ endpoint: z.string().trim().max(500) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const identity = workspaceIdentity(ctx);
      await ctx.db<typeof schema>().delete(schema.pushSubscriptions).where(and(eq(schema.pushSubscriptions.endpoint, args.endpoint), eq(schema.pushSubscriptions.userId, identity.workspaceUserId)));
      return { ok: true };
    },
  }),

  // -------------------------------------------------------------------------
  // Platform admin (Danny): moderation queue, users, refunds, settings, audit.
  // Every action below requires is_platform_admin on the caller's auth user.
  // -------------------------------------------------------------------------
  adminModerationQueue: defineAction({
    request: z.object({}),
    response: z.object({
      queue: z.array(z.object({
        listing: z.object({ id: z.number(), title: z.string(), description: z.string(), category: z.string(), companyName: z.string(), companyPhone: z.string(), serviceArea: z.string(), moderationStatus: z.string(), moderationReason: z.string(), flagCount: z.number(), createdAt: z.string(), updatedAt: z.string() }),
        flags: z.array(z.object({ id: z.number(), reason: z.string(), details: z.string(), status: z.string(), reporterCompanyName: z.string(), createdAt: z.string() })),
      })),
    }),
    async handler(ctx) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const rows = await db.select().from(schema.marketplaceListings).where(inArray(schema.marketplaceListings.moderationStatus, ["auto_rejected", "pending_review"])).orderBy(desc(schema.marketplaceListings.createdAt));
      const listingIds = rows.map((row) => row.id);
      const flagRows = listingIds.length ? await db.select().from(schema.marketplaceFlags).where(inArray(schema.marketplaceFlags.listingId, listingIds)).orderBy(desc(schema.marketplaceFlags.createdAt)) : [];
      const companyIds = new Set<number>();
      for (const row of rows) companyIds.add(row.companyId);
      for (const flag of flagRows) companyIds.add(flag.reporterCompanyId);
      const settingsRows = companyIds.size ? await db.select({ companyId: schema.settings.companyId, companyName: schema.settings.companyName }).from(schema.settings).where(inArray(schema.settings.companyId, [...companyIds])) : [];
      const companyNameById = new Map(settingsRows.map((row) => [row.companyId, row.companyName]));
      const flagsByListing = new Map<number, typeof flagRows>();
      for (const flag of flagRows) {
        const list = flagsByListing.get(flag.listingId) ?? [];
        list.push(flag);
        flagsByListing.set(flag.listingId, list);
      }
      return {
        queue: rows.map((row) => ({
          listing: {
            id: row.id, title: row.title, description: row.description, category: row.category,
            companyName: companyNameById.get(row.companyId) || row.companyName, companyPhone: row.companyPhone,
            serviceArea: row.serviceArea, moderationStatus: row.moderationStatus,
            moderationReason: row.moderationReason, flagCount: row.flagCount,
            createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
          },
          flags: (flagsByListing.get(row.id) ?? []).map((flag) => ({
            id: flag.id, reason: flag.reason, details: flag.details, status: flag.status,
            reporterCompanyName: companyNameById.get(flag.reporterCompanyId) || `Company ${flag.reporterCompanyId}`,
            createdAt: flag.createdAt.toISOString(),
          })),
        })),
      };
    },
  }),
  adminListingDecision: defineAction({
    request: z.object({ listingId: z.number().int().positive(), decision: z.enum(["approve", "remove"]), note: z.string().trim().max(500).default("") }),
    response: z.object({ ok: z.literal(true), status: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; status: string }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx); const now = new Date();
      const listing = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, args.listingId)).limit(1))[0];
      if (!listing) throw new Error("This listing could not be found.");
      const status = args.decision === "approve" ? "active" : "removed";
      await db.update(schema.marketplaceListings).set({
        moderationStatus: status,
        moderationReason: args.decision === "approve" ? "" : (args.note || "Removed by platform admin."),
        updatedAt: now,
      }).where(eq(schema.marketplaceListings.id, args.listingId));
      await db.update(schema.marketplaceFlags).set({ status: args.decision === "approve" ? "reviewed_ok" : "reviewed_removed" }).where(and(eq(schema.marketplaceFlags.listingId, args.listingId), eq(schema.marketplaceFlags.status, "open")));
      await logAdminAction(db, admin.id, args.decision === "approve" ? "listing.approve" : "listing.remove", "marketplace_listing", String(args.listingId), args.note || `${listing.title}`);
      // Chunk D: an approved listing becomes visible, so it triggers alerts.
      if (status === "active") {
        const ownerUser = (await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.companyId, listing.companyId)).limit(1))[0];
        await notifyAlertMatches(ctx, { id: listing.id, title: listing.title, description: listing.description, category: listing.category, serviceArea: listing.serviceArea, authorUserId: ownerUser?.id ?? -1 });
      }
      ctx.invalidateQueries();
      return { ok: true, status };
    },
    privileged: [privileged.sendSecurityAlert],
  }),
  // Mission Control: platform analytics dashboard. All actions require platform admin.
  adminAnalyticsOverview: defineAction({
    request: z.object({}),
    response: z.object({
      totalUsers: z.number(), newToday: z.number(), newThisWeek: z.number(), newThisMonth: z.number(),
      activePremium: z.number(), premiumToday: z.number(), premiumThisWeek: z.number(),
      mrr: z.number(), foundingClaimed: z.number(), foundingRemaining: z.number(),
      cancelledLast30d: z.number(), churnRate: z.number(),
    }),
    async handler(ctx) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const now = new Date();
      const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
      const weekAgo = new Date(now.getTime() - 7 * 86400000);
      const monthAgo = new Date(now.getTime() - 30 * 86400000);

      const users = await db.select({ id: schema.authUsers.id, createdAt: schema.authUsers.createdAt, tier: schema.authUsers.tier, subscriptionStatus: schema.authUsers.subscriptionStatus }).from(schema.authUsers);
      const totalUsers = users.length;
      const newToday = users.filter((u) => u.createdAt >= startOfDay).length;
      const newThisWeek = users.filter((u) => u.createdAt >= weekAgo).length;
      const newThisMonth = users.filter((u) => u.createdAt >= monthAgo).length;

      const premiumUsers = users.filter((u) => u.tier === "premium");
      const activePremium = premiumUsers.length;
      const foundingClaimed = users.filter((u) => u.subscriptionStatus === "founding_member").length;
      const foundingRemaining = Math.max(0, 100 - foundingClaimed);

      // New premium subscriptions from lifecycle events (accurate timestamps).
      const subEvents = await db.select().from(schema.subscriptionEvents).where(inArray(schema.subscriptionEvents.eventType, ["subscribed", "founding_claimed", "play_subscribed"]));
      const premiumToday = subEvents.filter((e) => e.createdAt >= startOfDay).length;
      const premiumThisWeek = subEvents.filter((e) => e.createdAt >= weekAgo).length;

      // MRR: monthly × $19 + annual × $189/12 + play monthly × $19. Founding/lifetime excluded.
      const latestPlanByUser = new Map<number, string>();
      const sortedEvents = [...subEvents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      for (const e of sortedEvents) {
        if (!latestPlanByUser.has(e.userId)) latestPlanByUser.set(e.userId, e.plan);
      }
      const premiumUserIds = new Set(premiumUsers.map((u) => u.id));
      let mrr = 0;
      for (const [userId, plan] of latestPlanByUser) {
        if (!premiumUserIds.has(userId)) continue;
        if (plan === "monthly" || plan === "play_monthly") mrr += 19;
        else if (plan === "annual") mrr += 189 / 12;
      }

      // Churn: cancellations in last 30d ÷ premium users at start of period (approx).
      const cancelEvents = await db.select().from(schema.subscriptionEvents).where(eq(schema.subscriptionEvents.eventType, "cancelled"));
      const cancelledLast30d = cancelEvents.filter((e) => e.createdAt >= monthAgo).length;
      const churnRate = activePremium > 0 ? Math.round((cancelledLast30d / (activePremium + cancelledLast30d)) * 1000) / 10 : 0;

      return { totalUsers, newToday, newThisWeek, newThisMonth, activePremium, premiumToday, premiumThisWeek, mrr: Math.round(mrr * 100) / 100, foundingClaimed, foundingRemaining, cancelledLast30d, churnRate };
    },
  }),
  adminAnalyticsCharts: defineAction({
    request: z.object({ days: z.number().int().min(7).max(90).default(30) }),
    response: z.object({
      signups: z.array(z.object({ date: z.string(), count: z.number() })),
      subscriptions: z.array(z.object({ date: z.string(), count: z.number(), monthly: z.number(), annual: z.number(), lifetime: z.number(), play: z.number() })),
      cancellations: z.array(z.object({ date: z.string(), count: z.number() })),
    }),
    async handler(ctx, args) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const days: { date: string; count: number }[] = [];
      const now = new Date();
      for (let i = args.days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        days.push({ date: d.toISOString().slice(0, 10), count: 0 });
      }
      const byDate = new Map(days.map((d) => [d.date, d]));

      const users = await db.select({ createdAt: schema.authUsers.createdAt }).from(schema.authUsers);
      for (const u of users) {
        const key = u.createdAt.toISOString().slice(0, 10);
        const bucket = byDate.get(key);
        if (bucket) bucket.count++;
      }
      const signups = days.map((d) => ({ ...d }));

      // Reset for subscriptions.
      for (const d of days) d.count = 0;
      const subEvents = await db.select().from(schema.subscriptionEvents).where(inArray(schema.subscriptionEvents.eventType, ["subscribed", "founding_claimed", "play_subscribed"]));
      const subsByDate = new Map<string, { count: number; monthly: number; annual: number; lifetime: number; play: number }>();
      for (const d of days) subsByDate.set(d.date, { count: 0, monthly: 0, annual: 0, lifetime: 0, play: 0 });
      for (const e of subEvents) {
        const key = e.createdAt.toISOString().slice(0, 10);
        const bucket = subsByDate.get(key);
        if (!bucket) continue;
        bucket.count++;
        if (e.plan === "monthly") bucket.monthly++;
        else if (e.plan === "annual") bucket.annual++;
        else if (e.plan === "lifetime") bucket.lifetime++;
        else if (e.plan === "play_monthly") bucket.play++;
      }
      const subscriptions = days.map((d) => ({ date: d.date, ...subsByDate.get(d.date)! }));

      for (const d of days) d.count = 0;
      const cancelEvents = await db.select({ createdAt: schema.subscriptionEvents.createdAt }).from(schema.subscriptionEvents).where(eq(schema.subscriptionEvents.eventType, "cancelled"));
      for (const e of cancelEvents) {
        const key = e.createdAt.toISOString().slice(0, 10);
        const bucket = byDate.get(key);
        if (bucket) bucket.count++;
      }
      const cancellations = days.map((d) => ({ ...d }));

      return { signups, subscriptions, cancellations };
    },
  }),
  adminCancellationStats: defineAction({
    request: z.object({}),
    response: z.object({
      byReason: z.array(z.object({ reason: z.string(), count: z.number() })),
      recent: z.array(z.object({ id: z.number(), userName: z.string(), reason: z.string(), details: z.string(), plan: z.string(), createdAt: z.string() })),
      total: z.number(),
    }),
    async handler(ctx) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const feedback = await db.select().from(schema.cancellationFeedback).orderBy(desc(schema.cancellationFeedback.createdAt)).limit(100);
      const byReason = new Map<string, number>();
      for (const f of feedback) byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1);
      const userIds = [...new Set(feedback.map((f) => f.userId))];
      const users = userIds.length ? await db.select({ id: schema.authUsers.id, name: schema.authUsers.name }).from(schema.authUsers).where(inArray(schema.authUsers.id, userIds)) : [];
      const nameById = new Map(users.map((u) => [u.id, u.name]));
      return {
        byReason: [...byReason.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
        recent: feedback.slice(0, 20).map((f) => ({ id: f.id, userName: nameById.get(f.userId) ?? "Unknown", reason: f.reason, details: f.details, plan: f.plan, createdAt: f.createdAt.toISOString() })),
        total: feedback.length,
      };
    },
  }),
  adminRecentActivity: defineAction({
    request: z.object({}),
    response: z.object({
      signups: z.array(z.object({ id: z.number(), name: z.string(), email: z.string(), tier: z.string(), createdAt: z.string() })),
      events: z.array(z.object({ id: z.number(), userName: z.string(), eventType: z.string(), plan: z.string(), createdAt: z.string() })),
    }),
    async handler(ctx) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const recentUsers = await db.select({ id: schema.authUsers.id, name: schema.authUsers.name, email: schema.authUsers.email, tier: schema.authUsers.tier, createdAt: schema.authUsers.createdAt }).from(schema.authUsers).orderBy(desc(schema.authUsers.createdAt)).limit(15);
      const recentEvents = await db.select().from(schema.subscriptionEvents).orderBy(desc(schema.subscriptionEvents.createdAt)).limit(15);
      const userIds = [...new Set(recentEvents.map((e) => e.userId))];
      const users = userIds.length ? await db.select({ id: schema.authUsers.id, name: schema.authUsers.name }).from(schema.authUsers).where(inArray(schema.authUsers.id, userIds)) : [];
      const nameById = new Map(users.map((u) => [u.id, u.name]));
      return {
        signups: recentUsers.map((u) => ({ id: u.id, name: u.name, email: u.email, tier: u.tier, createdAt: u.createdAt.toISOString() })),
        events: recentEvents.map((e) => ({ id: e.id, userName: nameById.get(e.userId) ?? "Unknown", eventType: e.eventType, plan: e.plan, createdAt: e.createdAt.toISOString() })),
      };
    },
  }),
  adminUsersList: defineAction({
    request: z.object({ search: z.string().trim().max(120).default(""), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20) }),
    response: z.object({
      users: z.array(z.object({ id: z.number(), name: z.string(), email: z.string(), tier: z.string(), subscriptionStatus: z.string(), companyId: z.number(), companyName: z.string(), createdAt: z.string(), suspended: z.boolean(), isPlatformAdmin: z.boolean() })),
      total: z.number(), page: z.number(), pageSize: z.number(),
    }),
    async handler(ctx, args) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const term = `%${args.search}%`;
      const whereClause = args.search ? or(like(schema.authUsers.name, term), like(schema.authUsers.email, term)) : undefined;
      const all = await db.select().from(schema.authUsers).where(whereClause).orderBy(desc(schema.authUsers.createdAt));
      const total = all.length;
      const page = all.slice((args.page - 1) * args.pageSize, args.page * args.pageSize);
      const companyIds = [...new Set(page.map((row) => row.companyId))];
      const settingsRows = companyIds.length ? await db.select({ companyId: schema.settings.companyId, companyName: schema.settings.companyName }).from(schema.settings).where(inArray(schema.settings.companyId, companyIds)) : [];
      const companyNameById = new Map(settingsRows.map((row) => [row.companyId, row.companyName]));
      return {
        users: page.map((row) => ({
          id: row.id, name: row.name, email: row.email, tier: row.tier, subscriptionStatus: row.subscriptionStatus,
          companyId: row.companyId, companyName: companyNameById.get(row.companyId) || "",
          createdAt: row.createdAt.toISOString(), suspended: Boolean(row.suspendedAt), isPlatformAdmin: row.isPlatformAdmin,
        })),
        total, page: args.page, pageSize: args.pageSize,
      };
    },
  }),
  adminUserDetail: defineAction({
    request: z.object({ userId: z.number().int().positive() }),
    response: z.object({
      user: z.object({
        id: z.number(), name: z.string(), email: z.string(),
        tier: z.string(), subscriptionStatus: z.string(),
        stripeCustomerId: z.string().nullable(), stripeSubscriptionId: z.string().nullable(),
        cancelAtPeriodEnd: z.boolean(), subscriptionCurrentPeriodEnd: z.string().nullable(),
        emailVerified: z.boolean(), emailVerifiedAt: z.string().nullable(),
        marketplaceTermsAcceptedAt: z.string().nullable(), marketplaceTermsVersion: z.string().nullable(),
        createdAt: z.string(), updatedAt: z.string(),
        suspendedAt: z.string().nullable(), suspended: z.boolean(), isPlatformAdmin: z.boolean(),
        companyId: z.number(), companyName: z.string(), activeSessionCount: z.number(),
      }),
      listings: z.array(z.object({ id: z.number(), title: z.string(), moderationStatus: z.string(), flagCount: z.number(), createdAt: z.string() })),
      flagsFiled: z.object({ count: z.number(), recent: z.array(z.object({ id: z.number(), listingId: z.number(), listingTitle: z.string(), reason: z.string(), createdAt: z.string() })) }),
      sessions: z.array(z.object({ id: z.number(), userAgent: z.string().nullable(), lastSeenAt: z.string(), createdAt: z.string() })),
      audit: z.array(z.object({ id: z.number(), action: z.string(), adminName: z.string(), details: z.string(), createdAt: z.string() })),
    }),
    async handler(ctx, args) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, args.userId)).limit(1))[0];
      if (!user) throw new Error("User not found.");
      const companyRow = (await db.select({ companyName: schema.settings.companyName }).from(schema.settings).where(eq(schema.settings.companyId, user.companyId)).limit(1))[0];
      const companyName = companyRow?.companyName || "";
      const listingRows = await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.companyId, user.companyId)).orderBy(desc(schema.marketplaceListings.createdAt));
      const listingIds = listingRows.map((row) => row.id);
      const flagRows = listingIds.length
        ? await db.select({ listingId: schema.marketplaceFlags.listingId }).from(schema.marketplaceFlags).where(inArray(schema.marketplaceFlags.listingId, listingIds))
        : [];
      const flagCounts = new Map<number, number>();
      for (const row of flagRows) flagCounts.set(row.listingId, (flagCounts.get(row.listingId) ?? 0) + 1);
      const filedRecent = await db.select({ id: schema.marketplaceFlags.id, listingId: schema.marketplaceFlags.listingId, listingTitle: schema.marketplaceListings.title, reason: schema.marketplaceFlags.reason, createdAt: schema.marketplaceFlags.createdAt })
        .from(schema.marketplaceFlags)
        .innerJoin(schema.marketplaceListings, eq(schema.marketplaceFlags.listingId, schema.marketplaceListings.id))
        .where(eq(schema.marketplaceFlags.reporterUserId, user.id))
        .orderBy(desc(schema.marketplaceFlags.createdAt)).limit(10);
      const filedCount = (await db.select({ n: sql<number>`count(*)` }).from(schema.marketplaceFlags).where(eq(schema.marketplaceFlags.reporterUserId, user.id)))[0]?.n ?? 0;
      // Active sessions only; token hashes never leave the server.
      const sessionRows = await db.select({ id: schema.authSessions.id, userAgent: schema.authSessions.userAgent, lastSeenAt: schema.authSessions.lastSeenAt, createdAt: schema.authSessions.createdAt })
        .from(schema.authSessions)
        .where(and(eq(schema.authSessions.userId, user.id), isNull(schema.authSessions.revokedAt)))
        .orderBy(desc(schema.authSessions.lastSeenAt));
      const auditRows = await db.select({ id: schema.adminAuditLog.id, action: schema.adminAuditLog.action, adminName: schema.authUsers.name, details: schema.adminAuditLog.details, createdAt: schema.adminAuditLog.createdAt })
        .from(schema.adminAuditLog)
        .leftJoin(schema.authUsers, eq(schema.adminAuditLog.adminUserId, schema.authUsers.id))
        .where(and(eq(schema.adminAuditLog.targetType, "auth_user"), eq(schema.adminAuditLog.targetId, String(user.id))))
        .orderBy(desc(schema.adminAuditLog.createdAt)).limit(20);
      return {
        user: {
          id: user.id, name: user.name, email: user.email,
          tier: user.tier, subscriptionStatus: user.subscriptionStatus,
          stripeCustomerId: user.stripeCustomerId, stripeSubscriptionId: user.stripeSubscriptionId,
          cancelAtPeriodEnd: !!user.cancelAtPeriodEnd,
          subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd ? user.subscriptionCurrentPeriodEnd.toISOString() : null,
          emailVerified: !!user.emailVerifiedAt,
          emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
          marketplaceTermsAcceptedAt: user.marketplaceTermsAcceptedAt ? user.marketplaceTermsAcceptedAt.toISOString() : null,
          marketplaceTermsVersion: user.marketplaceTermsVersion,
          createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString(),
          suspendedAt: user.suspendedAt ? user.suspendedAt.toISOString() : null,
          suspended: !!user.suspendedAt, isPlatformAdmin: user.isPlatformAdmin,
          companyId: user.companyId, companyName, activeSessionCount: sessionRows.length,
        },
        listings: listingRows.map((row) => ({ id: row.id, title: row.title, moderationStatus: row.moderationStatus, flagCount: flagCounts.get(row.id) ?? 0, createdAt: row.createdAt.toISOString() })),
        flagsFiled: { count: filedCount, recent: filedRecent.map((row) => ({ id: row.id, listingId: row.listingId, listingTitle: row.listingTitle, reason: row.reason, createdAt: row.createdAt.toISOString() })) },
        sessions: sessionRows.map((row) => ({ id: row.id, userAgent: row.userAgent, lastSeenAt: row.lastSeenAt.toISOString(), createdAt: row.createdAt.toISOString() })),
        audit: auditRows.map((row) => ({ id: row.id, action: row.action, adminName: row.adminName ?? "System", details: row.details, createdAt: row.createdAt.toISOString() })),
      };
    },
  }),
  adminUserSetTier: defineAction({
    request: z.object({ userId: z.number().int().positive(), tier: z.enum(["free", "premium"]) }),
    response: z.object({ ok: z.literal(true), tier: z.string(), subscriptionStatus: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; tier: string; subscriptionStatus: string }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx); const now = new Date();
      const user = (await db.select({ id: schema.authUsers.id, name: schema.authUsers.name, email: schema.authUsers.email }).from(schema.authUsers).where(eq(schema.authUsers.id, args.userId)).limit(1))[0];
      if (!user) throw new Error("User not found.");
      // Manual grant: "manual" marks it as admin-granted so it is never
      // confused with a Stripe-managed subscription. Stripe itself is untouched.
      const subscriptionStatus = args.tier === "premium" ? "manual" : "inactive";
      await db.update(schema.authUsers).set({ tier: args.tier, subscriptionStatus, cancelAtPeriodEnd: false, updatedAt: now }).where(eq(schema.authUsers.id, args.userId));
      await logAdminAction(db, admin.id, args.tier === "premium" ? "user.tier_grant_premium" : "user.tier_revoke_premium", "auth_user", String(user.id), `${user.name} <${user.email}> → ${args.tier}`);
      ctx.invalidateQueries();
      return { ok: true, tier: args.tier, subscriptionStatus };
    },
  }),
  adminUserRevokeSessions: defineAction({
    request: z.object({ userId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true), revoked: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; revoked: number }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx); const now = new Date();
      if (admin.id === args.userId) throw new Error("You cannot revoke your own sessions from here.");
      const user = (await db.select({ id: schema.authUsers.id, name: schema.authUsers.name, email: schema.authUsers.email }).from(schema.authUsers).where(eq(schema.authUsers.id, args.userId)).limit(1))[0];
      if (!user) throw new Error("User not found.");
      const active = await db.select({ id: schema.authSessions.id }).from(schema.authSessions).where(and(eq(schema.authSessions.userId, args.userId), isNull(schema.authSessions.revokedAt)));
      if (active.length) await db.update(schema.authSessions).set({ revokedAt: now }).where(and(eq(schema.authSessions.userId, args.userId), isNull(schema.authSessions.revokedAt)));
      await logAdminAction(db, admin.id, "user.sessions_revoked", "auth_user", String(user.id), `${user.name} <${user.email}> — ${active.length} session${active.length === 1 ? "" : "s"} revoked`);
      ctx.invalidateQueries();
      return { ok: true, revoked: active.length };
    },
  }),
  adminUserSuspend: defineAction({
    request: z.object({ userId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx); const now = new Date();
      const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, args.userId)).limit(1))[0];
      if (!user) throw new Error("User not found.");
      if (user.id === admin.id) throw new Error("You can't suspend your own account.");
      await db.update(schema.authUsers).set({ suspendedAt: now, updatedAt: now }).where(eq(schema.authUsers.id, user.id));
      // Terminate all existing sessions immediately.
      await db.update(schema.authSessions).set({ revokedAt: now }).where(and(eq(schema.authSessions.userId, user.id), isNull(schema.authSessions.revokedAt)));
      await logAdminAction(db, admin.id, "user.suspend", "auth_user", String(user.id), `${user.name} <${user.email}>`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  adminUserUnsuspend: defineAction({
    request: z.object({ userId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx); const now = new Date();
      const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, args.userId)).limit(1))[0];
      if (!user) throw new Error("User not found.");
      await db.update(schema.authUsers).set({ suspendedAt: null, updatedAt: now }).where(eq(schema.authUsers.id, user.id));
      await logAdminAction(db, admin.id, "user.unsuspend", "auth_user", String(user.id), `${user.name} <${user.email}>`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  adminRefundPreview: defineAction({
    request: z.object({ email: z.string().trim().email().max(200) }),
    response: z.object({
      user: z.object({ id: z.number(), name: z.string(), email: z.string(), stripeCustomerId: z.string().nullable() }).nullable(),
      charges: z.array(z.object({ id: z.string(), amount: z.number(), amountRefunded: z.number(), currency: z.string(), created: z.number(), status: z.string(), description: z.string().nullable() })),
    }),
    async handler(ctx, args) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, normalizedEmail(args.email))).limit(1))[0];
      if (!user) return { user: null, charges: [] };
      const payload = { id: user.id, name: user.name, email: user.email, stripeCustomerId: user.stripeCustomerId };
      if (!user.stripeCustomerId) return { user: payload, charges: [] };
      const result = await ctx.executePrivileged(privileged.listStripeCharges, { customerId: user.stripeCustomerId, limit: 10 });
      return { user: payload, charges: result.charges };
    },
  }),
  adminRefund: defineAction({
    request: z.object({ chargeId: z.string().trim().min(1).max(200), amountCents: z.number().int().positive().max(10_000_000).optional(), reason: z.string().trim().max(500).default("") }),
    response: z.object({ id: z.string(), amount: z.number(), currency: z.string(), status: z.string() }),
    async handler(ctx, args) {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const refund = await ctx.executePrivileged(privileged.issueStripeRefund, { chargeId: args.chargeId, amountCents: args.amountCents, reason: args.reason });
      await logAdminAction(db, admin.id, "stripe.refund", "stripe_charge", args.chargeId, `Refund ${refund.id}: ${(refund.amount / 100).toFixed(2)} ${refund.currency.toUpperCase()}${args.reason ? ` — ${args.reason}` : ""}`);
      ctx.invalidateQueries();
      return refund;
    },
  }),
  adminSettingsGet: defineAction({
    request: z.object({}),
    response: z.object({
      settings: z.record(z.string(), z.string()),
      defs: z.array(z.object({ key: z.string(), type: z.enum(["boolean", "int", "text"]), labelEn: z.string(), labelEs: z.string(), min: z.number().optional(), max: z.number().optional(), maxLength: z.number().optional() })),
    }),
    async handler(ctx) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const rows = await db.select().from(schema.platformSettings);
      const settings: Record<string, string> = {};
      for (const row of rows) settings[row.key] = row.value;
      const defs = Object.entries(PLATFORM_SETTING_DEFS).map(([key, def]) => ({
        key, type: def.type as "boolean" | "int" | "text", labelEn: def.labelEn, labelEs: def.labelEs,
        ...(def.min !== undefined ? { min: def.min } : {}),
        ...(def.max !== undefined ? { max: def.max } : {}),
        ...(def.maxLength !== undefined ? { maxLength: def.maxLength } : {}),
      }));
      return { settings, defs };
    },
  }),
  adminSettingsSet: defineAction({
    request: z.object({ key: z.enum(Object.keys(PLATFORM_SETTING_DEFS) as [string, ...string[]]), value: z.string().trim().max(2000) }),
    response: z.object({ ok: z.literal(true), key: z.string(), value: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; key: string; value: string }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx); const now = new Date();
      const value = normalizePlatformSetting(args.key, args.value);
      const existing = (await db.select({ key: schema.platformSettings.key }).from(schema.platformSettings).where(eq(schema.platformSettings.key, args.key)).limit(1))[0];
      if (existing) await db.update(schema.platformSettings).set({ value, updatedAt: now }).where(eq(schema.platformSettings.key, args.key));
      else await db.insert(schema.platformSettings).values({ key: args.key, value, updatedAt: now });
      await logAdminAction(db, admin.id, "settings.update", "platform_setting", args.key, `${args.key} = ${value}`);
      ctx.invalidateQueries();
      return { ok: true, key: args.key, value };
    },
  }),
  adminAuditLog: defineAction({
    request: z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(25) }),
    response: z.object({
      entries: z.array(z.object({ id: z.number(), adminUserId: z.number(), adminName: z.string(), action: z.string(), targetType: z.string(), targetId: z.string(), details: z.string(), createdAt: z.string() })),
      total: z.number(), page: z.number(), pageSize: z.number(),
    }),
    async handler(ctx, args) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const all = await db.select().from(schema.adminAuditLog).orderBy(desc(schema.adminAuditLog.createdAt));
      const total = all.length;
      const page = all.slice((args.page - 1) * args.pageSize, args.page * args.pageSize);
      const adminIds = [...new Set(page.map((row) => row.adminUserId))];
      const admins = adminIds.length ? await db.select({ id: schema.authUsers.id, name: schema.authUsers.name }).from(schema.authUsers).where(inArray(schema.authUsers.id, adminIds)) : [];
      const nameById = new Map(admins.map((row) => [row.id, row.name]));
      return {
        entries: page.map((row) => ({
          id: row.id, adminUserId: row.adminUserId, adminName: nameById.get(row.adminUserId) || `User ${row.adminUserId}`,
          action: row.action, targetType: row.targetType, targetId: row.targetId, details: row.details,
          createdAt: row.createdAt.toISOString(),
        })),
        total, page: args.page, pageSize: args.pageSize,
      };
    },
  }),
  // ---------------------------------------------------------------------------
  // Platform support inbox: two-way chat between Crewkat users and Danny.
  // Reports arrive server-side here (the old in-app form wrote to the
  // device's local support_reports table, which no one ever saw). Replies are
  // plain conversation bubbles — deliberately no read receipts; the only
  // unread signal is Danny's inbox badge.
  // ---------------------------------------------------------------------------
  submitPlatformSupportReport: defineAction({
    request: z.object({ kind: z.enum(["support", "problem", "question", "general", "feature"]), subject: z.string().trim().min(1).max(160), message: z.string().trim().min(1).max(5000), language: languageSchema }),
    response: z.object({ id: z.number(), sentAt: z.string() }),
    async handler(ctx, args) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const user = (await db.select({ id: schema.authUsers.id, name: schema.authUsers.name, email: schema.authUsers.email }).from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
      if (!user) throw new Error("Sign in to continue.");
      const now = new Date();
      const made = (await db.insert(schema.platformSupportReports).values({ userId: user.id, userName: user.name, userEmail: user.email, kind: args.kind, subject: args.subject, message: args.message, language: args.language, status: "open", isUnread: true, createdAt: now, updatedAt: now }).returning({ id: schema.platformSupportReports.id }))[0];
      if (!made) throw new Error("The report could not be sent.");
      ctx.invalidateQueries();
      return { id: made.id, sentAt: now.toISOString() };
    },
  }),
  platformSupportInbox: defineAction({
    request: z.object({}),
    response: z.object({
      reports: z.array(z.object({ id: z.number(), userName: z.string(), userEmail: z.string(), kind: z.string(), subject: z.string(), message: z.string(), language: z.string(), status: z.string(), isUnread: z.boolean(), replyCount: z.number(), lastReplyAt: z.string().nullable(), createdAt: z.string(), resolvedAt: z.string().nullable() })),
      unreadCount: z.number(),
    }),
    async handler(ctx) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const reports = await db.select().from(schema.platformSupportReports).orderBy(desc(schema.platformSupportReports.createdAt), desc(schema.platformSupportReports.id));
      const reportIds = reports.map((r) => r.id);
      const replyRows = reportIds.length ? await db.select().from(schema.platformSupportReplies).where(inArray(schema.platformSupportReplies.reportId, reportIds)) : [];
      const countByReport = new Map<number, number>();
      const lastAtByReport = new Map<number, Date>();
      for (const reply of replyRows) {
        countByReport.set(reply.reportId, (countByReport.get(reply.reportId) ?? 0) + 1);
        const prev = lastAtByReport.get(reply.reportId);
        if (!prev || reply.createdAt > prev) lastAtByReport.set(reply.reportId, reply.createdAt);
      }
      return {
        reports: reports.map((r) => ({
          id: r.id, userName: r.userName, userEmail: r.userEmail, kind: r.kind, subject: r.subject, message: r.message,
          language: r.language, status: r.status, isUnread: r.isUnread,
          replyCount: countByReport.get(r.id) ?? 0, lastReplyAt: lastAtByReport.get(r.id)?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null,
        })),
        unreadCount: reports.filter((r) => r.isUnread).length,
      };
    },
  }),
  platformSupportThread: defineAction({
    request: z.object({ reportId: z.number().int().positive() }),
    response: z.object({
      report: z.object({ id: z.number(), userName: z.string(), userEmail: z.string(), kind: z.string(), subject: z.string(), message: z.string(), language: z.string(), status: z.string(), isUnread: z.boolean(), createdAt: z.string(), resolvedAt: z.string().nullable() }),
      replies: z.array(z.object({ id: z.number(), sender: z.string(), message: z.string(), createdAt: z.string() })),
    }),
    async handler(ctx, args) {
      await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const report = (await db.select().from(schema.platformSupportReports).where(eq(schema.platformSupportReports.id, args.reportId)).limit(1))[0];
      if (!report) throw new Error("Report not found.");
      const replies = await db.select().from(schema.platformSupportReplies).where(eq(schema.platformSupportReplies.reportId, report.id)).orderBy(schema.platformSupportReplies.createdAt, schema.platformSupportReplies.id);
      return {
        report: { id: report.id, userName: report.userName, userEmail: report.userEmail, kind: report.kind, subject: report.subject, message: report.message, language: report.language, status: report.status, isUnread: report.isUnread, createdAt: report.createdAt.toISOString(), resolvedAt: report.resolvedAt?.toISOString() ?? null },
        replies: replies.map((r) => ({ id: r.id, sender: r.sender, message: r.message, createdAt: r.createdAt.toISOString() })),
      };
    },
  }),
  replyToSupportReport: defineAction({
    request: z.object({ reportId: z.number().int().positive(), message: z.string().trim().min(1).max(5000) }),
    response: z.object({ id: z.number(), sender: z.string(), message: z.string(), createdAt: z.string() }),
    async handler(ctx, args) {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const report = (await db.select().from(schema.platformSupportReports).where(eq(schema.platformSupportReports.id, args.reportId)).limit(1))[0];
      if (!report) throw new Error("Report not found.");
      const now = new Date();
      const made = (await db.insert(schema.platformSupportReplies).values({ reportId: report.id, sender: "admin", message: args.message, createdAt: now }).returning({ id: schema.platformSupportReplies.id }))[0];
      if (!made) throw new Error("The reply could not be sent.");
      // Danny read the thread by replying — clear the unread flag, stay open.
      await db.update(schema.platformSupportReports).set({ isUnread: false, updatedAt: now }).where(eq(schema.platformSupportReports.id, report.id));
      await logAdminAction(db, admin.id, "support.reply", "platform_support_report", String(report.id), `${report.userName} <${report.userEmail}> — ${report.subject}`);
      ctx.invalidateQueries();
      return { id: made.id, sender: "admin", message: args.message, createdAt: now.toISOString() };
    },
  }),
  updatePlatformSupportReport: defineAction({
    request: z.object({ id: z.number().int().positive(), status: z.enum(["open", "resolved"]), isUnread: z.boolean() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const { admin } = await requirePlatformAdmin(ctx);
      const db = platformDb(ctx);
      const now = new Date();
      const current = (await db.select().from(schema.platformSupportReports).where(eq(schema.platformSupportReports.id, args.id)).limit(1))[0];
      if (!current) throw new Error("Report not found.");
      await db.update(schema.platformSupportReports).set({ status: args.status, isUnread: args.isUnread, resolvedAt: args.status === "resolved" ? now : null, updatedAt: now }).where(eq(schema.platformSupportReports.id, args.id));
      await logAdminAction(db, admin.id, args.status === "resolved" ? "support.resolve" : "support.reopen", "platform_support_report", String(args.id), `${current.userName} <${current.userEmail}> — ${current.subject}`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  userSupportThreads: defineAction({
    request: z.object({}),
    response: z.object({
      threads: z.array(z.object({
        id: z.number(), kind: z.string(), subject: z.string(), message: z.string(), status: z.string(),
        replyCount: z.number(), lastReply: z.object({ sender: z.string(), message: z.string(), createdAt: z.string() }).nullable(),
        createdAt: z.string(), updatedAt: z.string(),
      })),
    }),
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const reports = await db.select().from(schema.platformSupportReports).where(eq(schema.platformSupportReports.userId, identity.workspaceUserId)).orderBy(desc(schema.platformSupportReports.createdAt), desc(schema.platformSupportReports.id));
      const reportIds = reports.map((r) => r.id);
      const replyRows = reportIds.length ? await db.select().from(schema.platformSupportReplies).where(inArray(schema.platformSupportReplies.reportId, reportIds)) : [];
      const byReport = new Map<number, { id: number; sender: string; message: string; createdAt: Date }[]>();
      for (const reply of replyRows) {
        const list = byReport.get(reply.reportId) ?? [];
        list.push({ id: reply.id, sender: reply.sender, message: reply.message, createdAt: reply.createdAt });
        byReport.set(reply.reportId, list);
      }
      return {
        threads: reports.map((r) => {
          const replies = (byReport.get(r.id) ?? []).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          const latest = replies[0] ?? null;
          return {
            id: r.id, kind: r.kind, subject: r.subject, message: r.message, status: r.status,
            replyCount: replies.length,
            lastReply: latest ? { sender: latest.sender, message: latest.message.slice(0, 120), createdAt: latest.createdAt.toISOString() } : null,
            createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
          };
        }),
      };
    },
  }),
  userSupportThread: defineAction({
    request: z.object({ reportId: z.number().int().positive() }),
    response: z.object({
      report: z.object({ id: z.number(), kind: z.string(), subject: z.string(), message: z.string(), status: z.string(), createdAt: z.string() }),
      replies: z.array(z.object({ id: z.number(), sender: z.string(), message: z.string(), createdAt: z.string() })),
    }),
    async handler(ctx, args) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const report = (await db.select().from(schema.platformSupportReports).where(eq(schema.platformSupportReports.id, args.reportId)).limit(1))[0];
      // Ownership check: users can only ever see their own reports.
      if (!report || report.userId !== identity.workspaceUserId) throw new Error("Report not found.");
      const replies = await db.select().from(schema.platformSupportReplies).where(eq(schema.platformSupportReplies.reportId, report.id)).orderBy(schema.platformSupportReplies.createdAt, schema.platformSupportReplies.id);
      return {
        report: { id: report.id, kind: report.kind, subject: report.subject, message: report.message, status: report.status, createdAt: report.createdAt.toISOString() },
        replies: replies.map((r) => ({ id: r.id, sender: r.sender, message: r.message, createdAt: r.createdAt.toISOString() })),
      };
    },
  }),
  replyToOwnSupportReport: defineAction({
    request: z.object({ reportId: z.number().int().positive(), message: z.string().trim().min(1).max(5000) }),
    response: z.object({ id: z.number(), sender: z.string(), message: z.string(), createdAt: z.string() }),
    async handler(ctx, args) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const report = (await db.select().from(schema.platformSupportReports).where(eq(schema.platformSupportReports.id, args.reportId)).limit(1))[0];
      // Ownership check: users can only reply on their own reports.
      if (!report || report.userId !== identity.workspaceUserId) throw new Error("Report not found.");
      const now = new Date();
      const made = (await db.insert(schema.platformSupportReplies).values({ reportId: report.id, sender: "user", message: args.message, createdAt: now }).returning({ id: schema.platformSupportReplies.id }))[0];
      if (!made) throw new Error("The reply could not be sent.");
      // Flag it unread so Danny's inbox badge picks it up.
      await db.update(schema.platformSupportReports).set({ isUnread: true, updatedAt: now }).where(eq(schema.platformSupportReports.id, report.id));
      ctx.invalidateQueries();
      return { id: made.id, sender: "user", message: args.message, createdAt: now.toISOString() };
    },
  }),
  submitSupportReport: defineAction({ request: z.object({ kind: z.enum(["support", "problem", "question", "general", "feature"]), subject: z.string().trim().min(1).max(160), message: z.string().trim().min(1).max(5000), language: languageSchema }), response: z.object({ id: z.number(), sentAt: z.string() }), async handler(ctx, args) { const now = new Date(); const rows = await ctx.db<typeof schema>().insert(schema.supportReports).values({ ...args, status: "open", isUnread: true, createdAt: now, updatedAt: now }).returning({ id: schema.supportReports.id }); const made = rows[0]; if (!made) throw new Error("The report could not be saved."); ctx.invalidateQueries(); return { id: made.id, sentAt: now.toISOString() }; }}),

  getSettings: defineAction({ request: z.object({}), response: settingsSchema, async handler(ctx) { const rows = await ctx.db<typeof schema>().select().from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1); const row = rows[0]; if (!row) return { companyName: "", licenseNumber: "", phone: "", email: "", website: "", address: "", profileDescription: "", serviceArea: "", facebookUrl: "", instagramUrl: "", youtubeUrl: "", reviewUrl: "", paymentInstructions: "", quoteFollowUpDays: 3, offersFreeEstimates: true, socialWatermark: true, language: "en" as const, accentColor: "#1f5a4a", themeMode: "system" as const, uiAccent: "orange" as const, defaultQuoteTheme: "classic" as const, defaultDocumentFont: "helvetica" as const, defaultShowTaxLine: true, defaultShowDiscountLine: true, defaultShowPaidLine: true, defaultShowPaymentTerms: true, defaultShowFooterNotes: true, defaultShowLogo: true, defaultShowCompanyInfo: true, defaultCustomizeJson: "{}", defaultFootnote: "", warrantyTerms: "", hourlyCostRate: "0", lateFeeType: "percent" as const, lateFeeValue: "0", lateFeeGraceDays: 0, costAlertPercent: 80, paymentRemindersEnabled: true, onlineSignatureEnabled: true, overdueInvoiceRemindersEnabled: true, overdueReminderDays: 3, invoiceGroupBy: "creation_date" as const, addShippingAddress: false, addJobSiteAddress: true, convertToQuote: false, notificationsEnabled: true, notifyNewMessage: true, notifyDocSigned: true, notifyInvoiceViewed: true, notifyEstimateViewed: true, reviewRequestsEnabled: true, reviewRequestDelayDays: 3, weeklyProgressEnabled: true, simpleMode: true, logoUrl: null, coverUrl: null }; return { companyName: row.companyName, licenseNumber: row.licenseNumber, phone: row.phone, email: row.email, website: row.website, address: row.address, profileDescription: row.profileDescription, serviceArea: row.serviceArea, facebookUrl: row.facebookUrl, instagramUrl: row.instagramUrl, youtubeUrl: row.youtubeUrl, reviewUrl: row.reviewUrl, paymentInstructions: row.paymentInstructions, quoteFollowUpDays: row.quoteFollowUpDays, offersFreeEstimates: row.offersFreeEstimates, socialWatermark: row.socialWatermark, language: row.language, accentColor: row.accentColor, themeMode: row.themeMode, uiAccent: row.uiAccent, defaultQuoteTheme: row.defaultQuoteTheme, defaultDocumentFont: row.defaultDocumentFont, defaultShowTaxLine: row.defaultShowTaxLine, defaultShowDiscountLine: row.defaultShowDiscountLine, defaultShowPaidLine: row.defaultShowPaidLine, defaultShowPaymentTerms: row.defaultShowPaymentTerms, defaultShowFooterNotes: row.defaultShowFooterNotes, defaultShowLogo: row.defaultShowLogo, defaultShowCompanyInfo: row.defaultShowCompanyInfo, defaultCustomizeJson: row.defaultCustomizeJson, defaultFootnote: row.defaultFootnote, warrantyTerms: row.warrantyTerms, hourlyCostRate: row.hourlyCostRate, lateFeeType: row.lateFeeType, lateFeeValue: row.lateFeeValue, lateFeeGraceDays: row.lateFeeGraceDays, costAlertPercent: row.costAlertPercent, paymentRemindersEnabled: row.paymentRemindersEnabled, onlineSignatureEnabled: row.onlineSignatureEnabled, overdueInvoiceRemindersEnabled: row.overdueInvoiceRemindersEnabled, overdueReminderDays: row.overdueReminderDays, invoiceGroupBy: row.invoiceGroupBy, addShippingAddress: row.addShippingAddress, addJobSiteAddress: row.addJobSiteAddress, convertToQuote: row.convertToQuote, notificationsEnabled: row.notificationsEnabled, notifyNewMessage: row.notifyNewMessage, notifyDocSigned: row.notifyDocSigned, notifyInvoiceViewed: row.notifyInvoiceViewed, notifyEstimateViewed: row.notifyEstimateViewed, reviewRequestsEnabled: row.reviewRequestsEnabled, reviewRequestDelayDays: row.reviewRequestDelayDays, weeklyProgressEnabled: row.weeklyProgressEnabled, simpleMode: row.simpleMode, logoUrl: row.logoBlobKey ? await ctx.blobs.getUrl(row.logoBlobKey) : null, coverUrl: row.coverBlobKey ? await ctx.blobs.getUrl(row.coverBlobKey) : null }; }}),
  updateSettings: defineAction({ request: settingsInputSchema, response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = platformDb(ctx); const rows = await db.select({ id: schema.settings.id }).from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1); if (rows[0]) await db.update(schema.settings).set({ ...args, hourlyCostRate: normalizeMoney(args.hourlyCostRate, "0.00"), lateFeeValue: normalizeMoney(args.lateFeeValue, "0.00"), updatedAt: new Date() }).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)); else await db.insert(schema.settings).values({ ...args, hourlyCostRate: normalizeMoney(args.hourlyCostRate, "0.00"), lateFeeValue: normalizeMoney(args.lateFeeValue, "0.00"), updatedAt: new Date() }); ctx.invalidateQueries(); return { ok: true }; }}),
  updateAppearance: defineAction({ request: z.object({ themeMode: z.enum(["light", "dark", "system"]), uiAccent: z.enum(["orange", "blue", "green", "purple", "red"]) }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const companyId = workspaceIdentity(ctx).workspaceCompanyId; const db = platformDb(ctx); const rows = await db.select({ id: schema.settings.id }).from(schema.settings).where(eq(schema.settings.companyId, companyId)).limit(1); if (rows[0]) await db.update(schema.settings).set({ themeMode: args.themeMode, uiAccent: args.uiAccent, updatedAt: new Date() }).where(eq(schema.settings.companyId, companyId)); else await db.insert(schema.settings).values({ companyId, companyName: "", themeMode: args.themeMode, uiAccent: args.uiAccent, updatedAt: new Date() }); ctx.invalidateQueries(); return { ok: true }; }}),
  uploadLogo: defineAction({ request: z.object({ filename: z.string().min(1).max(240), contentType: z.enum(["image/jpeg", "image/png"]), dataBase64: z.string().min(1).max(10_000_000) }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = platformDb(ctx); const rows = await db.select().from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1); const old = rows[0]; const key = `branding/${crypto.randomUUID()}-${args.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`; await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType }); if (old) await db.update(schema.settings).set({ logoBlobKey: key, updatedAt: new Date() }).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)); else await db.insert(schema.settings).values({ companyName: "", logoBlobKey: key, updatedAt: new Date() }); if (old?.logoBlobKey) await ctx.blobs.delete(old.logoBlobKey); ctx.invalidateQueries(); return { ok: true }; }}),
  uploadCompanyCover: defineAction({ request: z.object({ filename: z.string().min(1).max(240), contentType: z.enum(["image/jpeg", "image/png"]), dataBase64: z.string().min(1).max(14_000_000) }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = platformDb(ctx); const rows = await db.select().from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1); const old = rows[0]; const key = `branding/covers/${crypto.randomUUID()}-${args.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`; await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType }); if (old) await db.update(schema.settings).set({ coverBlobKey: key, updatedAt: new Date() }).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)); else await db.insert(schema.settings).values({ companyName: "", coverBlobKey: key, updatedAt: new Date() }); if (old?.coverBlobKey) await ctx.blobs.delete(old.coverBlobKey); ctx.invalidateQueries(); return { ok: true }; }}),
  // ---------------------------------------------------------------------------
  // Pinned tools on the Home screen (per-user, auth-gated).
  // ---------------------------------------------------------------------------
  pinTool: defineAction({
    request: z.object({ toolId: z.string().trim().min(1).max(80) }),
    response: z.object({ ok: z.literal(true), toolId: z.string(), position: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; toolId: string; position: number }> {
      const identity = workspaceIdentity(ctx);
      const entry = TOOL_REGISTRY[args.toolId];
      if (!entry) throw new Error("That tool cannot be pinned.");
      const db = ctx.db<typeof schema>();
      const existing = (await db.select({ position: schema.userHomePins.position }).from(schema.userHomePins).where(and(eq(schema.userHomePins.userId, identity.workspaceUserId), eq(schema.userHomePins.toolId, args.toolId))).limit(1))[0];
      if (existing) return { ok: true, toolId: args.toolId, position: existing.position };
      const maxRow = (await db.select({ maxPosition: sql<number | null>`max(${schema.userHomePins.position})` }).from(schema.userHomePins).where(eq(schema.userHomePins.userId, identity.workspaceUserId)))[0];
      const position = (maxRow?.maxPosition ?? -1) + 1;
      await db.insert(schema.userHomePins).values({ userId: identity.workspaceUserId, toolId: args.toolId, position });
      ctx.invalidateQueries();
      return { ok: true, toolId: args.toolId, position };
    },
  }),
  unpinTool: defineAction({
    request: z.object({ toolId: z.string().trim().min(1).max(80) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      await db.delete(schema.userHomePins).where(and(eq(schema.userHomePins.userId, identity.workspaceUserId), eq(schema.userHomePins.toolId, args.toolId)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  listPinnedTools: defineAction({
    request: z.object({}),
    response: z.object({ tools: z.array(z.object({ toolId: z.string(), position: z.number(), screen: z.string(), tab: z.string().nullable(), titleEn: z.string(), titleEs: z.string(), iconPath: z.string() })) }),
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.userHomePins).where(eq(schema.userHomePins.userId, identity.workspaceUserId)).orderBy(schema.userHomePins.position, schema.userHomePins.id);
      const tools = [];
      for (const row of rows) {
        const entry = TOOL_REGISTRY[row.toolId];
        if (!entry) continue;
        tools.push({ toolId: row.toolId, position: row.position, screen: entry.screen, tab: entry.tab, titleEn: entry.titleEn, titleEs: entry.titleEs, iconPath: entry.iconPath });
      }
      return { tools };
    },
  }),
  // -------------------------------------------------------------------------
  // Phase 2: per-job client messaging. A thread lives on the job; the
  // contractor writes from the job workspace Messages tab, the client replies
  // from their portal link (token-scoped, no login). System rows are written
  // by the server on lifecycle events (job created/completed, estimate sent).
  // -------------------------------------------------------------------------
  listJobMessages: defineAction({ request: z.object({ jobId: z.number().int().positive() }), response: z.object({ messages: z.array(z.object({ id: z.number(), jobId: z.number(), sender: z.enum(["contractor", "client", "system"]), body: z.string(), imageUrl: z.string().nullable(), voiceUrl: z.string().nullable(), voiceDurationSeconds: z.number(), createdAt: z.string() })) }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const { job } = await requireJobCompany(ctx, db, args.jobId); const rows = await db.select().from(schema.jobMessages).where(eq(schema.jobMessages.jobId, job.id)).orderBy(schema.jobMessages.createdAt, schema.jobMessages.id); return { messages: await Promise.all(rows.map((m) => jobMessageShape(ctx, m))) }; } }),
  sendJobMessage: defineAction({ request: z.object({ jobId: z.number().int().positive(), body: z.string().trim().max(4000).default(""), imageDataBase64: z.string().max(15_000_000).default(""), imageFilename: z.string().max(240).default(""), imageContentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).default("image/jpeg"), voiceDataBase64: z.string().max(20_000_000).default(""), voiceFilename: z.string().max(240).default(""), voiceDurationSeconds: z.number().int().min(0).max(600).default(0) }), response: z.object({ id: z.number() }), async handler(ctx, args) { if (!args.body && !args.imageDataBase64 && !args.voiceDataBase64) throw new Error("Write a message or attach a photo or voice note."); const db = ctx.db<typeof schema>(); const { job } = await requireJobCompany(ctx, db, args.jobId); let imageBlobKey: string | null = null; if (args.imageDataBase64) { imageBlobKey = `job-messages/${job.id}/${crypto.randomUUID()}`; await ctx.blobs.put(imageBlobKey, Buffer.from(args.imageDataBase64, "base64"), { contentType: args.imageContentType }); } let voiceBlobKey: string | null = null; if (args.voiceDataBase64) { voiceBlobKey = `job-messages/${job.id}/${crypto.randomUUID()}.webm`; await ctx.blobs.put(voiceBlobKey, Buffer.from(args.voiceDataBase64, "base64"), { contentType: "audio/webm" }); } const made = (await db.insert(schema.jobMessages).values({ jobId: job.id, sender: "contractor", body: args.body, imageBlobKey, imageFilename: args.imageFilename, imageContentType: args.imageContentType, voiceBlobKey, voiceFilename: args.voiceFilename, voiceContentType: "audio/webm", voiceDurationSeconds: args.voiceDurationSeconds, createdAt: new Date() }).returning({ id: schema.jobMessages.id }))[0]; if (!made) { if (imageBlobKey) await ctx.blobs.delete(imageBlobKey).catch(() => {}); if (voiceBlobKey) await ctx.blobs.delete(voiceBlobKey).catch(() => {}); throw new Error("The message could not be sent."); } ctx.invalidateQueries(); return { id: made.id }; } }),
  portalListJobMessages: defineAction({ request: z.object({ token: z.string().min(32).max(200) }), response: z.object({ messages: z.array(z.object({ id: z.number(), jobId: z.number(), sender: z.enum(["contractor", "client", "system"]), body: z.string(), imageUrl: z.string().nullable(), voiceUrl: z.string().nullable(), voiceDurationSeconds: z.number(), createdAt: z.string() })) }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const access = await requirePortalAccess(ctx, args.token, { logView: false }); const rows = await db.select().from(schema.jobMessages).where(eq(schema.jobMessages.jobId, access.jobId)).orderBy(schema.jobMessages.createdAt, schema.jobMessages.id); return { messages: await Promise.all(rows.map((m) => jobMessageShape(ctx, m))) }; } }),
  portalSendJobMessage: defineAction({ request: z.object({ token: z.string().min(32).max(200), body: z.string().trim().max(4000).default(""), imageDataBase64: z.string().max(15_000_000).default(""), imageFilename: z.string().max(240).default(""), imageContentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).default("image/jpeg") }), response: z.object({ id: z.number() }), async handler(ctx, args) {
    if (!args.body && !args.imageDataBase64) throw new Error("Write a message or attach a photo.");
    const db = ctx.db<typeof schema>();
    const access = await requirePortalAccess(ctx, args.token, { logView: false });
    let imageBlobKey: string | null = null;
    if (args.imageDataBase64) { imageBlobKey = `job-messages/${access.jobId}/${crypto.randomUUID()}`; await ctx.blobs.put(imageBlobKey, Buffer.from(args.imageDataBase64, "base64"), { contentType: args.imageContentType }); }
    const made = (await db.insert(schema.jobMessages).values({ jobId: access.jobId, sender: "client", body: args.body, imageBlobKey, imageFilename: args.imageFilename, imageContentType: args.imageContentType, createdAt: new Date() }).returning({ id: schema.jobMessages.id }))[0];
    if (!made) { if (imageBlobKey) await ctx.blobs.delete(imageBlobKey).catch(() => {}); throw new Error("The message could not be sent."); }
    const job = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, access.jobId)).limit(1))[0];
    if (job) await notifyCompanyEvent(ctx, job.companyId, "notifyNewMessage", "message", `New client message on ${job.jobType}`, `Nuevo mensaje del cliente en ${job.jobType}`, `job:${job.id}:messages`);
    ctx.invalidateQueries(); return { id: made.id };
  } }),
  // -------------------------------------------------------------------------
  // Phase 2: Marketplace Bid Board — Interested → Estimating → Submitted →
  // Won/Lost pipeline for marketplace leads, with due dates and reminders.
  // -------------------------------------------------------------------------
  listBidBoard: defineAction({ request: z.object({}), response: z.object({ items: z.array(z.object({ id: z.number(), title: z.string(), stage: bidBoardStageSchema, dueDate: z.string(), remindAt: z.string().nullable(), notes: z.string(), listingId: z.number().nullable(), requestId: z.number().nullable(), createdAt: z.string(), updatedAt: z.string() })) }), async handler(ctx) { const identity = workspaceIdentity(ctx); const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.bidBoardItems).where(eq(schema.bidBoardItems.userId, identity.workspaceUserId)).orderBy(desc(schema.bidBoardItems.updatedAt)); return { items: rows.map((r) => ({ id: r.id, title: r.title, stage: r.stage, dueDate: r.dueDate, remindAt: r.remindAt ? r.remindAt.toISOString() : null, notes: r.notes, listingId: r.listingId, requestId: r.requestId, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })) }; } }),
  saveBidBoardItem: defineAction({ request: z.object({ id: z.number().int().positive().nullable().default(null), title: z.string().trim().min(1).max(200), listingId: z.number().int().positive().nullable().default(null), requestId: z.number().int().positive().nullable().default(null), stage: bidBoardStageSchema.default("interested"), dueDate: z.string().trim().max(10).default(""), remindAt: z.string().datetime().nullable().default(null), notes: z.string().trim().max(3000).default("") }), response: z.object({ id: z.number() }), async handler(ctx, args) { const identity = workspaceIdentity(ctx); const db = ctx.db<typeof schema>(); const now = new Date(); if (args.id) { const existing = (await db.select().from(schema.bidBoardItems).where(eq(schema.bidBoardItems.id, args.id)).limit(1))[0]; if (!existing || existing.userId !== identity.workspaceUserId) throw new Error("Bid not found."); await db.update(schema.bidBoardItems).set({ title: args.title, listingId: args.listingId, requestId: args.requestId, stage: args.stage, dueDate: args.dueDate, remindAt: args.remindAt ? new Date(args.remindAt) : null, notes: args.notes, updatedAt: now }).where(eq(schema.bidBoardItems.id, args.id)); ctx.invalidateQueries(); return { id: args.id }; } const made = (await db.insert(schema.bidBoardItems).values({ companyId: identity.workspaceCompanyId, userId: identity.workspaceUserId, title: args.title, listingId: args.listingId, requestId: args.requestId, stage: args.stage, dueDate: args.dueDate, remindAt: args.remindAt ? new Date(args.remindAt) : null, notes: args.notes, createdAt: now, updatedAt: now }).returning({ id: schema.bidBoardItems.id }))[0]; if (!made) throw new Error("The bid could not be saved."); ctx.invalidateQueries(); return { id: made.id }; } }),
  moveBidBoardItem: defineAction({ request: z.object({ id: z.number().int().positive(), stage: bidBoardStageSchema }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const identity = workspaceIdentity(ctx); const db = ctx.db<typeof schema>(); const existing = (await db.select().from(schema.bidBoardItems).where(eq(schema.bidBoardItems.id, args.id)).limit(1))[0]; if (!existing || existing.userId !== identity.workspaceUserId) throw new Error("Bid not found."); await db.update(schema.bidBoardItems).set({ stage: args.stage, updatedAt: new Date() }).where(eq(schema.bidBoardItems.id, args.id)); ctx.invalidateQueries(); return { ok: true }; } }),
  deleteBidBoardItem: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const identity = workspaceIdentity(ctx); const db = ctx.db<typeof schema>(); const existing = (await db.select().from(schema.bidBoardItems).where(eq(schema.bidBoardItems.id, args.id)).limit(1))[0]; if (!existing || existing.userId !== identity.workspaceUserId) throw new Error("Bid not found."); await db.delete(schema.bidBoardItems).where(eq(schema.bidBoardItems.id, args.id)); ctx.invalidateQueries(); return { ok: true }; } }),
} satisfies ActionsModule;

const PUBLIC_ACTIONS = new Set([
  "getAuthBootstrap", "signUp", "verifyEmail", "resendVerification", "login", "refreshSession", "logout", "getAuthSession", "requestPasswordReset", "resetPassword", "handleStripeWebhook",
  "getPortalData", "portalUpdateSelection", "portalSignChangeOrder", "resolveDocumentLink", "submitDocumentSignature", "submitEstimateRequest", "portalListJobMessages", "portalSendJobMessage",
]);

const PREMIUM_ACTIONS = new Set([
  "getAutomationCenter", "logAutomationSend", "updateQuoteAutomationStatus", "updateSelectionLeadTime", "renewQuote", "getGrowthToolkit", "savePriceBookItem", "deletePriceBookItem", "saveQuoteTemplate", "deleteQuoteTemplate", "saveMileageTrip", "deleteMileageTrip", "saveBusinessExpense", "deleteBusinessExpense", "listSubcontractors", "saveSubcontractor", "deleteSubcontractor", "saveShareImage", "deleteShareImage", "listShareImages", "getWeatherOutlook", "getExpansionSuite", "saveWarranty", "saveSupplier", "saveMaintenancePlan", "completeMaintenancePlan", "saveSlideshowVideo", "getTaxExport", "getDocumentParameters", "getAdminConsole", "updateSupportReport", "addAppUser", "updateAppUser", "updateAdminParameters", "createPortalLink", "revokePortalLink", "getPortalLinkInfo", "rotatePortalLink", "createDocumentLink", "getDocumentLinkInfo", "revokeDocumentLink", "updateJobSiteLocation", "suggestJobsByLocation", "updateQuoteVersion", "createQuoteVersion", "sendQuoteVersion", "acceptQuoteVersion", "getQuoteVersions", "listMaterialCosts", "saveMaterialCost", "deleteMaterialCost", "getFieldIntelligence", "saveSupplierQuote", "createPurchaseOrder", "updatePurchaseOrderStatus", "receivePurchaseOrder", "saveEquipment", "setEquipmentCheckout", "completeEquipmentMaintenance", "deleteFieldTestRecord", "exportBackup", "restoreBackup", "verifyBackupRoundTrip"
]);

function protectActions<T extends ActionsModule>(actions: T): T {
  const entries = Object.entries(actions).map(([name, action]) => {
    if (PUBLIC_ACTIONS.has(name)) return [name, action] as const;
    const original = action.handler as (ctx: Ctx, args: unknown) => Promise<unknown>;
    const protectedAction: ActionDefinition = {
      ...action,
      request: action.request.and(authEnvelopeSchema),
      handler: async (ctx: Ctx, args: unknown) => {
        const envelope = authEnvelopeSchema.parse(args);
        const user = await requireSession(ctx, envelope._sessionToken);
        if (PREMIUM_ACTIONS.has(name) && user.tier !== "premium") throw new Error("Premium required. Upgrade to unlock this Pro tool.");
        return original(withWorkspace(ctx, user), args);
      },
    };
    return [name, protectedAction] as const;
  });
  return Object.fromEntries(entries) as T;
}

export const Actions = protectActions(BaseActions);
