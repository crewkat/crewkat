// Wave 2 (items 6-10, Danny 2026-11-01): Pay Now (Stripe Connect,
// two-account correction), proposal analytics + hot proposal,
// reputation inbox, lead capture form + source report, QuickBooks sync
// conflict rule.
//
// Run from app/:  bun wave2.behavior.test.ts   (script-style suite)
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import { BaseActions, stripeApplicationFeeCents } from "./server/src/actions.ts";
import { privileged, privilegedHandlers } from "./server/src/privileged.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function checkThrows(name: string, fn: () => Promise<unknown>) {
  try { await fn(); failures++; console.error(`FAIL ${name} — expected an error but none was thrown`); }
  catch { console.log(`ok   ${name}`); }
}
const A = BaseActions as any;

// --- 1. Migration journal ---------------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
const last = entries[entries.length - 1]!;
check("newest migration tag is 0096_safety", last.tag === "0096_safety", last.tag);
// (Historical pairs like 0035/0036 share a `when` — the production rule
// is that the NEWEST entry must exceed every earlier one.)
check("newest journal when exceeds every earlier entry", last.when > Math.max(...entries.slice(0, -1).map((e) => e.when)), `last=${last.when}`);

// --- 2. Scratch DB + fake privileged transport --------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-wave2-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
const tables = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
for (const t of ["invoice_payment_attempts", "quickbooks_connections", "qb_sync_records", "client_reviews"]) {
  check(`table ${t} exists`, tables.includes(t));
}

// Fake QuickBooks company, driven through the qbApiRequest stub.
const qb = {
  clock: "2026-10-01T01:00:00Z",
  seq: 100,
  customers: new Map<string, Record<string, unknown>>(),
  invoices: new Map<string, Record<string, unknown>>(),
  payments: new Map<string, Record<string, unknown>>(),
};
function qbHandle(args: Record<string, unknown>) {
  const method = String(args.method);
  const path = String(args.path);
  if (path.startsWith("/query?query=")) {
    const q = decodeURIComponent(path.slice("/query?query=".length));
    const entity = /from (\w+)/.exec(q)?.[1] ?? "";
    let rows: Array<Record<string, unknown>> = [];
    if (entity === "Customer") rows = [...qb.customers.values()];
    else if (entity === "Invoice") rows = [...qb.invoices.values()];
    else if (entity === "Payment") rows = [...qb.payments.values()];
    else if (entity === "Item") rows = [];
    else if (entity === "Account") rows = [{ Id: "acc-1" }];
    return { configured: true, status: 200, body: JSON.stringify({ QueryResponse: { [entity]: rows } }) };
  }
  const body = args.body ? JSON.parse(String(args.body)) as Record<string, unknown> : {};
  const stamp = () => ({ LastUpdatedTime: qb.clock });
  if (method === "POST" && path === "/customer") {
    const id = typeof body.Id === "string" ? body.Id : String(++qb.seq);
    const row = { ...body, Id: id, SyncToken: "1", MetaData: stamp() };
    qb.customers.set(id, row);
    return { configured: true, status: 200, body: JSON.stringify(row) };
  }
  if (method === "POST" && path === "/invoice") {
    const id = typeof body.Id === "string" ? body.Id : String(++qb.seq);
    const row = { ...body, Id: id, SyncToken: "1", TotalAmt: 200, Balance: 0, MetaData: stamp() };
    qb.invoices.set(id, row);
    return { configured: true, status: 200, body: JSON.stringify(row) };
  }
  if (method === "POST" && path === "/payment") {
    const id = String(++qb.seq);
    const row = { ...body, Id: id, MetaData: stamp() };
    qb.payments.set(id, row);
    return { configured: true, status: 200, body: JSON.stringify(row) };
  }
  if (method === "POST" && path === "/item") {
    return { configured: true, status: 200, body: JSON.stringify({ Id: "item-1", Name: "Services" }) };
  }
  if (method === "GET" && path.startsWith("/invoice/")) {
    const row = qb.invoices.get(path.slice("/invoice/".length));
    return { configured: true, status: row ? 200 : 404, body: JSON.stringify(row ?? {}) };
  }
  throw new Error(`unexpected QB call ${method} ${path}`);
}

