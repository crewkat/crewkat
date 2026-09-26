# Smoke test report — Crewkat standalone harness

**Date:** 2026-09-26
**Scope:** `~/workspace/crewkat-hosting` (server.mjs + Dockerfile + render.yaml)
**Method:** Ran the harness directly with Bun 1.4.2 against disposable
`/tmp/crewkat-test` data (`DATA_DIR=/tmp/crewkat-test PORT=3123`).
Docker is **not installed** on this machine, so the image was not built or
run here — the container adds Bun 1.3 + `poppler-utils` around the same
harness, and the Dockerfile was validated by review only (flagged below).
All database/blob inputs were **read-only copies** of the live artifact.

## Results

| # | Check | Result |
|---|---|---|
| 1 | Boot on empty volume; drizzle migrations applied (55 files) | ✅ `app.db` created, all tables present |
| 2 | `GET /healthz` | ✅ `{"ok":true,...}` |
| 3 | `GET /` serves client; `GET /assets/*.js` correct MIME | ✅ 200 `text/html`, 200 `text/javascript` |
| 4 | SPA fallback (`GET /jobs/1`) | ✅ 200 `index.html` |
| 5 | `getAuthBootstrap` (public) | ✅ `{hasAccount:false, ownerClaimAvailable:true, counts 0}` |
| 6 | `signUp` → `verifyEmail` → `login` | ✅ session token issued; first account claimed owner/premium |
| 7 | Backup built from read-only copies (mirrors app's own export format: gzip JSON `{format:"crewkat-backup",version:1,tables,blobs}`) | ✅ 55 tables, 51 records, 2 attachments |
| 8 | `restoreBackup` via app action | ✅ `{ok:true, recordCount:51, attachmentCount:2}` |
| 9 | Data counts after restore | ✅ **jobs=3, clients=2, invoices=1** |
| 10 | `listJobs` / `listClients` / `listInvoices` | ✅ 3 / 2 / 1 records returned |
| 11 | `getJob(id=1)` with photos | ✅ job + 2 photo URLs (after blob backfill, #12) |
| 12 | `scripts/import-worker-blobs.mjs` (7 worker blobs → flat layout) | ✅ all imported; `GET /blobs/...` 200 with correct content types (`image/jpeg`, `image/png`) |
| 13 | `renderPdfPreview` (privileged `pdftoppm` handler) | ✅ 1 page rendered from a generated PDF |
| 14 | Session survives restore (auth tables not in backup) | ✅ `getAuthSession` still valid |
| 15 | `getWeatherOutlook` without weather tool | ✅ `{available:false,...}` graceful degradation |
| 16 | Unknown action → 400 `{error}`; malformed JSON → 400 | ✅ |
| 17 | Blob 404, path traversal (`..%2F`) → 400/404 | ✅ |
| 18 | `POST /stripe-webhook` without signature → 400 | ✅ (full Stripe flow needs live keys — not tested) |
| 19 | Live artifact untouched | ✅ `app.db` and `blobs/index.sqlite` mtimes predate this session; only ever copied, never written |

## Findings worth knowing

1. **Backup gap (pre-existing app behavior, not introduced here):** the app's
   `createBackup` only embeds blobs referenced via `*_blob_key` columns.
   Job photos, receipts, and voice notes use `blob_key` and are **not** in
   the `.crewkat` file. The runbook covers this with the
   `import-worker-blobs.mjs` backfill step.
2. **Resend/Stripe are code-complete but unverified live** — no keys exist
   yet. Email fell back to in-app codes; Stripe checkout/webhook need the
   dashboard steps in the runbook.
3. **Dockerfile not executed** — no Docker on this machine. Reviewed for
   correctness (multi-stage, `poppler-utils` install, disk layout matches
   `render.yaml`). Recommend a `docker build` on first use.
4. **Browser/UI behavior not tested** — API-level verification only. Danny
   should tap through the deployed URL on his phone (scroll behavior,
   signing links, PDF preview rendering on device).
5. Stay-logged-in remains unshipped (separate blocked item); session
   behavior here matches the current app.

## Reproduce

```bash
cd ~/workspace/crewkat-hosting
rm -rf /tmp/crewkat-test && mkdir -p /tmp/crewkat-test
DATA_DIR=/tmp/crewkat-test PORT=3123 bun server.mjs
# then: sign up via POST /actions, restore a backup, exercise actions
```
