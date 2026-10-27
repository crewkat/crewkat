// Office Tier 2 behavior tests (crew logins, access switches, tier flag).
//
// Covers: migration 0089 (companies table + auth_users crew columns),
// the crew-code + PIN sign-in (happy path, wrong PIN, per-company
// lockout, deactivated member, PIN reset), per-member access switches
// enforced through the REAL protected `Actions` surface (money
// stripping, contact stripping, send/payment refusals, assigned-jobs
// filtering) with role presets untouched when no override is stored,
// the company tier flag's gating of team creation, and a legacy solo
// regression — all with real logins/session proofs, never BaseActions
// shortcuts.
//
// Run from app/:  bun office-track2.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { Actions, BaseActions, PUBLIC_ACTIONS } from "./server/src/actions.ts";
import {
  ADMIN_ACTIONS,
  ALL_ROLE_ACTIONS,
  OFFICE_ACTIONS,
  PLATFORM_ACTIONS,
  effectiveAccess,
  minRoleForAction,
  parseAccessOverrides,
  roleCan,
  serializeAccessOverrides,
} from "./server/src/permissions.ts";
import * as schema from "./server/src/schema.ts";
import { eq } from "drizzle-orm";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
async function checkThrows(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    failures++;
    console.error(`FAIL ${name} — expected an error but none was thrown`);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (match && !match.test(msg)) {
      failures++;
      console.error(`FAIL ${name} — wrong error: ${msg.slice(0, 140)}`);
    } else {
      console.log(`ok   ${name}`);
    }
  }
}

// --- 1. Migration journal ------------------------------------------------------
const journal = JSON.parse(await readFile(join("drizzle", "meta", "_journal.json"), "utf8"));
const entries: Array<{ idx: number; when: number; tag: string }> = journal.entries;
const last = entries[entries.length - 1]!;
const maxBefore = Math.max(...entries.slice(0, -1).map((e) => e.when));
check("newest migration when is strictly greater than every earlier entry", last.when > maxBefore, `last=${last.when} maxBefore=${maxBefore}`);
check("newest migration tag is 0090_office_wave1", last.tag === "0090_office_wave1", last.tag);
check("newest migration idx is 89", last.idx === 89, String(last.idx));

