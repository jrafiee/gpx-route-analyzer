/* =========================================================
   Mountain Route Compare
   Weather Forecast (Daily 7 days + Hourly on demand)
   Open-Meteo
   ========================================================= */


/* =========================================================
   Configuration
   ========================================================= */

const WEATHER_API_URL =
    "https://api.open-meteo.com/v1/forecast";

const WEATHER_FORECAST_DAYS = 7;

const WEATHER_TIMEZONE = "Asia/Tehran";


/* =========================================================
   Weather Models
   ========================================================= */

const WEATHER_MODELS = [

    { id: "best_match", name: "Best Match", apiModel: null },

    { id: "ecmwf_ifs", name: "ECMWF IFS HRES 9 km", apiModel: "ecmwf_ifs" },

    { id: "ecmwf_aifs025_single", name: "ECMWF AIFS 0.25°", apiModel: "ecmwf_aifs025_single" },

    { id: "ncep_gfs_seamless", name: "GFS Seamless", apiModel: "ncep_gfs_seamless" },

    { id: "icon_seamless", name: "DWD ICON Seamless", apiModel: "icon_seamless" }

];


let selectedWeatherModel = "best_match";

let currentWeatherResults = [];

let weatherRequestGeneration = 0;


/* =========================================================
   Variables
   ========================================================= */

const WEATHER_HOURLY_VARIABLES = [

    "temperature_2m",

    "wind_speed_10m",

    "precipitation"

];


const WEATHER_DAILY_VARIABLES = [

    "weather_code",

    "temperature_2m_max",

    "temperature_2m_min",

    "wind_speed_10m_max",

    "precipitation_probability_max"

];


/* =========================================================
   Weather codes (WMO) -> icon + Persian name
   ========================================================= */

const WEATHER_CODE_INFO = {

    0: { icon: "☀️", name: "صاف" },

    1: { icon: "🌤️", name: "عمدتاً صاف" },

    2: { icon: "⛅", name: "نیمه ابری" },

    3: { icon: "☁️", name: "ابری" },

    45: { icon: "🌫️", name: "مه" },

    48: { icon: "🌫️", name: "مه یخ‌زده" },

    51: { icon: "🌦️", name: "نم‌نم باران سبک" },

    53: { icon: "🌦️", name: "نم‌نم باران" },

    55: { icon: "🌦️", name: "نم‌نم باران شدید" },

    56: { icon: "🌧️", name: "نم‌نم باران یخ‌زده" },

    57: { icon: "🌧️", name: "نم‌نم باران یخ‌زده شدید" },

    61: { icon: "🌧️", name: "باران سبک" },

    63: { icon: "🌧️", name: "بارش باران" },

    65: { icon: "🌧️", name: "باران شدید" },

    66: { icon: "🌧️", name: "باران یخ‌زده" },

    67: { icon: "🌧️", name: "باران یخ‌زده شدید" },

    71: { icon: "🌨️", name: "برف سبک" },

    73: { icon: "🌨️", name: "بارش برف" },

    75: { icon: "❄️", name: "برف شدید" },

    77: { icon: "🌨️", name: "دانه‌های برف" },

    80: { icon: "🌦️", name: "رگبار باران سبک" },

    81: { icon: "🌧️", name: "رگبار باران" },

    82: { icon: "⛈️", name: "رگبار شدید باران" },

    85: { icon: "🌨️", name: "رگبار برف" },

    86: { icon: "❄️", name: "رگبار شدید برف" },

    95: { icon: "⛈️", name: "رعدوبرق" },

    96: { icon: "⛈️", name: "رعدوبرق با تگرگ" },

    99: { icon: "⛈️", name: "رعدوبرق با تگرگ شدید" }

};


function getWeatherCodeInfo(code) {

    const numeric =
        toWeatherNumber(code);

    if (
        Number.isFinite(numeric) &&
        WEATHER_CODE_INFO[numeric]
    ) {

        return WEATHER_CODE_INFO[numeric];

    }

    return { icon: "❔", name: "نامشخص" };

}


