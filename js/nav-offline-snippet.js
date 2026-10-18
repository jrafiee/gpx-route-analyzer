/* =========================================================
   پیش‌ذخیره نقشه مسیر برای حالت آفلاین
   داخل user-location.js (درون IIFE) اضافه کنید.
   ========================================================= */

const OFFLINE_TILE_ZOOMS = [12, 13, 14, 15];
const OFFLINE_TILE_MAX = 1200;                 // سقف تعداد کاشی برای هر لایه
const OFFLINE_TILE_LAYERS = [
    "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",   // نقشه ناوبری
    "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"  // نقشه دوبعدی
];
const prefetchedRoutes = new Set();

function tileXY(lat, lon, z) {
    const n = Math.pow(2, z);
    const x = Math.floor((lon + 180) / 360 * n);
    const r = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
    return [x, y];
}

async function prefetchRouteTiles(result) {

    if (!result || !result.routeData || !navigator.onLine) return;
    if (prefetchedRoutes.has(result.route)) return;
    prefetchedRoutes.add(result.route);

    const points = result.routeData.points;
    const urls = [];

    OFFLINE_TILE_LAYERS.forEach(template => {
        const seen = new Set();
        let count = 0;

        OFFLINE_TILE_ZOOMS.forEach(z => {
            for (let i = 0; i < points.length; i++) {
                const [tx, ty] = tileXY(points[i].latitude, points[i].longitude, z);
                // یک کاشی حاشیه دور مسیر
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        const key = z + "/" + (tx + dx) + "/" + (ty + dy);
                        if (seen.has(key) || count >= OFFLINE_TILE_MAX) continue;
                        seen.add(key);
                        count++;
                        urls.push(template
                            .replace("{z}", z)
                            .replace("{x}", tx + dx)
                            .replace("{y}", ty + dy));
                    }
                }
            }
        });
    });

    // دسته‌ای تا شبکه و مرورگر فشار نخورند؛ Service Worker پاسخ‌ها را کش می‌کند
    for (let i = 0; i < urls.length; i += 6) {
        if (!navigator.onLine) break;
        await Promise.allSettled(
            urls.slice(i, i + 6).map(u => fetch(u, { mode: "cors" }))
        );
    }
}

/* در openNav()، بعد از initNavMap(); این خط را اضافه کنید:
       prefetchRouteTiles(getReferenceResult());
   و در updateNavigation() داخل شرط تغییر مسیر (جایی که drawNavRoute(true) صدا زده می‌شود):
       prefetchRouteTiles(result);
*/
