// Crane Run weekly leaderboard (0077, Danny 2026-10-14): the board runs on
// calendar weeks in America/New_York — Monday 00:00 ET through Sunday
// 23:59 ET. Score rows are keyed by their ET calendar date ("YYYY-MM-DD"),
// so a week is just the 7 ET date strings from its Monday. All math here
// is pure calendar math on those date strings (weekday of a Y/M/D is the
// same in every zone), with the single zone-sensitive step being "which
// ET date is this instant" (etDateString).

export const CRANE_TZ = "America/New_York";

const etParts = new Intl.DateTimeFormat("en-US", {
  timeZone: CRANE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The America/New_York calendar date ("YYYY-MM-DD") containing `instant`. */
export function etDateString(instant: Date): string {
  let y = "";
  let m = "";
  let d = "";
  for (const part of etParts.formatToParts(instant)) {
    if (part.type === "year") y = part.value;
    else if (part.type === "month") m = part.value;
    else if (part.type === "day") d = part.value;
  }
  return `${y}-${m}-${d}`;
}

function parseDate(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.split("-").map((n) => Number(n));
  return { y: y!, m: m!, d: d! };
}

function formatUTCDate(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Shift a "YYYY-MM-DD" date string by n days (pure calendar math). */
export function addDays(dateStr: string, n: number): string {
  const { y, m, d } = parseDate(dateStr);
  return formatUTCDate(Date.UTC(y, m - 1, d) + n * 86400000);
}

/** Monday ("YYYY-MM-DD") of the week containing the given date string. */
export function weekStartOf(dateStr: string): string {
  const { y, m, d } = parseDate(dateStr);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const sinceMonday = (dow + 6) % 7;
  return addDays(dateStr, -sinceMonday);
}

/** The 7 date strings (Mon..Sun) of the week starting at `weekStart`. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Monday of the current ET week. */
export function currentWeekStart(now: Date = new Date()): string {
  return weekStartOf(etDateString(now));
}

/** Monday of the ET week before the current one (the finished week). */
export function lastWeekStart(now: Date = new Date()): string {
  return addDays(currentWeekStart(now), -7);
}
