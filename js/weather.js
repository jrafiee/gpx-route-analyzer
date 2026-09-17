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

const WEATHER_HOURLY_VARIABLES = [
    "temperature_2m",
    "wind_speed_10m",
    "precipitation",
    "precipitation_probability"
];


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

    if (routeData.points.length === 0) {
        return null;
    }

    let highestPoint = null;


    for (const point of routeData.points) {

        const latitude =
            Number(point.latitude);

        const longitude =
            Number(point.longitude);

        const elevation =
            Number(point.elevation);


        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            !Number.isFinite(elevation)
        ) {
            continue;
        }


        if (
            highestPoint === null ||
            elevation > highestPoint.elevation
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

function buildWeatherApiUrl(summitPoint) {

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


    params.set(
        "elevation",
        summitPoint.elevation.toString()
    );


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


    const response =
        await fetch(url);


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


    return data;
}


/* =========================================================
   Get weather for route
   ========================================================= */

async function getRouteWeather(result) {

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


    const result = {};


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

            result[dateKey] = [];

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


    const elevation =
        Math.round(
            summit.elevation
        );


    const latitude =
        summit.latitude.toFixed(5);


    const longitude =
        summit.longitude.toFixed(5);


    card.innerHTML = `

        <div class="weather-card-header">

            <div class="weather-route-title">

                ${routeName}

            </div>


            <div class="weather-summit-info">

                <span>

                    ارتفاع قله:

                    <strong>
                        ${elevation}
                    </strong>

                    متر

                </span>


                <span>

                    مختصات:

                    ${latitude},
                    ${longitude}

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
            (temperature, index) => {

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


    const lineSegments = [];


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

    if (windSpeed < 15) {
        return "rgba(255, 193, 7, 0.10)";
    }


    if (windSpeed < 25) {
        return "rgba(255, 193, 7, 0.28)";
    }


    if (windSpeed < 40) {
        return "rgba(255, 152, 0, 0.48)";
    }


    if (windSpeed < 55) {
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
   Draw all weather forecasts
   ========================================================= */

async function drawWeatherForecasts(
    results
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


    cardsContainer.innerHTML =
        "";


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


    for (
        const result of results
    ) {

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


            const card =
                createWeatherCard(
                    weatherResult
                );


            loading.replaceWith(
                card
            );


        } catch (error) {

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


        return weather;


    } catch (error) {

        console.error(
            "Weather error:",
            error
        );


        return null;

    }

}