// Crawl fix round 3 (2026-11-06): Schedule Board mode clarity.
// Rounds 1–2 fixed the board's controls and data (one toolbar; date-only
// jobs ride the board as all-day cards), but live verification still read
// it as broken: entering Board hid the Schedule toolbar, and the board
// itself showed only its Day/Week sub-view buttons plus a "List" button
// styled as a third mode inside the segmented group — "Day" stayed
// highlighted and the surface looked like the Day timeline, so Board
// appeared to do nothing. The board now opens with its own header band
// (dispatch-board-head): the mode's name (Board / Tablero) as the title,
// what the surface does, and the exit as a clearly labelled back action
// ("‹ Back to list" / "‹ Volver a la lista") OUTSIDE the mode group.
// The job detail's Schedule tab (WorkspaceSchedulePanel) has no
// Day/Week/Board modes at all, so there is nothing to align there.
//
// Static guards in the established style (the board is client-rendered;
// the suites pin the shipped source the live bundle is built from).
//
// Run from app/:  bun schedule-board-clarity.behavior.test.ts
import { readFile } from "node:fs/promises";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const clientSrc = await readFile("client/src/App.tsx", "utf8");
const cssSrc = await readFile("client/src/theme.css", "utf8");

const boardStart = clientSrc.indexOf("function DispatchBoard");
const boardBody = clientSrc.slice(boardStart, boardStart + 30000);

check("board: header band renders", boardBody.includes('className="dispatch-board-head"'));
check("board: header names the mode EN", boardBody.includes('"Tablero" : "Board"'));
check(
  "board: exit labelled as a back action EN",
  boardBody.includes("‹ Back to list"),
);
check(
  "board: exit labelled as a back action ES",
  boardBody.includes("‹ Volver a la lista"),
);
check(
  "board: exit sits outside the segmented mode group (before the toolbar)",
  boardBody.indexOf("dispatch-board-head") < boardBody.indexOf("dispatch-toolbar"),
);
check(
  "board: old in-group List/Lista mode button is gone",
  !boardBody.includes('"Lista" : "List"'),
);
check(
  "board: header explains the surface EN",
  boardBody.includes("to move an appointment."),
);
check(
  "board: header explains the surface ES",
  boardBody.includes("para mover una cita."),
);
check("board css: header band styled", cssSrc.includes(".dispatch-board-head"));
check(
  "board css: band is navy-edged (distinct from the Day timeline)",
  /\.dispatch-board-head\s*\{[^}]*border-left:4px solid var\(--navy-800\)/.test(cssSrc),
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
