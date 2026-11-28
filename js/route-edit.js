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

        E = { id, file: r.id, orig: cur, cur, clean: cur, hist: [], fut: [], sel: 0, a: 0, b: cur.points.length - 1, flags: new Set() };

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

        if (patch.points) { c._c = null; c._ll = null; }

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
    }

    function updatePanel() {
        const c = E.cur, n = c.points.length, cm = getCum();

        ["ed-sel", "ed-a", "ed-b"].forEach(id => { $(id).max = n - 1; });

        $("ed-undo").disabled = !E.hist.length;
        $("ed-redo").disabled = !E.fut.length;

        let gain = 0;

        for (let i = 1; i < n; i++) { gain += Math.max(0, c.points[i].elevation - c.points[i - 1].elevation); }

        $("ed-stat").textContent = `${n} نقطه · ${(cm[n - 1] / 1000).toFixed(2)} km · صعود ${Math.round(gain)} m`;
        $("ed-dirty").textContent = dirty() ? "● تغییرات ذخیره‌نشده" : "";

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

    function onSection(id) {
        if (id === "edit" && ui) {
            if (!E) { refreshList(); } else if (pending || !map) { refreshAll(true); }

            if (map) { setTimeout(() => map.invalidateSize(), 80); }
        }
    }


    /* =====================================================
       UI
       ===================================================== */

    function buildUI() {
        const opts = Object.keys(WT).map(k => `<option value="${k}">${WT[k][1]} ${WT[k][0]}</option>`).join("");

        $("ed-root").innerHTML = `
<div class="ed-bar">
  <label>مسیر <select id="ed-route"></select></label>
  <button type="button" class="ed-btn" id="ed-undo" title="Ctrl+Z">↶ Undo</button>
  <button type="button" class="ed-btn" id="ed-redo" title="Ctrl+Y">↷ Redo</button>
  <button type="button" class="ed-btn" id="ed-reset">⟲ بازگشت به فایل اولیه</button>
  <span id="ed-stat" class="ed-stat"></span><span id="ed-dirty" class="ed-dirty"></span>
</div>
<div class="ed-grid">
  <div class="ed-main">
    <div id="ed-map"></div><div id="ed-profile"></div>
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
    <details class="ed-card"><summary>مشخصات زمانی و توقف‌ها</summary>
      <div class="ed-row"><label>حداقل توقف (ثانیه) <input type="number" id="ed-stopsec" value="120" min="10"></label><label>شعاع (m) <input type="number" id="ed-stoprad" value="30" min="5"></label></div>
      <div class="ed-row"><label><input type="checkbox" id="ed-showstops" checked> نمایش توقف‌ها روی نقشه</label></div>
      <div id="ed-time" class="ed-info"></div>
    </details>
    <details class="ed-card"><summary>نقاط راهنما</summary>
      <div class="ed-row"><select id="ed-wtype">${opts}</select><input type="text" id="ed-wname" placeholder="نام (اختیاری)"></div>
      <div class="ed-row"><input type="text" id="ed-wdesc" placeholder="توضیحات"><button type="button" class="ed-btn primary" id="ed-wadd">افزودن در نقطهٔ انتخابی</button></div>
      <div id="ed-wlist"></div>
    </details>
    <details class="ed-card"><summary>پاک‌سازی مسیر</summary>
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
      <div class="ed-row"><button type="button" class="ed-btn primary" id="ed-save">⬇ دانلود نسخهٔ جدید (GPX)</button><button type="button" class="ed-btn" id="ed-add">افزودن به مسیرها</button></div>
      <div class="ed-info"><small>فایل اصلی تغییر نمی‌کند. فقط مسیر، نقاط راهنما، ارتفاع و زمان در فایل جدید ذخیره می‌شود (افزونه‌هایی مثل ضربان قلب حذف می‌شوند).</small></div>
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

        ["ed-stopsec", "ed-stoprad"].forEach(id => on(id, "change", () => { renderTime(); drawMarks(); }));
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
        hookFunction("setActiveSection", onSection);

        refreshList();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }

})();
