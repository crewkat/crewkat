import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { MarketplaceCategory, MarketplaceListing } from "../types";
import { MARKETPLACE_CATEGORY_LABELS } from "../types";
import { cleanError, formatDate, formatDateTime, formatMoney, parseMoney } from "../utils";

/**
 * Marketplace (Track 1b). Listings are READ-ONLY here: creating, editing,
 * promoting and deleting listings stay in the phone app for this track
 * (the write actions carry photo-upload + moderation flows that deserve
 * their own desktop pass). Conversations reuse the phone's actions,
 * including a text-only reply; bookings are shown only for my own
 * listings (listMarketplaceBookings returns unscoped rows, so Office
 * filters to listings this account owns before rendering anything).
 */
type Tab = "mine" | "explore" | "inbox" | "bookings";

function priceLine(l: MarketplaceListing): string {
  if (l.bookable && parseMoney(l.dailyRate) > 0) return `${formatMoney(l.dailyRate)}/day`;
  if (l.priceKind === "free") return "Free";
  if (l.priceKind === "contact") return "Contact for price";
  return formatMoney(l.price);
}

export function MarketplaceView() {
  const [tab, setTab] = useState<Tab>("mine");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState<MarketplaceCategory | null>(null);
  const [selectedListingId, setSelectedListingId] = useState<number | null>(null);
  const [selectedConvoId, setSelectedConvoId] = useState<number | null>(null);
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
            <div className={selectedListing ? "split-layout doc-split" : ""}>
              <section className="panel table-panel">
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
                    <p>{tab === "mine" ? "No active listings of yours match — post and manage listings from the phone app." : "No listings match this filter."}</p>
                  </div>
                ) : null}
                {(tab === "mine" ? mine : listings).length > 0 ? (
                  <table className="data-table">
                    <thead>
                      <tr><th>Listing</th><th>Category</th><th>Area</th><th>Price</th><th>Posted</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {(tab === "mine" ? mine : listings).map((l) => (
                        <tr key={l.id} className={l.id === selectedListingId ? "selected" : ""} onClick={() => setSelectedListingId(l.id)}>
                          <td>
                            <span className="doc-title-cell">{l.title}</span>
                            <span className="feed-meta block">{l.companyName}{l.verified ? " · Verified" : ""}{l.isMine ? " · Yours" : ""}</span>
                          </td>
                          <td>{MARKETPLACE_CATEGORY_LABELS[l.category]}</td>
                          <td className="cell-address">{l.serviceArea}{l.zipCode ? ` ${l.zipCode}` : ""}</td>
                          <td className="num">{priceLine(l)}</td>
                          <td>{formatDate(l.createdAt)}</td>
                          <td>
                            <span className={`status-pill ${l.intent === "need" ? "viewed" : "sent"}`}>{l.intent === "need" ? "Wanted" : "Available"}</span>
                            {l.featured ? <span className="chip market-chip">★ Featured</span> : null}
                            {l.promoted ? <span className="chip market-chip">Promoted</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </section>
              {selectedListing ? (
                <ListingDetail
                  listing={selectedListing}
                  onClose={() => setSelectedListingId(null)}
                  onOpenConversation={(id) => { setSelectedConvoId(id); setTab("inbox"); }}
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

function ListingDetail({
  listing,
  onClose,
  onOpenConversation,
  conversations,
}: {
  listing: MarketplaceListing;
  onClose: () => void;
  onOpenConversation: (id: number) => void;
  conversations: { id: number; otherPartyName: string; unreadCount: number }[];
}) {
  const detailQuery = useQuery({
    queryKey: ["marketplace-listing", listing.id],
    queryFn: () => api.getMarketplaceListing({ id: listing.id }),
  });
  const l = detailQuery.data?.listing ?? listing;
  return (
    <aside className="panel detail-panel">
      <div className="drawer-head">
        <div>
          <h2>{l.title}</h2>
          <span className="drawer-sub">{MARKETPLACE_CATEGORY_LABELS[l.category]} · {l.intent === "need" ? "Wanted" : "Available"}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {l.photos.length > 0 ? (
        <div className="listing-photos">
          {l.photos.map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer">
              <img src={p.url} alt={p.filename || l.title} loading="lazy" />
            </a>
          ))}
        </div>
      ) : null}
      <dl className="detail-list">
        <div><dt>Price</dt><dd>{priceLine(l)}{l.priceKind === "amount" && parseMoney(l.originalPrice) > parseMoney(l.price) ? ` (was ${formatMoney(l.originalPrice)})` : ""}</dd></div>
        <div><dt>Company</dt><dd>{l.companyName}{l.verified ? " · Verified" : ""}</dd></div>
        <div><dt>Area</dt><dd>{l.serviceArea}{l.zipCode ? ` · ${l.zipCode}` : ""}</dd></div>
        {l.neededBy ? <div><dt>Needed by</dt><dd>{l.neededBy}</dd></div> : null}
        {l.bookable ? <div><dt>Bookable</dt><dd>Yes · {formatMoney(l.dailyRate)}/day</dd></div> : null}
        <div><dt>Contact</dt><dd>{l.contactUnlocked && l.companyPhone ? l.companyPhone : "Message through a conversation — the phone number stays gated until it's unlocked, same as the phone app."}</dd></div>
        <div><dt>Posted</dt><dd>{formatDate(l.createdAt)}</dd></div>
        {l.isMine ? <div><dt>Moderation</dt><dd>{l.moderationStatus}</dd></div> : null}
      </dl>
      {l.description ? (
        <section className="drawer-section">
          <h3>Description</h3>
          <p className="listing-desc">{l.description}</p>
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
      <p className="muted small">Listings are managed (post, edit, promote, delete) in the phone app for now — Office is read-only for listings in this track.</p>
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
