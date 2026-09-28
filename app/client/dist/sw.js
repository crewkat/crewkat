// Chunk D: Crewkat app service worker — offline mode v1 + web push.
// Served at /app/sw.js (scope /app/). Copied into dist/ by client/build.mjs.
//
// Caching strategy:
// - App shell + bundled assets: cache-first (works offline after first visit).
// - API (POST /actions): network-first with an offline 503 JSON fallback so
//   the client can fall back to its cached lists; never served stale.
// - Everything else same-origin: cache-first with network fallback, and the
//   app shell as the last-resort fallback for navigation requests.

const CACHE = "crewkat-shell-v1";
const SHELL = [
  "/app/",
  "/app/index.html",
  "/app/manifest.webmanifest",
  "/app/icon-180.png",
  "/app/icon-192.png",
  "/app/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isNavigation(request) {
  return request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API calls: network-first; offline -> 503 JSON the client understands.
  if (url.pathname === "/actions" || url.pathname.startsWith("/actions/")) {
    event.respondWith(
      fetch(request).catch(
        () => new Response(JSON.stringify({ error: "OFFLINE" }), { status: 503, headers: { "content-type": "application/json" } })
      )
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Cache the app shell pieces and versioned bundle assets as they load.
        const cacheable =
          response.ok &&
          (url.pathname === "/app/" ||
            url.pathname === "/app/index.html" ||
            url.pathname.startsWith("/app/assets/") ||
            url.pathname === "/app/manifest.webmanifest" ||
            /^\/app\/icon-\d+\.png$/.test(url.pathname));
        if (cacheable) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => {
        // Offline and not cached: navigations fall back to the app shell.
        if (isNavigation(request)) return caches.match("/app/index.html");
        throw new Error("offline");
      });
    })
  );
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