/* =========================================================
   Helpers
   ========================================================= */

function toWeatherNumber(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {

        return NaN;

    }

    return Number(value);

}


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
   Injected styles (daily forecast)
   ========================================================= */

function injectDailyWeatherStyles() {

    if (
        document.getElementById(
            "weather-daily-styles"
        )
    ) {

        return;

    }


    const style =
        document.createElement("style");

    style.id =
        "weather-daily-styles";

    style.textContent = `

    .weather-daily-row {
        display: flex;
        flex-direction: row;
        direction: rtl;
        gap: 10px;
        padding: 14px 16px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
    }

    .weather-daily-item {
        flex: 1 0 118px;
        min-width: 118px;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
        padding: 12px 8px;
        border: 1px solid var(--border-color, #ddd);
        border-radius: 10px;
        background: var(--table-label-bg, #f7f7f7);
        text-align: center;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }

    .weather-daily-item.active {
        border-color: #4d8bc9;
        box-shadow: 0 0 0 1px rgba(77, 139, 201, 0.25);
    }

    .weather-daily-icon {
        font-size: 38px;
        line-height: 1.2;
    }

    .weather-daily-condition {
        font-size: 12px;
        font-weight: bold;
        min-height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1.5;
    }

    .weather-daily-weekday {
        font-size: 14px;
        font-weight: bold;
    }

    .weather-daily-date {
        font-size: 12px;
        color: var(--muted-text, #666);
    }

    .weather-daily-temp {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        font-size: 15px;
        font-weight: bold;
        direction: ltr;
    }

    .weather-daily-temp .arrow {
        font-size: 17px;
        font-weight: bold;
        line-height: 1;
    }

    .weather-daily-temp.max .arrow,
    .weather-daily-temp.max .value {
        color: #e53935;
    }

    .weather-daily-temp.min .arrow,
    .weather-daily-temp.min .value {
        color: #1e88e5;
    }

    .weather-daily-extra {
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
    }

    .weather-daily-extra .ltr {
        direction: ltr;
        unicode-bidi: embed;
    }

    .weather-hourly-button {
        margin-top: auto;
        padding: 7px 6px;
        border: 1px solid #ccc;
        border-radius: 7px;
        background: #f3f3f3;
        color: #333;
        font-family: inherit;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.2s ease, border-color 0.2s ease;
    }

    .weather-hourly-button:hover {
        background: #e7e7e7;
    }

    .weather-hourly-button.active {
        background: #4d8bc9;
        border-color: #4d8bc9;
        color: #fff;
    }

    .weather-hourly-panel {
        display: none;
        padding: 4px 16px 16px;
        border-top: 1px dashed var(--border-color, #ddd);
    }

    .weather-hourly-panel .weather-day {
        padding: 12px 0 0;
    }

    /* ---------- Hourly table: right-to-left ---------- */

    .weather-hourly-panel .weather-grid,
    .weather-hourly-panel .weather-scroll,
    .weather-hourly-panel .weather-data,
    .weather-hourly-panel .weather-time-row,
    .weather-hourly-panel .weather-value-row,
    .weather-hourly-panel .weather-temperature-chart-row {
        direction: rtl;
    }

    .weather-hourly-panel .weather-label-column {
        border-right: none;
        border-left: 1px solid var(--border-color, #ddd);
    }

    .weather-hourly-panel .weather-data .weather-grid-cell {
        border-right: none;
        border-left: 1px solid var(--border-color, #ddd);
    }

    .weather-hourly-panel .weather-data .weather-grid-cell:last-child {
        border-left: none;
    }

    body.dark-mode .weather-hourly-panel .weather-label-column,
    body.dark-mode .weather-hourly-panel .weather-data .weather-grid-cell {
        border-left-color: #3a3d3f;
    }

    body.dark-mode .weather-daily-item {
        background: #272a2c;
        border-color: #3a3d3f;
    }

    body.dark-mode .weather-daily-item.active {
        border-color: #4d8bc9;
    }

    body.dark-mode .weather-daily-date {
        color: #aaa;
    }

    body.dark-mode .weather-daily-temp.max .arrow,
    body.dark-mode .weather-daily-temp.max .value {
        color: #ef5350;
    }

    body.dark-mode .weather-daily-temp.min .arrow,
    body.dark-mode .weather-daily-temp.min .value {
        color: #64b5f6;
    }

    body.dark-mode .weather-hourly-button {
        background: #2b2e30;
        border-color: #484b4d;
        color: #eee;
    }

    body.dark-mode .weather-hourly-button:hover {
        background: #35383a;
    }

    body.dark-mode .weather-hourly-button.active {
        background: #4d8bc9;
        border-color: #4d8bc9;
        color: #fff;
    }

    body.dark-mode .weather-hourly-panel {
        border-top-color: #3a3d3f;
    }

    @media (max-width: 900px) {

        .weather-daily-row {
            padding: 10px 8px;
            gap: 8px;
        }

        .weather-daily-item {
            flex-basis: 108px;
            min-width: 108px;
        }

        .weather-hourly-panel {
            padding: 4px 8px 12px;
        }

    }

    `;

    document.head.appendChild(style);

}


