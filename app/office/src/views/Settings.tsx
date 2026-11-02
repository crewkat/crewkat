import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import { cleanError, downloadBase64, formatCents, formatDate, formatDateTime, formatMoney } from "../utils";

type SettingsData = Awaited<ReturnType<typeof api.getSettings>>;
/** The full company settings record minus the logo/cover URLs (those are
 *  display-only here). Office edits this SAME record through the SAME
 *  updateSettings action the phone app uses — one source of truth. */
type SettingsRecord = Omit<SettingsData, "logoUrl" | "coverUrl">;

/** Company-profile basics (the fields Office has always edited). */
const BASIC_FIELDS = [
  "companyName", "licenseNumber", "phone", "email", "website", "address",
  "serviceArea", "profileDescription", "paymentInstructions", "reviewUrl",
  "facebookUrl", "instagramUrl", "youtubeUrl",
] as const;
type BasicField = (typeof BASIC_FIELDS)[number];

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
 * Settings (Danny 2026-11-01): Office Settings is the single home for
 * everything a user can change — company profile, plan & billing,
 * document defaults, notifications & reminders, marketplace toggles,
 * appearance, backup & restore, and automations. Every section below
 * edits the one shared settings record via updateSettings, and saving
 * submits the full record the server returned with only the edited
 * fields replaced, so phone-side preferences Office doesn't render
 * (e.g. the document design-customization blob) are preserved, never
 * clobbered. Genuinely device-bound controls — this device's push
 * subscription, the company logo/cover uploads, account deletion —
 * stay where they belong and are noted in their sections.
 */
