// What's New card + changelog sheet (Danny 2026-10-14).
//
// Danny's spec: "a very slim card to home page with something like whats
// new? And a pop up window shows latest fixes and added features with date.
// No need to add to many details — some basics and bug fix count."
//
// Pins: the slim strip renders on Home (after the Open-jobs summary card,
// before the at-a-glance strip), the sheet lists curated entries newest
// first with a per-entry bug-fix count (count line omitted when 0), the
// unread dot follows "newest entry date > last seen date" in localStorage
// and clears when the sheet opens, and every seeded line exists in EN + ES.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

const dataStart = APP.indexOf("const WHATS_NEW_ENTRIES");
const compStart = APP.indexOf("function WhatsNewCard");
const compEnd = APP.indexOf("// Chunk D: referral loop panel", compStart);
const data = APP.slice(dataStart, compStart);
const comp = APP.slice(compStart, compEnd);
const home = APP.slice(APP.indexOf("function TodayScreen"), APP.indexOf("function AutomationGroup"));

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`${escaped} \\{([^}]*)\\}`));
  return m?.[1] ?? "";
};

describe("What's New — data model", () => {
  test("entries are curated data, newest first (Oct 15 above Oct 14)", () => {
    expect(dataStart).toBeGreaterThan(0);
    const a = data.indexOf('"2026-10-15"');
    const b = data.indexOf('"2026-10-14"');
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
  });

  test("bug-fix counts are the honest seeded totals (4 and 5)", () => {
    expect(/"2026-10-15"[\s\S]*?bugFixes: 4/.test(data)).toBe(true);
    expect(/"2026-10-14"[\s\S]*?bugFixes: 5/.test(data)).toBe(true);
  });

  test("seeded EN lines are present", () => {
    for (const line of [
      "Photo proof packs: pair before & after photos into a slider your clients can slide in their portal",
      "What's New is here — this card, so you can see what changed",
      "Place signatures on any page of an uploaded contract",
      "Crane Run: last week's champion now headlines the screen",
      "Estimate Options: clients tick optional add-ons right on the estimate, totals update live",
      "Sign on the dotted line: place signature + date fields on your own PDFs",
      "Crane Run went weekly — top the board and your business gets a free Featured Pro week in the Marketplace",
      "Pro Profiles in the Marketplace: a pro's info and all their listings in one place",
      "A Premium page that shows its work",
    ]) expect(data).toContain(line);
  });

  test("seeded ES lines are present for every entry", () => {
    for (const line of [
      "Packs de prueba en fotos: combina fotos de antes y después",
      "Novedades ya está aquí — esta tarjeta, para que veas qué cambió",
      "Coloca firmas en cualquier página de un contrato subido",
      "Crane Run: el campeón de la semana pasada ahora encabeza la pantalla",
      "Opciones en estimados: los clientes marcan complementos opcionales",
      "Firma en la línea punteada: coloca campos de firma y fecha en tus propios PDF",
      "Crane Run ahora es semanal — lidera la tabla",
      "Perfiles Pro en el Marketplace: la información de un profesional y todos sus anuncios en un solo lugar",
      "Una página Premium que muestra su valor",
    ]) expect(data).toContain(line);
  });
});

describe("What's New — Home card + sheet", () => {
  test("the slim card renders on Home, below the summary card and above at-a-glance", () => {
    const card = home.indexOf("<WhatsNewCard lang={lang} />");
    expect(card).toBeGreaterThan(home.indexOf("home-summary-card"));
    expect(card).toBeLessThan(home.indexOf("glance-strip"));
  });

  test("card is a one-line strip: sparkle icon, title, newest date, chevron", () => {
    expect(comp).toContain('className="whats-new-card"');
    expect(comp).toContain('className="whats-new-icon"');
    expect(comp).toContain('lang === "es" ? "Novedades" : "What\'s new"');
    expect(comp).toContain("cardDate");
    expect(comp).toContain("newest.date");
  });

  test("sheet is the shared BottomSheet and lists entries newest-first", () => {
    expect(comp).toContain("<BottomSheet");
    expect(comp).toContain("WHATS_NEW_ENTRIES.map((entry)");
    expect(comp).toContain("entry.features[lang]");
  });

  test("bug-fix count line renders per entry and is omitted when zero", () => {
    expect(comp).toContain("entry.bugFixes > 0");
    expect(comp).toContain("Bug fixes: ${entry.bugFixes}");
    expect(comp).toContain("Correcciones: ${entry.bugFixes}");
  });
});

describe("What's New — unread dot", () => {
  test("seen state lives in localStorage under the crewkat-whats-new-seen key", () => {
    expect(APP).toContain('WHATS_NEW_SEEN_KEY = "crewkat-whats-new-seen"');
    expect(comp).toContain("localStorage.getItem(WHATS_NEW_SEEN_KEY)");
    expect(comp).toContain("localStorage.setItem(WHATS_NEW_SEEN_KEY, newest.date)");
  });

  test("dot shows only while unread and clears on open", () => {
    expect(comp).toContain("newest.date > seen");
    expect(comp).toContain('{unread && <span className="whats-new-dot"');
    expect(comp).toContain("setUnread(false)");
  });

  test("unread rule semantics: dot iff newest entry is newer than the seen date", () => {
    const isUnread = (newest: string, seen: string) => newest > seen;
    expect(isUnread("2026-10-15", "")).toBe(true); // fresh device
    expect(isUnread("2026-10-15", "2026-10-14")).toBe(true); // saw only the older entry
    expect(isUnread("2026-10-15", "2026-10-15")).toBe(false); // already opened
  });
});

describe("What's New — styling", () => {
  test("card is a slim surface strip", () => {
    const r = rule(".whats-new-card");
    expect(r).toContain("background: var(--surface)");
    expect(r).toContain("border-radius: 12px");
    expect(r).toContain("display: flex");
  });

  test("dot is a small accent circle", () => {
    const r = rule(".whats-new-dot");
    expect(r).toContain("border-radius: 50%");
    expect(r).toContain("background: var(--accent)");
  });
});
