// Freemium behavior tests.
//
// Covers:
//  1. Free jobs 1-3 succeed; job 4 fails with FREE_JOB_LIMIT.
//  2. Completing a job (set completedAt) frees a slot — job 4 then succeeds.
//  3. Premium user (tier="premium") can create unlimited jobs (5+).
//  4. Free invoices 1-5 succeed; invoice 6 fails with FREE_INVOICE_LIMIT.
//  5. Existing invoice edits (updateInvoiceDocument) remain allowed at the limit.
//  6. Company A jobs/invoices never count toward Company B's limits.
//  7. Lifetime checkout (plan="lifetime") requires STRIPE_FOUNDING_PRICE_ID —
//     without it, returns configured:false with missing containing the key.
//  8. Lifetime webhook grants permanent Premium exactly once (idempotent on
//     repeat delivery with a different eventId).
//  9. Founding-member cap never exceeds 100 — 100 pre-inserted, the 101st
//     grant fails atomically and the count stays at 100.
//
// Run from app/:  bun freemium.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";
import { privileged, privilegedHandlers } from "./server/src/privileged.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- 1. Scratch DB -----------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-freemium-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

function makeCtx(companyId: number, userId: number, executePrivileged: (fn: any, args: any) => Promise<any>) {
  return {
    slug: "tradesign",
    invocationId: `freemium-test-c${companyId}-u${userId}`,
    spaceDir: dir,
    db: () => db,
    blobs: {
      put: async () => {},
      getUrl: async (key: string) => `blob://test/${key}`,
      get: async () => Buffer.alloc(0),
      delete: async () => {},
      head: async () => ({ contentType: "application/octet-stream", size: 0 }),
    },
    executePrivileged,
    emit: () => {},
    invalidateQueries: () => {},
    workspaceCompanyId: companyId,
    workspaceUserId: userId,
  } as any;
}
const noPrivileged = async () => { throw new Error("not stubbed"); };

