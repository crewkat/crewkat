// Regression test — 2026-09-29: tapping a job blanked the whole app.
// Root cause: in JobDetail, the mega-build added hooks (heroRect, wsTab,
// lastSeenMsg, wsMessages, the seen-message effect) AFTER the loading early
// return `if (!job || !query.data) return ...`. First render took the early
// return (fewer hooks); once the query resolved the component called more
// hooks -> React threw "Rendered more hooks than during the previous render"
// and, with no error boundary, the entire tree unmounted (dark screen).
//
// This test statically asserts the React rule for JobDetail: every hook call
// must appear before the first conditional early return.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");

const HOOKS = [
  "useState",
  "useEffect",
  "useQuery",
  "useMutation",
  "useRef",
  "useMemo",
  "useCallback",
];

function extractFunction(src: string, name: string): string[] {
  const lines = src.split("\n");
  const startIdx = lines.findIndex((l) => l.startsWith(`function ${name}(`));
  if (startIdx === -1) throw new Error(`function ${name} not found`);
  // Body ends at the next top-level `function ` declaration.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^function \w+\(/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx);
}

function firstConditionalEarlyReturn(body: string[]): number {
  for (let i = 0; i < body.length; i++) {
    const t = body[i].trim();
    if (/^if\s*\(.*\)\s*$/.test(t)) {
      const next = body[i + 1]?.trim() ?? "";
      if (/^return\b/.test(next)) return i;
    } else if (/^if\s*\(.*\)\s*return\b/.test(t)) {
      return i;
    }
  }
  return -1;
}

function hookCallLines(body: string[]): Array<{ line: number; hook: string }> {
  const out: Array<{ line: number; hook: string }> = [];
  body.forEach((text, i) => {
    for (const h of HOOKS) {
      if (new RegExp(`(^|[^\\w])${h}\\s*(<|\\()`).test(text)) {
        out.push({ line: i, hook: h });
      }
    }
  });
  return out;
}

describe("JobDetail hooks-before-early-return", () => {
  const body = extractFunction(SRC, "JobDetail");

  test("JobDetail exists and has a loading early return", () => {
    expect(body.length).toBeGreaterThan(100);
    expect(firstConditionalEarlyReturn(body)).toBeGreaterThan(-1);
  });

  test("no hook is called after the conditional early return", () => {
    const early = firstConditionalEarlyReturn(body);
    const bad = hookCallLines(body).filter((h) => h.line > early);
    expect(
      bad.map((h) => `${h.hook} at relative line ${h.line + 1}`),
    ).toEqual([]);
  });
});
