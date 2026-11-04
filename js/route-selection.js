/* =========================================================
   Route file input (GPX / KML)

   Identity of a route  = file name  (item.dataset.route, result.id)
   Display name         = result.route (taken from inside the file,
                          editable by the user, always unique)
   ========================================================= */

function initializeRouteSelection() {

    const input = document.getElementById("gpx-file-input");

    if (input) {
        input.addEventListener("change", handleGpxFiles);
    }

    document
        .querySelectorAll(".default-route")
        .forEach(checkbox => {
            checkbox.addEventListener("change", handleDefaultRouteChange);
        });

    const downloadAll = document.getElementById("download-all-routes");

    if (downloadAll) {
        downloadAll.addEventListener("click", downloadAllRoutes);
    }

}


/* =========================================================
   User files
   ========================================================= */

async function handleGpxFiles(event) {

    const files = Array.from(event.target.files);

    for (const file of files) {

        if (!isRouteFile(file.name)) {
            continue;
        }

        await addGpxFile(file);

    }

    event.target.value = "";

}


/* =========================================================
   Unique display names
   ========================================================= */

function makeUniqueRouteTitle(title, id) {

    const base = String(title || "").trim() || "مسیر";

    const taken = new Set(
        analysisResults
            .filter(result => result.id !== id)
            .map(result => result.route)
    );

    if (!taken.has(base)) {
        return base;
    }

    let n = 2;

    while (taken.has(`${base} (${n})`)) {
        n++;
    }

    return `${base} (${n})`;

}


function findSelectedRouteItem(id) {

    return Array.from(
        document.querySelectorAll(".selected-route")
    ).find(
        element => element.dataset.route === id
    );

}


function setSelectedRouteTitle(id, title) {

    const item = findSelectedRouteItem(id);

    if (!item) {
        return;
    }

    const nameElement = item.querySelector(".selected-route-name");

    if (nameElement) {
        nameElement.textContent = title;
    }

}


/* =========================================================
   Add route file

   options.title : forced display name (default routes, restored
                   routes). Otherwise the name inside the file is
                   used, then the file name.
   ========================================================= */

async function addGpxFile(file, options = {}) {

    if (!file || !file.name || !isRouteFile(file.name)) {
        return;
    }

    const alreadyExists =
        selectedFiles.some(
            existingFile => existingFile.name === file.name
        );

    if (alreadyExists) {
        return;
    }

    selectedFiles.push(file);

    // temporary name while the file is being read
    addSelectedRoute(file, options.title || routeBaseName(file.name));

    try {

        const route = await loadRouteFile(file);

        const title = makeUniqueRouteTitle(
            options.title || route.title || routeBaseName(file.name),
            file.name
        );

        const result = analyzeRoute(route, title);

        result.id = file.name;
        result.routeData = route;

        analysisResults.push(result);

        setSelectedRouteTitle(file.name, title);

        saveRouteToStorage(file, title);

        // while saved routes are being restored one redraw at the end is enough
        if (!isRestoringRoutes) {
            redrawAllCharts();
        }

    } catch (error) {

        console.error("Route analysis error:", error);

        selectedFiles =
            selectedFiles.filter(
                existingFile => existingFile !== file
            );

        const item = findSelectedRouteItem(file.name);

        if (item) {
            item.remove();
        }

        const failedRouteName = routeBaseName(file.name);

        const failedCheckbox =
            Array.from(
                document.querySelectorAll(".default-route")
            ).find(
                checkbox => checkbox.dataset.name === failedRouteName
            );

        if (failedCheckbox) {
            failedCheckbox.checked = false;
        }

        updateRouteNumbers();

        redrawAllCharts();

    }

}


/* =========================================================
   Default routes
   ========================================================= */

