// Crewkat standalone server harness.
//
// Runs the compiled Crewkat action bundle (built from the private web
// artifact's server source) as a plain HTTP server, without any Hatch
// worker/daemon infrastructure. Implements the runtime context the actions
// expect:
//
//   ctx.db()              -> Drizzle/libSQL over file:${DATA_DIR}/app.db
//   ctx.blobs             -> local filesystem blob store under ${DATA_DIR}/blobs
//   ctx.executePrivileged -> in-process dispatch to the compiled privileged
//                            handlers (PDF rendering, Resend email, Stripe)
//   ctx.emit / ctx.invalidateQueries -> no-ops (single instance)
//   ctx.tool.weather      -> unavailable (the app already treats this as
//                            optional and degrades gracefully)
//
// Routes:
//   POST /actions          -> action dispatch ({ action, args })
//   POST /stripe-webhook   -> Stripe event ingestion (raw body + signature)
//   GET  /healthz          -> liveness probe for the hosting platform
//   GET  /blobs/<key>     -> blob file serving
//   GET  /*               -> marketing site at /, app bundle at /app/*
//
// Environment:
//   PORT                 HTTP port (Render injects this). Default 3000.
//   DATA_DIR             persistent volume root. Default /data.
//                        Database: ${DATA_DIR}/app.db
//                        Blobs:     ${DATA_DIR}/blobs
//   CREWKAT_PUBLIC_URL   public base URL (https://crewkat.com). Used for
//                        Stripe checkout return URLs and absolute blob links
//                        when available.
//   RESEND_API_KEY / RESEND_FROM_EMAIL
//   STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY / STRIPE_PREMIUM_PRICE_ID /
//   STRIPE_WEBHOOK_SECRET
//                        consumed by the privileged handlers (email, billing).

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "/data";
const DB_PATH = join(DATA_DIR, "app.db");
const BLOB_ROOT = join(DATA_DIR, "blobs");
const PUBLIC_URL = (process.env.CREWKAT_PUBLIC_URL || "").replace(/\/+$/, "");
const APP_DIR = new URL("./app/", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Local filesystem blob store (ctx.blobs compatible)
// ---------------------------------------------------------------------------

function safeBlobPath(key) {
  if (typeof key !== "string" || !key || key.length > 512) {
    throw new Error("Invalid blob key.");
  }
  const parts = key.split("/").map((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      decoded = segment;
    }
    if (!decoded || decoded === "." || decoded === "..") throw new Error("Invalid blob key.");
    return decoded;
  });
  const resolved = resolve(BLOB_ROOT, ...parts);
  if (resolved !== BLOB_ROOT && !resolved.startsWith(BLOB_ROOT + sep)) {
    throw new Error("Invalid blob key.");
  }
  return resolved;
}

const metaPathFor = (filePath) => `${filePath}.meta.json`;

const blobs = {
  async put(key, data, options = {}) {
    const filePath = safeBlobPath(key);
    await mkdir(join(filePath, ".."), { recursive: true });
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await writeFile(filePath, bytes);
    await writeFile(
      metaPathFor(filePath),
      JSON.stringify({
        contentType: options.contentType || "application/octet-stream",
        size: bytes.length,
        updatedAt: new Date().toISOString(),
      }),
    );
  },

  async getUrl(key) {
    const filePath = safeBlobPath(key);
    try {
      await stat(filePath);
    } catch {
      throw new Error(`ctx.blobs key not found: ${key}`);
    }
    const encoded = key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    if (PUBLIC_URL) return `${PUBLIC_URL}/blobs/${encoded}`;
    return `/blobs/${encoded}`;
  },

  async get(key) {
    return readFile(safeBlobPath(key));
  },

  async delete(key) {
    const filePath = safeBlobPath(key);
    await rm(filePath, { force: true });
    await rm(metaPathFor(filePath), { force: true });
  },

  async head(key) {
    const filePath = safeBlobPath(key);
    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      return null;
    }
    let meta = null;
    try {
      meta = JSON.parse(await readFile(metaPathFor(filePath), "utf8"));
    } catch {
      meta = null;
    }
    return {
      contentType: meta?.contentType || "application/octet-stream",
      size: fileStat.size,
      updatedAt: meta?.updatedAt || fileStat.mtime.toISOString(),
    };
  },

  async list(prefix = "") {
    const results = [];
    async function walk(dir, relative) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(join(dir, entry.name), rel);
        } else if (!entry.name.endsWith(".meta.json")) {
          if (!prefix || rel.startsWith(prefix)) results.push(rel);
        }
      }
    }
    await walk(BLOB_ROOT, "");
    return results;
  },
};

