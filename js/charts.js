/* =========================================================
   Mountain Route Compare — Charts

   Design language (matches the "calculations" page):
     - one colour theme: blue #4d8bc9 / #315f8c + a single amber
       accent #f2a03d + neutral slate
     - technical look: thin axes with ticks, dotted horizontal
       grid, monospace numerals, sharp bar corners, formula
       captions under the bar charts
     - line charts keep the route colours of the numbered
       map markers
     - hover tooltips styled as small cards

   Combined elevation chart ("تحلیل و مقایسه مسیر")

   Mode:
     "elevation" -> elevation profile
     "gain"      -> aligned by start elevation (gain relative to start)
     "summit"    -> aligned by summit elevation (all summit tips at y = 0)
     "ordered"   -> routes placed one after another (cumulative distance)

   Options:
     summitCenter : summit distance = 0 on the x axis

   GPX waypoints (camps, springs, ...) are drawn as diamonds on
   the line charts; hovering them shows their name / description.
   ========================================================= */

const elevationChartState = {
    mode: "elevation",
    summitCenter: false
};


/* =========================================================
   Shared style helpers
   ========================================================= */

/*
 * Same colors (and same order) as the numbered route
 * markers on the 2D / 3D maps. Used by the line charts only.
 */

const CHART_ROUTE_COLORS = ROUTE_COLORS;

/*
 * Slope categories: light blue (easy) -> deep blue (steep),
 * and the one amber accent for the extreme category.
 */

const CHART_SLOPE_COLORS = [
    "#d5e5f4",   // خیلی آسان
    "#a9c8e8",   // آسان
    "#7aa9d8",   // متوسط
    "#4d8bc9",   // شیب‌دار
    "#2f6aa3",   // خیلی شیب‌دار
    "#f2a03d"    // بسیار شدید
];

const CHART_SERIES_COLORS = {
    estimated: "#4d8bc9",
    actual: "#f2a03d",
    total: "#a3b3c4",
    gain: "#4d8bc9",
    maxElevation: "#f2a03d"
};

const CHART_DIFFICULTY_COLORSCALE = [
    [0, "#a9c8e8"],
    [0.5, "#4d8bc9"],
    [1, "#22456b"]
];

const CHART_FONT_SANS =
    "Tahoma, Arial, sans-serif";

const CHART_FONT_MONO =
    "Consolas, 'Courier New', monospace";


function chartRouteColor(index) {
    return CHART_ROUTE_COLORS[
        index % CHART_ROUTE_COLORS.length
    ];
}


function hexToRgba(hex, alpha) {

    const value =
        hex.replace("#", "");

    const r = parseInt(value.substring(0, 2), 16);
    const g = parseInt(value.substring(2, 4), 16);
    const b = parseInt(value.substring(4, 6), 16);

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;

}


function getChartPalette() {

    const base =
        getPlotTheme();

    const dark =
        document.body.classList.contains("dark-mode");

    return {

        ...base,

        dark: dark,

        muted:
            dark ? "#9aa1a8" : "#68707a",

        grid:
            dark
                ? "rgba(255, 255, 255, 0.09)"
                : "rgba(32, 36, 42, 0.09)",

        axisLine:
            dark
                ? "rgba(255, 255, 255, 0.28)"
                : "rgba(32, 36, 42, 0.30)",

        hoverBg:
            dark ? "#2b2e30" : "#ffffff",

        hoverBorder:
            dark ? "#484b4d" : "#dfe4ea",

        /* colour of the card behind the chart */
        surface:
            dark ? "#202324" : "#ffffff",

        accent: "#4d8bc9"

    };

}


function getChartConfig(interactive) {

    return {

        responsive: true,

        displaylogo: false,

        displayModeBar:
            interactive ? "hover" : false,

        modeBarButtonsToRemove: [
            "lasso2d",
            "select2d",
            "autoScale2d",
            "toggleSpikelines"
        ]

    };

}


/*
 * [min, max] with a little padding for a list of numbers.
 */

function paddedRange(min, max, padFraction) {

    if (
        !Number.isFinite(min) ||
        !Number.isFinite(max)
    ) {
        return null;
    }

    const span =
        (max - min) || 1;

    return [
        min - span * padFraction,
        max + span * padFraction
    ];

}


function getArrayMinMax(values) {

    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < values.length; i++) {

        const v = values[i];

        if (!Number.isFinite(v)) {
            continue;
        }

        if (v < min) {
            min = v;
        }

        if (v > max) {
            max = v;
        }

    }

    return { min, max };

}


function getSummitIndex(values) {

    let summitIndex = 0;

    for (let i = 1; i < values.length; i++) {
        if (values[i] > values[summitIndex]) {
            summitIndex = i;
        }
    }

    return summitIndex;

}


