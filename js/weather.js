
/* =========================================================
   Mountain Route Compare
   Weather Forecast
   Open-Meteo
   ========================================================= */


/* =========================================================
   Configuration
   ========================================================= */

const WEATHER_API_URL =
    "https://api.open-meteo.com/v1/forecast";

const WEATHER_FORECAST_DAYS = 7;

const WEATHER_DISPLAY_DAYS = 3;

const WEATHER_TIMEZONE = "Asia/Tehran";


/* =========================================================
   Weather Models
   ========================================================= */

/*
   IMPORTANT:

   These are the model IDs currently used by
   Open-Meteo Forecast API.

   Best Match:
   No "models" parameter is sent.
   Open-Meteo automatically selects the
   appropriate model for the location.
*/

const WEATHER_MODELS = [

    {
        id: "best_match",

        name: "Best Match",

        apiModel: null
    },


    {
        id: "ecmwf_ifs",

        name: "ECMWF IFS HRES 9 km",

        apiModel: "ecmwf_ifs"
    },


    {
        id: "ecmwf_aifs025_single",

        name: "ECMWF AIFS 0.25°",

        apiModel: "ecmwf_aifs025_single"
    },


    {
        id: "ncep_gfs_seamless",

        name: "GFS Seamless",

        apiModel: "ncep_gfs_seamless"
    },


    {
        id: "icon_seamless",

        name: "DWD ICON Seamless",

        apiModel: "icon_seamless"
    }

];


/*
   Default selected model.

   Best Match means that Open-Meteo itself
   selects the appropriate model.
*/

let selectedWeatherModel =
    "best_match";


/*
   Keep the last route results.

   This is required so that when the user
   changes the model we can automatically
   request the weather again for the same
   routes.
*/

let currentWeatherResults = [];


/*
   Request generation.

   If the user changes the model several
   times quickly, an older request must not
   overwrite the newest result.
*/

let weatherRequestGeneration = 0;


/* =========================================================
   Hourly Variables
   ========================================================= */

const WEATHER_HOURLY_VARIABLES = [

    "temperature_2m",

    "wind_speed_10m",

    "precipitation",

    "precipitation_probability"

];


/* =========================================================
   Weather Model Helpers
   ========================================================= */

function getSelectedWeatherModel() {

    return WEATHER_MODELS.find(
        model =>
            model.id === selectedWeatherModel
    ) || WEATHER_MODELS[0];

}


function getSelectedWeatherModelName() {

    return getSelectedWeatherModel().name;

}


function getSelectedWeatherModelApiId() {

    return getSelectedWeatherModel().apiModel;

}


/* =========================================================
   Create Weather Model Selector
   ========================================================= */

function createWeatherModelSelector() {

    const selector =
        document.createElement(
            "div"
        );


    selector.className =
        "weather-model-selector";


    const title =
        document.createElement(
            "div"
        );


    title.className =
        "weather-model-selector-title";


    title.textContent =
        "مدل هواشناسی:";


    selector.appendChild(
        title
    );


    const options =
        document.createElement(
            "div"
        );


    options.className =
        "weather-model-options";


    WEATHER_MODELS.forEach(
        model => {

            const label =
                document.createElement(
                    "label"
                );


            label.className =
                "weather-model-option";


            const radio =
                document.createElement(
                    "input"
                );


            radio.type =
                "radio";


            radio.name =
                "weather-model";


            radio.value =
                model.id;


            radio.checked =
                model.id ===
                selectedWeatherModel;


            radio.addEventListener(
                "change",
                () => {

                    if (!radio.checked) {
                        return;
                    }


                    if (
                        selectedWeatherModel ===
                        model.id
                    ) {

                        return;

                    }


                    selectedWeatherModel =
                        model.id;


                    console.log(
                        "Weather model changed:",
                        model.id,
                        model.name
                    );


                    reloadWeatherForecasts();

                }
            );


            const text =
                document.createElement(
                    "span"
                );


            text.textContent =
                model.name;


            label.appendChild(
                radio
            );


            label.appendChild(
                text
            );


            options.appendChild(
                label
            );

        }
    );


    selector.appendChild(
        options
    );


    return selector;

}


