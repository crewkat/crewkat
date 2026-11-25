import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { cleanError, formatDate, formatDateTime, todayIso } from "../utils";

/**
 * Job-execution record panels for the Office job detail (parity items
 * 4, 5, 6, 8). The phone app authors these records from the job
 * workspace; Office previously only showed counts. Every panel wires
 * the same server actions the phone uses — no new server surface.
 *
 * Data comes from the shared ["job", jobId] getJob query (punch items,
 * progress updates) and ["job-operations", jobId] (daily logs, internal
 * notes) so the panels and the detail header never disagree.
 */

type JobData = Awaited<ReturnType<typeof api.getJob>>;
type OpsData = Awaited<ReturnType<typeof api.getJobOperations>>;

function useJobInvalidation(jobId: number) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    void queryClient.invalidateQueries({ queryKey: ["job-operations", jobId] });
    void queryClient.invalidateQueries({ queryKey: ["job-timeline", jobId] });
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
  };
}

/* ------------------------------ punch list (item 4) ------------------------------ */

export function PunchListPanel({ jobId, canDelete }: { jobId: number; canDelete: boolean }) {
  const invalidate = useJobInvalidation(jobId);
  const jobQuery = useQuery({ queryKey: ["job", jobId], queryFn: () => api.getJob({ id: jobId }) });
  const items = jobQuery.data?.punchItems ?? [];
  const signoff = jobQuery.data?.punchSignoff ?? null;
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const addMutation = useMutation({
    mutationFn: () => api.addPunchItem({ jobId, text: text.trim() }),
    onSuccess: () => { setText(""); setError(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const toggleMutation = useMutation({
    mutationFn: (args: { id: number; completed: boolean }) => api.togglePunchItem(args),
    onSuccess: invalidate,
    onError: (e) => setError(cleanError(e)),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deletePunchItem({ id }),
    onSuccess: invalidate,
    onError: (e) => setError(cleanError(e)),
  });

  const open = items.filter((i) => !i.completed).length;
  return (
    <section className="drawer-section">
      <h3>Punch list ({items.length}{items.length ? ` · ${open} open` : ""})</h3>
      {items.length === 0 ? <p className="muted">No punch items yet — add the first one below.</p> : (
        <ul className="check-list">
          {items.map((item) => (
            <li key={item.id} className={item.completed ? "done" : ""}>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={item.completed}
                  disabled={toggleMutation.isPending}
                  onChange={(e) => toggleMutation.mutate({ id: item.id, completed: e.target.checked })}
                />
                <span>{item.text}</span>
              </label>
              {canDelete ? (
                <button type="button" className="link-btn danger" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(item.id)}>Delete</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="inline-form">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a punch item…" aria-label="New punch item" maxLength={500} />
        <button type="button" className="btn btn-primary btn-small" disabled={!text.trim() || addMutation.isPending} onClick={() => addMutation.mutate()}>
          {addMutation.isPending ? "Adding…" : "Add"}
        </button>
      </div>
      {signoff ? (
        <p className="feed-meta block">✓ Signed off by {signoff.customerName} · {formatDateTime(signoff.signedAt)}</p>
      ) : (
        <p className="muted small">No client sign-off yet — sign-off is captured with the client in the app.</p>
      )}
      {error ? <p className="inline-error">{error}</p> : null}
    </section>
  );
}

/* ------------------------------ daily logs + notes (item 5) ------------------------------ */

export function DailyLogsPanel({ jobId }: { jobId: number }) {
  const invalidate = useJobInvalidation(jobId);
  const opsQuery = useQuery({ queryKey: ["job-operations", jobId], queryFn: () => api.getJobOperations({ jobId }) });
  const logs: OpsData["dailyLogs"] = opsQuery.data?.dailyLogs ?? [];
  const notes: OpsData["internalNotes"] = opsQuery.data?.internalNotes ?? [];
  const [logDate, setLogDate] = useState(todayIso());
  const [crew, setCrew] = useState("");
  const [hours, setHours] = useState("");
  const [logNotes, setLogNotes] = useState("");
  const [blockers, setBlockers] = useState("");
  const [clientSummary, setClientSummary] = useState("");
  const [shared, setShared] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [reminderDate, setReminderDate] = useState("");
  const [error, setError] = useState("");

  const editLog = (log: OpsData["dailyLogs"][number]) => {
    setLogDate(log.logDate);
    setCrew(log.crew);
    setHours(log.hours);
    setLogNotes(log.notes);
    setBlockers(log.blockers);
    setClientSummary(log.clientSummary);
    setShared(log.sharedWithClient);
  };

  const logMutation = useMutation({
    mutationFn: () => api.saveDailyLog({
      jobId, logDate, crew: crew.trim(), hours: hours.trim(), photoIds: [],
      notes: logNotes.trim(), blockers: blockers.trim(), clientSummary: clientSummary.trim(), sharedWithClient: shared,
    }),
    onSuccess: () => { setError(""); setLogNotes(""); setBlockers(""); setClientSummary(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const noteMutation = useMutation({
    mutationFn: () => api.saveInternalNote({ jobId, clientId: null, note: noteText.trim(), reminderDate }),
    onSuccess: () => { setNoteText(""); setReminderDate(""); setError(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const toggleNoteMutation = useMutation({
    mutationFn: (args: { id: number; completed: boolean }) => api.toggleInternalNote(args),
    onSuccess: invalidate,
    onError: (e) => setError(cleanError(e)),
  });

  return (
    <section className="drawer-section">
      <h3>Daily logs ({logs.length})</h3>
      {opsQuery.isLoading ? <p className="muted">Loading logs…</p> : null}
      {logs.length === 0 ? <p className="muted">No daily logs yet.</p> : (
        <ul className="feed-list">
          {logs.map((log) => (
            <li key={log.id}>
              <div className="feed-row">
                <strong>{formatDate(log.logDate)}</strong>
                <span className="feed-meta">{[log.crew, log.hours ? `${log.hours} hrs` : ""].filter(Boolean).join(" · ")}</span>
                <button type="button" className="link-btn" onClick={() => editLog(log)}>Edit</button>
              </div>
              {log.notes ? <p className="feed-body">{log.notes}</p> : null}
              {log.blockers ? <p className="feed-body"><strong>Blockers:</strong> {log.blockers}</p> : null}
              {log.clientSummary ? <p className="feed-body"><strong>Client summary:</strong> {log.clientSummary}{log.sharedWithClient ? " (shared)" : ""}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="sub-form">
        <h4 className="pair-title">Add / update a day's log</h4>
        <div className="form-grid">
          <label className="field"><span>Date</span><input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} /></label>
          <label className="field"><span>Crew</span><input value={crew} onChange={(e) => setCrew(e.target.value)} placeholder="Who was on site" /></label>
          <label className="field"><span>Hours</span><input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 8" /></label>
          <label className="field"><span>Share summary with client</span>
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} aria-label="Share summary with client" />
          </label>
          <label className="field span2"><span>Notes</span><textarea rows={2} value={logNotes} onChange={(e) => setLogNotes(e.target.value)} /></label>
          <label className="field span2"><span>Blockers</span><input value={blockers} onChange={(e) => setBlockers(e.target.value)} /></label>
          <label className="field span2"><span>Client summary</span><textarea rows={2} value={clientSummary} onChange={(e) => setClientSummary(e.target.value)} /></label>
        </div>
        <button type="button" className="btn btn-primary btn-small" disabled={logMutation.isPending} onClick={() => logMutation.mutate()}>
          {logMutation.isPending ? "Saving…" : "Save daily log"}
        </button>
        <p className="muted small">Saving with a date that already has a log updates that day's log.</p>
      </div>

      <h4 className="pair-title">Internal notes ({notes.length})</h4>
      {notes.length === 0 ? <p className="muted">No internal notes on this job.</p> : (
        <ul className="check-list">
          {notes.map((note) => (
            <li key={note.id} className={note.completed ? "done" : ""}>
              <label className="check-row">
                <input type="checkbox" checked={note.completed} disabled={toggleNoteMutation.isPending} onChange={(e) => toggleNoteMutation.mutate({ id: note.id, completed: e.target.checked })} />
                <span>{note.note}{note.reminderDate ? <span className="feed-meta"> · reminder {formatDate(note.reminderDate)}</span> : null}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="inline-form">
        <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add an internal note…" aria-label="New internal note" maxLength={5000} />
        <input type="date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} aria-label="Reminder date (optional)" />
        <button type="button" className="btn btn-primary btn-small" disabled={!noteText.trim() || noteMutation.isPending} onClick={() => noteMutation.mutate()}>
          {noteMutation.isPending ? "Adding…" : "Add note"}
        </button>
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
    </section>
  );
}

/* ------------------------------ progress updates (item 6) ------------------------------ */

export function ProgressPanel({ jobId, canDelete }: { jobId: number; canDelete: boolean }) {
  const invalidate = useJobInvalidation(jobId);
  const jobQuery = useQuery({ queryKey: ["job", jobId], queryFn: () => api.getJob({ id: jobId }) });
  const updates: JobData["progressUpdates"] = jobQuery.data?.progressUpdates ?? [];
  const photos: JobData["photos"] = jobQuery.data?.photos ?? [];
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dayNumber, setDayNumber] = useState(1);
  const [note, setNote] = useState("");
  const [photoIds, setPhotoIds] = useState<number[]>([]);
  const [status, setStatus] = useState<"draft" | "sent">("draft");
  const [error, setError] = useState("");

  const nextDay = useMemo(() => updates.reduce((max, u) => Math.max(max, u.dayNumber), 0) + 1, [updates]);

  const startNew = () => { setEditingId(null); setDayNumber(nextDay); setNote(""); setPhotoIds([]); setStatus("draft"); };
  const startEdit = (u: JobData["progressUpdates"][number]) => {
    setEditingId(u.id); setDayNumber(u.dayNumber); setNote(u.note); setPhotoIds(u.photoIds); setStatus(u.status);
  };

  const saveMutation = useMutation({
    mutationFn: () => api.saveProgressUpdate({ id: editingId, jobId, dayNumber, note: note.trim(), photoIds, status }),
    onSuccess: () => { setError(""); startNew(); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteProgressUpdate({ id }),
    onSuccess: invalidate,
    onError: (e) => setError(cleanError(e)),
  });

  return (
    <section className="drawer-section">
      <h3>Progress updates ({updates.length})</h3>
      {updates.length === 0 ? <p className="muted">No progress updates yet.</p> : (
        <ul className="feed-list">
          {[...updates].sort((a, b) => a.dayNumber - b.dayNumber).map((u) => (
            <li key={u.id}>
              <div className="feed-row">
                <strong>Day {u.dayNumber}</strong>
                <span className={`status-pill ${u.status === "sent" ? "sent" : "draft"}`}>{u.status === "sent" ? "Sent" : "Draft"}</span>
                <span className="feed-meta">{formatDate(u.createdAt)}</span>
                <button type="button" className="link-btn" onClick={() => startEdit(u)}>Edit</button>
                {canDelete ? <button type="button" className="link-btn danger" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(u.id)}>Delete</button> : null}
              </div>
              {u.note ? <p className="feed-body">{u.note}</p> : null}
              {u.photoIds.length ? <p className="feed-meta">{u.photoIds.length} photo{u.photoIds.length === 1 ? "" : "s"} attached</p> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="sub-form">
        <h4 className="pair-title">{editingId ? `Edit day ${dayNumber} update` : "New progress update"}</h4>
        <div className="form-grid">
          <label className="field"><span>Day #</span><input type="number" min={1} max={999} value={dayNumber} onChange={(e) => setDayNumber(Number(e.target.value) || 1)} /></label>
          <label className="field"><span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as "draft" | "sent")}>
              <option value="draft">Draft</option>
              <option value="sent">Sent to client</option>
            </select>
          </label>
          <label className="field span2"><span>Update</span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What got done…" /></label>
        </div>
        {photos.length > 0 ? (
          <div className="photo-pick">
            <span className="muted small">Attach job photos (max 12):</span>
            <div className="photo-pick-grid">
              {photos.map((p) => (
                <label key={p.id} className={`photo-pick-item${photoIds.includes(p.id) ? " picked" : ""}`}>
                  <input
                    type="checkbox"
                    checked={photoIds.includes(p.id)}
                    onChange={(e) => setPhotoIds((prev) => e.target.checked ? [...prev, p.id].slice(0, 12) : prev.filter((x) => x !== p.id))}
                  />
                  <img src={p.url} alt={p.caption || p.filename} loading="lazy" />
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <div className="link-actions">
          <button type="button" className="btn btn-primary btn-small" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "Saving…" : editingId ? "Save update" : "Add update"}
          </button>
          {editingId ? <button type="button" className="btn btn-ghost btn-small" onClick={startNew}>New instead</button> : null}
        </div>
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
    </section>
  );
}

/* ------------------------------ scanned documents (item 8) ------------------------------ */

const SCAN_KIND_LABELS: Record<string, string> = { receipt: "Receipt", contract: "Contract", other: "Document" };

export function ScansPanel({ jobId }: { jobId: number }) {
  const queryClient = useQueryClient();
  const suiteQuery = useQuery({
    queryKey: ["expansion-suite", todayIso()],
    queryFn: () => api.getExpansionSuite({ today: todayIso() }),
  });
  const scans = suiteQuery.data?.scans ?? [];
  const jobs = suiteQuery.data?.jobs ?? [];
  const [error, setError] = useState("");
  const relinkMutation = useMutation({
    mutationFn: (args: { scanId: number; jobId: number | null }) => api.setScannedDocumentJob(args),
    onSuccess: () => { setError(""); void queryClient.invalidateQueries({ queryKey: ["expansion-suite"] }); },
    onError: (e) => setError(cleanError(e)),
  });

  const here = scans.filter((s) => s.jobId === jobId);
  const elsewhere = scans.filter((s) => s.jobId !== jobId);

  const row = (scan: (typeof scans)[number]) => (
    <li key={scan.id}>
      <div className="feed-row">
        <a href={scan.url} target="_blank" rel="noreferrer">{scan.title || scan.filename}</a>
        <span className="feed-meta">{SCAN_KIND_LABELS[scan.kind] ?? scan.kind} · {formatDate(scan.createdAt)}</span>
      </div>
      <label className="field scan-relink">
        <span>Filed under</span>
        <select
          value={scan.jobId ?? ""}
          disabled={relinkMutation.isPending}
          onChange={(e) => relinkMutation.mutate({ scanId: scan.id, jobId: e.target.value ? Number(e.target.value) : null })}
          aria-label={`Job for ${scan.title || scan.filename}`}
        >
          <option value="">General (no job)</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
        </select>
      </label>
    </li>
  );

  return (
    <section className="drawer-section">
      <h3>Scanned documents ({here.length} on this job)</h3>
      {suiteQuery.isLoading ? <p className="muted">Loading scans…</p> : null}
      {suiteQuery.isError ? <p className="muted">Scans aren't available right now.</p> : null}
      {suiteQuery.data && here.length === 0 ? <p className="muted">No scans filed to this job yet — scanning happens in the app; filing can be fixed here or below.</p> : null}
      {here.length > 0 ? <ul className="feed-list">{here.map(row)}</ul> : null}
      {elsewhere.length > 0 ? (
        <>
          <h4 className="pair-title">All other scans — re-file to this job</h4>
          <ul className="feed-list">{elsewhere.map(row)}</ul>
        </>
      ) : null}
      {error ? <p className="inline-error">{error}</p> : null}
    </section>
  );
}
