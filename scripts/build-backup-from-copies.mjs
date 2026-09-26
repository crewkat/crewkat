// TEST/MIGRATION HELPER ONLY - not part of the server.
// Builds a Crewkat backup file from READ-ONLY copies of a Hatch worker's
// app.db + blob store, replicating byte-for-byte what the app's own
// exportBackup action + client-side attachment embedding produce
// (gzip(JSON({ format, version, createdAt, tables, blobs }))).
//
// In production the backup is taken from inside the app UI
// (Settings -> More options -> backup). This script exists so the backup
// step can be performed headlessly during migration testing without
// touching the live artifact: it only reads copies.
//
// Unlike the app's own createBackup, this ALSO embeds blobs referenced via
// `blob_key` columns (job photos, receipts, voice notes, ...). The app's
// backup only includes `*_blob_key` columns; photo blobs are backfilled by
// scripts/import-worker-blobs.mjs during migration (see DEPLOY-RUNBOOK.md).

// Test-only helper: builds a Crewkat backup file from a READ-ONLY copy of the
// live database + blob store, replicating exactly what the app's own
// exportBackup action + client-side attachment embedding produce.
// The live artifact is never touched: inputs are file copies.
import { createClient } from "@libsql/client";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import actionsSource from "node:fs";

const LIVE_DB_COPY = "/tmp/crewkat-test/live-copy.db";
const BLOB_INDEX_COPY = "/tmp/crewkat-test/blob-index-copy.sqlite";
const BLOB_OBJECTS_DIR = "/tmp/crewkat-test/blob-objects";
const OUT = "/tmp/crewkat-test/crewkat-backup-test.crewkat";

// Extract the exact BACKUP_TABLES list from the app source.
const src = actionsSource.readFileSync(
  "/home/hatch/workspace/ts-spaces/tradesign/server/src/actions.ts",
  "utf8",
);
const listMatch = src.match(/const BACKUP_TABLES = \[([\s\S]*?)\] as const;/);
if (!listMatch) throw new Error("BACKUP_TABLES not found in actions.ts");
const tables = [...listMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
console.log(`tables in backup list: ${tables.length}`);

const db = createClient({ url: `file:${LIVE_DB_COPY}` });
const blobIndex = createClient({ url: `file:${BLOB_INDEX_COPY}` });

const payload = {
  format: "crewkat-backup",
  version: 1,
  createdAt: new Date().toISOString(),
  tables: {},
  blobs: {},
};

let recordCount = 0;
const blobKeys = new Set();
for (const table of tables) {
  const rows = (await db.execute(`SELECT * FROM "${table}"`)).rows;
  payload.tables[table] = rows;
  recordCount += rows.length;
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if (column.endsWith("_blob_key") && typeof value === "string" && value) blobKeys.add(value);
    }
  }
}
console.log(`records: ${recordCount}, referenced blob keys: ${blobKeys.size}`);

for (const key of blobKeys) {
  const row = (await blobIndex.execute({ sql: "SELECT object_id, content_type FROM blobs WHERE key = ?", args: [key] })).rows[0];
  if (!row) {
    console.log(`WARNING: blob key missing from index: ${key}`);
    continue;
  }
  const objectPath = join(BLOB_OBJECTS_DIR, String(row.object_id).slice(0, 2), String(row.object_id));
  const bytes = await readFile(objectPath);
  payload.blobs[key] = { contentType: row.content_type || "application/octet-stream", dataBase64: bytes.toString("base64") };
}
console.log(`blob attachments embedded: ${Object.keys(payload.blobs).length}`);

const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 });
await writeFile(OUT, compressed);
console.log(`wrote ${OUT} (${compressed.length} bytes)`);
