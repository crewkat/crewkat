import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { downloadBase64, formatDate, formatMoney, parseMoney, todayIso } from "../utils";
import type { DocSelection } from "./Documents";

/**
 * Money — the financial dashboard (see MoneyView below). The plan and
 * billing-history block that used to live here moved to Settings
 * (Danny 2026-11-01); the accountant Export / Invoice Fly Import panels
 * below it are unchanged.
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
export function MoneyView({ onOpenDocument, seeMoney }: { onOpenDocument: (sel: DocSelection) => void; seeMoney: boolean }) {
  const invoicesQuery = useQuery({ queryKey: ["invoices"], queryFn: () => api.listInvoices({}) });
  const quotesQuery = useQuery({ queryKey: ["quotes"], queryFn: () => api.listQuotes({}) });
  const jobsQuery = useQuery({ queryKey: ["jobs", ""], queryFn: () => api.listJobs({ search: "" }) });
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
  const ytdCollected = paymentsAcross.filter((r) => inYear(r.payment.paymentDate)).reduce((sum, r) => sum + parseMoney(r.payment.amount), 0);
  const openQuotes = quotes.filter((q) => q.sentAt !== "" && !q.accepted);
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
        b.stillOwed += Math.max(0, parseMoney(inv.balanceRemaining));
      }
      for (const r of paymentsAcross) {
        if (!inYear(r.payment.paymentDate)) continue;
        const b = list[Number(r.payment.paymentDate.slice(5, 7)) - 1];
        if (b) b.collected += parseMoney(r.payment.amount);
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
      list[idx]!.stillOwed += Math.max(0, parseMoney(inv.balanceRemaining));
    }
    for (const r of paymentsAcross) {
      const idx = indexOf(r.payment.paymentDate);
      if (idx >= 0) list[idx]!.collected += parseMoney(r.payment.amount);
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
                          Balance {formatMoney(inv.balanceRemaining)} of {formatMoney(inv.total)}
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
          </div>
        </>
      )}
      {seeMoney ? <ExportPanel /> : null}
      {seeMoney ? <ImportPanel /> : null}
    </div>
  );
}
