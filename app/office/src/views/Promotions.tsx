import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import { cleanError, fileToBase64, formatDate } from "../utils";

/**
 * Promotions (0092, Danny 2026-11-01): Office email campaigns.
 *
 * A campaign is a draft the office composes — from a one-line prompt
 * (template composer; there is no AI hookup in Crewkat yet), a custom
 * uploaded image, or pasted custom HTML — aimed at one of three
 * audiences: hand-picked contacts, the "Estimate, never closed"
 * segment, or every contact with an email. Sending is Admin-only
 * (server-classified), happens exactly once, and every email carries a
 * personal unsubscribe link; unsubscribed addresses are excluded from
 * all future sends and the exclusion shows in the counts.
 */

type CampaignType = "promotion" | "blog";
type RecipientMode = "individual" | "never_closed" | "all";

type Draft = {
  name: string;
  type: CampaignType;
  subject: string;
  prompt: string;
  headline: string;
  bodyText: string;
  ctaLabel: string;
  ctaUrl: string;
  imageBlobKey: string | null;
  imageUrl: string | null;
  customHtml: string;
  recipientMode: RecipientMode;
  recipientClientIds: number[];
};

const EMPTY_DRAFT: Draft = {
  name: "",
  type: "promotion",
  subject: "",
  prompt: "",
  headline: "",
  bodyText: "",
  ctaLabel: "",
  ctaUrl: "",
  imageBlobKey: null,
  imageUrl: null,
  customHtml: "",
  recipientMode: "all",
  recipientClientIds: [],
};

const MODE_COPY: Record<RecipientMode, { title: string; blurb: string }> = {
  individual: {
    title: "Individual contacts",
    blurb: "Hand-pick exactly who gets this email from your client list below.",
  },
  never_closed: {
    title: "Estimate, never closed",
    blurb: "Clients who received an estimate from you but never booked: they have at least one sent estimate, and no job, no signed quote, and no invoice. Your best win-back list.",
  },
  all: {
    title: "All contacts",
    blurb: "Every client in your address book who has an email address.",
  },
};

