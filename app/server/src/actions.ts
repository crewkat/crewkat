import { defineAction, z, type ActionDefinition, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, desc, eq, gte, isNull, like, or, sql } from "drizzle-orm";
import { gzipSync, gunzipSync, strFromU8, strToU8 } from "fflate";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import * as schema from "./schema";
import { authCodeClientResult } from "./auth-email";
import { privileged } from "@space/privileged";

const stageSchema = z.enum(["before", "during", "after"]);
const languageSchema = z.enum(["en", "es"]);
const quoteThemeSchema = z.enum(["classic", "modern", "bold", "minimal"]);
const documentFontSchema = z.enum(["helvetica", "times", "courier", "palatino"]);
const adjustmentTypeSchema = z.enum(["percent", "fixed"]);
const invoiceStatusSchema = z.enum(["draft", "sent", "paid", "overdue"]);
const documentKindSchema = z.enum(["invoice", "quote", "contract", "change_order"]);
const clientSchema = z.object({ id: z.number(), name: z.string(), phone: z.string(), email: z.string(), address: z.string(), notes: z.string(), referredByClientId: z.number().nullable(), referredByName: z.string().nullable(), referralCount: z.number(), jobCount: z.number(), quoteCount: z.number(), totalInvoiced: z.number(), totalPaid: z.number(), paymentPercent: z.number(), createdAt: z.string(), updatedAt: z.string() });
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
const documentVisibilitySchema = z.object({ showTaxLine: z.boolean(), showDiscountLine: z.boolean(), showPaidLine: z.boolean(), showPaymentTerms: z.boolean(), showFooterNotes: z.boolean(), showLogo: z.boolean(), showCompanyInfo: z.boolean() });
const financialFieldsSchema = z.object({ subtotal: z.string(), discountType: adjustmentTypeSchema, discountValue: z.string(), taxType: adjustmentTypeSchema, taxValue: z.string(), total: z.string(), footnote: z.string(), theme: quoteThemeSchema, font: documentFontSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).extend(documentVisibilitySchema.shape);
const quoteSchema = z.object({ id: z.number(), clientId: z.number().nullable(), clientName: z.string(), clientPhone: z.string(), clientEmail: z.string(), jobAddress: z.string(), shippingAddress: z.string(), jobType: z.string(), lineItems: z.array(quoteItemSchema), expiryDate: z.string(), sentAt: z.string(), automationStatus: z.enum(["awaiting", "won", "lost"]), lostReason: z.enum(["price", "timing", "competitor", "no_response", "other"]).nullable(), lostNote: z.string(), jobId: z.number().nullable(), seriesId: z.number(), parentQuoteId: z.number().nullable(), versionNumber: z.number(), superseded: z.boolean(), accepted: z.boolean(), createdAt: z.string(), updatedAt: z.string() }).extend(financialFieldsSchema.shape);
const paymentSchema = z.object({ id: z.number(), invoiceId: z.number(), amount: z.string(), paymentDate: z.string(), method: z.string(), note: z.string(), createdAt: z.string() });
const invoiceSchema = z.object({ id: z.number(), quoteId: z.number().nullable(), jobId: z.number().nullable(), clientId: z.number().nullable(), clientName: z.string(), clientPhone: z.string(), clientEmail: z.string(), jobAddress: z.string(), shippingAddress: z.string(), jobType: z.string(), lineItems: z.array(quoteItemSchema), issueDate: z.string(), dueDate: z.string(), status: invoiceStatusSchema, recurringFrequency: z.enum(["none", "daily", "weekly", "monthly", "quarterly"]), nextDueDate: z.string(), seriesId: z.number(), parentInvoiceId: z.number().nullable(), recurringEndDate: z.string(), recurringCancelled: z.boolean(), paidToDate: z.string(), balanceRemaining: z.string(), lateFeeAccrued: z.string(), totalWithLateFee: z.string(), payments: z.array(paymentSchema), createdAt: z.string(), updatedAt: z.string() }).extend(financialFieldsSchema.shape);
const timeEntrySchema = z.object({ id: z.number(), jobId: z.number(), crewMember: z.string(), startedAt: z.string(), endedAt: z.string().nullable(), note: z.string(), durationSeconds: z.number() });
const receiptSchema = z.object({ id: z.number(), jobId: z.number(), vendor: z.string(), amount: z.string(), purchaseDate: z.string(), note: z.string(), filename: z.string(), url: z.string(), createdAt: z.string() });
const crewTaskSchema = z.object({ id: z.number(), jobId: z.number(), text: z.string(), completed: z.boolean(), createdAt: z.string(), updatedAt: z.string() });
const voiceNoteSchema = z.object({ id: z.number(), jobId: z.number(), title: z.string(), url: z.string(), durationSeconds: z.number(), createdAt: z.string() });
const certificateSchema = z.object({ id: z.number(), jobId: z.number(), completionDate: z.string(), warrantyTerms: z.string(), createdAt: z.string(), updatedAt: z.string() });
const settingsInputSchema = z.object({ companyName: z.string().trim().max(180), licenseNumber: z.string().trim().max(80), phone: z.string().trim().max(80), email: z.string().trim().email().max(200).or(z.literal("")), website: z.string().trim().max(300), address: z.string().trim().max(500), profileDescription: z.string().trim().max(3000), serviceArea: z.string().trim().max(500), facebookUrl: z.string().trim().max(600), instagramUrl: z.string().trim().max(600), youtubeUrl: z.string().trim().max(600), reviewUrl: z.string().trim().max(600), paymentInstructions: z.string().trim().max(1500), quoteFollowUpDays: z.number().int().min(1).max(60), offersFreeEstimates: z.boolean(), socialWatermark: z.boolean(), language: languageSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), defaultQuoteTheme: quoteThemeSchema, defaultDocumentFont: documentFontSchema, defaultShowTaxLine: z.boolean(), defaultShowDiscountLine: z.boolean(), defaultShowPaidLine: z.boolean(), defaultShowPaymentTerms: z.boolean(), defaultShowFooterNotes: z.boolean(), defaultShowLogo: z.boolean(), defaultShowCompanyInfo: z.boolean(), defaultFootnote: z.string().trim().max(3000), warrantyTerms: z.string().trim().max(5000), hourlyCostRate: z.string().trim().max(80), lateFeeType: z.enum(["flat","percent"]), lateFeeValue: z.string().trim().max(80), lateFeeGraceDays: z.number().int().min(0).max(365), costAlertPercent: z.number().int().min(50).max(100), paymentRemindersEnabled: z.boolean(), onlineSignatureEnabled: z.boolean(), overdueInvoiceRemindersEnabled: z.boolean(), overdueReminderDays: z.number().int().min(1).max(90), invoiceGroupBy: z.enum(["creation_date", "due_date", "client"]), addShippingAddress: z.boolean(), addJobSiteAddress: z.boolean(), convertToQuote: z.boolean(), notificationsEnabled: z.boolean(), simpleMode: z.boolean() });
const settingsSchema = settingsInputSchema.extend({ logoUrl: z.string().nullable(), coverUrl: z.string().nullable() });
const clientInputSchema = z.object({ name: z.string().trim().min(1).max(160), phone: z.string().trim().max(80), email: z.string().trim().email().max(200).or(z.literal("")), address: z.string().trim().max(240), notes: z.string().trim().max(2000), referredByClientId: z.number().int().positive().nullable().default(null) });
const leadStageSchema = z.enum(["new", "contacted", "quoted", "won", "lost"]);
const appointmentSchema = z.object({ id: z.number(), jobId: z.number().nullable(), clientId: z.number().nullable(), clientName: z.string(), clientPhone: z.string(), startsAt: z.string(), notes: z.string(), exteriorWork: z.boolean() });
const priceBookSchema = z.object({ id: z.number(), name: z.string(), description: z.string(), unitPrice: z.string(), createdAt: z.string() });
const templateSchema = z.object({ id: z.number(), name: z.string(), lineItems: z.array(quoteItemSchema), isStarter: z.boolean(), createdAt: z.string() });
const mileageSchema = z.object({ id: z.number(), tripDate: z.string(), fromLocation: z.string(), toLocation: z.string(), miles: z.string(), jobId: z.number().nullable(), jobName: z.string().nullable(), purpose: z.string(), createdAt: z.string() });
const expenseSchema = z.object({ id: z.number(), expenseDate: z.string(), vendor: z.string(), amount: z.string(), category: z.string(), jobId: z.number().nullable(), jobName: z.string().nullable(), supplierId: z.number().nullable(), note: z.string(), createdAt: z.string() });
const subcontractorSchema = z.object({ id: z.number(), jobId: z.number(), name: z.string(), trade: z.string(), phone: z.string(), agreedAmount: z.string(), paidToDate: z.string(), balance: z.number(), createdAt: z.string() });
const shareImageSchema = z.object({ id: z.number(), jobId: z.number(), beforePhotoId: z.number(), afterPhotoId: z.number(), branded: z.boolean(), filename: z.string(), url: z.string(), createdAt: z.string() });
const leadSchema = z.object({ id: z.number(), name: z.string(), phone: z.string(), email: z.string(), address: z.string(), serviceType: z.string(), preferredContactTime: z.string(), source: z.string(), notes: z.string(), stage: leadStageSchema, projectSize: z.enum(["small","medium","large"]), engagement: z.enum(["slow","normal","fast"]), score: z.number(), clientId: z.number().nullable(), quoteId: z.number().nullable(), createdAt: z.string() });
const selectionSchema = z.object({ id: z.number(), jobId: z.number(), category: z.string(), item: z.string(), vendor: z.string(), photoUrl: z.string().nullable(), approvalStatus: z.enum(["pending", "approved", "rejected"]), leadTimeDays: z.number(), createdAt: z.string() });
const dailyLogSchema = z.object({ id: z.number(), jobId: z.number(), logDate: z.string(), crew: z.string(), hours: z.string(), photoIds: z.array(z.number()), notes: z.string(), createdAt: z.string() });
const internalNoteSchema = z.object({ id: z.number(), jobId: z.number().nullable(), clientId: z.number().nullable(), note: z.string(), reminderDate: z.string(), completed: z.boolean(), createdAt: z.string() });
const milestoneSchema = z.object({ id: z.number(), jobId: z.number(), invoiceId: z.number().nullable(), label: z.string(), amount: z.string(), percentage: z.string(), dueDate: z.string(), status: z.enum(["pending", "paid"]), createdAt: z.string() });
const marketplaceCategorySchema = z.enum(["kitchens", "bathrooms", "plumbing", "electrical", "hvac", "roofing", "tile_flooring", "painting", "concrete", "landscaping", "handyman", "equipment", "materials", "other"]);
const marketplacePhotoSchema = z.object({ id: z.number(), url: z.string(), filename: z.string() });
const marketplaceListingSchema = z.object({ id: z.number(), title: z.string(), category: marketplaceCategorySchema, listingType: z.enum(["job", "project"]), employmentType: z.enum(["full_time", "part_time", "temporary"]), payUnit: z.enum(["hourly", "salary"]), priceKind: z.enum(["amount", "free", "contact"]), price: z.string(), originalPrice: z.string(), description: z.string(), serviceArea: z.string(), companyName: z.string(), companyPhone: z.string(), bookable: z.boolean(), dailyRate: z.string(), promoted: z.boolean(), isMine: z.boolean(), photos: z.array(marketplacePhotoSchema), justListed: z.boolean(), createdAt: z.string(), updatedAt: z.string() });
const marketplaceRequestSchema = z.object({ id: z.number(), title: z.string(), category: marketplaceCategorySchema, listingType: z.enum(["job", "project"]), description: z.string(), serviceArea: z.string(), neededBy: z.string(), companyName: z.string(), companyPhone: z.string(), createdAt: z.string(), updatedAt: z.string() });
const marketplaceMessageSchema = z.object({ id: z.number(), listingId: z.number(), body: z.string(), imageUrl: z.string().nullable(), imageFilename: z.string(), sender: z.enum(["me", "other"]), isRead: z.boolean(), createdAt: z.string() });
const marketplaceInboxRowSchema = z.object({ listingId: z.number(), listingTitle: z.string(), companyName: z.string(), lastMessage: z.string(), lastMessageAt: z.string(), unreadCount: z.number() });
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
function normalizeLineItems(items: Array<{ description: string; amount: string }>) {
  return items.map((item) => ({ ...item, amount: normalizeMoney(item.amount) }));
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
function quoteShape(q: typeof schema.quotes.$inferSelect) { return { id: q.id, clientId: q.clientId, clientName: q.clientName, clientPhone: q.clientPhone, clientEmail: q.clientEmail, jobAddress: q.jobAddress, shippingAddress: q.shippingAddress, jobType: q.jobType, lineItems: JSON.parse(q.lineItemsJson) as Array<{ description: string; amount: string }>, subtotal: q.subtotal, discountType: q.discountType, discountValue: q.discountValue, taxType: q.taxType, taxValue: q.taxValue, total: q.total, footnote: q.footnote, expiryDate: q.expiryDate, sentAt: q.sentAt, automationStatus: q.automationStatus, lostReason: q.lostReason, lostNote: q.lostNote, theme: q.theme, font: q.font, accentColor: q.accentColor, showTaxLine: q.showTaxLine, showDiscountLine: q.showDiscountLine, showPaidLine: q.showPaidLine, showPaymentTerms: q.showPaymentTerms, showFooterNotes: q.showFooterNotes, showLogo: q.showLogo, showCompanyInfo: q.showCompanyInfo, jobId: q.jobId, seriesId: q.seriesId ?? q.id, parentQuoteId: q.parentQuoteId, versionNumber: q.versionNumber, superseded: q.superseded, accepted: q.accepted, createdAt: q.createdAt.toISOString(), updatedAt: q.updatedAt.toISOString() }; }
function invoiceShape(row: typeof schema.invoices.$inferSelect, paymentRows: Array<typeof schema.payments.$inferSelect> = [], fee: {type:"flat"|"percent";value:number;graceDays:number} = {type:"flat",value:0,graceDays:0}) { const paid = paymentRows.reduce((sum, p) => sum + Number(p.amount.replace(/[^0-9.-]/g, "") || 0), 0); const total = Number(row.total.replace(/[^0-9.-]/g, "") || 0); const due=row.dueDate?new Date(`${row.dueDate}T12:00:00`).getTime():0; const daysLate=due?Math.floor((Date.now()-due)/86400000)-fee.graceDays:0; const monthsLate=Math.max(0,Math.ceil(daysLate/30)); const lateFee=row.status!=="paid"&&monthsLate>0?(fee.type==="percent"?total*fee.value/100*monthsLate:fee.value):0; return { id: row.id, quoteId: row.quoteId, jobId: row.jobId, clientId: row.clientId, clientName: row.clientName, clientPhone: row.clientPhone, clientEmail: row.clientEmail, jobAddress: row.jobAddress, shippingAddress: row.shippingAddress, jobType: row.jobType, lineItems: JSON.parse(row.lineItemsJson) as Array<{ description: string; amount: string }>, subtotal: row.subtotal, discountType: row.discountType, discountValue: row.discountValue, taxType: row.taxType, taxValue: row.taxValue, total: row.total, footnote: row.footnote, issueDate: row.issueDate, dueDate: row.dueDate, status: row.status, recurringFrequency: row.recurringFrequency, nextDueDate: row.nextDueDate, seriesId: row.seriesId ?? row.id, parentInvoiceId: row.parentInvoiceId, recurringEndDate: row.recurringEndDate, recurringCancelled: row.recurringCancelled, paidToDate: paid.toFixed(2), balanceRemaining: Math.max(0, total + lateFee - paid).toFixed(2), lateFeeAccrued: lateFee.toFixed(2), totalWithLateFee:(total+lateFee).toFixed(2), payments: paymentRows.map((p) => ({ id: p.id, invoiceId: p.invoiceId, amount: p.amount, paymentDate: p.paymentDate, method: p.method, note: p.note, createdAt: p.createdAt.toISOString() })), theme: row.theme, font: row.font, accentColor: row.accentColor, showTaxLine: row.showTaxLine, showDiscountLine: row.showDiscountLine, showPaidLine: row.showPaidLine, showPaymentTerms: row.showPaymentTerms, showFooterNotes: row.showFooterNotes, showLogo: row.showLogo, showCompanyInfo: row.showCompanyInfo, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
async function marketplaceListingShape(ctx: Ctx, row: typeof schema.marketplaceListings.$inferSelect, photoRows: Array<typeof schema.marketplaceListingPhotos.$inferSelect>) {
  const photos = await Promise.all(photoRows.filter((photo) => photo.listingId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map(async (photo) => ({ id: photo.id, url: await ctx.blobs.getUrl(photo.blobKey), filename: photo.filename })));
  return { id: row.id, title: row.title, category: row.category, listingType: row.listingType, employmentType: row.employmentType, payUnit: row.payUnit, priceKind: row.priceKind, price: row.price, originalPrice: row.originalPrice, description: row.description, serviceArea: row.serviceArea, companyName: row.companyName, companyPhone: row.companyPhone, bookable: row.bookable, dailyRate: row.dailyRate, promoted: row.promoted, isMine: row.companyId === workspaceIdentity(ctx).workspaceCompanyId, photos, justListed: Date.now() - row.createdAt.getTime() < 7 * 86400000, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
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
const authEnvelopeSchema = z.object({ _sessionToken: z.string().min(32).max(300) });
const authUserSchema = z.object({ id: z.number(), name: z.string(), email: z.string(), companyId: z.number(), role: z.literal("owner"), tier: z.enum(["free", "premium"]) });
const authCodeDeliverySchema = z.enum(["sent", "fallback", "failed"]);

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
function authUserShape(row: typeof schema.authUsers.$inferSelect) {
  return { id: row.id, name: row.name, email: row.email, companyId: row.companyId, role: "owner" as const, tier: row.tier };
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
async function issueSession(ctx: Ctx, userId: number) {
  const db = ctx.db<typeof schema>();
  const token = randomHex(48);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTH_SESSION_DAYS * 24 * 60 * 60_000);
  await db.insert(schema.authSessions).values({ userId, tokenHash: await sha256(token), expiresAt, lastSeenAt: now, createdAt: now });
  return { token, expiresAt };
}
async function requireSession(ctx: Ctx, token: string) {
  const db = ctx.db<typeof schema>();
  const session = (await db.select().from(schema.authSessions).where(eq(schema.authSessions.tokenHash, await sha256(token))).limit(1))[0];
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new Error("Your session has expired. Sign in again.");
  const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, session.userId)).limit(1))[0];
  if (!user?.emailVerifiedAt) throw new Error("Sign in to continue.");
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) await db.update(schema.authSessions).set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + AUTH_SESSION_DAYS * 24 * 60 * 60_000) }).where(eq(schema.authSessions.id, session.id));
  return user;
}

