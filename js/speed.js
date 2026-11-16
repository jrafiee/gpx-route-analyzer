/* =========================================================
   Speed calculation, colours and legend

   Single source of truth for the speed classes:
   SPEED_STEPS / SPEED_SCALE are used by the 2D map
   (getSpeedColor), the 3D map (colour expression) and the legend.
   ========================================================= */

const SPEED_SMOOTHING_WINDOW = 5;

const SPEED_COLORS = {
    verySlow: "#b2182b",
    slow: "#ef8a62",
    moderate: "#fddbc7",
    fast: "#fee08b",
    veryFast: "#a6d96a",
    fastest: "#1a9850",

    /* no timestamps (e.g. most KML files): saturated blue,
       not part of the red -> green speed scale */
    noData: "#2979ff"
};

/* km/h upper limits of the first five classes; the 6th is open-ended */
const SPEED_STEPS = [1.5, 2.5, 3.5, 4.5, 5.5];

const SPEED_SCALE = [
    SPEED_COLORS.verySlow,
    SPEED_COLORS.slow,
    SPEED_COLORS.moderate,
    SPEED_COLORS.fast,
    SPEED_COLORS.veryFast,
    SPEED_COLORS.fastest
];

const SPEED_LABELS = [
    "کمتر از ۱.۵",
    "۱.۵ تا ۲.۵",
    "۲.۵ تا ۳.۵",
    "۳.۵ تا ۴.۵",
    "۴.۵ تا ۵.۵",
    "۵.۵ و بیشتر"
];

function getSpeedColor(speed) {
    if (!Number.isFinite(speed)) {
        return SPEED_COLORS.noData;
    }

    const index = SPEED_STEPS.findIndex(limit => speed < limit);

    return SPEED_SCALE[index < 0 ? SPEED_SCALE.length - 1 : index];
}


/* =========================================================
   Smoothing (moving average, null values are skipped)
   ========================================================= */

function smoothSpeeds(rawSpeeds, windowSize) {
    const half = Math.floor(windowSize / 2);
    const last = rawSpeeds.length - 1;

    return rawSpeeds.map((_, index) => {
        let sum = 0;
        let count = 0;

        for (
            let i = Math.max(0, index - half);
            i <= Math.min(last, index + half);
            i++
        ) {
            const value = rawSpeeds[i];

            if (value !== null && Number.isFinite(value)) {
                sum += value;
                count++;
            }
        }

        return count > 0 ? sum / count : null;
    });
}


/*
 * Speeds only depend on the track points, but the 2D map, the 3D
 * map and every direction change need them. Cached per points
 * array (callers must not modify the result).
 */

const routeSpeedCache = new WeakMap();

function calculateRouteSpeeds(points) {
    if (!Array.isArray(points) || points.length < 2) {
        return [];
    }

    const cached = routeSpeedCache.get(points);

    if (cached) {
        return cached;
    }

    const count = points.length - 1;

    const rawSpeeds = new Array(count);
    const distances3D = new Array(count);
    const elapsedList = new Array(count);

    const timeOf = point =>
        point && Number.isFinite(point.time) ? point.time : null;

    let previousTime = timeOf(points[0]);

    for (let i = 0; i < count; i++) {
        const time = timeOf(points[i + 1]);

        const d3 = distance3D(points[i], points[i + 1]) ?? NaN;

        let elapsed = null;
        let speed = null;

        if (previousTime !== null && time !== null) {
            elapsed = (time - previousTime) / 1000;

            if (elapsed > 0 && Number.isFinite(d3) && d3 >= 0) {
                speed = (d3 / elapsed) * 3.6;
            }
        }

        rawSpeeds[i] = speed;
        distances3D[i] = d3;
        elapsedList[i] = elapsed;

        previousTime = time;
    }

    const smoothed = smoothSpeeds(rawSpeeds, SPEED_SMOOTHING_WINDOW);

    const segments = new Array(count);

    for (let i = 0; i < count; i++) {
        segments[i] = {
            rawSpeed: rawSpeeds[i],
            speed: smoothed[i],
            distance3D: distances3D[i],
            elapsedSeconds: elapsedList[i]
        };
    }

    routeSpeedCache.set(points, segments);

    return segments;
}


/* =========================================================
   Speed legend
   ========================================================= */

function createSpeedLegend(container) {
    if (!container) {
        return;
    }

    const existing = container.querySelector(".speed-legend");

    if (existing) {
        existing.remove();
    }

    const items = SPEED_SCALE
        .map((color, i) => [SPEED_LABELS[i], color])
        .concat([["بدون زمان", SPEED_COLORS.noData]]);

    const legend = document.createElement("div");

    legend.className = "speed-legend";

    legend.innerHTML =
        '<div class="speed-legend-title">سرعت حرکت</div>' +
        items.map(([label, color]) =>
            '<div class="speed-legend-item">' +
            `<span class="speed-legend-color" style="background:${color};"></span>` +
            `<span>${label}</span>` +
            "</div>"
        ).join("") +
        '<div class="speed-legend-smoothing">هموارسازی: ۵ سگمنت</div>';

    container.appendChild(legend);
}