// --- 2. Scratch DB + migrations --------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-office-t2-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });
const authCols = (await sqlite.execute("PRAGMA table_info(auth_users)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: auth_users.credential_type exists", authCols.includes("credential_type"));
check("migrations applied: auth_users.pin_hash / pin_salt exist", authCols.includes("pin_hash") && authCols.includes("pin_salt"));
check("migrations applied: auth_users.access_overrides exists", authCols.includes("access_overrides"));
const tables = (await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'").then((r) => (r.rows as Array<{ name: string }>).map((t) => t.name)));
check("migrations applied: companies table exists", tables.includes("companies"));

// --- 3. Permission map: new actions classified --------------------------------------
const sets = [
  ["public", PUBLIC_ACTIONS],
  ["admin", ADMIN_ACTIONS],
  ["office", OFFICE_ACTIONS],
  ["platform", PLATFORM_ACTIONS],
  ["all", ALL_ROLE_ACTIONS],
] as const;
const seen = new Map<string, string>();
let overlaps: string[] = [];
for (const [label, set] of sets) {
  for (const name of set) {
    if (seen.has(name)) overlaps.push(`${name} (${seen.get(name)} + ${label})`);
    seen.set(name, label);
  }
}
check("permission map has no overlapping classifications", overlaps.length === 0, overlaps.join(", "));
const allActionNames = Object.keys(BaseActions);
const unclassified = allActionNames.filter((n) => !seen.has(n));
check("every registered action is classified exactly once (incl. Tier 2)", unclassified.length === 0, unclassified.join(", "));
check("crew team actions are admin-only", minRoleForAction("createCrewLogin") === "admin" && minRoleForAction("resetCrewPin") === "admin" && minRoleForAction("setMemberAccess") === "admin");
check("crewLogin is public (it IS a login)", PUBLIC_ACTIONS.has("crewLogin"));
check("field role still can call no delete* actions", allActionNames.filter((n) => /^delete/.test(n) && n !== "deleteMyAccount").every((n) => !roleCan("field", n)));

// --- 4. Override helpers --------------------------------------------------------------
check("parseAccessOverrides tolerates junk", Object.keys(parseAccessOverrides(null)).length === 0 && Object.keys(parseAccessOverrides("{nope")).length === 0 && Object.keys(parseAccessOverrides('{"seeMoney":"yes"}')).length === 0);
check("parseAccessOverrides keeps booleans", parseAccessOverrides('{"seeMoney":false}').seeMoney === false);
check("serializeAccessOverrides round-trips sparsely", serializeAccessOverrides({ seeMoney: false }) === '{"seeMoney":false}' && serializeAccessOverrides({}) === null);
check("field preset: everything on except recordPayments", (() => { const a = effectiveAccess("field", {}); return a.seeMoney && a.seeClientContact && a.sendDocuments && a.seeAllJobs && !a.recordPayments; })());
check("override beats preset", effectiveAccess("field", { seeMoney: false }).seeMoney === false && effectiveAccess("office", { recordPayments: false }).recordPayments === false);
check("admin ignores overrides entirely", (() => { const a = effectiveAccess("admin", { seeMoney: false, recordPayments: false }); return a.seeMoney && a.recordPayments; })());

// --- 5. Test context ---------------------------------------------------------------------
const ctx = {
  slug: "tradesign",
  invocationId: "office-track2-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => ({ delivery: "fallback" }),
  emit: () => {},
  invalidateQueries: () => {},
} as any;

const A = Actions as any;
const today = new Date().toISOString().slice(0, 10);

async function signUpOwner(name: string, email: string, password: string) {
  const res = await A.signUp.handler(ctx, { name, email, password, marketplaceTermsAccepted: true });
  await A.verifyEmail.handler(ctx, { email, code: res.verificationCode });
  const login = await A.login.handler(ctx, { email, password });
  return login as { sessionToken: string; user: { id: number; companyId: number; role: string; teamRole: string; tier: string; credentialType: string; access: Record<string, boolean> } };
}

// --- 6. Company 1: owner, tier defaults, crew code ---------------------------------------
const owner = await signUpOwner("Olivia Owner", "owner@acme.test", "owner-pass-123");
const ownerToken = owner.sessionToken;
const company1 = owner.user.companyId;
check("email login reports credentialType email", owner.user.credentialType === "email");
check("owner's effective access is all-on", Object.values(owner.user.access).every(Boolean), JSON.stringify(owner.user.access));

const team0 = await A.listTeamMembers.handler(ctx, { _sessionToken: ownerToken });
check("new company defaults to the office tier", team0.tier === "office", team0.tier);
check("team response carries a crew code", typeof team0.crewCode === "string" && team0.crewCode.replace("-", "").length === 8, team0.crewCode);
const companyRow = (await db.select().from(schema.companies).where(eq(schema.companies.id, company1)))[0];
check("companies row backfilled/lazily created with office tier", !!companyRow && companyRow.tier === "office" && companyRow.crewCode === team0.crewCode);
const crewCode = team0.crewCode as string;

// --- 7. Crew login lifecycle ----------------------------------------------------------------
const crewMade = await A.createCrewLogin.handler(ctx, { _sessionToken: ownerToken, name: "Carlos Crew", overrides: {} });
check("createCrewLogin returns id + 6-digit PIN + crew code", typeof crewMade.id === "number" && /^\d{6}$/.test(crewMade.pin) && crewMade.crewCode === crewCode, JSON.stringify(crewMade));
const crewRow = (await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, crewMade.id)))[0]!;
check("crew row: field role + crew_pin credential", crewRow.role === "field" && crewRow.credentialType === "crew_pin");
check("crew row: PIN stored hashed, never plaintext", !!crewRow.pinHash && crewRow.pinHash !== crewMade.pin && !crewRow.pinHash.includes(crewMade.pin));
check("crew row: no real email (synthetic placeholder)", crewRow.email.endsWith("@crew.invalid"), crewRow.email);
await checkThrows("crew login cannot be used as an email login", () => A.login.handler(ctx, { email: crewRow.email, password: crewMade.pin }), /incorrect/);

const team1 = await A.listTeamMembers.handler(ctx, { _sessionToken: ownerToken });
const crewMember = team1.members.find((m: any) => m.id === crewMade.id);
check("team list shows the crew member as a crew login", crewMember?.credentialType === "crew_pin" && crewMember?.teamRole === "field");
check("crew member defaults resolve to the field preset", crewMember?.access.recordPayments === false && crewMember?.access.seeMoney === true);