// ---------------------------------------------------------------------------
// Boot: database, migrations, action bundles
// ---------------------------------------------------------------------------

const { Actions, runScheduledBackup, recoverStaleBackupRuns, runRecurringInvoiceTick, runEstimateNudgeTick, runReviewRequestTick, runWeeklyProgressTick } = await import(join(APP_DIR, "server/dist/actions.js"));
const privilegedBundle = await import(join(APP_DIR, "server/dist/privileged.js"));
const privilegedHandlers = privilegedBundle.privilegedHandlers;

await mkdir(DATA_DIR, { recursive: true });
await mkdir(BLOB_ROOT, { recursive: true });

const libsql = createClient({ url: `file:${DB_PATH}` });
await libsql.execute("PRAGMA journal_mode = WAL");
await libsql.execute("PRAGMA foreign_keys = ON");
const db = drizzle(libsql);

console.log(`[crewkat] applying migrations from ${join(APP_DIR, "drizzle")} ...`);
await migrate(db, { migrationsFolder: join(APP_DIR, "drizzle") });
console.log("[crewkat] migrations applied.");

// ---------------------------------------------------------------------------
// Runtime context
// ---------------------------------------------------------------------------

function executePrivileged(contract, args) {
  const entry = privilegedHandlers.entries.find(
    (candidate) => candidate.contract?.name === contract?.name,
  );
  if (!entry) throw new Error(`Unknown privileged contract: ${contract?.name}`);
  const validatedArgs = entry.contract.request.parse(args);
  return Promise.resolve(entry.handler(validatedArgs)).then((result) =>
    entry.contract.response.parse(result),
  );
}

function makeCtx(reqMeta) {
  return {
    slug: "tradesign",
    invocationId: randomUUID(),
    spaceDir: DATA_DIR,
    db: () => db,
    blobs,
    executePrivileged,
    // Secure persistent login metadata (attached by the /actions handler):
    // refreshToken = raw refresh token from the HttpOnly cookie, if present.
    refreshToken: reqMeta?.refreshToken,
    userAgent: reqMeta?.userAgent,
    ipHash: reqMeta?.ipHash,
    isProdCookie: reqMeta?.isProdCookie,
    // Portal rate limiting: best-effort client IP (x-forwarded-for first entry).
    clientIp: reqMeta?.clientIp,
    agent: {
      run: async () => {
        throw new Error("Agent runtime is unavailable in standalone mode.");
      },
    },
    inference: {
      complete: async () => {
        throw new Error("Inference is unavailable in standalone mode.");
      },
    },
    tool: {
      weather: async () => {
        throw new Error("Weather lookup is unavailable in standalone mode.");
      },
    },
    emit: () => {},
    invalidateQueries: () => {},
  };
}

