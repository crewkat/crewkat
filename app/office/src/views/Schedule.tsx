import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import type { Appointment, AppointmentStatus, Job } from "../types";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUSES } from "../types";
import { cleanError, formatDate } from "../utils";

/* Date helpers — all calendar math is done on local "YYYY-MM-DD" keys so an
   appointment never shifts a day because of a timezone conversion. */
function keyOf(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function dateOf(key: string): Date {
  return new Date(`${key}T12:00:00`);
}
function addDays(key: string, days: number): string {
  const d = dateOf(key);
  d.setDate(d.getDate() + days);
  return keyOf(d);
}
function addMonths(key: string, months: number): string {
  const d = dateOf(key);
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  return keyOf(d);
}
function weekStartKey(key: string): string {
  const d = dateOf(key);
  return addDays(key, -d.getDay());
}
function apptDayKey(startsAt: string): string {
  const d = new Date(startsAt);
  return Number.isNaN(d.getTime()) ? startsAt.slice(0, 10) : keyOf(d);
}
function apptTime(startsAt: string): string {
  const d = new Date(startsAt);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function todayKey(): string {
  return keyOf(new Date());
}

const STATUS_CLS: Record<AppointmentStatus, string> = {
  scheduled: "draft",
  confirmed: "sent",
  on_my_way: "viewed",
  arrived: "signed",
  completed: "done",
  cancelled: "overdue",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type EditorTarget = { appt: Appointment | null; dateKey: string };

export function ScheduleView({ onOpenJob, canDelete }: { onOpenJob: (jobId: number) => void; canDelete: boolean }) {
  const [mode, setMode] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState<string>(todayKey());
  const [selected, setSelected] = useState<string>(todayKey());
  const [editor, setEditor] = useState<EditorTarget | null>(null);

  const apptsQuery = useQuery({ queryKey: ["appointments"], queryFn: () => api.listAppointments({}) });
  const jobsQuery = useQuery({ queryKey: ["jobs", ""], queryFn: () => api.listJobs({ search: "" }) });
  const appointments = useMemo(() => apptsQuery.data?.appointments ?? [], [apptsQuery.data]);
  const jobs = useMemo(() => jobsQuery.data?.jobs ?? [], [jobsQuery.data]);

  const apptsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const key = apptDayKey(a.startsAt);
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [appointments]);
  const jobsByDay = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const j of jobs) {
      if (!j.jobDate) continue;
      const list = map.get(j.jobDate) ?? [];
      list.push(j);
      map.set(j.jobDate, list);
    }
    return map;
  }, [jobs]);

  const days = useMemo(() => {
    if (mode === "week") {
      const start = weekStartKey(anchor);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const first = `${anchor.slice(0, 7)}-01`;
    const start = weekStartKey(first);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [mode, anchor]);

  const periodLabel = mode === "month"
    ? dateOf(anchor).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : (() => {
        const start = dateOf(days[0]!);
        const end = dateOf(days[6]!);
        const sameMonth = start.getMonth() === end.getMonth();
        return sameMonth
          ? `${start.toLocaleDateString("en-US", { month: "long" })} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`
          : `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
      })();

  const step = (dir: 1 | -1) => setAnchor((a) => (mode === "month" ? addMonths(a, dir) : addDays(a, dir * 7)));
  const goToday = () => { setAnchor(todayKey()); setSelected(todayKey()); };

  const selectedAppts = apptsByDay.get(selected) ?? [];
  const selectedJobs = jobsByDay.get(selected) ?? [];
  const anchorMonth = anchor.slice(0, 7);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Schedule</h1>
          <p className="view-sub">{appointments.length} appointments · {jobs.length} jobs — the same calendar the phone app works from.</p>
        </div>
        <div className="head-controls">
          <div className="segmented" role="group" aria-label="Calendar mode">
            {(["month", "week"] as const).map((m) => (
              <button key={m} type="button" className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
                {m === "month" ? "Month" : "Week"}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => step(-1)} aria-label="Previous period">‹</button>
          <strong className="schedule-period">{periodLabel}</strong>
          <button type="button" className="btn btn-ghost" onClick={() => step(1)} aria-label="Next period">›</button>
          <button type="button" className="btn btn-ghost" onClick={goToday}>Today</button>
          <button type="button" className="btn btn-primary" onClick={() => setEditor({ appt: null, dateKey: selected })}>+ New appointment</button>
        </div>
      </div>

      {apptsQuery.isError ? (
        <div className="empty-state">
          <div className="empty-icon">◍</div>
          <p>Couldn't load the schedule.</p>
          <button type="button" className="btn btn-primary" onClick={() => void apptsQuery.refetch()}>Try again</button>
        </div>
      ) : (
        <div className="schedule-layout">
          <section className="panel calendar-panel">
            <div className="cal-weekdays" aria-hidden="true">
              {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
            </div>
            <div className={`cal-grid${mode === "week" ? " week" : ""}`}>
              {days.map((key) => {
                const dayAppts = apptsByDay.get(key) ?? [];
                const dayJobs = jobsByDay.get(key) ?? [];
                const inMonth = mode === "week" || key.slice(0, 7) === anchorMonth;
                const shown = mode === "month" ? dayAppts.slice(0, 3) : dayAppts;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`cal-cell${inMonth ? "" : " outside"}${key === todayKey() ? " today" : ""}${key === selected ? " selected" : ""}`}
                    onClick={() => setSelected(key)}
                  >
                    <span className="cal-daynum">{dateOf(key).getDate()}</span>
                    {shown.map((a) => (
                      <span key={a.id} className={`cal-chip appt status-${a.status}`}>
                        {apptTime(a.startsAt)} {a.clientName}
                      </span>
                    ))}
                    {mode === "month" && dayAppts.length > 3 ? <span className="cal-more">+{dayAppts.length - 3} more</span> : null}
                    {dayJobs.slice(0, mode === "month" ? 1 : 3).map((j) => (
                      <span key={j.id} className="cal-chip job">🛠 {j.clientName || j.jobType}</span>
                    ))}
                    {mode === "month" && dayJobs.length > 1 ? <span className="cal-more">+{dayJobs.length - 1} job{dayJobs.length > 2 ? "s" : ""}</span> : null}
                  </button>
                );
              })}
            </div>
            {apptsQuery.isLoading ? <p className="muted small">Loading appointments…</p> : null}
          </section>

          <aside className="panel day-panel">
            <div className="panel-head">
              <h2>{formatDate(selected)}</h2>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setEditor({ appt: null, dateKey: selected })}>+ Appointment</button>
            </div>
            <h3 className="day-section-title">Appointments ({selectedAppts.length})</h3>
            {selectedAppts.length === 0 ? <p className="muted">No appointments this day.</p> : (
              <ul className="day-list">
                {selectedAppts.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="day-item" onClick={() => setEditor({ appt: a, dateKey: selected })}>
                      <span className="day-item-main">
                        <strong>{apptTime(a.startsAt)} · {a.clientName}</strong>
                        <span className="feed-meta">
                          {[a.clientPhone, a.crewMember ? `Crew: ${a.crewMember}` : "", a.notes].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                      <span className={`status-pill ${STATUS_CLS[a.status]}`}>{APPOINTMENT_STATUS_LABELS[a.status]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="day-section-title">Jobs ({selectedJobs.length})</h3>
            {selectedJobs.length === 0 ? <p className="muted">No jobs dated this day.</p> : (
              <ul className="day-list">
                {selectedJobs.map((j) => (
                  <li key={j.id}>
                    <button type="button" className="day-item" onClick={() => onOpenJob(j.id)}>
                      <span className="day-item-main">
                        <strong>{j.clientName || "Job"} · {j.jobType || "—"}</strong>
                        <span className="feed-meta">{j.jobAddress || "—"}{j.completedAt ? " · Completed" : ""}</span>
                      </span>
                      <span className="status-pill">Job</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}

      {editor ? (
        <AppointmentEditor
          target={editor}
          jobs={jobs}
          onClose={() => setEditor(null)}
          onSaved={(key) => { setEditor(null); setSelected(key); setAnchor(key); }}
          canDelete={canDelete}
        />
      ) : null}
    </div>
  );
}

interface ApptForm {
  id: number | null;
  jobId: number | null;
  clientId: number | null;
  clientName: string;
  clientPhone: string;
  startsAt: string;
  notes: string;
  exteriorWork: boolean;
  status: AppointmentStatus;
  crewMember: string;
  etaMinutes: string;
  hasShareLink: boolean;
}

function AppointmentEditor({
  target,
  jobs,
  onClose,
  onSaved,
  canDelete,
}: {
  target: EditorTarget;
  jobs: Job[];
  onClose: () => void;
  onSaved: (dateKey: string) => void;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const a = target.appt;
  const [form, setForm] = useState<ApptForm>({
    id: a?.id ?? null,
    jobId: a?.jobId ?? null,
    clientId: a?.clientId ?? null,
    clientName: a?.clientName ?? "",
    clientPhone: a?.clientPhone ?? "",
    startsAt: a ? a.startsAt.slice(0, 16) : `${target.dateKey}T09:00`,
    notes: a?.notes ?? "",
    exteriorWork: a?.exteriorWork ?? false,
    status: a?.status ?? "scheduled",
    crewMember: a?.crewMember ?? "",
    etaMinutes: a?.etaMinutes != null ? String(a.etaMinutes) : "",
    hasShareLink: a?.hasShareLink ?? false,
  });
  const [prevStatus] = useState(form.status);
  const [prevEta] = useState(form.etaMinutes.trim() === "" ? null : Number(form.etaMinutes));
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const clientsQuery = useQuery({ queryKey: ["clients", ""], queryFn: () => api.listClients({ search: "" }) });
  const clients = clientsQuery.data?.clients ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["appointments"] });
    void queryClient.invalidateQueries({ queryKey: ["office-dashboard"] });
  };

  const parsedEta = form.status === "on_my_way" && form.etaMinutes.trim() !== ""
    ? Math.min(480, Math.max(1, Math.round(Number(form.etaMinutes) || 0)))
    : null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const clientName = form.clientName.trim();
      if (!clientName) throw new Error("Client name is required.");
      if (!form.startsAt) throw new Error("Date and time are required.");
      const startsAt = form.startsAt.length === 16 ? `${form.startsAt}:00` : form.startsAt;
      const saved = await api.saveAppointment({
        id: form.id,
        jobId: form.jobId,
        clientId: form.clientId,
        clientName,
        clientPhone: form.clientPhone.trim(),
        startsAt,
        notes: form.notes.trim(),
        exteriorWork: form.exteriorWork,
        status: form.status,
        crewMember: form.crewMember.trim(),
        etaMinutes: parsedEta,
      });
      // Same follow-through as the phone's Dispatch sheet: moving to
      // on-my-way / arrived refreshes the public page and logs the job thread.
      if ((form.status === "on_my_way" || form.status === "arrived") && (form.status !== prevStatus || parsedEta !== prevEta)) {
        await api.updateOnMyWay({ appointmentId: saved.id, status: form.status, etaMinutes: parsedEta }).catch(() => undefined);
      }
      return saved;
    },
    onSuccess: (saved) => { invalidate(); onSaved(apptDayKey(form.startsAt) || target.dateKey); void saved; },
    onError: (e) => setError(cleanError(e)),
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteAppointment({ id: form.id! }),
    onSuccess: () => { invalidate(); onSaved(target.dateKey); },
    onError: (e) => setError(cleanError(e)),
  });
  const shareMutation = useMutation({
    mutationFn: () => api.shareOnMyWay({ appointmentId: form.id! }),
    onSuccess: (res) => { setShareToken(res.token); setForm((f) => ({ ...f, hasShareLink: true })); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const revokeMutation = useMutation({
    mutationFn: () => api.revokeOnMyWay({ appointmentId: form.id! }),
    onSuccess: () => { setShareToken(null); setForm((f) => ({ ...f, hasShareLink: false })); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });

  const shareLink = shareToken ? `${window.location.origin}/${`#onmyway=${shareToken}`}` : null;
  const set = (patch: Partial<ApptForm>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={form.id ? "Edit appointment" : "New appointment"} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{form.id ? "Edit appointment" : "New appointment"}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); setError(""); saveMutation.mutate(); }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Job (optional)</span>
              <select
                value={form.jobId ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  const j = jobs.find((row) => row.id === id);
                  set({
                    jobId: id,
                    clientId: j ? j.clientId : form.clientId,
                    clientName: j ? j.clientName : form.clientName,
                    clientPhone: j && !form.clientPhone ? j.clientPhone : form.clientPhone,
                  });
                }}
              >
                <option value="">—</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.clientName} · {j.jobType}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Client (optional)</span>
              <select
                value={form.clientId ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  const c = clients.find((row) => row.id === id);
                  set({ clientId: id, clientName: c ? c.name : form.clientName, clientPhone: c ? c.phone : form.clientPhone });
                }}
              >
                <option value="">—</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Client name</span>
              <input value={form.clientName} onChange={(e) => set({ clientName: e.target.value })} required />
            </label>
            <label className="field">
              <span>Phone</span>
              <input value={form.clientPhone} onChange={(e) => set({ clientPhone: e.target.value })} />
            </label>
            <label className="field">
              <span>Date & time</span>
              <input type="datetime-local" value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} required />
            </label>
            <label className="field">
              <span>Crew member</span>
              <input value={form.crewMember} onChange={(e) => set({ crewMember: e.target.value })} placeholder="Who's going?" />
            </label>
            <label className="field">
              <span>Status</span>
              <select value={form.status} onChange={(e) => set({ status: e.target.value as AppointmentStatus })}>
                {APPOINTMENT_STATUSES.map((s) => <option key={s} value={s}>{APPOINTMENT_STATUS_LABELS[s]}</option>)}
              </select>
            </label>
            {form.status === "on_my_way" ? (
              <label className="field">
                <span>ETA (minutes)</span>
                <input type="number" min={1} max={480} value={form.etaMinutes} onChange={(e) => set({ etaMinutes: e.target.value })} placeholder="25" />
              </label>
            ) : null}
            <label className="field span2">
              <span>Notes</span>
              <textarea rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
            </label>
          </div>
          <label className="check-row appt-check">
            <input type="checkbox" checked={form.exteriorWork} onChange={(e) => set({ exteriorWork: e.target.checked })} />
            <span>Exterior work — show forecast on the phone</span>
          </label>

          {form.id ? (
            <div className="link-actions appt-share">
              {shareLink ? (
                <>
                  <input className="share-link-input" readOnly value={shareLink} aria-label="On-My-Way link" />
                  <button type="button" className="btn btn-ghost btn-small" onClick={async () => {
                    try { await navigator.clipboard.writeText(shareLink); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ }
                  }}>{copied ? "Copied!" : "Copy link"}</button>
                  <button type="button" className="btn btn-danger-ghost btn-small" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate()}>Revoke</button>
                </>
              ) : (
                <button type="button" className="btn btn-ghost btn-small" disabled={shareMutation.isPending} onClick={() => shareMutation.mutate()}>
                  {shareMutation.isPending ? "Creating…" : form.hasShareLink ? "Generate new On-My-Way link" : "Share On-My-Way link"}
                </button>
              )}
              {form.hasShareLink && !shareLink ? <span className="feed-meta">A link is already active for this appointment.</span> : null}
            </div>
          ) : null}

          {error ? <p className="inline-error">{error}</p> : null}
          <div className="modal-actions appt-actions">
            {form.id && canDelete ? (
              !confirmDelete ? (
                <button type="button" className="btn btn-danger-ghost" onClick={() => setConfirmDelete(true)}>Delete</button>
              ) : (
                <>
                  <span className="feed-meta">Delete this appointment?</span>
                  <button type="button" className="btn btn-danger-ghost" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
                    {deleteMutation.isPending ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Keep</button>
                </>
              )
            ) : null}
            <span className="appt-actions-spacer" />
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save appointment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
