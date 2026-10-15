// Marketplace Pro Profile behavior tests (Danny 2026-10-14).
//
// The Pro Profile is a marketplace pro's public page: all of the pro's
// info (their company profile from Settings — logo, cover, about, service
// area, socials) over ALL of their active listings. Entry points: the
// Featured Pro champion card ("View profile", by company) and a listing's
// "Listed by" area ("View profile", by listing).
//
// Covers:
//  1. getMarketplaceProProfile by company: settings fields pass through,
//     logo/cover resolve to blob URLs, verified comes from
//     business_verifications, categories are the distinct categories of
//     the pro's ACTIVE listings.
//  2. Listings: every active listing (Available AND Wanted), other
//     companies and non-active listings excluded; newestListingId is the
//     newest ACTIVE listing (the Message anchor); isMine follows the
//     viewer; the gated company phone stays hidden on the profile.
//  3. Resolution by listing follows getMarketplaceListing visibility: a
//     non-active listing resolves only for its owner.
//  4. Unknown company / no target → profile null (card renders linkless).
//  5. No ratings/reviews surface anywhere in the profile payload —
//     Danny parked that decision.
//  6. Static guards: the client registers the marketplaceProfile screen,
//     the profile component, the detail seller link, and the champion
//     card's profile navigation.
//
// Run from app/:  bun marketplace-profile.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { BaseActions } from "./server/src/actions.ts";
import * as schema from "./server/src/schema.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const appSrc = await readFile("client/src/App.tsx", "utf8");
const serverSrc = await readFile("server/src/actions.ts", "utf8");

// --- Scratch DB + migrate ------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-pro-profile-"));
const client = createClient({ url: `file:${join(dir, "test.db")}` });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });

// --- Fixtures ---------------------------------------------------------------------
const now = new Date();
const day = 86400000;
await db.insert(schema.settings).values({
  id: 1, companyId: 1, companyName: "Alpha Builders", updatedAt: now,
  profileDescription: "We build kitchens and baths.", serviceArea: "Tampa, FL",
  website: "alphabuilders.com", facebookUrl: "facebook.com/alpha", instagramUrl: "",
  offersFreeEstimates: true, logoBlobKey: "logos/alpha.png", coverBlobKey: "covers/alpha.jpg",
});
await db.insert(schema.settings).values({ id: 2, companyId: 2, companyName: "Gamma Works", updatedAt: now });
await db.insert(schema.businessVerifications).values({ companyId: 2, status: "verified", createdAt: now, updatedAt: now });
const mkUser = async (name: string, email: string, companyId: number) => {
  const rows = await db.insert(schema.authUsers).values({ name, email, passwordHash: "x", passwordSalt: "y", companyId, createdAt: now, updatedAt: now }).returning({ id: schema.authUsers.id });
  return rows[0]!.id;
};
const alphaId = await mkUser("Andy Alpha", "alpha@test.com", 1);
const gammaId = await mkUser("Gamma Lopez", "gamma@test.com", 2);
const ctxFor = (userId: number, companyId: number) => ({
  db: () => db,
  unscopedDb: () => db,
  workspaceCompanyId: companyId,
  workspaceUserId: userId,
  blobs: {
    put: async () => {},
    getUrl: async (key: string) => `blob://test/${key}`,
    get: async () => null,
    delete: async () => {},
    head: async () => ({ contentType: "application/octet-stream", size: 0 }),
  },
  invalidateQueries: () => {},
}) as any;
const actions = BaseActions as any;

const mkListing = async (values: Partial<typeof schema.marketplaceListings.$inferInsert> & { companyId: number; title: string }) => {
  const rows = await db.insert(schema.marketplaceListings).values({ category: "other", intent: "offer", serviceArea: "Tampa, FL", companyName: "", moderationStatus: "active", createdAt: now, updatedAt: now, ...values }).returning({ id: schema.marketplaceListings.id });
  return rows[0]!.id;
};
const l1 = await mkListing({ companyId: 1, title: "Kitchen remodel crew", category: "kitchens", intent: "offer", companyName: "Alpha Builders", createdAt: new Date(now.getTime() - 3 * day) });
const l2 = await mkListing({ companyId: 1, title: "Need a plumber", category: "plumbing", intent: "need", companyName: "Alpha Builders", createdAt: new Date(now.getTime() - 1 * day) });
const l3 = await mkListing({ companyId: 1, title: "Roofing special", category: "roofing", intent: "offer", companyName: "Alpha Builders", moderationStatus: "removed", createdAt: now });
const l4 = await mkListing({ companyId: 2, title: "Painters available", category: "painting", intent: "offer", companyName: "Gamma Works", createdAt: new Date(now.getTime() - 2 * day) });