async function handleDefaultRouteChange() {

    if (!this.checked) {

        removeSelectedRoute(this.dataset.name + ".gpx");

        return;

    }

    try {

        const response =
            await fetch(
                encodeURI(this.dataset.file),
                { cache: "no-cache" }
            );

        if (!response.ok) {
            throw new Error(`Cannot load GPX: ${this.dataset.file}`);
        }

        const blob = await response.blob();

        const file =
            new File(
                [blob],
                this.dataset.name + ".gpx",
                { type: "application/gpx+xml" }
            );

        // default routes keep their own (clean) names
        await addGpxFile(file, { title: this.dataset.name });

    } catch (error) {

        console.error("Default GPX loading error:", error);

        this.checked = false;

    }

}


/* =========================================================
   Selected routes UI
   ========================================================= */

function addSelectedRoute(file, title) {

    const container = document.getElementById("selected-routes");

    const emptyMessage = container.querySelector(".empty-message");

    if (emptyMessage) {
        emptyMessage.remove();
    }

    const item = document.createElement("div");

    item.className = "selected-route";
    item.draggable = true;
    item.file = file;
    item.dataset.route = file.name;

    item.innerHTML = `

        <span class="drag-handle">☰</span>

        <span class="route-number"></span>

        <span class="selected-route-name"></span>

        <button type="button" class="route-action route-rename"
                title="ویرایش نام" aria-label="ویرایش نام">✎</button>

        <button type="button" class="route-action route-download"
                title="دانلود فایل با نام جدید" aria-label="دانلود فایل">⬇</button>

        <button type="button" class="remove-route" title="حذف مسیر">×</button>

    `;

    const nameElement = item.querySelector(".selected-route-name");

    nameElement.textContent = title;
    nameElement.title = "فایل: " + file.name + " — برای ویرایش دوبار کلیک کنید";

    nameElement.addEventListener(
        "dblclick",
        () => startRenameRoute(item)
    );

    item.querySelector(".route-rename").addEventListener(
        "click",
        event => {
            event.stopPropagation();
            startRenameRoute(item);
        }
    );

    item.querySelector(".route-download").addEventListener(
        "click",
        event => {
            event.stopPropagation();
            downloadRoute(file.name);
        }
    );

    item.querySelector(".remove-route").addEventListener(
        "click",
        event => {
            event.stopPropagation();
            removeSelectedRoute(file.name);
        }
    );

    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("drop", handleDrop);
    item.addEventListener("dragend", handleDragEnd);

    container.appendChild(item);

    updateRouteNumbers();

}


function escapeHtml(value) {

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}


/* =========================================================
   Rename
   ========================================================= */

function startRenameRoute(item) {

    if (item.classList.contains("editing")) {
        return;
    }

    const id = item.dataset.route;

    const result = analysisResults.find(r => r.id === id);

    // still loading
    if (!result) {
        return;
    }

    const nameElement = item.querySelector(".selected-route-name");

    const oldTitle = result.route;

    const input = document.createElement("input");

    input.type = "text";
    input.className = "route-rename-input";
    input.value = oldTitle;
    input.maxLength = 120;
    input.setAttribute("aria-label", "نام مسیر");

    item.classList.add("editing");
    item.draggable = false;          // otherwise text can't be selected

    nameElement.hidden = true;
    nameElement.after(input);

    let finished = false;

    function finish(save) {

        if (finished) {
            return;
        }

        finished = true;

        const value = input.value.trim();

        input.remove();
        nameElement.hidden = false;

        item.classList.remove("editing");
        item.draggable = true;

        if (save && value && value !== oldTitle) {
            renameRoute(id, value);
        }

    }

    input.addEventListener("keydown", event => {

        if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();     // do not close the route sheet
            finish(false);
        }

    });

    input.addEventListener("blur", () => finish(true));

    input.focus();
    input.select();

}