/* =========================================================
   Create Weather Model Selector
   ========================================================= */

function createWeatherModelSelector() {

    const selector =
        document.createElement("div");

    selector.className =
        "weather-model-selector";


    const title =
        document.createElement("div");

    title.className =
        "weather-model-selector-title";

    title.textContent =
        "مدل هواشناسی:";

    selector.appendChild(title);


    const options =
        document.createElement("div");

    options.className =
        "weather-model-options";


    WEATHER_MODELS.forEach(
        model => {

            const label =
                document.createElement("label");

            label.className =
                "weather-model-option";


            const radio =
                document.createElement("input");

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

                    reloadWeatherForecasts();

                }
            );


            const text =
                document.createElement("span");

            text.textContent =
                model.name;


            label.appendChild(radio);

            label.appendChild(text);

            options.appendChild(label);

        }
    );


    selector.appendChild(options);

    return selector;

}


function ensureWeatherModelSelector() {

    const cardsContainer =
        document.getElementById(
            "weather-cards"
        );

    if (!cardsContainer) {
        return;
    }


    let selector =
        document.querySelector(
            "#weather-container .weather-model-selector"
        );

    if (!selector) {

        selector =
            createWeatherModelSelector();

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
        selectedRadio.checked = true;
    }

}


/* =========================================================
   Find highest point of route
   ========================================================= */

function getRouteSummitPoint(routeData) {

    if (
        !routeData ||
        !Array.isArray(routeData.points) ||
        routeData.points.length === 0
    ) {

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
        "daily",
        WEATHER_DAILY_VARIABLES.join(",")
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


    return `${WEATHER_API_URL}?${params.toString()}`;

}


/* =========================================================
   Fetch weather
   ========================================================= */

async function fetchSummitWeather(summitPoint) {

    if (!summitPoint) {

        throw new Error(
            "Summit point is not available."
        );

    }


    const url =
        buildWeatherApiUrl(summitPoint);

    console.log(
        "WEATHER API REQUEST:",
        getSelectedWeatherModelName(),
        url
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
        !Array.isArray(data.hourly.time) ||
        !data.daily ||
        !Array.isArray(data.daily.time)
    ) {

        throw new Error(
            "Invalid weather API response."
        );

    }


    console.log(
        "API returned elevation:",
        data.elevation
    );

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
        route: result.route,
        summit: summitPoint,
        weather: weather
    };

}


/* =========================================================
   Date / time formatting
   ========================================================= */

function getWeatherDateObject(dateString) {

    /*
       Noon UTC keeps the calendar day stable
       regardless of the browser time zone.
    */

    return new Date(
        `${dateString}T12:00:00Z`
    );

}


function formatWeatherWeekday(dateString) {

    return new Intl.DateTimeFormat(
        "fa-IR",
        {
            weekday: "long",
            timeZone: "UTC"
        }
    ).format(
        getWeatherDateObject(dateString)
    );

}


