// Price book picker popup (Danny 2026-11-09).
//
// Danny's New estimate screenshot: the "Add from price book" chip wall
// rendered every price book item inline in the builder — with a grown
// book (20+ items) it ate half the screen before the first line item.
// Fix: the builder shows only a trigger button in the template/assembly
// button row; the items live in a FloatPopup (search + scrollable rows),
// the same pattern as the template picker. Tapping a row adds the item
// and keeps the popup open; the row reports how many times it was added.
//
// Run from app/:  bun test price-book-popup.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

describe("price book picker is a popup, not an inline chip wall", () => {
  test("no quick-add chip wall remains in source or CSS", () => {
    expect(APP).not.toContain("quick-add");
    expect(CSS).not.toContain(".quick-add");
  });

  test("builder renders a price book trigger button in the button row", () => {
    const rowAt = APP.indexOf('className="b06-btn-row"');
    const triggerAt = APP.indexOf("setPriceBookOpen(true)", rowAt);
    expect(rowAt).toBeGreaterThan(-1);
    expect(triggerAt).toBeGreaterThan(rowAt);
    expect(APP).toContain('"Add from price book"');
  });

  test("popup is a FloatPopup with search and add rows", () => {
    const popupAt = APP.indexOf("{priceBookOpen && (");
    expect(popupAt).toBeGreaterThan(-1);
    const popup = APP.slice(popupAt, popupAt + 3600);
    expect(popup).toContain("FloatPopup");
    expect(popup).toContain("priceBookQuery");
    expect(popup).toContain("addPriceBookItem(item)");
    expect(popup).toContain("pbAdded");
  });

  test("adding a price book item appends a line with its price", () => {
    const helperAt = APP.indexOf("const addPriceBookItem");
    expect(helperAt).toBeGreaterThan(-1);
    const helper = APP.slice(helperAt, helperAt + 700);
    expect(helper).toContain("amount: item.unitPrice");
    expect(helper).toContain("quantity: 1");
  });

  test("builder exit escape guard yields while the popup is open", () => {
    expect(APP).toContain("!assemblyOpen && !priceBookOpen && !previewOpen");
  });
});
