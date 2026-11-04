/* =========================================================
   PWA + ذخیره مسیرها در IndexedDB
   ========================================================= */

/* ---------- Service worker ---------- */
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(e =>
            console.warn("SW registration failed:", e));
    });
}

/* ---------- دکمه نصب ---------- */
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;

    const actions = document.querySelector(".header-install-slot, .page-header-actions");
    if (!actions || document.getElementById("install-button")) return;

    const btn = document.createElement("button");
    btn.id = "install-button";
    btn.type = "button";
    btn.className = "calculations-link";
    btn.innerHTML = "📲 <span>نصب برنامه</span>";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        btn.remove();
    });
    actions.prepend(btn);
});

window.addEventListener("appinstalled", () => {
    const btn = document.getElementById("install-button");
    if (btn) btn.remove();
});

/* ---------- IndexedDB ---------- */
const ROUTE_DB_NAME = "mountain-route-compare";
const ROUTE_STORE = "routes";
let isRestoringRoutes = false;

function openRouteDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(ROUTE_DB_NAME, 1);
        req.onupgradeneeded = () =>
            req.result.createObjectStore(ROUTE_STORE, { keyPath: "name" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function idbDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
    });
}

function currentRouteOrder() {
    return Array.from(document.querySelectorAll(".selected-route"))
        .map(el => el.dataset.route);
}

/*
 * The order of the routes is a tiny list, so it lives in
 * localStorage. Re-ordering used to read and re-write every saved
 * GPX file in IndexedDB.
 */
const ROUTE_ORDER_KEY = "route-order";

function writeRouteOrderLocal() {
    try {
        localStorage.setItem(ROUTE_ORDER_KEY, JSON.stringify(currentRouteOrder()));
    } catch (e) { /* ignore */ }
}

function readRouteOrderLocal() {
    try {
        const value = JSON.parse(localStorage.getItem(ROUTE_ORDER_KEY));
        return Array.isArray(value) ? value : [];
    } catch (e) {
        return [];
    }
}

/*
 * Record: { name (file name = key), blob, order, title (display name) }
 */
async function saveRouteToStorage(file, title) {
    if (isRestoringRoutes) return;
    try {
        const db = await openRouteDb();
        const tx = db.transaction(ROUTE_STORE, "readwrite");
        tx.objectStore(ROUTE_STORE).put({
            name: file.name,
            blob: file,
            title: title || "",
            order: currentRouteOrder().indexOf(file.name)
        });
        await idbDone(tx);
        db.close();
        writeRouteOrderLocal();
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) { console.warn("Save route failed:", e); }
}

/* the user renamed a route: update only the title of the record */
async function saveRouteTitleToStorage(name, title) {
    if (isRestoringRoutes) return;
    try {
        const db = await openRouteDb();
        const tx = db.transaction(ROUTE_STORE, "readwrite");
        const store = tx.objectStore(ROUTE_STORE);
        const req = store.get(name);
        req.onsuccess = () => {
            const record = req.result;
            if (record) {
                record.title = title;
                store.put(record);
            }
        };
        await idbDone(tx);
        db.close();
    } catch (e) { console.warn("Save title failed:", e); }
}

async function deleteRouteFromStorage(name) {
    if (isRestoringRoutes) return;
    try {
        const db = await openRouteDb();
        const tx = db.transaction(ROUTE_STORE, "readwrite");
        tx.objectStore(ROUTE_STORE).delete(name);
        await idbDone(tx);
        db.close();
    } catch (e) { console.warn("Delete route failed:", e); }
}

async function saveRouteOrder() {
    if (isRestoringRoutes) return;
    writeRouteOrderLocal();
}

async function restoreSavedRoutes() {
    try {
        const db = await openRouteDb();
        const records = await new Promise((resolve, reject) => {
            const req = db.transaction(ROUTE_STORE).objectStore(ROUTE_STORE).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        db.close();

        // new order list first, old per-record "order" as fallback
        const saved = readRouteOrderLocal();
        const rank = rec => {
            const index = saved.indexOf(rec.name);
            return index >= 0
                ? index
                : saved.length + 1 + (Number.isFinite(rec.order) ? rec.order : 0);
        };

        records.sort((a, b) => rank(a) - rank(b));

        isRestoringRoutes = true;
        for (const rec of records) {
            const isKml = getRouteFileExtension(rec.name) === "kml";
            const file = new File([rec.blob], rec.name, {
                type: isKml ? "application/vnd.google-earth.kml+xml" : "application/gpx+xml"
            });
            const baseName = routeBaseName(rec.name);
            const cb = Array.from(document.querySelectorAll(".default-route"))
                .find(c => c.dataset.name === baseName);
            if (cb) cb.checked = true;

            // saved title first; records from older versions: default
            // routes keep their name, other files use the name inside the file
            await addGpxFile(file, {
                title: rec.title || (cb ? baseName : undefined)
            });
        }
    } catch (e) {
        console.warn("Restore routes failed:", e);
    } finally {
        isRestoringRoutes = false;
    }

    // single redraw for all restored routes
    if (analysisResults.length > 0) {
        redrawAllCharts();
    }
}
