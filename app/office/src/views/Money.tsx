import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { downloadBase64, formatCents, formatDate, formatMoney, parseMoney, todayIso } from "../utils";
import type { DocSelection } from "./Documents";

/**
 * Account money view (Track 1b) — READ-ONLY by design.
 * Plan + billing history come from getBillingOverview (the same action the
 * phone Billing screen uses); invoice balances and payments come from
 * listInvoices' server-derived fields. No checkout, no portal session, no
 * Stripe writes: subscription changes stay with the provider / phone app.
 */
type ExportPeriodKind = "all" | "lastMonth" | "month" | "quarter" | "year";
type ExportDataset = "invoices" | "payments" | "expenses" | "pdfzip";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Accountant exports (Danny 2026-10-27): the company's books as CSV
 * spreadsheets plus a batch PDF bundle of invoices. The server gates
 * these on the seeMoney switch; this panel additionally hides itself
 * for members whose money switch is off (seeMoney prop from the shell).
 * Periods mirror the export UX contractors know from Invoice Fly.
 */
function ExportPanel() {
  const now = new Date();
  const [period, setPeriod] = useState<ExportPeriodKind>("all");
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);
  const [selQuarter, setSelQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [selYear, setSelYear] = useState(now.getFullYear());
  const [busy, setBusy] = useState<ExportDataset | null>(null);
  const [error, setError] = useState("");
  const [doneNote, setDoneNote] = useState("");
  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);

  const run = async (dataset: ExportDataset) => {
    setBusy(dataset);
    setError("");
    setDoneNote("");
    const args = {
      period,
      ...(period === "month" ? { month: selMonth, year: selYear } : {}),
      ...(period === "quarter" ? { quarter: selQuarter, year: selYear } : {}),
    };
    try {
      const result =
        dataset === "invoices" ? await api.exportInvoicesCsv(args)
        : dataset === "payments" ? await api.exportPaymentsCsv(args)
        : dataset === "expenses" ? await api.exportExpensesCsv(args)
        : await api.exportInvoicesPdfZip(args);
      downloadBase64(result.dataBase64, result.filename, dataset === "pdfzip" ? "application/zip" : "text/csv;charset=utf-8");
      setDoneNote(`${result.filename} — ${result.rowCount} record${result.rowCount === 1 ? "" : "s"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const row = (dataset: ExportDataset, label: string, hint: string) => (
    <li>
      <span>
        {label}
        <span className="feed-meta">{hint}</span>
      </span>
      <button type="button" className="btn" disabled={busy !== null} onClick={() => void run(dataset)}>
        {busy === dataset ? "Preparing…" : "Download"}
      </button>
    </li>
  );

  return (
    <section className="panel">
      <div className="panel-head"><h2>Export your books</h2></div>
      <p className="muted small">Spreadsheets your accountant can open in Excel or Google Sheets, plus a ZIP with one PDF per invoice.</p>
      <div className="export-period-row">
        <label>
          Period
          <select className="doc-status-select" value={period} onChange={(e) => setPeriod(e.target.value as ExportPeriodKind)}>
            <option value="all">All time</option>
            <option value="lastMonth">Last month</option>
            <option value="month">By month</option>
            <option value="quarter">By quarter</option>
            <option value="year">This year</option>
          </select>
        </label>
        {period === "month" ? (
          <>
            <label>
              Month
              <select className="doc-status-select" value={selMonth} onChange={(e) => setSelMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
              </select>
            </label>
            <label>
              Year
              <select className="doc-status-select" value={selYear} onChange={(e) => setSelYear(Number(e.target.value))}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </>
        ) : null}
        {period === "quarter" ? (
          <>
            <label>
              Quarter
              <select className="doc-status-select" value={selQuarter} onChange={(e) => setSelQuarter(Number(e.target.value))}>
                {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
              </select>
            </label>
            <label>
              Year
              <select className="doc-status-select" value={selYear} onChange={(e) => setSelYear(Number(e.target.value))}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </>
        ) : null}
      </div>
      <ul className="link-list static export-list">
        {row("invoices", "Invoices", "Every invoice with totals, paid and balance — spreadsheet")}
        {row("payments", "Payments", "Every payment received, matched to its invoice — spreadsheet")}
        {row("expenses", "Expenses", "Business expenses and job receipts — spreadsheet")}
        {row("pdfzip", "Invoice PDFs", "One PDF per invoice in the period, bundled in a ZIP")}
      </ul>
      {doneNote ? <p className="muted small">{doneNote}</p> : null}
      {error ? <p className="status error" role="alert">{error}</p> : null}
    </section>
  );
}

type ImportPreview = Awaited<ReturnType<typeof api.previewInvoiceFlyImport>>;

const CLIENT_STATUS_LABEL: Record<string, string> = { new: "New", matched: "Already in Crewkat", invalid: "Can't import" };
const INVOICE_STATUS_LABEL: Record<string, string> = {
  new: "New", duplicate: "Possible duplicate", collision: "Number clash", imported: "Already imported", invalid: "Can't import",
};
const STATUS_PILL_CLASS: Record<string, string> = {
  new: "done", matched: "sent", invalid: "overdue", duplicate: "viewed", collision: "overdue", imported: "draft",
};

/**
 * Invoice Fly import (Danny 2026-10-27): the reverse of the exports
 * above. Pick the Clients and/or Invoices CSVs Invoice Fly produces,
 * review the server's preview (matches, duplicate flags, number
 * clashes), toggle rows, then confirm — nothing writes before that.
 * Same seeMoney gating family as the exports; the panel hides with
 * them for members whose money switch is off.
 */
function ImportPanel() {
  const queryClient = useQueryClient();
  const [clientsCsv, setClientsCsv] = useState("");
  const [invoicesCsv, setInvoicesCsv] = useState("");
  const [clientsName, setClientsName] = useState("");
  const [invoicesName, setInvoicesName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selClients, setSelClients] = useState<Set<number>>(new Set());
  const [selInvoices, setSelInvoices] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"preview" | "run" | null>(null);
  const [error, setError] = useState("");
  const [doneNote, setDoneNote] = useState("");

  const pick = async (file: File | undefined, which: "clients" | "invoices") => {
    if (!file) return;
    const text = await file.text();
    setPreview(null);
    setDoneNote("");
    setError("");
    if (which === "clients") { setClientsCsv(text); setClientsName(file.name); }
    else { setInvoicesCsv(text); setInvoicesName(file.name); }
  };

  const runPreview = async () => {
    setBusy("preview");
    setError("");
    setDoneNote("");
    try {
      const result = await api.previewInvoiceFlyImport({ clientsCsv, invoicesCsv });
      setPreview(result);
      setSelClients(new Set(result.clients.filter((r) => r.included).map((r) => r.index)));
      setSelInvoices(new Set(result.invoices.filter((r) => r.included).map((r) => r.index)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read those files. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const toggle = (set: Set<number>, index: number, apply: (next: Set<number>) => void) => {
    const next = new Set(set);
    if (next.has(index)) next.delete(index); else next.add(index);
    apply(next);
  };

  const runImport = async () => {
    setBusy("run");
    setError("");
    try {
      const result = await api.runInvoiceFlyImport({
        clientsCsv, invoicesCsv,
        clientIndexes: [...selClients], invoiceIndexes: [...selInvoices],
      });
      const parts = [
        `${result.clientsCreated} client${result.clientsCreated === 1 ? "" : "s"} added`,
        result.clientsMatched ? `${result.clientsMatched} matched` : "",
        result.addressesAppended ? `${result.addressesAppended} address${result.addressesAppended === 1 ? "" : "es"} saved` : "",
        `${result.invoicesCreated} invoice${result.invoicesCreated === 1 ? "" : "s"} imported`,
        result.paymentsCreated ? `${result.paymentsCreated} payment${result.paymentsCreated === 1 ? "" : "s"} recorded` : "",
        result.invoicesSkipped ? `${result.invoicesSkipped} skipped` : "",
      ].filter(Boolean);
      setDoneNote(`Import complete — ${parts.join(" · ")}.`);
      setPreview(null);
      setClientsCsv(""); setInvoicesCsv(""); setClientsName(""); setInvoicesName("");
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["billing-overview"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed. Nothing was half-written — try again.");
    } finally {
      setBusy(null);
    }
  };

  const c = preview?.counts;
  return (
    <section className="panel">
      <div className="panel-head"><h2>Import from Invoice Fly</h2></div>
      <p className="muted small">Bringing your books over from Invoice Fly? Export your Clients and Invoices there as CSV, pick the files here, and review everything before anything is imported.</p>
      <div className="export-period-row">
        <label>
          Clients CSV
          <input type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0], "clients")} />
          {clientsName ? <span className="feed-meta">{clientsName}</span> : null}
        </label>
        <label>
          Invoices CSV
          <input type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0], "invoices")} />
          {invoicesName ? <span className="feed-meta">{invoicesName}</span> : null}
        </label>
        <button type="button" className="btn btn-primary" disabled={busy !== null || (!clientsCsv && !invoicesCsv)} onClick={() => void runPreview()}>
          {busy === "preview" ? "Reading…" : "Preview import"}
        </button>
      </div>
      {preview && c ? (
        <>
          <p className="muted small">
            Clients: {c.clientsTotal} in file — {c.clientsNew} new, {c.clientsMatched} already in Crewkat{c.clientsInvalid ? `, ${c.clientsInvalid} can't import` : ""}.
            {c.invoicesTotal ? <> Invoices: {c.invoicesTotal} in file — {c.invoicesNew} new, {c.invoicesDuplicate} possible duplicate{c.invoicesDuplicate === 1 ? "" : "s"}, {c.invoicesCollision} number clash{c.invoicesCollision === 1 ? "" : "es"}{c.invoicesImported ? `, ${c.invoicesImported} already imported` : ""}{c.invoicesInvalid ? `, ${c.invoicesInvalid} can't import` : ""}.</> : null}
          </p>
          {preview.clients.length > 0 ? (
            <>
              <h3 className="day-section-title">Clients</h3>
              <ul className="link-list static import-rows">
                {preview.clients.map((r) => (
                  <li key={r.index}>
                    <label className="import-row">
                      <input type="checkbox" checked={selClients.has(r.index)} disabled={r.status === "invalid"}
                        onChange={() => toggle(selClients, r.index, setSelClients)} />
                      <span>
                        {r.name || "(no name)"}
                        <span className="feed-meta">{[r.email, r.phone, r.address].filter(Boolean).join(" · ") || "—"}</span>
                        {r.note ? <span className="feed-meta">{r.note}</span> : null}
                      </span>
                      <span className={`status-pill ${STATUS_PILL_CLASS[r.status] ?? ""}`}>{CLIENT_STATUS_LABEL[r.status]}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {preview.invoices.length > 0 ? (
            <>
              <h3 className="day-section-title">Invoices</h3>
              <ul className="link-list static import-rows">
                {preview.invoices.map((r) => (
                  <li key={r.index}>
                    <label className="import-row">
                      <input type="checkbox" checked={selInvoices.has(r.index)} disabled={r.status === "invalid" || r.status === "imported"}
                        onChange={() => toggle(selInvoices, r.index, setSelInvoices)} />
                      <span>
                        {r.number} · {r.clientName}
                        <span className="feed-meta">{formatDate(r.issueDate)} · Total {formatMoney(r.total)} · Paid {formatMoney(r.paid)}</span>
                        {r.note ? <span className="feed-meta">{r.note}</span> : null}
                      </span>
                      <span className={`status-pill ${STATUS_PILL_CLASS[r.status] ?? ""}`}>{INVOICE_STATUS_LABEL[r.status]}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <div className="export-period-row">
            <button type="button" className="btn btn-primary" disabled={busy !== null || (selClients.size === 0 && selInvoices.size === 0)} onClick={() => void runImport()}>
              {busy === "run" ? "Importing…" : `Import selected (${selClients.size + selInvoices.size})`}
            </button>
            <span className="muted small">Flagged rows stay off unless you tick them. Re-running the same files imports nothing twice.</span>
          </div>
        </>
      ) : null}
      {doneNote ? <p className="muted small">{doneNote}</p> : null}
      {error ? <p className="status error" role="alert">{error}</p> : null}
    </section>
  );
}

export function MoneyView({ onOpenDocument, seeMoney }: { onOpenDocument: (sel: DocSelection) => void; seeMoney: boolean }) {
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
      {seeMoney ? <ExportPanel /> : null}
      {seeMoney ? <ImportPanel /> : null}
    </div>
  );
}
