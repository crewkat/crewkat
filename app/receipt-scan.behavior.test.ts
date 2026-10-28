// Receipt scan → expense behavior tests: the deterministic OCR-text
// parser (client/src/receiptParse.ts), the prefill shape the forms use,
// and the wiring pins that keep the scan inside the existing save paths.
//
// The OCR engine itself (tesseract.js) is deliberately NOT exercised
// here — it loads lazily from static /app/ocr/ assets in the browser and
// cannot run under bun; the engine's own output shape is covered by the
// real-OCR fixture in the first case (text shaped like the engine's
// line output from a Home Depot receipt).
//
// Run from app/:  bun receipt-scan.behavior.test.ts
import { readFile } from "node:fs/promises";
import { parseReceiptText, receiptLooksUnreadable, receiptPrefill } from "./client/src/receiptParse";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// --- 1. Home Depot-style receipt: real-OCR-shaped text --------------------
const HOME_DEPOT = `THE HOME DEPOT
Store #1234 Tampa, FL
813-555-0142
10/24/2026 09:41 AM
2x4 STUD 8FT 11.98
PLYWOOD 1/2 32.47
SCREWS 1LB 8.99
SUBTOTAL 53.44
TAX 3.74
TOTAL 57.18
VISA ****4821

THANK YOU!`;
const hd = parseReceiptText(HOME_DEPOT);
check("home depot: total wins over subtotal and line items", hd.amount === "57.18", `got ${hd.amount}`);
check("home depot: first valid date is the purchase date", hd.date === "2026-10-24", `got ${hd.date}`);
check("home depot: vendor is the first line", hd.vendor === "THE HOME DEPOT", `got ${hd.vendor}`);
check("home depot: readable", !receiptLooksUnreadable(hd));

// --- 2. Fuel receipt: 3-decimal quantities must not become amounts -------
const FUEL = `SHELL OIL
1234 Highway 19
Palm Harbor, FL 34684
Oct 27, 2026 07:15
PUMP 03
REGULAR UNLEADED
GALLONS 12.483
PRICE/GAL 3.599
FUEL TOTAL $44.93`;
const fuel = parseReceiptText(FUEL);
check("fuel: fuel total wins, gallons/price-per-gallon ignored", fuel.amount === "44.93", `got ${fuel.amount}`);
check("fuel: month-name date parses", fuel.date === "2026-10-27", `got ${fuel.date}`);
check("fuel: vendor is the station name", fuel.vendor === "SHELL OIL", `got ${fuel.vendor}`);

// --- 3. Deposit bigger than the total: the total label wins ---------------
const RENTAL = `SUNBELT RENTALS
Tel: (813) 555-0142
10/26/26
DEPOSIT            500.00
RENTAL             120.00
TAX                 12.50
TOTAL DUE          132.50`;
const rental = parseReceiptText(RENTAL);
check("rental: total due wins over a larger deposit", rental.amount === "132.50", `got ${rental.amount}`);
check("rental: 2-digit year expands to 20xx", rental.date === "2026-10-26", `got ${rental.date}`);
check("rental: phone line is not the vendor", rental.vendor === "SUNBELT RENTALS", `got ${rental.vendor}`);

// --- 4. Cash/change lines never become the amount --------------------------
const CASH = `JOE'S HARDWARE
10/25/2026
HAMMER 24.99
TOTAL 57.18
CASH 100.00
CHANGE 42.82`;
const cash = parseReceiptText(CASH);
check("cash: total wins over cash tendered and change", cash.amount === "57.18", `got ${cash.amount}`);

// --- 5. Subtotal-only receipt falls back to the largest value -------------
const SUBTOTAL_ONLY = `PROSOURCE
10/20/2026
TILE 12CT 41.10
SUBTOTAL 53.44
TAX 3.74`;
const sub = parseReceiptText(SUBTOTAL_ONLY);
check("subtotal-only: falls back to largest value", sub.amount === "53.44", `got ${sub.amount}`);