/* =========================================================
   Ensure Weather Model Selector
   ========================================================= */

function ensureWeatherModelSelector() {

    const cardsContainer =
        document.getElementById(
            "weather-cards"
        );


    if (!cardsContainer) {

        return;

    }


    /*
       If selector already exists, only make sure
       the currently selected radio is checked.
    */

    let selector =
        document.querySelector(
            "#weather-container .weather-model-selector"
        );


    if (!selector) {

        selector =
            createWeatherModelSelector();


        /*
           IMPORTANT:

           Insert the selector immediately before
           weather-cards.

           Therefore it appears after the weather
           section title and before the cards,
           without changing index.html.
        */

        cardsContainer.parentNode.insertBefore(
            selector,
            cardsContainer
        );

    }


    const selectedRadio =
        selector.querySelector(
            `input[name="weather-model"][value="${selectedWeatherModel}"]`
        );


    if (selectedRadio) {

        selectedRadio.checked =
            true;

    }

}


/* =========================================================
   Find highest point of route
   ========================================================= */

function getRouteSummitPoint(routeData) {

    if (
        !routeData ||
        !Array.isArray(routeData.points)
    ) {

        return null;

    }


    if (
        routeData.points.length === 0
    ) {

        return null;

    }


    let highestPoint =
        null;


    for (
        const point of routeData.points
    ) {

        const latitude =
            Number(
                point.latitude
            );


        const longitude =
            Number(
                point.longitude
            );


        const elevation =
            Number(
                point.elevation
            );


        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            !Number.isFinite(elevation)
        ) {

            continue;

        }


        if (
            highestPoint === null ||
            elevation >
            highestPoint.elevation
        ) {

            highestPoint = {

                latitude,

                longitude,

                elevation

            };

        }

    }


    return highestPoint;

}


/* =========================================================
   Build Open-Meteo URL
   ========================================================= */

function buildWeatherApiUrl(
    summitPoint
) {

    const params =
        new URLSearchParams();


    params.set(
        "latitude",
        summitPoint.latitude.toString()
    );


    params.set(
        "longitude",
        summitPoint.longitude.toString()
    );


    /*
       Summit elevation extracted from GPX
       is explicitly sent to Open-Meteo.
    */

    params.set(
        "elevation",
        summitPoint.elevation.toString()
    );


    /*
       Best Match:

       Do NOT send the "models" parameter.

       Open-Meteo will automatically select
       the appropriate model.

       Manual model:

       Send the corresponding Open-Meteo
       model ID.
    */

    const apiModel =
        getSelectedWeatherModelApiId();


    if (apiModel) {

        params.set(
            "models",
            apiModel
        );

    }


    params.set(
        "hourly",
        WEATHER_HOURLY_VARIABLES.join(",")
    );


    params.set(
        "forecast_days",
        WEATHER_FORECAST_DAYS.toString()
    );


    params.set(
        "timezone",
        WEATHER_TIMEZONE
    );


    params.set(
        "temperature_unit",
        "celsius"
    );


    params.set(
        "wind_speed_unit",
        "kmh"
    );


    params.set(
        "precipitation_unit",
        "mm"
    );


    return (
        `${WEATHER_API_URL}?${params.toString()}`
    );

}


/* =========================================================
   Fetch weather
   ========================================================= */

