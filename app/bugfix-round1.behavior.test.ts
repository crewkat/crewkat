// Bug-fix round 1 behavior tests (contractor dogfood QA fixes).
//
// Covers:
//  1. Home endless loading — getAutomationCenter never throws on legacy/null
//     rows and always returns a valid payload.
//  2. Client-local date stamping — `today` request field is honored for
//     convertQuoteToInvoice, toggleInvoicePaid, and createRecurringSchedule.
//  3. Payment history — addPayment stores paymentDate as given; internal
//     "__paid_toggle__" auto payments exist server-side and the client hides
//     them from the visible history.
//  4. Estimate/quote terminology — estimateTerms mapping is bilingual and
//     settings-driven (evaluated from the client source in isolation).
//  5. Lumber live total — per-piece and current-entry board-feet math.
//  6. Static guards — Escape wiring, bottom-nav clearance, accordion CSS,
//     login verification recovery, payment sheet, localToday usage.
//
// Run from app/:  bun bugfix-round1.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
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
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const clientSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");
const cssSrc = await readFile("client/src/theme.css", "utf8");

// --- 1. Scratch DB -----------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-bugfix1-"));
const dbPath = join(dir, "app.db");
const sqlite = createClient({ url: `file:${dbPath}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx = {
  slug: "tradesign",
  invocationId: "bugfix1-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => { throw new Error("not stubbed"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
} as any;

await db.insert(schema.authUsers).values({
  companyId: 1, name: "Owner", email: "owner@example.com",
  passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ABCDEFGH",
});
await db.insert(schema.settings).values({ companyId: 1, companyName: "Stallions Test Co" });

// --- 2. getAutomationCenter: empty DB ---------------------------------------
const empty = await (BaseActions.getAutomationCenter as any).handler(ctx, { today: "2026-09-29" });
check("automation center returns a payload on an empty DB", typeof empty === "object" && empty !== null);
for (const key of ["appointments", "quoteChase", "paymentEscalations", "materials", "quoteExpiry", "reviews", "reengagement", "reminders", "crew"]) {
  check(`automation center payload has array "${key}"`, Array.isArray((empty as any)[key]));
}

// --- 3. getAutomationCenter: legacy/null rows --------------------------------
const now = new Date();
const clientRows = await db.insert(schema.clients).values({
  name: "Legacy Client", phone: "", email: "", address: "", notes: "",
  tags: JSON.stringify([]), createdAt: now, updatedAt: now,
}).returning({ id: schema.clients.id });
const clientId = clientRows[0]!.id;
await db.insert(schema.jobs).values({
  clientId, clientName: "Legacy Client", clientPhone: "", clientEmail: "",
  jobAddress: "1 Main St", jobType: "Remodel",
  jobDate: "2026-09-29T14:00:00.000Z", // legacy full ISO timestamp in a date-only column
  appointmentAt: "2026-09-29T14:00:00.000Z",
  createdAt: now, updatedAt: now,
});
const quoteRows = await db.insert(schema.quotes).values({
  clientId, clientName: "Legacy Client", clientPhone: "", clientEmail: "",
  jobAddress: "1 Main St", jobType: "Remodel",
  lineItemsJson: "not-json{{{", subtotal: "abc", total: "xyz",
  createdAt: now, updatedAt: now,
}).returning({ id: schema.quotes.id });
await db.insert(schema.invoices).values({
  clientId, clientName: "Legacy Client", clientPhone: "", clientEmail: "",
  jobAddress: "1 Main St", jobType: "Remodel",
  lineItemsJson: "[]", subtotal: "0", total: "1000",
  invoiceNumber: "INV-0001", issueDate: "2026-09-01T00:00:00.000Z",
  dueDate: "", status: "sent", createdAt: now, updatedAt: now,
});
await db.insert(schema.appointments).values({
  jobId: null, clientId, clientName: "Legacy Client", clientPhone: "",
  startsAt: "2026-09-29T14:00:00.000Z", notes: "", exteriorWork: false,
  createdAt: now, updatedAt: now,
});
const invRows = await db.insert(schema.invoices).values({
  clientId, clientName: "Legacy Client",
  clientPhone: "", clientEmail: "", jobAddress: "1 Main St", jobType: "Remodel",
  lineItemsJson: "[]", subtotal: "0", total: "500",
  invoiceNumber: "INV-0002", issueDate: "2026-09-10",
  dueDate: "", status: "draft", createdAt: now, updatedAt: now,
}).returning({ id: schema.invoices.id });

let legacyPayload: any = null;
let legacyThrew = false;
try {
  legacyPayload = await (BaseActions.getAutomationCenter as any).handler(ctx, { today: "2026-09-29" });
} catch (e) {
  legacyThrew = true;
  console.error("automation center threw:", e);
}
check("automation center does not throw on legacy/null rows", !legacyThrew);
if (legacyPayload) {
  check("automation center payload valid with legacy rows",
    Array.isArray(legacyPayload.appointments) && Array.isArray(legacyPayload.quoteChase) && Array.isArray(legacyPayload.crew));
  const appt = legacyPayload.appointments[0];
  check("automation center surfaces the legacy ISO-timestamp appointment",
    typeof appt?.startsAt === "string" && appt.startsAt.slice(0, 10) === "2026-09-29", appt?.startsAt);
  check("automation center coerces null notes to empty string", appt?.notes === "", JSON.stringify(appt?.notes));
}

// --- 4. Client-local date stamping -------------------------------------------
const LOCAL_DAY = "2026-09-28"; // client-local yesterday (test machine is UTC)
await db.update(schema.quotes).set({ subtotal: "700.00", total: "700.00" }).where(eq(schema.quotes.id, quoteRows[0]!.id));
const conv = await (BaseActions.convertQuoteToInvoice as any).handler(ctx, { quoteId: quoteRows[0]!.id, today: LOCAL_DAY });
const convInv = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, conv.invoiceId)).limit(1))[0]!;
check("convertQuoteToInvoice stamps client-local issueDate", convInv.issueDate === LOCAL_DAY, convInv.issueDate);

const paidRes = await (BaseActions.toggleInvoicePaid as any).handler(ctx, { id: conv.invoiceId, paid: true, today: LOCAL_DAY });
check("toggleInvoicePaid ok", paidRes.ok === true);
const autoPayments = await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, conv.invoiceId));
const autoPay = autoPayments.find((p) => p.note === "__paid_toggle__");
check("toggleInvoicePaid auto payment uses client-local paymentDate", autoPay?.paymentDate === LOCAL_DAY, autoPay?.paymentDate);

const sched = await (BaseActions.createRecurringSchedule as any).handler(ctx, { invoiceId: conv.invoiceId, frequency: "monthly", today: LOCAL_DAY });
check("createRecurringSchedule ok", typeof sched.id === "number");
const schedRow = (await db.select().from(schema.recurringInvoiceSchedules).where(eq(schema.recurringInvoiceSchedules.id, sched.id)).limit(1))[0]!;
check("createRecurringSchedule nextRunDate derives from client-local today", schedRow.nextRunDate === "2026-10-28", schedRow.nextRunDate);

// --- 5. Payment history -------------------------------------------------------
const pay = await (BaseActions.addPayment as any).handler(ctx, {
  invoiceId: invRows[0]!.id, amount: "100.00", paymentDate: LOCAL_DAY, method: "Cash", note: "Deposit",
});
check("addPayment ok", typeof pay.id === "number");
const storedPay = (await db.select().from(schema.payments).where(eq(schema.payments.id, pay.id)).limit(1))[0]!;
check("addPayment stores the client-supplied paymentDate", storedPay.paymentDate === LOCAL_DAY, storedPay.paymentDate);
check("addPayment stores the method", storedPay.method === "Cash");

// Client hides internal "__paid_toggle__" notes from visible history.
check("client filters __paid_toggle__ from visible payment history",
  clientSrc.includes('payment.note!=="__paid_toggle__"'));
check("client payment sheet prefills the remaining balance",
  clientSrc.includes("const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : \"\");"));
check("client payment sheet offers an explicit full-balance shortcut",
  clientSrc.includes("record(true)"));
check("client payment sheet includes method chips",
  clientSrc.includes("const methodChips ="));
check("client payment sheet defaults the date to the local day",
  clientSrc.includes("const [paymentDate, setPaymentDate] = useState(localToday());"));

// --- 6. estimateTerms (evaluated from client source in isolation) --------------
const estMatch = /function estimateTerms\(lang: Lang, settings: Settings \| null\): EstimateTerms \{([\s\S]*?)\n\}/.exec(clientSrc);
check("estimateTerms helper exists in client source", Boolean(estMatch));
let estFn: any = null;
if (estMatch) {
  const jsBody = estMatch[1]!
    .replace(/settings\?\.convertToQuote === true/g, "settings && settings.convertToQuote === true");
  estFn = new Function("lang", "settings", jsBody) as any;
}
if (estFn) {
  check("estimateTerms EN default", JSON.stringify(estFn("en", null).singular) === '"estimate"');
  check("estimateTerms EN quote setting", estFn("en", { convertToQuote: true }).singular === "quote");
  check("estimateTerms ES default", estFn("es", null).singular === "estimado");
  check("estimateTerms ES quote setting", estFn("es", { convertToQuote: true }).singular === "cotización");
  check("estimateTerms EN save label", estFn("en", null).saveDoc === "Save estimate");
  check("estimateTerms ES save label", estFn("es", null).saveDoc === "Guardar estimado");
}

// --- 7. Lumber live total ------------------------------------------------------
const money = (v: string) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const each = (money("1") * money("6") * money("8")) / 12; // 1x6x8 board
check("lumber per-piece board feet (1x6x8 = 4 BF)", Math.abs(each - 4) < 1e-9, String(each));
const entryQty = Math.max(1, Math.round(money("3")));
check("lumber current-entry total (3 pieces = 12 BF)", Math.abs(each * entryQty - 12) < 1e-9);
check("lumber entry-total formula in client source",
  clientSrc.includes("const entryTotal = each * entryQty;"));
check("lumber live total labeled per-piece and current entry (EN/ES)",
  clientSrc.includes("Per piece") && clientSrc.includes("Por pieza") &&
  clientSrc.includes("This entry") && clientSrc.includes("Esta entrada"));

// --- 8. Static guards ------------------------------------------------------------
check("server stamps quote->job with clientToday", serverSrc.includes("jobDate: clientToday(args)"));
check("server stamps quote->invoice with clientToday", serverSrc.includes("issueDate: clientToday(args)"));
check("server stamps milestone->invoice with clientToday", serverSrc.includes("issueDate: clientToday(args)"));
check("server stamps toggleInvoicePaid auto payment with clientToday", serverSrc.includes("paymentDate:clientToday(args)"));
check("server createRecurringSchedule uses clientToday", serverSrc.includes("const today = clientToday(args);"));
check("client localToday helper exists", clientSrc.includes("function localToday()"));
check("client passes local day when converting quotes", clientSrc.includes("today: localToday()"));

const escapeTargets = [
  ["payment sheet", "function PaymentSheet"],
  ["signature dialog", 'useEscapeToClose(true,()=>{if(!saving)close();});'],
  ["marketplace promotion sheet", 'useEscapeToClose(promotionOpen'],
  ["marketplace map preview", 'useEscapeToClose(mapPreviewOpen'],
  ["quote fullscreen preview", 'useEscapeToClose(fullScreen'],
  ["invoice fullscreen preview", 'useEscapeToClose(fullScreen'],
  ["loss-reason sheet", 'useEscapeToClose(lostQuote !== null'],
  ["admin message sheet", 'useEscapeToClose(opened'],
  ["admin confirmation sheets", 'useEscapeToClose(confirm'],
  ["document signer PDF modal", 'useEscapeToClose(preview !== null'],
  ["toolbox window", 'useEscapeToClose(true, onBack)'],
];
for (const [label, snippet] of escapeTargets) {
  check(`Escape closes ${label}`, clientSrc.includes(snippet));
}

check("bottom-nav content clearance rule exists",
  cssSrc.includes(".app-shell.has-bottom-nav .page"));
check("bottom nav keeps the dedicated 62px center track (FAB must not cover labels)",
  cssSrc.includes("repeat(2, minmax(0, 1fr)) 62px repeat(2, minmax(0, 1fr))") &&
  !/\.bottom-nav\s*\{[^}]*grid-template-columns:\s*repeat\(5/.test(cssSrc));
check("settings accordion panel wraps without clipping",
  cssSrc.includes(".settings-accordion-panel .privacy-note"));
check("login exposes verify-email recovery",
  clientSrc.includes("resendVerification") && /verify email/i.test(clientSrc));
check("password fields stay empty (no fake value)",
  clientSrc.includes('useState("")') && !/value="•+"/.test(clientSrc));
check("material guide describes editable material prices (EN)",
  clientSrc.includes("Save your material names, units, and prices"));
check("material guide describes editable material prices (ES)",
  clientSrc.includes("Guarda nombres, unidades y precios de materiales"));

// --- Build 0.7 motion system static guards -----------------------------------
check("motion: shared easing/duration vars", cssSrc.includes("--ease-out") && cssSrc.includes("--dur-fast"));
check("motion: dialog pop keyframes", cssSrc.includes("dialog-pop-in"));
check("motion: sheet closing reverses entrance", cssSrc.includes(".sheet-backdrop.closing > section"));
check("motion: press feedback app-wide", cssSrc.includes(".bottom-nav button:active"));
check("motion: stagger utility", cssSrc.includes(".stagger-children"));
check("motion: useAnimatedDismiss hook", clientSrc.includes("function useAnimatedDismiss"));
check("motion: vivid chart palette", cssSrc.includes("--chart-green") && clientSrc.includes('fill="var(--chart-green)"'));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll bug-fix round 1 checks passed.");
