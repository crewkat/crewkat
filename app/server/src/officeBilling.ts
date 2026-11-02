// Crewkat Office subscription billing (SimplySub steals Item 5, 0097).
//
// Office is billed PER COMPANY on the SUBSCRIPTIONS Stripe account — the
// same account and machinery as Crewkat Premium ($19): the checkout /
// billing-portal / webhook privileged ops in privileged.ts, extended
// with plan tags "office" / "office_founding". The Connect platform
// account (STRIPE_CONNECT_*) is a different Stripe account and is NEVER
// touched by anything in this module or its callers.
//
// Pricing (LOCKED 2026-11-01): $49/mo flat, UNLIMITED users; $490/yr;
// first 100 Office companies lock $39/mo for life (founding). Companies
// already using Office when billing switches on are grandfathered at
// the founding rate. Prices come from env ONLY — no price ID is ever
// hardcoded here:
//   STRIPE_OFFICE_PRICE_MONTHLY / STRIPE_OFFICE_PRICE_ANNUAL /
//   STRIPE_OFFICE_PRICE_FOUNDING
// When they are unset, Office billing reports a clean "not configured"
// setup state (the QuickBooks/Connect pattern) — never a dead button.
//
// ENFORCEMENT: OFFICE_BILLING_ENABLED env flag, default OFF (unset).
// While OFF, nothing in this file changes any behavior for any company.
// While ON, a company whose Office subscription is LAPSED (definition
// below) gets Office READ-ONLY: the gate lives in protectActions
// (actions.ts) and fires only for calls carrying the Office surface
// signal, so the phone app is never blocked and Premium is unaffected.

import { eq, isNotNull } from "drizzle-orm";
import type { Ctx } from "@hatch/space-sdk";
import * as schema from "./schema";
import { OFFICE_BILLING_EXEMPT_ACTIONS, PLATFORM_ACTIONS, isOfficeReadAction } from "./permissions";

type Db = ReturnType<Ctx["db"]>;
type Company = typeof schema.companies.$inferSelect;

export const OFFICE_FOUNDING_TOTAL = 100;

export type OfficePlanState = Company["officePlanState"];

/** The three env-configured Office price IDs (null when unset). */
export function officePriceIds(): { monthly: string | null; annual: string | null; founding: string | null } {
  const read = (name: string) => process.env[name]?.trim() || null;
  return {
    monthly: read("STRIPE_OFFICE_PRICE_MONTHLY"),
    annual: read("STRIPE_OFFICE_PRICE_ANNUAL"),
    founding: read("STRIPE_OFFICE_PRICE_FOUNDING"),
  };
}

/** Office billing is "configured" once Danny has created the Stripe
 *  prices and set all three env IDs. Anything less is the setup state. */
export function officeBillingConfigured(): boolean {
  const ids = officePriceIds();
  return !!ids.monthly && !!ids.annual && !!ids.founding;
}

/** Enforcement master switch. Default OFF: env unset (or anything other
 *  than 1/true) means zero behavior change everywhere. */