// --- 1+2. Profile by company ---------------------------------------------------------
const res = await actions.getMarketplaceProProfile.handler(ctxFor(gammaId, 2), { companyId: 1, listingId: null });
const profile = res.profile;
check("profile resolves by company id", profile !== null);
check("company name comes from Settings", profile?.companyName === "Alpha Builders", profile?.companyName);
check("about/bio comes from Settings profileDescription", profile?.description === "We build kitchens and baths.");
check("service area comes from Settings", profile?.serviceArea === "Tampa, FL");
check("website + socials pass through", profile?.website === "alphabuilders.com" && profile?.facebookUrl === "facebook.com/alpha" && profile?.instagramUrl === "");
check("logo + cover resolve to blob URLs", profile?.logoUrl === "blob://test/logos/alpha.png" && profile?.coverUrl === "blob://test/covers/alpha.jpg");
check("offersFreeEstimates passes through", profile?.offersFreeEstimates === true);
check("unverified company reads verified=false", profile?.verified === false);
const ids = (profile?.listings ?? []).map((l: any) => l.id);
check("profile lists ALL active listings (offer + need)", ids.length === 2 && ids.includes(l1) && ids.includes(l2), JSON.stringify(ids));
check("removed listing is excluded", !ids.includes(l3));
check("other companies' listings are excluded", !ids.includes(l4));
check("listing intents include Available and Wanted", (profile?.listings ?? []).some((l: any) => l.intent === "offer") && (profile?.listings ?? []).some((l: any) => l.intent === "need"));
check("categories are the distinct categories of the active listings", [...(profile?.categories ?? [])].sort().join(",") === "kitchens,plumbing", (profile?.categories ?? []).join(","));
check("newestListingId is the newest ACTIVE listing (not the removed newer one)", profile?.newestListingId === l2, String(profile?.newestListingId));
check("listings are not mine for another pro's viewer", (profile?.listings ?? []).every((l: any) => l.isMine === false));
check("gated company phone stays hidden on profile listings", (profile?.listings ?? []).every((l: any) => l.companyPhone === ""));
check("profile object carries no raw contact fields", !!profile && !("phone" in profile) && !("companyPhone" in profile) && !("email" in profile));

// --- Own view ---------------------------------------------------------------------------
const own = await actions.getMarketplaceProProfile.handler(ctxFor(alphaId, 1), { companyId: 1, listingId: null });
check("owner viewing own profile sees isMine listings", (own.profile?.listings ?? []).length === 2 && (own.profile?.listings ?? []).every((l: any) => l.isMine === true));

// --- 3. Resolution by listing --------------------------------------------------------------
const byListing = await actions.getMarketplaceProProfile.handler(ctxFor(gammaId, 2), { companyId: null, listingId: l1 });
check("profile resolves from a listing's seller area", byListing.profile?.companyId === 1, String(byListing.profile?.companyId));
const byRemoved = await actions.getMarketplaceProProfile.handler(ctxFor(gammaId, 2), { companyId: null, listingId: l3 });
check("a removed listing does not resolve for non-owners", byRemoved.profile === null);
const byRemovedOwn = await actions.getMarketplaceProProfile.handler(ctxFor(alphaId, 1), { companyId: null, listingId: l3 });
check("a removed listing still resolves for its owner", byRemovedOwn.profile?.companyId === 1);

// --- 4. Absence ------------------------------------------------------------------------------
const unknown = await actions.getMarketplaceProProfile.handler(ctxFor(gammaId, 2), { companyId: 999, listingId: null });
check("unknown company → profile null", unknown.profile === null);
const noTarget = await actions.getMarketplaceProProfile.handler(ctxFor(gammaId, 2), { companyId: null, listingId: null });
check("no target → profile null", noTarget.profile === null);

// --- Second company: verified + sparse profile --------------------------------------------------
const gamma = await actions.getMarketplaceProProfile.handler(ctxFor(alphaId, 1), { companyId: 2, listingId: null });
check("verified company reads verified=true", gamma.profile?.verified === true);
check("sparse profile still renders (name + listings, no logo)", gamma.profile?.companyName === "Gamma Works" && gamma.profile?.logoUrl === null && (gamma.profile?.listings ?? []).map((l: any) => l.id).join(",") === String(l4));
check("sparse profile categories come from its listings", (gamma.profile?.categories ?? []).join(",") === "painting");

// --- 5+6. Static guards ----------------------------------------------------------------------------
check("server registers getMarketplaceProProfile", serverSrc.includes("getMarketplaceProProfile"));
check("no ratings/reviews fields in the profile payload", !/rating\s*:|reviewCount\s*:|stars\s*:|averageRating/i.test(serverSrc.slice(serverSrc.indexOf("getMarketplaceProProfile"), serverSrc.indexOf("getMarketplaceProProfile") + 4500)));
check("client registers the marketplaceProfile screen", appSrc.includes('"marketplaceProfile"') && appSrc.includes("name: \"marketplaceProfile\""));
check("client has the MarketplaceProProfile component using the action", appSrc.includes("function MarketplaceProProfile") && appSrc.includes("api.getMarketplaceProProfile"));
check("listing detail links its seller area to the profile", appSrc.includes("onOpenProfile") && appSrc.includes("market-profile-link"));
check("champion card navigates to the profile by company id", appSrc.includes("marketplaceProfile\", companyId: weekChampion.companyId"));

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll Marketplace Pro Profile checks passed.");
