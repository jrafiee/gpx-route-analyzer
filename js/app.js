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


async function initializeApplication() {

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
