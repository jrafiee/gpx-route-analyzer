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


        <div class="weather-table-wrapper">

            <table class="weather-table">

                <thead>

                    <tr>

                        <th>
                            پارامتر
                        </th>


                        ${hourlyData
                            .map(
                                item => `
                                    <th>
                                        ${formatWeatherTime(
                                            item.time
                                        )}
                                    </th>
                                `
                            )
                            .join("")
                        }

                    </tr>

                </thead>


                <tbody>


                    <!-- Temperature -->

                    <tr
                        class="weather-temperature-row"
                    >

                        <th>
                            🌡️ دما
                        </th>


                        ${hourlyData
                            .map(
                                item => `

                                    <td>

                                        ${
                                            Number.isFinite(
                                                item.temperature
                                            )
                                                ? `${Math.round(
                                                    item.temperature
                                                )}°`
                                                : "-"
                                        }

                                    </td>

                                `
                            )
                            .join("")
                        }

                    </tr>


                    <!-- Wind -->

                    <tr
                        class="weather-wind-row"
                    >

                        <th>
                            💨 باد
                        </th>


                        ${hourlyData
                            .map(
                                item => `

                                    <td>

                                        ${
                                            Number.isFinite(
                                                item.windSpeed
                                            )
                                                ? `${Math.round(
                                                    item.windSpeed
                                                )}`
                                                : "-"
                                        }

                                    </td>

                                `
                            )
                            .join("")
                        }

                    </tr>


                    <!-- Precipitation -->

                    <tr
                        class="weather-rain-row"
                    >

                        <th>
                            🌧️ بارش
                        </th>


                        ${hourlyData
                            .map(
                                item => `

                                    <td>

                                        ${
                                            Number.isFinite(
                                                item.precipitation
                                            )
                                                ? item.precipitation.toFixed(1)
                                                : "-"
                                        }

                                    </td>

                                `
                            )
                            .join("")
                        }

                    </tr>


                    <!-- Precipitation probability -->

                    <tr
                        class="weather-rain-probability-row"
                    >

                        <th>
                            ☔ احتمال بارش
                        </th>


                        ${hourlyData
                            .map(
                                item => `

                                    <td>

                                        ${
                                            Number.isFinite(
                                                item.precipitationProbability
                                            )
                                                ? `${Math.round(
                                                    item.precipitationProbability
                                                )}%`
                                                : "-"
                                        }

                                    </td>

                                `
                            )
                            .join("")
                        }

                    </tr>


                </tbody>

            </table>

        </div>

    `;


    return day;
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