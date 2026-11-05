import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { SignaturePad } from "../components/SignaturePad";
import {
  MEMBER_CREDENTIAL_TYPES,
  type CredentialBucket,
  type MemberCredential,
  type MemberCredentialType,
  type SafetySession,
  type SafetyTalk,
} from "../types";
import { cleanError, downloadBase64, fileToBase64, formatDate } from "../utils";

/**
 * Safety (0096, SimplySub steals Item 3 — OFFICE ONLY): toolbox-talk
 * library (24 original talks, EN + ES), talk sessions with attendee
 * checklists + presenter signature and a branded PDF proof, and
 * per-member credential tracking with an expiry dashboard.
 *
 * Permissions mirror the server classification: reads are Office+,
 * EVERY mutation is Admin-only — non-admins see the library, sessions
 * and dashboard but no create/edit/delete controls (the server refuses
 * them regardless). Crew/field members have no Safety surface in v1,
 * including no self-service view of their own credentials.
 */

const BUCKET_DEFS: { key: "expired" | "due30" | "due90" | "ok" | "noExpiry"; label: string; hint: string }[] = [
  { key: "expired", label: "Expired", hint: "Past the expiry date" },
  { key: "due30", label: "≤ 30 days", hint: "Expires within a month" },
  { key: "due90", label: "≤ 90 days", hint: "Expires within a quarter" },
  { key: "ok", label: "OK", hint: "Good for 90+ days" },
  { key: "noExpiry", label: "No expiry", hint: "No date on file" },
];

const BUCKET_PILL: Record<CredentialBucket, string> = {
  expired: "overdue",
  due30: "sent",
  due90: "draft",
  ok: "done",
  no_expiry: "draft",
};