export function PromotionsView({ canSend }: { canSend: boolean }) {
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: () => api.listCampaigns({}) });
  const campaigns = campaignsQuery.data?.campaigns ?? [];

  if (editingId !== null) {
    return <CampaignEditor key={String(editingId)} campaignId={editingId === "new" ? null : editingId} canSend={canSend} onBack={() => setEditingId(null)} />;
  }

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Promotions</h1>
          <p className="view-sub">Email campaigns to your clients — seasonal offers, news, and blog-style updates. Every email carries an unsubscribe link, and unsubscribed clients are left out of future sends automatically.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditingId("new")}>New campaign</button>
      </div>

      {campaignsQuery.isLoading ? <p className="view-loading">Loading campaigns…</p> : null}
      {campaignsQuery.isError ? <p className="inline-error">Couldn't load campaigns.</p> : null}
      {!campaignsQuery.isLoading && campaigns.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✉</div>
          <p>No campaigns yet. Write a one-line prompt — like “10% off bathroom remodels booked in November” — and Crewkat drafts the email for you to polish and send.</p>
          <button type="button" className="btn btn-primary" onClick={() => setEditingId("new")}>Create your first campaign</button>
        </div>
      ) : null}
      {campaigns.length > 0 ? (
        <div className="panel table-panel">
          <table className="data-table">
            <thead>
              <tr><th>Campaign</th><th>Type</th><th>Status</th><th>Recipients</th><th>Sent</th><th></th></tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} onClick={() => setEditingId(c.id)}>
                  <td><strong>{c.name}</strong>{c.subject ? <span className="muted small block">{c.subject}</span> : null}</td>
                  <td>{c.type === "blog" ? "Blog post" : "Promotion"}</td>
                  <td><span className={`status-pill${c.status === "sent" ? " done" : ""}`}>{c.status === "sent" ? `Sent · ${c.sentCount} ok${c.failedCount ? ` · ${c.failedCount} failed` : ""}` : c.status === "sending" ? "Sending…" : "Draft"}</span></td>
                  <td>{c.status === "sent" ? c.recipientCount : "—"}</td>
                  <td>{c.sentAt ? formatDate(c.sentAt) : "—"}</td>
                  <td><span className="muted">Open →</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function CampaignEditor({ campaignId, canSend, onBack }: { campaignId: number | null; canSend: boolean; onBack: () => void }) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: () => api.getCampaign({ id: campaignId as number }),
    enabled: campaignId !== null,
  });
  const existing = detailQuery.data?.campaign ?? null;
  const locked = existing?.status === "sent";

  const [draft, setDraft] = useState<Draft | null>(null);
  const [hydratedFor, setHydratedFor] = useState<number | null>(null);
  if (campaignId === null && draft === null) setDraft(EMPTY_DRAFT);
  if (existing && hydratedFor !== existing.id) {
    setHydratedFor(existing.id);
    setDraft({
      name: existing.name,
      type: existing.type,
      subject: existing.subject,
      prompt: existing.prompt,
      headline: existing.headline,
      bodyText: existing.bodyText,
      ctaLabel: existing.ctaLabel,
      ctaUrl: existing.ctaUrl,
      imageBlobKey: existing.imageBlobKey,
      imageUrl: existing.imageUrl,
      customHtml: existing.customHtml,
      recipientMode: existing.recipientMode,
      recipientClientIds: existing.recipientClientIds,
    });
  }

  const [note, setNote] = useState("");
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(campaignId);
  const fileRef = useRef<HTMLInputElement>(null);

  const clientsQuery = useQuery({ queryKey: ["clients", ""], queryFn: () => api.listClients({ search: "" }) });
  const clients = clientsQuery.data?.clients ?? [];

  const previewQuery = useQuery({
    queryKey: ["campaign-preview", draft?.recipientMode, draft?.recipientClientIds.join(",")],
    queryFn: () => api.previewCampaignRecipients({ mode: draft!.recipientMode, clientIds: draft!.recipientClientIds }),
    enabled: !!draft,
  });
  const preview = previewQuery.data;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    if (savedId) void queryClient.invalidateQueries({ queryKey: ["campaign", savedId] });
  };

  const saveMutation = useMutation({
    mutationFn: (d: Draft) => api.saveCampaign({
      id: savedId,
      name: d.name.trim(),
      type: d.type,
      subject: d.subject,
      prompt: d.prompt,
      headline: d.headline,
      bodyText: d.bodyText,
      ctaLabel: d.ctaLabel,
      ctaUrl: d.ctaUrl,
      imageBlobKey: d.imageBlobKey,
      customHtml: d.customHtml,
      recipientMode: d.recipientMode,
      recipientClientIds: d.recipientClientIds,
    }),
    onSuccess: (result) => {
      setSavedId(result.id);
      setNote("Draft saved.");
      invalidate();
    },
    onError: (err) => setNote(cleanError(err)),
  });

  const generateMutation = useMutation({
    mutationFn: (d: Draft) => api.generateCampaignContent({ type: d.type, prompt: d.prompt }),
    onSuccess: (result) => {
      setDraft((cur) => (cur ? { ...cur, subject: result.subject, headline: result.headline, bodyText: result.bodyText, ctaLabel: result.ctaLabel, ctaUrl: result.ctaUrl } : cur));
      setNote("Draft generated from your prompt — edit anything before sending.");
    },
    onError: (err) => setNote(cleanError(err)),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const dataBase64 = await fileToBase64(file);
      return api.uploadCampaignImage({ filename: file.name, contentType: file.type as "image/jpeg" | "image/png" | "image/webp" | "image/gif", dataBase64 });
    },
    onSuccess: (result) => {
      setDraft((cur) => (cur ? { ...cur, imageBlobKey: result.blobKey, imageUrl: result.url } : cur));
      setNote("Image added — it will sit at the top of the email.");
    },
    onError: (err) => setNote(cleanError(err)),
  });

  const sendMutation = useMutation({
    mutationFn: (id: number) => api.sendCampaign({ id }),
    onSuccess: (result) => {
      setConfirmingSend(false);
      setNote(`Sent — ${result.sent} delivered, ${result.failed} failed, out of ${result.total} recipients.`);
      invalidate();
    },
    onError: (err) => { setConfirmingSend(false); setNote(cleanError(err)); },
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: number) => api.duplicateCampaign({ id }),
    onSuccess: () => { setNote("Duplicated as a new draft — find it in the campaign list."); invalidate(); },
    onError: (err) => setNote(cleanError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteCampaign({ id }),
    onSuccess: () => { invalidate(); onBack(); },
    onError: (err) => setNote(cleanError(err)),
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((cur) => (cur ? { ...cur, [key]: value } : cur));
  const toggleClient = (id: number, on: boolean) => {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = on ? [...cur.recipientClientIds, id] : cur.recipientClientIds.filter((x) => x !== id);
      return { ...cur, recipientClientIds: next };
    });
  };

  const recipientLine = useMemo(() => {
    if (!preview) return "";
    const parts = [`${preview.count} recipient${preview.count === 1 ? "" : "s"}`];
    if (preview.suppressedCount > 0) parts.push(`${preview.suppressedCount} unsubscribed excluded`);
    if (preview.noEmailCount > 0) parts.push(`${preview.noEmailCount} skipped — no email`);
    return parts.join(" · ");
  }, [preview]);

  if (campaignId !== null && detailQuery.isLoading) return <p className="view-loading">Loading campaign…</p>;
  if (campaignId !== null && !existing && !detailQuery.isLoading) {
    return (
      <>
        <button type="button" className="btn btn-ghost btn-small" onClick={onBack}>← All campaigns</button>
        <p className="inline-error">This campaign no longer exists.</p>
      </>
    );
  }
  if (!draft) return <p className="view-loading">Loading campaign…</p>;

  const canAttemptSend = canSend && !locked && savedId !== null;

  return (
    <>
      <div className="view-head">
        <div>
          <button type="button" className="btn btn-ghost btn-small" onClick={onBack}>← All campaigns</button>
          <h1>{campaignId === null ? "New campaign" : draft.name || "Campaign"}</h1>
          <p className="view-sub">{locked ? `Sent ${existing?.sentAt ? formatDate(existing.sentAt) : ""} — this campaign is locked. Duplicate it to send a new version.` : "Draft — nothing sends until you confirm the final recipient count."}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {existing ? <button type="button" className="btn btn-ghost" disabled={duplicateMutation.isPending} onClick={() => duplicateMutation.mutate(existing.id)}>Duplicate</button> : null}
          {existing && canSend ? <button type="button" className="btn btn-danger-ghost" disabled={deleteMutation.isPending} onClick={() => { if (window.confirm("Delete this campaign? Its send history goes with it.")) deleteMutation.mutate(existing.id); }}>Delete</button> : null}
        </div>
      </div>

      {note ? <p className="feed-meta block">{note}</p> : null}

      <div className="promo-grid">
        <div className="promo-main">
          <section className="panel">
            <div className="panel-head"><h2>Content</h2></div>
            <div className="form-grid">
              <label className="field">
                <span>Campaign name (only your office sees this)</span>
                <input value={draft.name} disabled={locked} onChange={(e) => set("name", e.target.value)} placeholder="November bathroom offer" />
              </label>
              <label className="field">
                <span>Type</span>
                <select value={draft.type} disabled={locked} onChange={(e) => set("type", e.target.value as CampaignType)}>
                  <option value="promotion">Promotion</option>
                  <option value="blog">Blog post</option>
                </select>
              </label>
              <label className="field span2">
                <span>Describe it in one line — Crewkat drafts the email</span>
                <input value={draft.prompt} disabled={locked} onChange={(e) => set("prompt", e.target.value)} placeholder={draft.type === "blog" ? "5 signs your bathroom needs a remodel" : "10% off bathroom remodels booked in November"} />
              </label>
            </div>
            <div className="promo-actions">
              <button type="button" className="btn btn-accent" disabled={locked || generateMutation.isPending || draft.prompt.trim().length < 3} onClick={() => generateMutation.mutate(draft)}>
                {generateMutation.isPending ? "Writing…" : "Generate draft"}
              </button>
              <span className="muted small">Drafts come from your prompt + your company details (templates, not AI — yet). Edit everything before sending.</span>
            </div>
            <div className="form-grid">
              <label className="field span2">
                <span>Subject line</span>
                <input value={draft.subject} disabled={locked} onChange={(e) => set("subject", e.target.value)} placeholder="Your subject line" />
              </label>
              <label className="field span2">
                <span>Headline</span>
                <input value={draft.headline} disabled={locked} onChange={(e) => set("headline", e.target.value)} placeholder="The big line at the top of the email" />
              </label>
              <label className="field span2">
                <span>Body</span>
                <textarea rows={9} value={draft.bodyText} disabled={locked} onChange={(e) => set("bodyText", e.target.value)} placeholder="The email text. Blank lines start a new paragraph." />
              </label>
              <label className="field">
                <span>Button label</span>
                <input value={draft.ctaLabel} disabled={locked} onChange={(e) => set("ctaLabel", e.target.value)} placeholder="Get my free estimate" />
              </label>
              <label className="field">
                <span>Button link</span>
                <input value={draft.ctaUrl} disabled={locked} onChange={(e) => set("ctaUrl", e.target.value)} placeholder="https://yourwebsite.com" />
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Your own creative (optional)</h2></div>
            <p className="muted small">Upload a flyer or poster image to run at the top of the email, or paste finished HTML to use as the email body instead of the fields above. The unsubscribe footer is added either way.</p>
            <div className="promo-actions">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMutation.mutate(f); e.target.value = ""; }} />
              <button type="button" className="btn btn-ghost" disabled={locked || uploadMutation.isPending} onClick={() => fileRef.current?.click()}>
                {uploadMutation.isPending ? "Uploading…" : draft.imageUrl ? "Replace image" : "Upload image"}
              </button>
              {draft.imageUrl ? <button type="button" className="btn btn-ghost" disabled={locked} onClick={() => { set("imageBlobKey", null); set("imageUrl", null); }}>Remove image</button> : null}
            </div>
            {draft.imageUrl ? <img className="promo-uploaded" src={draft.imageUrl} alt="Campaign creative" /> : null}
            <label className="field">
              <span>Custom HTML (leave empty to use the fields above)</span>
              <textarea rows={5} value={draft.customHtml} disabled={locked} onChange={(e) => set("customHtml", e.target.value)} placeholder="<div>…your finished email HTML…</div>" />
            </label>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Recipients</h2></div>
            <div className="promo-modes">
              {(Object.keys(MODE_COPY) as RecipientMode[]).map((mode) => (
                <label key={mode} className={`promo-mode${draft.recipientMode === mode ? " active" : ""}`}>
                  <input type="radio" name="promo-mode" checked={draft.recipientMode === mode} disabled={locked} onChange={() => set("recipientMode", mode)} />
                  <span>
                    <strong>{MODE_COPY[mode].title}</strong>
                    <span className="muted small block">{MODE_COPY[mode].blurb}</span>
                  </span>
                </label>
              ))}
            </div>
            {draft.recipientMode === "individual" ? (
              <div className="promo-client-list">
                {clients.length === 0 ? <p className="muted">No clients yet.</p> : clients.map((c) => {
                  const hasEmail = !!c.email.trim();
                  return (
                    <label key={c.id} className={`promo-client${hasEmail ? "" : " no-email"}`}>
                      <input type="checkbox" disabled={locked || !hasEmail} checked={draft.recipientClientIds.includes(c.id)} onChange={(e) => toggleClient(c.id, e.target.checked)} />
                      <span className="promo-client-name">{c.name}</span>
                      <span className="muted small">{hasEmail ? c.email : "no email"}</span>
                    </label>
                  );
                })}
              </div>
            ) : null}
            <p className="feed-meta block">{previewQuery.isLoading ? "Counting recipients…" : recipientLine || " "}</p>
          </section>

          {!locked ? (
            <div className="promo-actions promo-sendbar">
              <button type="button" className="btn btn-primary" disabled={saveMutation.isPending || !draft.name.trim()} onClick={() => saveMutation.mutate(draft)}>
                {saveMutation.isPending ? "Saving…" : savedId ? "Save draft" : "Save as draft"}
              </button>
              {canAttemptSend && !confirmingSend ? (
                <button type="button" className="btn btn-accent" disabled={!preview || preview.count === 0} onClick={() => setConfirmingSend(true)}>Send campaign</button>
              ) : null}
              {!canSend && !locked ? <span className="muted small">Only an admin can send a campaign — drafts can be prepared by anyone in the office.</span> : null}
              {canSend && savedId === null ? <span className="muted small">Save the draft first, then send.</span> : null}
            </div>
          ) : null}
          {confirmingSend && preview ? (
            <div className="panel promo-confirm">
              <p><strong>Send “{draft.name}” to {preview.count} recipient{preview.count === 1 ? "" : "s"}?</strong></p>
              <p className="muted small">{recipientLine}. This sends right away and can't be undone.</p>
              <div className="promo-actions">
                <button type="button" className="btn btn-accent" disabled={sendMutation.isPending} onClick={() => savedId && sendMutation.mutate(savedId)}>
                  {sendMutation.isPending ? "Sending…" : `Yes, send to ${preview.count}`}
                </button>
                <button type="button" className="btn btn-ghost" disabled={sendMutation.isPending} onClick={() => setConfirmingSend(false)}>Cancel</button>
              </div>
            </div>
          ) : null}

          {locked && existing ? (
            <section className="panel">
              <div className="panel-head"><h2>Send results</h2></div>
              <p className="feed-meta block">{existing.sentCount} delivered · {existing.failedCount} failed · {existing.recipientCount} total{existing.sentAt ? ` · ${formatDate(existing.sentAt)}` : ""}</p>
              {existing.recipients.length > 0 ? (
                <table className="data-table">
                  <thead><tr><th>Client</th><th>Email</th><th>Status</th></tr></thead>
                  <tbody>
                    {existing.recipients.map((r) => (
                      <tr key={r.id}>
                        <td>{r.clientName || "—"}</td>
                        <td>{r.email}</td>
                        <td>{r.status === "sent" ? "Sent" : <span title={r.error}>Failed</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside className="panel promo-preview">
          <div className="panel-head"><h2>Preview</h2></div>
          <p className="muted small">Subject: <strong>{draft.subject || draft.headline || "(no subject yet)"}</strong></p>
          {draft.customHtml.trim() ? (
            <iframe className="promo-frame" title="Email preview" srcDoc={draft.customHtml} />
          ) : (
            <div className="promo-email">
              {draft.imageUrl ? <img src={draft.imageUrl} alt="" /> : null}
              {draft.headline ? <h3>{draft.headline}</h3> : null}
              {draft.bodyText.split(/\n{2,}/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
              {draft.ctaLabel && draft.ctaUrl ? <span className="promo-cta">{draft.ctaLabel}</span> : null}
              <p className="promo-foot">Your company · phone · service area<br />Unsubscribe link included in every send.</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