// --- 6. Garbled / near-empty OCR ------------------------------------------
const GARBLED = "xkcd /// 12\n##";
const garbled = parseReceiptText(GARBLED);
check("garbled: no amount, unreadable", garbled.amount === null && receiptLooksUnreadable(garbled));
check("garbled: rawLength reported for the UI note", garbled.rawLength === GARBLED.trim().length);
const EMPTY = parseReceiptText("");
check("empty: all null, unreadable", EMPTY.amount === null && EMPTY.date === null && EMPTY.vendor === null && receiptLooksUnreadable(EMPTY));

// --- 7. Prefill shape: exactly the form's fields, missing fields kept -----
const prefilled = receiptPrefill(hd, { vendor: "", amount: "", date: "2026-10-27" });
check("prefill: found fields fill the form", prefilled.vendor === "THE HOME DEPOT" && prefilled.amount === "57.18" && prefilled.date === "2026-10-24", JSON.stringify(prefilled));
const kept = receiptPrefill(parseReceiptText("THE HOME DEPOT\n10/24/2026\n"), { vendor: "Typed vendor", amount: "9.99", date: "2026-10-01" });
check("prefill: missing amount keeps the typed value", kept.amount === "9.99" && kept.vendor === "THE HOME DEPOT" && kept.date === "2026-10-24", JSON.stringify(kept));
check("prefill: shape is exactly the three form fields", Object.keys(prefilled).sort().join(",") === "amount,date,vendor");

// --- 8. Wiring pins: scan lives inside the existing save paths ------------
const appSrc = await readFile("client/src/App.tsx", "utf8");
const ocrSrc = await readFile("client/src/receiptOcr.ts", "utf8");
const buildSrc = await readFile("client/build.mjs", "utf8");
const actionsSrc = await readFile("server/src/actions.ts", "utf8");

check("ReceiptManager runs scan + prefill + the existing addReceipt save",
  appSrc.includes("function ReceiptManager") &&
  appSrc.includes("runScan") &&
  appSrc.includes("scanReceiptText") &&
  appSrc.includes("parseReceiptText") &&
  appSrc.includes("api.addReceipt"));
check("ScannerTool runs scan + prefill + the existing saveScannedDocument save",
  appSrc.includes("function ScannerTool") &&
  appSrc.includes("runScan") &&
  appSrc.includes("scanReceiptText") &&
  appSrc.includes("api.saveScannedDocument"));
check("scan buttons render next to the photo attach in both flows",
  appSrc.includes("t.scanReceipt") && appSrc.includes("t.scanningReceipt"));
check("no new server save action was invented for scans",
  !/defineAction\(\{\s*request: z\.object\(\{\s*[^}]*ocr/i.test(actionsSrc) &&
  !actionsSrc.includes("scanReceiptText") &&
  !actionsSrc.includes("ocrReceipt"));
check("OCR engine is NOT bundled: receiptOcr loads it by script tag",
  !/^\s*import\s.*tesseract/m.test(ocrSrc) &&
  ocrSrc.includes('document.createElement("script")') &&
  ocrSrc.includes("tesseract.min.js"));
check("OCR worker/core/lang paths all point at the static /app/ocr/ tree",
  ocrSrc.includes('OCR_BASE = "/app/ocr/"') &&
  ocrSrc.includes("worker.min.js") &&
  ocrSrc.includes("${OCR_BASE}core") &&
  ocrSrc.includes("${OCR_BASE}lang"));
check("build copies the OCR asset tree into dist/ocr",
  buildSrc.includes("dist/ocr") &&
  buildSrc.includes("tesseract.min.js") &&
  buildSrc.includes("worker.min.js") &&
  buildSrc.includes("tesseract-core-simd-lstm.wasm.js") &&
  buildSrc.includes("eng.traineddata.gz"));
check("build's OCR copy lists all three LSTM core variants",
  buildSrc.includes("tesseract-core-lstm.wasm.js") &&
  buildSrc.includes("tesseract-core-relaxedsimd-lstm.wasm.js"));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll receipt-scan checks passed.");
