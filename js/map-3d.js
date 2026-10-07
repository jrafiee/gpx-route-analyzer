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

        // own copy first (vendor/maplibre/), CDN as a fallback
        const localBase =
            new URL("vendor/maplibre/", document.baseURI).href;

        const cdnBase =
            `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/`;

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
                .catch(
                    () => import(cdnBase + "maplibre-gl.mjs")
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


function createMap3D() {

    if (
        map3dInitialized
    ) {

        return;

    }


    if (
        !window.maplibregl
    ) {

        console.error(
            "MapLibre GL JS is not loaded."
        );

        return;

    }


    map3d =
        new window.maplibregl.Map({

            container:
                "map-3d",

            center:
                [51.5, 32.0],

            zoom:
                7,

            pitch:
                55,

            bearing:
                0,

            maxPitch:
                85,

            style: {

                version:
                    8,


                /*
                 * Glyphs are required for the route-number
                 * symbol layer.
                 */

                glyphs:
                    "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",


                sources: {

                    osm: {

                        type:
                            "raster",

                        tiles: [
                            "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                        ],

                        tileSize:
                            256,

                        maxzoom:
                            19,

                        attribution:
                            "&copy; OpenStreetMap contributors"

                    },


                    terrainSource: {

                        type:
                            "raster-dem",

                        url:
                            "https://tiles.mapterhorn.com/tilejson.json",

                        tileSize:
                            256

                    },


                    hillshadeSource: {

                        type:
                            "raster-dem",

                        url:
                            "https://tiles.mapterhorn.com/tilejson.json",

                        tileSize:
                            256

                    }

                },


                layers: [

                    {

                        id:
                            "osm",

                        type:
                            "raster",

                        source:
                            "osm"

                    },


                    {

                        id:
                            "hillshade",

                        type:
                            "hillshade",

                        source:
                            "hillshadeSource",

                        paint: {

                            "hillshade-exaggeration":
                                0.35

                        }

                    }

                ]

            }

        });


    map3d.on(
        "load",
        function() {

            map3d.setTerrain({

                source:
                    "terrainSource",

                exaggeration:
                    1.4

            });


            map3dInitialized =
                true;


            drawRoutesOn3DMap(
                analysisResults
            );

        }
    );


    map3d.on(
        "error",
        function(event) {

            console.error(
                "3D map error:",
                event
            );

        }
    );

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