/* =========================================================
   3D Map initialization
   ========================================================= */

function initialize3DMap() {

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


    const features = [];


    for (
        let i = 0;
        i < points.length - 1;
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


    const features = [];


    results.forEach(
        result => {

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

        }
    );


    const geojson = {

        type:
            "FeatureCollection",

        features:
            features

    };


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
                    Number.isFinite(speed)
                ) {

                    html +=
                        `<br>سرعت: <b>${speed.toFixed(1)}</b> km/h`;

                } else {

                    html +=
                        `<br>سرعت: بدون اطلاعات زمانی`;

                }


                const distance3D =
                    Number(
                        properties.distance3D
                    );


                if (
                    Number.isFinite(distance3D)
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

    }


    createSpeedLegend(
        document.getElementById(
            "map-3d"
        )
    );


    fit3DMapToRoutes(
        results
    );

}


/* =========================================================
   Fit map
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


            points.forEach(
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


    if (
        map3d.getLayer(
            "routes-3d"
        )
    ) {

        map3d.removeLayer(
            "routes-3d"
        );

    }


    if (
        map3d.getSource(
            "routes-3d"
        )
    ) {

        map3d.removeSource(
            "routes-3d"
        );

    }


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