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
                zoomControl: true,

                /* thousands of short segments: canvas instead of SVG nodes */
                preferCanvas: true
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

                crossOrigin: true,

                attribution:
                    "&copy; OpenStreetMap contributors"
            }
        );


    const topoLayer =
        L.tileLayer(
            "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 17,

                crossOrigin: true,

                attribution:
                    "Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap"
            }
        );


    const satelliteLayer =
        L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            {
                maxZoom: 19,

                crossOrigin: true,

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

/*
 * Consecutive segments with the same speed colour are drawn as ONE
 * polyline (10-20x fewer layers). The tooltip describes the whole
 * run: average speed and its 3D length.
 */

function buildRunTooltip(label, run) {

    let text = label;

    if (run.speedCount > 0) {
        text += `<br>سرعت (میانگین): <b>${(run.speedSum / run.speedCount).toFixed(1)}</b> km/h`;
    } else {
        text += `<br>سرعت: بدون اطلاعات زمانی`;
    }

    if (run.distance3D > 0) {
        text += run.distance3D >= 1000
            ? `<br>طول بخش (3D): ${(run.distance3D / 1000).toFixed(2)} km`
            : `<br>طول بخش (3D): ${run.distance3D.toFixed(0)} m`;
    }

    return text;

}


function drawSpeedRuns(points, range, speedSegments, label, bounds) {

    let run = null;

    function flush() {

        if (!run) {
            return;
        }

        const info = run;

        const line =
            L.polyline(
                info.latLngs,
                {
                    color: info.color,
                    weight: 4,
                    opacity: 0.9,
                    lineJoin: "round",
                    lineCap: "round"
                }
            ).addTo(map);

        line.bindTooltip(
            () => buildRunTooltip(label, info),
            {
                sticky: true,
                direction: "top"
            }
        );

        mapLayers.push(line);

        run = null;

    }

    bounds.extend([
        points[range.start].latitude,
        points[range.start].longitude
    ]);

    for (let i = range.start; i < range.end; i++) {

        const point1 = points[i];
        const point2 = points[i + 1];
        const segment = speedSegments[i];

        const color =
            getSpeedColor(segment ? segment.speed : null);

        if (!run || run.color !== color) {

            flush();

            run = {
                color: color,
                latLngs: [[point1.latitude, point1.longitude]],
                speedSum: 0,
                speedCount: 0,
                distance3D: 0
            };

        }

        const latLng = [point2.latitude, point2.longitude];

        run.latLngs.push(latLng);

        bounds.extend(latLng);

        if (segment) {

            if (Number.isFinite(segment.speed)) {
                run.speedSum += segment.speed;
                run.speedCount++;
            }

            if (Number.isFinite(segment.distance3D)) {
                run.distance3D += segment.distance3D;
            }

        }

    }

    flush();

}


function drawRoutesOnMap(results) {

    initializeMap();

    clearMap();


    const bounds =
        L.latLngBounds([]);


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


            // cached per route (see speed.js)
            const speedSegments =
                calculateRouteSpeeds(
                    points
                );


            const range =
                getDirectionPointRange(points);


            const label =
                `${index + 1}. ${escapeHtml(result.route)}`;


            drawSpeedRuns(
                points,
                range,
                speedSegments,
                label,
                bounds
            );


            const firstPoint =
                points[range.markerIndex];


            const markerColor =
                ROUTE_COLORS[
                    index %
                    ROUTE_COLORS.length
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
                    [
                        firstPoint.latitude,
                        firstPoint.longitude
                    ],
                    {
                        icon:
                            routeIcon
                    }
                ).addTo(
                    map
                );


            startMarker.bindTooltip(
                label,
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


    if (bounds.isValid()) {

        fitMapToBounds(bounds);

    } else {

        map._needsFit = false;

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


/* =========================================================
   Fit map to routes
   When the map section is hidden (e.g. right after a page
   refresh) the container has zero size and fitBounds would
   compute a wrong zoom. In that case the fit is postponed
   until the map section is shown (applyPendingMapFit).
   ========================================================= */

function fitMapToBounds(bounds) {

    if (!map || !bounds || !bounds.isValid()) {
        return;
    }

    map._routeBounds = bounds;

    const size = map.getSize();

    if (size.x > 0 && size.y > 0) {

        map.fitBounds(bounds, { padding: [30, 30] });

        map._needsFit = false;

    } else {

        map._needsFit = true;

    }

}


function applyPendingMapFit() {

    if (!map || !map._needsFit || !map._routeBounds) {
        return;
    }

    map.invalidateSize();

    const size = map.getSize();

    if (size.x > 0 && size.y > 0) {

        map.fitBounds(map._routeBounds, { padding: [30, 30] });

        map._needsFit = false;

    }

}