/* =========================================================
   GPX waypoints on the profile charts
   ========================================================= */

function chartEscapeText(value) {

    return String(value).replace(
        /[<>&]/g,
        character => ({
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;"
        })[character]
    );

}


/*
 * Wrap long text into lines (Plotly does not wrap hover text).
 * Returns an array of plain-text lines.
 */

function chartWrapText(text, maxChars) {

    const lines = [];

    String(text)
        .split(/\r?\n/)
        .forEach(paragraph => {

            const words =
                paragraph.split(/\s+/).filter(Boolean);

            let line = "";

            words.forEach(word => {

                if (
                    line &&
                    (line + " " + word).length > maxChars
                ) {
                    lines.push(line);
                    line = word;
                } else {
                    line = line ? line + " " + word : word;
                }

            });

            if (line) {
                lines.push(line);
            }

        });

    return lines;

}


/*
 * Snap the waypoints of one route to the elevation profile.
 *
 * The profile skips points with zero horizontal distance
 * (see extractRouteProfile), so the same rule is repeated here
 * to keep the indexes aligned with profile.distance_km.
 *
 * Result (cached on the analysis result):
 *   [{ index, offsetM, html }]
 */

function getRouteWaypointProfilePoints(
    result,
    maxOffsetM = 1000
) {

    if (result._waypointProfilePoints) {
        return result._waypointProfilePoints;
    }

    const list = [];

    result._waypointProfilePoints = list;

    const route =
        result.routeData;

    const waypoints =
        route && route.waypoints;

    const points =
        route && route.points;

    if (
        !Array.isArray(waypoints) ||
        waypoints.length === 0 ||
        !Array.isArray(points) ||
        points.length < 2
    ) {
        return list;
    }

    const keptIndexes = [0];

    for (let i = 0; i < points.length - 1; i++) {

        const d =
            distance2D(points[i], points[i + 1]);

        if (d === null || d <= 0) {
            continue;
        }

        keptIndexes.push(i + 1);

    }

    const profile =
        result.profiles?.elevation;

    const distancesKm =
        profile?.distance_km;

    const elevations =
        profile?.elevation_m;

    if (
        !distancesKm ||
        !elevations ||
        distancesKm.length !== keptIndexes.length
    ) {
        return list;
    }

    waypoints.forEach(waypoint => {

        let bestIndex = -1;
        let bestDistance = Infinity;

        for (let k = 0; k < keptIndexes.length; k++) {

            const d =
                distance2D(
                    waypoint,
                    points[keptIndexes[k]]
                );

            if (d !== null && d < bestDistance) {
                bestDistance = d;
                bestIndex = k;
            }

        }

        if (
            bestIndex < 0 ||
            bestDistance > maxOffsetM
        ) {
            return;
        }

        const name =
            waypoint.name || "نقطه راهنما";

        const label =
            waypoint.type || waypoint.symbol || "";

        const elevation =
            Number.isFinite(waypoint.elevation)
                ? waypoint.elevation
                : elevations[bestIndex];

        const parts = [
            `<b>${chartEscapeText(name)}</b>`
        ];

        if (label) {
            parts.push(chartEscapeText(label));
        }

        if (waypoint.description) {

            chartWrapText(
                waypoint.description.substring(0, 300),
                40
            ).forEach(line => {
                parts.push(chartEscapeText(line));
            });

        }

        parts.push(
            `ارتفاع: ${Math.round(elevation)} m` +
            ` · مسافت: ${distancesKm[bestIndex].toFixed(2)} km`
        );

        list.push({
            index: bestIndex,
            offsetM: bestDistance,
            html: parts.join("<br>")
        });

    });

    list.sort((a, b) => a.index - b.index);

    return list;

}


/*
 * Diamond markers for the waypoints of a route.
 * x / y are the (already shifted) coordinates of the route line.
 */

function buildWaypointTrace(result, color, x, y) {

    const waypoints =
        getRouteWaypointProfilePoints(result);

    const palette =
        getChartPalette();

    const xs = [];
    const ys = [];
    const info = [];

    waypoints.forEach(waypoint => {

        if (waypoint.index >= x.length) {
            return;
        }

        xs.push(x[waypoint.index]);
        ys.push(y[waypoint.index]);
        info.push(waypoint.html);

    });

    if (xs.length === 0) {
        return null;
    }

    return {

        x: xs,
        y: ys,

        type: "scatter",
        mode: "markers",

        name: result.route,
        legendgroup: result.route,
        showlegend: false,

        customdata: info,

        hovertemplate:
            "%{customdata}<extra>" +
            chartEscapeText(result.route || "") +
            "</extra>",

        marker: {
            symbol: "diamond",
            size: 11,
            color: color,
            line: {
                color: palette.surface,
                width: 1.8
            }
        }

    };

}


