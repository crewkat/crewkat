# Crewkat → Render: deployment runbook

**Status: engineering complete, awaiting Danny.** Nothing here is provisioned
yet. No Render account exists, no money has been spent, and the live private
app is untouched.

**Cost (approved 2026-09-26):** Starter web service ~$7/mo + 2 GB persistent
disk ~$0.50/mo ≈ **$7.50/mo**.

---

## 0. What was built

Repo: `~/workspace/crewkat-hosting/`

| File | Purpose |
|---|---|
| `server.mjs` | Standalone Bun server: serves the React client, dispatches all 180 app actions over `POST /actions`, implements `ctx.db` (Drizzle/libSQL), `ctx.blobs` (filesystem), and `ctx.executePrivileged` (in-process PDF/Resend/Stripe handlers), plus `/healthz`, `/stripe-webhook`, `/blobs/*`, static + SPA fallback |
| `Dockerfile` | Multi-stage: builds server + client from `app/`, runtime is Bun 1.3 + `poppler-utils` (`pdftoppm`) |
| `render.yaml` | Render Blueprint: Starter web service, Docker runtime, 2 GB disk at `/data`, `/healthz` check, 1 instance (SQLite requirement), 7 secrets marked `sync: false` (entered in dashboard, never committed) |
| `app/` | Snapshot of the Crewkat source (client, server, drizzle migrations) used to build the image. The live artifact is **not** modified by this. |
| `vendor/space-sdk.tgz` | Vendored SDK so the Docker build doesn't depend on Hatch-internal paths |
| `scripts/import-worker-blobs.mjs` | One-time migration helper: converts the worker's blob store to the flat layout |
| `scripts/build-backup-from-copies.mjs` | Test helper: builds a backup file from read-only DB/blob copies |
| `SMOKE-TEST-REPORT.md` | Local verification results (2026-09-26) |

---

## 1. Danny's steps — Render account & service

1. Go to **render.com** and create an account (Danny's step — account creation
   needs him).
2. **New → Blueprint**, connect the Git repo containing this folder
   (the repo needs to be pushed to GitHub/GitLab first — whoever does that
   step, Danny or his agent, pushes `~/workspace/crewkat-hosting/`).
3. Render reads `render.yaml`. Confirm:
   - Service **crewkat**, plan **Starter**, runtime **Docker**
   - Persistent disk **crewkat-data**, **2 GB**, mounted at **`/data`**
   - Health check path **`/healthz`**
4. Approve the charges (~$7.50/mo total). **Nothing is billed before this.**

## 2. Environment variables (Danny enters these in the Render dashboard)

Render will prompt for the `sync: false` keys. Enter real values; leave
`CREWKAT_PUBLIC_URL` as the temporary URL first:

