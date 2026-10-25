import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { DocumentLinkPanel, PortalLinkPanel } from "../components/LinkPanel";
import { SignaturePad } from "../components/SignaturePad";
import type { DocKind, Invoice, Job, Quote, SignableDocument } from "../types";
import { DOC_KIND_LABELS } from "../types";
import { cleanError, downloadBase64, financialTotals, formatDate, formatDateTime, formatMoney, lineTotal, parseMoney, todayIso } from "../utils";
import { ContractEditor, type ContractEditorTarget } from "./ContractEditor";
import { FinancialEditor, type FinancialEditorTarget } from "./FinancialEditor";
import { PlacementEditor } from "./PlacementEditor";

export interface DocSelection {
  kind: DocKind;
  id: number;
}

type StatusGroup = "draft" | "sent" | "viewed" | "signed" | "accepted" | "paid" | "overdue" | "closed";

interface DocRow {
  key: string;
  kind: DocKind;
  id: number;
  title: string;
  clientName: string;
  clientId: number | null;
  jobId: number | null;
  jobLabel: string;
  amount: string;
  amountMeta: string;
  date: string;
  statusLabel: string;
  statusCls: string;
  statusGroup: StatusGroup;
  searchText: string;
}

const STATUS_FILTERS: { value: "" | StatusGroup; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft / not sent" },
  { value: "sent", label: "Sent" },
  { value: "viewed", label: "Opened" },
  { value: "signed", label: "Signed" },
  { value: "accepted", label: "Accepted" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "closed", label: "Superseded / lost / invoiced" },
];

function quoteStatus(q: Quote): { label: string; cls: string; group: StatusGroup } {
  if (q.superseded) return { label: "Superseded", cls: "draft", group: "closed" };
  if (q.accepted) return { label: "Accepted", cls: "signed", group: "accepted" };
  if (q.automationStatus === "lost") return { label: "Lost", cls: "overdue", group: "closed" };
  if (q.convertedToInvoiceId) return { label: "Invoiced", cls: "viewed", group: "closed" };
  if (q.automationStatus === "won") return { label: "Won", cls: "signed", group: "accepted" };
  if (q.sentAt) return { label: "Sent", cls: "sent", group: "sent" };
  return { label: "Draft", cls: "draft", group: "draft" };
}

function invoiceStatus(inv: Invoice): { label: string; cls: string; group: StatusGroup } {
  if (inv.status === "paid") return { label: "Paid", cls: "signed", group: "paid" };
  const overdue = inv.status === "overdue" || (inv.status === "sent" && inv.dueDate && inv.dueDate < todayIso() && parseMoney(inv.balanceRemaining) > 0);
  if (overdue) return { label: "Overdue", cls: "overdue", group: "overdue" };
  if (inv.status === "sent") return { label: parseMoney(inv.paidToDate) > 0 ? "Sent · part paid" : "Sent", cls: "sent", group: "sent" };
  return { label: "Draft", cls: "draft", group: "draft" };
}

function signableStatus(d: SignableDocument): { label: string; cls: string; group: StatusGroup } {
  if (d.clientSignedAt) return { label: "Signed", cls: "signed", group: "signed" };
  if (d.linkView?.firstViewedAt) return { label: "Opened", cls: "viewed", group: "viewed" };
  if (d.linkView) return { label: "Awaiting", cls: "sent", group: "sent" };
  return { label: "Not sent", cls: "draft", group: "draft" };
}

