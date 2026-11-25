import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import { cleanError, formatDate, formatMoney, todayIso } from "../utils";
import type { DocSelection } from "../views/Documents";

/**
 * Recurring invoices management (parity item 11). Two server systems
 * exist and the phone exposes both, so Office manages both here:
 *  - invoice series: an invoice carrying a recurringFrequency
 *    (updateInvoiceRecurrence / generateRecurringInvoice /
 *    cancelRecurringInvoice) — new series are set in the invoice
 *    editor; here they can be generated early or cancelled.
 *  - schedules: createRecurringSchedule / listRecurringSchedules /
 *    cancelRecurringSchedule — a template invoice + weekly/monthly
 *    cadence the server tick turns into fresh invoices.
 */
export function RecurringPanel({ onOpenDocument }: { onOpenDocument: (sel: DocSelection) => void }) {
  const queryClient = useQueryClient();
  const invoicesQuery = useQuery({ queryKey: ["invoices"], queryFn: () => api.listInvoices({}) });
  const schedulesQuery = useQuery({ queryKey: ["recurring-schedules"], queryFn: () => api.listRecurringSchedules({}) });
  const [error, setError] = useState("");
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [frequency, setFrequency] = useState<"weekly" | "monthly">("monthly");

  const invoices = useMemo(() => invoicesQuery.data?.invoices ?? [], [invoicesQuery.data]);
  const series = useMemo(
    () => invoices.filter((i) => i.parentInvoiceId === null && i.recurringFrequency !== "none" && !i.recurringCancelled),
    [invoices],
  );
  const schedules = schedulesQuery.data?.schedules ?? [];
  const schedulable = useMemo(
    () => invoices.filter((i) => !schedules.some((s) => s.active && s.invoiceId === i.id)),
    [invoices, schedules],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    void queryClient.invalidateQueries({ queryKey: ["recurring-schedules"] });
  };
  const generateMutation = useMutation({
    mutationFn: (id: number) => api.generateRecurringInvoice({ id }),
    onSuccess: () => { setError(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const cancelSeriesMutation = useMutation({
    mutationFn: (id: number) => api.cancelRecurringInvoice({ id }),
    onSuccess: invalidate,
    onError: (e) => setError(cleanError(e)),
  });
  const createScheduleMutation = useMutation({
    mutationFn: () => api.createRecurringSchedule({ invoiceId: invoiceId!, frequency, today: todayIso() }),
    onSuccess: () => { setError(""); setInvoiceId(null); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const cancelScheduleMutation = useMutation({
    mutationFn: (id: number) => api.cancelRecurringSchedule({ id }),
    onSuccess: invalidate,
    onError: (e) => setError(cleanError(e)),
  });

  return (
    <section className="panel">
      <div className="panel-head"><h2>Recurring invoices ({series.length + schedules.filter((s) => s.active).length} active)</h2></div>
      {error ? <p className="inline-error">{error}</p> : null}

      {series.length === 0 && schedules.length === 0 ? (
        <p className="muted">Nothing recurs yet. Set a repeat on a new invoice in the editor, or start a schedule from an existing invoice below.</p>
      ) : null}

      {series.length > 0 ? (
        <>
          <h4 className="pair-title">Invoice series</h4>
          <ul className="link-list static">
            {series.map((inv) => (
              <li key={inv.id}>
                <button type="button" onClick={() => onOpenDocument({ kind: "invoice", id: inv.id })}>
                  <span>{inv.invoiceNumber} · {inv.clientName}</span>
                  <span className="feed-meta">
                    {formatMoney(inv.total)} · repeats {inv.recurringFrequency}
                    {inv.nextDueDate ? ` · next ${formatDate(inv.nextDueDate)}` : ""}
                    {inv.recurringEndDate ? ` · ends ${formatDate(inv.recurringEndDate)}` : ""}
                  </span>
                </button>
                <span className="row-actions">
                  <button type="button" className="link-btn" disabled={generateMutation.isPending} onClick={() => generateMutation.mutate(inv.id)}>Generate now</button>
                  <button type="button" className="link-btn danger" disabled={cancelSeriesMutation.isPending} onClick={() => cancelSeriesMutation.mutate(inv.id)}>Cancel series</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {schedules.length > 0 ? (
        <>
          <h4 className="pair-title">Schedules</h4>
          <ul className="link-list static">
            {schedules.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOpenDocument({ kind: "invoice", id: s.invoiceId })}>
                  <span>{s.invoiceNumber} · {s.clientName}</span>
                  <span className="feed-meta">
                    {formatMoney(s.total)} · {s.frequency} · {s.active ? `next run ${formatDate(s.nextRunDate)}` : "cancelled"}
                  </span>
                </button>
                {s.active ? (
                  <span className="row-actions">
                    <button type="button" className="link-btn danger" disabled={cancelScheduleMutation.isPending} onClick={() => cancelScheduleMutation.mutate(s.id)}>Cancel schedule</button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="sub-form">
        <h4 className="pair-title">Start a schedule from an invoice</h4>
        <div className="inline-form">
          <select value={invoiceId ?? ""} onChange={(e) => setInvoiceId(e.target.value ? Number(e.target.value) : null)} aria-label="Template invoice">
            <option value="">Pick an invoice…</option>
            {schedulable.map((i) => <option key={i.id} value={i.id}>{i.invoiceNumber} · {i.clientName} · {formatMoney(i.total)}</option>)}
          </select>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as "weekly" | "monthly")} aria-label="Frequency">
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <button type="button" className="btn btn-primary btn-small" disabled={!invoiceId || createScheduleMutation.isPending} onClick={() => createScheduleMutation.mutate()}>
            {createScheduleMutation.isPending ? "Starting…" : "Start schedule"}
          </button>
        </div>
        <p className="muted small">Each run creates a fresh draft invoice from the template — review and send it from Documents.</p>
      </div>
    </section>
  );
}
