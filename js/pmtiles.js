/* =========================================================
   Minimal PMTiles v3 reader (HTTP Range) - used by offline-region.js

   - reads the header + directories (root and leaf, cached)
   - finds the byte range of each wanted tile (z/x/y)
   - merges neighbouring tiles into a few big Range requests
   - supports internal/tile compression: none or gzip
   Load BEFORE offline-region.js.
   ========================================================= */

(function () {

    "use strict";

    const HEADER_FETCH = 16384;          // header (127 B) + root directory
    const MAX_GAP = 32 * 1024;           // merge tiles closer than this
    const MAX_RANGE = 4 * 1024 * 1024;   // largest single Range request

    const MIME = {
        1: "application/x-protobuf",
        2: "image/png",
        3: "image/jpeg",
        4: "image/webp",
        5: "image/avif"
    };

    /* Hilbert curve tile id */
    function tileIdOf(z, x, y) {

        let acc = (Math.pow(4, z) - 1) / 3;

        const n = Math.pow(2, z);

        let xx = x;
        let yy = y;
        let d = 0;

        for (let s = n / 2; s >= 1; s = s / 2) {

            const rx = (xx & s) > 0 ? 1 : 0;
            const ry = (yy & s) > 0 ? 1 : 0;

            d += s * s * ((3 * rx) ^ ry);

            if (ry === 0) {

                if (rx === 1) {
                    xx = s - 1 - xx;
                    yy = s - 1 - yy;
                }

                const t = xx;
                xx = yy;
                yy = t;
            }
        }

        return acc + d;
    }

    async function gunzip(buffer) {

        const stream = new Blob([buffer]).stream()
            .pipeThrough(new DecompressionStream("gzip"));

        return new Response(stream).arrayBuffer();
    }

    function decodeDirectory(buffer) {

        const bytes = new Uint8Array(buffer);

        let p = 0;

        function varint() {

            let value = 0;
            let mult = 1;

            for (;;) {

                const c = bytes[p++];

                value += (c & 127) * mult;

                if (c < 128) {
                    return value;
                }

                mult *= 128;
            }
        }

        const n = varint();

        const entries = new Array(n);

        let id = 0;

        for (let i = 0; i < n; i++) {
            id += varint();
            entries[i] = { tileId: id, offset: 0, length: 0, runLength: 0 };
        }

        for (let i = 0; i < n; i++) { entries[i].runLength = varint(); }
        for (let i = 0; i < n; i++) { entries[i].length = varint(); }

        for (let i = 0; i < n; i++) {

            const o = varint();

            entries[i].offset = (o === 0 && i > 0)
                ? entries[i - 1].offset + entries[i - 1].length
                : o - 1;
        }

        return entries;
    }

    function findEntry(entries, tileId) {

        let m = 0;
        let n = entries.length - 1;

        while (m <= n) {

            const k = (n + m) >> 1;
            const c = tileId - entries[k].tileId;

            if (c > 0) {
                m = k + 1;
            } else if (c < 0) {
                n = k - 1;
            } else {
                return entries[k];
            }
        }

        if (n >= 0) {

            if (entries[n].runLength === 0) {
                return entries[n];                       // leaf directory
            }

            if (tileId - entries[n].tileId < entries[n].runLength) {
                return entries[n];                       // run of equal tiles
            }
        }

        return null;
    }


    class PMTilesArchive {

        constructor(url) {
            this.url = url;
            this.dirs = new Map();
            this.header = null;
            this.root = null;
            this.contentType = "application/octet-stream";
        }

        async fetchRange(offset, length) {

            const response = await fetch(this.url, {
                headers: { Range: `bytes=${offset}-${offset + length - 1}` },
                mode: "cors",
                credentials: "omit"
            });

            if (response.status !== 206) {
                throw new Error("Range request not supported (HTTP " + response.status + ")");
            }

            return response.arrayBuffer();
        }

        async plain(buffer) {
            return this.header.internal === 2 ? gunzip(buffer) : buffer;
        }

        async open() {

            const buffer = await this.fetchRange(0, HEADER_FETCH);

            const view = new DataView(buffer);

            const magic = new TextDecoder().decode(buffer.slice(0, 7));

            if (magic !== "PMTiles" || view.getUint8(7) !== 3) {
                throw new Error("Not a PMTiles v3 file");
            }

            const u64 = o => Number(view.getBigUint64(o, true));

            const h = {
                rootOffset: u64(8),
                rootLength: u64(16),
                leafOffset: u64(40),
                dataOffset: u64(56),
                internal: view.getUint8(97),
                tileComp: view.getUint8(98),
                type: view.getUint8(99),
                minZoom: view.getUint8(100),
                maxZoom: view.getUint8(101)
            };

            if (![1, 2].includes(h.internal) || ![1, 2].includes(h.tileComp)) {
                throw new Error("Unsupported PMTiles compression");
            }

            this.header = h;
            this.contentType = MIME[h.type] || this.contentType;

            const end = h.rootOffset + h.rootLength;

            const rootBuffer = end <= buffer.byteLength
                ? buffer.slice(h.rootOffset, end)
                : await this.fetchRange(h.rootOffset, h.rootLength);

            this.root = decodeDirectory(await this.plain(rootBuffer));
        }

        getDirectory(offset, length) {

            let promise = this.dirs.get(offset);

            if (!promise) {

                promise = this.fetchRange(this.header.leafOffset + offset, length)
                    .then(buffer => this.plain(buffer))
                    .then(decodeDirectory);

                this.dirs.set(offset, promise);
            }

            return promise;
        }

        /* -> { offset, length } (absolute, in the file) or null */
        async locate(z, x, y) {

            const h = this.header;

            if (z < h.minZoom || z > h.maxZoom) {
                return null;
            }

            const id = tileIdOf(z, x, y);

            let dir = this.root;

            for (let depth = 0; depth < 4; depth++) {

                const entry = findEntry(dir, id);

                if (!entry) {
                    return null;
                }

                if (entry.runLength > 0) {
                    return { offset: h.dataOffset + entry.offset, length: entry.length };
                }

                dir = await this.getDirectory(entry.offset, entry.length);
            }

            return null;
        }

        /* tasks: [{ z, x, y, ... }] -> { found: [{task, offset, length}], missing: [task] } */
        async locateAll(tasks) {

            const found = [];
            const missing = [];

            const BATCH = 200;

            for (let i = 0; i < tasks.length; i += BATCH) {

                const slice = tasks.slice(i, i + BATCH);

                const results = await Promise.all(
                    slice.map(task => this.locate(task.z, task.x, task.y))
                );

                results.forEach((location, k) => {
                    if (location) {
                        found.push({ task: slice[k], offset: location.offset, length: location.length });
                    } else {
                        missing.push(slice[k]);
                    }
                });
            }

            return { found, missing };
        }

        /* neighbouring tiles -> [{ start, end, items }] (few big ranges) */
        planRanges(found) {

            found.sort((a, b) => a.offset - b.offset);

            const ranges = [];

            let current = null;

            found.forEach(item => {

                const end = item.offset + item.length;

                if (
                    current &&
                    item.offset - current.end <= MAX_GAP &&
                    end - current.start <= MAX_RANGE
                ) {
                    current.end = Math.max(current.end, end);
                    current.items.push(item);
                } else {
                    current = { start: item.offset, end, items: [item] };
                    ranges.push(current);
                }
            });

            return ranges;
        }

        /* body of one tile cut out of a fetched range */
        async tileBody(buffer, range, item) {

            const from = item.offset - range.start;

            const slice = buffer.slice(from, from + item.length);

            if (slice.byteLength !== item.length) {
                throw new Error("Short PMTiles range");
            }

            return this.header.tileComp === 2 ? gunzip(slice) : slice;
        }
    }

    window.PMTilesArchive = PMTilesArchive;

})();
