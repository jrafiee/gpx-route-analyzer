/* =========================================================
   Mountain Route Compare
   Weather Forecast (Daily 7 days + Hourly on demand)
   Open-Meteo
   ========================================================= */

const WEATHER_API_URL = "https://api.open-meteo.com/v1/forecast";
const WEATHER_FORECAST_DAYS = 7;
const WEATHER_TIMEZONE = "Asia/Tehran";

const WEATHER_MODELS = [
    { id: "best_match", name: "Best Match", sub: "بهینه ترکیبی", apiModel: null },
    { id: "ecmwf_ifs", name: "ECMWF IFS", sub: "اروپا ۹km", apiModel: "ecmwf_ifs" },
    { id: "ecmwf_aifs025_single", name: "ECMWF AIFS", sub: "AI اروپا ۰.۲۵°", apiModel: "ecmwf_aifs025_single" },
    { id: "ncep_gfs_seamless", name: "GFS Seamless", sub: "آمریکا NOAA", apiModel: "ncep_gfs_seamless" },
    { id: "icon_seamless", name: "ICON Seamless", sub: "آلمان DWD", apiModel: "icon_seamless" }
];

let selectedWeatherModel = "best_match";
let currentWeatherResults = [];
let selectedWeatherRouteFilter = "all"; // "all" or specific route name
let weatherRequestGeneration = 0;

const WEATHER_HOURLY_VARIABLES = [
    "temperature_2m",
    "wind_speed_10m",
    "precipitation",
    "precipitation_probability",
    "weather_code"
];

const WEATHER_DAILY_VARIABLES = [
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "wind_speed_10m_max",
    "precipitation_probability_max"
];

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
    const numeric = toWeatherNumber(code);
    if (Number.isFinite(numeric) && WEATHER_CODE_INFO[numeric]) {
        return WEATHER_CODE_INFO[numeric];
    }
    return { icon: "❔", name: "نامشخص" };
}

function toWeatherNumber(value) {
    if (value === null || value === undefined || value === "") return NaN;
    return Number(value);
}

function getSelectedWeatherModel() {
    return WEATHER_MODELS.find(m => m.id === selectedWeatherModel) || WEATHER_MODELS[0];
}

function getSelectedWeatherModelName() {
    return getSelectedWeatherModel().name;
}

function getSelectedWeatherModelApiId() {
    return getSelectedWeatherModel().apiModel;
}

