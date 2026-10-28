// Receipt OCR engine — tesseract.js, loaded ONLY when a user taps
// "Scan receipt" (field flow in receiptParse.ts does the reading; this
// module only turns a photo into raw text).
//
// Why a script tag instead of a bundle import: the client bundler runs
// without code splitting, so `import "tesseract.js"` would inline the
// engine into the main bundle and tax every screen. Instead the engine
// ships as static files under /app/ocr/ (copied into dist by
// client/build.mjs from devDependencies — the bundler never sees them):
//   tesseract.min.js  UMD API (~63KB), injected on first scan
//   worker.min.js     the OCR web worker
//   core/*.wasm.js    one LSTM core (~3.9MB), picked by feature detection
//   lang/eng.traineddata.gz  best_int English data (~2.9MB)
// The worker + core + language data are fetched on the first scan and
// then cached (HTTP cache + tesseract's IndexedDB cache), so repeat
// scans are fast. Fully on-device: the photo never leaves the phone for
// OCR — it only uploads later if the user saves the expense, through the
// existing save actions.

const OCR_BASE = "/app/ocr/";

let enginePromise: Promise<TesseractStatic> | null = null;

function loadEngine(): Promise<TesseractStatic> {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!enginePromise) {
    enginePromise = new Promise<TesseractStatic>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${OCR_BASE}tesseract.min.js`;
      script.async = true;
      script.onload = () => {
        if (window.Tesseract) resolve(window.Tesseract);
        else reject(new Error("OCR engine loaded without a Tesseract global."));
      };
      script.onerror = () => reject(new Error("OCR engine failed to load."));
      document.head.appendChild(script);
    });
    // A failed load (offline on a job site) must not poison later taps.
    enginePromise.catch(() => { enginePromise = null; });
  }
  return enginePromise;
}

/**
 * Run OCR over a receipt photo and return the raw text. Throws when the
 * engine can't load or the recognition fails — callers treat any failure
 * like an unreadable receipt (form still opens, photo still attached).
 */
export async function scanReceiptText(image: Blob): Promise<string> {
  const tesseract = await loadEngine();
  const worker = await tesseract.createWorker("eng", "1", {
    workerPath: `${OCR_BASE}worker.min.js`,
    corePath: `${OCR_BASE}core`,
    langPath: `${OCR_BASE}lang`,
    cacheMethod: "write",
  });
  try {
    const { data } = await worker.recognize(image);
    return data?.text ?? "";
  } finally {
    try { await worker.terminate(); } catch { /* worker already gone */ }
  }
}