async function fetchSummitWeather(
    summitPoint
) {

    if (!summitPoint) {

        throw new Error(
            "Summit point is not available."
        );

    }


    const url =
        buildWeatherApiUrl(
            summitPoint
        );


    const selectedModel =
        getSelectedWeatherModel();


    /*
       Keep request information available
       for debugging.
    */

    console.log(
        "WEATHER API REQUEST:"
    );


    console.log(
        "Requested latitude:",
        summitPoint.latitude
    );


    console.log(
        "Requested longitude:",
        summitPoint.longitude
    );


    console.log(
        "Requested elevation:",
        summitPoint.elevation
    );


    console.log(
        "Selected weather model ID:",
        selectedModel.id
    );


    console.log(
        "Selected weather model name:",
        selectedModel.name
    );


    console.log(
        "Open-Meteo model parameter:",
        selectedModel.apiModel || "(Best Match)"
    );


    console.log(
        "URL:",
        url
    );


    const response =
        await fetch(
            url
        );


    if (!response.ok) {

        throw new Error(
            `Weather API error: HTTP ${response.status}`
        );

    }


    const data =
        await response.json();


    if (
        !data ||
        !data.hourly ||
        !Array.isArray(
            data.hourly.time
        )
    ) {

        throw new Error(
            "Invalid weather API response."
        );

    }


    /*
       Open-Meteo returns the elevation associated
       with the forecast grid/model point.
    */

    console.log(
        "WEATHER API RESPONSE:"
    );


    console.log(
        "API returned latitude:",
        data.latitude
    );


    console.log(
        "API returned longitude:",
        data.longitude
    );


    console.log(
        "API returned elevation:",
        data.elevation
    );


    console.log(
        "Requested weather model:",
        selectedModel.name
    );


    console.log(
        "================================"
    );


    return data;

}


/* =========================================================
   Get weather for route
   ========================================================= */

async function getRouteWeather(
    result
) {

    if (
        !result ||
        !result.routeData
    ) {

        throw new Error(
            "Route data is not available."
        );

    }


    const summitPoint =
        getRouteSummitPoint(
            result.routeData
        );


    if (!summitPoint) {

        throw new Error(
            "Could not determine summit point."
        );

    }


    const weather =
        await fetchSummitWeather(
            summitPoint
        );


    return {

        route:
            result.route,

        summit:
            summitPoint,

        weather:
            weather

    };

}


/* =========================================================
   Format date
   ========================================================= */

function formatWeatherDate(
    dateString
) {

    const date =
        new Date(
            `${dateString}T12:00:00`
        );


    return new Intl.DateTimeFormat(
        "fa-IR",
        {
            weekday: "long",
            month: "long",
            day: "numeric"
        }
    ).format(date);

}


/* =========================================================
   Format time
   ========================================================= */

function formatWeatherTime(
    timeString
) {

    return timeString.substring(
        11,
        16
    );

}


/* =========================================================
   Get date key
   ========================================================= */

function getWeatherDateKey(
    timeString
) {

    return timeString.substring(
        0,
        10
    );

}


/* =========================================================
   Group hourly data by day
   ========================================================= */

function groupWeatherByDay(
    weatherData
) {

    const hourly =
        weatherData.hourly;


    const result =
        {};


    const times =
        hourly.time || [];


    const temperatures =
        hourly.temperature_2m || [];


    const windSpeeds =
        hourly.wind_speed_10m || [];


    const precipitation =
        hourly.precipitation || [];


    const precipitationProbability =
        hourly.precipitation_probability || [];


    for (
        let i = 0;
        i < times.length;
        i++
    ) {

        const time =
            times[i];


        const dateKey =
            getWeatherDateKey(
                time
            );


        if (!result[dateKey]) {

            result[dateKey] =
                [];

        }


        result[dateKey].push({

            time:
                time,

            temperature:
                temperatures[i],

            windSpeed:
                windSpeeds[i],

            precipitation:
                precipitation[i],

            precipitationProbability:
                precipitationProbability[i]

        });

    }


    return result;

}


/* =========================================================
   Create weather card
   ========================================================= */