// --- Users -------------------------------------------------------------------
// user 1: company 1, free   (job/invoice ceiling tests)
// user 2: company 2, free   (isolation test)
// user 3: company 1, premium (unlimited test)
// user 4: company 1, free   (lifetime webhook test)
// user 5: company 1, free   (cap test: the 101st)
const userRows = await db.insert(schema.authUsers).values([
  { companyId: 1, name: "Free One", email: "free1@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, tier: "free", referralCode: "FREE0001" },
  { companyId: 2, name: "Free Two", email: "free2@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, tier: "free", referralCode: "FREE0002" },
  { companyId: 1, name: "Premium One", email: "premium1@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, tier: "premium", referralCode: "PREM0001" },
  { companyId: 1, name: "Founder Prospect", email: "founder@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, tier: "free", referralCode: "FOUN0001" },
  { companyId: 1, name: "Cap Attempt", email: "cap101@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, tier: "free", referralCode: "CAP00101" },
]).returning({ id: schema.authUsers.id });
const [user1, user2, user3, user4, user5] = userRows.map((r) => r!.id);
await db.insert(schema.settings).values({ companyId: 1, companyName: "Stallions Test Co" });
await db.insert(schema.settings).values({ companyId: 2, companyName: "Second Test Co" });

const ctxFree1 = makeCtx(1, user1, noPrivileged);
const ctxFree2 = makeCtx(2, user2, noPrivileged);
const ctxPremium = makeCtx(1, user3, noPrivileged);

const jobArgs = (n: number) => ({
  clientId: null, clientName: `Job Client ${n}`, clientPhone: "", clientEmail: "",
  jobAddress: `${n} Test St`, jobType: "Remodel", notes: "", jobDate: "2026-09-29",
  appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "",
});

const invoiceArgs = (n: number) => ({
  invoiceNumber: "", quoteId: null, jobId: null, clientId: null,
  clientName: `Invoice Client ${n}`, clientPhone: "", clientEmail: "",
  jobAddress: `${n} Test St`, shippingAddress: "", jobType: "Remodel",
  lineItems: [{ description: "Labor", amount: "500.00" }],
  subtotal: "500.00", discountType: "percent" as const, discountValue: "0",
  taxType: "percent" as const, taxValue: "0", total: "500.00", footnote: "",
  issueDate: "2026-09-29", dueDate: "", status: "draft" as const,
  recurringFrequency: "none" as const, nextDueDate: "", recurringEndDate: "",
  theme: "classic" as const, font: "helvetica" as const, accentColor: "#dc2626",
  customizeJson: "{}",
  showTaxLine: true, showDiscountLine: true, showPaidLine: true,
  showPaymentTerms: true, showFooterNotes: true, showLogo: true, showCompanyInfo: true,
});

async function expectThrow(p: Promise<any>) {
  try { await p; return null; } catch (e: any) { return e as Error; }
}

// --- 2. Free job ceiling: 1-3 succeed, 4 fails -------------------------------
const jobIds: number[] = [];
for (let n = 1; n <= 3; n++) {
  const res = await (BaseActions.createJob as any).handler(ctxFree1, jobArgs(n));
  jobIds.push(res.id);
  check(`free job ${n} succeeds`, typeof res.id === "number");
}
const job4Err = await expectThrow((BaseActions.createJob as any).handler(ctxFree1, jobArgs(4)));
check("free job 4 fails with FREE_JOB_LIMIT", job4Err?.message?.startsWith("FREE_JOB_LIMIT") === true, job4Err?.message);

// --- 3. Completing a job frees a slot ----------------------------------------
await db.update(schema.jobs).set({ completedAt: new Date() }).where(eq(schema.jobs.id, jobIds[0]!));
const job4Retry = await (BaseActions.createJob as any).handler(ctxFree1, jobArgs(4));
check("job 4 succeeds after completing job 1", typeof job4Retry.id === "number");
const usage = await (BaseActions.getUsageLimits as any).handler(ctxFree1, {});
check("usage reports 3 active jobs after completing one", usage.activeJobs === 3 && usage.maxActiveJobs === 3, JSON.stringify(usage));

// --- 4. Premium: unlimited jobs ----------------------------------------------
let premiumOk = true;
for (let n = 1; n <= 5; n++) {
  try {
    await (BaseActions.createJob as any).handler(ctxPremium, jobArgs(100 + n));
  } catch { premiumOk = false; }
}
check("premium user creates 5+ jobs without hitting the ceiling", premiumOk);
const premiumUsage = await (BaseActions.getUsageLimits as any).handler(ctxPremium, {});
check("premium usage reports unlimited (-1) ceilings",
  premiumUsage.tier === "premium" && premiumUsage.maxActiveJobs === -1 && premiumUsage.maxInvoicesPerMonth === -1,
  JSON.stringify(premiumUsage));

// --- 5. Free invoice ceiling: 1-5 succeed, 6 fails ----------------------------
const invIds: number[] = [];
for (let n = 1; n <= 5; n++) {
  const res = await (BaseActions.saveInvoice as any).handler(ctxFree1, invoiceArgs(n));
  invIds.push(res.id);
  check(`free invoice ${n} succeeds`, typeof res.id === "number");
}
const inv6Err = await expectThrow((BaseActions.saveInvoice as any).handler(ctxFree1, invoiceArgs(6)));
check("free invoice 6 fails with FREE_INVOICE_LIMIT", inv6Err?.message?.startsWith("FREE_INVOICE_LIMIT") === true, inv6Err?.message);

// --- 6. Existing invoice edits remain allowed at the limit -------------------
const editRes = await (BaseActions.updateInvoiceDocument as any).handler(ctxFree1, {
  id: invIds[0]!, invoiceNumber: "INV-0001", issueDate: "2026-09-29",
  lineItems: [{ description: "Labor (updated)", amount: "600.00" }],
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  subtotal: "600.00", total: "600.00", footnote: "",
});
check("updateInvoiceDocument ok at the invoice ceiling", editRes.ok === true);
const edited = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, invIds[0]!)).limit(1))[0]!;
check("invoice edit persisted the new total", edited.total === "600.00", edited.total);

// --- 7. Company isolation -----------------------------------------------------
// Company 2 starts fresh despite company 1 being at both ceilings.
let companyBOk = true;
for (let n = 1; n <= 3; n++) {
  try { await (BaseActions.createJob as any).handler(ctxFree2, jobArgs(200 + n)); }
  catch { companyBOk = false; }
}
for (let n = 1; n <= 5; n++) {
  try { await (BaseActions.saveInvoice as any).handler(ctxFree2, invoiceArgs(200 + n)); }
  catch { companyBOk = false; }
}
check("company B creates 3 jobs + 5 invoices despite company A being at ceiling", companyBOk);
const bJob4Err = await expectThrow((BaseActions.createJob as any).handler(ctxFree2, jobArgs(204)));
check("company B has its own job counter (job 4 fails with FREE_JOB_LIMIT)",
  bJob4Err?.message?.startsWith("FREE_JOB_LIMIT") === true, bJob4Err?.message);
const bInv6Err = await expectThrow((BaseActions.saveInvoice as any).handler(ctxFree2, invoiceArgs(206)));
check("company B has its own invoice counter (invoice 6 fails with FREE_INVOICE_LIMIT)",
  bInv6Err?.message?.startsWith("FREE_INVOICE_LIMIT") === true, bInv6Err?.message);

// --- 8. Lifetime checkout requires STRIPE_FOUNDING_PRICE_ID --------------------
delete process.env.STRIPE_FOUNDING_PRICE_ID; // deterministic: the key must be absent
// Route executePrivileged to the REAL createStripeCheckout implementation so the
// test exercises the genuine graceful-unconfigured path (no network: it returns
// before any fetch when keys are missing).
const checkoutEntry = privilegedHandlers.entries.find((e) => e.contract === (privileged as any).createStripeCheckout);
if (!checkoutEntry) throw new Error("createStripeCheckout privileged handler entry not found");
const ctxCheckout = makeCtx(1, user1, async (_fn: any, args: any) => (checkoutEntry.handler as any)(args));
const checkoutRes = await (BaseActions.startPremiumCheckout as any).handler(ctxCheckout, { plan: "lifetime" });
check("lifetime checkout without STRIPE_FOUNDING_PRICE_ID returns configured:false",
  checkoutRes.configured === false && checkoutRes.checkoutUrl === null, JSON.stringify(checkoutRes));
check("lifetime checkout missing array contains STRIPE_FOUNDING_PRICE_ID",
  Array.isArray(checkoutRes.missing) && checkoutRes.missing.includes("STRIPE_FOUNDING_PRICE_ID"),
  JSON.stringify(checkoutRes.missing));

// --- 9. Lifetime webhook grants permanent Premium exactly once ----------------
let fakeEvent: any = {
  eventId: "evt_freemium_1",
  eventType: "checkout.session.completed",
  plan: "founding_member",
  userId: user4,
  customerId: "cus_test_founder",
  checkoutType: "subscription",
};
const ctxWebhook = makeCtx(1, user4, async () => fakeEvent);

const wh1 = await (BaseActions.handleStripeWebhook as any).handler(ctxWebhook, { payload: "x", signature: "y" });
check("founding_member webhook processed", wh1.ok === true && wh1.processed === true && wh1.duplicate === false, JSON.stringify(wh1));
const founder = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, user4)).limit(1))[0]!;
check("webhook grants tier=premium", founder.tier === "premium", founder.tier);
check("webhook grants subscriptionStatus=founding_member", founder.subscriptionStatus === "founding_member", founder.subscriptionStatus);

