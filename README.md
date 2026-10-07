# Mountain Route Compare

A browser-based JavaScript application for analyzing and comparing hiking and mountaineering routes using GPX files.

## Features

- Compare multiple GPX routes
- Compare distance and elevation profiles
- Analyze elevation gain
- Analyze slope distribution
- Estimate ascent time
- Calculate route difficulty
- Display routes on an interactive map
- Drag and reorder routes
- Light and dark mode
- Persian RTL interface

## How It Works

GPX files are loaded and analyzed directly in the browser. No backend or database is required, and GPX data is not uploaded to a server.

## Technologies

- HTML5
- CSS3
- JavaScript
- Plotly.js
- Leaflet

## Project Structure

```text
mountain-route-compare/
├── index.html
├── sw.js
├── manifest.webmanifest
├── partials/calculations.html   (formula guide, loaded on demand)
├── css/  style.css, responsive.css, toolbar.css, weather.css
└── js/   app-state, gpx-reader, route-analysis, charts, ui,
          route-selection, speed, map-2d, map-3d, track-geometry,
          user-location, weather, pwa, app
```
