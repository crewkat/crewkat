import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import type { DocKind } from "../types";
import { cleanError, formatDate, formatDateTime } from "../utils";

/**
 * Client-link panel for one document — the same link truth the phone
 * shows (createDocumentLink / getDocumentLinkInfo / revokeDocumentLink):
 * not sent → sent (awaiting) → opened (view count + first viewed), with
 * the /d/<shortCode> URL the phone builds. For contracts and change
 * orders the signed state comes from the document itself
 * (clientSignedAt), passed in by the caller.
 */
export function DocumentLinkPanel({
  kind,
  id,
  clientSignedAt,
}: {
  kind: DocKind;
  id: number;
  clientSignedAt?: string | null;
}) {
  const queryClient = useQueryClient();
  const [freshUrl, setFreshUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const linkQuery = useQuery({
    queryKey: ["doc-link", kind, id],
    queryFn: () => api.getDocumentLinkInfo({ kind, id }),
  });
  const link = linkQuery.data?.link ?? null;
  const url = freshUrl || (link?.shortCode ? `${window.location.origin}/d/${link.shortCode}` : "");

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["doc-link", kind, id] });

  const createMutation = useMutation({
    mutationFn: () => api.createDocumentLink({ kind, id }),
    onSuccess: (res) => {
      setFreshUrl(`${window.location.origin}/d/${res.shortCode}`);
      setError("");
      invalidate();
    },
    onError: (e) => setError(cleanError(e)),
  });
  const revokeMutation = useMutation({
    mutationFn: () => api.revokeDocumentLink({ kind, id }),
    onSuccess: () => { setFreshUrl(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable — the URL is visible to copy by hand */ }
  };

  const status = clientSignedAt
    ? { label: "Signed by client", cls: "signed" }
    : !link && !freshUrl
      ? { label: "Not sent", cls: "draft" }
      : link?.expired
        ? { label: "Link expired", cls: "overdue" }
        : link && link.viewCount > 0
          ? { label: `Opened · ${link.viewCount} view${link.viewCount === 1 ? "" : "s"}`, cls: "viewed" }
          : { label: "Sent · awaiting open", cls: "sent" };

  return (
    <section className="drawer-section">
      <h3>Client link</h3>
      <div className="link-status-row">
        <span className={`status-pill ${status.cls}`}>{status.label}</span>
        {link?.firstViewedAt ? <span className="feed-meta">First opened {formatDateTime(link.firstViewedAt)}</span> : null}
      </div>
      {link ? (
        <p className="feed-meta link-meta">
          Expires {formatDate(link.expiresAt)}
          {link.lastViewedAt ? ` · last opened ${formatDateTime(link.lastViewedAt)}` : ""}
        </p>
      ) : null}
      {url ? (
        <div className="link-url-row">
          <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Client link URL" />
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void copy()}>{copied ? "Copied ✓" : "Copy"}</button>
          <a className="btn btn-ghost btn-small" href={url} target="_blank" rel="noreferrer">Open</a>
        </div>
      ) : null}
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="link-actions">
        {!link && !freshUrl ? (
          <button type="button" className="btn btn-primary btn-small" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? "Creating…" : "Create client link"}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost btn-small" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Creating…" : "New link"}
            </button>
            <button type="button" className="btn btn-danger-ghost btn-small" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate()}>
              Revoke link
            </button>
          </>
        )}
      </div>
      <p className="feed-meta">The client opens this page to view{kind === "contract" || kind === "change_order" || kind === "quote" ? " and sign" : ""} the document. Previously shared links stay valid until revoked or expired.</p>
    </section>
  );
}

/**
 * Job portal link — the client's single record link (contract, invoices,
 * receipts, photos). Same actions the phone uses
 * (getPortalLinkInfo / createPortalLink / rotatePortalLink /
 * revokePortalLink); URL form is <origin>/p/<shortCode>.
 */
export function PortalLinkPanel({ jobId }: { jobId: number }) {
  const queryClient = useQueryClient();
  const [freshUrl, setFreshUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const linkQuery = useQuery({
    queryKey: ["portal-link", jobId],
    queryFn: () => api.getPortalLinkInfo({ jobId }),
  });
  const link = linkQuery.data?.link ?? null;
  const url = freshUrl || (link?.shortCode ? `${window.location.origin}/p/${link.shortCode}` : "");

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["portal-link", jobId] });

  const createMutation = useMutation({
    mutationFn: () => api.createPortalLink({ jobId, expiresInDays: 90 }),
    onSuccess: (res) => { setFreshUrl(`${window.location.origin}/${res.route}`); setError(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const rotateMutation = useMutation({
    mutationFn: () => api.rotatePortalLink({ jobId, expiresInDays: 90 }),
    onSuccess: (res) => { setFreshUrl(`${window.location.origin}/${res.route}`); setError(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const revokeMutation = useMutation({
    mutationFn: () => api.revokePortalLink({ jobId }),
    onSuccess: () => { setFreshUrl(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <section className="drawer-section">
      <h3>Job portal link</h3>
      <div className="link-status-row">
        <span className={`status-pill ${link ? (link.viewCount > 0 ? "viewed" : "sent") : "draft"}`}>
          {!link && !freshUrl ? "Not sent" : link && link.viewCount > 0 ? `Opened · ${link.viewCount} view${link.viewCount === 1 ? "" : "s"}` : "Sent · awaiting open"}
        </span>
        {link?.expiresAt ? <span className="feed-meta">Expires {formatDate(link.expiresAt)}</span> : link ? <span className="feed-meta">No expiry</span> : null}
      </div>
      {url ? (
        <div className="link-url-row">
          <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Portal link URL" />
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void copy()}>{copied ? "Copied ✓" : "Copy"}</button>
          <a className="btn btn-ghost btn-small" href={url} target="_blank" rel="noreferrer">Open</a>
        </div>
      ) : null}
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="link-actions">
        {!link && !freshUrl ? (
          <button type="button" className="btn btn-primary btn-small" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? "Creating…" : "Create portal link"}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost btn-small" disabled={rotateMutation.isPending} onClick={() => rotateMutation.mutate()}>
              {rotateMutation.isPending ? "Rotating…" : "Rotate link"}
            </button>
            <button type="button" className="btn btn-danger-ghost btn-small" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate()}>
              Revoke link
            </button>
          </>
        )}
      </div>
      <p className="feed-meta">One link for this job's contract, invoices, receipts and progress photos.</p>
    </section>
  );
}
