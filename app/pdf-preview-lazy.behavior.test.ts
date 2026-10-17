// Lazy PDF preview pages (2026-10-16, contract white-screen fix).
//
// DocumentPdfPages (document detail screen) used to fetch the uploaded PDF,
// hold it as a base64 data URL, receive up to 20 rasterized pages as base64
// in ONE response, and mount EVERY page as a data-URL <img> at once — the
// decoded bitmaps plus the source payload are what exhausted the Android
// WebView when Danny opened an uploaded-PDF contract (any contract, any
// job, reproducible white screen).
//
// Fix pinned here:
//  - NEW LazyPdfPageImage: a same-shape placeholder slot per page; the
//    <img> mounts only when the slot nears the viewport
//    (IntersectionObserver, generous rootMargin; immediate mount where IO
//    is unavailable).
//  - The source PDF's base64 data URL reference is dropped as soon as the
//    page payload string is extracted — the document is never held twice.
//  - Everything else is unchanged: same layout/classes, same page order,
//    same loading block, same failure copy in both languages, and the zoom
//    viewer (ClientDocPageViewer) still opens from a page tap with the
//    full pages array.
//
// Run from app/:  bun pdf-preview-lazy.behavior.test.ts
import { readFile } from "node:fs/promises";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const appSrc = await readFile("client/src/App.tsx", "utf8");
const themeCss = await readFile("client/src/theme.css", "utf8");

const lazyStart = appSrc.indexOf("function LazyPdfPageImage");
const pagesStart = appSrc.indexOf("function DocumentPdfPages");
const pagesEnd = appSrc.indexOf("function DocumentEditForm", pagesStart);
check("lazy page component exists ahead of DocumentPdfPages", lazyStart > -1 && pagesStart > lazyStart);
const LAZY = appSrc.slice(lazyStart, pagesStart);
const PAGES = appSrc.slice(pagesStart, pagesEnd);

check("page mounting is gated on an IntersectionObserver",
  LAZY.includes("new IntersectionObserver") && LAZY.includes("entry.isIntersecting"));
check("pages pre-mount just before they scroll in (rootMargin)",
  LAZY.includes('rootMargin: "800px 0px"'));
check("the observer disconnects once the page mounts (mount once, no churn)",
  LAZY.includes("observer.disconnect()"));
check("without IntersectionObserver the page mounts immediately (no dead placeholders)",
  LAZY.includes('typeof IntersectionObserver === "undefined"') && LAZY.includes("setNear(true)"));
check("the <img> renders only once the slot is near",
  LAZY.includes("near ? (") && LAZY.includes("<img src={src} alt={alt} />"));
check("off-screen pages render the same-shape placeholder, not an image",
  LAZY.includes('className="pdf-page-placeholder"') && LAZY.includes('className="pdf-page-slot"'));
check("tapping a page slot (or its placeholder) opens the zoom viewer",
  LAZY.includes("onClick={onOpen}"));

check("the detail screen renders pages through the lazy component",
  PAGES.includes("<LazyPdfPageImage") && PAGES.includes("onOpen={() => setViewerIndex(index)}"));
check("pages no longer mount as direct data-URL <img> elements in the map",
  !/pages\.map\(\(page, index\) => \(\s*<img/.test(PAGES));
check("page order, srcs and alt text are unchanged",
  PAGES.includes("src={`data:image/jpeg;base64,${page}`}") && PAGES.includes("alt={`${doc.title} — page ${index + 1}`}") && PAGES.includes("key={`${doc.id}-${index}`}"));
check("the full-PDF data URL is released once the payload is extracted",
  PAGES.includes('const dataBase64 = dataUrl.split(",")[1] ?? "";')
  && PAGES.includes("dataUrl = null;")
  && PAGES.indexOf("dataUrl = null;") < PAGES.indexOf("api.renderPdfPreview"));
check("the preview still comes from renderPdfPreview on the original blob URL",
  PAGES.includes("api.renderPdfPreview({ dataBase64 })") && PAGES.includes("sameOriginBlobPath(originalUrl)"));
check("the loading state is unchanged",
  PAGES.includes('<div className="loading-block" />'));
check("the failure copy is unchanged in both languages",
  PAGES.includes("The PDF couldn't be shown here.") && PAGES.includes("No se pudo mostrar el PDF aquí."));
check("the zoom viewer still opens with the full pages array",
  PAGES.includes("<ClientDocPageViewer") && PAGES.includes("pages={pages}") && PAGES.includes("onNavigate={setViewerIndex}"));
check("placeholder styling mirrors the page frame (letter ratio, same border/shadow)",
  themeCss.includes(".pdf-page-placeholder") && themeCss.includes(".pdf-page-placeholder-ratio")
  && themeCss.includes("padding-top:129.41%") && themeCss.includes(".pdf-page-slot")
  && LAZY.includes('className="pdf-page-placeholder-ratio"'));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll pdf-preview-lazy checks passed.");
