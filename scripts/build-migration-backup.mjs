// One-time migration backup builder.
// Builds a complete .crewkat backup from READ-ONLY copies of the live
// workspace DB + blob store, embedding blobs referenced via BOTH
// `*_blob_key` columns AND `blob_key` columns (job photos), so the new
// host gets everything in a single restore with no photo backfill step.
// The live workspace is never modified: inputs are file copies.

import { createClient } from "@libsql/client";
import { copyFile, mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { existsSync } from "node:fs";

const SRC_DB = "/home/hatch/workspace/ts-spaces/tradesign/app.db";
const SRC_BLOBS = "/home/hatch/workspace/ts-spaces/tradesign/blobs";
const WORK = "/tmp/ckmigrate";
const OUT = "/home/hatch/workspace/crewkat-hosting/crewkat-backup-2026-09-26.crewkat";

await mkdir(WORK, { recursive: true });

// Copy DB (+ WAL sidecars so the copy opens consistently) and blob store.
for (const suffix of ["", "-wal", "-shm"]) {
  const src = `${SRC_DB}${suffix}`;
  if (existsSync(src)) await copyFile(src, join(WORK, `live-copy.db${suffix}`));
}
await cp(SRC_BLOBS, join(WORK, "blobs"), { recursive: true });
console.log("copies made");

// Read the exact BACKUP_TABLES list from the app source.
const actionsSrc = await readFile("/home/hatch/workspace/ts-spaces/tradesign/server/src/actions.ts", "utf8");
const listMatch = actionsSrc.match(/const BACKUP_TABLES = \[([\s\S]*?)\] as const;/);
if (!listMatch) throw new Error("BACKUP_TABLES not found in actions.ts");
const tables = [...listMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
console.log(`tables in backup list: ${tables.length}`);

const db = createClient({ url: `file:${join(WORK, "live-copy.db")}` });
const blobIndex = createClient({ url: `file:${join(WORK, "blobs", "index.sqlite")}` });

const payload = { format: "crewkat-backup", version: 1, createdAt: new Date().toISOString(), tables: {}, blobs: {} };

let recordCount = 0;
const blobKeys = new Set();
for (const table of tables) {
  const rows = (await db.execute(`SELECT * FROM "${table}"`)).rows;
  payload.tables[table] = rows;
  recordCount += rows.length;
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if (typeof value !== "string" || !value) continue;
      // App backup covers `*_blob_key`; ALSO cover `blob_key` (job photos,
      // receipts, voice notes) so no separate backfill is needed.
      if (column.endsWith("_blob_key") || column === "blob_key") blobKeys.add(value);
    }
  }
}
console.log(`records: ${recordCount}, referenced blob keys: ${blobKeys.size}`);

let embedded = 0;
for (const key of blobKeys) {
  const row = (await blobIndex.execute({ sql: "SELECT object_id, content_type FROM blobs WHERE key = ?", args: [key] })).rows[0];
  if (!row) {
    console.log(`WARNING: blob key missing from index: ${key}`);
    continue;
  }
  const objectPath = join(WORK, "blobs", "objects", String(row.object_id).slice(0, 2), String(row.object_id));
  let bytes;
  try {
    bytes = await readFile(objectPath);
  } catch {
    console.log(`WARNING: missing object file for key: ${key}`);
    continue;
  }
  payload.blobs[key] = { contentType: row.content_type || "application/octet-stream", dataBase64: bytes.toString("base64") };
  embedded++;
}
console.log(`blob attachments embedded: ${embedded}`);

const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 });
await writeFile(OUT, compressed);
console.log(`wrote ${OUT} (${(compressed.length / 1024 / 1024).toFixed(2)} MB)`);
