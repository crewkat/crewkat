// Marketplace location helpers: ZIP/city parsing, keyless geocoding
// (zippopotam.us — free, no key, already used for the map preview), and the
// Haversine distance used by the Location sheet's radius filter.
//
// Data reality: marketplace listings carry only free-text `serviceArea`
// ("Tampa, FL", "33647", "Trinity FL 34655") — no coordinates. So the radius
// filter resolves the *query* (ZIP or "City, ST") to coordinates and each
// listing via the first ZIP in its service area. Listings that name the query
// city count as local. Listings that resolve to neither are excluded while a
// radius filter is active.

export const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
export const DEFAULT_RADIUS_MILES = 25;

/** True when the trimmed value is a bare 5-digit US ZIP. */
export function isZipQuery(value: string): boolean {
  return /^\d{5}$/.test(value.trim());
}

export type LocationQuery =
  | { kind: "zip"; zip: string }
  | { kind: "city"; city: string; state: string | null }
  | { kind: "text"; text: string };

/**
 * Parse a location filter query. "City, ST" (2-letter state) and bare city
 * names parse as city queries; anything else unparseable is free text.
 * Bare city names are best-effort: without a state they cannot be geocoded
 * keylessly, so they gracefully fall back to substring matching.
 */
export function parseLocationQuery(value: string): LocationQuery {
  const trimmed = value.trim();
  if (isZipQuery(trimmed)) return { kind: "zip", zip: trimmed };
  const cityState = trimmed.match(/^([A-Za-z][A-Za-z .'\-]*?),\s*([A-Za-z]{2})$/);
  if (cityState?.[1] && cityState[2]) {
    return { kind: "city", city: cityState[1].trim(), state: cityState[2].toLowerCase() };
  }
  if (trimmed.length >= 2 && /^[A-Za-z][A-Za-z .'\-]*$/.test(trimmed)) {
    return { kind: "city", city: trimmed, state: null };
  }
  return { kind: "text", text: trimmed };
}

/** True when the query can drive the radius filter (ZIP or city). */
export function isRadiusQuery(value: string): boolean {
  return parseLocationQuery(value).kind !== "text";
}

/** First 5-digit ZIP found in free text (handles ZIP+4 by taking the first 5). Returns null when none. */
export function extractZipFromServiceArea(serviceArea: string): string | null {
  const match = serviceArea.match(/\b(\d{5})\b/);
  return match?.[1] ?? null;
}

/** Great-circle distance in miles. */
export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface ZipCoords {
  lat: number;
  lon: number;
}

// Module-level cache: one zippopotam lookup per unique ZIP per session.
const zipCoordsCache = new Map<string, ZipCoords | null>();

/** Keyless ZIP → coordinates via zippopotam.us. Cached; null on any failure. */
export async function geocodeZip(zip: string): Promise<ZipCoords | null> {
  const key = zip.trim();
  if (!isZipQuery(key)) return null;
  if (zipCoordsCache.has(key)) return zipCoordsCache.get(key) ?? null;
  try {
    const response = await fetch(`https://api.zippopotam.us/us/${key}`);
    if (!response.ok) throw new Error(`zippopotam ${response.status}`);
    const data = (await response.json()) as {
      places?: Array<{ latitude?: string; longitude?: string }>;
    };
    const place = data.places?.[0];
    const lat = Number(place?.latitude);
    const lon = Number(place?.longitude);
    const coords = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    zipCoordsCache.set(key, coords);
    return coords;
  } catch {
    zipCoordsCache.set(key, null);
    return null;
  }
}

/** Clear the geocode cache (tests). */
export function clearZipCoordsCache(): void {
  zipCoordsCache.clear();
}

// Module-level cache: one zippopotam city lookup per unique city per session.
const cityCoordsCache = new Map<string, ZipCoords | null>();

/**
 * Keyless "City, ST" → coordinates via zippopotam.us/us/{state}/{city}.
 * Cached; null on any failure, and null when no 2-letter state is available
 * (bare city names cannot be geocoded keylessly — the caller falls back to
 * substring matching). fetchFn is injectable for tests.
 */
export async function geocodeCity(
  city: string,
  state: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<ZipCoords | null> {
  const c = city.trim();
  const s = (state ?? "").trim().toLowerCase();
  if (!c || !/^[a-z]{2}$/.test(s)) return null;
  const key = `${s}/${c.toLowerCase()}`;
  if (cityCoordsCache.has(key)) return cityCoordsCache.get(key) ?? null;
  try {
    const response = await fetchFn(`https://api.zippopotam.us/us/${s}/${encodeURIComponent(c)}`);
    if (!response.ok) throw new Error(`zippopotam ${response.status}`);
    const data = (await response.json()) as {
      places?: Array<{ latitude?: string; longitude?: string }>;
    };
    const place = data.places?.[0];
    const lat = Number(place?.latitude);
    const lon = Number(place?.longitude);
    const coords = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    cityCoordsCache.set(key, coords);
    return coords;
  } catch {
    cityCoordsCache.set(key, null);
    return null;
  }
}

/** Clear the city geocode cache (tests). */
export function clearCityCoordsCache(): void {
  cityCoordsCache.clear();
}

/** Resolve a parsed location query to coordinates (ZIP or city). Null for free text or any geocode failure. */
export async function resolveLocationCenter(query: LocationQuery): Promise<ZipCoords | null> {
  if (query.kind === "zip") return geocodeZip(query.zip);
  if (query.kind === "city") return geocodeCity(query.city, query.state);
  return null;
}

/** Case-insensitive city-name mention in a free-text service area (word-boundary aware). */
export function serviceAreaMentionsCity(serviceArea: string, city: string): boolean {
  const c = city.trim();
  if (!c) return false;
  const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(serviceArea);
}

/**
 * Pure per-listing radius decision, given a resolved center and a
 * ZIP → coords lookup. Inclusion rules while a radius filter is active:
 *  1. A listing whose service area names the query city counts as local
 *     (real distance is meaningless when the poster already said "Tampa").
 *  2. Otherwise the listing's first ZIP is geocoded and kept when within
 *     the radius via Haversine.
 *  3. Listings that resolve to neither (no city match, no parseable or
 *     resolvable ZIP) are excluded.
 */
export function listingWithinRadius(
  serviceArea: string,
  center: ZipCoords,
  coordsForZip: (zip: string) => ZipCoords | null | undefined,
  radiusMiles: number,
  queryCity?: string | null,
): boolean {
  if (queryCity && serviceAreaMentionsCity(serviceArea, queryCity)) return true;
  const zip = extractZipFromServiceArea(serviceArea);
  if (!zip) return false;
  const coords = coordsForZip(zip);
  if (!coords) return false;
  return haversineMiles(center.lat, center.lon, coords.lat, coords.lon) <= radiusMiles;
}

/** Google embed zoom that roughly frames the radius circle. */
export function radiusZoom(radiusMiles: number): number {
  if (radiusMiles <= 5) return 12;
  if (radiusMiles <= 10) return 11;
  if (radiusMiles <= 25) return 10;
  if (radiusMiles <= 50) return 9;
  return 8;
}