function formatWeatherJalaliDate(dateString) {

    return new Intl.DateTimeFormat(
        "fa-IR-u-ca-persian",
        {
            day: "numeric",
            month: "long",
            timeZone: "UTC"
        }
    ).format(
        getWeatherDateObject(dateString)
    );

}


function formatWeatherTime(timeString) {

    return timeString.substring(11, 16);

}


function getWeatherDateKey(timeString) {

    return timeString.substring(0, 10);

}


/* =========================================================
   Group hourly data by day
   ========================================================= */

function groupWeatherByDay(weatherData) {

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


    for (let i = 0; i < times.length; i++) {

        const time =
            times[i];

        const dateKey =
            getWeatherDateKey(time);

        if (!result[dateKey]) {
            result[dateKey] = [];
        }

        result[dateKey].push({
            time: time,
            temperature: temperatures[i],
            windSpeed: windSpeeds[i],
            precipitation: precipitation[i]
        });

    }

    return result;

}


/* =========================================================
   Build daily data
   ========================================================= */

function buildDailyWeather(weatherData) {

    const daily =
        weatherData.daily || {};

    const dates =
        daily.time || [];

    const codes =
        daily.weather_code || [];

    const maxTemps =
        daily.temperature_2m_max || [];

    const minTemps =
        daily.temperature_2m_min || [];

    const winds =
        daily.wind_speed_10m_max || [];

    const probabilities =
        daily.precipitation_probability_max || [];


    return dates.map(
        (date, i) => ({
            date: date,
            code: codes[i],
            maxTemp: toWeatherNumber(maxTemps[i]),
            minTemp: toWeatherNumber(minTemps[i]),
            wind: toWeatherNumber(winds[i]),
            probability: toWeatherNumber(probabilities[i])
        })
    );

}


function formatWeatherValue(value, digits = 0) {

    return Number.isFinite(value)
        ? value.toFixed(digits)
        : "-";

}


/* =========================================================
   Create weather card
   ========================================================= */

