// Client bundle for the space.
//
// Bundling is owned by the SDK so every space produces an identical
// production-mode React bundle. See @hatch/space-sdk/build for the
// canonical Bun.build() configuration (entrypoint, outdir, NODE_ENV
// define, asset naming, tailwind plugin).

import { buildClient } from "@hatch/space-sdk/build";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

await buildClient();

const here = dirname(fileURLToPath(import.meta.url));

// The app is served from /app (not the domain root). The SDK emits relative
// "./assets/..." URLs, which resolve against the *document* URL: from the
// exact path "/app" (no trailing slash) "./assets/x" resolves to "/assets/x"
// at the domain root, 404ing the JS bundle and leaving a blank white page.
// Rewrite them to absolute "/app/assets/..." so they resolve correctly from
// every URL that serves the app ("/app", "/app/", "/app/index.html", ...).
const distDir = join(here, "dist");
const indexHtmlPath = join(distDir, "index.html");
let html = await readFile(indexHtmlPath, "utf8");
html = html.split('"./assets/').join('"/app/assets/').split("'./assets/").join("'/app/assets/");
await writeFile(indexHtmlPath, html);
const assetFiles = await readdir(join(distDir, "assets"));
for (const file of assetFiles) {
  if (!file.endsWith(".js")) continue;
  const p = join(distDir, "assets", file);
  let text = await readFile(p, "utf8");
  const rewritten = text.split('"./assets/').join('"/app/assets/').split("'./assets/").join("'/app/assets/");
  if (rewritten !== text) {
    await writeFile(p, rewritten);
    console.log(`[build] rewrote ./assets/ -> /app/assets/ in ${file}`);
  }
}
console.log("[build] app asset URLs rewritten to absolute /app/assets/");

// Static marketing site (served at / by server.mjs; the app lives at /app).
// Plain HTML/CSS/JS — no bundling, just copy into dist.
await mkdir(join(here, "dist", "marketing"), { recursive: true });
await cp(join(here, "marketing"), join(here, "dist", "marketing"), { recursive: true });
console.log("[build] marketing site copied to dist/marketing");

// PWA assets for the Play Store TWA wrapper: manifest + icons land at /app/*.
for (const f of ["manifest.webmanifest", "icon-192.png", "icon-512.png"]) {
  await cp(join(here, "pwa", f), join(distDir, f));
}
console.log("[build] PWA manifest + icons copied to dist/");
