
/**
 * Read and parse a GPX File in the browser.
 *
 * This is the JavaScript equivalent of the Python load_gpx_file()
 * and extract_route_points() functions.
 */


/**
 * Read a GPX File and return its XML document.
 *
 * @param {File} file
 * @returns {Promise<Document>}
 */
async function readGpxFile(file) {
    if (!file) {
        throw new Error("No GPX file selected.");
    }

    if (!file.name.toLowerCase().endsWith(".gpx")) {
        throw new Error(
            `Expected a GPX file, got: ${file.name}`
        );
    }

    const text = await file.text();

    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "application/xml");

    const parserError = xml.querySelector("parsererror");

    if (parserError) {
        throw new Error(
            `Invalid GPX file: ${file.name}`
        );
    }

    return xml;
}


/**
 * Extract valid track points from a parsed GPX document.
 *
 * Equivalent to Python extract_route_points().
 *
 * Only points with elevation are returned.
 *
 * Time is extracted when available.
 *
 * @param {Document} xml
 * @returns {Array}
 */
function extractRoutePoints(xml) {
    const points = [];

    // getElementsByTagNameNS("*") is a lot faster than querySelector
    // per point, and also works with prefixed GPX namespaces.
    const trackPoints = xml.getElementsByTagNameNS("*", "trkpt");

    for (let i = 0; i < trackPoints.length; i++) {
        const point = trackPoints[i];

        let elevationText = null;
        let timeText = null;

        for (const child of point.children) {
            if (child.localName === "ele") {
                elevationText = child.textContent;
            } else if (child.localName === "time") {
                timeText = child.textContent;
            }
        }

        if (elevationText === null) {
            continue;
        }

        const latitude = parseFloat(point.getAttribute("lat"));
        const longitude = parseFloat(point.getAttribute("lon"));
        const elevation = parseFloat(elevationText);

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            !Number.isFinite(elevation)
        ) {
            continue;
        }

        let time = null;

        if (timeText !== null) {
            const parsedTime = new Date(timeText.trim());

            if (!Number.isNaN(parsedTime.getTime())) {
                time = parsedTime.getTime();   // ms since epoch (number)
            }
        }

        points.push({
            latitude,
            longitude,
            elevation,
            time
        });
    }

    if (points.length < 2) {
        throw new Error(
            "Route does not contain enough valid points."
        );
    }

    return points;
}


/**
 * Extract waypoints (<wpt>) such as camps, springs, shelters, ...
 *
 * Returned items:
 * {
 *     latitude, longitude,
 *     elevation   (number | null),
 *     name, description, type, symbol   (strings, may be empty)
 * }
 *
 * @param {Document} xml
 * @returns {Array}
 */
function extractWaypoints(xml) {
    const waypoints = [];

    Array.from(xml.getElementsByTagNameNS("*", "wpt")).forEach(waypoint => {

        const latitude = parseFloat(
            waypoint.getAttribute("lat")
        );

        const longitude = parseFloat(
            waypoint.getAttribute("lon")
        );

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            return;
        }

        const readText = tag => {

            const element = Array.from(
                waypoint.children
            ).find(
                child => child.localName === tag
            );

            return element
                ? element.textContent.trim()
                : "";

        };

        const elevationText =
            readText("ele");

        const elevation =
            elevationText === ""
                ? NaN
                : parseFloat(elevationText);

        const description =
            readText("desc");

        const comment =
            readText("cmt");

        let combined = description;

        if (comment && comment !== description) {
            combined = combined
                ? `${combined}\n${comment}`
                : comment;
        }

        waypoints.push({
            latitude,
            longitude,
            elevation:
                Number.isFinite(elevation)
                    ? elevation
                    : null,
            name: readText("name"),
            description: combined,
            type: readText("type"),
            symbol: readText("sym")
        });

    });

    return waypoints;
}


/**
 * Read a GPX File and extract its valid track points
 * and waypoints.
 *
 * @param {File} file
 * @returns {Promise<Object>}
 */
async function loadGpxFile(file) {
    const xml = await readGpxFile(file);

    const points = extractRoutePoints(xml);

    let waypoints = [];

    try {
        waypoints = extractWaypoints(xml);
    } catch (error) {
        console.warn(
            "Waypoint extraction failed:",
            error
        );
    }

    return {
        name: file.name,
        points,
        waypoints
    };
}


/*
 * The profile of a route never changes, but it is needed by the
 * metrics, slope analysis and every profile builder. It is computed
 * once per route (callers must not modify the returned arrays).
 */

const routeProfileCache = new WeakMap();

function extractRouteProfile(route) {
    const cached = routeProfileCache.get(route);

    if (cached) {
        return cached;
    }

    const points = route.points;

    if (points.length < 2) {
        throw new Error("Route does not contain enough valid points.");
    }

    const distance = [0];
    const elevation = [points[0].elevation];

    let totalDistance = 0;

    for (let i = 0; i < points.length - 1; i++) {
        const d = distance2D(points[i], points[i + 1]);

        if (d === null || d <= 0) {
            continue;
        }

        totalDistance += d;

        distance.push(totalDistance);
        elevation.push(points[i + 1].elevation);
    }

    if (distance.length < 2) {
        throw new Error("Not enough valid distance data.");
    }

    const profile = { distance, elevation };

    routeProfileCache.set(route, profile);

    return profile;
}


/*
 * Index of the highest point (first one on ties), cached per
 * points array. Shared by analysis, maps and weather.
 */

const summitIndexCache = new WeakMap();

function getSummitIndexOfPoints(points) {
    if (!Array.isArray(points) || points.length === 0) {
        return 0;
    }

    const cached = summitIndexCache.get(points);

    if (cached !== undefined) {
        return cached;
    }

    let summitIndex = 0;

    for (let i = 1; i < points.length; i++) {
        if (
            Number.isFinite(points[i].elevation) &&
            points[i].elevation > points[summitIndex].elevation
        ) {
            summitIndex = i;
        }
    }

    summitIndexCache.set(points, summitIndex);

    return summitIndex;
}


function distance2D(point1, point2) {
    const lat1 = point1.latitude;
    const lon1 = point1.longitude;

    const lat2 = point2.latitude;
    const lon2 = point2.longitude;

    if (
        !Number.isFinite(lat1) ||
        !Number.isFinite(lon1) ||
        !Number.isFinite(lat2) ||
        !Number.isFinite(lon2)
    ) {
        return null;
    }

    const earthRadius = 6371000;

    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;

    const deltaLat =
        (lat2 - lat1) * Math.PI / 180;

    const deltaLon =
        (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(lat1Rad) *
        Math.cos(lat2Rad) *
        Math.sin(deltaLon / 2) ** 2;

    const c =
        2 * Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return earthRadius * c;
}


function distance3D(point1, point2) {
    const horizontalDistance =
        distance2D(point1, point2);

    if (
        horizontalDistance === null ||
        !Number.isFinite(point1.elevation) ||
        !Number.isFinite(point2.elevation)
    ) {
        return null;
    }

    const elevationDifference =
        point2.elevation - point1.elevation;

    return Math.sqrt(
        horizontalDistance ** 2 +
        elevationDifference ** 2
    );
}
