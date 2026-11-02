import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { cleanError, formatDate } from "../utils";

type Preset = "today" | "this_week" | "custom";

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "this_week", label: "This week" },
  { id: "custom", label: "Custom range" },
];

function presetLabel(preset: string): string {
  return PRESETS.find((p) => p.id === preset)?.label ?? "Custom range";
}

/**
 * Work summaries (0094) — the Office half of the phone's job-view
 * action: create a frozen client-ready summary for a date range and
 * share it through the same document-link family the phone uses
 * (createDocumentLink / revokeDocumentLink with kind "work_summary";
 * the URL is the shared /d/<shortCode> form). The summary content is a
 * snapshot — later log/photo edits never change what the client sees.
 */
export function WorkSummaryPanel({ jobId }: { jobId: number }) {
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<Preset>("this_week");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const listQuery = useQuery({
    queryKey: ["work-summaries", jobId],
    queryFn: () => api.listWorkSummaries({ jobId }),
  });
  const summaries = listQuery.data?.summaries ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["work-summaries", jobId] });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createWorkSummary({
        jobId,
        preset,
        rangeStart: preset === "custom" ? rangeStart : "",
        rangeEnd: preset === "custom" ? rangeEnd : "",
        narrative: "",
        polishedWithAi: false,
      }),
    onSuccess: () => { setError(""); invalidate(); void queryClient.invalidateQueries({ queryKey: ["job-timeline", jobId] }); },
    onError: (e) => setError(cleanError(e)),
  });

  // Draft & polish (0098): assemble the narrative from the period's
  // logs/notes, optionally polish it with AI (same facts, cleaner
  // prose — the pre-polish text stays one tap away), edit freely,
  // then create. The frozen snapshot stores the final text plus a
  // polishedWithAi flag. The one-click Create summary above is
  // unchanged and never involves the draft flow.
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftRange, setDraftRange] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [prePolish, setPrePolish] = useState<string | null>(null);
  const [draftPolished, setDraftPolished] = useState(false);
  const aiAvailabilityQuery = useQuery({ queryKey: ["ai-availability"], queryFn: () => api.getAiAvailability({}), enabled: draftOpen });
  const aiAvailability = aiAvailabilityQuery.data;
  const previewMutation = useMutation({
    mutationFn: () =>
      api.previewWorkSummary({
        jobId,
        preset,
        rangeStart: preset === "custom" ? rangeStart : "",
        rangeEnd: preset === "custom" ? rangeEnd : "",
      }),
    onSuccess: (res) => {
      setDraftText(res.narrative);
      setDraftRange({ start: res.content.rangeStart, end: res.content.rangeEnd });
      setPrePolish(null);
      setDraftPolished(false);
      setDraftOpen(true);
      setError("");
    },
    onError: (e) => setError(cleanError(e)),
  });
  const polishMutation = useMutation({
    mutationFn: () => api.polishWorkSummary({ jobId, text: draftText, lang: "en", rangeStart: draftRange.start, rangeEnd: draftRange.end }),
    onSuccess: (res) => {
      setPrePolish(draftText);
      setDraftText(res.text);
      setDraftPolished(true);
      setError("");
      void queryClient.invalidateQueries({ queryKey: ["ai-availability"] });
    },
    onError: (e) => setError(cleanError(e)),
  });
  const createDraftMutation = useMutation({
    mutationFn: () =>
      api.createWorkSummary({
        jobId,
        preset,
        rangeStart: preset === "custom" ? rangeStart : "",
        rangeEnd: preset === "custom" ? rangeEnd : "",
        narrative: draftText,
        polishedWithAi: draftPolished,
      }),
    onSuccess: () => {
      setError("");
      setDraftOpen(false);
      setDraftText("");
      setPrePolish(null);
      setDraftPolished(false);
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["job-timeline", jobId] });
    },
    onError: (e) => setError(cleanError(e)),
  });
  const shareMutation = useMutation({
    mutationFn: (id: number) => api.createDocumentLink({ kind: "work_summary", id }),
    onSuccess: () => { setError(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const revokeMutation = useMutation({
    mutationFn: (id: number) => api.revokeDocumentLink({ kind: "work_summary", id }),
    onSuccess: () => invalidate(),
    onError: (e) => setError(cleanError(e)),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteWorkSummary({ id }),
    onSuccess: () => invalidate(),
    onError: (e) => setError(cleanError(e)),
  });

  const copy = async (id: number, shortCode: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/d/${shortCode}`);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch { /* clipboard unavailable — the URL is visible to copy by hand */ }
  };

  return (
    <section className="drawer-section">
      <h3>Work summary</h3>
      <p className="feed-meta block">
        A client-ready snapshot of this job's daily logs, notes and photos for a period. It's saved exactly
        as created — later edits don't change what the client sees.
      </p>
      <div className="link-actions">
        <select
          className="stage-select"
          value={preset}
          onChange={(e) => setPreset(e.target.value as Preset)}
          aria-label="Summary date range"
        >
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {preset === "custom" ? (
          <>
            <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} aria-label="Range start" />
            <input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} aria-label="Range end" />
          </>
        ) : null}
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={createMutation.isPending || (preset === "custom" && (!rangeStart || !rangeEnd))}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? "Creating…" : "Create summary"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={previewMutation.isPending || (preset === "custom" && (!rangeStart || !rangeEnd))}
          onClick={() => previewMutation.mutate()}
        >
          {previewMutation.isPending ? "Drafting…" : "Draft & polish"}
        </button>
      </div>
      {draftOpen ? (
        <div className="summary-draft">
          <label className="field">
            <span>Summary text — assembled from this period's daily logs and notes. Edit freely; this exact text is what gets saved.</span>
            <textarea rows={9} value={draftText} onChange={(e) => setDraftText(e.target.value)} aria-label="Work summary draft text" />
          </label>
          <div className="link-actions">
            {aiAvailability && !aiAvailability.configured ? (
              <span className="muted small">✨ Polish with AI isn't set up on this Crewkat server yet.</span>
            ) : aiAvailability && !aiAvailability.entitled ? (
              <span className="muted small">✨ Polish with AI is a Crewkat Premium / Office feature.</span>
            ) : aiAvailability && aiAvailability.usedThisMonth >= aiAvailability.monthlyCap ? (
              <span className="muted small">✨ This month's AI writing limit is reached ({aiAvailability.usedThisMonth} of {aiAvailability.monthlyCap}).</span>
            ) : (
              <button type="button" className="btn btn-ghost btn-small" disabled={polishMutation.isPending || draftText.trim().length === 0} onClick={() => polishMutation.mutate()}>
                {polishMutation.isPending ? "Polishing…" : "✨ Polish with AI"}
              </button>
            )}
            {prePolish !== null ? (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => { setDraftText(prePolish); setPrePolish(null); setDraftPolished(false); }}
              >
                Revert to my text
              </button>
            ) : null}
            {draftPolished ? <span className="muted small">Polished with AI — same facts, cleaner prose.</span> : null}
          </div>
          <div className="link-actions">
            <button type="button" className="btn btn-primary btn-small" disabled={createDraftMutation.isPending} onClick={() => createDraftMutation.mutate()}>
              {createDraftMutation.isPending ? "Creating…" : "Create summary from draft"}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setDraftOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="inline-error">{error}</p> : null}
      {listQuery.isLoading ? <p className="muted">Loading summaries…</p> : null}
      {!listQuery.isLoading && summaries.length === 0 ? <p className="muted">No summaries for this job yet.</p> : null}
      {summaries.map((s) => (
        <div key={s.id} className="summary-row">
          <div className="link-status-row">
            <strong>{formatDate(s.rangeStart)} – {formatDate(s.rangeEnd)}</strong>
            <span className={`status-pill ${s.link ? (s.link.viewCount > 0 ? "viewed" : "sent") : "draft"}`}>
              {!s.link ? "Not shared" : s.link.viewCount > 0 ? `Opened · ${s.link.viewCount} view${s.link.viewCount === 1 ? "" : "s"}` : "Sent · awaiting open"}
            </span>
          </div>
          <p className="feed-meta">
            {presetLabel(s.preset)} · {s.logCount} log{s.logCount === 1 ? "" : "s"} · {s.photoCount} photo{s.photoCount === 1 ? "" : "s"} · {s.loadCount} load{s.loadCount === 1 ? "" : "s"}
            {` · created ${formatDate(s.createdAt)}`}
            {s.link ? ` · link expires ${formatDate(s.link.expiresAt)}` : ""}
          </p>
          {s.link?.shortCode ? (
            <div className="link-url-row">
              <input readOnly value={`${window.location.origin}/d/${s.link.shortCode}`} onFocus={(e) => e.target.select()} aria-label="Work summary link URL" />
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void copy(s.id, s.link!.shortCode!)}>{copiedId === s.id ? "Copied ✓" : "Copy"}</button>
              <a className="btn btn-ghost btn-small" href={`${window.location.origin}/d/${s.link.shortCode}`} target="_blank" rel="noreferrer">Open</a>
            </div>
          ) : null}
          <div className="link-actions">
            {!s.link ? (
              <button type="button" className="btn btn-primary btn-small" disabled={shareMutation.isPending} onClick={() => shareMutation.mutate(s.id)}>
                {shareMutation.isPending ? "Creating link…" : "Share link"}
              </button>
            ) : (
              <button type="button" className="btn btn-danger-ghost btn-small" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate(s.id)}>
                Revoke link
              </button>
            )}
            <button type="button" className="btn btn-danger-ghost btn-small" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(s.id)}>
              Delete summary
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
