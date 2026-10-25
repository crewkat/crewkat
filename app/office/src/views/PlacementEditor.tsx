import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { FillField, SignatureFieldKey, SignatureFields, SignaturePlacement, SignableDocument } from "../types";
import { cleanError } from "../utils";

/* Defaults mirror the phone placement editor (client/src/App.tsx +
   signatureComposite.ts): signature boxes 30% × 7.5%, date boxes
   22% × 5%, fill sizes per kind. Saving goes through the same
   saveDocumentSignatureFields / saveDocumentFillFields actions, so the
   canonical PDF is rebuilt by the same server code. */

const SIG_TABS: { key: SignatureFieldKey; label: string }[] = [
  { key: "clientSignature", label: "Client signature" },
  { key: "clientDate", label: "Client date" },
  { key: "contractorSignature", label: "Your signature" },
  { key: "contractorDate", label: "Your date" },
];

const SIG_DEFAULTS: Record<"signature" | "date", { wPct: number; hPct: number }> = {
  signature: { wPct: 0.3, hPct: 0.075 },
  date: { wPct: 0.22, hPct: 0.05 },
};

const FILL_SIZES: Record<FillField["kind"], { wPct: number; hPct: number }> = {
  text: { wPct: 0.34, hPct: 0.045 },
  initials: { wPct: 0.16, hPct: 0.045 },
  checkbox: { wPct: 0.05, hPct: 0.035 },
};

const FILL_LABELS: Record<FillField["kind"], string> = {
  text: "Text field",
  initials: "Initials",
  checkbox: "Checkbox",
};

function clampBox<T extends SignaturePlacement>(f: T): T {
  return { ...f, xPct: Math.min(Math.max(0, f.xPct), 1 - f.wPct), yPct: Math.min(Math.max(0, f.yPct), 1 - f.hPct) };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? (reader.result.split(",")[1] ?? "") : "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the PDF."));
    reader.readAsDataURL(blob);
  });
}

type DragState =
  | { type: "sig"; key: SignatureFieldKey; pageIndex: number; dx: number; dy: number }
  | { type: "fill"; id: string; pageIndex: number; dx: number; dy: number };

