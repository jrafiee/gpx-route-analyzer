/* =========================================================
   لایهٔ هواشناسی روی نقشهٔ سه‌بعدی (دما / سرعت باد)

   - به‌صورت پیش‌فرض «خاموش» است و تا وقتی کاربر دکمهٔ دما یا باد را
     نزند هیچ درخواستی به Open-Meteo یا سرور کاشی‌های ارتفاعی نمی‌رود
   - داده: Open-Meteo، شبکهٔ ۶×۶ نقطه روی محدودهٔ مسیرها
       دمای ۲ متری، باد ۱۰ متری + دما، باد و ارتفاع ژئوپتانسیل
       در ترازهای فشاری ۹۲۵ تا ۴۰۰ هکتوپاسکال
   - هر نقطه یک «پروفایل قائم» دارد (ارتفاع ← دما / باد)
   - ارتفاع هر پیکسل از کاشی‌های DEM (Mapterhorn، همان منبع زمین
     سه‌بعدی) خوانده می‌شود و مقدار آن پیکسل از پروفایل در همان
     ارتفاع درون‌یابی می‌شود؛ یعنی دمای قله و دامنه با هم فرق دارد
   - نتیجه یک تصویر نیمه‌شفاف است که روی زمین سه‌بعدی (ماهواره،
     توپوگرافی، خیابانی) کشیده می‌شود
   - اسلایدر زمان (۳ روز، ساعتی) + پخش خودکار + کلیک برای مقدار نقطه
   - نمایش وضعیت «در حال دریافت»، مهلت زمانی (timeout) برای هر درخواست
     و پیام خطا همراه با دکمهٔ «تلاش دوباره»

   بعد از user-location.js و map-3d.js بارگذاری شود.
   ========================================================= */

