import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Client } from "../types";
import { cleanError, formatDate, formatMoney, initials } from "../utils";
import type { DocSelection } from "./Documents";
import { TimelineFeed } from "./Timeline";

type SortKey = "name" | "jobCount" | "totalInvoiced" | "balanceDue" | "createdAt";

export function ClientsView({
  selectedClientId,
  onSelectClient,
  onOpenJob,
  onOpenDocument,
}: {
  selectedClientId: number | null;
  onSelectClient: (id: number | null) => void;
  onOpenJob: (jobId: number) => void;
  onOpenDocument: (sel: DocSelection) => void;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const searchTimer = useRef<number | undefined>(undefined);

  const clientsQuery = useQuery({
    queryKey: ["clients", debounced],
    queryFn: () => api.listClients({ search: debounced }),
  });
  const clients = useMemo(() => clientsQuery.data?.clients ?? [], [clientsQuery.data]);

  const sorted = useMemo(() => {
    const rows = [...clients];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "string" ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
      return cmp * sortDir;
    });
    return rows;
  }, [clients, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(key === "name" ? 1 : -1); }
  };
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 1 ? " ↑" : " ↓") : "");

  const selected = clients.find((c) => c.id === selectedClientId) ?? null;

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Clients</h1>
          <p className="view-sub">{`${clients.length} clients on file.`}</p>
        </div>
        <div className="search-box">
          <input
            value={search}
            placeholder="Search name, phone, email, address…"
            onChange={(e) => {
              setSearch(e.target.value);
              window.clearTimeout(searchTimer.current);
              searchTimer.current = window.setTimeout(() => setDebounced(e.target.value), 250);
            }}
          />
        </div>
      </div>

      <div className={selected ? "split-layout" : ""}>
        <section className="panel table-panel">
          {clientsQuery.isLoading ? <div className="view-loading">Loading clients…</div> : null}
          {clientsQuery.isError ? (
            <div className="empty-state">
              <div className="empty-icon">◍</div>
              <p>Couldn't load clients.</p>
              <button type="button" className="btn btn-primary" onClick={() => void clientsQuery.refetch()}>Try again</button>
            </div>
          ) : null}
          {!clientsQuery.isLoading && !clientsQuery.isError && sorted.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">👥</div>
              <p>{debounced ? `No clients match “${debounced}”.` : "No clients yet — converted leads and new jobs will show up here."}</p>
            </div>
          ) : null}
          {sorted.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th><button type="button" className="th-btn" onClick={() => toggleSort("name")}>Client{arrow("name")}</button></th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Address</th>
                  <th className="num"><button type="button" className="th-btn" onClick={() => toggleSort("jobCount")}>Jobs{arrow("jobCount")}</button></th>
                  <th className="num"><button type="button" className="th-btn" onClick={() => toggleSort("totalInvoiced")}>Invoiced{arrow("totalInvoiced")}</button></th>
                  <th className="num"><button type="button" className="th-btn" onClick={() => toggleSort("balanceDue")}>Balance due{arrow("balanceDue")}</button></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
                  <tr key={c.id} className={c.id === selectedClientId ? "selected" : ""} onClick={() => onSelectClient(c.id)}>
                    <td>
                      <span className="cell-person">
                        <span className="avatar">{initials(c.name)}</span>
                        <span>{c.name}</span>
                      </span>
                    </td>
                    <td>{c.phone || "—"}</td>
                    <td>{c.email || "—"}</td>
                    <td className="cell-address">{c.address || "—"}</td>
                    <td className="num">{c.jobCount}</td>
                    <td className="num">{formatMoney(c.totalInvoiced)}</td>
                    <td className="num">{c.balanceDue > 0 ? <span className="overdue">{formatMoney(c.balanceDue)}</span> : formatMoney(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>

        {selected ? <ClientDetail client={selected} onClose={() => onSelectClient(null)} onOpenJob={onOpenJob} onOpenDocument={onOpenDocument} /> : null}
      </div>
    </div>
  );
}

function ClientDetail({ client, onClose, onOpenJob, onOpenDocument }: { client: Client; onClose: () => void; onOpenJob: (jobId: number) => void; onOpenDocument: (sel: DocSelection) => void }) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["client", client.id],
    queryFn: () => api.getClient({ id: client.id }),
  });
  const timelineQuery = useQuery({
    queryKey: ["client-timeline", client.id],
    queryFn: () => api.getClientTimeline({ clientId: client.id }),
  });
  const invoicesQuery = useQuery({ queryKey: ["invoices"], queryFn: () => api.listInvoices({}) });
  const signablesQuery = useQuery({ queryKey: ["documents"], queryFn: () => api.listDocuments({}) });
  const detail = detailQuery.data;
  const c = detail?.client ?? client;
  // Editing (Danny 2026-11-01): phone/email edit in place and the
  // saved-address list is manageable right here — add (append-only),
  // set primary, remove a non-primary entry. All writes go through the
  // existing client actions (saveClient carries the full record, so
  // fields this panel doesn't render are sent back untouched) and
  // appendClientAddress for adds. Nothing here writes back into jobs:
  // a job keeps the contact/address snapshot it was created with.
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [nameNote, setNameNote] = useState("");
  const [editingContact, setEditingContact] = useState(false);
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactNote, setContactNote] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [addressNote, setAddressNote] = useState("");
  const invalidateClient = () => {
    void queryClient.invalidateQueries({ queryKey: ["client", c.id] });
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
  };
  const saveClientMutation = useMutation({
    mutationFn: (patch: { phone?: string; email?: string; addresses?: Client["addresses"] }) =>
      api.saveClient({
        id: c.id,
        name: c.name,
        phone: patch.phone ?? c.phone,
        email: patch.email ?? c.email,
        address: c.address,
        addresses: (patch.addresses ?? c.addresses).map((a) => ({ label: a.label, address: a.address, primary: a.primary })),
        notes: c.notes,
        tags: c.tags,
        referredByClientId: c.referredByClientId,
      }),
    onError: (err) => { setContactNote(cleanError(err)); setAddressNote(cleanError(err)); },
  });
  const contactSave = useMutation({
    mutationFn: () => saveClientMutation.mutateAsync({ phone: contactPhone.trim(), email: contactEmail.trim() }),
    onSuccess: () => { setEditingContact(false); setContactNote("Saved."); invalidateClient(); },
  });
  // Rename (Danny 2026-11-01): the name edit goes through renameClient,
  // NOT saveClient — renaming cascades to the clientName snapshot on
  // every record linked to this client (jobs, estimates, invoices,
  // appointments, maintenance plans), so the panel says what was
  // updated from the counts the action returns.
  const renameSave = useMutation({
    mutationFn: () => api.renameClient({ clientId: c.id, name: nameValue.trim() }),
    onSuccess: (result) => {
      setEditingName(false);
      const parts: string[] = [];
      const add = (count: number, one: string, many: string) => { if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`); };
      add(result.jobs, "job", "jobs");
      add(result.quotes, "estimate", "estimates");
      add(result.invoices, "invoice", "invoices");
      add(result.appointments, "appointment", "appointments");
      add(result.maintenancePlans, "maintenance plan", "maintenance plans");
      setNameNote(parts.length > 0 ? `Renamed — also updated on ${parts.join(", ")}.` : "Renamed.");
      invalidateClient();
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (err) => setNameNote(cleanError(err)),
  });
  const startNameEdit = () => {
    setNameValue(c.name);
    setNameNote("");
    setEditingName(true);
  };
  const appendAddressMutation = useMutation({
    mutationFn: () => api.appendClientAddress({ clientId: c.id, address: newAddress.trim(), label: "" }),
    onSuccess: () => { setNewAddress(""); setAddressNote("Address added to the saved list."); invalidateClient(); },
    onError: (err) => setAddressNote(cleanError(err)),
  });
  const addressListMutation = useMutation({
    mutationFn: (addresses: Client["addresses"]) => saveClientMutation.mutateAsync({ addresses }),
    onSuccess: () => { setAddressNote("Saved addresses updated."); invalidateClient(); },
  });
  const startContactEdit = () => {
    setContactPhone(c.phone);
    setContactEmail(c.email);
    setContactNote("");
    setEditingContact(true);
  };
  const jobs = detail?.jobs ?? [];
  const quotes = detail?.quotes ?? [];
  const clientInvoices = (invoicesQuery.data?.invoices ?? []).filter((i) => i.clientId === client.id);
  const jobIds = new Set(jobs.map((j) => j.id));
  const clientSignables = (signablesQuery.data?.documents ?? []).filter((d) => jobIds.has(d.jobId));

  return (
    <aside className="panel detail-panel">
      <div className="drawer-head">
        <div>
          {editingName ? (
            <input className="contact-input name-input" value={nameValue} onChange={(e) => setNameValue(e.target.value)} placeholder="Client name" aria-label="Client name" autoFocus />
          ) : (
            <h2>{c.name}</h2>
          )}
          <span className="drawer-sub">Client since {formatDate(c.createdAt)}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="contact-edit-bar">
        {editingName ? (
          <>
            <button type="button" className="btn btn-primary btn-small" disabled={!nameValue.trim() || renameSave.isPending} onClick={() => renameSave.mutate()}>
              {renameSave.isPending ? "Saving…" : "Save name"}
            </button>
            <button type="button" className="btn btn-ghost btn-small" disabled={renameSave.isPending} onClick={() => setEditingName(false)}>Cancel</button>
            <span className="muted small">Renaming updates this client and all their jobs, estimates, invoices and documents.</span>
          </>
        ) : (
          <button type="button" className="btn btn-ghost btn-small" onClick={startNameEdit}>✎ Edit name</button>
        )}
      </div>
      {nameNote ? <p className="feed-meta block contact-note">{nameNote}</p> : null}

      <dl className="detail-list">
        <div><dt>Phone</dt><dd>{editingContact ? <input className="contact-input" type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Add a phone number" aria-label="Client phone" /> : (c.phone || "—")}</dd></div>
        <div><dt>Email</dt><dd>{editingContact ? <input className="contact-input" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Add an email" aria-label="Client email" /> : (c.email || "—")}</dd></div>
        <div><dt>Primary address</dt><dd>{c.address || "—"}</dd></div>
        {c.tags.length > 0 ? <div><dt>Tags</dt><dd>{c.tags.join(", ")}</dd></div> : null}
        {c.referredByName ? <div><dt>Referred by</dt><dd>{c.referredByName}</dd></div> : null}
        {c.notes ? <div><dt>Notes</dt><dd>{c.notes}</dd></div> : null}
      </dl>

      <div className="contact-edit-bar">
        {editingContact ? (
          <>
            <button type="button" className="btn btn-primary btn-small" disabled={contactSave.isPending} onClick={() => contactSave.mutate()}>
              {contactSave.isPending ? "Saving…" : "Save phone & email"}
            </button>
            <button type="button" className="btn btn-ghost btn-small" disabled={contactSave.isPending} onClick={() => setEditingContact(false)}>Cancel</button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost btn-small" onClick={startContactEdit}>✎ Edit phone &amp; email</button>
        )}
      </div>
      {contactNote ? <p className="feed-meta block contact-note">{contactNote}</p> : null}

      <section className="drawer-section">
        <h3>Saved addresses</h3>
        {c.addresses.length === 0 ? (
          <p className="muted">No saved addresses yet — add the first one below.</p>
        ) : (
          <ul className="address-list">
            {c.addresses.map((a, i) => (
              <li key={`${a.address}-${i}`}>
                <span>{a.address}</span>
                {a.label ? <span className="chip">{a.label}</span> : null}
                {a.primary ? <span className="chip chip-primary">Primary</span> : (
                  <>
                    <button
                      type="button"
                      className="link-btn"
                      disabled={addressListMutation.isPending}
                      onClick={() => addressListMutation.mutate(c.addresses.map((entry, j) => ({ ...entry, primary: j === i })))}
                    >
                      Make primary
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      disabled={addressListMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove “${a.address}” from this client's saved addresses? Jobs that already use it keep their own copy.`)) {
                          addressListMutation.mutate(c.addresses.filter((_, j) => j !== i));
                        }
                      }}
                    >
                      Remove
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="address-add">
          <input
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="Add another address…"
            aria-label="New saved address"
            onKeyDown={(e) => { if (e.key === "Enter" && newAddress.trim()) { setAddressNote(""); appendAddressMutation.mutate(); } }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={!newAddress.trim() || appendAddressMutation.isPending}
            onClick={() => { setAddressNote(""); appendAddressMutation.mutate(); }}
          >
            {appendAddressMutation.isPending ? "Adding…" : "Add address"}
          </button>
        </div>
        <p className="muted small">Adding never replaces an existing address — the list just grows (up to 20).</p>
        {addressNote ? <p className="feed-meta block contact-note">{addressNote}</p> : null}
      </section>

      <section className="drawer-section">
        <h3>Money</h3>
        <div className="mini-stats">
          <div><span>Invoiced</span><strong>{formatMoney(c.totalInvoiced)}</strong></div>
          <div><span>Paid</span><strong>{formatMoney(c.totalPaid)}</strong></div>
          <div><span>Balance due</span><strong>{formatMoney(c.balanceDue)}</strong></div>
          <div><span>Invoices</span><strong>{c.invoiceCount}</strong></div>
        </div>
        {c.totalInvoiced > 0 ? (
          <div className="progress-track" title={`${c.paymentPercent}% paid`}>
            <div className="progress-fill" style={{ width: `${c.paymentPercent}%` }} />
          </div>
        ) : null}
      </section>

      <section className="drawer-section">
        <h3>Jobs ({jobs.length})</h3>
        {detailQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {!detailQuery.isLoading && jobs.length === 0 ? <p className="muted">No jobs for this client yet.</p> : null}
        <ul className="link-list">
          {jobs.map((j) => (
            <li key={j.id}>
              <button type="button" onClick={() => onOpenJob(j.id)}>
                <span>{j.jobType || "Job"} · {j.jobAddress || "No address"}</span>
                <span className="feed-meta">{j.completedAt ? "Completed" : "Active"} · {formatDate(j.jobDate)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="drawer-section">
        <h3>Documents ({quotes.length + clientInvoices.length + clientSignables.length})</h3>
        {quotes.length + clientInvoices.length + clientSignables.length === 0 ? (
          <p className="muted">No documents for this client yet — create one from the Documents section.</p>
        ) : (
          <ul className="link-list">
            {clientSignables.map((d) => (
              <li key={`doc-${d.id}`}>
                <button type="button" onClick={() => onOpenDocument({ kind: d.kind, id: d.id })}>
                  <span>{d.displayTitle || d.title}</span>
                  <span className="feed-meta">{d.kind === "change_order" ? "Change order" : "Contract"} · {d.clientSignedAt ? "Signed" : "Awaiting client"} · {formatMoney(d.amount)}</span>
                </button>
              </li>
            ))}
            {clientInvoices.map((inv) => (
              <li key={`inv-${inv.id}`}>
                <button type="button" onClick={() => onOpenDocument({ kind: "invoice", id: inv.id })}>
                  <span>{inv.invoiceNumber}</span>
                  <span className="feed-meta">Invoice · {inv.status} · {formatMoney(inv.total)}</span>
                </button>
              </li>
            ))}
            {quotes.map((q) => (
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
        <h3>Timeline</h3>
        <TimelineFeed events={timelineQuery.data?.events ?? []} isLoading={timelineQuery.isLoading} />
      </section>
    </aside>
  );
}
