/* =========================================================
   Global application state
   ========================================================= */

let selectedFiles = [];

let analysisResults = [];

let draggedItem = null;


/* =========================================================
   Map state
   ========================================================= */

let map = null;

let mapLayers = [];

let map3d = null;

let currentMapMode = "2d";

let map3dInitialized = false;


/* =========================================================
   Plot theme
   ========================================================= */

function getPlotTheme() {

    if (
        document.body.classList.contains(
            "dark-mode"
        )
    ) {

        return {

            paperBg: "#202324",
            plotBg: "#202324",
            textColor: "#e5e5e5",
            gridColor: "#3a3d3f",
            zerolineColor: "#55585a",
            lineColor: "#666",
            tickColor: "#aaa"

        };

    }


    return {

        paperBg: "white",
        plotBg: "white",
        textColor: "#333",
        gridColor: "#ddd",
        zerolineColor: "#aaa",
        lineColor: "#777",
        tickColor: "#555"

    };

}


/* =========================================================
   Theme
   ========================================================= */

function applyTheme() {

    const isDark =
        document.body.classList.contains(
            "dark-mode"
        );


    const button =
        document.getElementById(
            "theme-toggle"
        );


    if (!button) {

        return;

    }


    if (isDark) {

        button.textContent = "☀️";

        button.title = "حالت روشن";

        button.setAttribute(
            "aria-label",
            "تغییر به حالت روشن"
        );

        localStorage.setItem(
            "theme",
            "dark"
        );

    } else {

        button.textContent = "🌙";

        button.title = "حالت تاریک";

        button.setAttribute(
            "aria-label",
            "تغییر به حالت تاریک"
        );

        localStorage.setItem(
            "theme",
            "light"
        );

    }


    if (
        analysisResults.length > 0 &&
        typeof redrawAllCharts === "function"
    ) {

        redrawAllCharts();

    }

}


function toggleTheme() {

    document.body.classList.toggle(
        "dark-mode"
    );

    applyTheme();

}


function initializeTheme() {

    const savedTheme =
        localStorage.getItem(
            "theme"
        );


    if (
        savedTheme === "dark"
    ) {

        document.body.classList.add(
            "dark-mode"
        );

    }


    applyTheme();

}


/* =========================================================
   Map direction (outbound / return / both)

   Outbound = start -> summit (highest point)
   Return   = summit -> end
   ========================================================= */

let mapDirectionMode = "both";


/*
 * Point index range (inclusive) that is visible for the
 * current direction mode, plus the index used for the
 * numbered route marker.
 */

function getDirectionPointRange(points) {

    const last = points.length - 1;

    let summitIndex = 0;

    for (let i = 1; i < points.length; i++) {

        if (
            Number.isFinite(points[i].elevation) &&
            points[i].elevation > points[summitIndex].elevation
        ) {
            summitIndex = i;
        }

    }

    if (mapDirectionMode === "outbound") {
        return { start: 0, end: summitIndex, markerIndex: 0 };
    }

    if (mapDirectionMode === "return") {
        return { start: summitIndex, end: last, markerIndex: summitIndex };
    }

    return { start: 0, end: last, markerIndex: 0 };

}


function getDirectionPoints(points) {

    const range = getDirectionPointRange(points);

    return points.slice(range.start, range.end + 1);

}


function setMapDirection(mode) {

    if (!["both", "outbound", "return"].includes(mode)) {
        return;
    }

    mapDirectionMode = mode;

    if (analysisResults.length === 0) {
        return;
    }

    if (map && typeof drawRoutesOnMap === "function") {
        drawRoutesOnMap(analysisResults);
    }

    if (
        map3d &&
        map3dInitialized &&
        typeof drawRoutesOn3DMap === "function"
    ) {
        drawRoutesOn3DMap(analysisResults);
    }

}