/* =========================================================
   Elevation chart state / controls
   ========================================================= */

function setElevationChartMode(mode) {
    elevationChartState.mode = mode;
    redrawElevationChart();
}


function setSummitCenter(checked) {
    elevationChartState.summitCenter = !!checked;
    redrawElevationChart();
}


function redrawElevationChart() {

    if (
        typeof analysisResults !== "undefined" &&
        analysisResults.length > 0
    ) {
        drawElevationProfile(analysisResults);
    } else {
        syncElevationChartControls();
    }

}


function syncElevationChartControls() {

    const state = elevationChartState;

    const elevationButton =
        document.getElementById("chart-mode-elevation");

    const gainButton =
        document.getElementById("chart-mode-gain");

    if (elevationButton) {
        elevationButton.classList.toggle(
            "active",
            state.mode === "elevation"
        );
    }

    if (gainButton) {
        gainButton.classList.toggle(
            "active",
            state.mode === "gain"
        );
    }

    const summitButton =
        document.getElementById("chart-mode-summit");

    if (summitButton) {
        summitButton.classList.toggle(
            "active",
            state.mode === "summit"
        );
    }

    const orderedButton =
        document.getElementById("chart-mode-ordered");

    if (orderedButton) {
        orderedButton.classList.toggle(
            "active",
            state.mode === "ordered"
        );
    }

    const centerInput =
        document.getElementById("option-summit-center");

    if (centerInput) {
        centerInput.checked = state.summitCenter;

        // "Summit at center" is meaningless in the ordered mode
        const isOrdered = state.mode === "ordered";

        centerInput.disabled = isOrdered;

        const centerLabel = centerInput.closest(".chart-option");

        if (centerLabel) {
            centerLabel.classList.toggle("disabled", isOrdered);
        }
    }

}


/*
 * Distance (km) of the highest point of the route.
 */

function getSummitDistanceKm(distances, elevations) {

    if (
        !Array.isArray(distances) ||
        !Array.isArray(elevations) ||
        elevations.length === 0
    ) {
        return 0;
    }

    return distances[getSummitIndex(elevations)] || 0;

}


/*
 * Reference lines through the summit (x = 0 and/or y = 0).
 */

function addSummitReferenceLines(layout, vertical, horizontal) {

    const palette = getChartPalette();

    const lineStyle = {
        color: palette.muted,
        width: 1.2,
        dash: "dot"
    };

    layout.shapes = [
        ...(layout.shapes || [])
    ];

    if (vertical) {
        layout.shapes.push({
            type: "line",
            xref: "x",
            yref: "paper",
            x0: 0,
            x1: 0,
            y0: 0,
            y1: 1,
            line: lineStyle
        });
    }

    if (horizontal) {
        layout.shapes.push({
            type: "line",
            xref: "paper",
            yref: "y",
            x0: 0,
            x1: 1,
            y0: 0,
            y1: 0,
            line: lineStyle
        });
    }

    layout.xaxis = {
        ...layout.xaxis,
        zeroline: false
    };

    layout.yaxis = {
        ...layout.yaxis,
        zeroline: false
    };

}


/* =========================================================
   Legend / layout
   ========================================================= */

/*
 * Horizontal legend above the plot area on every screen.
 */

function getResponsiveLegend() {

    const isMobile = window.innerWidth <= 900;

    return {

        orientation: "h",

        x: 0,
        xanchor: "left",

        y: 1,
        yanchor: "bottom",

        bgcolor: "rgba(0,0,0,0)",

        itemsizing: "constant",

        font: {
            size: isMobile ? 11 : 12
        }

    };

}


/*
 * Base layout shared by all charts.
 *
 * opts.legendItems : number of legend entries (reserves the
 *                    correct amount of room above the plot)
 * opts.perRow      : legend entries that fit in one row
 */

