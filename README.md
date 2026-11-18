# Pakoob (پاکوب) — Mountain Route Compare

A browser-based app for analysing and comparing hiking / mountaineering routes
from GPX or KML files. Everything runs in the browser: no backend, no database,
route files are never uploaded.

## Features

- Compare several routes: distance, elevation profile (real / aligned to start /
  aligned to summit / sequential), slope distribution, difficulty score,
  estimated (adjusted Naismith) and recorded ascent time
- 2D map (Leaflet) with speed colouring, 3D terrain map (MapLibre GL) with an
  optional weather overlay (temperature, wind, precipitation, CAPE)
- Live navigation on the route (GPS, deviation alert, pocket mode)
- 7-day / hourly summit forecast from several models (Open-Meteo)
- Rename, re-order (drag) and download routes; routes are kept in IndexedDB
- Offline maps: download the 2D / 3D tiles (and terrain) around the tracks
  in advance (map section -> "دانلود نقشه برای استفادهٔ آفلاین")
- Light / dark mode, Persian RTL interface, installable PWA, works offline
  (app shell, libraries and visited map tiles are cached)

## Project structure

```text
index.html
sw.js                       service worker (bump VERSION on every release)
manifest.webmanifest
robots.txt, sitemap.xml     replace YOUR-DOMAIN.com (see set-domain.sh)
download-vendor.sh          downloads Plotly / Leaflet / MapLibre into vendor/
build.sh                    optional: one minified js + css bundle (see below)
partials/calculations.html  formula guide, loaded on demand
icons/, images/header.jpg
data/sample/                default GPX files + index.json (the list of default
                            routes and "quick start" buttons is built from it)
vendor/                     self-hosted libraries (created by download-vendor.sh)

css/
  style.css       tokens, top bar, sections, cards, guide, sidebar, home page
  toolbar.css     chart / map toolbars + full-screen navigation view
  responsive.css  mobile & tablet rules
  weather.css     weather section + 3D-map weather layer + base-layer switcher
  offline.css     offline-map download panel

js/   (load order = order in index.html)
  app-state.js        globals + shared helpers (escapeHtml, hookFunction, theme,
                      section navigation, route drawer)
  gpx-reader.js       GPX / KML parsing, export, distance helpers
  route-analysis.js   metrics, slope distribution, difficulty, Naismith time
  charts.js           Plotly charts
  ui.js               lazy drawing of sections, home actions, search
  route-selection.js  file input, default routes, rename / reorder / remove
  speed.js            speed per segment, colours, legend
  map-2d.js           Leaflet map
  map-3d.js           MapLibre 3D map
  track-geometry.js   projection of a GPS fix onto the track
  user-location.js    navigation screen
  map-3d-weather.js   weather overlay on the 3D map
  offline-region.js   download the map around the routes for offline use
  weather.js          forecast cards
  pwa.js              service worker registration, install button, IndexedDB
  app.js              start-up
```

## Adding a default route

Put the GPX in `data/sample/` and add one entry to `data/sample/index.json`
(`routes` for the sidebar list, `quick` for the home-page button). No HTML change.

## Setup / release

1. `sh download-vendor.sh` once (needs internet).
2. Replace the domain: `sh set-domain.sh example.com`.
3. Bump `VERSION` in `sw.js`.

## Technologies

HTML5, CSS3, JavaScript (no framework), Plotly.js, Leaflet, MapLibre GL JS.
