/* =========================================================
   UI Controller & Navigation Orchestrator
   ========================================================= */

function initializeMobileMenu() {
    const overlay = document.getElementById("workspace-overlay");
    if (overlay) {
        overlay.addEventListener("click", closeRouteWorkspace);
    }

    document.querySelectorAll(".workspace-close-btn").forEach(btn => {
        btn.addEventListener("click", closeRouteWorkspace);
    });

    document.querySelectorAll(".workspace-trigger").forEach(btn => {
        btn.addEventListener("click", openRouteWorkspace);
    });
}

let analysisChartsShown = false;

function showAnalysisCharts() {
    const eleCont = document.getElementById("elevation-container");
    const slopeCont = document.getElementById("slope-difficulty-grid");
    const barCont = document.getElementById("bar-charts-grid");
    const mapCont = document.getElementById("map-container");

    if (eleCont) eleCont.style.display = "block";
    if (slopeCont) slopeCont.style.display = "grid";
    if (barCont) barCont.style.display = "grid";
    if (mapCont) mapCont.style.display = "block";

    // Only needed when the containers were hidden before; a resize
    // event makes every Plotly chart re-layout, so it is not fired
    // on every redraw any more.
    if (analysisChartsShown) {
        return;
    }

    analysisChartsShown = true;

    setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
        if (map && typeof map.invalidateSize === "function") {
            map.invalidateSize();
        }
        if (map3d && typeof map3d.resize === "function") {
            map3d.resize();
        }
    }, 50);
}

function hideAnalysisCharts() {
    const eleCont = document.getElementById("elevation-container");
    const slopeCont = document.getElementById("slope-difficulty-grid");
    const barCont = document.getElementById("bar-charts-grid");
    const mapCont = document.getElementById("map-container");

    if (eleCont) eleCont.style.display = "none";
    if (slopeCont) slopeCont.style.display = "none";
    if (barCont) barCont.style.display = "none";
    if (mapCont) mapCont.style.display = "none";

    analysisChartsShown = false;
}

let lastRouteCount = 0;

/*
 * Desktop only: first route selected -> open the analysis section;
 * all routes removed -> back to the guide section.
 */
function handleDesktopSectionSwitch() {
    const count = analysisResults.length;
    const previous = lastRouteCount;
    lastRouteCount = count;

    if (window.innerWidth <= 900) {
        return;
    }

    if (previous === 0 && count > 0) {
        setActiveSection("analysis");
    } else if (previous > 0 && count === 0) {
        setActiveSection("guide");
    }
}

/* =========================================================
   Lazy drawing

   Charts, maps and weather live in different sections. Only the
   visible one is drawn; the others are marked "dirty" and drawn
   when the user opens them (see flushPendingSectionWork, called
   from setActiveSection).
   ========================================================= */

let chartsNeedRedraw = false;
let mapNeedsRedraw = false;
let weatherNeedsRedraw = false;

function drawAnalysisCharts() {
    drawElevationProfile(analysisResults);
    drawSlopeDistribution(analysisResults);
    drawDifficultyScoreChart(analysisResults);
    drawAscentTimeComparisonChart(analysisResults);
    drawRouteMetricsComparisonChart(analysisResults);
}

function drawMapsNow() {
    drawRoutesOnMap(analysisResults);

    if (currentMapMode === "3d" && map3d && typeof drawRoutesOn3DMap === "function") {
        drawRoutesOn3DMap(analysisResults);
    }
}

function requestChartsRedraw() {
    if (analysisResults.length === 0) {
        return;
    }

    if (activeSection === "analysis") {
        chartsNeedRedraw = false;
        drawAnalysisCharts();
    } else {
        chartsNeedRedraw = true;
    }
}

function requestMapRedraw() {
    if (activeSection === "map") {
        mapNeedsRedraw = false;
        drawMapsNow();
    } else {
        mapNeedsRedraw = true;
    }
}

function requestWeatherRedraw() {
    if (activeSection === "weather") {
        weatherNeedsRedraw = false;
        drawWeatherForecasts(analysisResults);
    } else {
        weatherNeedsRedraw = true;
    }
}

function flushPendingSectionWork(section) {
    if (analysisResults.length === 0) {
        return;
    }

    if (section === "analysis" && chartsNeedRedraw) {
        chartsNeedRedraw = false;
        drawAnalysisCharts();
    } else if (section === "map" && mapNeedsRedraw) {
        mapNeedsRedraw = false;
        drawMapsNow();
    } else if (section === "weather" && weatherNeedsRedraw) {
        weatherNeedsRedraw = false;
        drawWeatherForecasts(analysisResults);
    }
}

function redrawAllCharts() {
    updateRouteWorkspaceBadges();
    handleDesktopSectionSwitch();
    if (typeof updateRouteSummary === "function") {
        updateRouteSummary();
    }

    if (analysisResults.length === 0) {
        chartsNeedRedraw = false;
        mapNeedsRedraw = false;
        weatherNeedsRedraw = false;
        hideAnalysisCharts();
        clearMap();
        clear3DMap();
        clearWeatherForecasts();
        return;
    }

    showAnalysisCharts();
    requestChartsRedraw();
    requestMapRedraw();
    requestWeatherRedraw();
}

/* =========================================================
   Calculations guide (loaded on demand)
   The ~900-line guide used to be inlined in index.html; it is
   now fetched the first time the accordion is opened.
   ========================================================= */

function initializeCalculationsGuide() {
    const details = document.getElementById("guide-calculations");
    const body = document.getElementById("calc-doc-body");

    if (!details || !body) {
        return;
    }

    let loaded = false;

    async function load() {
        if (loaded) {
            return;
        }

        loaded = true;

        try {
            const response = await fetch("partials/calculations.html");

            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }

            body.innerHTML = await response.text();
        } catch (error) {
            loaded = false;
            body.innerHTML =
                '<p class="small">بارگذاری راهنما ممکن نشد. ' +
                'اتصال اینترنت را بررسی کنید و دوباره باز کنید.</p>';
        }
    }

    details.addEventListener("toggle", () => {
        if (details.open) {
            load();
        }
    });

    if (details.open) {
        load();
    }
}

function initializeUIEvents() {
    document.querySelectorAll(".bottom-nav-item, .desktop-nav-item").forEach(item => {
        item.addEventListener("click", () => {
            setActiveSection(item.dataset.target);
        });
    });

    const searchInput = document.getElementById("route-search-input");
    if (searchInput) {
        searchInput.addEventListener("input", function() {
            const query = this.value.trim().toLowerCase();
            document.querySelectorAll("#default-routes label").forEach(label => {
                const text = label.textContent.toLowerCase();
                label.style.display = text.includes(query) ? "flex" : "none";
            });
        });
    }

    window.addEventListener("keydown", function(e) {
        if (e.key === "Escape" && isWorkspaceOpen) {
            closeRouteWorkspace();
        }
    });

    window.addEventListener("resize", function() {
        if (window.innerWidth > 900) {
            const sidebar = document.getElementById("sidebar");
            const overlay = document.getElementById("workspace-overlay");
            if (sidebar) {
                sidebar.classList.remove("closed", "open");
            }
            if (overlay) {
                overlay.classList.remove("active");
            }
            document.body.classList.remove("drawer-open");
            isWorkspaceOpen = false;
        }
    });

    initializeCalculationsGuide();
}
