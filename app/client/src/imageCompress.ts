// Shared client-side image compression — every image upload path routes
// through `compressImageFile` before the bytes hit the network, so phone
// photos stay small on cellular data.
//
// What it does, in order:
//  1. Applies EXIF orientation first (createImageBitmap with
//     imageOrientation:"from-image", falling back to a plain <img>), so
//     portrait phone photos don't come out sideways after the downscale.
//  2. Downscales so the longest side fits the per-kind cap.
//  3. Re-encodes as JPEG (quality ~0.82 for photos), except company logos,
//     which keep PNG so transparency survives.
// Files that are already small enough, animated GIFs, and anything that
// fails to decode pass through untouched.

export type CompressKind = "logo" | "cover" | "attachment" | "photo";

export interface CompressionPlan {
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png";
  quality: number;
}

const MAX_SIDE: Record<CompressKind, number> = {
  logo: 800,
  cover: 1600,
  attachment: 1600,
  photo: 1920,
};

// Files under both caps skip the canvas round-trip entirely.
const SKIP_BYTES = 400 * 1024;

/**
 * Pure decision logic for compression — returns null when the file should
 * be sent as-is. Kept side-effect free so it can be unit tested in bun.
 */
export function compressionPlan(
  naturalWidth: number,
  naturalHeight: number,
  fileSizeBytes: number,
  fileType: string,
  kind: CompressKind,
): CompressionPlan | null {
  // Never recompress animated GIFs — re-encoding as JPEG would kill the animation.
  if (fileType === "image/gif") return null;
  const maxSide = MAX_SIDE[kind];
  const longest = Math.max(naturalWidth, naturalHeight);
  if (longest <= maxSide && fileSizeBytes <= SKIP_BYTES) return null;
  const scale = Math.min(1, maxSide / longest);
  const keepPng = fileType === "image/png" && kind === "logo";
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
    mimeType: keepPng ? "image/png" : "image/jpeg",
    quality: kind === "photo" ? 0.82 : 0.85,
  };
}

export function compressedFileName(originalName: string, mimeType: string): string {
  const ext = mimeType === "image/png" ? ".png" : ".jpg";
  return /\.[a-z0-9]+$/i.test(originalName)
    ? originalName.replace(/\.[a-z0-9]+$/i, ext)
    : `${originalName}${ext}`;
}

interface OrientedBitmap {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  close: () => void;
}

async function loadOrientedBitmap(file: File): Promise<OrientedBitmap> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> path below.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Compress one image file for upload. Never throws — returns the original on any failure. */
export async function compressImageFile(file: File, kind: CompressKind): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const loaded = await loadOrientedBitmap(file);
    const plan = compressionPlan(loaded.width, loaded.height, file.size, file.type, kind);
    if (!plan) {
      loaded.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      loaded.close();
      return file;
    }
    ctx.drawImage(loaded.source, 0, 0, plan.width, plan.height);
    loaded.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, plan.mimeType, plan.quality),
    );
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], compressedFileName(file.name, plan.mimeType), { type: plan.mimeType });
  } catch {
    return file;
  }
}
