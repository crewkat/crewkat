// Proof packet photo squish (Danny, 2026-10-15 — screenshot of the
// "New construct" job's packet: every photo flattened into a wide band).
//
// Root cause: ProofPacket drew each photo with jsPDF at full content
// width (528pt) × a FIXED 175pt height — a ~3.02:1 slot — regardless of
// the photo's natural aspect ratio, so jsPDF stretched/squashed every
// image into that box (a 4:3 photo lost more than half its height).
// The space(225) pagination and y += 186 advance were built around the
// same fixed height.
//
// Fix pinned here:
//  - fitPhotoBox (client/src/pdfPhotoFit.ts) fits the WHOLE photo inside
//    (content width × PROOF_PHOTO_MAX_HEIGHT) at its natural ratio — no
//    stretch, no cover-crop; height-capped photos center horizontally.
//  - normalizePhotoForPdf returns the (ratio-preserving) downscaled
//    dimensions alongside the data URL, and the packet paginates with
//    each photo's computed height + caption so nothing splits/overlaps.
//
// Run from app/:  bun proof-packet-aspect.behavior.test.ts
import { readFile } from "node:fs/promises";
import { fitPhotoBox, PROOF_PHOTO_MAX_HEIGHT } from "./client/src/pdfPhotoFit.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

// The packet's real geometry: letter page, 42pt margins each side.
const CONTENT_W = 612 - 42 * 2; // 528
const MAX_H = PROOF_PHOTO_MAX_HEIGHT;

check("max height cap is the specced 340pt", MAX_H === 340, String(MAX_H));

// --- Ratio preservation + bounds across shapes -------------------------------
const shapes: Array<[string, number, number]> = [
  ["landscape 4:3", 1200, 900],
  ["landscape 16:9", 1600, 900],
  ["square 1:1", 1000, 1000],
  ["portrait 3:4", 900, 1200],
  ["portrait 9:16", 900, 1600],
  ["extreme panorama", 3000, 800],
];
for (const [label, nw, nh] of shapes) {
  const fit = fitPhotoBox(nw, nh, CONTENT_W, MAX_H);
  check(`${label}: drawn ratio equals natural ratio`,
    Math.abs(fit.width / fit.height - nw / nh) < 1e-6,
    `${fit.width}x${fit.height} vs ${nw}x${nh}`);
  check(`${label}: within bounds`, fit.width <= CONTENT_W + 1e-9 && fit.height <= MAX_H + 1e-9,
    `${fit.width}x${fit.height}`);
  check(`${label}: centered (offsetX symmetric)`,
    near(fit.offsetX, (CONTENT_W - fit.width) / 2, 1e-9) && fit.offsetX >= 0,
    String(fit.offsetX));
}

// --- Exact placements ----------------------------------------------------------
{
  const f = fitPhotoBox(1600, 900, CONTENT_W, MAX_H);
  check("16:9 draws full width at 297pt tall", near(f.width, 528) && near(f.height, 297) && near(f.offsetX, 0),
    `${f.width}x${f.height}@${f.offsetX}`);
}
{
  const f = fitPhotoBox(1200, 900, CONTENT_W, MAX_H);
  check("4:3 caps at max height, centered", near(f.height, 340) && near(f.width, 340 * (4 / 3)) && near(f.offsetX, (528 - 340 * (4 / 3)) / 2),
    `${f.width}x${f.height}@${f.offsetX}`);
}
{
  const f = fitPhotoBox(900, 1200, CONTENT_W, MAX_H);
  check("portrait 3:4 caps at max height, centered", near(f.height, 340) && near(f.width, 255) && near(f.offsetX, 136.5),
    `${f.width}x${f.height}@${f.offsetX}`);
}
{
  const f = fitPhotoBox(3000, 800, CONTENT_W, MAX_H);
  check("panorama draws full width, short height", near(f.width, 528) && near(f.height, 528 / 3.75) && near(f.offsetX, 0),
    `${f.width}x${f.height}@${f.offsetX}`);
}
{
  const f = fitPhotoBox(0, 0, CONTENT_W, MAX_H);
  check("degenerate dimensions stay finite and in bounds",
    Number.isFinite(f.width) && Number.isFinite(f.height) && f.width > 0 && f.height > 0 && f.height <= MAX_H,
    `${f.width}x${f.height}`);
}

// --- Static pins on the packet wiring ------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
check("App imports the fit helper",
  appSrc.includes('import { fitPhotoBox, PROOF_PHOTO_MAX_HEIGHT } from "./pdfPhotoFit";'));
check("the fixed 175pt draw slot is gone",
  !appSrc.includes("w - margin * 2,\n            175,"));
check("normalizePhotoForPdf returns the photo dimensions",
  appSrc.includes('return { dataUrl: canvas.toDataURL("image/jpeg", 0.85), width: w, height: h };'));
check("photo draw uses the fitted box, centered",
  appSrc.includes("margin + img.offsetX,") && appSrc.includes("img.width,") && appSrc.includes("img.height,"));
check("pagination reserves the computed photo height + caption",
  appSrc.includes("space((img ? img.height + 11 : 30) + 24);"));
check("vertical advance follows the drawn height",
  appSrc.includes("y += img.height + 11;"));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll proof-packet-aspect checks passed.");
