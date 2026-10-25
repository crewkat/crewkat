import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  AUTH_SESSION_INVALID_EVENT,
  clearActiveSessionToken,
  getStoredSessionToken,
  isCookieLoginResult,
  persistLegacySessionToken,
  restoreLegacySessionToken,
  setActiveSessionToken,
  trySilentRefresh,
} from "./api";
import type { AuthUser, ViewKey } from "./types";
import { STAGE_LABELS } from "./types";
import { cleanError, initials } from "./utils";
import { ClientsView } from "./views/Clients";
import { DashboardView } from "./views/Dashboard";
import { DocumentsView, type DocSelection } from "./views/Documents";
import { JobsView } from "./views/Jobs";
import { MarketplaceView } from "./views/Marketplace";
import { MoneyView } from "./views/Money";
import { PipelineView } from "./views/Pipeline";
import { ScheduleView } from "./views/Schedule";
import { SettingsView } from "./views/Settings";
import { TeamView } from "./views/Team";
import crewkatC from "./assets/crewkat-c.png";
import mascotIpad from "./assets/mascot-ipad.webp";

const NAV: { key: ViewKey; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "▦" },
  { key: "pipeline", label: "Pipeline", icon: "▤" },
  { key: "clients", label: "Clients", icon: "👥" },
  { key: "jobs", label: "Jobs", icon: "🛠" },
  { key: "documents", label: "Documents", icon: "📄" },
  { key: "schedule", label: "Schedule", icon: "📅" },
  { key: "marketplace", label: "Marketplace", icon: "🏪" },
  { key: "money", label: "Money & billing", icon: "$" },
  { key: "settings", label: "Settings", icon: "⚙" },
  // Track 1c: Team is Admin-only — filtered out of the nav for other
  // roles below (cosmetic; the server gates the team actions regardless).
  { key: "team", label: "Team", icon: "👤" },
];

const PHASE2_NAV = ["Reports", "Automations"];

