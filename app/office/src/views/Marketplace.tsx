import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { MarketplaceCategory, MarketplaceListing } from "../types";
import { MARKETPLACE_CATEGORY_LABELS } from "../types";
import { cleanError, fileToBase64, formatDate, formatDateTime, formatMoney, parseMoney } from "../utils";

/**
 * Marketplace — fully interactive, mirroring the phone app: photo-card
 * grid for My listings / Explore, a detail panel with gallery, contact
 * reveal, Message seller, booking requests and report; listing create /
 * edit / delete from Office. Everything runs on the same server actions
 * the phone calls (no parallel backend). Monetization stays PAUSED:
 * no boosts, credits or checkout surfaces — messaging and the contact
 * reveal go through the same free actions the phone uses. Bookings on
 * my listings are listed read-only because no action anywhere (phone
 * included) transitions a booking's status.
 */
type Tab = "mine" | "explore" | "inbox" | "bookings";

const LISTING_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

function priceLine(l: MarketplaceListing): string {
  if (l.bookable && parseMoney(l.dailyRate) > 0) return `${formatMoney(l.dailyRate)}/day`;
  if (l.priceKind === "free") return "Free";
  if (l.priceKind === "contact") return "Contact for price";
  return formatMoney(l.price);
}

function moderationLabel(status: MarketplaceListing["moderationStatus"]): string {
  return status === "pending_review" ? "Under review" : status === "auto_rejected" ? "Rejected" : status === "removed" ? "Removed" : "Active";
}

