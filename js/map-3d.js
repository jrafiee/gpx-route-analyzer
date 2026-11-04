/* =========================================================
   3D Map
   ========================================================= */


/* =========================================================
   3D Map initialization
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

        // CDN first (no 404 noise), own copy (vendor/maplibre/) as a fallback
        const localBase =
            new URL("vendor/maplibre/", document.baseURI).href;

        const cdnBase =
            `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/`;

        const link = document.createElement("link");

        link.rel = "stylesheet";

        link.href = cdnBase + "maplibre-gl.css";

        link.onerror = () => {

            link.onerror = null;

            link.href = localBase + "maplibre-gl.css";

        };

        document.head.appendChild(link);

        maplibrePromise =
            import(cdnBase + "maplibre-gl.mjs")
                .catch(
                    () => import(localBase + "maplibre-gl.mjs")
                )
                .then(
                    module => {

                        window.maplibregl = module;

                        return module;

                    }
                )
                .catch(
                    error => {

                        maplibrePromise = null;

                        throw error;

                    }
                );

    }

    return maplibrePromise;

}


let map3dLoading = false;

function initialize3DMap() {

    if (
        map3d ||
        map3dInitialized ||
        map3dLoading
    ) {

        return;

    }

    map3dLoading = true;

    loadMapLibre()
        .then(
            () => {

                map3dLoading = false;

                createMap3D();

            }
        )
        .catch(
            error => {

                map3dLoading = false;

                console.error(
                    "MapLibre GL JS could not be loaded:",
                    error
                );

            }
        );

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
   ========================================================= */

const BASE_LAYER_STORAGE_KEY = "map3d-base";

const BASE_LAYER_MODES = {

    sat: {
        label: "ماهواره‌ای",
        layers: ["base-sat"],
        topoOpacity: 1,
        hillshade: 0.30
    },

    hybrid: {
        label: "ماهواره + تراز",
        layers: ["base-sat", "base-topo"],
        topoOpacity: 0.45,
        hillshade: 0.22
    },

    topo: {
        label: "توپوگرافی",
        layers: ["base-topo"],
        topoOpacity: 1,
        hillshade: 0.15
    },

    osm: {
        label: "خیابانی",
        layers: ["base-osm"],
        topoOpacity: 1,
        hillshade: 0.35
    }

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

        if (!map3d.getLayer(id)) {
            return;
        }

        map3d.setLayoutProperty(
            id,
            "visibility",
            config.layers.includes(id) ? "visible" : "none"
        );

    });

    if (map3d.getLayer("base-topo")) {
        map3d.setPaintProperty("base-topo", "raster-opacity", config.topoOpacity);
    }

    if (map3d.getLayer("hillshade")) {
        map3d.setPaintProperty("hillshade", "hillshade-exaggeration", config.hillshade);
    }

    document
        .querySelectorAll(".map3d-base-btn")
        .forEach(button => {
            button.classList.toggle("active", button.dataset.mode === mode);
        });

}


function injectBaseControlStyles() {

    if (document.getElementById("map3d-base-styles")) {
        return;
    }

    const style = document.createElement("style");

    style.id = "map3d-base-styles";

    style.textContent = `
    .map3d-base-ctrl {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px;
        background: var(--card-bg, #fff);
        border: 1px solid var(--border-color, #ccc);
        border-radius: 10px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, .25);
        direction: rtl;
    }
    .map3d-base-btn {
        min-width: 110px;
        padding: 6px 10px;
        border: 1px solid var(--border-color, #ccc);
        border-radius: 7px;
        background: transparent;
        color: var(--text-primary, #222);
        font-family: inherit;
        font-size: 12px;
        text-align: right;
        cursor: pointer;
    }
    .map3d-base-btn:hover { background: var(--accent-light, #eee); }
    .map3d-base-btn.active {
        background: var(--accent, #0b7a66);
        border-color: var(--accent, #0b7a66);
        color: #fff;
        font-weight: 700;
    }
    `;

    document.head.appendChild(style);

}


