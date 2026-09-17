/* =========================================================
   Speed calculation
   ========================================================= */

const SPEED_SMOOTHING_WINDOW = 5;


const SPEED_COLORS = {

    verySlow:
        "#b2182b",

    slow:
        "#ef8a62",

    moderate:
        "#fddbc7",

    fast:
        "#fee08b",

    veryFast:
        "#a6d96a",

    fastest:
        "#1a9850",

    noData:
        "#888888"

};


const SPEED_LEGEND_ITEMS = [

    {
        max: 1.5,
        label: "کمتر از ۱.۵",
        color: SPEED_COLORS.verySlow
    },

    {
        max: 2.5,
        label: "۱.۵ تا ۲.۵",
        color: SPEED_COLORS.slow
    },

    {
        max: 3.5,
        label: "۲.۵ تا ۳.۵",
        color: SPEED_COLORS.moderate
    },

    {
        max: 4.5,
        label: "۳.۵ تا ۴.۵",
        color: SPEED_COLORS.fast
    },

    {
        max: 5.5,
        label: "۴.۵ تا ۵.۵",
        color: SPEED_COLORS.veryFast
    },

    {
        max: Infinity,
        label: "۵.۵ و بیشتر",
        color: SPEED_COLORS.fastest
    },

    {
        max: null,
        label: "بدون زمان",
        color: SPEED_COLORS.noData,
        noData: true
    }

];


function haversineDistance(
    lat1,
    lon1,
    lat2,
    lon2
) {

    const R = 6371000;


    const lat1Rad =
        lat1 *
        Math.PI /
        180;


    const lat2Rad =
        lat2 *
        Math.PI /
        180;


    const deltaLat =
        (lat2 - lat1) *
        Math.PI /
        180;


    const deltaLon =
        (lon2 - lon1) *
        Math.PI /
        180;


    const a =

        Math.sin(
            deltaLat / 2
        ) ** 2

        +

        Math.cos(
            lat1Rad
        )

        *

        Math.cos(
            lat2Rad
        )

        *

        Math.sin(
            deltaLon / 2
        ) ** 2;


    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );


    return R * c;

}


function calculate3DDistance(
    point1,
    point2
) {

    const horizontalDistance =
        haversineDistance(

            Number(
                point1.latitude
            ),

            Number(
                point1.longitude
            ),

            Number(
                point2.latitude
            ),

            Number(
                point2.longitude
            )

        );


    const elevation1 =
        Number(
            point1.elevation
        );


    const elevation2 =
        Number(
            point2.elevation
        );


    const safeElevation1 =
        Number.isFinite(
            elevation1
        )
            ? elevation1
            : 0;


    const safeElevation2 =
        Number.isFinite(
            elevation2
        )
            ? elevation2
            : 0;


    const verticalDistance =
        safeElevation2 -
        safeElevation1;


    return Math.sqrt(

        horizontalDistance *
        horizontalDistance

        +

        verticalDistance *
        verticalDistance

    );

}


function getPointTimestamp(point) {

    if (
        !point ||
        point.time === undefined ||
        point.time === null
    ) {

        return null;

    }


    if (
        point.time instanceof Date
    ) {

        const value =
            point.time.getTime();


        return Number.isFinite(value)
            ? value
            : null;

    }


    if (
        typeof point.time === "number"
    ) {

        return Number.isFinite(point.time)
            ? point.time
            : null;

    }


    const date =
        new Date(
            point.time
        );


    const timestamp =
        date.getTime();


    return Number.isFinite(timestamp)
        ? timestamp
        : null;

}


function calculateRawSpeed(
    point1,
    point2
) {

    const timestamp1 =
        getPointTimestamp(
            point1
        );


    const timestamp2 =
        getPointTimestamp(
            point2
        );


    if (
        timestamp1 === null ||
        timestamp2 === null
    ) {

        return null;

    }


    const elapsedSeconds =
        (
            timestamp2 -
            timestamp1
        ) / 1000;


    if (
        !Number.isFinite(elapsedSeconds) ||
        elapsedSeconds <= 0
    ) {

        return null;

    }


    const distance3D =
        calculate3DDistance(
            point1,
            point2
        );


    if (
        !Number.isFinite(distance3D) ||
        distance3D < 0
    ) {

        return null;

    }


    const speed =
        (
            distance3D /
            elapsedSeconds
        ) * 3.6;


    return Number.isFinite(speed)
        ? speed
        : null;

}


