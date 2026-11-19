/* =========================================================
   Navigation (live GPS position on the route)

   - "🧭 ناوبری" button next to the 2D / 3D buttons opens a full
     screen navigation view: status (on track / deviation),
     info panel (altitude, climb, distances ALONG the GPX track),
     mini map, deviation sensitivity and pocket mode (mobile)
   - Uses navigator.geolocation.watchPosition
   - Location never leaves the browser and is not stored
   - Load AFTER app-state.js, map-2d.js and track-geometry.js
   ========================================================= */

(function () {

    "use strict";

    const state = {
        watchId: null,
        position: null,
        signalLost: false,
        matchTrack: null,
        matchAlong: null,
        dir: 1,           // 1 = outbound (along grows), -1 = return
        dirKnown: false,  // true after real movement (or a manual choice)
        dirMode: "auto"   // "auto" | "out" | "back"  (manual choice)
    };

    // track chosen by the user when several routes are loaded
    let selectedTrackName = null;

    const PANEL_ID = "user-location-panel";

    /* navigation screen state */
    let navOpen = false;
    let pocketOpen = false;
    let navMap = null;
    let navUserMarker = null;
    let navAccuracy = null;
    let navRouteLine = null;
    let navOffLine = null;
    let navTrackedName = null;
    let wakeLock = null;
    let audioCtx = null;
    let lastPocketTap = 0;

    const NAV_THRESHOLDS = [10, 15, 25, 40, 60];
    const navAlert = { off: false, last: 0 };

    /* low-vision options (saved) */

    const NAV_FONT_STEPS = [0.8, 1, 1.2, 1.4, 1.6];   // 1 = default (index 1)

    function readNavPref(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function writeNavPref(key, value) {
        try { localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ }
    }

    let navFontStep = (function () {
        const index = NAV_FONT_STEPS.indexOf(Number(readNavPref("nav-font-scale")));
        return index >= 0 ? index : 1;
    })();

    let navLight = readNavPref("nav-theme") === "light";

    let navThreshold = (function () {
        const value = Number(readNavPref("nav-threshold"));
        return NAV_THRESHOLDS.includes(value) ? value : 25;
    })();


    /* =====================================================
       Small DOM helpers
       ===================================================== */

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

    function setStatus(text) {
        panelText("user-location-status", text || "");

        if (text && navOpen) {
            setNavStatus("wait", text, "");
        }
    }

    function updateButtons() {
        syncNavToggle();
        updatePanel();
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
        state.signalLost = false;
        state.matchTrack = null;
        state.matchAlong = null;
        state.dir = 1;
        state.dirKnown = false;
        state.dirMode = "auto";

        renderDirButtons();

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

        setStatus("");
        updateButtons();
    }


    function onError(error) {
        if (error.code === 1) {
            stopNav(
                "دسترسی به موقعیت داده نشد",
                "اجازه را در تنظیمات مرورگر فعال کنید."
            );

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

        const sign = rounded > 0 ? "+" : (rounded < 0 ? "\u2212" : "");

        return sign + Math.abs(rounded).toLocaleString("en-US") + " m";
    }

    function formatDistance(meters) {
        return Math.round(meters) < 1000
            ? Math.round(meters) + " m"
            : (meters / 1000).toFixed(1) + " km";
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


    function createPanel() {
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

        // the panel lives inside the navigation screen
        document.getElementById("nav-panel-slot").appendChild(panel);
    }


    function getReferenceResult() {
        if (typeof analysisResults === "undefined" || analysisResults.length === 0) {
            return null;
        }

        return analysisResults.find(result => result.id === selectedTrackName) ||
            analysisResults[0];
    }


    function syncTrackSelector(result) {
        const select = document.getElementById("ulp-track");
        const label = document.getElementById("ulp-route");

        if (!select || !label) {
            return;
        }

        const items = typeof analysisResults === "undefined" ? [] : analysisResults;

        if (items.length > 1) {
            const signature =
                items.map(item => item.id + "\u0002" + item.route).join("\u0001");

            if (select.dataset.signature !== signature) {
                select.innerHTML = "";

                items.forEach((item, index) => {
                    select.add(new Option(`${index + 1}. ${item.route}`, item.id));
                });

                select.dataset.signature = signature;
            }

            select.value = result.id;
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

        document.getElementById("ulp-meta").classList.toggle("warn", state.signalLost);

        /* elevations */

        const altitude = p && Number.isFinite(p.altitude) ? p.altitude : null;

        const metrics = result ? result.metrics : null;

        const summit = metrics ? Number(metrics["Maximum Elevation (m)"]) : NaN;
        const startElevation = metrics ? Number(metrics["Start Elevation (m)"]) : NaN;

        panelText("ulp-altitude", altitude === null ? "—" : formatMeters(altitude));

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
                    state.matchTrack === result ? state.matchAlong : null;

                projection = projectOnTrack(geometry, p.lat, p.lon, previous);

                onTrack = isUserOnTrack(projection, p.accuracy);

                if (onTrack) {
                    if (state.matchTrack === result && state.matchAlong !== null) {
                        const delta = projection.along - state.matchAlong;

                        if (state.dirMode === "auto" && Math.abs(delta) > 8) {
                            state.dir = delta > 0 ? 1 : -1;
                            state.dirKnown = true;
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
       Navigation screen
       ===================================================== */

    /*
     * extra (optional):
     *   arrow : "←" | "→"  big arrow = the way back to the track
     *   dir   : { kind: "out" | "back" | "unk", text }  direction badge
     */

    function setNavStatus(kind, main, sub, extra) {
        const box = document.getElementById("nav-status");

        if (!box) {
            return;
        }

        const opts = extra || {};

        box.className = "nav-status nav-" + kind;

        panelText("nav-status-main", main);
        panelText("nav-status-sub", sub || "");

        const arrow = document.getElementById("nav-status-arrow");

        if (arrow) {
            arrow.textContent = opts.arrow || "";
            arrow.hidden = !opts.arrow;
        }

        const badge = document.getElementById("nav-status-dir");

        if (badge) {
            badge.hidden = !opts.dir;
            badge.textContent = opts.dir ? opts.dir.text : "";
            badge.className =
                "nav-dir-badge" + (opts.dir ? " nav-dir-" + opts.dir.kind : "");
        }
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


    /* manual direction: "out" = outbound (1), "back" = return (-1) */

    function applyDirMode() {
        if (state.dirMode === "out") {
            state.dir = 1;
            state.dirKnown = true;
        } else if (state.dirMode === "back") {
            state.dir = -1;
            state.dirKnown = true;
        }
    }


    function renderDirButtons() {
        document.querySelectorAll(".nav-dir-opt").forEach(button => {
            const active = button.dataset.mode === state.dirMode;

            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
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

        writeNavPref("nav-font-scale", NAV_FONT_STEPS[navFontStep]);

        applyNavAppearance();
    }


    function toggleNavLight() {
        navLight = !navLight;

        writeNavPref("nav-theme", navLight ? "light" : "dark");

        applyNavAppearance();
    }


    function createNavScreen() {
        const slot = document.getElementById("nav-screen-slot");

        if (!slot || document.getElementById("nav-screen")) {
            return;
        }

        const screen = document.createElement("div");

        screen.id = "nav-screen";
        screen.className = "nav-screen";

        screen.innerHTML = `

            <div class="nav-top">
                <div class="nav-title">🧭 ناوبری زنده</div>
                <div class="nav-tools">
                    <button id="nav-font-minus" type="button" class="nav-btn"
                            title="کوچک‌تر کردن نوشته" aria-label="کوچک‌تر کردن نوشته">A−</button>
                    <button id="nav-font-plus" type="button" class="nav-btn"
                            title="بزرگ‌تر کردن نوشته" aria-label="بزرگ‌تر کردن نوشته">A+</button>
                    <button id="nav-sun-btn" type="button" class="nav-btn nav-sun"
                            aria-pressed="false">☀️ آفتاب</button>
                </div>
                <div class="nav-actions">
                    <button id="nav-routes-btn" type="button"
                            class="nav-btn nav-routes-btn">📂 مسیرها</button>
                    <button id="nav-toggle-btn" type="button"
                            class="nav-btn nav-start" aria-pressed="false">▶ شروع ناوبری</button>
                    <button id="nav-pocket-btn" type="button"
                            class="nav-btn nav-pocket-btn">🔒 حالت جیب</button>
                </div>
            </div>

            <div id="nav-status" class="nav-status nav-wait" role="status" aria-live="polite">
                <div id="nav-status-dir" class="nav-dir-badge" hidden></div>
                <div class="nav-status-row" dir="ltr">
                    <span id="nav-status-arrow" class="nav-status-arrow" aria-hidden="true" hidden></span>
                    <div id="nav-status-main" class="nav-status-main" dir="rtl"></div>
                </div>
                <div id="nav-status-sub" class="nav-status-sub"></div>
            </div>

            <div class="nav-dir-bar" role="group" aria-label="جهت مسیر">
                <span class="nav-dir-bar-label">جهت:</span>
                <button type="button" class="nav-dir-opt" data-mode="auto">خودکار</button>
                <button type="button" class="nav-dir-opt" data-mode="out">⬆ رفت</button>
                <button type="button" class="nav-dir-opt" data-mode="back">⬇ برگشت</button>
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

        slot.appendChild(screen);

        createPanel();

        const on = (id, handler) =>
            document.getElementById(id).addEventListener("click", handler);

        on("nav-toggle-btn", () => { if (navOpen) { stopNav(); } else { startNav(); } });
        on("nav-routes-btn", () => {
            if (typeof openRouteWorkspace === "function") {
                openRouteWorkspace();
            }
        });

        /* pocket mode needs a running navigation: start it first if needed */
        on("nav-pocket-btn", () => {
            if (!navOpen) {
                startNav();
            }

            if (navOpen) {
                openPocket();
            }
        });
        on("nav-font-minus", () => changeNavFont(-1));
        on("nav-font-plus", () => changeNavFont(1));
        on("nav-sun-btn", toggleNavLight);

        applyNavAppearance();

        screen.querySelectorAll(".nav-dir-opt").forEach(button => {
            button.addEventListener("click", () => {
                state.dirMode = button.dataset.mode;

                applyDirMode();
                renderDirButtons();
                updatePanel();
            });
        });

        renderDirButtons();
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

                writeNavPref("nav-threshold", value);

                renderSensitivityButtons();
                updatePanel();
            });

            holder.appendChild(button);
        });
    }


    function syncNavToggle() {
        const button = document.getElementById("nav-toggle-btn");

        if (button) {
            button.classList.toggle("active", navOpen);
            button.setAttribute("aria-pressed", navOpen ? "true" : "false");
            button.textContent = navOpen ? "■ توقف ناوبری" : "▶ شروع ناوبری";
        }
    }


    /* message shown while the navigation is not running */

    function showIdleStatus(main, sub) {
        if (main) {
            setNavStatus("wait", main, sub || "");
            return;
        }

        const result = getReferenceResult();

        if (!result) {
            setNavStatus(
                "wait",
                "ابتدا یک مسیر انتخاب کنید",
                "یک مسیر پیش‌فرض یا فایل GPX/KML خود را اضافه کنید."
            );
        } else {
            setNavStatus(
                "wait",
                "ناوبری غیرفعال است",
                "برای نمایش موقعیت خود روی مسیر «" + result.route +
                    "» دکمهٔ «شروع ناوبری» را بزنید."
            );
        }
    }


    function startNav() {
        if (navOpen) {
            return;
        }

        navOpen = true;

        initNavMap();

        if (state.watchId === null) {
            startTracking();
        }

        // geolocation not available: startTracking already showed why
        if (state.watchId === null) {
            navOpen = false;
            syncNavToggle();
            return;
        }

        requestWakeLock();

        syncNavToggle();

        updatePanel();
    }


    function stopNav(main, sub) {
        closePocket();

        navOpen = false;

        stopTracking();

        releaseWakeLock();

        syncNavToggle();

        showIdleStatus(main, sub);

        if (navMap) {
            drawNavRoute(activeSection === "navigation");
        }
    }


    /* routes changed / section opened */

    function refreshNav() {
        if (!document.getElementById("nav-screen")) {
            return;
        }

        const result = getReferenceResult();

        if (navMap && navTrackedName !== (result ? result.id : null)) {
            drawNavRoute(activeSection === "navigation");
        }

        if (navOpen) {
            updatePanel();
        } else {
            showIdleStatus();
        }
    }


    function onSectionChange(sectionId) {
        if (sectionId !== "navigation") {
            return;
        }

        setTimeout(() => {
            if (!navMap) {
                initNavMap();
            } else {
                navMap.invalidateSize();
                drawNavRoute(true);
            }

            refreshNav();
        }, 60);
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
        if (!navOpen || (window.innerWidth > 900 && !isTouchDevice())) {
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

        /* one finger scrolls the page, two fingers move / zoom the map */
        enableTwoFingerGestures(
            navMap,
            null,
            isTouchDevice() ||
                (navigator.maxTouchPoints > 0 && window.innerWidth <= 900)
        );

        const baseLayers = createBaseLayers();

        /* offline: zoom levels above the downloaded one are scaled from the last downloaded level */
        if (!navigator.onLine) {
            const savedZoom = Number(readNavPref("offline-max-zoom"));

            if (savedZoom > 0) {
                Object.values(baseLayers).forEach(layer => {
                    layer.options.maxNativeZoom = Math.min(layer.options.maxZoom, savedZoom);
                });
            }
        }

        baseLayers["توپوگرافی"].addTo(navMap);

        L.control.layers(baseLayers, null, {
            position: "topright",
            collapsed: true
        }).addTo(navMap);

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

        navTrackedName = result ? result.id : null;

        const points = result && result.routeData ? result.routeData.points : null;

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
            const line = [latLng, [projection.point.lat, projection.point.lon]];

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

        applyDirMode();

        if (result && navMap && navTrackedName !== result.id) {
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

        const userSide = projection.lateral * state.dir > 0 ? "چپ" : "راست";

        const trackSide = userSide === "چپ" ? "راست" : "چپ";

        /* the arrow points to where the track is */

        const arrow = trackSide === "چپ" ? "←" : "→";

        const dirInfo = !state.dirKnown
            ? { kind: "unk", text: "جهت حرکت: نامشخص (کمی حرکت کنید)" }
            : state.dir === 1
                ? { kind: "out", text: "⬆ مسیر رفت" }
                : { kind: "back", text: "⬇ مسیر برگشت" };

        const weak = state.signalLost ? "⚠ سیگنال GPS ضعیف" : "";

        if (off) {
            setNavStatus(
                "off",
                `${Math.round(distance)} متر انحراف`,
                `به سمت ${trackSide} بروید` + (weak ? " · " + weak : ""),
                { arrow: arrow, dir: dirInfo }
            );
        } else {
            setNavStatus(
                "ok",
                "✓ در مسیر درست",
                `فاصله تا مسیر: ${Math.round(distance)} متر` +
                    (weak ? " · " + weak : ""),
                { dir: dirInfo }
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
       Init (the navigation is its own section: #section-navigation)
       ===================================================== */

    function initialize() {
        createNavScreen();

        syncNavToggle();

        showIdleStatus();

        hookFunction("setActiveSection", onSectionChange);
        hookFunction("redrawAllCharts", refreshNav);
    }


    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }

})();
