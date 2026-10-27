import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import { cleanError } from "../utils";

type SettingsData = Awaited<ReturnType<typeof api.getSettings>>;

/** The company-profile basics Office edits; everything else round-trips
 *  unchanged through updateSettings so no phone-side preference is lost. */
const BASIC_FIELDS = [
  "companyName", "licenseNumber", "phone", "email", "website", "address",
  "serviceArea", "profileDescription", "paymentInstructions", "reviewUrl",
  "facebookUrl", "instagramUrl", "youtubeUrl",
] as const;
type BasicField = (typeof BASIC_FIELDS)[number];
type Basics = Record<BasicField, string>;

const FIELD_LABELS: Record<BasicField, string> = {
  companyName: "Company name",
  licenseNumber: "License number",
  phone: "Phone",
  email: "Email",
  website: "Website",
  address: "Address",
  serviceArea: "Service area",
  profileDescription: "Profile description",
  paymentInstructions: "Payment instructions (shown on invoices)",
  reviewUrl: "Review link",
  facebookUrl: "Facebook URL",
  instagramUrl: "Instagram URL",
  youtubeUrl: "YouTube URL",
};

const WIDE_FIELDS: BasicField[] = ["address", "serviceArea", "profileDescription", "paymentInstructions"];

/**
 * Settings basics (Track 1b, item 5): company profile only. Document
 * defaults, notification preferences and the rest of the phone Settings
 * screen stay phone-side for this track — but saving here preserves them
 * all, because the save submits the full settings record the server
 * returned, with only these basics replaced.
 */
export function SettingsView({ canManage = false }: { canManage?: boolean }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings-company"], queryFn: () => api.getSettings({}) });
  const [draft, setDraft] = useState<Basics | null>(null);
  const [error, setError] = useState("");
  const [savedNote, setSavedNote] = useState(false);

  useEffect(() => {
    const data = settingsQuery.data;
    if (data && draft === null) {
      const basics = {} as Basics;
      for (const f of BASIC_FIELDS) basics[f] = data[f] ?? "";
      setDraft(basics);
    }
  }, [settingsQuery.data, draft]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = settingsQuery.data as SettingsData | undefined;
      if (!data || !draft) throw new Error("Settings haven't loaded yet.");
      const { logoUrl: _logoUrl, coverUrl: _coverUrl, ...rest } = data;
      await api.updateSettings({ ...rest, ...draft });
    },
    onSuccess: () => {
      setSavedNote(true);
      void queryClient.invalidateQueries({ queryKey: ["settings-company"] });
    },
    onError: (e) => setError(cleanError(e)),
  });

  const data = settingsQuery.data;

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Settings</h1>
          <p className="view-sub">Company profile basics — the same Settings record the phone app edits. Advanced preferences (document defaults, notifications, reminders) stay in the phone app for now and are preserved when you save here.</p>
        </div>
      </div>

      <section className="panel settings-panel">
        {settingsQuery.isLoading ? <p className="muted">Loading settings…</p> : null}
        {settingsQuery.isError ? (
          <div className="empty-state small">
            <div className="empty-icon">◍</div>
            <p>Couldn't load settings.</p>
            <button type="button" className="btn btn-primary" onClick={() => void settingsQuery.refetch()}>Try again</button>
          </div>
        ) : null}
        {data && draft ? (
          <form
            onSubmit={(e) => { e.preventDefault(); setError(""); setSavedNote(false); saveMutation.mutate(); }}
          >
            {data.logoUrl ? (
              <div className="settings-logo-row">
                <img src={data.logoUrl} alt="" className="settings-logo" />
                <span className="muted small">Company logo — change it in the phone app.</span>
              </div>
            ) : null}
            <div className="form-grid">
              {BASIC_FIELDS.map((f) => (
                <label key={f} className={`field${WIDE_FIELDS.includes(f) ? " span2" : ""}`}>
                  <span>{FIELD_LABELS[f]}</span>
                  {WIDE_FIELDS.includes(f) ? (
                    <textarea rows={f === "profileDescription" ? 4 : 2} value={draft[f]} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
                  ) : (
                    <input value={draft[f]} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
                  )}
                </label>
              ))}
            </div>
            {error ? <p className="inline-error">{error}</p> : null}
            {savedNote && !error ? <p className="inline-ok">Saved — the phone app will show the same company details.</p> : null}
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : "Save company details"}
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <AutomationsSection canManage={canManage} />
    </div>
  );
}

/**
 * Wave 1: the five built-in automation recipes. Each one only creates
 * follow-up tasks (plus the review email through the existing review
 * mechanism) — automations never message a client on their own.
 * Switches are per company and Admin-only to change (server-enforced).
 */
function AutomationsSection({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const recipesQuery = useQuery({ queryKey: ["automation-settings"], queryFn: () => api.getAutomationSettings({}) });
  const recipes = recipesQuery.data?.recipes ?? [];

  const toggleMutation = useMutation({
    mutationFn: (args: { key: string; enabled: boolean }) =>
      api.updateAutomationSettings({ recipes: { [args.key]: args.enabled } }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["automation-settings"] }); },
    onError: (e) => setError(cleanError(e)),
  });

  return (
    <section className="panel settings-panel">
      <div className="panel-head">
        <h2>Automations</h2>
      </div>
      <p className="muted">
        Built-in recipes that keep work from slipping. They only create tasks in the follow-up queue —
        nothing is ever sent to a client automatically (the review recipe uses the review email you
        already control under Settings in the phone app).
      </p>
      {recipesQuery.isLoading ? <p className="muted">Loading automations…</p> : null}
      {recipesQuery.isError ? <p className="inline-error">Couldn't load the automation switches.</p> : null}
      {error ? <p className="inline-error">{error}</p> : null}
      <div className="automation-list">
        {recipes.map((recipe) => (
          <div key={recipe.key} className="automation-row">
            <div className="feed-main">
              <span className="feed-title">{recipe.label}</span>
              <span className="feed-meta block">{recipe.description}</span>
            </div>
            <label className="access-switch-row">
              <input
                type="checkbox"
                checked={recipe.enabled}
                disabled={!canManage || toggleMutation.isPending}
                onChange={(e) => { setError(""); toggleMutation.mutate({ key: recipe.key, enabled: e.target.checked }); }}
              />
              <span>{recipe.enabled ? "On" : "Off"}</span>
            </label>
          </div>
        ))}
      </div>
      {!canManage ? <p className="muted small">Only company Admins can change these switches.</p> : null}
    </section>
  );
}
