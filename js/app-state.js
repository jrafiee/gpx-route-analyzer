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