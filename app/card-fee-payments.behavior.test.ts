// Card payment controls (0100, Danny 2026-11-05).
//
// Two per-invoice controls on the invoice detail screen:
//   cardPaymentsEnabled (default ON) — the invoice's Pay Now switch.
//     Off: the public link payload offers no Pay Now, the portal payload
//     carries the off flag, and checkout creation refuses server-side.
//   cardFeeEnabled (default OFF) — pass the Stripe card fee to the
//     client. The fee is computed SERVER-side on every create/update
//     and baked into the invoice total:
//       feeCents = round((baseCents + 30) / 0.971) - baseCents
//     (Stripe card pricing 2.9% + 30c; $310.00 -> fee $9.57, total
//     $319.57). base is always the PRE-fee total: update paths strip
//     the stored cardFeeCents from the echoed fee-inclusive total, so
//     a fee never stacks on a fee. Either toggle off -> fee 0.
//
// Everything goes through the PRODUCTION dispatch seam (request
// safeParse -> handler -> response safeParse, exactly as server.mjs's
// dispatchAction) — the deposit-wipe lesson (d503790): handler-direct
// calls cannot see response-schema stripping.
//
// Run from app/:  bun card-fee-payments.behavior.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// --- Scratch DB + ctx -----------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-card-fee-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

const checkoutCalls: Array<Record<string, unknown>> = [];
const ctx = {
  slug: "tradesign",
  invocationId: "card-fee-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async (_action: unknown, args: Record<string, unknown>) => {
    if (typeof args?.amountCents === "number" && args?.invoiceId) {
      checkoutCalls.push(args);
      return { configured: true, sessionId: "cs_test_1", url: "https://checkout.stripe.test/pay" };
    }
    throw new Error("unexpected privileged call");
  },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "premium",
} as any;
const A = BaseActions as any;

// Production dispatch seam: request safeParse -> handler -> response safeParse.
const dispatch = async (action: any, payload: any) => {
  const parsedArgs = action.request.safeParse(payload);
  if (!parsedArgs.success) return { ok: false, error: `request: ${parsedArgs.error.message}`, data: null as any };
  let result: any;
  try { result = await action.handler(ctx, parsedArgs.data); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e), data: null as any }; }
  const parsedResult = action.response.safeParse(result);
  if (!parsedResult.success) return { ok: false, error: `response: ${parsedResult.error.message}`, data: null as any };
  return { ok: true, error: "", data: parsedResult.data };
};
const listInvoicesViaResponse = async () => {
  const r = await dispatch(A.listInvoices, {});
  if (!r.ok) throw new Error(`listInvoices failed: ${r.error}`);
  return r.data.invoices as Array<any>;
};
const invoiceRow = async (id: number) => (await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1))[0]!;

// Company: Stripe connected + a Premium owner (companyProActive reads the
// owner row's tier), so Pay Now's existing gates are all satisfied and
// only the new per-invoice switch can close them.
await db.insert(schema.settings).values({
  id: 1, companyId: 1, companyName: "CardFee Co", updatedAt: new Date(),
  stripeConnectAccountId: "acct_test_123", stripeChargesEnabled: true,
});
await db.insert(schema.authUsers).values({
  name: "Owner", email: "owner@cardfee.test", passwordHash: "x", passwordSalt: "y",
  companyId: 1, role: "owner", tier: "premium",
} as any);

const docFields = {
  quoteId: null, jobId: null, clientId: null, clientName: "Fee Client",
  clientPhone: "", clientEmail: "", jobAddress: "1 Test Way", shippingAddress: "", jobType: "Remodel",
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", issueDate: "2026-11-05", dueDate: "", status: "sent",
  theme: "classic", font: "helvetica", accentColor: "#1f5a4a", customizeJson: "{}",
  showTaxLine: true, showDiscountLine: true, showPaidLine: true, showPaymentTerms: true,
  showFooterNotes: true, showLogo: true, showCompanyInfo: true,
};
const line310 = [{ name: "Work", description: "The work", amount: "310.00", quantity: 1, discount: "0", unit: "none" as const }];

