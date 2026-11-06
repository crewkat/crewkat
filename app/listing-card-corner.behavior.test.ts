// Listing-card corner artifact guards (Danny 2026-10-15).
//
// Danny's Pro Profile screenshot showed a white broken-image-style box
// sitting on the save/bookmark circle at the top-right of EVERY market
// card (Explore + Pro Profile share the card markup). Source audit: the
// only element at that spot is the .market-save button (an inline SVG
// bookmark), and the card's only raster image is the listing photo
// (listing.photos[0].url). These guards pin the hardening for both:
//
//  1. The save button clips its content to its 30px circle and its icon
//     has a fully pinned box (width AND height + display:block) — the old
//     rule sized only the svg width, leaving its height to the attribute.
//  2. A card photo whose URL fails must degrade gracefully so the
//     browser's native broken-image box can never paint on a card — at
//     BOTH card call sites (Explore grid, Pro Profile). Original guard:
//     onError set visibility:hidden. Crawl fix A12 (2026-11-06) replaced
//     that with the shared MarketCardPhoto component: a failed photo
//     swaps to the category placeholder (the hidden img left an empty
//     beige tile), so the img leaves the tree entirely.
//
// Run from app/:  bun test listing-card-corner.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

describe("market card corner overlay (save button)", () => {
  test("button clips content to its circle", () => {
    expect(CSS).toMatch(/\.market-save \{[^}]*border-radius:\s*50%/);
    expect(CSS).toMatch(/\.market-save \{[^}]*overflow:\s*hidden/);
  });

  test("bookmark icon box is fully pinned (width + height + block)", () => {
    expect(CSS).toMatch(/\.market-save svg \{[^}]*width:\s*16px/);
    expect(CSS).toMatch(/\.market-save svg \{[^}]*height:\s*16px/);
    expect(CSS).toMatch(/\.market-save svg \{[^}]*display:\s*block/);
  });

  test("save button still renders its bookmark icon and toggle wiring", () => {
    expect(APP).toContain("market-save");
    expect(APP).toContain("M6 3h12v18l-6-4-6 4z");
    expect(APP).toContain("toggleSaved");
  });
});

describe("card photo degrade", () => {
  test("both card call sites render the shared MarketCardPhoto", () => {
    const sites = APP.match(/<MarketCardPhoto /g) ?? [];
    expect(sites.length).toBe(2);
  });

  test("a failed photo swaps to the placeholder instead of painting the broken-image box", () => {
    expect(APP).toContain("onError={() => setFailed(true)}");
    expect(APP).toContain("market-card-placeholder");
    expect(APP).not.toContain('e.currentTarget.style.visibility = "hidden"');
  });

  test("photo still renders normally when its URL loads", () => {
    expect(APP).toContain("<img src={photo.url} alt={listing.title} onError={() => setFailed(true)} />");
  });
});
