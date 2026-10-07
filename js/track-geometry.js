/* =========================================================
   Track geometry helpers

   Projects a GPS position onto a route polyline (segments, not
   only vertices) and returns the distance travelled ALONG the
   track.

   - Reuses distance2D() from gpx-reader.js for track lengths, so
     the numbers match the "Distance (km)" metric.
   - Geometry (planar coordinates + cumulative distance) is built
     once per route and cached.
   - Load AFTER gpx-reader.js, BEFORE user-location.js
   ========================================================= */


/*
 * A user is "on the track" when the distance to the nearest
 * point of the polyline is <= THRESHOLD + min(GPS accuracy, ALLOWANCE_MAX).
 *
 * 50 m: mountain GPX tracks usually have 10-30 m lateral error
 * (switchbacks, tree/rock cover) and phone GPS adds 5-20 m.
 * A larger value would wrongly accept parallel trails.
 */

const TRACK_PROXIMITY_THRESHOLD = 50;        // meters

const TRACK_ACCURACY_ALLOWANCE_MAX = 30;     // meters

/*
 * Out-and-back tracks run over the same ground twice. Segments
 * within this margin of the nearest one are treated as ambiguous
 * and resolved by continuity with the previous position.
 */

const TRACK_AMBIGUITY_MARGIN = 15;           // meters

const TRACK_EARTH_RADIUS = 6371000;

const trackGeometryCache = new WeakMap();


/*
 * Build (or read from cache) the geometry of an analysis result.
 */

function getTrackGeometry(result) {

    const route = result && result.routeData;

    const points = route && route.points;

    if (!Array.isArray(points) || points.length < 2) {
        return null;
    }

    const cached = trackGeometryCache.get(route);

    if (cached) {
        return cached;
    }

    const count = points.length;

    let latSum = 0;
    let lonSum = 0;

    points.forEach(point => {
        latSum += point.latitude;
        lonSum += point.longitude;
    });

    const lat0 = latSum / count;
    const lon0 = lonSum / count;
    const cosLat = Math.cos(lat0 * Math.PI / 180);
    const k = TRACK_EARTH_RADIUS * Math.PI / 180;

    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    const cum = new Float64Array(count);

    for (let i = 0; i < count; i++) {

        xs[i] = (points[i].longitude - lon0) * k * cosLat;
        ys[i] = (points[i].latitude - lat0) * k;

        if (i > 0) {
            cum[i] = cum[i - 1] +
                (distance2D(points[i - 1], points[i]) || 0);
        }

    }

    const geometry = {
        lat0, lon0, cosLat,
        xs, ys, cum,
        count,
        total: cum[count - 1]
    };

    trackGeometryCache.set(route, geometry);

    return geometry;

}


/*
 * Project a position onto the track.
 *
 * previousAlong (meters or null): last matched position along the
 * track; used to choose between overlapping segments.
 *
 * Returns { distance, along, remaining, total } in meters, where
 *   distance  = distance from the position to the track
 *   along     = track length from start to the projected point
 *   remaining = track length from the projected point to the end
 */

function projectOnTrack(
    geometry,
    latitude,
    longitude,
    previousAlong = null
) {

    if (
        !geometry ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
    ) {
        return null;
    }

    const k = TRACK_EARTH_RADIUS * Math.PI / 180;

    const px = (longitude - geometry.lon0) * k * geometry.cosLat;
    const py = (latitude - geometry.lat0) * k;

    const { xs, ys, cum, count, total } = geometry;

    let bestDistance = Infinity;

    // flat [distance, along, lateral, qx, qy, ...]
    const candidates = [];

    for (let i = 0; i < count - 1; i++) {

        const ax = xs[i];
        const ay = ys[i];
        const dx = xs[i + 1] - ax;
        const dy = ys[i + 1] - ay;

        const lengthSquared = dx * dx + dy * dy;

        let t = lengthSquared > 0
            ? ((px - ax) * dx + (py - ay) * dy) / lengthSquared
            : 0;

        t = t < 0 ? 0 : (t > 1 ? 1 : t);

        const distance = Math.hypot(
            ax + t * dx - px,
            ay + t * dy - py
        );

        if (distance <= bestDistance + TRACK_AMBIGUITY_MARGIN) {

            // signed offset: > 0 means the position is on the LEFT
            // of the track when walking in the track direction
            const length = Math.sqrt(lengthSquared);

            const lateral = length > 0
                ? (dx * (py - ay) - dy * (px - ax)) / length
                : 0;

            candidates.push(
                distance,
                cum[i] + t * (cum[i + 1] - cum[i]),
                lateral,
                ax + t * dx,
                ay + t * dy
            );

            if (distance < bestDistance) {
                bestDistance = distance;
            }

        }

    }

    let along = NaN;
    let lateral = 0;
    let qx = 0;
    let qy = 0;
    let bestScore = Infinity;

    for (let j = 0; j < candidates.length; j += 5) {

        if (candidates[j] > bestDistance + TRACK_AMBIGUITY_MARGIN) {
            continue;
        }

        const candidateAlong = candidates[j + 1];

        // first fix: prefer the earliest (outbound) pass
        const score = previousAlong === null
            ? candidateAlong
            : Math.abs(candidateAlong - previousAlong);

        if (score < bestScore) {
            bestScore = score;
            along = candidateAlong;
            lateral = candidates[j + 2];
            qx = candidates[j + 3];
            qy = candidates[j + 4];
        }

    }

    if (!Number.isFinite(along)) {
        return null;
    }

    return {
        distance: bestDistance,
        along: along,
        remaining: Math.max(0, total - along),
        total: total,
        lateral: lateral,
        point: {
            lat: geometry.lat0 + qy / k,
            lon: geometry.lon0 + qx / (k * geometry.cosLat)
        }
    };

}


function isUserOnTrack(projection, accuracy) {

    if (!projection) {
        return false;
    }

    const allowance =
        Number.isFinite(accuracy)
            ? Math.min(Math.max(accuracy, 0), TRACK_ACCURACY_ALLOWANCE_MAX)
            : 0;

    return projection.distance <=
        TRACK_PROXIMITY_THRESHOLD + allowance;

}