(function () {

    "use strict";

    const root = typeof window !== "undefined" ? window : globalThis;

    const API_URL = "https://api.open-meteo.com/v1/forecast";
    const TIMEZONE = "Asia/Tehran";
    const FORECAST_DAYS = 3;

    const GRID_N = 6;                                    // شبکهٔ ۶×۶
    const PRESSURE_LEVELS = [925, 850, 700, 600, 500, 400];
    const LAPSE_RATE = 0.0065;                           // °C بر متر
    const CACHE_TTL_MS = 15 * 60 * 1000;

    const WEATHER_TIMEOUT_MS = 30000;                    // مهلت دریافت هواشناسی
    const DEM_TIMEOUT_MS = 15000;                        // مهلت هر کاشی ارتفاعی

    const SRC_ID = "wx3d-overlay";
    const LYR_ID = "wx3d-overlay-layer";

    const MAX_OVERLAY_PX = 168;
    const DEM_TILE_LIMIT = 16;
    const DEM_FALLBACK_URL = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
    const DEM_TILEJSON_URL = "https://tiles.mapterhorn.com/tilejson.json";


    /* =====================================================
       Colour maps
       ===================================================== */

    const COLORMAPS = {

        temperature: {
            label: "دما",
            unit: "°C",
            min: -30,
            max: 40,
            ticks: [-30, -20, -10, 0, 10, 20, 30, 40],
            stops: [
                [-30, "#4b2a8a"],
                [-20, "#3a49c9"],
                [-10, "#2f7fe0"],
                [0, "#6ec6f0"],
                [5, "#9be3c0"],
                [10, "#b8e86a"],
                [15, "#f1e45c"],
                [22, "#f6a93b"],
                [30, "#e8552b"],
                [40, "#8f1d4a"]
            ]
        },

        wind: {
            label: "سرعت باد",
            unit: "km/h",
            min: 0,
            max: 120,
            ticks: [0, 20, 40, 60, 80, 100, 120],
            stops: [
                [0, "#4aa8e0"],
                [10, "#3cc8a8"],
                [20, "#8fd650"],
                [35, "#e8dc3a"],
                [50, "#f2a030"],
                [70, "#e5502a"],
                [90, "#c0207c"],
                [120, "#6a1b9a"]
            ]
        }

    };

    function hexToRgb(hex) {
        const v = parseInt(hex.slice(1), 16);
        return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }

    function buildLut(map) {

        const lut = new Uint8Array(256 * 3);

        for (let i = 0; i < 256; i++) {

            const value = map.min + (map.max - map.min) * i / 255;

            let k = 1;

            while (k < map.stops.length - 1 && map.stops[k][0] < value) {
                k++;
            }

            const [v0, c0] = map.stops[k - 1];
            const [v1, c1] = map.stops[k];

            let f = (value - v0) / (v1 - v0);

            f = Math.max(0, Math.min(1, f));

            const a = hexToRgb(c0);
            const b = hexToRgb(c1);

            for (let c = 0; c < 3; c++) {
                lut[i * 3 + c] = Math.round(a[c] + (b[c] - a[c]) * f);
            }

        }

        map.lut = lut;

    }

    Object.values(COLORMAPS).forEach(buildLut);


    /* =====================================================
       State
       ===================================================== */

    const state = {
        variable: "off",        // "off" | "temperature" | "wind"  (پیش‌فرض: خاموش)
        area: null,             // { south, north, west, east } of data + image
        data: null,             // { times, profiles[hour][point] }
        elev: null,             // elevation grid (see buildElevationGrid)
        demOk: false,
        hourIndex: 0,
        userMoved: false,
        opacity: 0.6,
        gen: 0,
        loading: false,
        playing: false,
        timer: null,
        renderPending: false,
        eventsBound: false
    };

    const dom = {};

    const weatherCache = new Map();

    let demTemplate = null;

    let debounceTimer = null;

    const canvas =
        typeof document !== "undefined"
            ? document.createElement("canvas")
            : null;


    /* =====================================================
       Small helpers
       ===================================================== */

    function isNum(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function mercY(lat) {
        return (
            1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI
        ) / 2;
    }

    function latFromMercY(y) {
        return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
    }

    function faNumber(value, digits) {
        return Number(value).toLocaleString("fa-IR", {
            minimumIntegerDigits: digits || 1,
            useGrouping: false
        });
    }

    function isMapReady() {
        return (
            typeof map3d !== "undefined" &&
            map3d &&
            typeof map3dInitialized !== "undefined" &&
            map3dInitialized
        );
    }

    /*
     * fetch با مهلت زمانی. اگر سرور جواب ندهد، به‌جای انتظار بی‌پایان
     * خطای مشخص برمی‌گردد و کاربر پیام «تلاش دوباره» می‌بیند.
     */

    async function fetchWithTimeout(url, options, timeoutMs) {

        const controller = new AbortController();

        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {

            return await fetch(
                url,
                Object.assign({}, options, { signal: controller.signal })
            );

        } catch (error) {

            if (error && error.name === "AbortError") {
                throw new Error("TIMEOUT");
            }

            throw error;

        } finally {

            clearTimeout(timer);

        }

    }

    function describeError(error) {

        const message = String((error && error.message) || error || "");

        if (message === "TIMEOUT") {
            return "سرور هواشناسی در زمان مقرر پاسخ نداد.";
        }

        if (/HTTP 429/.test(message) || /limit/i.test(message)) {
            return "سقف درخواست سرویس هواشناسی پر شده است؛ چند دقیقه بعد دوباره تلاش کنید.";
        }

        if (/HTTP 5\d\d/.test(message)) {
            return "سرویس هواشناسی موقتاً در دسترس نیست.";
        }

        if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed/i.test(message)) {
            return "ارتباط با اینترنت برقرار نشد.";
        }

        return message || "خطای نامشخص.";

    }


    /* =====================================================
       Area (bounds of the loaded routes + margin)
       ===================================================== */

    function computeArea() {

        const results =
            typeof analysisResults !== "undefined"
                ? analysisResults
                : [];

        let south = Infinity;
        let north = -Infinity;
        let west = Infinity;
        let east = -Infinity;

        results.forEach(result => {

            const points = result.routeData && result.routeData.points;

            if (!points) {
                return;
            }

            for (let i = 0; i < points.length; i++) {

                const lat = points[i].latitude;
                const lon = points[i].longitude;

                if (!isNum(lat) || !isNum(lon)) {
                    continue;
                }

                if (lat < south) { south = lat; }
                if (lat > north) { north = lat; }
                if (lon < west) { west = lon; }
                if (lon > east) { east = lon; }

            }

        });

        if (!Number.isFinite(south)) {
            return null;
        }

        const padLat = Math.max((north - south) * 0.6, 0.2);
        const padLon = Math.max((east - west) * 0.6, 0.25);

        return {
            south: Math.max(-84, south - padLat),
            north: Math.min(84, north + padLat),
            west: west - padLon,
            east: east + padLon
        };

    }

    function areaCovers(outer, inner) {

        const eps = 1e-6;

        const covers =
            outer.south <= inner.south + eps &&
            outer.north >= inner.north - eps &&
            outer.west <= inner.west + eps &&
            outer.east >= inner.east - eps;

        const notTooBig =
            (outer.north - outer.south) <= 2.5 * (inner.north - inner.south) &&
            (outer.east - outer.west) <= 2.5 * (inner.east - inner.west);

        return covers && notTooBig;

    }


    /* =====================================================
       Weather data (Open-Meteo)
       ===================================================== */

    function gridCoordinates(area) {

        const lats = [];
        const lons = [];

        for (let iy = 0; iy < GRID_N; iy++) {

            const lat = area.south + (area.north - area.south) * iy / (GRID_N - 1);

            for (let ix = 0; ix < GRID_N; ix++) {

                const lon = area.west + (area.east - area.west) * ix / (GRID_N - 1);

                lats.push(lat.toFixed(3));
                lons.push(lon.toFixed(3));

            }

        }

        return { lats, lons };

    }

    function buildWeatherUrl(area) {

        const { lats, lons } = gridCoordinates(area);

        const hourly = ["temperature_2m", "wind_speed_10m"];

        PRESSURE_LEVELS.forEach(level => {
            hourly.push(
                `temperature_${level}hPa`,
                `wind_speed_${level}hPa`,
                `geopotential_height_${level}hPa`
            );
        });

        const params = new URLSearchParams();

        params.set("latitude", lats.join(","));
        params.set("longitude", lons.join(","));
        params.set("hourly", hourly.join(","));
        params.set("forecast_days", String(FORECAST_DAYS));
        params.set("timezone", TIMEZONE);
        params.set("temperature_unit", "celsius");
        params.set("wind_speed_unit", "kmh");

        return `${API_URL}?${params.toString()}`;

    }

    /*
     * Vertical profile of one grid point at one hour:
     * { z: [...], t: [...], w: [...] }  (z ascending)
     * Levels below the (model) ground are dropped.
     */

    function buildProfile(surface, hourly, k) {

        const entries = [];

        const t2 = hourly.temperature_2m ? hourly.temperature_2m[k] : null;
        const w10 = hourly.wind_speed_10m ? hourly.wind_speed_10m[k] : null;

        if (isNum(t2) && isNum(w10)) {
            entries.push([surface, t2, w10]);
        }

        PRESSURE_LEVELS.forEach(level => {

            const gh = hourly[`geopotential_height_${level}hPa`];
            const tt = hourly[`temperature_${level}hPa`];
            const ww = hourly[`wind_speed_${level}hPa`];

            if (!gh || !tt || !ww) {
                return;
            }

            const z = gh[k];
            const t = tt[k];
            const w = ww[k];

            if (isNum(z) && isNum(t) && isNum(w) && z > surface + 40) {
                entries.push([z, t, w]);
            }

        });

        if (entries.length === 0) {
            return null;
        }

        entries.sort((a, b) => a[0] - b[0]);

        const profile = { z: [], t: [], w: [] };

        entries.forEach(entry => {

            const last = profile.z.length - 1;

            if (last >= 0 && entry[0] <= profile.z[last] + 1) {
                return;
            }

            profile.z.push(entry[0]);
            profile.t.push(entry[1]);
            profile.w.push(entry[2]);

        });

        return profile;

    }

    function buildData(responses) {

        if (responses.length !== GRID_N * GRID_N) {
            throw new Error("پاسخ سرویس هواشناسی کامل نیست.");
        }

        const first = responses[0].hourly;

        if (!first || !Array.isArray(first.time)) {
            throw new Error("پاسخ سرویس هواشناسی نامعتبر است.");
        }

        const times = first.time;

        const profiles = times.map(() => new Array(responses.length).fill(null));

        const surfaces = [];

        responses.forEach((response, pointIndex) => {

            const hourly = response.hourly || {};

            const surface = isNum(response.elevation) ? response.elevation : 0;

            surfaces.push(surface);

            for (let k = 0; k < times.length; k++) {
                profiles[k][pointIndex] = buildProfile(surface, hourly, k);
            }

        });

        return { times, profiles, surfaces };

    }

    async function fetchWeather(area) {

        const url = buildWeatherUrl(area);

        const hit = weatherCache.get(url);

        if (hit && Date.now() - hit.time < CACHE_TTL_MS) {
            return hit.promise;
        }

        const promise = (async () => {

            const response = await fetchWithTimeout(url, {}, WEATHER_TIMEOUT_MS);

            if (!response.ok) {

                let reason = "";

                try {
                    reason = (await response.json()).reason || "";
                } catch (e) { /* ignore */ }

                throw new Error(`HTTP ${response.status}` + (reason ? " - " + reason : ""));

            }

            const json = await response.json();

            return buildData(Array.isArray(json) ? json : [json]);

        })();

        weatherCache.set(url, { time: Date.now(), promise });

        promise.catch(() => {
            if (weatherCache.get(url) && weatherCache.get(url).promise === promise) {
                weatherCache.delete(url);
            }
        });

        return promise;

    }


    /* =====================================================
       Terrain elevation (DEM tiles, terrarium encoding)
       ===================================================== */

    async function getDemTemplate() {

        if (demTemplate) {
            return demTemplate;
        }

        try {

            const source = map3d.getSource("dem");

            if (source && Array.isArray(source.tiles) && source.tiles[0]) {
                demTemplate = source.tiles[0];
                return demTemplate;
            }

        } catch (e) { /* ignore */ }

        try {

            const response = await fetchWithTimeout(DEM_TILEJSON_URL, {}, DEM_TIMEOUT_MS);
            const json = await response.json();

            if (json && Array.isArray(json.tiles) && json.tiles[0]) {
                demTemplate = json.tiles[0];
                return demTemplate;
            }

        } catch (e) { /* ignore */ }

        demTemplate = DEM_FALLBACK_URL;

        return demTemplate;

    }

    function tileRange(area, z) {

        const n = Math.pow(2, z);

        const x0 = clamp(Math.floor((area.west + 180) / 360 * n), 0, n - 1);
        const x1 = clamp(Math.floor((area.east + 180) / 360 * n), 0, n - 1);
        const y0 = clamp(Math.floor(mercY(area.north) * n), 0, n - 1);
        const y1 = clamp(Math.floor(mercY(area.south) * n), 0, n - 1);

        return {
            x0, x1, y0, y1,
            count: (x1 - x0 + 1) * (y1 - y0 + 1)
        };

    }

    async function decodeTile(url) {

        const response = await fetchWithTimeout(url, { mode: "cors" }, DEM_TIMEOUT_MS);

        if (!response.ok) {
            throw new Error("DEM tile HTTP " + response.status);
        }

        const blob = await response.blob();

        let bitmap;

        try {
            bitmap = await createImageBitmap(blob, {
                premultiplyAlpha: "none",
                colorSpaceConversion: "none"
            });
        } catch (e) {
            bitmap = await createImageBitmap(blob);
        }

        const c = document.createElement("canvas");

        c.width = bitmap.width;
        c.height = bitmap.height;

        const ctx = c.getContext("2d", { willReadFrequently: true });

        ctx.drawImage(bitmap, 0, 0);

        const pixels = ctx.getImageData(0, 0, c.width, c.height).data;

        const data = new Float32Array(c.width * c.height);

        for (let p = 0; p < data.length; p++) {
            data[p] =
                pixels[p * 4] * 256 +
                pixels[p * 4 + 1] +
                pixels[p * 4 + 2] / 256 -
                32768;
        }

        if (bitmap.close) {
            bitmap.close();
        }

        return { w: c.width, h: c.height, data };

    }

    async function loadDem(area) {

        try {

            const template = await getDemTemplate();

            let z = clamp(
                Math.floor(Math.log2(360 / (area.east - area.west))) + 1,
                4,
                12
            );

            let range = tileRange(area, z);

            while (range.count > DEM_TILE_LIMIT && z > 4) {
                z--;
                range = tileRange(area, z);
            }

            const tiles = new Map();
            const jobs = [];

            for (let ty = range.y0; ty <= range.y1; ty++) {
                for (let tx = range.x0; tx <= range.x1; tx++) {

                    const url = template
                        .replace(/\{z\}/g, z)
                        .replace(/\{x\}/g, tx)
                        .replace(/\{y\}/g, ty);

                    jobs.push(
                        decodeTile(url)
                            .then(tile => tiles.set(`${z}/${tx}/${ty}`, tile))
                            .catch(error => console.warn("DEM tile failed:", error))
                    );

                }
            }

            await Promise.all(jobs);

            return tiles.size > 0 ? { z, tiles } : null;

        } catch (error) {

            console.warn("DEM loading failed:", error);

            return null;

        }

    }

    function sampleDem(dem, lon, my) {

        const n = Math.pow(2, dem.z);

        const x = (lon + 180) / 360 * n;
        const y = my * n;

        const xi = Math.floor(x);
        const yi = Math.floor(y);

        const tile = dem.tiles.get(`${dem.z}/${xi}/${yi}`);

        if (!tile) {
            return NaN;
        }

        const fx = (x - xi) * tile.w - 0.5;
        const fy = (y - yi) * tile.h - 0.5;

        let x0 = Math.floor(fx);
        let y0 = Math.floor(fy);

        const ax = fx - x0;
        const ay = fy - y0;

        let x1 = x0 + 1;
        let y1 = y0 + 1;

        x0 = clamp(x0, 0, tile.w - 1);
        x1 = clamp(x1, 0, tile.w - 1);
        y0 = clamp(y0, 0, tile.h - 1);
        y1 = clamp(y1, 0, tile.h - 1);

        const d = tile.data;

        const top = d[y0 * tile.w + x0] * (1 - ax) + d[y0 * tile.w + x1] * ax;
        const bottom = d[y1 * tile.w + x0] * (1 - ax) + d[y1 * tile.w + x1] * ax;

        return top * (1 - ay) + bottom * ay;

    }

    /*
     * Overlay grid: one elevation per image pixel.
     * Rows are evenly spaced in Mercator Y (that is how MapLibre
     * stretches an image source), columns evenly in longitude.
     */

    function buildElevationGrid(area, dem, data) {

        const midLat = (area.south + area.north) / 2;

        const spanX = (area.east - area.west) * Math.cos(midLat * Math.PI / 180);
        const spanY = area.north - area.south;

        let W;
        let H;

        if (spanX >= spanY) {
            W = MAX_OVERLAY_PX;
            H = Math.max(48, Math.round(MAX_OVERLAY_PX * spanY / spanX));
        } else {
            H = MAX_OVERLAY_PX;
            W = Math.max(48, Math.round(MAX_OVERLAY_PX * spanX / spanY));
        }

        const yN = mercY(area.north);
        const yS = mercY(area.south);

        const lonCol = new Float64Array(W);
        const latRow = new Float64Array(H);
        const myRow = new Float64Array(H);

        const gx = new Float64Array(W);
        const gy = new Float64Array(H);

        for (let i = 0; i < W; i++) {
            lonCol[i] = area.west + (i + 0.5) / W * (area.east - area.west);
            gx[i] = (lonCol[i] - area.west) / (area.east - area.west) * (GRID_N - 1);
        }

        for (let j = 0; j < H; j++) {
            myRow[j] = yN + (j + 0.5) / H * (yS - yN);
            latRow[j] = latFromMercY(myRow[j]);
            gy[j] = (latRow[j] - area.south) / (area.north - area.south) * (GRID_N - 1);
        }

        const values = new Float32Array(W * H);

        for (let j = 0; j < H; j++) {
            for (let i = 0; i < W; i++) {

                if (dem) {

                    values[j * W + i] = sampleDem(dem, lonCol[i], myRow[j]);

                } else {

                    // fallback: smooth model elevation of the grid points
                    values[j * W + i] = bilinearScalar(
                        data.surfaces,
                        gx[i],
                        gy[j]
                    );

                }

            }
        }

        return { W, H, values, gx, gy, yN, yS };

    }

    function bilinearScalar(array, fx, fy) {

        let ix = Math.floor(fx);
        let iy = Math.floor(fy);

        ix = clamp(ix, 0, GRID_N - 2);
        iy = clamp(iy, 0, GRID_N - 2);

        const tx = clamp(fx - ix, 0, 1);
        const ty = clamp(fy - iy, 0, 1);

        const a = array[iy * GRID_N + ix];
        const b = array[iy * GRID_N + ix + 1];
        const c = array[(iy + 1) * GRID_N + ix];
        const d = array[(iy + 1) * GRID_N + ix + 1];

        return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;

    }


    /* =====================================================
       Field evaluation: vertical profile + horizontal bilinear
       ===================================================== */

    function evalProfile(profile, z, kind) {

        const zs = profile.z;
        const values = kind === "wind" ? profile.w : profile.t;
        const n = zs.length;

        if (z <= zs[0]) {
            return kind === "wind"
                ? values[0]
                : values[0] + LAPSE_RATE * (zs[0] - z);
        }

        if (z >= zs[n - 1]) {
            return kind === "wind"
                ? values[n - 1]
                : values[n - 1] - LAPSE_RATE * (z - zs[n - 1]);
        }

        let i = 1;

        while (i < n - 1 && zs[i] < z) {
            i++;
        }

        const f = (z - zs[i - 1]) / (zs[i] - zs[i - 1]);

        return values[i - 1] + (values[i] - values[i - 1]) * f;

    }

    function interpField(profiles, fx, fy, z, kind) {

        const ix = clamp(Math.floor(fx), 0, GRID_N - 2);
        const iy = clamp(Math.floor(fy), 0, GRID_N - 2);

        const tx = clamp(fx - ix, 0, 1);
        const ty = clamp(fy - iy, 0, 1);

        const corners = [
            [profiles[iy * GRID_N + ix], (1 - tx) * (1 - ty)],
            [profiles[iy * GRID_N + ix + 1], tx * (1 - ty)],
            [profiles[(iy + 1) * GRID_N + ix], (1 - tx) * ty],
            [profiles[(iy + 1) * GRID_N + ix + 1], tx * ty]
        ];

        let sum = 0;
        let weight = 0;

        for (let c = 0; c < 4; c++) {

            const profile = corners[c][0];

            if (!profile || corners[c][1] <= 0) {
                continue;
            }

            sum += corners[c][1] * evalProfile(profile, z, kind);
            weight += corners[c][1];

        }

        return weight > 0 ? sum / weight : NaN;

    }


    /* =====================================================
       Rendering
       ===================================================== */

    function render() {

        if (
            state.variable === "off" ||
            !state.data ||
            !state.elev ||
            !state.area ||
            !canvas ||
            !isMapReady()
        ) {
            return;
        }

        const kind = state.variable;
        const colormap = COLORMAPS[kind];
        const lut = colormap.lut;

        const { W, H, values, gx, gy } = state.elev;

        const profiles = state.data.profiles[state.hourIndex];

        if (!profiles) {
            return;
        }

        canvas.width = W;
        canvas.height = H;

        const ctx = canvas.getContext("2d");

        const image = ctx.createImageData(W, H);

        const out = image.data;

        const range = colormap.max - colormap.min;

        for (let j = 0; j < H; j++) {
            for (let i = 0; i < W; i++) {

                const z = values[j * W + i];

                if (!Number.isFinite(z)) {
                    continue;
                }

                const v = interpField(profiles, gx[i], gy[j], z, kind);

                if (!Number.isFinite(v)) {
                    continue;
                }

                const index = clamp(Math.round((v - colormap.min) / range * 255), 0, 255);

                const p = (j * W + i) * 4;

                out[p] = lut[index * 3];
                out[p + 1] = lut[index * 3 + 1];
                out[p + 2] = lut[index * 3 + 2];
                out[p + 3] = 255;

            }
        }

        ctx.putImageData(image, 0, 0);

        pushImage(canvas.toDataURL("image/png"));

    }

    function scheduleRender() {

        if (state.renderPending) {
            return;
        }

        state.renderPending = true;

        requestAnimationFrame(() => {
            state.renderPending = false;
            render();
        });

    }

    function pushImage(url) {

        const a = state.area;

        const coordinates = [
            [a.west, a.north],
            [a.east, a.north],
            [a.east, a.south],
            [a.west, a.south]
        ];

        const source = map3d.getSource(SRC_ID);

        if (source && typeof source.updateImage === "function") {

            source.updateImage({ url, coordinates });

        } else if (!source) {

            map3d.addSource(SRC_ID, {
                type: "image",
                url,
                coordinates
            });

        }

        if (!map3d.getLayer(LYR_ID)) {

            // under the route lines (if they exist already)
            const before = map3d.getLayer("routes-3d") ? "routes-3d" : undefined;

            map3d.addLayer(
                {
                    id: LYR_ID,
                    type: "raster",
                    source: SRC_ID,
                    paint: {
                        "raster-opacity": state.opacity,
                        "raster-fade-duration": 0
                    }
                },
                before
            );

        }

    }

    function removeOverlay() {

        if (!isMapReady()) {
            return;
        }

        try {

            if (map3d.getLayer(LYR_ID)) {
                map3d.removeLayer(LYR_ID);
            }

            if (map3d.getSource(SRC_ID)) {
                map3d.removeSource(SRC_ID);
            }

        } catch (e) { /* ignore */ }

    }


    /* =====================================================
       Activation / data flow
       ===================================================== */

    function nowIndex(times) {

        let key = "";

        try {
            key = new Date()
                .toLocaleString("sv-SE", { timeZone: TIMEZONE })
                .slice(0, 13)
                .replace(" ", "T");
        } catch (e) { /* ignore */ }

        const index = times.findIndex(time => time.slice(0, 13) === key);

        return index >= 0 ? index : 0;

    }

    function retryLoad() {

        state.data = null;
        state.area = null;
        state.elev = null;

        weatherCache.clear();

        activate();

    }

    async function activate() {

        if (state.variable === "off") {
            return;
        }

        if (!isMapReady()) {
            setLoading(true);
            setStatus("نقشهٔ سه‌بعدی در حال بارگذاری است…", "busy");
            return;
        }

        bindMapEvents();

        const area = computeArea();

        if (!area) {
            setLoading(false);
            removeOverlay();
            state.data = null;
            state.area = null;
            state.elev = null;
            setStatus("ابتدا یک مسیر انتخاب کنید.", "warn");
            return;
        }

        const generation = ++state.gen;

        const needLoad =
            !state.data ||
            !state.area ||
            !areaCovers(state.area, area);

        if (needLoad) {

            stopPlay();

            setLoading(true);

            setStatus("در حال دریافت داده‌های هواشناسی و ارتفاع زمین…", "busy");

            let weatherDone = false;
            let demDone = false;

            try {

                const weatherJob = fetchWeather(area).then(data => {

                    weatherDone = true;

                    if (generation === state.gen && !demDone) {
                        setStatus("داده‌های هواشناسی دریافت شد؛ در حال دریافت ارتفاع زمین…", "busy");
                    }

                    return data;

                });

                const demJob = loadDem(area).then(dem => {

                    demDone = true;

                    if (generation === state.gen && !weatherDone) {
                        setStatus("ارتفاع زمین دریافت شد؛ در حال دریافت داده‌های هواشناسی…", "busy");
                    }

                    return dem;

                });

                const [data, dem] = await Promise.all([weatherJob, demJob]);

                if (generation !== state.gen) {
                    return;
                }

                state.area = area;
                state.data = data;
                state.demOk = !!dem;
                state.elev = buildElevationGrid(area, dem, data);

                if (!(state.userMoved && state.hourIndex < data.times.length)) {
                    state.hourIndex = nowIndex(data.times);
                }

                configureTimeControls();

            } catch (error) {

                if (generation !== state.gen) {
                    return;
                }

                console.error("Weather layer error:", error);

                setLoading(false);

                setStatus(
                    "دریافت اطلاعات هواشناسی ناموفق بود. " + describeError(error),
                    "error",
                    retryLoad
                );

                return;

            }

            setLoading(false);

        }

        renderLegend();
        updateTimeUI();
        render();

        setStatus(
            state.demOk
                ? "منبع: Open-Meteo (بهترین ترکیب مدل‌ها). مقدار هر نقطه بر پایهٔ ارتفاع همان نقطه از زمین محاسبه شده است. برای دیدن مقدار، روی نقشه کلیک کنید."
                : "ارتفاع دقیق زمین دریافت نشد؛ از ارتفاع تقریبی مدل استفاده شد و تفکیک ارتفاعی کم است.",
            state.demOk ? "" : "warn",
            state.demOk ? null : retryLoad
        );

    }

    function setMode(mode) {

        if (!COLORMAPS[mode] && mode !== "off") {
            return;
        }

        state.variable = mode;

        dom.modeButtons.forEach(button => {
            const active = button.dataset.mode === mode;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });

        // با خاموش بودن، کل بدنه (اسلایدر زمان، کدری، راهنما) پنهان است
        dom.body.hidden = mode === "off";
        dom.hint.hidden = mode !== "off";
        dom.panel.classList.toggle("is-on", mode !== "off");

        if (mode === "off") {
            stopPlay();
            state.gen++;            // درخواست‌های در حال انجام نادیده گرفته می‌شوند
            setLoading(false);
            removeOverlay();
            setStatus("");
            return;
        }

        renderLegend();

        activate();

    }

    function onRoutesDrawn() {

        // در حالت خاموش هیچ درخواستی ارسال نمی‌شود
        if (state.variable === "off") {
            return;
        }

        clearTimeout(debounceTimer);

        debounceTimer = setTimeout(activate, 250);

    }

    function onRoutesCleared() {

        if (state.variable === "off") {
            return;
        }

        stopPlay();

        state.gen++;
        state.data = null;
        state.area = null;
        state.elev = null;

        setLoading(false);

        removeOverlay();

        setStatus("ابتدا یک مسیر انتخاب کنید.", "warn");

    }


    /* =====================================================
       Click on the map: value at that point
       ===================================================== */

    function sampleAt(lng, lat) {

        const area = state.area;
        const elev = state.elev;

        if (!state.data || !area || !elev) {
            return null;
        }

        const i = Math.floor((lng - area.west) / (area.east - area.west) * elev.W);
        const j = Math.floor((mercY(lat) - elev.yN) / (elev.yS - elev.yN) * elev.H);

        if (i < 0 || j < 0 || i >= elev.W || j >= elev.H) {
            return null;
        }

        const z = elev.values[j * elev.W + i];

        if (!Number.isFinite(z)) {
            return null;
        }

        const profiles = state.data.profiles[state.hourIndex];

        const temperature = interpField(profiles, elev.gx[i], elev.gy[j], z, "temperature");
        const wind = interpField(profiles, elev.gx[i], elev.gy[j], z, "wind");

        return { z, temperature, wind };

    }

    function bindMapEvents() {

        if (state.eventsBound || !isMapReady()) {
            return;
        }

        state.eventsBound = true;

        map3d.on("click", event => {

            if (state.variable === "off") {
                return;
            }

            const routeLayers = ["routes-3d", "route-labels-3d"]
                .filter(id => map3d.getLayer(id));

            if (
                routeLayers.length > 0 &&
                map3d.queryRenderedFeatures(event.point, { layers: routeLayers }).length > 0
            ) {
                return;
            }

            const sample = sampleAt(event.lngLat.lng, event.lngLat.lat);

            if (!sample) {
                return;
            }

            const time = state.data.times[state.hourIndex];

            const lines = [
                `<strong>${formatTimeLabel(time)}</strong>`,
                `ارتفاع زمین: <b>${Math.round(sample.z)}</b> m`
            ];

            if (Number.isFinite(sample.temperature)) {
                lines.push(`دما: <b>${sample.temperature.toFixed(1)}</b> °C`);
            }

            if (Number.isFinite(sample.wind)) {
                lines.push(`باد: <b>${Math.round(sample.wind)}</b> km/h`);
            }

            // رنگ پس‌زمینه و متن پنجره در map-weather.css (حالت روشن و تاریک) تنظیم شده است
            new root.maplibregl.Popup({ className: "wx3d-popup" })
                .setLngLat(event.lngLat)
                .setHTML(lines.join("<br>"))
                .addTo(map3d);

        });

    }


    /* =====================================================
       Panel UI
       ===================================================== */

    function formatTimeLabel(timeString) {

        try {

            const [day, clock] = timeString.split("T");

            const date = new Date(`${day}T12:00:00Z`);

            const weekday = new Intl.DateTimeFormat("fa-IR", {
                weekday: "long",
                timeZone: "UTC"
            }).format(date);

            const jalali = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
                day: "numeric",
                month: "long",
                timeZone: "UTC"
            }).format(date);

            return `${weekday} ${jalali} · ساعت ${faNumber(clock.slice(0, 2), 2)}:۰۰`;

        } catch (e) {

            return timeString;

        }

    }

    /*
     * kind: "" | "busy" | "warn" | "error"
     * onRetry: اگر داده شود، دکمهٔ «تلاش دوباره» کنار پیام نمایش داده می‌شود.
     */

    function setStatus(text, kind, onRetry) {

        if (!dom.status) {
            return;
        }

        dom.status.className = "wx3d-status" + (kind ? " " + kind : "");
        dom.status.textContent = "";

        if (!text) {
            return;
        }

        if (kind === "busy") {

            const spinner = document.createElement("span");

            spinner.className = "wx3d-spinner";
            spinner.setAttribute("aria-hidden", "true");

            dom.status.appendChild(spinner);

        } else if (kind === "error" || kind === "warn") {

            const icon = document.createElement("span");

            icon.className = "wx3d-status-icon";
            icon.setAttribute("aria-hidden", "true");
            icon.textContent = kind === "error" ? "⚠️" : "ℹ️";

            dom.status.appendChild(icon);

        }

        const message = document.createElement("span");

        message.className = "wx3d-status-text";
        message.textContent = text;

        dom.status.appendChild(message);

        if (typeof onRetry === "function") {

            const retry = document.createElement("button");

            retry.type = "button";
            retry.className = "wx3d-retry";
            retry.textContent = "↻ تلاش دوباره";

            retry.addEventListener("click", onRetry);

            dom.status.appendChild(retry);

        }

    }

    function setLoading(flag) {

        state.loading = !!flag;

        if (!dom.panel) {
            return;
        }

        dom.panel.classList.toggle("is-loading", state.loading);
        dom.panel.setAttribute("aria-busy", state.loading ? "true" : "false");

        if (dom.loadbar) {
            dom.loadbar.hidden = !state.loading;
        }

    }

    function renderLegend() {

        const colormap = COLORMAPS[state.variable];

        if (!colormap || !dom.legend) {
            return;
        }

        const range = colormap.max - colormap.min;

        const gradient = colormap.stops
            .map(stop => `${stop[1]} ${((stop[0] - colormap.min) / range * 100).toFixed(1)}%`)
            .join(", ");

        const ticks = colormap.ticks
            .map(value =>
                `<span style="left:${((value - colormap.min) / range * 100).toFixed(1)}%">${value}</span>`
            )
            .join("");

        dom.legend.innerHTML =
            `<div class="wx3d-legend-title">راهنمای رنگ: ${colormap.label} (${colormap.unit})</div>` +
            `<div class="wx3d-legend-bar" style="background:linear-gradient(to right, ${gradient})"></div>` +
            `<div class="wx3d-legend-ticks">${ticks}</div>`;

    }

    function configureTimeControls() {

        const times = state.data ? state.data.times : [];

        dom.slider.max = String(Math.max(0, times.length - 1));
        dom.slider.disabled = times.length === 0;

        dom.days.innerHTML = "";

        const seen = new Set();

        times.forEach((time, index) => {

            const day = time.slice(0, 10);

            if (seen.has(day)) {
                return;
            }

            seen.add(day);

            const noon = times.findIndex(t => t === `${day}T12:00`);

            const target = noon >= 0 ? noon : index;

            const chip = document.createElement("button");

            chip.type = "button";
            chip.className = "wx3d-day";
            chip.dataset.day = day;

            chip.textContent = new Intl.DateTimeFormat("fa-IR", {
                weekday: "long",
                timeZone: "UTC"
            }).format(new Date(`${day}T12:00:00Z`));

            chip.addEventListener("click", () => {
                state.hourIndex = target;
                state.userMoved = true;
                updateTimeUI();
                scheduleRender();
            });

            dom.days.appendChild(chip);

        });

    }

    function updateTimeUI() {

        if (!state.data) {
            return;
        }

        const time = state.data.times[state.hourIndex];

        dom.slider.value = String(state.hourIndex);

        dom.timeLabel.textContent = time ? formatTimeLabel(time) : "";

        const day = time ? time.slice(0, 10) : "";

        dom.days.querySelectorAll(".wx3d-day").forEach(chip => {
            chip.classList.toggle("active", chip.dataset.day === day);
        });

    }

    function stepHour(delta) {

        if (!state.data) {
            return;
        }

        const count = state.data.times.length;

        state.hourIndex = (state.hourIndex + delta + count) % count;
        state.userMoved = true;

        updateTimeUI();
        scheduleRender();

    }

    function startPlay() {

        if (!state.data || state.playing) {
            return;
        }

        state.playing = true;

        dom.play.textContent = "⏸";
        dom.play.setAttribute("aria-label", "توقف");

        state.timer = setInterval(() => stepHour(1), 700);

    }

    function stopPlay() {

        if (state.timer) {
            clearInterval(state.timer);
        }

        state.timer = null;
        state.playing = false;

        if (dom.play) {
            dom.play.textContent = "▶";
            dom.play.setAttribute("aria-label", "پخش");
        }

    }

    function createPanel() {

        const container = document.getElementById("map-3d-container");

        if (!container || document.getElementById("wx3d-panel")) {
            return;
        }

        const panel = document.createElement("div");

        panel.id = "wx3d-panel";
        panel.className = "wx3d-panel";
        panel.setAttribute("aria-busy", "false");

        /*
         * حالت اولیه: خاموش. بدنه (وضعیت، اسلایدر زمان، کدری لایه و
         * راهنمای رنگ) تا زمانی که لایه روشن نشود پنهان است.
         */

        panel.innerHTML = `

            <div class="wx3d-head">

                <div class="wx3d-head-text">
                    <span class="wx3d-title">🌦️ لایهٔ هواشناسی روی زمین سه‌بعدی</span>
                    <span id="wx3d-hint" class="wx3d-hint">برای سرعت بیشتر، این لایه خاموش است و تا روشن نکنید چیزی دانلود نمی‌شود.</span>
                </div>

                <div class="wx3d-modes" role="group" aria-label="نوع لایه">
                    <button type="button" class="wx3d-mode active" data-mode="off" aria-pressed="true">خاموش</button>
                    <button type="button" class="wx3d-mode" data-mode="temperature" aria-pressed="false">🌡️ دما</button>
                    <button type="button" class="wx3d-mode" data-mode="wind" aria-pressed="false">💨 سرعت باد</button>
                </div>

            </div>

            <div id="wx3d-loadbar" class="wx3d-loadbar" hidden><span></span></div>

            <div class="wx3d-body" id="wx3d-body" hidden>

                <div id="wx3d-status" class="wx3d-status" role="status" aria-live="polite"></div>

                <div class="wx3d-card">

                    <div class="wx3d-card-title">زمان پیش‌بینی</div>

                    <div class="wx3d-time">
                        <button id="wx3d-play" class="wx3d-btn" type="button" aria-label="پخش">▶</button>
                        <button id="wx3d-prev" class="wx3d-btn" type="button" aria-label="یک ساعت قبل" dir="ltr">−1h</button>
                        <input id="wx3d-slider" class="wx3d-slider" type="range" min="0" max="0" step="1" value="0" dir="ltr" disabled aria-label="زمان پیش‌بینی">
                        <button id="wx3d-next" class="wx3d-btn" type="button" aria-label="یک ساعت بعد" dir="ltr">+1h</button>
                    </div>

                    <div id="wx3d-time-label" class="wx3d-time-label"></div>

                    <div id="wx3d-days" class="wx3d-days"></div>

                </div>

                <div class="wx3d-card wx3d-card-split">

                    <div id="wx3d-legend" class="wx3d-legend"></div>

                    <label class="wx3d-opacity">
                        <span>کدری لایه</span>
                        <input id="wx3d-opacity" type="range" min="20" max="95" step="5" value="60" dir="ltr">
                        <output id="wx3d-opacity-out">۶۰٪</output>
                    </label>

                </div>

            </div>

        `;

        container.insertBefore(panel, container.firstChild);

        dom.panel = panel;
        dom.hint = panel.querySelector("#wx3d-hint");
        dom.loadbar = panel.querySelector("#wx3d-loadbar");
        dom.body = panel.querySelector("#wx3d-body");
        dom.modeButtons = Array.from(panel.querySelectorAll(".wx3d-mode"));
        dom.slider = panel.querySelector("#wx3d-slider");
        dom.play = panel.querySelector("#wx3d-play");
        dom.timeLabel = panel.querySelector("#wx3d-time-label");
        dom.days = panel.querySelector("#wx3d-days");
        dom.legend = panel.querySelector("#wx3d-legend");
        dom.status = panel.querySelector("#wx3d-status");

        const opacityInput = panel.querySelector("#wx3d-opacity");
        const opacityOut = panel.querySelector("#wx3d-opacity-out");

        dom.modeButtons.forEach(button => {
            button.addEventListener("click", () => setMode(button.dataset.mode));
        });

        dom.slider.addEventListener("input", () => {
            state.hourIndex = Number(dom.slider.value);
            state.userMoved = true;
            updateTimeUI();
            scheduleRender();
        });

        dom.play.addEventListener("click", () => {
            if (state.playing) {
                stopPlay();
            } else {
                startPlay();
            }
        });

        panel.querySelector("#wx3d-prev").addEventListener("click", () => stepHour(-1));
        panel.querySelector("#wx3d-next").addEventListener("click", () => stepHour(1));

        opacityInput.addEventListener("input", () => {

            state.opacity = Number(opacityInput.value) / 100;

            opacityOut.textContent = faNumber(opacityInput.value) + "٪";

            if (isMapReady() && map3d.getLayer(LYR_ID)) {
                map3d.setPaintProperty(LYR_ID, "raster-opacity", state.opacity);
            }

        });

    }


    /* =====================================================
       Hooks (same technique as user-location.js)
       ===================================================== */

    function hook(name, after) {

        const original = root[name];

        if (typeof original !== "function") {
            return;
        }

        root[name] = function () {

            const result = original.apply(this, arguments);

            try {
                after.apply(this, arguments);
            } catch (error) {
                console.error(error);
            }

            return result;

        };

    }

    function initialize() {

        createPanel();

        hook("drawRoutesOn3DMap", onRoutesDrawn);
        hook("clear3DMap", onRoutesCleared);

    }

    if (typeof document !== "undefined") {

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", initialize);
        } else {
            initialize();
        }

    }

    root.mapWeather3D = {
        setMode,
        getState: () => state
    };

})();