function createWeatherCard(
    weatherResult
) {

    const card =
        document.createElement(
            "div"
        );


    card.className =
        "weather-card";


    const routeName =
        escapeHtml(
            weatherResult.route
        );


    const summit =
        weatherResult.summit;


    const weather =
        weatherResult.weather;


    /* -----------------------------------------------------
       Summit elevation from GPX
       ----------------------------------------------------- */

    const summitElevation =
        Number(
            summit.elevation
        );


    /* -----------------------------------------------------
       Elevation returned by Open-Meteo
       ----------------------------------------------------- */

    const apiElevation =
        Number(
            weather.elevation
        );


    const elevationText =
        Number.isFinite(
            summitElevation
        )
            ? Math.round(
                summitElevation
            )
            : "-";


    const apiElevationText =
        Number.isFinite(
            apiElevation
        )
            ? Math.round(
                apiElevation
            )
            : "-";


    /* -----------------------------------------------------
       Calculate elevation difference
       ----------------------------------------------------- */

    let elevationDifferenceText =
        "-";


    if (
        Number.isFinite(
            summitElevation
        ) &&
        Number.isFinite(
            apiElevation
        )
    ) {

        const difference =
            apiElevation -
            summitElevation;


        if (
            difference === 0
        ) {

            elevationDifferenceText =
                "0 متر";

        } else {

            const sign =
                difference > 0
                    ? "+"
                    : "";


            elevationDifferenceText =
                `${sign}${Math.round(
                    difference
                )} متر`;

        }

    }


    const latitude =
        Number(
            summit.latitude
        );


    const longitude =
        Number(
            summit.longitude
        );


    const latitudeText =
        Number.isFinite(
            latitude
        )
            ? latitude.toFixed(5)
            : "-";


    const longitudeText =
        Number.isFinite(
            longitude
        )
            ? longitude.toFixed(5)
            : "-";


    card.innerHTML = `

        <div class="weather-card-header">

            <div class="weather-route-title">

                ${routeName}

            </div>


            <div class="weather-summit-info">

                <span>

                    ارتفاع قله:

                    <strong>
                        ${elevationText}
                    </strong>

                    متر

                </span>


                <span>

                    ارتفاع استفاده‌شده توسط API:

                    <strong>
                        ${apiElevationText}
                    </strong>

                    متر

                </span>


                <span>

                    اختلاف:

                    <strong>
                        ${elevationDifferenceText}
                    </strong>

                </span>


                <span>

                    مدل هواشناسی:

                    <strong>
                        ${escapeHtml(
                            getSelectedWeatherModelName()
                        )}
                    </strong>

                </span>


                <span>

                    مختصات:

                    ${latitudeText},
                    ${longitudeText}

                </span>

            </div>

        </div>


        <div class="weather-days"></div>

    `;


    const daysContainer =
        card.querySelector(
            ".weather-days"
        );


    const grouped =
        groupWeatherByDay(
            weatherResult.weather
        );


    const dates =
        Object.keys(grouped)
            .slice(
                0,
                WEATHER_DISPLAY_DAYS
            );


    dates.forEach(
        dateKey => {

            const dayData =
                grouped[dateKey];


            const dayElement =
                createWeatherDay(
                    dateKey,
                    dayData
                );


            daysContainer.appendChild(
                dayElement
            );

        }
    );


    return card;

}


/* =========================================================
   Create one weather day
   ========================================================= */

