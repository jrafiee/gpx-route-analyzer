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
 * @param {Document} xml
 * @returns {Array}
 */
function extractRoutePoints(xml) {
    const points = [];

    const trackSegments = xml.querySelectorAll("trkseg");

    trackSegments.forEach(segment => {
        const trackPoints = segment.querySelectorAll("trkpt");

        trackPoints.forEach(point => {
            const elevationElement = point.querySelector("ele");

            if (!elevationElement) {
                return;
            }

            const latitude = parseFloat(
                point.getAttribute("lat")
            );

            const longitude = parseFloat(
                point.getAttribute("lon")
            );

            const elevation = parseFloat(
                elevationElement.textContent
            );

            if (
                !Number.isFinite(latitude) ||
                !Number.isFinite(longitude) ||
                !Number.isFinite(elevation)
            ) {
                return;
            }

            points.push({
                latitude,
                longitude,
                elevation
            });
        });
    });

    if (points.length < 2) {
        throw new Error(
            "Route does not contain enough valid points."
        );
    }

    return points;
}


/**
 * Read a GPX File and extract its valid track points.
 *
 * @param {File} file
 * @returns {Promise<Object>}
 */
async function loadGpxFile(file) {
    const xml = await readGpxFile(file);

    const points = extractRoutePoints(xml);

    return {
        name: file.name,
        points
    };
}


function extractRouteProfile(route) {
    const points = route.points;

    if (points.length < 2) {
        throw new Error("Route does not contain enough valid points.");
    }

    const distance = [0];
    const elevation = [points[0].elevation];

    let totalDistance = 0;

    for (let i = 0; i < points.length - 1; i++) {
        const previous = points[i];
        const current = points[i + 1];

        const d = distance2D(previous, current);

        if (d === null || d <= 0) {
            continue;
        }

        totalDistance += d;

        distance.push(totalDistance);
        elevation.push(current.elevation);
    }

    if (distance.length < 2) {
        throw new Error("Not enough valid distance data.");
    }

    return {
        distance,
        elevation
    };
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