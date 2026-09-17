/* =========================================================
   Application initialization
   ========================================================= */

function initializeApplication() {

    initializeTheme();

    initializeMobileMenu();

    initializeUIEvents();

    initializeRouteSelection();

}


document.addEventListener(
    "DOMContentLoaded",
    initializeApplication
);