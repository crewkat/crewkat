import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, type FormEvent } from "react";
import { api } from "../api";
import {
  ACCESS_SWITCH_DEFS,
  ROLE_ACCESS_PRESETS,
  TEAM_ROLE_DESCRIPTIONS,
  TEAM_ROLE_LABELS,
  type AccessOverrides,
  type AccessSwitch,
  type StaffRole,
  type TeamMember,
} from "../types";
import { cleanError, formatDate, initials } from "../utils";

const ROLE_OPTIONS: StaffRole[] = ["admin", "office", "field"];

/**
 * Team & staff accounts (Track 1c) + Tier 2 crew logins and access
 * switches. Admin-only surface: the nav item is hidden for Office/Field
 * logins, and the server enforces the same gate in the action layer
 * (team actions are ADMIN_ACTIONS in server/src/permissions.ts, and the
 * per-member switches are consulted inside protectActions) — this view
 * is the cosmetic layer, never the enforcement.
 *
 * Two kinds of logins live here:
 * - Staff logins (1c): email + password accounts with a role.
 * - Crew logins (Tier 2): no email, no password. The member signs in
 *   with the company crew code (shown above, shared by the whole
 *   company) + their personal PIN. The PIN is minted server-side and
 *   shown here exactly once — at creation and at reset.
 */
