import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, startImpersonation } from "../api";
import { cleanError, formatDate, formatDateTime, formatMoney } from "../utils";

/**
 * Platform admin console (Office desktop face for the server-side
 * platform-admin suite, app/server/src/platform-admin*.ts + the admin
 * actions in actions.ts). The nav item only renders for platform admins
 * and platform team-role holders, and every action is re-gated on the
 * server (requirePlatformAdmin / requireTeamRole) — this UI is cosmetic.
 *
 * Role semantics mirror the suite's permission matrix:
 *  - platform admin (is_platform_admin): everything, incl. the
 *    requirePlatformAdmin surfaces (analytics, revenue, broadcasts,
 *    flags, verification, support lookup).
 *  - team "admin": user management + audit search + team roles.
 *  - team "support": users (suspend/sessions), support inbox, team list.
 *  - team "moderator": user list + marketplace user reports.
 */

export type PlatformRole = "admin" | "support" | "moderator";

type AdminTab = "overview" | "users" | "support" | "broadcasts" | "flags" | "team" | "audit";

const TAB_LABELS: Record<AdminTab, string> = {
  overview: "Overview",
  users: "Users",
  support: "Support",
  broadcasts: "Broadcasts",
  flags: "Flags & settings",
  team: "Team roles",
  audit: "Audit log",
};