| Key | Value |
|---|---|
| `RESEND_API_KEY` | (Danny's Resend key — email verification codes) |
| `RESEND_FROM_EMAIL` | e.g. `Crewkat <noreply@crewkat.com>` (must be a verified Resend sender/domain) |
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_...` |
| `STRIPE_PREMIUM_PRICE_ID` | price for the Premium subscription |
| `STRIPE_WEBHOOK_SECRET` | created in step 5 below |
| `CREWKAT_PUBLIC_URL` | `https://<service>.onrender.com` for now |
| `SESSION_IP_SALT` | random string (e.g. `openssl rand -hex 32`) — salts the IP hashes stored on session rows (theft-detection signal only) |

## 3. First deploy & data migration

1. Deploy. Wait for **Live** (health check `/healthz` passes; migrations run
   automatically on boot against `/data/app.db`).
2. Open the temporary `https://<service>.onrender.com` URL.
3. **Sign up** for the owner account (same email as the live app), verify the
   code (arrives by Resend email once keys are set; shows in-app as a fallback
   until then), and log in.
4. **Take a backup from the live private app:** Settings → More options →
   backup. Save the downloaded `.crewkat` file.
5. **Restore on the new host:** same screen → "Restore from backup" → choose
   the file → confirm. Wait for the success notice.
6. **Verify:** Jobs = **3**, Clients = **2**, Invoices = **1**. Open a job,
   check photos load, open an invoice PDF preview.
7. **Blob backfill (agent-assisted):** the app's backup only embeds blobs
   referenced via `*_blob_key` columns; job photos use `blob_key` and need a
   backfill. During migration, your agent copies the worker blob store and
   runs:
   `bun scripts/import-worker-blobs.mjs --from <worker blobs dir> --data-dir /data`
   (runs once against the Render disk via a shell/console session or during a
   maintenance deploy). Then re-check job photos.

## 4. Email (Resend)

1. In Resend: add and verify **crewkat.com** (or use a verified sender until
   DNS is cut over).
2. Put the key + from-address in Render env vars (step 2), redeploy.
3. Test: sign up a second test account — the 6-digit code must arrive by
   email (not just in-app fallback).

## 5. Billing (Stripe)

1. Create the Premium product/price in the Stripe dashboard.
2. Register the webhook endpoint:
   `https://<service>.onrender.com/stripe-webhook`
   listening to `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
3. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`, set the other
   Stripe keys + price ID, redeploy.
4. Test checkout end-to-end with a test clock/card before going live.

## 6. DNS cutover (after everything above passes)

1. In Render: **Settings → Custom Domains** → add `crewkat.com` and `www.crewkat.com`.
   Render will show the exact DNS targets (do **not** guess them).
2. In **GoDaddy** (Danny's step): add the records exactly as Render specifies.
3. Wait for Render to issue HTTPS certificates (automatic).
4. Set `CREWKAT_PUBLIC_URL=https://crewkat.com` in Render env vars, redeploy.
5. In Stripe: update the webhook URL to `https://crewkat.com/stripe-webhook`
   and rotate `STRIPE_WEBHOOK_SECRET`.
6. Verify `https://crewkat.com` and `https://www.crewkat.com` load, log in,
   and show the data.

## 7. Pre-launch QA checklist

- [ ] Login + email verification code arrives by real email
- [ ] Jobs (3), clients (2), invoices (1) present; job photos load
- [ ] Invoice/estimate PDF preview renders (uses `pdftoppm`)
- [ ] Client signing links open, sign, and revoke correctly
- [ ] Free vs Premium gates behave (Pro tools locked on free tier)
- [ ] Stripe checkout upgrades a test account to Premium
- [ ] Terms & Privacy pages load
- [ ] Backup downloads and restores on the new host
- [ ] Old private artifact stays untouched until Danny says to retire it

## 8. Known limitations / honest notes

- **Secure persistent login (shipped 2026-09-27)** — sign-in issues a
  15-minute in-memory session proof plus a 30-day rotating refresh token in
  an HttpOnly cookie (`__Host-crewkat_rt` in production, `Secure; SameSite=Lax`).
  Reusing a rotated token revokes the whole token family and emails the
  account a security alert. Old 30-day localStorage sessions keep working
  during the transition (dual-mode). **After deploy, Danny should sign out
  and back in once on each device** so the new cookie is set.
- **Automated backups are built in (2026-09-27)** — the server takes a
  daily `VACUUM INTO` snapshot and a Sunday weekly `tar.gz` (DB + blobs),
  keeps 7 daily / 4 weekly on the disk, and emails copies offsite through
  Resend. Status and a "Back up now" button live in Settings → Backup &
  restore. The manual `.crewkat` download below is still useful before risky
  changes.
- **Single instance only** — SQLite can't scale horizontally; the Blueprint
  pins `numInstances: 1`.
- **Play Store app comes after** the web app is live and stable (Danny's
  plan); Danny creates the Google Play developer account ($25 one-time) in
  the meantime.
- **At public launch, resurface**
  `~/workspace/goals/tradesign-side-business/files/post-launch-roadmap.md`.
- **Portal share-link hardening (shipped 2026-09-27)** — client portal links
  now expire (90 days by default; owner can pick 30/90/365 days or "never"),
  every view/approval/rejection/signature is logged with a timestamp, and
  portal endpoints are rate-limited (30 req/min per IP, 120 req/min per
  token). Pre-existing links were grandfathered to 180 days from creation so
  nothing broke. The job's Client portal panel shows link hint, expiry, view
  count, and last-viewed, with **Rotate** (revoke + reissue in one tap) and
  **Revoke** buttons.

### 8b. Leaked portal link — response playbook

1. A leaked link works until it expires or is revoked — bearer links can't
   be "unseen". Bounding it is what expiry is for.
2. **Rotate immediately**: open the job → Client portal panel → **Rotate**.
   The old token dies instantly (hash lookup fails); you get a fresh link.
   (Or **Revoke** if the client doesn't need portal access anymore.)
3. **Check what the leaked token did**: `portal_link_events` rows for the old
   link id show every view, approval, rejection, and signature with
   timestamps and user agents — the audit trail for incident response.
4. A database leak alone does not expose usable tokens: only SHA-256 hashes
   of 256-bit random values are stored, which are not reversible.

## 9. Rollback

The live private artifact is untouched by this migration. If anything fails,
keep using it — nothing is deleted or changed there. The Render service can
be suspended from the dashboard; the disk retains `/data` until deleted.

## 10. Disaster recovery — restoring from an automated backup

Automated backups run on the server itself: a daily `VACUUM INTO` snapshot
(`/data/backups/app-YYYYMMDD-HHmmss-<rand>.db`, 7 kept) and a Sunday weekly
`tar.gz` of the snapshot plus `/data/blobs` (`crewkat-full-*.tar.gz`, 4
kept). Copies are also emailed offsite through Resend. `/data/backups` is
**not** served over HTTP.

**Full restore (disk corrupted or data destroyed):**

1. In Render: suspend the Crewkat service (or scale to 0) so nothing writes
   to the database.
2. Open a Render shell (or SSH) on the service with the disk attached.
3. Pick the newest good weekly archive, or the newest daily snapshot:
   `ls -lt /data/backups`.
4. If using the weekly archive: `mkdir -p /tmp/restore && tar -xzf
   /data/backups/crewkat-full-<stamp>.tar.gz -C /tmp/restore`.
5. Verify the snapshot before touching the live DB:
   `sqlite3 /tmp/restore/app-<stamp>-*.db "PRAGMA integrity_check;"`
   must print `ok`.
6. Sanity-check row counts, e.g.
   `sqlite3 /tmp/restore/app-<stamp>-*.db "SELECT count(*) FROM jobs;"`
   and compare with expectations.
7. Copy the verified snapshot over the live database:
   `cp /tmp/restore/app-<stamp>-*.db /data/app.db` (fill in the exact snapshot filename).
8. If restoring from the weekly archive, restore blobs too:
   `cp -r /tmp/restore/blobs/. /data/blobs/`.
9. Resume the service and verify: log in, check jobs/clients/invoices and
   that job photos load.

**Table-level restore (one table clobbered, rest of DB fine):**

1. Suspend the service.
2. Extract the newest good weekly archive to `/tmp/restore` as above.
3. Dump just the table from the snapshot:
   `sqlite3 /tmp/restore/app-<stamp>-*.db ".dump jobs" > /tmp/jobs.sql`
4. On a copy of the live DB, drop the damaged table, import the dump, and
   run `PRAGMA integrity_check;`.
5. Swap the repaired copy into `/data/app.db` and resume the service.

**Restore from the emailed offsite copy:** download the attachment from the
`[Crewkat backup]` email, then follow the same verify → copy steps above.

The scheduler also runs a monthly automated restore test (extracts the
latest weekly archive into `/tmp`, checks integrity, row counts, and 5
random blob keys) and logs it in the `backup_runs` table — visible in
Settings → Backup & restore. Failure alerts go to `BACKUP_ALERT_EMAIL`.