export function TeamView() {
  const queryClient = useQueryClient();
  const teamQuery = useQuery({ queryKey: ["team-members"], queryFn: () => api.listTeamMembers({}) });
  const members = teamQuery.data?.members ?? [];
  const crewCode = teamQuery.data?.crewCode ?? "";
  const tier = teamQuery.data?.tier ?? "office";
  const officeTier = tier === "office";

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["team-members"] });

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Team</h1>
          <p className="view-sub">
            Everyone who can sign in to your company. Roles and access switches are enforced by the server
            on every action — hiding a screen is never the security, the role is.
          </p>
        </div>
      </div>

      {teamQuery.data && !officeTier ? (
        <section className="panel tier-upgrade">
          <h2>Team logins are a Crewkat Office feature</h2>
          <p className="muted">
            This company is on the App plan (single user). Upgrade to Crewkat Office to add staff and crew
            logins, set per-person access switches, and use this Team section. Your existing logins keep
            working either way — nobody gets locked out.
          </p>
        </section>
      ) : null}

      {teamQuery.data && officeTier && crewCode ? (
        <section className="panel crew-code-card">
          <div>
            <h2>Crew sign-in code</h2>
            <p className="muted small">
              Crew members sign in on the app's <strong>Crew member sign-in</strong> screen with this company
              code plus their own PIN — no email, no password. The code is the same for the whole company;
              the PIN is what tells members apart.
            </p>
          </div>
          <span className="crew-code" aria-label={`Company crew code ${crewCode}`}>{crewCode}</span>
        </section>
      ) : null}

      <div className="team-grid">
        <section className="panel table-panel">
          <div className="panel-head team-panel-head">
            <h2>Team members</h2>
            <span className="muted small">{members.length} login{members.length === 1 ? "" : "s"}</span>
          </div>
          {teamQuery.isLoading ? <p className="view-loading">Loading team…</p> : null}
          {teamQuery.isError ? (
            <div className="empty-state small">
              <div className="empty-icon">👤</div>
              <p>Couldn't load the team list.</p>
              <button type="button" className="btn btn-primary" onClick={() => void teamQuery.refetch()}>Try again</button>
            </div>
          ) : null}
          {teamQuery.data ? (
            <table className="data-table team-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Since</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <MemberRow key={member.id} member={member} crewCode={crewCode} onChanged={invalidate} />
                ))}
              </tbody>
            </table>
          ) : null}
          <div className="team-role-notes">
            {ROLE_OPTIONS.map((role) => (
              <p key={role} className="small">
                <strong>{TEAM_ROLE_LABELS[role]}:</strong> <span className="muted">{TEAM_ROLE_DESCRIPTIONS[role]}</span>
              </p>
            ))}
          </div>
        </section>

        {officeTier ? (
          <div className="team-add-column">
            <AddStaffPanel onCreated={invalidate} />
            <AddCrewPanel crewCode={crewCode} onCreated={invalidate} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MemberRow({ member, crewCode, onChanged }: { member: TeamMember; crewCode: string; onChanged: () => void }) {
  const [error, setError] = useState("");
  const [accessOpen, setAccessOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: (args: { role?: StaffRole; active?: boolean }) =>
      api.updateStaffMember({ userId: member.id, ...args }),
    onSuccess: () => { setError(""); onChanged(); },
    onError: (e) => setError(cleanError(e)),
  });
  const locked = member.isSelf || member.role === "owner";
  const isCrew = member.credentialType === "crew_pin";

  return (
    <Fragment>
      <tr>
        <td>
          <span className="cell-person">
            <span className="avatar">{initials(member.name || member.email)}</span>
            <span>
              {member.name}
              {member.isSelf ? <span className="chip chip-primary">You</span> : null}
              {isCrew ? <span className="chip">Crew login</span> : null}
              <small className="feed-meta block">{isCrew ? "Signs in with the crew code + PIN" : member.email}</small>
            </span>
          </span>
          {error ? <p className="inline-error">{error}</p> : null}
        </td>
        <td>
          {locked ? (
            <span className="status-pill sent">{member.role === "owner" ? "Owner · Admin" : TEAM_ROLE_LABELS[member.teamRole]}</span>
          ) : (
            <select
              className="team-role-select"
              value={member.teamRole}
              disabled={mutation.isPending}
              aria-label={`Role for ${member.name}`}
              onChange={(e) => mutation.mutate({ role: e.target.value as StaffRole })}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>{TEAM_ROLE_LABELS[role]}</option>
              ))}
            </select>
          )}
        </td>
        <td>
          {member.active
            ? <span className="status-pill done">Active</span>
            : <span className="status-pill overdue">Deactivated</span>}
        </td>
        <td className="muted">{formatDate(member.createdAt)}</td>
        <td className="num">
          <span className="team-row-actions">
            {!locked ? (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                aria-expanded={accessOpen}
                onClick={() => setAccessOpen((open) => !open)}
              >
                Access {accessOpen ? "▴" : "▾"}
              </button>
            ) : null}
            {locked ? (
              <span className="muted small">{member.role === "owner" ? "Account owner" : ""}</span>
            ) : member.active ? (
              <button
                type="button"
                className="btn btn-danger-ghost btn-small"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ active: false })}
              >
                Deactivate
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ active: true })}
              >
                Reactivate
              </button>
            )}
          </span>
        </td>
      </tr>
      {accessOpen && !locked ? (
        <tr className="access-row-wrap">
          <td colSpan={5}>
            <AccessPanel member={member} crewCode={crewCode} onChanged={onChanged} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

/**
 * The per-member switch panel: each of the five access switches is a
 * three-way choice — "Role default" (no override stored), On, or Off.
 * The effective values (what the member can actually do right now) are
 * summarized as chips at the top; the server resolves and enforces
 * them, this panel only writes the admin's choices.
 */
function AccessPanel({ member, crewCode, onChanged }: { member: TeamMember; crewCode: string; onChanged: () => void }) {
  const [error, setError] = useState("");
  const [newPin, setNewPin] = useState("");
  const accessMutation = useMutation({
    mutationFn: (patch: Partial<Record<AccessSwitch, boolean | null>>) =>
      api.setMemberAccess({ userId: member.id, overrides: patch }),
    onSuccess: () => { setError(""); onChanged(); },
    onError: (e) => setError(cleanError(e)),
  });
  const pinMutation = useMutation({
    mutationFn: () => api.resetCrewPin({ userId: member.id }),
    onSuccess: (result) => { setError(""); setNewPin(result.pin); },
    onError: (e) => setError(cleanError(e)),
  });
  const preset = ROLE_ACCESS_PRESETS[member.teamRole];
  const isCrew = member.credentialType === "crew_pin";

  return (
    <div className="access-panel">
      <div className="access-summary">
        <span className="small muted">Can actually do:</span>
        {ACCESS_SWITCH_DEFS.map((def) => (
          <span key={def.key} className={`chip ${member.access[def.key] ? "chip-primary" : "chip-off"}`}>
            {def.label.replace(/^See |^Send |^Record /, "")}: {member.access[def.key] ? "Yes" : "No"}
          </span>
        ))}
      </div>
      <div className="access-switches">
        {ACCESS_SWITCH_DEFS.map((def) => {
          const override = member.overrides[def.key];
          const value = override === undefined ? "preset" : override ? "on" : "off";
          return (
            <label key={def.key} className="access-switch-row">
              <span>
                <strong>{def.label}</strong>
                <small className="feed-meta block">{def.hint}</small>
              </span>
              <select
                value={value}
                disabled={accessMutation.isPending}
                aria-label={`${def.label} for ${member.name}`}
                onChange={(e) => {
                  const next = e.target.value;
                  accessMutation.mutate({ [def.key]: next === "preset" ? null : next === "on" });
                }}
              >
                <option value="preset">Role default ({preset[def.key] ? "On" : "Off"})</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </label>
          );
        })}
      </div>
      {isCrew ? (
        <div className="access-pin">
          <div>
            <strong>Crew PIN</strong>
            <p className="muted small">
              {member.name} signs in with company code <strong>{crewCode}</strong> + their PIN.
              Resetting issues a new PIN and the old one stops working right away.
            </p>
            {newPin ? (
              <p className="pin-reveal" role="status">
                New PIN for {member.name}: <strong>{newPin}</strong>
                <small className="block">Shown once — hand it to {member.name} now. It won't be displayed again.</small>
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={pinMutation.isPending}
            onClick={() => pinMutation.mutate()}
          >
            {pinMutation.isPending ? "Resetting…" : "Reset PIN"}
          </button>
        </div>
      ) : null}
      {error ? <p className="inline-error">{error}</p> : null}
    </div>
  );
}

function AddStaffPanel({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("field");
  const [error, setError] = useState("");
  const [createdName, setCreatedName] = useState("");

  const mutation = useMutation({
    mutationFn: () => api.createStaffAccount({ name: name.trim(), email: email.trim(), password, role }),
    onSuccess: () => {
      setCreatedName(name.trim());
      setName("");
      setEmail("");
      setPassword("");
      setRole("field");
      setError("");
      onCreated();
    },
    onError: (e) => { setCreatedName(""); setError(cleanError(e)); },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Add a staff login</h2>
      </div>
      <p className="muted small team-add-note">
        They sign in with this email and password — in the phone app or here in Office — and land
        scoped to the role you pick. They can reset the password from the sign-in screen anytime.
      </p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="e.g. Maria Lopez" autoComplete="off" />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="them@company.com" autoComplete="off" />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} placeholder="At least 10 characters" autoComplete="new-password" />
          </label>
          <label className="field">
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{TEAM_ROLE_LABELS[r]}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="small muted team-role-desc">{TEAM_ROLE_DESCRIPTIONS[role]}</p>
        {createdName ? <p className="inline-ok">{createdName} can sign in now.</p> : null}
        {error ? <p className="inline-error">{error}</p> : null}
        <div className="modal-actions">
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create login"}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Add a crew login (Tier 2): name + the five switches, nothing else.
 * The server mints the PIN; the success card shows the company code +
 * PIN once so the admin can hand them over (text, paper, in person).
 */
function AddCrewPanel({ crewCode, onCreated }: { crewCode: string; onCreated: () => void }) {
  const preset = ROLE_ACCESS_PRESETS.field;
  const [name, setName] = useState("");
  const [switches, setSwitches] = useState({ ...preset });
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<{ name: string; pin: string; crewCode: string } | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const overrides: AccessOverrides = {};
      for (const def of ACCESS_SWITCH_DEFS) {
        if (switches[def.key] !== preset[def.key]) overrides[def.key] = switches[def.key];
      }
      return api.createCrewLogin({ name: name.trim(), overrides });
    },
    onSuccess: (result) => {
      setIssued({ name: name.trim(), pin: result.pin, crewCode: result.crewCode });
      setName("");
      setSwitches({ ...preset });
      setError("");
      onCreated();
    },
    onError: (e) => { setIssued(null); setError(cleanError(e)); },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Add a crew login</h2>
      </div>
      <p className="muted small team-add-note">
        For crew and foremen: no email, no password. They sign in on the app's crew screen with the
        company code and a PIN we generate — you hand both to them. They land on a simple field home:
        today's jobs, photos, messages, daily log, schedule.
      </p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="e.g. Jorge Diaz" autoComplete="off" />
          </label>
        </div>
        <div className="access-switches">
          {ACCESS_SWITCH_DEFS.map((def) => (
            <label key={def.key} className="access-switch-row">
              <span>
                <strong>{def.label}</strong>
                <small className="feed-meta block">{def.hint}</small>
              </span>
              <input
                type="checkbox"
                checked={switches[def.key]}
                aria-label={`${def.label} for the new crew member`}
                onChange={(e) => setSwitches((current) => ({ ...current, [def.key]: e.target.checked }))}
              />
            </label>
          ))}
        </div>
        {issued ? (
          <p className="pin-reveal" role="status">
            {issued.name} can sign in now — company code <strong>{issued.crewCode || crewCode}</strong>, PIN <strong>{issued.pin}</strong>
            <small className="block">Shown once — hand both to {issued.name} now. The PIN won't be displayed again (you can reset it anytime from their Access panel).</small>
          </p>
        ) : null}
        {error ? <p className="inline-error">{error}</p> : null}
        <div className="modal-actions">
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create crew login"}
          </button>
        </div>
      </form>
    </section>
  );
}