async function dispatchAction(name, args, reqMeta) {
  const action = Actions[name];
  if (!action) {
    const error = new Error(`Unknown action: ${name}`);
    error.status = 400;
    throw error;
  }
  const parsedArgs = action.request.safeParse(args ?? {});
  if (!parsedArgs.success) {
    const error = new Error("Invalid request for this action.");
    error.status = 400;
    throw error;
  }
  let result;
  try {
    result = await action.handler(makeCtx(reqMeta), parsedArgs.data);
  } catch (handlerError) {
    // The client surfaces body.error for action failures; keep HTTP 200 so
    // the transport treats it as a completed action call.
    return { status: 200, body: { error: handlerError?.message || "Action failed." } };
  }
  const parsedResult = action.response.safeParse(result);
  if (!parsedResult.success) {
    console.error(`[crewkat] action ${name} returned an invalid response:`, parsedResult.error.message);
    return { status: 200, body: { error: "The server returned an unexpected result." } };
  }
  return { status: 200, body: { data: parsedResult.data } };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name && !(name in out)) out[name] = value;
  }
  return out;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "";
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
}

// CSRF guard for POST /actions: browser requests must be same-origin. Clients
// without Origin/Referer (curl, tests, native apps) pass through.
function sameOriginRequest(req) {
  const host = req.headers.host;
  if (!host) return false;
  const hostLower = host.toLowerCase();
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (!origin && !referer) return true;
  const matchesHost = (value) => {
    try {
      return new URL(value).host.toLowerCase() === hostLower;
    } catch {
      return false;
    }
  };
  if (origin) return matchesHost(origin);
  return matchesHost(referer);
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};

function mimeFor(filePath) {
  const dot = filePath.lastIndexOf(".");
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
  return MIME_TYPES[ext] || "application/octet-stream";
}

function jsonResponse(res, status, body, setCookies) {
  const payload = JSON.stringify(body);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "x-content-type-options": "nosniff",
  };
  if (setCookies && setCookies.length) headers["set-cookie"] = setCookies;
  res.writeHead(status, headers);
  res.end(payload);
}

async function readBody(req, { raw = false } = {}) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  return raw ? buffer.toString("utf8") : buffer;
}

const CLIENT_DIST = join(APP_DIR, "client/dist");

const MARKETING_DIST = join(CLIENT_DIST, "marketing");

async function sendFile(res, filePath) {
  const bytes = await readFile(filePath);
  res.writeHead(200, {
    "content-type": mimeFor(filePath),
    "content-length": bytes.length,
    "x-content-type-options": "nosniff",
  });
  res.end(bytes);
}

function safeJoin(root, relative) {
  const filePath = resolve(root, `.${relative}`);
  if (filePath !== root && !filePath.startsWith(root + sep)) return null;
  return filePath;
}

