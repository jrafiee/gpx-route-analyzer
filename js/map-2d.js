/* =========================================================
   2D Map
   ========================================================= */

function initializeMap() {

    if (map) {

        return;

    }


    map =
        L.map(
            "map",
            {
                zoomControl: true
            }
        );


    initializeMapLayers();


    map.setView(
        [32.0, 51.5],
        7
    );

}


/* =========================================================
   Base layers
   ========================================================= */

function initializeMapLayers() {

    const osmLayer =
        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,

                attribution:
                    "&copy; OpenStreetMap contributors"
            }
        );


    const topoLayer =
        L.tileLayer(
            "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 17,

                attribution:
                    "Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap"
            }
        );


    const satelliteLayer =
        L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            {
                maxZoom: 19,

                attribution:
                    "Tiles &copy; Esri"
            }
        );


    osmLayer.addTo(
        map
    );


    const baseMaps = {

        "خیابانی":
            osmLayer,

        "توپوگرافی":
            topoLayer,

        "ماهواره‌ای":
            satelliteLayer

    };


    L.control.layers(
        baseMaps,
        null,
        {
            position: "topright",
            collapsed: false
        }
    ).addTo(
        map
    );


    map._baseLayers = {

        osm:
            osmLayer,

        topo:
            topoLayer,

        satellite:
            satelliteLayer

    };

}


/* =========================================================
   Clear map
   ========================================================= */

function clearMap() {

    if (!map) {

        return;

    }


    mapLayers.forEach(
        layer => {

            map.removeLayer(
                layer
            );

        }
    );


    mapLayers = [];

}


/* =========================================================
   Draw routes
   ========================================================= */

function drawRoutesOnMap(results) {

    initializeMap();

    clearMap();


    const bounds =
        L.latLngBounds([]);


    const routeColors = [

        "#e53935",
        "#1e88e5",
        "#43a047",
        "#fb8c00",
        "#8e24aa",
        "#00acc1",
        "#6d4c41",
        "#3949ab",
        "#f4511e",
        "#00897b"

    ];


    results.forEach(
        (result, index) => {

            const points =
                result.routeData?.points;


            if (
                !points ||
                points.length < 2
            ) {

                return;

            }


            const speedSegments =
                calculateRouteSpeeds(
                    points
                );


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


                const latLngs = [

                    [
                        point1.latitude,
                        point1.longitude
                    ],

                    [
                        point2.latitude,
                        point2.longitude
                    ]

                ];


                const speed =
                    segment
                        ? segment.speed
                        : null;


                const line =
                    L.polyline(
                        latLngs,
                        {

                            color:
                                getSpeedColor(
                                    speed
                                ),

                            weight:
                                4,

                            opacity:
                                0.9,

                            lineJoin:
                                "round",

                            lineCap:
                                "round"

                        }
                    ).addTo(
                        map
                    );


                let tooltipText =
                    `${index + 1}. ${escapeHtml(result.route)}`;


                if (
                    speed !== null &&
                    Number.isFinite(speed)
                ) {

                    tooltipText +=
                        `<br>سرعت: <b>${speed.toFixed(1)}</b> km/h`;

                } else {

                    tooltipText +=
                        `<br>سرعت: بدون اطلاعات زمانی`;

                }


                if (
                    segment &&
                    Number.isFinite(
                        segment.distance3D
                    )
                ) {

                    tooltipText +=
                        `<br>فاصله 3D: ${segment.distance3D.toFixed(1)} m`;

                }


                line.bindTooltip(
                    tooltipText,
                    {
                        sticky: true,
                        direction: "top"
                    }
                );


                mapLayers.push(
                    line
                );


                bounds.extend(
                    latLngs[0]
                );


                bounds.extend(
                    latLngs[1]
                );

            }


            const firstPoint =
                points[0];


            const startLatLng = [

                firstPoint.latitude,
                firstPoint.longitude

            ];


            const markerColor =
                routeColors[
                    index %
                    routeColors.length
                ];


            const routeIcon =
                L.divIcon({

                    className: "",

                    html:
                        `<div
                            class="route-map-marker"
                            style="background:${markerColor};"
                        >
                            ${index + 1}
                        </div>`,

                    iconSize:
                        [26, 26],

                    iconAnchor:
                        [13, 13],

                    popupAnchor:
                        [0, -13]

                });


            const startMarker =
                L.marker(
                    startLatLng,
                    {
                        icon:
                            routeIcon
                    }
                ).addTo(
                    map
                );


            startMarker.bindTooltip(
                `${index + 1}. ${escapeHtml(result.route)}`,
                {
                    direction: "top",
                    offset: [0, -10]
                }
            );


            mapLayers.push(
                startMarker
            );

        }
    );


    createSpeedLegend(
        document.getElementById(
            "map"
        )
    );


    if (
        bounds.isValid()
    ) {

        map.fitBounds(
            bounds,
            {
                padding:
                    [30, 30]
            }
        );

    }


    setTimeout(
        () => {

            if (map) {

                map.invalidateSize();

            }

        },
        100
    );

}