// Build 0.7: marketplace listings require a dedicated ZIP code (drives the
// radius filter). Migration 0067 adds `zip_code` to marketplace_listings;
// the create/update zod schemas reject missing or malformed ZIPs; ZIP+4 is
// accepted and normalized to 5 digits.
//
// Covers:
//  1. Migration 0067 applies: `zip_code` column exists, NOT NULL, default ''.
//  2. marketplaceZipCodeSchema: valid 5-digit, ZIP+4 accepted; empty,
//     4-digit, 6-digit, letters rejected.
//  3. normalizeZipCode: ZIP+4 → 5 digits, trims whitespace.
//  4. Handler round-trip: create with ZIP+4 stores "33647"; shape includes
//     zipCode; update changes it.
//  5. Radius filter prefers the dedicated column (listingGeoText).
//  6. Static guards: dedicated ZIP field in the post form with EN/ES copy;
//     client-side validation regex; server request schemas include zipCode.
//
// Run from app/:  bun marketplace-zip-required.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { BaseActions, marketplaceZipCodeSchema, normalizeZipCode } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";
import { listingGeoText } from "./client/src/marketplaceGeo.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const clientSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");

// --- 1. Migration 0067 --------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-zip-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const cols = await sqlite.execute("PRAGMA table_info(marketplace_listings)");
const zipCol = cols.rows.find((r) => (r as { name: string }).name === "zip_code") as
  | { name: string; notnull: number; dflt_value: string | null }
  | undefined;
check("0067 adds zip_code column", Boolean(zipCol), JSON.stringify(cols.rows.map((r) => (r as { name: string }).name)));
check("zip_code is NOT NULL with '' default", zipCol?.notnull === 1 && zipCol?.dflt_value === "''",
  JSON.stringify({ notnull: zipCol?.notnull, dflt: zipCol?.dflt_value }));

// --- 2. Zod schema ------------------------------------------------------------
const parse = (v: string) => marketplaceZipCodeSchema.safeParse(v).success;
check("zip schema: 5-digit passes", parse("33647") === true);
check("zip schema: ZIP+4 passes", parse("33647-1234") === true);
check("zip schema: trims whitespace", parse("  33647  ") === true);
check("zip schema: empty rejected", parse("") === false);
check("zip schema: 4-digit rejected", parse("3364") === false);
check("zip schema: 6-digit rejected", parse("336471") === false);
check("zip schema: letters rejected", parse("abcde") === false);
check("zip schema: partial +4 rejected", parse("33647-12") === false);

// --- 3. Normalization -----------------------------------------------------------
check("normalize: ZIP+4 → 5 digits", normalizeZipCode("33647-1234") === "33647");
check("normalize: 5-digit unchanged", normalizeZipCode("33647") === "33647");
check("normalize: trims", normalizeZipCode("  33647 ") === "33647");

// --- 4. Handler round-trip --------------------------------------------------------
const ctx: any = {
  slug: "tradesign",
  invocationId: "zip-test",
  spaceDir: dir,
  db: () => db,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => null,
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  executePrivileged: async () => { throw new Error("no privileged in test"); },
  emit: () => {},
  invalidateQueries: () => {},
  workspaceCompanyId: 1,
  workspaceUserId: 1,
  workspaceTier: "free",
};
const now = new Date();
await db.insert(schema.authUsers).values({ companyId: 1, name: "Owner", email: "owner@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ZZZZZZZZ" });
await db.insert(schema.settings).values({ companyId: 1, companyName: "Test Co", phone: "8135550100" });

const baseArgs = {
  title: "Cabinet install", category: "kitchens", intent: "offer", employmentType: "full_time",
  payUnit: "hourly", priceKind: "contact", price: "", originalPrice: "", description: "d",
  serviceArea: "Tampa Bay", companyName: "Test Co", companyPhone: "", bookable: false, dailyRate: "",
  photos: [],
};
const made = await (BaseActions.createMarketplaceListing as any).handler(ctx, { ...baseArgs, zipCode: "33647-1234" });
check("create with ZIP+4 succeeds", typeof made?.id === "number");
const stored = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, made.id)).limit(1))[0];
check("ZIP+4 stored normalized to 5 digits", stored?.zipCode === "33647", JSON.stringify(stored?.zipCode));

const shaped = await (BaseActions.getMarketplaceListing as any).handler(ctx, { id: made.id });
check("listing shape includes zipCode", shaped?.listing?.zipCode === "33647", JSON.stringify(shaped?.listing?.zipCode));

const edited = await (BaseActions.updateMarketplaceListing as any).handler(ctx, {
  ...baseArgs, id: made.id, zipCode: "34655", replacePhotos: false,
});
check("update changes ZIP", edited?.id === made.id);
const stored2 = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, made.id)).limit(1))[0];
check("updated ZIP persisted", stored2?.zipCode === "34655", JSON.stringify(stored2?.zipCode));

// --- 5. Radius prefers the dedicated column ---------------------------------------
check("listingGeoText: prefers zipCode", listingGeoText({ zipCode: "33647", serviceArea: "Tampa Bay" }) === "33647");
check("listingGeoText: falls back to serviceArea", listingGeoText({ zipCode: "", serviceArea: "Tampa 33647" }) === "Tampa 33647");
check("listingGeoText: null zipCode falls back", listingGeoText({ zipCode: null, serviceArea: "Tampa" }) === "Tampa");

// --- 6. Static guards ---------------------------------------------------------------
check("server: create schema requires zipCode", serverSrc.includes("zipCode: marketplaceZipCodeSchema"));
check("server: shape maps zipCode", serverSrc.includes("zipCode: row.zipCode"));
check("client: dedicated ZIP field", clientSrc.includes('aria-label={t.zip}') && clientSrc.includes('inputMode="numeric"'));
check("client: ES ZIP label", clientSrc.includes('"Código postal"'));
check("client: ES ZIP error", clientSrc.includes('"Ingresa un código postal válido de 5 dígitos."'));
check("client: validates ZIP on submit", clientSrc.includes('/^\\d{5}(-\\d{4})?$/'));
check("client: radius uses listingGeoText", clientSrc.includes("listingGeoText(listing)"));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
