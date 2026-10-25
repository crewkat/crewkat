import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { SignaturePad } from "../components/SignaturePad";
import type { SignableDocument } from "../types";
import { cleanError, fileToBase64, formatMoney, parseMoney } from "../utils";

export type ContractEditorTarget =
  | { mode: "create"; kind: "contract" | "change_order"; presetJobId?: number | null }
  | { mode: "edit"; doc: SignableDocument };

/**
 * Contract / change-order create + edit — the phone's single saveDocument
 * flow on desktop: a job, a title, pasted text and/or an uploaded PDF, a
 * scope description, an amount, and the contractor's FRESH drawn
 * signature at creation (never a stored one). Edits go through
 * updateDocument, which never touches signature state; replacing the PDF
 * clears placed fields (server behavior, warned below).
 */
export function ContractEditor({
  target,
  userName,
  onClose,
  onSaved,
}: {
  target: ContractEditorTarget;
  userName: string;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = target.mode === "edit";
  const doc = target.mode === "edit" ? target.doc : null;
  const kind = target.mode === "edit" ? target.doc.kind : target.kind;

  const jobsQuery = useQuery({ queryKey: ["jobs", ""], queryFn: () => api.listJobs({ search: "" }), enabled: !isEdit });
  const jobs = useMemo(() => jobsQuery.data?.jobs ?? [], [jobsQuery.data]);

  const [jobId, setJobId] = useState<number | null>(target.mode === "create" ? (target.presetJobId ?? null) : target.doc.jobId);
  const [title, setTitle] = useState(doc?.title ?? "");
  const [description, setDescription] = useState(doc?.description ?? "");
  const [amount, setAmount] = useState(doc?.amount ?? "");
  const [bodyText, setBodyText] = useState(doc?.bodyText ?? "");
  const [signerName, setSignerName] = useState(doc?.signerName ?? userName);
  const [signature, setSignature] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  const heading = isEdit
    ? `Edit ${kind === "change_order" ? "change order" : "contract"}`
    : kind === "change_order" ? "New change order" : "New contract";

  const saveMutation = useMutation({
    mutationFn: async (): Promise<number> => {
      if (!title.trim()) throw new Error("Title is required — the first missing field is the title.");
      if (target.mode === "create") {
        if (!jobId) throw new Error("Pick the job this document belongs to.");
        if (!signerName.trim()) throw new Error("Signer name is required — the contractor signs at creation.");
        if (!signature) throw new Error("Draw the contractor signature — every document is signed fresh at creation.");
        const originalDataBase64 = file ? await fileToBase64(file) : "";
        const res = await api.saveDocument({
          jobId,
          kind,
          title: title.trim(),
          bodyText,
          originalFilename: file?.name ?? "",
          originalDataBase64,
          description,
          amount,
          signerName: signerName.trim(),
          signatureDataBase64: signature,
          signedAt: new Date().toISOString(),
        });
        return res.id;
      }
      const originalDataBase64 = file ? await fileToBase64(file) : undefined;
      await api.updateDocument({
        id: target.doc.id,
        title: title.trim(),
        bodyText,
        description,
        amount,
        ...(originalDataBase64 !== undefined ? { originalDataBase64, originalFilename: file?.name ?? "" } : {}),
      });
      return target.doc.id;
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      void queryClient.invalidateQueries({ queryKey: ["job"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      onSaved(id);
    },
    onError: (e) => setError(cleanError(e)),
  });

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label={heading} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{heading}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="form-grid">
          {!isEdit ? (
            <label className="field span2">
              <span>Job *</span>
              <select value={jobId ?? ""} onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Pick a job —</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.clientName || "Job"} · {j.jobType || "—"} · {j.jobAddress || "No address"}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field span2">
            <span>Title *</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "change_order" ? "Change order title" : "Contract title"} />
          </label>
          <label className="field span2">
            <span>{kind === "change_order" ? "Scope of the change" : "Description"}</span>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={kind === "change_order" ? "What changes — the first line becomes the change order's list title…" : "Short description of this document…"} />
          </label>
          <label className="field">
            <span>{kind === "change_order" ? "Change amount" : "Contract amount"}</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </label>
          <div className="field">
            <span>Amount preview</span>
            <p className="amount-preview">{amount.trim() ? formatMoney(parseMoney(amount)) : "—"}</p>
          </div>
        </div>

        <h3 className="editor-section-title">Document file</h3>
        {doc?.originalFilename ? (
          <p className="feed-meta">Current file: {doc.originalFilename}. Uploading a replacement clears any placed signature/fill fields.</p>
        ) : null}
        <label className="field">
          <span>{isEdit ? "Replace PDF (optional)" : "Upload a PDF (optional)"}</span>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {file ? <p className="feed-meta">{file.name} · {(file.size / 1024).toFixed(0)} KB</p> : null}

        <label className="field">
          <span>{file || doc?.originalFilename ? "Pasted text (optional — used when there's no PDF)" : "…or paste the document text"}</span>
          <textarea rows={7} value={bodyText} onChange={(e) => setBodyText(e.target.value)} placeholder="Paste the full document text here when you're not uploading a PDF." />
        </label>

        {!isEdit ? (
          <>
            <h3 className="editor-section-title">Contractor signature</h3>
            <label className="field">
              <span>Signer name *</span>
              <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Printed name of the signer" />
            </label>
            <SignaturePad onChange={setSignature} />
          </>
        ) : (
          <p className="feed-meta">Signed by {doc?.signerName} — signature state is never changed by an edit. Use “Sign / re-sign” on the document to draw a fresh signature.</p>
        )}

        {error ? <p className="inline-error">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : kind === "change_order" ? "Create change order" : "Create contract"}
          </button>
        </div>
      </div>
    </div>
  );
}