const linkCalls: Array<{ refreshUrl: string; returnUrl: string }> = [];
const ctx = {
  slug: "tradesign",
  invocationId: "wave2-test",
  spaceDir: dir,
  db: () => db,
  unscopedDb: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async (_fn: unknown, args: Record<string, unknown>) => {
    // Stripe webhook verification (Connect op): parse the canned event.
    if (typeof args.payload === "string" && typeof args.signature === "string") {
      const evt = JSON.parse(args.payload) as { id: string; type: string; account?: string; data: { object: Record<string, any> } };
      const obj = evt.data.object;
      const md = (obj.metadata ?? {}) as Record<string, string>;
      return {
        eventId: evt.id, eventType: evt.type, userId: null, customerId: null, subscriptionId: null,
        subscriptionStatus: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
        checkoutType: md.type ?? null, plan: null, listingId: null,
        companyId: md.company_id ? Number(md.company_id) : null, packSize: null,
        stripeSessionId: typeof obj.id === "string" ? obj.id : null,
        invoiceId: md.invoice_id ? Number(md.invoice_id) : null,
        paymentIntentId: typeof obj.payment_intent === "string" ? obj.payment_intent : null,
        amountTotalCents: typeof obj.amount_total === "number" ? obj.amount_total : null,
        paymentMethodType: Array.isArray(obj.payment_method_types) ? obj.payment_method_types[0] ?? null : null,
        paymentStatus: typeof obj.payment_status === "string" ? obj.payment_status : null,
        connectAccountId: evt.account ?? null,
      };
    }
    // QuickBooks transport.
    if (typeof args.accessToken === "string" && typeof args.path === "string") return qbHandle(args);
    if (typeof args.refreshToken === "string") return { configured: true, accessToken: "tok-fresh", refreshToken: "ref-fresh", expiresInSeconds: 3600 };
    if (typeof args.code === "string" && typeof args.redirectUri === "string") return { configured: true, accessToken: "tok-1", refreshToken: "ref-1", expiresInSeconds: 3600 };
    // Stripe Connect transport (Part B gate tests): account create, account
    // link (URLs captured), account read-back, invoice checkout.
    if (typeof args.companyName === "string") return { configured: true, accountId: "acct_fake_1" };
    if (typeof args.refreshUrl === "string" && typeof args.returnUrl === "string") {
      linkCalls.push({ refreshUrl: String(args.refreshUrl), returnUrl: String(args.returnUrl) });
      return { configured: true, url: "https://connect.stripe.test/onboard" };
    }
    if (typeof args.amountCents === "number" && typeof args.invoiceId === "number") {
      return { configured: true, url: "https://checkout.stripe.test/pay", sessionId: `cs_pro_${args.invoiceId}` };
    }
    if (Object.keys(args).length === 1 && typeof args.accountId === "string") {
      return { configured: true, chargesEnabled: true, payoutsEnabled: true };
    }
    // Platform status probes (both take {}): configured + sandbox.
    if (Object.keys(args).length === 0) return { configured: true, environment: "sandbox" };
    throw new Error(`unexpected privileged call ${JSON.stringify(Object.keys(args))}`);
  },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;

const now = new Date();
await db.insert(schema.authUsers).values({ companyId: 1, name: "Danny Owner", email: "owner@test.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH", createdAt: now, updatedAt: now });
await db.insert(schema.settings).values({ id: 1, companyId: 1, companyName: "Wave2 Test Co", phone: "(813) 555-0100", updatedAt: now });

// --- 3. Platform fee math (env-configurable, default 0) ------------------------
delete process.env.STRIPE_APPLICATION_FEE_PERCENT;
check("platform fee defaults to 0 when the env is unset", stripeApplicationFeeCents(10000) === 0);
process.env.STRIPE_APPLICATION_FEE_PERCENT = "2.5";
check("platform fee applies the configured percent", stripeApplicationFeeCents(10000) === 250, String(stripeApplicationFeeCents(10000)));
process.env.STRIPE_APPLICATION_FEE_PERCENT = "0";
check("platform fee of 0 percent stays 0", stripeApplicationFeeCents(10000) === 0);
delete process.env.STRIPE_APPLICATION_FEE_PERCENT;

// --- 4. Pay Now setup state ------------------------------------------------------
const setup0 = await A.getPaymentsSetup.handler(ctx, {});
check("payments setup reports not_connected without a Connect account", setup0.status === "not_connected" && setup0.chargesEnabled === false, JSON.stringify(setup0));

// --- 5. Connect webhook: card payment records + idempotency ----------------------
const [inv1] = await db.insert(schema.invoices).values({ companyId: 1, invoiceNumber: "INV-W2-1", clientName: "Paying Pam", lineItemsJson: "[]", total: "500.00", status: "sent", issueDate: "2026-10-20" }).returning({ id: schema.invoices.id });
await db.insert(schema.invoicePaymentAttempts).values({ companyId: 1, invoiceId: inv1!.id, stripeSessionId: "cs_test_1", amount: "500.00", status: "pending" });
const cardEvent = JSON.stringify({ id: "evt_card_1", type: "checkout.session.completed", account: "acct_test", data: { object: { id: "cs_test_1", payment_intent: "pi_1", amount_total: 50000, payment_status: "paid", payment_method_types: ["card"], metadata: { type: "invoice_payment", invoice_id: String(inv1!.id), company_id: "1" } } } });
const wh1 = await A.handleConnectWebhook.handler(ctx, { payload: cardEvent, signature: "t=1,v1=x" });
check("connect webhook processes the card payment", wh1.processed === true);
const payments1 = await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, inv1!.id));
check("payment recorded against the invoice", payments1.length === 1 && payments1[0]!.amount === "500.00", JSON.stringify(payments1));
check("payment carries the online card method", payments1[0]!.method === "Card (online payment)", payments1[0]?.method);
check("payment is idempotent-keyed by payment intent", payments1[0]!.stripePaymentIntentId === "pi_1");
const inv1After = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv1!.id)))[0]!;
check("invoice flips to paid when the balance clears", inv1After.status === "paid", inv1After.status);
const attempt1 = (await db.select().from(schema.invoicePaymentAttempts).where(eq(schema.invoicePaymentAttempts.stripeSessionId, "cs_test_1")))[0]!;
check("attempt flips to paid with the method", attempt1.status === "paid" && attempt1.method === "Card (online payment)", JSON.stringify(attempt1));
const whDup = await A.handleConnectWebhook.handler(ctx, { payload: cardEvent, signature: "t=1,v1=x" });
check("redelivered event is a duplicate", whDup.duplicate === true);
check("duplicate delivery records no second payment", (await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, inv1!.id))).length === 1);

