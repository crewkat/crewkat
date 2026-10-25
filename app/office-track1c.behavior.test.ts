// Office Track 1c behavior tests (roles & staff accounts).
//
// Covers: migration 0088 (auth_users.deactivated_at), the permission map's
// exhaustiveness (every registered action classified exactly once), and —
// the heart of the track — SERVER-SIDE enforcement exercised through the
// real protected `Actions` surface with real password logins and session
// proofs (never BaseActions shortcuts, never the UI):
//   owner signup becomes Admin -> creates Office + Field staff -> each
//   signs in -> Field denied admin + money actions, Office denied team
//   management + billing but allowed documents/schedule/pipeline, Admin
//   allowed all -> role change takes effect on the next call ->
//   deactivation kills live sessions and logins -> a second company's
//   team and jobs are invisible across the boundary -> a legacy solo
//   owner's document flow runs unchanged.
//
// Run from app/:  bun office-track1c.behavior.test.ts
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
  minRoleForAction,
  productRoleOf,
  roleCan,
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
let nonDecreasing = true;
for (let i = 1; i < entries.length; i++) {
  if (entries[i]!.when < entries[i - 1]!.when) nonDecreasing = false;
}
check("journal when values are non-decreasing", nonDecreasing);
const last = entries[entries.length - 1]!;
const maxBefore = Math.max(...entries.slice(0, -1).map((e) => e.when));
check("newest migration when is strictly greater than every earlier entry", last.when > maxBefore, `last=${last.when} maxBefore=${maxBefore}`);
check("newest migration tag is 0088_team_roles", last.tag === "0088_team_roles", last.tag);
check("newest migration idx is 87", last.idx === 87, String(last.idx));

// --- 2. Scratch DB + migrations --------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-office-1c-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });
const authCols = (await sqlite.execute("PRAGMA table_info(auth_users)").then((r) => (r.rows as Array<{ name: string }>).map((c) => c.name)));
check("migrations applied: auth_users.deactivated_at exists", authCols.includes("deactivated_at"));

// --- 3. Permission map: exhaustive + layered --------------------------------------
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
check("every registered action is classified exactly once", unclassified.length === 0, unclassified.join(", "));
const unknownInMap = [...seen.keys()].filter((n) => !allActionNames.includes(n));
check("permission map names no unknown actions", unknownInMap.length === 0, unknownInMap.join(", "));
check("productRoleOf maps owner/admin -> admin", productRoleOf("owner") === "admin" && productRoleOf("admin") === "admin");
check("productRoleOf maps office/field", productRoleOf("office") === "office" && productRoleOf("field") === "field");
// Field gets NO record deletes (the one self-service exception is deleting
// your own login), NO admin actions, NO office actions.
const fieldDeletes = allActionNames.filter((n) => /^delete/.test(n) && n !== "deleteMyAccount" && roleCan("field", n));
check("field role can call no delete* actions", fieldDeletes.length === 0, fieldDeletes.join(", "));
check("field denied every admin action", [...ADMIN_ACTIONS].every((n) => !roleCan("field", n)));
check("field denied every office action", [...OFFICE_ACTIONS].every((n) => !roleCan("field", n)));
check("office denied every admin action", [...ADMIN_ACTIONS].every((n) => !roleCan("office", n)));
check("office allowed every office action", [...OFFICE_ACTIONS].every((n) => roleCan("office", n)));
check("admin allowed everything classified", allActionNames.every((n) => roleCan("admin", n)));
check("new team actions are admin-only", minRoleForAction("listTeamMembers") === "admin" && minRoleForAction("createStaffAccount") === "admin" && minRoleForAction("updateStaffMember") === "admin");
check("billing mutations are admin-only", minRoleForAction("createBillingPortalSession") === "admin" && minRoleForAction("startPremiumCheckout") === "admin");
check("money dashboards are office+", minRoleForAction("getDashboard") === "office" && minRoleForAction("getOfficeDashboard") === "office");
check("field workhorses stay open to all roles", minRoleForAction("createJob") === "field" && minRoleForAction("saveQuote") === "field" && minRoleForAction("listJobs") === "field");

// --- 4. Test context ---------------------------------------------------------------
const ctx = {
  slug: "tradesign",
  invocationId: "office-track1c-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => Buffer.alloc(0),
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  // Auth emails use the development fallback delivery, which returns the
  // verification code in the signUp response (no real email leaves).
  executePrivileged: async () => ({ delivery: "fallback" }),
  emit: () => {},
  invalidateQueries: () => {},
} as any;

