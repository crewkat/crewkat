import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "../api";
import type { FollowUpItem } from "../types";
import { cleanError, formatDate, formatMoney } from "../utils";

const RECIPE_LABELS: Record<string, string> = {
  proposal_follow_up: "Estimate follow-up",
  contract_welcome: "Contract welcome",
  job_review: "Review request",
  invoice_overdue: "Overdue invoice",
  lead_stale: "Stale lead",
};

type Filter = "open" | "done" | "all";

/**
 * Wave 1: the follow-up queue — one work list across leads, jobs,
 * clients and invoices. Manual items are created here; automation
 * recipes (estimate sent, contract signed, job complete, invoice
 * overdue, stale lead) drop their tasks here too — automations never
 * message a client directly, a person always works the queue.
 */
export function FollowUpsView({
  onOpenJob,
  onOpenLead,
  onOpenClient,
}: {
  onOpenJob: (jobId: number) => void;
  onOpenLead: (leadId: number) => void;
  onOpenClient: (clientId: number) => void;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("open");
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");

  const queueQuery = useQuery({
    queryKey: ["follow-up-queue", filter !== "open"],
    queryFn: () => api.getFollowUpQueue({ includeDone: filter !== "open" }),
  });
  const data = queueQuery.data;
  const items = useMemo(() => {
    const all = data?.items ?? [];
    if (filter === "open") return all.filter((i) => i.status === "open");
    if (filter === "done") return all.filter((i) => i.status === "done");
    return all;
  }, [data, filter]);
  const members = data?.members ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["follow-up-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["office-dashboard"] });
  };
  const fail = (err: unknown) => setError(cleanError(err));

  const completeMutation = useMutation({
    mutationFn: (args: { id: number; completed: boolean }) => api.completeFollowUp(args),
    onSuccess: invalidate,
    onError: fail,
  });
  const snoozeMutation = useMutation({
    mutationFn: (args: { id: number; days: number }) => api.snoozeFollowUp(args),
    onSuccess: invalidate,
    onError: fail,
  });

  const groups = useMemo(() => {
    const overdue: FollowUpItem[] = [];
    const todayList: FollowUpItem[] = [];
    const upcoming: FollowUpItem[] = [];
    const done: FollowUpItem[] = [];
    const todayKey = new Date().toISOString().slice(0, 10);
    for (const item of items) {
      if (item.status === "done") done.push(item);
      else if (item.overdue) overdue.push(item);
      else if (item.dueDate === todayKey) todayList.push(item);
      else upcoming.push(item);
    }
    return [
      { key: "overdue", label: "Overdue", rows: overdue },
      { key: "today", label: "Due today", rows: todayList },
      { key: "upcoming", label: "Coming up", rows: upcoming },
      { key: "done", label: "Completed", rows: done },
    ].filter((g) => g.rows.length > 0);
  }, [items]);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Follow-ups</h1>
          <p className="view-sub">
            {data ? `${data.openCount} open · ${data.overdueCount} overdue · ${data.dueTodayCount} due today` : "Every open loop in one list — leads, jobs, clients, invoices."}
          </p>
        </div>
        <div className="head-controls">
          <div className="segmented" role="tablist" aria-label="Filter follow-ups">
            {(["open", "done", "all"] as Filter[]).map((f) => (
              <button key={f} type="button" className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                {f === "open" ? "Open" : f === "done" ? "Done" : "All"}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>+ New follow-up</button>
        </div>
      </div>

      {error ? <p className="inline-error">{error}</p> : null}
      {showNew ? (
        <NewFollowUpForm
          members={members}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); invalidate(); }}
          onError={fail}
        />
      ) : null}

      {queueQuery.isLoading ? <div className="view-loading">Loading follow-ups…</div> : null}
      {queueQuery.isError ? (
        <div className="empty-state">
          <div className="empty-icon">◍</div>
          <p>Couldn't load the follow-up queue.</p>
          <button type="button" className="btn btn-primary" onClick={() => void queueQuery.refetch()}>Try again</button>
        </div>
      ) : null}
      {!queueQuery.isLoading && !queueQuery.isError && items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✓</div>
          <p>{filter === "done" ? "Nothing completed yet." : "All caught up — no open follow-ups. Automations will queue new ones here as work happens."}</p>
        </div>
      ) : null}

      {groups.map((group) => (
        <section key={group.key} className="panel queue-group">
          <div className="panel-head">
            <h2>{group.label}</h2>
            <span className="kanban-count">{group.rows.length}</span>
          </div>
          <ul className="feed-list">
            {group.rows.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                members={members}
                busy={completeMutation.isPending || snoozeMutation.isPending}
                onToggle={(completed) => { setError(""); completeMutation.mutate({ id: item.id, completed }); }}
                onSnooze={(days) => { setError(""); snoozeMutation.mutate({ id: item.id, days }); }}
                onAssign={(userId) => {
                  setError("");
                  void api.saveFollowUp({
                    id: item.id, title: item.title, body: item.body, dueDate: item.dueDate,
                    assigneeUserId: userId, leadId: item.leadId, jobId: item.jobId, clientId: item.clientId, invoiceId: item.invoiceId,
                  }).then(invalidate).catch(fail);
                }}
                onOpenJob={onOpenJob}
                onOpenLead={onOpenLead}
                onOpenClient={onOpenClient}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function QueueRow({
  item,
  members,
  busy,
  onToggle,
  onSnooze,
  onAssign,
  onOpenJob,
  onOpenLead,
  onOpenClient,
}: {
  item: FollowUpItem;
  members: { id: number; name: string; role: string }[];
  busy: boolean;
  onToggle: (completed: boolean) => void;
  onSnooze: (days: number) => void;
  onAssign: (userId: number | null) => void;
  onOpenJob: (jobId: number) => void;
  onOpenLead: (leadId: number) => void;
  onOpenClient: (clientId: number) => void;
}) {
  const done = item.status === "done";
  const linkLabel = item.jobLabel || item.leadName || item.clientName || "";
  const goLink = () => {
    if (item.jobId) onOpenJob(item.jobId);
    else if (item.leadId) onOpenLead(item.leadId);
    else if (item.clientId) onOpenClient(item.clientId);
  };
  return (
    <li className={`feed-item queue-row${done ? " is-done" : ""}${item.overdue && !done ? " is-overdue" : ""}`}>
      <label className="follow-check">
        <input type="checkbox" checked={done} disabled={busy} onChange={(e) => onToggle(e.target.checked)} aria-label={done ? "Reopen" : "Mark done"} />
      </label>
      <div className="feed-main">
        <span className="feed-title">{item.title}</span>
        {item.body ? <span className="feed-meta block">{item.body}</span> : null}
        <span className="feed-meta">
          {[
            item.invoiceNumber ? `Invoice ${item.invoiceNumber}` : "",
            item.dueDate ? `${done ? "Was due" : "Due"} ${formatDate(item.dueDate)}` : "No due date",
            item.source === "automation" ? `Auto · ${RECIPE_LABELS[item.recipe] ?? "Automation"}` : "Manual",
          ].filter(Boolean).join(" · ")}
        </span>
        {linkLabel ? (
          <button type="button" className="link-btn queue-link" onClick={goLink}>Open {linkLabel} →</button>
        ) : null}
      </div>
      {item.amount !== null ? <span className="feed-amount overdue">{formatMoney(item.amount)}</span> : null}
      <div className="queue-actions">
        <select
          className="queue-assign"
          value={item.assigneeUserId ?? ""}
          disabled={busy}
          onChange={(e) => onAssign(e.target.value ? Number(e.target.value) : null)}
          aria-label="Assign to"
        >
          <option value="">Unassigned</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {!done ? (
          <span className="queue-snooze">
            <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => onSnooze(1)}>+1d</button>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => onSnooze(3)}>+3d</button>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => onSnooze(7)}>+1w</button>
          </span>
        ) : null}
      </div>
    </li>
  );
}

function NewFollowUpForm({
  members,
  onClose,
  onSaved,
  onError,
}: {
  members: { id: number; name: string; role: string }[];
  onClose: () => void;
  onSaved: () => void;
  onError: (err: unknown) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [assignee, setAssignee] = useState("");
  const [jobId, setJobId] = useState("");
  const [leadId, setLeadId] = useState("");
  const jobsQuery = useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs({ search: "" }) });
  const leadsQuery = useQuery({ queryKey: ["leads"], queryFn: () => api.listLeads({}) });

  const saveMutation = useMutation({
    mutationFn: () => api.saveFollowUp({
      title: title.trim(),
      body: body.trim(),
      dueDate,
      assigneeUserId: assignee ? Number(assignee) : null,
      jobId: jobId ? Number(jobId) : null,
      leadId: leadId ? Number(leadId) : null,
      clientId: null,
      invoiceId: null,
    }),
    onSuccess: onSaved,
    onError,
  });

  const submit = (e: FormEvent) => { e.preventDefault(); if (title.trim()) saveMutation.mutate(); };

  return (
    <form className="panel queue-new" onSubmit={submit}>
      <div className="panel-head"><h2>New follow-up</h2></div>
      <div className="form-grid">
        <label className="field span2"><span>What needs doing? *</span><input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Call the client about the start date" /></label>
        <label className="field span2"><span>Notes</span><textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Anything the person picking this up should know" /></label>
        <label className="field"><span>Due date</span><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        <label className="field"><span>Assign to</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Link a job (optional)</span>
          <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">None</option>
            {(jobsQuery.data?.jobs ?? []).map((j) => <option key={j.id} value={j.id}>{j.jobType || "Job"} · {j.clientName}</option>)}
          </select>
        </label>
        <label className="field"><span>Link a lead (optional)</span>
          <select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">None</option>
            {(leadsQuery.data?.leads ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending || !title.trim()}>
          {saveMutation.isPending ? "Adding…" : "Add follow-up"}
        </button>
      </div>
    </form>
  );
}