// ACH: completes unpaid (clearing), then async success settles it.
const [inv2] = await db.insert(schema.invoices).values({ companyId: 1, invoiceNumber: "INV-W2-2", clientName: "Ach Andy", lineItemsJson: "[]", total: "300.00", status: "sent", issueDate: "2026-10-21" }).returning({ id: schema.invoices.id });
await db.insert(schema.invoicePaymentAttempts).values({ companyId: 1, invoiceId: inv2!.id, stripeSessionId: "cs_test_2", amount: "300.00", status: "pending" });
const achPending = JSON.stringify({ id: "evt_ach_1", type: "checkout.session.completed", account: "acct_test", data: { object: { id: "cs_test_2", payment_intent: "pi_2", amount_total: 30000, payment_status: "unpaid", payment_method_types: ["us_bank_account"], metadata: { type: "invoice_payment", invoice_id: String(inv2!.id), company_id: "1" } } } });
await A.handleConnectWebhook.handler(ctx, { payload: achPending, signature: "t=1,v1=x" });
check("ACH clearing records no payment yet", (await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, inv2!.id))).length === 0);
const attempt2 = (await db.select().from(schema.invoicePaymentAttempts).where(eq(schema.invoicePaymentAttempts.stripeSessionId, "cs_test_2")))[0]!;
check("ACH attempt stays pending with the PI stored", attempt2.status === "pending" && attempt2.stripePaymentIntentId === "pi_2", JSON.stringify(attempt2));
const achDone = JSON.stringify({ id: "evt_ach_2", type: "checkout.session.async_payment_succeeded", account: "acct_test", data: { object: { id: "cs_test_2", payment_intent: "pi_2", amount_total: 30000, payment_status: "paid", payment_method_types: ["us_bank_account"], metadata: { type: "invoice_payment", invoice_id: String(inv2!.id), company_id: "1" } } } });
await A.handleConnectWebhook.handler(ctx, { payload: achDone, signature: "t=1,v1=x" });
const payments2 = await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, inv2!.id));
check("ACH settle records the payment with the ACH method", payments2.length === 1 && payments2[0]!.method === "ACH (online payment)", JSON.stringify(payments2));

// Subscription handler never sees invoice payments (two-account split):
const subWh = await A.handleStripeWebhook.handler(ctx, { payload: cardEvent, signature: "t=1,v1=x" }).catch(() => null);
check("subscription webhook does not record invoice payments", (await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, inv1!.id))).length === 1 && subWh === null || subWh?.processed === false, JSON.stringify(subWh));

// --- 6. Proposal analytics + hot proposal ---------------------------------------
const jobId = (await db.insert(schema.jobs).values({ companyId: 1, clientName: "Hot Harry", clientEmail: "harry@example.com", jobAddress: "9 Pine St", jobType: "Bathroom remodel", jobDate: "2026-10-19", createdAt: now, updatedAt: now }).returning({ id: schema.jobs.id }))[0]!.id;
const docFields = { jobId, clientId: null, clientPhone: "", clientEmail: "harry@example.com", shippingAddress: "", jobType: "Bathroom remodel", jobAddress: "9 Pine St", discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0", footnote: "", expiryDate: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a", depositType: "none", depositValue: "0", materials: [] };
const line = [{ name: "Tile", description: "Tile work", amount: "2000.00", quantity: 1 }];
const quote = await A.saveQuote.handler(ctx, { ...docFields, clientName: "Hot Harry", lineItems: line, subtotal: "2000.00", total: "2000.00", sentAt: "2026-10-25" });
const quoteLink = await A.createDocumentLink.handler(ctx, { kind: "quote", id: quote.id });
await A.resolveDocumentLink.handler(ctx, { token: quoteLink.token, userAgent: "test" });
check("first open queues no hot-proposal follow-up", (await db.select().from(schema.followUps).where(eq(schema.followUps.recipe, "hot_proposal"))).length === 0);
await A.resolveDocumentLink.handler(ctx, { token: quoteLink.token, userAgent: "test" });
const hotTasks = await db.select().from(schema.followUps).where(eq(schema.followUps.recipe, "hot_proposal"));
check("second open queues exactly one hot-proposal follow-up", hotTasks.length === 1 && hotTasks[0]!.jobId === jobId, JSON.stringify(hotTasks.map((t) => t.sourceKey)));
await A.resolveDocumentLink.handler(ctx, { token: quoteLink.token, userAgent: "test" });
check("third open queues no second follow-up", (await db.select().from(schema.followUps).where(eq(schema.followUps.recipe, "hot_proposal"))).length === 1);
const analytics = await A.getProposalAnalytics.handler(ctx, {});
const quoteAnalytics = analytics.items.find((i: any) => i.kind === "quote" && i.documentId === quote.id);
check("analytics show sent -> opened -> 3 views", !!quoteAnalytics && quoteAnalytics.viewCount === 3 && !!quoteAnalytics.firstViewedAt && quoteAnalytics.sentAt === "2026-10-25", JSON.stringify(quoteAnalytics));
check("unsigned quote reports signed=false and no fabricated signedAt", quoteAnalytics?.signed === false && quoteAnalytics?.signedAt === null);
const recipes = await A.getAutomationSettings.handler(ctx, {});
check("hot proposal is a recipe, default ON", recipes.recipes.some((r: any) => r.key === "hot_proposal" && r.enabled === true), JSON.stringify(recipes.recipes.map((r: any) => r.key)));

// --- 7. Reputation inbox -----------------------------------------------------------
await db.insert(schema.automationLogs).values({ companyId: 1, kind: "review", entityId: jobId, stage: "Job completed", channel: "email", sentAt: new Date() });
const inbox0 = await A.getReputationInbox.handler(ctx, {});
check("inbox lists the sent request as not posted", inbox0.requests.length === 1 && inbox0.requests[0]!.posted === false && inbox0.requests[0]!.jobId === jobId, JSON.stringify(inbox0.requests));
check("google feed is honestly gated off", inbox0.googleConnected === false);
await A.recordPostedReview.handler(ctx, { jobId, clientId: null, clientName: "", rating: 5, text: "Fantastic work.", reviewDate: "2026-10-30", source: "manual" });
const inbox1 = await A.getReputationInbox.handler(ctx, {});
check("recording the review marks the request posted", inbox1.requests[0]!.posted === true, JSON.stringify(inbox1.requests));
check("posted review is captured with rating + text", inbox1.reviews.length === 1 && inbox1.reviews[0]!.rating === 5 && inbox1.reviews[0]!.clientName === "Hot Harry", JSON.stringify(inbox1.reviews));

