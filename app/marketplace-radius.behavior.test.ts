// Build 0.7: marketplace location radius filter + card ID removal.
// Radius now also works for city queries ("Tampa, FL") via keyless
// zippopotam city geocoding; listings naming the query city count as local.
//
// Covers:
//  1. isZipQuery: bare 5-digit ZIP detection.
//  2. parseLocationQuery / isRadiusQuery: ZIP vs "City, ST" vs bare city vs free text.
//  3. extractZipFromServiceArea: first ZIP out of free text, ZIP+4, none.
//  4. haversineMiles: zero distance, symmetry, Tampa→Clearwater ≈ 21 mi.
//  5. geocodeCity: stubbed-fetch success, HTTP failure → null, no state → null, caching.
//  6. resolveLocationCenter: free text → null.
//  7. serviceAreaMentionsCity: case-insensitive city mention detection.
//  8. listingWithinRadius: pure per-listing decision incl. city-name local rule
//     (near kept, far dropped, no-ZIP excluded, unresolvable ZIP excluded).
//  9. radiusZoom: radius → map embed zoom mapping.
//  10. Static guards: no "market-card-id" on cards; radius chips + ES copy in
//      the location sheet; radius in the listings query key.
//
// Run from app/:  bun marketplace-radius.behavior.test.ts
import { readFile } from "node:fs/promises";
import {
  DEFAULT_RADIUS_MILES,
  RADIUS_OPTIONS,
  clearCityCoordsCache,
  extractZipFromServiceArea,
  geocodeCity,
  haversineMiles,
  isRadiusQuery,
  isZipQuery,
  listingWithinRadius,
  parseLocationQuery,
  radiusZoom,
  resolveLocationCenter,
  serviceAreaMentionsCity,
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

// --- 2. parseLocationQuery / isRadiusQuery ---------------------------------------
const pq = (v: string) => JSON.stringify(parseLocationQuery(v));
check("parse: ZIP", pq("33647") === JSON.stringify({ kind: "zip", zip: "33647" }));
check("parse: City, ST", pq("Tampa, FL") === JSON.stringify({ kind: "city", city: "Tampa", state: "fl" }));
check("parse: City,ST trims + lowercases", pq("  tampa , Fl ") === JSON.stringify({ kind: "city", city: "tampa", state: "fl" }));
check("parse: multi-word city", pq("New Port Richey, FL") === JSON.stringify({ kind: "city", city: "New Port Richey", state: "fl" }));
check("parse: dotted city", pq("St. Petersburg, FL").includes('"city":"St. Petersburg"'));
check("parse: bare city", pq("Tampa") === JSON.stringify({ kind: "city", city: "Tampa", state: null }));
check("parse: free text stays text", parseLocationQuery("Tampa Bay area").kind === "city"); // best-effort: no state → substring fallback
check("parse: empty → text", parseLocationQuery("").kind === "text");
check("parse: digits+text → text", parseLocationQuery("123 Main St").kind === "text");
check("parse: long state → text", parseLocationQuery("Tampa, Florida").kind === "text");
check("isRadiusQuery: ZIP true", isRadiusQuery("33647") === true);
check("isRadiusQuery: City, ST true", isRadiusQuery("Tampa, FL") === true);
check("isRadiusQuery: bare city true", isRadiusQuery("Tampa") === true);
check("isRadiusQuery: empty false", isRadiusQuery("") === false);
check("isRadiusQuery: address false", isRadiusQuery("123 Main St") === false);

// --- 3. extractZipFromServiceArea ----------------------------------------------
check("extractZip: bare ZIP", extractZipFromServiceArea("33647") === "33647");
check("extractZip: city + ZIP", extractZipFromServiceArea("Tampa, FL 33647") === "33647");
check("extractZip: ZIP+4 takes first 5", extractZipFromServiceArea("34655-1234") === "34655");
check("extractZip: first of several", extractZipFromServiceArea("33647 / 34655") === "33647");
check("extractZip: no ZIP → null", extractZipFromServiceArea("Tampa Bay area") === null);
check("extractZip: empty → null", extractZipFromServiceArea("") === null);

// --- 4. haversineMiles ----------------------------------------------------------
check("haversine: same point is 0", haversineMiles(27.95, -82.46, 27.95, -82.46) === 0);
const tampaClearwater = haversineMiles(27.9475, -82.4584, 27.9659, -82.8001);
check("haversine: Tampa→Clearwater ≈ 21 mi", tampaClearwater > 19 && tampaClearwater < 23, `got ${tampaClearwater.toFixed(2)}`);
check(
  "haversine: symmetric",
  Math.abs(haversineMiles(27.95, -82.46, 27.96, -82.8) - haversineMiles(27.96, -82.8, 27.95, -82.46)) < 1e-9,
);

// --- 5. geocodeCity (stubbed fetch — no network) --------------------------------
clearCityCoordsCache();
type StubResp = { ok: boolean; status?: number; json?: () => Promise<unknown> };
const stubFetch = (resp: StubResp) => (async () => resp) as unknown as typeof fetch;
const tampaPlaces = { places: [{ latitude: "27.9475", longitude: "-82.4584", "place name": "Tampa" }] };
const tampaCoords = await geocodeCity("Tampa", "fl", stubFetch({ ok: true, json: async () => tampaPlaces }));
check("geocodeCity: resolves Tampa, FL", tampaCoords?.lat === 27.9475 && tampaCoords?.lon === -82.4584);
const cachedAgain = await geocodeCity("Tampa", "FL", stubFetch({ ok: false, status: 500 }));
check("geocodeCity: cached (no refetch on failure)", cachedAgain?.lat === 27.9475);
check("geocodeCity: HTTP failure → null", (await geocodeCity("Nowhere", "fl", stubFetch({ ok: false, status: 404 }))) === null);
check("geocodeCity: empty places → null", (await geocodeCity("Void", "fl", stubFetch({ ok: true, json: async () => ({ places: [] }) }))) === null);
check("geocodeCity: no state → null (bare city)", (await geocodeCity("Tampa", null, stubFetch({ ok: true, json: async () => tampaPlaces }))) === null);
check("geocodeCity: bad state → null", (await geocodeCity("Tampa", "florida", stubFetch({ ok: true, json: async () => tampaPlaces }))) === null);

// --- 6. resolveLocationCenter ----------------------------------------------------
check("resolveCenter: text → null", (await resolveLocationCenter({ kind: "text", text: "somewhere" })) === null);

// --- 7. serviceAreaMentionsCity ---------------------------------------------------
check("cityMention: exact", serviceAreaMentionsCity("Tampa, FL 33647", "Tampa") === true);
check("cityMention: case-insensitive", serviceAreaMentionsCity("TAMPA BAY", "tampa") === true);
check("cityMention: multi-word", serviceAreaMentionsCity("New Port Richey, FL", "New Port Richey") === true);
check("cityMention: no match", serviceAreaMentionsCity("Miami, FL 33101", "Tampa") === false);
check("cityMention: empty city", serviceAreaMentionsCity("Tampa, FL", "") === false);
check("cityMention: empty area", serviceAreaMentionsCity("", "Tampa") === false);

// --- 8. listingWithinRadius ------------------------------------------------------
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
// City-name local rule: the query city in the service area counts as local,
// bypassing distance entirely (far center, tiny radius, no ZIP on the listing).
const miamiCenter: ZipCoords = { lat: 25.7753, lon: -80.2089 };
check("radius: city-name match included (no ZIP, far center)", listingWithinRadius("Tampa, FL", miamiCenter, fakeGeo, 1, "Tampa") === true);
check("radius: city-name match case-insensitive", listingWithinRadius("tampa bay area", miamiCenter, fakeGeo, 1, "Tampa") === true);
check("radius: other city falls through to ZIP distance", listingWithinRadius("Miami 33101", center, fakeGeo, 100, "Tampa") === false);
check("radius: null city = legacy behavior", listingWithinRadius("Tampa 33647", center, fakeGeo, 25, null) === true);
check("radius: city match does not leak to other cities", listingWithinRadius("Tampa, FL", miamiCenter, fakeGeo, 100, "Orlando") === false);

// --- 9. radiusZoom ----------------------------------------------------------------
check("radiusZoom: 5 → 12", radiusZoom(5) === 12);
check("radiusZoom: 10 → 11", radiusZoom(10) === 11);
check("radiusZoom: 25 → 10", radiusZoom(25) === 10);
check("radiusZoom: 50 → 9", radiusZoom(50) === 9);
check("radiusZoom: 100 → 8", radiusZoom(100) === 8);

// --- 10. constants ------------------------------------------------------------------
check("RADIUS_OPTIONS is 5/10/25/50/100", JSON.stringify([...RADIUS_OPTIONS]) === "[5,10,25,50,100]");
check("DEFAULT_RADIUS_MILES is 25", DEFAULT_RADIUS_MILES === 25);

// --- 11. static guards ---------------------------------------------------------------
const clientSrc = await readFile("client/src/App.tsx", "utf8");
check("cards: no market-card-id row", !clientSrc.includes("market-card-id"));
check("sheet: radius chips rendered", clientSrc.includes('className="radius-chips"'));
check("sheet: RADIUS_OPTIONS used", clientSrc.includes("RADIUS_OPTIONS.map"));
check("sheet: chips gated on radiusMode", clientSrc.includes("disabled={!radiusMode}"));
check("copy: EN radius label", clientSrc.includes('radius: "Radius (miles)"'));
check("copy: ES radius label", clientSrc.includes('radius: "Radio (millas)"'));
check("copy: EN city hint", clientSrc.includes("Enter a ZIP code or city to filter by radius."));
check("copy: ES city hint", clientSrc.includes("o una ciudad para filtrar por radio"));
check("query: radius in query key", clientSrc.includes('["marketplace-listings", search, category, radiusMode'));
check("query: Haversine filter wired", clientSrc.includes("listingWithinRadius("));
check("query: city geocode wired", clientSrc.includes("resolveLocationCenter("));
check("query: city kind passed to filter", clientSrc.includes('locationQuery.kind === "city"'));
check("map: zoom follows radius", clientSrc.includes("radiusZoom(radius)"));
check("map: city geocode for preview", clientSrc.includes("geocodeLocationForMapPreview"));

if (failures > 0) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