function createWeatherDay(
    dateKey,
    dayData
) {

    const day =
        document.createElement(
            "div"
        );


    day.className =
        "weather-day";


    const title =
        formatWeatherDate(
            dateKey
        );


    const hourlyData =
        dayData;


    day.innerHTML = `

        <div class="weather-day-title">

            ${title}

        </div>


        <div class="weather-grid">

            <!-- Fixed parameter column -->

            <div class="weather-label-column">

                <div class="weather-grid-cell weather-grid-header">
                    پارامتر
                </div>

                <div class="weather-grid-cell weather-temperature-label">
                    🌡️ دما
                </div>

                <div class="weather-grid-cell weather-wind-label">
                    💨 باد
                </div>

                <div class="weather-grid-cell weather-rain-label">
                    🌧️ بارش
                </div>

                <div class="weather-grid-cell weather-rain-probability-label">
                    ☔ احتمال بارش
                </div>

            </div>


            <!-- Horizontally scrollable hourly data -->

            <div class="weather-scroll">

                <div
                    class="weather-data"
                    style="
                        --weather-hours:
                        ${hourlyData.length};
                    "
                >

                    <div class="weather-time-row">

                        ${hourlyData
                            .map(
                                hour => `
                                    <div class="weather-grid-cell weather-time">
                                        ${formatWeatherTime(hour.time)}
                                    </div>
                                `
                            )
                            .join("")
                        }

                    </div>


                    <div class="weather-temperature-chart-row">

                        ${createTemperatureChart(
                            hourlyData
                        )}

                    </div>


                    <div class="weather-value-row weather-wind-row">

                        ${hourlyData
                            .map(
                                hour => {

                                    const wind =
                                        Number(
                                            hour.windSpeed
                                        );


                                    const background =
                                        getWindCellColor(
                                            wind
                                        );


                                    return `

                                        <div
                                            class="weather-grid-cell weather-wind-cell"
                                            style="background:${background};"
                                            title="سرعت باد: ${
                                                Number.isFinite(wind)
                                                    ? wind.toFixed(1)
                                                    : "-"
                                            } km/h"
                                        >

                                            ${
                                                Number.isFinite(wind)
                                                    ? Math.round(wind)
                                                    : "-"
                                            }

                                        </div>

                                    `;

                                }
                            )
                            .join("")
                        }

                    </div>


                    <div class="weather-value-row weather-rain-row">

                        ${hourlyData
                            .map(
                                hour => {

                                    const rain =
                                        Number(
                                            hour.precipitation
                                        );


                                    const background =
                                        getRainCellColor(
                                            rain
                                        );


                                    return `

                                        <div
                                            class="weather-grid-cell weather-rain-cell"
                                            style="background:${background};"
                                            title="بارش: ${
                                                Number.isFinite(rain)
                                                    ? rain.toFixed(1)
                                                    : "-"
                                            } mm"
                                        >

                                            ${
                                                Number.isFinite(rain)
                                                    ? rain.toFixed(1)
                                                    : "-"
                                            }

                                        </div>

                                    `;

                                }
                            )
                            .join("")
                        }

                    </div>


                    <div class="weather-value-row weather-rain-probability-row">

                        ${hourlyData
                            .map(
                                hour => {

                                    const probability =
                                        Number(
                                            hour.precipitationProbability
                                        );


                                    const background =
                                        getRainProbabilityCellColor(
                                            probability
                                        );


                                    return `

                                        <div
                                            class="weather-grid-cell weather-rain-probability-cell"
                                            style="background:${background};"
                                            title="احتمال بارش: ${
                                                Number.isFinite(probability)
                                                    ? probability.toFixed(0)
                                                    : "-"
                                            }%"
                                        >

                                            ${
                                                Number.isFinite(probability)
                                                    ? Math.round(probability)
                                                    : "-"
                                            }%

                                        </div>

                                    `;

                                }
                            )
                            .join("")
                        }

                    </div>

                </div>

            </div>

        </div>

    `;


    return day;

}


/* =========================================================
   Create temperature chart
   ========================================================= */

