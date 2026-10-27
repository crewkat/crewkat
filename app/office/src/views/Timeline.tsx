import type { TimelineEvent } from "../types";
import { formatDateTime } from "../utils";

/**
 * Wave 1: the unified timeline feed — documents and their client-link
 * lifecycle, invoices, payments, daily logs, photos, notes,
 * production-stage moves, automation firings and follow-up activity,
 * newest first. Read-model on the server (getJobTimeline /
 * getClientTimeline); amounts are scrubbed server-side for members
 * whose seeMoney switch is off.
 */
const KIND_ICONS: Record<string, string> = {
  job: "🛠",
  client: "👥",
  stage: "▤",
  automation: "⚡",
  document: "📄",
  signed: "✍",
  shared: "↗",
  viewed: "👁",
  estimate: "🧾",
  invoice: "🧾",
  payment: "$",
  log: "📓",
  photo: "📷",
  note: "📝",
  follow_up: "✓",
  system: "·",
};

export function TimelineFeed({ events, isLoading }: { events: TimelineEvent[]; isLoading: boolean }) {
  if (isLoading) return <p className="muted">Loading timeline…</p>;
  if (events.length === 0) return <p className="muted">Nothing here yet — documents, payments, logs and stage moves will appear as they happen.</p>;
  return (
    <ul className="feed-list timeline-feed">
      {events.map((event) => (
        <li key={event.id} className="feed-item">
          <span className={`timeline-dot kind-${event.kind}`} aria-hidden="true">{KIND_ICONS[event.kind] ?? "·"}</span>
          <div className="feed-main">
            <span className="feed-title">{event.title}</span>
            {event.body ? <span className="feed-meta block">{event.body}</span> : null}
            <span className="feed-meta">{formatDateTime(event.at)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
