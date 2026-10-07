#!/bin/sh
# Downloads the third-party libraries into vendor/ (run once, with internet).
set -e
cd "$(dirname "$0")/.."

mkdir -p vendor/plotly vendor/leaflet/images vendor/maplibre

curl -fL -o vendor/plotly/plotly-basic-2.35.2.min.js \
  https://cdn.plot.ly/plotly-basic-2.35.2.min.js

L=https://unpkg.com/leaflet@1.9.4/dist
curl -fL -o vendor/leaflet/leaflet.js  $L/leaflet.js
curl -fL -o vendor/leaflet/leaflet.css $L/leaflet.css
for f in layers.png layers-2x.png marker-icon.png marker-icon-2x.png marker-shadow.png; do
  curl -fL -o vendor/leaflet/images/$f $L/images/$f
done

M=https://unpkg.com/maplibre-gl@6.9.0/dist
curl -fL -o vendor/maplibre/maplibre-gl.mjs $M/maplibre-gl.mjs
curl -fL -o vendor/maplibre/maplibre-gl.css $M/maplibre-gl.css

echo "Done. Bump VERSION in sw.js so the new files are cached."
