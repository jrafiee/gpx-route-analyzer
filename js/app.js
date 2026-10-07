/* =========================================================
   Application initialization
   ========================================================= */

/*
 * Desktop: the Damavand header image scrolls away while the top
 * bar stays. The fixed sidebar must follow the visible part of
 * the header, so its offset is exposed as a CSS variable.
 */

function updateSidebarOffset() {

    const hero = document.querySelector(".site-hero");

    let offset = 0;

    if (hero && hero.offsetHeight > 0) {
        offset = Math.max(0, hero.offsetHeight - window.scrollY);
    }

    document.documentElement.style.setProperty(
        "--hero-offset",
        offset + "px"
    );

}


function initializeSidebarOffset() {

    updateSidebarOffset();

    window.addEventListener("scroll", updateSidebarOffset, { passive: true });
    window.addEventListener("resize", updateSidebarOffset);
    window.addEventListener("load", updateSidebarOffset);

}


/*
 * The header image is desktop only; on phones it is hidden by CSS
 * but the browser would still download it. It is loaded only when
 * the screen is wide enough.
 */

function loadHeroImage() {

    const image = document.querySelector(".site-hero img[data-src]");

    if (!image) {
        return;
    }

    if (window.innerWidth > 900) {
        image.src = image.dataset.src;
        image.removeAttribute("data-src");
    } else {
        window.addEventListener("resize", loadHeroImage, { once: true });
    }

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

    initializeSidebarOffset();

    await restoreSavedRoutes();

    /*
     * No route selected on start:
     *   mobile  -> open the route management sheet
     *   desktop -> show the guide section
     */

    if (selectedFiles.length === 0) {

        if (window.innerWidth <= 900) {
            openRouteWorkspace();
        } else {
            setActiveSection("guide");
        }

    }

}


document.addEventListener(
    "DOMContentLoaded",
    initializeApplication
);