// Wrong code + wrong PIN are generic; right pair signs in.
await checkThrows("crewLogin with an unknown company code is refused generically", () => A.crewLogin.handler(ctx, { companyCode: "ZZZZ-9999", pin: crewMade.pin }), /Company code or PIN is incorrect/);
await checkThrows("crewLogin with a wrong PIN is refused generically", () => A.crewLogin.handler(ctx, { companyCode: crewCode, pin: "000000" === crewMade.pin ? "111111" : "000000" }), /Company code or PIN is incorrect/);
const crewLogin = await A.crewLogin.handler(ctx, { companyCode: crewCode.toLowerCase().replace("-", ""), pin: crewMade.pin });
check("crewLogin accepts code without dash / lowercase", typeof crewLogin.sessionToken === "string" && crewLogin.sessionToken.length >= 32);
check("crew session user is the crew member", crewLogin.user.id === crewMade.id && crewLogin.user.credentialType === "crew_pin" && crewLogin.user.teamRole === "field");
let crewToken = crewLogin.sessionToken as string;
const crewSession = await A.getAuthSession.handler(ctx, { _sessionToken: crewToken });
check("crew session resolves via getAuthSession", crewSession.user?.id === crewMade.id && crewSession.user?.access.seeAllJobs === true);

// The crew member works the field surface.
const crewJob = await A.createJob.handler(ctx, { _sessionToken: crewToken, clientId: null, clientName: "Crew Client", clientPhone: "", clientEmail: "", jobAddress: "5 Crew Ct, Tampa, FL", jobType: "Repair", notes: "", jobDate: today, appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "" });
check("crew member can create a job (field surface)", typeof crewJob.id === "number");
await checkThrows("crew member denied team management", () => A.listTeamMembers.handler(ctx, { _sessionToken: crewToken }), /Field role/);

// PIN reset: old PIN dies, new PIN works, both unique per company.
const secondCrew = await A.createCrewLogin.handler(ctx, { _sessionToken: ownerToken, name: "Maria Crew", overrides: {} });
check("two crew members never share a PIN", secondCrew.pin !== crewMade.pin);
const reset = await A.resetCrewPin.handler(ctx, { _sessionToken: ownerToken, userId: crewMade.id });
check("resetCrewPin returns a fresh PIN", /^\d{6}$/.test(reset.pin) && reset.pin !== secondCrew.pin);
await checkThrows("old PIN stops working after reset", () => A.crewLogin.handler(ctx, { companyCode: crewCode, pin: crewMade.pin }), /Company code or PIN is incorrect/);
const crewRelogin = await A.crewLogin.handler(ctx, { companyCode: crewCode, pin: reset.pin });
check("new PIN signs in after reset", crewRelogin.user.id === crewMade.id);
crewToken = crewRelogin.sessionToken as string;
await checkThrows("resetCrewPin refuses an email login", () => A.resetCrewPin.handler(ctx, { _sessionToken: ownerToken, userId: owner.user.id }), /not found/);

// Deactivation: live session dies + PIN login refused; reactivation restores.
await A.updateStaffMember.handler(ctx, { _sessionToken: ownerToken, userId: crewMade.id, active: false });
const deadCrewSession = await A.getAuthSession.handler(ctx, { _sessionToken: crewToken });
check("deactivating a crew member kills the live session", deadCrewSession.user === null);
await checkThrows("deactivated crew member cannot sign in with the PIN", () => A.crewLogin.handler(ctx, { companyCode: crewCode, pin: reset.pin }), /deactivated/);
await A.updateStaffMember.handler(ctx, { _sessionToken: ownerToken, userId: crewMade.id, active: true });
const revivedCrew = await A.crewLogin.handler(ctx, { companyCode: crewCode, pin: reset.pin });
check("reactivation restores crew sign-in", revivedCrew.user.id === crewMade.id);
crewToken = revivedCrew.sessionToken as string;

// --- 8. Access switches: money + contact stripping -------------------------------------------
const officeMade = await A.createStaffAccount.handler(ctx, { _sessionToken: ownerToken, name: "Oscar Office", email: "office@acme.test", password: "office-pass-123", role: "office" });
const fieldMade = await A.createStaffAccount.handler(ctx, { _sessionToken: ownerToken, name: "Fred Field", email: "field@acme.test", password: "field-pass-123", role: "field" });
const officeLogin = await A.login.handler(ctx, { email: "office@acme.test", password: "office-pass-123" });
const fieldLogin = await A.login.handler(ctx, { email: "field@acme.test", password: "field-pass-123" });
const officeToken = officeLogin.sessionToken as string;
const fieldToken = fieldLogin.sessionToken as string;

