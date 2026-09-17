/* =========================================================
   GPX file input
   ========================================================= */

function initializeRouteSelection() {

    const input =
        document.getElementById(
            "gpx-file-input"
        );


    if (input) {

        input.addEventListener(
            "change",
            handleGpxFiles
        );

    }


    document
        .querySelectorAll(
            ".default-route"
        )
        .forEach(
            checkbox => {

                checkbox.addEventListener(
                    "change",
                    handleDefaultRouteChange
                );

            }
        );

}


/* =========================================================
   User GPX files
   ========================================================= */

async function handleGpxFiles(event) {

    const files =
        Array.from(
            event.target.files
        );


    for (
        const file of files
    ) {

        if (
            !file.name
                .toLowerCase()
                .endsWith(".gpx")
        ) {

            continue;

        }


        await addGpxFile(
            file
        );

    }


    event.target.value = "";

}


/* =========================================================
   Add GPX
   ========================================================= */

async function addGpxFile(file) {

    if (
        !file ||
        !file.name ||
        !file.name
            .toLowerCase()
            .endsWith(".gpx")
    ) {

        return;

    }


    const alreadyExists =
        selectedFiles.some(
            existingFile =>
                existingFile.name ===
                file.name
        );


    if (
        alreadyExists
    ) {

        return;

    }


    selectedFiles.push(
        file
    );


    addSelectedRoute(
        file
    );


    try {

        const route =
            await loadGpxFile(
                file
            );


        const routeName =
            file.name.replace(
                /\.gpx$/i,
                ""
            );


        const result =
            analyzeRoute(
                route,
                routeName
            );


        result.routeData =
            route;


        analysisResults.push(
            result
        );


        redrawAllCharts();


    } catch (error) {

        console.error(
            "GPX analysis error:",
            error
        );


        selectedFiles =
            selectedFiles.filter(
                existingFile =>
                    existingFile !== file
            );


        const item =
            Array.from(
                document.querySelectorAll(
                    ".selected-route"
                )
            ).find(
                element =>
                    element.file === file
            );


        if (item) {

            item.remove();

        }


        const failedRouteName =
            file.name.replace(
                /\.gpx$/i,
                ""
            );


        const failedCheckbox =
            Array.from(
                document.querySelectorAll(
                    ".default-route"
                )
            ).find(
                checkbox =>
                    checkbox.dataset.name ===
                    failedRouteName
            );


        if (failedCheckbox) {

            failedCheckbox.checked =
                false;

        }


        updateRouteNumbers();

        redrawAllCharts();

    }

}


/* =========================================================
   Default routes
   ========================================================= */

async function handleDefaultRouteChange() {

    if (
        !this.checked
    ) {

        removeSelectedRoute(
            this.dataset.name +
            ".gpx"
        );

        return;

    }


    try {

        const response =
            await fetch(
                encodeURI(
                    this.dataset.file
                ),
                {
                    cache:
                        "no-cache"
                }
            );


        if (
            !response.ok
        ) {

            throw new Error(
                `Cannot load GPX: ${this.dataset.file}`
            );

        }


        const blob =
            await response.blob();


        const file =
            new File(
                [blob],
                this.dataset.name +
                ".gpx",
                {
                    type:
                        "application/gpx+xml"
                }
            );


        await addGpxFile(
            file
        );


    } catch (error) {

        console.error(
            "Default GPX loading error:",
            error
        );


        this.checked =
            false;

    }

}


/* =========================================================
   Selected routes UI
   ========================================================= */

function addSelectedRoute(file) {

    const container =
        document.getElementById(
            "selected-routes"
        );


    const emptyMessage =
        document.getElementById(
            "empty-message"
        );


    if (emptyMessage) {

        emptyMessage.remove();

    }


    const item =
        document.createElement(
            "div"
        );


    item.className =
        "selected-route";


    item.draggable = true;


    item.file = file;


    item.dataset.route =
        file.name;


    const routeName =
        file.name.replace(
            /\.gpx$/i,
            ""
        );


    item.innerHTML = `

        <span class="drag-handle">
            ☰
        </span>

        <span class="route-number">
        </span>

        <span class="selected-route-name">
            ${escapeHtml(routeName)}
        </span>

        <button
            class="remove-route"
            title="حذف مسیر"
        >
            ×
        </button>

    `;


    item
        .querySelector(
            ".remove-route"
        )
        .addEventListener(
            "click",
            function(event) {

                event.stopPropagation();

                removeSelectedRoute(
                    file.name
                );

            }
        );


    item.addEventListener(
        "dragstart",
        handleDragStart
    );


    item.addEventListener(
        "dragover",
        handleDragOver
    );


    item.addEventListener(
        "drop",
        handleDrop
    );


    item.addEventListener(
        "dragend",
        handleDragEnd
    );


    container.appendChild(
        item
    );


    updateRouteNumbers();

}