function createTemperatureChart(
    hourlyData
) {

    if (
        !Array.isArray(hourlyData) ||
        hourlyData.length === 0
    ) {

        return `
            <div class="weather-temperature-empty">
                داده‌ای وجود ندارد
            </div>
        `;

    }


    const width =
        Math.max(
            hourlyData.length * 70,
            70
        );


    const height =
        92;


    const topPadding =
        18;


    const bottomPadding =
        14;


    const chartHeight =
        height -
        topPadding -
        bottomPadding;


    const temperatures =
        hourlyData.map(
            item => {

                const value =
                    Number(
                        item.temperature
                    );


                return Number.isFinite(value)
                    ? value
                    : null;

            }
        );


    const validTemperatures =
        temperatures.filter(
            value =>
                value !== null
        );


    if (
        validTemperatures.length === 0
    ) {

        return `
            <div class="weather-temperature-empty">
                داده دما موجود نیست
            </div>
        `;

    }


    let minTemperature =
        Math.min(
            ...validTemperatures
        );


    let maxTemperature =
        Math.max(
            ...validTemperatures
        );


    /*
       Add some vertical breathing room.
       Zero is always included when the
       temperature range crosses zero.
    */

    minTemperature =
        Math.min(
            minTemperature,
            0
        );


    maxTemperature =
        Math.max(
            maxTemperature,
            0
        );


    const range =
        Math.max(
            maxTemperature -
            minTemperature,
            1
        );


    const zeroY =
        topPadding +
        (
            maxTemperature /
            range
        ) *
        chartHeight;


    const points =
        temperatures.map(
            (
                temperature,
                index
            ) => {

                if (
                    temperature === null
                ) {

                    return null;

                }


                const x =
                    hourlyData.length === 1
                        ? width / 2
                        : index *
                          (
                              width /
                              (
                                  hourlyData.length -
                                  1
                              )
                          );


                const y =
                    topPadding +
                    (
                        (
                            maxTemperature -
                            temperature
                        ) /
                        range
                    ) *
                    chartHeight;


                return {

                    x,

                    y,

                    temperature

                };

            }
        );


    const lineSegments =
        [];


    for (
        let i = 0;
        i < points.length - 1;
        i++
    ) {

        const p1 =
            points[i];


        const p2 =
            points[i + 1];


        if (
            !p1 ||
            !p2
        ) {

            continue;

        }


        /*
           Both points below zero.
        */

        if (
            p1.temperature < 0 &&
            p2.temperature < 0
        ) {

            lineSegments.push(`

                <line
                    x1="${p1.x}"
                    y1="${p1.y}"
                    x2="${p2.x}"
                    y2="${p2.y}"
                    class="temperature-line temperature-line-cold"
                />

            `);

            continue;

        }


        /*
           Both points at or above zero.
        */

        if (
            p1.temperature >= 0 &&
            p2.temperature >= 0
        ) {

            lineSegments.push(`

                <line
                    x1="${p1.x}"
                    y1="${p1.y}"
                    x2="${p2.x}"
                    y2="${p2.y}"
                    class="temperature-line temperature-line-warm"
                />

            `);

            continue;

        }


        /*
           Segment crosses zero.
           Calculate the exact x position where
           temperature reaches 0°C.
        */

        const fraction =
            (
                0 -
                p1.temperature
            ) /
            (
                p2.temperature -
                p1.temperature
            );


        const zeroX =
            p1.x +
            (
                p2.x -
                p1.x
            ) *
            fraction;


        const zeroPointY =
            zeroY;


        const firstClass =
            p1.temperature < 0
                ? "temperature-line-cold"
                : "temperature-line-warm";


        const secondClass =
            p2.temperature < 0
                ? "temperature-line-cold"
                : "temperature-line-warm";


        lineSegments.push(`

            <line
                x1="${p1.x}"
                y1="${p1.y}"
                x2="${zeroX}"
                y2="${zeroPointY}"
                class="temperature-line ${firstClass}"
            />

            <line
                x1="${zeroX}"
                y1="${zeroPointY}"
                x2="${p2.x}"
                y2="${p2.y}"
                class="temperature-line ${secondClass}"
            />

        `);

    }


    const labels =
        points
            .map(
                point => {

                    if (!point) {

                        return "";

                    }


                    const cold =
                        point.temperature < 0;


                    return `

                        <text
                            x="${point.x}"
                            y="${Math.max(
                                point.y - 8,
                                14
                            )}"
                            class="temperature-value ${
                                cold
                                    ? "temperature-value-cold"
                                    : "temperature-value-warm"
                            }"
                            text-anchor="middle"
                        >
                            ${Math.round(
                                point.temperature
                            )}°
                        </text>

                    `;

                }
            )
            .join("");


    const pointsMarkup =
        points
            .map(
                point => {

                    if (!point) {

                        return "";

                    }


                    return `

                        <circle
                            cx="${point.x}"
                            cy="${point.y}"
                            r="3.5"
                            class="temperature-point ${
                                point.temperature < 0
                                    ? "temperature-point-cold"
                                    : "temperature-point-warm"
                            }"
                        />

                    `;

                }
            )
            .join("");


    return `

        <svg
            class="temperature-chart"
            viewBox="0 0 ${width} ${height}"
            preserveAspectRatio="none"
            role="img"
            aria-label="نمودار دمای ساعتی"
        >

            <!-- Zero degree reference -->

            <line
                x1="0"
                y1="${zeroY}"
                x2="${width}"
                y2="${zeroY}"
                class="temperature-zero-line"
            />


            <!-- Continuous temperature line -->

            ${lineSegments.join("")}


            <!-- Temperature values -->

            ${labels}


            <!-- Data points -->

            ${pointsMarkup}

        </svg>

    `;

}