export function officeBillingEnabled(): boolean {
  const raw = process.env.OFFICE_BILLING_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/** Founding grants used so far — counted from company data (the
 *  office_founding_granted_at flag), never a stored constant. */
export async function countOfficeFoundingGrants(db: Db): Promise<number> {
  const rows = await db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(isNotNull(schema.companies.officeFoundingGrantedAt));
  return rows.length;
}

// FOUNDING RULE (Danny 2026-11-01, "never punish loyalty"):
// A company qualifies for the $39/mo-for-life founding price when
//   (a) GRANDFATHERED — it already uses Office when billing first
//       switches on, OR
//   (b) the count of companies EVER granted founding is still < 100.
// (a) is implemented data-driven: a company is grandfathered when it has
// Office-surface usage rows (leads, follow-ups, safety sessions, member
// credentials, automation settings, campaigns — tables only Office
// flows write) recorded BEFORE its first Office-billing interaction.
// While billing is off/unconfigured every existing company accumulates
// exactly that evidence by using Office for free; a company created
// after billing launches has no Office data at its first checkout (it
// subscribes before it can build any), so the predicate separates the
// two cohorts from data alone, with no "billing switched on" timestamp
// to keep in sync. Grandfathered grants also set the granted flag, so
// they count toward the same 100-company counter as (b) grants.
export async function companyHasOfficeUsage(db: Db, companyId: number): Promise<boolean> {
  const probes = [
    db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.companyId, companyId)).limit(1),
    db.select({ id: schema.followUps.id }).from(schema.followUps).where(eq(schema.followUps.companyId, companyId)).limit(1),
    db.select({ id: schema.safetySessions.id }).from(schema.safetySessions).where(eq(schema.safetySessions.companyId, companyId)).limit(1),
    db.select({ id: schema.memberCredentials.id }).from(schema.memberCredentials).where(eq(schema.memberCredentials.companyId, companyId)).limit(1),
    db.select({ id: schema.officeAutomationSettings.companyId }).from(schema.officeAutomationSettings).where(eq(schema.officeAutomationSettings.companyId, companyId)).limit(1),
    db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.companyId, companyId)).limit(1),
  ];
  for (const probe of probes) {
    if ((await probe).length > 0) return true;
  }
  return false;
}

export async function officeFoundingQualification(
  db: Db,
  company: Company,
): Promise<{ qualifies: boolean; grandfathered: boolean; grantsUsed: number }> {
  const grantsUsed = await countOfficeFoundingGrants(db);
  if (company.officeFoundingGrantedAt) {
    // Already granted — the founding rate is theirs for life.
    return { qualifies: true, grandfathered: true, grantsUsed };
  }
  const grandfathered = await companyHasOfficeUsage(db, company.id);
  return { qualifies: grandfathered || grantsUsed < OFFICE_FOUNDING_TOTAL, grandfathered, grantsUsed };
}

// LAPSED definition (enforcement): a company is lapsed only when its
// Office plan state is "canceled", or "past_due" with the subscription's
// current period already ended (Stripe keeps retrying the card during
// past_due; the company keeps full Office access until the paid period
// actually runs out). "none" (never subscribed), "founding", and
// "active" are never lapsed.
export function officeSubscriptionLapsed(company: Pick<Company, "officePlanState" | "officeCurrentPeriodEnd">, now = new Date()): boolean {
  if (company.officePlanState === "canceled") return true;
  if (company.officePlanState === "past_due" && company.officeCurrentPeriodEnd && company.officeCurrentPeriodEnd.getTime() < now.getTime()) return true;
  return false;
}

// ENFORCEMENT SEAM. protectActions (actions.ts) is the single choke
// point every non-public action passes through. The Office client tags
// every call with the `_surface: "office"` auth-envelope field (see
// app/office/src/api.ts); the phone client never sends it. When the
// flag is ON and the call is an Office-surface MUTATION (reads are
// classified in permissions.ts: get*/list*/export*/preview* prefixes
// plus a small explicit read set) for a lapsed company, the call is
// refused here with an upgrade-prompt error — Office data stays fully
// readable, the phone app (no surface tag) is untouched, and the
// billing/support/self-service actions in OFFICE_BILLING_EXEMPT_ACTIONS
// stay open so the company can always fix its subscription.
export async function assertOfficeBillingAllows(db: Db, companyId: number, actionName: string): Promise<void> {
  if (!officeBillingEnabled()) return;
  if (PLATFORM_ACTIONS.has(actionName)) return;
  if (OFFICE_BILLING_EXEMPT_ACTIONS.has(actionName) || isOfficeReadAction(actionName)) return;
  const company = (await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).limit(1))[0];
  if (!company) return;
  if (officeSubscriptionLapsed(company)) {
    throw new Error("Crewkat Office is read-only for your company — the Office subscription has lapsed. An admin can restart it in Office → Settings → Billing.");
  }
}
