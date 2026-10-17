// formatDate crash regression (2026-10-17).
//
// Production bug: formatDate appended "T12:00:00" to EVERY input,
// assuming date-only strings. DocumentDetailScreen passes full ISO
// timestamps (doc.signedAt / doc.clientSignedAt), producing
// "2026-10-14T01:23:45.678ZT12:00:00" — an Invalid Date. Intl
// format() on it throws RangeError: Invalid time value, which the
// error boundary caught on EVERY contract open (Danny's phone,
// Technical details screenshot 2026-10-17). A quote's sentAt hit the
// same helper the same way.
//
// Pins: the helper accepts both shapes and can never throw —
// unparseable input renders "—".
//
// Run from app/:  bun format-date.behavior.test.ts
import { readFile } from "node:fs/promises";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const appSrc = await readFile("client/src/App.tsx", "utf8");
const start = appSrc.indexOf("function formatDate(value: string, lang: Lang) {");
check("formatDate exists in App.tsx", start >= 0);
const fnSrc = appSrc.slice(start, appSrc.indexOf("\n}", start) + 2);
check("timestamps parse as-is (no unconditional T12:00:00 append)",
  fnSrc.includes('value.includes("T")') && fnSrc.includes("Number.isNaN(d.getTime())"));
check("document screen still formats signedAt through the helper",
  appSrc.includes("formatDate(doc.signedAt, lang)") && appSrc.includes("formatDate(doc.clientSignedAt, lang)"));

// Execute the real implementation (types stripped) against both shapes.
const js = fnSrc.replace("function formatDate(value: string, lang: Lang)", "function formatDate(value, lang)");
const formatDate = new Function(`${js}; return formatDate;`)() as (v: string, l: string) => string;
const fmt = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);

let dateOnly = ""; let threw = false;
try { dateOnly = formatDate("2026-10-14", "en"); } catch { threw = true; }
check("date-only value formats without throwing", !threw && dateOnly === fmt(new Date("2026-10-14T12:00:00")), dateOnly);

let ts = ""; threw = false;
try { ts = formatDate("2026-10-14T01:23:45.678Z", "en"); } catch { threw = true; }
check("full timestamp formats without throwing (the crash)", !threw && ts === fmt(new Date("2026-10-14T01:23:45.678Z")), ts);

let sentAt = ""; threw = false;
try { sentAt = formatDate("2026-10-15T14:02:11.000Z", "en"); } catch { threw = true; }
check("quote sentAt timestamp also safe", !threw && sentAt.length > 0, sentAt);

check("unparseable value renders an em dash instead of throwing", formatDate("not-a-date", "en") === "—");
check("empty value renders an em dash", formatDate("", "en") === "—");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
