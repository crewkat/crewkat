// Aspect-preserving photo placement for the proof packet PDF
// (Danny, 2026-10-15 — "Proof packet looks squished").
//
// The packet used to draw every photo at full content width × a FIXED
// 175pt height, so jsPDF stretched each image into a ~3:1 slot whatever
// its real shape was — a 4:3 photo lost more than half its height.
// fitPhotoBox fits the WHOLE photo inside (maxW × maxH) at its natural
// ratio: no stretching in either dimension, no cover-crop. Photos that
// hit the height cap are centered horizontally via offsetX.

export interface PhotoFit {
  width: number;
  height: number;
  /** Horizontal offset inside the maxW box that centers the drawn photo. */
  offsetX: number;
}

// A photo may take at most this much vertical space in the packet. At
// the 528pt content width a 16:9 shot (297pt tall) still draws full
// width and two can share a page with captions; a 4:3 or portrait shot
// caps here instead of eating most of a page.
export const PROOF_PHOTO_MAX_HEIGHT = 340;

export function fitPhotoBox(
  naturalW: number,
  naturalH: number,
  maxW: number,
  maxH: number,
): PhotoFit {
  const usableW =
    Number.isFinite(naturalW) && naturalW > 0 ? naturalW : 4;
  const usableH =
    Number.isFinite(naturalH) && naturalH > 0 ? naturalH : 3;
  const ratio = usableW / usableH;
  let width = maxW;
  let height = width / ratio;
  if (height > maxH) {
    height = maxH;
    width = height * ratio;
  }
  return { width, height, offsetX: (maxW - width) / 2 };
}