/* =========================================================
   Weather cell color helpers
   ========================================================= */

function getWindCellColor(
    windSpeed
) {

    if (
        !Number.isFinite(windSpeed) ||
        windSpeed <= 0
    ) {

        return "transparent";

    }


    /*
       Wind scale:
       < 15 km/h  -> almost neutral
       15–25      -> yellow
       25–40      -> orange
       40–55      -> red-orange
       > 55       -> deep red
    */

    if (
        windSpeed < 15
    ) {

        return "rgba(255, 193, 7, 0.10)";

    }


    if (
        windSpeed < 25
    ) {

        return "rgba(255, 193, 7, 0.28)";

    }


    if (
        windSpeed < 40
    ) {

        return "rgba(255, 152, 0, 0.48)";

    }


    if (
        windSpeed < 55
    ) {

        return "rgba(244, 81, 30, 0.58)";

    }


    return "rgba(198, 40, 40, 0.72)";

}


function getRainCellColor(
    precipitation
) {

    if (
        !Number.isFinite(precipitation) ||
        precipitation <= 0
    ) {

        return "transparent";

    }


    /*
       Blue intensity increases with precipitation.
    */

    const intensity =
        Math.min(
            precipitation / 8,
            1
        );


    const alpha =
        0.16 +
        intensity * 0.62;


    return `rgba(30, 136, 229, ${alpha})`;

}


function getRainProbabilityCellColor(
    probability
) {

    if (
        !Number.isFinite(probability) ||
        probability <= 0
    ) {

        return "transparent";

    }


    const intensity =
        Math.min(
            probability / 100,
            1
        );


    const alpha =
        0.08 +
        intensity * 0.32;


    return `rgba(30, 136, 229, ${alpha})`;

}


/* =========================================================
   Get / create weather container
   ========================================================= */

function getWeatherContainer() {

    return document.getElementById(
        "weather-container"
    );

}


/* =========================================================
   Reload weather forecasts
   ========================================================= */

async function reloadWeatherForecasts() {

    if (
        !Array.isArray(
            currentWeatherResults
        ) ||
        currentWeatherResults.length === 0
    ) {

        return;

    }


    const generation =
        ++weatherRequestGeneration;


    console.log(
        "Reloading weather forecasts..."
    );


    console.log(
        "Selected model:",
        getSelectedWeatherModelName()
    );


    await drawWeatherForecasts(
        currentWeatherResults,
        generation
    );

}


/* =========================================================
   Draw all weather forecasts
   ========================================================= */

