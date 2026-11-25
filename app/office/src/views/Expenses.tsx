import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { cleanError, downloadBase64, fileToBase64, formatDate, formatMoney, parseMoney, todayIso } from "../utils";

/**
 * Expenses & receipts in Office (parity item 1). The phone's Business
 * Tools expenses tab, on the desktop: create/edit/delete business
 * expenses (saveBusinessExpense / deleteBusinessExpense over the same
 * getGrowthToolkit feed the phone reads), a per-job filter, the
 * accountant CSV export, and per-job receipt photos via addReceipt —
 * the same receipt records the phone scanner files. Before this view,
 * costs could only reach Office as Job Loads.
 */

type Toolkit = Awaited<ReturnType<typeof api.getGrowthToolkit>>;
type Expense = Toolkit["expenses"][number];

const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function ExpensesView({ canDelete, canExport }: { canDelete: boolean; canExport: boolean }) {
  const queryClient = useQueryClient();
  const toolkitQuery = useQuery({ queryKey: ["growth-toolkit"], queryFn: () => api.getGrowthToolkit({}) });
  const expenses = useMemo(() => toolkitQuery.data?.expenses ?? [], [toolkitQuery.data]);
  const jobs = toolkitQuery.data?.jobs ?? [];
  const [jobFilter, setJobFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Expense | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => expenses.filter((e) => {
    if (jobFilter === "general" && e.jobId !== null) return false;
    if (jobFilter !== "all" && jobFilter !== "general" && e.jobId !== Number(jobFilter)) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return [e.vendor, e.category, e.note, e.jobName ?? ""].some((s) => s.toLowerCase().includes(q));
    }
    return true;
  }), [expenses, jobFilter, search]);
  const filteredTotal = filtered.reduce((s, e) => s + parseMoney(e.amount), 0);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["growth-toolkit"] });
    void queryClient.invalidateQueries({ queryKey: ["job-operations"] });
    void queryClient.invalidateQueries({ queryKey: ["job-budget"] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteBusinessExpense({ id }),
    onSuccess: invalidate,
    onError: (e) => setError(cleanError(e)),
  });
  const exportMutation = useMutation({
    mutationFn: () => api.exportExpensesCsv({ period: "all" }),
    onSuccess: (res) => downloadBase64(res.dataBase64, res.filename, "text/csv"),
    onError: (e) => setError(cleanError(e)),
  });

  const selectedJobId = jobFilter !== "all" && jobFilter !== "general" ? Number(jobFilter) : null;

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Expenses &amp; receipts</h1>
          <p className="view-sub">
            {expenses.length} expenses · {formatMoney(toolkitQuery.data?.monthlyExpenses ?? 0)} this month.
          </p>
        </div>
        <div className="head-controls">
          {canExport ? (
            <button type="button" className="btn btn-ghost" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate()}>
              {exportMutation.isPending ? "Exporting…" : "Export CSV"}
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ Add expense</button>
        </div>
      </div>

      {error ? <p className="inline-error">{error}</p> : null}

      <section className="panel table-panel">
        <div className="table-tools">
          <div className="search-box">
            <input value={search} placeholder="Search vendor, category, note…" onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} aria-label="Filter by job">
            <option value="all">All jobs</option>
            <option value="general">General (no job)</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
          </select>
          <span className="feed-meta">Showing {filtered.length} · {formatMoney(filteredTotal)}</span>
        </div>
        {toolkitQuery.isLoading ? <div className="view-loading">Loading expenses…</div> : null}
        {toolkitQuery.isError ? <p className="inline-error">Couldn't load expenses.</p> : null}
        {!toolkitQuery.isLoading && filtered.length === 0 ? (
          <div className="empty-state"><p>No expenses match — add the first one with “+ Add expense”.</p></div>
        ) : null}
        {filtered.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Vendor</th><th>Category</th><th>Job</th><th>Note</th><th className="num">Amount</th><th /></tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.expenseDate)}</td>
                  <td>{e.vendor || "—"}</td>
                  <td>{e.category}</td>
                  <td>{e.jobName ?? "General"}</td>
                  <td>{e.note || "—"}</td>
                  <td className="num">{formatMoney(e.amount)}</td>
                  <td className="row-actions">
                    <button type="button" className="link-btn" onClick={() => { setEditing(e); setShowForm(true); }}>Edit</button>
                    {canDelete ? (
                      <button type="button" className="link-btn danger" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(e.id)}>Delete</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {selectedJobId !== null ? <JobReceiptsPanel jobId={selectedJobId} /> : (
        <p className="muted small">Receipt photos live on their job — pick a job in the filter above to see its receipts or add one.</p>
      )}

      {showForm ? (
        <ExpenseForm
          expense={editing}
          jobs={jobs}
          presetJobId={selectedJobId}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); invalidate(); }}
        />
      ) : null}
    </div>
  );
}

