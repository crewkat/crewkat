// Danny 2026-10-11: "Crane Run" — a Chrome-dino-style endless runner starring
// the Crewkat crane, as a tile in Tools ("Just for fun"). Canvas 2D, single
// jump (tap/click/Space), cones + toolboxes, score = distance, high score in
// localStorage, EN+ES strings. Very simple by design.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

describe("Crane Run screen registration", () => {
  test("Screen union includes craneRun", () => {
    expect(APP).toContain('{ name: "craneRun" }');
  });

  test("render switch mounts CraneRunScreen with back navigation", () => {
    expect(APP).toContain('screen.name === "craneRun"');
    expect(APP).toContain("<CraneRunScreen");
  });

  test("craneRun is not a pro-gated tool screen", () => {
    // isProToolScreen enumerates pro screens; craneRun must stay free.
    const m = APP.match(/function isProToolScreen[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m![0]).not.toContain("craneRun");
  });
});

describe("Crane Run Tools tile", () => {
  test("tile registered in the Tools catalog", () => {
    expect(APP).toContain('byKey.set("craneRun"');
  });

  test("'Just for fun' group exists at the end of the catalog (EN+ES)", () => {
    expect(APP).toContain("Just for fun");
    expect(APP).toContain("Solo por diversión");
  });

  test("tile has EN+ES title and description", () => {
    expect(APP).toContain("Crane Run");
    expect(APP).toContain("Carrera de la Grulla");
  });
});

describe("Crane Run game engine", () => {
  test("single-jump physics: gravity + jump velocity defined", () => {
    expect(APP).toMatch(/GRAVITY\s*=\s*\d+/);
    expect(APP).toMatch(/JUMP_V\s*=\s*\d+/);
  });

  test("obstacles are cones and toolboxes with ramping speed", () => {
    expect(APP).toContain('"cone"');
    expect(APP).toContain('"box"');
    expect(APP).toMatch(/MAX_SPEED\s*=\s*\d+/);
    expect(APP).toMatch(/ACCEL\s*=\s*[\d.]+/);
  });

  test("score = distance, high score persisted in localStorage", () => {
    expect(APP).toContain("crewkat-crane-run-high");
    expect(APP).toContain("localStorage");
    expect(APP).toMatch(/S\.dist\s*\/\s*10/);
  });

  test("tap / click / Space all jump; tap restarts after game over", () => {
    expect(APP).toContain("pointerdown");
    expect(APP).toContain('"Space"');
    expect(APP).toContain("tapToRestart");
  });

  test("loop pauses when tab hidden and tears down on unmount", () => {
    expect(APP).toContain("visibilitychange");
    expect(APP).toContain("cancelAnimationFrame");
  });

  test("canvas is devicePixelRatio-aware", () => {
    expect(APP).toContain("devicePixelRatio");
  });

  test("game world scales to the canvas: dynamic view width, minimum visible width", () => {
    // Scale fills the canvas height but never shows less than MIN_VIEW_W
    // world units, so reaction time stays fair on narrow portrait screens.
    expect(APP).toMatch(/MIN_VIEW_W\s*=\s*\d+/);
    expect(APP).toContain("viewW");
    expect(APP).toContain("groundY");
  });

  test("crane drawn with canvas paths (body, neck, beak, legs)", () => {
    // drawCrane is the only place these shapes combine for the mascot.
    expect(APP).toContain("drawCrane");
    expect(APP).toContain("quadraticCurveTo"); // neck
  });
});

describe("Crane Run i18n (EN+ES)", () => {
  const strings: Array<[string, string]> = [
    ["tapToJump", "Toca para saltar"],
    ["gameOver", "Fin del juego"],
    ["score", "Puntos"],
    ["highScore", "Récord"],
    ["tapToRestart", "Toca para reintentar"],
  ];
  for (const [key, es] of strings) {
    test(`${key} has EN+ES strings`, () => {
      expect(APP).toContain(key);
      expect(APP).toContain(es);
    });
  }
});

describe("Crane Run styles", () => {
  test("game wrap fills the screen + panels styled with app conventions", () => {
    expect(CSS).toContain(".crane-run-wrap");
    expect(CSS).toContain(".crane-run-panel");
    // full-screen game area: wrap flex-fills below the header, no fixed strip
    expect(CSS).toMatch(/\.crane-run-wrap[\s\S]*?flex:\s*1/);
    expect(CSS).not.toMatch(/\.crane-run-wrap[\s\S]*?aspect-ratio/);
    // panels use 8px rounding + soft shadows per the app design language
    expect(CSS).toMatch(/\.crane-run-panel[\s\S]*?border-radius:\s*8px/);
    expect(CSS).toContain("var(--shadow-lift)");
  });
});

describe("Crane Run home easter egg (Danny 2026-10-11)", () => {
  test("home hero crane illustration is a pressable that opens the game", () => {
    // The art itself is the only affordance: no visible button chrome, no labels.
    expect(APP).toContain('<button type="button" className="home-summary-art"');
    expect(APP).toMatch(/className="home-summary-art"[\s\S]*?setScreen\(\{ name: "craneRun" \}\)/);
  });

  test("easter egg has screen-reader-only EN+ES labels", () => {
    expect(APP).toMatch(/home-summary-art[\s\S]*?"Jugar a Crane Run"/);
    expect(APP).toMatch(/home-summary-art[\s\S]*?"Play Crane Run"/);
  });

  test("art button keeps its faded look, resets button chrome, stays tappable (CSS)", () => {
    expect(CSS).toMatch(/\.home-summary-art[^{]*\{[^}]*background:\s*none/);
    expect(CSS).toMatch(/\.home-summary-art[^{]*\{[^}]*cursor:\s*pointer/);
    expect(CSS).toMatch(/\.home-summary-art[^{]*\{[^}]*opacity:\s*\.5/);
    // the inner svg stays non-interactive; no full-art pointer-events block remains
    expect(CSS).toMatch(/\.home-summary-art svg[^{]*\{[^}]*pointer-events:\s*none/);
  });
});

describe("Crane Run weekly leaderboard UI (Danny 2026-10-11 daily; weekly 2026-10-14)", () => {
  test("board card renders above the game with EN+ES strings", () => {
    expect(APP).toContain("crane-run-board");
    expect(APP).toContain("This Week's Top 5");
    expect(APP).toContain("Los 5 mejores de la semana");
    expect(APP).toContain("Show me on the leaderboard");
    expect(APP).toContain("Mostrarme en la tabla");
    expect(APP).toContain("No scores yet this week");
    expect(APP).toContain("Aún no hay puntajes esta semana");
  });

  test("champion spotlight renders on Crane Run and in the Marketplace (0077)", () => {
    expect(APP).toContain("crane-run-champion");
    expect(APP).toContain("Last week's champion");
    expect(APP).toContain("Campeón de la semana pasada");
    expect(APP).toContain("api.craneRunGetChampion");
    expect(APP).toContain("market-champion-card");
    expect(APP).toContain("Featured Pro");
    expect(APP).toContain("Profesional destacado");
    expect(CSS).toContain(".crane-run-champion");
    expect(CSS).toContain(".market-champion-card");
  });

  test("board uses the shared Switch for opt-in, wired to the opt-in action", () => {
    expect(APP).toContain("api.craneRunSetOptIn");
    expect(APP).toMatch(/crane-run-optin[\s\S]*?<Switch/);
  });

  test("board fetches via the leaderboard action and highlights the caller's row", () => {
    expect(APP).toContain("api.craneRunGetLeaderboard");
    expect(APP).toContain("crane-run-board-list");
    expect(APP).toContain("crane-run-me");
  });

  test("final score submits once per game when opted in (local high score untouched)", () => {
    expect(APP).toContain("api.craneRunSubmitScore");
    expect(APP).toContain("submittedRef");
    expect(APP).toContain("CRANE_RUN_HIGH_KEY");
  });

  test("board card styled with app conventions (8px rounding, soft shadow)", () => {
    expect(CSS).toMatch(/\.crane-run-board\s*\{[\s\S]*?border-radius:\s*8px/);
    expect(CSS).toContain("var(--shadow-soft)");
  });

  test("own leaderboard row uses an orange hairline, no beige fill (Danny 2026-10-11)", () => {
    const meRule = CSS.match(/\.crane-run-board-list li\.crane-run-me\s*\{([\s\S]*?)\}/);
    expect(meRule).not.toBeNull();
    expect(meRule![1]).toMatch(/border-color:\s*var\(--accent\)/);
    expect(meRule![1]).not.toMatch(/background/);
  });

  test("leaderboard card is compact and sizes to content", () => {
    expect(CSS).toMatch(/\.crane-run-board\s*\{[\s\S]*?flex:\s*0 0 auto/);
    expect(CSS).toMatch(/\.crane-run-board-list li\s*\{[\s\S]*?padding:\s*3px 6px/);
  });
});