function createBaseLayerControl() {

    injectBaseControlStyles();

    return {

        onAdd: function () {

            const container = document.createElement("div");

            container.className = "maplibregl-ctrl map3d-base-ctrl";

            Object.entries(BASE_LAYER_MODES).forEach(([mode, config]) => {

                const button = document.createElement("button");

                button.type = "button";
                button.className = "map3d-base-btn";
                button.dataset.mode = mode;
                button.textContent = config.label;

                button.classList.toggle("active", mode === currentBase3D);

                button.addEventListener("click", () => applyBaseLayer3D(mode));

                container.appendChild(button);

            });

            this._container = container;

            return container;

        },

        onRemove: function () {

            if (this._container && this._container.parentNode) {
                this._container.parentNode.removeChild(this._container);
            }

        }

    };

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

        style: {

            version: 8,

            /* glyphs are required for the route-number symbol layer */
            glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",

            sources: {

                satellite: {
                    type: "raster",
                    tiles: [
                        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    ],
                    tileSize: 256,
                    maxzoom: 19,
                    attribution: "Tiles &copy; Esri"
                },

                topo: {
                    type: "raster",
                    tiles: [
                        "https://tile.opentopomap.org/{z}/{x}/{y}.png"
                    ],
                    tileSize: 256,
                    maxzoom: 17,
                    attribution:
                        "Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap"
                },

                osm: {
                    type: "raster",
                    tiles: [
                        "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                    ],
                    tileSize: 256,
                    maxzoom: 19,
                    attribution: "&copy; OpenStreetMap contributors"
                },

                /*
                 * ONE elevation source for terrain AND hillshade
                 * (it was declared twice before = tiles downloaded twice).
                 * The TileJSON is the source of truth; encoding / tileSize /
                 * maxzoom are set explicitly as well so nothing depends
                 * on defaults ("mapbox" encoding would distort the terrain).
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

                {
                    id: "base-osm",
                    type: "raster",
                    source: "osm",
                    layout: { visibility: "none" }
                },

                {
                    id: "base-sat",
                    type: "raster",
                    source: "satellite",
                    layout: { visibility: "visible" }
                },

                {
                    id: "base-topo",
                    type: "raster",
                    source: "topo",
                    layout: { visibility: "none" },
                    paint: { "raster-opacity": 1 }
                },

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

        map3d.setTerrain({
            source: "dem",
            exaggeration: 1.4
        });

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

    map3d.on("error", function (event) {

        console.error("3D map error:", event);

    });

}


/* =========================================================
   Route to GeoJSON
   ========================================================= */

function routeToGeoJSON(result) {

    const points =
        result.routeData?.points;


    if (
        !points ||
        points.length < 2
    ) {

        return null;

    }


    const speedSegments =
        calculateRouteSpeeds(
            points
        );


    const range =
        getDirectionPointRange(points);


    const features = [];


    for (
        let i = range.start;
        i < range.end;
        i++
    ) {

        const point1 =
            points[i];


        const point2 =
            points[i + 1];


        const segment =
            speedSegments[i];


        const speed =
            segment
                ? segment.speed
                : null;


        const distance3D =
            segment
                ? segment.distance3D
                : null;


        features.push({

            type:
                "Feature",


            properties: {

                name:
                    result.route,

                speed:
                    speed,

                rawSpeed:
                    segment
                        ? segment.rawSpeed
                        : null,

                distance3D:
                    distance3D

            },


            geometry: {

                type:
                    "LineString",

                coordinates: [

                    [

                        Number(
                            point1.longitude
                        ),

                        Number(
                            point1.latitude
                        ),

                        Number.isFinite(
                            point1.elevation
                        )
                            ? point1.elevation
                            : 0

                    ],


                    [

                        Number(
                            point2.longitude
                        ),

                        Number(
                            point2.latitude
                        ),

                        Number.isFinite(
                            point2.elevation
                        )
                            ? point2.elevation
                            : 0

                    ]

                ]

            }

        });

    }


    return {

        type:
            "FeatureCollection",

        features:
            features

    };

}


/* =========================================================
   Draw 3D routes
   ========================================================= */

function drawRoutesOn3DMap(results) {

    if (
        !map3d ||
        !map3dInitialized
    ) {

        return;

    }


    /*
     * Route line features
     */

    const features = [];


    /*
     * Route-number point features
     */

    const routeLabelFeatures = [];


    /*
     * Same route colors used by the 2D map.
     */

    const routeColors = ROUTE_COLORS;


    /*
     * Build route lines and route-number points.
     */

    results.forEach(
        (result, index) => {

            const routeGeoJSON =
                routeToGeoJSON(
                    result
                );


            if (
                routeGeoJSON &&
                Array.isArray(
                    routeGeoJSON.features
                )
            ) {

                features.push(
                    ...routeGeoJSON.features
                );

            }


            /*
             * Create one numbered point
             * at the beginning of each route.
             */

            const points =
                result.routeData?.points;


            if (
                !points ||
                points.length === 0
            ) {

                return;

            }


            const range =
                getDirectionPointRange(points);


            const firstPoint =
                points[range.markerIndex];


            if (
                !Number.isFinite(
                    firstPoint.latitude
                ) ||
                !Number.isFinite(
                    firstPoint.longitude
                )
            ) {

                return;

            }


            const markerColor =
                routeColors[
                    index %
                    routeColors.length
                ];


            routeLabelFeatures.push({

                type:
                    "Feature",


                properties: {

                    number:
                        index + 1,

                    name:
                        result.route,

                    color:
                        markerColor

                },


                geometry: {

                    type:
                        "Point",

                    coordinates: [

                        Number(
                            firstPoint.longitude
                        ),

                        Number(
                            firstPoint.latitude
                        )

                    ]

                }

            });

        }
    );


    /*
     * Route line GeoJSON.
     */

    const geojson = {

        type:
            "FeatureCollection",

        features:
            features

    };


    /*
     * Route-number GeoJSON.
     */

    const labelGeoJSON = {

        type:
            "FeatureCollection",

        features:
            routeLabelFeatures

    };


    /* =====================================================
       Route source
       ===================================================== */

    if (
        map3d.getSource(
            "routes-3d"
        )
    ) {

        map3d
            .getSource(
                "routes-3d"
            )
            .setData(
                geojson
            );

    }

    else {

        map3d.addSource(
            "routes-3d",
            {

                type:
                    "geojson",

                data:
                    geojson

            }
        );

    }


    /* =====================================================
       Route-number source
       ===================================================== */

    if (
        map3d.getSource(
            "route-labels-3d"
        )
    ) {

        map3d
            .getSource(
                "route-labels-3d"
            )
            .setData(
                labelGeoJSON
            );

    }

    else {

        map3d.addSource(
            "route-labels-3d",
            {

                type:
                    "geojson",

                data:
                    labelGeoJSON

            }
        );

    }


    /* =====================================================
       Speed color expression
       ===================================================== */

    const speedColorExpression = [

        "case",


        [
            "==",

            [
                "get",
                "speed"
            ],

            null

        ],

        SPEED_COLORS.noData,


        [
            "<",

            [
                "get",
                "speed"
            ],

            1.5

        ],

        SPEED_COLORS.verySlow,


        [
            "<",

            [
                "get",
                "speed"
            ],

            2.5

        ],

        SPEED_COLORS.slow,


        [
            "<",

            [
                "get",
                "speed"
            ],

            3.5

        ],

        SPEED_COLORS.moderate,


        [
            "<",

            [
                "get",
                "speed"
            ],

            4.5

        ],

        SPEED_COLORS.fast,


        [
            "<",

            [
                "get",
                "speed"
            ],

            5.5

        ],

        SPEED_COLORS.veryFast,


        SPEED_COLORS.fastest

    ];


    /* =====================================================
       Route line layer
       ===================================================== */

    if (
        !map3d.getLayer(
            "routes-3d"
        )
    ) {

        map3d.addLayer({

            id:
                "routes-3d",

            type:
                "line",

            source:
                "routes-3d",

            layout: {

                "line-cap":
                    "round",

                "line-join":
                    "round"

            },

            paint: {

                "line-color":
                    speedColorExpression,

                "line-width":
                    5,

                "line-opacity":
                    0.95

            }

        });

    }


    /* =====================================================
       Route-number circle layer
       ===================================================== */

    if (
        !map3d.getLayer(
            "route-labels-3d"
        )
    ) {

        map3d.addLayer({

            id:
                "route-labels-3d",

            type:
                "circle",

            source:
                "route-labels-3d",

            paint: {

                "circle-radius":
                    13,

                "circle-color":

                    [
                        "get",
                        "color"
                    ],

                "circle-stroke-color":
                    "#ffffff",

                "circle-stroke-width":
                    2,

                "circle-opacity":
                    1

            }

        });

    }


    /* =====================================================
       Route-number text layer
       ===================================================== */

    if (
        !map3d.getLayer(
            "route-label-text-3d"
        )
    ) {

        map3d.addLayer({

            id:
                "route-label-text-3d",

            type:
                "symbol",

            source:
                "route-labels-3d",

            layout: {

                "text-field":

                    [
                        "to-string",

                        [
                            "get",
                            "number"
                        ]

                    ],

                "text-size":
                    12,

                "text-font": [
                    "Open Sans Bold"
                ],

                "text-anchor":
                    "center",

                "text-allow-overlap":
                    true,

                "text-ignore-placement":
                    true

            },

            paint: {

                "text-color":
                    "#ffffff",

                "text-halo-color":
                    "rgba(0,0,0,0.25)",

                "text-halo-width":
                    0.5

            }

        });

    }


    if (!map3d._routeEventsBound) {

    map3d._routeEventsBound = true;


    /* =====================================================
       Route hover cursor
       ===================================================== */

    map3d.on(
        "mouseenter",
        "routes-3d",
        function() {

            map3d.getCanvas()
                .style.cursor =
                "pointer";

        }
    );


    map3d.on(
        "mouseleave",
        "routes-3d",
        function() {

            map3d.getCanvas()
                .style.cursor =
                "";

        }
    );


    /* =====================================================
       Route click
       ===================================================== */

    map3d.on(
        "click",
        "routes-3d",
        function(event) {

            const feature =
                event.features?.[0];


            if (!feature) {

                return;

            }


            const properties =
                feature.properties;


            const speed =
                Number(
                    properties.speed
                );


            let html =
                `<strong>${escapeHtml(
                    properties.name || ""
                )}</strong>`;


            if (
                Number.isFinite(
                    speed
                )
            ) {

                html +=
                    `<br>سرعت: <b>${speed.toFixed(1)}</b> km/h`;

            }

            else {

                html +=
                    `<br>سرعت: بدون اطلاعات زمانی`;

            }


            const distance3D =
                Number(
                    properties.distance3D
                );


            if (
                Number.isFinite(
                    distance3D
                )
            ) {

                html +=
                    `<br>فاصله 3D: ${distance3D.toFixed(1)} m`;

            }


            new window.maplibregl.Popup()

                .setLngLat(
                    event.lngLat
                )

                .setHTML(
                    html
                )

                .addTo(
                    map3d
                );

        }
    );


    /* =====================================================
       Route-number hover cursor
       ===================================================== */

    map3d.on(
        "mouseenter",
        "route-labels-3d",
        function() {

            map3d.getCanvas()
                .style.cursor =
                "pointer";

        }
    );


    map3d.on(
        "mouseleave",
        "route-labels-3d",
        function() {

            map3d.getCanvas()
                .style.cursor =
                "";

        }
    );


    /* =====================================================
       Route-number click
       ===================================================== */

    map3d.on(
        "click",
        "route-labels-3d",
        function(event) {

            const feature =
                event.features?.[0];


            if (!feature) {

                return;

            }


            const properties =
                feature.properties;


            const number =
                Number(
                    properties.number
                );


            const name =
                properties.name || "";


            let html =
                `<strong>${number}. ${escapeHtml(
                    name
                )}</strong>`;


            new window.maplibregl.Popup()

                .setLngLat(
                    event.lngLat
                )

                .setHTML(
                    html
                )

                .addTo(
                    map3d
                );

        }
    );


    }


    /* =====================================================
       Speed legend
       ===================================================== */

    createSpeedLegend(
        document.getElementById(
            "map-3d"
        )
    );


    /* =====================================================
       Fit map to routes
       ===================================================== */

    fit3DMapToRoutes(
        results
    );

}


/* =========================================================
   Fit 3D map
   ========================================================= */

function fit3DMapToRoutes(results) {

    if (
        !map3d ||
        !map3dInitialized
    ) {

        return;

    }


    const bounds =
        new window.maplibregl.LngLatBounds();


    let hasPoints = false;


    results.forEach(
        result => {

            const points =
                result.routeData?.points;


            if (
                !points ||
                points.length === 0
            ) {

                return;

            }


            getDirectionPoints(points).forEach(
                point => {

                    if (
                        Number.isFinite(
                            point.latitude
                        ) &&
                        Number.isFinite(
                            point.longitude
                        )
                    ) {

                        bounds.extend(

                            [

                                point.longitude,

                                point.latitude

                            ]

                        );


                        hasPoints = true;

                    }

                }
            );

        }
    );


    if (!hasPoints) {

        return;

    }


    map3d.fitBounds(
        bounds,
        {

            padding:
                50,

            pitch:
                55,

            bearing:
                0,

            duration:
                800

        }
    );

}


/* =========================================================
   Clear 3D map
   ========================================================= */

function clear3DMap() {

    if (!map3d) {

        return;

    }


    /* =====================================================
       Remove route-number text layer
       ===================================================== */

    if (
        map3d.getLayer(
            "route-label-text-3d"
        )
    ) {

        map3d.removeLayer(
            "route-label-text-3d"
        );

    }


    /* =====================================================
       Remove route-number circle layer
       ===================================================== */

    if (
        map3d.getLayer(
            "route-labels-3d"
        )
    ) {

        map3d.removeLayer(
            "route-labels-3d"
        );

    }


    /* =====================================================
       Remove route-number source
       ===================================================== */

    if (
        map3d.getSource(
            "route-labels-3d"
        )
    ) {

        map3d.removeSource(
            "route-labels-3d"
        );

    }


    /* =====================================================
       Remove route line layer
       ===================================================== */

    if (
        map3d.getLayer(
            "routes-3d"
        )
    ) {

        map3d.removeLayer(
            "routes-3d"
        );

    }


    /* =====================================================
       Remove route line source
       ===================================================== */

    if (
        map3d.getSource(
            "routes-3d"
        )
    ) {

        map3d.removeSource(
            "routes-3d"
        );

    }


    /* =====================================================
       Remove speed legend
       ===================================================== */

    const legend =
        document.querySelector(
            "#map-3d .speed-legend"
        );


    if (legend) {

        legend.remove();

    }

}


/* =========================================================
   2D / 3D switch
   ========================================================= */

function show2DMap() {

    currentMapMode =
        "2d";


    document.getElementById(
        "map"
    ).style.display =
        "block";


    document.getElementById(
        "map-3d-container"
    ).style.display =
        "none";


    document.getElementById(
        "map-2d-button"
    ).classList.add(
        "active"
    );


    document.getElementById(
        "map-3d-button"
    ).classList.remove(
        "active"
    );


    initializeMap();


    setTimeout(
        () => {

            if (map) {

                map.invalidateSize();


                drawRoutesOnMap(
                    analysisResults
                );

            }

        },
        100
    );

}


/* =========================================================
   Show 3D map
   ========================================================= */

function show3DMap() {

    currentMapMode =
        "3d";


    document.getElementById(
        "map"
    ).style.display =
        "none";


    document.getElementById(
        "map-3d-container"
    ).style.display =
        "block";


    document.getElementById(
        "map-2d-button"
    ).classList.remove(
        "active"
    );


    document.getElementById(
        "map-3d-button"
    ).classList.add(
        "active"
    );


    initialize3DMap();


    setTimeout(
        () => {

            if (map3d) {

                map3d.resize();


                drawRoutesOn3DMap(
                    analysisResults
                );

            }

        },
        150
    );

}