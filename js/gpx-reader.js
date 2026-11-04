/**
 * Read and parse route files (GPX and KML) in the browser.
 *
 * - GPX: <trkpt>, <wpt>, name from <metadata><name> (or <trk><name>)
 * - KML: <LineString>, <gx:Track>, <Point> placemarks, name from <Document><name>
 * - Export: write a new title back into the file (for download)
 */


/* =========================================================
   File type helpers
   ========================================================= */

const ROUTE_FILE_RE = /\.(gpx|kml)$/i;

function isRouteFile(name) {
    return ROUTE_FILE_RE.test(String(name || ""));
}

function getRouteFileExtension(name) {
    const match = ROUTE_FILE_RE.exec(String(name || ""));
    return match ? match[1].toLowerCase() : "";
}

function routeBaseName(name) {
    return String(name || "").replace(ROUTE_FILE_RE, "");
}


/* =========================================================
   XML helpers
   ========================================================= */

async function readXmlFile(file) {
    if (!file) {
        throw new Error("No file selected.");
    }

    if (!isRouteFile(file.name)) {
        throw new Error(
            `Expected a GPX or KML file, got: ${file.name}`
        );
    }

    const text = await file.text();

    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "application/xml");

    if (xml.querySelector("parsererror")) {
        throw new Error(`Invalid file: ${file.name}`);
    }

    return xml;
}

// kept for compatibility
async function readGpxFile(file) {
    return readXmlFile(file);
}

function xmlChildren(element, localName) {
    if (!element) {
        return [];
    }

    return Array.from(element.children).filter(
        child => child.localName === localName
    );
}

function xmlChildText(element, localName) {
    const child = xmlChildren(element, localName)[0];

    return child ? child.textContent.trim() : "";
}

function cleanRouteTitle(text) {
    let title = String(text || "").replace(/\s+/g, " ").trim();

    // Wikiloc adds "Wikiloc - " in front of every name
    title = title.replace(/^wikiloc\s*[-–—:]\s*/i, "").trim();

    return title;
}


/* =========================================================
   Title (route name) inside the file
   ========================================================= */

function extractGpxTitle(xml) {
    const root = xml.documentElement;

    let title = xmlChildText(
        xmlChildren(root, "metadata")[0],
        "name"
    );

    // GPX 1.0 keeps the name directly under <gpx>
    if (!title) {
        title = xmlChildText(root, "name");
    }

    if (!title) {
        title = xmlChildText(xmlChildren(root, "trk")[0], "name");
    }

    if (!title) {
        title = xmlChildText(xmlChildren(root, "rte")[0], "name");
    }

    return cleanRouteTitle(title);
}


function getKmlTrackPlacemarks(xml) {
    return Array.from(
        xml.getElementsByTagNameNS("*", "Placemark")
    ).filter(
        placemark =>
            placemark.getElementsByTagNameNS("*", "LineString").length > 0 ||
            placemark.getElementsByTagNameNS("*", "Track").length > 0
    );
}


function extractKmlTitle(xml) {
    const root = xml.documentElement;

    let title = xmlChildText(
        xmlChildren(root, "Document")[0],
        "name"
    );

    // Google Earth often stores the file name as the document name
    if (ROUTE_FILE_RE.test(title)) {
        title = "";
    }

    if (!title) {
        const placemark = getKmlTrackPlacemarks(xml)[0];

        if (placemark) {
            title = xmlChildText(placemark, "name");
        }
    }

    if (!title) {
        const folder = xml.getElementsByTagNameNS("*", "Folder")[0];

        if (folder) {
            title = xmlChildText(folder, "name");
        }
    }

    return cleanRouteTitle(title);
}


/* =========================================================
   GPX
   ========================================================= */

/**
 * Extract valid track points from a parsed GPX document.
 * Only points with elevation are returned.
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
 */
