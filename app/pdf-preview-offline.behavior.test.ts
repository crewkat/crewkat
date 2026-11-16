// Offline document PDF previews — behavior tests for the fallback
// policy in client/src/pdfPreviewCore.ts plus source-wiring checks for
// App.tsx / build.mjs / sw.js.
//
// Field report (Danny, 2026-11-15, airplane mode): the offline app
// opened estimate EST0023 from cache, but the preview card was blank
// and the full-screen viewer said "could not be displayed" — PdfFrame
// rasterized pages ONLY through the server action renderPdfPreview
// (pdftoppm), even though the PDF blob is generated locally. The policy
// under test: server first while online (unchanged behavior), local
// pdf.js rasterizer as backup, local first while known offline, and an
// error only when both engines fail.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PREVIEW_DPI,
  PREVIEW_JPEG_QUALITY,
  PREVIEW_MAX_PAGES,
  PREVIEW_RENDER_SCALE,
  renderPdfPreviewPages,
  type PreviewRenderers,
} from "./client/src/pdfPreviewCore";

function scripted(overrides: Partial<PreviewRenderers> & { offline?: boolean }): {
  renderers: PreviewRenderers;
  calls: string[];
} {
  const calls: string[] = [];
  const renderers: PreviewRenderers = {
    isOffline: () => overrides.offline ?? false,
    toBase64: async () => {
      calls.push("toBase64");
      return "QUJD";
    },
    serverRender: async (dataBase64) => {
      calls.push(`server:${dataBase64}`);
      return ["c2VydmVyLTE", "c2VydmVyLTI"];
    },
    localRender: async () => {
      calls.push("local");
      return ["bG9jYWwtMQ"];
    },
    ...overrides,
  };
  // Keep the call log even when a renderer is overridden.
  const wrap = <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      calls.push(name);
      return fn(...args);
    };
  if (overrides.serverRender) renderers.serverRender = wrap("server", overrides.serverRender);
  if (overrides.localRender) renderers.localRender = wrap("local", overrides.localRender);
  return { renderers, calls };
}

describe("preview render policy", () => {
  test("online: server rasterizer is used and local never runs", async () => {
    const { renderers, calls } = scripted({});
    const pages = await renderPdfPreviewPages(renderers);
    expect(pages).toEqual(["c2VydmVyLTE", "c2VydmVyLTI"]);
    expect(calls).toEqual(["toBase64", "server:QUJD"]);
  });

  test("online: a server failure falls back to local rendering", async () => {
    const { renderers, calls } = scripted({
      serverRender: async () => {
        throw new Error("Failed to fetch");
      },
    });
    const pages = await renderPdfPreviewPages(renderers);
    expect(pages).toEqual(["bG9jYWwtMQ"]);
    expect(calls).toContain("server");
    expect(calls).toContain("local");
  });

  test("offline: local rendering runs first, server never called on success", async () => {
    const { renderers, calls } = scripted({ offline: true });
    const pages = await renderPdfPreviewPages(renderers);
    expect(pages).toEqual(["bG9jYWwtMQ"]);
    expect(calls).toEqual(["local"]);
  });

  test("offline: if local rendering fails the server is still tried", async () => {
    const { renderers, calls } = scripted({
      offline: true,
      localRender: async () => {
        throw new Error("worker missing");
      },
    });
    const pages = await renderPdfPreviewPages(renderers);
    expect(pages).toEqual(["c2VydmVyLTE", "c2VydmVyLTI"]);
    expect(calls).toEqual(["local", "toBase64", "server:QUJD"]);
  });

  test("both engines failing surfaces an error (the only error case)", async () => {
    const { renderers } = scripted({
      serverRender: async () => {
        throw new Error("offline 503");
      },
      localRender: async () => {
        throw new Error("corrupt pdf");
      },
    });
    await expect(renderPdfPreviewPages(renderers)).rejects.toThrow("corrupt pdf");
  });

  test("an empty page list counts as failure and triggers the fallback", async () => {
    const { renderers } = scripted({ serverRender: async () => [] });
    const pages = await renderPdfPreviewPages(renderers);
    expect(pages).toEqual(["bG9jYWwtMQ"]);
  });

  test("local envelope matches the server's pdftoppm run", () => {
    expect(PREVIEW_DPI).toBe(120);
    expect(PREVIEW_MAX_PAGES).toBe(20);
    expect(PREVIEW_RENDER_SCALE).toBeCloseTo(120 / 72);
    expect(PREVIEW_JPEG_QUALITY).toBeGreaterThan(0);
    expect(PREVIEW_JPEG_QUALITY).toBeLessThanOrEqual(1);
  });
});

describe("source wiring", () => {
  const appSource = readFileSync(new URL("./client/src/App.tsx", import.meta.url), "utf8");
  const localSource = readFileSync(new URL("./client/src/pdfPreviewLocal.ts", import.meta.url), "utf8");
  const buildSource = readFileSync(new URL("./client/build.mjs", import.meta.url), "utf8");
  const swSource = readFileSync(new URL("./client/pwa/sw.js", import.meta.url), "utf8");

  test("PdfFrame renders through the fallback helper, not the server action directly", () => {
    expect(appSource).toContain("renderPdfPreviewPages({");
    expect(appSource).toContain("renderPdfPagesLocally(blob)");
    expect(appSource).toContain("getOfflineSnapshot()");
    const frameAt = appSource.indexOf("function PdfFrame");
    const frameEnd = appSource.indexOf("function documentDesignOf", frameAt);
    const frameBody = appSource.slice(frameAt, frameEnd);
    expect(frameBody).toContain("renderPreviewPages(blob)");
    expect(frameBody).not.toContain("api.renderPdfPreview");
  });

  test("download-as-image and signed-document pages share the fallback", () => {
    const downloadAt = appSource.indexOf("async function downloadPdfAsImage");
    expect(appSource.slice(downloadAt, downloadAt + 300)).toContain("renderPreviewPages(blob)");
    const docPagesAt = appSource.indexOf("function DocumentPdfPages");
    expect(appSource.slice(docPagesAt, docPagesAt + 2200)).toContain("renderPreviewPages(blob)");
  });

  test("the only direct server-render call left in App.tsx is inside the shared helper", () => {
    const direct = appSource.split("api.renderPdfPreview").length - 1;
    const helperAt = appSource.indexOf("async function renderPreviewPages");
    const helperEnd = appSource.indexOf("function PdfFrame", helperAt);
    const helperBody = appSource.slice(helperAt, helperEnd);
    expect(helperBody).toContain("api.renderPdfPreview");
    // Helper + the signature-placement editor (server-fetched originals,
    // deliberately unchanged) are the only direct call sites.
    expect(direct).toBe(2);
  });

  test("local rasterizer is pdf.js at the server envelope with the copied worker", () => {
    expect(localSource).toContain('from "pdfjs-dist"');
    expect(localSource).toContain('GlobalWorkerOptions.workerSrc = "/app/pdf.worker.min.mjs"');
    expect(localSource).toContain("PREVIEW_RENDER_SCALE");
    expect(localSource).toContain("PREVIEW_MAX_PAGES");
    expect(localSource).toContain('toDataURL("image/jpeg", PREVIEW_JPEG_QUALITY)');
  });

  test("build copies the worker and the service worker precaches it", () => {
    expect(buildSource).toContain('"pdfjs-dist", "build", "pdf.worker.min.mjs"');
    expect(buildSource).toContain('"pdf.worker.min.mjs"');
    expect(swSource).toContain('"/app/pdf.worker.min.mjs"');
  });
});
