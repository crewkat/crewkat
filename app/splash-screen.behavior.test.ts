// Boot splash (Danny approved 2026-10-24; mockup:
// brand-assets/loading-screen-mockup.png) — a full-viewport navy
// loading screen over the app boot window: session restore plus the
// signed-in app's initial settings load. It renders from the first
// paint (main.tsx, sibling of <App />), fades out when the boot-ready
// latch fires, and force-dismisses after ~6s so a hung load can never
// trap the user. Public link surfaces (doc/portal/tools/booking)
// never arm it. Static assertions in the repo's usual style, plus
// built-output checks on the committed client dist.
// Run from app/:  bun test splash-screen.behavior.test.ts
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MAIN = readFileSync(join(import.meta.dir, "client/src/main.tsx"), "utf8");
const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const SPLASH = readFileSync(join(import.meta.dir, "client/src/SplashScreen.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

const DIST_ASSETS = join(import.meta.dir, "client/dist/assets");
const distFiles = existsSync(DIST_ASSETS) ? readdirSync(DIST_ASSETS) : [];
const distJs = distFiles
  .filter((f) => f.endsWith(".js"))
  .map((f) => readFileSync(join(DIST_ASSETS, f), "utf8"))
  .join("\n");
const distCss = distFiles
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(join(DIST_ASSETS, f), "utf8"))
  .join("\n");

describe("boot wiring", () => {
  test("main.tsx mounts the splash as a sibling of <App /> inside the boundary", () => {
    expect(MAIN).toContain('import { BootSplash } from "./SplashScreen";');
    expect(MAIN).toContain("<App />");
    expect(MAIN).toContain("<BootSplash />");
    expect(MAIN.indexOf("<App />")).toBeLessThan(MAIN.indexOf("<BootSplash />"));
  });

  test("splash renders while not ready and removes itself when done", () => {
    expect(SPLASH).toContain('className={`boot-splash${done ? " leaving" : ""}`}');
    expect(SPLASH).toContain('if (!armed || gone) return null;');
    // fade first (480ms), then unmount via the gone state
    expect(SPLASH).toContain("const SPLASH_FADE_MS = 480;");
    expect(SPLASH).toContain("setGone(true), SPLASH_FADE_MS");
  });

  test("ready is a one-way latch fed by the boot milestones", () => {
    expect(SPLASH).toContain("export function signalBootReady(): void");
    expect(SPLASH).toContain("if (bootReady) return;");
    // signed-out destination: AuthScreen reports restore settled
    expect(APP).toContain("onRestoreSettled={signalBootReady}");
    expect(APP).toContain("onRestoreSettled?.();");
    // signed-in destination: CrewkatApplication reports its initial load
    expect(APP).toContain("<CrewkatApplication onBootSettled={signalBootReady} />");
    expect(APP).toContain("if (settings.isSuccess || settings.isError)");
    expect(APP).toContain("onBootSettled?.();");
    // gate destinations (terms / maintenance) signal from App directly
    expect(APP).toContain("if (termsGatePending) signalBootReady();");
  });

  test("public link surfaces never arm the splash", () => {
    expect(SPLASH).toContain('if (hash.get("doc") || hash.get("portal")) return true;');
    expect(SPLASH).toContain('window.location.pathname.startsWith("/tools")');
    expect(SPLASH).toContain('new URLSearchParams(window.location.search).has("booking")');
    expect(SPLASH).toContain("useState(() => !isPublicEntryLocation())");
  });
});

describe("failsafe", () => {
  test("max-display auto-dismiss is ~6s regardless of ready", () => {
    expect(SPLASH).toContain("export const SPLASH_MAX_MS = 6000;");
    expect(SPLASH).toContain("setFailsafeDone(true), SPLASH_MAX_MS");
    expect(SPLASH).toContain("const done = ready || failsafeDone;");
  });
});

describe("assets", () => {
  test("both brand images are copied into client assets and imported", () => {
    expect(existsSync(join(import.meta.dir, "client/src/assets/mascot-peek.webp"))).toBe(true);
    expect(existsSync(join(import.meta.dir, "client/src/assets/crewkat-c-chevron.png"))).toBe(true);
    expect(SPLASH).toContain('import splashCat from "./assets/mascot-peek.webp";');
    expect(SPLASH).toContain('import splashLogo from "./assets/crewkat-c-chevron.png";');
  });

  test("both images exist in the built output and are referenced by the bundle", () => {
    expect(distFiles.some((f) => /^mascot-peek-.+\.webp$/.test(f))).toBe(true);
    expect(distFiles.some((f) => /^crewkat-c-chevron-.+\.png$/.test(f))).toBe(true);
    expect(distJs).toContain("mascot-peek-");
    expect(distJs).toContain("crewkat-c-chevron-");
    expect(distJs).toContain("boot-splash");
    expect(distCss).toContain(".boot-splash");
  });
});

describe("visual build", () => {
  test("navy gradient in the header tokens, z-index 45 (above chrome, below sheets)", () => {
    expect(CSS).toContain(".boot-splash {");
    expect(CSS).toContain("background: linear-gradient(180deg, var(--navy-900), var(--navy-700));");
    expect(CSS).toContain("z-index: 45;");
  });

  test("haze treatment reused at low alpha with the app's orbit keyframes", () => {
    expect(CSS).toContain(".boot-splash-haze {");
    expect(CSS).toContain("animation: haze-drift-a 16s linear infinite;");
    expect(CSS).toContain("animation-name: haze-drift-b; animation-duration: 22s;");
  });

  test("orange arc spinner: 1s linear rotation, three orange sides on a faint track", () => {
    expect(CSS).toContain("animation: boot-splash-spin 1s linear infinite;");
    expect(CSS).toContain("@keyframes boot-splash-spin { to { transform: rotate(360deg); } }");
    expect(CSS).toContain("border: 4px solid rgba(255, 255, 255, .15);");
    expect(CSS).toContain("border-top-color: var(--accent-orange);");
  });

  test("wordmark letterspaced in white; peek cat anchored to the bottom edge", () => {
    expect(SPLASH).toContain('<p className="boot-splash-word">CREWKAT</p>');
    expect(CSS).toContain("letter-spacing: .42em;");
    expect(CSS).toContain(".boot-splash-cat {");
    expect(CSS).toContain("width: min(78vw, 420px);");
    expect(CSS).toContain("bottom: 0;");
  });

  test("cat entrance rise + idle bob; reduced motion disables bob and drift", () => {
    expect(CSS).toContain("@keyframes boot-splash-cat-in {");
    expect(CSS).toContain("@keyframes boot-splash-cat-bob {");
    expect(CSS).toContain("boot-splash-cat-bob 3.4s ease-in-out .7s infinite");
    expect(CSS).toContain(".boot-splash-cat { animation: none; }");
  });
});
