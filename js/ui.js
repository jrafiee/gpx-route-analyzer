/* =========================================================
   Mobile menu
   ========================================================= */

function updateMenuButton() {

    const sidebar =
        document.getElementById(
            "sidebar"
        );


    const button =
        document.getElementById(
            "menu-button"
        );


    if (
        !sidebar ||
        !button
    ) {

        return;

    }


    const isClosed =
        sidebar.classList.contains(
            "closed"
        );


    button.setAttribute(
        "aria-expanded",
        String(!isClosed)
    );


    button.setAttribute(
        "aria-label",
        isClosed
            ? "باز کردن منوی مسیرها"
            : "بستن منوی مسیرها"
    );


    button.title =
        isClosed
            ? "باز کردن منوی مسیرها"
            : "بستن منوی مسیرها";

}


function toggleMenu() {

    const sidebar =
        document.getElementById(
            "sidebar"
        );


    if (!sidebar) {

        return;

    }


    sidebar.classList.toggle(
        "closed"
    );


    updateMenuButton();

}


function closeMobileMenu() {

    if (
        window.innerWidth >
        900
    ) {

        return;

    }


    const sidebar =
        document.getElementById(
            "sidebar"
        );


    if (!sidebar) {

        return;

    }


    sidebar.classList.add(
        "closed"
    );


    updateMenuButton();

}


function initializeMobileMenu() {

    const sidebar =
        document.getElementById(
            "sidebar"
        );


    if (!sidebar) {

        return;

    }


    sidebar.classList.remove(
        "closed"
    );


    updateMenuButton();

}


/* =========================================================
   Show / hide analysis charts
   ========================================================= */

function showAnalysisCharts() {

    document.getElementById(
        "elevation-container"
    ).style.display = "block";


    document.getElementById(
        "elevation-gain-container"
    ).style.display = "block";


    document.getElementById(
        "ordered-elevation-container"
    ).style.display = "block";


    document.getElementById(
        "slope-container"
    ).style.display = "block";


    document.getElementById(
        "bar-charts-grid"
    ).style.display = "grid";


    document.getElementById(
        "map-container"
    ).style.display = "block";


    setTimeout(
        () => {

            window.dispatchEvent(
                new Event("resize")
            );


            if (map) {

                map.invalidateSize();

            }


            if (map3d) {

                map3d.resize();

            }

        },
        50
    );

}


function hideAnalysisCharts() {

    document.getElementById(
        "elevation-container"
    ).style.display = "none";


    document.getElementById(
        "elevation-gain-container"
    ).style.display = "none";


    document.getElementById(
        "ordered-elevation-container"
    ).style.display = "none";


    document.getElementById(
        "slope-container"
    ).style.display = "none";


    document.getElementById(
        "bar-charts-grid"
    ).style.display = "none";


    document.getElementById(
        "map-container"
    ).style.display = "none";

}


/* =========================================================
   Redraw all charts and maps
   ========================================================= */
function redrawAllCharts() {

    if (
        analysisResults.length === 0
    ) {

        hideAnalysisCharts();

        clearMap();

        clear3DMap();

        clearWeatherForecasts();

        return;

    }


    showAnalysisCharts();


    drawElevationProfile(
        analysisResults
    );


    drawElevationGainProfile(
        analysisResults
    );


    drawOrderedElevationProfile(
        analysisResults
    );


    drawSlopeDistribution(
        analysisResults
    );


    drawAscentTimeComparisonChart(
        analysisResults
    );


    drawRouteMetricsComparisonChart(
        analysisResults
    );


    drawRoutesOnMap(
        analysisResults
    );


    if (
        currentMapMode === "3d" &&
        map3d
    ) {

        drawRoutesOn3DMap(
            analysisResults
        );

    }


    /* =========================
       Weather
       بعد از نقشه‌ها
       ========================= */

    drawWeatherForecasts(
        analysisResults
    );

}


/* =========================================================
   Main click closes mobile menu
   ========================================================= */

function initializeUIEvents() {

    const main =
        document.querySelector(
            ".main"
        );


    if (main) {

        main.addEventListener(
            "click",
            function() {

                closeMobileMenu();

            }
        );

    }


    window.addEventListener(
        "resize",
        function() {

            if (
                window.innerWidth >
                900
            ) {

                const sidebar =
                    document.getElementById(
                        "sidebar"
                    );


                if (sidebar) {

                    sidebar.classList.remove(
                        "closed"
                    );

                }

            }


            updateMenuButton();

        }
    );

}