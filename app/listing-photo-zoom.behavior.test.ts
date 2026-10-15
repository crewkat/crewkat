// Danny 2026-10-14: "In listings the first image isnt tappable to zoom in."
// Root cause: the listing detail fed its photo index through
// useAnimatedDismiss, whose open-test is truthiness — index 0 is falsy, so
// tapping the FIRST photo never opened the viewer (photos 2+ worked). The
// fix retires the scroll-snap PhotoLightbox (no pinch zoom) and mounts the
// app's proven pinch-zoom viewer (ClientDocPageViewer, generalized with a
// photo mode) behind a plain `!== null` check, the same pattern PdfPageView
// uses for document pages.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");

describe("Listing photo zoom (Danny 2026-10-14)", () => {
  test("the falsy-index trap is gone from the listing detail", () => {
    expect(APP).not.toContain("useAnimatedDismiss(lightboxIndex)");
    expect(APP).not.toContain("lightboxSheet");
    expect(APP).not.toContain("function PhotoLightbox");
  });

  test("every gallery photo — including the first — opens the shared zoom viewer", () => {
    // Gallery buttons set the tapped index directly…
    expect(APP).toMatch(/market-detail-photo[\s\S]{0,400}setLightboxIndex\(index\)/);
    // …and the viewer mounts on a plain null check, so index 0 renders.
    expect(APP).toContain("lightboxIndex !== null && listing.photos[lightboxIndex]");
    expect(APP).toContain('kind="photo"');
    expect(APP).toContain("urls={listing.photos.map((photo) => photo.url)}");
    expect(APP).toContain("onNavigate={setLightboxIndex}");
  });

  test("the shared viewer supports photo mode (urls + Photo/Foto unit)", () => {
    expect(APP).toContain("urls?: string[]");
    expect(APP).toContain('kind?: "page" | "photo"');
    expect(APP).toContain("urls ? urls[index]");
    expect(APP).toContain('kind === "photo" ? (lang === "es" ? "Foto" : "Photo")');
    // Pinch range is the doc viewer's 1x–4x.
    expect(APP).toContain("Math.min(4, Math.max(1, target))");
  });

  test("document pages still use the same viewer in page mode (no regression)", () => {
    const pdfView = APP.slice(APP.indexOf("function PdfPageView"));
    expect(pdfView).toContain("<ClientDocPageViewer");
    expect(pdfView).toContain("pages={pages}");
    expect(pdfView).not.toContain("urls=");
  });
});
