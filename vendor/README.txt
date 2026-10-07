Third-party libraries served from your own host
==============================================

Run  tools/download-vendor.sh  once (needs internet), or copy the files by hand:

  vendor/plotly/plotly-basic-2.35.2.min.js
  vendor/leaflet/leaflet.js, leaflet.css, images/layers.png, images/layers-2x.png
  vendor/maplibre/maplibre-gl.mjs, maplibre-gl.css
      (if the dist folder of your maplibre version contains more files,
       e.g. a separate worker file, copy them into the same folder)

While a file is missing the app silently loads the CDN copy instead,
so nothing breaks.
