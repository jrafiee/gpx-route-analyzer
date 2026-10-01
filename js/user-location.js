/* =========================================================
   User location on 2D (Leaflet) and 3D (MapLibre) maps

   - Adds two buttons next to the 2D / 3D map buttons
   - Uses navigator.geolocation.watchPosition
   - Location never leaves the browser and is not stored
   - Load this file AFTER map-2d.js and map-3d.js
   ========================================================= */

(function () {

    "use strict";

    const state = {
        watchId: null,
        position: null,
        centerOnNextFix: false
    };

    const SRC_POINT = "user-location-point";
    const SRC_ACCURACY = "user-location-accuracy";
    const LYR_ACCURACY = "user-location-accuracy-fill";
    const LYR_DOT = "user-location-dot";

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

        .map-view-buttons {
            flex-wrap: wrap;
            align-items: center;
        }

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

        .user-location-status {
            font-size: 12px;
            color: #777;
            margin-right: 4px;
        }

        body.dark-mode .user-location-status {
            color: #aaa;
        }

        .map-view-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
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
                active ? "📍 توقف نمایش موقعیت" : "📍 موقعیت من";
        }

        if (center) {
            center.disabled = !state.position;
        }

    }


    function createButtons() {

        const container =
            document.querySelector(
                "#map-container .map-view-buttons"
            );

        if (
            !container ||
            document.getElementById("user-location-button")
        ) {
            return;
        }

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

        container.appendChild(toggle);
        container.appendChild(center);
        container.appendChild(status);

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

        render2D();
        render3D();

        let text = `دقت: ±${Math.round(state.position.accuracy)} متر`;

        if (state.position.altitude !== null) {
            text += ` · ارتفاع: ${Math.round(state.position.altitude)} m`;
        }

        setStatus(text);
        updateButtons();

        if (state.centerOnNextFix) {
            state.centerOnNextFix = false;
            centerOnUser();
        }

    }


    function onError(error) {

        if (error.code === 1) {

            setStatus("دسترسی به موقعیت داده نشد. اجازه را در تنظیمات مرورگر فعال کنید.");
            stopTracking();

            setStatus("دسترسی به موقعیت داده نشد. اجازه را در تنظیمات مرورگر فعال کنید.");

            return;

        }

        if (error.code === 2) {
            setStatus("موقعیت در دسترس نیست (GPS یا اینترنت را بررسی کنید).");
            return;
        }

        setStatus("زمان دریافت موقعیت تمام شد؛ در حال تلاش مجدد...");

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

        hook("drawRoutesOnMap", render2D);

        hook("drawRoutesOn3DMap", render3D);

    }


    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }

})();
