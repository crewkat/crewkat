import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../api";
import type { Lead, LeadStage } from "../types";
import { LEAD_STAGES, STAGE_LABELS } from "../types";
import { ageLabel, cleanError, formatDateTime, formatMoney, parseMoney } from "../utils";

const EMPTY_FORM = {
  name: "",
  phone: "",
  email: "",
  address: "",
  serviceType: "",
  source: "",
  estimatedValue: "",
  projectSize: "medium" as "small" | "medium" | "large",
  notes: "",
};

type LeadForm = typeof EMPTY_FORM;

function formFromLead(lead: Lead): LeadForm {
  return {
    name: lead.name ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    address: lead.address ?? "",
    serviceType: lead.serviceType ?? "",
    source: lead.source ?? "",
    estimatedValue: lead.estimatedValue != null && parseMoney(lead.estimatedValue) !== 0 ? String(parseMoney(lead.estimatedValue)) : "",
    projectSize: lead.projectSize ?? "medium",
    notes: lead.notes ?? "",
  };
}

function ScoreChip({ score }: { score: number }) {
  const cls = score >= 70 ? "score high" : score >= 40 ? "score mid" : "score low";
  return <span className={cls}>{score}</span>;
}

export function PipelineView({
  focusLeadId,
  onOpenJob,
  onConsumeFocus,
  canDelete,
}: {
  focusLeadId: number | null;
  onOpenJob: (jobId: number) => void;
  onConsumeFocus: () => void;
  /** Deletes are Admin-only (Danny 2026-10-24); the server enforces, this only hides the buttons. */
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [dragOverStage, setDragOverStage] = useState<LeadStage | null>(null);
  const [boardError, setBoardError] = useState("");

  const leadsQuery = useQuery({ queryKey: ["leads"], queryFn: () => api.listLeads({}) });
  const leads = useMemo(() => leadsQuery.data?.leads ?? [], [leadsQuery.data]);

  useEffect(() => {
    if (focusLeadId != null && leads.some((l) => l.id === focusLeadId)) {
      setSelectedId(focusLeadId);
      onConsumeFocus();
    }
  }, [focusLeadId, leads, onConsumeFocus]);

  const selected = leads.find((l) => l.id === selectedId) ?? null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["leads"] });
    void queryClient.invalidateQueries({ queryKey: ["office-dashboard"] });
  };

  const stageMutation = useMutation({
    mutationFn: (args: { id: number; stage: LeadStage }) => api.updateLeadStage(args),
    onError: (err) => { setBoardError(cleanError(err)); invalidate(); },
    onSuccess: invalidate,
  });

  const moveLead = (lead: Lead, stage: LeadStage) => {
    if (lead.stage === stage) return;
    setBoardError("");
    // Optimistic move; reverted by the refetch if the server rejects it.
    queryClient.setQueryData<{ leads: Lead[]; winRate: number }>(["leads"], (old) =>
      old ? { ...old, leads: old.leads.map((l) => (l.id === lead.id ? { ...l, stage } : l)) } : old,
    );
    stageMutation.mutate({ id: lead.id, stage });
  };

  const byStage = useMemo(() => {
    const map = new Map<LeadStage, Lead[]>(LEAD_STAGES.map((s) => [s, []]));
    for (const lead of leads) map.get(lead.stage)?.push(lead);
    return map;
  }, [leads]);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Pipeline</h1>
          <p className="view-sub">
            {leads.length} leads{leadsQuery.data ? ` · ${leadsQuery.data.winRate}% win rate on decided leads` : ""}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>+ New lead</button>
      </div>
      {boardError ? <p className="inline-error">{boardError}</p> : null}

      {leadsQuery.isLoading ? <div className="view-loading">Loading pipeline…</div> : null}
      {leadsQuery.isError ? (
        <div className="empty-state">
          <div className="empty-icon">◍</div>
          <p>Couldn't load leads.</p>
          <button type="button" className="btn btn-primary" onClick={() => void leadsQuery.refetch()}>Try again</button>
        </div>
      ) : null}

      {!leadsQuery.isLoading && !leadsQuery.isError ? (
        <div className="kanban">
          {LEAD_STAGES.map((stage) => {
            const column = byStage.get(stage) ?? [];
            const total = column.reduce((sum, l) => sum + parseMoney(l.estimatedValue), 0);
            return (
              <section
                key={stage}
                className={`kanban-col stage-${stage}${dragOverStage === stage ? " drag-over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage); }}
                onDragLeave={() => setDragOverStage((cur) => (cur === stage ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverStage(null);
                  const id = Number(e.dataTransfer.getData("text/lead-id"));
                  const lead = leads.find((l) => l.id === id);
                  if (lead) moveLead(lead, stage);
                }}
              >
                <header className="kanban-head">
                  <span className="kanban-title">{STAGE_LABELS[stage]}</span>
                  <span className="kanban-count">{column.length}</span>
                  <span className="kanban-total">{formatMoney(total)}</span>
                </header>
                <div className="kanban-body">
                  {column.length === 0 ? (
                    <div className="kanban-empty">No leads here yet.<br />Drag a card over, or add a new lead.</div>
                  ) : column.map((lead) => (
                    <article
                      key={lead.id}
                      className="lead-card"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/lead-id", String(lead.id)); e.dataTransfer.effectAllowed = "move"; }}
                      onClick={() => setSelectedId(lead.id)}
                    >
                      <div className="lead-card-top">
                        <span className="lead-name">{lead.name}</span>
                        <ScoreChip score={lead.score} />
                      </div>
                      {lead.serviceType ? <span className="lead-service">{lead.serviceType}</span> : null}
                      <div className="lead-card-meta">
                        <span className="lead-value">{parseMoney(lead.estimatedValue) > 0 ? formatMoney(lead.estimatedValue) : "No estimate"}</span>
                        <span>{ageLabel(lead.createdAt)}</span>
                      </div>
                      {lead.source ? <span className="lead-source">via {lead.source}</span> : null}
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {showNew ? <NewLeadModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); invalidate(); }} /> : null}
      {selected ? (
        <LeadDrawer
          key={selected.id}
          lead={selected}
          onClose={() => setSelectedId(null)}
          onChanged={invalidate}
          onOpenJob={(jobId) => { setSelectedId(null); onOpenJob(jobId); }}
          canDelete={canDelete}
        />
      ) : null}
    </div>
  );
}

function LeadFormFields({ form, setForm }: { form: LeadForm; setForm: (f: LeadForm) => void }) {
  const set = (patch: Partial<LeadForm>) => setForm({ ...form, ...patch });
  return (
    <div className="form-grid">
      <label className="field span2"><span>Name *</span><input value={form.name} onChange={(e) => set({ name: e.target.value })} required placeholder="Jane Homeowner" /></label>
      <label className="field"><span>Phone</span><input value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="(555) 555-5555" /></label>
      <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="jane@example.com" /></label>
      <label className="field span2"><span>Address</span><input value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="Street, City, State ZIP" /></label>
      <label className="field"><span>Service type</span><input value={form.serviceType} onChange={(e) => set({ serviceType: e.target.value })} placeholder="Kitchen remodel" /></label>
      <label className="field"><span>Source</span><input value={form.source} onChange={(e) => set({ source: e.target.value })} placeholder="Referral, Google, Website…" /></label>
      <label className="field"><span>Estimated value ($)</span><input inputMode="decimal" value={form.estimatedValue} onChange={(e) => set({ estimatedValue: e.target.value })} placeholder="0" /></label>
      <label className="field"><span>Project size</span>
        <select value={form.projectSize} onChange={(e) => set({ projectSize: e.target.value as LeadForm["projectSize"] })}>
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </label>
      <label className="field span2"><span>Notes</span><textarea rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="What do they want? Timeline? Budget signals?" /></label>
    </div>
  );
}

function NewLeadModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<LeadForm>(EMPTY_FORM);
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.saveLead({
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      serviceType: form.serviceType.trim(),
      source: form.source.trim(),
      notes: form.notes.trim(),
      estimatedValue: form.estimatedValue.trim() || "0",
      projectSize: form.projectSize,
      engagement: "normal",
    }),
    onSuccess: onSaved,
    onError: (err) => setError(cleanError(err)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(""); mutation.mutate(); };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="New lead" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>New lead</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={submit}>
          <LeadFormFields form={form} setForm={setForm} />
          {error ? <p className="inline-error">{error}</p> : null}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={mutation.isPending || !form.name.trim()}>
              {mutation.isPending ? "Saving…" : "Save lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LeadDrawer({
  lead,
  onClose,
  onChanged,
  onOpenJob,
  canDelete,
}: {
  lead: Lead;
  onClose: () => void;
  onChanged: () => void;
  onOpenJob: (jobId: number) => void;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LeadForm>(() => formFromLead(lead));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [converted, setConverted] = useState<{ clientId: number; jobId: number } | null>(null);
  const [activityKind, setActivityKind] = useState("note");
  const [activityBody, setActivityBody] = useState("");

  const activitiesQuery = useQuery({
    queryKey: ["lead-activities", lead.id],
    queryFn: async () => {
      const result = await api.getLeadActivities({ leadId: lead.id });
      return Array.isArray(result) ? result : result.activities ?? [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => api.updateLead({
      id: lead.id,
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      serviceType: form.serviceType.trim(),
      source: form.source.trim(),
      notes: form.notes.trim(),
      estimatedValue: form.estimatedValue.trim() || "0",
      projectSize: form.projectSize,
    }),
    onSuccess: () => { setNotice("Saved."); onChanged(); },
    onError: (err) => setError(cleanError(err)),
  });

  const stageMutation = useMutation({
    mutationFn: (stage: LeadStage) => api.updateLeadStage({ id: lead.id, stage }),
    onSuccess: onChanged,
    onError: (err) => setError(cleanError(err)),
  });

  const activityMutation = useMutation({
    mutationFn: () => api.addLeadActivity({ leadId: lead.id, kind: activityKind, body: activityBody.trim() }),
    onSuccess: () => {
      setActivityBody("");
      void queryClient.invalidateQueries({ queryKey: ["lead-activities", lead.id] });
    },
    onError: (err) => setError(cleanError(err)),
  });

  const convertMutation = useMutation({
    mutationFn: () => api.convertLeadToJob({ id: lead.id }),
    onSuccess: (result) => { setConverted(result); onChanged(); },
    onError: (err) => setError(cleanError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteLead({ id: lead.id }),
    onSuccess: () => { onChanged(); onClose(); },
    onError: (err) => setError(cleanError(err)),
  });

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label={`Lead ${lead.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2>{lead.name}</h2>
            <span className="drawer-sub">{STAGE_LABELS[lead.stage]} · Score {lead.score} · {ageLabel(lead.createdAt)} old</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="drawer-body">
          <label className="field">
            <span>Stage</span>
            <select
              value={lead.stage}
              disabled={stageMutation.isPending}
              onChange={(e) => stageMutation.mutate(e.target.value as LeadStage)}
            >
              {LEAD_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>
          </label>

          <form onSubmit={(e) => { e.preventDefault(); setError(""); setNotice(""); saveMutation.mutate(); }}>
            <LeadFormFields form={form} setForm={setForm} />
            <div className="drawer-actions">
              <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending || !form.name.trim()}>
                {saveMutation.isPending ? "Saving…" : "Save changes"}
              </button>
              {notice ? <span className="inline-ok">{notice}</span> : null}
            </div>
          </form>

          {error ? <p className="inline-error">{error}</p> : null}

          <section className="drawer-section">
            <h3>Convert</h3>
            {converted ? (
              <div className="convert-done">
                <p>Created client #{converted.clientId} and job #{converted.jobId}.</p>
                <button type="button" className="btn btn-primary" onClick={() => onOpenJob(converted.jobId)}>View job →</button>
              </div>
            ) : lead.clientId ? (
              <p className="muted">Already linked to client #{lead.clientId}.</p>
            ) : (
              <>
                <p className="muted">Turn this lead into a client and a job in one step.</p>
                <button
                  type="button"
                  className="btn btn-accent"
                  disabled={convertMutation.isPending}
                  onClick={() => convertMutation.mutate()}
                >
                  {convertMutation.isPending ? "Converting…" : "Convert to client + job"}
                </button>
              </>
            )}
          </section>

          <section className="drawer-section">
            <h3>Communication log</h3>
            {activitiesQuery.isLoading ? <p className="muted">Loading…</p> : null}
            {activitiesQuery.isError ? <p className="muted">Couldn't load the log for this lead.</p> : null}
            {activitiesQuery.data && activitiesQuery.data.length === 0 ? (
              <div className="empty-state small">
                <div className="empty-icon">✎</div>
                <p>No calls, emails, texts or notes logged yet.</p>
              </div>
            ) : null}
            <ul className="activity-list">
              {(activitiesQuery.data ?? []).map((a) => (
                <li key={a.id}>
                  <span className={`activity-kind kind-${a.kind}`}>{a.kind}</span>
                  <div>
                    <p>{a.body}</p>
                    <span className="feed-meta">{formatDateTime(a.createdAt)}{a.authorName ? ` · ${a.authorName}` : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="activity-add">
              <select value={activityKind} onChange={(e) => setActivityKind(e.target.value)} aria-label="Activity kind">
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="text">Text</option>
              </select>
              <textarea
                rows={2}
                value={activityBody}
                onChange={(e) => setActivityBody(e.target.value)}
                placeholder="Log what happened…"
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={!activityBody.trim() || activityMutation.isPending}
                onClick={() => activityMutation.mutate()}
              >
                {activityMutation.isPending ? "Adding…" : "Add entry"}
              </button>
            </div>
          </section>

          {canDelete ? (
            <section className="drawer-section danger-zone">
              <button
                type="button"
                className="btn btn-danger-ghost"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (window.confirm(`Delete lead "${lead.name}"? This can't be undone.`)) deleteMutation.mutate();
                }}
              >
                Delete lead
              </button>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
