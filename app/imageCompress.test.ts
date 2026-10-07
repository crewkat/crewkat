// Unit tests for the compression decision logic in client/src/imageCompress.ts.
// The DOM half (compressImageFile) needs canvas/ImageBitmap, so only the pure
// `compressionPlan` / `compressedFileName` helpers are covered here in bun.
import { describe, expect, test } from "bun:test";
import { compressedFileName, compressionPlan } from "./client/src/imageCompress";

describe("compressionPlan — skip fast path", () => {
  test("small-enough photo passes through untouched", () => {
    expect(compressionPlan(1200, 900, 300 * 1024, "image/jpeg", "photo")).toBeNull();
  });
  test("small dimensions but huge file still compresses", () => {
    const plan = compressionPlan(1200, 900, 5 * 1024 * 1024, "image/jpeg", "photo");
    expect(plan).not.toBeNull();
    expect(plan!.width).toBe(1200);
    expect(plan!.height).toBe(900);
  });
  test("animated GIFs are never recompressed", () => {
    expect(compressionPlan(4000, 3000, 8 * 1024 * 1024, "image/gif", "photo")).toBeNull();
  });
});

describe("compressionPlan — downscale caps", () => {
  test("photo caps the longest side at 1920px, landscape", () => {
    const plan = compressionPlan(4032, 3024, 6 * 1024 * 1024, "image/jpeg", "photo");
    expect(plan).not.toBeNull();
    expect(plan!.width).toBe(1920);
    expect(plan!.height).toBe(1440);
    expect(plan!.mimeType).toBe("image/jpeg");
    expect(plan!.quality).toBe(0.82);
  });
  test("photo caps the longest side at 1920px, portrait (post-EXIF dimensions)", () => {
    const plan = compressionPlan(3024, 4032, 6 * 1024 * 1024, "image/jpeg", "photo");
    expect(plan).not.toBeNull();
    expect(plan!.width).toBe(1440);
    expect(plan!.height).toBe(1920);
  });
  test("logo caps at 800px and keeps PNG for transparency", () => {
    const plan = compressionPlan(2000, 1000, 2 * 1024 * 1024, "image/png", "logo");
    expect(plan).not.toBeNull();
    expect(plan!.width).toBe(800);
    expect(plan!.height).toBe(400);
    expect(plan!.mimeType).toBe("image/png");
  });
  test("logo JPEG input becomes JPEG", () => {
    const plan = compressionPlan(2000, 1000, 2 * 1024 * 1024, "image/jpeg", "logo");
    expect(plan!.mimeType).toBe("image/jpeg");
  });
  test("attachment caps at 1600px", () => {
    const plan = compressionPlan(3200, 2400, 2 * 1024 * 1024, "image/jpeg", "attachment");
    expect(plan!.width).toBe(1600);
    expect(plan!.height).toBe(1200);
    expect(plan!.quality).toBe(0.85);
  });
});

describe("compressedFileName", () => {
  test("swaps the extension to .jpg", () => {
    expect(compressedFileName("photo.PNG", "image/jpeg")).toBe("photo.jpg");
    expect(compressedFileName("shot.heic", "image/jpeg")).toBe("shot.jpg");
  });
  test("keeps .png for logos", () => {
    expect(compressedFileName("logo.png", "image/png")).toBe("logo.png");
  });
  test("appends an extension when there is none", () => {
    expect(compressedFileName("noext", "image/jpeg")).toBe("noext.jpg");
  });
});