// A $500 estimate -> invoice, and a client with contact details.
const quote = await A.saveQuote.handler(ctx, {
  _sessionToken: ownerToken, jobId: null, clientId: null, clientName: "Money Client",
  clientPhone: "813-555-0100", clientEmail: "money@client.test", shippingAddress: "", jobType: "Remodel",
  jobAddress: "9 Money Ln, Tampa, FL", lineItems: [{ name: "Work", description: "Money work", amount: "500.00", quantity: 1 }],
  subtotal: "500.00", total: "500.00", expiryDate: "", sentAt: "", depositType: "none", depositValue: "0", materials: [],
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a",
});
const converted = await A.convertQuoteToInvoice.handler(ctx, { _sessionToken: ownerToken, quoteId: quote.id, today });
const client = await A.saveClient.handler(ctx, { _sessionToken: ownerToken, id: null, name: "Contact Client", phone: "813-555-0199", email: "contact@client.test", address: "1 Contact Way, Tampa, FL", addresses: [], notes: "", tags: [], referredByClientId: null });

// Preset behavior first: a Field member with NO overrides sees totals
// exactly as before Tier 2.
const fieldInvoicesBefore = await A.listInvoices.handler(ctx, { _sessionToken: fieldToken });
const fieldInvoiceBefore = fieldInvoicesBefore.invoices.find((i: any) => i.id === converted.invoiceId);
check("preset: field member sees the invoice total (unchanged behavior)", fieldInvoiceBefore?.total === "500.00", fieldInvoiceBefore?.total);

// seeMoney OFF: totals never reach the member; the owner still sees them.
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: fieldMade.id, overrides: { seeMoney: false } });
const fieldInvoicesAfter = await A.listInvoices.handler(ctx, { _sessionToken: fieldToken });
const fieldInvoiceAfter = fieldInvoicesAfter.invoices.find((i: any) => i.id === converted.invoiceId);
check("seeMoney off: invoice total is stripped", fieldInvoiceAfter && fieldInvoiceAfter.total === "" && fieldInvoiceAfter.balanceRemaining === "" && fieldInvoiceAfter.paidToDate === "", JSON.stringify({ total: fieldInvoiceAfter?.total, bal: fieldInvoiceAfter?.balanceRemaining }));
check("seeMoney off: line item amounts are stripped", fieldInvoiceAfter?.lineItems.every((li: any) => li.amount === "") === true);
const fieldQuotesAfter = await A.listQuotes.handler(ctx, { _sessionToken: fieldToken });
check("seeMoney off: quote totals are stripped", fieldQuotesAfter.quotes.find((q: any) => q.id === quote.id)?.total === "");
const ownerInvoices = await A.listInvoices.handler(ctx, { _sessionToken: ownerToken });
check("owner still sees the real total", ownerInvoices.invoices.find((i: any) => i.id === converted.invoiceId)?.total === "500.00");
const fieldClientAfter = await A.listClients.handler(ctx, { _sessionToken: fieldToken, search: "" });
const shapedClient = fieldClientAfter.clients.find((c: any) => c.id === client.id);
check("seeMoney off: client money totals are zeroed", shapedClient && shapedClient.totalInvoiced === 0 && shapedClient.balanceDue === 0, JSON.stringify(shapedClient?.totalInvoiced));
// Clearing the override restores the preset.
const cleared = await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: fieldMade.id, overrides: { seeMoney: null } });
check("clearing an override restores the preset", cleared.overrides.seeMoney === undefined && cleared.access.seeMoney === true);
const fieldInvoicesRestored = await A.listInvoices.handler(ctx, { _sessionToken: fieldToken });
check("after clearing, the field member sees totals again", fieldInvoicesRestored.invoices.find((i: any) => i.id === converted.invoiceId)?.total === "500.00");

