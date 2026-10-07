// Build 0.7: marketplace location radius filter + card ID removal.
//
// Covers:
//  1. isZipQuery: bare 5-digit ZIP detection (radius mode gate).
//  2. extractZipFromServiceArea: first ZIP out of free text, ZIP+4, none.
//  3. haversineMiles: zero distance, symmetry, Tampa→Clearwater ≈ 21 mi.
//  4. listingWithinRadius: pure per-listing decision (near kept, far dropped,
//     no-ZIP excluded, unresolvable ZIP excluded).
//  5. radiusZoom: radius → map embed zoom mapping.
//  6. Static guards: no "market-card-id" on cards; radius chips + ES copy in
//     the location sheet; radius in the listings query key.
//
// Run from app/:  bun marketplace-radius.behavior.test.ts
import { readFile } from "node:fs/promises";
import {
  DEFAULT_RADIUS_MILES,
  RADIUS_OPTIONS,
  extractZipFromServiceArea,
  haversineMiles,
  isZipQuery,
  listingWithinRadius,
  radiusZoom,
  type ZipCoords,
} from "./client/src/marketplaceGeo.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- 1. isZipQuery ------------------------------------------------------------
check("isZipQuery: bare ZIP", isZipQuery("33647") === true);
check("isZipQuery: trims whitespace", isZipQuery("  33647 ") === true);
check("isZipQuery: rejects 4 digits", isZipQuery("3364") === false);
check("isZipQuery: rejects 6 digits", isZipQuery("336471") === false);
check("isZipQuery: rejects city text", isZipQuery("Tampa, FL") === false);
check("isZipQuery: rejects empty", isZipQuery("") === false);
check("isZipQuery: rejects ZIP+4", isZipQuery("33647-1234") === false);

// --- 2. extractZipFromServiceArea ----------------------------------------------
check("extractZip: bare ZIP", extractZipFromServiceArea("33647") === "33647");
check("extractZip: city + ZIP", extractZipFromServiceArea("Tampa, FL 33647") === "33647");
check("extractZip: ZIP+4 takes first 5", extractZipFromServiceArea("34655-1234") === "34655");
check("extractZip: first of several", extractZipFromServiceArea("33647 / 34655") === "33647");
check("extractZip: no ZIP → null", extractZipFromServiceArea("Tampa Bay area") === null);
check("extractZip: empty → null", extractZipFromServiceArea("") === null);

// --- 3. haversineMiles ----------------------------------------------------------
check("haversine: same point is 0", haversineMiles(27.95, -82.46, 27.95, -82.46) === 0);
const tampaClearwater = haversineMiles(27.9475, -82.4584, 27.9659, -82.8001);
check("haversine: Tampa→Clearwater ≈ 21 mi", tampaClearwater > 19 && tampaClearwater < 23, `got ${tampaClearwater.toFixed(2)}`);
check(
  "haversine: symmetric",
  Math.abs(haversineMiles(27.95, -82.46, 27.96, -82.8) - haversineMiles(27.96, -82.8, 27.95, -82.46)) < 1e-9,
);

// --- 4. listingWithinRadius ------------------------------------------------------
const center: ZipCoords = { lat: 27.9475, lon: -82.4584 }; // Tampa 33647-ish
const fakeGeo = (zip: string): ZipCoords | null => {
  if (zip === "33647") return { lat: 27.9475, lon: -82.4584 }; // 0 mi
  if (zip === "33755") return { lat: 27.9659, lon: -82.8001 }; // Clearwater ~21 mi
  if (zip === "33101") return { lat: 25.7753, lon: -80.2089 }; // Miami ~200 mi
  return null;
};
check("radius: same-ZIP listing kept", listingWithinRadius("Tampa 33647", center, fakeGeo, 25) === true);
check("radius: 21 mi listing kept at 25", listingWithinRadius("Clearwater 33755", center, fakeGeo, 25) === true);
check("radius: 21 mi listing dropped at 10", listingWithinRadius("Clearwater 33755", center, fakeGeo, 10) === false);
check("radius: Miami dropped at 100", listingWithinRadius("Miami 33101", center, fakeGeo, 100) === false);
check("radius: no-ZIP area excluded", listingWithinRadius("Tampa Bay area", center, fakeGeo, 100) === false);
check("radius: unresolvable ZIP excluded", listingWithinRadius("Nowhere 00000", center, fakeGeo, 100) === false);

// --- 5. radiusZoom ----------------------------------------------------------------
check("radiusZoom: 5 → 12", radiusZoom(5) === 12);
check("radiusZoom: 10 → 11", radiusZoom(10) === 11);
check("radiusZoom: 25 → 10", radiusZoom(25) === 10);
check("radiusZoom: 50 → 9", radiusZoom(50) === 9);
check("radiusZoom: 100 → 8", radiusZoom(100) === 8);

// --- 6. constants ------------------------------------------------------------------
check("RADIUS_OPTIONS is 5/10/25/50/100", JSON.stringify([...RADIUS_OPTIONS]) === "[5,10,25,50,100]");
check("DEFAULT_RADIUS_MILES is 25", DEFAULT_RADIUS_MILES === 25);

// --- 7. static guards ---------------------------------------------------------------
const clientSrc = await readFile("client/src/App.tsx", "utf8");
check("cards: no market-card-id row", !clientSrc.includes("market-card-id"));
check("sheet: radius chips rendered", clientSrc.includes('className="radius-chips"'));
check("sheet: RADIUS_OPTIONS used", clientSrc.includes("RADIUS_OPTIONS.map"));
check("copy: EN radius label", clientSrc.includes('radius: "Radius (miles)"'));
check("copy: ES radius label", clientSrc.includes('radius: "Radio (millas)"'));
check("copy: ES radius hint", clientSrc.includes("para filtrar por radio"));
check("query: radius in query key", clientSrc.includes('["marketplace-listings", search, category, zipMode'));
check("query: Haversine filter wired", clientSrc.includes("listingWithinRadius("));
check("map: zoom follows radius", clientSrc.includes("radiusZoom(radius)"));

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