// --- 8. Lead capture form + source report -------------------------------------------
const capture = await A.getLeadCaptureInfo.handler(ctx, {});
check("lead capture info yields a code + hosted url", capture.code.length >= 8 && capture.url.endsWith(`/lead/${capture.code}`), capture.url);
check("embed snippet points at the same form", capture.embedSnippet.includes(capture.url));
const leadSubmit = await A.submitLeadForm.handler(ctx, { code: capture.code, variant: "google-profile", name: "Form Fred", phone: "(813) 555-7777", email: "fred@example.com", address: "1 Form Way", serviceType: "Kitchen remodel", message: "Want a quote", company: "" });
const leadRow = (await db.select().from(schema.leads).where(eq(schema.leads.id, leadSubmit.id)))[0]!;
check("form submission lands as a pipeline lead with the variant source", leadRow.source === "form:google-profile" && leadRow.companyId === 1 && leadRow.stage === "new", JSON.stringify(leadRow));
await checkThrows("honeypot submission is rejected", () => A.submitLeadForm.handler(ctx, { code: capture.code, variant: "website", name: "Bot Bob", phone: "(813) 555-7778", email: "", address: "", serviceType: "Spam", message: "", company: "spammy" }));
await checkThrows("unknown form code is rejected", () => A.submitLeadForm.handler(ctx, { code: "zzzzzzzz", variant: "website", name: "Nope Ned", phone: "(813) 555-7779", email: "", address: "", serviceType: "Nope", message: "", company: "" }));
await db.update(schema.leads).set({ stage: "won", estimatedValue: "12000" }).where(eq(schema.leads.id, leadSubmit.id));
const report = await A.getLeadSourceReport.handler(ctx, {});
const formRow = report.rows.find((r: any) => r.source === "form:google-profile");
check("source report splits by source with close rate + won value", !!formRow && formRow.count === 1 && formRow.wonCount === 1 && formRow.closeRate === 100 && formRow.wonValue === "12000.00", JSON.stringify(report.rows));

// --- 9. QuickBooks: connect state, first sync, conflict rule -------------------------
const qbStatus0 = await A.getQuickBooksStatus.handler(ctx, {});
check("quickbooks starts disconnected with the platform configured", qbStatus0.status === "not_connected" && qbStatus0.configured === true, JSON.stringify(qbStatus0));
await db.insert(schema.quickbooksConnections).values({ companyId: 1, realmId: "9341454758971050", accessToken: "tok-1", refreshToken: "ref-1", accessTokenExpiresAt: new Date(Date.now() + 3600_000), status: "connected" });
const [syncClient] = await db.insert(schema.clients).values({ companyId: 1, name: "Sync Client", email: "crewkat@example.com", phone: "(813) 555-1212", address: "5 Sync St", createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: new Date("2026-10-01T00:00:00Z") }).returning({ id: schema.clients.id });
const sync1 = await A.runQuickBooksSync.handler(ctx, {});
// (errors > 0 is expected here: the section-5 invoices have no linked
// client, so they surface as sync errors — the centre working as intended.)
check("first sync pushes the customer", sync1.pushed >= 1 && qb.customers.size === 1, JSON.stringify(sync1));
const custRecord = (await db.select().from(schema.qbSyncRecords).where(and(eq(schema.qbSyncRecords.entityType, "customer"), eq(schema.qbSyncRecords.entityId, syncClient!.id))))[0]!;
check("customer record is synced with a QB id", custRecord.status === "synced" && !!custRecord.qbId, JSON.stringify(custRecord));
const connAfter = (await db.select().from(schema.quickbooksConnections).where(eq(schema.quickbooksConnections.companyId, 1)))[0]!;
check("default Services item stored after first sync", connAfter.defaultItemId === "item-1", connAfter.defaultItemId);
check("last sync time recorded", !!connAfter.lastSyncAt);

// Both sides change; QuickBooks is newer -> QB wins, flagged as conflict.
await db.update(schema.clients).set({ phone: "(813) 555-9999", updatedAt: new Date("2026-10-03T00:00:00Z") }).where(eq(schema.clients.id, syncClient!.id));
const qbCust = qb.customers.get(custRecord.qbId!)!;
qbCust.PrimaryEmailAddr = { Address: "qb-edited@example.com" };
qbCust.MetaData = { LastUpdatedTime: "2026-10-04T00:00:00Z" };
qb.clock = "2026-10-04T00:00:00Z";
const sync2 = await A.runQuickBooksSync.handler(ctx, {});
const clientAfter = (await db.select().from(schema.clients).where(eq(schema.clients.id, syncClient!.id)))[0]!;
check("both-changed conflict resolves last-write-wins (QuickBooks newer)", clientAfter.email === "qb-edited@example.com", clientAfter.email);
const custRecord2 = (await db.select().from(schema.qbSyncRecords).where(and(eq(schema.qbSyncRecords.entityType, "customer"), eq(schema.qbSyncRecords.entityId, syncClient!.id))))[0]!;
check("conflict is surfaced on the sync record, not silent", custRecord2.status === "conflict" && custRecord2.error.includes("QuickBooks was newer"), JSON.stringify(custRecord2));
check("sync summary counts the conflict", sync2.conflicts >= 1, JSON.stringify(sync2));

