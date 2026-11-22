// Local PDF page rasterizer (pdf.js) — the offline half of the document
// preview. The server rasterizer (renderPdfPreview / pdftoppm) is still
// the primary path while online; this exists so a preview whose PDF
// bytes are already on the device (every financial document — they are
// generated locally by financialPdf.ts) still renders with no network.
//
// The pdf.js worker is NOT bundled: client/build.mjs copies
// pdf.worker.min.mjs verbatim to /app/pdf.worker.min.mjs (the same
// pattern as the receipt-OCR engine) and the service worker precaches
// it, so it is on the device before it is ever needed offline. The
// historical "browser-side pdf.js failed on Android Chrome" note (see
// the public client page in App.tsx) was about loading PDFs inside
// iframes/objects in the installed app — pages here are rasterized to
// plain <img> JPEGs exactly like the server path produces.

import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { PREVIEW_JPEG_QUALITY, PREVIEW_MAX_PAGES, PREVIEW_RENDER_SCALE } from "./pdfPreviewCore";

/** 1×1 white JPEG, used only when a page can't be opened at all. */
const BLANK_PAGE_JPEG =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwH/2Q==";

let workerConfigured = false;
function ensureWorker(): void {
  if (workerConfigured) return;
  workerConfigured = true;
  if (!GlobalWorkerOptions.workerSrc) {
    GlobalWorkerOptions.workerSrc = "/app/pdf.worker.min.mjs";
  }
}

/**
 * Rasterize a PDF blob to per-page JPEG base64 strings (no data:
 * prefix), at the same 120 DPI / 20-page envelope as the server's
 * pdftoppm run so local and server previews look the same.
 */
export async function renderPdfPagesLocally(blob: Blob): Promise<string[]> {
  ensureWorker();
  const data = await blob.arrayBuffer();
  const loadingTask = getDocument({ data });
  const pdf = await loadingTask.promise;
  try {
    const pages: string[] = [];
    const count = Math.min(pdf.numPages, PREVIEW_MAX_PAGES);
    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      // Per-page isolation (audit B4): one bad page must not kill the
      // whole preview — offline, the server fallback is unreachable, so a
      // single failing page used to mean NO preview at all. A page that
      // fails renders as a blank sheet at the right size instead.
      pages.push(await renderPage(pageNumber));
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }

  async function renderPage(pageNumber: number): Promise<string> {
    let page: Awaited<ReturnType<typeof pdf.getPage>> | null = null;
    try {
      page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: PREVIEW_RENDER_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is not available for PDF preview");
      // JPEG has no alpha — paint the page's paper white first so any
      // transparent region matches the server-rendered pages.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      try {
        await page.render({ canvas, canvasContext: context, viewport }).promise;
      } catch {
        // Render operators failed for this page only — keep the white
        // sheet (correct size, no content) and let the other pages show.
      }
      const dataUrl = canvas.toDataURL("image/jpeg", PREVIEW_JPEG_QUALITY);
      // Release the bitmap before the next page — a 20-page document
      // at 120 DPI is ~27 MB of canvas if held all at once.
      canvas.width = 0;
      canvas.height = 0;
      return dataUrl.split(",")[1] ?? "";
    } catch {
      // The page couldn't even be opened — a 1×1 white JPEG placeholder
      // keeps the page count (and the viewer's page order) intact.
      return BLANK_PAGE_JPEG;
    } finally {
      page?.cleanup();
    }
  }
}
