
/* =========================================================
   Combined elevation chart ("تحلیل و مقایسه مسیر")

   Mode:
     "elevation" -> elevation profile
     "gain"      -> aligned by start elevation (gain relative to start)
     "summit"    -> aligned by summit elevation (all summit tips at y = 0)
     "ordered"   -> routes placed one after another (cumulative distance)

   Options:
     summitCenter : summit distance = 0 on the x axis
   ========================================================= */

const elevationChartState = {
    mode: "elevation",
    summitCenter: false
};


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

    let summitIndex = 0;

    for (let i = 1; i < elevations.length; i++) {
        if (elevations[i] > elevations[summitIndex]) {
            summitIndex = i;
        }
    }

    return distances[summitIndex] || 0;

}


/*
 * Reference lines through the summit (x = 0 and/or y = 0).
 */

function addSummitReferenceLines(layout, vertical, horizontal) {

    const theme = getPlotTheme();

    const lineStyle = {
        color: theme.tickColor,
        width: 1.5,
        dash: "dash"
    };

    layout.shapes = [];

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


function getResponsiveLegend() {

    const isMobile = window.innerWidth <= 900;

    if (isMobile) {

        return {
            orientation: "h",

            x: 0.5,
            xanchor: "center",

            y: 1.08,
            yanchor: "bottom",

            font: {
                size: 11
            }
        };

    }

    return {
        orientation: "v",

        x: 1.02,
        xanchor: "left",

        y: 1,
        yanchor: "top"
    };

}


function buildPlotLayout(
    title,
    yTitle,
    xTitle = ""
) {

    const theme = getPlotTheme();

    const isMobile =
        window.innerWidth <= 900;


    return {

        title: {

            text: title,

            font: {
                color: theme.textColor
            }

        },


        paper_bgcolor:
            theme.paperBg,

        plot_bgcolor:
            theme.plotBg,


        font: {

            color:
                theme.textColor

        },


        xaxis: {

            title: {

                text:
                    xTitle,

                font: {

                    color:
                        theme.textColor

                }

            },

            color:
                theme.textColor,

            gridcolor:
                theme.gridColor

        },


        yaxis: {

            title: {

                text:
                    yTitle,

                font: {

                    color:
                        theme.textColor

                }

            },

            color:
                theme.textColor,

            gridcolor:
                theme.gridColor

        },


        margin: {

            /*
             * در موبایل Legend افقی بالای
             * نمودار قرار می‌گیرد، بنابراین
             * فضای بیشتری در بالا نیاز داریم.
             */

            t:
                isMobile
                    ? 90
                    : 60,

            r:
                isMobile
                    ? 20
                    : 30,

            b: 70,

            l:
                isMobile
                    ? 60
                    : 70

        },


        hovermode:
            "x unified",


        legend: {

            ...getResponsiveLegend(),

            font: {

                color:
                    theme.textColor

            }

        }

    };

}


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


    const traces =
        results.map(
            result => {

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

                const trace = {
                    x: distances.map(d => d - shiftX),
                    y: values.map(v => v - shiftY),
                    type: "scatter",
                    mode: "lines",
                    name: result.route,
                    line: { width: 2 }
                };

                if (isSummit) {

                    trace.customdata = values;

                    trace.hovertemplate =
                        "%{y:.0f} m" +
                        " (ارتفاع واقعی: %{customdata:.0f} m)" +
                        "<extra>%{fullData.name}</extra>";

                }

                return trace;

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
                : "مسافت (km)"
        );


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
        {
            responsive: true,
            displaylogo: false
        }
    );

}


// --------------------------------------------------
// پروفایل ارتفاعی نرمال‌شده
// --------------------------------------------------

/* =========================================================
   3. Ordered elevation profile
   ========================================================= */

