import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Job, JobPhoto, PhotoStage } from "../types";
import { PHOTO_STAGE_LABELS } from "../types";
import { cleanError, downloadUrl, fileToBase64, formatDate, formatDateTime, formatMoney, parseMoney } from "../utils";
import type { DocSelection } from "./Documents";

export function JobsView({
  selectedJobId,
  onSelectJob,
  onOpenDocument,
  canDelete,
}: {
  selectedJobId: number | null;
  onSelectJob: (id: number | null) => void;
  onOpenDocument: (sel: DocSelection) => void;
  /** Deletes are Admin-only (Danny 2026-10-24); the server enforces, this only hides the buttons. */
  canDelete: boolean;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all");
  const searchTimer = useRef<number | undefined>(undefined);

  const jobsQuery = useQuery({
    queryKey: ["jobs", debounced],
    queryFn: () => api.listJobs({ search: debounced }),
  });
  const jobs = useMemo(() => jobsQuery.data?.jobs ?? [], [jobsQuery.data]);
  const filtered = useMemo(
    () => jobs.filter((j) => statusFilter === "all" || (statusFilter === "completed" ? !!j.completedAt : !j.completedAt)),
    [jobs, statusFilter],
  );
  const selected = jobs.find((j) => j.id === selectedJobId) ?? null;

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Jobs</h1>
          <p className="view-sub">{jobs.length} jobs · {jobs.filter((j) => !j.completedAt).length} active.</p>
        </div>
        <div className="head-controls">
          <div className="segmented" role="group" aria-label="Status filter">
            {(["all", "active", "completed"] as const).map((s) => (
              <button key={s} type="button" className={statusFilter === s ? "active" : ""} onClick={() => setStatusFilter(s)}>
                {s === "all" ? "All" : s === "active" ? "Active" : "Completed"}
              </button>
            ))}
          </div>
          <div className="search-box">
            <input
              value={search}
              placeholder="Search client, type, address…"
              onChange={(e) => {
                setSearch(e.target.value);
                window.clearTimeout(searchTimer.current);
                searchTimer.current = window.setTimeout(() => setDebounced(e.target.value), 250);
              }}
            />
          </div>
        </div>
      </div>

      <div className={selected ? "split-layout" : ""}>
        <section className="panel table-panel">
          {jobsQuery.isLoading ? <div className="view-loading">Loading jobs…</div> : null}
          {jobsQuery.isError ? (
            <div className="empty-state">
              <div className="empty-icon">◍</div>
              <p>Couldn't load jobs.</p>
              <button type="button" className="btn btn-primary" onClick={() => void jobsQuery.refetch()}>Try again</button>
            </div>
          ) : null}
          {!jobsQuery.isLoading && !jobsQuery.isError && filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🛠</div>
              <p>{debounced || statusFilter !== "all" ? "No jobs match this filter." : "No jobs yet — convert a lead from the Pipeline to create the first one."}</p>
            </div>
          ) : null}
          {filtered.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Address</th>
                  <th>Date</th>
                  <th className="num">Contract sum</th>
                  <th className="num">Amount due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((j) => (
                  <tr key={j.id} className={j.id === selectedJobId ? "selected" : ""} onClick={() => onSelectJob(j.id)}>
                    <td>{j.clientName || "—"}</td>
                    <td>{j.jobType || "—"}</td>
                    <td className="cell-address">{j.jobAddress || "—"}</td>
                    <td>{formatDate(j.jobDate)}</td>
                    <td className="num">{parseMoney(j.contractSum) > 0 ? formatMoney(j.contractSum) : "—"}</td>
                    <td className="num">{parseMoney(j.amountDue) > 0 ? <span className="overdue">{formatMoney(j.amountDue)}</span> : formatMoney(0)}</td>
                    <td><span className={`status-pill${j.completedAt ? " done" : ""}`}>{j.completedAt ? "Completed" : "Active"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>

        {selected ? <JobDetail jobId={selected.id} onClose={() => onSelectJob(null)} onOpenDocument={onOpenDocument} canDelete={canDelete} /> : null}
      </div>
    </div>
  );
}

function JobDetail({ jobId, onClose, onOpenDocument, canDelete }: { jobId: number; onClose: () => void; onOpenDocument: (sel: DocSelection) => void; canDelete: boolean }) {
  const detailQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.getJob({ id: jobId }),
  });
  const quotesQuery = useQuery({ queryKey: ["quotes"], queryFn: () => api.listQuotes({}) });
  const invoicesQuery = useQuery({ queryKey: ["invoices"], queryFn: () => api.listInvoices({}) });
  const data = detailQuery.data;
  const job: Job | null = data?.job ?? null;
  const jobQuotes = (quotesQuery.data?.quotes ?? []).filter((q) => q.jobId === jobId);
  const jobInvoices = (invoicesQuery.data?.invoices ?? []).filter((i) => i.jobId === jobId);

  return (
    <aside className="panel detail-panel">
      <div className="drawer-head">
        <div>
          <h2>{job ? (job.jobType || "Job") : "Job"}</h2>
          <span className="drawer-sub">{job ? `${job.clientName} · ${job.completedAt ? "Completed" : "Active"}` : ""}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {detailQuery.isLoading ? <p className="muted">Loading job…</p> : null}
      {detailQuery.isError ? <p className="inline-error">Couldn't load this job's detail.</p> : null}
      {data && !job ? <p className="muted">This job no longer exists.</p> : null}

      {job ? (
        <>
          <dl className="detail-list">
            <div><dt>Client</dt><dd>{job.clientName || "—"}</dd></div>
            <div><dt>Phone</dt><dd>{job.clientPhone || "—"}</dd></div>
            <div><dt>Email</dt><dd>{job.clientEmail || "—"}</dd></div>
            <div><dt>Address</dt><dd>{job.jobAddress || "—"}</dd></div>
            <div><dt>Job date</dt><dd>{formatDate(job.jobDate)}</dd></div>
            {job.appointmentAt ? <div><dt>Appointment</dt><dd>{formatDate(job.appointmentAt)}</dd></div> : null}
            {job.dueDate ? <div><dt>Due date</dt><dd>{formatDate(job.dueDate)}</dd></div> : null}
            {job.completedAt ? <div><dt>Completed</dt><dd>{formatDate(job.completedAt)}</dd></div> : null}
            {job.notes ? <div><dt>Notes</dt><dd>{job.notes}</dd></div> : null}
            {job.paymentNotes ? <div><dt>Payment notes</dt><dd>{job.paymentNotes}</dd></div> : null}
          </dl>

          <section className="drawer-section">
            <h3>Amounts</h3>
            <div className="mini-stats">
              <div><span>Contract sum</span><strong>{formatMoney(job.contractSum)}</strong></div>
              <div><span>Amount due</span><strong>{formatMoney(job.amountDue)}</strong></div>
              <div><span>Deposit</span><strong>{formatMoney(job.depositAmount)}</strong></div>
              <div><span>Photos</span><strong>{job.photoCount}</strong></div>
            </div>
            {data?.contractSummary ? (
              <dl className="detail-list compact">
                <div><dt>Base amount</dt><dd>{formatMoney(data.contractSummary.baseAmount)}</dd></div>
                <div><dt>Signed change orders</dt><dd>{formatMoney(data.contractSummary.signedChangeOrdersTotal)}</dd></div>
                <div><dt>Revised total</dt><dd>{formatMoney(data.contractSummary.revisedTotal)}</dd></div>
                {parseMoney(data.contractSummary.pendingChangeOrdersTotal) > 0 ? (
                  <div><dt>Pending change orders</dt><dd>{formatMoney(data.contractSummary.pendingChangeOrdersTotal)}</dd></div>
                ) : null}
              </dl>
            ) : null}
          </section>

          <JobPhotosSection jobId={job.id} photos={data?.photos ?? []} canDelete={canDelete} />

          <section className="drawer-section">
            <h3>Documents</h3>
            {(data?.documents.length ?? 0) + jobQuotes.length + jobInvoices.length === 0 ? (
              <p className="muted">No documents on this job yet — create one from the Documents section.</p>
            ) : (
              <ul className="link-list">
                {(data?.documents ?? []).map((doc) => (
                  <li key={`doc-${doc.id}`}>
                    <button type="button" onClick={() => onOpenDocument({ kind: doc.kind, id: doc.id })}>
                      <span>{doc.displayTitle || doc.title}</span>
                      <span className="feed-meta">
                        {doc.kind === "change_order" ? "Change order" : "Contract"} · {doc.clientSignedAt ? `Signed ${formatDate(doc.clientSignedAt)}` : "Awaiting client"} · {formatMoney(doc.amount)}
                      </span>
                    </button>
                  </li>
                ))}
                {jobInvoices.map((inv) => (
                  <li key={`inv-${inv.id}`}>
                    <button type="button" onClick={() => onOpenDocument({ kind: "invoice", id: inv.id })}>
                      <span>{inv.invoiceNumber}</span>
                      <span className="feed-meta">Invoice · {inv.status} · {formatMoney(inv.total)}</span>
                    </button>
                  </li>
                ))}
                {jobQuotes.map((q) => (
                  <li key={`quote-${q.id}`}>
                    <button type="button" onClick={() => onOpenDocument({ kind: "quote", id: q.id })}>
                      <span>Estimate #{q.id}{q.jobType ? ` — ${q.jobType}` : ""}</span>
                      <span className="feed-meta">Estimate · {q.accepted ? "Accepted" : q.sentAt ? "Sent" : "Draft"} · {formatMoney(q.total)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="drawer-section">
            <h3>Linked records</h3>

            <div className="mini-stats">
              <div><span>Documents</span><strong>{(data?.documents.length ?? 0) + jobQuotes.length + jobInvoices.length}</strong></div>
              <div><span>Files</span><strong>{data?.jobFiles.length ?? 0}</strong></div>
              <div><span>Punch items</span><strong>{data?.punchItems.length ?? 0}</strong></div>
              <div><span>Receipts</span><strong>{data?.receipts.length ?? 0}</strong></div>
              <div><span>Time entries</span><strong>{data?.timeEntries.length ?? 0}</strong></div>
              <div><span>Progress updates</span><strong>{data?.progressUpdates.length ?? 0}</strong></div>
            </div>
          </section>
        </>
      ) : null}
    </aside>
  );
}

/* ------------------------------ job photos (Track 1b) ------------------------------ */

interface SoloPhoto {
  url: string;
  caption: string;
  stage: string;
  filename: string;
}

const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

function JobPhotosSection({ jobId, photos, canDelete }: { jobId: number; photos: JobPhoto[]; canDelete: boolean }) {
  const queryClient = useQueryClient();
  const [stageFilter, setStageFilter] = useState<"all" | PhotoStage>("all");
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const [soloPhoto, setSoloPhoto] = useState<SoloPhoto | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [upStage, setUpStage] = useState<PhotoStage>("during");
  const [upCaption, setUpCaption] = useState("");
  const [error, setError] = useState("");
  const [beforeId, setBeforeId] = useState<number | null>(null);
  const [afterId, setAfterId] = useState<number | null>(null);
  const [pairLabel, setPairLabel] = useState("");

  const pairsQuery = useQuery({
    queryKey: ["photo-pairs", jobId],
    queryFn: () => api.listPhotoPairs({ jobId }),
  });
  const pairs = pairsQuery.data?.pairs ?? [];

  const filtered = stageFilter === "all" ? photos : photos.filter((p) => p.stage === stageFilter);
  const befores = photos.filter((p) => p.stage === "before");
  const afters = photos.filter((p) => p.stage === "after");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    void queryClient.invalidateQueries({ queryKey: ["photo-pairs", jobId] });
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a photo first.");
      if (!(PHOTO_CONTENT_TYPES as readonly string[]).includes(file.type)) {
        throw new Error("Use a JPG, PNG, WebP or GIF photo.");
      }
      if (file.size > 20_000_000) throw new Error("That photo is too large — pick one under 20 MB.");
      const dataBase64 = await fileToBase64(file);
      return api.addPhoto({
        jobId,
        stage: upStage,
        caption: upCaption.trim(),
        filename: file.name,
        contentType: file.type as (typeof PHOTO_CONTENT_TYPES)[number],
        capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
        dataBase64,
        annotatedFromId: null,
      });
    },
    onSuccess: () => { setFile(null); setUpCaption(""); setError(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const pairMutation = useMutation({
    mutationFn: () => api.createPhotoPair({ jobId, beforePhotoId: beforeId!, afterPhotoId: afterId!, label: pairLabel.trim() }),
    onSuccess: () => { setPairLabel(""); setError(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const unpairMutation = useMutation({
    mutationFn: (pairId: number) => api.deletePhotoPair({ id: pairId }),
    onSuccess: invalidate,
    onError: (e) => setError(cleanError(e)),
  });

  const galleryPhoto = galleryIndex != null ? filtered[galleryIndex] ?? null : null;

  return (
    <section className="drawer-section">
      <h3>Photos ({photos.length})</h3>
      {photos.length === 0 ? (
        <p className="muted">No photos on this job yet — add the first one below.</p>
      ) : (
        <>
          <div className="segmented photo-filter" role="group" aria-label="Photo stage filter">
            {(["all", "before", "during", "after"] as const).map((s) => (
              <button key={s} type="button" className={stageFilter === s ? "active" : ""} onClick={() => setStageFilter(s)}>
                {s === "all" ? `All (${photos.length})` : `${PHOTO_STAGE_LABELS[s]} (${photos.filter((p) => p.stage === s).length})`}
              </button>
            ))}
          </div>
          {filtered.length === 0 ? <p className="muted">No {stageFilter} photos yet.</p> : (
            <div className="photo-grid">
              {filtered.map((p, i) => (
                <button key={p.id} type="button" className="photo-thumb" onClick={() => setGalleryIndex(i)}>
                  <img src={p.url} alt={p.caption || PHOTO_STAGE_LABELS[p.stage]} loading="lazy" />
                  <span className="photo-thumb-meta">
                    <span className={`chip stage-${p.stage}`}>{PHOTO_STAGE_LABELS[p.stage]}</span>
                    {p.caption ? <span className="photo-thumb-caption">{p.caption}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {pairs.length > 0 ? (
        <div className="pair-list">
          <h4 className="pair-title">Before / After pairs</h4>
          {pairs.map((pair) => (
            <div key={pair.id} className="pair-card">
              <div className="pair-images">
                <button type="button" onClick={() => setSoloPhoto({ url: pair.before.url, caption: pair.before.caption, stage: "Before", filename: "" })}>
                  <img src={pair.before.url} alt={pair.before.caption || "Before"} loading="lazy" />
                  <span>Before</span>
                </button>
                <button type="button" onClick={() => setSoloPhoto({ url: pair.after.url, caption: pair.after.caption, stage: "After", filename: "" })}>
                  <img src={pair.after.url} alt={pair.after.caption || "After"} loading="lazy" />
                  <span>After</span>
                </button>
              </div>
              <div className="pair-meta">
                <span>{pair.label || "Before / After"}</span>
                {canDelete ? (
                  <button type="button" className="link-btn" disabled={unpairMutation.isPending} onClick={() => unpairMutation.mutate(pair.id)}>Unpair</button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {befores.length > 0 && afters.length > 0 ? (
        <div className="pair-create">
          <select value={beforeId ?? ""} onChange={(e) => setBeforeId(e.target.value ? Number(e.target.value) : null)} aria-label="Before photo">
            <option value="">Before photo…</option>
            {befores.map((p) => <option key={p.id} value={p.id}>{p.caption || p.filename}</option>)}
          </select>
          <select value={afterId ?? ""} onChange={(e) => setAfterId(e.target.value ? Number(e.target.value) : null)} aria-label="After photo">
            <option value="">After photo…</option>
            {afters.map((p) => <option key={p.id} value={p.id}>{p.caption || p.filename}</option>)}
          </select>
          <input value={pairLabel} onChange={(e) => setPairLabel(e.target.value)} placeholder="Label (optional)" aria-label="Pair label" />
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={!beforeId || !afterId || beforeId === afterId || pairMutation.isPending}
            onClick={() => pairMutation.mutate()}
          >
            {pairMutation.isPending ? "Pairing…" : "Create pair"}
          </button>
        </div>
      ) : null}

      <div className="photo-upload">
        <label className="field">
          <span>Add a photo from this computer</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="photo-upload-row">
          <select value={upStage} onChange={(e) => setUpStage(e.target.value as PhotoStage)} aria-label="Photo stage">
            {(["before", "during", "after"] as const).map((s) => <option key={s} value={s}>{PHOTO_STAGE_LABELS[s]}</option>)}
          </select>
          <input value={upCaption} onChange={(e) => setUpCaption(e.target.value)} placeholder="Caption (optional)" aria-label="Photo caption" />
          <button type="button" className="btn btn-primary btn-small" disabled={!file || uploadMutation.isPending} onClick={() => { setError(""); uploadMutation.mutate(); }}>
            {uploadMutation.isPending ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
      {error ? <p className="inline-error">{error}</p> : null}

      {galleryPhoto ? (
        <PhotoLightbox
          photo={{ url: galleryPhoto.url, caption: galleryPhoto.caption, stage: PHOTO_STAGE_LABELS[galleryPhoto.stage], filename: galleryPhoto.filename }}
          meta={`${galleryPhoto.filename} · ${formatDateTime(galleryPhoto.capturedAt)}`}
          onClose={() => setGalleryIndex(null)}
          onPrev={galleryIndex! > 0 ? () => setGalleryIndex(galleryIndex! - 1) : undefined}
          onNext={galleryIndex! < filtered.length - 1 ? () => setGalleryIndex(galleryIndex! + 1) : undefined}
        />
      ) : null}
      {soloPhoto ? (
        <PhotoLightbox photo={soloPhoto} onClose={() => setSoloPhoto(null)} />
      ) : null}
    </section>
  );
}

function PhotoLightbox({
  photo,
  meta,
  onClose,
  onPrev,
  onNext,
}: {
  photo: SoloPhoto;
  meta?: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return (
    <div className="modal-backdrop lightbox-backdrop" role="presentation" onClick={onClose}>
      <div className="lightbox" role="dialog" aria-modal="true" aria-label={photo.caption || "Job photo"} onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-head">
          <div>
            <strong>{photo.caption || photo.stage}</strong>
            {meta ? <span className="feed-meta block">{meta}</span> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <img className="lightbox-img" src={photo.url} alt={photo.caption || photo.stage} />
        <div className="lightbox-actions">
          {onPrev ? <button type="button" className="btn btn-ghost btn-small" onClick={onPrev}>‹ Prev</button> : null}
          {onNext ? <button type="button" className="btn btn-ghost btn-small" onClick={onNext}>Next ›</button> : null}
          <span className="appt-actions-spacer" />
          <button type="button" className="btn btn-primary btn-small" onClick={() => downloadUrl(photo.url, photo.filename || "crewkat-photo")}>
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
