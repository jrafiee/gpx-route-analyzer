/* Service Worker - Mountain Route Compare */
const VERSION = "v5";
const SHELL_CACHE = "mrc-shell-" + VERSION;
const RUNTIME_CACHE = "mrc-runtime-" + VERSION;

const SHELL_FILES = [
  "./", "index.html", "mountain-route-calculations-fa.html", "manifest.webmanifest",
  "css/style.css", "css/responsive.css",
  "js/app-state.js", "js/gpx-reader.js", "js/route-analysis.js", "js/charts.js",
  "js/ui.js", "js/route-selection.js", "js/speed.js", "js/map-2d.js",
  "js/map-3d.js", "js/weather.js", "js/app.js", "js/pwa.js",
  "images/header.jpg", "icons/icon-192.png", "icons/icon-512.png","js/user-location.js","css/toolbar.css" ,"js/track-geometry.js"
];

/* کتابخانه‌های خارجی که باید برای استفاده آفلاین کش شوند */
const CACHEABLE_HOSTS = ["cdn.plot.ly", "unpkg.com"];

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

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = CACHEABLE_HOSTS.includes(url.hostname);

  // بقیه (تایل نقشه، API هواشناسی، analytics) مستقیم از شبکه
  if (!sameOrigin && !cdn) return;

  // stale-while-revalidate
  event.respondWith(
    caches.match(req, { ignoreSearch: false }).then(cached => {
      const network = fetch(req).then(res => {
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          const name = sameOrigin && SHELL_FILES.some(f => url.pathname.endsWith(f.replace("./", "")))
            ? SHELL_CACHE : RUNTIME_CACHE;
          caches.open(name).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached || (req.mode === "navigate" ? caches.match("index.html") : undefined));
      return cached || network;
    })
  );
});