// Invoice + payment push.
const [qbInv] = await db.insert(schema.invoices).values({ companyId: 1, clientId: syncClient!.id, invoiceNumber: "INV-QB-1", clientName: "Sync Client", lineItemsJson: JSON.stringify([{ description: "Remodel work", amount: "200.00", quantity: 1 }]), subtotal: "200.00", total: "200.00", status: "sent", issueDate: "2026-10-10" }).returning({ id: schema.invoices.id });
const [qbPay] = await db.insert(schema.payments).values({ companyId: 1, invoiceId: qbInv!.id, amount: "200.00", paymentDate: "2026-10-12", method: "Check" }).returning({ id: schema.payments.id });
const sync3 = await A.runQuickBooksSync.handler(ctx, {});
const invRecord = (await db.select().from(schema.qbSyncRecords).where(and(eq(schema.qbSyncRecords.entityType, "invoice"), eq(schema.qbSyncRecords.entityId, qbInv!.id))))[0]!;
check("invoice pushes to QuickBooks", invRecord?.status === "synced" && !!invRecord?.qbId && qb.invoices.size === 1, JSON.stringify({ invRecord, sync3 }));
const payRecord = (await db.select().from(schema.qbSyncRecords).where(and(eq(schema.qbSyncRecords.entityType, "payment"), eq(schema.qbSyncRecords.entityId, qbPay!.id))))[0]!;
check("payment pushes linked to the synced invoice", !!payRecord?.qbId && qb.payments.size === 1, JSON.stringify(payRecord));
const qbRecords = await A.listQbSyncRecords.handler(ctx, {});
check("sync status centre lists records with labels", qbRecords.records.length >= 3 && qbRecords.records.every((r: any) => r.label.length > 0), JSON.stringify(qbRecords.records.map((r: any) => r.label)));

// --- 10. Pay Now is Pro-only (Danny 2026-11-01) ---------------------------------
// The seeded owner (user 1) is free-tier (schema default). Entitlement
// resolves from the OWNER's row, not the caller's claims.
const ownerRow = () => db.select().from(schema.authUsers).where(eq(schema.authUsers.id, 1)).then((r) => r[0]!);
const settingsRow = () => db.select().from(schema.settings).where(eq(schema.settings.companyId, 1)).then((r) => r[0]!);
check("seeded owner starts free-tier", (await ownerRow()).tier === "free", (await ownerRow()).tier);
const setupGate0 = await A.getPaymentsSetup.handler(ctx, {});
check("setup shape reports proActive=false for a free company", setupGate0.proActive === false, JSON.stringify(setupGate0));
await checkThrows("non-Pro onboarding is refused (default surface)", () => A.startConnectOnboarding.handler(ctx, {}));
await checkThrows("non-Pro onboarding is refused (app surface)", () => A.startConnectOnboarding.handler(ctx, { surface: "app" }));
check("refused onboarding persists no Connect account", (await settingsRow()).stripeConnectAccountId === null, (await settingsRow()).stripeConnectAccountId ?? "null");
check("refused onboarding never reaches Stripe", linkCalls.length === 0);

// Connect wired by hand (as if connected while Pro, then lapsed): the
// client-facing surfaces must still hide/refuse Pay Now for free.
await db.update(schema.settings).set({ stripeConnectAccountId: "acct_test", stripeChargesEnabled: true, stripePayoutsEnabled: true, stripeConnectStatus: "connected" }).where(eq(schema.settings.companyId, 1));
const [invGate] = await db.insert(schema.invoices).values({ companyId: 1, jobId, invoiceNumber: "INV-W2-GATE", clientName: "Gate Gail", clientEmail: "gail@example.com", lineItemsJson: "[]", total: "120.00", status: "sent", issueDate: "2026-10-28" }).returning({ id: schema.invoices.id });
const gateLink = await A.createDocumentLink.handler(ctx, { kind: "invoice", id: invGate!.id });
const gatePayloadFree = await A.resolveDocumentLink.handler(ctx, { token: gateLink.token, userAgent: "test" });
check("invoice link hides Pay Now for a non-Pro company even with charges enabled", gatePayloadFree.payNowAvailable === false, JSON.stringify(gatePayloadFree.payNowAvailable));
await checkThrows("non-Pro checkout creation is refused", () => A.createDocumentInvoicePayment.handler(ctx, { token: gateLink.token }));
const portalLink = await A.createPortalLink.handler(ctx, { jobId, expiresInDays: 90 });
const portalFree = await A.getPortalData.handler(ctx, { token: portalLink.token });
check("portal hides Pay Now for a non-Pro company", portalFree.payNowAvailable === false);
await checkThrows("non-Pro portal checkout is refused", () => A.createPortalInvoicePayment.handler(ctx, { token: portalLink.token, invoiceId: invGate!.id }));

// Upgrade the owner to Premium: every gate opens.
await db.update(schema.authUsers).set({ tier: "premium", subscriptionStatus: "active" }).where(eq(schema.authUsers.id, 1));
const setupGate1 = await A.getPaymentsSetup.handler(ctx, {});
check("setup shape reports proActive=true for a Premium company", setupGate1.proActive === true, JSON.stringify(setupGate1));