export function DocumentsView({
  selected,
  onSelect,
  onOpenJob,
  onOpenClient,
  userName,
  canDelete,
}: {
  selected: DocSelection | null;
  onSelect: (sel: DocSelection | null) => void;
  onOpenJob: (jobId: number) => void;
  onOpenClient: (clientId: number) => void;
  userName: string;
  /** Deletes are Admin-only (Danny 2026-10-24); the server enforces, this only hides the buttons. */
  canDelete: boolean;
}) {
  const [kindFilter, setKindFilter] = useState<"" | DocKind>("");
  const [statusFilter, setStatusFilter] = useState<"" | StatusGroup>("");
  const [search, setSearch] = useState("");
  const [financialTarget, setFinancialTarget] = useState<FinancialEditorTarget | null>(null);
  const [contractTarget, setContractTarget] = useState<ContractEditorTarget | null>(null);

  const quotesQuery = useQuery({ queryKey: ["quotes"], queryFn: () => api.listQuotes({}) });
  const invoicesQuery = useQuery({ queryKey: ["invoices"], queryFn: () => api.listInvoices({}) });
  const docsQuery = useQuery({ queryKey: ["documents"], queryFn: () => api.listDocuments({}) });
  const jobsQuery = useQuery({ queryKey: ["jobs", ""], queryFn: () => api.listJobs({ search: "" }) });

  const quotes = useMemo(() => quotesQuery.data?.quotes ?? [], [quotesQuery.data]);
  const invoices = useMemo(() => invoicesQuery.data?.invoices ?? [], [invoicesQuery.data]);
  const signables = useMemo(() => docsQuery.data?.documents ?? [], [docsQuery.data]);
  const jobs = useMemo(() => jobsQuery.data?.jobs ?? [], [jobsQuery.data]);
  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);
  const jobLabel = (jobId: number | null) => {
    if (!jobId) return "—";
    const j = jobById.get(jobId);
    return j ? `${j.clientName || "Job"} · ${j.jobType || "—"}` : `Job #${jobId}`;
  };

  const rows = useMemo<DocRow[]>(() => {
    const out: DocRow[] = [];
    for (const q of quotes) {
      const s = quoteStatus(q);
      out.push({
        key: `quote-${q.id}`, kind: "quote", id: q.id,
        title: `Estimate #${q.id}${q.jobType ? ` — ${q.jobType}` : ""}`,
        clientName: q.clientName, clientId: q.clientId, jobId: q.jobId, jobLabel: jobLabel(q.jobId),
        amount: q.total, amountMeta: q.accepted ? "Accepted" : q.superseded ? `v${q.versionNumber} · superseded` : `v${q.versionNumber}`,
        date: q.createdAt, statusLabel: s.label, statusCls: s.cls, statusGroup: s.group,
        searchText: `${q.clientName} ${q.jobType} ${q.jobAddress} estimate ${q.id}`,
      });
    }
    for (const inv of invoices) {
      const s = invoiceStatus(inv);
      out.push({
        key: `invoice-${inv.id}`, kind: "invoice", id: inv.id,
        title: inv.invoiceNumber,
        clientName: inv.clientName, clientId: inv.clientId, jobId: inv.jobId, jobLabel: jobLabel(inv.jobId),
        amount: inv.total, amountMeta: parseMoney(inv.balanceRemaining) > 0 && inv.status !== "draft" ? `Balance ${formatMoney(inv.balanceRemaining)}` : inv.dueDate ? `Due ${formatDate(inv.dueDate)}` : "",
        date: inv.issueDate || inv.createdAt, statusLabel: s.label, statusCls: s.cls, statusGroup: s.group,
        searchText: `${inv.clientName} ${inv.invoiceNumber} ${inv.jobType} ${inv.jobAddress} invoice`,
      });
    }
    for (const d of signables) {
      const s = signableStatus(d);
      out.push({
        key: `${d.kind}-${d.id}`, kind: d.kind, id: d.id,
        title: d.displayTitle || d.title,
        clientName: jobById.get(d.jobId)?.clientName ?? "", clientId: jobById.get(d.jobId)?.clientId ?? null,
        jobId: d.jobId, jobLabel: jobLabel(d.jobId),
        amount: d.amount, amountMeta: d.kind === "change_order" && d.newContractSum ? `New sum ${formatMoney(d.newContractSum)}` : "",
        date: d.signedAt, statusLabel: s.label, statusCls: s.cls, statusGroup: s.group,
        searchText: `${d.title} ${d.displayTitle} ${jobById.get(d.jobId)?.clientName ?? ""} ${d.kind}`,
      });
    }
    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, invoices, signables, jobById]);

  const filtered = rows.filter((r) =>
    (!kindFilter || r.kind === kindFilter) &&
    (!statusFilter || r.statusGroup === statusFilter) &&
    (!search.trim() || r.searchText.toLowerCase().includes(search.trim().toLowerCase())),
  );

  const loading = quotesQuery.isLoading || invoicesQuery.isLoading || docsQuery.isLoading;
  const loadError = quotesQuery.isError || invoicesQuery.isError || docsQuery.isError;

  const openFinancial = (kind: "quote" | "invoice", id: number) => {
    onSelect({ kind, id });
    setFinancialTarget(null);
  };
  const openContract = (kind: "contract" | "change_order", id: number) => {
    onSelect({ kind, id });
    setContractTarget(null);
  };

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Documents</h1>
          <p className="view-sub">{rows.length} documents — the same records the phone app works with.</p>
        </div>
        <div className="head-controls">
          <button type="button" className="btn btn-primary" onClick={() => setFinancialTarget({ mode: "create", kind: "quote" })}>+ New estimate</button>
          <button type="button" className="btn btn-primary" onClick={() => setFinancialTarget({ mode: "create", kind: "invoice" })}>+ New invoice</button>
          <button type="button" className="btn btn-ghost" onClick={() => setContractTarget({ mode: "create", kind: "contract" })}>+ New contract</button>
          <button type="button" className="btn btn-ghost" onClick={() => setContractTarget({ mode: "create", kind: "change_order" })}>+ Change order</button>
        </div>
      </div>

      <div className="doc-filter-row">
        <div className="segmented" role="group" aria-label="Type filter">
          {(["", "quote", "invoice", "contract", "change_order"] as const).map((k) => (
            <button key={k || "all"} type="button" className={kindFilter === k ? "active" : ""} onClick={() => setKindFilter(k)}>
              {k === "" ? "All" : `${DOC_KIND_LABELS[k]}s`}
            </button>
          ))}
        </div>
        <select className="doc-status-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | StatusGroup)} aria-label="Status filter">
          {STATUS_FILTERS.map((s) => <option key={s.label} value={s.value}>{s.label}</option>)}
        </select>
        <div className="search-box">
          <input value={search} placeholder="Search client, title, number…" onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className={selected ? "split-layout doc-split" : ""}>
        <section className="panel table-panel">
          {loading ? <div className="view-loading">Loading documents…</div> : null}
          {loadError ? (
            <div className="empty-state">
              <div className="empty-icon">◍</div>
              <p>Couldn't load documents.</p>
              <button type="button" className="btn btn-primary" onClick={() => { void quotesQuery.refetch(); void invoicesQuery.refetch(); void docsQuery.refetch(); }}>Try again</button>
            </div>
          ) : null}
          {!loading && !loadError && filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📄</div>
              <p>{rows.length === 0 ? "No documents yet — create the first estimate or invoice." : "No documents match this filter."}</p>
            </div>
          ) : null}
          {filtered.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Document</th>
                  <th>Client</th>
                  <th>Job</th>
                  <th>Date</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.key} className={selected && selected.kind === r.kind && selected.id === r.id ? "selected" : ""} onClick={() => onSelect({ kind: r.kind, id: r.id })}>
                    <td><span className={`doc-kind kind-${r.kind}`}>{DOC_KIND_LABELS[r.kind]}</span></td>
                    <td>
                      <span className="doc-title-cell">{r.title}</span>
                      {r.amountMeta ? <span className="feed-meta block">{r.amountMeta}</span> : null}
                    </td>
                    <td>{r.clientName || "—"}</td>
                    <td className="cell-address">{r.jobLabel}</td>
                    <td>{formatDate(r.date)}</td>
                    <td className="num">{parseMoney(r.amount) > 0 ? formatMoney(r.amount) : "—"}</td>
                    <td><span className={`status-pill ${r.statusCls}`}>{r.statusLabel}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>

        {selected ? (
          <DocDetail
            key={`${selected.kind}-${selected.id}`}
            selection={selected}
            quotes={quotes}
            invoices={invoices}
            signables={signables}
            jobById={jobById}
            jobs={jobs}
            onClose={() => onSelect(null)}
            onOpenJob={onOpenJob}
            onOpenClient={onOpenClient}
            onEditFinancial={(t) => setFinancialTarget(t)}
            onEditContract={(t) => setContractTarget(t)}
            onSelect={onSelect}
            canDelete={canDelete}
          />
        ) : null}
      </div>

      {financialTarget ? (
        <FinancialEditor
          target={financialTarget}
          onClose={() => setFinancialTarget(null)}
          onSaved={(k, id) => openFinancial(k, id)}
        />
      ) : null}
      {contractTarget ? (
        <ContractEditor
          target={contractTarget}
          userName={userName}
          onClose={() => setContractTarget(null)}
          onSaved={(id) => openContract(contractTarget.mode === "edit" ? contractTarget.doc.kind : contractTarget.kind, id)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------ detail panel ------------------------------ */

function DocDetail({
  selection,
  quotes,
  invoices,
  signables,
  jobById,
  jobs,
  onClose,
  onOpenJob,
  onOpenClient,
  onEditFinancial,
  onEditContract,
  onSelect,
  canDelete,
}: {
  selection: DocSelection;
  quotes: Quote[];
  invoices: Invoice[];
  signables: SignableDocument[];
  jobById: Map<number, Job>;
  jobs: Job[];
  onClose: () => void;
  onOpenJob: (jobId: number) => void;
  onOpenClient: (clientId: number) => void;
  onEditFinancial: (t: FinancialEditorTarget) => void;
  onEditContract: (t: ContractEditorTarget) => void;
  onSelect: (sel: DocSelection | null) => void;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState("");
  const [signing, setSigning] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["quotes"] });
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    void queryClient.invalidateQueries({ queryKey: ["documents"] });
    void queryClient.invalidateQueries({ queryKey: ["office-dashboard"] });
  };

  const quote = selection.kind === "quote" ? quotes.find((q) => q.id === selection.id) : undefined;
  const invoice = selection.kind === "invoice" ? invoices.find((i) => i.id === selection.id) : undefined;
  const signable = selection.kind === "contract" || selection.kind === "change_order"
    ? signables.find((d) => d.id === selection.id)
    : undefined;

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (selection.kind === "quote") await api.deleteQuote({ id: selection.id });
      else if (selection.kind === "invoice") await api.deleteInvoice({ id: selection.id });
      else await api.deleteDocument({ id: selection.id });
    },
    onSuccess: () => { invalidateAll(); onSelect(null); },
    onError: (e) => setActionError(cleanError(e)),
  });
  const duplicateMutation = useMutation({
    mutationFn: async () => {
      if (selection.kind === "quote") return api.duplicateQuote({ id: selection.id });
      if (selection.kind === "invoice") return api.duplicateInvoice({ id: selection.id });
      throw new Error("Contracts and change orders can't be duplicated.");
    },
    onSuccess: (res) => { invalidateAll(); onSelect({ kind: selection.kind, id: res.id }); },
    onError: (e) => setActionError(cleanError(e)),
  });
  const convertMutation = useMutation({
    mutationFn: () => api.convertQuoteToInvoice({ quoteId: selection.id, today: todayIso() }),
    onSuccess: (res) => { invalidateAll(); onSelect({ kind: "invoice", id: res.invoiceId }); },
    onError: (e) => setActionError(cleanError(e)),
  });
  const paidMutation = useMutation({
    mutationFn: (paid: boolean) => api.toggleInvoicePaid({ id: selection.id, paid, today: todayIso() }),
    onSuccess: invalidateAll,
    onError: (e) => setActionError(cleanError(e)),
  });

  const heading = quote
    ? `Estimate #${quote.id}`
    : invoice
      ? `Invoice ${invoice.invoiceNumber}`
      : signable
        ? (signable.displayTitle || signable.title)
        : "Document";

  return (
    <aside className="panel detail-panel">
      <div className="drawer-head">
        <div>
          <h2>{heading}</h2>
          <span className="drawer-sub">{DOC_KIND_LABELS[selection.kind]}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {!quote && !invoice && !signable ? <p className="muted">This document no longer exists.</p> : null}

      {quote ? (
        <>
          <QuoteSummary quote={quote} onOpenJob={onOpenJob} onOpenClient={onOpenClient} jobById={jobById} />
          <LineItemsTable doc={quote} />
          <TotalsBlock doc={quote} />
          {quote.optionSelection.accepted ? (
            <section className="drawer-section">
              <h3>Client-selected options</h3>
              <p className="muted">Accepted {formatDate(quote.optionSelection.accepted.acceptedAt)} · options {formatMoney(quote.optionSelection.accepted.optionsTotal)} · total with options {formatMoney(quote.optionSelection.accepted.totalWithOptions)}</p>
            </section>
          ) : null}
          {quote.materials.length > 0 ? (
            <section className="drawer-section">
              <h3>Materials ({quote.materials.length})</h3>
              <ul className="link-list static">
                {quote.materials.map((m, i) => (
                  <li key={i}><span>{m.name}</span><span className="feed-meta">{[m.qty, m.unit].filter(Boolean).join(" ")}{m.checked ? " · on hand" : ""}</span></li>
                ))}
              </ul>
            </section>
          ) : null}
          <DocumentLinkPanel kind="quote" id={quote.id} />
        </>
      ) : null}

      {invoice ? (
        <>
          <InvoiceSummary invoice={invoice} onOpenJob={onOpenJob} onOpenClient={onOpenClient} />
          <LineItemsTable doc={invoice} />
          <TotalsBlock doc={invoice} extra={{ paid: invoice.paidToDate, balance: invoice.balanceRemaining, lateFee: invoice.lateFeeAccrued }} />
          <PaymentsSection invoice={invoice} onError={setActionError} canDelete={canDelete} />
          <DocumentLinkPanel kind="invoice" id={invoice.id} />
          {invoice.jobId ? <PortalLinkPanel jobId={invoice.jobId} /> : <InvoiceJobLinker invoice={invoice} jobs={jobs} onError={setActionError} />}
        </>
      ) : null}

      {signable ? (
        <>
          <dl className="detail-list">
            <div><dt>Job</dt><dd>{signable.jobId ? <button type="button" className="link-btn" onClick={() => onOpenJob(signable.jobId)}>{jobById.get(signable.jobId)?.clientName || "Job"} · {jobById.get(signable.jobId)?.jobType || ""}</button> : "—"}</dd></div>
            {signable.kind === "change_order" ? (
              <>
                <div><dt>Contract sum before</dt><dd>{signable.contractSumBefore ? formatMoney(signable.contractSumBefore) : "—"}</dd></div>
                <div><dt>This change</dt><dd>{formatMoney(signable.amount)}</dd></div>
                <div><dt>New contract sum</dt><dd>{signable.newContractSum ? formatMoney(signable.newContractSum) : "—"}</dd></div>
              </>
            ) : (
              <div><dt>Amount</dt><dd>{parseMoney(signable.amount) > 0 ? formatMoney(signable.amount) : "—"}</dd></div>
            )}
            <div><dt>Contractor</dt><dd>{signable.signerName} · signed {formatDate(signable.signedAt)}</dd></div>
            <div><dt>Client</dt><dd>{signable.clientSignedAt ? `${signable.clientSignerName} · signed ${formatDate(signable.clientSignedAt)}` : "Not signed yet"}</dd></div>
            {signable.originalFilename ? <div><dt>File</dt><dd>{signable.originalFilename}</dd></div> : null}
            {signable.description ? <div><dt>{signable.kind === "change_order" ? "Scope" : "Description"}</dt><dd>{signable.description}</dd></div> : null}
          </dl>
          {signable.bodyText ? (
            <section className="drawer-section">
              <h3>Document text</h3>
              <pre className="doc-body-text">{signable.bodyText}</pre>
            </section>
          ) : null}
          <div className="link-actions doc-actions">
            <button type="button" className="btn btn-primary btn-small" disabled={downloading} onClick={async () => {
              setDownloading(true);
              setActionError("");
              try {
                const res = await api.getDocumentPdf({ documentId: signable.id });
                downloadBase64(res.pdfBase64, res.filename);
              } catch (e) { setActionError(cleanError(e)); } finally { setDownloading(false); }
            }}>
              {downloading ? "Preparing…" : "Download PDF"}
            </button>
            {signable.originalUrl ? (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPlacing(true)}>Place fields</button>
            ) : null}
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setSigning(true)}>
              {signable.clientSignedAt ? "Re-sign as contractor" : "Sign as contractor"}
            </button>
          </div>
          <DocumentLinkPanel kind={signable.kind} id={signable.id} clientSignedAt={signable.clientSignedAt} />
          <PortalLinkPanel jobId={signable.jobId} />
        </>
      ) : null}

      {actionError ? <p className="inline-error">{actionError}</p> : null}

      {(quote || invoice || signable) ? (
        <section className="drawer-section">
          <h3>Actions</h3>
          <div className="link-actions">
            {quote ? (
              <>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => onEditFinancial({ mode: "edit", kind: "quote", doc: quote })}>Edit</button>
                {!quote.convertedToInvoiceId ? (
                  <button type="button" className="btn btn-ghost btn-small" disabled={convertMutation.isPending} onClick={() => convertMutation.mutate()}>Convert to invoice</button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => onSelect({ kind: "invoice", id: quote.convertedToInvoiceId! })}>Open invoice</button>
                )}
                <button type="button" className="btn btn-ghost btn-small" disabled={duplicateMutation.isPending} onClick={() => duplicateMutation.mutate()}>Duplicate</button>
              </>
            ) : null}
            {invoice ? (
              <>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => onEditFinancial({ mode: "edit", kind: "invoice", doc: invoice })}>Edit</button>
                {invoice.status !== "paid" ? (
                  <button type="button" className="btn btn-ghost btn-small" disabled={paidMutation.isPending} onClick={() => paidMutation.mutate(true)}>Mark paid</button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-small" disabled={paidMutation.isPending} onClick={() => paidMutation.mutate(false)}>Mark unpaid</button>
                )}
                <button type="button" className="btn btn-ghost btn-small" disabled={duplicateMutation.isPending} onClick={() => duplicateMutation.mutate()}>Duplicate</button>
              </>
            ) : null}
            {signable ? (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => onEditContract({ mode: "edit", doc: signable })}>Edit</button>
            ) : null}
            {canDelete ? (
              !confirmDelete ? (
                <button type="button" className="btn btn-danger-ghost btn-small" onClick={() => setConfirmDelete(true)}>Delete</button>
              ) : (
                <>
                  <span className="feed-meta">Delete this document?</span>
                  <button type="button" className="btn btn-danger-ghost btn-small" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
                    {deleteMutation.isPending ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmDelete(false)}>Keep</button>
                </>
              )
            ) : null}
          </div>
        </section>
      ) : null}

      {signing && signable ? (
        <SignModal
          doc={signable}
          onClose={() => setSigning(false)}
          onDone={() => { setSigning(false); invalidateAll(); }}
        />
      ) : null}
      {placing && signable ? (
        <PlacementEditor
          doc={signable}
          onClose={() => setPlacing(false)}
          onSaved={() => { setPlacing(false); invalidateAll(); }}
        />
      ) : null}
    </aside>
  );
}

