// Danny 2026-10-14: "In profile if we dont have reviews yet lets get rid
// of the option." The Pro Profile's Reviews link was driven by the pro's
// Settings reviewUrl (their Google review link) — it rendered whenever a
// link was configured, but Crewkat has no in-app reviews for anyone yet
// (ratings/reviews are parked until completed-booking volume exists), so
// a "Reviews" option implied something that isn't there. Rule: the option
// is absent from the public profile entirely until a real reviews
// presence exists; the other optional links keep their configured-or-
// absent behavior, and reviewUrl stays in the payload for the pro's own
// review-request flows.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const SERVER = readFileSync(join(import.meta.dir, "server/src/actions.ts"), "utf8");

const profileScreen = APP.slice(APP.indexOf("function MarketplaceProProfile"), APP.indexOf("function MarketplaceListingDetail"));

describe("Pro Profile Reviews rule (Danny 2026-10-14)", () => {
  test("no Reviews entry is rendered on the public profile", () => {
    expect(profileScreen).not.toContain("t.reviews");
    expect(profileScreen).not.toContain("profile.reviewUrl");
    expect(APP).not.toContain("label: t.reviews");
  });

  test("the other optional links keep their configured-or-absent gating", () => {
    expect(profileScreen).toContain("{ label: t.website, url: profile.website }");
    expect(profileScreen).toContain('{ label: "Facebook", url: profile.facebookUrl }');
    expect(profileScreen).toContain('{ label: "Instagram", url: profile.instagramUrl }');
    expect(profileScreen).toContain('{ label: "YouTube", url: profile.youtubeUrl }');
    expect(profileScreen).toContain(".filter((item) => item.url.trim())");
  });

  test("reviewUrl still flows to the pro's own tools (payload unchanged)", () => {
    const action = SERVER.slice(SERVER.indexOf("getMarketplaceProProfile"));
    expect(action).toContain('reviewUrl: profileSettings?.reviewUrl ?? ""');
  });
});