function renameRoute(id, newTitle) {

    const result = analysisResults.find(r => r.id === id);

    if (!result) {
        return;
    }

    const oldTitle = result.route;

    const title = makeUniqueRouteTitle(newTitle, id);

    setSelectedRouteTitle(id, title);

    if (title === oldTitle) {
        return;
    }

    result.route = title;

    if (result.metrics) {
        result.metrics.route = title;
    }

    if (result.difficulty) {
        result.difficulty.route = title;
    }

    // cached values that contain the route name
    delete result._uphillSlopeData;
    delete result._waypointProfilePoints;

    if (
        typeof selectedWeatherRouteFilter !== "undefined" &&
        selectedWeatherRouteFilter === oldTitle
    ) {
        selectedWeatherRouteFilter = title;
    }

    if (typeof saveRouteTitleToStorage === "function") {
        saveRouteTitleToStorage(id, title);
    }

    redrawAllCharts();

}


/* =========================================================
   Download (file with the new name written inside)
   ========================================================= */

async function downloadRoute(id) {

    const file = selectedFiles.find(f => f.name === id);

    if (!file) {
        return;
    }

    const result = analysisResults.find(r => r.id === id);

    const title = result ? result.route : routeBaseName(file.name);

    try {

        await downloadRouteFile(file, title);

    } catch (error) {

        console.error("Download error:", error);

        alert("ساخت فایل برای دانلود ممکن نشد.");

    }

}


async function downloadAllRoutes() {

    const ids = Array.from(
        document.querySelectorAll(".selected-route")
    ).map(item => item.dataset.route);

    for (const id of ids) {

        await downloadRoute(id);

        // browsers block several downloads fired at the same moment
        await new Promise(resolve => setTimeout(resolve, 400));

    }

}


/* =========================================================
   Remove route
   ========================================================= */

function removeSelectedRoute(route) {

    deleteRouteFromStorage(route);

    selectedFiles =
        selectedFiles.filter(file => file.name !== route);

    const routeName = routeBaseName(route);

    analysisResults =
        analysisResults.filter(result => result.id !== route);

    const defaultCheckbox =
        Array.from(
            document.querySelectorAll(".default-route")
        ).find(
            checkbox => checkbox.dataset.name === routeName
        );

    if (defaultCheckbox) {
        defaultCheckbox.checked = false;
    }

    const item = findSelectedRouteItem(route);

    if (item) {
        item.remove();
    }

    const container = document.getElementById("selected-routes");

    if (container.querySelectorAll(".selected-route").length === 0) {

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


function updateRouteNumbers() {

    const items = document.querySelectorAll(".selected-route");

    items.forEach(
        (item, index) => {

            const number = item.querySelector(".route-number");

            if (number) {
                number.textContent = index + 1;
            }

        }
    );

    const downloadAll = document.getElementById("download-all-routes");

    if (downloadAll) {
        downloadAll.hidden = items.length === 0;
    }

}


/* =========================================================
   Drag & Drop
   ========================================================= */

function handleDragStart(event) {

    draggedItem = event.currentTarget;

    event.currentTarget.style.opacity = "0.5";

}


function handleDragOver(event) {

    event.preventDefault();

    const target = event.currentTarget;

    if (!draggedItem || target === draggedItem) {
        return;
    }

    const container = document.getElementById("selected-routes");

    const items =
        Array.from(container.querySelectorAll(".selected-route"));

    const draggedIndex = items.indexOf(draggedItem);
    const targetIndex = items.indexOf(target);

    if (draggedIndex < targetIndex) {
        container.insertBefore(draggedItem, target.nextSibling);
    } else {
        container.insertBefore(draggedItem, target);
    }

    updateRouteNumbers();

}


function handleDrop(event) {

    event.preventDefault();

}


function handleDragEnd(event) {

    event.currentTarget.style.opacity = "1";

    draggedItem = null;

    updateRouteNumbers();

    syncAnalysisOrder();

}


/* =========================================================
   Synchronize analysis order
   ========================================================= */

function syncAnalysisOrder() {

    saveRouteOrder();

    const orderedIds =
        Array.from(
            document.querySelectorAll(".selected-route")
        ).map(item => item.dataset.route);

    analysisResults.sort(
        (a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id)
    );

    redrawAllCharts();

}