const A = Actions as any;
const today = new Date().toISOString().slice(0, 10);

async function signUpOwner(name: string, email: string, password: string) {
  const res = await A.signUp.handler(ctx, { name, email, password, marketplaceTermsAccepted: true });
  check(`signUp returns a verification code for ${email}`, typeof res.verificationCode === "string" && res.verificationCode.length === 6);
  await A.verifyEmail.handler(ctx, { email, code: res.verificationCode });
  const login = await A.login.handler(ctx, { email, password });
  return login as { sessionToken: string; user: { id: number; companyId: number; role: string; teamRole: string; tier: string } };
}

// --- 5. Company 1: owner becomes Admin automatically -------------------------------
const owner = await signUpOwner("Olivia Owner", "owner@acme.test", "owner-pass-123");
check("legacy signup keeps stored role 'owner'", owner.user.role === "owner", owner.user.role);
check("owner's product role is admin", owner.user.teamRole === "admin", owner.user.teamRole);
const ownerToken = owner.sessionToken;
const company1 = owner.user.companyId;

const team0 = await A.listTeamMembers.handler(ctx, { _sessionToken: ownerToken });
check("team list starts with just the owner", team0.members.length === 1 && team0.members[0].id === owner.user.id && team0.members[0].isSelf === true, JSON.stringify(team0.members));

// --- 6. Admin creates Office + Field staff ------------------------------------------
const officeMade = await A.createStaffAccount.handler(ctx, { _sessionToken: ownerToken, name: "Oscar Office", email: "office@acme.test", password: "office-pass-123", role: "office" });
const fieldMade = await A.createStaffAccount.handler(ctx, { _sessionToken: ownerToken, name: "Fred Field", email: "field@acme.test", password: "field-pass-123", role: "field" });
check("createStaffAccount returns ids", typeof officeMade.id === "number" && typeof fieldMade.id === "number");
const staffRows = await db.select().from(schema.authUsers).where(eq(schema.authUsers.companyId, company1));
check("staff rows live on the owner's company", staffRows.length === 3 && staffRows.every((r) => r.companyId === company1), String(staffRows.length));
check("staff inherit the company plan tier", staffRows.filter((r) => r.id !== owner.user.id).every((r) => r.tier === owner.user.tier));
await checkThrows("duplicate staff email refused", () => A.createStaffAccount.handler(ctx, { _sessionToken: ownerToken, name: "Copy Cat", email: "office@acme.test", password: "copy-pass-1234", role: "field" }), /already exists/);

const team1 = await A.listTeamMembers.handler(ctx, { _sessionToken: ownerToken });
check("team list shows owner + office + field", team1.members.length === 3, JSON.stringify(team1.members.map((m: any) => m.email)));
check("team list carries product roles", team1.members.find((m: any) => m.id === officeMade.id)?.teamRole === "office" && team1.members.find((m: any) => m.id === fieldMade.id)?.teamRole === "field");

// --- 7. Staff sign in with the same login surface ------------------------------------
const officeLogin = await A.login.handler(ctx, { email: "office@acme.test", password: "office-pass-123" });
const fieldLogin = await A.login.handler(ctx, { email: "field@acme.test", password: "field-pass-123" });
const officeToken = officeLogin.sessionToken as string;
const fieldToken = fieldLogin.sessionToken as string;
check("office staff login reports teamRole office", officeLogin.user.teamRole === "office" && officeLogin.user.role === "office");
check("field staff login reports teamRole field", fieldLogin.user.teamRole === "field" && fieldLogin.user.role === "field");
const officeSession = await A.getAuthSession.handler(ctx, { _sessionToken: officeToken });
check("getAuthSession resolves the office staffer", officeSession.user?.id === officeMade.id && officeSession.user?.teamRole === "office");