function buildPlotLayout(
    title,
    yTitle,
    xTitle = "",
    opts = {}
) {

    const palette = getChartPalette();

    const isMobile =
        window.innerWidth <= 900;

    const legendItems =
        opts.legendItems || 0;

    const perRow =
        opts.perRow ||
        (isMobile ? 2 : 5);

    const legendRows =
        legendItems > 0
            ? Math.ceil(legendItems / perRow)
            : 0;

    const topMargin =
        (title ? 44 : 26) +
        legendRows * 24;

    const layout = {

        paper_bgcolor:
            "rgba(0,0,0,0)",

        plot_bgcolor:
            "rgba(0,0,0,0)",

        font: {
            family: CHART_FONT_SANS,
            size: 12,
            color: palette.textColor
        },

        xaxis: {

            title: {
                text: xTitle,
                standoff: 12,
                font: {
                    size: 12,
                    color: palette.muted
                }
            },

            color: palette.textColor,

            showgrid: false,
            zeroline: false,

            showline: true,
            linecolor: palette.axisLine,
            linewidth: 1,

            ticks: "outside",
            ticklen: 4,
            tickcolor: palette.axisLine,

            tickfont: {
                family: CHART_FONT_MONO,
                size: 11,
                color: palette.muted
            },

            automargin: true

        },

        yaxis: {

            title: {
                text: yTitle,
                standoff: 10,
                font: {
                    size: 12,
                    color: palette.muted
                }
            },

            color: palette.textColor,

            showgrid: true,
            gridcolor: palette.grid,
            gridwidth: 1,
            griddash: "dot",

            zeroline: false,
            showline: false,

            ticks: "",

            tickfont: {
                family: CHART_FONT_MONO,
                size: 11,
                color: palette.muted
            },

            automargin: true

        },

        margin: {
            t: topMargin,
            r: isMobile ? 14 : 22,
            b: 52,
            l: isMobile ? 52 : 60
        },

        hovermode: "x unified",

        hoverdistance: 30,

        hoverlabel: {
            bgcolor: palette.hoverBg,
            bordercolor: palette.hoverBorder,
            font: {
                family: CHART_FONT_SANS,
                size: 12,
                color: palette.textColor
            }
        },

        legend: {
            ...getResponsiveLegend(),
            font: {
                size: isMobile ? 11 : 12,
                color: palette.textColor
            }
        },

        bargap: 0.4,
        bargroupgap: 0.06,

        /* sharp, technical bars (ignored by older Plotly builds) */
        barcornerradius: 2

    };

    if (title) {
        layout.title = {
            text: title,
            x: 0.01,
            xanchor: "left",
            font: {
                size: 14,
                color: palette.textColor
            }
        };
    }

    return layout;

}


/*
 * Category x axis (route names) — sans-serif labels,
 * no vertical ticks.
 */

function applyCategoryAxis(layout) {

    const palette = getChartPalette();

    layout.xaxis = {

        ...layout.xaxis,

        type: "category",

        ticks: "",

        tickfont: {
            family: CHART_FONT_SANS,
            size: 12,
            color: palette.textColor
        }

    };

}


/*
 * "Computational" look for the bar charts:
 *   - measured y axis (thin line + outside ticks)
 *   - a monospace formula caption under the chart
 *     (hidden on narrow screens where it would not fit)
 */

function applyTechnicalAxes(layout, formula) {

    const palette = getChartPalette();

    const isMobile =
        window.innerWidth <= 900;

    layout.yaxis = {

        ...layout.yaxis,

        showline: true,
        linecolor: palette.axisLine,
        linewidth: 1,

        ticks: "outside",
        ticklen: 4,
        tickcolor: palette.axisLine

    };

    layout.xaxis = {

        ...layout.xaxis,

        title: {
            text: isMobile ? "" : (formula || ""),
            standoff: 16,
            font: {
                family: CHART_FONT_MONO,
                size: 11,
                color: palette.muted
            }
        }

    };

}


/*
 * Keep bars slim: bar width is fixed as a fraction of one
 * category slot, and the axis always has room for at least
 * `minSlots` routes so one or two routes do not get fat bars.
 */

function applySlimBars(layout, routeCount, minSlots = 4) {

    layout.xaxis = {

        ...layout.xaxis,

        range: [
            -0.5,
            Math.max(routeCount, minSlots) - 0.5
        ]

    };

}


/*
 * Vertical guide following the cursor on line charts.
 */

function applySpikeLine(layout) {

    const palette = getChartPalette();

    layout.xaxis = {

        ...layout.xaxis,

        showspikes: true,
        spikemode: "across",
        spikesnap: "cursor",
        spikethickness: 1,
        spikedash: "dot",
        spikecolor: palette.muted

    };

}


const CHART_SLIM_BAR_WIDTH = 0.34;


// --------------------------------------------------
// پروفایل ارتفاعی
// --------------------------------------------------

