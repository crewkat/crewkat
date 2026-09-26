// One-time migration helper: import blobs from a Hatch worker blob store
// (index.sqlite + content-addressed objects/) into the standalone harness's
// flat blob layout under ${DATA_DIR}/blobs.
//
// Usage:
//   bun scripts/import-worker-blobs.mjs --from /path/to/worker/blobs --data-dir /data
//
// The worker store keeps objects at objects/<first2>/<object_id> with key,
// content_type metadata in index.sqlite. This script writes each blob to
// ${DATA_DIR}/blobs/<key> plus a <key>.meta.json sidecar carrying the
// content type, matching the layout the server harness reads and writes.
//
// Safe to re-run: existing keys are overwritten with identical bytes.

import { createClient } from "@libsql/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const from = argValue("--from");
const dataDir = argValue("--data-dir") || process.env.DATA_DIR || "/data";

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (!from) {
  console.error("Usage: bun scripts/import-worker-blobs.mjs --from <worker blobs dir> [--data-dir /data]");
  process.exit(1);
}

const blobRoot = join(dataDir, "blobs");
await mkdir(blobRoot, { recursive: true });

const index = createClient({ url: `file:${join(from, "index.sqlite")}` });
const rows = (await index.execute("SELECT key, object_id, content_type FROM blobs")).rows;

let imported = 0;
let missing = 0;
for (const row of rows) {
  const key = String(row.key);
  const objectId = String(row.object_id);
  const objectPath = join(from, "objects", objectId.slice(0, 2), objectId);
  let bytes;
  try {
    bytes = await readFile(objectPath);
  } catch {
    console.log(`missing object file for key: ${key}`);
    missing++;
    continue;
  }
  const target = resolve(blobRoot, ...key.split("/"));
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, bytes);
  await writeFile(
    `${target}.meta.json`,
    JSON.stringify({
      contentType: row.content_type || "application/octet-stream",
      size: bytes.length,
      updatedAt: new Date().toISOString(),
    }),
  );
  imported++;
}

console.log(`imported ${imported} blobs into ${blobRoot} (${missing} missing object files)`);