// --- 1. Defaults: a pre-existing-style save (no new fields sent) ----------------
const plain = await dispatch(A.saveInvoice, { ...docFields, lineItems: line310, subtotal: "310.00", total: "310.00" });
check("defaults: saveInvoice without card fields dispatches cleanly", plain.ok, plain.error);
const plainRow = await invoiceRow(plain.data.id);
check("defaults: stored cardPaymentsEnabled=true, cardFeeEnabled=false, cardFeeCents=0",
  plainRow.cardPaymentsEnabled === true && plainRow.cardFeeEnabled === false && plainRow.cardFeeCents === 0,
  `${plainRow.cardPaymentsEnabled}/${plainRow.cardFeeEnabled}/${plainRow.cardFeeCents}`);
check("defaults: stored total untouched", plainRow.total === "310.00", plainRow.total);
const listedPlain = (await listInvoicesViaResponse()).find((i) => i.id === plain.data.id);
check("defaults: list payload carries true/false/0 through the response schema",
  listedPlain?.cardPaymentsEnabled === true && listedPlain?.cardFeeEnabled === false && listedPlain?.cardFeeCents === 0,
  `${listedPlain?.cardPaymentsEnabled}/${listedPlain?.cardFeeEnabled}/${listedPlain?.cardFeeCents}`);

// --- 2. Fee math at create: $310.00 -> fee $9.57, total $319.57 ------------------
const feeInv = await dispatch(A.saveInvoice, { ...docFields, lineItems: line310, subtotal: "310.00", total: "310.00", cardFeeEnabled: true });
check("fee create: dispatches cleanly", feeInv.ok, feeInv.error);
const feeRow = await invoiceRow(feeInv.data.id);
check("fee create: cardFeeCents = 957", feeRow.cardFeeCents === 957, String(feeRow.cardFeeCents));
check("fee create: stored total = 319.57 (fee baked in)", feeRow.total === "319.57", feeRow.total);
const listedFee = (await listInvoicesViaResponse()).find((i) => i.id === feeInv.data.id);
check("fee create: list shows fee 957 + total/balance 319.57",
  listedFee?.cardFeeCents === 957 && listedFee?.total === "319.57" && listedFee?.balanceRemaining === "319.57",
  `${listedFee?.cardFeeCents}/${listedFee?.total}/${listedFee?.balanceRemaining}`);

// --- 3. setInvoiceCardOptions: the detail screen's switches ---------------------
const optInv = await dispatch(A.saveInvoice, { ...docFields, lineItems: line310, subtotal: "310.00", total: "310.00" });
const optId = optInv.data.id;
const on = await dispatch(A.setInvoiceCardOptions, { id: optId, cardFeeEnabled: true });
check("options: enabling the fee returns 957 / 319.57", on.ok && on.data.cardFeeCents === 957 && on.data.total === "319.57", `${on.error} ${on.data?.cardFeeCents}/${on.data?.total}`);
const off = await dispatch(A.setInvoiceCardOptions, { id: optId, cardFeeEnabled: false });
check("options: disabling the fee zeroes it and restores the total", off.ok && off.data.cardFeeCents === 0 && off.data.total === "310.00", `${off.error} ${off.data?.cardFeeCents}/${off.data?.total}`);
await dispatch(A.setInvoiceCardOptions, { id: optId, cardFeeEnabled: true });
const payOff = await dispatch(A.setInvoiceCardOptions, { id: optId, cardPaymentsEnabled: false });
check("options: card payments off zeroes the fee (total back to base)", payOff.ok && payOff.data.cardFeeCents === 0 && payOff.data.total === "310.00", `${payOff.error} ${payOff.data?.cardFeeCents}/${payOff.data?.total}`);
const optRowOff = await invoiceRow(optId);
check("options: fee FLAG persists while payments are off (only the fee zeroes)", optRowOff.cardFeeEnabled === true && optRowOff.cardPaymentsEnabled === false);
const payOn = await dispatch(A.setInvoiceCardOptions, { id: optId, cardPaymentsEnabled: true });
check("options: payments back on recomputes the persisted fee", payOn.ok && payOn.data.cardFeeCents === 957 && payOn.data.total === "319.57", `${payOn.error} ${payOn.data?.cardFeeCents}/${payOn.data?.total}`);