export function App() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [view, setView] = useState<ViewKey>("dashboard");
  const [focusLeadId, setFocusLeadId] = useState<number | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocSelection | null>(null);

  // Session restore — mirrors the phone client (app/client/src/App.tsx
  // AuthScreen + api.ts): a legacy pre-cookie token if one is stored,
  // otherwise a silent refresh via the HttpOnly cookie (refreshSession),
  // then getAuthSession to load the user. getAuthBootstrap is only an
  // anonymous has-account probe and plays no part in restore.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const legacy = getStoredSessionToken();
      if (legacy) {
        restoreLegacySessionToken(legacy);
        try {
          const result = await api.getAuthSession({ _sessionToken: "active" });
          if (cancelled) return;
          if (result.user) { setUser(result.user as AuthUser); setRestoring(false); return; }
          clearActiveSessionToken();
        } catch { /* transport failure is not an auth verdict — try the cookie path */ }
      }
      const refreshed = await trySilentRefresh(Boolean(legacy)).catch(() => false);
      if (cancelled) return;
      if (refreshed) {
        try {
          const result = await api.getAuthSession({ _sessionToken: "active" });
          if (cancelled) return;
          if (result.user) { setUser(result.user as AuthUser); setRestoring(false); return; }
        } catch { /* fall through to sign-in */ }
      }
      if (!cancelled) setRestoring(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onInvalid = () => setUser(null);
    window.addEventListener(AUTH_SESSION_INVALID_EVENT, onInvalid);
    return () => window.removeEventListener(AUTH_SESSION_INVALID_EVENT, onInvalid);
  }, []);

  const signOut = useCallback(async () => {
    try { await api.logout({ _sessionToken: "active" }); } catch { /* already out */ }
    clearActiveSessionToken();
    queryClient.clear();
    setUser(null);
    setView("dashboard");
    setSelectedClientId(null);
    setSelectedJobId(null);
    setSelectedDoc(null);
    setFocusLeadId(null);
  }, [queryClient]);

  const openJob = useCallback((jobId: number) => { setSelectedJobId(jobId); setView("jobs"); }, []);
  const openClient = useCallback((clientId: number) => { setSelectedClientId(clientId); setView("clients"); }, []);
  const openDocument = useCallback((sel: DocSelection) => { setSelectedDoc(sel); setView("documents"); }, []);
  const openLead = useCallback((leadId: number) => { setFocusLeadId(leadId); setView("pipeline"); }, []);
  const consumeFocus = useCallback(() => setFocusLeadId(null), []);

  if (restoring) {
    return (
      <main className="login-page">
        <div className="login-card restoring">
          <img src={crewkatC} alt="Crewkat" className="login-logo" />
          <p className="muted">Restoring your session…</p>
        </div>
      </main>
    );
  }

  if (!user) return <LoginScreen onAuthenticated={setUser} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={crewkatC} alt="Crewkat" className="brand-logo" />
          <div className="brand-words">
            <span className="brand-name">Crewkat</span>
            <span className="brand-sub">OFFICE</span>
          </div>
        </div>
        <nav className="nav" aria-label="Office">
          {NAV.filter((item) => item.key !== "team" || user.teamRole === "admin").map((item) => (
            <button
              key={item.key}
              type="button"
              className={`nav-item${view === item.key ? " active" : ""}`}
              onClick={() => setView(item.key)}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
          <div className="nav-group-label">Phase 2</div>
          {PHASE2_NAV.map((label) => (
            <span key={label} className="nav-item disabled" aria-disabled="true" title="Coming in Phase 2">
              <span className="nav-icon" aria-hidden="true">·</span>
              {label}
              <span className="phase-tag">Soon</span>
            </span>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="muted small">Crewkat Office · Phase 1</span>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <GlobalSearch onOpenLead={openLead} onOpenClient={openClient} onOpenJob={openJob} />
          <UserChip user={user} onSignOut={() => void signOut()} />
        </header>
        <main className="content">
          {view === "dashboard" ? (
            <DashboardView onGoPipeline={() => setView("pipeline")} onGoJobs={() => setView("jobs")} />
          ) : null}
          {view === "pipeline" ? (
            <PipelineView focusLeadId={focusLeadId} onOpenJob={openJob} onConsumeFocus={consumeFocus} canDelete={user.teamRole === "admin"} />
          ) : null}
          {view === "clients" ? (
            <ClientsView selectedClientId={selectedClientId} onSelectClient={setSelectedClientId} onOpenJob={openJob} onOpenDocument={openDocument} />
          ) : null}
          {view === "jobs" ? (
            <JobsView selectedJobId={selectedJobId} onSelectJob={setSelectedJobId} onOpenDocument={openDocument} canDelete={user.teamRole === "admin"} />
          ) : null}
          {view === "documents" ? (
            <DocumentsView
              selected={selectedDoc}
              onSelect={setSelectedDoc}
              onOpenJob={openJob}
              onOpenClient={openClient}
              userName={user.name}
              canDelete={user.teamRole === "admin"}
            />
          ) : null}
          {view === "schedule" ? <ScheduleView onOpenJob={openJob} canDelete={user.teamRole === "admin"} /> : null}
          {view === "marketplace" ? <MarketplaceView /> : null}
          {view === "money" ? <MoneyView onOpenDocument={openDocument} /> : null}
          {view === "settings" ? <SettingsView /> : null}
          {view === "team" && user.teamRole === "admin" ? <TeamView /> : null}
        </main>
      </div>
    </div>
  );
}

function UserChip({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const settingsQuery = useQuery({
    queryKey: ["settings-company"],
    queryFn: () => api.getSettings({}),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const company = settingsQuery.data?.companyName?.trim() || "Your company";
  return (
    <div className="user-chip">
      <span className="avatar avatar-navy">{initials(user.name || user.email)}</span>
      <span className="user-chip-text">
        <strong>{company}</strong>
        <small>{user.name} · {user.email}</small>
      </span>
      <button type="button" className="btn btn-ghost btn-small" onClick={onSignOut}>Sign out</button>
    </div>
  );
}

function GlobalSearch({
  onOpenLead,
  onOpenClient,
  onOpenJob,
}: {
  onOpenLead: (id: number) => void;
  onOpenClient: (id: number) => void;
  onOpenJob: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const boxRef = useRef<HTMLDivElement>(null);

  const searchQuery = useQuery({
    queryKey: ["office-search", debounced],
    queryFn: () => api.getOfficeSearch({ query: debounced }),
    enabled: debounced.trim().length >= 2,
  });
  const results = searchQuery.data;
  const hasResults = !!results && (results.leads.length + results.clients.length + results.jobs.length > 0);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (fn: (id: number) => void, id: number) => { setOpen(false); setQuery(""); setDebounced(""); fn(id); };

  return (
    <div className="global-search" ref={boxRef}>
      <span className="search-glyph" aria-hidden="true">⌕</span>
      <input
        value={query}
        placeholder="Search leads, clients, jobs…"
        aria-label="Search leads, clients, jobs"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDebounced(e.target.value), 250);
        }}
      />
      {open && debounced.trim().length >= 2 ? (
        <div className="search-dropdown">
          {searchQuery.isLoading ? <p className="search-note">Searching…</p> : null}
          {searchQuery.isError ? <p className="search-note">Search isn't available right now.</p> : null}
          {results && !hasResults && !searchQuery.isLoading ? <p className="search-note">No matches for “{debounced}”.</p> : null}
          {results && results.leads.length > 0 ? (
            <div className="search-group">
              <span className="search-group-label">Leads</span>
              {results.leads.slice(0, 5).map((l) => (
                <button key={l.id} type="button" className="search-result" onClick={() => go(onOpenLead, l.id)}>
                  <span>{l.name}</span>
                  <small>{[l.phone, STAGE_LABELS[l.stage] ?? l.stage].filter(Boolean).join(" · ")}</small>
                </button>
              ))}
            </div>
          ) : null}
          {results && results.clients.length > 0 ? (
            <div className="search-group">
              <span className="search-group-label">Clients</span>
              {results.clients.slice(0, 5).map((c) => (
                <button key={c.id} type="button" className="search-result" onClick={() => go(onOpenClient, c.id)}>
                  <span>{c.name}</span>
                  <small>{[c.phone, c.email].filter(Boolean).join(" · ")}</small>
                </button>
              ))}
            </div>
          ) : null}
          {results && results.jobs.length > 0 ? (
            <div className="search-group">
              <span className="search-group-label">Jobs</span>
              {results.jobs.slice(0, 5).map((j) => (
                <button key={j.id} type="button" className="search-result" onClick={() => go(onOpenJob, j.id)}>
                  <span>{j.clientName || "Job"} · {j.jobType}</span>
                  <small>{j.jobAddress}</small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [crewMode, setCrewMode] = useState(false);
  const [companyCode, setCompanyCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [totpNotice, setTotpNotice] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setTotpNotice(false);
    try {
      if (crewMode) {
        // Tier 2 crew sign-in: company code + personal PIN, no email.
        const result = await api.crewLogin({ companyCode: companyCode.trim(), pin });
        if (isCookieLoginResult(result)) setActiveSessionToken(result.sessionToken);
        else persistLegacySessionToken(result.sessionToken);
        onAuthenticated(result.user as AuthUser);
        return;
      }
      const result = await api.login({ email: email.trim(), password });
      if (result.totpRequired) {
        // Platform-team 2FA accounts finish sign-in in the phone app flow;
        // Office deliberately does not build a TOTP step in Phase 1.
        setTotpNotice(true);
        return;
      }
      if (isCookieLoginResult(result)) setActiveSessionToken(result.sessionToken);
      else persistLegacySessionToken(result.sessionToken);
      onAuthenticated(result.user as AuthUser);
    } catch (caught) {
      setError(cleanError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <img src={crewkatC} alt="Crewkat" className="login-logo" />
        <h1 className="login-wordmark">Crewkat <span>Office</span></h1>
        <img src={mascotIpad} alt="Crewkat cat mascot holding a tablet with the Office dashboard" className="login-mascot" />
        <p className="login-sub">{crewMode ? "Crew member sign-in — use the company code and PIN your admin gave you." : "The desktop back office for your Crewkat account."}</p>
        {crewMode ? (
          <>
            <label className="field">
              <span>Company code</span>
              <input autoComplete="off" value={companyCode} onChange={(e) => setCompanyCode(e.target.value.toUpperCase())} required placeholder="e.g. WK7P-2QXR" />
            </label>
            <label className="field">
              <span>Your PIN</span>
              <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,6}" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} required placeholder="6-digit PIN" />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>Email</span>
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Your password" />
            </label>
          </>
        )}
        {totpNotice ? (
          <p className="inline-notice">This account requires two-factor authentication. Please sign in with the Crewkat phone app to complete the 2FA flow.</p>
        ) : null}
        {error ? <p className="inline-error">{error}</p> : null}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="login-foot muted">
          {crewMode ? (
            <button type="button" className="link-button" onClick={() => { setCrewMode(false); setError(""); }}>← Back to email sign-in</button>
          ) : (
            <>
              Same account as the Crewkat mobile app.{" "}
              <button type="button" className="link-button" onClick={() => { setCrewMode(true); setError(""); }}>Crew member? Sign in with a code →</button>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
