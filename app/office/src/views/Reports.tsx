import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { downloadBase64, formatMoney } from "../utils";

/**
 * Reports home in Office (parity item 12). The phone's Reports screen
 * surfaces that had no desktop home: the tax summary (getTaxExport —
 * revenue / expenses / materials by month for a year, with a CSV
 * download) and estimate-vs-actual per job (getGrowthToolkit).
 */

type TaxRow = Awaited<ReturnType<typeof api.getTaxExport>>["rows"][number];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function ReportsView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const taxQuery = useQuery({ queryKey: ["tax-export", year], queryFn: () => api.getTaxExport({ year }) });
  const toolkitQuery = useQuery({ queryKey: ["growth-toolkit"], queryFn: () => api.getGrowthToolkit({}) });
  const rows: TaxRow[] = taxQuery.data?.rows ?? [];
  const estimateActual = toolkitQuery.data?.estimateActual ?? [];

  const monthly = useMemo(() => {
    const map = new Map<string, { revenue: number; expense: number; materials: number }>();
    for (const row of rows) {
      const entry = map.get(row.month) ?? { revenue: 0, expense: 0, materials: 0 };
      entry[row.type] += row.amount;
      map.set(row.month, entry);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);
  const totals = useMemo(() => monthly.reduce(
    (acc, [, m]) => ({ revenue: acc.revenue + m.revenue, expense: acc.expense + m.expense, materials: acc.materials + m.materials }),
    { revenue: 0, expense: 0, materials: 0 },
  ), [monthly]);

  const downloadCsv = () => {
    const lines = [
      ["Month", "Type", "Category", "Date", "Description", "Amount"].join(","),
      ...rows.map((r) => [r.month, r.type, csvEscape(r.category), r.date, csvEscape(r.description), r.amount.toFixed(2)].join(",")),
    ];
    const base64 = btoa(unescape(encodeURIComponent(lines.join("\n"))));
    downloadBase64(base64, `crewkat-tax-summary-${year}.csv`, "text/csv");
  };

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Reports</h1>
          <p className="view-sub">Tax summary and estimate-vs-actual — the reports the phone has carried, now on the desktop.</p>
        </div>
        <div className="head-controls">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Tax year">
            {[now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button type="button" className="btn btn-ghost" disabled={rows.length === 0} onClick={downloadCsv}>Download tax CSV</button>
        </div>
      </div>

      <section className="panel table-panel">
        <h3 className="panel-title">Tax summary — {year}</h3>
        {taxQuery.isLoading ? <div className="view-loading">Loading tax summary…</div> : null}
        {taxQuery.isError ? <p className="inline-error">Couldn't load the tax summary.</p> : null}
        {!taxQuery.isLoading && monthly.length === 0 ? <p className="muted">No revenue, expenses, or materials recorded in {year} yet.</p> : null}
        {monthly.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr><th>Month</th><th className="num">Revenue</th><th className="num">Expenses</th><th className="num">Materials</th><th className="num">Net</th></tr>
            </thead>
            <tbody>
              {monthly.map(([month, m]) => (
                <tr key={month}>
                  <td>{MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month} {month.slice(0, 4)}</td>
                  <td className="num">{formatMoney(m.revenue)}</td>
                  <td className="num">{formatMoney(m.expense)}</td>
                  <td className="num">{formatMoney(m.materials)}</td>
                  <td className="num">{formatMoney(m.revenue - m.expense - m.materials)}</td>
                </tr>
              ))}
              <tr className="totals-row">
                <td><strong>Year total</strong></td>
                <td className="num"><strong>{formatMoney(totals.revenue)}</strong></td>
                <td className="num"><strong>{formatMoney(totals.expense)}</strong></td>
                <td className="num"><strong>{formatMoney(totals.materials)}</strong></td>
                <td className="num"><strong>{formatMoney(totals.revenue - totals.expense - totals.materials)}</strong></td>
              </tr>
            </tbody>
          </table>
        ) : null}
        <p className="muted small">Revenue is recorded invoice payments; expenses are business expenses; materials are job receipts — the same rows the CSV export carries.</p>
      </section>

      <section className="panel table-panel">
        <h3 className="panel-title">Estimate vs actual</h3>
        {toolkitQuery.isLoading ? <div className="view-loading">Loading…</div> : null}
        {!toolkitQuery.isLoading && estimateActual.length === 0 ? <p className="muted">No jobs with estimates or invoices yet.</p> : null}
        {estimateActual.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr><th>Client</th><th>Job</th><th className="num">Quoted</th><th className="num">Invoiced</th><th className="num">Variance</th><th className="num">Variance %</th></tr>
            </thead>
            <tbody>
              {estimateActual.map((row) => (
                <tr key={row.jobId}>
                  <td>{row.clientName}</td>
                  <td>{row.jobType}</td>
                  <td className="num">{formatMoney(row.quoted)}</td>
                  <td className="num">{formatMoney(row.invoiced)}</td>
                  <td className="num">{formatMoney(row.variance)}</td>
                  <td className="num">{row.variancePercent === null ? "—" : `${row.variancePercent.toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