function smoothSpeeds(
    rawSpeeds,
    windowSize
) {

    if (
        !Array.isArray(rawSpeeds) ||
        rawSpeeds.length === 0
    ) {

        return [];

    }


    let size =
        Number(
            windowSize
        );


    if (
        !Number.isFinite(size) ||
        size < 1
    ) {

        size = 1;

    }


    size =
        Math.floor(size);


    if (
        size % 2 === 0
    ) {

        size += 1;

    }


    const half =
        Math.floor(
            size / 2
        );


    return rawSpeeds.map(
        (
            currentSpeed,
            index
        ) => {

            const values = [];


            const start =
                Math.max(
                    0,
                    index - half
                );


            const end =
                Math.min(
                    rawSpeeds.length - 1,
                    index + half
                );


            for (
                let i = start;
                i <= end;
                i++
            ) {

                const value =
                    rawSpeeds[i];


                if (
                    value !== null &&
                    Number.isFinite(value)
                ) {

                    values.push(
                        value
                    );

                }

            }


            if (
                values.length === 0
            ) {

                return null;

            }


            const sum =
                values.reduce(
                    (
                        total,
                        value
                    ) =>
                        total + value,
                    0
                );


            return (
                sum /
                values.length
            );

        }
    );

}


function calculateRouteSpeeds(points) {

    if (
        !Array.isArray(points) ||
        points.length < 2
    ) {

        return [];

    }


    const rawSpeeds = [];


    for (
        let i = 0;
        i < points.length - 1;
        i++
    ) {

        rawSpeeds.push(
            calculateRawSpeed(
                points[i],
                points[i + 1]
            )
        );

    }


    const smoothedSpeeds =
        smoothSpeeds(
            rawSpeeds,
            SPEED_SMOOTHING_WINDOW
        );


    return rawSpeeds.map(
        (
            rawSpeed,
            index
        ) => {

            const distance3D =
                calculate3DDistance(
                    points[index],
                    points[index + 1]
                );


            const timestamp1 =
                getPointTimestamp(
                    points[index]
                );


            const timestamp2 =
                getPointTimestamp(
                    points[index + 1]
                );


            let elapsedSeconds = null;


            if (
                timestamp1 !== null &&
                timestamp2 !== null
            ) {

                elapsedSeconds =
                    (
                        timestamp2 -
                        timestamp1
                    ) / 1000;

            }


            return {

                rawSpeed:
                    rawSpeed,

                speed:
                    smoothedSpeeds[index],

                distance3D:
                    distance3D,

                elapsedSeconds:
                    elapsedSeconds

            };

        }
    );

}


/* =========================================================
   Speed color
   ========================================================= */

function getSpeedColor(speed) {

    if (
        speed === null ||
        !Number.isFinite(speed)
    ) {

        return SPEED_COLORS.noData;

    }


    if (speed < 1.5) {

        return SPEED_COLORS.verySlow;

    }


    if (speed < 2.5) {

        return SPEED_COLORS.slow;

    }


    if (speed < 3.5) {

        return SPEED_COLORS.moderate;

    }


    if (speed < 4.5) {

        return SPEED_COLORS.fast;

    }


    if (speed < 5.5) {

        return SPEED_COLORS.veryFast;

    }


    return SPEED_COLORS.fastest;

}


/* =========================================================
   Speed legend
   ========================================================= */

function createSpeedLegend(container) {

    if (!container) {

        return;

    }


    const existing =
        container.querySelector(
            ".speed-legend"
        );


    if (existing) {

        existing.remove();

    }


    const legend =
        document.createElement(
            "div"
        );


    legend.className =
        "speed-legend";


    const itemsHtml =
        SPEED_LEGEND_ITEMS
            .map(
                item => `

                    <div class="speed-legend-item">

                        <span
                            class="speed-legend-color"
                            style="background:${item.color};"
                        ></span>

                        <span>
                            ${item.label}
                        </span>

                    </div>

                `
            )
            .join("");


    legend.innerHTML = `

        <div class="speed-legend-title">
            سرعت حرکت
        </div>

        ${itemsHtml}

        <div class="speed-legend-smoothing">
            هموارسازی: ۵ سگمنت
        </div>

    `;


    container.appendChild(
        legend
    );

}