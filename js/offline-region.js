/* =========================================================
   Offline map download (pre-cache the area around the routes)

   - Tiles are taken along the TRACK (a corridor), not a big
     rectangle, so a long diagonal route does not download
     thousands of useless tiles.
   - Raster layers (satellite / topo / street) are shared by the
     2D (Leaflet) and the 3D (MapLibre) map: one download serves both.
   - Optional: terrain (DEM) tiles for the 3D map, MapLibre library
     and the glyph file used for the route numbers.
   - Tiles are stored in their own cache ("mrc-offline-v1") which the
     service worker (sw.js) reads and which is never trimmed.
   - Load AFTER app-state.js, map-3d.js (needs loadMapLibre).
   ========================================================= */

(function () {

    "use strict";

    const OFFLINE_CACHE = "mrc-offline-v1";
    const TILE_CACHE = "mrc-tiles-v1";

    const MAX_TILES = 15000;        // one download job
    const CONCURRENCY = 4;
    const REQUEST_GAP_MS = 30;      // be polite to free tile servers

    const RASTER_MIN_Z = 8;
    const DEM_MIN_Z = 5;
    const DEM_MAX_Z = 12;           // maxzoom of the DEM source in map-3d.js

    const EARTH_KM = 40075.017;

    const DEM_TILEJSON_URL = "https://tiles.mapterhorn.com/tilejson.json";
    const DEM_FALLBACK_URL = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";

    /* same glyph file the 3D map uses for the route numbers */
    const GLYPH_URLS = [
        "https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/resources/fonts/Arial%20Unicode%20MS%20Bold/0-255.pbf"
    ];

    /* the URLs must be identical to the ones in map-2d.js / map-3d.js
       (without the a/b/c sub-domain, see tileKey in sw.js) */
    const LAYERS = {
        sat: {
            label: "ماهواره‌ای",
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            maxZoom: 19,
            kb: 22
        },
        topo: {
            label: "توپوگرافی",
            url: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
            maxZoom: 17,
            kb: 16
        },
        osm: {
            label: "خیابانی",
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            maxZoom: 19,
            kb: 10
        }
    };

    const DEM_KB = 60;

    /*
     * PMTiles: instead of thousands of tile requests, the needed byte ranges
     * of ONE archive are fetched (HTTP Range, see js/pmtiles.js) and every tile
     * is stored in OFFLINE_CACHE under its normal XYZ URL, so the maps and the
     * service worker need no change.
     * A layer uses it when it has a "pmtiles" URL (LAYERS.x.pmtiles); the
     * server must allow CORS + Range. If the archive cannot be read, the
     * download falls back to per-tile requests automatically.
     * The DEM URL below must be checked; "" turns the DEM PMTiles path off.
     */
    const DEM_PMTILES_URL = "https://download.mapterhorn.com/planet.pmtiles";

    const state = {
        running: false,
        abort: false,
        plan: null,
        heartbeat: null
    };

    const dom = {};


    /* =====================================================
       Helpers
       ===================================================== */

    const fa = n => Number(n).toLocaleString("fa-IR", { useGrouping: true });

    function isNum(v) {
        return typeof v === "number" && Number.isFinite(v);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /* identical to tileKey() in sw.js */
    function tileKey(href) {
        return new URL(href).href.replace(/^https:\/\/[abc]\.(tile\.)/, "https://$1");
    }

    function swFlag(on) {
        try {
            const controller =
                navigator.serviceWorker && navigator.serviceWorker.controller;

            if (controller) {
                controller.postMessage({ type: "offline-download", on: !!on });
            }
        } catch (e) { /* ignore */ }
    }


    /* =====================================================
       Track samples (every ~100 m along all routes)
       ===================================================== */

    function getSamples() {

        const out = [];

        const results =
            typeof analysisResults !== "undefined" ? analysisResults : [];

        results.forEach(result => {

            const points = result.routeData && result.routeData.points;

            if (!points) {
                return;
            }

            let last = null;

            for (let i = 0; i < points.length; i++) {

                const lat = points[i].latitude;
                const lon = points[i].longitude;

                if (!isNum(lat) || !isNum(lon)) {
                    continue;
                }

                if (last) {

                    const dy = (lat - last.lat) * 111320;
                    const dx = (lon - last.lon) * 111320 * Math.cos(lat * Math.PI / 180);
                    const d = Math.hypot(dx, dy);

                    // dense GPS points: keep one every ~80 m
                    if (d < 80) {
                        continue;
                    }

                    // sparse points: fill the gap
                    const n = Math.floor(d / 100);

                    for (let k = 1; k <= n; k++) {
                        const f = k / (n + 1);
                        out.push([
                            last.lat + (lat - last.lat) * f,
                            last.lon + (lon - last.lon) * f
                        ]);
                    }
                }

                out.push([lat, lon]);

                last = { lat, lon };
            }
        });

        return out;
    }


    /* =====================================================
       Tile planning
       ===================================================== */

    function padKmForZoom(z, marginKm) {
        if (z <= 10) { return Math.max(marginKm, 30); }
        if (z <= 12) { return Math.max(marginKm, 10); }
        return marginKm;
    }

    function lonToX(lon, n) {
        return Math.min(n - 1, Math.max(0, Math.floor((lon + 180) / 360 * n)));
    }

    function latToY(lat, n) {
        const rad = lat * Math.PI / 180;
        const y = (1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n;
        return Math.min(n - 1, Math.max(0, Math.floor(y)));
    }

    /* zoom -> Set of (x * 2^z + y) for the corridor around the track */
    function computeZoomSets(samples, marginKm, zMin, zMax) {

        const sets = new Map();

        let latSum = 0;

        samples.forEach(s => { latSum += s[0]; });

        const midLat = latSum / samples.length;

        for (let z = zMin; z <= zMax; z++) {

            const n = Math.pow(2, z);

            const centers = new Map();

            for (let i = 0; i < samples.length; i++) {

                const x = lonToX(samples[i][1], n);
                const y = latToY(samples[i][0], n);

                const key = x * n + y;

                if (!centers.has(key)) {
                    centers.set(key, [x, y]);
                }
            }

            const tileKm = EARTH_KM * Math.cos(midLat * Math.PI / 180) / n;

            const r = Math.max(1, Math.ceil(padKmForZoom(z, marginKm) / tileKm));

            const set = new Set();

            centers.forEach(([cx, cy]) => {

                const x0 = Math.max(0, cx - r);
                const x1 = Math.min(n - 1, cx + r);
                const y0 = Math.max(0, cy - r);
                const y1 = Math.min(n - 1, cy + r);

                for (let x = x0; x <= x1; x++) {
                    for (let y = y0; y <= y1; y++) {
                        set.add(x * n + y);
                    }
                }
            });

            sets.set(z, set);
        }

        return sets;
    }

    function readOptions() {

        const layers = Array.from(
            dom.panel.querySelectorAll("input[data-layer]:checked")
        ).map(input => input.dataset.layer);

        return {
            layers,
            dem: dom.panel.querySelector("#off-dem").checked,
            maxZoom: Number(dom.zoom.value),
            margin: Number(dom.margin.value)
        };
    }

    function makePlan() {

        const samples = getSamples();

        if (samples.length === 0) {
            return null;
        }

        const opts = readOptions();

        const zMin = opts.dem ? DEM_MIN_Z : RASTER_MIN_Z;
        const zMax = Math.max(opts.maxZoom, opts.dem ? DEM_MAX_Z : 0);

        const sets = computeZoomSets(samples, opts.margin, zMin, zMax);

        let count = 0;
        let bytes = 0;

        opts.layers.forEach(id => {

            const layer = LAYERS[id];

            const top = Math.min(opts.maxZoom, layer.maxZoom);

            for (let z = RASTER_MIN_Z; z <= top; z++) {
                const size = sets.get(z).size;
                count += size;
                bytes += size * layer.kb * 1024;
            }
        });

        if (opts.dem) {
            for (let z = DEM_MIN_Z; z <= DEM_MAX_Z; z++) {
                const size = sets.get(z).size;
                count += size;
                bytes += size * DEM_KB * 1024;
            }
        }

        return { opts, sets, count, bytes };
    }

    function buildTasks(plan, demTemplate) {

        const tasks = [];

        function add(template, z, set, n, pm) {
            set.forEach(key => {
                const x = Math.floor(key / n);
                const y = key % n;

                const url = template
                    .replace(/\{z\}/g, z)
                    .replace(/\{x\}/g, x)
                    .replace(/\{y\}/g, y);

                tasks.push({ url, key: tileKey(url), pm: pm || null, z, x, y });
            });
        }

        plan.opts.layers.forEach(id => {

            const layer = LAYERS[id];

            const top = Math.min(plan.opts.maxZoom, layer.maxZoom);

            for (let z = RASTER_MIN_Z; z <= top; z++) {
                add(layer.url, z, plan.sets.get(z), Math.pow(2, z), layer.pmtiles);
            }
        });

        if (plan.opts.dem) {
            for (let z = DEM_MIN_Z; z <= DEM_MAX_Z; z++) {
                add(demTemplate, z, plan.sets.get(z), Math.pow(2, z), DEM_PMTILES_URL);
            }
        }

        // lower zooms first: if the download is stopped, the overview exists
        return tasks;
    }


    /* =====================================================
       Download
       ===================================================== */

    async function resolveDemTemplate() {

        try {

            const response = await fetch(DEM_TILEJSON_URL, { mode: "cors" });

            if (response.ok) {

                const json = await response.json();

                if (json && Array.isArray(json.tiles) && json.tiles[0]) {
                    return json.tiles[0];
                }
            }

        } catch (e) { /* use the fallback */ }

        return DEM_FALLBACK_URL;
    }

    /* MapLibre (JS + CSS) and the glyph file: needed by the 3D map offline */
    async function prefetchSupportFiles() {

        try {
            if (typeof loadMapLibre === "function") {
                await loadMapLibre();
            }
        } catch (e) {
            console.warn("MapLibre prefetch failed:", e);
        }

        for (const url of GLYPH_URLS) {
            try {
                const response = await fetch(url, { mode: "cors" });

                if (response.ok) {
                    await (await caches.open(OFFLINE_CACHE)).put(tileKey(url), response);
                }
            } catch (e) { /* ignore */ }
        }
    }

    /*
     * Tasks that have a PMTiles archive: locate the tiles in the archive
     * directories, merge neighbours into a few big Range requests, cut the
     * tiles out and store them. Tasks that are handled get task.handled = true;
     * anything that fails stays unhandled and is fetched tile by tile later.
     * tick(kind): "new" = stored, "skip" = already there / not in the archive.
     */
    async function downloadViaPmtiles(tasks, offline, existing, tick) {

        const groups = new Map();

        tasks.forEach(task => {
            if (task.pm && typeof PMTilesArchive === "function") {
                if (!groups.has(task.pm)) {
                    groups.set(task.pm, []);
                }
                groups.get(task.pm).push(task);
            }
        });

        for (const [url, list] of groups) {

            if (state.abort) {
                return;
            }

            const pending = [];

            list.forEach(task => {
                if (existing.has(task.key)) {
                    task.handled = true;
                    tick("skip");
                } else {
                    pending.push(task);
                }
            });

            if (pending.length === 0) {
                continue;
            }

            try {

                setStatus("در حال خواندن فهرست PMTiles…", "busy");

                const archive = new PMTilesArchive(url);

                await archive.open();

                const { found, missing } = await archive.locateAll(pending);

                missing.forEach(task => {
                    task.handled = true;
                    tick("skip");
                });

                const ranges = archive.planRanges(found);

                setStatus("");

                let next = 0;

                async function worker() {

                    while (!state.abort) {

                        const range = ranges[next++];

                        if (!range) {
                            return;
                        }

                        try {

                            const buffer = await archive.fetchRange(range.start, range.end - range.start);

                            for (const item of range.items) {

                                const body = await archive.tileBody(buffer, range, item);

                                await offline.put(
                                    item.task.key,
                                    new Response(body, { headers: { "Content-Type": archive.contentType } })
                                );

                                item.task.handled = true;
                                tick("new");
                            }

                        } catch (error) {
                            console.warn("PMTiles range failed (per-tile fallback):", error);
                        }
                    }
                }

                await Promise.all(Array.from({ length: 3 }, worker));

            } catch (error) {
                console.warn("PMTiles unavailable (per-tile fallback):", url, error);
                setStatus("");
            }
        }
    }

    async function startDownload() {

        if (state.running) {
            return;
        }

        if (!("caches" in window)) {
            setStatus("این مرورگر از ذخیرهٔ آفلاین پشتیبانی نمی‌کند.", "error");
            return;
        }

        const plan = makePlan();

        if (!plan || plan.count === 0) {
            setStatus("ابتدا یک مسیر و حداقل یک لایه انتخاب کنید.", "warn");
            return;
        }

        if (plan.count > MAX_TILES) {
            setStatus("تعداد تایل‌ها زیاد است؛ حداکثر زوم یا حاشیه را کمتر کنید.", "warn");
            return;
        }

        state.running = true;
        state.abort = false;

        setRunningUI(true);

        setStatus("در حال آماده‌سازی…", "busy");

        try {

            if (navigator.storage && navigator.storage.persist) {
                navigator.storage.persist();
            }

            swFlag(true);

            state.heartbeat = setInterval(() => swFlag(true), 15000);

            window.addEventListener("beforeunload", warnBeforeUnload);

            await prefetchSupportFiles();

            const demTemplate = plan.opts.dem
                ? await resolveDemTemplate()
                : null;

            const offline = await caches.open(OFFLINE_CACHE);
            const tileCache = await caches.open(TILE_CACHE);

            const existing = new Set(
                (await offline.keys()).map(request => request.url)
            );

            const tasks = buildTasks(plan, demTemplate);

            let index = 0;
            let done = 0;
            let failed = 0;
            let fresh = 0;

            const total = tasks.length;

            async function fetchOne(task) {

                if (existing.has(task.key)) {
                    return;
                }

                // already seen on the map: copy, no network
                const hit = await tileCache.match(task.key, { ignoreVary: true });

                if (hit) {
                    await offline.put(task.key, hit);
                    fresh++;
                    return;
                }

                for (let attempt = 0; attempt < 2; attempt++) {

                    try {

                        const response = await fetch(task.url, {
                            mode: "cors",
                            credentials: "omit"
                        });

                        if (response.ok) {
                            await offline.put(task.key, response);
                            fresh++;
                            return;
                        }

                        // no tile there (outside coverage): not an error
                        if (response.status === 404) {
                            return;
                        }

                        throw new Error("HTTP " + response.status);

                    } catch (error) {

                        if (attempt === 1) {
                            throw error;
                        }

                        await sleep(400);
                    }
                }
            }

            async function worker() {

                while (!state.abort) {

                    const i = index++;

                    if (i < total && tasks[i].handled) {
                        continue;
                    }

                    if (i >= total) {
                        return;
                    }

                    try {
                        await fetchOne(tasks[i]);
                    } catch (error) {
                        failed++;
                    }

                    done++;

                    if (done % 8 === 0 || done === total) {
                        setProgress(done, total, failed);
                    }

                    await sleep(REQUEST_GAP_MS);
                }
            }

            setStatus("");
            setProgress(0, total, 0);

            await downloadViaPmtiles(tasks, offline, existing, kind => {

                done++;

                if (kind === "new") {
                    fresh++;
                }

                if (done % 8 === 0 || done === total) {
                    setProgress(done, total, failed);
                }
            });

            await Promise.all(
                Array.from({ length: CONCURRENCY }, () => worker())
            );

            setProgress(done, total, failed);

            /* the navigation map uses this to scale tiles when offline */
            if (!state.abort) {
                try {
                    const prev = Number(localStorage.getItem("offline-max-zoom")) || 0;
                    localStorage.setItem("offline-max-zoom", String(Math.max(prev, plan.opts.maxZoom)));
                } catch (e) { /* ignore */ }
            }

            if (state.abort) {
                setStatus(
                    `متوقف شد. ${fa(fresh)} تایل جدید ذخیره شد؛ با «دانلود» دوباره، ادامه می‌یابد.`,
                    "warn"
                );
            } else if (failed > 0) {
                setStatus(
                    `تمام شد؛ ${fa(failed)} تایل دانلود نشد. دوباره «دانلود» را بزنید تا تکمیل شود.`,
                    "warn"
                );
            } else {
                setStatus(`✓ آماده برای آفلاین (${fa(fresh)} تایل جدید ذخیره شد).`, "ok");
            }

            if (!(navigator.serviceWorker && navigator.serviceWorker.controller)) {
                setStatus(
                    "یک‌بار صفحه را رفرش کنید تا نسخهٔ آفلاین فعال شود (سرویس‌ورکر هنوز کنترل صفحه را ندارد).",
                    "warn"
                );
            }

        } catch (error) {

            console.error("Offline download failed:", error);

            setStatus("دانلود با خطا متوقف شد: " + (error && error.message || error), "error");

        } finally {

            clearInterval(state.heartbeat);

            state.heartbeat = null;

            swFlag(false);

            window.removeEventListener("beforeunload", warnBeforeUnload);

            state.running = false;

            setRunningUI(false);

            refreshStats();
        }
    }

    function warnBeforeUnload(event) {
        event.preventDefault();
        event.returnValue = "";
    }

    function stopDownload() {
        state.abort = true;
    }

    async function clearOffline() {

        if (state.running) {
            return;
        }

        if (!confirm("همهٔ نقشه‌های آفلاین ذخیره‌شده حذف شود؟")) {
            return;
        }

        try {
            await caches.delete(OFFLINE_CACHE);
            try { localStorage.removeItem("offline-max-zoom"); } catch (e) { /* ignore */ }
            setStatus("نقشه‌های آفلاین حذف شد.", "ok");
        } catch (error) {
            setStatus("حذف ممکن نشد.", "error");
        }

        setProgress(0, 0, 0);
        refreshStats();
    }


    /* =====================================================
       UI
       ===================================================== */

    function setStatus(text, kind) {

        if (!dom.status) {
            return;
        }

        dom.status.className = "offline-status" + (kind ? " " + kind : "");
        dom.status.textContent = text || "";
    }

    function setProgress(done, total, failed) {

        if (!dom.bar) {
            return;
        }

        const fraction = total > 0 ? done / total : 0;

        dom.progress.hidden = total === 0;

        dom.fill.style.width = (fraction * 100).toFixed(1) + "%";

        dom.progressText.textContent = total > 0
            ? `${fa(done)} از ${fa(total)} (${fa(Math.round(fraction * 100))}٪)` +
              (failed ? ` · ${fa(failed)} خطا` : "")
            : "";
    }

    function setRunningUI(running) {

        dom.start.disabled = running;
        dom.stop.hidden = !running;
        dom.clear.disabled = running;

        dom.panel.classList.toggle("is-running", running);

        dom.panel.querySelectorAll("input, select").forEach(element => {
            element.disabled = running;
        });
    }

    function refreshEstimate() {

        if (!dom.panel) {
            return;
        }

        const plan = makePlan();

        state.plan = plan;

        if (!plan) {
            dom.estimate.textContent = "ابتدا یک مسیر انتخاب کنید.";
            dom.start.disabled = true;
            return;
        }

        const mb = Math.max(1, Math.round(plan.bytes / 1048576));

        const tooMany = plan.count > MAX_TILES;

        dom.estimate.textContent = plan.count === 0
            ? "حداقل یک لایه را انتخاب کنید."
            : `${fa(plan.count)} تایل · حدود ${fa(mb)} مگابایت (تقریبی)` +
              (tooMany ? " — بیش از حد مجاز؛ زوم یا حاشیه را کمتر کنید." : "");

        dom.estimate.classList.toggle("bad", tooMany);

        dom.start.disabled = state.running || plan.count === 0 || tooMany;
    }

    async function refreshStats() {

        if (!dom.stats || !("caches" in window)) {
            return;
        }

        try {

            let count = 0;

            if (await caches.has(OFFLINE_CACHE)) {
                const cache = await caches.open(OFFLINE_CACHE);
                count = (await cache.keys()).length;
            }

            let usage = "";

            if (navigator.storage && navigator.storage.estimate) {
                const estimate = await navigator.storage.estimate();
                usage = ` · کل فضای مصرفی برنامه: ${fa(Math.round((estimate.usage || 0) / 1048576))} مگابایت`;
            }

            dom.stats.textContent = count > 0
                ? `ذخیره‌شده برای آفلاین: ${fa(count)} تایل${usage}`
                : "هنوز نقشهٔ آفلاینی ذخیره نشده است.";

            dom.badge.textContent = count > 0 ? fa(count) : "";
            dom.badge.hidden = count === 0;

        } catch (e) { /* ignore */ }
    }

    function createPanel() {

        const group = document.querySelector("#map-container .map-location-group");

        if (!group || document.getElementById("offline-panel")) {
            return;
        }

        /* one button in the toolbar (next to 2D / 3D / navigation); the details open in a modal */
        const button = document.createElement("button");

        button.type = "button";
        button.id = "offline-open-btn";
        button.className = "map-view-button map-offline-btn";
        button.title = "دانلود نقشه برای استفادهٔ آفلاین";
        button.innerHTML =
            '<span aria-hidden="true">⬇</span>' +
            '<span class="btn-lbl-full">دانلود نقشه آفلاین</span>' +
            '<span class="btn-lbl-short">آفلاین</span>' +
            '<span id="off-badge" class="offline-badge" hidden></span>';

        group.appendChild(button);

        const panel = document.createElement("div");

        panel.id = "offline-panel";
        panel.className = "offline-panel";

        panel.innerHTML = `
            <div class="offline-body">

                <p class="offline-note">
                    نقشهٔ اطراف مسیرهای انتخاب‌شده را یک‌بار با اینترنت دانلود کنید تا
                    در کوه، بدون اینترنت هم نقشهٔ ۲بعدی، ۳بعدی و صفحهٔ ناوبری کار کند.
                </p>

                <div class="offline-group">
                    <div class="offline-group-title">لایه‌ها</div>
                    <label><input type="checkbox" data-layer="sat" checked> ماهواره‌ای</label>
                    <label><input type="checkbox" data-layer="topo" checked> توپوگرافی</label>
                    <label><input type="checkbox" data-layer="osm"> خیابانی</label>
                    <label><input type="checkbox" id="off-dem" checked> ارتفاع زمین (برای نقشهٔ ۳بعدی)</label>
                </div>

                <div class="offline-row">
                    <label>
                        <span>حداکثر زوم (جزئیات)</span>
                        <select id="off-zoom">
                            <option value="13">۱۳ (کم‌حجم)</option>
                            <option value="14">۱۴</option>
                            <option value="15" selected>۱۵ (پیشنهادی)</option>
                            <option value="16">۱۶</option>
                            <option value="17">۱۷ (پرحجم)</option>
                        </select>
                    </label>
                    <label>
                        <span>حاشیه دو طرف مسیر</span>
                        <select id="off-margin">
                            <option value="1">۱ کیلومتر</option>
                            <option value="2" selected>۲ کیلومتر</option>
                            <option value="3">۳ کیلومتر</option>
                            <option value="5">۵ کیلومتر</option>
                            <option value="10">۱۰ کیلومتر</option>
                        </select>
                    </label>
                </div>

                <div id="off-estimate" class="offline-estimate"></div>

                <div class="offline-actions">
                    <button type="button" id="off-start" class="offline-btn primary">⬇ دانلود</button>
                    <button type="button" id="off-stop" class="offline-btn" hidden>■ توقف</button>
                    <button type="button" id="off-clear" class="offline-btn danger">🗑 حذف نقشه‌های آفلاین</button>
                </div>

                <div id="off-progress" class="offline-progress" hidden>
                    <div class="offline-bar" id="off-bar" dir="ltr"><div id="off-fill" class="offline-fill"></div></div>
                    <div id="off-progress-text" class="offline-progress-text"></div>
                </div>

                <div id="off-status" class="offline-status" role="status" aria-live="polite"></div>
                <div id="off-stats" class="offline-stats"></div>

            </div>
        `;

        const modal = document.createElement("div");

        modal.id = "offline-modal";
        modal.className = "offline-modal";
        modal.hidden = true;
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-labelledby", "offline-modal-title");
        modal.innerHTML =
            '<div class="offline-modal-box">' +
            '<div class="offline-modal-head">' +
            '<h3 id="offline-modal-title">دانلود نقشه آفلاین</h3>' +
            '<button type="button" class="offline-modal-close" aria-label="بستن">×</button>' +
            '</div>' +
            '<div class="offline-modal-body"></div>' +
            '</div>';

        modal.querySelector(".offline-modal-body").appendChild(panel);
        document.body.appendChild(modal);

        dom.modal = modal;
        dom.panel = panel;
        dom.badge = button.querySelector("#off-badge");
        dom.zoom = panel.querySelector("#off-zoom");
        dom.margin = panel.querySelector("#off-margin");
        dom.estimate = panel.querySelector("#off-estimate");
        dom.start = panel.querySelector("#off-start");
        dom.stop = panel.querySelector("#off-stop");
        dom.clear = panel.querySelector("#off-clear");
        dom.progress = panel.querySelector("#off-progress");
        dom.bar = panel.querySelector("#off-bar");
        dom.fill = panel.querySelector("#off-fill");
        dom.progressText = panel.querySelector("#off-progress-text");
        dom.status = panel.querySelector("#off-status");
        dom.stats = panel.querySelector("#off-stats");

        let timer = null;

        function scheduleEstimate() {
            clearTimeout(timer);
            timer = setTimeout(refreshEstimate, 120);
        }

        panel.querySelectorAll("input, select").forEach(element => {
            element.addEventListener("change", scheduleEstimate);
        });

        function openModal() {
            modal.hidden = false;
            document.body.classList.add("offline-modal-open");
            button.classList.add("active");
            refreshEstimate();
            refreshStats();
        }

        function closeModal() {
            modal.hidden = true;
            document.body.classList.remove("offline-modal-open");
            button.classList.remove("active");
        }

        button.addEventListener("click", openModal);
        modal.querySelector(".offline-modal-close").addEventListener("click", closeModal);

        modal.addEventListener("click", event => {
            if (event.target === modal) {
                closeModal();
            }
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && !modal.hidden) {
                closeModal();
            }
        });

        dom.start.addEventListener("click", startDownload);
        dom.stop.addEventListener("click", stopDownload);
        dom.clear.addEventListener("click", clearOffline);

        refreshStats();
    }

    function initialize() {

        createPanel();

        // routes changed -> the estimate changes
        if (typeof hookFunction === "function") {
            hookFunction("drawRoutesOnMap", () => {
                if (dom.modal && !dom.modal.hidden && !state.running) {
                    refreshEstimate();
                }
            });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }

})();
