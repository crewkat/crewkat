import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { formatDate } from "../utils";

// Wave 2 item 9: reputation inbox. Review requests come from the
// shared review record (automation + manual sends). Posted reviews
// are recorded by hand until the business's Google account is
// connected with Business Profile API access — the live feed and
// in-app replies land behind that connection; nothing is faked here.
type Inbox = Awaited<ReturnType<typeof api.getReputationInbox>>;
type RequestRow = Inbox["requests"][number];

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function stars(rating: number) {
  return "★★★★★".slice(0, rating) + "☆☆☆☆☆".slice(0, 5 - rating);
}

function RecordReviewForm({ request, onDone }: { request: RequestRow | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [clientName, setClientName] = useState(request?.clientName ?? "");
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [reviewDate, setReviewDate] = useState(todayKey());
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => api.recordPostedReview({
      jobId: request?.jobId ?? null,
      clientId: request?.clientId ?? null,
      clientName: clientName.trim(),
      rating,
      text: text.trim(),
      reviewDate,
      source: "manual",
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reputation-inbox"] });
      onDone();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save the review."),
  });
  return (
    <form className="promo-form" onSubmit={(e) => { e.preventDefault(); setError(""); save.mutate(); }}>
      <div className="form-grid">
        <label className="field">
          <span>Client</span>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name" required />
        </label>
        <label className="field">
          <span>Rating</span>
          <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{stars(n)} ({n})</option>)}
          </select>
        </label>
        <label className="field">
          <span>Review date</span>
          <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} required />
        </label>
      </div>
      <label className="field">
        <span>Review text (paste it exactly as posted)</span>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="“Great work, on time and tidy…”" />
      </label>
      {request ? <p className="muted small">Matched to: {request.jobTitle} — {request.clientName}. Recording this marks that review request as posted.</p> : null}
      {error ? <p className="status error">{error}</p> : null}
      <div className="settings-save-row">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save review"}</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export function ReputationView({ canDelete = false }: { canDelete?: boolean }) {
  const queryClient = useQueryClient();
  const inboxQuery = useQuery({ queryKey: ["reputation-inbox"], queryFn: () => api.getReputationInbox({}) });
  const [recording, setRecording] = useState<RequestRow | "new" | null>(null);
  const [error, setError] = useState("");
  const remove = useMutation({
    mutationFn: (id: number) => api.deletePostedReview({ id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["reputation-inbox"] }),
    onError: (e) => setError(e instanceof Error ? e.message : "Could not delete the review."),
  });
  const inbox = inboxQuery.data;
  const requests = inbox?.requests ?? [];
  const reviews = inbox?.reviews ?? [];
  const postedCount = requests.filter((r) => r.posted).length;

  return (
    <div className="view reputation-view">
      <div className="view-head">
        <div>
          <h1>Reputation</h1>
          <p className="view-sub">Every review request you've sent, and the reviews that came back. Requests go out automatically when a job completes (if the recipe is on) or by hand from the job panel.</p>
        </div>
        <div className="head-controls">
          <button type="button" className="btn btn-primary" onClick={() => setRecording("new")}>+ Record a review</button>
        </div>
      </div>

      {error ? <p className="status error">{error}</p> : null}

      <section className="panel">
        <div className="panel-head"><h2>Google reviews</h2><span className="chip">Not connected</span></div>
        <p className="muted">
          The live Google review feed — new reviews appearing here automatically, with replies from inside Crewkat — needs the business's
          Google account connected with Google Business Profile API access. That connection isn't in place yet, so for now reviews are
          recorded by hand below (paste the text from Google) and matched to the request that earned them. Nothing about your Google
          reviews is fetched or scraped in the meantime.
        </p>
      </section>

      {recording ? (
        <section className="panel">
          <div className="panel-head"><h2>{recording === "new" ? "Record a posted review" : "Record the review for this request"}</h2></div>
          <RecordReviewForm request={recording === "new" ? null : recording} onDone={() => setRecording(null)} />
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>Review requests</h2>
          {requests.length ? <span className="muted small">{`${postedCount} of ${requests.length} posted`}</span> : null}
        </div>
        {inboxQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {!inboxQuery.isLoading && requests.length === 0 ? (
          <p className="muted">No review requests yet. They appear here when a job completes or when you send one from the job's detail panel.</p>
        ) : null}
        {requests.length > 0 ? (
          <ul className="link-list static">
            {requests.map((r) => (
              <li key={r.logId}>
                <span>
                  <strong>{r.clientName || "Client"}</strong> · {r.jobTitle}
                  <span className="feed-meta">Requested {formatDate(r.sentAt.slice(0, 10))} · {r.stageTitle}</span>
                </span>
                {r.posted ? (
                  <span className="chip ok">★ Posted</span>
                ) : (
                  <button type="button" className="btn btn-small" onClick={() => setRecording(r)}>Record review</button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Posted reviews ({reviews.length})</h2></div>
        {reviews.length === 0 ? <p className="muted">No reviews recorded yet.</p> : null}
        {reviews.length > 0 ? (
          <ul className="link-list static">
            {reviews.map((r) => (
              <li key={r.id}>
                <span>
                  <strong>{stars(r.rating)}</strong> {r.clientName}
                  <span className="feed-meta">{formatDate(r.reviewDate)} · {r.source === "google" ? "Google" : "Recorded by hand"}</span>
                  {r.text ? <span className="review-text">“{r.text}”</span> : null}
                </span>
                {canDelete ? (
                  <button type="button" className="btn btn-small danger" disabled={remove.isPending} onClick={() => { setError(""); remove.mutate(r.id); }}>Delete</button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
