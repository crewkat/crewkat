import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import type { LeadStage, OfficeDashboardData, StageBucket } from "../types";
import { LEAD_STAGES, STAGE_LABELS } from "../types";
import { asRecordArray, formatDate, formatMoney, parseMoney, pickNumber, pickString } from "../utils";

const STAGE_COLORS: Record<LeadStage, string> = {
  new: "#3d7ab8",
  contacted: "#7c6bb0",
  quoted: "#e8a33d",
  won: "#2e9e6b",
  lost: "#b0533d",
};

/** Normalize whatever shape leadsByStage arrives in (array of buckets or a
 *  stage→count/value record) into StageBucket rows for all five stages. */
function normalizeStages(raw: unknown): StageBucket[] {
  const byStage = new Map<LeadStage, StageBucket>(LEAD_STAGES.map((s) => [s, { stage: s, count: 0, value: 0 }]));
  if (Array.isArray(raw)) {
    for (const item of asRecordArray(raw)) {
      const stage = pickString(item, ["stage", "key", "name"]) as LeadStage;
      const bucket = byStage.get(stage);
      if (!bucket) continue;
      bucket.count = pickNumber(item, ["count", "leads", "total"]);
      bucket.value = parseMoney(pickString(item, ["value", "estimatedValue", "totalValue", "sum"]) || pickNumber(item, ["value", "estimatedValue", "totalValue", "sum"]));
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const bucket = byStage.get(key as LeadStage);
      if (!bucket) continue;
      if (typeof value === "number") bucket.count = value;
      else if (value && typeof value === "object") {
        const rec = value as Record<string, unknown>;
        bucket.count = pickNumber(rec, ["count", "leads"]);
        bucket.value = pickNumber(rec, ["value", "estimatedValue", "totalValue"]);
      }
    }
  }
  return LEAD_STAGES.map((s) => byStage.get(s) ?? { stage: s, count: 0, value: 0 });
}

function normalizeDashboard(raw: unknown): OfficeDashboardData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : parseMoney(v as string));
  return {
    pipelineValue: num(r.pipelineValue),
    openLeads: num(r.openLeads),
    leadsByStage: normalizeStages(r.leadsByStage),
    activeJobs: num(r.activeJobs),
    invoicedMonth: num(r.invoicedMonth),
    collectedMonth: num(r.collectedMonth),
    outstanding: num(r.outstanding),
    overdueInvoices: asRecordArray(r.overdueInvoices),
    followUps: asRecordArray(r.followUps),
    recentActivity: asRecordArray(r.recentActivity),
  };
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi-card">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub ? <span className="kpi-sub">{sub}</span> : null}
    </div>
  );
}

