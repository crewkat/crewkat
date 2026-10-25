import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import type { DocSettings, Invoice, LineItem, MaterialItem, Quote } from "../types";
import { cleanError, financialTotals, formatMoney, isoPlusDays, lineTotal, moneyOf, moneyString, todayIso } from "../utils";

export type FinancialEditorTarget =
  | { mode: "create"; kind: "quote" | "invoice"; presetClientId?: number | null; presetJobId?: number | null }
  | { mode: "edit"; kind: "quote"; doc: Quote }
  | { mode: "edit"; kind: "invoice"; doc: Invoice };

interface ItemRow extends LineItem {
  name: string;
  quantity: number;
  discount: string;
  unit: "none" | "days" | "hours";
}

const blankItem = (): ItemRow => ({ name: "", description: "", amount: "", quantity: 1, discount: "0", unit: "none" });

/**
 * Desktop estimate / invoice editor. Create goes through saveQuote /
 * saveInvoice; edit goes through updateQuoteDocument /
 * updateInvoiceDocument — the exact actions (and gated discount/tax
 * semantics) the phone editors use, with totals computed by the shared
 * financialTotals mirror. Documents are doc-only: picking a client or
 * job fills the snapshot fields but never writes the client record.
 */
export function FinancialEditor({
  target,
  onClose,
  onSaved,
}: {
  target: FinancialEditorTarget;
  onClose: () => void;
  onSaved: (kind: "quote" | "invoice", id: number) => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = target.mode === "edit";
  const kind = target.kind;
  const doc = target.mode === "edit" ? target.doc : null;

  const settingsQuery = useQuery({
    queryKey: ["settings-company"],
    queryFn: () => api.getSettings({}),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const settings = settingsQuery.data as unknown as DocSettings | undefined;

  const clientsQuery = useQuery({ queryKey: ["clients", ""], queryFn: () => api.listClients({ search: "" }), enabled: !isEdit });
  const jobsQuery = useQuery({ queryKey: ["jobs", ""], queryFn: () => api.listJobs({ search: "" }), enabled: !isEdit });
  const clients = useMemo(() => clientsQuery.data?.clients ?? [], [clientsQuery.data]);
  const jobs = useMemo(() => jobsQuery.data?.jobs ?? [], [jobsQuery.data]);

  const [clientId, setClientId] = useState<number | null>(
    target.mode === "edit" ? target.doc.clientId : (target.presetClientId ?? null),
  );
  const [jobId, setJobId] = useState<number | null>(
    target.mode === "edit" ? target.doc.jobId : (target.presetJobId ?? null),
  );
  const [clientName, setClientName] = useState(doc?.clientName ?? "");
  const [clientPhone, setClientPhone] = useState(doc?.clientPhone ?? "");
  const [clientEmail, setClientEmail] = useState(doc?.clientEmail ?? "");
  const [jobAddress, setJobAddress] = useState(doc?.jobAddress ?? "");
  const [shippingAddress, setShippingAddress] = useState(doc?.shippingAddress ?? "");
  const [jobType, setJobType] = useState(doc?.jobType ?? "");
  const [items, setItems] = useState<ItemRow[]>(
    doc && doc.lineItems.length > 0
      ? doc.lineItems.map((i) => ({ ...i, name: i.name ?? "", quantity: i.quantity ?? 1, discount: i.discount ?? "0", unit: i.unit ?? "none" }))
      : [blankItem()],
  );
  const [discountOn, setDiscountOn] = useState<boolean | null>(null);
  const [discountType, setDiscountType] = useState<"percent" | "fixed">(doc?.discountType ?? "percent");
  const [discountValue, setDiscountValue] = useState(doc?.discountValue ?? "0");
  const [taxOn, setTaxOn] = useState<boolean | null>(null);
  const [taxType, setTaxType] = useState<"percent" | "fixed">(doc?.taxType ?? "percent");
  const [taxValue, setTaxValue] = useState(doc?.taxValue ?? "0");
  const [depositType, setDepositType] = useState<"none" | "percent" | "fixed">("none");
  const [depositValue, setDepositValue] = useState("0");
  const [footnote, setFootnote] = useState(doc?.footnote ?? "");
  const [materials, setMaterials] = useState<MaterialItem[]>(doc && "materials" in doc ? doc.materials : []);
  const [expiryDate, setExpiryDate] = useState(target.mode === "edit" && target.kind === "quote" ? target.doc.expiryDate : isoPlusDays(30));
  const [invoiceNumber, setInvoiceNumber] = useState(target.mode === "edit" && target.kind === "invoice" ? target.doc.invoiceNumber : "");
  const [issueDate, setIssueDate] = useState(target.mode === "edit" && target.kind === "invoice" ? target.doc.issueDate : todayIso());
  const [dueDate, setDueDate] = useState(target.mode === "edit" && target.kind === "invoice" ? target.doc.dueDate : "");
  const [status, setStatus] = useState<"draft" | "sent">("draft");
  const [error, setError] = useState("");

  // Create-mode toggles seed from the company defaults once settings land.
  const effDiscountOn = discountOn ?? (isEdit ? (doc?.showDiscountLine ?? true) : (settings?.defaultShowDiscountLine ?? true));
  const effTaxOn = taxOn ?? (isEdit ? (doc?.showTaxLine ?? true) : (settings?.defaultShowTaxLine ?? true));

  const totals = useMemo(
    () => financialTotals(items, discountType, effDiscountOn ? discountValue : "0", taxType, effTaxOn ? taxValue : "0"),
    [items, discountType, discountValue, taxType, taxValue, effDiscountOn, effTaxOn],
  );
  const optionsTotal = useMemo(
    () => items.filter((i) => i.optional).reduce((sum, i) => sum + lineTotal(i), 0),
    [items],
  );

  const pickClient = (id: number | null) => {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (c) {
      setClientName(c.name);
      setClientPhone(c.phone);
      setClientEmail(c.email);
      if (!jobAddress) setJobAddress(c.address);
    }
  };
  const pickJob = (id: number | null) => {
    setJobId(id);
    const j = jobs.find((x) => x.id === id);
    if (j) {
      if (!jobAddress) setJobAddress(j.jobAddress);
      if (!jobType) setJobType(j.jobType);
      if (j.clientId && !clientId) pickClient(j.clientId);
    }
  };

  const setItem = (index: number, patch: Partial<ItemRow>) =>
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));

  const saveMutation = useMutation({
    mutationFn: async (): Promise<number> => {
      const cleanItems = items.filter((i) => i.description.trim() || moneyOf(i.amount) > 0);
      if (!clientName.trim()) throw new Error("Client name is required — the first missing field is the client name.");
      if (cleanItems.length === 0) throw new Error("Add at least one line item with a description.");
      const lineItems = cleanItems.map((i) => ({
        name: i.name,
        description: i.description.trim(),
        amount: i.amount.trim() || "0",
        quantity: i.quantity,
        discount: i.discount || "0",
        unit: i.unit,
        ...(i.id ? { id: i.id } : {}),
        ...(kind === "quote" && i.optional ? { optional: true } : {}),
      }));
      const financials = {
        lineItems,
        discountType,
        discountValue: effDiscountOn ? discountValue : "0",
        taxType,
        taxValue: effTaxOn ? taxValue : "0",
        subtotal: moneyString(totals.subtotal),
        total: moneyString(totals.total),
        footnote,
        depositType,
        depositValue,
      };
      if (target.mode === "edit") {
        if (kind === "quote") await api.updateQuoteDocument({ id: target.doc.id, ...financials });
        else await api.updateInvoiceDocument({ id: target.doc.id, ...financials, ...(invoiceNumber.trim() ? { invoiceNumber: invoiceNumber.trim() } : {}), issueDate, dueDate });
        return target.doc.id;
      }
      const design = {
        theme: (settings?.defaultQuoteTheme ?? "classic") as "classic" | "modern" | "bold" | "minimal",
        font: (settings?.defaultDocumentFont ?? "helvetica") as "helvetica" | "times" | "courier" | "palatino",
        accentColor: settings?.accentColor && /^#[0-9a-fA-F]{6}$/.test(settings.accentColor) ? settings.accentColor : "#f2762e",
        customizeJson: settings?.defaultCustomizeJson || "{}",
        showTaxLine: effTaxOn,
        showDiscountLine: effDiscountOn,
        showPaidLine: settings?.defaultShowPaidLine ?? true,
        showPaymentTerms: settings?.defaultShowPaymentTerms ?? true,
        showFooterNotes: settings?.defaultShowFooterNotes ?? true,
        showLogo: settings?.defaultShowLogo ?? true,
        showCompanyInfo: settings?.defaultShowCompanyInfo ?? true,
      };
      const snapshot = { clientId, jobId, clientName: clientName.trim(), clientPhone, clientEmail, jobAddress, shippingAddress, jobType };
      if (kind === "quote") {
        const res = await api.saveQuote({
          ...snapshot,
          ...financials,
          expiryDate,
          sentAt: "",
          materials: materials.filter((m) => m.name.trim()),
          ...design,
        });
        return res.id;
      }
      const res = await api.saveInvoice({
        ...snapshot,
        ...financials,
        invoiceNumber: "",
        quoteId: null,
        issueDate,
        dueDate,
        status,
        recurringFrequency: "none",
        nextDueDate: "",
        recurringEndDate: "",
        ...design,
      });
      return res.id;
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ["quotes"] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["office-dashboard"] });
      onSaved(kind, id);
    },
    onError: (e) => setError(cleanError(e)),
  });

  const title = isEdit
    ? kind === "quote" ? `Edit estimate #${(doc as Quote).id}` : `Edit invoice ${(doc as Invoice).invoiceNumber}`
    : kind === "quote" ? "New estimate" : "New invoice";

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!isEdit ? (
          <div className="form-grid">
            <label className="field">
              <span>Client (fills the snapshot below)</span>
              <select value={clientId ?? ""} onChange={(e) => pickClient(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— No linked client —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Job</span>
              <select value={jobId ?? ""} onChange={(e) => pickJob(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— No linked job —</option>
                {jobs.filter((j) => !clientId || j.clientId === clientId || j.id === jobId).map((j) => (
                  <option key={j.id} value={j.id}>{j.clientName || "Job"} · {j.jobType || "—"} · {j.jobAddress || "No address"}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div className="form-grid doc-head-grid">
          <label className="field">
            <span>Client name *</span>
            <input value={clientName} disabled={isEdit} onChange={(e) => setClientName(e.target.value)} placeholder="Client name" />
          </label>
          <label className="field">
            <span>Job type</span>
            <input value={jobType} disabled={isEdit} onChange={(e) => setJobType(e.target.value)} placeholder="Kitchen remodel" />
          </label>
          <label className="field">
            <span>Client phone</span>
            <input value={clientPhone} disabled={isEdit} onChange={(e) => setClientPhone(e.target.value)} />
          </label>
          <label className="field">
            <span>Client email</span>
            <input value={clientEmail} disabled={isEdit} onChange={(e) => setClientEmail(e.target.value)} />
          </label>
          <label className="field span2">
            <span>Job address</span>
            <input value={jobAddress} disabled={isEdit} onChange={(e) => setJobAddress(e.target.value)} />
          </label>
          <label className="field span2">
            <span>Service / shipping address</span>
            <input value={shippingAddress} disabled={isEdit} onChange={(e) => setShippingAddress(e.target.value)} placeholder="Optional" />
          </label>
          {kind === "invoice" ? (
            <>
              <label className="field">
                <span>Issue date</span>
                <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </label>
              <label className="field">
                <span>Due date</span>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
              {isEdit ? (
                <label className="field">
                  <span>Invoice number</span>
                  <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
                </label>
              ) : (
                <label className="field">
                  <span>Status</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value as "draft" | "sent")}>
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                  </select>
                </label>
              )}
            </>
          ) : (
            <label className="field">
              <span>Valid until</span>
              <input type="date" value={expiryDate} disabled={isEdit} onChange={(e) => setExpiryDate(e.target.value)} />
            </label>
          )}
        </div>

        <h3 className="editor-section-title">Line items</h3>
        <table className="line-table">
          <thead>
            <tr>
              <th className="lt-name">Name</th>
              <th>Description</th>
              <th className="lt-num">Qty</th>
              <th className="lt-unit">Unit</th>
              <th className="lt-num">Amount</th>
              <th className="lt-num">Discount</th>
              {kind === "quote" ? <th className="lt-opt">Optional</th> : null}
              <th className="lt-total">Total</th>
              <th className="lt-x" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td><input value={item.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="Item name" /></td>
                <td><input value={item.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="Description *" /></td>
                <td><input type="number" min={0} step="any" value={item.quantity} onChange={(e) => setItem(i, { quantity: Number(e.target.value) || 0 })} /></td>
                <td>
                  <select value={item.unit} onChange={(e) => setItem(i, { unit: e.target.value as ItemRow["unit"] })}>
                    <option value="none">—</option>
                    <option value="days">days</option>
                    <option value="hours">hours</option>
                  </select>
                </td>
                <td><input inputMode="decimal" value={item.amount} onChange={(e) => setItem(i, { amount: e.target.value })} placeholder="0.00" /></td>
                <td><input inputMode="decimal" value={item.discount} onChange={(e) => setItem(i, { discount: e.target.value })} placeholder="0" /></td>
                {kind === "quote" ? (
                  <td className="lt-center"><input type="checkbox" checked={!!item.optional} onChange={(e) => setItem(i, { optional: e.target.checked })} aria-label="Optional add-on" /></td>
                ) : null}
                <td className="lt-total">{formatMoney(lineTotal(item))}</td>
                <td>
                  <button type="button" className="icon-btn" disabled={items.length <= 1} onClick={() => setItems((prev) => prev.filter((_, x) => x !== i))} aria-label="Remove line">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setItems((prev) => [...prev, blankItem()])}>+ Add line item</button>
        {kind === "quote" && optionsTotal > 0 ? (
          <p className="feed-meta">Optional add-ons total {formatMoney(optionsTotal)} — priced separately; they join the total only when the client selects them.</p>
        ) : null}

        <div className="editor-totals-grid">
          <div className="editor-adjustments">
            <div className="adjust-row">
              <label className="check-row">
                <input type="checkbox" checked={effDiscountOn} onChange={(e) => setDiscountOn(e.target.checked)} />
                Discount
              </label>
              <select value={discountType} disabled={!effDiscountOn} onChange={(e) => setDiscountType(e.target.value as "percent" | "fixed")} aria-label="Discount type">
                <option value="percent">%</option>
                <option value="fixed">$</option>
              </select>
              <input inputMode="decimal" value={discountValue} disabled={!effDiscountOn} onChange={(e) => setDiscountValue(e.target.value)} aria-label="Discount value" />
            </div>
            <div className="adjust-row">
              <label className="check-row">
                <input type="checkbox" checked={effTaxOn} onChange={(e) => setTaxOn(e.target.checked)} />
                Tax
              </label>
              <select value={taxType} disabled={!effTaxOn} onChange={(e) => setTaxType(e.target.value as "percent" | "fixed")} aria-label="Tax type">
                <option value="percent">%</option>
                <option value="fixed">$</option>
              </select>
              <input inputMode="decimal" value={taxValue} disabled={!effTaxOn} onChange={(e) => setTaxValue(e.target.value)} aria-label="Tax value" />
            </div>
            <div className="adjust-row">
              <label className="check-row static">Deposit request</label>
              <select value={depositType} onChange={(e) => setDepositType(e.target.value as "none" | "percent" | "fixed")} aria-label="Deposit type">
                <option value="none">None</option>
                <option value="percent">%</option>
                <option value="fixed">$</option>
              </select>
              <input inputMode="decimal" value={depositValue} disabled={depositType === "none"} onChange={(e) => setDepositValue(e.target.value)} aria-label="Deposit value" />
            </div>
            <label className="field">
              <span>Notes / terms (footnote)</span>
              <textarea rows={3} value={footnote} onChange={(e) => setFootnote(e.target.value)} placeholder="Payment terms, notes shown on the document…" />
            </label>
          </div>
          <div className="totals-box">
            <div><span>Subtotal</span><strong>{formatMoney(totals.subtotal)}</strong></div>
            {effDiscountOn && totals.discount > 0 ? <div><span>Discount</span><strong>−{formatMoney(totals.discount)}</strong></div> : null}
            {effTaxOn && totals.tax > 0 ? <div><span>Tax</span><strong>{formatMoney(totals.tax)}</strong></div> : null}
            <div className="totals-total"><span>Total</span><strong>{formatMoney(totals.total)}</strong></div>
          </div>
        </div>

        {kind === "quote" && !isEdit ? (
          <>
            <h3 className="editor-section-title">Materials list (internal)</h3>
            <div className="materials-editor">
              {materials.map((m, i) => (
                <div className="material-row" key={i}>
                  <input value={m.name} placeholder="Material" onChange={(e) => setMaterials((prev) => prev.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))} />
                  <input value={m.qty} placeholder="Qty" onChange={(e) => setMaterials((prev) => prev.map((x, xi) => (xi === i ? { ...x, qty: e.target.value } : x)))} />
                  <input value={m.unit} placeholder="Unit" onChange={(e) => setMaterials((prev) => prev.map((x, xi) => (xi === i ? { ...x, unit: e.target.value } : x)))} />
                  <button type="button" className="icon-btn" onClick={() => setMaterials((prev) => prev.filter((_, xi) => xi !== i))} aria-label="Remove material">✕</button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setMaterials((prev) => [...prev, { name: "", qty: "", unit: "", checked: false }])}>+ Add material</button>
            </div>
          </>
        ) : null}
        {kind === "quote" && isEdit && materials.length > 0 ? (
          <p className="feed-meta">This estimate carries a materials list ({materials.length} item{materials.length === 1 ? "" : "s"}) — it is kept as saved; materials are set when the estimate is created.</p>
        ) : null}

        {error ? <p className="inline-error">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : kind === "quote" ? "Create estimate" : "Create invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}
