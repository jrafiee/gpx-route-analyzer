/* =========================================================
   3D Map (MapLibre GL)
   ========================================================= */

/*
 * MapLibre (JS + CSS, several hundred KB) is only downloaded the
 * first time the 3D view is opened.
 */

const MAPLIBRE_VERSION = "6.9.0";

let maplibrePromise = null;

function loadMapLibre() {
    if (window.maplibregl) {
        return Promise.resolve(window.maplibregl);
    }

    if (!maplibrePromise) {
        // own copy first (pre-cached by the service worker, works offline), CDN as a fallback
        const localBase = new URL("vendor/maplibre/", document.baseURI).href;
        const cdnBase = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/`;

        const link = document.createElement("link");

        link.rel = "stylesheet";
        link.href = localBase + "maplibre-gl.css";

        link.onerror = () => {
            link.onerror = null;
            link.href = cdnBase + "maplibre-gl.css";
        };

        document.head.appendChild(link);

        maplibrePromise =
            import(localBase + "maplibre-gl.mjs")
                .catch(() => import(cdnBase + "maplibre-gl.mjs"))
                .then(module => {
                    window.maplibregl = module;
                    return module;
                })
                .catch(error => {
                    maplibrePromise = null;
                    throw error;
                });
    }

    return maplibrePromise;
}


let map3dLoading = false;

function initialize3DMap() {
    if (map3d || map3dInitialized || map3dLoading) {
        return;
    }

    map3dLoading = true;

    loadMapLibre()
        .then(() => {
            map3dLoading = false;
            createMap3D();
        })
        .catch(error => {
            map3dLoading = false;
            console.error("MapLibre GL JS could not be loaded:", error);
        });
}


/* =========================================================
   3D base layers

   One DEM source (used by BOTH the terrain and the hillshade, so
   its tiles are downloaded once) and three raster base layers
   that the user can switch between:
     sat    : Esri World Imagery
     hybrid : satellite + OpenTopoMap contour lines (semi transparent)
     topo   : OpenTopoMap
     osm    : OpenStreetMap

   The styles of the switcher (.map3d-base-*) live in weather.css
   ========================================================= */

const BASE_LAYER_STORAGE_KEY = "map3d-base";

const BASE_LAYER_MODES = {
    sat:    { label: "ماهواره‌ای",    icon: "🛰️", layers: ["base-sat"],              topoOpacity: 1,    hillshade: 0.30 },
    hybrid: { label: "ماهواره + تراز", icon: "🏞️", layers: ["base-sat", "base-topo"], topoOpacity: 0.45, hillshade: 0.22 },
    topo:   { label: "توپوگرافی",     icon: "⛰️", layers: ["base-topo"],             topoOpacity: 1,    hillshade: 0.15 },
    osm:    { label: "خیابانی",       icon: "🏙️", layers: ["base-osm"],              topoOpacity: 1,    hillshade: 0.35 }
};

const BASE_LAYER_IDS = ["base-sat", "base-topo", "base-osm"];

let currentBase3D = (function () {
    try {
        const saved = localStorage.getItem(BASE_LAYER_STORAGE_KEY);

        if (saved && BASE_LAYER_MODES[saved]) {
            return saved;
        }
    } catch (e) { /* ignore */ }

    return "sat";
})();


function applyBaseLayer3D(mode) {
    const config = BASE_LAYER_MODES[mode];

    if (!config || !map3d) {
        return;
    }

    currentBase3D = mode;

    try {
        localStorage.setItem(BASE_LAYER_STORAGE_KEY, mode);
    } catch (e) { /* ignore */ }

    BASE_LAYER_IDS.forEach(id => {
        if (map3d.getLayer(id)) {
            map3d.setLayoutProperty(
                id,
                "visibility",
                config.layers.includes(id) ? "visible" : "none"
            );
        }
    });

    if (map3d.getLayer("base-topo")) {
        map3d.setPaintProperty("base-topo", "raster-opacity", config.topoOpacity);
    }

    if (map3d.getLayer("hillshade")) {
        map3d.setPaintProperty("hillshade", "hillshade-exaggeration", config.hillshade);
    }

    document.querySelectorAll(".map3d-base-btn").forEach(button => {
        button.classList.toggle("active", button.dataset.mode === mode);
    });
}


function createBaseLayerControl() {
    return {
        onAdd() {
            const container = document.createElement("div");

            container.className = "maplibregl-ctrl map3d-base-ctrl";

            Object.entries(BASE_LAYER_MODES).forEach(([mode, config]) => {
                const button = document.createElement("button");

                button.type = "button";
                button.className = "map3d-base-btn";
                button.dataset.mode = mode;
                button.title = config.label;
                button.setAttribute("aria-label", config.label);
                button.innerHTML =
                    `<span class="map3d-base-ico" aria-hidden="true">${config.icon}</span>` +
                    `<span class="map3d-base-lbl">${config.label}</span>`;

                button.classList.toggle("active", mode === currentBase3D);

                button.addEventListener("click", () => applyBaseLayer3D(mode));

                container.appendChild(button);
            });

            this._container = container;

            return container;
        },

        onRemove() {
            if (this._container && this._container.parentNode) {
                this._container.parentNode.removeChild(this._container);
            }
        }
    };
}


function rasterSource(tiles, maxzoom, attribution) {
    return { type: "raster", tiles: [tiles], tileSize: 256, maxzoom, attribution };
}


function createMap3D() {
    if (map3dInitialized) {
        return;
    }

    if (!window.maplibregl) {
        console.error("MapLibre GL JS is not loaded.");
        return;
    }

    map3d = new window.maplibregl.Map({
        container: "map-3d",

        center: [51.5, 32.0],
        zoom: 7,
        pitch: 55,
        bearing: 0,
        maxPitch: 85,

        // touch devices: one finger scrolls the page, two fingers move the map
        cooperativeGestures: isTouchDevice(),

        locale: {
            "CooperativeGesturesHandler.MobileHelpText":
                "برای حرکت روی نقشه از دو انگشت استفاده کنید",
            "CooperativeGesturesHandler.WindowsHelpText":
                "برای زوم، Ctrl را نگه دارید و اسکرول کنید",
            "CooperativeGesturesHandler.MacHelpText":
                "برای زوم، ⌘ را نگه دارید و اسکرول کنید"
        },

        style: {
            version: 8,

            /* glyphs are required for the route-number symbol layer */
            glyphs: "https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/resources/fonts/{fontstack}/{range}.pbf",

            sources: {
                satellite: rasterSource(
                    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                    19,
                    "Tiles &copy; Esri"
                ),

                topo: rasterSource(
                    "https://tile.opentopomap.org/{z}/{x}/{y}.png",
                    17,
                    "Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap"
                ),

                osm: rasterSource(
                    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                    19,
                    "&copy; OpenStreetMap contributors"
                ),

                /*
                 * ONE elevation source for terrain AND hillshade.
                 * encoding / tileSize / maxzoom are explicit so nothing
                 * depends on defaults ("mapbox" encoding would distort
                 * the terrain).
                 */
                dem: {
                    type: "raster-dem",
                    url: "https://tiles.mapterhorn.com/tilejson.json",
                    encoding: "terrarium",
                    tileSize: 512,
                    maxzoom: 12,
                    attribution: "Terrain &copy; Mapterhorn"
                }
            },

            layers: [
                { id: "base-osm", type: "raster", source: "osm", layout: { visibility: "none" } },
                { id: "base-sat", type: "raster", source: "satellite", layout: { visibility: "visible" } },
                { id: "base-topo", type: "raster", source: "topo", layout: { visibility: "none" }, paint: { "raster-opacity": 1 } },
                {
                    id: "hillshade",
                    type: "hillshade",
                    source: "dem",
                    paint: {
                        "hillshade-exaggeration": 0.3,
                        "hillshade-shadow-color": "#000000",
                        "hillshade-highlight-color": "#ffffff"
                    }
                }
            ]
        }
    });

    map3d.addControl(
        new window.maplibregl.NavigationControl({ visualizePitch: true }),
        "top-left"
    );

    map3d.addControl(
        new window.maplibregl.ScaleControl({ unit: "metric" }),
        "bottom-left"
    );

    map3d.addControl(createBaseLayerControl(), "top-right");

    map3d.on("load", function () {
        map3d.setTerrain({ source: "dem", exaggeration: 1.4 });

        /* sky + haze: depth and realism at high pitch */
        try {
            map3d.setSky({
                "sky-color": "#7fb4e6",
                "horizon-color": "#dce9f4",
                "fog-color": "#dce9f4",
                "sky-horizon-blend": 0.5,
                "horizon-fog-blend": 0.6,
                "fog-ground-blend": 0.25
            });
        } catch (e) {
            console.warn("Sky is not supported:", e);
        }

        applyBaseLayer3D(currentBase3D);

        map3dInitialized = true;

        drawRoutesOn3DMap(analysisResults);
    });

    map3d.on("error", event => console.error("3D map error:", event));
}


/* =========================================================
   Route to GeoJSON (one LineString per segment, with its speed)
   ========================================================= */

function routeToGeoJSON(result) {
    const points = result.routeData?.points;

    if (!points || points.length < 2) {
        return null;
    }

    const speedSegments = calculateRouteSpeeds(points);

    const range = getDirectionPointRange(points);

    const coordinate = point => [
        Number(point.longitude),
        Number(point.latitude),
        Number.isFinite(point.elevation) ? point.elevation : 0
    ];

    const features = [];

    for (let i = range.start; i < range.end; i++) {
        const segment = speedSegments[i];

        features.push({
            type: "Feature",
            properties: {
                name: result.route,
                speed: segment ? segment.speed : null,
                distance3D: segment ? segment.distance3D : null
            },
            geometry: {
                type: "LineString",
                coordinates: [coordinate(points[i]), coordinate(points[i + 1])]
            }
        });
    }

    return { type: "FeatureCollection", features };
}


/* =========================================================
   Draw 3D routes
   ========================================================= */

/* colour of a segment from its "speed" property (same classes as 2D) */
const speedColorExpression = [
    "case",
    ["==", ["get", "speed"], null], SPEED_COLORS.noData,
    ...SPEED_STEPS.flatMap((limit, i) => [
        ["<", ["get", "speed"], limit],
        SPEED_SCALE[i]
    ]),
    SPEED_SCALE[SPEED_SCALE.length - 1]
];


function setGeoJSONSource(id, features) {
    const data = { type: "FeatureCollection", features };
    const source = map3d.getSource(id);

    if (source) {
        source.setData(data);
    } else {
        map3d.addSource(id, { type: "geojson", data });
    }
}


function bindClickableLayer(layerId, onClick) {
    map3d.on("mouseenter", layerId, () => {
        map3d.getCanvas().style.cursor = "pointer";
    });

    map3d.on("mouseleave", layerId, () => {
        map3d.getCanvas().style.cursor = "";
    });

    map3d.on("click", layerId, event => {
        const feature = event.features?.[0];

        if (!feature) {
            return;
        }

        new window.maplibregl.Popup()
            .setLngLat(event.lngLat)
            .setHTML(onClick(feature.properties))
            .addTo(map3d);
    });
}


function bindRouteEvents() {
    if (map3d._routeEventsBound) {
        return;
    }

    map3d._routeEventsBound = true;

    bindClickableLayer("routes-3d", properties => {
        let html = `<strong>${escapeHtml(properties.name || "")}</strong>`;

        const speed = Number(properties.speed);
        const distance3D = Number(properties.distance3D);

        html += Number.isFinite(speed) && properties.speed !== null
            ? `<br>سرعت: <b>${speed.toFixed(1)}</b> km/h`
            : "<br>سرعت: بدون اطلاعات زمانی";

        if (Number.isFinite(distance3D) && properties.distance3D !== null) {
            html += `<br>فاصله 3D: ${distance3D.toFixed(1)} m`;
        }

        return html;
    });

    bindClickableLayer("route-labels-3d", properties =>
        `<strong>${Number(properties.number)}. ${escapeHtml(properties.name || "")}</strong>`
    );
}


function drawRoutesOn3DMap(results) {
    if (!map3d || !map3dInitialized) {
        return;
    }

    const lineFeatures = [];
    const labelFeatures = [];

    results.forEach((result, index) => {
        const geojson = routeToGeoJSON(result);

        if (geojson) {
            for (const feature of geojson.features) {
                lineFeatures.push(feature);
            }
        }

        // one numbered point at the beginning of each route
        const points = result.routeData?.points;

        if (!points || points.length === 0) {
            return;
        }

        const first = points[getDirectionPointRange(points).markerIndex];

        if (!Number.isFinite(first.latitude) || !Number.isFinite(first.longitude)) {
            return;
        }

        labelFeatures.push({
            type: "Feature",
            properties: {
                number: index + 1,
                name: result.route,
                color: ROUTE_COLORS[index % ROUTE_COLORS.length]
            },
            geometry: {
                type: "Point",
                coordinates: [Number(first.longitude), Number(first.latitude)]
            }
        });
    });

    setGeoJSONSource("routes-3d", lineFeatures);
    setGeoJSONSource("route-labels-3d", labelFeatures);

    if (!map3d.getLayer("routes-3d")) {
        map3d.addLayer({
            id: "routes-3d",
            type: "line",
            source: "routes-3d",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": speedColorExpression,
                "line-width": 5,
                "line-opacity": 0.95
            }
        });
    }

    if (!map3d.getLayer("route-labels-3d")) {
        map3d.addLayer({
            id: "route-labels-3d",
            type: "circle",
            source: "route-labels-3d",
            paint: {
                "circle-radius": 13,
                "circle-color": ["get", "color"],
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 2,
                "circle-opacity": 1
            }
        });
    }

    if (!map3d.getLayer("route-label-text-3d")) {
        map3d.addLayer({
            id: "route-label-text-3d",
            type: "symbol",
            source: "route-labels-3d",
            layout: {
                "text-field": ["to-string", ["get", "number"]],
                "text-size": 12,
                "text-font": ["Arial Unicode MS Bold"],
                "text-anchor": "center",
                "text-allow-overlap": true,
                "text-ignore-placement": true
            },
            paint: {
                "text-color": "#ffffff",
                "text-halo-color": "rgba(0,0,0,0.25)",
                "text-halo-width": 0.5
            }
        });
    }

    bindRouteEvents();

    createSpeedLegend(document.getElementById("map-3d"));

    fit3DMapToRoutes(results);
}


/* =========================================================
   Fit / clear
   ========================================================= */

function fit3DMapToRoutes(results) {
    if (!map3d || !map3dInitialized) {
        return;
    }

    const bounds = new window.maplibregl.LngLatBounds();

    let hasPoints = false;

    results.forEach(result => {
        const points = result.routeData?.points;

        if (!points || points.length === 0) {
            return;
        }

        getDirectionPoints(points).forEach(point => {
            if (Number.isFinite(point.latitude) && Number.isFinite(point.longitude)) {
                bounds.extend([point.longitude, point.latitude]);
                hasPoints = true;
            }
        });
    });

    if (!hasPoints) {
        return;
    }

    map3d.fitBounds(bounds, {
        padding: 50,
        pitch: 55,
        bearing: 0,
        duration: 800
    });
}


function clear3DMap() {
    if (!map3d) {
        return;
    }

    ["route-label-text-3d", "route-labels-3d", "routes-3d"].forEach(id => {
        if (map3d.getLayer(id)) {
            map3d.removeLayer(id);
        }
    });

    ["route-labels-3d", "routes-3d"].forEach(id => {
        if (map3d.getSource(id)) {
            map3d.removeSource(id);
        }
    });

    const legend = document.querySelector("#map-3d .speed-legend");

    if (legend) {
        legend.remove();
    }
}


/* =========================================================
   2D / 3D switch
   ========================================================= */

function showMapMode(mode) {
    const is3D = mode === "3d";

    currentMapMode = mode;

    document.getElementById("map").style.display = is3D ? "none" : "block";
    document.getElementById("map-3d-container").style.display = is3D ? "block" : "none";

    document.getElementById("map-2d-button").classList.toggle("active", !is3D);
    document.getElementById("map-3d-button").classList.toggle("active", is3D);

    if (is3D) {
        initialize3DMap();

        setTimeout(() => {
            if (map3d) {
                map3d.resize();
                drawRoutesOn3DMap(analysisResults);
            }
        }, 150);
    } else {
        initializeMap();

        setTimeout(() => {
            if (map) {
                map.invalidateSize();
                drawRoutesOnMap(analysisResults);
            }
        }, 100);
    }
}

/* called from the buttons in index.html */
function show2DMap() { showMapMode("2d"); }
function show3DMap() { showMapMode("3d"); }