function drawElevationProfile(
    results,
    containerId = "elevation-chart"
) {

    const state = elevationChartState;

    const isGain = state.mode === "gain";

    const isSummit = state.mode === "summit";

    syncElevationChartControls();

    if (state.mode === "ordered") {

        drawOrderedElevationProfile(results, containerId);

        return;

    }

    const palette = getChartPalette();

    /*
     * Soft area under each line is used only in the plain
     * elevation view, where "below the line" is real ground.
     */

    const useFill = !isGain && !isSummit;

    let yMin = Infinity;
    let yMax = -Infinity;

    const traces = [];

    results.forEach(
        (result, index) => {

            const color =
                chartRouteColor(index);

            const profile =
                isGain
                    ? result.profiles.elevation_gain
                    : result.profiles.elevation;

            const distances =
                profile.distance_km;

            const values =
                isGain
                    ? profile.elevation_gain_m
                    : profile.elevation_m;

            // Horizontal shift: summit distance -> 0
            const shiftX =
                state.summitCenter
                    ? getSummitDistanceKm(distances, values)
                    : 0;

            // Vertical shift: summit height -> 0
            let shiftY = 0;

            if (isSummit && values.length > 0) {
                shiftY = values.reduce(
                    (max, v) => v > max ? v : max,
                    -Infinity
                );
            }

            const x =
                distances.map(d => d - shiftX);

            const y =
                values.map(v => v - shiftY);

            const range =
                getArrayMinMax(y);

            yMin = Math.min(yMin, range.min);
            yMax = Math.max(yMax, range.max);

            const trace = {

                x: x,
                y: y,

                type: "scatter",
                mode: "lines",

                name: result.route,
                legendgroup: result.route,

                line: {
                    color: color,
                    width: 2.6,
                    shape: "linear"
                },

                hovertemplate:
                    "%{y:.0f} m<extra>%{fullData.name}</extra>"

            };

            if (useFill) {
                trace.fill = "tozeroy";
                trace.fillcolor =
                    hexToRgba(
                        color,
                        palette.dark ? 0.12 : 0.09
                    );
            }

            if (isSummit) {

                trace.customdata = values;

                trace.hovertemplate =
                    "%{y:.0f} m" +
                    " (ارتفاع واقعی: %{customdata:.0f} m)" +
                    "<extra>%{fullData.name}</extra>";

            }

            traces.push(trace);

            /*
             * Summit marker (triangle on the highest point)
             */

            if (y.length > 0) {

                const summitIndex =
                    getSummitIndex(y);

                traces.push({

                    x: [x[summitIndex]],
                    y: [y[summitIndex]],

                    type: "scatter",
                    mode: "markers",

                    legendgroup: result.route,
                    showlegend: false,
                    hoverinfo: "skip",

                    marker: {
                        symbol: "triangle-up",
                        size: 11,
                        color: color,
                        line: {
                            color: palette.surface,
                            width: 1.5
                        }
                    }

                });

            }

            /*
             * GPX waypoints (camps, ...)
             */

            const waypointTrace =
                buildWaypointTrace(result, color, x, y);

            if (waypointTrace) {
                traces.push(waypointTrace);
            }

        }
    );


    let yTitle;

    if (isSummit) {
        yTitle = "ارتفاع نسبت به قله (m)";
    } else if (isGain) {
        yTitle = "ارتفاع‌گیری نسبت به نقطه شروع (m)";
    } else {
        yTitle = "ارتفاع (m)";
    }


    const layout =
        buildPlotLayout(
            "",
            yTitle,
            state.summitCenter
                ? "مسافت نسبت به قله (km)"
                : "مسافت (km)",
            {
                legendItems: results.length
            }
        );

    applySpikeLine(layout);


    /*
     * With a filled area the fill goes down to y = 0.
     * A fixed range keeps the chart focused on the real
     * elevation window instead of stretching down to zero.
     */

    if (useFill) {

        const range =
            paddedRange(yMin, yMax, 0.08);

        if (range) {
            layout.yaxis.range = range;
        }

    }


    if (state.summitCenter || isSummit) {
        addSummitReferenceLines(
            layout,
            state.summitCenter,
            isSummit
        );
    }


    Plotly.react(
        containerId,
        traces,
        layout,
        getChartConfig(true)
    );

}


// --------------------------------------------------
// پروفایل ترتیبی
// --------------------------------------------------

/* =========================================================
   Ordered elevation profile
   ========================================================= */