function escapeHtml(value) {

    return value

        .replace(
            /&/g,
            "&amp;"
        )

        .replace(
            /</g,
            "&lt;"
        )

        .replace(
            />/g,
            "&gt;"
        )

        .replace(
            /"/g,
            "&quot;"
        )

        .replace(
            /'/g,
            "&#039;"
        );

}


/* =========================================================
   Remove route
   ========================================================= */

function removeSelectedRoute(
    route
) {

    selectedFiles =
        selectedFiles.filter(
            file =>
                file.name !== route
        );


    const routeName =
        route.replace(
            /\.gpx$/i,
            ""
        );


    analysisResults =
        analysisResults.filter(
            result =>
                result.route !==
                routeName
        );


    const defaultCheckbox =
        Array.from(
            document.querySelectorAll(
                ".default-route"
            )
        ).find(
            checkbox =>
                checkbox.dataset.name ===
                routeName
        );


    if (defaultCheckbox) {

        defaultCheckbox.checked =
            false;

    }


    const item =
        Array.from(
            document.querySelectorAll(
                ".selected-route"
            )
        ).find(
            element =>
                element.dataset.route ===
                route
        );


    if (item) {

        item.remove();

    }


    const container =
        document.getElementById(
            "selected-routes"
        );


    if (
        container.querySelectorAll(
            ".selected-route"
        ).length === 0
    ) {

        container.innerHTML = `

            <div
                id="empty-message"
                class="empty-message"
            >
                هنوز مسیری انتخاب نشده است
            </div>

        `;

    }


    updateRouteNumbers();

    redrawAllCharts();

}


/* =========================================================
   Selected files
   ========================================================= */

function getSelectedFiles() {

    return Array.from(
        document.querySelectorAll(
            ".selected-route"
        )
    ).map(
        item =>
            item.file
    );

}


function updateRouteNumbers() {

    const items =
        document.querySelectorAll(
            ".selected-route"
        );


    items.forEach(
        (item, index) => {

            const number =
                item.querySelector(
                    ".route-number"
                );


            if (number) {

                number.textContent =
                    index + 1;

            }

        }
    );

}


/* =========================================================
   Drag & Drop
   ========================================================= */

function handleDragStart(event) {

    draggedItem =
        event.currentTarget;


    event.currentTarget.style.opacity =
        "0.5";

}


function handleDragOver(event) {

    event.preventDefault();


    const target =
        event.currentTarget;


    if (
        !draggedItem ||
        target === draggedItem
    ) {

        return;

    }


    const container =
        document.getElementById(
            "selected-routes"
        );


    const items =
        Array.from(
            container.querySelectorAll(
                ".selected-route"
            )
        );


    const draggedIndex =
        items.indexOf(
            draggedItem
        );


    const targetIndex =
        items.indexOf(
            target
        );


    if (
        draggedIndex <
        targetIndex
    ) {

        container.insertBefore(
            draggedItem,
            target.nextSibling
        );

    } else {

        container.insertBefore(
            draggedItem,
            target
        );

    }


    updateRouteNumbers();

}


function handleDrop(event) {

    event.preventDefault();

}


function handleDragEnd(event) {

    event.currentTarget.style.opacity =
        "1";


    draggedItem = null;


    updateRouteNumbers();

    syncAnalysisOrder();

}


/* =========================================================
   Synchronize analysis order
   ========================================================= */

function syncAnalysisOrder() {

    const routeItems =
        Array.from(
            document.querySelectorAll(
                ".selected-route"
            )
        );


    const orderedNames =
        routeItems.map(
            item =>
                item.file.name.replace(
                    /\.gpx$/i,
                    ""
                )
        );


    analysisResults.sort(
        (a, b) => {

            return (
                orderedNames.indexOf(
                    a.route
                ) -
                orderedNames.indexOf(
                    b.route
                )
            );

        }
    );


    redrawAllCharts();

}