function QuoteSummary({ quote, onOpenJob, onOpenClient, jobById }: { quote: Quote; onOpenJob: (id: number) => void; onOpenClient: (id: number) => void; jobById: Map<number, Job> }) {
  return (
    <dl className="detail-list">
      <div><dt>Client</dt><dd>{quote.clientId ? <button type="button" className="link-btn" onClick={() => onOpenClient(quote.clientId!)}>{quote.clientName}</button> : quote.clientName}</dd></div>
      {quote.jobId ? <div><dt>Job</dt><dd><button type="button" className="link-btn" onClick={() => onOpenJob(quote.jobId!)}>{jobById.get(quote.jobId)?.jobType || "Job"} · {quote.jobAddress}</button></dd></div> : null}
      {quote.jobAddress ? <div><dt>Address</dt><dd>{quote.jobAddress}</dd></div> : null}
      <div><dt>Created</dt><dd>{formatDate(quote.createdAt)}</dd></div>
      {quote.expiryDate ? <div><dt>Valid until</dt><dd>{formatDate(quote.expiryDate)}</dd></div> : null}
      {quote.sentAt ? <div><dt>Sent</dt><dd>{formatDate(quote.sentAt)}</dd></div> : null}
      <div><dt>Version</dt><dd>{quote.versionNumber}{quote.superseded ? " · superseded" : ""}</dd></div>
    </dl>
  );
}