function drawOrderedElevationProfile(
    results,
    containerId = "ordered-elevation-chart"
) {

    const theme =
        getPlotTheme();


    const traces = [];


    let offset = 0;


    let globalMin =
        Infinity;


    let globalMax =
        -Infinity;


    /*
     * مسیرها دقیقاً به همان ترتیبی که
     * در analysisResults قرار دارند رسم می‌شوند.
     *
     * ترتیب analysisResults نیز در index.html
     * با ترتیب "مسیرهای انتخاب‌شده" هماهنگ می‌شود.
     */

    results.forEach(
        (result, index) => {

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


            /*
             * برای تعیین محدوده عمودی
             * کل نمودار
             */

            globalMin =
                Math.min(
                    globalMin,
                    ...elevations
                );


            globalMax =
                Math.max(
                    globalMax,
                    ...elevations
                );


            /*
             * انتقال مسیر به انتهای مسیر قبلی
             */

            const x =
                distances.map(
                    distance =>
                        distance + offset
                );


            traces.push({

                x:
                    x,

                y:
                    elevations,

                type:
                    "scatter",

                mode:
                    "lines",

                name:
                    result.route ||
                    "مسیر",

                line: {

                    width:
                        2

                },

                hovertemplate:

                    `مسیر: ${
                        result.route ||
                        "مسیر"
                    }` +

                    `<br>مسافت مسیر: %{customdata:.2f} km` +

                    `<br>ارتفاع: %{y:.0f} m` +

                    `<extra></extra>`,

                customdata:
                    distances

            });


            /*
             * خط جداکننده بین دو مسیر
             */

            if (
                index <
                results.length - 1
            ) {

                const lastX =
                    x[
                        x.length - 1
                    ];


                traces.push({

                    x: [

                        lastX,
                        lastX

                    ],

                    y: [

                        globalMin,
                        globalMax

                    ],

                    type:
                        "scatter",

                    mode:
                        "lines",

                    line: {

                        dash:
                            "dash",

                        width:
                            1

                    },

                    showlegend:
                        false,

                    hoverinfo:
                        "skip"

                });

            }


            /*
             * offset مسیر بعدی
             * برابر طول مسیر فعلی است.
             */

            offset +=
                distances[
                    distances.length - 1
                ] || 0;

        }
    );


    const layout =
        buildPlotLayout(

            "",

            "ارتفاع (m)",

            "مسافت تجمعی (km)"

        );


    layout.hovermode =
        "closest";


    Plotly.react(

        containerId,

        traces,

        layout,

        {

            responsive:
                true,

            displaylogo:
                false

        }

    );

}


// --------------------------------------------------
// توزیع شیب
// یک ستون برای هر مسیر و شیب‌ها به صورت stacked
// --------------------------------------------------

