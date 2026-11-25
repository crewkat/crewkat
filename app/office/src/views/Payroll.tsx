import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { cleanError, downloadBase64, formatMoney, todayIso } from "../utils";

/**
 * Time & payroll management in Office (parity item 7). The GPS punch
 * itself stays on the phone; this is the management side the phone's
 * Field Intelligence payroll tab carries: crew hours by person for a
 * period, hours by job, pay rates (saveCrewPayRate), gross pay, and a
 * payroll CSV export — all over getFieldIntelligence, the same feed
 * the phone reads.
 */

function weekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(monday), end: iso(sunday) };
}

function monthRange(offset: number): { start: string; end: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: iso(first), end: iso(last) };
}

export function PayrollView() {
  const initial = useMemo(weekRange, []);
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [periodEnd, setPeriodEnd] = useState(initial.end);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();

  const fiQuery = useQuery({
    queryKey: ["field-intelligence", periodStart, periodEnd],
    queryFn: () => api.getFieldIntelligence({ today: todayIso(), periodStart, periodEnd }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(periodStart) && /^\d{4}-\d{2}-\d{2}$/.test(periodEnd) && periodStart <= periodEnd,
  });
  const suiteQuery = useQuery({
    queryKey: ["expansion-suite", todayIso()],
    queryFn: () => api.getExpansionSuite({ today: todayIso() }),
  });
  const payroll = fiQuery.data?.payroll ?? [];
  const crewHours = suiteQuery.data?.crewHours ?? [];
  const totalHours = payroll.reduce((s, p) => s + p.hours, 0);
  const totalGross = payroll.reduce((s, p) => s + Number(p.grossPay || 0), 0);

  const hoursByJob = useMemo(() => {
    const map = new Map<string, { jobLabel: string; crewMember: string; hours: number }>();
    for (const row of crewHours) {
      const key = `${row.jobId}:${row.crewMember}`;
      const entry = map.get(key) ?? { jobLabel: row.jobLabel, crewMember: row.crewMember, hours: 0 };
      entry.hours += row.hours;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => a.jobLabel.localeCompare(b.jobLabel) || a.crewMember.localeCompare(b.crewMember));
  }, [crewHours]);

  const downloadCsv = () => {
    const lines = [
      "Crew member,Hours,Hourly rate,Gross pay",
      ...payroll.map((p) => `"${p.crewMember.replace(/"/g, '""')}",${p.hours.toFixed(2)},${p.hourlyRate},${p.grossPay}`),
      `Total,${totalHours.toFixed(2)},,${totalGross.toFixed(2)}`,
    ];
    downloadBase64(btoa(unescape(encodeURIComponent(lines.join("\n")))), `crewkat-payroll-${periodStart}-to-${periodEnd}.csv`, "text/csv");
  };

  const applyPreset = (preset: "week" | "month" | "lastMonth") => {
    const range = preset === "week" ? weekRange() : monthRange(preset === "month" ? 0 : -1);
    setPeriodStart(range.start);
    setPeriodEnd(range.end);
  };

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Time &amp; payroll</h1>
          <p className="view-sub">Crew hours and pay for the period — the punch itself happens in the app; rates and exports live here.</p>
        </div>
        <div className="head-controls">
          <button type="button" className="btn btn-ghost" disabled={payroll.length === 0} onClick={downloadCsv}>Payroll CSV</button>
        </div>
      </div>

      <section className="panel">
        <div className="table-tools">
          <div className="segmented" role="group" aria-label="Pay period">
            <button type="button" onClick={() => applyPreset("week")}>This week</button>
            <button type="button" onClick={() => applyPreset("month")}>This month</button>
            <button type="button" onClick={() => applyPreset("lastMonth")}>Last month</button>
          </div>
          <label className="field inline"><span>From</span><input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></label>
          <label className="field inline"><span>To</span><input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></label>
        </div>
        {error ? <p className="inline-error">{error}</p> : null}
        {fiQuery.isLoading ? <div className="view-loading">Loading payroll…</div> : null}
        {fiQuery.isError ? <p className="inline-error">Couldn't load payroll for this period.</p> : null}
        {!fiQuery.isLoading && payroll.length === 0 ? <p className="muted">No crew time recorded in this period.</p> : null}
        {payroll.length > 0 ? (
          <>
            <table className="data-table">
              <thead>
                <tr><th>Crew member</th><th className="num">Hours</th><th className="num">Hourly rate</th><th /><th className="num">Gross pay</th></tr>
              </thead>
              <tbody>
                {payroll.map((p) => (
                  <PayRateRow
                    key={p.crewMember}
                    crewMember={p.crewMember}
                    hours={p.hours}
                    hourlyRate={p.hourlyRate}
                    grossPay={p.grossPay}
                    onSaved={() => { void queryClient.invalidateQueries({ queryKey: ["field-intelligence"] }); }}
                    onError={setError}
                  />
                ))}
                <tr className="totals-row">
                  <td><strong>Total</strong></td>
                  <td className="num"><strong>{totalHours.toFixed(1)}</strong></td>
                  <td /><td />
                  <td className="num"><strong>{formatMoney(totalGross)}</strong></td>
                </tr>
              </tbody>
            </table>
          </>
        ) : null}
      </section>

      <section className="panel table-panel">
        <h3 className="panel-title">Hours by job (all recorded time)</h3>
        {hoursByJob.length === 0 ? <p className="muted">No job time recorded yet.</p> : (
          <table className="data-table">
            <thead><tr><th>Job</th><th>Crew member</th><th className="num">Hours</th></tr></thead>
            <tbody>
              {hoursByJob.map((row, i) => (
                <tr key={i}>
                  <td>{row.jobLabel}</td>
                  <td>{row.crewMember}</td>
                  <td className="num">{row.hours.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function PayRateRow({
  crewMember, hours, hourlyRate, grossPay, onSaved, onError,
}: {
  crewMember: string;
  hours: number;
  hourlyRate: string;
  grossPay: string;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [rate, setRate] = useState(hourlyRate);
  const rateMutation = useMutation({
    mutationFn: () => api.saveCrewPayRate({ crewMember, hourlyRate: rate.trim() || "0" }),
    onSuccess: onSaved,
    onError: (e) => onError(cleanError(e)),
  });
  return (
    <tr>
      <td>{crewMember}</td>
      <td className="num">{hours.toFixed(1)}</td>
      <td className="num">
        <input className="rate-input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} aria-label={`Hourly rate for ${crewMember}`} />
      </td>
      <td>
        <button type="button" className="link-btn" disabled={rateMutation.isPending || rate === hourlyRate} onClick={() => rateMutation.mutate()}>
          {rateMutation.isPending ? "Saving…" : "Save rate"}
        </button>
      </td>
      <td className="num">{formatMoney(grossPay)}</td>
    </tr>
  );
}