export function SafetyView({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [lang, setLang] = useState<"en" | "es">("en");
  const [selectedTalk, setSelectedTalk] = useState<SafetyTalk | null>(null);
  const [runningTalk, setRunningTalk] = useState<SafetyTalk | "custom" | null>(null);
  const [jobFilter, setJobFilter] = useState<number | null>(null);
  const [memberFilter, setMemberFilter] = useState<number | null>(null);
  const [bucketFilter, setBucketFilter] = useState<string>("all");
  const [error, setError] = useState("");

  const talksQuery = useQuery({ queryKey: ["safety-talks"], queryFn: () => api.listSafetyTalks({}) });
  const dashboardQuery = useQuery({ queryKey: ["safety-dashboard"], queryFn: () => api.getSafetyDashboard({}) });
  const sessionsQuery = useQuery({
    queryKey: ["safety-sessions", jobFilter, memberFilter],
    queryFn: () => api.listSafetySessions({ jobId: jobFilter, memberUserId: memberFilter }),
  });
  const credentialsQuery = useQuery({
    queryKey: ["member-credentials", memberFilter],
    queryFn: () => api.listMemberCredentials({ userId: memberFilter }),
  });
  const jobsQuery = useQuery({ queryKey: ["jobs", ""], queryFn: () => api.listJobs({ search: "" }) });
  // Team roster is Admin-only server-side; only admins need it (session
  // presenters/attendees and credential owners are picked from it).
  const teamQuery = useQuery({
    queryKey: ["team-members"],
    queryFn: () => api.listTeamMembers({}),
    enabled: canManage,
    retry: false,
  });

  const talks = talksQuery.data?.talks ?? [];
  const sessions = sessionsQuery.data?.sessions ?? [];
  const credentials = credentialsQuery.data?.credentials ?? [];
  const dashboard = dashboardQuery.data;
  const members = teamQuery.data?.members ?? [];
  const jobs = jobsQuery.data?.jobs ?? [];

  // Member filter options for non-admin viewers come from the data
  // itself (they cannot read the roster).
  const memberOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of members) map.set(m.id, m.name);
    for (const c of credentialsQuery.data?.credentials ?? []) map.set(c.userId, c.memberName);
    for (const s of dashboard?.recentSessions ?? []) {
      if (s.presenterUserId) map.set(s.presenterUserId, s.presenterName);
      for (const a of s.attendees) if (a.userId) map.set(a.userId, a.name);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [members, credentialsQuery.data, dashboard]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["safety-sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["safety-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["member-credentials"] });
  };

  const pdfMutation = useMutation({
    mutationFn: (id: number) => api.getSafetySessionPdf({ id }),
    onSuccess: (r) => downloadBase64(r.pdfBase64, r.filename),
    onError: (e) => setError(cleanError(e)),
  });
  const deleteSessionMutation = useMutation({
    mutationFn: (id: number) => api.deleteSafetySession({ id }),
    onSuccess: () => { setError(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });

  const visibleCredentials = bucketFilter === "all" ? credentials : credentials.filter((c) => (bucketFilter === "noExpiry" ? c.bucket === "no_expiry" : c.bucket === bucketFilter));

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Safety</h1>
          <p className="view-sub">Toolbox talks, attendance records, and team credential expirations. Talks are written in English and Spanish; sessions are signed by the presenter and exportable as a PDF proof.</p>
        </div>
        {canManage ? (
          <button type="button" className="btn btn-primary" onClick={() => setRunningTalk("custom")}>Run a talk</button>
        ) : null}
      </div>
      {!canManage ? <p className="inline-notice">You're viewing Safety as office staff — only an Admin can run talks or change credential records.</p> : null}
      {error ? <p className="inline-error">{error}</p> : null}

      {/* ---- Expiry dashboard ---- */}
      <section className="panel">
        <h2 className="panel-title">Credential expirations</h2>
        {dashboardQuery.isLoading ? <p className="muted">Loading dashboard…</p> : null}
        {dashboard ? (
          <>
            <div className="link-actions">
              {BUCKET_DEFS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className={`btn btn-small ${bucketFilter === b.key ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setBucketFilter(bucketFilter === b.key ? "all" : b.key)}
                  title={b.hint}
                >
                  {b.label}: {dashboard.counts[b.key]}
                </button>
              ))}
              <span className="muted small">{`${dashboard.credentialCount} credentials · ${dashboard.sessionCount} talk sessions (${dashboard.sessionsThisMonth} this month)`}</span>
            </div>
            {BUCKET_DEFS.filter((b) => b.key !== "ok" && dashboard.buckets[b.key].length > 0).map((b) => (
              <p key={b.key} className="feed-meta block">
                <strong>{b.label}:</strong>{" "}
                {dashboard.buckets[b.key].map((c) => `${c.memberName} — ${c.typeLabel}${c.expiresOn ? ` (${formatDate(c.expiresOn)})` : ""}`).join(" · ")}
              </p>
            ))}
          </>
        ) : null}
      </section>

      {/* ---- Credentials ---- */}
      <CredentialsPanel
        credentials={visibleCredentials}
        members={members}
        canManage={canManage}
        memberFilter={memberFilter}
        onMemberFilter={setMemberFilter}
        memberOptions={memberOptions}
        onChanged={invalidate}
      />

      {/* ---- Sessions ---- */}
      <section className="panel">
        <h2 className="panel-title">Talk sessions</h2>
        <div className="link-actions">
          <select className="stage-select" value={jobFilter ?? ""} onChange={(e) => setJobFilter(e.target.value ? Number(e.target.value) : null)} aria-label="Filter sessions by job">
            <option value="">All jobs</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.clientName} · {j.jobType}</option>)}
          </select>
          <select className="stage-select" value={memberFilter ?? ""} onChange={(e) => setMemberFilter(e.target.value ? Number(e.target.value) : null)} aria-label="Filter by team member">
            <option value="">All team members</option>
            {memberOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {sessionsQuery.isLoading ? <p className="muted">Loading sessions…</p> : null}
        {!sessionsQuery.isLoading && sessions.length === 0 ? <p className="muted">No sessions match. Run a talk from the library below to record attendance.</p> : null}
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            canManage={canManage}
            onPdf={() => pdfMutation.mutate(s.id)}
            onDelete={() => { if (window.confirm("Delete this session record?")) deleteSessionMutation.mutate(s.id); }}
          />
        ))}
      </section>

      {/* ---- Talk library ---- */}
      <section className="panel">
        <div className="link-status-row">
          <h2 className="panel-title">Talk library</h2>
          <div className="link-actions">
            <button type="button" className={`btn btn-small ${lang === "en" ? "btn-primary" : "btn-ghost"}`} onClick={() => setLang("en")}>English</button>
            <button type="button" className={`btn btn-small ${lang === "es" ? "btn-primary" : "btn-ghost"}`} onClick={() => setLang("es")}>Español</button>
          </div>
        </div>
        {talksQuery.isLoading ? <p className="muted">Loading talks…</p> : null}
        <div className="link-actions">
          {talks.map((t) => (
            <button key={t.slug} type="button" className={`btn btn-small ${selectedTalk?.slug === t.slug ? "btn-primary" : "btn-ghost"}`} onClick={() => setSelectedTalk(t)}>
              {lang === "es" ? t.titleEs : t.titleEn}
            </button>
          ))}
        </div>
        {selectedTalk ? (
          <div className="summary-row">
            <h3>{lang === "es" ? selectedTalk.titleEs : selectedTalk.titleEn}</h3>
            <ul>
              {(lang === "es" ? selectedTalk.bulletsEs : selectedTalk.bulletsEn).map((b) => <li key={b.slice(0, 24)} className="feed-meta">{b}</li>)}
            </ul>
            {canManage ? (
              <button type="button" className="btn btn-primary btn-small" onClick={() => setRunningTalk(selectedTalk)}>Run this talk</button>
            ) : null}
          </div>
        ) : <p className="muted">Pick a topic to read the talk points.</p>}
      </section>

      {runningTalk !== null && canManage ? (
        <RunTalkForm
          talk={runningTalk === "custom" ? null : runningTalk}
          members={members}
          jobs={jobs}
          onClose={() => setRunningTalk(null)}
          onSaved={() => { setRunningTalk(null); invalidate(); }}
        />
      ) : null}
    </>
  );
}

function SessionRow({ session, canManage, onPdf, onDelete }: { session: SafetySession; canManage: boolean; onPdf: () => void; onDelete: () => void }) {
  return (
    <div className="summary-row">
      <div className="link-status-row">
        <strong>{session.title}</strong>
        <span className="status-pill draft">{formatDate(session.date)}</span>
      </div>
      <p className="feed-meta">
        Presented by {session.presenterName}
        {session.jobLabel ? ` · ${session.jobLabel}` : ""}
        {session.signatureUrl ? " · ✓ signed" : " · unsigned"}
      </p>
      <p className="feed-meta">
        Attendees ({session.attendees.length}): {session.attendees.map((a) => a.name).join(", ") || "—"}
      </p>
      {session.customBody ? <p className="feed-meta">{session.customBody}</p> : null}
      {session.signatureUrl ? <p><img src={session.signatureUrl} alt={`Signature of ${session.presenterName}`} style={{ maxWidth: 180, borderRadius: 8, background: "#fff" }} /></p> : null}
      <div className="link-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={onPdf}>PDF proof</button>
        {canManage ? (
          <button type="button" className="btn btn-danger-ghost btn-small" onClick={onDelete}>Delete</button>
        ) : null}
      </div>
    </div>
  );
}

function RunTalkForm({ talk, members, jobs, onClose, onSaved }: {
  talk: SafetyTalk | null;
  members: { id: number; name: string }[];
  jobs: { id: number; clientName: string; jobType: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [lang, setLang] = useState<"en" | "es">("en");
  const [customTitle, setCustomTitle] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [presenterUserId, setPresenterUserId] = useState<number>(members[0]?.id ?? 0);
  const [attendeeIds, setAttendeeIds] = useState<number[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");

  const saveMutation = useMutation({
    mutationFn: () => api.createSafetySession({
      date,
      talkSlug: talk?.slug ?? "",
      lang,
      customTitle: talk ? "" : customTitle.trim(),
      customBody: customBody.trim(),
      presenterUserId,
      attendeeUserIds: attendeeIds,
      jobId,
      signatureDataBase64: signature,
    }),
    onSuccess: onSaved,
    onError: (e) => setError(cleanError(e)),
  });

  const toggleAttendee = (id: number) =>
    setAttendeeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <section className="panel">
      <h2 className="panel-title">{talk ? `Run: ${lang === "es" ? talk.titleEs : talk.titleEn}` : "Run a custom talk"}</h2>
      {talk ? (
        <>
          <div className="link-actions">
            <button type="button" className={`btn btn-small ${lang === "en" ? "btn-primary" : "btn-ghost"}`} onClick={() => setLang("en")}>English</button>
            <button type="button" className={`btn btn-small ${lang === "es" ? "btn-primary" : "btn-ghost"}`} onClick={() => setLang("es")}>Español</button>
          </div>
          <ul>
            {(lang === "es" ? talk.bulletsEs : talk.bulletsEn).map((b) => <li key={b.slice(0, 24)} className="feed-meta">{b}</li>)}
          </ul>
        </>
      ) : (
        <div className="link-actions">
          <input type="text" placeholder="Custom talk title" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} aria-label="Custom talk title" style={{ minWidth: 260 }} />
        </div>
      )}
      <div className="link-actions">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Session date" />
        <select className="stage-select" value={presenterUserId} onChange={(e) => setPresenterUserId(Number(e.target.value))} aria-label="Presenter">
          {members.map((m) => <option key={m.id} value={m.id}>Presenter: {m.name}</option>)}
        </select>
        <select className="stage-select" value={jobId ?? ""} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : null)} aria-label="Linked job">
          <option value="">No linked job</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.clientName} · {j.jobType}</option>)}
        </select>
      </div>
      <p className="muted small">Attendees — check everyone who was present:</p>
      <div className="link-actions">
        {members.map((m) => (
          <label key={m.id} className="muted small">
            <input type="checkbox" checked={attendeeIds.includes(m.id)} onChange={() => toggleAttendee(m.id)} /> {m.name}
          </label>
        ))}
        {members.length === 0 ? <span className="muted small">No team members found.</span> : null}
      </div>
      <div className="link-actions">
        <input type="text" placeholder="Notes (optional)" value={customBody} onChange={(e) => setCustomBody(e.target.value)} aria-label="Session notes" style={{ minWidth: 320 }} />
      </div>
      <p className="muted small">Presenter signature:</p>
      <SignaturePad onChange={setSignature} />
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="link-actions">
        <button type="button" className="btn btn-primary btn-small" disabled={saveMutation.isPending || !presenterUserId || (!talk && !customTitle.trim())} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? "Saving…" : "Save session"}
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>Cancel</button>
      </div>
    </section>
  );
}

function CredentialsPanel({ credentials, members, canManage, memberFilter, onMemberFilter, memberOptions, onChanged }: {
  credentials: MemberCredential[];
  members: { id: number; name: string }[];
  canManage: boolean;
  memberFilter: number | null;
  onMemberFilter: (id: number | null) => void;
  memberOptions: { id: number; name: string }[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<MemberCredential | "new" | null>(null);
  const [error, setError] = useState("");
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteMemberCredential({ id }),
    onSuccess: () => { setError(""); onChanged(); },
    onError: (e) => setError(cleanError(e)),
  });

  return (
    <section className="panel">
      <div className="link-status-row">
        <h2 className="panel-title">Team credentials</h2>
        {canManage ? (
          <button type="button" className="btn btn-primary btn-small" onClick={() => setEditing("new")}>Add credential</button>
        ) : null}
      </div>
      <div className="link-actions">
        <select className="stage-select" value={memberFilter ?? ""} onChange={(e) => onMemberFilter(e.target.value ? Number(e.target.value) : null)} aria-label="Filter credentials by member">
          <option value="">All team members</option>
          {memberOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
      {credentials.length === 0 ? <p className="muted">No credentials on file for this filter.</p> : null}
      {credentials.map((c) => (
        <div key={c.id} className="summary-row">
          <div className="link-status-row">
            <strong>{c.memberName} — {c.typeLabel}</strong>
            <span className={`status-pill ${BUCKET_PILL[c.bucket]}`}>
              {c.bucket === "no_expiry" ? "No expiry" : c.bucket === "expired" ? `Expired ${formatDate(c.expiresOn)}` : `Expires ${formatDate(c.expiresOn)}`}
            </span>
          </div>
          <p className="feed-meta">
            {c.number ? `# ${c.number} · ` : ""}
            {c.daysRemaining === null ? "No expiry date on file" : c.daysRemaining < 0 ? `${Math.abs(c.daysRemaining)} days past expiry` : `${c.daysRemaining} days remaining`}
            {c.attachmentUrl ? " · file attached" : ""}
          </p>
          {c.attachmentUrl ? (
            <p><a href={c.attachmentUrl} target="_blank" rel="noreferrer">{c.attachmentFilename || "View attachment"}</a></p>
          ) : null}
          {canManage ? (
            <div className="link-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setEditing(c)}>Edit</button>
              <button type="button" className="btn btn-danger-ghost btn-small" disabled={deleteMutation.isPending} onClick={() => { if (window.confirm("Delete this credential record?")) deleteMutation.mutate(c.id); }}>Delete</button>
            </div>
          ) : null}
        </div>
      ))}
      {editing !== null && canManage ? (
        <CredentialForm
          key={editing === "new" ? "new" : editing.id}
          existing={editing === "new" ? null : editing}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      ) : null}
    </section>
  );
}

function CredentialForm({ existing, members, onClose, onSaved }: {
  existing: MemberCredential | null;
  members: { id: number; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [userId, setUserId] = useState<number>(existing?.userId ?? members[0]?.id ?? 0);
  const [type, setType] = useState<MemberCredentialType>(existing?.type ?? "osha_10");
  const [customLabel, setCustomLabel] = useState(existing?.customLabel ?? "");
  const [number, setNumber] = useState(existing?.number ?? "");
  const [expiresOn, setExpiresOn] = useState(existing?.expiresOn ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [error, setError] = useState("");

  const saveMutation = useMutation({
    mutationFn: async () => {
      let attachment = { attachmentFilename: "", attachmentContentType: "", attachmentDataBase64: "" };
      if (file) {
        attachment = { attachmentFilename: file.name, attachmentContentType: file.type || "application/octet-stream", attachmentDataBase64: await fileToBase64(file) };
      }
      return api.saveMemberCredential({
        id: existing?.id ?? null,
        userId,
        type,
        customLabel: type === "custom" ? customLabel.trim() : "",
        number: number.trim(),
        expiresOn,
        removeAttachment,
        ...attachment,
      });
    },
    onSuccess: onSaved,
    onError: (e) => setError(cleanError(e)),
  });

  return (
    <div className="summary-row">
      <h3>{existing ? "Edit credential" : "Add credential"}</h3>
      <div className="link-actions">
        <select className="stage-select" value={userId} onChange={(e) => setUserId(Number(e.target.value))} aria-label="Team member">
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select className="stage-select" value={type} onChange={(e) => setType(e.target.value as MemberCredentialType)} aria-label="Credential type">
          {MEMBER_CREDENTIAL_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {type === "custom" ? (
          <input type="text" placeholder="Custom type name" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} aria-label="Custom type name" />
        ) : null}
      </div>
      <div className="link-actions">
        <input type="text" placeholder="Number (optional)" value={number} onChange={(e) => setNumber(e.target.value)} aria-label="Credential number" />
        <label className="muted small">Expires <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} aria-label="Expiry date" /></label>
        <label className="muted small">
          File/photo <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Credential file" />
        </label>
        {existing?.attachmentUrl && !file ? (
          <label className="muted small">
            <input type="checkbox" checked={removeAttachment} onChange={(e) => setRemoveAttachment(e.target.checked)} /> Remove current file
          </label>
        ) : null}
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="link-actions">
        <button type="button" className="btn btn-primary btn-small" disabled={saveMutation.isPending || !userId || (type === "custom" && !customLabel.trim())} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? "Saving…" : "Save credential"}
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
