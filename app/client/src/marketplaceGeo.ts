// Marketplace location helpers: ZIP extraction, keyless ZIP geocoding
// (zippopotam.us — free, no key, already used for the map preview), and the
// Haversine distance used by the Location sheet's radius filter.
//
// Data reality: marketplace listings carry only free-text `serviceArea`
// ("Tampa, FL", "33647", "Trinity FL 34655") — no coordinates. So the radius
// filter works ONLY on listings whose service area contains a 5-digit ZIP,
// geocoded honestly via zippopotam. Listings without a parseable ZIP cannot
// be placed on the map and are excluded while a radius filter is active.

export const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
export const DEFAULT_RADIUS_MILES = 25;

/** True when the trimmed value is a bare 5-digit US ZIP. */
export function isZipQuery(value: string): boolean {
  return /^\d{5}$/.test(value.trim());
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

/**
 * Pure per-listing radius decision, given a resolved center and a
 * ZIP → coords lookup. Listings whose service area has no parseable ZIP
 * return false: they cannot be placed, so they are excluded while a
 * radius filter is active.
 */
export function listingWithinRadius(
  serviceArea: string,
  center: ZipCoords,
  coordsForZip: (zip: string) => ZipCoords | null | undefined,
  radiusMiles: number,
): boolean {
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