const foundingCount = async () =>
  (await db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(eq(schema.authUsers.subscriptionStatus, "founding_member"))).length;
check("one founding member after first grant", (await foundingCount()) === 1);

// Same eventId delivered again -> duplicate.
const whDup = await (BaseActions.handleStripeWebhook as any).handler(ctxWebhook, { payload: "x", signature: "y" });
check("repeat delivery of the same eventId is a duplicate", whDup.duplicate === true && whDup.processed === false, JSON.stringify(whDup));

// Different eventId for the same user -> idempotent grant, no double count.
fakeEvent = { ...fakeEvent, eventId: "evt_freemium_2" };
const wh2 = await (BaseActions.handleStripeWebhook as any).handler(ctxWebhook, { payload: "x", signature: "y" });
check("second eventId for the same user is processed idempotently",
  wh2.ok === true && wh2.processed === true && wh2.duplicate === false, JSON.stringify(wh2));
check("founding member count stays at 1 after the second event", (await foundingCount()) === 1);
const founder2 = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, user4)).limit(1))[0]!;
check("user still premium/founding_member after the second event",
  founder2.tier === "premium" && founder2.subscriptionStatus === "founding_member");

// Reset user 4 so the cap test below starts from a clean count.
await db.update(schema.authUsers).set({ tier: "free", subscriptionStatus: "inactive" }).where(eq(schema.authUsers.id, user4));

// --- 10. Founding-member cap never exceeds 100 --------------------------------
const fmBatch = Array.from({ length: 100 }, (_, i) => ({
  companyId: 1, name: `Founding Member ${i + 1}`, email: `fm${String(i + 1).padStart(3, "0")}@example.com`,
  passwordHash: "x", passwordSalt: "y", passwordIterations: 1,
  tier: "premium" as const, subscriptionStatus: "founding_member", referralCode: `FM${String(i + 1).padStart(4, "0")}`,
}));
await db.insert(schema.authUsers).values(fmBatch);
check("100 founding members pre-inserted", (await foundingCount()) === 100);

fakeEvent = {
  eventId: "evt_freemium_cap_101",
  eventType: "checkout.session.completed",
  plan: "founding_member",
  userId: user5,
  customerId: "cus_test_cap101",
  checkoutType: "subscription",
};
const capErr = await expectThrow((BaseActions.handleStripeWebhook as any).handler(ctxWebhook, { payload: "x", signature: "y" }));
check("101st founding-member grant fails", capErr !== null, "no error thrown");
check("101st grant fails with the cap message",
  capErr?.message?.includes("Founding member cap reached") === true, capErr?.message);
check("founding member count stays at 100", (await foundingCount()) === 100);
const capUser = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, user5)).limit(1))[0]!;
check("101st user remains free tier", capUser.tier === "free", capUser.tier);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll freemium checks passed.");