// seeClientContact OFF: phone/email blanked, names still visible.
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: fieldMade.id, overrides: { seeClientContact: false } });
const noContactClients = await A.listClients.handler(ctx, { _sessionToken: fieldToken, search: "" });
const noContactClient = noContactClients.clients.find((c: any) => c.id === client.id);
check("seeClientContact off: phone + email blanked on listClients", noContactClient?.phone === "" && noContactClient?.email === "" && noContactClient?.name === "Contact Client", JSON.stringify(noContactClient));
const noContactDetail = await A.getClient.handler(ctx, { _sessionToken: fieldToken, id: client.id });
check("seeClientContact off: getClient blanks contact too", noContactDetail.client?.phone === "" && noContactDetail.client?.email === "");
const ownerClient = await A.getClient.handler(ctx, { _sessionToken: ownerToken, id: client.id });
check("owner still sees contact details", ownerClient.client?.phone === "813-555-0199");
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: fieldMade.id, overrides: { seeClientContact: null } });

// Non-admins cannot set switches; the owner row can't be limited.
await checkThrows("office member cannot set access switches", () => A.setMemberAccess.handler(ctx, { _sessionToken: officeToken, userId: fieldMade.id, overrides: { seeMoney: false } }), /Office role/);
await checkThrows("field member cannot create crew logins", () => A.createCrewLogin.handler(ctx, { _sessionToken: fieldToken, name: "Sneaky Crew", overrides: {} }), /Field role/);
await checkThrows("the owner's access cannot be limited", () => A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: owner.user.id, overrides: { seeMoney: false } }), /owner/);

// --- 9. Access switches: send + payments refusals ----------------------------------------------
// Field preset can send document links; switch off refuses.
const linkBefore = await A.createDocumentLink.handler(ctx, { _sessionToken: fieldToken, kind: "invoice", id: converted.invoiceId });
check("preset: field member can create a document link", typeof linkBefore.token === "string");
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: fieldMade.id, overrides: { sendDocuments: false } });
await checkThrows("sendDocuments off: createDocumentLink refused", () => A.createDocumentLink.handler(ctx, { _sessionToken: fieldToken, kind: "invoice", id: converted.invoiceId }), /doesn't include sending documents/);
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: fieldMade.id, overrides: { sendDocuments: null } });

// Office preset records payments; switch off refuses addPayment AND toggleInvoicePaid.
const paymentBefore = await A.addPayment.handler(ctx, { _sessionToken: officeToken, invoiceId: converted.invoiceId, amount: "100", paymentDate: today, method: "card", note: "" });
check("preset: office member records a payment", typeof paymentBefore.id === "number");
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: officeMade.id, overrides: { recordPayments: false } });
await checkThrows("recordPayments off: addPayment refused for office", () => A.addPayment.handler(ctx, { _sessionToken: officeToken, invoiceId: converted.invoiceId, amount: "50", paymentDate: today, method: "card", note: "" }), /doesn't include recording payments/);
await checkThrows("recordPayments off: toggleInvoicePaid refused for office", () => A.toggleInvoicePaid.handler(ctx, { _sessionToken: officeToken, invoiceId: converted.invoiceId }), /doesn't include recording payments/);
const officeInvoices = await A.listInvoices.handler(ctx, { _sessionToken: officeToken });
check("recordPayments off does NOT strip office money views", officeInvoices.invoices.find((i: any) => i.id === converted.invoiceId)?.total === "500.00");
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: officeMade.id, overrides: { recordPayments: null } });
const paymentAfter = await A.addPayment.handler(ctx, { _sessionToken: officeToken, invoiceId: converted.invoiceId, amount: "25", paymentDate: today, method: "cash", note: "" });
check("clearing recordPayments restores payment recording", typeof paymentAfter.id === "number");

// Overrides chosen AT crew creation are stored and reported.
const gatedCrew = await A.createCrewLogin.handler(ctx, { _sessionToken: ownerToken, name: "Gated Crew", overrides: { seeMoney: false } });
const team2 = await A.listTeamMembers.handler(ctx, { _sessionToken: ownerToken });
const gatedMember = team2.members.find((m: any) => m.id === gatedCrew.id);
check("crew login created with an override reports it", gatedMember?.overrides.seeMoney === false && gatedMember?.access.seeMoney === false && gatedMember?.access.seeAllJobs === true);

