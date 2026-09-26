# Crewkat standalone hosting

Self-hosted deployment of the **Crewkat** web app (source snapshot in
`app/`) as a standalone Bun server + Docker container, built for migration
to **Render**. The live private web artifact is not modified by anything
here.

## How it works

The app was written against the Hatch worker runtime (`ctx.db`, `ctx.blobs`,
`ctx.executePrivileged`, ...). `server.mjs` re-implements that runtime
context on plain Node/Bun primitives:

- `ctx.db()` → Drizzle ORM over libSQL, `file:${DATA_DIR}/app.db`
  (migrations from `app/drizzle` applied automatically on boot)
- `ctx.blobs` → flat files under `${DATA_DIR}/blobs/<key>` with a
  `.meta.json` content-type sidecar, served at `GET /blobs/<key>`
- `ctx.executePrivileged` → in-process dispatch to the compiled privileged
  handlers (PDF page rendering via `/usr/bin/pdftoppm`, Resend email,
  Stripe checkout + webhook verification), with contract request/response
  validation
- `ctx.emit` / `ctx.invalidateQueries` → no-ops (single instance)
- `ctx.tool.weather` → unavailable (the app already degrades gracefully)

HTTP surface:

| Route | Purpose |
|---|---|
| `POST /actions` | Action dispatch: `{ action, args }` → `{ data }` / `{ error }`, with zod request/response validation like the worker |
| `POST /stripe-webhook` | Stripe events: raw body + `stripe-signature` header → `handleStripeWebhook` |
| `GET /healthz` | Liveness probe |
| `GET /blobs/<key>` | Blob file serving with stored content types |
| `GET /*` | Static React client + SPA fallback to `index.html` |

## Layout

```
server.mjs            # the harness (bun server.mjs)
package.json          # harness deps: drizzle-orm, @libsql/client
Dockerfile            # multi-stage build -> Bun 1.3 + poppler-utils runtime
render.yaml           # Render Blueprint (Starter, 2 GB disk at /data)
app/                  # Crewkat source snapshot (client, server, drizzle)
vendor/space-sdk.tgz  # vendored SDK (Docker builds can't reach Hatch paths)
scripts/              # migration helpers
DEPLOY-RUNBOOK.md     # step-by-step Render deployment (Danny's steps marked)
SMOKE-TEST-REPORT.md  # local verification results
```

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Render injects this |
| `DATA_DIR` | `/data` | Persistent volume root: `app.db` + `blobs/` |
| `CREWKAT_PUBLIC_URL` | — | Public base URL; used for absolute blob links + Stripe return URLs |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | — | Auth email delivery |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_PREMIUM_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | — | Billing |

## Run locally

```bash
cd ~/workspace/crewkat-hosting
bun install
DATA_DIR=/tmp/crewkat-data PORT=3000 bun server.mjs
```

Build the image (needs Docker):

```bash
docker build -t crewkat .
docker run -p 3000:3000 -v crewkat-data:/data crewkat
```

## Rebuilding from a newer app snapshot

1. Re-copy the artifact source into `app/` (excluding `node_modules`,
   `dist/`, `app.db`, `blobs/`).
2. `cd app && bun install && HATCH_SPACES_BUILD_DRIVER=1 bun run build`
   (the env var is the SDK's supported switch for self-hosted builds; the
   live artifact is untouched).
3. Re-run the smoke test, then rebuild the image.
