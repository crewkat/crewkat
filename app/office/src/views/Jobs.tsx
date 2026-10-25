import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Job } from "../types";
import { formatDate, formatMoney, parseMoney } from "../utils";
import type { DocSelection } from "./Documents";

export function JobsView({
  selectedJobId,
  onSelectJob,
  onOpenDocument,
}: {
  selectedJobId: number | null;
  onSelectJob: (id: number | null) => void;
  onOpenDocument: (sel: DocSelection) => void;
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

        {selected ? <JobDetail jobId={selected.id} onClose={() => onSelectJob(null)} onOpenDocument={onOpenDocument} /> : null}
      </div>
    </div>
  );
}

function JobDetail({ jobId, onClose, onOpenDocument }: { jobId: number; onClose: () => void; onOpenDocument: (sel: DocSelection) => void }) {
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