function drawSlopeDistribution(
    results,
    containerId = "slope-chart"
) {

    const categories = [

        "Very Easy (0–5%)",

        "Easy (5–10%)",

        "Moderate (10–15%)",

        "Steep (15–20%)",

        "Very Steep (20–25%)",

        "Extreme (>25%)"

    ];


    const labels = [

        "خیلی آسان",

        "آسان",

        "متوسط",

        "شیب‌دار",

        "خیلی شیب‌دار",

        "بسیار شدید"

    ];


    /*
     * برای هر مسیر:
     * فقط بخش ابتدای مسیر تا رسیدن به بیشترین ارتفاع بررسی می‌شود.
     */

    const uphillData =
        results.map(
            result => {

                const profile =
                    result.profiles?.elevation;


                if (
                    !profile ||
                    !profile.distance_km ||
                    !profile.elevation_m ||
                    profile.distance_km.length < 2
                ) {

                    return {

                        route:
                            result.route,

                        values:
                            categories.map(
                                () => 0
                            ),

                        distance:
                            0

                    };

                }


                const distances =
                    profile.distance_km;


                const elevations =
                    profile.elevation_m;


                // نقطه رسیدن به بیشترین ارتفاع

                let summitIndex =
                    0;


                for (
                    let i = 1;
                    i < elevations.length;
                    i++
                ) {

                    if (
                        elevations[i] >
                        elevations[summitIndex]
                    ) {

                        summitIndex =
                            i;

                    }

                }


                const values =
                    categories.map(
                        () => 0
                    );


                /*
                 * محاسبه شیب هر قطعه از مسیر
                 * فقط از شروع تا summitIndex
                 */

                for (
                    let i = 1;
                    i <= summitIndex;
                    i++
                ) {

                    const distance =
                        distances[i] -
                        distances[i - 1];


                    const elevationChange =
                        elevations[i] -
                        elevations[i - 1];


                    if (
                        !Number.isFinite(
                            distance
                        ) ||
                        distance <= 0 ||
                        !Number.isFinite(
                            elevationChange
                        )
                    ) {

                        continue;

                    }


                    const slope =
                        (
                            elevationChange /
                            (distance * 1000)
                        ) * 100;


                    /*
                     * فقط شیب‌های صعودی
                     * بخش‌های نزولی در این نمودار نمایش داده نمی‌شوند.
                     */

                    if (
                        slope <= 0
                    ) {

                        continue;

                    }


                    let categoryIndex =
                        -1;


                    if (
                        slope < 5
                    ) {

                        categoryIndex =
                            0;

                    }
                    else if (
                        slope < 10
                    ) {

                        categoryIndex =
                            1;

                    }
                    else if (
                        slope < 15
                    ) {

                        categoryIndex =
                            2;

                    }
                    else if (
                        slope < 20
                    ) {

                        categoryIndex =
                            3;

                    }
                    else if (
                        slope < 25
                    ) {

                        categoryIndex =
                            4;

                    }
                    else {

                        categoryIndex =
                            5;

                    }


                    values[
                        categoryIndex
                    ] +=
                        distance;

                }


                /*
                 * طول مسیر رفت:
                 * از نقطه شروع تا رسیدن به قله
                 */

                const uphillDistance =
                    distances[
                        summitIndex
                    ] || 0;


                return {

                    route:
                        result.route,

                    values:
                        values,

                    distance:
                        uphillDistance

                };

            }
        );


    /*
     * ساخت ستون‌های stacked
     */

    const traces =
        categories.map(
            (
                category,
                categoryIndex
            ) => ({

                x:
                    uphillData.map(
                        item =>
                            item.route
                    ),

                y:
                    uphillData.map(
                        item =>
                            item.values[
                                categoryIndex
                            ]
                    ),

                type:
                    "bar",

                name:
                    labels[
                        categoryIndex
                    ],

                hovertemplate:

                    `مسیر: %{x}` +

                    `<br>مسافت: %{y:.2f} km` +

                    `<extra></extra>`

            })
        );


    /*
     * نوشته‌ی طول مسیر بالای خود ستون
     *
     * ارتفاع نوشته = مجموع واقعی قطعات شیب
     * نه طول کل مسیر.
     */

    const annotations =
        uphillData.map(
            (item, index) => {

                const stackHeight =
                    item.values.reduce(
                        (
                            sum,
                            value
                        ) =>
                            sum + value,
                        0
                    );


                const totalDistance =
                    Number(
                        results[index].slope?.[
                            "Total Distance (km)"
                        ]
                    ) || 0;


                return {

                    x:
                        item.route,

                    // جای نوشته فقط بر اساس ارتفاع خود ستون

                    y:
                        stackHeight,

                    // اما متن، طول کل مسیر است

                    text:
                        `${totalDistance.toFixed(1)} km`,

                    showarrow:
                        false,

                    yshift:
                        8,

                    font: {

                        size:
                            12

                    }

                };

            }
        );


    const layout =
        buildPlotLayout(

            "",

            "مسافت (km)"

        );


    layout.barmode =
        "stack";


    layout.xaxis = {

        ...layout.xaxis,

        type:
            "category"

    };


    layout.annotations =
        annotations;


    /*
     * در موبایل:
     *
     * Legend در بالای نمودار قرار دارد.
     * برای جلوگیری از برخورد Legend با عنوان
     * داخلی نمودار، فضای بیشتری در بالا ایجاد
     * می‌کنیم و Legend را کمی پایین‌تر می‌آوریم.
     */

    const isMobile =
        window.innerWidth <= 900;


    layout.margin = {

        ...layout.margin,

        t:
            isMobile
                ? 120
                : 55

    };


    if (isMobile) {

        layout.legend = {

            ...layout.legend,

            y:
                1.02,

            yanchor:
                "bottom"

        };

    }


    Plotly.react(

        containerId,

        traces,

        layout,

        {

            responsive:
                true,

            displaylogo:
                false

        }

    );

}


// --------------------------------------------------
// نمودارهای میله‌ای مقایسه مسیرها
// --------------------------------------------------

function drawRouteBarChart(
    results,
    valueGetter,
    containerId,
    yTitle
) {

    const names =
        results.map(
            result =>
                result.route
        );


    const values =
        results.map(
            result =>
                valueGetter(result)
        );


    const trace = {

        x:
            names,

        y:
            values,

        type:
            "bar"

    };


    const layout =
        buildPlotLayout(

            "",

            yTitle

        );


    layout.xaxis = {

        ...layout.xaxis,

        type:
            "category"

    };


    Plotly.react(

        containerId,

        [trace],

        layout,

        {

            responsive:
                true,

            displaylogo:
                false

        }

    );

}


// --------------------------------------------------
// مقایسه شاخص‌های مسیر
// --------------------------------------------------