async function serveStatic(res, urlPath) {
  // Marketing site at / ; the app lives at /app.
  if (urlPath === "/" || urlPath === "") {
    return sendFile(res, join(MARKETING_DIST, "index.html"));
  }
  if (urlPath === "/privacy" || urlPath === "/privacy/") {
    return sendFile(res, join(MARKETING_DIST, "privacy.html"));
  }
  // Crawler + browser well-known files live at the root.
  if (urlPath === "/robots.txt" || urlPath === "/sitemap.xml" || urlPath === "/favicon.ico") {
    const name = urlPath === "/favicon.ico" ? "favicon.png" : urlPath.slice(1);
    return sendFile(res, join(MARKETING_DIST, name));
  }
  // Digital Asset Links for the Play Store TWA (Trusted Web Activity).
  // Must be served with Content-Type: application/json.
  if (urlPath === "/.well-known/assetlinks.json") {
    const bytes = await readFile(join(MARKETING_DIST, ".well-known", "assetlinks.json"));
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": bytes.length,
      "cache-control": "public, max-age=3600",
    });
    res.end(bytes);
    return;
  }
  // Public calculator funnel pages (/tools, /tools/<slug>): shareable no-login
  // pages rendered by the app bundle's public tools screen.
  if (urlPath === "/tools" || urlPath === "/tools/" || urlPath.startsWith("/tools/")) {
    return sendFile(res, join(CLIENT_DIST, "index.html"));
  }
  if (urlPath === "/app" || urlPath.startsWith("/app/")) {
    const relative = urlPath === "/app" ? "/index.html" : urlPath.slice(4) || "/index.html";
    // Known PWA files that must 404 instead of falling through to the SPA shell.
    const KNOWN_PWA_STATIC = new Set(["/manifest.webmanifest", "/sw.js", "/icon-180.png", "/icon-192.png", "/icon-512.png"]);
    const filePath = safeJoin(CLIENT_DIST, relative);
    if (!filePath) {
      res.writeHead(403);
      res.end();
      return;
    }
    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      fileStat = null;
    }
    if (!fileStat || !fileStat.isFile()) {
      // SPA fallback: client-side routes resolve to the app index. A missing
      // file under /app/assets/ is a genuine 404 so broken asset URLs fail loudly.
      // Chunk D: same for the known PWA files — a missing manifest, service
      // worker, or icon must never serve HTML by accident.
      if (relative.startsWith("/assets/") || KNOWN_PWA_STATIC.has(relative)) {
        res.writeHead(404, { "x-content-type-options": "nosniff" });
        res.end();
        return;
      }
      return sendFile(res, join(CLIENT_DIST, "index.html"));
    }
    return sendFile(res, filePath);
  }
  if (urlPath.startsWith("/marketing/")) {
    const filePath = safeJoin(MARKETING_DIST, urlPath.slice(10) || "/index.html");
    if (!filePath) {
      res.writeHead(403);
      res.end();
      return;
    }
    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      fileStat = null;
    }
    if (fileStat && fileStat.isFile()) return sendFile(res, filePath);
    res.writeHead(404, { "x-content-type-options": "nosniff" });
    res.end();
    return;
  }
  // Unknown paths fall back to the marketing site.
  return sendFile(res, join(MARKETING_DIST, "index.html"));
}