// --- 4. Editor round trip through the production response path ------------------
// Mirrors FinancialEditor's save exactly: totals are recomputed from the
// line items pre-fee, and the stored fee is echoed back inside the total
// (total = preFee + listed cardFeeCents), deposit-style.
const listed1 = (await listInvoicesViaResponse()).find((i) => i.id === feeInv.data.id);
const echoSave = await dispatch(A.updateInvoiceDocument, {
  id: listed1.id, lineItems: listed1.lineItems, issueDate: listed1.issueDate, dueDate: listed1.dueDate,
  discountType: listed1.discountType, discountValue: listed1.discountValue,
  taxType: listed1.taxType, taxValue: listed1.taxValue,
  subtotal: "310.00", total: listed1.total, footnote: listed1.footnote,
  depositType: listed1.depositType ?? "none", depositValue: listed1.depositValue ?? "0",
  cardPaymentsEnabled: listed1.cardPaymentsEnabled, cardFeeEnabled: listed1.cardFeeEnabled,
});
check("round trip: editor echo-save dispatches cleanly", echoSave.ok, echoSave.error);
const rowAfterEcho = await invoiceRow(feeInv.data.id);
check("round trip: fee + total unchanged after echo-save (no stacking)",
  rowAfterEcho.cardFeeCents === 957 && rowAfterEcho.total === "319.57" && rowAfterEcho.cardFeeEnabled === true && rowAfterEcho.cardPaymentsEnabled === true,
  `${rowAfterEcho.cardFeeCents}/${rowAfterEcho.total}`);
const line400 = [{ name: "Work", description: "The work, expanded", amount: "400.00", quantity: 1, discount: "0", unit: "none" as const }];
const editSave = await dispatch(A.updateInvoiceDocument, {
  id: listed1.id, lineItems: line400, issueDate: listed1.issueDate, dueDate: listed1.dueDate,
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  subtotal: "400.00", total: "409.57", footnote: "",
  depositType: "none", depositValue: "0",
  cardPaymentsEnabled: true, cardFeeEnabled: true,
});
check("round trip: edited save dispatches cleanly", editSave.ok, editSave.error);
const rowAfterEdit = await invoiceRow(feeInv.data.id);
check("round trip: fee recomputed on the NEW base (400 -> 1226 / 412.26), never stacked",
  rowAfterEdit.cardFeeCents === 1226 && rowAfterEdit.total === "412.26",
  `${rowAfterEdit.cardFeeCents}/${rowAfterEdit.total}`);
// Restore the $310 fee invoice for the link/checkout section below.
await dispatch(A.updateInvoiceDocument, {
  id: listed1.id, lineItems: line310, issueDate: listed1.issueDate, dueDate: listed1.dueDate,
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  subtotal: "310.00", total: "322.26", footnote: "",
  depositType: "none", depositValue: "0", cardPaymentsEnabled: true, cardFeeEnabled: true,
});
const restored = await invoiceRow(feeInv.data.id);
check("round trip: restore to 310 base lands back on 957 / 319.57", restored.cardFeeCents === 957 && restored.total === "319.57", `${restored.cardFeeCents}/${restored.total}`);

// --- 5. Fee on + card payments off at create: fee forced to 0 -------------------
const bothInv = await dispatch(A.saveInvoice, { ...docFields, lineItems: line310, subtotal: "310.00", total: "310.00", cardFeeEnabled: true, cardPaymentsEnabled: false });
const bothRow = await invoiceRow(bothInv.data.id);
check("create fee-on + payments-off: cardFeeCents = 0 and total stays 310.00",
  bothRow.cardFeeCents === 0 && bothRow.total === "310.00" && bothRow.cardFeeEnabled === true && bothRow.cardPaymentsEnabled === false,
  `${bothRow.cardFeeCents}/${bothRow.total}`);

