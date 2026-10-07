/* Service Worker - Mountain Route Compare */
const VERSION = "v9";
const SHELL_CACHE = "mrc-shell-" + VERSION;
const RUNTIME_CACHE = "mrc-runtime-" + VERSION;

/* map tiles live in their own cache that survives version bumps */
const TILE_CACHE = "mrc-tiles-v1";
const TILE_LIMIT = 1500;

const SHELL_FILES = [
  "./", "index.html", "manifest.webmanifest",
  "css/style.css", "css/responsive.css", "css/toolbar.css", "css/weather.css",
  "js/app-state.js", "js/gpx-reader.js", "js/route-analysis.js", "js/charts.js",
  "js/ui.js", "js/route-selection.js", "js/speed.js", "js/map-2d.js",
  "js/map-3d.js", "js/track-geometry.js", "js/user-location.js",
  "js/weather.js", "js/app.js", "js/pwa.js",
  "partials/calculations.html",
  "icons/icon-192.png", "icons/icon-512.png",
  // own copies of the libraries (missing files are simply skipped)
  "vendor/plotly/plotly-basic-2.35.2.min.js",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css",
  "vendor/leaflet/images/layers.png", "vendor/leaflet/images/layers-2x.png",
  "vendor/maplibre/maplibre-gl.mjs", "vendor/maplibre/maplibre-gl.css"
  // images/header.jpg is cached on first use (it is not loaded on phones)
];

/* external libraries (fallback when vendor/ is empty): versioned URLs -> cache first */
const CACHEABLE_HOSTS = ["cdn.plot.ly", "unpkg.com"];

/* map tile servers */
const TILE_HOST_RE =
  /(^|\.)(tile\.openstreetmap\.org|tile\.opentopomap\.org|server\.arcgisonline\.com|tiles\.mapterhorn\.com)$/;

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
  const keep = [SHELL_CACHE, RUNTIME_CACHE, TILE_CACHE];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k.startsWith("mrc-") && !keep.includes(k))
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

/* a/b/c.tile.* subdomains serve the same tile: one cache entry */
function tileKey(url) {
  return url.href.replace(/^https:\/\/[abc]\.(tile\.)/, "https://$1");
}

let tilePuts = 0;

async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length > TILE_LIMIT) {
    await Promise.all(
      keys.slice(0, keys.length - TILE_LIMIT).map(k => cache.delete(k))
    );
  }
}

/* tiles: cache first (visited areas also work offline) */
async function tileResponse(req, url) {
  const cache = await caches.open(TILE_CACHE);
  const key = tileKey(url);

  const hit = await cache.match(key);
  if (hit) return hit;

  try {
    const res = await fetch(req);

    // only real (CORS) responses; opaque ones would waste storage quota
    if (res.ok) {
      cache.put(key, res.clone());
      if (++tilePuts % 50 === 0) trimTiles(cache);
    }

    return res;
  } catch (e) {
    return Response.error();
  }
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (!sameOrigin && TILE_HOST_RE.test(url.hostname)) {
    event.respondWith(tileResponse(req, url));
    return;
  }

  const cdn = CACHEABLE_HOSTS.includes(url.hostname);

  // weather API, analytics, ...: straight from the network
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