function InvoiceSummary({ invoice, onOpenJob, onOpenClient }: { invoice: Invoice; onOpenJob: (id: number) => void; onOpenClient: (id: number) => void }) {
  return (
    <dl className="detail-list">
      <div><dt>Client</dt><dd>{invoice.clientId ? <button type="button" className="link-btn" onClick={() => onOpenClient(invoice.clientId!)}>{invoice.clientName}</button> : invoice.clientName}</dd></div>
      {invoice.jobId ? <div><dt>Job</dt><dd><button type="button" className="link-btn" onClick={() => onOpenJob(invoice.jobId!)}>Open job</button></dd></div> : null}
      {invoice.jobAddress ? <div><dt>Address</dt><dd>{invoice.jobAddress}</dd></div> : null}
      <div><dt>Issued</dt><dd>{invoice.issueDate ? formatDate(invoice.issueDate) : "—"}</dd></div>
      <div><dt>Due</dt><dd>{invoice.dueDate ? formatDate(invoice.dueDate) : "—"}</dd></div>
      {invoice.quoteId ? <div><dt>From estimate</dt><dd>Estimate #{invoice.quoteId}</dd></div> : null}
    </dl>
  );
}

function LineItemsTable({ doc }: { doc: Quote | Invoice }) {
  if (doc.lineItems.length === 0) return null;
  return (
    <section className="drawer-section">
      <h3>Line items</h3>
      <ul className="link-list static">
        {doc.lineItems.map((item, i) => (
          <li key={i}>
            <span>{[item.name, item.description].filter(Boolean).join(" — ") || "Line item"}{item.optional ? <span className="chip">Optional</span> : null}</span>
            <span className="feed-meta">
              {(item.quantity ?? 1) !== 1 ? `${item.quantity} × ${formatMoney(item.amount)} · ` : ""}{formatMoney(lineTotal(item))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TotalsBlock({ doc, extra }: { doc: Quote | Invoice; extra?: { paid: string; balance: string; lateFee: string } }) {
  const totals = financialTotals(doc.lineItems, doc.discountType, doc.discountValue, doc.taxType, doc.taxValue);
  return (
    <section className="drawer-section">
      <h3>Totals</h3>
      <dl className="detail-list compact">
        <div><dt>Subtotal</dt><dd>{formatMoney(doc.subtotal)}</dd></div>
        {doc.showDiscountLine && totals.discount > 0 ? <div><dt>Discount ({doc.discountType === "percent" ? `${doc.discountValue}%` : "fixed"})</dt><dd>−{formatMoney(totals.discount)}</dd></div> : null}
        {doc.showTaxLine && totals.tax > 0 ? <div><dt>Tax ({doc.taxType === "percent" ? `${doc.taxValue}%` : "fixed"})</dt><dd>{formatMoney(totals.tax)}</dd></div> : null}
        <div><dt>Total</dt><dd><strong>{formatMoney(doc.total)}</strong></dd></div>
        {extra ? (
          <>
            <div><dt>Paid to date</dt><dd>{formatMoney(extra.paid)}</dd></div>
            {parseMoney(extra.lateFee) > 0 ? <div><dt>Late fee accrued</dt><dd>{formatMoney(extra.lateFee)}</dd></div> : null}
            <div><dt>Balance remaining</dt><dd><strong>{formatMoney(extra.balance)}</strong></dd></div>
          </>
        ) : null}
      </dl>
      {doc.footnote ? <p className="muted">{doc.footnote}</p> : null}
    </section>
  );
}

function PaymentsSection({ invoice, onError, canDelete }: { invoice: Invoice; onError: (msg: string) => void; canDelete: boolean }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["invoices"] });
  const addMutation = useMutation({
    mutationFn: () => api.addPayment({ invoiceId: invoice.id, amount, paymentDate: date, method, note }),
    onSuccess: () => { setAmount(""); setMethod(""); setNote(""); invalidate(); },
    onError: (e) => onError(cleanError(e)),
  });
  const deleteMutation = useMutation({
    mutationFn: (paymentId: number) => api.deletePayment({ id: paymentId }),
    onSuccess: invalidate,
    onError: (e) => onError(cleanError(e)),
  });

  return (
    <section className="drawer-section">
      <h3>Payments ({invoice.payments.length})</h3>
      {invoice.payments.length === 0 ? <p className="muted">No payments recorded yet.</p> : (
        <ul className="link-list static">
          {invoice.payments.map((p) => (
            <li key={p.id}>
              <span>{formatMoney(p.amount)} · {formatDate(p.paymentDate)}{p.method ? ` · ${p.method}` : ""}</span>
              <span className="feed-meta">
                {p.note && p.note !== "__paid_toggle__" ? `${p.note} · ` : ""}{formatDateTime(p.createdAt)}{canDelete ? (
                  <> <button type="button" className="link-btn" onClick={() => deleteMutation.mutate(p.id)}>Remove</button></>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="payment-add">
        <input inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Payment amount" />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Payment date" />
        <input placeholder="Method (Zelle, check…)" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment method" />
        <input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Payment note" />
        <button type="button" className="btn btn-primary btn-small" disabled={!amount.trim() || addMutation.isPending} onClick={() => addMutation.mutate()}>
          {addMutation.isPending ? "Adding…" : "Add payment"}
        </button>
      </div>
    </section>
  );
}

function InvoiceJobLinker({ invoice, jobs, onError }: { invoice: Invoice; jobs: Job[]; onError: (msg: string) => void }) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<number | null>(null);
  const linkMutation = useMutation({
    mutationFn: () => api.linkInvoiceToJob({ invoiceId: invoice.id, jobId: jobId! }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["invoices"] }),
    onError: (e) => onError(cleanError(e)),
  });
  return (
    <section className="drawer-section">
      <h3>Job</h3>
      <p className="muted">This invoice isn't linked to a job yet.</p>
      <div className="link-actions">
        <select value={jobId ?? ""} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : null)} aria-label="Pick a job">
          <option value="">— Pick a job —</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.clientName || "Job"} · {j.jobType || "—"}</option>)}
        </select>
        <button type="button" className="btn btn-ghost btn-small" disabled={!jobId || linkMutation.isPending} onClick={() => linkMutation.mutate()}>Link to job</button>
      </div>
    </section>
  );
}

function SignModal({ doc, onClose, onDone }: { doc: SignableDocument; onClose: () => void; onDone: () => void }) {
  const [signature, setSignature] = useState("");
  const [signerName, setSignerName] = useState(doc.signerName);
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.signDocumentWithDrawnSignature({ documentId: doc.id, signatureDataBase64: signature, signerName: signerName.trim() || undefined }),
    onSuccess: onDone,
    onError: (e) => setError(cleanError(e)),
  });
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Sign as contractor" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Sign as contractor</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="muted">Draw a fresh signature — it replaces the contractor signature and re-stamps the document, exactly like signing on the phone.</p>
        <label className="field">
          <span>Signer name</span>
          <input value={signerName} onChange={(e) => setSignerName(e.target.value)} />
        </label>
        <SignaturePad onChange={setSignature} />
        {error ? <p className="inline-error">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!signature || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Signing…" : "Sign document"}
          </button>
        </div>
      </div>
    </div>
  );
}
