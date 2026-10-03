/* =========================================================
   UI Controller & Navigation Orchestrator
   ========================================================= */

function updateMenuButton() {
    const isClosed = !isWorkspaceOpen;
    document.querySelectorAll(".menu-button, .workspace-toggle-btn").forEach(btn => {
        btn.setAttribute("aria-expanded", String(!isClosed));
    });
}

function toggleMenu() {
    toggleRouteWorkspace();
}

function closeMobileMenu() {
    closeRouteWorkspace();
}

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

function showAnalysisCharts() {
    const eleCont = document.getElementById("elevation-container");
    const slopeCont = document.getElementById("slope-difficulty-grid");
    const barCont = document.getElementById("bar-charts-grid");
    const mapCont = document.getElementById("map-container");

    if (eleCont) eleCont.style.display = "block";
    if (slopeCont) slopeCont.style.display = "grid";
    if (barCont) barCont.style.display = "grid";
    if (mapCont) mapCont.style.display = "block";

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

function redrawAllCharts() {
    updateRouteWorkspaceBadges();
    handleDesktopSectionSwitch();
    if (typeof updateRouteSummary === "function") {
        updateRouteSummary();
    }

    if (analysisResults.length === 0) {
        hideAnalysisCharts();
        clearMap();
        clear3DMap();
        clearWeatherForecasts();
        return;
    }

    showAnalysisCharts();

    if (typeof drawElevationProfile === "function") {
        drawElevationProfile(analysisResults);
    }

    if (typeof drawSlopeDistribution === "function") {
        drawSlopeDistribution(analysisResults);
    }

    if (typeof drawDifficultyScoreChart === "function") {
        drawDifficultyScoreChart(analysisResults);
    }

    if (typeof drawAscentTimeComparisonChart === "function") {
        drawAscentTimeComparisonChart(analysisResults);
    }

    if (typeof drawRouteMetricsComparisonChart === "function") {
        drawRouteMetricsComparisonChart(analysisResults);
    }

    if (typeof drawRoutesOnMap === "function") {
        drawRoutesOnMap(analysisResults);
    }

    if (currentMapMode === "3d" && map3d && typeof drawRoutesOn3DMap === "function") {
        drawRoutesOn3DMap(analysisResults);
    }

    if (typeof drawWeatherForecasts === "function") {
        drawWeatherForecasts(analysisResults);
    }
}

function initializeUIEvents() {
    document.querySelectorAll(".bottom-nav-item").forEach(item => {
        item.addEventListener("click", () => {
            const targetSection = item.dataset.target;
            setActiveSection(targetSection);
        });
    });

    document.querySelectorAll(".desktop-nav-item").forEach(item => {
        item.addEventListener("click", () => {
            const targetSection = item.dataset.target;
            setActiveSection(targetSection);
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
}