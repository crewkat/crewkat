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
check("newest migration tag is 0093_wave2", last.tag === "0093_wave2", last.tag);
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

console.log(failures === 0 ? "\nALL WAVE 2 CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