// --- 10. Access switches: seeAllJobs filtering ---------------------------------------------------
const jobA = await A.createJob.handler(ctx, { _sessionToken: ownerToken, clientId: null, clientName: "Alpha Client", clientPhone: "", clientEmail: "", jobAddress: "1 Alpha St, Tampa, FL", jobType: "Bath", notes: "", jobDate: today, appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "" });
const jobB = await A.createJob.handler(ctx, { _sessionToken: ownerToken, clientId: null, clientName: "Beta Client", clientPhone: "", clientEmail: "", jobAddress: "2 Beta St, Tampa, FL", jobType: "Kitchen", notes: "", jobDate: today, appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "" });
await A.saveAppointment.handler(ctx, { _sessionToken: ownerToken, id: null, jobId: jobA.id, clientId: null, clientName: "Alpha Client", clientPhone: "", startsAt: `${today}T08:00:00`, notes: "", exteriorWork: false, status: "scheduled", crewMember: "Fred Field", etaMinutes: null });
await A.saveAppointment.handler(ctx, { _sessionToken: ownerToken, id: null, jobId: jobB.id, clientId: null, clientName: "Beta Client", clientPhone: "", startsAt: `${today}T13:00:00`, notes: "", exteriorWork: false, status: "scheduled", crewMember: "Someone Else", etaMinutes: null });