function drawOrderedElevationProfile(
    results,
    containerId = "ordered-elevation-chart"
) {

    const palette =
        getChartPalette();

    const traces = [];

    const shapes = [];


    /*
     * Global vertical range across ALL routes
     */

    let globalMin = Infinity;
    let globalMax = -Infinity;

    results.forEach(
        result => {

            const elevations =
                result.profiles?.elevation?.elevation_m;

            if (!elevations || elevations.length === 0) {
                return;
            }

            const range =
                getArrayMinMax(elevations);

            globalMin =
                Math.min(globalMin, range.min);

            globalMax =
                Math.max(globalMax, range.max);

        }
    );


    let offset = 0;


    /*
     * Routes are drawn in the same order as analysisResults,
     * which follows the "selected routes" list in the sidebar.
     */

    results.forEach(
        (result, index) => {

            const color =
                chartRouteColor(index);

            const profile =
                result.profiles.elevation;

            const distances =
                profile.distance_km;

            const elevations =
                profile.elevation_m;

            if (
                !distances ||
                !elevations ||
                distances.length === 0
            ) {
                return;
            }

            const x =
                distances.map(
                    distance => distance + offset
                );

            const routeName =
                result.route || "مسیر";

            traces.push({

                x: x,
                y: elevations,

                type: "scatter",
                mode: "lines",

                name: routeName,
                legendgroup: routeName,

                line: {
                    color: color,
                    width: 2.6
                },

                fill: "tozeroy",

                fillcolor:
                    hexToRgba(
                        color,
                        palette.dark ? 0.12 : 0.09
                    ),

                customdata: distances,

                hovertemplate:
                    `<b>${routeName}</b>` +
                    "<br>مسافت مسیر: %{customdata:.2f} km" +
                    "<br>ارتفاع: %{y:.0f} m" +
                    "<extra></extra>"

            });

            /*
             * Summit marker
             */

            const summitIndex =
                getSummitIndex(elevations);

            traces.push({

                x: [x[summitIndex]],
                y: [elevations[summitIndex]],

                type: "scatter",
                mode: "markers",

                legendgroup: routeName,
                showlegend: false,
                hoverinfo: "skip",

                marker: {
                    symbol: "triangle-up",
                    size: 11,
                    color: color,
                    line: {
                        color: palette.surface,
                        width: 1.5
                    }
                }

            });

            /*
             * GPX waypoints (camps, ...)
             */

            const waypointTrace =
                buildWaypointTrace(
                    result,
                    color,
                    x,
                    elevations
                );

            if (waypointTrace) {
                traces.push(waypointTrace);
            }

            /*
             * Separator between two routes
             */

            const lastX =
                x[x.length - 1];

            if (index < results.length - 1) {

                shapes.push({
                    type: "line",
                    xref: "x",
                    yref: "paper",
                    x0: lastX,
                    x1: lastX,
                    y0: 0,
                    y1: 1,
                    line: {
                        color: palette.muted,
                        width: 1,
                        dash: "dot"
                    }
                });

            }

            offset +=
                distances[distances.length - 1] || 0;

        }
    );


    const layout =
        buildPlotLayout(
            "",
            "ارتفاع (m)",
            "مسافت تجمعی (km)",
            {
                legendItems: results.length
            }
        );

    layout.hovermode = "closest";

    layout.shapes = shapes;

    const range =
        paddedRange(globalMin, globalMax, 0.08);

    if (range) {
        layout.yaxis.range = range;
    }

    Plotly.react(
        containerId,
        traces,
        layout,
        getChartConfig(true)
    );

}


// --------------------------------------------------
// توزیع شیب
// یک ستون برای هر مسیر و شیب‌ها به صورت stacked
// --------------------------------------------------

/*
 * Uphill slope distribution of one route (start -> summit).
 * Cached on the result: it does not change between redraws.
 */

function getUphillSlopeData(result) {

    if (result._uphillSlopeData) {
        return result._uphillSlopeData;
    }

    const values = new Array(6).fill(0);

    let distance = 0;

    const profile =
        result.profiles?.elevation;

    if (
        profile &&
        profile.distance_km &&
        profile.elevation_m &&
        profile.distance_km.length >= 2
    ) {

        const distances = profile.distance_km;
        const elevations = profile.elevation_m;

        const summitIndex = getSummitIndex(elevations);

        for (let i = 1; i <= summitIndex; i++) {

            const segment =
                distances[i] - distances[i - 1];

            const elevationChange =
                elevations[i] - elevations[i - 1];

            if (
                !Number.isFinite(segment) ||
                segment <= 0 ||
                !Number.isFinite(elevationChange)
            ) {
                continue;
            }

            const slope =
                (elevationChange / (segment * 1000)) * 100;

            // only uphill segments
            if (slope <= 0) {
                continue;
            }

            let categoryIndex;

            if (slope < 5) {
                categoryIndex = 0;
            } else if (slope < 10) {
                categoryIndex = 1;
            } else if (slope < 15) {
                categoryIndex = 2;
            } else if (slope < 20) {
                categoryIndex = 3;
            } else if (slope < 25) {
                categoryIndex = 4;
            } else {
                categoryIndex = 5;
            }

            values[categoryIndex] += segment;

        }

        distance = distances[summitIndex] || 0;

    }

    result._uphillSlopeData = {
        route: result.route,
        values: values,
        distance: distance
    };

    return result._uphillSlopeData;

}