export function PlacementEditor({
  doc,
  onClose,
  onSaved,
}: {
  doc: SignableDocument;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pages, setPages] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [fields, setFields] = useState<SignatureFields>(doc.signatureFields ?? {});
  const [fillFields, setFillFields] = useState<FillField[]>(doc.fillFields ?? []);
  const [active, setActive] = useState<SignatureFieldKey>("clientSignature");
  const [selectedFillId, setSelectedFillId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const drag = useRef<DragState | null>(null);
  const pressStart = useRef<{ pageIndex: number; x: number; y: number } | null>(null);
  const fillCounter = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!doc.originalUrl) throw new Error("This document has no uploaded PDF.");
        const url = new URL(doc.originalUrl, window.location.origin);
        const res = await fetch(`${url.pathname}${url.search}`);
        if (!res.ok) throw new Error("fetch failed");
        const blob = await res.blob();
        const dataBase64 = await blobToBase64(blob);
        const result = await api.renderPdfPreview({ dataBase64 });
        if (!cancelled) setPages(result.pagesBase64);
      } catch {
        if (!cancelled) setLoadError("The document couldn't be loaded for placement.");
      }
    })();
    return () => { cancelled = true; };
  }, [doc.originalUrl]);

  const pctFromEvent = (e: React.PointerEvent, pageIndex: number) => {
    const el = pageRefs.current[pageIndex];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const isDateKey = (key: SignatureFieldKey) => key === "clientDate" || key === "contractorDate";

  const placeSigAt = (pageIndex: number, x: number, y: number) => {
    const size = isDateKey(active) ? SIG_DEFAULTS.date : SIG_DEFAULTS.signature;
    const current = fields[active];
    const wPct = current?.wPct ?? size.wPct;
    const hPct = current?.hPct ?? size.hPct;
    setFields((prev) => ({ ...prev, [active]: clampBox({ page: pageIndex + 1, xPct: x - wPct / 2, yPct: y - hPct / 2, wPct, hPct }) }));
  };

  const onPagePointerDown = (e: React.PointerEvent, pageIndex: number) => {
    if (drag.current) return;
    const p = pctFromEvent(e, pageIndex);
    pressStart.current = p ? { pageIndex, x: p.x, y: p.y } : null;
  };
  const onPagePointerUp = (e: React.PointerEvent, pageIndex: number) => {
    const start = pressStart.current;
    pressStart.current = null;
    const wasDrag = drag.current;
    drag.current = null;
    if (!start || start.pageIndex !== pageIndex || wasDrag) return;
    const p = pctFromEvent(e, pageIndex);
    if (!p) return;
    if (Math.hypot(p.x - start.x, p.y - start.y) > 0.02) return;
    if (selectedFillId) {
      setFillFields((prev) => prev.map((f) => (f.id === selectedFillId ? clampBox({ ...f, page: pageIndex + 1, xPct: p.x - f.wPct / 2, yPct: p.y - f.hPct / 2 }) : f)));
      return;
    }
    placeSigAt(pageIndex, start.x, start.y);
  };
  const onPagePointerMove = (e: React.PointerEvent, pageIndex: number) => {
    const d = drag.current;
    if (!d || d.pageIndex !== pageIndex) return;
    const p = pctFromEvent(e, pageIndex);
    if (!p) return;
    if (d.type === "fill") {
      setFillFields((prev) => prev.map((f) => (f.id === d.id ? clampBox({ ...f, page: pageIndex + 1, xPct: p.x - d.dx, yPct: p.y - d.dy }) : f)));
    } else {
      setFields((prev) => {
        const f = prev[d.key];
        if (!f) return prev;
        return { ...prev, [d.key]: clampBox({ ...f, page: pageIndex + 1, xPct: p.x - d.dx, yPct: p.y - d.dy }) };
      });
    }
  };

  const addFillField = (kind: FillField["kind"]) => {
    fillCounter.current += 1;
    const id = `f${Date.now().toString(36)}${fillCounter.current}`;
    const pageCount = Math.max(1, pages.length);
    const stacked = fillFields.filter((f) => f.page === pageCount).length;
    const field: FillField = {
      id,
      kind,
      role: "client",
      label: FILL_LABELS[kind],
      required: kind !== "checkbox",
      page: pageCount,
      xPct: 0.07,
      yPct: Math.min(0.93, 0.8 + stacked * 0.055),
      ...FILL_SIZES[kind],
    };
    setFillFields((prev) => [...prev, field]);
    setSelectedFillId(id);
  };

  const selectedFill = selectedFillId ? fillFields.find((f) => f.id === selectedFillId) ?? null : null;
  const activeSig = fields[active];
  const heightRange = isDateKey(active) ? { min: 2, max: 10 } : { min: 3, max: 15 };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api.saveDocumentSignatureFields({ documentId: doc.id, fields });
      await api.saveDocumentFillFields({ documentId: doc.id, fields: fillFields });
      onSaved();
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setSaving(false);
    }
  };

  const boxStyle = (f: SignaturePlacement): React.CSSProperties => ({
    left: `${f.xPct * 100}%`,
    top: `${f.yPct * 100}%`,
    width: `${f.wPct * 100}%`,
    height: `${f.hPct * 100}%`,
  });

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal modal-placement" role="dialog" aria-modal="true" aria-label="Place signature fields" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Place fields</h2>
            <span className="drawer-sub">{doc.displayTitle || doc.title} — pick a field, click a page to place it, drag boxes to adjust.</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="place-toolbar">
          <div className="place-chips">
            {SIG_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`place-chip${active === tab.key && !selectedFillId ? " active" : ""}${fields[tab.key] ? " placed" : ""}`}
                onClick={() => { setActive(tab.key); setSelectedFillId(null); }}
              >
                {tab.label}{fields[tab.key] ? ` · p${fields[tab.key]?.page}` : ""}
              </button>
            ))}
          </div>
          <div className="place-chips">
            {(Object.keys(FILL_SIZES) as FillField["kind"][]).map((kind) => (
              <button key={kind} type="button" className="place-chip add" onClick={() => addFillField(kind)}>
                + {FILL_LABELS[kind]}
              </button>
            ))}
          </div>
        </div>

        {(activeSig && !selectedFillId) || selectedFill ? (
          <div className="place-controls">
            {selectedFill ? (
              <>
                <strong>{FILL_LABELS[selectedFill.kind]} field</strong>
                <label className="field inline">
                  <span>Label</span>
                  <input value={selectedFill.label} onChange={(e) => setFillFields((prev) => prev.map((f) => (f.id === selectedFill.id ? { ...f, label: e.target.value } : f)))} />
                </label>
                <label className="field inline">
                  <span>Filled by</span>
                  <select value={selectedFill.role} onChange={(e) => setFillFields((prev) => prev.map((f) => (f.id === selectedFill.id ? { ...f, role: e.target.value as FillField["role"] } : f)))}>
                    <option value="client">Client</option>
                    <option value="contractor">Contractor</option>
                  </select>
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={selectedFill.required} onChange={(e) => setFillFields((prev) => prev.map((f) => (f.id === selectedFill.id ? { ...f, required: e.target.checked } : f)))} />
                  Required
                </label>
                <button type="button" className="btn btn-danger-ghost btn-small" onClick={() => { setFillFields((prev) => prev.filter((f) => f.id !== selectedFill.id)); setSelectedFillId(null); }}>
                  Delete field
                </button>
              </>
            ) : activeSig ? (
              <>
                <strong>{SIG_TABS.find((t) => t.key === active)?.label} · page {activeSig.page}</strong>
                <label className="field inline range">
                  <span>Width {Math.round(activeSig.wPct * 100)}%</span>
                  <input type="range" min={8} max={70} step={1} value={Math.round(activeSig.wPct * 100)} onChange={(e) => setFields((prev) => ({ ...prev, [active]: prev[active] ? clampBox({ ...prev[active]!, wPct: Number(e.target.value) / 100 }) : prev[active] }))} />
                </label>
                <label className="field inline range">
                  <span>Height {Math.round(activeSig.hPct * 100)}%</span>
                  <input type="range" min={heightRange.min} max={heightRange.max} step={0.5} value={Math.round(activeSig.hPct * 100)} onChange={(e) => setFields((prev) => ({ ...prev, [active]: prev[active] ? clampBox({ ...prev[active]!, hPct: Number(e.target.value) / 100 }) : prev[active] }))} />
                </label>
                <button type="button" className="btn btn-danger-ghost btn-small" onClick={() => setFields((prev) => { const next = { ...prev }; delete next[active]; return next; })}>
                  Remove placement
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {loadError ? <p className="inline-error">{loadError}</p> : null}
        {pages.length === 0 && !loadError ? <p className="muted">Rendering pages…</p> : null}

        <div className="place-pages">
          {pages.map((page, pageIndex) => (
            <div
              key={pageIndex}
              className="place-page"
              ref={(el) => { pageRefs.current[pageIndex] = el; }}
              onPointerDown={(e) => onPagePointerDown(e, pageIndex)}
              onPointerUp={(e) => onPagePointerUp(e, pageIndex)}
              onPointerMove={(e) => onPagePointerMove(e, pageIndex)}
            >
              <img src={`data:image/png;base64,${page}`} alt={`Page ${pageIndex + 1}`} draggable={false} />
              <span className="place-page-num">Page {pageIndex + 1}</span>
              {SIG_TABS.map((tab) => {
                const f = fields[tab.key];
                if (!f || f.page !== pageIndex + 1) return null;
                return (
                  <div
                    key={tab.key}
                    className={`place-box ${tab.key.startsWith("client") ? "client" : "contractor"}${active === tab.key && !selectedFillId ? " selected" : ""}`}
                    style={boxStyle(f)}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setActive(tab.key);
                      setSelectedFillId(null);
                      const p = pctFromEvent(e, pageIndex);
                      if (p) drag.current = { type: "sig", key: tab.key, pageIndex, dx: p.x - f.xPct, dy: p.y - f.yPct };
                    }}
                  >
                    {tab.label}
                  </div>
                );
              })}
              {fillFields.filter((f) => f.page === pageIndex + 1).map((f) => (
                <div
                  key={f.id}
                  className={`place-box fill${selectedFillId === f.id ? " selected" : ""}`}
                  style={boxStyle(f)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedFillId(f.id);
                    const p = pctFromEvent(e, pageIndex);
                    if (p) drag.current = { type: "fill", id: f.id, pageIndex, dx: p.x - f.xPct, dy: p.y - f.yPct };
                  }}
                >
                  {f.label || FILL_LABELS[f.kind]}
                </div>
              ))}
            </div>
          ))}
        </div>

        {error ? <p className="inline-error">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saving || pages.length === 0} onClick={() => void save()}>
            {saving ? "Saving…" : "Save placement"}
          </button>
        </div>
      </div>
    </div>
  );
}
