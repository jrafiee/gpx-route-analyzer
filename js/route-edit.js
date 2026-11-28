/* =========================================================
   Route editor (desktop only)

   - Works on a COPY of the route (the original file is never changed).
   - Every operation creates a new immutable state: undo / redo just move
     between states.
   - Output: a new GPX (downloaded, or added to the routes list).
   - Load AFTER map-2d.js, charts.js, gpx-reader.js, route-selection.js
   ========================================================= */

(function () {

    "use strict";

    const $ = id => document.getElementById(id);
    const esc = escapeHtml;

    const WT = {
        summit: ["قله", "⛰️", "Summit"],
        shelter: ["پناهگاه", "🏠", "Shelter"],
        spring: ["چشمه", "💧", "Drinking Water"],
        pass: ["گردنه", "🏔️", "Pass"],
        camp: ["محل کمپ", "⛺", "Campground"]
    };

    let E = null;           // { id, file, orig, cur, clean, hist, fut, sel, a, b, flags }
    let map = null;
    let ui = false;
    let pending = false;
    let stops = [];
    let badEle = [];
    let m3 = null;          // MapLibre (3D view)
    let m3Ready = false;
    let m3NeedFit = false;
    let view = "2d";
    let prevKeep = null;    // indexes kept by the simplify preview

    const g = {};

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const d2 = (a, b) => distance2D(a, b) || 0;
    const dirty = () => !!E && E.cur !== E.clean;

    const dur = s => {
        s = Math.round(s);
        return Math.floor(s / 3600) + ":" + String(Math.floor(s % 3600 / 60)).padStart(2, "0") +
            ":" + String(s % 60).padStart(2, "0");
    };

    function msg(html, kind) {
        const m = $("ed-msg");
        m.className = "ed-msg " + (kind || "");
        m.innerHTML = html;
    }

    function getCum() {
        const c = E.cur;

        if (!c._c) {
            const r = [0];

            for (let i = 1; i < c.points.length; i++) {
                r.push(r[i - 1] + d2(c.points[i - 1], c.points[i]));
            }

            c._c = r;
        }

        return c._c;
    }

    function getLL() {
        const c = E.cur;
        return c._ll || (c._ll = c.points.map(p => [p.latitude, p.longitude]));
    }

    /* [lon, lat] list (MapLibre order) */
    function getCO() {
        const c = E.cur;
        return c._co || (c._co = c.points.map(p => [p.longitude, p.latitude]));
    }


    /* =====================================================
       Analysis
       ===================================================== */

    function toXY(pts) {
        const o = pts[0], k = 111320, c = Math.cos(o.latitude * Math.PI / 180);
        return pts.map(p => [(p.longitude - o.longitude) * k * c, (p.latitude - o.latitude) * k, p.elevation]);
    }

    function segDist(p, a, b, use3) {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = use3 ? b[2] - a[2] : 0;
        const l = dx * dx + dy * dy + dz * dz;

        let t = l > 0
            ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (use3 ? (p[2] - a[2]) * dz : 0)) / l
            : 0;

        t = clamp(t, 0, 1);

        return Math.hypot(
            a[0] + t * dx - p[0],
            a[1] + t * dy - p[1],
            use3 ? a[2] + t * (b[2] - a[2]) - p[2] : 0
        );
    }

    /* Douglas-Peucker (3D, iterative) -> Uint8Array of kept points */
    function simplifyKeep(pts, tol) {
        const n = pts.length, keep = new Uint8Array(n);

        keep[0] = keep[n - 1] = 1;

        if (n < 3) { return keep; }

        const xy = toXY(pts), st = [[0, n - 1]];

        while (st.length) {
            const [s, e] = st.pop();

            let m = -1, idx = -1;

            for (let i = s + 1; i < e; i++) {
                const d = segDist(xy[i], xy[s], xy[e], true);
                if (d > m) { m = d; idx = i; }
            }

            if (m > tol) {
                keep[idx] = 1;
                st.push([s, idx], [idx, e]);
            }
        }

        return keep;
    }

    /* stops: stay within `radius` m of the first point for >= minSec */
    function findStops(pts, minSec, radius) {
        const out = [];
        let i = 0;

        while (i < pts.length - 1) {
            let j = i;

            while (j + 1 < pts.length && d2(pts[i], pts[j + 1]) <= radius) { j++; }

            const sec = (pts[j].time - pts[i].time) / 1000;

            if (j > i && sec >= minSec) {
                out.push({ i, j, sec });
                i = j + 1;
            } else {
                i++;
            }
        }

        return out;
    }

    function timeInfo(pts) {
        if (pts.length < 2 || !pts.every(p => Number.isFinite(p.time))) { return null; }

        let move = 0, dist = 0;

        for (let i = 1; i < pts.length; i++) {
            const dt = (pts[i].time - pts[i - 1].time) / 1000, d = d2(pts[i - 1], pts[i]);

            dist += d;

            if (dt > 0 && d / dt * 3.6 > 0.8) { move += dt; }
        }

        const total = (pts[pts.length - 1].time - pts[0].time) / 1000;

        return {
            start: pts[0].time, end: pts[pts.length - 1].time, total, move,
            stopped: Math.max(0, total - move), avg: move > 0 ? dist / 1000 / (move / 3600) : 0
        };
    }

    /* outliers: far from the chord of the neighbours (+-8 points) or an impossible speed */
    function findOutliers(pts, thr) {
        const set = new Set(), n = pts.length, w = 8;

        if (n < 5) { return set; }

        const xy = toXY(pts);

        for (let i = 1; i < n - 1; i++) {
            if (segDist(xy[i], xy[Math.max(0, i - w)], xy[Math.min(n - 1, i + w)], false) > thr) {
                set.add(i);
            }

            const dt = (pts[i].time - pts[i - 1].time) / 1000;

            if (dt > 0 && d2(pts[i - 1], pts[i]) / dt > 40) { set.add(i); }
        }

        return set;
    }

    /* invalid elevation: out of range, or far from the median of the neighbours */
    function findBadEle(p) {
        const out = [], s = p.map(x => x.elevation).sort((a, b) => a - b), gm = s[s.length >> 1];

        for (let i = 0; i < p.length; i++) {
            const e = p[i].elevation;

            let bad = !Number.isFinite(e) || e < -430 || e > 8900 || (e === 0 && gm > 100);

            if (!bad) {
                const w = [];

                for (let k = Math.max(0, i - 4); k <= Math.min(p.length - 1, i + 4); k++) {
                    if (k !== i) { w.push(p[k].elevation); }
                }

                if (w.length >= 3) {
                    w.sort((a, b) => a - b);
                    bad = Math.abs(e - w[w.length >> 1]) > 100;
                }
            }

            if (bad) { out.push(i); }
        }

        return out;
    }


    /* =====================================================
       State / history
       ===================================================== */

    function load(id) {
        const r = analysisResults.find(x => x.id === id);

        if (!r) { return; }

        const rd = r.routeData;

        const cur = {
            points: rd.points.slice(),
            wpts: (rd.waypoints || []).map(w => Object.assign({}, w)),
            meta: { name: r.route, desc: "" }
        };

        E = { id, file: r.id, orig: cur, cur, clean: cur, applied: cur, hist: [], fut: [], sel: 0, a: 0, b: cur.points.length - 1, flags: new Set() };

        msg("");
        refreshAll(true);
    }

    function afterChange(resetRange) {
        const n = E.cur.points.length;

        E.flags = new Set();

        if (resetRange) { E.a = 0; E.b = n - 1; E.sel = 0; }

        E.sel = Math.min(E.sel, n - 1);
        E.a = Math.min(E.a, n - 1);
        E.b = clamp(E.b, E.a, n - 1);

        refreshAll(false);
    }

    function commit(patch, resetRange) {
        const c = Object.assign({}, E.cur, patch);

        if (patch.points) { c._c = null; c._ll = null; c._co = null; }

        E.hist.push(E.cur);
        E.fut = [];
        E.cur = c;

        afterChange(resetRange);
    }

    function undo() {
        if (!E || !E.hist.length) { return; }
        const len = E.cur.points.length;
        E.fut.push(E.cur);
        E.cur = E.hist.pop();
        afterChange(len !== E.cur.points.length);
    }

    function redo() {
        if (!E || !E.fut.length) { return; }
        const len = E.cur.points.length;
        E.hist.push(E.cur);
        E.cur = E.fut.pop();
        afterChange(len !== E.cur.points.length);
    }

    function resetOriginal() {
        if (!E || E.cur === E.orig) { return; }

        if (!confirm("همهٔ تغییرات حذف و مسیر به فایل اولیه برمی‌گردد (با Undo قابل بازگشت است). ادامه می‌دهید؟")) { return; }

        const o = E.orig;
        commit({ points: o.points, wpts: o.wpts, meta: o.meta }, true);
    }


    /* =====================================================
       Operations
       ===================================================== */

    function cropRange() {
        const { a, b } = E;

        if (b - a < 1) { msg("بازه باید حداقل ۲ نقطه باشد.", "warn"); return; }

        commit({ points: E.cur.points.slice(a, b + 1) }, true);
    }

    function cutRange() {
        const pts = E.cur.points, rest = pts.slice(0, E.a).concat(pts.slice(E.b + 1));

        if (rest.length < 2) { msg("پس از حذف، حداقل ۲ نقطه باید بماند.", "warn"); return; }

        commit({ points: rest }, true);
    }

    function setElevation() {
        const v = parseFloat($("ed-ele").value);

        if (!Number.isFinite(v)) { msg("ارتفاع معتبر وارد کنید.", "warn"); return; }

        const np = E.cur.points.slice();

        np[E.sel] = Object.assign({}, np[E.sel], { elevation: v });

        commit({ points: np });
    }

    function deletePoint() {
        const pts = E.cur.points;

        if (pts.length <= 2) { return; }

        commit({ points: pts.filter((_, i) => i !== E.sel) });
    }

    function simplifyRoute() {
        const pts = E.cur.points, keep = simplifyKeep(pts, +$("ed-tol").value || 5);

        commit({ points: pts.filter((_, i) => keep[i]) }, true);
    }

    function removeFlagged() {
        const rest = E.cur.points.filter((_, i) => !E.flags.has(i));

        if (rest.length < 2) { msg("پس از حذف، حداقل ۲ نقطه باید بماند.", "warn"); return; }

        commit({ points: rest }, true);
    }

    async function fixElevations() {
        const idx = badEle.slice(), base = E.cur, pts = base.points;

        if (!idx.length) { msg("ارتفاع نامعتبری پیدا نشد.", "ok"); return; }

        if (idx.length > 3000) { msg("تعداد نقاط نامعتبر بیش از ۳۰۰۰ است؛ ابتدا مسیر را ساده یا برش دهید.", "warn"); return; }

        const np = pts.slice();

        msg("در حال دریافت ارتفاع از داده توپوگرافی (Open-Meteo)…");

        try {
            for (let s = 0; s < idx.length; s += 100) {
                const part = idx.slice(s, s + 100);

                const url = "https://api.open-meteo.com/v1/elevation?latitude=" +
                    part.map(i => pts[i].latitude.toFixed(5)).join(",") +
                    "&longitude=" + part.map(i => pts[i].longitude.toFixed(5)).join(",");

                const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);

                let r;

                try { r = await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(timer); }

                if (!r.ok) { throw new Error("HTTP " + r.status); }

                const j = await r.json();

                if (!Array.isArray(j.elevation) || j.elevation.length !== part.length) { throw new Error("پاسخ نامعتبر"); }

                part.forEach((i, k) => { np[i] = Object.assign({}, pts[i], { elevation: j.elevation[k] }); });
            }
        } catch (e) {
            msg("دریافت ارتفاع ناموفق بود: " + esc(e.message || e), "error");
            return;
        }

        if (E.cur !== base) { msg("مسیر در این فاصله تغییر کرد؛ دوباره تلاش کنید.", "warn"); return; }

        commit({ points: np });
        msg(idx.length + " ارتفاع با داده توپوگرافی جایگزین شد.", "ok");
    }

    function addWaypoint() {
        const p = E.cur.points[E.sel], t = $("ed-wtype").value;

        const w = {
            latitude: p.latitude, longitude: p.longitude, elevation: p.elevation,
            name: $("ed-wname").value.trim() || WT[t][0],
            description: $("ed-wdesc").value.trim(), type: t, symbol: WT[t][2]
        };

        commit({ wpts: E.cur.wpts.concat(w) });

        $("ed-wname").value = "";
        $("ed-wdesc").value = "";
    }


    /* =====================================================
       Export: build + validate GPX
       ===================================================== */

    function buildGpx(c) {
        let s = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Pakoob" xmlns="http://www.topografix.com/GPX/1/1">\n';

        s += `<metadata><name>${esc(c.meta.name)}</name>` +
            (c.meta.desc ? `<desc>${esc(c.meta.desc)}</desc>` : "") +
            `<time>${new Date().toISOString()}</time></metadata>\n`;

        c.wpts.forEach(w => {
            s += `<wpt lat="${w.latitude}" lon="${w.longitude}">` +
                (Number.isFinite(w.elevation) ? `<ele>${(+w.elevation).toFixed(1)}</ele>` : "") +
                `<name>${esc(w.name || "")}</name>` +
                (w.description ? `<desc>${esc(w.description)}</desc>` : "") +
                (w.symbol ? `<sym>${esc(w.symbol)}</sym>` : "") +
                (w.type ? `<type>${esc(w.type)}</type>` : "") + "</wpt>\n";
        });

        s += `<trk><name>${esc(c.meta.name)}</name><trkseg>\n`;

        c.points.forEach(p => {
            s += `<trkpt lat="${p.latitude.toFixed(7)}" lon="${p.longitude.toFixed(7)}"><ele>${(+p.elevation).toFixed(1)}</ele>` +
                (Number.isFinite(p.time) ? `<time>${new Date(p.time).toISOString()}</time>` : "") + "</trkpt>\n";
        });

        return s + "</trkseg></trk>\n</gpx>\n";
    }

    function validateGpx(text) {
        const err = [], warn = [];
        const doc = new DOMParser().parseFromString(text, "application/xml");

        if (doc.querySelector("parsererror")) { return { err: ["ساختار XML معتبر نیست."], warn }; }

        const root = doc.documentElement;

        if (root.localName !== "gpx") { err.push("عنصر ریشه gpx نیست."); }
        if (!root.getAttribute("version")) { err.push("ویژگی version در gpx وجود ندارد."); }

        const tp = doc.getElementsByTagNameNS("*", "trkpt");

        if (tp.length < 2) { err.push("مسیر حداقل ۲ نقطه لازم دارد."); }

        let badPos = 0, badEle = 0, back = 0, prev = -Infinity;

        for (let i = 0; i < tp.length; i++) {
            const lat = parseFloat(tp[i].getAttribute("lat")), lon = parseFloat(tp[i].getAttribute("lon"));

            if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) { badPos++; }

            const ele = tp[i].getElementsByTagNameNS("*", "ele")[0];

            if (!ele || !Number.isFinite(parseFloat(ele.textContent))) { badEle++; }

            const tm = tp[i].getElementsByTagNameNS("*", "time")[0];

            if (tm) {
                const t = Date.parse(tm.textContent);
                if (!Number.isFinite(t) || t < prev) { back++; } else { prev = t; }
            }
        }

        if (badPos) { err.push(badPos + " نقطه مختصات نامعتبر دارد."); }
        if (badEle) { err.push(badEle + " نقطه ارتفاع نامعتبر دارد."); }
        if (back) { warn.push(back + " نقطه زمان نامعتبر یا برگشتی دارد."); }

        const w = doc.getElementsByTagNameNS("*", "wpt");

        for (let i = 0; i < w.length; i++) {
            const lat = parseFloat(w[i].getAttribute("lat")), lon = parseFloat(w[i].getAttribute("lon"));

            if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) { err.push("نقطهٔ راهنمای " + (i + 1) + " مختصات نامعتبر دارد."); }
        }

        if (!E.cur.meta.name.trim()) { warn.push("نام مسیر خالی است."); }

        return { err, warn };
    }

    function exportName(unique) {
        const base = sanitizeFileName(routeBaseName(E.file) + "-edited");

        let name = base + ".gpx", k = 2;

        while (unique && selectedFiles.some(f => f.name === name)) { name = base + "-" + (k++) + ".gpx"; }

        return name;
    }

    async function save(toProject) {
        const text = buildGpx(E.cur), v = validateGpx(text);
        const list = a => "<ul>" + a.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>";

        if (v.err.length) { msg("خروجی ساخته نشد:" + list(v.err), "error"); return; }

        const blob = new Blob([text], { type: "application/gpx+xml" });

        if (toProject) {
            const file = new File([blob], exportName(true), { type: "application/gpx+xml" });

            await addGpxFile(file, { title: E.cur.meta.name });
        } else {
            triggerBlobDownload(blob, exportName(false));
        }

        E.clean = E.cur;
        updatePanel();

        msg((toProject ? "به فهرست مسیرها اضافه شد." : "فایل جدید دانلود شد.") +
            " (اعتبارسنجی XML/GPX موفق)" + (v.warn.length ? list(v.warn) : ""), v.warn.length ? "warn" : "ok");
    }


    /* =====================================================
       Rendering
       ===================================================== */

    /* =====================================================
       Apply the edited route to the app
       (replaces the route in the list: all other tabs use it)
       ===================================================== */

    async function applyToApp() {
        if (!E || E.cur === E.applied) { return; }

        const snap = E.cur, oldId = E.id;
        const text = buildGpx(snap), v = validateGpx(text);

        if (v.err.length) {
            msg("اعمال انجام نشد:<ul>" + v.err.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>", "error");
            return;
        }

        if (!analysisResults.some(r => r.id === oldId)) {
            msg("مسیر اصلی دیگر در فهرست نیست؛ از «افزودن به مسیرها» استفاده کنید.", "warn");
            return;
        }

        const base = sanitizeFileName(routeBaseName(oldId));

        let name = base + ".gpx", k = 2;

        while (name !== oldId && selectedFiles.some(f => f.name === name)) { name = base + "-" + (k++) + ".gpx"; }

        const file = new File([new Blob([text], { type: "application/gpx+xml" })], name, { type: "application/gpx+xml" });

        let route, result, title;

        try {
            route = await loadRouteFile(file);
            title = makeUniqueRouteTitle(snap.meta.name.trim() || routeBaseName(name), oldId);
            result = analyzeRoute(route, title);
        } catch (e) {
            msg("تحلیل مسیر ویرایش‌شده ممکن نشد: " + esc(e.message || e), "error");
            return;
        }

        const idx = analysisResults.findIndex(r => r.id === oldId);

        if (idx < 0 || !E || E.id !== oldId) {
            msg("مسیر در این فاصله تغییر کرد؛ دوباره تلاش کنید.", "warn");
            return;
        }

        result.id = name;
        result.routeData = route;

        // same position in the list; the list item is rebuilt so its buttons use the new file
        const container = $("selected-routes");
        const oldItem = findSelectedRouteItem(oldId);
        const pos = Array.from(container.querySelectorAll(".selected-route")).indexOf(oldItem);

        analysisResults[idx] = result;
        selectedFiles = selectedFiles.map(f => f.name === oldId ? file : f);

        if (oldItem) { oldItem.remove(); }

        addSelectedRoute(file, title);

        const item = findSelectedRouteItem(name);
        const others = Array.from(container.querySelectorAll(".selected-route")).filter(x => x !== item);

        if (item) { container.insertBefore(item, others[pos] || null); }

        updateRouteNumbers();

        await saveRouteToStorage(file, title);

        if (name !== oldId) { await deleteRouteFromStorage(oldId); }

        E.id = name;
        E.file = name;
        E.applied = snap;
        E.clean = snap;

        // charts, maps, weather, navigation and the route list use the new route
        redrawAllCharts();
        updatePanel();

        msg("✓ تغییرات روی مسیر اعمال شد و جایگزین نسخهٔ قبلی در برنامه شد؛ در تب‌های تحلیل، نقشه، هواشناسی و ناوبری هم دیده می‌شود.", "ok");
    }


    /* =====================================================
       3D view (MapLibre, same tiles / terrain as the main 3D map)
       ===================================================== */

    const emptyFC = () => ({ type: "FeatureCollection", features: [] });

    const lineFeature = co => co.length < 2
        ? emptyFC()
        : { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: co } };

    const pointFeature = (c, kind) =>
        ({ type: "Feature", properties: { kind }, geometry: { type: "Point", coordinates: c } });

    function setView(v) {
        view = v;

        const is3 = v === "3d";

        $("ed-map").hidden = is3;
        $("ed-map3d").hidden = !is3;
        $("ed-base3d").hidden = !is3;
        $("ed-v2d").classList.toggle("active", !is3);
        $("ed-v3d").classList.toggle("active", is3);

        if (is3) {
            open3D();
        } else if (map) {
            setTimeout(() => map.invalidateSize(), 60);
        }
    }

    async function open3D() {
        try {
            if (!m3) {
                await create3D();
            } else {
                m3.resize();

                if (m3Ready && m3NeedFit) { fit3D(); }
            }
        } catch (e) {
            console.error(e);
            msg("بارگذاری نقشهٔ سه‌بعدی ممکن نشد: " + esc(e.message || e), "error");
            setView("2d");
        }
    }

    function apply3DBase(mode) {
        const cfg = BASE_LAYER_MODES[mode] || BASE_LAYER_MODES.sat;

        BASE_LAYER_IDS.forEach(id => {
            if (m3.getLayer(id)) {
                m3.setLayoutProperty(id, "visibility", cfg.layers.includes(id) ? "visible" : "none");
            }
        });

        if (m3.getLayer("base-topo")) { m3.setPaintProperty("base-topo", "raster-opacity", cfg.topoOpacity); }
        if (m3.getLayer("hillshade")) { m3.setPaintProperty("hillshade", "hillshade-exaggeration", cfg.hillshade); }
    }

    async function create3D() {
        const ml = await loadMapLibre();

        if (m3) { return; }

        m3NeedFit = true;

        m3 = new ml.Map({
            container: "ed-map3d",
            center: [51.5, 32.0],
            zoom: 7,
            pitch: 55,
            bearing: 0,
            maxPitch: 85,
            style: {
                version: 8,
                sources: {
                    satellite: rasterSource("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", 19, "Tiles &copy; Esri"),
                    topo: rasterSource("https://tile.opentopomap.org/{z}/{x}/{y}.png", 17, "Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap"),
                    osm: rasterSource("https://tile.openstreetmap.org/{z}/{x}/{y}.png", 19, "&copy; OpenStreetMap contributors"),
                    dem: {
                        type: "raster-dem",
                        url: "https://tiles.mapterhorn.com/tilejson.json",
                        encoding: "terrarium",
                        tileSize: 512,
                        maxzoom: 12,
                        attribution: "Terrain &copy; Mapterhorn"
                    }
                },
                layers: [
                    { id: "base-osm", type: "raster", source: "osm", layout: { visibility: "none" } },
                    { id: "base-sat", type: "raster", source: "satellite", layout: { visibility: "visible" } },
                    { id: "base-topo", type: "raster", source: "topo", layout: { visibility: "none" }, paint: { "raster-opacity": 1 } },
                    { id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.3, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#ffffff" } }
                ]
            }
        });

        m3.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-left");
        m3.addControl(new ml.ScaleControl({ unit: "metric" }), "bottom-left");

        m3.on("error", ev => console.error("Editor 3D map error:", ev));

        m3.on("load", () => {
            m3.setTerrain({ source: "dem", exaggeration: 1.4 });

            ["ed-range", "ed-line", "ed-pts", "ed-sel"].forEach(id => {
                m3.addSource(id, { type: "geojson", data: emptyFC() });
            });

            m3.addLayer({ id: "ed-range", type: "line", source: "ed-range", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ff9800", "line-width": 9, "line-opacity": 0.85 } });
            m3.addLayer({ id: "ed-line", type: "line", source: "ed-line", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#1e88e5", "line-width": 4 } });

            m3.addLayer({
                id: "ed-pts",
                type: "circle",
                source: "ed-pts",
                paint: {
                    "circle-radius": ["match", ["get", "kind"], "wpt", 7, "keep", 3.5, 5],
                    "circle-color": ["match", ["get", "kind"], "wpt", "#0b7a66", "flag", "#ff5252", "bad", "#ab47bc", "stop", "#ff9800", "keep", "#ff9800", "#888888"],
                    "circle-stroke-color": "#ffffff",
                    "circle-stroke-width": 1.5
                }
            });

            m3.addLayer({ id: "ed-sel", type: "circle", source: "ed-sel", paint: { "circle-radius": 8, "circle-color": "#e53935", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });

            apply3DBase($("ed-base3d").value);

            m3Ready = true;

            update3DLine(true);
            update3DRange();
            update3DSel();
            update3DPts();
        });

        // click: select the nearest track point (screen distance)
        m3.on("click", ev => {
            if (!E) { return; }

            const co = getCO();

            let best = -1, bd = Infinity;

            for (let i = 0; i < co.length; i++) {
                const q = m3.project(co[i]), dx = q.x - ev.point.x, dy = q.y - ev.point.y, d = dx * dx + dy * dy;

                if (d < bd) { bd = d; best = i; }
            }

            if (best >= 0 && bd < 900) { setSel(best); }
        });
    }

    function fit3D() {
        m3NeedFit = false;

        const co = getCO();

        if (!co.length) { return; }

        const b = new window.maplibregl.LngLatBounds(co[0], co[0]);

        co.forEach(c => b.extend(c));

        m3.fitBounds(b, { padding: 50, pitch: 55, bearing: 0, duration: 700 });
    }

    function update3DLine(fit) {
        if (!m3Ready || !E) { return; }

        m3.getSource("ed-line").setData(lineFeature(getCO()));

        if (fit) {
            if (view === "3d") { fit3D(); } else { m3NeedFit = true; }
        }
    }

    function update3DRange() {
        if (!m3Ready || !E) { return; }

        m3.getSource("ed-range").setData(lineFeature(getCO().slice(E.a, E.b + 1)));
    }

    function update3DSel() {
        if (!m3Ready || !E) { return; }

        const c = getCO()[E.sel];

        m3.getSource("ed-sel").setData(c ? pointFeature(c, "sel") : emptyFC());
    }

    function update3DPts() {
        if (!m3Ready || !E) { return; }

        const co = getCO(), f = [];

        E.cur.wpts.forEach(w => f.push(pointFeature([w.longitude, w.latitude], "wpt")));

        if ($("ed-showstops").checked) {
            stops.forEach(s => { if (co[s.i]) { f.push(pointFeature(co[s.i], "stop")); } });
        }

        E.flags.forEach(i => { if (co[i]) { f.push(pointFeature(co[i], "flag")); } });
        badEle.forEach(i => { if (co[i]) { f.push(pointFeature(co[i], "bad")); } });

        if (prevKeep && prevKeep.length <= 600) {
            prevKeep.forEach(i => { if (co[i]) { f.push(pointFeature(co[i], "keep")); } });
        }

        m3.getSource("ed-pts").setData({ type: "FeatureCollection", features: f });
    }

    /* simplify preview: the points that would stay (orange) */
    function drawPreview() {
        if (map && g.prev) {
            g.prev.clearLayers();

            if (prevKeep && E) {
                const ll = getLL(), pts = prevKeep.map(i => ll[i]);

                L.polyline(pts, { color: "#ff9800", weight: 3, dashArray: "6 6", interactive: false }).addTo(g.prev);

                if (pts.length <= 600) {
                    pts.forEach(q => L.circleMarker(q, { radius: 4, color: "#fff", weight: 1.5, fillColor: "#ff9800", fillOpacity: 1, interactive: false }).addTo(g.prev));
                }
            }
        }

        update3DPts();
    }


    function refreshAll(fit) {
        if (!ui || !E) { return; }

        if (activeSection !== "edit") { pending = true; return; }

        pending = false;

        const created = initMap();

        badEle = findBadEle(E.cur.points);

        updatePanel();
        renderTime();
        renderWpts();

        g.main.setLatLngs(getLL());

        if (created || fit) {
            map.invalidateSize();
            map.fitBounds(g.main.getBounds(), { padding: [30, 30] });
        }

        drawProfile();
        drawMarks();
        selUI();
        rangeUI();
        update3DLine(fit || created);
    }

    function updatePanel() {
        const c = E.cur, n = c.points.length, cm = getCum();

        ["ed-sel", "ed-a", "ed-b"].forEach(id => { $(id).max = n - 1; });

        $("ed-undo").disabled = !E.hist.length;
        $("ed-redo").disabled = !E.fut.length;

        let gain = 0;

        for (let i = 1; i < n; i++) { gain += Math.max(0, c.points[i].elevation - c.points[i - 1].elevation); }

        $("ed-stat").textContent = `${n} نقطه · ${(cm[n - 1] / 1000).toFixed(2)} km · صعود ${Math.round(gain)} m`;
        $("ed-dirty").textContent = E.cur !== E.applied ? "● تغییرات هنوز در برنامه اعمال نشده" : "";
        $("ed-apply").disabled = $("ed-apply2").disabled = E.cur === E.applied;

        $("ed-mname").value = c.meta.name;
        $("ed-mdesc").value = c.meta.desc;

        $("ed-einfo").textContent = badEle.length
            ? badEle.length + " نقطه با ارتفاع نامعتبر (بنفش روی نقشه)"
            : "ارتفاع نامعتبری پیدا نشد.";

        $("ed-oinfo").textContent = E.flags.size ? E.flags.size + " نقطهٔ مشکوک علامت‌گذاری شد (قرمز روی نقشه)." : "";

        tolPreview();
    }

    function tolPreview() {
        if (!E) { return; }

        const keep = simplifyKeep(E.cur.points, +$("ed-tol").value || 5);

        prevKeep = null;

        if ($("ed-prevchk").checked && $("ed-clean").open) {
            prevKeep = [];
            keep.forEach((v, i) => { if (v) { prevKeep.push(i); } });
        }

        drawPreview();

        let k = 0;

        keep.forEach(v => { k += v; });

        $("ed-tolinfo").textContent = `با این مقدار ${k} از ${keep.length} نقطه می‌ماند.`;
    }

    function renderTime() {
        const c = E.cur, ti = timeInfo(c.points), box = $("ed-time"), cm = getCum();

        if (!ti) {
            stops = [];
            box.innerHTML = "<small>این مسیر زمان کامل ندارد (فایل بدون time یا ناقص).</small>";
            return;
        }

        stops = findStops(c.points, +$("ed-stopsec").value || 120, +$("ed-stoprad").value || 30);

        const f = t => new Date(t).toLocaleString("fa-IR");

        box.innerHTML = "<table>" +
            `<tr><td>شروع</td><td>${f(ti.start)}</td></tr>` +
            `<tr><td>پایان</td><td>${f(ti.end)}</td></tr>` +
            `<tr><td>مدت کل</td><td>${dur(ti.total)}</td></tr>` +
            `<tr><td>زمان حرکت</td><td>${dur(ti.move)}</td></tr>` +
            `<tr><td>زمان توقف</td><td>${dur(ti.stopped)}</td></tr>` +
            `<tr><td>سرعت متوسط حرکت</td><td>${ti.avg.toFixed(2)} km/h</td></tr></table>` +
            `<div>${stops.length} توقف:</div><div class="ed-stops">` +
            stops.map((s, k) => `<button type="button" class="ed-stopb" data-i="${s.i}">${k + 1}. ${dur(s.sec)} · ${(cm[s.i] / 1000).toFixed(2)} km</button>`).join("") + "</div>";
    }

    function renderWpts() {
        $("ed-wlist").innerHTML = E.cur.wpts.map((w, i) =>
            `<div class="ed-w" data-i="${i}"><span>${(WT[w.type] || [0, "📍"])[1]}</span>` +
            `<input type="text" data-f="name" value="${esc(w.name || "")}" placeholder="نام">` +
            `<input type="text" data-f="description" value="${esc(w.description || "")}" placeholder="توضیحات">` +
            '<button type="button" data-act="go" title="نمایش روی نقشه">◎</button>' +
            '<button type="button" data-act="del" title="حذف">×</button></div>'
        ).join("") || "<small>نقطهٔ راهنمایی وجود ندارد.</small>";
    }

    function selUI() {
        if (!E) { return; }

        const p = E.cur.points[E.sel], cm = getCum();

        $("ed-sel").value = E.sel;
        $("ed-ele").value = Number(p.elevation).toFixed(1);

        $("ed-selinfo").innerHTML =
            `نقطه <b>${E.sel + 1}</b> از ${E.cur.points.length} · مسافت <b>${(cm[E.sel] / 1000).toFixed(2)}</b> km<br>` +
            `<span dir="ltr">${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}</span>` +
            (Number.isFinite(p.time) ? "<br>" + new Date(p.time).toLocaleString("fa-IR") : "");

        if (map) {
            g.sel.setLatLng([p.latitude, p.longitude]);
            if (!map.hasLayer(g.sel)) { g.sel.addTo(map); }
        }

        shapesUpdate();
        update3DSel();
    }

    function rangeUI() {
        if (!E) { return; }

        const cm = getCum();

        $("ed-a").value = E.a;
        $("ed-b").value = E.b;

        $("ed-rng").textContent =
            `از ${(cm[E.a] / 1000).toFixed(2)} km تا ${(cm[E.b] / 1000).toFixed(2)} km (${E.b - E.a + 1} نقطه)`;

        if (map) { g.range.setLatLngs(getLL().slice(E.a, E.b + 1)); }

        shapesUpdate();
        update3DRange();
    }

    function setSel(i) {
        E.sel = clamp(Math.round(i), 0, E.cur.points.length - 1);
        selUI();
    }

    function initMap() {
        if (map) { return false; }

        map = L.map("ed-map", { preferCanvas: true });

        const bl = createBaseLayers();

        bl["توپوگرافی"].addTo(map);

        L.control.layers(bl, null, { collapsed: true }).addTo(map);

        g.main = L.polyline([], { color: "#1e88e5", weight: 4 }).addTo(map);
        g.range = L.polyline([], { color: "#ff9800", weight: 8, opacity: 0.8 }).addTo(map);
        g.marks = L.layerGroup().addTo(map);
        g.prev = L.layerGroup().addTo(map);
        g.sel = L.circleMarker([0, 0], { radius: 8, color: "#fff", weight: 2, fillColor: "#e53935", fillOpacity: 1 });

        map.on("click", ev => {
            if (!E) { return; }

            const ll = getLL(), cp = map.latLngToContainerPoint(ev.latlng), cos = Math.cos(ev.latlng.lat * Math.PI / 180);

            let best = -1, bd = Infinity;

            for (let i = 0; i < ll.length; i++) {
                const dx = (ll[i][1] - ev.latlng.lng) * cos, dy = ll[i][0] - ev.latlng.lat, d = dx * dx + dy * dy;
                if (d < bd) { bd = d; best = i; }
            }

            if (best >= 0 && map.latLngToContainerPoint(ll[best]).distanceTo(cp) < 30) { setSel(best); }
        });

        map.setView([32, 51.5], 7);

        return true;
    }

    function drawMarks() {
        g.marks.clearLayers();

        const c = E.cur, ll = getLL();

        c.wpts.forEach(w => {
            L.marker([w.latitude, w.longitude], {
                icon: L.divIcon({ className: "", html: `<div class="ed-wpt">${(WT[w.type] || [0, "📍"])[1]}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })
            }).bindTooltip(esc(w.name || "")).addTo(g.marks);
        });

        ($("ed-showstops").checked ? stops : []).forEach(s => {
            L.marker(ll[s.i], {
                icon: L.divIcon({ className: "", html: '<div class="ed-stop">⏸</div>', iconSize: [26, 26], iconAnchor: [13, 13] })
            }).bindTooltip("توقف " + dur(s.sec)).addTo(g.marks);
        });

        E.flags.forEach(i => {
            L.circleMarker(ll[i], { radius: 7, color: "#b71c1c", fillColor: "#ff5252", fillOpacity: 0.9 })
                .bindTooltip("نقطهٔ پرت (مشکوک)").addTo(g.marks);
        });

        badEle.forEach(i => {
            L.circleMarker(ll[i], { radius: 5, color: "#4a148c", fillColor: "#ab47bc", fillOpacity: 0.9 })
                .bindTooltip("ارتفاع نامعتبر: " + Math.round(E.cur.points[i].elevation) + " m").addTo(g.marks);
        });

        update3DPts();
    }

    function shapes() {
        const cm = getCum(), x = i => cm[i] / 1000;

        return [
            { type: "rect", xref: "x", yref: "paper", x0: x(E.a), x1: x(E.b), y0: 0, y1: 1, fillcolor: "rgba(255,152,0,.22)", line: { width: 0 } },
            { type: "line", xref: "x", yref: "paper", x0: x(E.sel), x1: x(E.sel), y0: 0, y1: 1, line: { color: "#e53935", width: 2 } }
        ];
    }

    function shapesUpdate() {
        const el = $("ed-profile");

        if (el && el.data && E) { Plotly.relayout(el, { shapes: shapes() }); }
    }

    function drawProfile() {
        const c = E.cur, el = $("ed-profile");

        const layout = buildPlotLayout("", "ارتفاع (m)", "مسافت (km)");

        layout.hovermode = "closest";
        layout.margin.t = 10;
        layout.shapes = shapes();

        /* strong contrast in both themes */
        const dk = document.body.classList.contains("dark-mode");
        const txt = dk ? "#e5e5e5" : "#1f2933";
        const axis = dk ? "rgba(255,255,255,.55)" : "rgba(31,41,51,.65)";
        const grid = dk ? "rgba(255,255,255,.12)" : "rgba(31,41,51,.15)";

        const styleAxis = (ax, showGrid) => Object.assign({}, ax, {
            color: txt,
            showline: true,
            linecolor: axis,
            linewidth: 1.2,
            ticks: "outside",
            ticklen: 5,
            tickcolor: axis,
            showgrid: showGrid,
            gridcolor: grid,
            tickfont: { family: CHART_FONT_MONO, size: 12.5, color: txt },
            title: Object.assign({}, ax.title, { font: Object.assign({}, ax.title && ax.title.font, { size: 13, color: txt }) })
        });

        layout.font = Object.assign({}, layout.font, { color: txt });
        layout.xaxis = styleAxis(layout.xaxis, false);
        layout.yaxis = styleAxis(layout.yaxis, true);

        Plotly.react(el, [{
            x: getCum().map(v => v / 1000), y: c.points.map(p => p.elevation),
            type: "scatter", mode: "lines", line: { color: "#1e88e5", width: 2 },
            hovertemplate: "%{y:.0f} m · %{x:.2f} km<extra></extra>"
        }], layout, { responsive: true, displaylogo: false, displayModeBar: false }).then(() => {
            if (!el._edBound) {
                el._edBound = true;
                el.on("plotly_click", ev => { if (E && ev.points[0]) { setSel(ev.points[0].pointIndex); } });
            }
        });
    }


    /* =====================================================
       Route list / section hooks
       ===================================================== */

    function refreshList() {
        const sel = $("ed-route");

        if (!sel) { return; }

        const items = analysisResults.map(r => ({ id: r.id, name: r.route }));

        if (E && !items.some(i => i.id === E.id) && dirty()) {
            items.push({ id: E.id, name: E.cur.meta.name + " (خارج از فهرست)" });
        }

        sel.innerHTML = items.map((r, i) => `<option value="${esc(r.id)}">${i + 1}. ${esc(r.name)}</option>`).join("");

        $("ed-empty").hidden = items.length > 0;
        $("ed-root").hidden = items.length === 0;

        if (items.length === 0) { E = null; return; }

        if (!E || !items.some(i => i.id === E.id)) {
            load(items[0].id);
        } else {
            sel.value = E.id;
        }
    }

    let themeDirty = false;

    function onSection(id) {
        if (id === "edit" && ui) {
            if (themeDirty && E) {
                themeDirty = false;
                drawProfile();
            }

            if (!E) { refreshList(); } else if (pending || !map) { refreshAll(true); }

            if (map) { setTimeout(() => map.invalidateSize(), 80); }

            if (m3 && view === "3d") { setTimeout(() => m3.resize(), 80); }
        }
    }


    /* =====================================================
       UI
       ===================================================== */

    /* ---------- help (؟) texts with before / after drawings ---------- */

    const HELP_BTN = '<button type="button" class="ed-help-btn" aria-label="راهنما" aria-expanded="false" title="راهنما">؟</button>';

    const figLine = (pts, dotClass) =>
        '<polyline class="ln" points="' + pts.map(q => q.join(",")).join(" ") + '"/>' +
        (dotClass ? pts.map(q => '<circle class="' + dotClass + '" cx="' + q[0] + '" cy="' + q[1] + '" r="2.4"/>').join("") : "");

    /* "before" on the right, "after" on the left (the page is right-to-left) */
    const figSvg = (before, after) =>
        '<svg class="ed-fig" viewBox="0 0 230 70" role="img" aria-label="تصویر قبل و بعد">' +
        '<rect class="bx" x="1" y="1" width="104" height="54" rx="6"/><rect class="bx" x="125" y="1" width="104" height="54" rx="6"/>' +
        '<path class="ar" d="M118 28h-10m4-4-4 4 4 4"/>' +
        '<text class="tx" x="177" y="67">قبل</text><text class="tx" x="53" y="67">بعد</text>' +
        '<g transform="translate(125 1)">' + before + '</g><g transform="translate(1 1)">' + after + '</g></svg>';

    const FIG_SIMPLIFY = figSvg(
        figLine([[6, 42], [16, 38], [26, 40], [36, 33], [46, 35], [56, 28], [66, 30], [76, 22], [86, 24], [98, 12]], "dt"),
        figLine([[6, 42], [56, 28], [98, 12]], "kp")
    );

    const FIG_OUTLIER = figSvg(
        figLine([[6, 38], [22, 35], [38, 32], [52, 6], [66, 26], [82, 22], [98, 19]], "dt") + '<circle class="bad" cx="52" cy="6" r="3.8"/>',
        figLine([[6, 38], [22, 35], [38, 32], [66, 26], [82, 22], [98, 19]], "dt")
    );

    const FIG_ELE = figSvg(
        figLine([[6, 20], [22, 18], [38, 16], [52, 48], [66, 14], [82, 12], [98, 10]], "dt") + '<circle class="vio" cx="52" cy="48" r="3.8"/>',
        figLine([[6, 20], [22, 18], [38, 16], [52, 15], [66, 14], [82, 12], [98, 10]], "dt") + '<circle class="ok" cx="52" cy="15" r="3.8"/>'
    );

    const FIG_WPT = figSvg(
        figLine([[6, 42], [24, 36], [42, 31], [60, 24], [78, 26], [98, 12]], null),
        figLine([[6, 42], [24, 36], [42, 31], [60, 24], [78, 26], [98, 12]], null) +
        '<rect class="wp" x="56" y="20" width="8" height="8" transform="rotate(45 60 24)"/><text class="tx" x="60" y="13">چشمه</text>'
    );

    /* stop + radius drawing */
    const FIG_STOP =
        '<svg class="ed-fig" viewBox="0 0 230 70" role="img" aria-label="تصویر توقف و شعاع">' +
        '<rect class="bx" x="1" y="1" width="228" height="54" rx="6"/>' +
        '<polyline class="ln" points="10,42 40,40 70,36 108,30 150,24 190,19 220,14"/>' +
        '<circle class="rg" cx="115" cy="29" r="19"/>' +
        '<g class="sp"><circle cx="108" cy="30" r="2"/><circle cx="113" cy="26" r="2"/><circle cx="118" cy="32" r="2"/><circle cx="122" cy="27" r="2"/><circle cx="116" cy="29" r="2"/><circle cx="111" cy="33" r="2"/></g>' +
        '<circle class="dt" cx="10" cy="42" r="2.4"/><circle class="dt" cx="70" cy="36" r="2.4"/><circle class="dt" cx="190" cy="19" r="2.4"/>' +
        '<path class="ar" d="M115 29h19m-4-3 4 3-4 3"/>' +
        '<text class="tx" x="146" y="40">شعاع</text><text class="tx" x="115" y="9">توقف ⏸</text>' +
        '<text class="tx" x="115" y="67">ماندن داخل دایره به‌مدت کافی = یک توقف</text></svg>';

    const HELP = {

        time:
            '<div class="ed-help" hidden>' +
            '<p>«توقف» جایی است که مدتی (مثلاً برای استراحت یا غذا) تقریباً یک‌جا مانده‌اید. فقط در فایل‌هایی که زمان دارند محاسبه می‌شود.</p>' + FIG_STOP +
            '<div class="ed-help-item"><b>حداقل مدت توقف (ثانیه)</b>' +
            '<p>اگر حداقل این‌قدر ثانیه در یک محل بمانید، توقف حساب می‌شود (۱۲۰ = ۲ دقیقه). عدد را کمتر کنید توقف‌های کوتاه هم پیدا می‌شود؛ بیشتر کنید فقط توقف‌های طولانی می‌ماند.</p></div>' +
            '<div class="ed-help-item"><b>شعاع توقف (متر)</b>' +
            '<p>یک دایرهٔ فرضی به این شعاع دور اولین نقطهٔ توقف در نظر گرفته می‌شود. تا وقتی نقطه‌های بعدی داخل این دایره‌اند، یعنی از جایتان تکان نخورده‌اید. چون GPS حتی در حالت ایستاده ۱۰ تا ۳۰ متر لرزش دارد، شعاع خیلی کوچک توقف‌ها را از دست می‌دهد و شعاع خیلی بزرگ راه رفتن آهسته را هم توقف حساب می‌کند. مقدار پیشنهادی: ۳۰.</p></div>' +
            '<p>با تغییر هر دو عدد، فهرست توقف‌ها و علامت‌های ⏸ روی نقشه (۲بعدی و ۳بعدی) هم بلافاصله به‌روز می‌شود؛ توقفی که در فهرست نیست روی نقشه هم دیده نمی‌شود. با تیک «نمایش توقف‌ها روی نقشه» می‌توانید همه را پنهان کنید.</p>' +
            '</div>',

        clean:
            '<div class="ed-help" hidden>' +
            '<p>این بخش سه کار جدا انجام می‌دهد. هیچ‌کدام فایل اصلی را عوض نمی‌کند و همه با Undo قابل بازگشت‌اند.</p>' +

            '<div class="ed-help-item"><b>۱) کاهش نقاط</b>' + FIG_SIMPLIFY +
            '<p>نقاطِ اضافی روی بخش‌های صاف یا ملایم حذف می‌شود تا فایل سبک‌تر شود، ولی شکل مسیر تقریباً همان می‌ماند. «خطا (m)» یعنی مسیر ساده‌شده حداکثر چند متر با مسیر اصلی فاصله بگیرد (۵ = دقیق، ۲۰ = سبک‌تر). با تیک پیش‌نمایش، نقاطی که می‌مانند <b class="c-orange">نارنجی</b> روی نقشه دیده می‌شود.</p></div>' +

            '<div class="ed-help-item"><b>۲) نقاط پرت</b>' + FIG_OUTLIER +
            '<p>«تشخیص» نقاطی را که ناگهان از مسیر دور افتاده‌اند (پرش GPS یا سرعت غیرممکن) <b class="c-red">قرمز</b> علامت می‌زند. تا «حذف نقاط علامت‌خورده» را نزنید چیزی پاک نمی‌شود؛ «نگه‌داشتن» فقط علامت‌ها را برمی‌دارد. «آستانه» فاصلهٔ نقطه تا خط بین همسایه‌هایش است.</p></div>' +

            '<div class="ed-help-item"><b>۳) ارتفاع نامعتبر</b>' + FIG_ELE +
            '<p>ارتفاع‌های غیرمنطقی (صفر، بیرون از محدودهٔ زمین یا پرش بیش از ۱۰۰ متر نسبت به همسایه‌ها) <b class="c-purple">بنفش</b> دیده می‌شود. «جایگزینی» ارتفاع آن نقاط را از داده توپوگرافی Open-Meteo می‌گیرد (نیاز به اینترنت دارد و مختصات همان نقاط ارسال می‌شود).</p></div>' +
            '</div>',

        wpt:
            '<div class="ed-help" hidden>' +
            '<p>نقطهٔ راهنما یک مکان مهم روی مسیر است (چشمه، پناهگاه، گردنه، کمپ، قله).</p>' + FIG_WPT +
            '<p>۱) نقطه‌ای از مسیر را روی نقشه یا نمودار انتخاب کنید. ۲) نوع و نام (و در صورت نیاز توضیح) را بنویسید. ۳) «افزودن در نقطهٔ انتخابی» را بزنید.</p>' +
            '<p>نقطه در فایل GPX ذخیره می‌شود و روی نمودار ارتفاعی به شکل لوزی دیده می‌شود. در فهرست زیر می‌توانید نام و توضیح را ویرایش کنید، با ◎ آن را روی نقشه ببینید و با × حذفش کنید.</p>' +
            '</div>'
    };


    function buildUI() {
        const opts = Object.keys(WT).map(k => `<option value="${k}">${WT[k][1]} ${WT[k][0]}</option>`).join("");

        $("ed-root").innerHTML = `
<div class="ed-bar">
  <label>مسیر <select id="ed-route"></select></label>
  <button type="button" class="ed-btn" id="ed-undo" title="Ctrl+Z">↶ Undo</button>
  <button type="button" class="ed-btn" id="ed-redo" title="Ctrl+Y">↷ Redo</button>
  <button type="button" class="ed-btn" id="ed-reset">⟲ بازگشت به فایل اولیه</button>
  <button type="button" class="ed-btn primary" id="ed-apply" title="نسخهٔ ویرایش‌شده جایگزین این مسیر در برنامه می‌شود">✔ اعمال تغییرات در برنامه</button>
  <span id="ed-stat" class="ed-stat"></span><span id="ed-dirty" class="ed-dirty"></span>
</div>
<div class="ed-grid">
  <div class="ed-main">
    <div class="ed-viewbar">
      <button type="button" class="ed-btn active" id="ed-v2d">🗺 نقشهٔ ۲بعدی</button>
      <button type="button" class="ed-btn" id="ed-v3d">⛰ زمین ۳بعدی</button>
      <select id="ed-base3d" aria-label="لایهٔ نقشهٔ سه‌بعدی" hidden>${Object.entries(BASE_LAYER_MODES).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join("")}</select>
    </div>
    <div id="ed-map"></div><div id="ed-map3d" hidden></div><div id="ed-profile"></div>
    <div class="ed-hint">برای انتخاب نقطه روی نقشه یا نمودار کلیک کنید. ● قرمز: نقطهٔ پرت · ● بنفش: ارتفاع نامعتبر · ⏸ توقف</div>
  </div>
  <div class="ed-side">
    <details class="ed-card" open><summary>نقطهٔ انتخاب‌شده / اصلاح ارتفاع</summary>
      <input type="range" id="ed-sel" min="0" max="0" value="0" dir="ltr">
      <div id="ed-selinfo" class="ed-info"></div>
      <div class="ed-row"><label>ارتفاع (m) <input type="number" id="ed-ele" step="0.1" dir="ltr"></label><button type="button" class="ed-btn" id="ed-eleset">اعمال</button></div>
      <div class="ed-row"><button type="button" class="ed-btn" id="ed-gosummit">رفتن به قله</button><button type="button" class="ed-btn" id="ed-seta">شروع بازه</button><button type="button" class="ed-btn" id="ed-setb">پایان بازه</button><button type="button" class="ed-btn danger" id="ed-ptdel">حذف نقطه</button></div>
    </details>
    <details class="ed-card" open><summary>برش مسیر</summary>
      <div class="ed-info">شروع بازه</div><input type="range" id="ed-a" min="0" max="0" value="0" dir="ltr">
      <div class="ed-info">پایان بازه</div><input type="range" id="ed-b" min="0" max="0" value="0" dir="ltr">
      <div id="ed-rng" class="ed-info"></div>
      <div class="ed-row"><button type="button" class="ed-btn primary" id="ed-crop">فقط بازه بماند</button><button type="button" class="ed-btn danger" id="ed-cut">حذف بازه</button></div>
    </details>
    <details class="ed-card"><summary>مشخصات زمانی و توقف‌ها ${HELP_BTN}</summary>
      ${HELP.time}
      <div class="ed-row"><label>حداقل مدت توقف (ثانیه) <input type="number" id="ed-stopsec" value="120" min="10"></label><label>شعاع توقف (متر) <input type="number" id="ed-stoprad" value="30" min="5"></label></div>
      <div class="ed-row"><label><input type="checkbox" id="ed-showstops" checked> نمایش توقف‌ها روی نقشه</label></div>
      <div id="ed-time" class="ed-info"></div>
    </details>
    <details class="ed-card" id="ed-wcard"><summary>نقاط راهنما ${HELP_BTN}</summary>
      ${HELP.wpt}
      <div class="ed-row"><select id="ed-wtype">${opts}</select><input type="text" id="ed-wname" placeholder="نام (اختیاری)"></div>
      <div class="ed-row"><input type="text" id="ed-wdesc" placeholder="توضیحات"><button type="button" class="ed-btn primary" id="ed-wadd">افزودن در نقطهٔ انتخابی</button></div>
      <div id="ed-wlist"></div>
    </details>
    <details class="ed-card" id="ed-clean"><summary>پاک‌سازی مسیر ${HELP_BTN}</summary>
      ${HELP.clean}
      <div class="ed-row"><label><input type="checkbox" id="ed-prevchk" checked> پیش‌نمایش کاهش نقاط روی نقشه (نقطه‌های نارنجی می‌مانند)</label></div>
      <div class="ed-row"><label>کاهش نقاط، خطا (m) <input type="number" id="ed-tol" value="5" min="0.5" step="0.5"></label><button type="button" class="ed-btn" id="ed-simp">اعمال</button></div>
      <div id="ed-tolinfo" class="ed-info"></div>
      <div class="ed-row"><label>نقاط پرت، آستانه (m) <input type="number" id="ed-othr" value="120" min="20"></label><button type="button" class="ed-btn" id="ed-odet">تشخیص</button></div>
      <div class="ed-row"><button type="button" class="ed-btn danger" id="ed-orem">حذف نقاط علامت‌خورده</button><button type="button" class="ed-btn" id="ed-oclr">نگه‌داشتن (پاک کردن علامت)</button></div>
      <div id="ed-oinfo" class="ed-info"></div>
      <div id="ed-einfo" class="ed-info"></div>
      <div class="ed-row"><button type="button" class="ed-btn" id="ed-efix">جایگزینی ارتفاع‌های نامعتبر با داده توپوگرافی</button></div>
    </details>
    <details class="ed-card"><summary>اطلاعات فایل (متادیتا)</summary>
      <div class="ed-row"><input type="text" id="ed-mname" placeholder="نام مسیر"></div>
      <div class="ed-row"><input type="text" id="ed-mdesc" placeholder="توضیحات"></div>
    </details>
    <details class="ed-card" open><summary>ذخیره</summary>
      <div class="ed-row"><button type="button" class="ed-btn primary" id="ed-apply2">✔ اعمال تغییرات روی مسیر در برنامه (جایگزین نسخهٔ قبلی)</button></div>
      <div class="ed-row"><button type="button" class="ed-btn primary" id="ed-save">⬇ دانلود نسخهٔ جدید (GPX)</button><button type="button" class="ed-btn" id="ed-add">افزودن به مسیرها</button></div>
      <div class="ed-info"><small>فایل اصلی روی دستگاه شما تغییر نمی‌کند. «اعمال تغییرات» نسخهٔ ویرایش‌شده را جایگزین همین مسیر در برنامه می‌کند و در همهٔ تب‌ها دیده می‌شود. فقط مسیر، نقاط راهنما، ارتفاع و زمان در فایل جدید ذخیره می‌شود (افزونه‌هایی مثل ضربان قلب حذف می‌شوند).</small></div>
      <div id="ed-msg" class="ed-msg" role="status" aria-live="polite"></div>
    </details>
  </div>
</div>`;
    }

    function bind() {
        const on = (id, ev, fn) => $(id).addEventListener(ev, fn);

        on("ed-route", "change", () => {
            const sel = $("ed-route");

            if (dirty() && !confirm("تغییرات ذخیره‌نشده از بین می‌رود. ادامه می‌دهید؟")) {
                sel.value = E.id;
                return;
            }

            load(sel.value);
        });

        on("ed-undo", "click", undo);
        on("ed-redo", "click", redo);
        on("ed-reset", "click", resetOriginal);
        on("ed-apply", "click", applyToApp);
        on("ed-apply2", "click", applyToApp);

        on("ed-v2d", "click", () => setView("2d"));
        on("ed-v3d", "click", () => setView("3d"));
        on("ed-base3d", "change", () => { if (m3Ready) { apply3DBase($("ed-base3d").value); } });

        on("ed-clean", "toggle", tolPreview);
        on("ed-prevchk", "change", tolPreview);

        // ؟ buttons: show / hide the help of the card (the card itself does not toggle)
        $("ed-root").addEventListener("click", ev => {
            const b = ev.target.closest(".ed-help-btn");

            if (!b) { return; }

            ev.preventDefault();
            ev.stopPropagation();

            const box = b.closest(".ed-card").querySelector(".ed-help"), open = box.hidden;

            box.hidden = !open;
            b.setAttribute("aria-expanded", open ? "true" : "false");
            b.classList.toggle("active", open);
        });

        on("ed-sel", "input", () => setSel(+$("ed-sel").value));
        on("ed-eleset", "click", setElevation);
        on("ed-ptdel", "click", deletePoint);
        on("ed-gosummit", "click", () => setSel(getSummitIndexOfPoints(E.cur.points)));
        on("ed-seta", "click", () => { E.a = E.sel; E.b = Math.max(E.b, E.a); rangeUI(); });
        on("ed-setb", "click", () => { E.b = E.sel; E.a = Math.min(E.a, E.b); rangeUI(); });

        on("ed-a", "input", () => { E.a = +$("ed-a").value; E.b = Math.max(E.b, E.a); rangeUI(); });
        on("ed-b", "input", () => { E.b = +$("ed-b").value; E.a = Math.min(E.a, E.b); rangeUI(); });
        on("ed-crop", "click", cropRange);
        on("ed-cut", "click", cutRange);

        let stopTimer = null;

        const refreshStops = () => {
            clearTimeout(stopTimer);

            stopTimer = setTimeout(() => {
                if (!E) { return; }
                renderTime();
                drawMarks();
            }, 150);
        };

        ["ed-stopsec", "ed-stoprad"].forEach(id => {
            on(id, "input", refreshStops);
            on(id, "change", refreshStops);
        });
        on("ed-showstops", "change", drawMarks);

        on("ed-time", "click", ev => {
            const b = ev.target.closest(".ed-stopb");

            if (b) {
                setSel(+b.dataset.i);
                map.panTo(getLL()[E.sel]);
            }
        });

        on("ed-wadd", "click", addWaypoint);

        on("ed-wlist", "change", ev => {
            const row = ev.target.closest(".ed-w");

            if (!row || !ev.target.dataset.f) { return; }

            const list = E.cur.wpts.slice(), i = +row.dataset.i;

            list[i] = Object.assign({}, list[i], { [ev.target.dataset.f]: ev.target.value.trim() });

            commit({ wpts: list });
        });

        on("ed-wlist", "click", ev => {
            const b = ev.target.closest("button[data-act]");

            if (!b) { return; }

            const i = +b.closest(".ed-w").dataset.i, w = E.cur.wpts[i];

            if (b.dataset.act === "del") {
                commit({ wpts: E.cur.wpts.filter((_, k) => k !== i) });
            } else {
                map.setView([w.latitude, w.longitude], Math.max(map.getZoom(), 15));
            }
        });

        on("ed-tol", "input", tolPreview);
        on("ed-simp", "click", simplifyRoute);
        on("ed-odet", "click", () => {
            E.flags = findOutliers(E.cur.points, +$("ed-othr").value || 120);
            updatePanel();
            drawMarks();
            if (!E.flags.size) { $("ed-oinfo").textContent = "نقطهٔ پرتی پیدا نشد."; }
        });
        on("ed-orem", "click", () => { if (E.flags.size) { removeFlagged(); } });
        on("ed-oclr", "click", () => { E.flags = new Set(); updatePanel(); drawMarks(); });
        on("ed-efix", "click", fixElevations);

        on("ed-mname", "change", () => commit({ meta: Object.assign({}, E.cur.meta, { name: $("ed-mname").value.trim() }) }));
        on("ed-mdesc", "change", () => commit({ meta: Object.assign({}, E.cur.meta, { desc: $("ed-mdesc").value.trim() }) }));

        on("ed-save", "click", () => save(false));
        on("ed-add", "click", () => save(true));

        document.addEventListener("keydown", ev => {
            if (activeSection !== "edit" || !E || !(ev.ctrlKey || ev.metaKey)) { return; }

            if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) && ev.target.type !== "range") { return; }

            const k = ev.key.toLowerCase();

            if (k === "z" && !ev.shiftKey) { ev.preventDefault(); undo(); }
            else if (k === "y" || (k === "z" && ev.shiftKey)) { ev.preventDefault(); redo(); }
        });

        window.addEventListener("beforeunload", ev => {
            if (dirty()) {
                ev.preventDefault();
                ev.returnValue = "";
            }
        });
    }

    function initialize() {
        if (!$("ed-root")) { return; }

        buildUI();
        bind();

        ui = true;

        hookFunction("redrawAllCharts", refreshList);

        // light / dark switch: the profile colours are fixed at draw time
        hookFunction("applyTheme", () => {
            if (!E || !ui) { return; }

            if (activeSection === "edit") { drawProfile(); } else { themeDirty = true; }
        });
        hookFunction("setActiveSection", onSection);

        refreshList();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }

})();