function drawSlopeDistribution(
    results,
    containerId = "slope-chart"
) {

    const palette =
        getChartPalette();

    const labels = [
        "خیلی آسان",
        "آسان",
        "متوسط",
        "شیب‌دار",
        "خیلی شیب‌دار",
        "بسیار شدید"
    ];

    const uphillData =
        results.map(result => getUphillSlopeData(result));

    // column totals (for the percentage in the tooltip)
    const stackTotals =
        uphillData.map(
            item =>
                item.values.reduce(
                    (sum, value) => sum + value,
                    0
                )
        );

    // one stacked trace per slope category
    const traces =
        labels.map(
            (label, categoryIndex) => ({

                x:
                    uphillData.map(item => item.route),

                y:
                    uphillData.map(
                        item => item.values[categoryIndex]
                    ),

                width: CHART_SLIM_BAR_WIDTH,

                customdata:
                    uphillData.map(
                        (item, itemIndex) =>
                            stackTotals[itemIndex] > 0
                                ? (
                                    item.values[categoryIndex] /
                                    stackTotals[itemIndex]
                                ) * 100
                                : 0
                    ),

                type: "bar",

                name: label,

                marker: {
                    color: CHART_SLOPE_COLORS[categoryIndex],
                    line: {
                        color: palette.surface,
                        width: 1.5
                    }
                },

                hovertemplate:
                    "%{y:.2f} km (%{customdata:.0f}%)" +
                    "<extra>" + label + "</extra>"

            })
        );

    // total route length above each column
    const annotations =
        uphillData.map(
            (item, index) => {

                const totalDistance =
                    Number(
                        results[index].slope?.[
                            "Total Distance (km)"
                        ]
                    ) || 0;

                return {

                    x: item.route,

                    y: stackTotals[index],

                    text: `${totalDistance.toFixed(1)} km`,

                    showarrow: false,

                    yshift: 10,

                    font: {
                        family: CHART_FONT_MONO,
                        size: 11,
                        color: palette.muted
                    }

                };

            }
        );

    const layout =
        buildPlotLayout(
            "",
            "مسافت مسیر رفت (km)",
            "",
            {
                legendItems: labels.length,
                perRow: window.innerWidth <= 900 ? 3 : 6
            }
        );

    layout.barmode = "stack";

    applyCategoryAxis(layout);

    applyTechnicalAxes(
        layout,
        "grade (%) = Δh / Δd × 100"
    );

    applySlimBars(layout, results.length);

    layout.annotations = annotations;

    // headroom for the distance labels
    let maxStack = 0;

    stackTotals.forEach(total => {
        if (total > maxStack) {
            maxStack = total;
        }
    });

    if (maxStack > 0) {
        layout.yaxis.range = [0, maxStack * 1.14];
    }

    Plotly.react(
        containerId,
        traces,
        layout,
        getChartConfig(false)
    );

}


// --------------------------------------------------
// Helper: grouped bar chart with value labels
// --------------------------------------------------

/*
 * series: [{ name, color, getter(result), unit, digits,
 *            textSuffix, hatch }]
 *
 * hatch: true -> diagonal hatching (used for model estimates,
 *                as opposed to measured values)
 */

function drawGroupedBarChart(
    results,
    containerId,
    series,
    yTitle,
    formula = ""
) {

    const palette =
        getChartPalette();

    const names =
        results.map(result => result.route);

    /* value labels become unreadable with many bars */
    const showLabels =
        results.length * series.length <= 12;

    let maxValue = 0;

    const traces =
        series.map(
            item => {

                const values =
                    results.map(
                        result => {

                            const value =
                                Number(item.getter(result));

                            return Number.isFinite(value)
                                ? value
                                : null;

                        }
                    );

                values.forEach(
                    value => {
                        if (
                            value !== null &&
                            value > maxValue
                        ) {
                            maxValue = value;
                        }
                    }
                );

                const marker = {
                    color: item.color,
                    line: {
                        color: item.color,
                        width: 1.2
                    }
                };

                if (item.hatch) {

                    marker.pattern = {
                        shape: "/",
                        size: 7,
                        solidity: 0.42,
                        bgcolor:
                            hexToRgba(item.color, 0.10),
                        fgcolor: item.color
                    };

                }

                const trace = {

                    x: names,
                    y: values,

                    type: "bar",

                    name: item.name,

                    marker: marker,

                    hovertemplate:
                        `%{y:.${item.digits}f} ${item.unit}` +
                        "<extra>" + item.name + "</extra>"

                };

                if (showLabels) {

                    trace.text =
                        values.map(
                            value =>
                                value === null
                                    ? ""
                                    : value.toFixed(item.digits) +
                                      (item.textSuffix || "")
                        );

                    trace.textposition = "outside";

                    trace.cliponaxis = false;

                    trace.textfont = {
                        family: CHART_FONT_MONO,
                        size: 10,
                        color: palette.muted
                    };

                }

                return trace;

            }
        );


    const layout =
        buildPlotLayout(
            "",
            yTitle,
            "",
            {
                legendItems: series.length,
                perRow: window.innerWidth <= 900 ? 2 : 4
            }
        );

    layout.barmode = "group";

    applyCategoryAxis(layout);

    applyTechnicalAxes(layout, formula);

    if (maxValue > 0) {
        layout.yaxis.range =
            [0, maxValue * (showLabels ? 1.15 : 1.06)];
    }

    Plotly.react(
        containerId,
        traces,
        layout,
        getChartConfig(false)
    );

}