async function serveBlob(res, urlPath) {
  const encodedKey = urlPath.slice("/blobs/".length);
  if (!encodedKey) {
    res.writeHead(400);
    res.end();
    return;
  }
  let filePath;
  try {
    filePath = safeBlobPath(encodedKey);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch {
    res.writeHead(404, { "x-content-type-options": "nosniff" });
    res.end();
    return;
  }
  let contentType = mimeFor(filePath);
  try {
    const meta = JSON.parse(await readFile(metaPathFor(filePath), "utf8"));
    if (meta?.contentType) contentType = meta.contentType;
  } catch {
    // fall back to extension-based type
  }
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": bytes.length,
    "cache-control": "public, max-age=3600",
    "x-content-type-options": "nosniff",
  });
  res.end(bytes);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/healthz") {
      jsonResponse(res, 200, { ok: true, time: new Date().toISOString() });
      return;
    }

    if (path === "/actions" && req.method === "POST") {
      // CSRF guard: browser POSTs must be same-origin (Origin/Referer check).
      if (!sameOriginRequest(req)) {
        jsonResponse(res, 403, { error: "Cross-origin requests are not allowed." });
        return;
      }
      let payload;
      try {
        payload = JSON.parse((await readBody(req, { raw: true })) || "{}");
      } catch {
        jsonResponse(res, 400, { error: "Request body must be JSON." });
        return;
      }
      try {
        const cookies = parseCookies(req.headers.cookie);
        const refreshToken = cookies["__Host-crewkat_rt"] || cookies["crewkat_rt"];
        const ipSalt = process.env.SESSION_IP_SALT?.trim();
        const reqMeta = {
          refreshToken,
          userAgent: req.headers["user-agent"] ?? "",
          ipHash: ipSalt ? await sha256Hex(`${ipSalt}:${clientIp(req)}`) : "",
          clientIp: clientIp(req),
          // NOTE: read here (unbundled runtime), not in actions.ts — bun build
          // inlines process.env.NODE_ENV at build time.
          isProdCookie: process.env.NODE_ENV === "production",
        };
        const { status, body } = await dispatchAction(payload.action, payload.args, reqMeta);
        const rawSetCookies = body?.data && Array.isArray(body.data.setCookies) ? body.data.setCookies : undefined;
        if (rawSetCookies) {
          // Redact refresh-token values from the JSON body: the client only
          // needs to know THAT a cookie was set, never the secret itself.
          // The real values travel solely via the HttpOnly Set-Cookie header.
          body.data.setCookies = rawSetCookies.map((c) => String(c).replace(/=[^;]*/, "=<redacted>"));
        }
        jsonResponse(res, status, body, rawSetCookies);
      } catch (error) {
        jsonResponse(res, error.status || 500, { error: error.message || "Action failed." });
      }
      return;
    }

    if (path === "/stripe-webhook" && req.method === "POST") {
      const payload = await readBody(req, { raw: true });
      const signature = req.headers["stripe-signature"];
      if (!signature) {
        jsonResponse(res, 400, { error: "Missing Stripe signature." });
        return;
      }
      try {
        const { status, body } = await dispatchAction("handleStripeWebhook", { payload, signature });
        jsonResponse(res, status === 200 && body.error ? 400 : status, body);
      } catch (error) {
        jsonResponse(res, error.status || 500, { error: error.message || "Webhook failed." });
      }
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && path.startsWith("/blobs/")) {
      if (req.method === "HEAD") {
        const encodedKey = path.slice("/blobs/".length);
        try {
          const metadata = await blobs.head(encodedKey);
          if (!metadata) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, {
            "content-type": metadata.contentType,
            "content-length": metadata.size,
            "x-content-type-options": "nosniff",
          });
          res.end();
        } catch {
          res.writeHead(400);
          res.end();
        }
        return;
      }
      await serveBlob(res, path);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(res, path);
      return;
    }

    res.writeHead(404, { "x-content-type-options": "nosniff" });
    res.end();
  } catch (error) {
    console.error("[crewkat] request failed:", error);
    try {
      jsonResponse(res, 500, { error: "Internal server error." });
    } catch {
      // response already started
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[crewkat] listening on 0.0.0.0:${PORT} (data: ${DATA_DIR})`);
});

// ---------------------------------------------------------------------------
// Automated backups: in-process scheduler (single Render instance)
// ---------------------------------------------------------------------------

try {
  const stale = await recoverStaleBackupRuns(makeCtx());
  if (stale > 0) console.log(`[crewkat][backup] marked ${stale} stale backup run(s) as failed.`);
} catch (error) {
  console.error("[crewkat][backup] startup recovery failed:", error);
}

if (!process.env.BACKUP_ALERT_EMAIL) {
  console.error("[crewkat][backup] BACKUP_ALERT_EMAIL is not set — automated backups will not run. Set it in the Render env vars.");
} else {
  const BACKUP_TICK_MS = 5 * 60 * 1000;
  const tick = async () => {
    try {
      const result = await runScheduledBackup(makeCtx());
      if (result.ran) console.log(`[crewkat][backup] ${result.kind} run finished (ok=${result.ok}).`);
    } catch (error) {
      console.error("[crewkat][backup] scheduled run errored:", error);
    }
  };
  setTimeout(tick, 60 * 1000); // catch up shortly after boot in case the hour already passed
  setInterval(tick, BACKUP_TICK_MS).unref();
  console.log(`[crewkat][backup] scheduler armed (hour ${process.env.BACKUP_HOUR || "3"} UTC, tick every ${BACKUP_TICK_MS / 60000} min).`);
}

// ---------------------------------------------------------------------------
// Recurring invoices: in-process scheduler (single Render instance)
// ---------------------------------------------------------------------------
// Independent of the backup scheduler (not gated on BACKUP_ALERT_EMAIL).
// Ticks every 30 minutes; the tick itself only generates for schedules whose
// next_run_date is due, so frequent ticks are cheap and safe.

{
  const RECURRING_TICK_MS = 30 * 60 * 1000;
  const tick = async () => {
    try {
      const result = await runRecurringInvoiceTick(makeCtx());
      if (result.ran) console.log(`[crewkat][recurring] generated invoice(s): ${result.generated.join(", ")}.`);
    } catch (error) {
      console.error("[crewkat][recurring] scheduled run errored:", error);
    }
  };
  setTimeout(tick, 2 * 60 * 1000); // catch up shortly after boot
  setInterval(tick, RECURRING_TICK_MS).unref();
  console.log(`[crewkat][recurring] scheduler armed (tick every ${RECURRING_TICK_MS / 60000} min).`);
}

// ---------------------------------------------------------------------------
// Estimate nudge: in-process scheduler (single Render instance)
// ---------------------------------------------------------------------------
// Ticks hourly; the tick itself only nudges quotes that were sent, viewed,
// and unanswered for 3+ days, exactly once each, so hourly ticks are cheap.

{
  const NUDGE_TICK_MS = 60 * 60 * 1000;
  const tick = async () => {
    try {
      const result = await runEstimateNudgeTick(makeCtx());
      if (result.ran) console.log(`[crewkat][nudge] sent reminder(s) for quote(s): ${result.nudged.join(", ")}.`);
    } catch (error) {
      console.error("[crewkat][nudge] scheduled run errored:", error);
    }
  };
  setTimeout(tick, 5 * 60 * 1000); // catch up shortly after boot
  setInterval(tick, NUDGE_TICK_MS).unref();
  console.log(`[crewkat][nudge] scheduler armed (tick every ${NUDGE_TICK_MS / 60000} min).`);
}

// ---------------------------------------------------------------------------
// Review requests: in-process scheduler (single Render instance)
// ---------------------------------------------------------------------------
// Ticks hourly; the tick only emails jobs completed reviewRequestDelayDays+
// ago (Settings), with review requests enabled and a review URL set, exactly
// once per job (automation_logs kind "review"), so hourly ticks are cheap.

{
  const REVIEWS_TICK_MS = 60 * 60 * 1000;
  const tick = async () => {
    try {
      const result = await runReviewRequestTick(makeCtx());
      if (result.ran) console.log(`[crewkat][reviews] sent review request(s) for job(s): ${result.emailed.join(", ")}.`);
    } catch (error) {
      console.error("[crewkat][reviews] scheduled run errored:", error);
    }
  };
  setTimeout(tick, 6 * 60 * 1000); // catch up shortly after boot
  setInterval(tick, REVIEWS_TICK_MS).unref();
  console.log(`[crewkat][reviews] scheduler armed (tick every ${REVIEWS_TICK_MS / 60000} min).`);
}

// ---------------------------------------------------------------------------
// Weekly progress digests: in-process scheduler (single Render instance)
// ---------------------------------------------------------------------------
// Ticks every 6 hours; the tick only emails jobs with client-shared daily logs
// from the past 7 days, exactly once per job per week (automation_logs kind
// "weekly_progress"), so frequent ticks are cheap and safe.

{
  const PROGRESS_TICK_MS = 6 * 60 * 60 * 1000;
  const tick = async () => {
    try {
      const result = await runWeeklyProgressTick(makeCtx());
      if (result.ran) console.log(`[crewkat][progress] sent weekly digest(s) for job(s): ${result.emailed.join(", ")}.`);
    } catch (error) {
      console.error("[crewkat][progress] scheduled run errored:", error);
    }
  };
  setTimeout(tick, 8 * 60 * 1000); // catch up shortly after boot
  setInterval(tick, PROGRESS_TICK_MS).unref();
  console.log(`[crewkat][progress] scheduler armed (tick every ${PROGRESS_TICK_MS / 3600000} h).`);
}

function shutdown(signal) {
  console.log(`[crewkat] received ${signal}; shutting down...`);
  server.close(() => {
    try {
      libsql.close();
    } catch {
      // ignore
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