export function SettingsView({ canManage = false, userName = "", seeMoney = false }: { canManage?: boolean; userName?: string; seeMoney?: boolean }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings-company"], queryFn: () => api.getSettings({}) });
  const [draft, setDraft] = useState<SettingsRecord | null>(null);
  const [error, setError] = useState("");
  const [savedNote, setSavedNote] = useState(false);

  useEffect(() => {
    const data = settingsQuery.data;
    if (data && draft === null) {
      const { logoUrl: _logoUrl, coverUrl: _coverUrl, ...rest } = data;
      setDraft(rest);
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
  const set = <K extends keyof SettingsRecord>(key: K, value: SettingsRecord[K]) =>
    setDraft((cur) => (cur ? { ...cur, [key]: value } : cur));

  const saveButton = (label: string) => (
    <div className="modal-actions">
      <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending}>
        {saveMutation.isPending ? "Saving…" : label}
      </button>
    </div>
  );

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Settings</h1>
          <p className="view-sub">Everything you can change or tweak lives here — company profile, plan & billing, document defaults, notifications, marketplace, appearance, and backups. These are the same settings the phone app edits; a change here is the change the phone sees.</p>
        </div>
      </div>

      <ProfileSection userName={userName} />

      <BillingSection />

      <PaymentsSection canManage={canManage} />

      <QuickBooksSection canManage={canManage} />

      {settingsQuery.isLoading ? (
        <section className="panel settings-panel"><p className="muted">Loading settings…</p></section>
      ) : null}
      {settingsQuery.isError ? (
        <section className="panel settings-panel">
          <div className="empty-state small">
            <div className="empty-icon">◍</div>
            <p>Couldn't load settings.</p>
            <button type="button" className="btn btn-primary" onClick={() => void settingsQuery.refetch()}>Try again</button>
          </div>
        </section>
      ) : null}

      {data && draft ? (
        <form onSubmit={(e) => { e.preventDefault(); setError(""); setSavedNote(false); saveMutation.mutate(); }}>
          <section className="panel settings-panel">
            <div className="panel-head"><h2>Company profile</h2></div>
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
                    <textarea rows={f === "profileDescription" ? 4 : 2} value={draft[f]} onChange={(e) => set(f, e.target.value)} />
                  ) : (
                    <input value={draft[f]} onChange={(e) => set(f, e.target.value)} />
                  )}
                </label>
              ))}
            </div>
            {saveButton("Save company details")}
          </section>

          <section className="panel settings-panel">
            <div className="panel-head"><h2>Documents & defaults</h2></div>
            <div className="form-grid">
              <label className="field">
                <span>Default document theme</span>
                <select value={draft.defaultQuoteTheme} onChange={(e) => set("defaultQuoteTheme", e.target.value as SettingsRecord["defaultQuoteTheme"])}>
                  <option value="classic">Classic</option>
                  <option value="modern">Modern</option>
                  <option value="bold">Bold</option>
                  <option value="minimal">Minimal</option>
                </select>
              </label>
              <label className="field">
                <span>Default document font</span>
                <select value={draft.defaultDocumentFont} onChange={(e) => set("defaultDocumentFont", e.target.value as SettingsRecord["defaultDocumentFont"])}>
                  <option value="helvetica">Helvetica</option>
                  <option value="times">Times</option>
                  <option value="courier">Courier</option>
                  <option value="palatino">Palatino</option>
                </select>
              </label>
              <label className="field">
                <span>Estimate follow-up after (days)</span>
                <input type="number" min={1} max={60} value={draft.quoteFollowUpDays} onChange={(e) => set("quoteFollowUpDays", Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Hourly cost rate (job costing)</span>
                <input value={draft.hourlyCostRate} onChange={(e) => set("hourlyCostRate", e.target.value)} inputMode="decimal" />
              </label>
              <label className="field">
                <span>Cost alert at (% of budget)</span>
                <input type="number" min={50} max={100} value={draft.costAlertPercent} onChange={(e) => set("costAlertPercent", Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Late fee type</span>
                <select value={draft.lateFeeType} onChange={(e) => set("lateFeeType", e.target.value as SettingsRecord["lateFeeType"])}>
                  <option value="flat">Flat amount</option>
                  <option value="percent">Percent of balance</option>
                </select>
              </label>
              <label className="field">
                <span>Late fee value</span>
                <input value={draft.lateFeeValue} onChange={(e) => set("lateFeeValue", e.target.value)} inputMode="decimal" />
              </label>
              <label className="field">
                <span>Late fee grace period (days)</span>
                <input type="number" min={0} max={365} value={draft.lateFeeGraceDays} onChange={(e) => set("lateFeeGraceDays", Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Invoices grouped by</span>
                <select value={draft.invoiceGroupBy} onChange={(e) => set("invoiceGroupBy", e.target.value as SettingsRecord["invoiceGroupBy"])}>
                  <option value="creation_date">Creation date</option>
                  <option value="due_date">Due date</option>
                  <option value="client">Client</option>
                </select>
              </label>
            </div>
            <h3 className="day-section-title">Shown on new documents by default</h3>
            <div className="form-grid">
              <Toggle label="Tax line" checked={draft.defaultShowTaxLine} onChange={(v) => set("defaultShowTaxLine", v)} />
              <Toggle label="Discount line" checked={draft.defaultShowDiscountLine} onChange={(v) => set("defaultShowDiscountLine", v)} />
              <Toggle label="Paid line" checked={draft.defaultShowPaidLine} onChange={(v) => set("defaultShowPaidLine", v)} />
              <Toggle label="Payment terms" checked={draft.defaultShowPaymentTerms} onChange={(v) => set("defaultShowPaymentTerms", v)} />
              <Toggle label="Footer notes" checked={draft.defaultShowFooterNotes} onChange={(v) => set("defaultShowFooterNotes", v)} />
              <Toggle label="Logo" checked={draft.defaultShowLogo} onChange={(v) => set("defaultShowLogo", v)} />
              <Toggle label="Company info" checked={draft.defaultShowCompanyInfo} onChange={(v) => set("defaultShowCompanyInfo", v)} />
            </div>
            <h3 className="day-section-title">Invoice & estimate behavior</h3>
            <div className="form-grid">
              <Toggle label="Online signature — collect signatures on estimates and invoices" checked={draft.onlineSignatureEnabled} onChange={(v) => set("onlineSignatureEnabled", v)} />
              <Toggle label={'Add "Job Site" address on documents'} checked={draft.addJobSiteAddress} onChange={(v) => set("addJobSiteAddress", v)} />
              <Toggle label="Add shipping address on documents" checked={draft.addShippingAddress} onChange={(v) => set("addShippingAddress", v)} />
              <Toggle label="Convert to Quote — use Quote wording for estimates" checked={draft.convertToQuote} onChange={(v) => set("convertToQuote", v)} />
            </div>
            <div className="form-grid">
              <label className="field span2">
                <span>Default footnote</span>
                <textarea rows={3} value={draft.defaultFootnote} onChange={(e) => set("defaultFootnote", e.target.value)} />
              </label>
              <label className="field span2">
                <span>Warranty terms</span>
                <textarea rows={4} value={draft.warrantyTerms} onChange={(e) => set("warrantyTerms", e.target.value)} />
              </label>
            </div>
            <p className="muted small">The visual document design editor (colors, layout tweaks) still lives in the phone app — its saved design is preserved untouched when you save here.</p>
            {saveButton("Save document defaults")}
          </section>

          <section className="panel settings-panel">
            <div className="panel-head"><h2>Notifications & reminders</h2></div>
            <div className="form-grid">
              <Toggle label="Show alerts and follow-ups" checked={draft.notificationsEnabled} onChange={(v) => set("notificationsEnabled", v)} />
              <Toggle label="New Marketplace message" checked={draft.notifyNewMessage} onChange={(v) => set("notifyNewMessage", v)} />
              <Toggle label="Client signed a document" checked={draft.notifyDocSigned} onChange={(v) => set("notifyDocSigned", v)} />
              <Toggle label="Client viewed an invoice" checked={draft.notifyInvoiceViewed} onChange={(v) => set("notifyInvoiceViewed", v)} />
              <Toggle label="Client viewed an estimate" checked={draft.notifyEstimateViewed} onChange={(v) => set("notifyEstimateViewed", v)} />
              <Toggle label="Client opened a contract" checked={draft.notifyContractViewed} onChange={(v) => set("notifyContractViewed", v)} />
              <Toggle label="Show payment reminders" checked={draft.paymentRemindersEnabled} onChange={(v) => set("paymentRemindersEnabled", v)} />
              <Toggle label="Alert me about overdue invoices" checked={draft.overdueInvoiceRemindersEnabled} onChange={(v) => set("overdueInvoiceRemindersEnabled", v)} />
              <Toggle label="Automatic review requests after a job" checked={draft.reviewRequestsEnabled} onChange={(v) => set("reviewRequestsEnabled", v)} />
              <Toggle label="Weekly progress summary" checked={draft.weeklyProgressEnabled} onChange={(v) => set("weeklyProgressEnabled", v)} />
            </div>
            <div className="form-grid">
              <label className="field">
                <span>First overdue reminder after (days)</span>
                <input type="number" min={1} max={90} value={draft.overdueReminderDays} onChange={(e) => set("overdueReminderDays", Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Review request delay (days after completion)</span>
                <input type="number" min={0} max={30} value={draft.reviewRequestDelayDays} onChange={(e) => set("reviewRequestDelayDays", Number(e.target.value))} />
              </label>
            </div>
            <p className="muted small">Push notifications to a specific phone are switched on that device — open the phone app on the device to turn its push subscription on or off. The alert types above apply everywhere.</p>
            {saveButton("Save notification settings")}
          </section>

          <section className="panel settings-panel">
            <div className="panel-head"><h2>Marketplace</h2></div>
            <div className="form-grid">
              <Toggle label="Offer free estimates (shown on your marketplace profile)" checked={draft.offersFreeEstimates} onChange={(v) => set("offersFreeEstimates", v)} />
              <Toggle label="Watermark shared job photos with your company name" checked={draft.socialWatermark} onChange={(v) => set("socialWatermark", v)} />
            </div>
            <p className="muted small">Your listings show the company name and phone from Company profile above — edit them there and every listing picks them up. Message alerts are under Notifications & reminders.</p>
            {saveButton("Save marketplace settings")}
          </section>

          <section className="panel settings-panel">
            <div className="panel-head"><h2>Appearance & software</h2></div>
            <div className="form-grid">
              <label className="field">
                <span>Theme</span>
                <select value={draft.themeMode} onChange={(e) => set("themeMode", e.target.value as SettingsRecord["themeMode"])}>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">Match device</option>
                </select>
              </label>
              <label className="field">
                <span>App accent</span>
                <select value={draft.uiAccent} onChange={(e) => set("uiAccent", e.target.value as SettingsRecord["uiAccent"])}>
                  <option value="orange">Orange</option>
                  <option value="blue">Blue</option>
                  <option value="green">Green</option>
                  <option value="purple">Purple</option>
                  <option value="red">Red</option>
                </select>
              </label>
              <label className="field">
                <span>Document accent color</span>
                <span className="accent-input-row">
                  <input type="color" value={draft.accentColor} onChange={(e) => set("accentColor", e.target.value)} aria-label="Document accent color picker" />
                  <input value={draft.accentColor} onChange={(e) => set("accentColor", e.target.value)} aria-label="Document accent color hex" />
                </span>
              </label>
              <label className="field">
                <span>Language</span>
                <select value={draft.language} onChange={(e) => set("language", e.target.value as SettingsRecord["language"])}>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                </select>
              </label>
            </div>
            <div className="form-grid">
              <Toggle label="Simple mode — the streamlined phone layout" checked={draft.simpleMode} onChange={(v) => set("simpleMode", v)} />
            </div>
            {saveButton("Save appearance")}
          </section>

          {error ? <p className="inline-error">{error}</p> : null}
          {savedNote && !error ? <p className="inline-ok">Saved — the phone app will show the same settings.</p> : null}
        </form>
      ) : null}

      {seeMoney ? (
        <>
          <div className="panel-head settings-group-head"><h2>Backup & restore</h2></div>
          <ExportPanel />
          <ImportPanel />
        </>
      ) : null}

      <AutomationsSection canManage={canManage} />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="field checkbox-field">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Your own sign-in profile: display name (updateProfileName — the same
 *  action the phone profile editor calls). Email is the sign-in ID and
 *  isn't editable here. */
function ProfileSection({ userName }: { userName: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const value = name ?? userName;

  const mutation = useMutation({
    mutationFn: () => api.updateProfileName({ name: value.trim() }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries();
    },
    onError: (e) => setError(cleanError(e)),
  });

  return (
    <section className="panel settings-panel">
      <div className="panel-head"><h2>Your profile</h2></div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          setSaved(false);
          if (value.trim().length < 2) { setError("Enter your name (at least 2 characters)."); return; }
          mutation.mutate();
        }}
      >
        <div className="form-grid">
          <label className="field">
            <span>Your name</span>
            <input value={value} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </label>
        </div>
        {error ? <p className="inline-error">{error}</p> : null}
        {saved && !error ? <p className="inline-ok">Name saved.</p> : null}
        <div className="modal-actions">
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending || value.trim() === userName}>
            {mutation.isPending ? "Saving…" : "Save name"}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Plan & billing (moved here from the Money page, Danny 2026-11-01) —
 * the same read-only block: plan name/status, billed-through, and the
 * billing payment history from getBillingOverview. No checkout, no
 * portal session, no Stripe writes: subscription changes stay with
 * the provider / phone app, exactly as before.
 */
// Wave 2 Item 6: Stripe Connect — clients pay invoices by card/ACH
// from the invoice link; funds land in the company's own Stripe
// account. Degrades to a setup state until the platform keys exist.
function PaymentsSection({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const setupQuery = useQuery({ queryKey: ["payments-setup"], queryFn: () => api.getPaymentsSetup({}) });
  const [error, setError] = useState("");
  const onboard = useMutation({
    mutationFn: () => api.startConnectOnboarding({}),
    onSuccess: (result) => {
      if (result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
        void queryClient.invalidateQueries({ queryKey: ["payments-setup"] });
      }
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not start Stripe setup."),
  });
  const refresh = useMutation({
    mutationFn: () => api.refreshConnectStatus({}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["payments-setup"] }),
    onError: (e) => setError(e instanceof Error ? e.message : "Could not refresh the status."),
  });
  const setup = setupQuery.data;
  return (
    <section className="panel settings-panel">
      <div className="panel-head"><h2>Payments — get paid by card</h2></div>
      {setupQuery.isLoading ? <p className="muted">Loading payment setup…</p> : null}
      {setupQuery.isError ? <p className="muted">Couldn't load payment setup.</p> : null}
      {setup && !setup.platformConfigured ? (
        <div className="empty-state small">
          <div className="empty-icon">▣</div>
          <p><strong>Online payments aren't switched on for Crewkat yet.</strong></p>
          <p className="muted">Once the platform's Stripe Connect keys are configured, this is where you connect your own Stripe account so clients can pay invoices by card or bank transfer (ACH) straight from the invoice link. Nothing to do here until then.</p>
        </div>
      ) : null}
      {setup && setup.platformConfigured ? (
        <>
          <div className="settings-kv">
            <div><span>Status</span><strong>{setup.status === "connected" ? "Connected" : setup.status === "onboarding" ? "Onboarding incomplete" : "Not connected"}</strong></div>
            <div><span>Card & ACH charges</span><strong>{setup.chargesEnabled ? "Enabled" : "Not yet"}</strong></div>
            <div><span>Payouts to your bank</span><strong>{setup.payoutsEnabled ? "Enabled" : "Not yet"}</strong></div>
          </div>
          <p className="muted small">
            {setup.status === "connected" && setup.chargesEnabled
              ? "Invoice links now carry a Pay Now button — clients pay by card or ACH and the money goes to your Stripe account. Payments record themselves against the invoice."
              : "Connect your Stripe account (a few minutes: business details + bank account). When it's ready, every invoice link you send gets a Pay Now button automatically."}
          </p>
          {error ? <p className="status error">{error}</p> : null}
          <div className="settings-save-row">
            {canManage ? (
              <button type="button" className="btn btn-primary" disabled={onboard.isPending} onClick={() => { setError(""); onboard.mutate(); }}>
                {onboard.isPending ? "Opening Stripe…" : setup.status === "not_connected" ? "Connect Stripe" : "Continue Stripe setup"}
              </button>
            ) : <span className="muted small">Only an admin can connect payments.</span>}
            {setup.status !== "not_connected" ? (
              <button type="button" className="btn" disabled={refresh.isPending} onClick={() => { setError(""); refresh.mutate(); }}>
                {refresh.isPending ? "Refreshing…" : "Refresh status"}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

// Wave 2 Item 7: QuickBooks Online — connect once, then clients,
// invoices, and payments sync both ways. The Sync Status centre lists
// every record's state; conflicts (both sides edited) are flagged
// there, never silently overwritten (last-write-wins by updatedAt).
function QuickBooksSection({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({ queryKey: ["quickbooks-status"], queryFn: () => api.getQuickBooksStatus({}) });
  const recordsQuery = useQuery({ queryKey: ["qb-sync-records"], queryFn: () => api.listQbSyncRecords({}), enabled: statusQuery.data?.status === "connected" });
  const [error, setError] = useState("");
  const [syncNote, setSyncNote] = useState("");
  const connect = useMutation({
    mutationFn: () => api.getQuickBooksConnectUrl({}),
    onSuccess: (result) => {
      if (result.url) window.location.href = result.url;
      else setError("QuickBooks is not configured on the platform yet.");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not start the QuickBooks connection."),
  });
  const disconnect = useMutation({
    mutationFn: () => api.disconnectQuickBooks({}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["quickbooks-status"] });
      void queryClient.invalidateQueries({ queryKey: ["qb-sync-records"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not disconnect QuickBooks."),
  });
  const sync = useMutation({
    mutationFn: () => api.runQuickBooksSync({}),
    onSuccess: (r) => {
      setSyncNote(`Sync complete: ${r.pushed} pushed, ${r.pulled} pulled${r.conflicts ? `, ${r.conflicts} conflict${r.conflicts === 1 ? "" : "s"}` : ""}${r.errors ? `, ${r.errors} error${r.errors === 1 ? "" : "s"}` : ""}.`);
      void queryClient.invalidateQueries({ queryKey: ["qb-sync-records"] });
      void queryClient.invalidateQueries({ queryKey: ["quickbooks-status"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Sync failed."),
  });
  const status = statusQuery.data;
  const records = recordsQuery.data?.records ?? [];
  return (
    <section className="panel settings-panel">
      <div className="panel-head"><h2>QuickBooks Online</h2></div>
      {statusQuery.isLoading ? <p className="muted">Loading QuickBooks status…</p> : null}
      {statusQuery.isError ? <p className="muted">Couldn't load QuickBooks status.</p> : null}
      {status && !status.configured ? (
        <div className="empty-state small">
          <div className="empty-icon">▤</div>
          <p><strong>QuickBooks sync isn't switched on for Crewkat yet.</strong></p>
          <p className="muted">Once the platform's Intuit app credentials are configured, this is where you connect your QuickBooks Online company and keep clients, invoices, and payments in sync both ways. Nothing to do here until then.</p>
        </div>
      ) : null}
      {status && status.configured && status.status !== "connected" ? (
        <>
          <p className="muted">Connect your QuickBooks Online company ({status.environment}) and Crewkat will keep clients, invoices, and payments in sync both ways. Invoice lines post to a single “Services” item in QuickBooks — no journal entries, no expense sync.</p>
          {error ? <p className="status error">{error}</p> : null}
          <div className="settings-save-row">
            {canManage ? (
              <button type="button" className="btn btn-primary" disabled={connect.isPending} onClick={() => { setError(""); connect.mutate(); }}>
                {connect.isPending ? "Opening Intuit…" : "Connect QuickBooks"}
              </button>
            ) : <span className="muted small">Only an admin can connect QuickBooks.</span>}
          </div>
        </>
      ) : null}
      {status && status.configured && status.status === "connected" ? (
        <>
          <div className="settings-kv">
            <div><span>Company</span><strong>{status.companyName || "Connected"}</strong></div>
            <div><span>Realm</span><strong>{status.realmHint ?? "—"}</strong></div>
            <div><span>Default item</span><strong>{status.hasDefaultItem ? "Services" : "Created on first sync"}</strong></div>
            <div><span>Last sync</span><strong>{status.lastSyncAt ? formatDateTime(status.lastSyncAt) : "Never"}</strong></div>
          </div>
          <p className="muted small">If both sides edit the same record between syncs, the newer edit wins and the record is flagged as a conflict below — nothing is silently overwritten.</p>
          {error ? <p className="status error">{error}</p> : null}
          {syncNote ? <p className="status ok">{syncNote}</p> : null}
          <div className="settings-save-row">
            <button type="button" className="btn btn-primary" disabled={sync.isPending} onClick={() => { setError(""); setSyncNote(""); sync.mutate(); }}>
              {sync.isPending ? "Syncing…" : "Sync now"}
            </button>
            {canManage ? (
              <button type="button" className="btn danger" disabled={disconnect.isPending} onClick={() => { setError(""); disconnect.mutate(); }}>
                {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : null}
          </div>
          <h3 className="settings-group-title">Sync status</h3>
          {recordsQuery.isLoading ? <p className="muted">Loading sync records…</p> : null}
          {!recordsQuery.isLoading && records.length === 0 ? <p className="muted small">Nothing synced yet — run the first sync and every client, invoice, and payment gets a state here.</p> : null}
          {records.length > 0 ? (
            <table className="mini-table">
              <thead><tr><th>Record</th><th>Type</th><th>Status</th><th>Last synced</th></tr></thead>
              <tbody>
                {records.slice(0, 60).map((r) => (
                  <tr key={r.id}>
                    <td>{r.label}{r.error ? <span className="feed-meta" style={{ display: "block" }}>{r.error}</span> : null}</td>
                    <td>{r.entityType}</td>
                    <td>{r.status === "synced" ? "✓ Synced" : r.status === "conflict" ? "⚠ Conflict" : r.status === "error" ? "✗ Error" : "Pending"}</td>
                    <td>{r.lastSyncedAt ? formatDate(r.lastSyncedAt.slice(0, 10)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {records.length > 60 ? <p className="muted small">Showing the 60 most recently updated records.</p> : null}
        </>
      ) : null}
    </section>
  );
}

function BillingSection() {
  const billingQuery = useQuery({ queryKey: ["billing-overview"], queryFn: () => api.getBillingOverview({}) });
  const billing = billingQuery.data;
  const plan = billing?.plan;
  const isFounder = plan?.status === "founder" || plan?.status === "founding_member";
  const planLabel = !plan ? "" : isFounder ? "Founder plan" : plan.tier === "premium" ? "Crewkat Premium" : "Free plan";
  const periodEnd = plan?.currentPeriodEnd ? formatDate(plan.currentPeriodEnd) : null;

  return (
    <section className="panel settings-panel">
      <div className="panel-head"><h2>Plan & billing</h2></div>
      {billingQuery.isLoading ? <p className="muted">Loading plan…</p> : null}
      {billingQuery.isError ? (
        <div className="empty-state small">
          <div className="empty-icon">◍</div>
          <p>Couldn't load billing.</p>
          <button type="button" className="btn btn-primary" onClick={() => void billingQuery.refetch()}>Try again</button>
        </div>
      ) : null}
      {plan ? (
        <>
          <p className="plan-name">{planLabel}</p>
          <dl className="detail-list">
            <div><dt>Status</dt><dd>{plan.status || "—"}</dd></div>
            {periodEnd ? <div><dt>{plan.cancelAtPeriodEnd ? "Ends" : "Renews"}</dt><dd>{periodEnd}</dd></div> : null}
            <div>
              <dt>Billed through</dt>
              <dd>{plan.provider === "stripe" ? "Stripe" : plan.provider === "play" ? "Google Play" : isFounder ? "— (founder plan, no billing)" : "Set up by the Crewkat team"}</dd>
            </div>
          </dl>
          <p className="muted small">
            {plan.provider === "play"
              ? "Manage or cancel this subscription in the Play Store app."
              : "To change plans or payment methods, use Billing in the Crewkat phone app — Office shows the state only."}
          </p>
        </>
      ) : null}

      <h3 className="day-section-title">Billing payment history</h3>
      {billing && billing.payments.length === 0 ? <p className="muted">No billing payments yet.</p> : null}
      {billing && billing.payments.length > 0 ? (
        <ul className="link-list static">
          {billing.payments.map((p) => {
            const row = (
              <>
                <span>{p.description}</span>
                <span className="feed-meta">
                  {formatDate(p.date)} · {p.source === "subscription" ? "Subscription" : "Promotion"}
                  {p.status && p.status !== "paid" && p.status !== "completed" ? ` · ${p.status}` : ""}
                  {p.amountCents !== null ? ` · ${formatCents(p.amountCents, p.currency)}` : ""}
                </span>
              </>
            );
            return (
              <li key={p.id}>
                {p.receiptUrl ? (
                  <a className="billing-receipt-link" href={p.receiptUrl} target="_blank" rel="noopener noreferrer">{row}</a>
                ) : row}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
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
type ExportPeriodKind = "all" | "lastMonth" | "month" | "quarter" | "year";
type ExportDataset = "invoices" | "payments" | "expenses" | "pdfzip";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Accountant exports (Danny 2026-10-27): the company's books as CSV
 * spreadsheets plus a batch PDF bundle of invoices. The server gates
 * these on the seeMoney switch; this panel additionally hides itself
 * for members whose money switch is off (seeMoney prop from the shell).
 * Periods mirror the export UX contractors know from Invoice Fly.
 */
function ExportPanel() {
  const now = new Date();
  const [period, setPeriod] = useState<ExportPeriodKind>("all");
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);
  const [selQuarter, setSelQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [selYear, setSelYear] = useState(now.getFullYear());
  const [busy, setBusy] = useState<ExportDataset | null>(null);
  const [error, setError] = useState("");
  const [doneNote, setDoneNote] = useState("");
  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);

  const run = async (dataset: ExportDataset) => {
    setBusy(dataset);
    setError("");
    setDoneNote("");
    const args = {
      period,
      ...(period === "month" ? { month: selMonth, year: selYear } : {}),
      ...(period === "quarter" ? { quarter: selQuarter, year: selYear } : {}),
    };
    try {
      const result =
        dataset === "invoices" ? await api.exportInvoicesCsv(args)
        : dataset === "payments" ? await api.exportPaymentsCsv(args)
        : dataset === "expenses" ? await api.exportExpensesCsv(args)
        : await api.exportInvoicesPdfZip(args);
      downloadBase64(result.dataBase64, result.filename, dataset === "pdfzip" ? "application/zip" : "text/csv;charset=utf-8");
      setDoneNote(`${result.filename} — ${result.rowCount} record${result.rowCount === 1 ? "" : "s"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const row = (dataset: ExportDataset, label: string, hint: string) => (
    <li>
      <span>
        {label}
        <span className="feed-meta">{hint}</span>
      </span>
      <button type="button" className="btn" disabled={busy !== null} onClick={() => void run(dataset)}>
        {busy === dataset ? "Preparing…" : "Download"}
      </button>
    </li>
  );

  return (
    <section className="panel">
      <div className="panel-head"><h2>Export your books</h2></div>
      <p className="muted small">Spreadsheets your accountant can open in Excel or Google Sheets, plus a ZIP with one PDF per invoice.</p>
      <div className="export-period-row">
        <label>
          Period
          <select className="doc-status-select" value={period} onChange={(e) => setPeriod(e.target.value as ExportPeriodKind)}>
            <option value="all">All time</option>
            <option value="lastMonth">Last month</option>
            <option value="month">By month</option>
            <option value="quarter">By quarter</option>
            <option value="year">This year</option>
          </select>
        </label>
        {period === "month" ? (
          <>
            <label>
              Month
              <select className="doc-status-select" value={selMonth} onChange={(e) => setSelMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
              </select>
            </label>
            <label>
              Year
              <select className="doc-status-select" value={selYear} onChange={(e) => setSelYear(Number(e.target.value))}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </>
        ) : null}
        {period === "quarter" ? (
          <>
            <label>
              Quarter
              <select className="doc-status-select" value={selQuarter} onChange={(e) => setSelQuarter(Number(e.target.value))}>
                {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
              </select>
            </label>
            <label>
              Year
              <select className="doc-status-select" value={selYear} onChange={(e) => setSelYear(Number(e.target.value))}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </>
        ) : null}
      </div>
      <ul className="link-list static export-list">
        {row("invoices", "Invoices", "Every invoice with totals, paid and balance — spreadsheet")}
        {row("payments", "Payments", "Every payment received, matched to its invoice — spreadsheet")}
        {row("expenses", "Expenses", "Business expenses and job receipts — spreadsheet")}
        {row("pdfzip", "Invoice PDFs", "One PDF per invoice in the period, bundled in a ZIP")}
      </ul>
      {doneNote ? <p className="muted small">{doneNote}</p> : null}
      {error ? <p className="status error" role="alert">{error}</p> : null}
    </section>
  );
}

type ImportPreview = Awaited<ReturnType<typeof api.previewInvoiceFlyImport>>;

const CLIENT_STATUS_LABEL: Record<string, string> = { new: "New", matched: "Already in Crewkat", invalid: "Can't import" };
const INVOICE_STATUS_LABEL: Record<string, string> = {
  new: "New", duplicate: "Possible duplicate", collision: "Number clash", imported: "Already imported", invalid: "Can't import",
};
const STATUS_PILL_CLASS: Record<string, string> = {
  new: "done", matched: "sent", invalid: "overdue", duplicate: "viewed", collision: "overdue", imported: "draft",
};

/**
 * Invoice Fly import (Danny 2026-10-27): the reverse of the exports
 * above. Pick the Clients and/or Invoices CSVs Invoice Fly produces,
 * review the server's preview (matches, duplicate flags, number
 * clashes), toggle rows, then confirm — nothing writes before that.
 * Same seeMoney gating family as the exports; the panel hides with
 * them for members whose money switch is off.
 */
function ImportPanel() {
  const queryClient = useQueryClient();
  const [clientsCsv, setClientsCsv] = useState("");
  const [invoicesCsv, setInvoicesCsv] = useState("");
  const [clientsName, setClientsName] = useState("");
  const [invoicesName, setInvoicesName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selClients, setSelClients] = useState<Set<number>>(new Set());
  const [selInvoices, setSelInvoices] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"preview" | "run" | null>(null);
  const [error, setError] = useState("");
  const [doneNote, setDoneNote] = useState("");

  const pick = async (file: File | undefined, which: "clients" | "invoices") => {
    if (!file) return;
    const text = await file.text();
    setPreview(null);
    setDoneNote("");
    setError("");
    if (which === "clients") { setClientsCsv(text); setClientsName(file.name); }
    else { setInvoicesCsv(text); setInvoicesName(file.name); }
  };

  const runPreview = async () => {
    setBusy("preview");
    setError("");
    setDoneNote("");
    try {
      const result = await api.previewInvoiceFlyImport({ clientsCsv, invoicesCsv });
      setPreview(result);
      setSelClients(new Set(result.clients.filter((r) => r.included).map((r) => r.index)));
      setSelInvoices(new Set(result.invoices.filter((r) => r.included).map((r) => r.index)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read those files. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const toggle = (set: Set<number>, index: number, apply: (next: Set<number>) => void) => {
    const next = new Set(set);
    if (next.has(index)) next.delete(index); else next.add(index);
    apply(next);
  };

  const runImport = async () => {
    setBusy("run");
    setError("");
    try {
      const result = await api.runInvoiceFlyImport({
        clientsCsv, invoicesCsv,
        clientIndexes: [...selClients], invoiceIndexes: [...selInvoices],
      });
      const parts = [
        `${result.clientsCreated} client${result.clientsCreated === 1 ? "" : "s"} added`,
        result.clientsMatched ? `${result.clientsMatched} matched` : "",
        result.addressesAppended ? `${result.addressesAppended} address${result.addressesAppended === 1 ? "" : "es"} saved` : "",
        `${result.invoicesCreated} invoice${result.invoicesCreated === 1 ? "" : "s"} imported`,
        result.paymentsCreated ? `${result.paymentsCreated} payment${result.paymentsCreated === 1 ? "" : "s"} recorded` : "",
        result.invoicesSkipped ? `${result.invoicesSkipped} skipped` : "",
      ].filter(Boolean);
      setDoneNote(`Import complete — ${parts.join(" · ")}.`);
      setPreview(null);
      setClientsCsv(""); setInvoicesCsv(""); setClientsName(""); setInvoicesName("");
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["billing-overview"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed. Nothing was half-written — try again.");
    } finally {
      setBusy(null);
    }
  };

  const c = preview?.counts;
  return (
    <section className="panel">
      <div className="panel-head"><h2>Import from Invoice Fly</h2></div>
      <p className="muted small">Bringing your books over from Invoice Fly? Export your Clients and Invoices there as CSV, pick the files here, and review everything before anything is imported.</p>
      <div className="export-period-row">
        <label>
          Clients CSV
          <input type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0], "clients")} />
          {clientsName ? <span className="feed-meta">{clientsName}</span> : null}
        </label>
        <label>
          Invoices CSV
          <input type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0], "invoices")} />
          {invoicesName ? <span className="feed-meta">{invoicesName}</span> : null}
        </label>
        <button type="button" className="btn btn-primary" disabled={busy !== null || (!clientsCsv && !invoicesCsv)} onClick={() => void runPreview()}>
          {busy === "preview" ? "Reading…" : "Preview import"}
        </button>
      </div>
      {preview && c ? (
        <>
          <p className="muted small">
            Clients: {c.clientsTotal} in file — {c.clientsNew} new, {c.clientsMatched} already in Crewkat{c.clientsInvalid ? `, ${c.clientsInvalid} can't import` : ""}.
            {c.invoicesTotal ? <> Invoices: {c.invoicesTotal} in file — {c.invoicesNew} new, {c.invoicesDuplicate} possible duplicate{c.invoicesDuplicate === 1 ? "" : "s"}, {c.invoicesCollision} number clash{c.invoicesCollision === 1 ? "" : "es"}{c.invoicesImported ? `, ${c.invoicesImported} already imported` : ""}{c.invoicesInvalid ? `, ${c.invoicesInvalid} can't import` : ""}.</> : null}
          </p>
          {preview.clients.length > 0 ? (
            <>
              <h3 className="day-section-title">Clients</h3>
              <ul className="link-list static import-rows">
                {preview.clients.map((r) => (
                  <li key={r.index}>
                    <label className="import-row">
                      <input type="checkbox" checked={selClients.has(r.index)} disabled={r.status === "invalid"}
                        onChange={() => toggle(selClients, r.index, setSelClients)} />
                      <span>
                        {r.name || "(no name)"}
                        <span className="feed-meta">{[r.email, r.phone, r.address].filter(Boolean).join(" · ") || "—"}</span>
                        {r.note ? <span className="feed-meta">{r.note}</span> : null}
                      </span>
                      <span className={`status-pill ${STATUS_PILL_CLASS[r.status] ?? ""}`}>{CLIENT_STATUS_LABEL[r.status]}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {preview.invoices.length > 0 ? (
            <>
              <h3 className="day-section-title">Invoices</h3>
              <ul className="link-list static import-rows">
                {preview.invoices.map((r) => (
                  <li key={r.index}>
                    <label className="import-row">
                      <input type="checkbox" checked={selInvoices.has(r.index)} disabled={r.status === "invalid" || r.status === "imported"}
                        onChange={() => toggle(selInvoices, r.index, setSelInvoices)} />
                      <span>
                        {r.number} · {r.clientName}
                        <span className="feed-meta">{formatDate(r.issueDate)} · Total {formatMoney(r.total)} · Paid {formatMoney(r.paid)}</span>
                        {r.note ? <span className="feed-meta">{r.note}</span> : null}
                      </span>
                      <span className={`status-pill ${STATUS_PILL_CLASS[r.status] ?? ""}`}>{INVOICE_STATUS_LABEL[r.status]}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <div className="export-period-row">
            <button type="button" className="btn btn-primary" disabled={busy !== null || (selClients.size === 0 && selInvoices.size === 0)} onClick={() => void runImport()}>
              {busy === "run" ? "Importing…" : `Import selected (${selClients.size + selInvoices.size})`}
            </button>
            <span className="muted small">Flagged rows stay off unless you tick them. Re-running the same files imports nothing twice.</span>
          </div>
        </>
      ) : null}
      {doneNote ? <p className="muted small">{doneNote}</p> : null}
      {error ? <p className="status error" role="alert">{error}</p> : null}
    </section>
  );
}
