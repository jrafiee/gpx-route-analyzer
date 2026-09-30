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

    const actions = document.querySelector(".page-header-actions");
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

async function saveRouteToStorage(file) {
    if (isRestoringRoutes) return;
    try {
        const db = await openRouteDb();
        const tx = db.transaction(ROUTE_STORE, "readwrite");
        tx.objectStore(ROUTE_STORE).put({
            name: file.name,
            blob: file,
            order: currentRouteOrder().indexOf(file.name)
        });
        await idbDone(tx);
        db.close();
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) { console.warn("Save route failed:", e); }
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
    try {
        const order = currentRouteOrder();
        const db = await openRouteDb();
        const tx = db.transaction(ROUTE_STORE, "readwrite");
        const store = tx.objectStore(ROUTE_STORE);
        store.getAll().onsuccess = e => {
            e.target.result.forEach(rec => {
                rec.order = order.indexOf(rec.name);
                store.put(rec);
            });
        };
        await idbDone(tx);
        db.close();
    } catch (e) { console.warn("Save order failed:", e); }
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

        records.sort((a, b) => a.order - b.order);

        isRestoringRoutes = true;
        for (const rec of records) {
            const file = new File([rec.blob], rec.name, { type: "application/gpx+xml" });
            const baseName = rec.name.replace(/\.gpx$/i, "");
            const cb = Array.from(document.querySelectorAll(".default-route"))
                .find(c => c.dataset.name === baseName);
            if (cb) cb.checked = true;
            await addGpxFile(file);
        }
    } catch (e) {
        console.warn("Restore routes failed:", e);
    } finally {
        isRestoringRoutes = false;
    }
}