export function MarketplaceView() {
  const [tab, setTab] = useState<Tab>("mine");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState<MarketplaceCategory | null>(null);
  const [selectedListingId, setSelectedListingId] = useState<number | null>(null);
  const [selectedConvoId, setSelectedConvoId] = useState<number | null>(null);
  const [formListingId, setFormListingId] = useState<number | null | undefined>(undefined);
  const searchTimer = useRef<number | undefined>(undefined);

  const gateQuery = useQuery({ queryKey: ["marketplace-gate"], queryFn: () => api.marketplaceGate({}), retry: false });
  const listingsQuery = useQuery({
    queryKey: ["marketplace-listings", debounced, category],
    queryFn: () => api.listMarketplaceListings({ search: debounced, category, serviceArea: "" }),
  });
  const inboxQuery = useQuery({
    queryKey: ["marketplace-inbox"],
    queryFn: () => api.marketplaceConversations({}),
    refetchInterval: 30_000,
  });
  const bookingsQuery = useQuery({
    queryKey: ["marketplace-bookings"],
    queryFn: () => api.listMarketplaceBookings({ listingId: null }),
    enabled: tab === "bookings",
  });

  const listings = useMemo(() => listingsQuery.data?.listings ?? [], [listingsQuery.data]);
  const mine = useMemo(() => listings.filter((l) => l.isMine), [listings]);
  const myListingIds = useMemo(() => new Set(mine.map((l) => l.id)), [mine]);
  const conversations = inboxQuery.data?.conversations ?? [];
  const myBookings = useMemo(
    () => (bookingsQuery.data?.bookings ?? []).filter((b) => myListingIds.has(b.listingId)),
    [bookingsQuery.data, myListingIds],
  );
  const selectedListing = listings.find((l) => l.id === selectedListingId) ?? null;
  const listingTitle = (id: number) => listings.find((l) => l.id === id)?.title ?? `Listing #${id}`;
  const formOpen = formListingId !== undefined;
  const sideOpen = formOpen || !!selectedListing;

  const openCreate = () => setFormListingId(null);
  const openEdit = (listing: MarketplaceListing) => { setSelectedListingId(listing.id); setFormListingId(listing.id); };

  const disabled = gateQuery.data?.enabled === false;

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Marketplace</h1>
          <p className="view-sub">
            Your listings and conversations — the same Marketplace the phone app shows.
            {gateQuery.data ? ` ${gateQuery.data.myActiveListingCount} of ${gateQuery.data.effectiveListingLimit} free listing slots used.` : ""}
          </p>
        </div>
        <div className="head-controls">
          <select
            className="doc-status-select"
            value={category ?? ""}
            onChange={(e) => setCategory(e.target.value ? (e.target.value as MarketplaceCategory) : null)}
            aria-label="Category filter"
          >
            <option value="">All categories</option>
            {(Object.keys(MARKETPLACE_CATEGORY_LABELS) as MarketplaceCategory[]).map((c) => (
              <option key={c} value={c}>{MARKETPLACE_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <div className="search-box">
            <input
              value={search}
              placeholder="Search listings…"
              onChange={(e) => {
                setSearch(e.target.value);
                window.clearTimeout(searchTimer.current);
                searchTimer.current = window.setTimeout(() => setDebounced(e.target.value), 250);
              }}
            />
          </div>
          {!disabled ? (
            <button type="button" className="btn btn-primary" onClick={openCreate}>+ Post a listing</button>
          ) : null}
        </div>
      </div>

      {disabled ? (
        <div className="empty-state">
          <div className="empty-icon">🏪</div>
          <p>Marketplace is temporarily disabled. Please check back later.</p>
        </div>
      ) : (
        <>
          <div className="segmented market-tabs" role="group" aria-label="Marketplace views">
            <button type="button" className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>My listings ({mine.length})</button>
            <button type="button" className={tab === "explore" ? "active" : ""} onClick={() => setTab("explore")}>Explore ({listings.length})</button>
            <button type="button" className={tab === "inbox" ? "active" : ""} onClick={() => setTab("inbox")}>
              Conversations ({conversations.length}){(inboxQuery.data?.unreadCount ?? 0) > 0 ? ` · ${inboxQuery.data?.unreadCount} unread` : ""}
            </button>
            <button type="button" className={tab === "bookings" ? "active" : ""} onClick={() => setTab("bookings")}>Bookings on my listings</button>
          </div>

          {(tab === "mine" || tab === "explore") ? (
            <div className={sideOpen ? "split-layout doc-split" : ""}>
              <section className="panel listing-grid-panel">
                {listingsQuery.isLoading ? <div className="view-loading">Loading listings…</div> : null}
                {listingsQuery.isError ? (
                  <div className="empty-state">
                    <div className="empty-icon">◍</div>
                    <p>Couldn't load listings.</p>
                    <button type="button" className="btn btn-primary" onClick={() => void listingsQuery.refetch()}>Try again</button>
                  </div>
                ) : null}
                {!listingsQuery.isLoading && !listingsQuery.isError && (tab === "mine" ? mine : listings).length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">🏪</div>
                    <p>{tab === "mine" ? "No listings of yours match — post your first one right here." : "No listings match this filter."}</p>
                    {tab === "mine" ? <button type="button" className="btn btn-primary" onClick={openCreate}>+ Post a listing</button> : null}
                  </div>
                ) : null}
                {(tab === "mine" ? mine : listings).length > 0 ? (
                  <div className="listing-grid">
                    {(tab === "mine" ? mine : listings).map((l) => (
                      <ListingCard
                        key={l.id}
                        listing={l}
                        selected={l.id === selectedListingId && !formOpen}
                        onOpen={() => { setFormListingId(undefined); setSelectedListingId(l.id); }}
                        onEdit={() => openEdit(l)}
                        onDeleted={() => { if (selectedListingId === l.id) setSelectedListingId(null); }}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
              {formOpen ? (
                <ListingFormPanel
                  listingId={formListingId ?? null}
                  onClose={() => setFormListingId(undefined)}
                  onSaved={(id) => { setFormListingId(undefined); setSelectedListingId(id); }}
                />
              ) : selectedListing ? (
                <ListingDetail
                  key={selectedListing.id}
                  listing={selectedListing}
                  onClose={() => setSelectedListingId(null)}
                  onOpenConversation={(id) => { setSelectedConvoId(id); setTab("inbox"); }}
                  onEdit={() => openEdit(selectedListing)}
                  onDeleted={() => setSelectedListingId(null)}
                  conversations={conversations.filter((c) => c.listingId === selectedListing.id)}
                />
              ) : null}
            </div>
          ) : null}

          {tab === "inbox" ? (
            <div className={selectedConvoId ? "split-layout doc-split" : ""}>
              <section className="panel table-panel">
                {inboxQuery.isLoading ? <div className="view-loading">Loading conversations…</div> : null}
                {inboxQuery.isError ? <p className="inline-error">Couldn't load conversations.</p> : null}
                {!inboxQuery.isLoading && conversations.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">✉</div>
                    <p>No conversations yet — messages about listings will appear here.</p>
                  </div>
                ) : null}
                {conversations.length > 0 ? (
                  <table className="data-table">
                    <thead>
                      <tr><th>Listing</th><th>With</th><th>Last message</th><th>When</th><th></th></tr>
                    </thead>
                    <tbody>
                      {conversations.map((c) => (
                        <tr key={c.id} className={c.id === selectedConvoId ? "selected" : ""} onClick={() => setSelectedConvoId(c.id)}>
                          <td><span className="doc-title-cell">{c.listingTitle}</span><span className="feed-meta block">{c.isInquiry ? "Your inquiry" : "On your listing"}</span></td>
                          <td>{c.otherPartyName}</td>
                          <td className="cell-address">{c.lastMessage || "—"}</td>
                          <td>{formatDateTime(c.lastMessageAt)}</td>
                          <td>{c.unreadCount > 0 ? <span className="status-pill viewed">{c.unreadCount} unread</span> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </section>
              {selectedConvoId ? <ConversationPanel conversationId={selectedConvoId} onClose={() => setSelectedConvoId(null)} /> : null}
            </div>
          ) : null}

          {tab === "bookings" ? (
            <section className="panel table-panel">
              {bookingsQuery.isLoading ? <div className="view-loading">Loading bookings…</div> : null}
              {!bookingsQuery.isLoading && myBookings.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📅</div>
                  <p>No booking requests on your listings yet.</p>
                </div>
              ) : null}
              {myBookings.length > 0 ? (
                <table className="data-table">
                  <thead>
                    <tr><th>Listing</th><th>Dates</th><th>Note</th><th>Status</th><th>Requested</th></tr>
                  </thead>
                  <tbody>
                    {myBookings.map((b) => (
                      <tr key={b.id}>
                        <td><span className="doc-title-cell">{listingTitle(b.listingId)}</span></td>
                        <td>{formatDate(b.startDate)} → {formatDate(b.endDate)}</td>
                        <td className="cell-address">{b.note || "—"}</td>
                        <td><span className={`status-pill ${b.status === "confirmed" ? "signed" : b.status === "declined" ? "overdue" : "viewed"}`}>{b.status}</span></td>
                        <td>{formatDate(b.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function ListingCard({
  listing,
  selected,
  onOpen,
  onEdit,
  onDeleted,
}: {
  listing: MarketplaceListing;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteMarketplaceListing({ id: listing.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["marketplace-listings"] });
      void queryClient.invalidateQueries({ queryKey: ["marketplace-gate"] });
      onDeleted();
    },
    onError: (e) => setError(cleanError(e)),
  });
  const cover = listing.photos[0];
  return (
    <article className={`listing-card${selected ? " selected" : ""}`}>
      <button type="button" className="listing-card-main" onClick={onOpen} aria-label={`${listing.title}, ${priceLine(listing)}`}>
        <span className="listing-cover">
          {cover ? (
            <img src={cover.url} alt={listing.title} loading="lazy" />
          ) : (
            <span className="listing-cover-placeholder" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 16l5-5 4 4 3-3 6 6" />
                <circle cx="9" cy="9.5" r="1.4" />
              </svg>
            </span>
          )}
          <span className="listing-cover-badges">
            <span className={`status-pill ${listing.intent === "need" ? "viewed" : "sent"}`}>{listing.intent === "need" ? "Wanted" : "Available"}</span>
            {listing.featured ? <span className="chip market-chip">★ Featured</span> : null}
            {listing.promoted ? <span className="chip market-chip">Promoted</span> : null}
            {listing.justListed ? <span className="chip market-chip">Just listed</span> : null}
          </span>
        </span>
        <span className="listing-card-body">
          <span className="listing-price">{priceLine(listing)}</span>
          <span className="listing-title">{listing.title}</span>
          <span className="listing-meta">
            {MARKETPLACE_CATEGORY_LABELS[listing.category]} · {listing.companyName}
            {listing.verified ? " · Verified" : ""}
            {listing.isMine ? " · Yours" : ""}
          </span>
          <span className="listing-meta">{listing.serviceArea}{listing.zipCode ? ` ${listing.zipCode}` : ""} · {formatDate(listing.createdAt)}</span>
          {listing.isMine && listing.moderationStatus !== "active" ? (
            <span className="listing-meta"><span className="status-pill overdue">{moderationLabel(listing.moderationStatus)}</span></span>
          ) : null}
        </span>
      </button>
      {listing.isMine ? (
        <div className="listing-card-actions">
          {confirmingDelete ? (
            <>
              <span className="feed-meta">Delete this listing?</span>
              <button type="button" className="btn btn-danger-ghost btn-small" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
                {deleteMutation.isPending ? "Deleting…" : "Yes, delete"}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmingDelete(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost btn-small" onClick={onEdit}>Edit</button>
              <button type="button" className="btn btn-danger-ghost btn-small" onClick={() => { setError(""); setConfirmingDelete(true); }}>Delete</button>
            </>
          )}
        </div>
      ) : null}
      {error ? <p className="inline-error">{error}</p> : null}
    </article>
  );
}

type ReportReason = "spam" | "explicit" | "illegal" | "scam" | "misleading" | "other";
const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "explicit", label: "Explicit content" },
  { value: "illegal", label: "Illegal" },
  { value: "scam", label: "Scam" },
  { value: "misleading", label: "Misleading" },
  { value: "other", label: "Other" },
];

function ListingDetail({
  listing,
  onClose,
  onOpenConversation,
  onEdit,
  onDeleted,
  conversations,
}: {
  listing: MarketplaceListing;
  onClose: () => void;
  onOpenConversation: (id: number) => void;
  onEdit: () => void;
  onDeleted: () => void;
  conversations: { id: number; otherPartyName: string; unreadCount: number }[];
}) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["marketplace-listing", listing.id],
    queryFn: () => api.getMarketplaceListing({ id: listing.id }),
  });
  const l = detailQuery.data?.listing ?? listing;
  const [activePhoto, setActivePhoto] = useState(0);
  const [revealedPhone, setRevealedPhone] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [bookingOpen, setBookingOpen] = useState(false);
  const [booking, setBooking] = useState({ startDate: "", endDate: "", note: "" });
  const [bookingSent, setBookingSent] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("spam");
  const [reportDetails, setReportDetails] = useState("");
  const [reportDone, setReportDone] = useState(false);

  const invalidateListings = () => {
    void queryClient.invalidateQueries({ queryKey: ["marketplace-listings"] });
    void queryClient.invalidateQueries({ queryKey: ["marketplace-gate"] });
  };
  const startConvo = useMutation({
    mutationFn: () => api.startMarketplaceConversation({ listingId: l.id }),
    onSuccess: (res) => { setActionError(""); onOpenConversation(res.conversationId); },
    onError: (e) => setActionError(cleanError(e)),
  });
  const reveal = useMutation({
    mutationFn: () => api.unlockMarketplaceContact({ listingId: l.id }),
    onSuccess: (res) => { setActionError(""); setRevealedPhone(res.phone ?? ""); },
    onError: (e) => setActionError(cleanError(e)),
  });
  const bookingMutation = useMutation({
    mutationFn: () => api.createMarketplaceBooking({ listingId: l.id, ...booking }),
    onSuccess: () => { setBookingSent(true); setActionError(""); },
    onError: (e) => setActionError(cleanError(e)),
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteMarketplaceListing({ id: l.id }),
    onSuccess: () => { invalidateListings(); onDeleted(); },
    onError: (e) => setActionError(cleanError(e)),
  });
  const reportMutation = useMutation({
    mutationFn: () => api.marketplaceListingFlag({ listingId: l.id, reason: reportReason, details: reportDetails }),
    onSuccess: () => { setReportDone(true); setActionError(""); },
    onError: (e) => setActionError(cleanError(e)),
  });

  const mainPhoto = l.photos[activePhoto] ?? l.photos[0];

  return (
    <aside className="panel detail-panel">
      <div className="drawer-head">
        <div>
          <h2>{l.title}</h2>
          <span className="drawer-sub">{MARKETPLACE_CATEGORY_LABELS[l.category]} · {l.intent === "need" ? "Wanted" : "Available"}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {l.photos.length > 0 && mainPhoto ? (
        <div className="listing-gallery">
          <a href={mainPhoto.url} target="_blank" rel="noopener noreferrer">
            <img className="gallery-main" src={mainPhoto.url} alt={mainPhoto.filename || l.title} />
          </a>
          {l.photos.length > 1 ? (
            <div className="gallery-thumbs">
              {l.photos.map((p, i) => (
                <button key={p.id} type="button" className={i === activePhoto ? "active" : ""} onClick={() => setActivePhoto(i)} aria-label={`Photo ${i + 1}`}>
                  <img src={p.url} alt={p.filename || `${l.title} photo ${i + 1}`} loading="lazy" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <dl className="detail-list">
        <div><dt>Price</dt><dd>{priceLine(l)}{l.priceKind === "amount" && parseMoney(l.originalPrice) > parseMoney(l.price) ? ` (was ${formatMoney(l.originalPrice)})` : ""}</dd></div>
        <div><dt>Company</dt><dd>{l.companyName}{l.verified ? " · Verified" : ""}</dd></div>
        <div><dt>Area</dt><dd>{l.serviceArea}{l.zipCode ? ` · ${l.zipCode}` : ""}</dd></div>
        {l.neededBy ? <div><dt>Needed by</dt><dd>{l.neededBy}</dd></div> : null}
        {l.bookable ? <div><dt>Bookable</dt><dd>Yes · {formatMoney(l.dailyRate)}/day</dd></div> : null}
        <div>
          <dt>Contact</dt>
          <dd>
            {l.isMine
              ? (l.companyPhone || "—")
              : revealedPhone !== null
                ? (revealedPhone || "No phone number listed — send them a message instead.")
                : l.contactUnlocked && l.companyPhone
                  ? l.companyPhone
                  : (
                    <button type="button" className="btn btn-ghost btn-small" disabled={reveal.isPending} onClick={() => reveal.mutate()}>
                      {reveal.isPending ? "Loading…" : "Show contact"}
                    </button>
                  )}
          </dd>
        </div>
        <div><dt>Posted</dt><dd>{formatDate(l.createdAt)}</dd></div>
        {l.isMine ? <div><dt>Moderation</dt><dd>{moderationLabel(l.moderationStatus)}</dd></div> : null}
      </dl>

      {l.description ? (
        <section className="drawer-section">
          <h3>Description</h3>
          <p className="listing-desc">{l.description}</p>
        </section>
      ) : null}

      {actionError ? <p className="inline-error">{actionError}</p> : null}

      {!l.isMine ? (
        <section className="drawer-section">
          <h3>Contact the seller</h3>
          <div className="detail-actions">
            <button type="button" className="btn btn-primary btn-small" disabled={startConvo.isPending} onClick={() => startConvo.mutate()}>
              {startConvo.isPending ? "Opening…" : "Message seller"}
            </button>
            {l.bookable ? (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => { setBookingSent(false); setBookingOpen((open) => !open); }}>
                Request booking
              </button>
            ) : null}
          </div>
          {bookingOpen && l.bookable ? (
            bookingSent ? (
              <p className="inline-ok">Request sent — the owner will confirm shortly.</p>
            ) : (
              <form
                className="booking-form"
                onSubmit={(e) => { e.preventDefault(); setActionError(""); bookingMutation.mutate(); }}
              >
                <div className="form-grid">
                  <label className="field">
                    <span>Start date</span>
                    <input type="date" required value={booking.startDate} onChange={(e) => setBooking({ ...booking, startDate: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>End date</span>
                    <input type="date" required min={booking.startDate || undefined} value={booking.endDate} onChange={(e) => setBooking({ ...booking, endDate: e.target.value })} />
                  </label>
                </div>
                <label className="field">
                  <span>Note for the owner</span>
                  <textarea rows={3} value={booking.note} onChange={(e) => setBooking({ ...booking, note: e.target.value })} />
                </label>
                <button type="submit" className="btn btn-primary btn-small" disabled={bookingMutation.isPending}>
                  {bookingMutation.isPending ? "Sending…" : "Send request"}
                </button>
              </form>
            )
          ) : null}
        </section>
      ) : null}

      {l.isMine ? (
        <section className="drawer-section">
          <h3>Manage listing</h3>
          {confirmingDelete ? (
            <div className="detail-actions">
              <span className="feed-meta">Delete this listing? It will be removed from Marketplace and one free listing slot will open up.</span>
              <button type="button" className="btn btn-danger-ghost btn-small" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
                {deleteMutation.isPending ? "Deleting…" : "Yes, delete"}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmingDelete(false)}>Cancel</button>
            </div>
          ) : (
            <div className="detail-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={onEdit}>Edit listing</button>
              <button type="button" className="btn btn-danger-ghost btn-small" onClick={() => { setActionError(""); setConfirmingDelete(true); }}>Delete listing</button>
            </div>
          )}
        </section>
      ) : null}

      {conversations.length > 0 ? (
        <section className="drawer-section">
          <h3>Conversations on this listing</h3>
          <ul className="link-list">
            {conversations.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onOpenConversation(c.id)}>
                  <span>{c.otherPartyName}</span>
                  {c.unreadCount > 0 ? <span className="feed-meta">{c.unreadCount} unread</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!l.isMine ? (
        <section className="drawer-section">
          {reportDone ? (
            <p className="inline-ok">Thanks for the report — our team will review this listing soon.</p>
          ) : reportOpen ? (
            <>
              <h3>Report this listing</h3>
              <label className="field">
                <span>Reason</span>
                <select value={reportReason} onChange={(e) => setReportReason(e.target.value as ReportReason)}>
                  {REPORT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Details (optional)</span>
                <textarea rows={3} value={reportDetails} onChange={(e) => setReportDetails(e.target.value)} maxLength={1000} />
              </label>
              <div className="detail-actions">
                <button type="button" className="btn btn-primary btn-small" disabled={reportMutation.isPending} onClick={() => { setActionError(""); reportMutation.mutate(); }}>
                  {reportMutation.isPending ? "Sending…" : "Send report"}
                </button>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setReportOpen(false)}>Cancel</button>
              </div>
            </>
          ) : (
            <button type="button" className="link-btn" onClick={() => setReportOpen(true)}>Report this listing</button>
          )}
        </section>
      ) : null}
    </aside>
  );
}

interface ListingFormState {
  title: string;
  category: MarketplaceCategory;
  intent: "need" | "offer";
  neededBy: string;
  employmentType: "full_time" | "part_time" | "temporary";
  payUnit: "hourly" | "salary";
  priceKind: "amount" | "free" | "contact";
  price: string;
  originalPrice: string;
  description: string;
  serviceArea: string;
  zipCode: string;
  companyName: string;
  companyPhone: string;
  bookable: boolean;
  dailyRate: string;
}

const EMPTY_LISTING_FORM: ListingFormState = {
  title: "", category: "other", intent: "offer", neededBy: "",
  employmentType: "full_time", payUnit: "hourly",
  priceKind: "contact", price: "", originalPrice: "",
  description: "", serviceArea: "", zipCode: "", companyName: "", companyPhone: "",
  bookable: false, dailyRate: "",
};

function ListingFormPanel({
  listingId,
  onClose,
  onSaved,
}: {
  /** null = create a new listing. */
  listingId: number | null;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const existingQuery = useQuery({
    queryKey: ["marketplace-listing", listingId],
    queryFn: () => api.getMarketplaceListing({ id: listingId ?? 0 }),
    enabled: listingId != null,
  });
  const settingsQuery = useQuery({ queryKey: ["settings-company"], queryFn: () => api.getSettings({}) });
  const [form, setForm] = useState<ListingFormState>(EMPTY_LISTING_FORM);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ id: number; reasons: string[] } | null>(null);
  const initializedFor = useRef<number | null | undefined>(undefined);

  // Prefill once: from the listing being edited, else from company settings.
  useEffect(() => {
    if (initializedFor.current !== undefined && initializedFor.current === listingId) return;
    if (listingId != null) {
      const listing = existingQuery.data?.listing;
      if (!listing) return;
      initializedFor.current = listingId;
      setForm({
        title: listing.title, category: listing.category, intent: listing.intent, neededBy: listing.neededBy,
        employmentType: listing.employmentType, payUnit: listing.payUnit, priceKind: listing.priceKind,
        price: listing.price, originalPrice: listing.originalPrice, description: listing.description,
        serviceArea: listing.serviceArea, zipCode: listing.zipCode ?? "", companyName: listing.companyName,
        companyPhone: listing.companyPhone, bookable: listing.bookable, dailyRate: listing.dailyRate,
      });
    } else {
      const settings = settingsQuery.data as { companyName?: string; phone?: string } | undefined;
      if (!settings) return;
      initializedFor.current = null;
      setForm((cur) => ({
        ...cur,
        companyName: cur.companyName || settings.companyName || "",
        companyPhone: cur.companyPhone || settings.phone || "",
      }));
    }
  }, [listingId, existingQuery.data, settingsQuery.data]);

  const existing = listingId != null ? existingQuery.data?.listing ?? null : null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const encoded = await Promise.all(files.map(async (file) => ({
        filename: file.name,
        contentType: file.type as (typeof LISTING_PHOTO_TYPES)[number],
        dataBase64: await fileToBase64(file),
      })));
      if (listingId != null) {
        return api.updateMarketplaceListing({ id: listingId, ...form, replacePhotos: files.length > 0, photos: encoded });
      }
      return api.createMarketplaceListing({ ...form, photos: encoded });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["marketplace-listings"] });
      void queryClient.invalidateQueries({ queryKey: ["marketplace-gate"] });
      void queryClient.invalidateQueries({ queryKey: ["marketplace-listing", result.id] });
      if (result.moderation.flagged) {
        setNotice({ id: result.id, reasons: result.moderation.reasons });
      } else {
        onSaved(result.id);
      }
    },
    onError: (e) => setError(cleanError(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.title.trim() || !form.serviceArea.trim() || !form.zipCode.trim()) {
      setError("Add a title, service area, and ZIP code.");
      return;
    }
    if (!/^\d{5}$/.test(form.zipCode.trim())) {
      setError("Enter a valid 5-digit ZIP code.");
      return;
    }
    saveMutation.mutate();
  };

  const pickFiles = (picked: FileList | null) => {
    if (!picked) return;
    const next = Array.from(picked);
    for (const file of next) {
      if (!(LISTING_PHOTO_TYPES as readonly string[]).includes(file.type)) {
        setError("Use JPG, PNG, or WebP photos.");
        return;
      }
      if (file.size > 20_000_000) {
        setError("That photo is too large — pick one under 20 MB.");
        return;
      }
    }
    if (next.length > 8) {
      setError("Up to 8 photos per listing.");
      return;
    }
    setError("");
    setFiles(next);
  };

  if (notice) {
    return (
      <aside className="panel detail-panel">
        <div className="drawer-head">
          <div>
            <h2>{listingId != null ? "Listing updated" : "Listing submitted"}</h2>
            <span className="drawer-sub">Marketplace moderation</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => onSaved(notice.id)} aria-label="Close">✕</button>
        </div>
        <p>Your listing was flagged for review before it goes live:</p>
        <ul className="flag-reasons">
          {notice.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
        <button type="button" className="btn btn-primary" onClick={() => onSaved(notice.id)}>Done</button>
      </aside>
    );
  }

  return (
    <aside className="panel detail-panel">
      <div className="drawer-head">
        <div>
          <h2>{listingId != null ? "Edit listing" : "Post a listing"}</h2>
          <span className="drawer-sub">{listingId != null ? (existing?.title ?? "") : "It goes to the same Marketplace the phone app shows."}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {listingId != null && existingQuery.isLoading ? <p className="muted">Loading listing…</p> : null}
      {listingId != null && !existingQuery.isLoading && !existing ? <p className="inline-error">This listing could not be found.</p> : null}
      <form className="listing-form" onSubmit={submit}>
        <div className="segmented" role="group" aria-label="What are you posting?">
          <button type="button" className={form.intent === "offer" ? "active" : ""} onClick={() => setForm({ ...form, intent: "offer" })}>Available — I offer this</button>
          <button type="button" className={form.intent === "need" ? "active" : ""} onClick={() => setForm({ ...form, intent: "need" })}>Wanted — I need this</button>
        </div>
        <label className="field">
          <span>Title</span>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Cabinet installation available" maxLength={180} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Trade category</span>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as MarketplaceCategory })}>
              {(Object.keys(MARKETPLACE_CATEGORY_LABELS) as MarketplaceCategory[]).map((c) => (
                <option key={c} value={c}>{MARKETPLACE_CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Price</span>
            <select value={form.priceKind} onChange={(e) => setForm({ ...form, priceKind: e.target.value as ListingFormState["priceKind"] })}>
              <option value="contact">Contact for price</option>
              <option value="amount">Set a price</option>
              <option value="free">Free</option>
            </select>
          </label>
        </div>
        {form.priceKind === "amount" ? (
          <div className="form-grid">
            <label className="field">
              <span>Current price</span>
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="e.g. 250" inputMode="decimal" />
            </label>
            <label className="field">
              <span>Original price (optional)</span>
              <input value={form.originalPrice} onChange={(e) => setForm({ ...form, originalPrice: e.target.value })} inputMode="decimal" />
            </label>
          </div>
        ) : null}
        {form.intent === "need" ? (
          <>
            <label className="field">
              <span>Needed by (optional)</span>
              <input value={form.neededBy} onChange={(e) => setForm({ ...form, neededBy: e.target.value })} maxLength={80} />
            </label>
            <div className="form-grid">
              <label className="field">
                <span>Employment terms</span>
                <select value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value as ListingFormState["employmentType"] })}>
                  <option value="full_time">Full-time</option>
                  <option value="part_time">Part-time</option>
                  <option value="temporary">Temporary</option>
                </select>
              </label>
              <label className="field">
                <span>Pay type</span>
                <select value={form.payUnit} onChange={(e) => setForm({ ...form, payUnit: e.target.value as ListingFormState["payUnit"] })}>
                  <option value="hourly">Hourly</option>
                  <option value="salary">Salary</option>
                </select>
              </label>
            </div>
          </>
        ) : null}
        <label className="field">
          <span>Description</span>
          <textarea rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={5000} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Service area</span>
            <input value={form.serviceArea} onChange={(e) => setForm({ ...form, serviceArea: e.target.value })} placeholder="e.g. Tampa Bay" maxLength={160} />
          </label>
          <label className="field">
            <span>ZIP code</span>
            <input value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: e.target.value })} inputMode="numeric" maxLength={5} />
          </label>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Company name (optional)</span>
            <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} maxLength={180} />
          </label>
          <label className="field">
            <span>Contact phone (optional)</span>
            <input value={form.companyPhone} onChange={(e) => setForm({ ...form, companyPhone: e.target.value })} maxLength={80} />
          </label>
        </div>
        <label className="field checkbox-field">
          <input type="checkbox" checked={form.bookable} onChange={(e) => setForm({ ...form, bookable: e.target.checked })} />
          <span>Allow bookings — for trailers, equipment, or other items rented by the day</span>
        </label>
        {form.bookable ? (
          <label className="field">
            <span>Price per day</span>
            <input value={form.dailyRate} onChange={(e) => setForm({ ...form, dailyRate: e.target.value })} inputMode="decimal" />
          </label>
        ) : null}
        <div className="field">
          <span>Photos — up to 8 JPG, PNG, or WebP</span>
          {existing && existing.photos.length > 0 ? (
            <>
              <div className="listing-photos">
                {existing.photos.map((p) => <img key={p.id} src={p.url} alt={p.filename || existing.title} loading="lazy" />)}
              </div>
              <p className="feed-meta">Your current photos stay unless you choose new ones — new photos replace them.</p>
            </>
          ) : null}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => pickFiles(e.target.files)} aria-label="Listing photos" />
          {files.length > 0 ? <p className="feed-meta">{files.length} photo{files.length === 1 ? "" : "s"} ready to upload.</p> : null}
        </div>
        {error ? <p className="inline-error">{error}</p> : null}
        <div className="detail-actions">
          <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : listingId != null ? "Save changes" : "Publish listing"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </aside>
  );
}

function ConversationPanel({ conversationId, onClose }: { conversationId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const threadQuery = useQuery({
    queryKey: ["marketplace-thread", conversationId],
    queryFn: () => api.marketplaceConversation({ conversationId }),
    refetchInterval: 15_000,
  });
  const markRead = useMutation({
    mutationFn: () => api.markMarketplaceConversationRead({ conversationId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["marketplace-inbox"] }),
    onError: () => { /* read state is best-effort */ },
  });
  const latestId = threadQuery.data?.messages.length ? threadQuery.data.messages[threadQuery.data.messages.length - 1]?.id : null;
  const markedFor = useRef<number | null>(null);
  if (threadQuery.data && latestId != null && markedFor.current !== latestId) {
    markedFor.current = latestId;
    // Same behavior as the phone thread: opening marks the caller's side read.
    setTimeout(() => markRead.mutate(), 0);
  }
  const sendMutation = useMutation({
    mutationFn: () => api.sendMarketplaceMessage({ conversationId, body: draft.trim(), image: null }),
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["marketplace-thread", conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["marketplace-inbox"] });
    },
    onError: (e) => setError(cleanError(e)),
  });
  const convo = threadQuery.data;

  return (
    <aside className="panel detail-panel">
      <div className="drawer-head">
        <div>
          <h2>{convo ? convo.otherPartyName : "Conversation"}</h2>
          <span className="drawer-sub">{convo ? `${convo.listingTitle} · ${convo.isInquiry ? "Your inquiry" : "On your listing"}` : ""}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {threadQuery.isLoading ? <p className="muted">Loading messages…</p> : null}
      {threadQuery.isError ? <p className="inline-error">Couldn't load this conversation.</p> : null}
      {convo && convo.messages.length === 0 ? <p className="muted">No messages yet — start the conversation below.</p> : null}
      {convo ? (
        <div className="thread-list">
          {convo.messages.map((m) => (
            <article key={m.id} className={`thread-msg${m.outgoing ? " outgoing" : ""}`}>
              {!m.outgoing ? <span className="feed-meta">{m.senderName}</span> : null}
              {m.imageUrl ? <img className="thread-img" src={m.imageUrl} alt={m.imageFilename || "Attached photo"} loading="lazy" /> : null}
              {m.body ? <p>{m.body}</p> : null}
              <time className="feed-meta">{formatDateTime(m.createdAt)}</time>
            </article>
          ))}
        </div>
      ) : null}
      {error ? <p className="inline-error">{error}</p> : null}
      <form
        className="thread-composer"
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { setError(""); sendMutation.mutate(); } }}
      >
        <textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a message…" aria-label="Write a message" />
        <button type="submit" className="btn btn-primary btn-small" disabled={!draft.trim() || sendMutation.isPending}>
          {sendMutation.isPending ? "Sending…" : "Send"}
        </button>
      </form>
      <p className="muted small">Text replies only in Office — attach photos from the phone app.</p>
    </aside>
  );
}