type WorkspaceCtx = Ctx & { workspaceCompanyId: number; workspaceUserId: number; workspaceTier: "free" | "premium" };
const GLOBAL_MARKETPLACE_READ_TABLES = new Set<unknown>([
  schema.marketplaceListings,
  schema.marketplaceListingPhotos,
  schema.marketplaceRequests,
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
                ? values.map((value) => ({ ...value, companyId }))
                : { ...values, companyId },
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
  Object.defineProperties(scoped, {
    db: { value: () => workspaceDb(ctx.db<typeof schema>(), user.companyId) },
    workspaceCompanyId: { value: user.companyId },
    workspaceUserId: { value: user.id },
    workspaceTier: { value: user.tier },
  });
  return scoped;
}

function workspaceIdentity(ctx: Ctx) {
  const scoped = ctx as WorkspaceCtx;
  if (!scoped.workspaceCompanyId || !scoped.workspaceUserId) throw new Error("Sign in to continue.");
  return scoped;
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

const BaseActions = {
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
    request: z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200), password: z.string().min(10).max(200) }),
    response: z.object({ ok: z.literal(true), email: z.string(), verificationCode: z.string().length(6).nullable(), emailDelivery: authCodeDeliverySchema, existingDataClaimed: z.boolean() }),
    privileged: [privileged.sendAuthEmail],
    async handler(ctx, args): Promise<{ ok: true; email: string; verificationCode: string | null; emailDelivery: "sent" | "fallback" | "failed"; existingDataClaimed: boolean }> {
      const db = ctx.db<typeof schema>();
      const users = await db.select({ id: schema.authUsers.id, companyId: schema.authUsers.companyId }).from(schema.authUsers);
      const email = normalizedEmail(args.email);
      const duplicate = (await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.email, email)).limit(1))[0];
      if (duplicate) throw new Error("An account with this email already exists. Sign in instead.");
      const salt = randomHex(16);
      const now = new Date();
      const firstAccount = users.length === 0;
      const companyId = firstAccount ? 1 : Math.max(1, ...users.map((user) => user.companyId)) + 1;
      const counts = firstAccount ? await Promise.all([db.select({ id: schema.jobs.id }).from(schema.jobs), db.select({ id: schema.clients.id }).from(schema.clients), db.select({ id: schema.invoices.id }).from(schema.invoices)]) : [[], [], []];
      const made = (await db.insert(schema.authUsers).values({ name: args.name.trim(), email, passwordHash: await derivePassword(args.password, salt, AUTH_PASSWORD_ITERATIONS), passwordSalt: salt, passwordIterations: AUTH_PASSWORD_ITERATIONS, companyId, role: "owner", tier: firstAccount ? "premium" : "free", subscriptionStatus: firstAccount ? "founder" : "inactive", createdAt: now, updatedAt: now }).returning({ id: schema.authUsers.id }))[0];
      if (!made) throw new Error("The account could not be created.");
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
    response: z.object({ sessionToken: z.string(), expiresAt: z.string(), user: authUserSchema }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>(); const email = normalizedEmail(args.email); const cutoff = Date.now() - 15 * 60_000;
      const attempts = await db.select().from(schema.authLoginAttempts).where(eq(schema.authLoginAttempts.email, email)).orderBy(desc(schema.authLoginAttempts.attemptedAt));
      if (attempts.filter((row) => row.attemptedAt.getTime() >= cutoff).length >= 5) throw new Error("Too many sign-in attempts. Try again in 15 minutes.");
      const user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.email, email)).limit(1))[0];
      const valid = user ? (await derivePassword(args.password, user.passwordSalt, user.passwordIterations)) === user.passwordHash : false;
      if (!user || !valid) { await db.insert(schema.authLoginAttempts).values({ email, attemptedAt: new Date() }); throw new Error("Email or password is incorrect."); }
      if (!user.emailVerifiedAt) throw new Error("Verify your email before signing in.");
      await db.delete(schema.authLoginAttempts).where(eq(schema.authLoginAttempts.email, email));
      const session = await issueSession(ctx, user.id);
      return { sessionToken: session.token, expiresAt: session.expiresAt.toISOString(), user: authUserShape(user) };
    },
  }),
  logout: defineAction({
    request: authEnvelopeSchema,
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await ctx.db<typeof schema>().update(schema.authSessions).set({ revokedAt: new Date() }).where(eq(schema.authSessions.tokenHash, await sha256(args._sessionToken)));
      return { ok: true };
    },
  }),
  getAuthSession: defineAction({
    request: authEnvelopeSchema,
    response: z.object({ user: authUserSchema.nullable() }),
    async handler(ctx, args) {
      try {
        const user = await requireSession(ctx, args._sessionToken);
        return { user: authUserShape(user) };
      } catch {
        return { user: null };
      }
    },
  }),
  getSubscription: defineAction({
    request: z.object({}),
    response: z.object({ tier: z.enum(["free", "premium"]), status: z.string(), cancelAtPeriodEnd: z.boolean(), currentPeriodEnd: z.string().nullable() }),
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const user = (await ctx.db<typeof schema>().select().from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
      if (!user) throw new Error("Sign in to continue.");
      return { tier: user.tier, status: user.subscriptionStatus, cancelAtPeriodEnd: user.cancelAtPeriodEnd, currentPeriodEnd: user.subscriptionCurrentPeriodEnd?.toISOString() ?? null };
    },
  }),
  startPremiumCheckout: defineAction({
    request: z.object({}),
    response: z.object({ configured: z.boolean(), checkoutUrl: z.string().nullable(), missing: z.array(z.string()) }),
    privileged: [privileged.createStripeCheckout],
    async handler(ctx) {
      const identity = workspaceIdentity(ctx);
      const user = (await ctx.db<typeof schema>().select().from(schema.authUsers).where(eq(schema.authUsers.id, identity.workspaceUserId)).limit(1))[0];
      if (!user) throw new Error("Sign in to continue.");
      if (user.tier === "premium") return { configured: true, checkoutUrl: null, missing: [] };
      return await ctx.executePrivileged(privileged.createStripeCheckout, { userId: user.id, companyId: user.companyId, email: user.email });
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
      let user = event.userId ? (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, event.userId)).limit(1))[0] : undefined;
      if (!user && event.subscriptionId) user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.stripeSubscriptionId, event.subscriptionId)).limit(1))[0];
      if (!user && event.customerId) user = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.stripeCustomerId, event.customerId)).limit(1))[0];
      if (!user) throw new Error("Stripe event did not match a Crewkat account.");
      const end = event.currentPeriodEnd ? new Date(event.currentPeriodEnd * 1000) : null;
      if (event.eventType === "customer.subscription.deleted") {
        await db.update(schema.authUsers).set({ tier: "free", subscriptionStatus: event.subscriptionStatus ?? "canceled", cancelAtPeriodEnd: false, subscriptionCurrentPeriodEnd: end, stripeCustomerId: event.customerId ?? user.stripeCustomerId, stripeSubscriptionId: event.subscriptionId ?? user.stripeSubscriptionId, updatedAt: new Date() }).where(eq(schema.authUsers.id, user.id));
      } else {
        const active = event.eventType === "checkout.session.completed" || ["active", "trialing", "past_due"].includes(event.subscriptionStatus ?? "");
        await db.update(schema.authUsers).set({ tier: active ? "premium" : "free", subscriptionStatus: event.subscriptionStatus ?? (active ? "active" : user.subscriptionStatus), cancelAtPeriodEnd: event.cancelAtPeriodEnd, subscriptionCurrentPeriodEnd: end ?? user.subscriptionCurrentPeriodEnd, stripeCustomerId: event.customerId ?? user.stripeCustomerId, stripeSubscriptionId: event.subscriptionId ?? user.stripeSubscriptionId, updatedAt: new Date() }).where(eq(schema.authUsers.id, user.id));
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
  listClients: defineAction({ request: z.object({ search: z.string().max(120).default("") }), response: z.object({ clients: z.array(clientSchema) }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.clients).orderBy(schema.clients.name); const jobs = await db.select({ clientId: schema.jobs.clientId }).from(schema.jobs); const quotes = await db.select({ clientId: schema.quotes.clientId }).from(schema.quotes); const invoices = await db.select({ id: schema.invoices.id, clientId: schema.invoices.clientId, total: schema.invoices.total }).from(schema.invoices); const payments = await db.select({ invoiceId: schema.payments.invoiceId, amount: schema.payments.amount }).from(schema.payments); const term = args.search.trim().toLowerCase(); return { clients: rows.filter((c) => !term || [c.name, c.phone, c.email, c.address].some((v) => v.toLowerCase().includes(term))).map((c) => { const clientInvoices = invoices.filter((invoice) => invoice.clientId === c.id); const invoiceIds = new Set(clientInvoices.map((invoice) => invoice.id)); const totalInvoiced = clientInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0); const totalPaid = payments.filter((payment) => invoiceIds.has(payment.invoiceId)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0); return { id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, notes: c.notes, referredByClientId: c.referredByClientId, referredByName: rows.find((r) => r.id === c.referredByClientId)?.name ?? null, referralCount: rows.filter((r) => r.referredByClientId === c.id).length, jobCount: jobs.filter((j) => j.clientId === c.id).length, quoteCount: quotes.filter((q) => q.clientId === c.id).length, totalInvoiced, totalPaid, paymentPercent: totalInvoiced > 0 ? Math.min(100, Math.round(totalPaid / totalInvoiced * 100)) : 0, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() }; }) }; }}),
  getClient: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ client: clientSchema.nullable(), jobs: z.array(jobSchema), quotes: z.array(quoteSchema) }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.clients); const c = rows.find((row) => row.id === args.id); if (!c) return { client: null, jobs: [], quotes: [] }; const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.clientId, c.id)).orderBy(desc(schema.jobs.jobDate)); const photos = await db.select().from(schema.photos); const quotes = await db.select().from(schema.quotes).where(eq(schema.quotes.clientId, c.id)).orderBy(desc(schema.quotes.createdAt)); const invoices = await db.select({ id: schema.invoices.id, total: schema.invoices.total }).from(schema.invoices).where(eq(schema.invoices.clientId, c.id)); const invoiceIds = new Set(invoices.map((invoice) => invoice.id)); const payments = await db.select({ invoiceId: schema.payments.invoiceId, amount: schema.payments.amount }).from(schema.payments); const totalInvoiced = invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0); const totalPaid = payments.filter((payment) => invoiceIds.has(payment.invoiceId)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0); return { client: { id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, notes: c.notes, referredByClientId: c.referredByClientId, referredByName: rows.find((r) => r.id === c.referredByClientId)?.name ?? null, referralCount: rows.filter((r) => r.referredByClientId === c.id).length, jobCount: jobs.length, quoteCount: quotes.length, totalInvoiced, totalPaid, paymentPercent: totalInvoiced > 0 ? Math.min(100, Math.round(totalPaid / totalInvoiced * 100)) : 0, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() }, jobs: jobs.map((j) => { const jobPhotos = photos.filter((p) => p.jobId === j.id); return jobShape(j, jobPhotos.length, jobPhotos.map((p) => p.stage)); }), quotes: quotes.map(quoteShape) }; }}),
  saveClient: defineAction({ request: clientInputSchema.extend({ id: z.number().int().positive().nullable() }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const now = new Date(); if (args.id) { await db.update(schema.clients).set({ name: args.name, phone: args.phone, email: args.email, address: args.address, notes: args.notes, referredByClientId: args.referredByClientId, updatedAt: now }).where(eq(schema.clients.id, args.id)); ctx.invalidateQueries(); return { id: args.id }; } const rows = await db.insert(schema.clients).values({ name: args.name, phone: args.phone, email: args.email, address: args.address, notes: args.notes, referredByClientId: args.referredByClientId, createdAt: now, updatedAt: now }).returning({ id: schema.clients.id }); const made = rows[0]; if (!made) throw new Error("Could not save client."); ctx.invalidateQueries(); return { id: made.id }; }}),
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

  createJob: defineAction({ request: z.object({ clientId: z.number().int().positive().nullable().default(null), clientName: z.string().trim().min(1).max(160), clientPhone: z.string().trim().max(80).default(""), clientEmail: z.string().trim().email().max(200).or(z.literal("")).default(""), jobAddress: z.string().trim().min(1).max(240), jobType: z.string().trim().min(1).max(120), notes: z.string().trim().max(3000).default(""), jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), appointmentAt: z.string().max(40).default(""), amountDue: z.string().trim().max(80).default(""), dueDate: z.string().max(10).default(""), depositAmount: z.string().trim().max(80).default(""), paymentNotes: z.string().trim().max(1000).default("") }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const now = new Date(); const clientId = await upsertClient(ctx, { clientId: args.clientId, name: args.clientName, phone: args.clientPhone, email: args.clientEmail, address: args.jobAddress }); const rows = await db.insert(schema.jobs).values({ ...args, clientId, amountDue: normalizeMoney(args.amountDue), depositAmount: normalizeMoney(args.depositAmount), createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }); const made = rows[0]; if (!made) throw new Error("The job could not be saved."); ctx.invalidateQueries(); return { id: made.id }; }}),

  updateJob: defineAction({ request: z.object({ id: z.number().int().positive(), clientId: z.number().int().positive().nullable(), clientName: z.string().trim().min(1).max(160), clientPhone: z.string().trim().max(80), clientEmail: z.string().trim().email().max(200).or(z.literal("")), jobAddress: z.string().trim().min(1).max(240), jobType: z.string().trim().min(1).max(120), notes: z.string().trim().max(3000), jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), appointmentAt: z.string().max(40), amountDue: z.string().trim().max(80), dueDate: z.string().max(10), depositAmount: z.string().trim().max(80), paymentNotes: z.string().trim().max(1000), galleryPick: z.boolean() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const { id, ...values } = args; const clientId = await upsertClient(ctx, { clientId: args.clientId, name: args.clientName, phone: args.clientPhone, email: args.clientEmail, address: args.jobAddress }); await ctx.db<typeof schema>().update(schema.jobs).set({ ...values, clientId, amountDue: normalizeMoney(args.amountDue), depositAmount: normalizeMoney(args.depositAmount), updatedAt: new Date() }).where(eq(schema.jobs.id, id)); ctx.invalidateQueries(); return { ok: true }; }}),

  addPhoto: defineAction({ request: z.object({ jobId: z.number().int().positive(), stage: stageSchema, caption: z.string().trim().max(500).default(""), filename: z.string().min(1).max(240), contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]), capturedAt: z.string().datetime(), dataBase64: z.string().min(1).max(30_000_000), annotatedFromId: z.number().int().positive().nullable().default(null) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const key = `jobs/${args.jobId}/${crypto.randomUUID()}`; await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType }); const rows = await db.insert(schema.photos).values({ jobId: args.jobId, stage: args.stage, caption: args.caption, blobKey: key, filename: args.filename, contentType: args.contentType, capturedAt: new Date(args.capturedAt), annotatedFromId: args.annotatedFromId }).returning({ id: schema.photos.id }); const made = rows[0]; if (!made) { await ctx.blobs.delete(key); throw new Error("The photo could not be saved."); } await db.update(schema.jobs).set({ updatedAt: new Date() }).where(eq(schema.jobs.id, args.jobId)); ctx.invalidateQueries(); return { id: made.id }; }}),

  updatePhoto: defineAction({ request: z.object({ id: z.number().int().positive(), caption: z.string().trim().max(500), stage: stageSchema, galleryPick: z.boolean() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.photos).set({ caption: args.caption, stage: args.stage, galleryPick: args.galleryPick }).where(eq(schema.photos.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  togglePhotoSocial: defineAction({ request: z.object({ id: z.number().int().positive(), excludeFromSocial: z.boolean() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.photos).set({ excludeFromSocial: args.excludeFromSocial }).where(eq(schema.photos.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  deletePhoto: defineAction({ request: z.object({ id: z.number().int().positive(), jobId: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const rows = await db.select({ blobKey: schema.photos.blobKey }).from(schema.photos).where(and(eq(schema.photos.id, args.id), eq(schema.photos.jobId, args.jobId))).limit(1); const row = rows[0]; if (row) { await db.delete(schema.photos).where(eq(schema.photos.id, args.id)); await ctx.blobs.delete(row.blobKey); } ctx.invalidateQueries(); return { ok: true }; }}),

  saveDocument: defineAction({ request: z.object({ jobId: z.number().int().positive(), kind: z.enum(["contract", "change_order"]), title: z.string().trim().min(1).max(200), bodyText: z.string().max(100_000).default(""), originalFilename: z.string().max(240).default(""), originalDataBase64: z.string().max(30_000_000).default(""), description: z.string().max(3000).default(""), amount: z.string().max(80).default(""), signerName: z.string().trim().min(1).max(160), signatureDataBase64: z.string().min(1).max(5_000_000), signedAt: z.string().datetime() }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); let originalBlobKey: string | null = null; if (args.originalDataBase64) { originalBlobKey = `documents/${args.jobId}/${crypto.randomUUID()}.pdf`; await ctx.blobs.put(originalBlobKey, Buffer.from(args.originalDataBase64, "base64"), { contentType: "application/pdf" }); } const signatureBlobKey = `signatures/${args.jobId}/${crypto.randomUUID()}.png`; await ctx.blobs.put(signatureBlobKey, Buffer.from(args.signatureDataBase64, "base64"), { contentType: "image/png" }); const rows = await db.insert(schema.documents).values({ jobId: args.jobId, kind: args.kind, title: args.title, bodyText: args.bodyText, originalBlobKey, originalFilename: args.originalFilename, description: args.description, amount: normalizeMoney(args.amount), signerName: args.signerName, signatureBlobKey, signedAt: new Date(args.signedAt), createdAt: new Date() }).returning({ id: schema.documents.id }); const made = rows[0]; if (!made) throw new Error("Could not save document."); ctx.invalidateQueries(); return { id: made.id }; }}),

  addPunchItem: defineAction({ request: z.object({ jobId: z.number().int().positive(), text: z.string().trim().min(1).max(500) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const rows = await ctx.db<typeof schema>().insert(schema.punchItems).values(args).returning({ id: schema.punchItems.id }); const made = rows[0]; if (!made) throw new Error("Could not save item."); ctx.invalidateQueries(); return { id: made.id }; }}),
  togglePunchItem: defineAction({ request: z.object({ id: z.number().int().positive(), completed: z.boolean() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.punchItems).set({ completed: args.completed }).where(eq(schema.punchItems.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  deletePunchItem: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().delete(schema.punchItems).where(eq(schema.punchItems.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  savePunchSignoff: defineAction({ request: z.object({ jobId: z.number().int().positive(), customerName: z.string().trim().min(1).max(160), customerSignatureDataBase64: z.string().min(1).max(5_000_000), contractorName: z.string().trim().min(1).max(160), contractorSignatureDataBase64: z.string().min(1).max(5_000_000), signedAt: z.string().datetime() }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const customerKey = `punch/${args.jobId}/${crypto.randomUUID()}-customer.png`; const contractorKey = `punch/${args.jobId}/${crypto.randomUUID()}-contractor.png`; await Promise.all([ctx.blobs.put(customerKey, Buffer.from(args.customerSignatureDataBase64, "base64"), { contentType: "image/png" }), ctx.blobs.put(contractorKey, Buffer.from(args.contractorSignatureDataBase64, "base64"), { contentType: "image/png" })]); const rows = await db.insert(schema.punchSignoffs).values({ jobId: args.jobId, customerName: args.customerName, customerSignatureBlobKey: customerKey, contractorName: args.contractorName, contractorSignatureBlobKey: contractorKey, signedAt: new Date(args.signedAt) }).returning({ id: schema.punchSignoffs.id }); const made = rows[0]; if (!made) throw new Error("Could not save sign-off."); ctx.invalidateQueries(); return { id: made.id }; }}),
  saveProgressUpdate: defineAction({ request: z.object({ id: z.number().int().positive().nullable().default(null), jobId: z.number().int().positive(), dayNumber: z.number().int().min(1).max(999), note: z.string().trim().max(3000), photoIds: z.array(z.number().int().positive()).max(12), status: z.enum(["draft", "sent"]) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); if(args.status==="sent"&&args.photoIds.length){const rows=await db.select().from(schema.photos);const selected=rows.filter(p=>args.photoIds.includes(p.id)&&p.jobId===args.jobId);if(selected.length!==args.photoIds.length||selected.some(p=>p.excludeFromSocial))throw new Error("A photo marked Not for social cannot be shared.");} const now = new Date(); if (args.id) { await db.update(schema.progressUpdates).set({ dayNumber: args.dayNumber, note: args.note, photoIdsJson: JSON.stringify(args.photoIds), status: args.status, updatedAt: now }).where(and(eq(schema.progressUpdates.id, args.id), eq(schema.progressUpdates.jobId, args.jobId))); ctx.invalidateQueries(); return { id: args.id }; } const rows = await db.insert(schema.progressUpdates).values({ jobId: args.jobId, dayNumber: args.dayNumber, note: args.note, photoIdsJson: JSON.stringify(args.photoIds), status: args.status, createdAt: now, updatedAt: now }).returning({ id: schema.progressUpdates.id }); const made = rows[0]; if (!made) throw new Error("Could not save update."); ctx.invalidateQueries(); return { id: made.id }; }}),
  deleteProgressUpdate: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().delete(schema.progressUpdates).where(eq(schema.progressUpdates.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),

  listQuotes: defineAction({ request: z.object({}), response: z.object({ quotes: z.array(quoteSchema) }), async handler(ctx) { const rows = await ctx.db<typeof schema>().select().from(schema.quotes).orderBy(desc(schema.quotes.createdAt)); return { quotes: rows.map(quoteShape) }; }}),
  saveQuote: defineAction({ request: z.object({ clientId: z.number().int().positive().nullable().default(null), clientName: z.string().trim().min(1).max(160), clientPhone: z.string().trim().max(80), clientEmail: z.string().trim().email().max(200).or(z.literal("")), jobAddress: z.string().trim().max(240), shippingAddress: z.string().trim().max(240).default(""), jobType: z.string().trim().max(120), lineItems: z.array(quoteItemSchema).min(1).max(50), subtotal: z.string().max(80), discountType: adjustmentTypeSchema, discountValue: z.string().max(80), taxType: adjustmentTypeSchema, taxValue: z.string().max(80), total: z.string().max(80), footnote: z.string().max(3000), expiryDate: z.string().max(10), sentAt: z.string().max(10), theme: quoteThemeSchema, font: documentFontSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).extend(documentVisibilitySchema.shape), response: z.object({ id: z.number() }), async handler(ctx, args) { const now = new Date(); const clientId = await upsertClient(ctx, { clientId: args.clientId, name: args.clientName, phone: args.clientPhone, email: args.clientEmail, address: args.jobAddress }); const rows = await ctx.db<typeof schema>().insert(schema.quotes).values({ ...args, clientId, lineItemsJson: JSON.stringify(normalizeLineItems(args.lineItems)), subtotal: normalizeMoney(args.subtotal, "0.00"), discountValue: normalizeMoney(args.discountValue, "0.00"), taxValue: normalizeMoney(args.taxValue, "0.00"), total: normalizeMoney(args.total, "0.00"), createdAt: now, updatedAt: now }).returning({ id: schema.quotes.id }); const made = rows[0]; if (!made) throw new Error("Could not save quote."); ctx.invalidateQueries(); return { id: made.id }; }}),
  convertQuoteToJob: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ jobId: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.quotes).where(eq(schema.quotes.id, args.id)).limit(1); const q = rows[0]; if (!q) throw new Error("Quote not found."); if (q.jobId) return { jobId: q.jobId }; const now = new Date(); const madeRows = await db.insert(schema.jobs).values({ clientId: q.clientId, clientName: q.clientName, clientPhone: q.clientPhone, clientEmail: q.clientEmail, jobAddress: q.jobAddress || "Address pending", jobType: q.jobType || "Quoted work", notes: `Converted from quote #${q.id}`, jobDate: now.toISOString().slice(0, 10), amountDue: q.total, createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }); const made = madeRows[0]; if (!made) throw new Error("Could not create job."); await db.update(schema.quotes).set({ jobId: made.id, updatedAt: now }).where(eq(schema.quotes.id, q.id)); ctx.invalidateQueries(); return { jobId: made.id }; }}),

  listInvoices: defineAction({ request: z.object({}), response: z.object({ invoices: z.array(invoiceSchema) }), async handler(ctx) { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.invoices).orderBy(desc(schema.invoices.createdAt)); const payments = await db.select().from(schema.payments).orderBy(desc(schema.payments.paymentDate)); const setting=(await db.select().from(schema.settings).where(eq(schema.settings.id,1)).limit(1))[0]; const fee={type:setting?.lateFeeType??"flat",value:Number(setting?.lateFeeValue??0),graceDays:setting?.lateFeeGraceDays??0}; return { invoices: rows.map((row) => invoiceShape(row, payments.filter((p) => p.invoiceId === row.id), fee)) }; }}),
  saveInvoice: defineAction({ request: z.object({ quoteId: z.number().int().positive().nullable().default(null), jobId: z.number().int().positive().nullable().default(null), clientId: z.number().int().positive().nullable().default(null), clientName: z.string().trim().min(1).max(160), clientPhone: z.string().trim().max(80), clientEmail: z.string().trim().email().max(200).or(z.literal("")), jobAddress: z.string().trim().max(240), shippingAddress: z.string().trim().max(240).default(""), jobType: z.string().trim().max(120), lineItems: z.array(quoteItemSchema).min(1).max(50), subtotal: z.string().max(80), discountType: adjustmentTypeSchema, discountValue: z.string().max(80), taxType: adjustmentTypeSchema, taxValue: z.string().max(80), total: z.string().max(80), footnote: z.string().max(3000), issueDate: z.string().max(10), dueDate: z.string().max(10), status: invoiceStatusSchema, recurringFrequency: z.enum(["none", "daily", "weekly", "monthly", "quarterly"]).default("none"), nextDueDate: z.string().max(10).default(""), recurringEndDate: z.string().max(10).default(""), theme: quoteThemeSchema, font: documentFontSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).extend(documentVisibilitySchema.shape), response: z.object({ id: z.number() }), async handler(ctx, args) { const now = new Date(); const clientId = await upsertClient(ctx, { clientId: args.clientId, name: args.clientName, phone: args.clientPhone, email: args.clientEmail, address: args.jobAddress }); const rows = await ctx.db<typeof schema>().insert(schema.invoices).values({ ...args, clientId, lineItemsJson: JSON.stringify(normalizeLineItems(args.lineItems)), subtotal: normalizeMoney(args.subtotal, "0.00"), discountValue: normalizeMoney(args.discountValue, "0.00"), taxValue: normalizeMoney(args.taxValue, "0.00"), total: normalizeMoney(args.total, "0.00"), createdAt: now, updatedAt: now }).returning({ id: schema.invoices.id }); const made = rows[0]; if (!made) throw new Error("Could not save invoice."); ctx.invalidateQueries(); return { id: made.id }; }}),
  convertQuoteToInvoice: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ invoiceId: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const requested=(await db.select().from(schema.quotes).where(eq(schema.quotes.id,args.id)).limit(1))[0];if(!requested)throw new Error("Quote not found.");const seriesId=requested.seriesId??requested.id;const versions=(await db.select().from(schema.quotes)).filter(q=>(q.seriesId??q.id)===seriesId);const q=[...versions].filter(v=>v.accepted).sort((a,b)=>b.versionNumber-a.versionNumber)[0]??[...versions].sort((a,b)=>b.versionNumber-a.versionNumber)[0];if(!q)throw new Error("Quote not found.");const prior=(await db.select().from(schema.invoices).where(eq(schema.invoices.quoteId,q.id)).limit(1))[0];if(prior)return{invoiceId:prior.id}; const now = new Date(); const madeRows = await db.insert(schema.invoices).values({ quoteId: q.id, jobId: q.jobId, clientId: q.clientId, clientName: q.clientName, clientPhone: q.clientPhone, clientEmail: q.clientEmail, jobAddress: q.jobAddress, shippingAddress: q.shippingAddress, jobType: q.jobType, lineItemsJson: q.lineItemsJson, subtotal: q.subtotal, discountType: q.discountType, discountValue: q.discountValue, taxType: q.taxType, taxValue: q.taxValue, total: q.total, footnote: q.footnote, issueDate: now.toISOString().slice(0, 10), dueDate: "", status: "draft", theme: q.theme, font: q.font, accentColor: q.accentColor, showTaxLine: q.showTaxLine, showDiscountLine: q.showDiscountLine, showPaidLine: q.showPaidLine, showPaymentTerms: q.showPaymentTerms, showFooterNotes: q.showFooterNotes, showLogo: q.showLogo, showCompanyInfo: q.showCompanyInfo, createdAt: now, updatedAt: now }).returning({ id: schema.invoices.id }); const made = madeRows[0]; if (!made) throw new Error("Could not create invoice."); ctx.invalidateQueries(); return { invoiceId: made.id }; }}),
  updateInvoiceStatus: defineAction({ request: z.object({ id: z.number().int().positive(), status: invoiceStatusSchema }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.invoices).set({ status: args.status, updatedAt: new Date() }).where(eq(schema.invoices.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  toggleInvoicePaid: defineAction({ request: z.object({ id: z.number().int().positive(), paid: z.boolean() }), response: z.object({ ok: z.literal(true) }), async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const row=(await db.select().from(schema.invoices).where(eq(schema.invoices.id,args.id)).limit(1))[0];if(!row)throw new Error("Invoice not found.");const auto=(await db.select().from(schema.payments).where(eq(schema.payments.invoiceId,args.id))).filter(p=>p.note==="__paid_toggle__");if(args.paid){if(!auto.length){const all=await db.select().from(schema.payments).where(eq(schema.payments.invoiceId,args.id));const paid=all.reduce((sum,p)=>sum+Number(p.amount||0),0);const balance=Math.max(0,Number(row.total||0)-paid);if(balance>0)await db.insert(schema.payments).values({invoiceId:args.id,amount:balance.toFixed(2),paymentDate:new Date().toISOString().slice(0,10),method:"Marked paid",note:"__paid_toggle__",createdAt:new Date()});}await db.update(schema.invoices).set({status:"paid",updatedAt:new Date()}).where(eq(schema.invoices.id,args.id));}else{for(const payment of auto)await db.delete(schema.payments).where(eq(schema.payments.id,payment.id));await db.update(schema.invoices).set({status:"draft",updatedAt:new Date()}).where(eq(schema.invoices.id,args.id));}ctx.invalidateQueries();return{ok:true};} }),
  duplicateInvoice: defineAction({ request:z.object({id:z.number().int().positive()}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const row=(await db.select().from(schema.invoices).where(eq(schema.invoices.id,args.id)).limit(1))[0];if(!row)throw new Error("Invoice not found.");const now=new Date();const made=await db.insert(schema.invoices).values({...row,id:undefined,quoteId:null,status:"draft",issueDate:now.toISOString().slice(0,10),dueDate:"",recurringFrequency:"none",nextDueDate:"",seriesId:null,parentInvoiceId:row.id,recurringEndDate:"",recurringCancelled:false,createdAt:now,updatedAt:now}).returning({id:schema.invoices.id});const next=made[0];if(!next)throw new Error("Could not duplicate invoice.");ctx.invalidateQueries();return{id:next.id};} }),
  duplicateQuote: defineAction({ request:z.object({id:z.number().int().positive()}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const row=(await db.select().from(schema.quotes).where(eq(schema.quotes.id,args.id)).limit(1))[0];if(!row)throw new Error("Estimate not found.");const now=new Date();const made=await db.insert(schema.quotes).values({...row,id:undefined,jobId:null,seriesId:null,parentQuoteId:row.id,versionNumber:1,superseded:false,accepted:false,sentAt:"",automationStatus:"awaiting",lostReason:null,lostNote:"",createdAt:now,updatedAt:now}).returning({id:schema.quotes.id});const next=made[0];if(!next)throw new Error("Could not duplicate estimate.");ctx.invalidateQueries();return{id:next.id};} }),
  updateInvoiceDocument: defineAction({ request:z.object({id:z.number().int().positive(),lineItems:z.array(quoteItemSchema).min(1).max(50),discountType:adjustmentTypeSchema,discountValue:z.string().max(80),taxType:adjustmentTypeSchema,taxValue:z.string().max(80),subtotal:z.string().max(80),total:z.string().max(80),footnote:z.string().max(3000)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const {id,...values}=args;await ctx.db<typeof schema>().update(schema.invoices).set({...values,lineItemsJson:JSON.stringify(normalizeLineItems(args.lineItems)),subtotal:normalizeMoney(args.subtotal,"0.00"),discountValue:normalizeMoney(args.discountValue,"0.00"),taxValue:normalizeMoney(args.taxValue,"0.00"),total:normalizeMoney(args.total,"0.00"),updatedAt:new Date()}).where(eq(schema.invoices.id,id));ctx.invalidateQueries();return{ok:true};} }),
  updateQuoteDocument: defineAction({ request:z.object({id:z.number().int().positive(),lineItems:z.array(quoteItemSchema).min(1).max(50),discountType:adjustmentTypeSchema,discountValue:z.string().max(80),taxType:adjustmentTypeSchema,taxValue:z.string().max(80),subtotal:z.string().max(80),total:z.string().max(80),footnote:z.string().max(3000)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const {id,...values}=args;await ctx.db<typeof schema>().update(schema.quotes).set({...values,lineItemsJson:JSON.stringify(normalizeLineItems(args.lineItems)),subtotal:normalizeMoney(args.subtotal,"0.00"),discountValue:normalizeMoney(args.discountValue,"0.00"),taxValue:normalizeMoney(args.taxValue,"0.00"),total:normalizeMoney(args.total,"0.00"),updatedAt:new Date()}).where(eq(schema.quotes.id,id));ctx.invalidateQueries();return{ok:true};} }),
  deleteInvoice: defineAction({request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const sigs=await db.select().from(schema.financialDocumentSignatures).where(and(eq(schema.financialDocumentSignatures.documentKind,"invoice"),eq(schema.financialDocumentSignatures.documentId,args.id)));for(const sig of sigs)await ctx.blobs.delete(sig.signatureBlobKey);await db.delete(schema.financialDocumentSignatures).where(and(eq(schema.financialDocumentSignatures.documentKind,"invoice"),eq(schema.financialDocumentSignatures.documentId,args.id)));await db.delete(schema.invoices).where(eq(schema.invoices.id,args.id));ctx.invalidateQueries();return{ok:true};} }),
  deleteQuote: defineAction({request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const sigs=await db.select().from(schema.financialDocumentSignatures).where(and(eq(schema.financialDocumentSignatures.documentKind,"quote"),eq(schema.financialDocumentSignatures.documentId,args.id)));for(const sig of sigs)await ctx.blobs.delete(sig.signatureBlobKey);await db.delete(schema.financialDocumentSignatures).where(and(eq(schema.financialDocumentSignatures.documentKind,"quote"),eq(schema.financialDocumentSignatures.documentId,args.id)));await db.delete(schema.quotes).where(eq(schema.quotes.id,args.id));ctx.invalidateQueries();return{ok:true};} }),
  getFinancialSignature: defineAction({request:z.object({kind:z.enum(["invoice","quote"]),id:z.number().int().positive()}),response:z.object({signature:z.object({signerName:z.string(),signedAt:z.string(),url:z.string()}).nullable()}),async handler(ctx,args){const rows=await ctx.db<typeof schema>().select().from(schema.financialDocumentSignatures).where(and(eq(schema.financialDocumentSignatures.documentKind,args.kind),eq(schema.financialDocumentSignatures.documentId,args.id))).limit(1);const row=rows[0];return{signature:row?{signerName:row.signerName,signedAt:row.signedAt.toISOString(),url:await ctx.blobs.getUrl(row.signatureBlobKey)}:null};} }),
  saveFinancialSignature: defineAction({request:z.object({kind:z.enum(["invoice","quote"]),id:z.number().int().positive(),signerName:z.string().trim().min(1).max(160),signatureDataBase64:z.string().min(1).max(5_000_000)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const exists=args.kind==="invoice"?(await db.select({id:schema.invoices.id}).from(schema.invoices).where(eq(schema.invoices.id,args.id)).limit(1))[0]:(await db.select({id:schema.quotes.id}).from(schema.quotes).where(eq(schema.quotes.id,args.id)).limit(1))[0];if(!exists)throw new Error("Document not found.");const prior=(await db.select().from(schema.financialDocumentSignatures).where(and(eq(schema.financialDocumentSignatures.documentKind,args.kind),eq(schema.financialDocumentSignatures.documentId,args.id))).limit(1))[0];if(prior){await db.delete(schema.financialDocumentSignatures).where(eq(schema.financialDocumentSignatures.id,prior.id));await ctx.blobs.delete(prior.signatureBlobKey);}const key=`financial-signatures/${args.kind}/${args.id}/${crypto.randomUUID()}.png`;await ctx.blobs.put(key,Buffer.from(args.signatureDataBase64,"base64"),{contentType:"image/png"});await db.insert(schema.financialDocumentSignatures).values({documentKind:args.kind,documentId:args.id,signerName:args.signerName,signatureBlobKey:key,signedAt:new Date()});ctx.invalidateQueries();return{ok:true};} }),

  updateQuoteDesign: defineAction({ request: z.object({ id: z.number().int().positive(), theme: quoteThemeSchema, font: documentFontSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).extend(documentVisibilitySchema.shape), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const { id, ...design } = args; await ctx.db<typeof schema>().update(schema.quotes).set({ ...design, updatedAt: new Date() }).where(eq(schema.quotes.id, id)); ctx.invalidateQueries(); return { ok: true }; }}),
  updateInvoiceDesign: defineAction({ request: z.object({ id: z.number().int().positive(), theme: quoteThemeSchema, font: documentFontSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).extend(documentVisibilitySchema.shape), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const { id, ...design } = args; await ctx.db<typeof schema>().update(schema.invoices).set({ ...design, updatedAt: new Date() }).where(eq(schema.invoices.id, id)); ctx.invalidateQueries(); return { ok: true }; }}),
  saveDocumentDesignDefault: defineAction({ request: z.object({ theme: quoteThemeSchema, font: documentFontSchema, accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).extend(documentVisibilitySchema.shape), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const values = { defaultQuoteTheme: args.theme, defaultDocumentFont: args.font, accentColor: args.accentColor, defaultShowTaxLine: args.showTaxLine, defaultShowDiscountLine: args.showDiscountLine, defaultShowPaidLine: args.showPaidLine, defaultShowPaymentTerms: args.showPaymentTerms, defaultShowFooterNotes: args.showFooterNotes, defaultShowLogo: args.showLogo, defaultShowCompanyInfo: args.showCompanyInfo, updatedAt: new Date() }; const current = await db.select({ id: schema.settings.id }).from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1); if (current[0]) await db.update(schema.settings).set(values).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)); else await db.insert(schema.settings).values({ companyName: "", ...values }); ctx.invalidateQueries(); return { ok: true }; }}),

  startTimer: defineAction({ request: z.object({ jobId: z.number().int().positive(), crewMember: z.string().trim().max(160).default(""), note: z.string().trim().max(500).default("") }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const active = await db.select().from(schema.timeEntries).where(and(eq(schema.timeEntries.jobId, args.jobId))).orderBy(desc(schema.timeEntries.startedAt)); const existing = active.find((row) => !row.endedAt); if (existing) return { id: existing.id }; const rows = await db.insert(schema.timeEntries).values({ jobId: args.jobId, crewMember: args.crewMember, startedAt: new Date(), note: args.note, createdAt: new Date() }).returning({ id: schema.timeEntries.id }); const made = rows[0]; if (!made) throw new Error("Could not start timer."); ctx.invalidateQueries(); return { id: made.id }; }}),
  stopTimer: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.timeEntries).set({ endedAt: new Date() }).where(eq(schema.timeEntries.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  deleteTimeEntry: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().delete(schema.timeEntries).where(eq(schema.timeEntries.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  addReceipt: defineAction({ request: z.object({ jobId: z.number().int().positive(), vendor: z.string().trim().max(160), amount: z.string().trim().min(1).max(80), purchaseDate: z.string().max(10), note: z.string().trim().max(1000), filename: z.string().min(1).max(240), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), dataBase64: z.string().min(1).max(20_000_000) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const key = `receipts/${args.jobId}/${crypto.randomUUID()}`; await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType }); const rows = await ctx.db<typeof schema>().insert(schema.receipts).values({ jobId: args.jobId, vendor: args.vendor, amount: normalizeMoney(args.amount, "0.00"), purchaseDate: args.purchaseDate, note: args.note, blobKey: key, filename: args.filename, contentType: args.contentType, createdAt: new Date() }).returning({ id: schema.receipts.id }); const made = rows[0]; if (!made) throw new Error("Could not save receipt."); ctx.invalidateQueries(); return { id: made.id }; }}),
  deleteReceipt: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.receipts).where(eq(schema.receipts.id, args.id)).limit(1); const row = rows[0]; if (row) { await db.delete(schema.receipts).where(eq(schema.receipts.id, args.id)); await ctx.blobs.delete(row.blobKey); } ctx.invalidateQueries(); return { ok: true }; }}),
  saveCrewTask: defineAction({ request: z.object({ id: z.number().int().positive().nullable().default(null), jobId: z.number().int().positive(), text: z.string().trim().min(1).max(500), completed: z.boolean().default(false) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); if (args.id) { await db.update(schema.crewTasks).set({ text: args.text, completed: args.completed, updatedAt: new Date() }).where(eq(schema.crewTasks.id, args.id)); ctx.invalidateQueries(); return { id: args.id }; } const rows = await db.insert(schema.crewTasks).values({ jobId: args.jobId, text: args.text, completed: args.completed, createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.crewTasks.id }); const made = rows[0]; if (!made) throw new Error("Could not save task."); ctx.invalidateQueries(); return { id: made.id }; }}),
  deleteCrewTask: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().delete(schema.crewTasks).where(eq(schema.crewTasks.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  addVoiceNote: defineAction({ request: z.object({ jobId: z.number().int().positive(), title: z.string().trim().max(160), filename: z.string().min(1).max(240), contentType: z.string().min(1).max(100), durationSeconds: z.number().int().min(0).max(3600), dataBase64: z.string().min(1).max(20_000_000) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const key = `voice/${args.jobId}/${crypto.randomUUID()}`; await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType }); const rows = await ctx.db<typeof schema>().insert(schema.voiceNotes).values({ jobId: args.jobId, title: args.title, blobKey: key, filename: args.filename, contentType: args.contentType, durationSeconds: args.durationSeconds, createdAt: new Date() }).returning({ id: schema.voiceNotes.id }); const made = rows[0]; if (!made) throw new Error("Could not save voice note."); ctx.invalidateQueries(); return { id: made.id }; }}),
  deleteVoiceNote: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.voiceNotes).where(eq(schema.voiceNotes.id, args.id)).limit(1); const row = rows[0]; if (row) { await db.delete(schema.voiceNotes).where(eq(schema.voiceNotes.id, args.id)); await ctx.blobs.delete(row.blobKey); } ctx.invalidateQueries(); return { ok: true }; }}),
  addPayment: defineAction({ request: z.object({ invoiceId: z.number().int().positive(), amount: z.string().trim().min(1).max(80), paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), method: z.string().trim().max(80), note: z.string().trim().max(500) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const rows = await db.insert(schema.payments).values({ ...args, amount: normalizeMoney(args.amount, "0.00"), createdAt: new Date() }).returning({ id: schema.payments.id }); const made = rows[0]; if (!made) throw new Error("Could not save payment."); const invoiceRows = await db.select().from(schema.invoices).where(eq(schema.invoices.id, args.invoiceId)).limit(1); const inv = invoiceRows[0]; if (inv) { const payments = await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, inv.id)); const paid = payments.reduce((sum, p) => sum + Number(p.amount.replace(/[^0-9.-]/g, "") || 0), 0); const total = Number(inv.total.replace(/[^0-9.-]/g, "") || 0); if (paid >= total && total > 0) await db.update(schema.invoices).set({ status: "paid", updatedAt: new Date() }).where(eq(schema.invoices.id, inv.id)); } ctx.invalidateQueries(); return { id: made.id }; }}),
  deletePayment: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().delete(schema.payments).where(eq(schema.payments.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  updateInvoiceRecurrence: defineAction({ request: z.object({ id: z.number().int().positive(), recurringFrequency: z.enum(["none", "daily", "weekly", "monthly", "quarterly"]), nextDueDate: z.string().max(10), recurringEndDate: z.string().max(10).default("") }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db=ctx.db<typeof schema>(); const row=(await db.select().from(schema.invoices).where(eq(schema.invoices.id,args.id)).limit(1))[0]; if(!row)throw new Error("Invoice not found."); await db.update(schema.invoices).set({ recurringFrequency: args.recurringFrequency, nextDueDate: args.recurringFrequency === "none" ? "" : args.nextDueDate, recurringEndDate: args.recurringFrequency === "none" ? "" : args.recurringEndDate, recurringCancelled: args.recurringFrequency === "none", seriesId: row.seriesId ?? row.id, parentInvoiceId: null, updatedAt: new Date() }).where(eq(schema.invoices.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  cancelRecurringInvoice: defineAction({request:z.object({id:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().update(schema.invoices).set({recurringCancelled:true,recurringFrequency:"none",nextDueDate:"",updatedAt:new Date()}).where(eq(schema.invoices.id,args.id));ctx.invalidateQueries();return{ok:true};}}),
  generateRecurringInvoice: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ invoiceId: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const row=(await db.select().from(schema.invoices).where(eq(schema.invoices.id,args.id)).limit(1))[0]; if(!row||row.recurringFrequency==="none"||row.recurringCancelled)throw new Error("Recurring invoice not found."); const issue=row.nextDueDate||new Date().toISOString().slice(0,10); if(row.recurringEndDate&&issue>row.recurringEndDate)throw new Error("Recurring series has ended."); const seriesId=row.seriesId??row.id; const existing=(await db.select().from(schema.invoices)).find(i=>i.seriesId===seriesId&&i.issueDate===issue&&i.parentInvoiceId===row.id); if(existing)return{invoiceId:existing.id}; const next=advanceRecurringDate(issue,row.recurringFrequency); const madeRows=await db.insert(schema.invoices).values({quoteId:null,jobId:row.jobId,clientId:row.clientId,clientName:row.clientName,clientPhone:row.clientPhone,clientEmail:row.clientEmail,jobAddress:row.jobAddress,jobType:row.jobType,lineItemsJson:row.lineItemsJson,subtotal:row.subtotal,discountType:row.discountType,discountValue:row.discountValue,taxType:row.taxType,taxValue:row.taxValue,total:row.total,footnote:row.footnote,issueDate:issue,dueDate:issue,status:"draft",recurringFrequency:"none",nextDueDate:"",seriesId,parentInvoiceId:row.id,theme:row.theme,font:row.font,accentColor:row.accentColor,createdAt:new Date(),updatedAt:new Date()}).returning({id:schema.invoices.id}); const made=madeRows[0];if(!made)throw new Error("Could not generate invoice.");const ended=Boolean(row.recurringEndDate&&next>row.recurringEndDate);await db.update(schema.invoices).set({nextDueDate:ended?"":next,recurringCancelled:ended,recurringFrequency:ended?"none":row.recurringFrequency,updatedAt:new Date()}).where(eq(schema.invoices.id,row.id));ctx.invalidateQueries();return{invoiceId:made.id};} }),
  processRecurringInvoices: defineAction({request:z.object({runDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("")}),response:z.object({generated:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const today=args.runDate||new Date().toISOString().slice(0,10);const rows=await db.select().from(schema.invoices);let generated=0;for(const row of rows.filter(i=>i.parentInvoiceId===null&&i.recurringFrequency!=="none"&&!i.recurringCancelled&&i.nextDueDate&&i.nextDueDate<=today)){const issue=row.nextDueDate;if(row.recurringEndDate&&issue>row.recurringEndDate){await db.update(schema.invoices).set({recurringFrequency:"none",recurringCancelled:true,nextDueDate:"",updatedAt:new Date()}).where(eq(schema.invoices.id,row.id));continue;}const seriesId=row.seriesId??row.id;const existing=rows.find(i=>i.seriesId===seriesId&&i.issueDate===issue&&i.parentInvoiceId===row.id);if(!existing){await db.insert(schema.invoices).values({quoteId:null,jobId:row.jobId,clientId:row.clientId,clientName:row.clientName,clientPhone:row.clientPhone,clientEmail:row.clientEmail,jobAddress:row.jobAddress,jobType:row.jobType,lineItemsJson:row.lineItemsJson,subtotal:row.subtotal,discountType:row.discountType,discountValue:row.discountValue,taxType:row.taxType,taxValue:row.taxValue,total:row.total,footnote:row.footnote,issueDate:issue,dueDate:issue,status:"draft",recurringFrequency:"none",nextDueDate:"",seriesId,parentInvoiceId:row.id,theme:row.theme,font:row.font,accentColor:row.accentColor,createdAt:new Date(),updatedAt:new Date()});generated++;}const next=advanceRecurringDate(issue,row.recurringFrequency === "none" ? "monthly" : row.recurringFrequency);const ended=Boolean(row.recurringEndDate&&next>row.recurringEndDate);await db.update(schema.invoices).set({nextDueDate:ended?"":next,recurringCancelled:ended,recurringFrequency:ended?"none":row.recurringFrequency,updatedAt:new Date()}).where(eq(schema.invoices.id,row.id));}if(generated)ctx.invalidateQueries();return{generated};} }),
  saveCertificate: defineAction({ request: z.object({ jobId: z.number().int().positive(), completionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), warrantyTerms: z.string().trim().max(5000) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.completionCertificates).where(eq(schema.completionCertificates.jobId, args.jobId)).limit(1); const row = rows[0]; let id:number; if (row) { await db.update(schema.completionCertificates).set({ completionDate: args.completionDate, warrantyTerms: args.warrantyTerms, updatedAt: new Date() }).where(eq(schema.completionCertificates.id, row.id)); id=row.id; } else { const madeRows = await db.insert(schema.completionCertificates).values({ ...args, createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.completionCertificates.id }); const made = madeRows[0]; if (!made) throw new Error("Could not save certificate."); id=made.id; } const job=(await db.select().from(schema.jobs).where(eq(schema.jobs.id,args.jobId)).limit(1))[0]; const existing=(await db.select().from(schema.warranties).where(eq(schema.warranties.jobId,args.jobId)).limit(1))[0]; const expiry=new Date(`${args.completionDate}T12:00:00`);expiry.setMonth(expiry.getMonth()+12);const warranty={clientId:job?.clientId??null,terms:args.warrantyTerms,startDate:args.completionDate,durationMonths:12,expiryDate:expiry.toISOString().slice(0,10),updatedAt:new Date()};if(existing)await db.update(schema.warranties).set(warranty).where(eq(schema.warranties.id,existing.id));else await db.insert(schema.warranties).values({jobId:args.jobId,...warranty,createdAt:new Date()});ctx.invalidateQueries();return { id }; }}),
  listAppointments: defineAction({ request: z.object({}), response: z.object({ appointments: z.array(appointmentSchema) }), async handler(ctx) { const rows = await ctx.db<typeof schema>().select().from(schema.appointments).orderBy(schema.appointments.startsAt); return { appointments: rows.map((row) => ({ id: row.id, jobId: row.jobId, clientId: row.clientId, clientName: row.clientName, clientPhone: row.clientPhone, startsAt: row.startsAt, notes: row.notes, exteriorWork: row.exteriorWork })) }; }}),
  saveAppointment: defineAction({ request: z.object({ id: z.number().int().positive().nullable().default(null), jobId: z.number().int().positive().nullable().default(null), clientId: z.number().int().positive().nullable().default(null), clientName: z.string().trim().min(1).max(160), clientPhone: z.string().trim().max(80), startsAt: z.string().min(1).max(40), notes: z.string().trim().max(2000), exteriorWork: z.boolean().default(false) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const now = new Date(); if (args.id) { await db.update(schema.appointments).set({ jobId: args.jobId, clientId: args.clientId, clientName: args.clientName, clientPhone: args.clientPhone, startsAt: args.startsAt, notes: args.notes, exteriorWork: args.exteriorWork, updatedAt: now }).where(eq(schema.appointments.id, args.id)); ctx.invalidateQueries(); return { id: args.id }; } const rows = await db.insert(schema.appointments).values({ jobId: args.jobId, clientId: args.clientId, clientName: args.clientName, clientPhone: args.clientPhone, startsAt: args.startsAt, notes: args.notes, exteriorWork: args.exteriorWork, createdAt: now, updatedAt: now }).returning({ id: schema.appointments.id }); const made = rows[0]; if (!made) throw new Error("Could not save appointment."); ctx.invalidateQueries(); return { id: made.id }; }}),
  deleteAppointment: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().delete(schema.appointments).where(eq(schema.appointments.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  listLeads: defineAction({ request: z.object({}), response: z.object({ leads: z.array(leadSchema), winRate: z.number() }), async handler(ctx) { const rows = await ctx.db<typeof schema>().select().from(schema.leads).orderBy(desc(schema.leads.score), desc(schema.leads.updatedAt)); const decided = rows.filter((row) => row.stage === "won" || row.stage === "lost"); const won = decided.filter((row) => row.stage === "won").length; return { leads: rows.map((row) => ({ id: row.id, name: row.name, phone: row.phone, email: row.email, address: row.address, serviceType: row.serviceType, preferredContactTime: row.preferredContactTime, source: row.source, notes: row.notes, stage: row.stage, projectSize: row.projectSize, engagement: row.engagement, score: row.score, clientId: row.clientId, quoteId: row.quoteId, createdAt: row.createdAt.toISOString() })), winRate: decided.length ? Math.round((won / decided.length) * 100) : 0 }; }}),
  saveLead: defineAction({ request: z.object({ name: z.string().trim().min(1).max(160), phone: z.string().trim().max(80), source: z.string().trim().max(160), notes: z.string().trim().max(2000), projectSize: z.enum(["small","medium","large"]).default("medium"), engagement: z.enum(["slow","normal","fast"]).default("normal"), serviceType: z.string().trim().max(120).default("") }), response: z.object({ id: z.number(), score: z.number() }), async handler(ctx, args) { const source=args.source.toLowerCase(); const service=args.serviceType.toLowerCase(); const score=Math.min(100,(args.projectSize==="large"?35:args.projectSize==="medium"?24:12)+(args.engagement==="fast"?30:args.engagement==="normal"?18:8)+(/referral|google|website/.test(source)?20:10)+(/kitchen|bath|addition|remodel|paint/.test(service)?15:8)); const rows = await ctx.db<typeof schema>().insert(schema.leads).values({ ...args, score, stage: "new", createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.leads.id }); const made = rows[0]; if (!made) throw new Error("Could not save lead."); ctx.invalidateQueries(); return { id: made.id, score }; }}),
  updateLeadStage: defineAction({ request: z.object({ id: z.number().int().positive(), stage: leadStageSchema }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.leads).set({ stage: args.stage, updatedAt: new Date() }).where(eq(schema.leads.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  prepareLeadQuote: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ clientId: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.leads).where(eq(schema.leads.id, args.id)).limit(1); const lead = rows[0]; if (!lead) throw new Error("Lead not found."); const clientId = await upsertClient(ctx, { clientId: lead.clientId, name: lead.name, phone: lead.phone, email: "", address: "" }); if (!clientId) throw new Error("Could not create client."); await db.update(schema.leads).set({ clientId, stage: "quoted", updatedAt: new Date() }).where(eq(schema.leads.id, lead.id)); ctx.invalidateQueries(); return { clientId }; }}),
  getJobOperations: defineAction({ request: z.object({ jobId: z.number().int().positive() }), response: z.object({ selections: z.array(selectionSchema), dailyLogs: z.array(dailyLogSchema), internalNotes: z.array(internalNoteSchema), milestones: z.array(milestoneSchema), profitability: z.object({ quoted: z.number(), invoiced: z.number(), variance: z.number(), variancePercent: z.number().nullable(), materials: z.number(), expenses: z.number(), subcontractors: z.number(), laborHours: z.number(), laborCost: z.number(), profit: z.number(), margin: z.number() }) }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const [selectionRows, logRows, noteRows, milestoneRows, invoiceRows, receiptRows, timeRows, settingRows, expenseRows, subcontractorRows, jobQuoteRows] = await Promise.all([db.select().from(schema.selections).where(eq(schema.selections.jobId, args.jobId)).orderBy(desc(schema.selections.createdAt)), db.select().from(schema.dailyLogs).where(eq(schema.dailyLogs.jobId, args.jobId)).orderBy(desc(schema.dailyLogs.logDate)), db.select().from(schema.internalNotes).where(eq(schema.internalNotes.jobId, args.jobId)).orderBy(desc(schema.internalNotes.createdAt)), db.select().from(schema.paymentMilestones).where(eq(schema.paymentMilestones.jobId, args.jobId)).orderBy(schema.paymentMilestones.id), db.select().from(schema.invoices).where(eq(schema.invoices.jobId, args.jobId)), db.select().from(schema.receipts).where(eq(schema.receipts.jobId, args.jobId)), db.select().from(schema.timeEntries).where(eq(schema.timeEntries.jobId, args.jobId)), db.select().from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1), db.select().from(schema.businessExpenses).where(eq(schema.businessExpenses.jobId, args.jobId)), db.select().from(schema.subcontractors).where(eq(schema.subcontractors.jobId, args.jobId)), db.select().from(schema.quotes).where(eq(schema.quotes.jobId, args.jobId))]); const now = Date.now(); const invoiced = invoiceRows.reduce((sum, row) => sum + Number(row.total.replace(/[^0-9.-]/g, "") || 0), 0); const quoted = jobQuoteRows.reduce((sum,row)=>sum+Number(row.total.replace(/[^0-9.-]/g,"")||0),0); const materials = receiptRows.reduce((sum, row) => sum + Number(row.amount.replace(/[^0-9.-]/g, "") || 0), 0); const laborHours = timeRows.reduce((sum, row) => sum + Math.max(0, ((row.endedAt?.getTime() ?? now) - row.startedAt.getTime()) / 3600000), 0); const laborCost = laborHours * Number(settingRows[0]?.hourlyCostRate.replace(/[^0-9.-]/g, "") || 0); const expenses = expenseRows.reduce((sum,row)=>sum+Number(row.amount.replace(/[^0-9.-]/g,"")||0),0); const subcontractors = subcontractorRows.reduce((sum,row)=>sum+Number(row.agreedAmount.replace(/[^0-9.-]/g,"")||0),0); const profit = invoiced - materials - laborCost - expenses - subcontractors; return { selections: await Promise.all(selectionRows.map(async (row) => ({ id: row.id, jobId: row.jobId, category: row.category, item: row.item, vendor: row.vendor, photoUrl: row.photoBlobKey ? await ctx.blobs.getUrl(row.photoBlobKey) : null, approvalStatus: row.approvalStatus, leadTimeDays: row.leadTimeDays, createdAt: row.createdAt.toISOString() }))), dailyLogs: logRows.map((row) => ({ id: row.id, jobId: row.jobId, logDate: row.logDate, crew: row.crew, hours: row.hours, photoIds: JSON.parse(row.photoIdsJson) as number[], notes: row.notes, createdAt: row.createdAt.toISOString() })), internalNotes: noteRows.map((row) => ({ id: row.id, jobId: row.jobId, clientId: row.clientId, note: row.note, reminderDate: row.reminderDate, completed: row.completed, createdAt: row.createdAt.toISOString() })), milestones: milestoneRows.map((row) => ({ id: row.id, jobId: row.jobId, invoiceId: row.invoiceId, label: row.label, amount: row.amount, percentage: row.percentage, dueDate: row.dueDate, status: row.status, createdAt: row.createdAt.toISOString() })), profitability: { quoted, invoiced, variance: invoiced-quoted, variancePercent: quoted>0?(invoiced-quoted)/quoted*100:null, materials, expenses, subcontractors, laborHours, laborCost, profit, margin: invoiced > 0 ? (profit / invoiced) * 100 : 0 } }; }}),
  saveSelection: defineAction({ request: z.object({ jobId: z.number().int().positive(), category: z.string().trim().min(1).max(160), item: z.string().trim().min(1).max(300), vendor: z.string().trim().max(160), approvalStatus: z.enum(["pending", "approved", "rejected"]), leadTimeDays: z.number().int().min(0).max(730).default(0), photoFilename: z.string().max(240).default(""), photoContentType: z.enum(["", "image/jpeg", "image/png", "image/webp"]), photoDataBase64: z.string().max(20_000_000).default("") }), response: z.object({ id: z.number() }), async handler(ctx, args) { let photoBlobKey: string | null = null; if (args.photoDataBase64 && args.photoContentType) { photoBlobKey = `selections/${args.jobId}/${crypto.randomUUID()}`; await ctx.blobs.put(photoBlobKey, Buffer.from(args.photoDataBase64, "base64"), { contentType: args.photoContentType }); } const rows = await ctx.db<typeof schema>().insert(schema.selections).values({ jobId: args.jobId, category: args.category, item: args.item, vendor: args.vendor, approvalStatus: args.approvalStatus, leadTimeDays: args.leadTimeDays, photoBlobKey, photoFilename: args.photoFilename, photoContentType: args.photoContentType, createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.selections.id }); const made = rows[0]; if (!made) throw new Error("Could not save selection."); ctx.invalidateQueries(); return { id: made.id }; }}),
  updateSelectionStatus: defineAction({ request: z.object({ id: z.number().int().positive(), approvalStatus: z.enum(["pending", "approved", "rejected"]) }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.selections).set({ approvalStatus: args.approvalStatus, updatedAt: new Date() }).where(eq(schema.selections.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  saveDailyLog: defineAction({ request: z.object({ jobId: z.number().int().positive(), logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), crew: z.string().trim().max(1000), hours: z.string().trim().max(80), photoIds: z.array(z.number().int().positive()).max(24), notes: z.string().trim().max(5000) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const rows = await ctx.db<typeof schema>().insert(schema.dailyLogs).values({ jobId: args.jobId, logDate: args.logDate, crew: args.crew, hours: args.hours, photoIdsJson: JSON.stringify(args.photoIds), notes: args.notes, createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.dailyLogs.id }); const made = rows[0]; if (!made) throw new Error("Could not save daily log."); ctx.invalidateQueries(); return { id: made.id }; }}),
  saveInternalNote: defineAction({ request: z.object({ jobId: z.number().int().positive().nullable().default(null), clientId: z.number().int().positive().nullable().default(null), note: z.string().trim().min(1).max(5000), reminderDate: z.string().max(10) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const rows = await ctx.db<typeof schema>().insert(schema.internalNotes).values({ ...args, completed: false, createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.internalNotes.id }); const made = rows[0]; if (!made) throw new Error("Could not save note."); ctx.invalidateQueries(); return { id: made.id }; }}),
  toggleInternalNote: defineAction({ request: z.object({ id: z.number().int().positive(), completed: z.boolean() }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.internalNotes).set({ completed: args.completed, updatedAt: new Date() }).where(eq(schema.internalNotes.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  saveMilestone: defineAction({ request: z.object({ jobId: z.number().int().positive(), label: z.string().trim().min(1).max(160), amount: z.string().trim().max(80), percentage: z.string().trim().max(80), dueDate: z.string().max(10) }), response: z.object({ id: z.number() }), async handler(ctx, args) { const rows = await ctx.db<typeof schema>().insert(schema.paymentMilestones).values({ ...args, amount: normalizeMoney(args.amount, "0.00"), status: "pending", createdAt: new Date(), updatedAt: new Date() }).returning({ id: schema.paymentMilestones.id }); const made = rows[0]; if (!made) throw new Error("Could not save milestone."); ctx.invalidateQueries(); return { id: made.id }; }}),
  updateMilestoneStatus: defineAction({ request: z.object({ id: z.number().int().positive(), status: z.enum(["pending", "paid"]) }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { await ctx.db<typeof schema>().update(schema.paymentMilestones).set({ status: args.status, updatedAt: new Date() }).where(eq(schema.paymentMilestones.id, args.id)); ctx.invalidateQueries(); return { ok: true }; }}),
  invoiceMilestone: defineAction({ request: z.object({ id: z.number().int().positive() }), response: z.object({ invoiceId: z.number() }), async handler(ctx, args) { const db = ctx.db<typeof schema>(); const milestones = await db.select().from(schema.paymentMilestones).where(eq(schema.paymentMilestones.id, args.id)).limit(1); const milestone = milestones[0]; if (!milestone) throw new Error("Milestone not found."); if (milestone.invoiceId) return { invoiceId: milestone.invoiceId }; const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.id, milestone.jobId)).limit(1); const job = jobs[0]; if (!job) throw new Error("Job not found."); const settingRows = await db.select().from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1); const setting = settingRows[0]; const amount = milestone.amount || "0"; const now = new Date(); const rows = await db.insert(schema.invoices).values({ jobId: job.id, clientId: job.clientId, clientName: job.clientName, clientPhone: job.clientPhone, clientEmail: job.clientEmail, jobAddress: job.jobAddress, jobType: job.jobType, lineItemsJson: JSON.stringify([{ description: milestone.label, amount }]), subtotal: amount, total: amount, issueDate: now.toISOString().slice(0, 10), dueDate: milestone.dueDate, status: "draft", theme: setting?.defaultQuoteTheme ?? "classic", font: setting?.defaultDocumentFont ?? "helvetica", accentColor: setting?.accentColor ?? "#1f5a4a", createdAt: now, updatedAt: now }).returning({ id: schema.invoices.id }); const made = rows[0]; if (!made) throw new Error("Could not create invoice."); await db.update(schema.paymentMilestones).set({ invoiceId: made.id, updatedAt: now }).where(eq(schema.paymentMilestones.id, milestone.id)); ctx.invalidateQueries(); return { invoiceId: made.id }; }}),
  getDashboard: defineAction({ request: z.object({}), response: z.object({ revenueMonth: z.number(), expensesMonth: z.number(), actualProfitMonth: z.number(), outstanding: z.number(), hoursWeek: z.number(), winRate: z.number(), appointments: z.array(appointmentSchema), overdueCount: z.number(), quoteFollowupCount: z.number(), reminders: z.array(internalNoteSchema) }), async handler(ctx) { const db = ctx.db<typeof schema>(); const [invoiceRows, paymentRows, timeRows, leadRows, appointmentRows, noteRows, quoteRows, settingRows, expenseRows] = await Promise.all([db.select().from(schema.invoices), db.select().from(schema.payments), db.select().from(schema.timeEntries), db.select().from(schema.leads), db.select().from(schema.appointments).orderBy(schema.appointments.startsAt), db.select().from(schema.internalNotes).orderBy(schema.internalNotes.reminderDate), db.select().from(schema.quotes), db.select().from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1), db.select().from(schema.businessExpenses)]); const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); const revenueMonth = paymentRows.filter((p) => new Date(`${p.paymentDate}T12:00:00`).getTime() >= monthStart).reduce((sum, p) => sum + Number(p.amount.replace(/[^0-9.-]/g, "") || 0), 0); const expensesMonth = expenseRows.filter((row) => new Date(`${row.expenseDate}T12:00:00`).getTime() >= monthStart).reduce((sum,row)=>sum+Number(row.amount.replace(/[^0-9.-]/g,"")||0),0); const outstanding = invoiceRows.reduce((sum, invoice) => { const paid = paymentRows.filter((p) => p.invoiceId === invoice.id).reduce((s, p) => s + Number(p.amount.replace(/[^0-9.-]/g, "") || 0), 0); return sum + Math.max(0, Number(invoice.total.replace(/[^0-9.-]/g, "") || 0) - paid); }, 0); const day = now.getDay(); const weekStart = new Date(now); weekStart.setDate(now.getDate() - ((day + 6) % 7)); weekStart.setHours(0,0,0,0); const hoursWeek = timeRows.filter((row) => row.startedAt >= weekStart).reduce((sum, row) => sum + Math.max(0, ((row.endedAt?.getTime() ?? now.getTime()) - row.startedAt.getTime()) / 3600000), 0); const decided = leadRows.filter((row) => row.stage === "won" || row.stage === "lost"); const winRate = decided.length ? Math.round(decided.filter((row) => row.stage === "won").length / decided.length * 100) : 0; const today = now.toISOString().slice(0,10); const followDays = settingRows[0]?.quoteFollowUpDays ?? 3; const quoteFollowupCount = quoteRows.filter((q) => !q.jobId && q.sentAt && Math.floor((now.getTime() - new Date(`${q.sentAt}T00:00:00`).getTime()) / 86400000) >= followDays).length; return { revenueMonth, expensesMonth, actualProfitMonth: revenueMonth - expensesMonth, outstanding, hoursWeek, winRate, appointments: appointmentRows.filter((row) => row.startsAt.slice(0,10) >= today).slice(0,6).map((row) => ({ id: row.id, jobId: row.jobId, clientId: row.clientId, clientName: row.clientName, clientPhone: row.clientPhone, startsAt: row.startsAt, notes: row.notes, exteriorWork: row.exteriorWork })), overdueCount: invoiceRows.filter((row) => row.status !== "paid" && row.dueDate && row.dueDate < today).length, quoteFollowupCount, reminders: noteRows.filter((row) => !row.completed && row.reminderDate && row.reminderDate <= today).map((row) => ({ id: row.id, jobId: row.jobId, clientId: row.clientId, note: row.note, reminderDate: row.reminderDate, completed: row.completed, createdAt: row.createdAt.toISOString() })) }; }}),

  getAutomationCenter: defineAction({
    request: z.object({ today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    response: z.object({
      appointments: z.array(appointmentSchema),
      quoteChase: z.array(z.object({ id:z.number(), clientName:z.string(), clientPhone:z.string(), total:z.string(), daysWaiting:z.number(), score:z.number(), expiryDate:z.string() })),
      paymentEscalations: z.array(z.object({ id:z.number(), clientName:z.string(), clientPhone:z.string(), balance:z.number(), dueDate:z.string(), daysOverdue:z.number(), stage:z.number(), lastSentAt:z.string().nullable() })),
      materials: z.array(z.object({ selectionId:z.number(), jobId:z.number(), clientName:z.string(), category:z.string(), item:z.string(), jobDate:z.string(), orderByDate:z.string(), daysUntil:z.number(), leadTimeDays:z.number() })),
      quoteExpiry: z.array(z.object({ id:z.number(), clientName:z.string(), clientPhone:z.string(), total:z.string(), expiryDate:z.string(), daysUntil:z.number() })),
      reviews: z.array(z.object({ jobId:z.number(), clientName:z.string(), clientPhone:z.string(), jobType:z.string(), dueDate:z.string() })),
      reengagement: z.array(z.object({ jobId:z.number(), clientName:z.string(), clientPhone:z.string(), jobType:z.string(), months:z.number(), dueDate:z.string() })),
      reminders: z.array(internalNoteSchema),
      crew: z.array(z.object({ jobId:z.number(), clientName:z.string(), jobType:z.string(), jobAddress:z.string(), startsAt:z.string(), tasks:z.array(z.string()) })),
    }),
    async handler(ctx, args) {
      const db=ctx.db<typeof schema>();
      const [appointmentRows,quoteRows,invoiceRows,paymentRows,selectionRows,jobRows,certificateRows,noteRows,crewRows,logRows,parameterRows]=await Promise.all([
        db.select().from(schema.appointments), db.select().from(schema.quotes), db.select().from(schema.invoices), db.select().from(schema.payments), db.select().from(schema.selections), db.select().from(schema.jobs), db.select().from(schema.completionCertificates), db.select().from(schema.internalNotes), db.select().from(schema.crewTasks), db.select().from(schema.automationLogs), db.select().from(schema.adminParameters).where(eq(schema.adminParameters.id,1)).limit(1),
      ]);
      const parameter=parameterRows[0]; const paymentDay1=parameter?.paymentDay1??3; const paymentDay2=parameter?.paymentDay2??14; const paymentDay3=parameter?.paymentDay3??30; const reviewDelay=parameter?.reviewDelayDays??1; const reengagementMonths=[parameter?.reengagementMonth1??6,parameter?.reengagementMonth2??12]; const expiryWarning=parameter?.quoteExpiryWarningDays??3; const defaultLeadTime=parameter?.materialLeadTimeDays??14;
      const base=new Date(`${args.today}T12:00:00`); const dayMs=86400000;
      const dayDiff=(date:string)=>Math.floor((new Date(`${date}T12:00:00`).getTime()-base.getTime())/dayMs);
      const addMonths=(date:string,months:number)=>{const d=new Date(`${date}T12:00:00`);d.setMonth(d.getMonth()+months);return d.toISOString().slice(0,10)};
      const wasSent=(kind:typeof schema.automationLogs.$inferSelect["kind"],entityId:number,stage:string)=>logRows.some(l=>l.kind===kind&&l.entityId===entityId&&l.stage===stage);
      const quoteChase=quoteRows.filter(q=>q.automationStatus==="awaiting"&&Boolean(q.sentAt)).map(q=>{const days=Math.max(0,-dayDiff(q.sentAt));return{id:q.id,clientName:q.clientName,clientPhone:q.clientPhone,total:q.total,daysWaiting:days,score:Number(q.total.replace(/[^0-9.-]/g,"")||0)*days,expiryDate:q.expiryDate}}).filter(q=>q.daysWaiting>0).sort((a,b)=>b.score-a.score);
      const paymentEscalations=invoiceRows.filter(i=>i.status!=="paid"&&Boolean(i.dueDate)&&dayDiff(i.dueDate)<=-paymentDay1).map(i=>{const paid=paymentRows.filter(p=>p.invoiceId===i.id).reduce((sum,p)=>sum+Number(p.amount.replace(/[^0-9.-]/g,"")||0),0);const days=-dayDiff(i.dueDate);const stage=days>=paymentDay3?paymentDay3:days>=paymentDay2?paymentDay2:paymentDay1;const latest=logRows.filter(l=>l.kind==="payment"&&l.entityId===i.id&&l.stage===String(stage)).sort((a,b)=>b.sentAt.getTime()-a.sentAt.getTime())[0];return{id:i.id,clientName:i.clientName,clientPhone:i.clientPhone,balance:Math.max(0,Number(i.total.replace(/[^0-9.-]/g,"")||0)-paid),dueDate:i.dueDate,daysOverdue:days,stage,lastSentAt:latest?.sentAt.toISOString()??null}}).filter(i=>i.balance>0).sort((a,b)=>b.daysOverdue-a.daysOverdue);
      const materials=selectionRows.map(s=>{const job=jobRows.find(j=>j.id===s.jobId);if(!job)return null;const leadTimeDays=s.leadTimeDays>0?s.leadTimeDays:defaultLeadTime;const order=new Date(`${job.jobDate}T12:00:00`);order.setDate(order.getDate()-leadTimeDays);const orderByDate=order.toISOString().slice(0,10);return{selectionId:s.id,jobId:s.jobId,clientName:job.clientName,category:s.category,item:s.item,jobDate:job.jobDate,orderByDate,daysUntil:dayDiff(orderByDate),leadTimeDays}}).filter((v):v is NonNullable<typeof v>=>v!==null).filter(v=>v.daysUntil<=14).sort((a,b)=>a.daysUntil-b.daysUntil);
      const quoteExpiry=quoteRows.filter(q=>q.automationStatus==="awaiting"&&Boolean(q.expiryDate)).map(q=>({id:q.id,clientName:q.clientName,clientPhone:q.clientPhone,total:q.total,expiryDate:q.expiryDate,daysUntil:dayDiff(q.expiryDate)})).filter(q=>q.daysUntil<=expiryWarning).sort((a,b)=>a.daysUntil-b.daysUntil);
      const reviews=certificateRows.map(c=>{const job=jobRows.find(j=>j.id===c.jobId);if(!job)return null;const d=new Date(`${c.completionDate}T12:00:00`);d.setDate(d.getDate()+reviewDelay);const dueDate=d.toISOString().slice(0,10);return{jobId:job.id,clientName:job.clientName,clientPhone:job.clientPhone,jobType:job.jobType,dueDate}}).filter((v):v is NonNullable<typeof v>=>v!==null).filter(v=>v.dueDate<=args.today&&!wasSent("review",v.jobId,"next_day"));
      const reengagement=certificateRows.flatMap(c=>{const job=jobRows.find(j=>j.id===c.jobId);if(!job)return[];return reengagementMonths.map(months=>({jobId:job.id,clientName:job.clientName,clientPhone:job.clientPhone,jobType:job.jobType,months,dueDate:addMonths(c.completionDate,months)}))}).filter(v=>v.dueDate<=args.today&&!wasSent("reengagement",v.jobId,String(v.months)));
      const appointments=appointmentRows.filter(a=>a.startsAt.slice(0,10)===args.today).sort((a,b)=>a.startsAt.localeCompare(b.startsAt)).map(a=>({id:a.id,jobId:a.jobId,clientId:a.clientId,clientName:a.clientName,clientPhone:a.clientPhone,startsAt:a.startsAt,notes:a.notes,exteriorWork:a.exteriorWork}));
      const crew=appointments.flatMap(a=>{const job=jobRows.find(j=>j.id===a.jobId);if(!job)return[];return[{jobId:job.id,clientName:job.clientName,jobType:job.jobType,jobAddress:job.jobAddress,startsAt:a.startsAt,tasks:crewRows.filter(t=>t.jobId===job.id&&!t.completed).map(t=>t.text)}]});
      const reminders=noteRows.filter(n=>!n.completed&&Boolean(n.reminderDate)&&n.reminderDate<=args.today).map(n=>({id:n.id,jobId:n.jobId,clientId:n.clientId,note:n.note,reminderDate:n.reminderDate,completed:n.completed,createdAt:n.createdAt.toISOString()}));
      return{appointments,quoteChase,paymentEscalations,materials,quoteExpiry,reviews,reengagement,reminders,crew};
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
  saveQuoteTemplate: defineAction({ request:z.object({id:z.number().int().positive().nullable().default(null),name:z.string().trim().min(1).max(160),lineItems:z.array(quoteItemSchema).min(1).max(50)}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const now=new Date();if(args.id){await db.update(schema.quoteTemplates).set({name:args.name,lineItemsJson:JSON.stringify(normalizeLineItems(args.lineItems)),isStarter:false,updatedAt:now}).where(eq(schema.quoteTemplates.id,args.id));ctx.invalidateQueries();return{id:args.id};}const rows=await db.insert(schema.quoteTemplates).values({name:args.name,lineItemsJson:JSON.stringify(normalizeLineItems(args.lineItems)),isStarter:false,createdAt:now,updatedAt:now}).returning({id:schema.quoteTemplates.id});const made=rows[0];if(!made)throw new Error("Could not save template.");ctx.invalidateQueries();return{id:made.id};} }),
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
    warranties:z.array(z.object({id:z.number(),jobId:z.number(),jobLabel:z.string(),clientName:z.string(),clientPhone:z.string(),terms:z.string(),startDate:z.string(),durationMonths:z.number(),expiryDate:z.string(),status:z.enum(["active","expiring","expired"])})),
    lossReport:z.array(z.object({reason:z.string(),count:z.number(),value:z.number()})),
    crewHours:z.array(z.object({crewMember:z.string(),jobId:z.number(),jobLabel:z.string(),hours:z.number()})),
    suppliers:z.array(z.object({id:z.number(),name:z.string(),category:z.string(),phone:z.string(),email:z.string(),notes:z.string(),orderCount:z.number(),orderTotal:z.number()})),
    plans:z.array(z.object({id:z.number(),clientId:z.number().nullable(),clientName:z.string(),clientPhone:z.string(),title:z.string(),tasks:z.string(),startDate:z.string(),intervalMonths:z.number(),nextDueDate:z.string(),lastJobId:z.number().nullable(),active:z.boolean()})),
    scans:z.array(z.object({id:z.number(),jobId:z.number().nullable(),expenseId:z.number().nullable(),title:z.string(),kind:z.enum(["receipt","contract","other"]),filename:z.string(),url:z.string(),createdAt:z.string()})),
    videos:z.array(z.object({id:z.number(),jobId:z.number(),jobLabel:z.string(),caption:z.string(),branded:z.boolean(),filename:z.string(),contentType:z.string(),url:z.string(),createdAt:z.string()}))
  }), async handler(ctx,args){const db=ctx.db<typeof schema>();const [jobRows,clientRows,warrantyRows,quoteRows,timeRows,supplierRows,expenseRows,receiptRows,planRows,scanRows,videoRows]=await Promise.all([db.select().from(schema.jobs),db.select().from(schema.clients),db.select().from(schema.warranties),db.select().from(schema.quotes),db.select().from(schema.timeEntries),db.select().from(schema.suppliers),db.select().from(schema.businessExpenses),db.select().from(schema.receipts),db.select().from(schema.maintenancePlans),db.select().from(schema.scannedDocuments),db.select().from(schema.slideshowVideos)]);const jobLabel=(id:number)=>{const j=jobRows.find(x=>x.id===id);return j?`${j.clientName} · ${j.jobType}`:`Job #${id}`};const today=new Date(`${args.today}T12:00:00`).getTime();const lossKeys=["price","timing","competitor","no_response","other"] as const;const weekStart=new Date(`${args.today}T12:00:00`);weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));weekStart.setHours(0,0,0,0);return{jobs:jobRows.map(j=>({id:j.id,label:jobLabel(j.id),clientId:j.clientId,clientName:j.clientName,clientPhone:j.clientPhone})),clients:clientRows.map(c=>({id:c.id,name:c.name,phone:c.phone})),warranties:warrantyRows.map(w=>{const j=jobRows.find(x=>x.id===w.jobId);const days=Math.ceil((new Date(`${w.expiryDate}T12:00:00`).getTime()-today)/86400000);return{id:w.id,jobId:w.jobId,jobLabel:jobLabel(w.jobId),clientName:j?.clientName??"",clientPhone:j?.clientPhone??"",terms:w.terms,startDate:w.startDate,durationMonths:w.durationMonths,expiryDate:w.expiryDate,status:(days<0?"expired":days<=60?"expiring":"active") as "active"|"expiring"|"expired"}}),lossReport:lossKeys.map(reason=>{const rows=quoteRows.filter(q=>q.automationStatus==="lost"&&q.lostReason===reason);return{reason,count:rows.length,value:rows.reduce((s,q)=>s+Number(q.total.replace(/[^0-9.-]/g,"")||0),0)}}),crewHours:timeRows.filter(t=>t.startedAt>=weekStart).map(t=>({crewMember:t.crewMember||"Unassigned",jobId:t.jobId,jobLabel:jobLabel(t.jobId),hours:Math.max(0,((t.endedAt?.getTime()??Date.now())-t.startedAt.getTime())/3600000)})),suppliers:supplierRows.map(s=>{const orders=[...expenseRows.filter(e=>e.supplierId===s.id).map(e=>e.amount),...receiptRows.filter(r=>r.supplierId===s.id).map(r=>r.amount)];return{id:s.id,name:s.name,category:s.category,phone:s.phone,email:s.email,notes:s.notes,orderCount:orders.length,orderTotal:orders.reduce((n,v)=>n+Number(v.replace(/[^0-9.-]/g,"")||0),0)}}),plans:planRows.map(p=>({id:p.id,clientId:p.clientId,clientName:p.clientName,clientPhone:p.clientPhone,title:p.title,tasks:p.tasks,startDate:p.startDate,intervalMonths:p.intervalMonths,nextDueDate:p.nextDueDate,lastJobId:p.lastJobId,active:p.active})),scans:await Promise.all(scanRows.map(async s=>({id:s.id,jobId:s.jobId,expenseId:s.expenseId,title:s.title,kind:s.kind,filename:s.filename,url:await ctx.blobs.getUrl(s.blobKey),createdAt:s.createdAt.toISOString()}))),videos:await Promise.all(videoRows.map(async v=>({id:v.id,jobId:v.jobId,jobLabel:jobLabel(v.jobId),caption:v.caption,branded:v.branded,filename:v.filename,contentType:v.contentType,url:await ctx.blobs.getUrl(v.blobKey),createdAt:v.createdAt.toISOString()})))};} }),
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
  saveSlideshowVideo: defineAction({request:z.object({jobId:z.number().int().positive(),caption:z.string().trim().max(2000),branded:z.boolean(),filename:z.string().min(1).max(240),contentType:z.string().max(100),dataBase64:z.string().min(1).max(80_000_000),photoIds:z.array(z.number().int().positive()).min(1).max(100)}),response:z.object({id:z.number()}),async handler(ctx,args){const photoRows=await ctx.db<typeof schema>().select().from(schema.photos);const requested=photoRows.filter(p=>args.photoIds.includes(p.id)&&p.jobId===args.jobId);if(requested.length!==args.photoIds.length||requested.some(p=>p.excludeFromSocial))throw new Error("A photo marked Not for social cannot be exported.");const key=`slideshows/${args.jobId}/${crypto.randomUUID()}`;await ctx.blobs.put(key,Buffer.from(args.dataBase64,"base64"),{contentType:args.contentType});const rows=await ctx.db<typeof schema>().insert(schema.slideshowVideos).values({jobId:args.jobId,caption:args.caption,branded:args.branded,blobKey:key,filename:args.filename,contentType:args.contentType,createdAt:new Date()}).returning({id:schema.slideshowVideos.id});const made=rows[0];if(!made)throw new Error("Could not save video.");ctx.invalidateQueries();return{id:made.id};}}),
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

  createPortalLink: defineAction({ request: z.object({ jobId: z.number().int().positive() }), response: z.object({ token: z.string(), route: z.string() }), async handler(ctx, args) { const db=ctx.db<typeof schema>(); const job=(await db.select().from(schema.jobs).where(eq(schema.jobs.id,args.jobId)).limit(1))[0]; if(!job) throw new Error("Job not found."); const token=`${crypto.randomUUID().replace(/-/g,"")}${crypto.randomUUID().replace(/-/g,"")}`; const hash=await hashPortalToken(token); await db.update(schema.portalTokens).set({revokedAt:new Date()}).where(and(eq(schema.portalTokens.jobId,args.jobId),isNull(schema.portalTokens.revokedAt))); await db.insert(schema.portalTokens).values({jobId:args.jobId,tokenHash:hash,tokenHint:token.slice(-6),createdAt:new Date()}); ctx.invalidateQueries(); return{token,route:`#portal=${encodeURIComponent(token)}`}; } }),
  revokePortalLink: defineAction({ request:z.object({jobId:z.number().int().positive()}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().update(schema.portalTokens).set({revokedAt:new Date()}).where(and(eq(schema.portalTokens.jobId,args.jobId),isNull(schema.portalTokens.revokedAt)));ctx.invalidateQueries();return{ok:true};} }),
  getPortalData: defineAction({ request:z.object({token:z.string().min(32).max(200)}),response:z.object({job:z.object({id:z.number(),clientName:z.string(),jobType:z.string(),jobAddress:z.string()}),photos:z.array(z.object({id:z.number(),stage:stageSchema,caption:z.string(),url:z.string()})),appointments:z.array(z.object({id:z.number(),startsAt:z.string(),notes:z.string()})),selections:z.array(selectionSchema),changeOrders:z.array(z.object({id:z.number(),title:z.string(),description:z.string(),amount:z.string(),originalUrl:z.string().nullable(),clientSignerName:z.string(),clientSignedAt:z.string().nullable()}))}),async handler(ctx,args){const db=ctx.db<typeof schema>();const hash=await hashPortalToken(args.token);const access=(await db.select().from(schema.portalTokens).where(eq(schema.portalTokens.tokenHash,hash)).limit(1))[0];if(!access||access.revokedAt)throw new Error("This portal link is no longer active.");const job=(await db.select().from(schema.jobs).where(eq(schema.jobs.id,access.jobId)).limit(1))[0];if(!job)throw new Error("Job not found.");const [photos,appointments,selections,documents]=await Promise.all([db.select().from(schema.photos).where(eq(schema.photos.jobId,job.id)).orderBy(schema.photos.createdAt),db.select().from(schema.appointments).where(eq(schema.appointments.jobId,job.id)).orderBy(schema.appointments.startsAt),db.select().from(schema.selections).where(eq(schema.selections.jobId,job.id)).orderBy(schema.selections.id),db.select().from(schema.documents).where(eq(schema.documents.jobId,job.id)).orderBy(desc(schema.documents.createdAt))]);const today=new Date().toISOString();return{job:{id:job.id,clientName:job.clientName,jobType:job.jobType,jobAddress:job.jobAddress},photos:await Promise.all(photos.filter(p=>!p.excludeFromSocial).map(async p=>({id:p.id,stage:p.stage,caption:p.caption,url:await ctx.blobs.getUrl(p.blobKey)}))),appointments:appointments.filter(a=>a.startsAt>=today).map(a=>({id:a.id,startsAt:a.startsAt,notes:a.notes})),selections:await Promise.all(selections.map(async s=>({id:s.id,jobId:s.jobId,category:s.category,item:s.item,vendor:s.vendor,photoUrl:s.photoBlobKey?await ctx.blobs.getUrl(s.photoBlobKey):null,approvalStatus:s.approvalStatus,leadTimeDays:s.leadTimeDays,createdAt:s.createdAt.toISOString()}))),changeOrders:await Promise.all(documents.filter(d=>d.kind==="change_order").map(async d=>({id:d.id,title:d.title,description:d.description,amount:d.amount,originalUrl:d.originalBlobKey?await ctx.blobs.getUrl(d.originalBlobKey):null,clientSignerName:d.clientSignerName,clientSignedAt:d.clientSignedAt?.toISOString()??null}))) };} }),
  portalUpdateSelection: defineAction({request:z.object({token:z.string().min(32).max(200),selectionId:z.number().int().positive(),status:z.enum(["approved","rejected"])}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const hash=await hashPortalToken(args.token);const access=(await db.select().from(schema.portalTokens).where(eq(schema.portalTokens.tokenHash,hash)).limit(1))[0];if(!access||access.revokedAt)throw new Error("This portal link is no longer active.");const selection=(await db.select().from(schema.selections).where(eq(schema.selections.id,args.selectionId)).limit(1))[0];if(!selection||selection.jobId!==access.jobId)throw new Error("Selection not found.");await db.update(schema.selections).set({approvalStatus:args.status}).where(eq(schema.selections.id,selection.id));ctx.invalidateQueries();return{ok:true};} }),
  portalSignChangeOrder: defineAction({request:z.object({token:z.string().min(32).max(200),documentId:z.number().int().positive(),signerName:z.string().trim().min(1).max(160),signatureDataBase64:z.string().min(1).max(5_000_000)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const hash=await hashPortalToken(args.token);const access=(await db.select().from(schema.portalTokens).where(eq(schema.portalTokens.tokenHash,hash)).limit(1))[0];if(!access||access.revokedAt)throw new Error("This portal link is no longer active.");const document=(await db.select().from(schema.documents).where(eq(schema.documents.id,args.documentId)).limit(1))[0];if(!document||document.jobId!==access.jobId||document.kind!=="change_order")throw new Error("Change order not found.");if(document.clientSignedAt)return{ok:true};const key=`client-signatures/${access.jobId}/${crypto.randomUUID()}.png`;await ctx.blobs.put(key,Buffer.from(args.signatureDataBase64,"base64"),{contentType:"image/png"});await db.update(schema.documents).set({clientSignerName:args.signerName,clientSignatureBlobKey:key,clientSignedAt:new Date()}).where(eq(schema.documents.id,document.id));ctx.invalidateQueries();return{ok:true};} }),
  createDocumentLink: defineAction({ request: z.object({ kind: documentKindSchema, id: z.number().int().positive() }), response: z.object({ token: z.string(), hint: z.string(), expiresAt: z.string() }), async handler(ctx, args) { const db=ctx.db<typeof schema>(); if(!await documentLinkTargetExists(ctx,args.kind,args.id)) throw new Error("Document not found."); const token=`${crypto.randomUUID().replace(/-/g,"")}${crypto.randomUUID().replace(/-/g,"")}`; const hash=await hashLinkToken(token); const now=new Date(); const expiresAt=new Date(now.getTime()+30*86400000); await db.update(schema.documentLinks).set({revokedAt:now}).where(and(eq(schema.documentLinks.documentKind,args.kind),eq(schema.documentLinks.documentId,args.id),isNull(schema.documentLinks.revokedAt))); await db.insert(schema.documentLinks).values({documentKind:args.kind,documentId:args.id,tokenHash:hash,tokenHint:token.slice(-6),expiresAt,createdAt:now}); ctx.invalidateQueries(); return{token,hint:token.slice(-6),expiresAt:expiresAt.toISOString()}; } }),
  getDocumentLinkInfo: defineAction({ request: z.object({ kind: documentKindSchema, id: z.number().int().positive() }), response: z.object({ link: z.object({ hint: z.string(), expiresAt: z.string(), expired: z.boolean(), viewCount: z.number(), firstViewedAt: z.string().nullable(), lastViewedAt: z.string().nullable(), createdAt: z.string() }).nullable() }), async handler(ctx, args) { const link=await getActiveDocumentLinkRow(ctx,args.kind,args.id); if(!link) return{link:null}; return{link:{hint:link.tokenHint,expiresAt:link.expiresAt.toISOString(),expired:link.expiresAt.getTime()<Date.now(),viewCount:link.viewCount,firstViewedAt:link.firstViewedAt?.toISOString()??null,lastViewedAt:link.lastViewedAt?.toISOString()??null,createdAt:link.createdAt.toISOString()}}; } }),
  revokeDocumentLink: defineAction({ request: z.object({ kind: documentKindSchema, id: z.number().int().positive() }), response: z.object({ ok: z.literal(true) }), async handler(ctx,args): Promise<{ok:true}> { await ctx.db<typeof schema>().update(schema.documentLinks).set({revokedAt:new Date()}).where(and(eq(schema.documentLinks.documentKind,args.kind),eq(schema.documentLinks.documentId,args.id),isNull(schema.documentLinks.revokedAt))); ctx.invalidateQueries(); return{ok:true}; } }),
  resolveDocumentLink: defineAction({ request: z.object({ token: z.string().min(64).max(200), userAgent: z.string().max(500).default("") }), response: z.object({ kind: documentKindSchema, documentId: z.number(), signable: z.boolean(), alreadySigned: z.boolean(), company: z.object({ name: z.string(), phone: z.string(), email: z.string(), website: z.string(), licenseNumber: z.string(), logoUrl: z.string().nullable() }), title: z.string(), clientName: z.string(), jobAddress: z.string(), jobType: z.string(), lineItems: z.array(z.object({ description: z.string(), amount: z.string() })), subtotal: z.string(), total: z.string(), dateLabel: z.string(), dateValue: z.string(), footnote: z.string(), bodyText: z.string(), description: z.string(), amount: z.string(), contractorSignerName: z.string(), linkExpiresAt: z.string() }), async handler(ctx, args) {
    const db=ctx.db<typeof schema>(); const link=await resolveDocumentLinkToken(ctx,args.token);
    const now=new Date();
    await db.update(schema.documentLinks).set({viewCount:link.viewCount+1,firstViewedAt:link.firstViewedAt??now,lastViewedAt:now}).where(eq(schema.documentLinks.id,link.id));
    await db.insert(schema.documentLinkEvents).values({linkId:link.id,eventType:"view",userAgent:args.userAgent.slice(0,300),occurredAt:now});
    const settings=(await db.select().from(schema.settings).where(eq(schema.settings.id,1)).limit(1))[0];
    const company={name:settings?.companyName??"",phone:settings?.phone??"",email:settings?.email??"",website:settings?.website??"",licenseNumber:settings?.licenseNumber??"",logoUrl:settings?.logoBlobKey?await ctx.blobs.getUrl(settings.logoBlobKey):null};
    const base={kind:link.documentKind,documentId:link.documentId,signable:false,alreadySigned:false,company,title:"",clientName:"",jobAddress:"",jobType:"",lineItems:[] as Array<{description:string;amount:string}>,subtotal:"",total:"",dateLabel:"",dateValue:"",footnote:"",bodyText:"",description:"",amount:"",contractorSignerName:"",linkExpiresAt:link.expiresAt.toISOString()};
    if(link.documentKind==="invoice"){const row=(await db.select().from(schema.invoices).where(eq(schema.invoices.id,link.documentId)).limit(1))[0];if(!row)throw new Error("This document is no longer available.");return{...base,title:`Invoice #${row.id}`,clientName:row.clientName,jobAddress:row.jobAddress,jobType:row.jobType,lineItems:JSON.parse(row.lineItemsJson),subtotal:row.subtotal,total:row.total,dateLabel:"Due date",dateValue:row.dueDate,footnote:row.footnote};}
    if(link.documentKind==="quote"){const row=(await db.select().from(schema.quotes).where(eq(schema.quotes.id,link.documentId)).limit(1))[0];if(!row)throw new Error("This document is no longer available.");return{...base,title:`Estimate #${row.id}`,clientName:row.clientName,jobAddress:row.jobAddress,jobType:row.jobType,lineItems:JSON.parse(row.lineItemsJson),subtotal:row.subtotal,total:row.total,dateLabel:"Valid until",dateValue:row.expiryDate,footnote:row.footnote};}
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
    ctx.invalidateQueries(); return{ok:true,signedAt:now.toISOString()};
  } }),
  submitEstimateRequest: defineAction({request:z.object({name:z.string().trim().min(2).max(160),phone:z.string().trim().min(7).max(40),email:z.string().trim().email().max(200),address:z.string().trim().min(5).max(240),serviceType:z.string().trim().min(2).max(120),projectDetails:z.string().trim().min(10).max(3000),preferredContactTime:z.string().trim().max(120),company:z.string().max(0).default("")}),response:z.object({id:z.number()}),async handler(ctx,args){if(args.company)throw new Error("Request rejected.");const db=ctx.db<typeof schema>();const digits=normalizedPhone(args.phone);if(digits.length<10)throw new Error("Enter a valid phone number.");const recent=await db.select().from(schema.leads).orderBy(desc(schema.leads.createdAt));const cutoff=Date.now()-86400000;const duplicates=recent.filter(l=>l.source==="website form"&&l.createdAt.getTime()>=cutoff&&(normalizedPhone(l.phone)===digits||l.email.toLowerCase()===args.email.toLowerCase()));if(duplicates.length>=3)throw new Error("Too many recent requests. Please call the office.");const rows=await db.insert(schema.leads).values({name:args.name,phone:args.phone,email:args.email,address:args.address,serviceType:args.serviceType,preferredContactTime:args.preferredContactTime,source:"website form",notes:args.projectDetails,stage:"new",createdAt:new Date(),updatedAt:new Date()}).returning({id:schema.leads.id});const made=rows[0];if(!made)throw new Error("Could not submit request.");ctx.invalidateQueries();return{id:made.id};} }),
  updateJobSiteLocation: defineAction({request:z.object({jobId:z.number().int().positive(),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().update(schema.jobs).set({latitude:String(args.latitude),longitude:String(args.longitude),updatedAt:new Date()}).where(eq(schema.jobs.id,args.jobId));ctx.invalidateQueries();return{ok:true};} }),
  suggestJobsByLocation: defineAction({request:z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}),response:z.object({jobs:z.array(z.object({id:z.number(),label:z.string(),distanceMiles:z.number()}))}),async handler(ctx,args){const rows=await ctx.db<typeof schema>().select().from(schema.jobs);const rad=(value:number)=>value*Math.PI/180;const miles=(lat:number,lon:number)=>{const dLat=rad(lat-args.latitude),dLon=rad(lon-args.longitude);const a=Math.sin(dLat/2)**2+Math.cos(rad(args.latitude))*Math.cos(rad(lat))*Math.sin(dLon/2)**2;return 3958.8*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));};return{jobs:rows.flatMap(j=>{const lat=Number(j.latitude),lon=Number(j.longitude);return Number.isFinite(lat)&&Number.isFinite(lon)?[{id:j.id,label:`${j.clientName} · ${j.jobType}`,distanceMiles:Math.round(miles(lat,lon)*10)/10}]:[]}).sort((a,b)=>a.distanceMiles-b.distanceMiles).slice(0,5)};} }),
  clockInCrew: defineAction({request:z.object({jobId:z.number().int().positive(),crewMember:z.string().trim().min(1).max(160),latitude:z.number().min(-90).max(90).nullable(),longitude:z.number().min(-180).max(180).nullable(),note:z.string().trim().max(500).default("")}),response:z.object({id:z.number()}),async handler(ctx,args){const db=ctx.db<typeof schema>();const active=(await db.select().from(schema.timeEntries).orderBy(desc(schema.timeEntries.startedAt))).find(t=>!t.endedAt&&t.crewMember.toLowerCase()===args.crewMember.toLowerCase());if(active)return{id:active.id};const rows=await db.insert(schema.timeEntries).values({jobId:args.jobId,crewMember:args.crewMember,startedAt:new Date(),clockInLatitude:args.latitude===null?null:String(args.latitude),clockInLongitude:args.longitude===null?null:String(args.longitude),note:args.note,createdAt:new Date()}).returning({id:schema.timeEntries.id});const made=rows[0];if(!made)throw new Error("Could not clock in.");ctx.invalidateQueries();return{id:made.id};} }),
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
  saveSafetyTalk: defineAction({request:z.object({jobId:z.number().int().positive(),topicKey:z.enum(["ladder","ppe","electrical","heat","silica","fall"]),talkDate:z.string().max(10),checklist:z.array(z.string().max(300)).max(20),acknowledgements:z.array(z.string().trim().min(1).max(160)).min(1).max(30)}),response:z.object({id:z.number()}),async handler(ctx,args){const rows=await ctx.db<typeof schema>().insert(schema.safetyTalks).values({jobId:args.jobId,topicKey:args.topicKey,talkDate:args.talkDate,checklistJson:JSON.stringify(args.checklist),acknowledgementsJson:JSON.stringify(args.acknowledgements),createdAt:new Date()}).returning({id:schema.safetyTalks.id});const made=rows[0];if(!made)throw new Error("Could not save safety talk.");ctx.invalidateQueries();return{id:made.id};}}),
  saveIncident: defineAction({request:z.object({jobId:z.number().int().positive(),incidentDate:z.string().max(10),description:z.string().trim().min(1).max(3000),severity:z.enum(["near_miss","minor","serious"]),correctiveAction:z.string().trim().max(3000),photoContentType:z.enum(["","image/jpeg","image/png","image/webp"]).default(""),photoDataBase64:z.string().max(20_000_000).default("")}),response:z.object({id:z.number()}),async handler(ctx,args){let photoBlobKey:null|string=null;if(args.photoDataBase64&&args.photoContentType){photoBlobKey=`incidents/${crypto.randomUUID()}`;await ctx.blobs.put(photoBlobKey,Buffer.from(args.photoDataBase64,"base64"),{contentType:args.photoContentType});}const {photoContentType:_t,photoDataBase64:_d,...values}=args;const rows=await ctx.db<typeof schema>().insert(schema.incidents).values({...values,photoBlobKey,createdAt:new Date()}).returning({id:schema.incidents.id});const made=rows[0];if(!made)throw new Error("Could not save incident.");ctx.invalidateQueries();return{id:made.id};}}),
  saveCredential: defineAction({request:z.object({ownerType:z.enum(["business","subcontractor"]),subcontractorId:z.number().int().positive().nullable(),kind:z.string().trim().min(1).max(160),identifier:z.string().trim().max(160),expiresOn:z.string().max(10)}),response:z.object({id:z.number()}),async handler(ctx,args){const rows=await ctx.db<typeof schema>().insert(schema.credentials).values({...args,createdAt:new Date(),updatedAt:new Date()}).returning({id:schema.credentials.id});const made=rows[0];if(!made)throw new Error("Could not save credential.");ctx.invalidateQueries();return{id:made.id};}}),
  renewCredential: defineAction({request:z.object({id:z.number().int().positive(),expiresOn:z.string().max(10)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{await ctx.db<typeof schema>().update(schema.credentials).set({expiresOn:args.expiresOn,renewedAt:new Date(),updatedAt:new Date()}).where(eq(schema.credentials.id,args.id));ctx.invalidateQueries();return{ok:true};}}),
  saveCrewPayRate: defineAction({request:z.object({crewMember:z.string().trim().min(1).max(160),hourlyRate:z.string().max(80)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const db=ctx.db<typeof schema>();const current=(await db.select().from(schema.crewPayRates).where(eq(schema.crewPayRates.crewMember,args.crewMember)).limit(1))[0];if(current)await db.update(schema.crewPayRates).set({hourlyRate:normalizeMoney(args.hourlyRate,"0.00"),updatedAt:new Date()}).where(eq(schema.crewPayRates.id,current.id));else await db.insert(schema.crewPayRates).values({crewMember:args.crewMember,hourlyRate:normalizeMoney(args.hourlyRate,"0.00"),updatedAt:new Date()});ctx.invalidateQueries();return{ok:true};}}),
  setJobPhotoRequirements: defineAction({request:z.object({jobId:z.number().int().positive(),requiredStages:z.array(stageSchema).max(3)}),response:z.object({ok:z.literal(true)}),async handler(ctx,args):Promise<{ok:true}>{const ordered=(['before','during','after'] as const).filter(stage=>args.requiredStages.includes(stage));await ctx.db<typeof schema>().update(schema.jobs).set({requiredPhotoStages:ordered.join(','),updatedAt:new Date()}).where(eq(schema.jobs.id,args.jobId));ctx.invalidateQueries();return{ok:true};}}),
  completeJob: defineAction({request:z.object({jobId:z.number().int().positive(),overrideNote:z.string().trim().max(1000).default("")}),response:z.object({ok:z.literal(true),missingStages:z.array(stageSchema)}),async handler(ctx,args):Promise<{ok:true;missingStages:Array<"before"|"during"|"after">}>{const db=ctx.db<typeof schema>();const job=(await db.select().from(schema.jobs).where(eq(schema.jobs.id,args.jobId)).limit(1))[0];if(!job)throw new Error("Job not found.");const photos=await db.select().from(schema.photos).where(eq(schema.photos.jobId,args.jobId));const required=job.requiredPhotoStages.split(",").filter((s):s is "before"|"during"|"after"=>s==="before"||s==="during"||s==="after");const missingStages=required.filter(s=>!photos.some(p=>p.stage===s));if(missingStages.length&&!args.overrideNote)throw new Error("Add an override note for missing required photos.");await db.update(schema.jobs).set({completedAt:new Date(),completionOverrideNote:args.overrideNote,updatedAt:new Date()}).where(eq(schema.jobs.id,args.jobId));if(missingStages.length)await db.insert(schema.completionOverrides).values({jobId:args.jobId,missingStages:missingStages.join(","),note:args.overrideNote,createdAt:new Date()});ctx.invalidateQueries();return{ok:true,missingStages};}}),
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

  listMarketplaceListings: defineAction({
    request: z.object({ search: z.string().trim().max(120).default(""), category: marketplaceCategorySchema.nullable().default(null), serviceArea: z.string().trim().max(120).default("") }),
    response: z.object({ listings: z.array(marketplaceListingSchema) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.marketplaceListings).orderBy(desc(schema.marketplaceListings.promoted), desc(schema.marketplaceListings.createdAt));
      const photoRows = await db.select().from(schema.marketplaceListingPhotos).orderBy(schema.marketplaceListingPhotos.sortOrder);
      const search = args.search.toLowerCase();
      const area = args.serviceArea.toLowerCase();
      const categoryTerms: Record<z.infer<typeof marketplaceCategorySchema>, string> = { kitchens: "kitchen cabinet carpenter", bathrooms: "bathroom shower", plumbing: "plumbing plumber", electrical: "electrical electrician", hvac: "hvac air conditioning", roofing: "roof roofers roofing", tile_flooring: "tile flooring floor installer", painting: "painting painter", concrete: "concrete masonry", landscaping: "landscaping lawn", handyman: "handyman repair", equipment: "equipment trailer rental", materials: "materials supplies", other: "other" };
      const filtered = rows.filter((row) => (!args.category || row.category === args.category) && (!search || [row.title, row.description, row.companyName, row.serviceArea, categoryTerms[row.category]].some((value) => value.toLowerCase().includes(search))) && (!area || row.serviceArea.toLowerCase().includes(area)));
      return { listings: await Promise.all(filtered.map((row) => marketplaceListingShape(ctx, row, photoRows))) };
    },
  }),
  getMarketplaceListing: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ listing: marketplaceListingSchema.nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const row = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, args.id)).limit(1))[0];
      if (!row) return { listing: null };
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
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      if (args.priceKind === "amount" && !args.price.trim()) throw new Error("Enter a price or choose Contact for price.");
      if (args.bookable && !args.dailyRate.trim()) throw new Error("Enter a daily rate for this bookable listing.");
      const identity = workspaceIdentity(ctx);
      const db = ctx.db<typeof schema>(); const now = new Date();
      if (identity.workspaceTier === "free") {
        const mine = await db.select({ id: schema.marketplaceListings.id }).from(schema.marketplaceListings).where(eq(schema.marketplaceListings.companyId, identity.workspaceCompanyId));
        if (mine.length >= 5) throw new Error("Your free plan includes 5 Marketplace listings. Upgrade to Premium for more.");
      }
      const made = (await db.insert(schema.marketplaceListings).values({ title: args.title, category: args.category, listingType: args.listingType, employmentType: args.employmentType, payUnit: args.payUnit, priceKind: args.priceKind, price: args.priceKind === "amount" ? normalizeMoney(args.price) : "", originalPrice: args.priceKind === "amount" ? normalizeMoney(args.originalPrice) : "", description: args.description, serviceArea: args.serviceArea, companyName: args.companyName, companyPhone: args.companyPhone, bookable: args.bookable, dailyRate: args.bookable ? normalizeMoney(args.dailyRate) : "", createdAt: now, updatedAt: now }).returning({ id: schema.marketplaceListings.id }))[0];
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
      return { id: made.id };
    },
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
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      if (args.priceKind === "amount" && !args.price.trim()) throw new Error("Enter a price or choose Contact for price.");
      if (args.bookable && !args.dailyRate.trim()) throw new Error("Enter a daily rate for this bookable listing.");
      const db = ctx.db<typeof schema>();
      const existing = (await db.select().from(schema.marketplaceListings).where(and(eq(schema.marketplaceListings.id, args.id), eq(schema.marketplaceListings.companyId, workspaceIdentity(ctx).workspaceCompanyId))).limit(1))[0];
      if (!existing) throw new Error("You can only edit your own listings.");
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
        await db.update(schema.marketplaceListings).set({ title: args.title, category: args.category, listingType: args.listingType, employmentType: args.employmentType, payUnit: args.payUnit, priceKind: args.priceKind, price: args.priceKind === "amount" ? normalizeMoney(args.price) : "", originalPrice: args.priceKind === "amount" ? normalizeMoney(args.originalPrice) : "", description: args.description, serviceArea: args.serviceArea, companyName: args.companyName, companyPhone: args.companyPhone, bookable: args.bookable, dailyRate: args.bookable ? normalizeMoney(args.dailyRate) : "", updatedAt: now }).where(eq(schema.marketplaceListings.id, args.id));
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
      return { id: args.id };
    },
  }),
  deleteMarketplaceListing: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
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
  listMarketplaceMessages: defineAction({
    request: z.object({ listingId: z.number().int().positive() }),
    response: z.object({ messages: z.array(marketplaceMessageSchema) }),
    async handler(ctx, args) {
      const rows = await ctx.db<typeof schema>().select().from(schema.marketplaceMessages).where(eq(schema.marketplaceMessages.listingId, args.listingId)).orderBy(schema.marketplaceMessages.createdAt);
      return { messages: await Promise.all(rows.map(async (row) => ({ id: row.id, listingId: row.listingId, body: row.body, imageUrl: row.imageBlobKey ? await ctx.blobs.getUrl(row.imageBlobKey) : null, imageFilename: row.imageFilename, sender: row.sender, isRead: row.sender === "me" || row.readAt !== null, createdAt: row.createdAt.toISOString() }))) };
    },
  }),
  getMarketplaceInbox: defineAction({
    request: z.object({}),
    response: z.object({ unreadCount: z.number(), conversations: z.array(marketplaceInboxRowSchema) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const [messages, listings] = await Promise.all([
        db.select().from(schema.marketplaceMessages).orderBy(desc(schema.marketplaceMessages.createdAt)),
        db.select({ id: schema.marketplaceListings.id, title: schema.marketplaceListings.title, companyName: schema.marketplaceListings.companyName }).from(schema.marketplaceListings),
      ]);
      const listingById = new Map(listings.map((listing) => [listing.id, listing]));
      const grouped = new Map<number, { listingId: number; listingTitle: string; companyName: string; lastMessage: string; lastMessageAt: string; unreadCount: number }>();
      for (const message of messages) {
        const listing = listingById.get(message.listingId);
        if (!listing) continue;
        const existing = grouped.get(message.listingId);
        const unread = message.sender === "other" && message.readAt === null ? 1 : 0;
        if (!existing) {
          grouped.set(message.listingId, {
            listingId: message.listingId,
            listingTitle: listing.title,
            companyName: listing.companyName,
            lastMessage: message.body || (message.imageBlobKey ? "Photo" : "Message"),
            lastMessageAt: message.createdAt.toISOString(),
            unreadCount: unread,
          });
        } else {
          existing.unreadCount += unread;
        }
      }
      const conversations = [...grouped.values()].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      return { unreadCount: conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0), conversations };
    },
  }),
  markMarketplaceThreadRead: defineAction({
    request: z.object({ listingId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await ctx.db<typeof schema>().update(schema.marketplaceMessages).set({ readAt: new Date() }).where(and(eq(schema.marketplaceMessages.listingId, args.listingId), eq(schema.marketplaceMessages.sender, "other"), isNull(schema.marketplaceMessages.readAt)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  sendMarketplaceMessage: defineAction({
    request: z.object({ listingId: z.number().int().positive(), body: z.string().trim().max(3000), image: z.object({ filename: z.string().min(1).max(240), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), dataBase64: z.string().min(1).max(30_000_000) }).nullable(), sender: z.enum(["me", "other"]).default("me") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      if (!args.body && !args.image) throw new Error("Write a message or add a photo.");
      const db = ctx.db<typeof schema>();
      const listing = (await db.select({ id: schema.marketplaceListings.id }).from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, args.listingId)).limit(1))[0];
      if (!listing) throw new Error("This listing is no longer available.");
      const key = args.image ? `marketplace/messages/${args.listingId}/${crypto.randomUUID()}-${args.image.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}` : null;
      if (args.image && key) await ctx.blobs.put(key, Buffer.from(args.image.dataBase64, "base64"), { contentType: args.image.contentType });
      try {
        const made = (await db.insert(schema.marketplaceMessages).values({ listingId: args.listingId, body: args.body, imageBlobKey: key, imageFilename: args.image?.filename ?? "", imageContentType: args.image?.contentType ?? "", sender: args.sender, readAt: args.sender === "me" ? new Date() : null, createdAt: new Date() }).returning({ id: schema.marketplaceMessages.id }))[0];
        if (!made) throw new Error("The message could not be saved.");
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

  submitSupportReport: defineAction({ request: z.object({ kind: z.enum(["support", "problem", "question", "general", "feature"]), subject: z.string().trim().min(1).max(160), message: z.string().trim().min(1).max(5000), language: languageSchema }), response: z.object({ id: z.number(), sentAt: z.string() }), async handler(ctx, args) { const now = new Date(); const rows = await ctx.db<typeof schema>().insert(schema.supportReports).values({ ...args, status: "open", isUnread: true, createdAt: now, updatedAt: now }).returning({ id: schema.supportReports.id }); const made = rows[0]; if (!made) throw new Error("The report could not be saved."); ctx.invalidateQueries(); return { id: made.id, sentAt: now.toISOString() }; }}),

  getSettings: defineAction({ request: z.object({}), response: settingsSchema, async handler(ctx) { const rows = await ctx.db<typeof schema>().select().from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1); const row = rows[0]; if (!row) return { companyName: "", licenseNumber: "", phone: "", email: "", website: "", address: "", profileDescription: "", serviceArea: "", facebookUrl: "", instagramUrl: "", youtubeUrl: "", reviewUrl: "", paymentInstructions: "", quoteFollowUpDays: 3, offersFreeEstimates: true, socialWatermark: true, language: "en" as const, accentColor: "#1f5a4a", defaultQuoteTheme: "classic" as const, defaultDocumentFont: "helvetica" as const, defaultShowTaxLine: true, defaultShowDiscountLine: true, defaultShowPaidLine: true, defaultShowPaymentTerms: true, defaultShowFooterNotes: true, defaultShowLogo: true, defaultShowCompanyInfo: true, defaultFootnote: "", warrantyTerms: "", hourlyCostRate: "0", lateFeeType: "percent" as const, lateFeeValue: "0", lateFeeGraceDays: 0, costAlertPercent: 80, paymentRemindersEnabled: true, onlineSignatureEnabled: true, overdueInvoiceRemindersEnabled: true, overdueReminderDays: 3, invoiceGroupBy: "creation_date" as const, addShippingAddress: false, addJobSiteAddress: true, convertToQuote: false, notificationsEnabled: true, simpleMode: true, logoUrl: null, coverUrl: null }; return { companyName: row.companyName, licenseNumber: row.licenseNumber, phone: row.phone, email: row.email, website: row.website, address: row.address, profileDescription: row.profileDescription, serviceArea: row.serviceArea, facebookUrl: row.facebookUrl, instagramUrl: row.instagramUrl, youtubeUrl: row.youtubeUrl, reviewUrl: row.reviewUrl, paymentInstructions: row.paymentInstructions, quoteFollowUpDays: row.quoteFollowUpDays, offersFreeEstimates: row.offersFreeEstimates, socialWatermark: row.socialWatermark, language: row.language, accentColor: row.accentColor, defaultQuoteTheme: row.defaultQuoteTheme, defaultDocumentFont: row.defaultDocumentFont, defaultShowTaxLine: row.defaultShowTaxLine, defaultShowDiscountLine: row.defaultShowDiscountLine, defaultShowPaidLine: row.defaultShowPaidLine, defaultShowPaymentTerms: row.defaultShowPaymentTerms, defaultShowFooterNotes: row.defaultShowFooterNotes, defaultShowLogo: row.defaultShowLogo, defaultShowCompanyInfo: row.defaultShowCompanyInfo, defaultFootnote: row.defaultFootnote, warrantyTerms: row.warrantyTerms, hourlyCostRate: row.hourlyCostRate, lateFeeType: row.lateFeeType, lateFeeValue: row.lateFeeValue, lateFeeGraceDays: row.lateFeeGraceDays, costAlertPercent: row.costAlertPercent, paymentRemindersEnabled: row.paymentRemindersEnabled, onlineSignatureEnabled: row.onlineSignatureEnabled, overdueInvoiceRemindersEnabled: row.overdueInvoiceRemindersEnabled, overdueReminderDays: row.overdueReminderDays, invoiceGroupBy: row.invoiceGroupBy, addShippingAddress: row.addShippingAddress, addJobSiteAddress: row.addJobSiteAddress, convertToQuote: row.convertToQuote, notificationsEnabled: row.notificationsEnabled, simpleMode: row.simpleMode, logoUrl: row.logoBlobKey ? await ctx.blobs.getUrl(row.logoBlobKey) : null, coverUrl: row.coverBlobKey ? await ctx.blobs.getUrl(row.coverBlobKey) : null }; }}),
  updateSettings: defineAction({ request: settingsInputSchema, response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const rows = await db.select({ id: schema.settings.id }).from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1); if (rows[0]) await db.update(schema.settings).set({ ...args, hourlyCostRate: normalizeMoney(args.hourlyCostRate, "0.00"), lateFeeValue: normalizeMoney(args.lateFeeValue, "0.00"), updatedAt: new Date() }).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)); else await db.insert(schema.settings).values({ ...args, hourlyCostRate: normalizeMoney(args.hourlyCostRate, "0.00"), lateFeeValue: normalizeMoney(args.lateFeeValue, "0.00"), updatedAt: new Date() }); ctx.invalidateQueries(); return { ok: true }; }}),
  uploadLogo: defineAction({ request: z.object({ filename: z.string().min(1).max(240), contentType: z.enum(["image/jpeg", "image/png"]), dataBase64: z.string().min(1).max(10_000_000) }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1); const old = rows[0]; const key = `branding/${crypto.randomUUID()}-${args.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`; await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType }); if (old) await db.update(schema.settings).set({ logoBlobKey: key, updatedAt: new Date() }).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)); else await db.insert(schema.settings).values({ companyName: "", logoBlobKey: key, updatedAt: new Date() }); if (old?.logoBlobKey) await ctx.blobs.delete(old.logoBlobKey); ctx.invalidateQueries(); return { ok: true }; }}),
  uploadCompanyCover: defineAction({ request: z.object({ filename: z.string().min(1).max(240), contentType: z.enum(["image/jpeg", "image/png"]), dataBase64: z.string().min(1).max(14_000_000) }), response: z.object({ ok: z.literal(true) }), async handler(ctx, args): Promise<{ ok: true }> { const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.settings).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)).limit(1); const old = rows[0]; const key = `branding/covers/${crypto.randomUUID()}-${args.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`; await ctx.blobs.put(key, Buffer.from(args.dataBase64, "base64"), { contentType: args.contentType }); if (old) await db.update(schema.settings).set({ coverBlobKey: key, updatedAt: new Date() }).where(eq(schema.settings.companyId, workspaceIdentity(ctx).workspaceCompanyId)); else await db.insert(schema.settings).values({ companyName: "", coverBlobKey: key, updatedAt: new Date() }); if (old?.coverBlobKey) await ctx.blobs.delete(old.coverBlobKey); ctx.invalidateQueries(); return { ok: true }; }}),
} satisfies ActionsModule;

const PUBLIC_ACTIONS = new Set([
  "getAuthBootstrap", "signUp", "verifyEmail", "resendVerification", "login", "logout", "getAuthSession", "requestPasswordReset", "resetPassword", "handleStripeWebhook",
  "getPortalData", "portalUpdateSelection", "portalSignChangeOrder", "resolveDocumentLink", "submitDocumentSignature", "submitEstimateRequest",
]);

const PREMIUM_ACTIONS = new Set([
  "getAutomationCenter", "logAutomationSend", "updateQuoteAutomationStatus", "updateSelectionLeadTime", "renewQuote",
  "getGrowthToolkit", "savePriceBookItem", "deletePriceBookItem", "saveQuoteTemplate", "deleteQuoteTemplate", "saveMileageTrip", "deleteMileageTrip", "saveBusinessExpense", "deleteBusinessExpense", "listSubcontractors", "saveSubcontractor", "deleteSubcontractor", "saveShareImage", "deleteShareImage", "listShareImages", "getWeatherOutlook", "getExpansionSuite", "saveWarranty", "saveSupplier", "saveMaintenancePlan", "completeMaintenancePlan", "saveScannedDocument", "saveSlideshowVideo", "getTaxExport", "getDocumentParameters", "getAdminConsole", "updateSupportReport", "addAppUser", "updateAppUser", "updateAdminParameters", "createPortalLink", "revokePortalLink", "createDocumentLink", "getDocumentLinkInfo", "revokeDocumentLink", "updateJobSiteLocation", "suggestJobsByLocation", "clockInCrew", "clockOutCrew", "getCrewClockStatus", "updateQuoteVersion", "createQuoteVersion", "sendQuoteVersion", "acceptQuoteVersion", "getQuoteVersions", "listMaterialCosts", "saveMaterialCost", "deleteMaterialCost", "getFieldIntelligence", "saveSupplierQuote", "createPurchaseOrder", "updatePurchaseOrderStatus", "receivePurchaseOrder", "saveEquipment", "setEquipmentCheckout", "completeEquipmentMaintenance", "saveSafetyTalk", "saveIncident", "saveCredential", "renewCredential", "saveCrewPayRate", "setJobPhotoRequirements", "completeJob", "deleteFieldTestRecord", "exportBackup", "restoreBackup", "verifyBackupRoundTrip",
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
