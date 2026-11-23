/* =========================================================
   Application initialization
   ========================================================= */

/*
 * The hero photo of the home page is loaded after the first paint.
 */

function loadHeroImage() {

    const image = document.querySelector(".home-hero-bg img[data-src]");

    if (!image) {
        return;
    }

    image.src = image.dataset.src;
    image.removeAttribute("data-src");

}


/*
 * Plotly / Leaflet are loaded from vendor/ (own server, see
 * download-vendor.sh). If a script is missing there, the CDN copy is
 * loaded instead (the Leaflet stylesheet has its own onerror fallback
 * in index.html).
 */

const LIBRARY_FALLBACKS = {
    Plotly: "https://cdn.plot.ly/plotly-basic-2.35.2.min.js",
    L: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
};

function loadScriptOnce(src, timeoutMs = 8000) {

    return new Promise((resolve, reject) => {

        const script = document.createElement("script");

        const timer = setTimeout(() => {
            script.remove();
            reject(new Error("Timeout " + src));
        }, timeoutMs);

        script.src = src;

        script.onload = () => {
            clearTimeout(timer);
            resolve();
        };

        script.onerror = () => {
            clearTimeout(timer);
            reject(new Error("Cannot load " + src));
        };

        document.head.appendChild(script);

    });

}


async function ensureLibraries() {

    const jobs = Object.entries(LIBRARY_FALLBACKS)
        .filter(([name]) => !window[name])
        .map(([, src]) => loadScriptOnce(src));

    if (jobs.length > 0) {
        await Promise.allSettled(jobs);
    }

}


async function initializeApplication() {

    await ensureLibraries();

    loadHeroImage();

    initializeTheme();

    initializeMobileMenu();

    initializeUIEvents();

    // the default-route checkboxes must exist before they get listeners
    await loadSampleRouteList();

    initializeRouteSelection();

    /*
     * First screen: users with saved routes go straight to the
     * analysis, everyone else sees the home page.
     */

    // a direct link (#/map ...) or a refresh keeps the requested section
    const hashSection = getSectionFromHash();

    hashRoutePinned = hashSection !== null;

    const hasSavedRoutes =
        typeof readRouteOrderLocal === "function" &&
        readRouteOrderLocal().length > 0;

    setActiveSection(hashSection || (hasSavedRoutes ? "analysis" : "home"));

    // empty state first (hides the charts until a route exists)
    redrawAllCharts();

    await restoreSavedRoutes();

    if (!hashSection) {
        if (selectedFiles.length === 0) {
            setActiveSection("home");
        } else if (activeSection === "home") {
            setActiveSection("analysis");
        }
    }

    hashRoutePinned = false;

}


document.addEventListener(
    "DOMContentLoaded",
    initializeApplication
);
