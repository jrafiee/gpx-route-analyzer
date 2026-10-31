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
 * Plotly / Leaflet are loaded from vendor/ (own server). If a file
 * is missing there, the CDN copy is loaded instead.
 */

const LIBRARY_FALLBACKS = {
    Plotly: "https://cdn.plot.ly/plotly-basic-2.35.2.min.js",
    L: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
};

function loadScriptOnce(src) {

    return new Promise((resolve, reject) => {

        const script = document.createElement("script");

        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Cannot load " + src));

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

    initializeRouteSelection();

    /*
     * First screen: users with saved routes go straight to the
     * analysis, everyone else sees the home page.
     */

    const hasSavedRoutes =
        typeof readRouteOrderLocal === "function" &&
        readRouteOrderLocal().length > 0;

    setActiveSection(hasSavedRoutes ? "analysis" : "home");

    // empty state first (hides the charts until a route exists)
    redrawAllCharts();

    await restoreSavedRoutes();

    if (selectedFiles.length === 0) {
        setActiveSection("home");
    } else if (activeSection === "home") {
        setActiveSection("analysis");
    }

}


document.addEventListener(
    "DOMContentLoaded",
    initializeApplication
);
