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
        matchAlong: null,
        dir: 1            // 1 = outbound (along grows), -1 = return
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

    /* navigation screen state */
    let navOpen = false;
    let pocketOpen = false;
    let navMap = null;
    let navUserMarker = null;
    let navAccuracy = null;
    let navRouteLine = null;
    let navOffLine = null;
    let navTrackedName = null;
    let navHistoryPushed = false;
    let wakeLock = null;
    let audioCtx = null;
    let lastPocketTap = 0;

    const NAV_THRESHOLDS = [10, 15, 25, 40, 60];
    const navAlert = { off: false, last: 0 };

    /* low-vision options (saved) */

    const NAV_FONT_STEPS = [1, 1.2, 1.4, 1.6];

    function readNavPref(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function writeNavPref(key, value) {
        try { localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ }
    }

    let navFontStep = (function () {
        const v = Number(readNavPref("nav-font-step"));
        return Number.isInteger(v) && v >= 0 && v < NAV_FONT_STEPS.length ? v : 0;
    })();

    let navLight = readNavPref("nav-theme") === "light";

    let navThreshold = (function () {
        try {
            const v = Number(localStorage.getItem("nav-threshold"));
            return NAV_THRESHOLDS.includes(v) ? v : 25;
        } catch (e) {
            return 25;
        }
    })();


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

        if (text && navOpen) {
            setNavStatus("wait", text, "");
        }

    }


    function updateButtons() {

        const nav =
            document.getElementById("user-location-button");

        if (nav) {
            nav.classList.toggle("active", navOpen);
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

        let toolbar = mapButtons.parentElement;

        if (!toolbar.classList.contains("map-toolbar")) {

            toolbar = document.createElement("div");

            toolbar.className = "map-toolbar";

            mapButtons.parentNode.insertBefore(toolbar, mapButtons);

            toolbar.appendChild(mapButtons);

        }

        const group = document.createElement("div");

        group.className = "map-location-group";

        const nav = document.createElement("button");

        nav.id = "user-location-button";
        nav.type = "button";
        nav.className = "map-view-button";
        nav.textContent = "🧭 ناوبری";
        nav.addEventListener("click", openNav);

        const status = document.createElement("span");

        status.id = "user-location-status";
        status.className = "user-location-status";

        group.appendChild(nav);

        toolbar.appendChild(group);
        toolbar.appendChild(status);

        createPanel(toolbar);
        createNavScreen();

    }


    /* =====================================================
       Geolocation
       ===================================================== */

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

        state.dir = 1;
        navAlert.off = false;
        navAlert.last = 0;
        removeNavUser();

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

    function setProgress(prefix, fraction) {

        const fill = document.getElementById(prefix + "-fill");
        const pct = document.getElementById(prefix + "-pct");

        const ok = Number.isFinite(fraction);
        const f = ok ? Math.min(1, Math.max(0, fraction)) : 0;

        if (fill) {
            fill.style.width = (f * 100) + "%";
        }

        if (pct) {
            pct.textContent = ok ? Math.round(f * 100) + "%" : "—";
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

                <div id="ulp-item-climb" class="ulp-item ulp-progress ulp-climb">
                    <div class="ulp-prog-head">
                        <span class="ulp-label">پیشروی ارتفاعی</span>
                        <span id="ulp-climb-pct" class="ulp-prog-pct" dir="ltr">—</span>
                    </div>
                    <div class="ulp-bar" dir="ltr"><div id="ulp-climb-fill" class="ulp-bar-fill"></div></div>
                    <div class="ulp-prog-foot" dir="ltr">
                        <span><small dir="rtl">اختلاف از نقطه شروع</small><b id="ulp-from-start">—</b></span>
                        <span><small dir="rtl">ارتفاع تا قله</small><b id="ulp-to-summit">—</b></span>
                    </div>
                </div>

                <div id="ulp-item-origin" class="ulp-item ulp-progress ulp-dist" hidden>
                    <div class="ulp-prog-head">
                        <span class="ulp-label">پیشروی مسیر</span>
                        <span id="ulp-dist-pct" class="ulp-prog-pct" dir="ltr">—</span>
                    </div>
                    <div class="ulp-bar" dir="ltr"><div id="ulp-dist-fill" class="ulp-bar-fill"></div></div>
                    <div class="ulp-prog-foot" dir="ltr">
                        <span><small dir="rtl">فاصله از مبدا</small><b id="ulp-from-origin">—</b></span>
                        <span><small dir="rtl">فاصله تا مقصد</small><b id="ulp-to-end">—</b></span>
                    </div>
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

        // the panel lives inside the navigation screen (see createNavScreen)
        document.body.appendChild(panel);

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

        setProgress(
            "ulp-climb",
            altitude !== null &&
            Number.isFinite(summit) &&
            Number.isFinite(startElevation) &&
            summit > startElevation
                ? (altitude - startElevation) / (summit - startElevation)
                : null
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
                    if (
                        state.matchTrack === result &&
                        state.matchAlong !== null
                    ) {
                        const delta = projection.along - state.matchAlong;

                        if (Math.abs(delta) > 8) {
                            state.dir = delta > 0 ? 1 : -1;
                        }
                    }

                    state.matchTrack = result;
                    state.matchAlong = projection.along;
                }

            }

        }

        panelHide("ulp-item-origin", !onTrack);

        if (onTrack) {
            panelText("ulp-from-origin", formatDistance(projection.along));
            panelText("ulp-to-end", formatDistance(projection.remaining));

            setProgress(
                "ulp-dist",
                projection.total > 0 ? projection.along / projection.total : null
            );
        }

        updateNavigation(projection, onTrack, p, result);

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
       Navigation screen (full screen, always dark)

       - status box: on track / deviation (distance + side)
       - the info panel (altitude, climb, progress...) is
         moved into this screen and shown large
       - mini map with the route and the user
       - deviation sensitivity buttons
       - pocket mode (mobile): black screen + voice alerts
       ===================================================== */

    function setNavStatus(kind, main, sub) {

        const box = document.getElementById("nav-status");

        if (!box) {
            return;
        }

        box.className = "nav-status nav-" + kind;

        panelText("nav-status-main", main);
        panelText("nav-status-sub", sub || "");

    }


    function applyNavAppearance() {

        const screen = document.getElementById("nav-screen");

        if (!screen) {
            return;
        }

        screen.style.setProperty("--nav-scale", String(NAV_FONT_STEPS[navFontStep]));
        screen.classList.toggle("nav-light", navLight);

        const minus = document.getElementById("nav-font-minus");
        const plus = document.getElementById("nav-font-plus");
        const sun = document.getElementById("nav-sun-btn");

        if (minus) {
            minus.disabled = navFontStep <= 0;
        }

        if (plus) {
            plus.disabled = navFontStep >= NAV_FONT_STEPS.length - 1;
        }

        if (sun) {
            sun.classList.toggle("active", navLight);
            sun.setAttribute("aria-pressed", navLight ? "true" : "false");
            sun.textContent = navLight ? "🌙 شب" : "☀️ آفتاب";
        }

    }


    function changeNavFont(delta) {

        const next = Math.min(
            NAV_FONT_STEPS.length - 1,
            Math.max(0, navFontStep + delta)
        );

        if (next === navFontStep) {
            return;
        }

        navFontStep = next;

        writeNavPref("nav-font-step", navFontStep);

        applyNavAppearance();

    }


    function toggleNavLight() {

        navLight = !navLight;

        writeNavPref("nav-theme", navLight ? "light" : "dark");

        applyNavAppearance();

    }


    function createNavScreen() {

        if (document.getElementById("nav-screen")) {
            return;
        }

        const screen = document.createElement("div");

        screen.id = "nav-screen";
        screen.className = "nav-screen";
        screen.hidden = true;

        screen.innerHTML = `

            <div class="nav-top">
                <div class="nav-title">🧭 ناوبری</div>
                <div class="nav-tools">
                    <button id="nav-font-minus" type="button" class="nav-btn"
                            title="کوچک‌تر کردن نوشته" aria-label="کوچک‌تر کردن نوشته">A−</button>
                    <button id="nav-font-plus" type="button" class="nav-btn"
                            title="بزرگ‌تر کردن نوشته" aria-label="بزرگ‌تر کردن نوشته">A+</button>
                    <button id="nav-sun-btn" type="button" class="nav-btn nav-sun"
                            aria-pressed="false">☀️ آفتاب</button>
                </div>
                <div class="nav-actions">
                    <button id="nav-pocket-btn" type="button"
                            class="nav-btn nav-pocket-btn">🔒 حالت جیب</button>
                    <button id="nav-close-btn" type="button"
                            class="nav-btn nav-close">✕ خروج</button>
                </div>
            </div>

            <div id="nav-status" class="nav-status nav-wait" role="status" aria-live="polite">
                <div id="nav-status-main" class="nav-status-main">در حال یافتن موقعیت...</div>
                <div id="nav-status-sub" class="nav-status-sub"></div>
            </div>

            <div class="nav-body">

                <div class="nav-info">
                    <div id="nav-panel-slot"></div>
                </div>

                <div class="nav-map-col">
                    <div id="nav-map" class="nav-map"></div>
                    <div class="nav-sens">
                        <div class="nav-sens-title">حساسیت هشدار انحراف از مسیر</div>
                        <div id="nav-sens-buttons" class="nav-sens-buttons"></div>
                    </div>
                </div>

            </div>

        `;

        document.body.appendChild(screen);

        const panel = document.getElementById(PANEL_ID);

        if (panel) {
            document.getElementById("nav-panel-slot").appendChild(panel);
        }

        document
            .getElementById("nav-close-btn")
            .addEventListener("click", () => closeNav(false));

        document
            .getElementById("nav-pocket-btn")
            .addEventListener("click", openPocket);

        document
            .getElementById("nav-font-minus")
            .addEventListener("click", () => changeNavFont(-1));

        document
            .getElementById("nav-font-plus")
            .addEventListener("click", () => changeNavFont(1));

        document
            .getElementById("nav-sun-btn")
            .addEventListener("click", toggleNavLight);

        applyNavAppearance();

        renderSensitivityButtons();

        /* pocket screen */

        const pocket = document.createElement("div");

        pocket.id = "pocket-screen";
        pocket.className = "pocket-screen";
        pocket.hidden = true;

        pocket.innerHTML =
            '<div class="pocket-hint">برای خروج از حالت جیب، دو بار سریع لمس کنید</div>';

        pocket.addEventListener("click", () => {

            const now = Date.now();

            if (now - lastPocketTap < 450) {
                closePocket();
            }

            lastPocketTap = now;

        });

        document.body.appendChild(pocket);

        window.addEventListener("popstate", () => {

            if (navOpen) {
                closeNav(true);
            }

        });

        document.addEventListener("visibilitychange", () => {

            if (!document.hidden && navOpen) {
                requestWakeLock();
            }

        });

    }


    function renderSensitivityButtons() {

        const holder = document.getElementById("nav-sens-buttons");

        if (!holder) {
            return;
        }

        holder.innerHTML = "";

        NAV_THRESHOLDS.forEach(value => {

            const button = document.createElement("button");

            button.type = "button";
            button.className =
                "nav-sens-btn" + (value === navThreshold ? " active" : "");
            button.textContent = value + " متر";

            button.addEventListener("click", () => {

                navThreshold = value;

                try {
                    localStorage.setItem("nav-threshold", String(value));
                } catch (e) { /* ignore */ }

                renderSensitivityButtons();
                updatePanel();

            });

            holder.appendChild(button);

        });

    }


    function openNav() {

        if (navOpen) {
            return;
        }

        navOpen = true;

        document.getElementById("nav-screen").hidden = false;
        document.body.classList.add("nav-open");

        try {
            history.pushState({ navScreen: true }, "");
            navHistoryPushed = true;
        } catch (e) {
            navHistoryPushed = false;
        }

        if (state.watchId === null) {
            startTracking();
        }

        initNavMap();

        requestWakeLock();

        updateButtons();

    }


    function closeNav(fromPopState) {

        if (!navOpen) {
            return;
        }

        closePocket();

        navOpen = false;

        document.getElementById("nav-screen").hidden = true;
        document.body.classList.remove("nav-open");

        stopTracking();

        destroyNavMap();

        releaseWakeLock();

        if (navHistoryPushed) {

            navHistoryPushed = false;

            if (!fromPopState) {
                history.back();
            }

        }

        updateButtons();

    }


    /* ---------- wake lock / audio ---------- */

    async function requestWakeLock() {

        try {

            if ("wakeLock" in navigator && !wakeLock) {

                wakeLock = await navigator.wakeLock.request("screen");

                wakeLock.addEventListener("release", () => {
                    wakeLock = null;
                });

            }

        } catch (e) { /* not supported / denied */ }

    }


    function releaseWakeLock() {

        try {

            if (wakeLock) {
                wakeLock.release();
            }

        } catch (e) { /* ignore */ }

        wakeLock = null;

    }


    function getAudio() {

        try {

            if (!audioCtx) {

                const Ctx = window.AudioContext || window.webkitAudioContext;

                if (Ctx) {
                    audioCtx = new Ctx();
                }

            }

            if (audioCtx && audioCtx.state === "suspended") {
                audioCtx.resume();
            }

        } catch (e) { /* ignore */ }

        return audioCtx;

    }


    function beep(count) {

        const ctx = getAudio();

        if (!ctx) {
            return;
        }

        for (let i = 0; i < count; i++) {

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.frequency.value = 880;
            gain.gain.value = 0.4;

            osc.connect(gain);
            gain.connect(ctx.destination);

            const t = ctx.currentTime + i * 0.4;

            osc.start(t);
            osc.stop(t + 0.22);

        }

    }


    /*
     * Spoken alert.
     *  - Persian voice available -> Persian text
     *  - otherwise -> English-voice fallback text ("chap" / "raast" /
     *    "dorost shod")
     *  - no speech support at all -> beeps (1 = left, 2 = right)
     */

    function speakAlert(text, beepCount, fallbackText) {

        try {

            if ("speechSynthesis" in window) {

                const voices = window.speechSynthesis.getVoices();

                const fa = voices.find(v => /^fa/i.test(v.lang));

                const en = voices.find(v => /^en/i.test(v.lang));

                const utterance = new SpeechSynthesisUtterance(
                    fa ? text : (fallbackText || text)
                );

                if (fa) {
                    utterance.lang = "fa-IR";
                    utterance.voice = fa;
                } else {
                    utterance.lang = "en-US";

                    if (en) {
                        utterance.voice = en;
                    }
                }

                utterance.rate = 0.9;
                utterance.volume = 1;

                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(utterance);

                return;

            }

        } catch (e) { /* fall through to beeps */ }

        beep(beepCount);

    }


    /* ---------- pocket mode ---------- */

    function openPocket() {

        if (!navOpen || window.innerWidth > 900) {
            return;
        }

        pocketOpen = true;

        document.getElementById("pocket-screen").hidden = false;

        getAudio();

        requestWakeLock();

        speakAlert("حالت جیب فعال شد", 1, "pocket mode on");

    }


    function closePocket() {

        if (!pocketOpen) {
            return;
        }

        pocketOpen = false;

        document.getElementById("pocket-screen").hidden = true;

        try {
            window.speechSynthesis.cancel();
        } catch (e) { /* ignore */ }

    }


    /* ---------- navigation map ---------- */

    function initNavMap() {

        if (navMap || typeof L === "undefined") {
            return;
        }

        navMap = L.map("nav-map", {
            zoomControl: true,
            attributionControl: false
        });

        const topo = L.tileLayer(
            "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
            { maxZoom: 17, crossOrigin: true }
        );

        const sat = L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            { maxZoom: 19, crossOrigin: true }
        );

        const osm = L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            { maxZoom: 19, crossOrigin: true }
        );

        topo.addTo(navMap);

        L.control.layers(
            {
                "توپوگرافی": topo,
                "ماهواره‌ای": sat,
                "خیابانی": osm
            },
            null,
            { position: "topright", collapsed: true }
        ).addTo(navMap);

        navMap.setView([32.0, 51.5], 7);

        drawNavRoute(true);

        setTimeout(() => {

            if (navMap) {
                navMap.invalidateSize();
            }

        }, 150);

    }


    function drawNavRoute(fit) {

        if (!navMap) {
            return;
        }

        if (navRouteLine) {
            navMap.removeLayer(navRouteLine);
            navRouteLine = null;
        }

        const result = getReferenceResult();

        navTrackedName = result ? result.route : null;

        const points = result && result.routeData
            ? result.routeData.points
            : null;

        if (!points || points.length < 2) {
            return;
        }

        navRouteLine = L.polyline(
            points.map(point => [point.latitude, point.longitude]),
            { color: "#4da3ff", weight: 5, opacity: 0.95 }
        ).addTo(navMap);

        if (fit && !navUserMarker) {
            navMap.fitBounds(navRouteLine.getBounds(), { padding: [20, 20] });
        }

    }


    function renderNavMap(p, projection, off) {

        if (!navMap || !p) {
            return;
        }

        const latLng = [p.lat, p.lon];

        if (!navUserMarker) {

            navAccuracy = L.circle(latLng, {
                radius: p.accuracy,
                color: "#1a73e8",
                weight: 1,
                fillColor: "#1a73e8",
                fillOpacity: 0.12,
                interactive: false
            }).addTo(navMap);

            navUserMarker = L.marker(latLng, {
                icon: L.divIcon({
                    className: "",
                    html: '<div class="user-location-dot"></div>',
                    iconSize: [22, 22],
                    iconAnchor: [11, 11]
                }),
                zIndexOffset: 1000
            }).addTo(navMap);

            navMap.setView(latLng, 16);

        } else {

            navUserMarker.setLatLng(latLng);
            navAccuracy.setLatLng(latLng);
            navAccuracy.setRadius(p.accuracy);

            if (!navMap.getBounds().pad(-0.2).contains(latLng)) {
                navMap.panTo(latLng);
            }

        }

        /* dashed line from the user to the nearest point of the track */

        if (projection && projection.point && projection.distance > 3) {

            const line = [
                latLng,
                [projection.point.lat, projection.point.lon]
            ];

            const style = {
                color: off ? "#ff5252" : "#4cd964",
                weight: 3,
                dashArray: "6 6"
            };

            if (!navOffLine) {
                navOffLine = L.polyline(line, style).addTo(navMap);
            } else {
                navOffLine.setLatLngs(line);
                navOffLine.setStyle(style);
            }

        } else if (navOffLine) {

            navMap.removeLayer(navOffLine);
            navOffLine = null;

        }

    }


    function removeNavUser() {

        if (!navMap) {
            return;
        }

        [navUserMarker, navAccuracy, navOffLine].forEach(layer => {

            if (layer) {
                navMap.removeLayer(layer);
            }

        });

        navUserMarker = null;
        navAccuracy = null;
        navOffLine = null;

    }


    function destroyNavMap() {

        if (navMap) {
            navMap.remove();
        }

        navMap = null;
        navUserMarker = null;
        navAccuracy = null;
        navRouteLine = null;
        navOffLine = null;
        navTrackedName = null;

    }


    /* ---------- evaluation + alerts ---------- */

    function updateNavigation(projection, onTrack, p, result) {

        if (!navOpen) {
            return;
        }

        if (result && navMap && navTrackedName !== result.route) {
            drawNavRoute(true);
        }

        if (!result) {
            setNavStatus("wait", "ابتدا یک مسیر انتخاب کنید", "");
            return;
        }

        if (!p) {

            setNavStatus(
                "wait",
                state.signalLost
                    ? "⚠ موقعیت در دسترس نیست"
                    : "در حال یافتن موقعیت...",
                ""
            );

            return;

        }

        if (!projection) {

            setNavStatus("wait", "مسیر قابل محاسبه نیست", "");

            return;

        }

        /* GPS noise: allow half of the accuracy (max 10 m) */

        const allowance = Math.min(p.accuracy || 0, 20) / 2;

        const limit = navThreshold + allowance;

        const distance = projection.distance;

        const off = navAlert.off
            ? distance > limit * 0.85
            : distance > limit;

        /* side relative to the walking direction */

        const userSide =
            projection.lateral * state.dir > 0 ? "چپ" : "راست";

        const trackSide = userSide === "چپ" ? "راست" : "چپ";

        const directionText =
            state.dir === 1 ? "مسیر رفت" : "مسیر برگشت";

        const weak = state.signalLost
            ? " · ⚠ سیگنال GPS ضعیف"
            : "";

        if (off) {

            setNavStatus(
                "off",
                `⚠ ${Math.round(distance)} متر سمت ${userSide} مسیر`,
                `مسیر سمت ${trackSide} شماست · ${directionText}${weak}`
            );

        } else {

            setNavStatus(
                "ok",
                "✓ در مسیر درست",
                `فاصله تا مسیر: ${Math.round(distance)} متر · ${directionText}${weak}`
            );

        }

        renderNavMap(p, projection, off);

        handleAlert(off, trackSide);

    }


    function handleAlert(off, trackSide) {

        const now = Date.now();

        if (off) {

            if (!navAlert.off) {
                navAlert.off = true;
                navAlert.last = 0;
            }

            if (pocketOpen && now - navAlert.last > 12000) {

                navAlert.last = now;

                speakAlert(
                    `از مسیر خارج شدید. مسیر سمت ${trackSide} شماست`,
                    trackSide === "چپ" ? 1 : 2,
                    trackSide === "چپ" ? "chap" : "raast"
                );

                if (navigator.vibrate) {
                    navigator.vibrate([300, 150, 300]);
                }

            }

        } else if (navAlert.off) {

            navAlert.off = false;

            if (pocketOpen) {
                speakAlert("به مسیر برگشتید", 1, "dorost shod");
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