async function drawWeatherForecasts(
    results,
    requestGeneration = null
) {

    const container =
        document.getElementById(
            "weather-container"
        );


    const cardsContainer =
        document.getElementById(
            "weather-cards"
        );


    if (
        !container ||
        !cardsContainer
    ) {

        console.error(
            "Weather container not found."
        );

        return;

    }


    /*
       Keep the original route results.

       These are the routes for which weather
       will be requested whenever the model changes.
    */

    if (
        Array.isArray(results)
    ) {

        currentWeatherResults =
            results;

    }


    if (
        !Array.isArray(results) ||
        results.length === 0
    ) {

        container.style.display =
            "none";


        return;

    }


    container.style.display =
        "block";


    /*
       Create / preserve model selector.

       It is inserted immediately before
       weather-cards, so it stays below the
       section title and above the cards.
    */

    ensureWeatherModelSelector();


    /*
       Clear old cards.

       The model selector is NOT inside
       weather-cards, so it remains intact.
    */

    cardsContainer.innerHTML =
        "";


    const generation =
        requestGeneration !== null
            ? requestGeneration
            : weatherRequestGeneration;


    for (
        const result of results
    ) {

        /*
           If a newer model selection happened
           while this request was running, stop
           rendering the old result.
        */

        if (
            generation !==
            weatherRequestGeneration
        ) {

            return;

        }


        const loading =
            document.createElement(
                "div"
            );


        loading.className =
            "weather-card weather-loading";


        loading.innerHTML = `

            <div
                class="weather-loading-text"
            >

                در حال دریافت پیش‌بینی هوای قله

                <strong>
                    ${escapeHtml(
                        result.route
                    )}
                </strong>

                ...

            </div>

        `;


        cardsContainer.appendChild(
            loading
        );


        try {

            const weatherResult =
                await getRouteWeather(
                    result
                );


            /*
               Do not allow an old request to
               insert a card after the user has
               selected another model.
            */

            if (
                generation !==
                weatherRequestGeneration
            ) {

                return;

            }


            const card =
                createWeatherCard(
                    weatherResult
                );


            loading.replaceWith(
                card
            );


        } catch (error) {

            /*
               Ignore errors from obsolete requests.
            */

            if (
                generation !==
                weatherRequestGeneration
            ) {

                return;

            }


            console.error(
                `Weather error for ${result.route}:`,
                error
            );


            loading.className =
                "weather-card weather-error";


            loading.innerHTML = `

                <div
                    class="weather-error-title"
                >

                    دریافت پیش‌بینی هوا
                    ناموفق بود

                </div>


                <div
                    class="weather-error-route"
                >

                    ${escapeHtml(
                        result.route
                    )}

                </div>


                <div
                    class="weather-error-message"
                >

                    ${escapeHtml(
                        error.message
                    )}

                </div>

            `;

        }

    }

}


/* =========================================================
   Clear weather
   ========================================================= */

function clearWeatherForecasts() {

    /*
       Invalidate any request that is currently
       being processed.
    */

    weatherRequestGeneration++;


    currentWeatherResults =
        [];


    const container =
        document.getElementById(
            "weather-container"
        );


    const cardsContainer =
        document.getElementById(
            "weather-cards"
        );


    if (cardsContainer) {

        cardsContainer.innerHTML =
            "";

    }


    if (container) {

        container.style.display =
            "none";

    }

}


/* =========================================================
   Test helper
   ========================================================= */

async function testRouteWeather(
    result
) {

    try {

        const weather =
            await getRouteWeather(
                result
            );


        console.log(
            "WEATHER RESULT:",
            weather
        );


        console.log(
            "GPX summit elevation:",
            weather.summit.elevation
        );


        console.log(
            "Open-Meteo returned elevation:",
            weather.weather.elevation
        );


        console.log(
            "Selected weather model:",
            getSelectedWeatherModelName()
        );


        console.log(
            "Selected weather model ID:",
            selectedWeatherModel
        );


        console.log(
            "================================"
        );


        return weather;


    } catch (error) {

        console.error(
            "Weather error:",
            error
        );


        return null;

    }

}