// --- 8. Enforcement by direct action call ----------------------------------------------
// Field: denied admin actions, money views, office surface, deletes.
await checkThrows("FIELD denied an admin action (updateSettings)", () => A.updateSettings.handler(ctx, { _sessionToken: fieldToken }), /Field role/);
await checkThrows("FIELD denied team management (listTeamMembers)", () => A.listTeamMembers.handler(ctx, { _sessionToken: fieldToken }), /Field role/);
await checkThrows("FIELD denied a money view (getDashboard)", () => A.getDashboard.handler(ctx, { _sessionToken: fieldToken }), /Field role/);
await checkThrows("FIELD denied a money view (getOfficeDashboard)", () => A.getOfficeDashboard.handler(ctx, { _sessionToken: fieldToken }), /Field role/);
await checkThrows("FIELD denied the pipeline (listLeads)", () => A.listLeads.handler(ctx, { _sessionToken: fieldToken }), /Field role/);
await checkThrows("FIELD denied a record delete (deleteInvoice)", () => A.deleteInvoice.handler(ctx, { _sessionToken: fieldToken, id: 1 }), /Field role/);
await checkThrows("FIELD denied recording a payment (addPayment)", () => A.addPayment.handler(ctx, { _sessionToken: fieldToken, invoiceId: 1, amount: "10", paymentDate: today, method: "cash", note: "" }), /Field role/);
// Field: allowed its working surface.
const fieldJob = await A.createJob.handler(ctx, { _sessionToken: fieldToken, clientId: null, clientName: "Field Client", clientPhone: "", clientEmail: "", jobAddress: "1 Field Way, Tampa, FL", jobType: "Repair", notes: "", jobDate: today, appointmentAt: "", amountDue: "", dueDate: "", depositAmount: "", paymentNotes: "" });
check("FIELD can create a job", typeof fieldJob.id === "number");
const fieldJobs = await A.listJobs.handler(ctx, { _sessionToken: fieldToken, search: "" });
check("FIELD lists its company's jobs", fieldJobs.jobs.some((j: any) => j.id === fieldJob.id));

// Office: denied admin + billing + team, allowed documents/schedule/pipeline/money views.
await checkThrows("OFFICE denied an admin action (updateSettings)", () => A.updateSettings.handler(ctx, { _sessionToken: officeToken }), /Office role/);
await checkThrows("OFFICE denied team management (createStaffAccount)", () => A.createStaffAccount.handler(ctx, { _sessionToken: officeToken, name: "Nope", email: "nope@acme.test", password: "nope-pass-1234", role: "field" }), /Office role/);
await checkThrows("OFFICE denied a billing mutation (createBillingPortalSession)", () => A.createBillingPortalSession.handler(ctx, { _sessionToken: officeToken }), /Office role/);
await checkThrows("OFFICE denied a destructive delete (deleteClient)", () => A.deleteClient.handler(ctx, { _sessionToken: officeToken, id: 1 }), /Office role/);
const officeDash = await A.getOfficeDashboard.handler(ctx, { _sessionToken: officeToken });
check("OFFICE can read the money dashboard", typeof officeDash.outstanding === "number");
const officeLead = await A.saveLead.handler(ctx, { _sessionToken: officeToken, name: "Office Lead", phone: "813-555-0130", source: "web", notes: "", projectSize: "small", engagement: "normal", serviceType: "Bathroom", estimatedValue: "3000" });
check("OFFICE can work the pipeline (saveLead)", typeof officeLead.id === "number");
const officeDelete = await A.deleteInvoice.handler(ctx, { _sessionToken: officeToken, id: 999999 });
check("OFFICE may run normal doc deletes (deleteInvoice)", officeDelete.ok === true);

// Admin: allowed across the layers.
const adminBilling = await A.getBillingOverview.handler(ctx, { _sessionToken: ownerToken });
check("ADMIN can read billing overview", adminBilling.plan.tier === owner.user.tier);
const adminDash = await A.getDashboard.handler(ctx, { _sessionToken: ownerToken });
check("ADMIN can read the money dashboard", typeof adminDash.revenueMonth === "number");

// --- 9. Role change takes effect on the next call ---------------------------------------
await checkThrows("before promotion, FIELD denied getDashboard", () => A.getDashboard.handler(ctx, { _sessionToken: fieldToken }), /Field role/);
await A.updateStaffMember.handler(ctx, { _sessionToken: ownerToken, userId: fieldMade.id, role: "office" });
const promotedDash = await A.getDashboard.handler(ctx, { _sessionToken: fieldToken });
check("after promotion to office, the SAME session can read the dashboard", typeof promotedDash.revenueMonth === "number");
await A.updateStaffMember.handler(ctx, { _sessionToken: ownerToken, userId: fieldMade.id, role: "field" });
await checkThrows("after demotion back to field, dashboard denied again", () => A.getDashboard.handler(ctx, { _sessionToken: fieldToken }), /Field role/);