// Onboarding from scratch: app surface returns Stripe to /app, the
// default (Office) surface to /office — byte-identical to before.
await db.update(schema.settings).set({ stripeConnectAccountId: null, stripeChargesEnabled: false, stripePayoutsEnabled: false, stripeConnectStatus: "not_connected" }).where(eq(schema.settings.companyId, 1));
const onboardApp = await A.startConnectOnboarding.handler(ctx, { surface: "app" });
check("Pro onboarding returns a Stripe URL", onboardApp.platformConfigured === true && typeof onboardApp.url === "string" && onboardApp.url.length > 0, JSON.stringify(onboardApp));
check("app-surface onboarding returns to /app", linkCalls.at(-1)?.returnUrl.endsWith("/app") === true && linkCalls.at(-1)?.refreshUrl.endsWith("/app") === true, JSON.stringify(linkCalls.at(-1)));
check("onboarding persisted the created account as onboarding", (await settingsRow()).stripeConnectAccountId === "acct_fake_1" && (await settingsRow()).stripeConnectStatus === "onboarding", JSON.stringify((await settingsRow()).stripeConnectAccountId));
const onboardOffice = await A.startConnectOnboarding.handler(ctx, {});
check("default-surface onboarding returns to /office (unchanged)", linkCalls.at(-1)?.returnUrl.endsWith("/office") === true, JSON.stringify(linkCalls.at(-1)));

// Founder premium (tier "premium" + subscriptionStatus "founder" —
// Danny's own account shape) passes every gate too.
await db.update(schema.authUsers).set({ subscriptionStatus: "founder" }).where(eq(schema.authUsers.id, 1));
const setupFounder = await A.getPaymentsSetup.handler(ctx, {});
check("founder premium reports proActive=true", setupFounder.proActive === true, JSON.stringify(setupFounder));
const onboardFounder = await A.startConnectOnboarding.handler(ctx, { surface: "app" });
check("founder premium can onboard", typeof onboardFounder.url === "string" && onboardFounder.url.length > 0, JSON.stringify(onboardFounder));
await db.update(schema.authUsers).set({ subscriptionStatus: "active" }).where(eq(schema.authUsers.id, 1));

// Status refresh flips the company to connected (fake account read-back
// reports charges + payouts enabled).
const refreshed = await A.refreshConnectStatus.handler(ctx, {});
check("refresh reports connected + proActive for Pro", refreshed.status === "connected" && refreshed.chargesEnabled === true && refreshed.proActive === true, JSON.stringify(refreshed));

// Pro checkout: link + portal show Pay Now, checkout creates an attempt.
const gatePayloadPro = await A.resolveDocumentLink.handler(ctx, { token: gateLink.token, userAgent: "test" });
check("invoice link shows Pay Now for Pro + connected + balance", gatePayloadPro.payNowAvailable === true);
const checkoutPro = await A.createDocumentInvoicePayment.handler(ctx, { token: gateLink.token });
check("Pro checkout returns a Stripe URL", typeof checkoutPro.url === "string" && checkoutPro.url.length > 0, JSON.stringify(checkoutPro));
const gateAttempt = (await db.select().from(schema.invoicePaymentAttempts).where(eq(schema.invoicePaymentAttempts.invoiceId, invGate!.id)))[0]!;
check("checkout recorded a pending attempt", gateAttempt?.status === "pending" && gateAttempt?.stripeSessionId === `cs_pro_${invGate!.id}`, JSON.stringify(gateAttempt));
const portalPro = await A.getPortalData.handler(ctx, { token: portalLink.token });
check("portal shows Pay Now for Pro", portalPro.payNowAvailable === true);

// Lapse AFTER the client started paying: new checkouts stop, surfaces
// hide the button — but the in-flight payment still records via the
// webhook (the webhook is deliberately NOT gated).
await db.update(schema.authUsers).set({ tier: "free", subscriptionStatus: "canceled" }).where(eq(schema.authUsers.id, 1));
const gatePayloadLapsed = await A.resolveDocumentLink.handler(ctx, { token: gateLink.token, userAgent: "test" });
check("lapsed company link hides Pay Now again", gatePayloadLapsed.payNowAvailable === false);
await checkThrows("lapsed company cannot start a new checkout", () => A.createDocumentInvoicePayment.handler(ctx, { token: gateLink.token }));
const lapseEvent = JSON.stringify({ id: "evt_pro_lapse", type: "checkout.session.completed", account: "acct_fake_1", data: { object: { id: `cs_pro_${invGate!.id}`, payment_intent: "pi_pro_lapse", amount_total: 12000, payment_status: "paid", payment_method_types: ["card"], metadata: { type: "invoice_payment", invoice_id: String(invGate!.id), company_id: "1" } } } });
const whLapse = await A.handleConnectWebhook.handler(ctx, { payload: lapseEvent, signature: "t=1,v1=x" });
check("webhook still processes a payment that settles after the lapse", whLapse.processed === true, JSON.stringify(whLapse));
const lapsePayments = await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, invGate!.id));
check("post-lapse settlement records the payment in full", lapsePayments.length === 1 && lapsePayments[0]!.amount === "120.00", JSON.stringify(lapsePayments));
const invGateAfter = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, invGate!.id)))[0]!;
check("post-lapse settlement flips the invoice to paid", invGateAfter.status === "paid", invGateAfter.status);