function injectDailyWeatherStyles() {
    if (document.getElementById("weather-daily-styles")) return;

    const style = document.createElement("style");
    style.id = "weather-daily-styles";
    style.textContent = `
    .weather-route-filter-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 14px;
        padding: 4px 0;
    }

    .weather-route-filter-btn {
        padding: 6px 14px;
        border-radius: 8px;
        font-size: 13px;
        font-family: inherit;
        background: #f1f3f5;
        border: 1px solid #dcdfe3;
        color: #444;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .weather-route-filter-btn:hover {
        background: #e2e8f0;
    }

    .weather-route-filter-btn.active {
        background: #4d8bc9;
        border-color: #4d8bc9;
        color: white;
        font-weight: bold;
    }

    body.dark-mode .weather-route-filter-btn {
        background: #2b2e30;
        border-color: #484b4d;
        color: #eee;
    }

    body.dark-mode .weather-route-filter-btn.active {
        background: #4d8bc9;
        color: white;
    }

    /* Model Selector Container */
    .weather-model-selector {
        width: 100%;
        margin-bottom: 18px;
        padding: 14px 16px;
        background: var(--card-bg, #ffffff);
        border: 1px solid var(--border-color, #e2e8f0);
        border-radius: 14px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        box-sizing: border-box;
    }

    .weather-model-selector-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
    }

    .weather-model-title-left {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .weather-model-heading {
        font-size: 13.5px;
        font-weight: 700;
        color: var(--text-primary, #1e293b);
    }

    .weather-model-current-badge {
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
        background: #eaf2f9;
        color: #245f91;
    }

    .weather-model-scroll-hint {
        font-size: 11px;
        color: var(--text-muted, #94a3b8);
    }

    /* Weather Model Options Strip: Horizontal Scroll with Identical Sized Boxes */
    .weather-model-options {
        display: flex !important;
        flex-direction: row !important;
        gap: 10px !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
        scrollbar-width: thin;
        padding: 4px 2px 8px !important;
        width: 100% !important;
        box-sizing: border-box !important;
    }

    /* STRICT UNIFORM BOX SIZE ON BOTH MOBILE AND DESKTOP: 140px x 76px */
    .weather-model-option {
        position: relative !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        justify-content: center !important;
        flex: 0 0 140px !important;
        width: 140px !important;
        min-width: 140px !important;
        max-width: 140px !important;
        height: 76px !important;
        min-height: 76px !important;
        max-height: 76px !important;
        padding: 8px 10px !important;
        border: 1.5px solid var(--border-color, #cbd5e1) !important;
        border-radius: 12px !important;
        background: #ffffff !important;
        cursor: pointer !important;
        user-select: none !important;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
        box-sizing: border-box !important;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04) !important;
        text-align: right !important;
    }

    .weather-model-option:hover {
        border-color: #94a3b8 !important;
        background: #f8fafc !important;
    }

    .weather-model-option input[type="radio"] {
        position: absolute !important;
        opacity: 0 !important;
        width: 0 !important;
        height: 0 !important;
        pointer-events: none !important;
    }

    .weather-model-card-inner {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 100%;
    }

    .weather-model-header-row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
    }

    .weather-model-radio-circle {
        width: 13px;
        height: 13px;
        border-radius: 50%;
        border: 2px solid #94a3b8;
        background: #ffffff;
        flex-shrink: 0;
        transition: all 0.2s ease;
        box-sizing: border-box;
    }

    .weather-model-name {
        font-size: 13px;
        font-weight: 700;
        color: var(--text-primary, #1e293b);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.2;
    }

    .weather-model-sub-badge {
        font-size: 10.5px;
        font-weight: 500;
        color: var(--text-secondary, #64748b);
        background: #f1f5f9;
        padding: 2px 6px;
        border-radius: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: inline-block;
        max-width: 100%;
        width: fit-content;
    }

    /* Active Selected Model */
    .weather-model-option.active,
    .weather-model-option:has(input:checked) {
        border-color: #3182ce !important;
        background: #ebf5ff !important;
        box-shadow: 0 0 0 1px #3182ce, 0 3px 8px rgba(49, 130, 206, 0.2) !important;
    }

    .weather-model-option.active .weather-model-radio-circle,
    .weather-model-option:has(input:checked) .weather-model-radio-circle {
        border-color: #3182ce;
        background: #3182ce;
        box-shadow: inset 0 0 0 2.5px #ffffff;
    }

    .weather-model-option.active .weather-model-name,
    .weather-model-option:has(input:checked) .weather-model-name {
        color: #1e4e79;
    }

    .weather-model-option.active .weather-model-sub-badge,
    .weather-model-option:has(input:checked) .weather-model-sub-badge {
        background: #dbeafe;
        color: #1d4ed8;
        font-weight: 600;
    }

    /* Daily Row */
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
        font-size: 34px;
        line-height: 1.2;
    }

    .weather-daily-condition {
        font-size: 12px;
        font-weight: bold;
        min-height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1.4;
    }

    .weather-daily-weekday {
        font-size: 13px;
        font-weight: bold;
    }

    .weather-daily-date {
        font-size: 11px;
        color: var(--muted-text, #666);
    }

    .weather-daily-temp {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        font-size: 14px;
        font-weight: bold;
        direction: ltr;
    }

    .weather-daily-temp .arrow {
        font-size: 16px;
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
        font-size: 11px;
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
        box-sizing: border-box;
        width: 100%;
    }

    /* =========================================================
       Hourly Forecast Horizontal Table & Quick Jumps
       ========================================================= */

    .hourly-forecast-wrapper {
        width: 100%;
        margin-top: 12px;
        padding: 12px 0 6px;
        box-sizing: border-box;
    }

    .hourly-forecast-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 12px;
        padding: 0 4px;
    }

    .hourly-header-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .hourly-forecast-title {
        margin: 0;
        font-size: 13.5px;
        font-weight: 700;
        color: var(--text-primary, #1e293b);
    }

    .hourly-forecast-hint {
        font-size: 11px;
        color: var(--text-muted, #94a3b8);
    }

    .hourly-quick-jumps {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    }

    .hourly-jump-label {
        font-size: 11px;
        color: var(--text-muted, #94a3b8);
        margin-inline-end: 2px;
    }

    .hourly-jump-btn {
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid var(--border-color, #cbd5e1);
        background: #f8fafc;
        font-size: 11px;
        font-family: inherit;
        color: var(--text-primary, #334155);
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
    }

    .hourly-jump-btn:hover {
        background: #e2e8f0;
        border-color: #94a3b8;
    }

    /* Horizontal Scroll Container */
    .hourly-table-scroll-container {
        width: 100% !important;
        max-width: 100% !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        -webkit-overflow-scrolling: touch !important;
        scrollbar-width: thin;
        border: 1px solid var(--border-color, #e2e8f0);
        border-radius: 12px;
        background: var(--card-bg, #ffffff);
        box-sizing: border-box;
        position: relative;
    }

    /* The Horizontal Table */
    .hourly-forecast-table {
        display: table !important;
        table-layout: fixed !important;
        width: 1632px !important;
        min-width: 1632px !important;
        max-width: 1632px !important;
        border-collapse: separate !important;
        border-spacing: 0 !important;
        font-size: 12px;
        direction: rtl !important;
        text-align: center;
        margin: 0;
    }

    /* Sticky First Column pinned to right edge */
    .hourly-sticky-col {
        position: sticky !important;
        right: 0 !important;
        z-index: 25 !important;
        width: 96px !important;
        min-width: 96px !important;
        max-width: 96px !important;
        background: #f1f5f9 !important;
        color: var(--text-primary, #1e293b) !important;
        font-weight: 700 !important;
        font-size: 11.5px !important;
        text-align: right !important;
        padding: 8px 10px 8px 6px !important;
        box-shadow: -3px 0 6px rgba(0, 0, 0, 0.06);
        border-left: 2px solid var(--border-color, #e2e8f0) !important;
        border-bottom: 1px solid var(--border-color, #e2e8f0) !important;
        white-space: nowrap !important;
        box-sizing: border-box !important;
        vertical-align: middle !important;
    }

    /* All 24 Hour Columns */
    .hourly-th-cell,
    .hourly-td-cell {
        display: table-cell !important;
        width: 64px !important;
        min-width: 64px !important;
        max-width: 64px !important;
        padding: 6px 4px !important;
        border-bottom: 1px solid var(--border-color, #e2e8f0);
        border-left: 1px solid var(--border-color, #e2e8f0);
        white-space: nowrap !important;
        box-sizing: border-box !important;
        vertical-align: middle !important;
        text-align: center !important;
        height: 40px;
    }

    .hourly-forecast-table thead tr th.hourly-th-cell {
        background: #f8fafc;
        color: var(--text-primary, #1e293b);
        font-family: Consolas, monospace;
        font-size: 11px;
        font-weight: 700;
        padding: 7px 4px;
    }

    .hourly-th-cell.hour-night {
        background: #f1f5f9;
    }

    .hourly-th-cell.hour-day {
        background: #fffbeb;
    }

    .hourly-cell-time {
        font-weight: 700;
        line-height: 1.2;
    }

    .hourly-cell-phase {
        font-size: 10px;
        opacity: 0.8;
    }

    .hourly-table-icon {
        font-size: 17px;
        line-height: 1;
        display: block;
        margin-bottom: 2px;
    }

    .hourly-table-cond-name {
        font-size: 9.5px;
        color: var(--text-secondary, #64748b);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 58px;
        margin: 0 auto;
    }

    .hourly-chart-td {
        padding: 0 !important;
        height: 76px;
        background: var(--card-bg, #ffffff);
        vertical-align: middle;
    }

    .temp-val-cold {
        color: #1e88e5;
        background: rgba(30, 136, 229, 0.06);
    }

    .temp-val-warm {
        color: #e53935;
        background: rgba(229, 57, 53, 0.06);
    }

    .hourly-temp-value {
        font-size: 13px;
        font-weight: 700;
    }

    .hourly-rain-value,
    .hourly-wind-value,
    .hourly-prob-value {
        font-size: 11.5px;
        font-weight: 600;
    }

    /* Dark Mode */
    body.dark-mode .weather-model-selector {
        background: #202324;
        border-color: #313538;
    }

    body.dark-mode .weather-model-current-badge {
        background: #1c2b3c;
        color: #8ec5f5;
    }

    body.dark-mode .weather-model-option {
        background: #272a2c !important;
        border-color: #3a3d3f !important;
    }

    body.dark-mode .weather-model-option:hover {
        background: #2f3336 !important;
        border-color: #4f5356 !important;
    }

    body.dark-mode .weather-model-sub-badge {
        background: #1e2022;
        color: #94a3b8;
    }

    body.dark-mode .weather-model-option.active,
    body.dark-mode .weather-model-option:has(input:checked) {
        background: #1a2c3f !important;
        border-color: #4d8bc9 !important;
        box-shadow: 0 0 0 1px #4d8bc9, 0 3px 8px rgba(77, 139, 201, 0.25) !important;
    }

    body.dark-mode .weather-model-option.active .weather-model-name,
    body.dark-mode .weather-model-option:has(input:checked) .weather-model-name {
        color: #8ec5f5;
    }

    body.dark-mode .weather-model-option.active .weather-model-sub-badge,
    body.dark-mode .weather-model-option:has(input:checked) .weather-model-sub-badge {
        background: #183350;
        color: #93c5fd;
    }

    body.dark-mode .hourly-forecast-wrapper {
        border-top-color: #313538;
    }

    body.dark-mode .hourly-jump-btn {
        background: #272a2c;
        border-color: #3a3d3f;
        color: #e2e8f0;
    }

    body.dark-mode .hourly-jump-btn:hover {
        background: #35383a;
    }

    body.dark-mode .hourly-table-scroll-container {
        background: #202324;
        border-color: #313538;
    }

    body.dark-mode .hourly-th-cell,
    body.dark-mode .hourly-td-cell {
        border-bottom-color: #313538;
        border-left-color: #313538;
    }

    body.dark-mode .hourly-forecast-table thead tr th.hourly-th-cell {
        background: #272a2c;
        color: #e5e5e5;
    }

    body.dark-mode .hourly-th-cell.hour-night {
        background: #1c1f21;
    }

    body.dark-mode .hourly-th-cell.hour-day {
        background: #252824;
    }

    body.dark-mode .hourly-sticky-col {
        background: #2b2e30 !important;
        color: #e5e5e5 !important;
        border-bottom-color: #313538 !important;
        border-left-color: #3a3d3f !important;
        box-shadow: -3px 0 6px rgba(0, 0, 0, 0.3);
    }

    body.dark-mode .hourly-chart-td {
        background: #202324;
    }

    body.dark-mode .temp-val-cold {
        color: #64b5f6;
        background: rgba(33, 150, 243, 0.12);
    }

    body.dark-mode .temp-val-warm {
        color: #ef5350;
        background: rgba(239, 83, 80, 0.12);
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

function createWeatherModelSelector() {
    const selector = document.createElement("div");
    selector.className = "weather-model-selector";

    const title = document.createElement("div");
    title.className = "weather-model-selector-title";
    title.innerHTML = `
        <div class="weather-model-title-left">
            <span class="weather-model-heading">مدل‌های هواشناسی</span>
            <span class="weather-model-current-badge">${escapeHtml(getSelectedWeatherModelName())}</span>
        </div>
        <span class="weather-model-scroll-hint">↔ برای دیدن تمام مدل‌ها اسکرول کنید</span>
    `;
    selector.appendChild(title);

    const options = document.createElement("div");
    options.className = "weather-model-options";

    WEATHER_MODELS.forEach(model => {
        const label = document.createElement("label");
        const isActive = model.id === selectedWeatherModel;
        label.className = "weather-model-option" + (isActive ? " active" : "");
        label.setAttribute("title", model.name + " - " + (model.sub || ""));

        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "weather-model";
        radio.value = model.id;
        radio.checked = isActive;

        radio.addEventListener("change", () => {
            if (!radio.checked) return;
            if (selectedWeatherModel === model.id) return;
            selectedWeatherModel = model.id;

            selector.querySelectorAll(".weather-model-option").forEach(opt => opt.classList.remove("active"));
            label.classList.add("active");

            const badge = selector.querySelector(".weather-model-current-badge");
            if (badge) badge.textContent = model.name;

            reloadWeatherForecasts();
        });

        label.innerHTML = `
            <div class="weather-model-card-inner">
                <div class="weather-model-header-row">
                    <span class="weather-model-radio-circle"></span>
                    <strong class="weather-model-name">${escapeHtml(model.name)}</strong>
                </div>
                <div class="weather-model-sub-badge">${escapeHtml(model.sub || "")}</div>
            </div>
        `;
        label.prepend(radio);
        options.appendChild(label);
    });

    selector.appendChild(options);
    return selector;
}

function ensureWeatherModelSelector() {
    const cardsContainer = document.getElementById("weather-cards");
    if (!cardsContainer) return;

    let selector = document.querySelector("#weather-container .weather-model-selector");
    if (!selector) {
        selector = createWeatherModelSelector();
        cardsContainer.parentNode.insertBefore(selector, cardsContainer);
    }

    const selectedRadio = selector.querySelector(
        `input[name="weather-model"][value="${selectedWeatherModel}"]`
    );
    if (selectedRadio) selectedRadio.checked = true;
}

function ensureWeatherRouteFilterBar(results) {
    const cardsContainer = document.getElementById("weather-cards");
    if (!cardsContainer) return;

    let filterBar = document.getElementById("weather-route-filter-bar");
    if (!filterBar) {
        filterBar = document.createElement("div");
        filterBar.id = "weather-route-filter-bar";
        filterBar.className = "weather-route-filter-bar";
        cardsContainer.parentNode.insertBefore(filterBar, cardsContainer);
    }

    if (!Array.isArray(results) || results.length <= 1) {
        filterBar.style.display = "none";
        selectedWeatherRouteFilter = "all";
        return;
    }

    filterBar.style.display = "flex";
    filterBar.innerHTML = "";

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "weather-route-filter-btn" + (selectedWeatherRouteFilter === "all" ? " active" : "");
    allBtn.textContent = `همه قله‌ها (${results.length})`;
    allBtn.addEventListener("click", () => {
        selectedWeatherRouteFilter = "all";
        renderWeatherCardsVisibility();
    });
    filterBar.appendChild(allBtn);

    results.forEach((r, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "weather-route-filter-btn" + (selectedWeatherRouteFilter === r.route ? " active" : "");
        btn.textContent = `${idx + 1}. ${r.route}`;
        btn.addEventListener("click", () => {
            selectedWeatherRouteFilter = r.route;
            renderWeatherCardsVisibility();
        });
        filterBar.appendChild(btn);
    });
}

function renderWeatherCardsVisibility() {
    const cards = document.querySelectorAll("#weather-cards .weather-card");
    cards.forEach(card => {
        const routeName = card.dataset.route;
        if (selectedWeatherRouteFilter === "all" || selectedWeatherRouteFilter === routeName) {
            card.style.display = "block";
        } else {
            card.style.display = "none";
        }
    });

    document.querySelectorAll(".weather-route-filter-btn").forEach(btn => {
        if (
            (selectedWeatherRouteFilter === "all" && btn.textContent.startsWith("همه")) ||
            btn.textContent.includes(selectedWeatherRouteFilter)
        ) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

function getRouteSummitPoint(routeData) {
    if (!routeData || !Array.isArray(routeData.points) || routeData.points.length === 0) {
        return null;
    }

    let highestPoint = null;
    for (const point of routeData.points) {
        const latitude = Number(point.latitude);
        const longitude = Number(point.longitude);
        const elevation = Number(point.elevation);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(elevation)) {
            continue;
        }

        if (highestPoint === null || elevation > highestPoint.elevation) {
            highestPoint = { latitude, longitude, elevation };
        }
    }
    return highestPoint;
}

function buildWeatherApiUrl(summitPoint) {
    const params = new URLSearchParams();
    params.set("latitude", summitPoint.latitude.toString());
    params.set("longitude", summitPoint.longitude.toString());
    params.set("elevation", summitPoint.elevation.toString());

    const apiModel = getSelectedWeatherModelApiId();
    if (apiModel) params.set("models", apiModel);

    params.set("hourly", WEATHER_HOURLY_VARIABLES.join(","));
    params.set("daily", WEATHER_DAILY_VARIABLES.join(","));
    params.set("forecast_days", WEATHER_FORECAST_DAYS.toString());
    params.set("timezone", WEATHER_TIMEZONE);
    params.set("temperature_unit", "celsius");
    params.set("wind_speed_unit", "kmh");
    params.set("precipitation_unit", "mm");

    return `${WEATHER_API_URL}?${params.toString()}`;
}

async function fetchSummitWeather(summitPoint) {
    if (!summitPoint) throw new Error("Summit point is not available.");
    const url = buildWeatherApiUrl(summitPoint);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Weather API error: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (
        !data ||
        !data.hourly ||
        !Array.isArray(data.hourly.time) ||
        !data.daily ||
        !Array.isArray(data.daily.time)
    ) {
        throw new Error("Invalid weather API response.");
    }

    return data;
}

async function getRouteWeather(result) {
    if (!result || !result.routeData) throw new Error("Route data is not available.");
    const summitPoint = getRouteSummitPoint(result.routeData);
    if (!summitPoint) throw new Error("Could not determine summit point.");

    const weather = await fetchSummitWeather(summitPoint);
    return {
        route: result.route,
        summit: summitPoint,
        weather: weather
    };
}

function getWeatherDateObject(dateString) {
    return new Date(`${dateString}T12:00:00Z`);
}

function formatWeatherWeekday(dateString) {
    return new Intl.DateTimeFormat("fa-IR", {
        weekday: "long",
        timeZone: "UTC"
    }).format(getWeatherDateObject(dateString));
}

function formatWeatherJalaliDate(dateString) {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
        day: "numeric",
        month: "long",
        timeZone: "UTC"
    }).format(getWeatherDateObject(dateString));
}

function formatWeatherTime(timeString) {
    return timeString.substring(11, 16);
}

function getWeatherDateKey(timeString) {
    return timeString.substring(0, 10);
}

function groupWeatherByDay(weatherData) {
    const hourly = weatherData.hourly || {};
    const result = {};
    const times = hourly.time || [];
    const temperatures = hourly.temperature_2m || [];
    const windSpeeds = hourly.wind_speed_10m || [];
    const precipitation = hourly.precipitation || [];
    const probabilities = hourly.precipitation_probability || [];
    const weatherCodes = hourly.weather_code || [];

    for (let i = 0; i < times.length; i++) {
        const time = times[i];
        const dateKey = getWeatherDateKey(time);
        if (!result[dateKey]) result[dateKey] = [];
        result[dateKey].push({
            time: time,
            temperature: temperatures[i],
            windSpeed: windSpeeds[i],
            precipitation: precipitation[i],
            probability: probabilities[i] !== undefined ? probabilities[i] : null,
            weatherCode: weatherCodes[i] !== undefined ? weatherCodes[i] : null
        });
    }
    return result;
}

function buildDailyWeather(weatherData) {
    const daily = weatherData.daily || {};
    const dates = daily.time || [];
    const codes = daily.weather_code || [];
    const maxTemps = daily.temperature_2m_max || [];
    const minTemps = daily.temperature_2m_min || [];
    const winds = daily.wind_speed_10m_max || [];
    const probabilities = daily.precipitation_probability_max || [];

    return dates.map((date, i) => ({
        date: date,
        code: codes[i],
        maxTemp: toWeatherNumber(maxTemps[i]),
        minTemp: toWeatherNumber(minTemps[i]),
        wind: toWeatherNumber(winds[i]),
        probability: toWeatherNumber(probabilities[i])
    }));
}

function formatWeatherValue(value, digits = 0) {
    return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function createWeatherCard(weatherResult) {
    const card = document.createElement("div");
    card.className = "weather-card";
    card.dataset.route = weatherResult.route;

    const routeName = escapeHtml(weatherResult.route);
    const summit = weatherResult.summit;
    const weather = weatherResult.weather;

    const summitElevation = Number(summit.elevation);
    const apiElevation = Number(weather.elevation);

    const elevationText = Number.isFinite(summitElevation) ? Math.round(summitElevation) : "-";
    const apiElevationText = Number.isFinite(apiElevation) ? Math.round(apiElevation) : "-";

    let elevationDifferenceText = "-";
    if (Number.isFinite(summitElevation) && Number.isFinite(apiElevation)) {
        const difference = apiElevation - summitElevation;
        if (difference === 0) {
            elevationDifferenceText = "0 متر";
        } else {
            const sign = difference > 0 ? "+" : "";
            elevationDifferenceText = `${sign}${Math.round(difference)} متر`;
        }
    }

    const latitude = Number(summit.latitude);
    const longitude = Number(summit.longitude);

    card.innerHTML = `
        <div class="weather-card-header">
            <div class="weather-route-title">
                🏔️ قله ${routeName}
            </div>
            <div class="weather-summit-info">
                <span>ارتفاع قله: <strong>${elevationText}</strong> m</span>
                <span>ارتفاع مدل: <strong>${apiElevationText}</strong> m</span>
                <span>اختلاف: <strong>${elevationDifferenceText}</strong></span>
                <span>مدل: <strong>${escapeHtml(getSelectedWeatherModelName())}</strong></span>
                <span>مختصات: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}</span>
            </div>
        </div>
        <div class="weather-daily-row"></div>
        <div class="weather-hourly-panel"></div>
    `;

    const dailyRow = card.querySelector(".weather-daily-row");
    const hourlyPanel = card.querySelector(".weather-hourly-panel");
    const dailyData = buildDailyWeather(weather);
    const hourlyByDay = groupWeatherByDay(weather);

    let openDate = null;
    const items = [];

    function updateActiveState() {
        items.forEach(entry => {
            const isActive = entry.date === openDate;
            entry.element.classList.toggle("active", isActive);
            entry.button.classList.toggle("active", isActive);
            entry.button.textContent = isActive ? "بستن ساعتی" : "پیش‌بینی ساعتی";
        });
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
        hourlyPanel.appendChild(createHourlyPanelContent(dateKey, hourlyByDay[dateKey] || []));
        hourlyPanel.style.display = "block";
        updateActiveState();
    }

    dailyData.forEach(day => {
        const element = createDailyDayElement(day);
        const button = element.querySelector(".weather-hourly-button");
        button.addEventListener("click", () => toggleHourly(day.date));
        dailyRow.appendChild(element);
        items.push({ date: day.date, element, button });
    });

    return card;
}

function createDailyDayElement(day) {
    const info = getWeatherCodeInfo(day.code);
    const element = document.createElement("div");
    element.className = "weather-daily-item";

    element.innerHTML = `
        <div class="weather-daily-weekday">${formatWeatherWeekday(day.date)}</div>
        <div class="weather-daily-date">${formatWeatherJalaliDate(day.date)}</div>
        <div class="weather-daily-icon">${info.icon}</div>
        <div class="weather-daily-condition">${info.name}</div>
        <div class="weather-daily-temp max" title="بیشینه دما">
            <span class="arrow">↑</span>
            <span class="value">${formatWeatherValue(day.maxTemp)}°</span>
        </div>
        <div class="weather-daily-temp min" title="کمینه دما">
            <span class="arrow">↓</span>
            <span class="value">${formatWeatherValue(day.minTemp)}°</span>
        </div>
        <div class="weather-daily-extra" title="بیشینه سرعت باد">
            <span>💨</span>
            <span class="ltr">${formatWeatherValue(day.wind)} km/h</span>
        </div>
        <div class="weather-daily-extra" title="احتمال بارش">
            <span>☔</span>
            <span class="ltr">${Number.isFinite(day.probability) ? Math.round(day.probability) + "%" : "-"}</span>
        </div>
        <button type="button" class="weather-hourly-button">پیش‌بینی ساعتی</button>
    `;
    return element;
}

function createHourlyPanelContent(dateKey, hourlyData) {
    const wrapper = document.createElement("div");
    wrapper.className = "hourly-forecast-wrapper";

    if (!Array.isArray(hourlyData) || hourlyData.length === 0) {
        wrapper.innerHTML = `<div class="weather-day-title">داده ساعتی برای این روز موجود نیست</div>`;
        return wrapper;
    }

    const title = `پیش‌بینی ساعتی ۲۴ ساعته (${formatWeatherWeekday(dateKey)} ${formatWeatherJalaliDate(dateKey)})`;

    wrapper.innerHTML = `
        <div class="hourly-forecast-header">
            <div class="hourly-header-info">
                <h4 class="hourly-forecast-title">${title}</h4>
                <span class="hourly-forecast-hint">↔ جدول افقی (به چپ و راست بکشید)</span>
            </div>
            <div class="hourly-quick-jumps">
                <span class="hourly-jump-label">پرش به:</span>
                <button type="button" class="hourly-jump-btn" data-hour="0">۰۰:۰۰ بامداد</button>
                <button type="button" class="hourly-jump-btn" data-hour="6">۰۶:۰۰ صبح</button>
                <button type="button" class="hourly-jump-btn" data-hour="12">۱۲:۰۰ ظهر</button>
                <button type="button" class="hourly-jump-btn" data-hour="18">۱۸:۰۰ عصر</button>
            </div>
        </div>

        <div class="hourly-table-scroll-container">
            <table class="hourly-forecast-table" dir="rtl">
                <colgroup>
                    <col style="width: 96px; min-width: 96px; max-width: 96px;">
                    ${hourlyData.map(() => '<col style="width: 64px; min-width: 64px; max-width: 64px;">').join("")}
                </colgroup>
                <thead>
                    <tr>
                        <th class="hourly-sticky-col">ساعت</th>
                        ${hourlyData.map((hour, idx) => {
                            const timeStr = formatWeatherTime(hour.time);
                            const hourNum = parseInt(timeStr.split(":")[0], 10);
                            const isNight = hourNum < 6 || hourNum >= 19;
                            return `
                                <th class="hourly-th-cell ${isNight ? 'hour-night' : 'hour-day'}" data-index="${idx}">
                                    <div class="hourly-cell-time">${timeStr}</div>
                                    <div class="hourly-cell-phase">${isNight ? '🌙' : '☀️'}</div>
                                </th>
                            `;
                        }).join("")}
                    </tr>
                </thead>
                <tbody>
                    <tr class="hourly-row-condition">
                        <th class="hourly-sticky-col">وضعیت</th>
                        ${hourlyData.map(hour => {
                            const info = getWeatherCodeInfo(hour.weatherCode);
                            return `
                                <td class="hourly-td-cell" title="${info.name}">
                                    <span class="hourly-table-icon">${info.icon}</span>
                                    <div class="hourly-table-cond-name">${info.name}</div>
                                </td>
                            `;
                        }).join("")}
                    </tr>

                    <tr class="hourly-row-temp">
                        <th class="hourly-sticky-col">🌡️ دما</th>
                        ${hourlyData.map(hour => {
                            const temp = toWeatherNumber(hour.temperature);
                            const isCold = temp < 0;
                            return `
                                <td class="hourly-td-cell ${isCold ? 'temp-val-cold' : 'temp-val-warm'}">
                                    <strong class="hourly-temp-value">${Number.isFinite(temp) ? Math.round(temp) + '°' : '-'}</strong>
                                </td>
                            `;
                        }).join("")}
                    </tr>

                    <tr class="hourly-row-chart">
                        <th class="hourly-sticky-col">روند دما</th>
                        <td colspan="${hourlyData.length}" class="hourly-chart-td">
                            ${createTemperatureChart(hourlyData)}
                        </td>
                    </tr>

                    <tr class="hourly-row-rain">
                        <th class="hourly-sticky-col">🌧️ بارش (mm)</th>
                        ${hourlyData.map(hour => {
                            const rain = toWeatherNumber(hour.precipitation);
                            const bg = getRainCellColor(rain);
                            return `
                                <td class="hourly-td-cell" style="background:${bg};" title="بارش: ${Number.isFinite(rain) ? rain.toFixed(1) : '-'} mm">
                                    <span class="hourly-rain-value">${Number.isFinite(rain) ? (rain > 0 ? rain.toFixed(1) : '۰') : '-'}</span>
                                </td>
                            `;
                        }).join("")}
                    </tr>

                    <tr class="hourly-row-prob">
                        <th class="hourly-sticky-col">☔ احتمال بارش</th>
                        ${hourlyData.map(hour => {
                            const prob = toWeatherNumber(hour.probability);
                            return `
                                <td class="hourly-td-cell" title="احتمال بارش: ${Number.isFinite(prob) ? Math.round(prob) + '%' : '-'}">
                                    <span class="hourly-prob-value">${Number.isFinite(prob) ? Math.round(prob) + '%' : '-'}</span>
                                </td>
                            `;
                        }).join("")}
                    </tr>

                    <tr class="hourly-row-wind">
                        <th class="hourly-sticky-col">💨 باد (km/h)</th>
                        ${hourlyData.map(hour => {
                            const wind = toWeatherNumber(hour.windSpeed);
                            const bg = getWindCellColor(wind);
                            return `
                                <td class="hourly-td-cell" style="background:${bg};" title="سرعت باد: ${Number.isFinite(wind) ? Math.round(wind) : '-'} km/h">
                                    <span class="hourly-wind-value">${Number.isFinite(wind) ? Math.round(wind) : '-'}</span>
                                </td>
                            `;
                        }).join("")}
                    </tr>
                </tbody>
            </table>
        </div>
    `;

    // Hook up quick jump buttons
    const scrollContainer = wrapper.querySelector(".hourly-table-scroll-container");
    const jumpButtons = wrapper.querySelectorAll(".hourly-jump-btn");
    jumpButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetHour = parseInt(btn.dataset.hour, 10);
            let targetIdx = 0;
            for (let i = 0; i < hourlyData.length; i++) {
                const hourNum = parseInt(formatWeatherTime(hourlyData[i].time).split(":")[0], 10);
                if (hourNum >= targetHour) {
                    targetIdx = i;
                    break;
                }
            }
            if (scrollContainer) {
                const thCells = scrollContainer.querySelectorAll("th.hourly-th-cell");
                if (thCells[targetIdx]) {
                    thCells[targetIdx].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
                }
            }
        });
    });

    return wrapper;
}

function createTemperatureChart(hourlyData) {
    if (!Array.isArray(hourlyData) || hourlyData.length === 0) {
        return `<div class="weather-temperature-empty">داده‌ای وجود ندارد</div>`;
    }

    const cellWidth = 64;
    const width = Math.max(hourlyData.length * cellWidth, cellWidth);
    const height = 76;
    const topPadding = 16;
    const bottomPadding = 12;
    const chartHeight = height - topPadding - bottomPadding;

    const temperatures = hourlyData.map(item => {
        const value = toWeatherNumber(item.temperature);
        return Number.isFinite(value) ? value : null;
    });

    const validTemperatures = temperatures.filter(v => v !== null);
    if (validTemperatures.length === 0) {
        return `<div class="weather-temperature-empty">داده دما موجود نیست</div>`;
    }

    let minTemperature = Math.min(...validTemperatures, 0);
    let maxTemperature = Math.max(...validTemperatures, 0);
    const range = Math.max(maxTemperature - minTemperature, 1);
    const zeroY = topPadding + (maxTemperature / range) * chartHeight;

    const points = temperatures.map((temperature, index) => {
        if (temperature === null) return null;
        // In RTL table, index 0 is at the right edge
        const x = width - (index + 0.5) * cellWidth;
        const y = topPadding + ((maxTemperature - temperature) / range) * chartHeight;
        return { x, y, temperature };
    });

    const lineSegments = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        if (!p1 || !p2) continue;

        if (p1.temperature < 0 && p2.temperature < 0) {
            lineSegments.push(`
                <line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" class="temperature-line temperature-line-cold" />
            `);
            continue;
        }

        if (p1.temperature >= 0 && p2.temperature >= 0) {
            lineSegments.push(`
                <line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" class="temperature-line temperature-line-warm" />
            `);
            continue;
        }

        const fraction = (0 - p1.temperature) / (p2.temperature - p1.temperature);
        const zeroX = p1.x + (p2.x - p1.x) * fraction;
        const firstClass = p1.temperature < 0 ? "temperature-line-cold" : "temperature-line-warm";
        const secondClass = p2.temperature < 0 ? "temperature-line-cold" : "temperature-line-warm";

        lineSegments.push(`
            <line x1="${p1.x}" y1="${p1.y}" x2="${zeroX}" y2="${zeroY}" class="temperature-line ${firstClass}" />
            <line x1="${zeroX}" y1="${zeroY}" x2="${p2.x}" y2="${p2.y}" class="temperature-line ${secondClass}" />
        `);
    }

    const labels = points.map(point => {
        if (!point) return "";
        const cold = point.temperature < 0;
        return `
            <text x="${point.x}" y="${Math.max(point.y - 7, 12)}" class="temperature-value ${cold ? "temperature-value-cold" : "temperature-value-warm"}" text-anchor="middle">
                ${Math.round(point.temperature)}°
            </text>
        `;
    }).join("");

    const pointsMarkup = points.map(point => {
        if (!point) return "";
        return `
            <circle cx="${point.x}" cy="${point.y}" r="3" class="temperature-point ${point.temperature < 0 ? "temperature-point-cold" : "temperature-point-warm"}" />
        `;
    }).join("");

    return `
        <svg class="temperature-chart" viewBox="0 0 ${width} ${height}" style="width:${width}px; height:${height}px; display:block;" preserveAspectRatio="none" role="img" aria-label="نمودار دمای ساعتی">
            <line x1="0" y1="${zeroY}" x2="${width}" y2="${zeroY}" class="temperature-zero-line" />
            ${lineSegments.join("")}
            ${labels}
            ${pointsMarkup}
        </svg>
    `;
}

function getWindCellColor(windSpeed) {
    if (!Number.isFinite(windSpeed) || windSpeed <= 0) return "transparent";
    if (windSpeed < 15) return "rgba(255, 193, 7, 0.10)";
    if (windSpeed < 25) return "rgba(255, 193, 7, 0.28)";
    if (windSpeed < 40) return "rgba(255, 152, 0, 0.48)";
    if (windSpeed < 55) return "rgba(244, 81, 30, 0.58)";
    return "rgba(198, 40, 40, 0.72)";
}

function getRainCellColor(precipitation) {
    if (!Number.isFinite(precipitation) || precipitation <= 0) return "transparent";
    const intensity = Math.min(precipitation / 8, 1);
    const alpha = 0.16 + intensity * 0.62;
    return `rgba(30, 136, 229, ${alpha})`;
}

async function reloadWeatherForecasts() {
    if (!Array.isArray(currentWeatherResults) || currentWeatherResults.length === 0) return;
    const generation = ++weatherRequestGeneration;
    await drawWeatherForecasts(currentWeatherResults, generation);
}

async function drawWeatherForecasts(results, requestGeneration = null) {
    injectDailyWeatherStyles();

    const container = document.getElementById("weather-container");
    const cardsContainer = document.getElementById("weather-cards");
    if (!container || !cardsContainer) return;

    if (Array.isArray(results)) {
        currentWeatherResults = results;
    }

    if (!Array.isArray(results) || results.length === 0) {
        container.style.display = "none";
        return;
    }

    container.style.display = "block";
    ensureWeatherModelSelector();
    ensureWeatherRouteFilterBar(results);

    cardsContainer.innerHTML = "";
    const generation = requestGeneration !== null ? requestGeneration : ++weatherRequestGeneration;

    for (const result of results) {
        if (generation !== weatherRequestGeneration) return;

        const loading = document.createElement("div");
        loading.className = "weather-card weather-loading";
        loading.dataset.route = result.route;
        loading.innerHTML = `
            <div class="weather-loading-text">
                در حال دریافت پیش‌بینی هوای قله <strong>${escapeHtml(result.route)}</strong>...
            </div>
        `;
        cardsContainer.appendChild(loading);

        try {
            const weatherResult = await getRouteWeather(result);
            if (generation !== weatherRequestGeneration) return;
            const card = createWeatherCard(weatherResult);
            loading.replaceWith(card);
        } catch (error) {
            if (generation !== weatherRequestGeneration) return;
            loading.className = "weather-card weather-error";
            loading.innerHTML = `
                <div class="weather-error-title">دریافت پیش‌بینی هوا ناموفق بود</div>
                <div class="weather-error-route">${escapeHtml(result.route)}</div>
                <div class="weather-error-message">${escapeHtml(error.message)}</div>
            `;
        }
    }

    renderWeatherCardsVisibility();
}

function clearWeatherForecasts() {
    weatherRequestGeneration++;
    currentWeatherResults = [];
    const container = document.getElementById("weather-container");
    const cardsContainer = document.getElementById("weather-cards");
    if (cardsContainer) cardsContainer.innerHTML = "";
    if (container) container.style.display = "none";
}