export function AdminView({
  isPlatformAdmin,
  role,
  selfUserId,
}: {
  isPlatformAdmin: boolean;
  role: PlatformRole;
  selfUserId: number;
}) {
  const tabs: AdminTab[] = [
    ...(isPlatformAdmin ? (["overview"] as AdminTab[]) : []),
    "users",
    "support",
    ...(isPlatformAdmin ? (["broadcasts", "flags"] as AdminTab[]) : []),
    ...(role === "admin" || role === "support" ? (["team"] as AdminTab[]) : []),
    ...(role === "admin" ? (["audit"] as AdminTab[]) : []),
  ];
  const [tab, setTab] = useState<AdminTab>(tabs[0] ?? "users");
  const active = tabs.includes(tab) ? tab : (tabs[0] ?? "users");

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Admin</h1>
          <p className="view-sub">
            Platform console for the Crewkat team — your role: <strong>{isPlatformAdmin ? "platform admin" : role}</strong>. Every action here is logged to the audit trail.
          </p>
        </div>
        <div className="segmented" role="tablist" aria-label="Admin sections">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={active === t} className={active === t ? "active" : ""} onClick={() => setTab(t)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {active === "overview" ? <OverviewTab /> : null}
      {active === "users" ? <UsersTab role={role} isPlatformAdmin={isPlatformAdmin} selfUserId={selfUserId} /> : null}
      {active === "support" ? <SupportTab role={role} isPlatformAdmin={isPlatformAdmin} /> : null}
      {active === "broadcasts" ? <BroadcastsTab /> : null}
      {active === "flags" ? <FlagsTab /> : null}
      {active === "team" ? <TeamTab role={role} selfUserId={selfUserId} /> : null}
      {active === "audit" ? <AuditTab /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{title}</h2></div>
        <p className="muted">{body}</p>
        {children}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={`btn ${danger ? "btn-danger-ghost" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <div className="pager">
      <button type="button" className="btn btn-ghost btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
      <span className="muted small">Page {page} of {pages} · {total} total</span>
      <button type="button" className="btn btn-ghost btn-small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}

function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/* ------------------------------------------------------------------ */
/* Overview: Mission Control analytics + Stripe revenue + growth       */
/* ------------------------------------------------------------------ */

function OverviewTab() {
  const analyticsQuery = useQuery({ queryKey: ["admin-analytics-overview"], queryFn: () => api.adminAnalyticsOverview({}) });
  const revenueQuery = useQuery({ queryKey: ["admin-revenue"], queryFn: () => api.adminRevenueDashboard({}) });
  const growthQuery = useQuery({ queryKey: ["admin-growth"], queryFn: () => api.adminGrowthMetrics({}) });
  const marketplaceQuery = useQuery({ queryKey: ["admin-marketplace-overview"], queryFn: () => api.adminMarketplaceOverview({}) });
  const activityQuery = useQuery({ queryKey: ["admin-recent-activity"], queryFn: () => api.adminRecentActivity({}) });

  const a = analyticsQuery.data;
  const r = revenueQuery.data;
  const g = growthQuery.data;
  const m = marketplaceQuery.data;
  const act = activityQuery.data;

  return (
    <div className="admin-stack">
      {analyticsQuery.isLoading ? <div className="view-loading">Loading platform numbers…</div> : null}
      {analyticsQuery.isError ? <p className="inline-error">Couldn't load the platform analytics.</p> : null}
      {a ? (
        <div className="kpi-row admin-kpis">
          <div className="kpi-card"><span className="kpi-label">Total users</span><span className="kpi-value">{a.totalUsers}</span><span className="kpi-sub">+{a.newToday} today · +{a.newThisWeek} this week · +{a.newThisMonth} this month</span></div>
          <div className="kpi-card"><span className="kpi-label">Active premium</span><span className="kpi-value">{a.activePremium}</span><span className="kpi-sub">+{a.premiumToday} today · +{a.premiumThisWeek} this week</span></div>
          <div className="kpi-card"><span className="kpi-label">Est. MRR (local)</span><span className="kpi-value">{formatMoney(a.mrr)}</span><span className="kpi-sub">From subscription events, excl. lifetime</span></div>
          <div className="kpi-card"><span className="kpi-label">Founding members</span><span className="kpi-value">{a.foundingClaimed}</span><span className="kpi-sub">{a.foundingRemaining} of 100 remaining</span></div>
          <div className="kpi-card"><span className="kpi-label">Churn (30d)</span><span className="kpi-value">{a.churnRate}%</span><span className="kpi-sub">{a.cancelledLast30d} cancellations</span></div>
          {g ? <div className="kpi-card"><span className="kpi-label">Signup growth WoW</span><span className="kpi-value">{g.signupGrowthWow}%</span><span className="kpi-sub">{g.wowHasBaseline ? "vs prior 7 days" : "No prior-week baseline"}</span></div> : null}
        </div>
      ) : null}

      <div className="panel-grid admin-panels">
        <section className="panel">
          <div className="panel-head"><h2>Revenue (Stripe)</h2></div>
          {revenueQuery.isLoading ? <p className="muted">Loading…</p> : null}
          {revenueQuery.isError ? <p className="inline-error">Couldn't load Stripe revenue.</p> : null}
          {r && !r.configured ? <p className="muted">Stripe isn't configured in this environment, so live revenue is unavailable. Local premium accounts: <strong>{r.localActivePremium}</strong>.</p> : null}
          {r && r.configured ? (
            <dl className="detail-list">
              <div><dt>MRR</dt><dd>{r.mrrDollars != null ? formatMoney(r.mrrDollars) : "—"}</dd></div>
              <div><dt>Active subscriptions</dt><dd>{r.activeSubscriptions ?? "—"}</dd></div>
              <div><dt>Trialing</dt><dd>{r.trialing ?? "—"}</dd></div>
              <div><dt>Failed payments</dt><dd>{r.failedPayments ?? "—"}</dd></div>
              <div><dt>Local premium accounts</dt><dd>{r.localActivePremium}</dd></div>
              <div><dt>As of</dt><dd>{formatDateTime(r.cachedAt)}</dd></div>
            </dl>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Growth & health</h2></div>
          {growthQuery.isLoading ? <p className="muted">Loading…</p> : null}
          {growthQuery.isError ? <p className="inline-error">Couldn't load growth metrics.</p> : null}
          {g ? (
            <dl className="detail-list">
              <div><dt>Premium conversion</dt><dd>{g.premiumConversionRate}% ({g.premiumTotal} premium)</dd></div>
              <div><dt>Active listings</dt><dd>{g.activeListings}</dd></div>
              <div><dt>Avg messages / listing</dt><dd>{g.avgMessagesPerListing}</dd></div>
              <div><dt>Open support tickets</dt><dd>{g.supportOpenCount}</dd></div>
            </dl>
          ) : null}
          {m ? (
            <>
              <div className="drawer-section">
                <h3>Marketplace</h3>
                <dl className="detail-list">
                  <div><dt>Listings</dt><dd>{m.listingsActive} active of {m.listingsTotal} ({m.listingsLast30d} in 30d)</dd></div>
                  <div><dt>Need / offer</dt><dd>{m.listingsByIntent.need} / {m.listingsByIntent.offer}</dd></div>
                  <div><dt>Messages</dt><dd>{m.messagesTotal} ({m.messagesLast30d} in 30d)</dd></div>
                  <div><dt>Conversations</dt><dd>{m.conversationsTotal} · {m.listingToMessageRate}% of listings</dd></div>
                  <div><dt>Completed jobs</dt><dd>{m.completedJobsTotal} ({m.completedJobsLast30d} in 30d)</dd></div>
                </dl>
              </div>
            </>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Recent activity</h2></div>
          {activityQuery.isLoading ? <p className="muted">Loading…</p> : null}
          {act && act.signups.length === 0 && act.events.length === 0 ? (
            <div className="empty-state small"><div className="empty-icon">↻</div><p>No signups or subscription events yet.</p></div>
          ) : null}
          {act && act.signups.length > 0 ? (
            <ul className="feed-list">
              {act.signups.slice(0, 8).map((u) => (
                <li key={u.id} className="feed-item">
                  <div className="feed-main">
                    <span className="feed-title">{u.name}</span>
                    <span className="feed-meta">{u.email} · {u.tier} · {formatDate(u.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {act && act.events.length > 0 ? (
            <ul className="feed-list">
              {act.events.slice(0, 8).map((e) => (
                <li key={e.id} className="feed-item">
                  <div className="feed-main">
                    <span className="feed-title">{e.eventType}{e.plan ? ` · ${e.plan}` : ""}</span>
                    <span className="feed-meta">{e.userName} · {formatDate(e.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

type UserTierFilter = "all" | "free" | "premium";
type UserStatusFilter = "all" | "active" | "suspended" | "founder";
type UserConfirm =
  | { kind: "suspend" } | { kind: "unsuspend" } | { kind: "revokeSessions" }
  | { kind: "tier"; to: "free" | "premium" } | { kind: "founderGrant" } | { kind: "founderRevoke" }
  | { kind: "impersonate" } | { kind: "delete" } | null;

function UsersTab({ role, isPlatformAdmin, selfUserId }: { role: PlatformRole; isPlatformAdmin: boolean; selfUserId: number }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [tier, setTier] = useState<UserTierFilter>("all");
  const [status, setStatus] = useState<UserStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const pageSize = 20;

  const listQuery = useQuery({
    queryKey: ["admin-users", debouncedSearch, tier, status, page],
    queryFn: () => api.adminUsersList({ search: debouncedSearch, tier, status, page, pageSize }),
  });
  const detailQuery = useQuery({
    queryKey: ["admin-user-detail", selectedId],
    queryFn: () => api.adminUserDetail({ userId: selectedId as number }),
    enabled: selectedId != null,
  });
  const detail = detailQuery.data;
  // Jobs/clients/invoice counts live on the (platform-admin-only) support
  // view; each lookup is audit-logged server-side by design.
  const supportQuery = useQuery({
    queryKey: ["admin-support-view", detail?.user.email],
    queryFn: () => api.adminSupportView({ email: detail?.user.email as string }),
    enabled: isPlatformAdmin && !!detail?.user.email,
  });

  const [confirm, setConfirm] = useState<UserConfirm>(null);
  const [deleteReason, setDeleteReason] = useState("");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-user-detail"] });
  };
  const actionMutation = useMutation({
    mutationFn: async (c: NonNullable<UserConfirm>) => {
      const userId = selectedId as number;
      switch (c.kind) {
        case "suspend": return api.adminUserSuspend({ userId });
        case "unsuspend": return api.adminUserUnsuspend({ userId });
        case "revokeSessions": return api.adminUserRevokeSessions({ userId });
        case "tier": return api.adminUserSetTier({ userId, tier: c.to });
        case "founderGrant": return api.adminUserGrantFounder({ userId });
        case "founderRevoke": return api.adminUserRevokeFounder({ userId });
        case "delete": return api.adminUserDelete({ userId, reason: deleteReason.trim() });
        case "impersonate": return api.adminImpersonateStart({ userId });
      }
    },
    onSuccess: (result, c) => {
      setConfirm(null);
      setDeleteReason("");
      setError("");
      if (c.kind === "impersonate" && result && typeof result === "object" && "proof" in result) {
        // Switch the whole Office session to the target user (30 min,
        // audit-logged). App.tsx hears IMPERSONATION_EVENT and reloads
        // the session as the target, with a banner to end it.
        startImpersonation(result.proof, result.userName);
        return;
      }
      if (c.kind === "delete") setSelectedId(null);
      invalidate();
    },
    onError: (e) => { setConfirm(null); setError(cleanError(e)); },
  });

  const canSuspend = role === "admin" || role === "support";
  const canAdminOnly = role === "admin";
  const u = detail?.user;
  const isSelf = u?.id === selfUserId;

  const confirmCopy: Record<NonNullable<UserConfirm>["kind"], { title: string; body: string; label: string; danger?: boolean }> = {
    suspend: { title: "Suspend this account?", body: "The user is signed out everywhere immediately and can't sign in until unsuspended.", label: "Suspend", danger: true },
    unsuspend: { title: "Unsuspend this account?", body: "The user will be able to sign in again.", label: "Unsuspend" },
    revokeSessions: { title: "Revoke all sessions?", body: "Every signed-in device for this user is signed out.", label: "Revoke sessions" },
    tier: { title: "Change plan tier?", body: "Manual tier changes are marked as admin-granted and never touch Stripe.", label: "Change tier" },
    founderGrant: { title: "Grant Founders status?", body: "Lifetime premium, never billed.", label: "Grant Founders" },
    founderRevoke: { title: "Revoke Founders status?", body: "The account drops to the free tier.", label: "Revoke Founders", danger: true },
    impersonate: { title: "View as this user?", body: "You'll see Office exactly as this user for up to 30 minutes. The session is recorded in the audit log.", label: "Start viewing" },
    delete: { title: "Delete this account permanently?", body: "This removes the account and, if it's the company's only user, all company data. This cannot be undone.", label: "Delete account", danger: true },
  };

  return (
    <div className="admin-stack">
      <div className="doc-filter-row">
        <label className="search-box">
          <input value={search} placeholder="Search name or email…" aria-label="Search users" onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </label>
        <select className="doc-status-select" value={tier} aria-label="Filter by tier" onChange={(e) => { setTier(e.target.value as UserTierFilter); setPage(1); }}>
          <option value="all">All tiers</option>
          <option value="free">Free</option>
          <option value="premium">Premium</option>
        </select>
        <select className="doc-status-select" value={status} aria-label="Filter by status" onChange={(e) => { setStatus(e.target.value as UserStatusFilter); setPage(1); }}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="founder">Founders</option>
        </select>
      </div>
      {error ? <p className="inline-error">{error}</p> : null}

      <div className="split-layout admin-split">
        <section className="panel table-panel">
          {listQuery.isLoading ? <div className="view-loading">Loading users…</div> : null}
          {listQuery.isError ? <p className="inline-error">Couldn't load users.</p> : null}
          {listQuery.data && listQuery.data.users.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">👥</div><p>No users match those filters.</p></div>
          ) : null}
          {listQuery.data && listQuery.data.users.length > 0 ? (
            <>
              <table className="data-table">
                <thead><tr><th>User</th><th>Company</th><th>Plan</th><th>Status</th><th>Joined</th></tr></thead>
                <tbody>
                  {listQuery.data.users.map((row) => (
                    <tr key={row.id} className={selectedId === row.id ? "selected" : ""} onClick={() => setSelectedId(row.id)}>
                      <td>
                        <span className="cell-person">{row.name}</span>
                        <span className="feed-meta block">{row.email}</span>
                      </td>
                      <td>{row.companyName || "—"}</td>
                      <td><span className={`status-pill${row.tier === "premium" ? " signed" : ""}`}>{row.subscriptionStatus === "founder" ? "Founder" : row.tier}</span></td>
                      <td>{row.suspended ? <span className="status-pill overdue">Suspended</span> : row.isPlatformAdmin ? <span className="status-pill">Platform admin</span> : <span className="muted small">Active</span>}</td>
                      <td>{formatDate(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager page={page} pageSize={pageSize} total={listQuery.data.total} onPage={setPage} />
            </>
          ) : null}
        </section>

        <aside className="panel detail-panel">
          {!u ? (
            <div className="empty-state small"><div className="empty-icon">👤</div><p>Select a user to see their account detail.</p></div>
          ) : detailQuery.isLoading ? (
            <div className="view-loading">Loading detail…</div>
          ) : (
            <>
              <div className="panel-head">
                <h2>{u.name}</h2>
                {u.suspended ? <span className="status-pill overdue">Suspended</span> : null}
              </div>
              <dl className="detail-list">
                <div><dt>Email</dt><dd>{u.email}</dd></div>
                <div><dt>Company</dt><dd>{u.companyName || "—"} (#{u.companyId})</dd></div>
                <div><dt>Plan</dt><dd>{u.subscriptionStatus === "founder" ? "Founder (lifetime)" : `${u.tier} · ${u.subscriptionStatus}`}</dd></div>
                <div><dt>Billing</dt><dd>{u.stripeSubscriptionId ? `Stripe sub ${u.stripeSubscriptionId}` : u.stripeCustomerId ? `Stripe customer ${u.stripeCustomerId}` : "No Stripe customer"}</dd></div>
                <div><dt>Period end</dt><dd>{u.subscriptionCurrentPeriodEnd ? formatDate(u.subscriptionCurrentPeriodEnd) : "—"}{u.cancelAtPeriodEnd ? " · cancels at period end" : ""}</dd></div>
                <div><dt>Email verified</dt><dd>{u.emailVerified ? `Yes · ${formatDate(u.emailVerifiedAt)}` : "No"}</dd></div>
                <div><dt>Active sessions</dt><dd>{u.activeSessionCount}</dd></div>
                <div><dt>Joined</dt><dd>{formatDate(u.createdAt)}</dd></div>
              </dl>

              {isPlatformAdmin && supportQuery.data?.counts ? (
                <div className="drawer-section">
                  <h3>Workspace</h3>
                  <div className="mini-stats">
                    <div><span>Jobs</span><strong>{supportQuery.data.counts.jobs}</strong></div>
                    <div><span>Clients</span><strong>{supportQuery.data.counts.clients}</strong></div>
                    <div><span>Invoices</span><strong>{supportQuery.data.counts.invoices}</strong></div>
                    <div><span>Estimates</span><strong>{supportQuery.data.counts.quotes}</strong></div>
                  </div>
                </div>
              ) : null}

              {detail && detail.listings.length > 0 ? (
                <div className="drawer-section">
                  <h3>Marketplace listings ({detail.listings.length})</h3>
                  <ul className="feed-list">
                    {detail.listings.slice(0, 6).map((l) => (
                      <li key={l.id} className="feed-item">
                        <div className="feed-main">
                          <span className="feed-title">{l.title}</span>
                          <span className="feed-meta">{l.moderationStatus} · {l.flagCount} flags · {formatDate(l.createdAt)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="drawer-section">
                <h3>Actions</h3>
                <div className="admin-action-grid">
                  {canSuspend && !isSelf ? (
                    u.suspended
                      ? <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirm({ kind: "unsuspend" })}>Unsuspend</button>
                      : <button type="button" className="btn btn-danger-ghost btn-small" onClick={() => setConfirm({ kind: "suspend" })}>Suspend</button>
                  ) : null}
                  {canSuspend && !isSelf ? <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirm({ kind: "revokeSessions" })}>Revoke sessions</button> : null}
                  {canAdminOnly && !isSelf && !u.isPlatformAdmin ? (
                    <button type="button" className="btn btn-ghost btn-small" disabled={!!u.suspended} onClick={() => setConfirm({ kind: "impersonate" })}>View as user</button>
                  ) : null}
                  {isPlatformAdmin ? (
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirm({ kind: "tier", to: u.tier === "premium" ? "free" : "premium" })}>
                      {u.tier === "premium" ? "Move to free" : "Grant premium"}
                    </button>
                  ) : null}
                  {canAdminOnly && u.subscriptionStatus !== "founder" ? <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirm({ kind: "founderGrant" })}>Grant Founders</button> : null}
                  {canAdminOnly && u.subscriptionStatus === "founder" ? <button type="button" className="btn btn-danger-ghost btn-small" onClick={() => setConfirm({ kind: "founderRevoke" })}>Revoke Founders</button> : null}
                  {canAdminOnly && !isSelf && !u.isPlatformAdmin ? <button type="button" className="btn btn-danger-ghost btn-small" onClick={() => setConfirm({ kind: "delete" })}>Delete account</button> : null}
                </div>
                {isSelf ? <p className="muted small">This is your own account — account actions are disabled here.</p> : null}
              </div>

              {detail && detail.audit.length > 0 ? (
                <div className="drawer-section">
                  <h3>Admin history</h3>
                  <ul className="feed-list">
                    {detail.audit.slice(0, 8).map((entry) => (
                      <li key={entry.id} className="feed-item">
                        <div className="feed-main">
                          <span className="feed-title">{entry.action}</span>
                          <span className="feed-meta">{entry.adminName} · {formatDate(entry.createdAt)}{entry.details ? ` · ${entry.details}` : ""}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </aside>
      </div>

      {confirm && u ? (
        <ConfirmDialog
          title={confirmCopy[confirm.kind].title}
          body={confirmCopy[confirm.kind].body}
          confirmLabel={confirmCopy[confirm.kind].label}
          danger={confirmCopy[confirm.kind].danger}
          busy={actionMutation.isPending}
          onCancel={() => { setConfirm(null); setDeleteReason(""); }}
          onConfirm={() => actionMutation.mutate(confirm)}
        >
          {confirm.kind === "delete" ? (
            <label className="field">
              <span>Reason (optional, saved to the audit log)</span>
              <input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Why is this account being deleted?" />
            </label>
          ) : null}
          <p className="muted small">Target: {u.name} &lt;{u.email}&gt;</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Support: ticket inbox + thread, lookup, reports, verification       */
/* ------------------------------------------------------------------ */

type TicketStatus = "open" | "resolved" | "all";
type TicketPriority = "low" | "normal" | "high" | "urgent";

function SupportTab({ role, isPlatformAdmin }: { role: PlatformRole; isPlatformAdmin: boolean }) {
  const canTickets = role === "admin" || role === "support";
  const canReports = role === "admin" || role === "moderator";
  return (
    <div className="admin-stack">
      {canTickets ? <SupportInbox /> : null}
      {isPlatformAdmin ? <SupportLookup /> : null}
      {canReports ? <UserReports /> : null}
      {isPlatformAdmin ? <VerificationQueue /> : null}
    </div>
  );
}

function SupportInbox() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TicketStatus>("open");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const inboxQuery = useQuery({
    queryKey: ["admin-support-inbox", status, debouncedSearch],
    queryFn: () => api.platformSupportInbox({ status, priority: "all", assignedTo: "all", search: debouncedSearch }),
  });
  const threadQuery = useQuery({
    queryKey: ["admin-support-thread", selectedId],
    queryFn: () => api.platformSupportThread({ reportId: selectedId as number }),
    enabled: selectedId != null,
  });
  const teamQuery = useQuery({ queryKey: ["admin-team-list"], queryFn: () => api.adminTeamList({}) });
  const notesQuery = useQuery({
    queryKey: ["admin-support-notes", selectedId],
    queryFn: () => api.adminSupportNotesList({ reportId: selectedId as number }),
    enabled: selectedId != null,
  });

  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-support-inbox"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-support-thread"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-support-notes"] });
  };
  const fail = (e: unknown) => setError(cleanError(e));
  const replyMutation = useMutation({
    mutationFn: () => api.replyToSupportReport({ reportId: selectedId as number, message: reply.trim() }),
    onSuccess: () => { setReply(""); setError(""); invalidate(); },
    onError: fail,
  });
  const statusMutation = useMutation({
    mutationFn: (next: "open" | "resolved") => api.updatePlatformSupportReport({ id: selectedId as number, status: next, isUnread: false }),
    onSuccess: () => { setError(""); invalidate(); },
    onError: fail,
  });
  const priorityMutation = useMutation({
    mutationFn: (priority: TicketPriority) => api.adminSupportTicketPriority({ reportId: selectedId as number, priority }),
    onSuccess: () => { setError(""); invalidate(); },
    onError: fail,
  });
  const assignMutation = useMutation({
    mutationFn: (userId: number | null) => api.adminSupportTicketAssign({ reportId: selectedId as number, userId }),
    onSuccess: () => { setError(""); invalidate(); },
    onError: fail,
  });
  const noteMutation = useMutation({
    mutationFn: () => api.adminSupportNoteAdd({ reportId: selectedId as number, note: note.trim() }),
    onSuccess: () => { setNote(""); setError(""); invalidate(); },
    onError: fail,
  });

  const thread = threadQuery.data;
  const reports = inboxQuery.data?.reports ?? [];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Support inbox{inboxQuery.data ? ` · ${inboxQuery.data.unreadCount} unread` : ""}</h2>
        <div className="head-controls">
          <div className="segmented" role="tablist" aria-label="Ticket status">
            {(["open", "resolved", "all"] as TicketStatus[]).map((s) => (
              <button key={s} type="button" className={status === s ? "active" : ""} onClick={() => setStatus(s)}>{s === "all" ? "All" : s === "open" ? "Open" : "Resolved"}</button>
            ))}
          </div>
          <label className="search-box">
            <input value={search} placeholder="Search tickets…" aria-label="Search support tickets" onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="split-layout admin-split">
        <div>
          {inboxQuery.isLoading ? <div className="view-loading">Loading tickets…</div> : null}
          {inboxQuery.isError ? <p className="inline-error">Couldn't load the support inbox.</p> : null}
          {inboxQuery.data && reports.length === 0 ? (
            <div className="empty-state small"><div className="empty-icon">✓</div><p>No tickets match — the inbox is clear.</p></div>
          ) : null}
          <ul className="feed-list">
            {reports.map((r) => (
              <li key={r.id} className={`feed-item admin-ticket${selectedId === r.id ? " selected" : ""}`} onClick={() => setSelectedId(r.id)}>
                <div className="feed-main">
                  <span className="feed-title">{r.isUnread ? "● " : ""}{r.subject}</span>
                  <span className="feed-meta">{r.userName} · {r.userEmail} · {r.kind} · {formatDate(r.createdAt)}</span>
                  <span className="feed-meta">{r.replyCount} replies{r.assignedTo ? ` · assigned to ${r.assignedTo.name}` : ""}{r.noteCount ? ` · ${r.noteCount} internal notes` : ""}</span>
                </div>
                <span className={`status-pill${r.priority === "urgent" || r.priority === "high" ? " overdue" : r.status === "resolved" ? " done" : ""}`}>{r.status === "resolved" ? "Resolved" : r.priority}</span>
              </li>
            ))}
          </ul>
        </div>

        <aside className="detail-panel">
          {selectedId == null ? (
            <div className="empty-state small"><div className="empty-icon">✉</div><p>Select a ticket to read the conversation.</p></div>
          ) : !thread ? (
            <div className="view-loading">Loading thread…</div>
          ) : (
            <>
              <div className="panel-head"><h2>{thread.report.subject}</h2></div>
              <dl className="detail-list">
                <div><dt>From</dt><dd>{thread.report.userName} · {thread.report.userEmail}</dd></div>
                <div><dt>Kind</dt><dd>{thread.report.kind} · {thread.report.language}</dd></div>
                <div><dt>Status</dt><dd>{thread.report.status}{thread.report.resolvedAt ? ` · resolved ${formatDate(thread.report.resolvedAt)}` : ""}</dd></div>
                <div><dt>Priority</dt><dd>
                  <select className="doc-status-select" value={thread.report.priority} aria-label="Ticket priority" onChange={(e) => priorityMutation.mutate(e.target.value as TicketPriority)}>
                    {(["low", "normal", "high", "urgent"] as TicketPriority[]).map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </dd></div>
                <div><dt>Assigned to</dt><dd>
                  <select
                    className="doc-status-select"
                    value={thread.report.assignedTo?.id ?? ""}
                    aria-label="Assign ticket"
                    onChange={(e) => assignMutation.mutate(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Unassigned</option>
                    {(teamQuery.data?.members ?? []).map((m) => <option key={m.userId} value={m.userId}>{m.name} ({m.role})</option>)}
                  </select>
                </dd></div>
              </dl>

              <div className="drawer-section">
                <div className="support-msg user">
                  <p>{thread.report.message}</p>
                  <span className="feed-meta">{thread.report.userName} · {formatDateTime(thread.report.createdAt)}</span>
                </div>
                {thread.report.screenshots.length > 0 ? (
                  <div className="support-shots">
                    {thread.report.screenshots.map((s) => (
                      s.url ? (
                        <a key={s.key} href={s.url} target="_blank" rel="noreferrer"><img src={s.url} alt="Support screenshot" /></a>
                      ) : <span key={s.key} className="chip">screenshot unavailable</span>
                    ))}
                  </div>
                ) : null}
                {thread.replies.map((rep) => (
                  <div key={rep.id} className={`support-msg ${rep.sender === "admin" ? "admin" : "user"}`}>
                    <p>{rep.message}</p>
                    <span className="feed-meta">{rep.sender === "admin" ? "Crewkat support" : thread.report.userName} · {formatDateTime(rep.createdAt)}</span>
                  </div>
                ))}
              </div>

              <form className="drawer-section" onSubmit={(e: FormEvent) => { e.preventDefault(); if (reply.trim()) replyMutation.mutate(); }}>
                <h3>Reply</h3>
                <label className="field">
                  <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply — the user gets a push notification." />
                </label>
                <div className="drawer-actions">
                  <button type="submit" className="btn btn-primary btn-small" disabled={!reply.trim() || replyMutation.isPending}>Send reply</button>
                  {thread.report.status === "open" ? (
                    <button type="button" className="btn btn-ghost btn-small" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("resolved")}>Resolve</button>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-small" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("open")}>Reopen</button>
                  )}
                </div>
              </form>

              <div className="drawer-section">
                <h3>Internal notes (team only)</h3>
                <ul className="feed-list">
                  {(notesQuery.data?.notes ?? []).map((n) => (
                    <li key={n.id} className="feed-item">
                      <div className="feed-main">
                        <span className="feed-title">{n.note}</span>
                        <span className="feed-meta">{n.authorName} · {formatDateTime(n.createdAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (note.trim()) noteMutation.mutate(); }}>
                  <label className="field">
                    <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note only the team can see…" />
                  </label>
                  <div className="drawer-actions">
                    <button type="submit" className="btn btn-ghost btn-small" disabled={!note.trim() || noteMutation.isPending}>Add note</button>
                  </div>
                </form>
              </div>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function SupportLookup() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState("");
  const lookupQuery = useQuery({
    queryKey: ["admin-support-lookup", submitted],
    queryFn: () => api.adminSupportView({ email: submitted }),
    enabled: submitted.includes("@"),
  });
  const data = lookupQuery.data;
  return (
    <section className="panel">
      <div className="panel-head"><h2>Support lookup</h2></div>
      <p className="muted">Read-only account snapshot by email. Every lookup is written to the audit log.</p>
      <form className="doc-filter-row" onSubmit={(e: FormEvent) => { e.preventDefault(); setSubmitted(email.trim()); }}>
        <label className="search-box">
          <input type="email" value={email} placeholder="user@example.com" aria-label="Lookup email" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary btn-small" disabled={!email.includes("@")}>Look up</button>
      </form>
      {lookupQuery.isLoading ? <p className="muted">Searching…</p> : null}
      {lookupQuery.isError ? <p className="inline-error">{cleanError(lookupQuery.error)}</p> : null}
      {data && !data.found ? <p className="muted">No account with that email.</p> : null}
      {data?.profile ? (
        <div className="split-layout admin-split">
          <dl className="detail-list">
            <div><dt>Name</dt><dd>{data.profile.name}</dd></div>
            <div><dt>Email</dt><dd>{data.profile.email}</dd></div>
            <div><dt>Plan</dt><dd>{data.profile.subscriptionStatus === "founder" ? "Founder" : `${data.profile.tier} · ${data.profile.subscriptionStatus}`}</dd></div>
            <div><dt>Provider</dt><dd>{data.profile.provider}</dd></div>
            <div><dt>Period end</dt><dd>{data.profile.currentPeriodEnd ? formatDate(data.profile.currentPeriodEnd) : "—"}{data.profile.cancelAtPeriodEnd ? " · cancels" : ""}</dd></div>
            <div><dt>Suspended</dt><dd>{data.profile.suspended ? "Yes" : "No"}</dd></div>
            <div><dt>Joined</dt><dd>{formatDate(data.profile.createdAt)}</dd></div>
          </dl>
          <div>
            {data.counts ? (
              <div className="mini-stats">
                <div><span>Jobs</span><strong>{data.counts.jobs}</strong></div>
                <div><span>Clients</span><strong>{data.counts.clients}</strong></div>
                <div><span>Invoices</span><strong>{data.counts.invoices}</strong></div>
                <div><span>Estimates</span><strong>{data.counts.quotes}</strong></div>
              </div>
            ) : null}
            {data.recentActivity && data.recentActivity.length > 0 ? (
              <div className="drawer-section">
                <h3>Recent automated sends</h3>
                <ul className="feed-list">
                  {data.recentActivity.map((entry, i) => (
                    <li key={i} className="feed-item">
                      <div className="feed-main">
                        <span className="feed-title">{entry.kind}</span>
                        <span className="feed-meta">{entry.channel} · {formatDateTime(entry.sentAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function UserReports() {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const reportsQuery = useQuery({ queryKey: ["admin-user-reports"], queryFn: () => api.adminUserReports({}) });
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["admin-user-reports"] }); };
  const decideMutation = useMutation({
    mutationFn: (args: { reportId: number; decision: "reviewed_ok" | "reviewed_actioned" }) => api.adminUserReportDecide({ ...args, note: "" }),
    onSuccess: () => { setError(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const hideMutation = useMutation({
    mutationFn: (args: { kind: "listing" | "message"; id: number }) => api.adminContentHide({ ...args, reason: "Hidden from the user-reports queue." }),
    onSuccess: () => { setError(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const reports = reportsQuery.data?.reports ?? [];
  return (
    <section className="panel">
      <div className="panel-head"><h2>User reports (marketplace)</h2></div>
      {error ? <p className="inline-error">{error}</p> : null}
      {reportsQuery.isLoading ? <p className="muted">Loading reports…</p> : null}
      {reportsQuery.data && reports.length === 0 ? (
        <div className="empty-state small"><div className="empty-icon">✓</div><p>No open user reports.</p></div>
      ) : null}
      <ul className="feed-list">
        {reports.map((r) => (
          <li key={r.id} className="feed-item">
            <div className="feed-main">
              <span className="feed-title">{r.reason} — {r.targetType} “{r.targetName}”</span>
              <span className="feed-meta">Reported by {r.reporterName} · {formatDate(r.createdAt)}{r.details ? ` · ${r.details}` : ""}</span>
            </div>
            <span className="admin-row-actions">
              {(r.targetType === "listing" || r.targetType === "message") ? (
                <button type="button" className="btn btn-danger-ghost btn-small" disabled={hideMutation.isPending} onClick={() => hideMutation.mutate({ kind: r.targetType as "listing" | "message", id: r.targetId })}>Hide content</button>
              ) : null}
              <button type="button" className="btn btn-ghost btn-small" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate({ reportId: r.id, decision: "reviewed_actioned" })}>Actioned</button>
              <button type="button" className="btn btn-ghost btn-small" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate({ reportId: r.id, decision: "reviewed_ok" })}>No issue</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function VerificationQueue() {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<number, { status: string; note: string }>>({});
  const listQuery = useQuery({ queryKey: ["admin-verifications"], queryFn: () => api.adminVerificationList({}) });
  const setMutation = useMutation({
    mutationFn: (args: { companyId: number; status: "pending" | "verified" | "rejected"; note: string }) => api.adminVerificationSet(args),
    onSuccess: () => { setError(""); void queryClient.invalidateQueries({ queryKey: ["admin-verifications"] }); },
    onError: (e) => setError(cleanError(e)),
  });
  const businesses = listQuery.data?.businesses ?? [];
  return (
    <section className="panel">
      <div className="panel-head"><h2>Business verification</h2></div>
      <p className="muted">Verified businesses get the marketplace trust badge. Status defaults to pending until reviewed.</p>
      {error ? <p className="inline-error">{error}</p> : null}
      {listQuery.isLoading ? <p className="muted">Loading businesses…</p> : null}
      {listQuery.data && businesses.length === 0 ? (
        <div className="empty-state small"><div className="empty-icon">🏪</div><p>No businesses to review yet.</p></div>
      ) : null}
      <ul className="feed-list">
        {businesses.map((b) => {
          const draft = drafts[b.companyId] ?? { status: b.status, note: b.note };
          return (
            <li key={b.companyId} className="feed-item">
              <div className="feed-main">
                <span className="feed-title">{b.companyName || `Company ${b.companyId}`}</span>
                <span className="feed-meta">License {b.licenseNumber || "—"}{b.reviewedAt ? ` · reviewed ${formatDate(b.reviewedAt)} by ${b.reviewedByName ?? "—"}` : ""}</span>
              </div>
              <span className="admin-row-actions">
                <select
                  className="doc-status-select"
                  value={draft.status}
                  aria-label={`Verification status for ${b.companyName}`}
                  onChange={(e) => setDrafts((d) => ({ ...d, [b.companyId]: { status: e.target.value, note: draft.note } }))}
                >
                  <option value="pending">Pending</option>
                  <option value="verified">Verified</option>
                  <option value="rejected">Rejected</option>
                </select>
                <input
                  className="admin-note-input"
                  value={draft.note}
                  placeholder="Reviewer note"
                  aria-label={`Verification note for ${b.companyName}`}
                  onChange={(e) => setDrafts((d) => ({ ...d, [b.companyId]: { status: draft.status, note: e.target.value } }))}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={setMutation.isPending || (draft.status === b.status && draft.note === b.note)}
                  onClick={() => setMutation.mutate({ companyId: b.companyId, status: draft.status as "pending" | "verified" | "rejected", note: draft.note })}
                >Save</button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Broadcasts                                                          */
/* ------------------------------------------------------------------ */

function BroadcastsTab() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [segment, setSegment] = useState<"all" | "pro" | "free">("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const pageSize = 25;

  const flagsQuery = useQuery({ queryKey: ["admin-feature-flags"], queryFn: () => api.adminFeatureFlags({}) });
  const broadcastsOff = flagsQuery.data?.flags.find((f) => f.key === "broadcasts_enabled")?.enabled === false;
  const historyQuery = useQuery({
    queryKey: ["admin-broadcast-history", page],
    queryFn: () => api.adminBroadcastHistory({ page, pageSize }),
  });

  const sendMutation = useMutation({
    mutationFn: () => api.adminBroadcastSend({ title: title.trim(), body: body.trim(), segment }),
    onSuccess: (res) => {
      setConfirming(false);
      setError("");
      setNotice(`Broadcast sent — delivered to ${res.sentCount} of ${res.totalUsers} users in the segment.`);
      setTitle("");
      setBody("");
      void queryClient.invalidateQueries({ queryKey: ["admin-broadcast-history"] });
    },
    onError: (e) => { setConfirming(false); setError(cleanError(e)); },
  });

  return (
    <div className="admin-stack">
      <section className="panel">
        <div className="panel-head"><h2>Send a broadcast</h2></div>
        <p className="muted">Push notification to app users. Sends are capped per user by the abuse controls, and every broadcast is recorded below and in the audit log.</p>
        {broadcastsOff ? <p className="inline-notice">Broadcasts are currently disabled by the broadcasts_enabled flag — sending is blocked server-side. Turn it on under Flags &amp; settings.</p> : null}
        {error ? <p className="inline-error">{error}</p> : null}
        {notice ? <p className="inline-ok">{notice}</p> : null}
        <form className="form-grid" onSubmit={(e: FormEvent) => { e.preventDefault(); setError(""); setNotice(""); setConfirming(true); }}>
          <label className="field span2">
            <span>Title</span>
            <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New: Production Board in Office" required />
          </label>
          <label className="field span2">
            <span>Message</span>
            <textarea rows={3} value={body} maxLength={500} onChange={(e) => setBody(e.target.value)} placeholder="What should users know?" required />
          </label>
          <label className="field">
            <span>Audience</span>
            <select value={segment} onChange={(e) => setSegment(e.target.value as "all" | "pro" | "free")}>
              <option value="all">All users</option>
              <option value="pro">Premium only</option>
              <option value="free">Free only</option>
            </select>
          </label>
          <div className="field">
            <span>&nbsp;</span>
            <button type="submit" className="btn btn-primary" disabled={broadcastsOff || !title.trim() || !body.trim()}>Review &amp; send…</button>
          </div>
        </form>
      </section>

      <section className="panel table-panel">
        <div className="panel-head"><h2>Broadcast history</h2></div>
        {historyQuery.isLoading ? <div className="view-loading">Loading history…</div> : null}
        {historyQuery.isError ? <p className="inline-error">Couldn't load broadcast history.</p> : null}
        {historyQuery.data && historyQuery.data.entries.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">📣</div><p>No broadcasts sent yet.</p></div>
        ) : null}
        {historyQuery.data && historyQuery.data.entries.length > 0 ? (
          <>
            <table className="data-table">
              <thead><tr><th>Title</th><th>Message</th><th>Segment</th><th>Delivered</th><th>Sent</th></tr></thead>
              <tbody>
                {historyQuery.data.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="doc-title-cell">{entry.title}</td>
                    <td className="cell-address">{entry.body}</td>
                    <td>{entry.segment}</td>
                    <td className="num">{entry.sentCount}</td>
                    <td>{formatDateTime(entry.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={page} pageSize={pageSize} total={historyQuery.data.total} onPage={setPage} />
          </>
        ) : null}
      </section>

      {confirming ? (
        <ConfirmDialog
          title="Send this broadcast?"
          body={`"${title.trim()}" will be pushed to the ${segment === "all" ? "all users" : segment === "pro" ? "premium" : "free"} segment right away. This can't be unsent.`}
          confirmLabel="Send broadcast"
          busy={sendMutation.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => sendMutation.mutate()}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Flags & settings                                                    */
/* ------------------------------------------------------------------ */

function FlagsTab() {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const flagsQuery = useQuery({ queryKey: ["admin-feature-flags"], queryFn: () => api.adminFeatureFlags({}) });
  const setMutation = useMutation({
    mutationFn: (args: { key: "marketplace_enabled" | "signups_enabled" | "broadcasts_enabled"; enabled: boolean }) => api.adminFeatureFlagSet(args),
    onSuccess: () => { setError(""); void queryClient.invalidateQueries({ queryKey: ["admin-feature-flags"] }); },
    onError: (e) => setError(cleanError(e)),
  });
  const flags = flagsQuery.data?.flags ?? [];
  return (
    <div className="admin-stack">
      <section className="panel">
        <div className="panel-head"><h2>Feature flags</h2></div>
        <p className="muted">Platform-wide switches. Turning one off takes effect immediately for every user — the server enforces these, not the apps.</p>
        {error ? <p className="inline-error">{error}</p> : null}
        {flagsQuery.isLoading ? <p className="muted">Loading flags…</p> : null}
        {flagsQuery.isError ? <p className="inline-error">Couldn't load the feature flags.</p> : null}
        <div className="automation-list">
          {flags.map((flag) => (
            <div key={flag.key} className="automation-row">
              <div className="feed-main">
                <span className="feed-title">{flag.key}</span>
                <span className="feed-meta block">{flag.description} · updated {formatDateTime(flag.updatedAt)}</span>
              </div>
              <label className="access-switch-row">
                <input
                  type="checkbox"
                  checked={flag.enabled}
                  disabled={setMutation.isPending}
                  onChange={(e) => setMutation.mutate({ key: flag.key as "marketplace_enabled" | "signups_enabled" | "broadcasts_enabled", enabled: e.target.checked })}
                />
                <span>{flag.enabled ? "On" : "Off"}</span>
              </label>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Team roles                                                          */
/* ------------------------------------------------------------------ */

function TeamTab({ role, selfUserId }: { role: PlatformRole; selfUserId: number }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [pickUserId, setPickUserId] = useState<number | "">("");
  const [pickRole, setPickRole] = useState<"support" | "moderator">("support");
  const [revoking, setRevoking] = useState<{ userId: number; name: string } | null>(null);

  const teamQuery = useQuery({ queryKey: ["admin-team-list"], queryFn: () => api.adminTeamList({}) });
  const candidatesQuery = useQuery({
    queryKey: ["admin-team-candidates", debouncedSearch],
    queryFn: () => api.adminUsersList({ search: debouncedSearch, tier: "all", status: "all", page: 1, pageSize: 10 }),
    enabled: role === "admin" && debouncedSearch.trim().length >= 2,
  });

  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["admin-team-list"] }); };
  const grantMutation = useMutation({
    mutationFn: () => api.adminTeamSetRole({ userId: pickUserId as number, role: pickRole }),
    onSuccess: () => { setError(""); setPickUserId(""); setSearch(""); invalidate(); },
    onError: (e) => setError(cleanError(e)),
  });
  const revokeMutation = useMutation({
    mutationFn: (userId: number) => api.adminTeamRemoveRole({ userId }),
    onSuccess: () => { setError(""); setRevoking(null); invalidate(); },
    onError: (e) => { setRevoking(null); setError(cleanError(e)); },
  });

  const members = teamQuery.data?.members ?? [];
  const candidates = (candidatesQuery.data?.users ?? []).filter((c) => !c.isPlatformAdmin && !members.some((m) => m.userId === c.id));

  return (
    <div className="admin-stack">
      <section className="panel table-panel">
        <div className="panel-head"><h2>Platform team</h2></div>
        <p className="muted admin-panel-note">Platform admins (flag on their account) always have full access. Team roles scope a hired manager's access: <strong>support</strong> works the inbox and can suspend accounts; <strong>moderator</strong> handles marketplace reports. Full “admin” team access comes from the platform-admin flag, not a team role.</p>
        {error ? <p className="inline-error">{error}</p> : null}
        {teamQuery.isLoading ? <div className="view-loading">Loading team…</div> : null}
        {teamQuery.data && members.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">👤</div><p>No platform team members yet.</p></div>
        ) : null}
        {members.length > 0 ? (
          <table className="data-table">
            <thead><tr><th>Member</th><th>Role</th><th>Granted by</th><th>Since</th><th></th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={`${m.userId}-${m.role}`}>
                  <td>
                    <span className="cell-person">{m.name}</span>
                    <span className="feed-meta block">{m.email}</span>
                  </td>
                  <td><span className="status-pill">{m.role}</span></td>
                  <td>{m.grantedByName ?? "—"}</td>
                  <td>{m.createdAt ? formatDate(m.createdAt) : "—"}</td>
                  <td className="num">
                    {role === "admin" && m.userId !== selfUserId && m.createdAt !== "" ? (
                      <button type="button" className="btn btn-danger-ghost btn-small" onClick={() => setRevoking({ userId: m.userId, name: m.name })}>Revoke</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {role === "admin" ? (
        <section className="panel">
          <div className="panel-head"><h2>Grant a team role</h2></div>
          <div className="form-grid">
            <label className="field">
              <span>Find the user (name or email)</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type at least 2 characters…" />
            </label>
            <label className="field">
              <span>Role</span>
              <select value={pickRole} onChange={(e) => setPickRole(e.target.value as "support" | "moderator")}>
                <option value="support">Support</option>
                <option value="moderator">Moderator</option>
              </select>
            </label>
            <label className="field span2">
              <span>Account</span>
              <select value={pickUserId} onChange={(e) => setPickUserId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">{debouncedSearch.trim().length < 2 ? "Search first…" : candidates.length === 0 ? "No matching accounts" : "Select an account…"}</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}
              </select>
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" disabled={pickUserId === "" || grantMutation.isPending} onClick={() => grantMutation.mutate()}>
              {grantMutation.isPending ? "Granting…" : `Grant ${pickRole}`}
            </button>
          </div>
        </section>
      ) : (
        <p className="muted small">Only platform admins can grant or revoke team roles.</p>
      )}

      {revoking ? (
        <ConfirmDialog
          title="Revoke this team role?"
          body={`${revoking.name} will immediately lose their platform team access. Their Crewkat account itself is untouched.`}
          confirmLabel="Revoke role"
          danger
          busy={revokeMutation.isPending}
          onCancel={() => setRevoking(null)}
          onConfirm={() => revokeMutation.mutate(revoking.userId)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Audit log                                                           */
/* ------------------------------------------------------------------ */

function AuditTab() {
  const [action, setAction] = useState("");
  const debouncedAction = useDebounced(action);
  const [targetType, setTargetType] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const logQuery = useQuery({
    queryKey: ["admin-audit-log", debouncedAction, targetType, page],
    queryFn: () => api.adminAuditLogSearch({ action: debouncedAction, targetType, page, pageSize }),
  });
  const entries = logQuery.data?.entries ?? [];
  return (
    <div className="admin-stack">
      <div className="doc-filter-row">
        <label className="search-box">
          <input value={action} placeholder="Filter by action (e.g. user.suspend)…" aria-label="Filter audit log by action" onChange={(e) => { setAction(e.target.value); setPage(1); }} />
        </label>
        <select className="doc-status-select" value={targetType} aria-label="Filter by target type" onChange={(e) => { setTargetType(e.target.value); setPage(1); }}>
          <option value="">All target types</option>
          <option value="auth_user">User</option>
          <option value="platform_support_report">Support ticket</option>
          <option value="marketplace_listing">Listing</option>
          <option value="marketplace_message">Message</option>
          <option value="user_report">User report</option>
          <option value="feature_flag">Feature flag</option>
          <option value="business">Business</option>
          <option value="broadcast">Broadcast</option>
          <option value="platform_setting">Platform setting</option>
        </select>
      </div>
      <section className="panel table-panel">
        {logQuery.isLoading ? <div className="view-loading">Loading audit log…</div> : null}
        {logQuery.isError ? <p className="inline-error">Couldn't load the audit log.</p> : null}
        {logQuery.data && entries.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">📜</div><p>No admin actions recorded for those filters.</p></div>
        ) : null}
        {entries.length > 0 ? (
          <>
            <table className="data-table">
              <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.createdAt)}</td>
                    <td>{entry.adminName}</td>
                    <td className="doc-title-cell">{entry.action}</td>
                    <td>{entry.targetType} #{entry.targetId}</td>
                    <td className="cell-address">{entry.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={page} pageSize={pageSize} total={logQuery.data?.total ?? 0} onPage={setPage} />
          </>
        ) : null}
      </section>
    </div>
  );
}