function extractWaypoints(xml) {
    const waypoints = [];

    Array.from(xml.getElementsByTagNameNS("*", "wpt")).forEach(waypoint => {

        const latitude = parseFloat(waypoint.getAttribute("lat"));
        const longitude = parseFloat(waypoint.getAttribute("lon"));

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            return;
        }

        const readText = tag => xmlChildText(waypoint, tag);

        const elevationText = readText("ele");

        const elevation =
            elevationText === ""
                ? NaN
                : parseFloat(elevationText);

        const description = readText("desc");
        const comment = readText("cmt");

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


/* =========================================================
   KML
   ========================================================= */

/**
 * Track points from <gx:Track> (with times) or, when there is no
 * usable gx:Track, from <LineString> coordinates ("lon,lat,alt ...").
 * Only points with elevation are kept (same rule as GPX).
 */
function extractKmlPoints(xml) {
    let points = [];

    function push(longitude, latitude, elevation, time) {
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
            elevation,
            time: Number.isFinite(time) ? time : null
        });
    }

    Array.from(xml.getElementsByTagNameNS("*", "Track")).forEach(track => {

        const whens = [];
        const coords = [];

        for (const child of track.children) {
            if (child.localName === "when") {
                whens.push(child.textContent.trim());
            } else if (child.localName === "coord") {
                coords.push(child.textContent.trim());
            }
        }

        coords.forEach((coord, i) => {
            const parts = coord.split(/\s+/);

            push(
                parseFloat(parts[0]),
                parseFloat(parts[1]),
                parts.length > 2 ? parseFloat(parts[2]) : NaN,
                whens[i] ? Date.parse(whens[i]) : NaN
            );
        });

    });

    if (points.length < 2) {

        points = [];

        Array.from(xml.getElementsByTagNameNS("*", "LineString")).forEach(line => {

            const coordinates =
                line.getElementsByTagNameNS("*", "coordinates")[0];

            if (!coordinates) {
                return;
            }

            coordinates.textContent
                .trim()
                .split(/\s+/)
                .forEach(tuple => {
                    const parts = tuple.split(",");

                    push(
                        parseFloat(parts[0]),
                        parseFloat(parts[1]),
                        parts.length > 2 ? parseFloat(parts[2]) : NaN,
                        NaN
                    );
                });

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
 * Placemarks that are a single <Point> become waypoints.
 */
function extractKmlWaypoints(xml) {
    const waypoints = [];

    Array.from(xml.getElementsByTagNameNS("*", "Placemark")).forEach(placemark => {

        if (
            placemark.getElementsByTagNameNS("*", "LineString").length > 0 ||
            placemark.getElementsByTagNameNS("*", "Track").length > 0
        ) {
            return;
        }

        const pointElement =
            placemark.getElementsByTagNameNS("*", "Point")[0];

        const coordinates = pointElement
            ? pointElement.getElementsByTagNameNS("*", "coordinates")[0]
            : null;

        if (!coordinates) {
            return;
        }

        const parts = coordinates.textContent.trim().split(",");

        const longitude = parseFloat(parts[0]);
        const latitude = parseFloat(parts[1]);
        const elevation = parts.length > 2 ? parseFloat(parts[2]) : NaN;

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            return;
        }

        // descriptions are often HTML
        const description =
            xmlChildText(placemark, "description")
                .replace(/<[^>]*>/g, " ")
                .replace(/[ \t]+/g, " ")
                .trim();

        waypoints.push({
            latitude,
            longitude,
            elevation: Number.isFinite(elevation) ? elevation : null,
            name: xmlChildText(placemark, "name"),
            description,
            type: "",
            symbol: ""
        });

    });

    return waypoints;
}


/* =========================================================
   Load a route file (GPX or KML)

   Returns { name (file name), title (name found inside the
   file, may be ""), points, waypoints, format }
   ========================================================= */

async function loadRouteFile(file) {
    const xml = await readXmlFile(file);

    const isKml = getRouteFileExtension(file.name) === "kml";

    const points = isKml
        ? extractKmlPoints(xml)
        : extractRoutePoints(xml);

    let waypoints = [];

    try {
        waypoints = isKml
            ? extractKmlWaypoints(xml)
            : extractWaypoints(xml);
    } catch (error) {
        console.warn("Waypoint extraction failed:", error);
    }

    let title = "";

    try {
        title = isKml
            ? extractKmlTitle(xml)
            : extractGpxTitle(xml);
    } catch (error) {
        console.warn("Title extraction failed:", error);
    }

    return {
        name: file.name,
        title,
        points,
        waypoints,
        format: isKml ? "kml" : "gpx"
    };
}

// kept for compatibility
async function loadGpxFile(file) {
    return loadRouteFile(file);
}


/* =========================================================
   Export: the same file with a new route name
   ========================================================= */

function setNameElement(parent, title) {
    let nameElement = xmlChildren(parent, "name")[0];

    if (!nameElement) {
        nameElement = parent.ownerDocument.createElementNS(
            parent.namespaceURI,
            "name"
        );

        parent.insertBefore(nameElement, parent.firstChild);
    }

    nameElement.textContent = title;
}


function setGpxTitle(xml, title) {
    const root = xml.documentElement;

    if (root.getAttribute("version") === "1.0") {
        setNameElement(root, title);
    } else {
        let metadata = xmlChildren(root, "metadata")[0];

        if (!metadata) {
            metadata = xml.createElementNS(root.namespaceURI, "metadata");
            root.insertBefore(metadata, root.firstChild);
        }

        setNameElement(metadata, title);
    }

    // keep the track name in sync when the file has one
    const track = xmlChildren(root, "trk")[0];

    if (track && xmlChildren(track, "name")[0]) {
        setNameElement(track, title);
    }
}


function setKmlTitle(xml, title) {
    const root = xml.documentElement;

    let documentElement = xmlChildren(root, "Document")[0];

    if (!documentElement) {
        documentElement = xml.createElementNS(root.namespaceURI, "Document");

        while (root.firstChild) {
            documentElement.appendChild(root.firstChild);
        }

        root.appendChild(documentElement);
    }

    setNameElement(documentElement, title);
}


function sanitizeFileName(name) {
    const clean = String(name || "")
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\.+/, "");

    return clean || "route";
}


async function buildRenamedRouteBlob(file, title) {
    const xml = await readXmlFile(file);

    const isKml = getRouteFileExtension(file.name) === "kml";

    if (isKml) {
        setKmlTitle(xml, title);
    } else {
        setGpxTitle(xml, title);
    }

    let text = new XMLSerializer().serializeToString(xml);

    if (!/^\s*<\?xml/i.test(text)) {
        text = '<?xml version="1.0" encoding="UTF-8"?>\n' + text;
    }

    return new Blob(
        [text],
        {
            type: isKml
                ? "application/vnd.google-earth.kml+xml"
                : "application/gpx+xml"
        }
    );
}


function triggerBlobDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 10000);
}


async function downloadRouteFile(file, title) {
    const blob = await buildRenamedRouteBlob(file, title);

    triggerBlobDownload(
        blob,
        sanitizeFileName(title) + "." + getRouteFileExtension(file.name)
    );
}


/* =========================================================
   Profile / geometry helpers
   ========================================================= */

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
