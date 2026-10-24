import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Client } from "../types";
import { formatDate, formatMoney, initials } from "../utils";

type SortKey = "name" | "jobCount" | "totalInvoiced" | "balanceDue" | "createdAt";

export function ClientsView({
  selectedClientId,
  onSelectClient,
  onOpenJob,
}: {
  selectedClientId: number | null;
  onSelectClient: (id: number | null) => void;
  onOpenJob: (jobId: number) => void;
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
          <p className="view-sub">{clients.length} clients on file.</p>
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

        {selected ? <ClientDetail client={selected} onClose={() => onSelectClient(null)} onOpenJob={onOpenJob} /> : null}
      </div>
    </div>
  );
}

function ClientDetail({ client, onClose, onOpenJob }: { client: Client; onClose: () => void; onOpenJob: (jobId: number) => void }) {
  const detailQuery = useQuery({
    queryKey: ["client", client.id],
    queryFn: () => api.getClient({ id: client.id }),
  });
  const detail = detailQuery.data;
  const c = detail?.client ?? client;
  const jobs = detail?.jobs ?? [];
  const quotes = detail?.quotes ?? [];

  return (
    <aside className="panel detail-panel">
      <div className="drawer-head">
        <div>
          <h2>{c.name}</h2>
          <span className="drawer-sub">Client since {formatDate(c.createdAt)}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <dl className="detail-list">
        <div><dt>Phone</dt><dd>{c.phone || "—"}</dd></div>
        <div><dt>Email</dt><dd>{c.email || "—"}</dd></div>
        <div><dt>Primary address</dt><dd>{c.address || "—"}</dd></div>
        {c.tags.length > 0 ? <div><dt>Tags</dt><dd>{c.tags.join(", ")}</dd></div> : null}
        {c.referredByName ? <div><dt>Referred by</dt><dd>{c.referredByName}</dd></div> : null}
        {c.notes ? <div><dt>Notes</dt><dd>{c.notes}</dd></div> : null}
      </dl>

      <section className="drawer-section">
        <h3>Saved addresses</h3>
        {c.addresses.length === 0 ? (
          <p className="muted">No saved addresses yet.</p>
        ) : (
          <ul className="address-list">
            {c.addresses.map((a, i) => (
              <li key={`${a.address}-${i}`}>
                <span>{a.address}</span>
                {a.label ? <span className="chip">{a.label}</span> : null}
                {a.primary ? <span className="chip chip-primary">Primary</span> : null}
              </li>
            ))}
          </ul>
        )}
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
        <h3>Documents summary</h3>
        <p className="muted">
          {c.quoteCount} estimate{c.quoteCount === 1 ? "" : "s"} · {c.invoiceCount} invoice{c.invoiceCount === 1 ? "" : "s"}
          {quotes.length > 0 ? ` · latest estimate ${formatDate(quotes[0]?.createdAt)}` : ""}
        </p>
      </section>
    </aside>
  );
}
