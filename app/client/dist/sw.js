// Crewkat app service worker — offline mode + web push.
// Served at /app/sw.js (scope /app/). build.mjs stamps 99ecb2c with the
// git commit (or a build timestamp) so EVERY deploy produces a new worker and
// the browser installs it immediately instead of serving a stale shell.
//
// Caching strategy:
// - App shell (/, /app/index.html, manifest, icons): network-first for
//   navigations/HTML — a fresh deploy is never hidden behind stale HTML.
// - Versioned bundle assets (/app/assets/*, hashed at build): cache-first,
//   safe because the filenames change with every build.
// - API (/actions): network-only with an offline 503 JSON fallback the
//   client understands; never served stale.
// - Everything else same-origin: network-first with cache fallback.

const BUILD_ID = "99ecb2c";
const SHELL_CACHE = `crewkat-shell-${BUILD_ID}`;
const RUNTIME_CACHE = `crewkat-runtime-${BUILD_ID}`;
const PRECACHE = [
  "/app/",
  "/app/index.html",
  "/app/manifest.webmanifest",
  "/app/icon-180.png",
  "/app/icon-192.png",
  "/app/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("crewkat-") && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// The update toast's Refresh button tells the waiting worker to take over now.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isNavigation(request) {
  return request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");
}

async function networkFirst(request, cacheName, fallback) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallback) return fallback();
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API: network only; offline -> 503 JSON the client understands.
  if (url.pathname === "/actions" || url.pathname.startsWith("/actions/")) {
    event.respondWith(
      fetch(request).catch(
        () => new Response(JSON.stringify({ error: "OFFLINE" }), { status: 503, headers: { "content-type": "application/json" } })
      )
    );
    return;
  }

  // Navigations + HTML: NETWORK-FIRST — never serve a stale app shell after a deploy.
  if (isNavigation(request) || url.pathname === "/app/" || url.pathname === "/app/index.html") {
    event.respondWith(networkFirst(request, SHELL_CACHE, () => caches.match("/app/index.html")));
    return;
  }

  // Versioned bundle assets (hashed filenames): cache-first, then network.
  if (
    url.pathname.startsWith("/app/assets/") ||
    url.pathname === "/app/manifest.webmanifest" ||
    /^\/app\/icon-\d+\.png$/.test(url.pathname)
  ) {
    event.respondWith(
      caches
        .match(request, { ignoreSearch: true })
        .then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          });
        })
        .catch(() => {
          throw new Error("offline");
        })
    );
    return;
  }

  // Everything else same-origin: network-first with cache fallback.
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// --- Web Push ----------------------------------------------------------------

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const lang = (self.navigator && self.navigator.language ? self.navigator.language : "en").toLowerCase();
  const useEs = lang.startsWith("es");
  const title = (useEs ? data.titleEs || data.titleEn : data.titleEn || data.titleEs) || "Crewkat";
  const body = (useEs ? data.bodyEs || data.bodyEn : data.bodyEn || data.bodyEs) || "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/app/icon-192.png",
      badge: "/app/icon-192.png",
      data: { url: data.url || "/app/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/app")) {
          if ("focus" in client) return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    })
  );
});
