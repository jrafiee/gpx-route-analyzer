/* =========================================================
   Application initialization
   ========================================================= */

function initializeApplication() {

    initializeTheme();

    initializeMobileMenu();

    initializeUIEvents();

    initializeRouteSelection();

    restoreSavedRoutes();

}


document.addEventListener(
    "DOMContentLoaded",
    initializeApplication
);