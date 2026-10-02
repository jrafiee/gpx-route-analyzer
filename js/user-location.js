/* =========================================================
   User location on 2D (Leaflet) and 3D (MapLibre) maps
   + info panel (altitude, height to summit, distances ALONG
     the GPX track)

   - Adds location buttons (own toolbar group) next to the 2D / 3D buttons
   - Uses navigator.geolocation.watchPosition
   - Location never leaves the browser and is not stored
   - Load AFTER map-2d.js, map-3d.js and track-geometry.js
   ========================================================= */

(function () {

    "use strict";

    const state = {
        watchId: null,
        position: null,
        centerOnNextFix: false,
        signalLost: false,
        matchTrack: null,
        matchAlong: null
    };

    // track chosen by the user when several routes are loaded
    let selectedTrackName = null;

    const SRC_POINT = "user-location-point";
    const SRC_ACCURACY = "user-location-accuracy";
    const LYR_ACCURACY = "user-location-accuracy-fill";
    const LYR_DOT = "user-location-dot";

    const PANEL_ID = "user-location-panel";

    let marker2d = null;
    let circle2d = null;


    /* =====================================================
       Styles + buttons
       ===================================================== */

    function injectStyles() {

        if (document.getElementById("user-location-styles")) {
            return;
        }

        const style = document.createElement("style");

        style.id = "user-location-styles";

        style.textContent = `

        .user-location-dot {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #1a73e8;
            border: 3px solid #fff;
            box-shadow: 0 0 0 0 rgba(26, 115, 232, 0.55),
                        0 1px 4px rgba(0, 0, 0, 0.45);
            animation: user-location-pulse 2s infinite;
        }

        @keyframes user-location-pulse {
            0%   { box-shadow: 0 0 0 0 rgba(26, 115, 232, 0.55), 0 1px 4px rgba(0,0,0,.45); }
            70%  { box-shadow: 0 0 0 14px rgba(26, 115, 232, 0), 0 1px 4px rgba(0,0,0,.45); }
            100% { box-shadow: 0 0 0 0 rgba(26, 115, 232, 0), 0 1px 4px rgba(0,0,0,.45); }
        }

        `;

        document.head.appendChild(style);

    }


    function setStatus(text) {

        const element =
            document.getElementById("user-location-status");

        if (element) {
            element.textContent = text || "";
        }

    }


    function updateButtons() {

        const toggle =
            document.getElementById("user-location-button");

        const center =
            document.getElementById("user-location-center-button");

        const active = state.watchId !== null;

        if (toggle) {
            toggle.classList.toggle("active", active);
            toggle.textContent =
                active ? "⏹ توقف موقعیت" : "📍 موقعیت من";
        }

        if (center) {
            center.disabled = !state.position;
        }

        updatePanel();

    }


    function createButtons() {

        const mapButtons =
            document.querySelector(
                "#map-container .map-view-buttons"
            );

        if (
            !mapButtons ||
            document.getElementById("user-location-button")
        ) {
            return;
        }

        /*
         * Wrapper: [ 2D / 3D group ] [ location group ]
         */

        let toolbar = mapButtons.parentElement;

        if (!toolbar.classList.contains("map-toolbar")) {

            toolbar = document.createElement("div");

            toolbar.className = "map-toolbar";

            mapButtons.parentNode.insertBefore(toolbar, mapButtons);

            toolbar.appendChild(mapButtons);

        }

        const group = document.createElement("div");

        group.className = "map-location-group";

        const toggle = document.createElement("button");

        toggle.id = "user-location-button";
        toggle.type = "button";
        toggle.className = "map-view-button";
        toggle.textContent = "📍 موقعیت من";
        toggle.addEventListener("click", toggleTracking);

        const center = document.createElement("button");

        center.id = "user-location-center-button";
        center.type = "button";
        center.className = "map-view-button";
        center.textContent = "🎯 مرکز روی من";
        center.disabled = true;
        center.addEventListener("click", centerOnUser);

        const status = document.createElement("span");

        status.id = "user-location-status";
        status.className = "user-location-status";

        group.appendChild(toggle);
        group.appendChild(center);

        toolbar.appendChild(group);
        toolbar.appendChild(status);

        createPanel(toolbar);

    }


    /* =====================================================
       Geolocation
       ===================================================== */

    function toggleTracking() {

        if (state.watchId !== null) {
            stopTracking();
        } else {
            startTracking();
        }

    }


    function startTracking() {

        if (!("geolocation" in navigator)) {
            setStatus("مرورگر شما از موقعیت‌یابی پشتیبانی نمی‌کند.");
            return;
        }

        if (!window.isSecureContext) {
            setStatus("موقعیت‌یابی فقط روی HTTPS (یا localhost) کار می‌کند.");
            return;
        }

        state.centerOnNextFix = true;

        setStatus("در حال یافتن موقعیت...");

        state.watchId = navigator.geolocation.watchPosition(
            onPosition,
            onError,
            {
                enableHighAccuracy: true,
                maximumAge: 5000,
                timeout: 20000
            }
        );

        updateButtons();

    }


    function stopTracking() {

        if (state.watchId !== null) {
            navigator.geolocation.clearWatch(state.watchId);
        }

        state.watchId = null;
        state.position = null;
        state.centerOnNextFix = false;
        state.signalLost = false;
        state.matchTrack = null;
        state.matchAlong = null;

        remove2D();
        remove3D();

        setStatus("");
        updateButtons();

    }


    function onPosition(position) {

        const c = position.coords;

        state.position = {
            lat: c.latitude,
            lon: c.longitude,
            accuracy: Number.isFinite(c.accuracy) ? c.accuracy : 0,
            altitude: Number.isFinite(c.altitude) ? c.altitude : null
        };

        state.signalLost = false;

        render2D();
        render3D();

        setStatus("");
        updateButtons();

        if (state.centerOnNextFix) {
            state.centerOnNextFix = false;
            centerOnUser();
        }

    }


    function onError(error) {

        if (error.code === 1) {

            stopTracking();

            setStatus("دسترسی به موقعیت داده نشد. اجازه را در تنظیمات مرورگر فعال کنید.");

            return;

        }

        if (error.code === 2) {
            setStatus("موقعیت در دسترس نیست (GPS یا اینترنت را بررسی کنید).");
        } else {
            setStatus("زمان دریافت موقعیت تمام شد؛ در حال تلاش مجدد...");
        }

        // keep the last valid position, only flag the signal
        state.signalLost = true;
        updatePanel();

    }


    /* =====================================================
       Center
       ===================================================== */

    function centerOnUser() {

        const p = state.position;

        if (!p) {
            return;
        }

        if (
            currentMapMode === "3d" &&
            map3d &&
            map3dInitialized
        ) {

            map3d.easeTo({
                center: [p.lon, p.lat],
                zoom: Math.max(map3d.getZoom(), 13),
                pitch: 55,
                duration: 800
            });

        } else if (map) {

            map.setView(
                [p.lat, p.lon],
                Math.max(map.getZoom(), 15),
                { animate: true }
            );

        }

    }


    /* =====================================================
       2D map (Leaflet)
       ===================================================== */

    function render2D() {

        const p = state.position;

        if (!p) {
            return;
        }

        if (!map && typeof initializeMap === "function") {
            initializeMap();
        }

        if (!map) {
            return;
        }

        const latLng = [p.lat, p.lon];

        const tooltip =
            `موقعیت شما<br>دقت: ±${Math.round(p.accuracy)} متر`;

        if (!marker2d || !map.hasLayer(marker2d)) {

            circle2d = L.circle(
                latLng,
                {
                    radius: p.accuracy,
                    color: "#1a73e8",
                    weight: 1,
                    fillColor: "#1a73e8",
                    fillOpacity: 0.12,
                    interactive: false
                }
            ).addTo(map);

            marker2d = L.marker(
                latLng,
                {
                    icon: L.divIcon({
                        className: "",
                        html: '<div class="user-location-dot"></div>',
                        iconSize: [22, 22],
                        iconAnchor: [11, 11]
                    }),
                    zIndexOffset: 1000
                }
            ).addTo(map);

            marker2d.bindTooltip(
                tooltip,
                { direction: "top", offset: [0, -12] }
            );

        } else {

            marker2d.setLatLng(latLng);
            circle2d.setLatLng(latLng);
            circle2d.setRadius(p.accuracy);
            marker2d.setTooltipContent(tooltip);

        }

    }


    function remove2D() {

        if (map) {

            if (marker2d) {
                map.removeLayer(marker2d);
            }

            if (circle2d) {
                map.removeLayer(circle2d);
            }

        }

        marker2d = null;
        circle2d = null;

    }


    /* =====================================================
       3D map (MapLibre)
       ===================================================== */

    function circlePolygon(lat, lon, radiusM) {

        const steps = 64;

        const dLat = radiusM / 111320;

        const dLon =
            radiusM /
            (111320 * Math.max(Math.cos(lat * Math.PI / 180), 0.01));

        const ring = [];

        for (let i = 0; i <= steps; i++) {

            const angle = (i / steps) * 2 * Math.PI;

            ring.push([
                lon + dLon * Math.cos(angle),
                lat + dLat * Math.sin(angle)
            ]);

        }

        return {
            type: "Feature",
            properties: {},
            geometry: {
                type: "Polygon",
                coordinates: [ring]
            }
        };

    }


    function render3D() {

        const p = state.position;

        if (!p || !map3d || !map3dInitialized) {
            return;
        }

        const pointData = {
            type: "Feature",
            properties: {},
            geometry: {
                type: "Point",
                coordinates: [p.lon, p.lat]
            }
        };

        const accuracyData =
            circlePolygon(p.lat, p.lon, Math.max(p.accuracy, 1));

        if (map3d.getSource(SRC_POINT)) {

            map3d.getSource(SRC_POINT).setData(pointData);
            map3d.getSource(SRC_ACCURACY).setData(accuracyData);

        } else {

            map3d.addSource(
                SRC_ACCURACY,
                { type: "geojson", data: accuracyData }
            );

            map3d.addSource(
                SRC_POINT,
                { type: "geojson", data: pointData }
            );

            map3d.addLayer({
                id: LYR_ACCURACY,
                type: "fill",
                source: SRC_ACCURACY,
                paint: {
                    "fill-color": "#1a73e8",
                    "fill-opacity": 0.18
                }
            });

            map3d.addLayer({
                id: LYR_DOT,
                type: "circle",
                source: SRC_POINT,
                paint: {
                    "circle-radius": 8,
                    "circle-color": "#1a73e8",
                    "circle-stroke-color": "#ffffff",
                    "circle-stroke-width": 3
                }
            });

        }

        // keep the dot above the route layers
        if (map3d.getLayer(LYR_ACCURACY)) {
            map3d.moveLayer(LYR_ACCURACY);
        }

        if (map3d.getLayer(LYR_DOT)) {
            map3d.moveLayer(LYR_DOT);
        }

    }


    function remove3D() {

        if (!map3d || !map3dInitialized) {
            return;
        }

        [LYR_DOT, LYR_ACCURACY].forEach(id => {
            if (map3d.getLayer(id)) {
                map3d.removeLayer(id);
            }
        });

        [SRC_POINT, SRC_ACCURACY].forEach(id => {
            if (map3d.getSource(id)) {
                map3d.removeSource(id);
            }
        });

    }


    /* =====================================================
       Info panel (altitude / summit / distances along track)

       Reference track = the route chosen in the panel selector
       (when several routes are loaded), otherwise route #1.
       Route geometry comes from track-geometry.js (cached);
       summit / start elevation come from result.metrics.
       ===================================================== */

    function formatMeters(value) {
        return Math.round(value).toLocaleString("en-US") + " m";
    }

    function formatSignedMeters(value) {

        const rounded = Math.round(value);

        const sign =
            rounded > 0 ? "+" : (rounded < 0 ? "\u2212" : "");

        return sign + Math.abs(rounded).toLocaleString("en-US") + " m";

    }

    function formatDistance(meters) {

        return Math.round(meters) < 1000
            ? Math.round(meters) + " m"
            : (meters / 1000).toFixed(1) + " km";

    }

    function panelText(id, text) {

        const element = document.getElementById(id);

        if (element) {
            element.textContent = text;
        }

    }

    function panelHide(id, hidden) {

        const element = document.getElementById(id);

        if (element) {
            element.hidden = hidden;
        }

    }


    function createPanel(toolbar) {

        if (document.getElementById(PANEL_ID)) {
            return;
        }

        const panel = document.createElement("div");

        panel.id = PANEL_ID;
        panel.className = "user-location-panel";
        panel.hidden = true;

        panel.innerHTML = `

            <div class="ulp-header">
                <span class="ulp-title">موقعیت فعلی</span>
                <span id="ulp-route" class="ulp-route"></span>
                <select id="ulp-track" class="ulp-track"
                        aria-label="مسیر مرجع" hidden></select>
                <span id="ulp-meta" class="ulp-meta"></span>
            </div>

            <div class="ulp-grid">

                <div class="ulp-item">
                    <span class="ulp-label">ارتفاع کاربر</span>
                    <span id="ulp-altitude" class="ulp-value" dir="ltr">—</span>
                </div>

                <div class="ulp-item">
                    <span class="ulp-label">ارتفاع تا قله</span>
                    <span id="ulp-to-summit" class="ulp-value" dir="ltr">—</span>
                </div>

                <div class="ulp-item">
                    <span class="ulp-label">اختلاف از نقطه شروع</span>
                    <span id="ulp-from-start" class="ulp-value" dir="ltr">—</span>
                </div>

                <div id="ulp-item-origin" class="ulp-item" hidden>
                    <span class="ulp-label">فاصله از مبدا</span>
                    <span id="ulp-from-origin" class="ulp-value" dir="ltr">—</span>
                </div>

                <div id="ulp-item-end" class="ulp-item" hidden>
                    <span class="ulp-label">فاصله تا مقصد</span>
                    <span id="ulp-to-end" class="ulp-value" dir="ltr">—</span>
                </div>

            </div>

            <div id="ulp-offtrack" class="ulp-note" hidden></div>

        `;

        panel
            .querySelector("#ulp-track")
            .addEventListener("change", event => {

                selectedTrackName = event.target.value;

                state.matchTrack = null;
                state.matchAlong = null;

                updatePanel();

            });

        toolbar.insertAdjacentElement("afterend", panel);

    }


    function getReferenceResult() {

        if (
            typeof analysisResults === "undefined" ||
            analysisResults.length === 0
        ) {
            return null;
        }

        return analysisResults.find(
            result => result.route === selectedTrackName
        ) || analysisResults[0];

    }


    function syncTrackSelector(result) {

        const select = document.getElementById("ulp-track");
        const label = document.getElementById("ulp-route");

        if (!select || !label) {
            return;
        }

        const names =
            typeof analysisResults === "undefined"
                ? []
                : analysisResults.map(item => item.route);

        if (names.length > 1) {

            const signature = names.join("\u0001");

            if (select.dataset.signature !== signature) {

                select.innerHTML = "";

                names.forEach((name, index) => {
                    select.add(new Option(`${index + 1}. ${name}`, name));
                });

                select.dataset.signature = signature;

            }

            select.value = result.route;
            select.hidden = false;
            label.hidden = true;

        } else {

            select.hidden = true;
            label.hidden = false;
            label.textContent = result ? result.route : "";

        }

    }


    function updatePanel() {

        const panel = document.getElementById(PANEL_ID);

        if (!panel) {
            return;
        }

        const active = state.watchId !== null;

        panel.hidden = !active;

        if (!active) {
            return;
        }

        const p = state.position;
        const result = getReferenceResult();

        syncTrackSelector(result);

        /* status line */

        let meta;

        if (state.signalLost) {
            meta = p
                ? "⚠ سیگنال GPS ضعیف · آخرین موقعیت معتبر"
                : "⚠ موقعیت در دسترس نیست";
        } else if (!p) {
            meta = "در حال یافتن موقعیت...";
        } else {
            meta = `دقت ±${Math.round(p.accuracy)} m`;
        }

        panelText("ulp-meta", meta);

        document
            .getElementById("ulp-meta")
            .classList.toggle("warn", state.signalLost);

        /* elevations */

        const altitude =
            p && Number.isFinite(p.altitude) ? p.altitude : null;

        const metrics = result ? result.metrics : null;

        const summit =
            metrics ? Number(metrics["Maximum Elevation (m)"]) : NaN;

        const startElevation =
            metrics ? Number(metrics["Start Elevation (m)"]) : NaN;

        panelText(
            "ulp-altitude",
            altitude === null ? "—" : formatMeters(altitude)
        );

        panelText(
            "ulp-to-summit",
            altitude !== null && Number.isFinite(summit)
                ? formatMeters(Math.max(0, summit - altitude))
                : "—"
        );

        panelText(
            "ulp-from-start",
            altitude !== null && Number.isFinite(startElevation)
                ? formatSignedMeters(altitude - startElevation)
                : "—"
        );

        /* distances along the track */

        let projection = null;
        let onTrack = false;

        if (p && result) {

            const geometry = getTrackGeometry(result);

            if (geometry) {

                const previous =
                    state.matchTrack === result
                        ? state.matchAlong
                        : null;

                projection =
                    projectOnTrack(geometry, p.lat, p.lon, previous);

                onTrack = isUserOnTrack(projection, p.accuracy);

                if (onTrack) {
                    state.matchTrack = result;
                    state.matchAlong = projection.along;
                }

            }

        }

        panelHide("ulp-item-origin", !onTrack);
        panelHide("ulp-item-end", !onTrack);

        if (onTrack) {
            panelText("ulp-from-origin", formatDistance(projection.along));
            panelText("ulp-to-end", formatDistance(projection.remaining));
        }

        const note = document.getElementById("ulp-offtrack");

        if (note) {

            const offTrack = !!projection && !onTrack;

            note.hidden = !offTrack;

            if (offTrack) {
                note.textContent =
                    `خارج از مسیر · ${formatDistance(projection.distance)} تا مسیر`;
            }

        }

    }


    /* =====================================================
       Hooks: redraw the location after routes are redrawn
       ===================================================== */

    function hook(name, after) {

        const original = window[name];

        if (typeof original !== "function") {
            return;
        }

        window[name] = function () {

            const result = original.apply(this, arguments);

            after();

            return result;

        };

    }


    function initialize() {

        injectStyles();

        createButtons();

        hook("drawRoutesOnMap", function () {
            render2D();
            updatePanel();
        });

        hook("drawRoutesOn3DMap", render3D);

    }


    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }

})();
