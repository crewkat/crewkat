// Preview page zoom (Danny 2026-11-09: "Make it where I can zoom a doc in
// preview windows"). The in-app previews render through PdfFrame
// (server-rasterized page images). In zoomable previews a page tap opens
// ClientDocPageViewer — the app's existing pinch-zoom engine (1×–4×,
// drag to pan, double-tap, +/− buttons) already used by the public client
// page and marketplace photos. The one PdfFrame inside the detail pages'
// preview-card <button> stays non-zoomable: its own tap opens the
// fullscreen preview, and that PdfFrame IS zoomable.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const APP = readFileSync("client/src/App.tsx", "utf8");
const CSS = readFileSync("client/src/theme.css", "utf8");

const frameStart = APP.indexOf("function PdfFrame(");
const frameEnd = APP.indexOf("function documentDesignOf(", frameStart);
const FRAME = APP.slice(frameStart, frameEnd);

describe("preview page zoom (Danny 2026-11-09)", () => {
  test("PdfFrame takes lang + zoomable props, both defaulted", () => {
    expect(FRAME).toContain('lang = "en", zoomable = false');
  });

  test("zoomable pages open the pinch-zoom viewer at the tapped page", () => {
    expect(FRAME).toContain("const [viewerIndex, setViewerIndex] = useState<number | null>(null);");
    expect(FRAME).toContain('onClick={zoomable ? () => setViewerIndex(index) : undefined}');
    expect(FRAME).toContain("<ClientDocPageViewer");
    expect(FRAME).toContain("onNavigate={setViewerIndex}");
  });

  test("zoomable pages carry the zoom cursor + the enlarge hint", () => {
    expect(FRAME).toContain('className={zoomable ? "pdf-page-zoomable" : undefined}');
    expect(FRAME).toContain("Tap a page to enlarge it");
    expect(CSS).toContain(".pdf-pages img.pdf-page-zoomable { cursor: zoom-in; }");
    expect(CSS).toContain(".pdf-zoom-hint");
  });

  test("every standalone preview surface is zoomable; only the preview-card button's frame is not", () => {
    const frames = APP.split("\n").filter((line) => line.includes("<PdfFrame"));
    const zoomableCount = frames.filter((line) => line.includes("zoomable")).length;
    const plain = frames.filter((line) => !line.includes("zoomable"));
    expect(zoomableCount).toBe(9);
    expect(plain.length).toBe(1);
    expect(plain[0]).toContain("document-preview-card");
  });

  test("Send action glyph matches the other action-bar glyphs at 16px (Danny 2026-11-09)", () => {
    expect(CSS).toContain(".document-action-bar .doc-action-chip svg { width: 16px; height: 16px;");
    expect(CSS).toContain(".document-action-bar button.doc-action-send svg { width: 16px; height: 16px;");
    expect(CSS).not.toContain(".document-action-bar button.doc-action-send svg { width: 18px;");
  });
});
