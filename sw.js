/* Service Worker - Mountain Route Compare */
const VERSION = "v8";
const SHELL_CACHE = "mrc-shell-" + VERSION;
const RUNTIME_CACHE = "mrc-runtime-" + VERSION;

const SHELL_FILES = [
  "./", "index.html", "manifest.webmanifest",
  "css/style.css", "css/responsive.css", "css/toolbar.css", "css/weather.css",
  "js/app-state.js", "js/gpx-reader.js", "js/route-analysis.js", "js/charts.js",
  "js/ui.js", "js/route-selection.js", "js/speed.js", "js/map-2d.js",
  "js/map-3d.js", "js/track-geometry.js", "js/user-location.js",
  "js/weather.js", "js/app.js", "js/pwa.js",
  "partials/calculations.html",
  "icons/icon-192.png", "icons/icon-512.png"
  // images/header.jpg is cached on first use (it is not loaded on phones)
];

/* external libraries: versioned URLs, never change -> cache first */
const CACHEABLE_HOSTS = ["cdn.plot.ly", "unpkg.com"];

/* pathnames of the shell files (used to pick the right cache) */
const SHELL_PATHS = new Set(
  SHELL_FILES.map(f => new URL(f, self.registration.scope).pathname)
);

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      Promise.allSettled(SHELL_FILES.map(f => cache.add(f)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k.startsWith("mrc-") && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
        .map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function store(cacheName, req, res) {
  if (res && (res.ok || res.type === "opaque")) {
    const copy = res.clone();
    caches.open(cacheName).then(c => c.put(req, copy));
  }
  return res;
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = CACHEABLE_HOSTS.includes(url.hostname);

  // map tiles, weather API, analytics: straight from the network
  if (!sameOrigin && !cdn) return;

  // CDN libraries: cache first, no background re-download
  if (cdn) {
    event.respondWith(
      caches.match(req).then(cached =>
        cached || fetch(req).then(res => store(RUNTIME_CACHE, req, res))
      )
    );
    return;
  }

  // own files: stale-while-revalidate
  const cacheName = SHELL_PATHS.has(url.pathname) ? SHELL_CACHE : RUNTIME_CACHE;

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => store(cacheName, req, res))
        .catch(() =>
          cached ||
          (req.mode === "navigate" ? caches.match("index.html") : Response.error())
        );
      return cached || network;
    })
  );
});