const fieldJobsBefore = await A.listJobs.handler(ctx, { _sessionToken: fieldToken, search: "" });
check("preset: field member lists every company job", fieldJobsBefore.jobs.some((j: any) => j.id === jobA.id) && fieldJobsBefore.jobs.some((j: any) => j.id === jobB.id));
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: fieldMade.id, overrides: { seeAllJobs: false } });
const fieldJobsAfter = await A.listJobs.handler(ctx, { _sessionToken: fieldToken, search: "" });
check("seeAllJobs off: listJobs keeps only scheduled-on jobs", fieldJobsAfter.jobs.some((j: any) => j.id === jobA.id) && !fieldJobsAfter.jobs.some((j: any) => j.id === jobB.id), JSON.stringify(fieldJobsAfter.jobs.map((j: any) => j.id)));
const ownJob = await A.getJob.handler(ctx, { _sessionToken: fieldToken, id: jobA.id });
check("seeAllJobs off: own job still opens", ownJob.job?.id === jobA.id);
await checkThrows("seeAllJobs off: another job's detail is refused", () => A.getJob.handler(ctx, { _sessionToken: fieldToken, id: jobB.id }), /isn't on your schedule/);
const fieldAppts = await A.listAppointments.handler(ctx, { _sessionToken: fieldToken });
check("seeAllJobs off: appointments filtered to own jobs/crew name", fieldAppts.appointments.some((a: any) => a.jobId === jobA.id) && !fieldAppts.appointments.some((a: any) => a.jobId === jobB.id));
await A.setMemberAccess.handler(ctx, { _sessionToken: ownerToken, userId: fieldMade.id, overrides: { seeAllJobs: null } });

// --- 11. Tier flag gating --------------------------------------------------------------------------
const owner2 = await signUpOwner("Second Owner", "owner@beta.test", "owner2-pass-123");
const company2 = owner2.user.companyId;
const betaTeam = await A.listTeamMembers.handler(ctx, { _sessionToken: owner2.sessionToken });
check("second company also defaults to office tier", betaTeam.tier === "office" && betaTeam.crewCode !== crewCode);
const betaCrew = await A.createCrewLogin.handler(ctx, { _sessionToken: owner2.sessionToken, name: "Beta Crew", overrides: {} });
check("office-tier company can create crew logins", typeof betaCrew.id === "number");

// Flip company 2 to the app tier directly (the flag's storage truth).
await db.update(schema.companies).set({ tier: "app" }).where(eq(schema.companies.id, company2));
await checkThrows("app tier: createStaffAccount refused with upgrade message", () => A.createStaffAccount.handler(ctx, { _sessionToken: owner2.sessionToken, name: "No Staff", email: "nostaff@beta.test", password: "nostaff-pass-1", role: "field" }), /Crewkat Office plan/);
await checkThrows("app tier: createCrewLogin refused with upgrade message", () => A.createCrewLogin.handler(ctx, { _sessionToken: owner2.sessionToken, name: "No Crew", overrides: {} }), /Crewkat Office plan/);
await checkThrows("app tier: setMemberAccess refused with upgrade message", () => A.setMemberAccess.handler(ctx, { _sessionToken: owner2.sessionToken, userId: betaCrew.id, overrides: { seeMoney: false } }), /Crewkat Office plan/);
const betaTeamApp = await A.listTeamMembers.handler(ctx, { _sessionToken: owner2.sessionToken });
check("app tier: team list still readable (and reports tier app)", betaTeamApp.tier === "app" && betaTeamApp.members.length === 2);
const betaJob = await A.createJob.handler(ctx, { _sessionToken: owner2.sessionToken, clientId: null, clientName: "Beta Solo", clientPhone: "", clientEmail: "", jobAddress: "7 Solo Rd, Tampa, FL", jobType: "Repair", notes: "", jobDate: today, appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "" });
check("app tier: the owner's own work is unaffected", typeof betaJob.id === "number");
const betaDeactivate = await A.updateStaffMember.handler(ctx, { _sessionToken: owner2.sessionToken, userId: betaCrew.id, active: false });
check("app tier: deactivation still works (off switches are never gated)", betaDeactivate.ok === true);
await db.update(schema.companies).set({ tier: "office" }).where(eq(schema.companies.id, company2));
const betaStaff = await A.createStaffAccount.handler(ctx, { _sessionToken: owner2.sessionToken, name: "Beta Staff", email: "staff@beta.test", password: "betastaff-pass-1", role: "field" });
check("back on office tier, staff creation works again", typeof betaStaff.id === "number");

// --- 12. Crew lockout (company 2's crew code) ---------------------------------------------------------
// betaCrew was deactivated above; reactivate so PIN attempts reach the
// credential check. 10 failures inside the window locks the company.
await A.updateStaffMember.handler(ctx, { _sessionToken: owner2.sessionToken, userId: betaCrew.id, active: true });
const betaCode = betaTeam.crewCode as string;
const wrongPin = betaCrew.pin === "999999" ? "888888" : "999999";
for (let i = 0; i < 10; i++) {
  await A.crewLogin.handler(ctx, { companyCode: betaCode, pin: wrongPin }).catch(() => {});
}
await checkThrows("after 10 failed attempts the company is locked out", () => A.crewLogin.handler(ctx, { companyCode: betaCode, pin: wrongPin }), /Too many crew sign-in attempts/);
await checkThrows("lockout refuses even the CORRECT PIN", () => A.crewLogin.handler(ctx, { companyCode: betaCode, pin: betaCrew.pin }), /Too many crew sign-in attempts/);
// Company 1's crew sign-in is unaffected by company 2's lockout.
const acmeCrewOk = await A.crewLogin.handler(ctx, { companyCode: crewCode, pin: reset.pin });
check("lockout is per-company (company 1 crew still signs in)", acmeCrewOk.user.id === crewMade.id);

// Cross-company: company 2's admin cannot touch company 1's members.
await checkThrows("second company admin cannot set first company's switches", () => A.setMemberAccess.handler(ctx, { _sessionToken: owner2.sessionToken, userId: fieldMade.id, overrides: { seeMoney: false } }), /not found/);
await checkThrows("second company admin cannot reset first company's PINs", () => A.resetCrewPin.handler(ctx, { _sessionToken: owner2.sessionToken, userId: crewMade.id }), /not found/);

// --- 13. Legacy solo regression -----------------------------------------------------------------------
const solo = await signUpOwner("Solo Sam", "solo@sam.test", "solo-pass-1234");
check("legacy login shape carries email credential + all-on access", solo.user.credentialType === "email" && Object.values(solo.user.access).every(Boolean));
const soloQuote = await A.saveQuote.handler(ctx, {
  _sessionToken: solo.sessionToken, jobId: null, clientId: null, clientName: "Legacy Client",
  clientPhone: "", clientEmail: "", shippingAddress: "", jobType: "Remodel",
  jobAddress: "9 Legacy Ln, Tampa, FL", lineItems: [{ name: "Work", description: "Legacy work", amount: "750.00", quantity: 1 }],
  subtotal: "750.00", total: "750.00", expiryDate: "", sentAt: "", depositType: "none", depositValue: "0", materials: [],
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a",
});
const soloConverted = await A.convertQuoteToInvoice.handler(ctx, { _sessionToken: solo.sessionToken, quoteId: soloQuote.id, today });
const soloInvoices = await A.listInvoices.handler(ctx, { _sessionToken: solo.sessionToken });
check("legacy solo flow unchanged: quote -> invoice with real totals", soloInvoices.invoices.find((i: any) => i.id === soloConverted.invoiceId)?.total === "750.00");

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Tier 2 checks passed.");
