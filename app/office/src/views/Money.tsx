import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../api";
import { formatCents, formatDate, formatMoney, parseMoney, todayIso } from "../utils";
import type { DocSelection } from "./Documents";

/**
 * Account money view (Track 1b) — READ-ONLY by design.
 * Plan + billing history come from getBillingOverview (the same action the
 * phone Billing screen uses); invoice balances and payments come from
 * listInvoices' server-derived fields. No checkout, no portal session, no
 * Stripe writes: subscription changes stay with the provider / phone app.
 */
export function MoneyView({ onOpenDocument }: { onOpenDocument: (sel: DocSelection) => void }) {
  const billingQuery = useQuery({ queryKey: ["billing-overview"], queryFn: () => api.getBillingOverview({}) });
  const invoicesQuery = useQuery({ queryKey: ["invoices"], queryFn: () => api.listInvoices({}) });

  const billing = billingQuery.data;
  const plan = billing?.plan;
  const invoices = useMemo(() => invoicesQuery.data?.invoices ?? [], [invoicesQuery.data]);

  const paymentsAcross = useMemo(() => {
    const rows = invoices.flatMap((inv) =>
      inv.payments.map((p) => ({ payment: p, invoice: inv })),
    );
    rows.sort((a, b) =>
      a.payment.paymentDate !== b.payment.paymentDate
        ? (a.payment.paymentDate < b.payment.paymentDate ? 1 : -1)
        : (a.payment.createdAt < b.payment.createdAt ? 1 : -1),
    );
    return rows;
  }, [invoices]);

  const openInvoices = invoices.filter((i) => i.status !== "paid" && parseMoney(i.balanceRemaining) > 0);

  const isFounder = plan?.status === "founder" || plan?.status === "founding_member";
  const planLabel = !plan ? "" : isFounder ? "Founder plan" : plan.tier === "premium" ? "Crewkat Premium" : "Free plan";
  const periodEnd = plan?.currentPeriodEnd ? formatDate(plan.currentPeriodEnd) : null;

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Money & billing</h1>
          <p className="view-sub">Your Crewkat plan, billing history, and what clients owe — read-only; nothing here charges or changes a subscription.</p>
        </div>
      </div>

      <div className="money-grid">
        <section className="panel">
          <div className="panel-head"><h2>Your plan</h2></div>
          {billingQuery.isLoading ? <p className="muted">Loading plan…</p> : null}
          {billingQuery.isError ? (
            <div className="empty-state small">
              <div className="empty-icon">◍</div>
              <p>Couldn't load billing.</p>
              <button type="button" className="btn btn-primary" onClick={() => void billingQuery.refetch()}>Try again</button>
            </div>
          ) : null}
          {plan ? (
            <>
              <p className="plan-name">{planLabel}</p>
              <dl className="detail-list">
                <div><dt>Status</dt><dd>{plan.status || "—"}</dd></div>
                {periodEnd ? <div><dt>{plan.cancelAtPeriodEnd ? "Ends" : "Renews"}</dt><dd>{periodEnd}</dd></div> : null}
                <div>
                  <dt>Billed through</dt>
                  <dd>{plan.provider === "stripe" ? "Stripe" : plan.provider === "play" ? "Google Play" : isFounder ? "— (founder plan, no billing)" : "Set up by the Crewkat team"}</dd>
                </div>
              </dl>
              <p className="muted small">
                {plan.provider === "play"
                  ? "Manage or cancel this subscription in the Play Store app."
                  : "To change plans or payment methods, use Billing in the Crewkat phone app — Office shows the state only."}
              </p>
            </>
          ) : null}

          <h3 className="day-section-title">Billing payment history</h3>
          {billing && billing.payments.length === 0 ? <p className="muted">No billing payments yet.</p> : null}
          {billing && billing.payments.length > 0 ? (
            <ul className="link-list static">
              {billing.payments.map((p) => {
                const row = (
                  <>
                    <span>{p.description}</span>
                    <span className="feed-meta">
                      {formatDate(p.date)} · {p.source === "subscription" ? "Subscription" : "Promotion"}
                      {p.status && p.status !== "paid" && p.status !== "completed" ? ` · ${p.status}` : ""}
                      {p.amountCents !== null ? ` · ${formatCents(p.amountCents, p.currency)}` : ""}
                    </span>
                  </>
                );
                return (
                  <li key={p.id}>
                    {p.receiptUrl ? (
                      <a className="billing-receipt-link" href={p.receiptUrl} target="_blank" rel="noopener noreferrer">{row}</a>
                    ) : row}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Open client balances ({openInvoices.length})</h2></div>
          {invoicesQuery.isLoading ? <p className="muted">Loading invoices…</p> : null}
          {invoicesQuery.isError ? <p className="muted">Couldn't load invoices.</p> : null}
          {!invoicesQuery.isLoading && openInvoices.length === 0 ? <p className="muted">Nothing outstanding — every sent invoice is settled.</p> : null}
          {openInvoices.length > 0 ? (
            <ul className="link-list">
              {openInvoices.map((inv) => (
                <li key={inv.id}>
                  <button type="button" onClick={() => onOpenDocument({ kind: "invoice", id: inv.id })}>
                    <span>{inv.invoiceNumber} · {inv.clientName}</span>
                    <span className="feed-meta">
                      Balance {formatMoney(inv.balanceRemaining)} of {formatMoney(inv.total)}
                      {inv.dueDate ? ` · Due ${formatDate(inv.dueDate)}${inv.dueDate < todayIso() ? " · overdue" : ""}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <h3 className="day-section-title">Payments received across invoices ({paymentsAcross.length})</h3>
          {!invoicesQuery.isLoading && paymentsAcross.length === 0 ? <p className="muted">No client payments recorded yet.</p> : null}
          {paymentsAcross.length > 0 ? (
            <ul className="link-list static">
              {paymentsAcross.slice(0, 25).map(({ payment: p, invoice: inv }) => (
                <li key={p.id}>
                  <span>{formatMoney(p.amount)} · {inv.invoiceNumber} · {inv.clientName}</span>
                  <span className="feed-meta">
                    {formatDate(p.paymentDate)}{p.method ? ` · ${p.method}` : ""}{p.note && p.note !== "__paid_toggle__" ? ` · ${p.note}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {paymentsAcross.length > 25 ? <p className="muted small">Showing the 25 most recent payments — open an invoice to see its full history.</p> : null}
        </section>
      </div>
    </div>
  );
}
