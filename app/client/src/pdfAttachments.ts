// Build 0.6: append document attachments (images + PDFs) to a generated
// document PDF. Shared by the server (docPdf.ts, for shared links) and the
// client (in-app preview), so both show the same appended pages.
import { PDFDocument } from "pdf-lib";

export interface AttachmentForPdf {
  kind: "image" | "pdf";
  contentType: string;
  bytes: Uint8Array;
}

const PAGE_W = 612; // letter
const PAGE_H = 792;
const MARGIN = 36;

async function embedAttachmentImage(out: PDFDocument, att: AttachmentForPdf) {
  // Client compresses uploads to JPEG before sending; PNG is the only other
  // format we store. Anything else is skipped by the caller.
  if (att.contentType === "image/png") return out.embedPng(att.bytes);
  return out.embedJpg(att.bytes);
}

function fitInCell(imgW: number, imgH: number, cellW: number, cellH: number) {
  const scale = Math.min(cellW / imgW, cellH / imgH, 1);
  return { w: imgW * scale, h: imgH * scale };
}

/** Returns the main PDF bytes unchanged when there are no attachments. */
export async function appendAttachmentsToPdf(
  mainPdfBytes: Uint8Array,
  attachments: AttachmentForPdf[],
  imagesPerPage: 1 | 2 | 4,
): Promise<Uint8Array> {
  const images = attachments.filter((a) => a.kind === "image" && (a.contentType === "image/jpeg" || a.contentType === "image/png"));
  const pdfs = attachments.filter((a) => a.kind === "pdf");
  if (images.length === 0 && pdfs.length === 0) return mainPdfBytes;

  const out = await PDFDocument.load(mainPdfBytes, { ignoreEncryption: true });

  // Image pages: 1 per page = full-bleed-ish, 2 = stacked rows, 4 = 2x2 grid.
  const perPage = imagesPerPage === 2 ? 2 : imagesPerPage === 4 ? 4 : 1;
  const cols = perPage === 4 ? 2 : 1;
  const rows = perPage === 4 ? 2 : perPage;
  for (let i = 0; i < images.length; i += perPage) {
    const group = images.slice(i, i + perPage);
    const page = out.addPage([PAGE_W, PAGE_H]);
    const cellW = (PAGE_W - MARGIN * 2 - (cols - 1) * 12) / cols;
    const cellH = (PAGE_H - MARGIN * 2 - (rows - 1) * 12) / rows;
    for (let g = 0; g < group.length; g++) {
      const att = group[g]!;
      let embedded;
      try {
        embedded = await embedAttachmentImage(out, att);
      } catch {
        continue; // one bad image never kills the whole PDF
      }
      // Server-side sanity scaling: draw at most the cell size, so even an
      // oversized upload renders bounded. (Client already compresses to
      // ~1600px before upload; this is the backstop.)
      const { w, h } = fitInCell(embedded.width, embedded.height, cellW, cellH);
      const col = g % cols;
      const row = Math.floor(g / cols);
      const x = MARGIN + col * (cellW + 12) + (cellW - w) / 2;
      const topY = PAGE_H - MARGIN - row * (cellH + 12);
      const y = topY - cellH + (cellH - h) / 2;
      page.drawImage(embedded, { x, y, width: w, height: h });
    }
  }

  // Attached PDFs: append all their pages verbatim.
  for (const pdf of pdfs) {
    try {
      const src = await PDFDocument.load(pdf.bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
    } catch {
      // skip unreadable PDFs rather than failing the document
    }
  }

  return out.save();
}
