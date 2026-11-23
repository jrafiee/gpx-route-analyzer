#!/bin/sh
# Usage: sh set-domain.sh example.com   (replaces YOUR-DOMAIN.com in robots.txt and sitemap.xml)
set -e
[ -n "$1" ] || { echo "usage: sh set-domain.sh example.com"; exit 1; }
cd "$(dirname "$0")"
sed -i "s/YOUR-DOMAIN\.com/$1/g" robots.txt sitemap.xml index.html
sed -i "s|<lastmod>.*</lastmod>|<lastmod>$(date +%F)</lastmod>|" sitemap.xml
echo "Done: $1"
