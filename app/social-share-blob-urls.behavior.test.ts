// Share-to-social blob URL behavior tests (Danny 2026-10-15): on a job
// with one Before photo, tapping "Share to social" in Pictures showed
// "The photos could not be prepared. Try again." and no share happened.
//
// Root cause (client, same defect class as Signatures Phase A ba2e258):
// photo URLs are minted by ctx.blobs.getUrl() on the apex origin
// (CREWKAT_PUBLIC_URL=https://crewkat.com) while the app is served from
// www.crewkat.com. The apex 301-redirects to www and the server sends no
// CORS headers, so fetch() of the photo bytes from the www origin is
// rejected; shareSocial's catch-all turned that into the banner. The
// photos themselves DISPLAY fine everywhere because <img> display needs
// no CORS — only byte fetches (and crossOrigin="anonymous" canvas loads)
// break. Phase A fixed this for the financial-PDF paths with
// sameOriginBlobPath(); the share/photo byte paths were never swept.
//
// Fix: every client byte-fetch / CORS-mode image load of a server-minted
// blob URL now goes through sameOriginBlobPath():
//   1. shareSocial — job Pictures "Share to social" (Danny's repro).
//   2. share_images before/after composer (fetch left/right photo bytes).
//   3. Backup export attachment downloads.
//   4. Website-gallery export bundle photo downloads.
//   5. Job documentation PDF photo embedding.
//   6. Slideshow video maker photo downloads.
//   7. Saved share-video download for nativeShare.
//   8. PhotoAnnotator base image (img.src, crossOrigin="anonymous").
//   9. Progress-update share card images (img.src, crossOrigin="anonymous").
//
// Covers:
//  1. sameOriginBlobPath unit behavior on photo-shaped URLs.
//  2. The origin property that decides success live: the raw minted URL
//     resolves cross-origin against the www app origin, the rewritten
//     one resolves same-origin.
//  3. Source wiring: every site above fetches/loads same-origin, and no
//     bare fetch(<photo>.url) / img.src = <photo>.url survives in App.tsx.
//
// Run from app/:  bun social-share-blob-urls.behavior.test.ts
import { readFile } from "node:fs/promises";
import { sameOriginBlobPath } from "./client/src/financialPdf.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- 1. sameOriginBlobPath on photo URLs ------------------------------------
check(
  "apex photo URL becomes path-relative",
  sameOriginBlobPath("https://crewkat.com/blobs/photos/12/abc.jpg") === "/blobs/photos/12/abc.jpg",
);
check(
  "www photo URL becomes path-relative",
  sameOriginBlobPath("https://www.crewkat.com/blobs/photos/12/abc.jpg") === "/blobs/photos/12/abc.jpg",
);
check(
  "already-relative photo path passes through",
  sameOriginBlobPath("/blobs/photos/12/abc.jpg") === "/blobs/photos/12/abc.jpg",
);

// --- 2. Origin property (why the live fetch failed, and why the fix works) --
const appOrigin = "https://www.crewkat.com";
const minted = "https://crewkat.com/blobs/photos/12/abc.jpg"; // ctx.blobs.getUrl shape with the apex PUBLIC_URL
check(
  "raw minted photo URL is cross-origin from the app",
  new URL(minted, appOrigin).origin !== appOrigin,
);
check(
  "rewritten photo URL resolves same-origin with the app",
  new URL(sameOriginBlobPath(minted), appOrigin).origin === appOrigin,
);

// --- 3. Source wiring ---------------------------------------------------------
const appSrc = await readFile("client/src/App.tsx", "utf8");

check(
  "Share to social fetches photo bytes same-origin",
  appSrc.includes("const response = await fetch(sameOriginBlobPath(p.url));"),
);
check(
  "share_images composer fetches before photo same-origin",
  appSrc.includes("fetch(sameOriginBlobPath(left.url))"),
);
check(
  "share_images composer fetches after photo same-origin",
  appSrc.includes("fetch(sameOriginBlobPath(right.url))"),
);
check(
  "backup export fetches attachments same-origin",
  appSrc.includes("const response = await fetch(sameOriginBlobPath(attachment.url));"),
);
check(
  "gallery export bundle fetches photos same-origin",
  appSrc.includes("const blob = await (await fetch(sameOriginBlobPath(p.url))).blob();"),
);
check(
  "documentation PDF fetches photos same-origin",
  appSrc.includes("const blob = await (await fetch(sameOriginBlobPath(p.url))).blob();\n          doc.addImage("),
);
check(
  "slideshow maker fetches photos same-origin",
  appSrc.includes("const blob = await fetch(sameOriginBlobPath(p.url)).then((r) => r.blob());"),
);
check(
  "saved video share fetches same-origin",
  appSrc.includes("const blob = await fetch(sameOriginBlobPath(v.url)).then((r) => r.blob());"),
);
check(
  "progress share card loads images same-origin",
  appSrc.includes("img.src = sameOriginBlobPath(p.url);"),
);
check(
  "PhotoAnnotator loads its base image same-origin",
  appSrc.includes("img.src = sameOriginBlobPath(photo.url);"),
);

// No bare byte-fetch / CORS load of a server-minted URL may survive.
for (const bare of [
  "fetch(p.url)",
  "fetch(left.url)",
  "fetch(right.url)",
  "fetch(v.url)",
  "fetch(attachment.url)",
  "img.src = p.url;",
  "img.src = photo.url;",
]) {
  check(`no bare ${bare} left in App.tsx`, !appSrc.includes(bare));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
