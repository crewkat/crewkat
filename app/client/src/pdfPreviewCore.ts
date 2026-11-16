// PDF preview page rendering — fallback policy (pure, no DOM, no pdf.js).
//
// The in-app document preview shows JPEG page images. Historically the
// only rasterizer was the server action `renderPdfPreview` (pdftoppm at
// 120 DPI, max 20 pages), so every preview died offline even though the
// PDF bytes are generated locally (financialPdf.ts) and already on the
// device. This module owns the choice between the two rasterizers:
//
// - Online: server first (the exact path previews have always taken);
//   any server failure falls back to the local pdf.js rasterizer
//   (pdfPreviewLocal.ts) instead of the old "could not be displayed"
//   error — that message now means both engines failed, i.e. the
//   document genuinely can't be rendered on this device.
// - Known offline (connectivity store): local first, so the preview
//   doesn't wait on a doomed network round trip; the server is still
//   tried if local rendering fails (the store can be stale).
//
// An empty page list counts as a failure on either side: the server
// action throws for a pageless PDF, and a local render with zero pages
// is never a usable preview.

/** Rasterization resolution, matched to the server's pdftoppm -r 120. */
export const PREVIEW_DPI = 120;
/** Page cap, matched to the server's pdftoppm -f 1 -l 20. */
export const PREVIEW_MAX_PAGES = 20;
/** pdf.js viewport scale that yields PREVIEW_DPI output. */
export const PREVIEW_RENDER_SCALE = PREVIEW_DPI / 72;
/** JPEG quality for locally rendered pages (pdftoppm's default is 75). */
export const PREVIEW_JPEG_QUALITY = 0.8;

export interface PreviewRenderers {
  /** Server rasterizer: PDF base64 in, per-page JPEG base64 out. */
  serverRender: (dataBase64: string) => Promise<string[]>;
  /** Local rasterizer: PDF blob in, per-page JPEG base64 out. */
  localRender: () => Promise<string[]>;
  /** Connectivity store snapshot — true when the device is known offline. */
  isOffline: () => boolean;
  /** Converts the blob to base64 for the server rasterizer. */
  toBase64: () => Promise<string>;
}

function usable(pages: string[]): boolean {
  return Array.isArray(pages) && pages.length > 0;
}

/**
 * Render preview pages for a locally held PDF blob, preferring the
 * server rasterizer while online and the local one while offline, with
 * each backing up the other. Resolves with per-page JPEG base64 strings
 * (no data: prefix — the same shape `renderPdfPreview` returns). Throws
 * only when both rasterizers fail or produce no pages.
 */
export async function renderPdfPreviewPages(renderers: PreviewRenderers): Promise<string[]> {
  const tryServer = async (): Promise<string[]> => {
    const pages = await renderers.serverRender(await renderers.toBase64());
    if (!usable(pages)) throw new Error("Server preview returned no pages");
    return pages;
  };
  const tryLocal = async (): Promise<string[]> => {
    const pages = await renderers.localRender();
    if (!usable(pages)) throw new Error("Local preview returned no pages");
    return pages;
  };
  const order = renderers.isOffline() ? [tryLocal, tryServer] : [tryServer, tryLocal];
  let lastError: unknown;
  for (const attempt of order) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("PDF preview rendering failed");
}