function createWeatherCard(weatherResult) {

    const card =
        document.createElement("div");

    card.className =
        "weather-card";


    const routeName =
        escapeHtml(weatherResult.route);

    const summit =
        weatherResult.summit;

    const weather =
        weatherResult.weather;


    const summitElevation =
        Number(summit.elevation);

    const apiElevation =
        Number(weather.elevation);


    const elevationText =
        Number.isFinite(summitElevation)
            ? Math.round(summitElevation)
            : "-";

    const apiElevationText =
        Number.isFinite(apiElevation)
            ? Math.round(apiElevation)
            : "-";


    let elevationDifferenceText = "-";

    if (
        Number.isFinite(summitElevation) &&
        Number.isFinite(apiElevation)
    ) {

        const difference =
            apiElevation - summitElevation;

        if (difference === 0) {

            elevationDifferenceText =
                "0 متر";

        } else {

            const sign =
                difference > 0 ? "+" : "";

            elevationDifferenceText =
                `${sign}${Math.round(difference)} متر`;

        }

    }


    const latitude =
        Number(summit.latitude);

    const longitude =
        Number(summit.longitude);

    const latitudeText =
        Number.isFinite(latitude)
            ? latitude.toFixed(5)
            : "-";

    const longitudeText =
        Number.isFinite(longitude)
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
                    <strong>${elevationText}</strong>
                    متر
                </span>

                <span>
                    ارتفاع استفاده‌شده توسط API:
                    <strong>${apiElevationText}</strong>
                    متر
                </span>

                <span>
                    اختلاف:
                    <strong>${elevationDifferenceText}</strong>
                </span>

                <span>
                    مدل هواشناسی:
                    <strong>${escapeHtml(getSelectedWeatherModelName())}</strong>
                </span>

                <span>
                    مختصات:
                    ${latitudeText},
                    ${longitudeText}
                </span>

            </div>

        </div>

        <div class="weather-daily-row"></div>

        <div class="weather-hourly-panel"></div>

    `;


    const dailyRow =
        card.querySelector(".weather-daily-row");

    const hourlyPanel =
        card.querySelector(".weather-hourly-panel");


    const dailyData =
        buildDailyWeather(weather);

    const hourlyByDay =
        groupWeatherByDay(weather);


    let openDate = null;

    const items = [];


    function updateActiveState() {

        items.forEach(
            entry => {

                const isActive =
                    entry.date === openDate;

                entry.element.classList.toggle(
                    "active",
                    isActive
                );

                entry.button.classList.toggle(
                    "active",
                    isActive
                );

                entry.button.textContent =
                    isActive
                        ? "بستن پیش‌بینی ساعتی"
                        : "پیش‌بینی ساعتی";

            }
        );

    }


    function toggleHourly(dateKey) {

        if (openDate === dateKey) {

            openDate = null;

            hourlyPanel.innerHTML = "";

            hourlyPanel.style.display = "none";

            updateActiveState();

            return;

        }


        openDate = dateKey;

        hourlyPanel.innerHTML = "";

        hourlyPanel.appendChild(
            createHourlyPanelContent(
                dateKey,
                hourlyByDay[dateKey] || []
            )
        );

        hourlyPanel.style.display = "block";

        updateActiveState();

    }


    dailyData.forEach(
        day => {

            const element =
                createDailyDayElement(day);

            const button =
                element.querySelector(
                    ".weather-hourly-button"
                );

            button.addEventListener(
                "click",
                () => toggleHourly(day.date)
            );

            dailyRow.appendChild(element);

            items.push({
                date: day.date,
                element: element,
                button: button
            });

        }
    );


    return card;

}


/* =========================================================
   One daily column
   ========================================================= */

function createDailyDayElement(day) {

    const info =
        getWeatherCodeInfo(day.code);


    const element =
        document.createElement("div");

    element.className =
        "weather-daily-item";


    element.innerHTML = `

        <div class="weather-daily-weekday">
            ${formatWeatherWeekday(day.date)}
        </div>

        <div class="weather-daily-date">
            ${formatWeatherJalaliDate(day.date)}
        </div>

        <div class="weather-daily-icon">
            ${info.icon}
        </div>

        <div class="weather-daily-condition">
            ${info.name}
        </div>

        <div
            class="weather-daily-temp max"
            title="بیشینه دما"
        >
            <span class="arrow">↑</span>
            <span class="value">${formatWeatherValue(day.maxTemp)}°</span>
        </div>

        <div
            class="weather-daily-temp min"
            title="کمینه دما"
        >
            <span class="arrow">↓</span>
            <span class="value">${formatWeatherValue(day.minTemp)}°</span>
        </div>

        <div
            class="weather-daily-extra"
            title="بیشینه سرعت باد"
        >
            <span>💨</span>
            <span class="ltr">${formatWeatherValue(day.wind)} km/h</span>
        </div>

        <div
            class="weather-daily-extra"
            title="احتمال بارش"
        >
            <span>☔</span>
            <span class="ltr">${
                Number.isFinite(day.probability)
                    ? Math.round(day.probability) + "%"
                    : "-"
            }</span>
        </div>

        <button
            type="button"
            class="weather-hourly-button"
        >
            پیش‌بینی ساعتی
        </button>

    `;

    return element;

}


/* =========================================================
   Hourly panel (24 hours of one day)
   ========================================================= */

function createHourlyPanelContent(dateKey, hourlyData) {

    const wrapper =
        document.createElement("div");

    wrapper.className =
        "weather-day";


    if (
        !Array.isArray(hourlyData) ||
        hourlyData.length === 0
    ) {

        wrapper.innerHTML = `
            <div class="weather-day-title">
                داده ساعتی برای این روز موجود نیست
            </div>
        `;

        return wrapper;

    }


    const title =
        `پیش‌بینی ساعتی ${formatWeatherWeekday(dateKey)} ` +
        `${formatWeatherJalaliDate(dateKey)}`;


    wrapper.innerHTML = `

        <div class="weather-day-title">
            ${title}
        </div>

        <div class="weather-grid">

            <div class="weather-label-column">

                <div class="weather-grid-cell weather-grid-header">
                    پارامتر
                </div>

                <div class="weather-grid-cell weather-temperature-label">
                    🌡️ دما
                </div>

                <div class="weather-grid-cell weather-rain-label">
                    🌧️ بارش
                </div>

                <div class="weather-grid-cell weather-wind-label">
                    💨 باد
                </div>

            </div>

            <div class="weather-scroll">

                <div
                    class="weather-data"
                    style="--weather-hours: ${hourlyData.length};"
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
                            .join("")}

                    </div>

                    <div class="weather-temperature-chart-row">

                        ${createTemperatureChart(hourlyData)}

                    </div>

                    <div class="weather-value-row weather-rain-row">

                        ${hourlyData
                            .map(
                                hour => {

                                    const rain =
                                        toWeatherNumber(
                                            hour.precipitation
                                        );

                                    const background =
                                        getRainCellColor(rain);

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
                            .join("")}

                    </div>

                    <div class="weather-value-row weather-wind-row">

                        ${hourlyData
                            .map(
                                hour => {

                                    const wind =
                                        toWeatherNumber(
                                            hour.windSpeed
                                        );

                                    const background =
                                        getWindCellColor(wind);

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
                            .join("")}

                    </div>

                </div>

            </div>

        </div>

    `;

    return wrapper;

}


/* =========================================================
   Create temperature chart
   ========================================================= */

function createTemperatureChart(hourlyData) {

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
        Math.max(hourlyData.length * 70, 70);

    const height = 92;

    const topPadding = 18;

    const bottomPadding = 14;

    const chartHeight =
        height - topPadding - bottomPadding;


    const temperatures =
        hourlyData.map(
            item => {

                const value =
                    toWeatherNumber(item.temperature);

                return Number.isFinite(value)
                    ? value
                    : null;

            }
        );


    const validTemperatures =
        temperatures.filter(
            value => value !== null
        );

    if (validTemperatures.length === 0) {

        return `
            <div class="weather-temperature-empty">
                داده دما موجود نیست
            </div>
        `;

    }


    let minTemperature =
        Math.min(...validTemperatures);

    let maxTemperature =
        Math.max(...validTemperatures);

    minTemperature =
        Math.min(minTemperature, 0);

    maxTemperature =
        Math.max(maxTemperature, 0);


    const range =
        Math.max(
            maxTemperature - minTemperature,
            1
        );

    const zeroY =
        topPadding +
        (maxTemperature / range) * chartHeight;


    const points =
        temperatures.map(
            (temperature, index) => {

                if (temperature === null) {
                    return null;
                }

                /*
                   Right-to-left: the first hour is on the
                   right, and each point is centered on its cell.
                */

                const x =
                    width -
                    (index + 0.5) *
                    (width / hourlyData.length);

                const y =
                    topPadding +
                    (
                        (maxTemperature - temperature) /
                        range
                    ) * chartHeight;

                return { x, y, temperature };

            }
        );


    const lineSegments = [];

    for (let i = 0; i < points.length - 1; i++) {

        const p1 = points[i];

        const p2 = points[i + 1];

        if (!p1 || !p2) {
            continue;
        }


        if (
            p1.temperature < 0 &&
            p2.temperature < 0
        ) {

            lineSegments.push(`
                <line
                    x1="${p1.x}" y1="${p1.y}"
                    x2="${p2.x}" y2="${p2.y}"
                    class="temperature-line temperature-line-cold"
                />
            `);

            continue;

        }


        if (
            p1.temperature >= 0 &&
            p2.temperature >= 0
        ) {

            lineSegments.push(`
                <line
                    x1="${p1.x}" y1="${p1.y}"
                    x2="${p2.x}" y2="${p2.y}"
                    class="temperature-line temperature-line-warm"
                />
            `);

            continue;

        }


        const fraction =
            (0 - p1.temperature) /
            (p2.temperature - p1.temperature);

        const zeroX =
            p1.x + (p2.x - p1.x) * fraction;

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
                x1="${p1.x}" y1="${p1.y}"
                x2="${zeroX}" y2="${zeroY}"
                class="temperature-line ${firstClass}"
            />
            <line
                x1="${zeroX}" y1="${zeroY}"
                x2="${p2.x}" y2="${p2.y}"
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
                            y="${Math.max(point.y - 8, 14)}"
                            class="temperature-value ${
                                cold
                                    ? "temperature-value-cold"
                                    : "temperature-value-warm"
                            }"
                            text-anchor="middle"
                        >
                            ${Math.round(point.temperature)}°
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

            <line
                x1="0" y1="${zeroY}"
                x2="${width}" y2="${zeroY}"
                class="temperature-zero-line"
            />

            ${lineSegments.join("")}

            ${labels}

            ${pointsMarkup}

        </svg>

    `;

}


/* =========================================================
   Weather cell color helpers
   ========================================================= */

function getWindCellColor(windSpeed) {

    if (
        !Number.isFinite(windSpeed) ||
        windSpeed <= 0
    ) {
        return "transparent";
    }

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


function getRainCellColor(precipitation) {

    if (
        !Number.isFinite(precipitation) ||
        precipitation <= 0
    ) {
        return "transparent";
    }

    const intensity =
        Math.min(precipitation / 8, 1);

    const alpha =
        0.16 + intensity * 0.62;

    return `rgba(30, 136, 229, ${alpha})`;

}


/* =========================================================
   Reload weather forecasts
   ========================================================= */

async function reloadWeatherForecasts() {

    if (
        !Array.isArray(currentWeatherResults) ||
        currentWeatherResults.length === 0
    ) {
        return;
    }

    const generation =
        ++weatherRequestGeneration;

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

    injectDailyWeatherStyles();


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


    if (Array.isArray(results)) {
        currentWeatherResults = results;
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


    ensureWeatherModelSelector();


    cardsContainer.innerHTML = "";


    /*
       Every call that is not a model reload gets
       its own generation, so older pending requests
       (for example after adding a route quickly)
       do not write into the refreshed container.
    */

    let generation;

    if (requestGeneration !== null) {

        generation = requestGeneration;

    } else {

        generation =
            ++weatherRequestGeneration;

    }


    for (const result of results) {

        if (generation !== weatherRequestGeneration) {
            return;
        }


        const loading =
            document.createElement("div");

        loading.className =
            "weather-card weather-loading";

        loading.innerHTML = `

            <div class="weather-loading-text">

                در حال دریافت پیش‌بینی هوای قله

                <strong>
                    ${escapeHtml(result.route)}
                </strong>

                ...

            </div>

        `;

        cardsContainer.appendChild(loading);


        try {

            const weatherResult =
                await getRouteWeather(result);

            if (generation !== weatherRequestGeneration) {
                return;
            }

            const card =
                createWeatherCard(weatherResult);

            loading.replaceWith(card);

        } catch (error) {

            if (generation !== weatherRequestGeneration) {
                return;
            }

            console.error(
                `Weather error for ${result.route}:`,
                error
            );

            loading.className =
                "weather-card weather-error";

            loading.innerHTML = `

                <div class="weather-error-title">
                    دریافت پیش‌بینی هوا ناموفق بود
                </div>

                <div class="weather-error-route">
                    ${escapeHtml(result.route)}
                </div>

                <div class="weather-error-message">
                    ${escapeHtml(error.message)}
                </div>

            `;

        }

    }

}


/* =========================================================
   Clear weather
   ========================================================= */

function clearWeatherForecasts() {

    weatherRequestGeneration++;

    currentWeatherResults = [];


    const container =
        document.getElementById(
            "weather-container"
        );

    const cardsContainer =
        document.getElementById(
            "weather-cards"
        );

    if (cardsContainer) {
        cardsContainer.innerHTML = "";
    }

    if (container) {
        container.style.display = "none";
    }

}


/* =========================================================
   Test helper
   ========================================================= */

async function testRouteWeather(result) {

    try {

        const weather =
            await getRouteWeather(result);

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