// --- 6. Public link + checkout gating -------------------------------------------
await db.insert(schema.documentLinks).values({
  companyId: 1, documentKind: "invoice", documentId: feeInv.data.id,
  tokenHash: "testhash-cardfee-1", tokenHint: "cardfee", shortCode: "cardfee001",
  expiresAt: new Date(Date.now() + 86_400_000),
});
const link1 = await dispatch(A.resolveDocumentLink, { token: "cardfee001" });
check("link: resolves through the response schema", link1.ok, link1.error);
check("link: payNowAvailable true while the switch is on", link1.data?.payNowAvailable === true, String(link1.data?.payNowAvailable));
check("link: payload carries cardFeeCents 957 and total 319.57", link1.data?.cardFeeCents === 957 && link1.data?.total === "319.57", `${link1.data?.cardFeeCents}/${link1.data?.total}`);

await dispatch(A.setInvoiceCardOptions, { id: feeInv.data.id, cardPaymentsEnabled: false });
const link2 = await dispatch(A.resolveDocumentLink, { token: "cardfee001" });
check("link: payNowAvailable false once the switch is off", link2.ok && link2.data?.payNowAvailable === false, `${link2.error} ${link2.data?.payNowAvailable}`);
const refused = await dispatch(A.createDocumentInvoicePayment, { token: "cardfee001" });
check("checkout: creation refuses while the switch is off", !refused.ok && /turned off/i.test(refused.error), refused.error);
check("checkout: Stripe was never called for the refused checkout", checkoutCalls.length === 0, String(checkoutCalls.length));

await dispatch(A.setInvoiceCardOptions, { id: feeInv.data.id, cardPaymentsEnabled: true });
const paid = await dispatch(A.createDocumentInvoicePayment, { token: "cardfee001" });
check("checkout: creation succeeds once the switch is back on", paid.ok && typeof paid.data?.url === "string", paid.error);
check("checkout: amount is the fee-inclusive balance (31957 cents)", checkoutCalls.length === 1 && checkoutCalls[0]?.amountCents === 31957, JSON.stringify(checkoutCalls[0]?.amountCents));

// --- 7. Portal payload: per-invoice flag rides along ----------------------------
const [job] = await db.insert(schema.jobs).values({
  companyId: 1, clientName: "Fee Client", jobType: "Remodel", jobAddress: "1 Test Way", jobDate: "2026-11-05",
} as any).returning();
await db.update(schema.invoices).set({ jobId: job!.id }).where(eq(schema.invoices.id, feeInv.data.id));
await db.insert(schema.portalTokens).values({
  companyId: 1, jobId: job!.id, tokenHash: "testhash-portal-1", tokenHint: "portal", shortCode: "portalfee1",
  expiresAt: new Date(Date.now() + 86_400_000),
});
await dispatch(A.setInvoiceCardOptions, { id: feeInv.data.id, cardPaymentsEnabled: false });
const portal = await dispatch(A.getPortalData, { token: "portalfee1" });
check("portal: resolves through the response schema", portal.ok, portal.error);
const portalInv = portal.data?.invoices?.find((i: any) => i.id === feeInv.data.id);
check("portal: invoice carries cardPaymentsEnabled=false + cardFeeCents",
  portalInv?.cardPaymentsEnabled === false && typeof portalInv?.cardFeeCents === "number",
  `${portalInv?.cardPaymentsEnabled}/${portalInv?.cardFeeCents}`);
const portalRefused = await dispatch(A.createPortalInvoicePayment, { token: "portalfee1", invoiceId: feeInv.data.id });
check("portal checkout: creation refuses while the switch is off", !portalRefused.ok && /turned off/i.test(portalRefused.error), portalRefused.error);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
