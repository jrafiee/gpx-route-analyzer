/* =========================================================
   Global application state
   ========================================================= */

let selectedFiles = [];
let analysisResults = [];
let draggedItem = null;
let activeSection = "analysis"; // "guide" | "analysis" | "map" | "weather"
let isWorkspaceOpen = false;

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
    if (document.body.classList.contains("dark-mode")) {
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
    const isDark = document.body.classList.contains("dark-mode");
    const buttons = document.querySelectorAll(".theme-toggle");

    buttons.forEach(button => {
        if (isDark) {
            button.innerHTML = "☀️";
            button.title = "حالت روشن";
            button.setAttribute("aria-label", "تغییر به حالت روشن");
        } else {
            button.innerHTML = "🌙";
            button.title = "حالت تاریک";
            button.setAttribute("aria-label", "تغییر به حالت تاریک");
        }
    });

    if (isDark) {
        localStorage.setItem("theme", "dark");
    } else {
        localStorage.setItem("theme", "light");
    }

    if (analysisResults.length > 0 && typeof redrawAllCharts === "function") {
        redrawAllCharts();
    }
}

function toggleTheme() {
    document.body.classList.toggle("dark-mode");
    applyTheme();
}

function initializeTheme() {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") {
        document.body.classList.add("dark-mode");
    }
    applyTheme();
}

/* =========================================================
   Map direction (outbound / return / both)
   ========================================================= */

let mapDirectionMode = "both";

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

    document.querySelectorAll(`input[name="map-direction"][value="${mode}"]`).forEach(input => {
        input.checked = true;
    });

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

/* =========================================================
   Section Navigation (4 main sections)
   ========================================================= */

function setActiveSection(sectionId) {
    const validSections = ["guide", "analysis", "map", "weather"];
    if (!validSections.includes(sectionId)) {
        return;
    }

    activeSection = sectionId;

    validSections.forEach(id => {
        const el = document.getElementById(`section-${id}`);
        if (el) {
            if (id === sectionId) {
                el.classList.add("active-section");
                el.style.display = "block";
            } else {
                el.classList.remove("active-section");
                el.style.display = "none";
            }
        }
    });

    document.querySelectorAll(".bottom-nav-item").forEach(item => {
        const target = item.dataset.target;
        if (target === sectionId) {
            item.classList.add("active");
            item.setAttribute("aria-current", "page");
        } else {
            item.classList.remove("active");
            item.removeAttribute("aria-current");
        }
    });

    document.querySelectorAll(".desktop-nav-item").forEach(item => {
        const target = item.dataset.target;
        if (target === sectionId) {
            item.classList.add("active");
            item.setAttribute("aria-current", "page");
        } else {
            item.classList.remove("active");
            item.removeAttribute("aria-current");
        }
    });

    if (sectionId === "map") {
        setTimeout(() => {
            if (map && typeof map.invalidateSize === "function") {
                map.invalidateSize();
            }
            if (map3d && map3dInitialized && typeof map3d.resize === "function") {
                map3d.resize();
            }
        }, 80);
    } else if (sectionId === "analysis") {
        setTimeout(() => {
            window.dispatchEvent(new Event("resize"));
        }, 80);
    }

    window.scrollTo({ top: 0, behavior: "instant" });
}

/* =========================================================
   Route Workspace Drawer
   ========================================================= */

function updateRouteWorkspaceBadges() {
    const count = selectedFiles.length;
    const badgeElements = document.querySelectorAll(".route-count-badge");
    const labelElements = document.querySelectorAll(".route-count-label");

    badgeElements.forEach(badge => {
        badge.textContent = count;
        if (count > 0) {
            badge.classList.remove("badge-zero");
        } else {
            badge.classList.add("badge-zero");
        }
    });

    labelElements.forEach(label => {
        if (count === 0) {
            label.textContent = "بدون مسیر";
        } else {
            label.textContent = `${count} مسیر`;
        }
    });
}

function openRouteWorkspace() {
    isWorkspaceOpen = true;
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("workspace-overlay");

    if (sidebar) {
        sidebar.classList.add("open");
        sidebar.classList.remove("closed");
        sidebar.setAttribute("aria-hidden", "false");
    }

    if (overlay) {
        overlay.classList.add("active");
    }

    document.body.classList.add("drawer-open");
}

function closeRouteWorkspace() {
    isWorkspaceOpen = false;
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("workspace-overlay");

    if (sidebar) {
        sidebar.classList.remove("open");
        sidebar.classList.add("closed");
        sidebar.setAttribute("aria-hidden", "true");
    }

    if (overlay) {
        overlay.classList.remove("active");
    }

    document.body.classList.remove("drawer-open");
}

function toggleRouteWorkspace() {
    if (isWorkspaceOpen) {
        closeRouteWorkspace();
    } else {
        openRouteWorkspace();
    }
}