// --- 11. Stripe's real error rides out (Danny 2026-11-01) ---------------------
// The sections above stub executePrivileged wholesale. Here the ctx
// delegates the four Connect contracts to the REAL privileged handlers
// and fakes only the global fetch (Stripe's transport): a Stripe error
// body must surface in the action's thrown error, so the app can show
// Stripe's own reason instead of "Could not open Stripe right now."
// The same faked transport also pins the Accounts v2 wire shapes
// (Managed Risk: v1 creation is refused for this platform) and the
// v2 → contract status mapping.
async function checkThrowsMessage(name: string, fn: () => Promise<unknown>, ...needles: string[]) {
  try { await fn(); failures++; console.error(`FAIL ${name} — expected an error but none was thrown`); }
  catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    const missing = needles.filter((n) => !message.includes(n));
    if (missing.length === 0) console.log(`ok   ${name}`);
    else { failures++; console.error(`FAIL ${name} — error "${message}" is missing ${JSON.stringify(missing)}`); }
  }
}
const connectHandlerFor = (contract: unknown) => (privilegedHandlers.entries as Array<{ contract: unknown; handler: (args: any) => Promise<any> }>).find((e) => e.contract === contract)!.handler;
// Dispatch by contract NAME, exactly like server.mjs: the actions
// import their contracts via the "@space/privileged" alias (a different
// module instance than this file's), so object identity never matches.
const realConnectHandlers = new Map<string, (args: any) => Promise<any>>();
for (const name of ["createConnectAccount", "createConnectAccountLink", "getConnectAccount", "createInvoiceCheckout"] as const) {
  realConnectHandlers.set(name, connectHandlerFor(privileged[name]));
}
check("connect contracts carry dispatch names", [...realConnectHandlers.keys()].every((n) => (privileged as any)[n]?.name === n), JSON.stringify([...realConnectHandlers.keys()]));
const ctxStripe: any = {
  ...ctx,
  executePrivileged: async (fn: unknown, args: Record<string, unknown>) => {
    const handler = realConnectHandlers.get((fn as any)?.name ?? "");
    if (handler) return handler(args);
    return (ctx as any).executePrivileged(fn, args);
  },
};
// Back to Pro so onboarding reaches Stripe at all.
await db.update(schema.authUsers).set({ tier: "premium", subscriptionStatus: "active" }).where(eq(schema.authUsers.id, 1));
await db.update(schema.settings).set({ stripeConnectAccountId: null, stripeChargesEnabled: false, stripePayoutsEnabled: false, stripeConnectStatus: "not_connected" }).where(eq(schema.settings.companyId, 1));
const realFetch = globalThis.fetch;
const savedConnectKey = process.env.STRIPE_CONNECT_SECRET_KEY;
process.env.STRIPE_CONNECT_SECRET_KEY = "sk_test_connect_fake";
let stripeMode: "create-error" | "link-error" | "ok" | "readback-restricted" = "create-error";
// Accounts v2 fixtures, mirrored on the Retrieve-account API reference
// example response (configuration.merchant.capabilities.<name>.status +
// requirements.entries): "restricted" with a requirements_past_due
// status_detail before onboarding completes, "active" + no outstanding
// holder requirements once it has.
const v2ReadbackRestricted = {
  id: "acct_real_1", object: "v2.core.account", applied_configurations: ["merchant"], dashboard: "express", livemode: false,
  configuration: { merchant: { capabilities: {
    card_payments: { status: "restricted", status_details: [{ code: "requirements_past_due", resolution: "provide_info" }] },
    stripe_balance: { payouts: { status: "restricted", status_details: [{ code: "requirements_past_due", resolution: "provide_info" }] } },
  } } },
  requirements: { collector: "stripe", entries: [
    { description: "identity.business_details.registered_name", awaiting_action_from: "user", minimum_deadline: { status: "past_due" }, errors: [], requested_reasons: [{ code: "routine_onboarding" }] },
  ] },
};
const v2ReadbackReady = {
  id: "acct_real_1", object: "v2.core.account", applied_configurations: ["merchant"], dashboard: "express", livemode: false,
  configuration: { merchant: { capabilities: {
    card_payments: { status: "active" },
    stripe_balance: { payouts: { status: "active" } },
  } } },
  requirements: { collector: "stripe", entries: [] },
};
type CapturedStripeRequest = { url: string; method: string; headers: Record<string, string>; json: any };
const stripeRequests: CapturedStripeRequest[] = [];
try {
  globalThis.fetch = (async (url: unknown, init?: any) => {
    const u = String(url);
    const capture = () => {
      let json: any = null;
      try { json = typeof init?.body === "string" ? JSON.parse(init.body) : null; } catch { /* not a JSON body */ }
      const entry: CapturedStripeRequest = { url: u, method: String(init?.method ?? "GET"), headers: (init?.headers ?? {}) as Record<string, string>, json };
      stripeRequests.push(entry);
      return entry;
    };
    if (u.startsWith("https://api.stripe.com/v2/core/accounts/")) {
      capture();
      return { ok: true, status: 200, json: async () => (stripeMode === "readback-restricted" ? v2ReadbackRestricted : v2ReadbackReady) };
    }
    if (u === "https://api.stripe.com/v2/core/accounts") {
      capture();
      if (stripeMode === "create-error") return { ok: false, status: 400, json: async () => ({ error: { message: "You must complete your platform profile before creating connected accounts.", code: "platform_profile_incomplete" } }) };
      return { ok: true, status: 200, json: async () => ({ id: "acct_real_1", object: "v2.core.account" }) };
    }
    if (u === "https://api.stripe.com/v2/core/account_links") {
      capture();
      if (stripeMode === "link-error") return { ok: false, status: 400, json: async () => ({ error: { message: "The provided account is not eligible for onboarding.", code: "account_invalid" } }) };
      return { ok: true, status: 200, json: async () => ({ object: "v2.core.account_link", url: "https://connect.stripe.com/setup/s/real_link" }) };
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;

  await checkThrowsMessage("account-creation failure carries Stripe's message + code",
    () => A.startConnectOnboarding.handler(ctxStripe, { surface: "app" }),
    "connected account: You must complete your platform profile", "platform_profile_incomplete");
  check("failed account creation persists nothing", (await settingsRow()).stripeConnectAccountId === null, (await settingsRow()).stripeConnectAccountId ?? "null");

  stripeMode = "link-error";
  await checkThrowsMessage("account-link failure carries Stripe's message + code",
    () => A.startConnectOnboarding.handler(ctxStripe, { surface: "app" }),
    "start onboarding: The provided account is not eligible", "account_invalid");
  check("the created account still persisted before the link failed", (await settingsRow()).stripeConnectAccountId === "acct_real_1" && (await settingsRow()).stripeConnectStatus === "onboarding", JSON.stringify((await settingsRow()).stripeConnectAccountId));

  stripeMode = "ok";
  const onboardReal = await A.startConnectOnboarding.handler(ctxStripe, { surface: "app" });
  check("success path through the real handlers is unchanged", onboardReal.platformConfigured === true && onboardReal.url === "https://connect.stripe.com/setup/s/real_link", JSON.stringify(onboardReal));

  // Accounts v2 request shapes (Danny 2026-11-01): the platform carries
  // Stripe as losses collector (Managed Risk), so v1 creation is
  // refused — assert what actually goes over the wire.
  const createReq = stripeRequests.filter((r) => r.url === "https://api.stripe.com/v2/core/accounts" && r.method === "POST").at(-1)!;
  check("account creation posts to the Accounts v2 endpoint", !!createReq, JSON.stringify(stripeRequests.map((r) => r.url)));
  check("v2 create carries the preview Stripe-Version header", createReq.headers["Stripe-Version"] === "2026-10-28.preview", createReq.headers["Stripe-Version"] ?? "missing");
  check("v2 create sends NO legacy type field", !!createReq.json && !("type" in createReq.json), JSON.stringify(createReq.json));
  check("v2 create sets dashboard express (the v1 Express equivalent)", createReq.json?.dashboard === "express", createReq.json?.dashboard ?? "missing");
  check("v2 create sets Stripe as fees + losses collector (Managed Risk)",
    createReq.json?.defaults?.responsibilities?.fees_collector === "stripe" && createReq.json?.defaults?.responsibilities?.losses_collector === "stripe",
    JSON.stringify(createReq.json?.defaults?.responsibilities));
  check("v2 create requests the merchant card_payments capability", createReq.json?.configuration?.merchant?.capabilities?.card_payments?.requested === true, JSON.stringify(createReq.json?.configuration));
  check("v2 create maps email/name/country/metadata",
    createReq.json?.contact_email === "owner@test.com" && createReq.json?.display_name === "Wave2 Test Co" && createReq.json?.identity?.country === "US" && createReq.json?.metadata?.company_id === "1" && createReq.json?.metadata?.type === "crewkat_connect",
    JSON.stringify(createReq.json));
  const linkReq = stripeRequests.filter((r) => r.url === "https://api.stripe.com/v2/core/account_links" && r.method === "POST").at(-1)!;
  check("account link posts to the v2 account_links endpoint", !!linkReq, JSON.stringify(stripeRequests.map((r) => r.url)));
  check("v2 link uses the account_onboarding use case for the merchant configuration",
    linkReq.json?.account === "acct_real_1" && linkReq.json?.use_case?.type === "account_onboarding" && JSON.stringify(linkReq.json?.use_case?.account_onboarding?.configurations) === JSON.stringify(["merchant"]),
    JSON.stringify(linkReq.json));
  check("v2 link maps the return/refresh URLs from the action",
    String(linkReq.json?.use_case?.account_onboarding?.return_url ?? "").endsWith("/app") && String(linkReq.json?.use_case?.account_onboarding?.refresh_url ?? "").endsWith("/app"),
    JSON.stringify(linkReq.json?.use_case?.account_onboarding));

  // v2 read-back mapping: restricted (docs example shape) keeps the
  // company in onboarding with every flag off; active + no outstanding
  // holder requirements flips it to connected.
  const getConnectAccount = realConnectHandlers.get("getConnectAccount")!;
  stripeMode = "readback-restricted";
  const restricted = await getConnectAccount({ accountId: "acct_real_1" });
  check("v2 restricted read-back maps to charges/payouts off + details not submitted",
    restricted.configured === true && restricted.chargesEnabled === false && restricted.payoutsEnabled === false && restricted.detailsSubmitted === false,
    JSON.stringify(restricted));
  const refreshedRestricted = await A.refreshConnectStatus.handler(ctxStripe, {});
  check("refresh on a restricted v2 account stays onboarding", refreshedRestricted.status === "onboarding" && refreshedRestricted.chargesEnabled === false, JSON.stringify(refreshedRestricted));
  const getReq = stripeRequests.filter((r) => r.method === "GET").at(-1)!;
  check("v2 read asks for the merchant configuration + requirements",
    new URL(getReq.url).searchParams.get("include[0]") === "configuration.merchant" && new URL(getReq.url).searchParams.get("include[1]") === "requirements",
    getReq.url);
  stripeMode = "ok";
  const ready = await getConnectAccount({ accountId: "acct_real_1" });
  check("v2 ready read-back maps to charges/payouts on + details submitted",
    ready.configured === true && ready.chargesEnabled === true && ready.payoutsEnabled === true && ready.detailsSubmitted === true,
    JSON.stringify(ready));
  const refreshedReady = await A.refreshConnectStatus.handler(ctxStripe, {});
  check("refresh on a ready v2 account flips the company to connected", refreshedReady.status === "connected" && refreshedReady.chargesEnabled === true && refreshedReady.payoutsEnabled === true, JSON.stringify(refreshedReady));
  check("connected v2 state persisted to settings", (await settingsRow()).stripeConnectStatus === "connected" && (await settingsRow()).stripeChargesEnabled === true && (await settingsRow()).stripePayoutsEnabled === true, JSON.stringify((await settingsRow()).stripeConnectStatus));
} finally {
  globalThis.fetch = realFetch;
  if (savedConnectKey === undefined) delete process.env.STRIPE_CONNECT_SECRET_KEY; else process.env.STRIPE_CONNECT_SECRET_KEY = savedConnectKey;
}

console.log(failures === 0 ? "\nALL WAVE 2 CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
