import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import type { LineItem } from "../types";
import { cleanError, formatMoney, parseMoney } from "../utils";
import { FinancialEditor, type FinancialEditorTarget } from "./FinancialEditor";
import type { DocSelection } from "./Documents";

/**
 * Estimate templates in Office (parity item 9) — the desktop template
 * manager the Oct 27 expansion plan called for and never got. Same
 * store the phone's Business Tools templates tab reads
 * (getGrowthToolkit.templates / saveQuoteTemplate /
 * deleteQuoteTemplate), plus "Use template" opening the Office
 * estimate editor prefilled with the template's lines.
 */

type Toolkit = Awaited<ReturnType<typeof api.getGrowthToolkit>>;
type Template = Toolkit["templates"][number];

export function TemplatesView({ canDelete, onOpenDocument }: { canDelete: boolean; onOpenDocument: (sel: DocSelection) => void }) {
  const queryClient = useQueryClient();
  const toolkitQuery = useQuery({ queryKey: ["growth-toolkit"], queryFn: () => api.getGrowthToolkit({}) });
  const templates = toolkitQuery.data?.templates ?? [];
  const [editing, setEditing] = useState<Template | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editorTarget, setEditorTarget] = useState<FinancialEditorTarget | null>(null);
  const [error, setError] = useState("");

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteQuoteTemplate({ id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["growth-toolkit"] }),
    onError: (e) => setError(cleanError(e)),
  });

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Estimate templates</h1>
          <p className="view-sub">{templates.length} templates — start an estimate from one instead of retyping the standard lines.</p>
        </div>
        <div className="head-controls">
          <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ New template</button>
        </div>
      </div>

      {error ? <p className="inline-error">{error}</p> : null}
      {toolkitQuery.isLoading ? <div className="view-loading">Loading templates…</div> : null}
      {toolkitQuery.isError ? <p className="inline-error">Couldn't load templates.</p> : null}

      <div className="card-grid">
        {templates.map((t) => {
          const total = t.lineItems.reduce((s, i) => s + parseMoney(i.amount), 0);
          return (
            <section key={t.id} className="panel template-card">
              <div className="feed-row">
                <strong>{t.name}</strong>
                {t.isStarter ? <span className="status-pill draft">Starter</span> : null}
              </div>
              <ul className="template-lines">
                {t.lineItems.map((item, i) => (
                  <li key={i}><span>{item.description || "—"}</span><span>{item.amount ? formatMoney(item.amount) : ""}</span></li>
                ))}
              </ul>
              <p className="feed-meta">{t.lineItems.length} lines{total > 0 ? ` · ${formatMoney(total)}` : ""}</p>
              <div className="link-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={() => setEditorTarget({
                    mode: "create", kind: "quote",
                    presetItems: t.lineItems.map((i): LineItem => ({ name: "", description: i.description, amount: i.amount })),
                  })}
                >
                  Use template
                </button>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => { setEditing(t); setShowForm(true); }}>Edit</button>
                {canDelete ? (
                  <button type="button" className="btn btn-danger-ghost btn-small" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(t.id)}>Delete</button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
      {!toolkitQuery.isLoading && templates.length === 0 ? (
        <div className="empty-state"><p>No templates yet — create the first one.</p></div>
      ) : null}

      {showForm ? (
        <TemplateForm
          template={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); void queryClient.invalidateQueries({ queryKey: ["growth-toolkit"] }); }}
        />
      ) : null}

      {editorTarget ? (
        <FinancialEditor
          target={editorTarget}
          onClose={() => setEditorTarget(null)}
          onSaved={(kind, id) => { setEditorTarget(null); onOpenDocument({ kind, id }); }}
        />
      ) : null}
    </div>
  );
}

function TemplateForm({ template, onClose, onSaved }: { template: Template | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(template?.name ?? "");
  const [lines, setLines] = useState<Array<{ description: string; amount: string }>>(
    template && template.lineItems.length > 0 ? template.lineItems.map((i) => ({ description: i.description, amount: i.amount })) : [{ description: "", amount: "" }],
  );
  const [error, setError] = useState("");

  const saveMutation = useMutation({
    mutationFn: () => api.saveQuoteTemplate({
      id: template?.id ?? null,
      name: name.trim(),
      lineItems: lines
        .filter((l) => l.description.trim() || l.amount.trim())
        .map((l) => ({ name: "", description: l.description.trim(), amount: l.amount.trim() || "0" })),
    }),
    onSuccess: onSaved,
    onError: (e) => setError(cleanError(e)),
  });

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={template ? "Edit template" : "New template"} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{template ? "Edit template" : "New template"}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <label className="field">
          <span>Template name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard bathroom remodel" />
        </label>
        <h3 className="editor-section-title">Line items</h3>
        {lines.map((line, i) => (
          <div className="material-row" key={i}>
            <input value={line.description} placeholder="Description" onChange={(e) => setLines((prev) => prev.map((x, xi) => (xi === i ? { ...x, description: e.target.value } : x)))} />
            <input value={line.amount} placeholder="Amount" inputMode="decimal" onChange={(e) => setLines((prev) => prev.map((x, xi) => (xi === i ? { ...x, amount: e.target.value } : x)))} />
            <button type="button" className="icon-btn" disabled={lines.length <= 1} onClick={() => setLines((prev) => prev.filter((_, xi) => xi !== i))} aria-label="Remove line">✕</button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setLines((prev) => [...prev, { description: "", amount: "" }])}>+ Add line</button>
        {error ? <p className="inline-error">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim() || !lines.some((l) => l.description.trim()) || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Saving…" : template ? "Save changes" : "Create template"}
          </button>
        </div>
      </div>
    </div>
  );
}