function ExpenseForm({
  expense, jobs, presetJobId, onClose, onSaved,
}: {
  expense: Expense | null;
  jobs: Toolkit["jobs"];
  presetJobId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [expenseDate, setExpenseDate] = useState(expense?.expenseDate ?? todayIso());
  const [vendor, setVendor] = useState(expense?.vendor ?? "");
  const [amount, setAmount] = useState(expense?.amount ?? "");
  const [category, setCategory] = useState(expense?.category ?? "Materials");
  const [jobId, setJobId] = useState<number | null>(expense?.jobId ?? presetJobId);
  const [note, setNote] = useState(expense?.note ?? "");
  const [error, setError] = useState("");

  const saveMutation = useMutation({
    mutationFn: () => api.saveBusinessExpense({
      id: expense?.id ?? null,
      expenseDate,
      vendor: vendor.trim(),
      amount: amount.trim(),
      category: category.trim(),
      jobId,
      supplierId: expense?.supplierId ?? null,
      note: note.trim(),
    }),
    onSuccess: onSaved,
    onError: (e) => setError(cleanError(e)),
  });

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={expense ? "Edit expense" : "Add expense"} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{expense ? "Edit expense" : "Add expense"}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="form-grid">
          <label className="field"><span>Date *</span><input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} /></label>
          <label className="field"><span>Amount *</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
          <label className="field"><span>Vendor</span><input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Home Depot, Shell…" /></label>
          <label className="field"><span>Category *</span>
            <input value={category} onChange={(e) => setCategory(e.target.value)} list="expense-categories" />
            <datalist id="expense-categories">
              {["Materials", "Fuel", "Tools", "Dump fees", "Permits", "Subcontractor", "Food", "Office", "Other"].map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <label className="field span2"><span>Job</span>
            <select value={jobId ?? ""} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">General (no job)</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
            </select>
          </label>
          <label className="field span2"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        {error ? <p className="inline-error">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!amount.trim() || !category.trim() || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "Saving…" : expense ? "Save changes" : "Add expense"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Receipt photos for one job — the receipts table the phone scanner
 *  and the app's receipt tool write to (addReceipt), listed from getJob. */
function JobReceiptsPanel({ jobId }: { jobId: number }) {
  const queryClient = useQueryClient();
  const jobQuery = useQuery({ queryKey: ["job", jobId], queryFn: () => api.getJob({ id: jobId }) });
  const receipts = jobQuery.data?.receipts ?? [];
  const [file, setFile] = useState<File | null>(null);
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a receipt photo first.");
      if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) throw new Error("Use a JPG, PNG or WebP photo.");
      if (file.size > 20_000_000) throw new Error("That photo is too large — pick one under 20 MB.");
      const dataBase64 = await fileToBase64(file);
      return api.addReceipt({
        jobId, vendor: vendor.trim(), amount: amount.trim(), purchaseDate, note: note.trim(),
        filename: file.name, contentType: file.type as (typeof RECEIPT_TYPES)[number], dataBase64,
      });
    },
    onSuccess: () => {
      setFile(null); setVendor(""); setAmount(""); setNote(""); setError("");
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["job-budget", jobId] });
    },
    onError: (e) => setError(cleanError(e)),
  });

  return (
    <section className="panel">
      <h3 className="panel-title">Receipts on this job ({receipts.length})</h3>
      {receipts.length === 0 ? <p className="muted">No receipt photos on this job yet.</p> : (
        <ul className="link-list">
          {receipts.map((r) => (
            <li key={r.id}>
              <a href={r.url} target="_blank" rel="noreferrer">
                <span>{r.vendor || r.filename}</span>
                <span className="feed-meta">{formatDate(r.purchaseDate)} · {formatMoney(r.amount)}{r.note ? ` · ${r.note}` : ""}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="sub-form">
        <h4 className="pair-title">Add a receipt photo</h4>
        <div className="form-grid">
          <label className="field"><span>Photo (JPG/PNG/WebP)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <label className="field"><span>Date</span><input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></label>
          <label className="field"><span>Vendor</span><input value={vendor} onChange={(e) => setVendor(e.target.value)} /></label>
          <label className="field"><span>Amount *</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
          <label className="field span2"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <button type="button" className="btn btn-primary btn-small" disabled={!file || !amount.trim() || addMutation.isPending} onClick={() => addMutation.mutate()}>
          {addMutation.isPending ? "Uploading…" : "Add receipt"}
        </button>
        {error ? <p className="inline-error">{error}</p> : null}
      </div>
    </section>
  );
}