function drawRouteMetricsComparisonChart(
    results
) {

    const names =
        results.map(
            result =>
                result.route
        );


    const elevationGain =
        results.map(
            result =>
                result.metrics[
                    "Maximum Elevation Gain (m)"
                ]
        );


    const maxElevation =
        results.map(
            result =>
                result.metrics[
                    "Maximum Elevation (m)"
                ]
        );


    const difficulty =
        results.map(
            result =>
                result.difficulty[
                    "Difficulty Score"
                ]
        );


    const traces = [

        {

            x:
                names,

            y:
                elevationGain,

            type:
                "bar",

            name:
                "حداکثر ارتفاع‌گیری",

            hovertemplate:

                "مسیر: %{x}" +

                "<br>حداکثر ارتفاع‌گیری: %{y:.2f} m" +

                "<extra></extra>"

        },


        {

            x:
                names,

            y:
                maxElevation,

            type:
                "bar",

            name:
                "حداکثر ارتفاع",

            hovertemplate:

                "مسیر: %{x}" +

                "<br>حداکثر ارتفاع: %{y:.2f} m" +

                "<extra></extra>"

        },


        {

            x:
                names,

            y:
                difficulty,

            type:
                "bar",

            name:
                "امتیاز سختی نهایی",

            hovertemplate:

                "مسیر: %{x}" +

                "<br>امتیاز سختی نهایی: %{y:.2f}" +

                "<extra></extra>"

        }

    ];


    const layout =
        buildPlotLayout(

            "",

            "مقدار شاخص"

        );


    layout.barmode =
        "group";


    layout.xaxis = {

        ...layout.xaxis,

        type:
            "category"

    };


    /*
     * Legend به صورت Responsive
     *
     * دسکتاپ:
     * عمودی در سمت راست
     *
     * موبایل:
     * افقی در بالای نمودار
     */

    layout.legend = {

        ...layout.legend,

        ...getResponsiveLegend()

    };


    Plotly.react(

        "route-metrics-comparison-chart",

        traces,

        layout,

        {

            responsive:
                true,

            displaylogo:
                false

        }

    );

}


// --------------------------------------------------
// مقایسه زمان صعود و زمان کل مسیر
// --------------------------------------------------

function drawAscentTimeComparisonChart(
    results
) {

    const names =
        results.map(
            result =>
                result.route
        );


    const estimatedValues =
        results.map(
            result =>
                result.difficulty[
                    "Estimated Ascent Time (h)"
                ]
        );


    const actualValues =
        results.map(
            result =>
                result.metrics[
                    "Ascent Time (h)"
                ]
        );


    const totalTimeValues =
        results.map(
            result =>
                result.metrics[
                    "Total Time (h)"
                ]
        );


    const traces = [

        {

            x:
                names,

            y:
                estimatedValues,

            type:
                "bar",

            name:
                "زمان تقریبی صعود",

            hovertemplate:

                "مسیر: %{x}" +

                "<br>زمان تقریبی صعود: %{y:.2f} ساعت" +

                "<extra></extra>"

        },


        {

            x:
                names,

            y:
                actualValues,

            type:
                "bar",

            name:
                "زمان واقعی صعود",

            hovertemplate:

                "مسیر: %{x}" +

                "<br>زمان واقعی صعود: %{y:.2f} ساعت" +

                "<extra></extra>"

        },


        {

            x:
                names,

            y:
                totalTimeValues,

            type:
                "bar",

            name:
                "زمان کل مسیر",

            hovertemplate:

                "مسیر: %{x}" +

                "<br>زمان کل مسیر: %{y:.2f} ساعت" +

                "<extra></extra>"

        }

    ];


    const layout =
        buildPlotLayout(

            "",

            "زمان (ساعت)"

        );


    layout.barmode =
        "group";


    layout.xaxis = {

        ...layout.xaxis,

        type:
            "category"

    };


    /*
     * Legend به صورت Responsive
     */

    layout.legend = {

        ...layout.legend,

        ...getResponsiveLegend()

    };


    Plotly.react(

        "estimated-ascent-time-chart",

        traces,

        layout,

        {

            responsive:
                true,

            displaylogo:
                false

        }

    );

}


// --------------------------------------------------
// زمان واقعی صعود
// --------------------------------------------------

function drawAscentTimeChart(
    results
) {

    drawRouteBarChart(

        results,

        result =>
            result.metrics[
                "Ascent Time (h)"
            ],

        "ascent-time-chart",

        "زمان صعود (ساعت)"

    );

}


// --------------------------------------------------
// زمان کل مسیر
// --------------------------------------------------

function drawTotalTimeChart(
    results
) {

    drawRouteBarChart(

        results,

        result =>
            result.metrics[
                "Total Time (h)"
            ],

        "total-time-chart",

        "زمان کل مسیر (ساعت)"

    );

}

