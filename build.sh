#!/bin/sh
# OPTIONAL production bundle: css/app.min.css and js/app.min.js
# Needs Node.js (npx downloads esbuild the first time).
# The sources are classic scripts that share globals, so they are concatenated
# in index.html order and only minified (names are NOT bundled / renamed).
set -e
cd "$(dirname "$0")"

JS=$(sed -n 's/.*<script defer src="\(js\/[^"]*\)".*/\1/p' index.html | grep -v 'app.min.js')
cat $JS > /tmp/pakoob-all.js
npx --yes esbuild /tmp/pakoob-all.js --minify --outfile=js/app.min.js

cat css/style.css css/toolbar.css css/responsive.css css/weather.css css/offline.css > /tmp/pakoob-all.css
npx --yes esbuild /tmp/pakoob-all.css --minify --outfile=css/app.min.css

echo "Now in index.html: replace the 16 <script defer src=\"js/...\"> lines with"
echo "  <script defer src=\"js/app.min.js\"></script>"
echo "and the 5 css <link>s with css/app.min.css; update SHELL_FILES in sw.js and bump VERSION."
