import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { formatDate, formatMoney, parseMoney, todayIso } from "../utils";
import type { DocSelection } from "./Documents";

/**
 * Money — the financial dashboard (see MoneyView below). The plan and
 * billing-history block that used to live here moved to Settings
 * (Danny 2026-11-01), and the accountant Export / Invoice Fly Import
 * panels followed it there (Settings → Backup & restore).
 */
type MoneyMode = "month" | "week";

interface MoneyBucket {
  key: string;
  label: string;
  invoiced: number;
  collected: number;
  stillOwed: number;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Monday (local) of the week containing `d`. */
function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Money dashboard (Danny 2026-11-01): the plan/billing block moved to
 * Settings; this page is the company's money at a glance — a big
 * year-to-date hero, the stat row, an invoiced-vs-collected chart with
 * a Month/Week toggle and the matching breakdown list, then the open
 * balances and payments-received lists the page has always carried.
 * Everything is computed from the same listInvoices / listQuotes /
 * listJobs payloads Office already fetches; when a member's seeMoney
 * switch is off the server blanks the figures, exactly as before.
 * Month mode buckets the current calendar year; Week mode buckets the
 * trailing 12 Monday-start weeks including the current one.
 */
export function MoneyView({ onOpenDocument }: { onOpenDocument: (sel: DocSelection) => void }) {
  const invoicesQuery = useQuery({ queryKey: ["invoices"], queryFn: () => api.listInvoices({}) });
  const quotesQuery = useQuery({ queryKey: ["quotes"], queryFn: () => api.listQuotes({}) });
  const jobsQuery = useQuery({ queryKey: ["jobs", ""], queryFn: () => api.listJobs({ search: "" }) });
  const attemptsQuery = useQuery({ queryKey: ["invoice-payment-attempts"], queryFn: () => api.listInvoicePaymentAttempts({}) });
  const [mode, setMode] = useState<MoneyMode>("month");

  const invoices = useMemo(() => invoicesQuery.data?.invoices ?? [], [invoicesQuery.data]);
  const quotes = useMemo(() => quotesQuery.data?.quotes ?? [], [quotesQuery.data]);
  const jobs = useMemo(() => jobsQuery.data?.jobs ?? [], [jobsQuery.data]);

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
  const toReceive = openInvoices.reduce((sum, i) => sum + parseMoney(i.balanceRemaining), 0);

  const year = new Date().getFullYear();
  const inYear = (dateStr: string) => dateStr.slice(0, 4) === String(year);
  const ytdInvoiced = invoices.filter((i) => inYear(i.issueDate)).reduce((sum, i) => sum + parseMoney(i.total), 0);
  // Numbers integrity (audit Batch 2): "collected" is the money APPLIED to
  // invoices (server-shaped paidApplied — capped at each invoice's total,
  // overpayment excluded and shown as credit below), bucketed by the
  // invoice's issue period — the exact rule the phone app's totals use, so
  // app and Office can only agree. Raw payment rows remain the ledger for
  // the "Payments received" history list.
  const ytdCollected = invoices.filter((i) => inYear(i.issueDate)).reduce((sum, i) => sum + parseMoney(i.paidApplied ?? i.paidToDate), 0);
  const totalCredit = invoices.reduce((sum, i) => sum + parseMoney(i.credit ?? "0"), 0);
  // One shared "open estimate" definition (audit Batch 2): sent, not
  // accepted/won/lost, not converted, not superseded — the same predicate
  // the automation center and dashboard use server-side.
  const openQuotes = quotes.filter((q) => q.sentAt !== "" && !q.accepted && q.automationStatus === "awaiting" && q.convertedToInvoiceId == null && !q.superseded);
  const openQuotesTotal = openQuotes.reduce((sum, q) => sum + parseMoney(q.total), 0);
  const activeJobs = jobs.filter((j) => j.productionStage !== "complete" && j.productionStage !== "paid_in_full").length;

  const buckets = useMemo<MoneyBucket[]>(() => {
    const make = (key: string, label: string): MoneyBucket => ({ key, label, invoiced: 0, collected: 0, stillOwed: 0 });
    if (mode === "month") {
      const list = MONTH_SHORT.map((label, i) => make(`${year}-${String(i + 1).padStart(2, "0")}`, label));
      for (const inv of invoices) {
        if (!inYear(inv.issueDate)) continue;
        const b = list[Number(inv.issueDate.slice(5, 7)) - 1];
        if (!b) continue;
        b.invoiced += parseMoney(inv.total);
        b.collected += parseMoney(inv.paidApplied ?? inv.paidToDate);
        b.stillOwed += Math.max(0, parseMoney(inv.balanceRemaining));
      }
      return list;
    }
    const starts: Date[] = [];
    const thisWeek = weekStart(new Date());
    for (let i = 11; i >= 0; i--) {
      const d = new Date(thisWeek);
      d.setDate(d.getDate() - i * 7);
      starts.push(d);
    }
    const list = starts.map((d) => make(dayKey(d), `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`));
    const indexOf = (dateStr: string) => {
      const t = new Date(`${dateStr}T12:00:00`).getTime();
      return starts.findIndex((s, i) => t >= s.getTime() && (i === starts.length - 1 || t < starts[i + 1]!.getTime()));
    };
    for (const inv of invoices) {
      const idx = indexOf(inv.issueDate);
      if (idx < 0) continue;
      list[idx]!.invoiced += parseMoney(inv.total);
      list[idx]!.collected += parseMoney(inv.paidApplied ?? inv.paidToDate);
      list[idx]!.stillOwed += Math.max(0, parseMoney(inv.balanceRemaining));
    }
    return list;
  }, [mode, invoices, paymentsAcross, year]);

  const chartMax = Math.max(1, ...buckets.map((b) => Math.max(b.invoiced, b.collected)));
  const loading = invoicesQuery.isLoading;

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Money</h1>
          <p className="view-sub">Collected, invoiced, and still to be received — across every job and estimate. Your plan and billing history live in Settings now.</p>
        </div>
      </div>

      {invoicesQuery.isError ? (
        <div className="empty-state">
          <div className="empty-icon">◍</div>
          <p>Couldn't load your money data.</p>
          <button type="button" className="btn btn-primary" onClick={() => void invoicesQuery.refetch()}>Try again</button>
        </div>
      ) : (
        <>
          <section className="panel money-hero">
            <span className="money-hero-label">Collected year to date · {year}</span>
            <span className="money-hero-figure">{loading ? "…" : formatMoney(ytdCollected)}</span>
            <span className="money-hero-sub">{formatMoney(ytdInvoiced)} invoiced so far this year · {formatMoney(toReceive)} still to be received</span>
          </section>

          <div className="mini-stats money-stats">
            <div><span>Open estimates</span><strong>{openQuotes.length} · {formatMoney(openQuotesTotal)}</strong></div>
            <div><span>Invoiced · {year}</span><strong>{formatMoney(ytdInvoiced)}</strong></div>
            <div><span>Collected · {year}</span><strong>{formatMoney(ytdCollected)}</strong></div>
            <div><span>To be received</span><strong>{openInvoices.length} open · {formatMoney(toReceive)}</strong></div>
            {totalCredit > 0 ? <div><span>Client credit</span><strong>{formatMoney(totalCredit)}</strong></div> : null}
            <div><span>Active jobs</span><strong>{jobsQuery.isLoading ? "…" : `${activeJobs} of ${jobs.length}`}</strong></div>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Invoiced vs collected</h2>
              <div className="segmented" role="group" aria-label="Chart period">
                <button type="button" className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>Month</button>
                <button type="button" className={mode === "week" ? "active" : ""} onClick={() => setMode("week")}>Week</button>
              </div>
            </div>
            <div className="money-legend">
              <span><i className="legend-dot invoiced" /> Invoiced</span>
              <span><i className="legend-dot collected" /> Collected</span>
            </div>
            <div className="money-chart" role="img" aria-label={`Bar chart of invoiced versus collected by ${mode}`}>
              {buckets.map((b) => (
                <div key={b.key} className="chart-group">
                  <div className="chart-bars">
                    <span className="chart-bar invoiced" style={{ height: `${Math.max(2, (b.invoiced / chartMax) * 100)}%` }} title={`${b.label} invoiced ${formatMoney(b.invoiced)}`} />
                    <span className="chart-bar collected" style={{ height: `${Math.max(2, (b.collected / chartMax) * 100)}%` }} title={`${b.label} collected ${formatMoney(b.collected)}`} />
                  </div>
                  <span className="chart-label">{b.label}</span>
                </div>
              ))}
            </div>
            <table className="data-table money-breakdown">
              <thead>
                <tr><th>{mode === "month" ? "Month" : "Week of"}</th><th>Invoiced</th><th>Collected</th><th>Still owed from this {mode === "month" ? "month" : "week"}</th></tr>
              </thead>
              <tbody>
                {[...buckets].reverse().map((b) => (
                  <tr key={b.key}>
                    <td>{mode === "month" ? `${b.label} ${year}` : b.label}</td>
                    <td>{formatMoney(b.invoiced)}</td>
                    <td>{formatMoney(b.collected)}</td>
                    <td>{b.stillOwed > 0 ? formatMoney(b.stillOwed) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="money-grid">
            <section className="panel">
              <div className="panel-head"><h2>Open client balances ({openInvoices.length})</h2></div>
              {loading ? <p className="muted">Loading invoices…</p> : null}
              {!loading && openInvoices.length === 0 ? <p className="muted">Nothing outstanding — every sent invoice is settled.</p> : null}
              {openInvoices.length > 0 ? (
                <ul className="link-list">
                  {openInvoices.map((inv) => (
                    <li key={inv.id}>
                      <button type="button" onClick={() => onOpenDocument({ kind: "invoice", id: inv.id })}>
                        <span>{inv.invoiceNumber} · {inv.clientName}</span>
                        <span className="feed-meta">
                          {`Balance ${formatMoney(inv.balanceRemaining)} of ${formatMoney(inv.total)}`}
                          {inv.dueDate ? ` · Due ${formatDate(inv.dueDate)}${inv.dueDate < todayIso() ? " · overdue" : ""}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="panel">
              <div className="panel-head"><h2>Payments received across invoices ({paymentsAcross.length})</h2></div>
              {!loading && paymentsAcross.length === 0 ? <p className="muted">No client payments recorded yet.</p> : null}
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

            {(attemptsQuery.data?.attempts.length ?? 0) > 0 ? (
              <section className="panel">
                <div className="panel-head"><h2>Online payment attempts ({attemptsQuery.data!.attempts.length})</h2></div>
                <p className="muted small">Every Pay Now checkout started from an invoice link — including ones that didn't finish, so a client who says "I tried to pay" is easy to check.</p>
                <ul className="link-list static">
                  {attemptsQuery.data!.attempts.map((a) => (
                    <li key={a.id}>
                      <span>{formatMoney(a.amount)} · {a.invoiceNumber} · {a.clientName}</span>
                      <span className="feed-meta">
                        {a.status === "paid" ? "Paid" : a.status === "pending" ? "Started — not completed" : a.status === "failed" ? "Payment failed" : "Link expired"}
                        {a.method ? ` · ${a.method === "us_bank_account" ? "ACH" : "Card"}` : ""} · {formatDate(a.createdAt.slice(0, 10))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