export function DashboardView({ onGoPipeline, onGoJobs }: { onGoPipeline: () => void; onGoJobs: () => void }) {
  const queryClient = useQueryClient();
  const [followUpError, setFollowUpError] = useState("");
  const dashQuery = useQuery({
    queryKey: ["office-dashboard"],
    queryFn: async () => normalizeDashboard(await api.getOfficeDashboard({})),
  });
  // leadsByStage arrives as counts only, so stage dollar values for the
  // pipeline chart are summed from the lead list itself.
  const leadsQuery = useQuery({ queryKey: ["leads"], queryFn: () => api.listLeads({}) });
  const toggleMutation = useMutation({
    mutationFn: (args: { id: number; completed: boolean }) => api.toggleInternalNote(args),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["office-dashboard"] }); },
    onError: () => setFollowUpError("Couldn't update that follow-up — it may not be a toggleable reminder."),
  });

  if (dashQuery.isLoading) return <div className="view-loading">Loading dashboard…</div>;
  if (dashQuery.isError || !dashQuery.data) {
    return (
      <div className="empty-state">
        <div className="empty-icon">◍</div>
        <p>Couldn't load the dashboard.</p>
        <button type="button" className="btn btn-primary" onClick={() => void dashQuery.refetch()}>Try again</button>
      </div>
    );
  }
  const d = dashQuery.data;
  const stageBuckets = d.leadsByStage.map((b) => {
    if (b.value > 0) return b;
    const value = (leadsQuery.data?.leads ?? [])
      .filter((l) => l.stage === b.stage)
      .reduce((sum, l) => sum + parseMoney(l.estimatedValue), 0);
    return { ...b, value };
  });
  const pipelineChart = stageBuckets.map((b) => ({ stage: STAGE_LABELS[b.stage], value: b.value, count: b.count, fill: STAGE_COLORS[b.stage] }));
  const cashChart = [{ name: "This month", Invoiced: d.invoicedMonth, Collected: d.collectedMonth }];

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Dashboard</h1>
          <p className="view-sub">The whole business at a glance.</p>
        </div>
      </div>

      <div className="kpi-row">
        <Kpi label="Pipeline value" value={formatMoney(d.pipelineValue)} />
        <Kpi label="Open leads" value={String(d.openLeads)} sub="Not yet won or lost" />
        <Kpi label="Active jobs" value={String(d.activeJobs)} />
        <Kpi label="Invoiced this month" value={formatMoney(d.invoicedMonth)} />
        <Kpi label="Collected this month" value={formatMoney(d.collectedMonth)} />
        <Kpi label="Outstanding" value={formatMoney(d.outstanding)} sub="Unpaid invoice balance" />
      </div>

      <div className="chart-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Pipeline by stage</h2>
            <button type="button" className="link-btn" onClick={onGoPipeline}>Open pipeline →</button>
          </div>
          {stageBuckets.every((b) => b.value === 0 && b.count === 0) ? (
            <div className="empty-state small">
              <div className="empty-icon">▤</div>
              <p>No leads yet — the pipeline chart will fill in as leads come in.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={pipelineChart} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6ebf0" />
                <XAxis dataKey="stage" tick={{ fontSize: 12, fill: "#5b6b7a" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v: number) => formatMoney(v)} tick={{ fontSize: 11, fill: "#5b6b7a" }} axisLine={false} tickLine={false} width={86} />
                <Tooltip formatter={(v: unknown) => [formatMoney(v as number), "Estimated value"]} cursor={{ fill: "rgba(10,34,57,0.04)" }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
                  {pipelineChart.map((entry) => <Cell key={entry.stage} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Invoiced vs collected</h2>
            <button type="button" className="link-btn" onClick={onGoJobs}>Open jobs →</button>
          </div>
          {d.invoicedMonth === 0 && d.collectedMonth === 0 ? (
            <div className="empty-state small">
              <div className="empty-icon">$</div>
              <p>Nothing invoiced yet this month.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={cashChart} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6ebf0" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#5b6b7a" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v: number) => formatMoney(v)} tick={{ fontSize: 11, fill: "#5b6b7a" }} axisLine={false} tickLine={false} width={86} />
                <Tooltip formatter={(v: unknown) => formatMoney(v as number)} cursor={{ fill: "rgba(10,34,57,0.04)" }} />
                <Bar dataKey="Invoiced" fill="#0b2a44" radius={[6, 6, 0, 0]} maxBarSize={56} />
                <Bar dataKey="Collected" fill="#f2762e" radius={[6, 6, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>
      </div>

      <div className="panel-grid">
        <section className="panel">
          <div className="panel-head"><h2>Follow-ups due</h2></div>
          {followUpError ? <p className="inline-error">{followUpError}</p> : null}
          {d.followUps.length === 0 ? (
            <div className="empty-state small">
              <div className="empty-icon">✓</div>
              <p>Nothing due — every follow-up is handled.</p>
            </div>
          ) : (
            <ul className="feed-list">
              {d.followUps.map((row, i) => {
                const id = pickNumber(row, ["id"]);
                const completed = row.completed === true;
                const title = pickString(row, ["note", "title", "body", "label"]) || "Follow-up";
                const who = pickString(row, ["clientName", "leadName", "name", "contactName"]);
                const when = pickString(row, ["reminderDate", "dueDate", "date"]);
                return (
                  <li key={id || i} className={`feed-item${completed ? " is-done" : ""}`}>
                    <label className="follow-check">
                      <input
                        type="checkbox"
                        checked={completed}
                        disabled={!id || toggleMutation.isPending}
                        onChange={(e) => { setFollowUpError(""); toggleMutation.mutate({ id, completed: e.target.checked }); }}
                      />
                    </label>
                    <div className="feed-main">
                      <span className="feed-title">{title}</span>
                      <span className="feed-meta">{[who, when ? formatDate(when) : ""].filter(Boolean).join(" · ") || "—"}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Recent activity</h2></div>
          {d.recentActivity.length === 0 ? (
            <div className="empty-state small">
              <div className="empty-icon">↻</div>
              <p>No recent activity yet.</p>
            </div>
          ) : (
            <ul className="feed-list">
              {d.recentActivity.slice(0, 10).map((row, i) => {
                const text = pickString(row, ["body", "text", "description", "title", "summary"]) || "Activity";
                const kind = pickString(row, ["kind", "type"]);
                const who = pickString(row, ["leadName", "clientName", "name"]);
                const when = pickString(row, ["createdAt", "at", "date"]);
                return (
                  <li key={pickNumber(row, ["id"]) || i} className="feed-item">
                    <div className="feed-main">
                      <span className="feed-title">{text}</span>
                      <span className="feed-meta">{[who, kind, when ? formatDate(when) : ""].filter(Boolean).join(" · ") || "—"}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Overdue invoices</h2></div>
          {d.overdueInvoices.length === 0 ? (
            <div className="empty-state small">
              <div className="empty-icon">✓</div>
              <p>No overdue invoices — collections are clean.</p>
            </div>
          ) : (
            <ul className="feed-list">
              {d.overdueInvoices.map((row, i) => {
                const who = pickString(row, ["clientName", "name", "client"]) || "Client";
                const number = pickString(row, ["invoiceNumber", "number", "label"]);
                const amount = pickNumber(row, ["balance", "amountDue", "total", "amount"]);
                const due = pickString(row, ["dueDate", "due"]);
                const days = pickNumber(row, ["daysOverdue"]);
                return (
                  <li key={pickNumber(row, ["id"]) || i} className="feed-item">
                    <div className="feed-main">
                      <span className="feed-title">{who}{number ? ` · ${number}` : ""}</span>
                      <span className="feed-meta">{[due ? `Due ${formatDate(due)}` : "", days ? `${days}d overdue` : ""].filter(Boolean).join(" · ") || "Overdue"}</span>
                    </div>
                    <span className="feed-amount overdue">{formatMoney(amount)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
