import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { cleanError, fileToBase64, formatDate, formatMoney } from "../utils";

const LOAD_KINDS = [
  { id: "debris_haul", label: "Debris haul" },
  { id: "concrete", label: "Concrete" },
  { id: "dirt", label: "Dirt" },
  { id: "delivery", label: "Material delivery" },
  { id: "other", label: "Other" },
] as const;
type LoadKind = (typeof LOAD_KINDS)[number]["id"];
const LOAD_UNITS = ["loads", "yards", "tons"] as const;
type LoadUnit = (typeof LOAD_UNITS)[number];

const kindLabel = (id: string) => LOAD_KINDS.find((k) => k.id === id)?.label ?? id;

/**
 * Job loads / dump-run log (0095) — the Office half of the phone's
 * Financials-tab Loads section. A costed load posts its cost into the
 * job's business_expenses (category "hauling") server-side, so the
 * Budget vs actual block above already includes it — mutations here
 * invalidate the job-budget query so that shows immediately. An empty
 * cost is a proof-only record. Attestation is the "logged by" form:
 * the logger's identity + timestamp + the confirm checkbox.
 */
export function JobLoadsPanel({ jobId }: { jobId: number }) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<LoadKind>("debris_haul");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState<LoadUnit>("loads");
  const [cost, setCost] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [attested, setAttested] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [error, setError] = useState("");

  const listQuery = useQuery({
    queryKey: ["job-loads", jobId],
    queryFn: () => api.listJobLoads({ jobId }),
  });
  const loads = listQuery.data?.loads ?? [];
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["job-loads", jobId] });
    // The load's cost lives in the job's expenses — refresh the budget
    // block so its Expenses / Costs figures move with the log.
    void queryClient.invalidateQueries({ queryKey: ["job-budget", jobId] });
    void queryClient.invalidateQueries({ queryKey: ["job-timeline", jobId] });
  };
  const resetForm = () => {
    setDate(today); setKind("debris_haul"); setQuantity("1"); setUnit("loads");
    setCost(""); setVendor(""); setNotes(""); setAttested(true);
    setFile(null); setEditingId(null); setHasPhoto(false); setRemovePhoto(false);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      let photo = { photoFilename: "", photoContentType: "" as "" | "image/jpeg" | "image/png" | "image/webp", photoDataBase64: "" };
      if (file) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use a JPG, PNG or WebP photo.");
        photo = { photoFilename: file.name, photoContentType: file.type as "image/jpeg" | "image/png" | "image/webp", photoDataBase64: await fileToBase64(file) };
      }
      const payload = { date, kind, quantity: quantity.trim() || "1", unit, cost: cost.trim(), vendor: vendor.trim(), notes: notes.trim(), attested, ...photo };
      return editingId
        ? api.updateJobLoad({ id: editingId, removePhoto, ...payload })
        : api.createJobLoad({ jobId, ...payload });
    },
    onSuccess: () => { setError(""); resetForm(); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteJobLoad({ id }),
    onSuccess: () => { setError(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });

  return (
    <section className="drawer-section">
      <h3>Loads / dump runs</h3>
      <p className="feed-meta block">
        Hauling logged against this job. A load with a cost posts into the job's expenses (hauling),
        so Budget vs actual above already includes it; leave the cost blank for a proof-only record.
      </p>
      {listQuery.data && loads.length > 0 ? (
        <p className="feed-meta block">
          <strong>{loads.length} load{loads.length === 1 ? "" : "s"} · {formatMoney(listQuery.data.totalCost)} total</strong>
          {" "}— in this job's expenses.
        </p>
      ) : null}
      {listQuery.isLoading ? <p className="muted">Loading loads…</p> : null}
      {!listQuery.isLoading && loads.length === 0 ? <p className="muted">No loads logged for this job yet.</p> : null}
      {loads.map((load) => (
        <div key={load.id} className="summary-row">
          <div className="link-status-row">
            <strong>{kindLabel(load.kind)} · {load.quantity} {load.unit}</strong>
            <span className={`status-pill ${load.cost ? "sent" : "draft"}`}>{load.cost ? formatMoney(load.cost) : "Proof only"}</span>
          </div>
          <p className="feed-meta">
            {formatDate(load.date)}
            {load.vendor ? ` · ${load.vendor}` : ""}
            {load.notes ? ` · ${load.notes}` : ""}
          </p>
          <p className="feed-meta">
            Logged by {load.loggedByName || "—"}{load.attested ? " · ✓ attested" : ""}
            {load.expenseId ? " · posted to job expenses" : ""}
          </p>
          {load.photoUrl ? <p><img src={load.photoUrl} alt={load.photoFilename || kindLabel(load.kind)} style={{ maxWidth: 180, borderRadius: 8 }} /></p> : null}
          <div className="link-actions">
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => {
                setEditingId(load.id); setHasPhoto(!!load.photoUrl); setRemovePhoto(false); setFile(null);
                setDate(load.date); setKind(load.kind); setQuantity(load.quantity); setUnit(load.unit);
                setCost(load.cost ?? ""); setVendor(load.vendor); setNotes(load.notes); setAttested(load.attested);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn-danger-ghost btn-small"
              disabled={deleteMutation.isPending}
              onClick={() => { if (window.confirm("Delete this load? Its job expense is removed too.")) deleteMutation.mutate(load.id); }}
            >
              Delete load
            </button>
          </div>
        </div>
      ))}
      <div className="link-actions">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Load date" />
        <select className="stage-select" value={kind} onChange={(e) => setKind(e.target.value as LoadKind)} aria-label="Load kind">
          {LOAD_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <input type="text" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Quantity" style={{ width: 70 }} />
        <select className="stage-select" value={unit} onChange={(e) => setUnit(e.target.value as LoadUnit)} aria-label="Unit">
          {LOAD_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div className="link-actions">
        <input type="text" inputMode="decimal" placeholder="Cost $ (blank = proof only)" value={cost} onChange={(e) => setCost(e.target.value)} aria-label="Cost" />
        <input type="text" placeholder="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor" />
        <input type="text" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
      </div>
      <div className="link-actions">
        <label className="muted small">
          Photo <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Load photo" />
        </label>
        {editingId && hasPhoto && !file ? (
          <label className="muted small">
            <input type="checkbox" checked={removePhoto} onChange={(e) => setRemovePhoto(e.target.checked)} /> Remove current photo
          </label>
        ) : null}
        <label className="muted small">
          <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} /> I confirm this load happened as logged
        </label>
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="link-actions">
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={saveMutation.isPending || !date || !quantity.trim()}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? "Saving…" : editingId ? "Save changes" : "Log load"}
        </button>
        {editingId ? (
          <button type="button" className="btn btn-ghost btn-small" onClick={resetForm}>Cancel edit</button>
        ) : null}
      </div>
    </section>
  );
}