// --- 10. Deactivation ---------------------------------------------------------------------
await A.updateStaffMember.handler(ctx, { _sessionToken: ownerToken, userId: fieldMade.id, active: false });
const deadSession = await A.getAuthSession.handler(ctx, { _sessionToken: fieldToken });
check("deactivation kills the live session", deadSession.user === null, JSON.stringify(deadSession));
// (Sessions are revoked at deactivation, so the dead proof reads as
// expired; the deactivated-specific message is asserted at login below.)
await checkThrows("deactivated staff cannot call actions", () => A.listJobs.handler(ctx, { _sessionToken: fieldToken, search: "" }), /expired|deactivated/);
await checkThrows("deactivated staff cannot log in", () => A.login.handler(ctx, { email: "field@acme.test", password: "field-pass-123" }), /deactivated/);
await A.updateStaffMember.handler(ctx, { _sessionToken: ownerToken, userId: fieldMade.id, active: true });
const revived = await A.login.handler(ctx, { email: "field@acme.test", password: "field-pass-123" });
check("reactivation restores sign-in", revived.user.teamRole === "field");

// Self-protection + owner protection.
await checkThrows("admin cannot deactivate themself", () => A.updateStaffMember.handler(ctx, { _sessionToken: ownerToken, userId: owner.user.id, active: false }), /your own/);
await checkThrows("admin cannot change their own role", () => A.updateStaffMember.handler(ctx, { _sessionToken: ownerToken, userId: owner.user.id, role: "office" }), /your own/);

// --- 11. Second company: total isolation -----------------------------------------------------
const owner2 = await signUpOwner("Second Owner", "owner@beta.test", "owner2-pass-123");
check("second signup lands on a different company", owner2.user.companyId !== company1, `${owner2.user.companyId} vs ${company1}`);
const teamBeta = await A.listTeamMembers.handler(ctx, { _sessionToken: owner2.sessionToken });
check("second company's team list shows only its own owner", teamBeta.members.length === 1 && teamBeta.members[0].email === "owner@beta.test", JSON.stringify(teamBeta.members.map((m: any) => m.email)));
await checkThrows("second company admin cannot touch first company's staff", () => A.updateStaffMember.handler(ctx, { _sessionToken: owner2.sessionToken, userId: fieldMade.id, active: false }), /not found/);
const betaJobs = await A.listJobs.handler(ctx, { _sessionToken: owner2.sessionToken, search: "" });
check("second company sees none of company 1's jobs", !betaJobs.jobs.some((j: any) => j.id === fieldJob.id) && betaJobs.jobs.length === 0, String(betaJobs.jobs.length));
const acmeJobs = await A.listJobs.handler(ctx, { _sessionToken: ownerToken, search: "" });
check("company 1 still sees its field-created job", acmeJobs.jobs.some((j: any) => j.id === fieldJob.id));

// --- 12. Legacy solo behavior: the document flow is unchanged ---------------------------------
const quote = await A.saveQuote.handler(ctx, {
  _sessionToken: ownerToken, jobId: null, clientId: null, clientName: "Legacy Client",
  clientPhone: "", clientEmail: "", shippingAddress: "", jobType: "Remodel",
  jobAddress: "9 Legacy Ln, Tampa, FL", lineItems: [{ name: "Work", description: "Legacy job work", amount: "500.00", quantity: 1 }],
  subtotal: "500.00", total: "500.00", expiryDate: "", sentAt: "", depositType: "none", depositValue: "0", materials: [],
  discountType: "percent", discountValue: "0", taxType: "percent", taxValue: "0",
  footnote: "", theme: "classic", font: "helvetica", accentColor: "#1f5a4a",
});
check("legacy owner saves an estimate", typeof quote.id === "number");
const quotes = await A.listQuotes.handler(ctx, { _sessionToken: ownerToken, search: "" });
check("legacy owner lists the estimate", quotes.quotes.some((q: any) => q.id === quote.id));
const converted = await A.convertQuoteToInvoice.handler(ctx, { _sessionToken: ownerToken, quoteId: quote.id, today });
check("legacy owner converts estimate -> invoice", typeof converted.invoiceId === "number");
const invoices = await A.listInvoices.handler(ctx, { _sessionToken: ownerToken, search: "" });
check("legacy owner lists the invoice", invoices.invoices.some((i: any) => i.id === converted.invoiceId));

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Track 1c role checks passed.");
