/* =========================================================
   Global application state + shared helpers
   (must be the FIRST script: other files rely on these)
   ========================================================= */

/* Route colours (same order as the numbered markers on the maps) */
const ROUTE_COLORS = [
    "#e53935", "#1e88e5", "#43a047", "#fb8c00", "#8e24aa",
    "#00acc1", "#6d4c41", "#3949ab", "#f4511e", "#00897b"
];

let selectedFiles = [];
let analysisResults = [];
let draggedItem = null;
let activeSection = "home"; // "home" | "guide" | "analysis" | "map" | "navigation" | "weather"
let isWorkspaceOpen = false;

/* Map state */
let map = null;
let mapLayers = [];
let map3d = null;
let currentMapMode = "2d";
let map3dInitialized = false;


/* =========================================================
   Shared helpers
   ========================================================= */

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* touch screens: one finger scrolls the page */
function isTouchDevice() {
    return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
}

/* run `after` every time the global function `name` is called */
function hookFunction(name, after) {
    const original = window[name];

    if (typeof original !== "function") {
        return;
    }

    window[name] = function () {
        const result = original.apply(this, arguments);

        try {
            after.apply(this, arguments);
        } catch (error) {
            console.error(error);
        }

        return result;
    };
}


/*
 * One row above the map for the optional tools (offline download,
 * weather layer). Each tool adds a toggle to the bar and, when it is
 * switched on, its details appear in the panels area under the bar.
 * (offline-region.js and map-3d-weather.js use it)
 */
function getMapExtras() {
    let root = document.getElementById("map-extras");

    if (root) {
        return root;
    }

    const container = document.getElementById("map-container");

    if (!container) {
        return null;
    }

    root = document.createElement("div");
    root.id = "map-extras";
    root.className = "map-extras";
    root.innerHTML =
        '<div class="map-extras-panels" id="map-extras-panels"></div>';

    const anchor = container.querySelector(".map-title-row");

    if (anchor) {
        anchor.after(root);
    } else {
        container.insertBefore(root, container.firstChild);
    }

    return root;
}


/* =========================================================
   Theme
   ========================================================= */

function applyTheme() {
    const isDark = document.body.classList.contains("dark-mode");

    document.querySelectorAll(".theme-toggle").forEach(button => {
        button.innerHTML =
            '<svg class="ico" aria-hidden="true"><use href="#' +
            (isDark ? "i-sun" : "i-moon") + '"/></svg>';
        button.title = isDark ? "حالت روشن" : "حالت تاریک";
        button.setAttribute(
            "aria-label",
            isDark ? "تغییر به حالت روشن" : "تغییر به حالت تاریک"
        );
    });

    try {
        localStorage.setItem("theme", isDark ? "dark" : "light");
    } catch (e) { /* ignore */ }

    // only the charts depend on the theme (maps / weather are CSS driven)
    if (analysisResults.length > 0 && typeof requestChartsRedraw === "function") {
        requestChartsRedraw();
    }
}

function toggleTheme() {
    document.body.classList.toggle("dark-mode");
    applyTheme();
}

function initializeTheme() {
    let saved = null;

    try {
        saved = localStorage.getItem("theme");
    } catch (e) { /* ignore */ }

    if (saved === "dark") {
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
    const summitIndex = getSummitIndexOfPoints(points);

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

    document
        .querySelectorAll(`input[name="map-direction"][value="${mode}"]`)
        .forEach(input => { input.checked = true; });

    if (analysisResults.length === 0) {
        return;
    }

    if (map && typeof drawRoutesOnMap === "function") {
        drawRoutesOnMap(analysisResults);
    }

    if (map3d && map3dInitialized && typeof drawRoutesOn3DMap === "function") {
        drawRoutesOn3DMap(analysisResults);
    }
}


/* =========================================================
   Section navigation
   ========================================================= */

const APP_SECTIONS = ["home", "guide", "analysis", "map", "navigation", "weather"];

function markActiveNav(selector, sectionId) {
    document.querySelectorAll(selector).forEach(item => {
        const active = item.dataset.target === sectionId;

        item.classList.toggle("active", active);

        if (active) {
            item.setAttribute("aria-current", "page");
        } else {
            item.removeAttribute("aria-current");
        }
    });
}

function setActiveSection(sectionId) {
    if (!APP_SECTIONS.includes(sectionId)) {
        return;
    }

    activeSection = sectionId;
    document.body.dataset.section = sectionId;

    APP_SECTIONS.forEach(id => {
        const el = document.getElementById(`section-${id}`);

        if (!el) {
            return;
        }

        el.classList.toggle("active-section", id === sectionId);
        el.style.display = id === sectionId ? "block" : "none";
    });

    markActiveNav(".bottom-nav-item", sectionId);
    markActiveNav(".desktop-nav-item", sectionId);

    // draw whatever was postponed while this section was hidden
    if (typeof flushPendingSectionWork === "function") {
        flushPendingSectionWork(sectionId);
    }

    if (sectionId === "map") {
        setTimeout(() => {
            if (map && typeof map.invalidateSize === "function") {
                map.invalidateSize();
            }
            if (typeof applyPendingMapFit === "function") {
                applyPendingMapFit();
            }
            if (map3d && map3dInitialized && typeof map3d.resize === "function") {
                map3d.resize();
            }
        }, 80);
    } else if (sectionId === "analysis") {
        setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
    }

    window.scrollTo({ top: 0, behavior: "instant" });
}


/* =========================================================
   Route workspace drawer
   ========================================================= */

function updateRouteWorkspaceBadges() {
    const count = selectedFiles.length;

    document.querySelectorAll(".route-count-badge").forEach(badge => {
        badge.textContent = count;
        badge.classList.toggle("badge-zero", count === 0);
    });

    document.querySelectorAll(".route-count-label").forEach(label => {
        label.textContent = count === 0 ? "بدون مسیر" : `${count} مسیر`;
    });
}

/*
 * On mobile the sheet owns one history entry, so the browser /
 * phone Back button closes the sheet instead of leaving the app.
 */

let workspaceHistoryPushed = false;

function openRouteWorkspace() {
    if (isWorkspaceOpen) {
        return;
    }

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

    if (window.innerWidth <= 900 && !workspaceHistoryPushed) {
        try {
            history.pushState({ routeWorkspace: true }, "");
            workspaceHistoryPushed = true;
        } catch (e) {
            workspaceHistoryPushed = false;
        }
    }
}

function hideRouteWorkspaceUI() {
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

function closeRouteWorkspace() {
    const needBack = workspaceHistoryPushed;

    hideRouteWorkspaceUI();

    if (needBack) {
        workspaceHistoryPushed = false;
        history.back();
    }
}

window.addEventListener("popstate", function () {
    workspaceHistoryPushed = false;

    if (isWorkspaceOpen) {
        hideRouteWorkspaceUI();
    }
});
