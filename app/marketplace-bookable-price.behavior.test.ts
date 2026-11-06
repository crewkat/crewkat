// Crawl fix round 3 (2026-11-06): bookable Marketplace price keeps its
// period. Live verification found a $25/day rental ("Waterproof boots")
// rendering as a bare "$25.00" on card, detail and aria labels alike.
// Root-cause hunt, in order:
//   1. The helper (marketplacePrice) DOES own the bookable format — it
//      checks listing.bookable first and renders "$25/day" / "$25/día".
//   2. Both creation flows (phone form, Office form) capture and send
//      bookable + dailyRate; the create/update request schemas have
//      carried both fields since the feature's first commit, so the
//      server.mjs request safeParse never stripped them.
//   3. This suite proves the whole path with server.mjs's exact dispatch
//      semantics (request safeParse → handler → response safeParse):
//      a bookable listing's flag and rate survive create, storage, list
//      and get. The live listing's row therefore lacks the data itself
//      (bookable = 0, daily_rate = '') — its $25 sits in `price` as a
//      plain amount listing and its rental period exists only in free
//      text. It renders "$25.00" until its owner edits it, turns on
//      "Allow bookings" and sets "Price per day"; no code may invent
//      the period from prose.
//   4. One real defect WAS in the helper: the bookable branch formatted
//      with maximumFractionDigits 0, silently rounding a fractional
//      daily rate ($25.50/day → "$26/day"). It now keeps the rate exact
//      (min 0 / max 2 fraction digits), pinned by a static guard below.
//
// Run from app/:  bun marketplace-bookable-price.behavior.test.ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
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

const clientSrc = await readFile("client/src/App.tsx", "utf8");

// --- Production-path dispatch (mirrors server.mjs dispatchAction) ------------
const dir = await mkdtemp(join(tmpdir(), "crewkat-bookable-"));
const sqlite = createClient({ url: `file:${join(dir, "app.db")}` });
const db = drizzle(sqlite);
await migrate(db, { migrationsFolder: "./drizzle" });

const ctx: any = {
  slug: "tradesign",
  invocationId: "bookable-test",
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
await db.insert(schema.authUsers).values({ companyId: 1, name: "Owner", email: "owner@example.com", passwordHash: "x", passwordSalt: "y", passwordIterations: 1, referralCode: "ZZZZZZZZ" });
await db.insert(schema.settings).values({ companyId: 1, companyName: "Test Co", phone: "8135550100" });

async function dispatch(name: string, args: any): Promise<any> {
  const action: any = (BaseActions as any)[name];
  const parsedArgs = action.request.safeParse(args ?? {});
  if (!parsedArgs.success) return { error: "Invalid request" };
  let result: any;
  try {
    result = await action.handler(ctx, parsedArgs.data);
  } catch (e: any) {
    return { error: e?.message || "Action failed." };
  }
  const parsedResult = action.response.safeParse(result);
  if (!parsedResult.success) return { error: "Invalid response" };
  return { data: parsedResult.data };
}

// The request safeParse must not strip the bookable fields (the exact
// silent-drop failure mode this round investigated).
const parsedCreate = (BaseActions as any).createMarketplaceListing.request.safeParse({
  title: "Waterproof boots", category: "equipment", intent: "offer", neededBy: "",
  employmentType: "full_time", payUnit: "hourly", priceKind: "amount", price: "25",
  originalPrice: "", description: "Rent by the day", serviceArea: "Tampa", zipCode: "33647",
  companyName: "Test Co", companyPhone: "", bookable: true, dailyRate: "25", photos: [],
});
check("request schema keeps bookable", parsedCreate.success && parsedCreate.data.bookable === true);
check("request schema keeps dailyRate", parsedCreate.success && parsedCreate.data.dailyRate === "25");

// --- Bookable round-trip -------------------------------------------------------
const baseArgs = {
  title: "Waterproof boots", category: "equipment", intent: "offer", neededBy: "",
  employmentType: "full_time", payUnit: "hourly", priceKind: "amount", price: "25",
  originalPrice: "", description: "Rent by the day", serviceArea: "Tampa", zipCode: "33647",
  companyName: "Test Co", companyPhone: "", photos: [],
};
const made = await dispatch("createMarketplaceListing", { ...baseArgs, bookable: true, dailyRate: "25" });
check("create bookable listing succeeds", typeof made?.data?.id === "number", JSON.stringify(made));
const id = made.data.id;

const stored = (await db.select().from(schema.marketplaceListings).where(eq(schema.marketplaceListings.id, id)).limit(1))[0];
check("stored row: bookable true", stored?.bookable === true, JSON.stringify(stored?.bookable));
check("stored row: dailyRate normalized", stored?.dailyRate === "25.00", JSON.stringify(stored?.dailyRate));

const listed = await dispatch("listMarketplaceListings", { search: "", category: null, serviceArea: "" });
const listRow = listed?.data?.listings?.find((l: any) => l.id === id);
check("list payload: bookable true", listRow?.bookable === true, JSON.stringify(listRow?.bookable));
check("list payload: dailyRate carried", listRow?.dailyRate === "25.00", JSON.stringify(listRow?.dailyRate));

const got = await dispatch("getMarketplaceListing", { id });
check("get payload: bookable true", got?.data?.listing?.bookable === true);
check("get payload: dailyRate carried", got?.data?.listing?.dailyRate === "25.00");

// Bookable without a rate is rejected, so a bookable row can never carry
// an empty rate through the supported flows.
const noRate = await dispatch("createMarketplaceListing", { ...baseArgs, bookable: true, dailyRate: "" });
check("bookable without dailyRate rejected", typeof noRate?.error === "string" && noRate.error.includes("daily rate"), JSON.stringify(noRate));

// A plain listing stays plain — the helper's bookable branch must not
// fire for it (this is the live boots listing's actual stored shape).
const plain = await dispatch("createMarketplaceListing", { ...baseArgs, title: "Plain boots", bookable: false, dailyRate: "" });
const plainRow = (await dispatch("listMarketplaceListings", { search: "", category: null, serviceArea: "" }))?.data?.listings?.find((l: any) => l.id === plain.data.id);
check("plain listing: bookable false in payload", plainRow?.bookable === false);
check("plain listing: dailyRate empty in payload", plainRow?.dailyRate === "");

// --- Helper contract (static guards on the client source) ----------------------
const helperStart = clientSrc.indexOf("function marketplacePrice");
const helperBody = clientSrc.slice(helperStart, helperStart + 1600);
check("helper: bookable branch exists", helperBody.includes("if (listing.bookable)"));
check(
  "helper: bookable checked before priceKind branches",
  helperBody.indexOf("listing.bookable") < helperBody.indexOf('priceKind === "free"'),
);
check("helper: EN/ES period words", helperBody.includes('"día"') && helperBody.includes('"day"'));
check(
  "helper: rate kept exact (min 0 / max 2 fraction digits, no silent rounding)",
  helperBody.includes("minimumFractionDigits: 0, maximumFractionDigits: 2"),
);
// Every price surface renders through the one helper: Explore card +
// aria label, seller-profile card + aria label, detail header.
check(
  "helper: all card/detail/aria surfaces call marketplacePrice",
  (clientSrc.match(/marketplacePrice\(listing, lang\)/g) ?? []).length >= 5,
  `count=${(clientSrc.match(/marketplacePrice\(listing, lang\)/g) ?? []).length}`,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