// --------------------------------------------------
// مقایسه شاخص‌های مسیر
// --------------------------------------------------

function drawRouteMetricsComparisonChart(
    results
) {

    drawGroupedBarChart(

        results,

        "route-metrics-comparison-chart",

        [

            {
                name: "حداکثر ارتفاع‌گیری",
                color: CHART_SERIES_COLORS.gain,
                getter: result =>
                    result.metrics[
                        "Maximum Elevation Gain (m)"
                    ],
                unit: "m",
                digits: 0
            },

            {
                name: "حداکثر ارتفاع",
                color: CHART_SERIES_COLORS.maxElevation,
                getter: result =>
                    result.metrics[
                        "Maximum Elevation (m)"
                    ],
                unit: "m",
                digits: 0
            }

        ],

        "ارتفاع (m)",

        "Gain = Max Elevation − Min Elevation"

    );

}


// --------------------------------------------------
// مقایسه زمان صعود و زمان کل مسیر
// --------------------------------------------------

function drawAscentTimeComparisonChart(
    results
) {

    drawGroupedBarChart(

        results,

        "estimated-ascent-time-chart",

        [

            {
                name: "زمان تقریبی صعود",
                color: CHART_SERIES_COLORS.estimated,
                getter: result =>
                    result.difficulty[
                        "Estimated Ascent Time (h)"
                    ],
                unit: "ساعت",
                digits: 2,
                textSuffix: "h",
                hatch: true
            },

            {
                name: "زمان واقعی صعود",
                color: CHART_SERIES_COLORS.actual,
                getter: result =>
                    result.metrics[
                        "Ascent Time (h)"
                    ],
                unit: "ساعت",
                digits: 2,
                textSuffix: "h"
            },

            {
                name: "زمان کل مسیر",
                color: CHART_SERIES_COLORS.total,
                getter: result =>
                    result.metrics[
                        "Total Time (h)"
                    ],
                unit: "ساعت",
                digits: 2,
                textSuffix: "h"
            }

        ],

        "زمان (ساعت)",

        "T = (D3D / 5 + Ascent / 600) × SlopeFactor"

    );

}


// --------------------------------------------------
// امتیاز سختی مسیرها
// رنگ هر ستون بر اساس مقدار امتیاز (آبی روشن → آبی تیره)
// --------------------------------------------------

function drawDifficultyScoreChart(
    results,
    containerId = "difficulty-score-chart"
) {

    const palette =
        getChartPalette();

    const names =
        results.map(result => result.route);

    const scores =
        results.map(
            result =>
                result.difficulty["Difficulty Score"]
        );

    const trace = {

        x: names,
        y: scores,

        width: CHART_SLIM_BAR_WIDTH,

        type: "bar",

        name: "امتیاز سختی",

        marker: {

            color: scores,

            colorscale: CHART_DIFFICULTY_COLORSCALE,

            cmin: 0,
            cmax: 100,

            showscale: false,

            line: {
                color: scores,
                colorscale: CHART_DIFFICULTY_COLORSCALE,
                cmin: 0,
                cmax: 100,
                width: 1.2
            }

        },

        text:
            scores.map(
                value =>
                    Number.isFinite(value)
                        ? value.toFixed(1)
                        : ""
            ),

        textposition: "outside",

        cliponaxis: false,

        textfont: {
            family: CHART_FONT_MONO,
            size: 11,
            color: palette.muted
        },

        hovertemplate:
            "%{y:.2f} از ۱۰۰<extra>%{x}</extra>"

    };

    const layout =
        buildPlotLayout(
            "",
            "امتیاز سختی"
        );

    layout.showlegend = false;

    applyCategoryAxis(layout);

    applyTechnicalAxes(
        layout,
        "Score = 0.40·Climb + 0.35·Slope + 0.15·Alt + 0.10·Descent"
    );

    applySlimBars(layout, results.length);

    const range =
        getArrayMinMax(scores);

    if (range.max > 0) {
        layout.yaxis.range = [0, range.max * 1.15];
    }

    Plotly.react(
        containerId,
        [trace],
        layout,
        getChartConfig(false)
    );

}
