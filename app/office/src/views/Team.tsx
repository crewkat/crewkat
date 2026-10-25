import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../api";
import {
  TEAM_ROLE_DESCRIPTIONS,
  TEAM_ROLE_LABELS,
  type StaffRole,
  type TeamMember,
} from "../types";
import { cleanError, formatDate, initials } from "../utils";

const ROLE_OPTIONS: StaffRole[] = ["admin", "office", "field"];

/**
 * Team & staff accounts (Track 1c). Admin-only surface: the nav item is
 * hidden for Office/Field logins, and the server enforces the same gate
 * in the action layer (listTeamMembers / createStaffAccount /
 * updateStaffMember are ADMIN_ACTIONS in server/src/permissions.ts) —
 * this view is the cosmetic layer, never the enforcement.
 *
 * Staff logins are real auth accounts on the SAME company: the person
 * signs in with the email + password set here, in the phone app or in
 * Office, and everything they see/do is scoped by their role server-side.
 */
export function TeamView() {
  const queryClient = useQueryClient();
  const teamQuery = useQuery({ queryKey: ["team-members"], queryFn: () => api.listTeamMembers({}) });
  const members = teamQuery.data?.members ?? [];

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["team-members"] });

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Team</h1>
          <p className="view-sub">
            Everyone who can sign in to your company. Roles are enforced by the server on every action —
            hiding a screen is never the security, the role is.
          </p>
        </div>
      </div>

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
                  <MemberRow key={member.id} member={member} onChanged={invalidate} />
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

        <AddStaffPanel onCreated={invalidate} />
      </div>
    </div>
  );
}

function MemberRow({ member, onChanged }: { member: TeamMember; onChanged: () => void }) {
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (args: { role?: StaffRole; active?: boolean }) =>
      api.updateStaffMember({ userId: member.id, ...args }),
    onSuccess: () => { setError(""); onChanged(); },
    onError: (e) => setError(cleanError(e)),
  });
  const locked = member.isSelf || member.role === "owner";

  return (
    <tr>
      <td>
        <span className="cell-person">
          <span className="avatar">{initials(member.name || member.email)}</span>
          <span>
            {member.name}
            {member.isSelf ? <span className="chip chip-primary">You</span> : null}
            <small className="feed-meta block">{member.email}</small>
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
      </td>
    </tr>
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
