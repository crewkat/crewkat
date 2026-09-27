// Client bundle for the space.
//
// Bundling is owned by the SDK so every space produces an identical
// production-mode React bundle. See @hatch/space-sdk/build for the
// canonical Bun.build() configuration (entrypoint, outdir, NODE_ENV
// define, asset naming, tailwind plugin).

import { buildClient } from "@hatch/space-sdk/build";
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

await buildClient();

// Static marketing site (served at / by server.mjs; the app lives at /app).
// Plain HTML/CSS/JS — no bundling, just copy into dist.
const here = dirname(fileURLToPath(import.meta.url));
await mkdir(join(here, "dist", "marketing"), { recursive: true });
await cp(join(here, "marketing"), join(here, "dist", "marketing"), { recursive: true });
console.log("[build] marketing site copied to dist/marketing");
