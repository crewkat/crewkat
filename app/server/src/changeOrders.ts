// Change-order document math (Danny 2026-10-21): change orders are
// official documents, so their number and contract-sum chain are derived
// in ONE place on the server and shared by the document render, the
// client link payload, the portal, and the contractor app — the client
// never supplies or recomputes totals.
//
// Numbering: a change order's number is its position among the job's
// change orders ordered by createdAt then id (1-based). Derived from
// existing rows — no stored field, no migration — and stable as long as
// rows are not deleted (deleting an earlier CO renumbers later ones,
// which matches how the paper chain would be reissued).
//
// Contract-sum chain: walk the job's change orders in number order with
// a running sum that starts at the ORIGINAL contract amount. Each CO's
// "contract sum before" is the running sum at its position; only SIGNED
// change orders advance the running sum (a pending CO's "new sum" is
// what the total becomes IF it is signed, and it does not move the
// chain for later COs until it is signed).
//
// Original contract amount source, in order: (1) the job's explicit
// contract sum (jobs.contractSum, migration 0086 — set by the
// contractor when the derived base is wrong, e.g. an uploaded-PDF
// contract with no stored amount); (2) the job's earliest contract
// document carrying a parseable amount; (3) the job's amountDue
// field (a job-level figure the proof packet treats as the base the
// COs add to — but it also carries balance-due meaning in payment
// reminders, which is why the explicit field exists and wins);
// (4) 0.
import { asc, eq } from "drizzle-orm";
import type { Ctx } from "@hatch/space-sdk";
import * as schema from "./schema";

type Db = ReturnType<Ctx["db"]>;

export function parseMoneyLoose(value: string | null | undefined): number {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function moneyString(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

type DocumentRow = typeof schema.documents.$inferSelect;
type JobRow = typeof schema.jobs.$inferSelect;

export async function jobDocumentsOrdered(
  db: Db,
  jobId: number,
): Promise<DocumentRow[]> {
  return db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.jobId, jobId))
    .orderBy(asc(schema.documents.createdAt), asc(schema.documents.id));
}

/** CO id → 1-based number among the job's change orders. */
export function changeOrderNumbers(docs: DocumentRow[]): Map<number, number> {
  const out = new Map<number, number>();
  docs
    .filter((d) => d.kind === "change_order")
    .forEach((d, i) => out.set(d.id, i + 1));
  return out;
}

export function originalContractAmount(job: JobRow, docs: DocumentRow[]): number {
  const explicit = parseMoneyLoose(job.contractSum);
  if (explicit > 0) return explicit;
  for (const doc of docs) {
    if (doc.kind !== "contract") continue;
    const amount = parseMoneyLoose(doc.amount);
    if (amount > 0) return amount;
  }
  const due = parseMoneyLoose(job.amountDue);
  return due > 0 ? due : 0;
}

export function referenceContractTitle(docs: DocumentRow[]): string {
  const contract = docs.find((d) => d.kind === "contract");
  return contract?.title ?? "";
}

export type ChangeOrderMath = {
  number: number;
  baseAmount: string;
  contractSumBefore: string;
  amount: string;
  newContractSum: string;
  signed: boolean;
};

/**
 * The full chain for a job: one entry per change order, in number
 * order. `contractSumBefore`/`newContractSum` are money strings.
 */
export function changeOrderChain(job: JobRow, docs: DocumentRow[]): Map<number, ChangeOrderMath> {
  const base = originalContractAmount(job, docs);
  const numbers = changeOrderNumbers(docs);
  const out = new Map<number, ChangeOrderMath>();
  let running = base;
  for (const doc of docs) {
    if (doc.kind !== "change_order") continue;
    const amount = parseMoneyLoose(doc.amount);
    const before = running;
    const after = before + amount;
    const signed = !!doc.clientSignedAt;
    out.set(doc.id, {
      number: numbers.get(doc.id) ?? 0,
      baseAmount: moneyString(base),
      contractSumBefore: moneyString(before),
      amount: moneyString(amount),
      newContractSum: moneyString(after),
      signed,
    });
    if (signed) running = after;
  }
  return out;
}

export type ContractSummary = {
  baseAmount: string;
  // The job's explicit contract sum ("" when unset) — the edit
  // surfaces seed from it; baseAmount stays the RESOLVED base.
  contractSum: string;
  signedChangeOrdersTotal: string;
  revisedTotal: string;
  pendingChangeOrdersTotal: string;
};

/**
 * The job's revised contract total: original contract amount + SIGNED
 * change orders only. Pending COs are summed separately and never
 * included. (getJobOperations' budgetTotal — quoted + ALL change
 * orders — is a profitability figure with different semantics and is
 * deliberately not reused here.)
 */
export function contractSummaryForJob(job: JobRow, docs: DocumentRow[]): ContractSummary {
  const base = originalContractAmount(job, docs);
  let signedTotal = 0;
  let pendingTotal = 0;
  for (const doc of docs) {
    if (doc.kind !== "change_order") continue;
    if (doc.clientSignedAt) signedTotal += parseMoneyLoose(doc.amount);
    else pendingTotal += parseMoneyLoose(doc.amount);
  }
  return {
    baseAmount: moneyString(base),
    contractSum: parseMoneyLoose(job.contractSum) > 0 ? moneyString(parseMoneyLoose(job.contractSum)) : "",
    signedChangeOrdersTotal: moneyString(signedTotal),
    revisedTotal: moneyString(base + signedTotal),
    pendingChangeOrdersTotal: moneyString(pendingTotal),
  };
}

/** First non-empty line of the CO description, capped for list titles. */
export function changeOrderScopeLabel(doc: DocumentRow): string {
  const line = (doc.description || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.length > 72 ? `${line.slice(0, 69).trimEnd()}…` : line;
}

/**
 * The formal list/display title for a change order: "Change Order #N"
 * (ES "Orden de cambio #N") plus the scope label when there is one.
 * Identical on the document, the portal list, and the job screen.
 */
export function changeOrderDisplayTitle(
  doc: DocumentRow,
  number: number,
  lang: "en" | "es" = "en",
): string {
  const base = lang === "es" ? `Orden de cambio #${number}` : `Change Order #${number}`;
  const scope = changeOrderScopeLabel(doc);
  return scope ? `${base} — ${scope}` : base;
}
