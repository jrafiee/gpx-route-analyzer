
function buildPlotLayout(title, yTitle, xTitle = "") {
    const theme = getPlotTheme();

    return {
        title: {
            text: title,
            font: {
                color: theme.textColor
            }
        },

        paper_bgcolor: theme.paperBg,
        plot_bgcolor: theme.plotBg,

        font: {
            color: theme.textColor
        },

        xaxis: {
            title: {
                text: xTitle,
                font: {
                    color: theme.textColor
                }
            },
            color: theme.textColor,
            gridcolor: theme.gridColor
        },

        yaxis: {
            title: {
                text: yTitle,
                font: {
                    color: theme.textColor
                }
            },
            color: theme.textColor,
            gridcolor: theme.gridColor
        },

        margin: {
            t: 60,
            r: 30,
            b: 70,
            l: 70
        },

        hovermode: "x unified",

        legend: {
            font: {
                color: theme.textColor
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
    const traces = results.map(result => ({
        x: result.profiles.elevation.distance_km,
        y: result.profiles.elevation.elevation_m,
        type: "scatter",
        mode: "lines",
        name: result.route,
        line: {
            width: 2
        }
    }));

    const layout = buildPlotLayout(
        "پروفایل ارتفاعی مسیرها",
        "ارتفاع (m)",
        "مسافت (km)"
    );

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
// پروفایل ارتفاع‌گیری
// --------------------------------------------------

function drawElevationGainProfile(
    results,
    containerId = "elevation-gain-chart"
) {
    const traces = results.map(result => ({
        x: result.profiles.elevation_gain.distance_km,
        y: result.profiles.elevation_gain.elevation_gain_m,
        type: "scatter",
        mode: "lines",
        name: result.route,
        line: {
            width: 2
        }
    }));

    const layout = buildPlotLayout(
        "پروفایل ارتفاع‌گیری مسیرها",
        "ارتفاع‌گیری نسبت به نقطه شروع (m)",
        "مسافت (km)"
    );

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

    const theme = getPlotTheme();

    const traces = [];

    let offset = 0;

    let globalMin = Infinity;
    let globalMax = -Infinity;


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

                x: x,

                y: elevations,

                type: "scatter",

                mode: "lines",

                name:
                    result.route || "مسیر",

                line: {
                    width: 2
                },

                hovertemplate:
                    `مسیر: ${result.route || "مسیر"}` +
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

                    type: "scatter",

                    mode: "lines",

                    line: {
                        dash: "dash",
                        width: 1
                    },

                    showlegend: false,

                    hoverinfo: "skip"

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


    layout.hovermode = "closest";


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

    const uphillData = results.map(result => {

        const profile =
            result.profiles?.elevation;


        if (
            !profile ||
            !profile.distance_km ||
            !profile.elevation_m ||
            profile.distance_km.length < 2
        ) {

            return {

                route: result.route,

                values:
                    categories.map(
                        () => 0
                    ),

                distance: 0

            };

        }


        const distances =
            profile.distance_km;


        const elevations =
            profile.elevation_m;


        // نقطه رسیدن به بیشترین ارتفاع

        let summitIndex = 0;


        for (
            let i = 1;
            i < elevations.length;
            i++
        ) {

            if (
                elevations[i] >
                elevations[summitIndex]
            ) {

                summitIndex = i;

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
                !Number.isFinite(distance) ||
                distance <= 0 ||
                !Number.isFinite(elevationChange)
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


            let categoryIndex = -1;


            if (
                slope < 5
            ) {

                categoryIndex = 0;

            } else if (
                slope < 10
            ) {

                categoryIndex = 1;

            } else if (
                slope < 15
            ) {

                categoryIndex = 2;

            } else if (
                slope < 20
            ) {

                categoryIndex = 3;

            } else if (
                slope < 25
            ) {

                categoryIndex = 4;

            } else {

                categoryIndex = 5;

            }


            values[
                categoryIndex
            ] += distance;

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

    });


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

                type: "bar",

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

                    showarrow: false,

                    yshift: 8,

                    font: {
                        size: 12
                    }

                };

            }
        );


    const layout =
        buildPlotLayout(
            "توزیع شیب مسیر رفت",
            "مسافت (km)"
        );


    layout.barmode = "stack";


    layout.xaxis = {
        ...layout.xaxis,
        type: "category"
    };


    layout.annotations =
        annotations;


    /*
     * کمی فضای بالای نمودار برای نوشته‌ها
     */

    layout.margin = {
        ...layout.margin,
        t: 55
    };


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

        x: names,

        y: values,

        type: "bar"

    };


    const layout =
        buildPlotLayout(
            "",
            yTitle
        );


    layout.xaxis = {
        ...layout.xaxis,
        type: "category"
    };


    Plotly.react(
        containerId,
        [trace],
        layout,
        {
            responsive: true,
            displaylogo: false
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

            x: names,

            y: elevationGain,

            type: "bar",

            name:
                "حداکثر ارتفاع‌گیری",

            hovertemplate:
                "مسیر: %{x}" +
                "<br>حداکثر ارتفاع‌گیری: %{y:.2f} m" +
                "<extra></extra>"

        },


        {

            x: names,

            y: maxElevation,

            type: "bar",

            name:
                "حداکثر ارتفاع",

            hovertemplate:
                "مسیر: %{x}" +
                "<br>حداکثر ارتفاع: %{y:.2f} m" +
                "<extra></extra>"

        },


        {

            x: names,

            y: difficulty,

            type: "bar",

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
     * Legend
     *
     * هر سه شاخص به صورت هم‌زمان نمایش داده می‌شوند
     * و کاربر می‌تواند هر trace را با کلیک روی Legend
     * روشن یا خاموش کند.
     */

    layout.legend = {

        ...layout.legend,

        orientation:
            "h",

        x:
            0.5,

        xanchor:
            "center",

        y:
            1.05

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

            x: names,

            y: estimatedValues,

            type: "bar",

            name:
                "زمان تقریبی صعود",

            hovertemplate:
                "مسیر: %{x}" +
                "<br>زمان تقریبی صعود: %{y:.2f} ساعت" +
                "<extra></extra>"

        },


        {

            x: names,

            y: actualValues,

            type: "bar",

            name:
                "زمان واقعی صعود",

            hovertemplate:
                "مسیر: %{x}" +
                "<br>زمان واقعی صعود: %{y:.2f} ساعت" +
                "<extra></extra>"

        },


        {

            x: names,

            y: totalTimeValues,

            type: "bar",

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

        type: "category"

    };


    layout.legend = {

        ...layout.legend,

        orientation: "h",

        x: 0.5,

        xanchor: "center",

        y: 1.05

    };


    Plotly.react(
        "estimated-ascent-time-chart",
        traces,
        layout,
        {
            responsive: true,
            displaylogo: false
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

