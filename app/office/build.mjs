// Office desktop client bundle.
//
// The SDK's buildClient() cannot target this directory: it hardcodes
// ENTRY="./client/index.html" and OUTDIR="./client/dist" relative to the
// process cwd (see node_modules/@hatch/space-sdk/dist/build.js — the options
// argument is ignored), so running it from app/office would look for
// office/client/index.html. This script therefore replicates the SDK's
// Bun.build configuration verbatim (same naming, NODE_ENV define, tailwind
// plugin, and bare-asset re-prefixing) with office entry/outdir paths.

import { rm, readFile, writeFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindPlugin from "bun-plugin-tailwind";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "dist");

if (typeof Bun === "undefined" || typeof Bun.build !== "function") {
  throw new Error("office build must run under Bun");
}

await rm(distDir, { force: true, recursive: true });
const result = await Bun.build({
  entrypoints: [join(here, "index.html")],
  outdir: distDir,
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  naming: {
    asset: "assets/[name]-[hash].[ext]",
    chunk: "assets/[name]-[hash].[ext]",
    entry: "[name].[ext]",
  },
  plugins: [tailwindPlugin],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("office build failed; see logged diagnostics");
}

// Same fix-up as the SDK: Bun emits imported-asset URLs as bare
// "./<name>-<hash>.<ext>"; re-prefix them to "./assets/...".
const assetFiles = result.outputs
  .filter((output) => output.kind === "asset")
  .map((output) => basename(output.path));
if (assetFiles.length > 0) {
  for (const output of result.outputs) {
    if (!/\.(js|css|html)$/.test(output.path)) continue;
    let text = await output.text();
    let changed = false;
    for (const name of assetFiles) {
      const bare = `./${name}`;
      if (text.includes(bare)) {
        text = text.split(bare).join(`./assets/${name}`);
        changed = true;
      }
    }
    if (changed) await Bun.write(output.path, text);
  }
}

// Office is served from /office (not the domain root). Rewrite relative
// "./assets/..." URLs to absolute "/office/assets/..." so they resolve from
// every URL that serves the app ("/office", "/office/", "/office/index.html").
const indexHtmlPath = join(distDir, "index.html");
let html = await readFile(indexHtmlPath, "utf8");
html = html.split('"./assets/').join('"/office/assets/').split("'./assets/").join("'/office/assets/");
await writeFile(indexHtmlPath, html);
const distAssets = await readdir(join(distDir, "assets"));
for (const file of distAssets) {
  if (!file.endsWith(".js")) continue;
  const p = join(distDir, "assets", file);
  const text = await readFile(p, "utf8");
  const rewritten = text.split('"./assets/').join('"/office/assets/').split("'./assets/").join("'/office/assets/");
  if (rewritten !== text) {
    await writeFile(p, rewritten);
    console.log(`[office build] rewrote ./assets/ -> /office/assets/ in ${file}`);
  }
}
console.log("[office build] done -> office/dist");
