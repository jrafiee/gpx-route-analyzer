/**
 * Route profile analysis.
 *
 * JavaScript equivalent of profiles.py
 */

/**
 * Actual elevation profile.
 *
 * Returns:
 * {
 *     distance_km: [...],
 *     elevation_m: [...]
 * }
 */
function getElevationProfile(route) {
    const { distance, elevation } = extractRouteProfile(route);

    return {
        distance_km: distance.map(d => d / 1000),
        elevation_m: elevation
    };
}


/**
 * Elevation profile with normalized distance.
 *
 * Distance is normalized between 0 and 1.
 */
function getNormalizedElevationProfile(route) {
    const { distance, elevation } = extractRouteProfile(route);

    const totalDistance = distance[distance.length - 1];

    let normalizedDistance;

    if (totalDistance > 0) {
        normalizedDistance = distance.map(
            d => d / totalDistance
        );
    } else {
        normalizedDistance = distance.map(() => 0);
    }

    return {
        distance: normalizedDistance,
        elevation_m: elevation
    };
}


/**
 * Elevation gain relative to starting elevation.
 */
function getElevationGainProfile(route) {
    const { distance, elevation } = extractRouteProfile(route);

    const startingElevation = elevation[0];

    const elevationGain = elevation.map(
        e => e - startingElevation
    );

    return {
        distance_km: distance.map(d => d / 1000),
        elevation_gain_m: elevationGain
    };
}


/**
 * Elevation gain with normalized distance.
 */
function getNormalizedElevationGainProfile(route) {
    const { distance, elevation } = extractRouteProfile(route);

    const totalDistance = distance[distance.length - 1];

    let normalizedDistance;

    if (totalDistance > 0) {
        normalizedDistance = distance.map(
            d => d / totalDistance
        );
    } else {
        normalizedDistance = distance.map(() => 0);
    }

    const startingElevation = elevation[0];

    const elevationGain = elevation.map(
        e => e - startingElevation
    );

    return {
        distance: normalizedDistance,
        elevation_gain_m: elevationGain
    };
}

function calculateRouteMetrics(route) {
    // Extract cumulative distance and raw elevation
    const { distance, elevation } =
        extractRouteProfile(route);

    // --------------------------------------------------
    // Elevation changes
    // --------------------------------------------------

    const elevationDiff = [];

    for (let i = 1; i < elevation.length; i++) {
        elevationDiff.push(
            elevation[i] - elevation[i - 1]
        );
    }

    // --------------------------------------------------
    // Total ascent
    // --------------------------------------------------

    let totalAscent = 0;

    for (const diff of elevationDiff) {
        if (diff > 0) {
            totalAscent += diff;
        }
    }

    // --------------------------------------------------
    // Total descent
    // --------------------------------------------------

    let totalDescent = 0;

    for (const diff of elevationDiff) {
        if (diff < 0) {
            totalDescent += Math.abs(diff);
        }
    }

    // --------------------------------------------------
    // Mean elevation
    // --------------------------------------------------

    const meanElevation =
        elevation.reduce(
            (sum, value) => sum + value,
            0
        ) / elevation.length;

    // --------------------------------------------------
    // Minimum elevation
    // --------------------------------------------------

    const minimumElevation =
        Math.min(...elevation);

    // --------------------------------------------------
    // Maximum elevation
    // --------------------------------------------------

    const maximumElevation =
        Math.max(...elevation);

    // --------------------------------------------------
    // Maximum elevation gain
    // Difference between maximum and minimum elevation
    // --------------------------------------------------

    const maximumElevationGain =
        maximumElevation - minimumElevation;

    // --------------------------------------------------
    // Return metrics
    // --------------------------------------------------

    return {
        "Distance (km)":
            distance[distance.length - 1] / 1000,

        "Start Elevation (m)":
            elevation[0],

        "Minimum Elevation (m)":
            minimumElevation,

        "Maximum Elevation (m)":
            maximumElevation,

        "Maximum Elevation Gain (m)":
            maximumElevationGain,

        "Mean Elevation (m)":
            meanElevation,

        "Total Ascent (m)":
            totalAscent,

        "Total Descent (m)":
            totalDescent
    };
}

function calculateAscentDistance3D(route) {
    const points = route.points;

    if (!points || points.length < 2) {
        return 0;
    }

    // Find summit (highest point)
    let summitIndex = 0;

    for (let i = 1; i < points.length; i++) {
        if (
            Number.isFinite(points[i].elevation) &&
            points[i].elevation >
            points[summitIndex].elevation
        ) {
            summitIndex = i;
        }
    }

    // Sum 3D distance from start to summit
    let ascentDistance3D = 0;

    for (let i = 0; i < summitIndex; i++) {
        const d = distance3D(
            points[i],
            points[i + 1]
        );

        if (d !== null) {
            ascentDistance3D += d;
        }
    }

    return ascentDistance3D / 1000;
}



function calculateRouteTimes(route) {
    const points = route.points;

    if (!points || points.length < 2) {
        return {
            ascentTimeHours: null,
            totalTimeHours: null
        };
    }

    // --------------------------------------------------
    // Start point
    // --------------------------------------------------

    const startPoint = points[0];

    if (!(startPoint.time instanceof Date) ||
        Number.isNaN(startPoint.time.getTime())) {
        return {
            ascentTimeHours: null,
            totalTimeHours: null
        };
    }

    // --------------------------------------------------
    // Find summit (highest elevation)
    // --------------------------------------------------

    let summitIndex = 0;

    for (let i = 1; i < points.length; i++) {
        if (
            Number.isFinite(points[i].elevation) &&
            points[i].elevation >
            points[summitIndex].elevation
        ) {
            summitIndex = i;
        }
    }

    // --------------------------------------------------
    // End point
    // --------------------------------------------------

    const endPoint = points[points.length - 1];

    if (!(endPoint.time instanceof Date) ||
        Number.isNaN(endPoint.time.getTime())) {
        return {
            ascentTimeHours: null,
            totalTimeHours: null
        };
    }

    // --------------------------------------------------
    // Summit time
    // --------------------------------------------------

    const summitPoint = points[summitIndex];

    if (!(summitPoint.time instanceof Date) ||
        Number.isNaN(summitPoint.time.getTime())) {
        return {
            ascentTimeHours: null,
            totalTimeHours: null
        };
    }

    // --------------------------------------------------
    // Calculate elapsed times
    // --------------------------------------------------

    const ascentTimeMs =
        summitPoint.time.getTime() -
        startPoint.time.getTime();

    const totalTimeMs =
        endPoint.time.getTime() -
        startPoint.time.getTime();

    // --------------------------------------------------
    // Validate
    // --------------------------------------------------

    if (ascentTimeMs < 0 || totalTimeMs < 0) {
        return {
            ascentTimeHours: null,
            totalTimeHours: null
        };
    }

    return {
        ascentTimeHours:
            ascentTimeMs / (1000 * 60 * 60),

        totalTimeHours:
            totalTimeMs / (1000 * 60 * 60)
    };
}

function calculateSlopeDistribution(
    route,
    resampleDistance = 20,
    smoothingWindow = 2
) {
    // ========================================================
    // 1. Extract route profile
    // ========================================================

    const { distance, elevation } =
        extractRouteProfile(route);

    if (distance.length < 2) {
        throw new Error(
            "Not enough route data for slope calculation."
        );
    }

    // ========================================================
    // 2. Resampling
    // ========================================================

    const newDistance = [];

    for (
        let d = 0;
        d < distance[distance.length - 1];
        d += resampleDistance
    ) {
        newDistance.push(d);
    }

    const lastDistance =
        distance[distance.length - 1];

    if (
        newDistance.length === 0 ||
        newDistance[newDistance.length - 1] < lastDistance
    ) {
        newDistance.push(lastDistance);
    }

    const newElevation = interpolate(
        newDistance,
        distance,
        elevation
    );

    // ========================================================
    // 3. Smoothing
    // ========================================================

    if (smoothingWindow < 1) {
        throw new Error(
            "smoothing_window must be greater than zero."
        );
    }

    if (smoothingWindow % 2 === 0) {
        smoothingWindow += 1;
    }

    let smoothElevation;

    if (newElevation.length >= smoothingWindow) {
        const kernel = Array(
            smoothingWindow
        ).fill(1 / smoothingWindow);

        smoothElevation = convolveSame(
            newElevation,
            kernel
        );

        const half =
            Math.floor(smoothingWindow / 2);

        // Avoid convolution edge effects
        for (let i = 0; i < half; i++) {
            smoothElevation[i] =
                newElevation[i];
        }

        for (
            let i = newElevation.length - half;
            i < newElevation.length;
            i++
        ) {
            smoothElevation[i] =
                newElevation[i];
        }
    } else {
        smoothElevation = [...newElevation];
    }

    // ========================================================
    // 4. Calculate grade
    // ========================================================

    const deltaElevation = [];

    const deltaDistance = [];

    for (let i = 1; i < smoothElevation.length; i++) {
        deltaElevation.push(
            smoothElevation[i] -
            smoothElevation[i - 1]
        );

        deltaDistance.push(
            newDistance[i] -
            newDistance[i - 1]
        );
    }

    const grade = deltaElevation.map(
        (delta, i) =>
            (delta / deltaDistance[i]) * 100
    );

    const segmentDistance = deltaDistance;

    const totalDistance =
        segmentDistance.reduce(
            (sum, value) => sum + value,
            0
        );

    // ========================================================
    // 5. Slope categories
    // ========================================================

    const categories = {
        "Descent (<0%)":
            grade.map(g => g < 0),

        "Very Easy (0–5%)":
            grade.map(
                g => g >= 0 && g < 5
            ),

        "Easy (5–10%)":
            grade.map(
                g => g >= 5 && g < 10
            ),

        "Moderate (10–15%)":
            grade.map(
                g => g >= 10 && g < 15
            ),

        "Steep (15–20%)":
            grade.map(
                g => g >= 15 && g < 20
            ),

        "Very Steep (20–25%)":
            grade.map(
                g => g >= 20 && g < 25
            ),

        "Extreme (>25%)":
            grade.map(g => g >= 25)
    };

    // ========================================================
    // 6. Distance and percentage per category
    // ========================================================

    const result = {};

    for (
        const [category, categoryMask]
        of Object.entries(categories)
    ) {
        let categoryDistance = 0;

        for (let i = 0; i < categoryMask.length; i++) {
            if (categoryMask[i]) {
                categoryDistance +=
                    segmentDistance[i];
            }
        }

        result[`${category} - km`] =
            categoryDistance / 1000;

        result[`${category} - %`] =
            (categoryDistance / totalDistance) * 100;
    }

    // ========================================================
    // 7. Uphill distance
    // ========================================================

    let uphillDistance = 0;

    for (let i = 0; i < grade.length; i++) {
        if (grade[i] > 0) {
            uphillDistance +=
                segmentDistance[i];
        }
    }

    result["Uphill Distance (km)"] =
        uphillDistance / 1000;

    // ========================================================
    // 8. Total ascent
    // ========================================================

    let totalAscent = 0;

    for (const delta of deltaElevation) {
        if (delta > 0) {
            totalAscent += delta;
        }
    }

    result["Total Ascent (m)"] =
        totalAscent;

    // ========================================================
    // 9. Total descent
    // ========================================================

    let totalDescent = 0;

    for (const delta of deltaElevation) {
        if (delta < 0) {
            totalDescent += Math.abs(delta);
        }
    }

    result["Total Descent (m)"] =
        totalDescent;

    // ========================================================
    // 10. Weighted average uphill grade
    // ========================================================

    let weightedUpHillGrade = 0;

    if (uphillDistance > 0) {
        let weightedSum = 0;

        for (let i = 0; i < grade.length; i++) {
            if (grade[i] > 0) {
                weightedSum +=
                    grade[i] *
                    segmentDistance[i];
            }
        }

        weightedUpHillGrade =
            weightedSum / uphillDistance;
    }

    result["Average Uphill Grade (%)"] =
        weightedUpHillGrade;

    // ========================================================
    // 11. Maximum and minimum grade
    // ========================================================

    result["Maximum Grade (%)"] =
        Math.max(...grade);

    result["Minimum Grade (%)"] =
        Math.min(...grade);

    // ========================================================
    // 12. Total distance
    // ========================================================

    result["Total Distance (km)"] =
        totalDistance / 1000;

    return result;
}


function interpolate(
    xValues,
    x,
    y
) {
    const result = [];

    let j = 0;

    for (const targetX of xValues) {
        while (
            j < x.length - 2 &&
            x[j + 1] < targetX
        ) {
            j++;
        }

        if (targetX <= x[0]) {
            result.push(y[0]);
            continue;
        }

        if (targetX >= x[x.length - 1]) {
            result.push(y[y.length - 1]);
            continue;
        }

        const x0 = x[j];
        const x1 = x[j + 1];

        const y0 = y[j];
        const y1 = y[j + 1];

        const ratio =
            (targetX - x0) /
            (x1 - x0);

        result.push(
            y0 + ratio * (y1 - y0)
        );
    }

    return result;
}


function convolveSame(
    values,
    kernel
) {
    const result =
        Array(values.length).fill(0);

    const kernelSize = kernel.length;
    const half =
        Math.floor(kernelSize / 2);

    for (let i = 0; i < values.length; i++) {
        let sum = 0;

        for (let j = 0; j < kernelSize; j++) {
            const index =
                i + j - half;

            if (
                index >= 0 &&
                index < values.length
            ) {
                sum +=
                    values[index] *
                    kernel[j];
            }
        }

        result[i] = sum;
    }

    return result;
}



const DISTANCE_THRESHOLDS = [
    [0, 0],
    [5, 20],
    [10, 40],
    [15, 60],
    [20, 80],
    [25, 100]
];

const ASCENT_THRESHOLDS = [
    [0, 0],
    [500, 20],
    [1000, 40],
    [1500, 60],
    [2000, 80],
    [2500, 100]
];

const MAX_ALTITUDE_THRESHOLDS = [
    [1500, 0],
    [2000, 20],
    [2500, 40],
    [3000, 60],
    [3500, 80],
    [4000, 100]
];

const MEAN_ALTITUDE_THRESHOLDS = [
    [1000, 0],
    [1500, 20],
    [2000, 40],
    [2500, 60],
    [3000, 80],
    [3500, 100]
];

const DESCENT_THRESHOLDS = [
    [0, 0],
    [500, 20],
    [1000, 40],
    [1500, 60],
    [2000, 80],
    [2500, 100]
];


const SLOPE_WEIGHTS = {
    "Very Easy (0–5%)": 0.00,
    "Easy (5–10%)": 0.10,
    "Moderate (10–15%)": 0.25,
    "Steep (15–20%)": 0.40,
    "Very Steep (20–25%)": 0.60,
    "Extreme (>25%)": 1.00
};


/**
 * Convert a numeric value to a score between 0 and 100
 * using linear interpolation between thresholds.
 */
function scoreByThresholds(value, thresholds) {
    if (!Number.isFinite(value)) {
        return NaN;
    }

    if (thresholds.length < 2) {
        throw new Error(
            "At least two thresholds are required."
        );
    }

    const sortedThresholds = [...thresholds].sort(
        (a, b) => a[0] - b[0]
    );

    // Below minimum
    if (value <= sortedThresholds[0][0]) {
        return sortedThresholds[0][1];
    }

    // Above maximum
    if (
        value >=
        sortedThresholds[sortedThresholds.length - 1][0]
    ) {
        return sortedThresholds[
            sortedThresholds.length - 1
        ][1];
    }

    // Linear interpolation
    for (
        let i = 0;
        i < sortedThresholds.length - 1;
        i++
    ) {
        const [x1, y1] =
            sortedThresholds[i];

        const [x2, y2] =
            sortedThresholds[i + 1];

        if (
            x1 <= value &&
            value <= x2
        ) {
            if (x2 === x1) {
                return y1;
            }

            const score =
                y1 +
                (
                    (value - x1) /
                    (x2 - x1)
                ) *
                (y2 - y1);

            return Math.max(
                0,
                Math.min(100, score)
            );
        }
    }

    return NaN;
}


/**
 * Calculate route difficulty.
 *
 * JavaScript equivalent of difficulty.py
 */
function calculateDifficulty(metrics) {
    const result = {
        ...metrics
    };

    // ========================================================
    // 1. Distance Score
    // ========================================================

    result["Distance Score"] =
        scoreByThresholds(
            result["Distance (km)"],
            DISTANCE_THRESHOLDS
        );

    // ========================================================
    // 2. Ascent Score
    // ========================================================

    result["Ascent Score"] =
        scoreByThresholds(
            result["Total Ascent (m)"],
            ASCENT_THRESHOLDS
        );

    // ========================================================
    // 3. Climb Load
    // ========================================================

    result["Climb Load"] =
        Math.sqrt(
            result["Distance Score"] *
            result["Ascent Score"]
        );

    // ========================================================
    // 4. Slope Load
    // ========================================================

    result["Slope Load"] = 0;

    for (
        const [column, weight]
        of Object.entries(SLOPE_WEIGHTS)
    ) {
        const kmColumn =
            `${column} - km`;

        if (!(kmColumn in result)) {
            throw new Error(
                `Missing slope column: ${kmColumn}`
            );
        }

        result["Slope Load"] +=
            result[kmColumn] * weight;
    }

    // ========================================================
    // 5. Slope Difficulty
    // ========================================================

    if (
        result["Uphill Distance (km)"] > 0
    ) {
        result["Slope Difficulty"] =
            (
                result["Slope Load"] /
                result["Uphill Distance (km)"]
            ) * 100;
    } else {
        result["Slope Difficulty"] = 0;
    }

    // ========================================================
    // 6. Slope Factor
    // ========================================================

    result["Slope Factor"] =
        1 +
        result["Slope Difficulty"] / 200;

// ========================================================
// 7. Estimated ascent time - Adjusted Naismith
// ========================================================
//
// Base Naismith:
//   5 km distance  = 1 hour
//   600 m ascent   = 1 hour
//
// Distance:
//   Ascent Distance 3D
//
// Elevation:
//   Total Ascent
//
// Slope adjustment:
//   Multiply base time by Slope Factor
//

const naismithTime =
    (
        result["Ascent Distance 3D (km)"] / 5
    )
    +
    (
        result["Total Ascent (m)"] / 600
    );

result["Estimated Ascent Time (h)"] =
    naismithTime *
    result["Slope Factor"];
    // ========================================================
    // 8. Maximum altitude score
    // ========================================================

    result["Max Altitude Score"] =
        scoreByThresholds(
            result["Maximum Elevation (m)"],
            MAX_ALTITUDE_THRESHOLDS
        );

    // ========================================================
    // 9. Mean altitude score
    // ========================================================

    result["Mean Altitude Score"] =
        scoreByThresholds(
            result["Mean Elevation (m)"],
            MEAN_ALTITUDE_THRESHOLDS
        );

    // ========================================================
    // 10. Altitude Score
    // ========================================================

    result["Altitude Score"] =
        0.60 *
        result["Max Altitude Score"]

        +

        0.40 *
        result["Mean Altitude Score"];

    // ========================================================
    // 11. Descent Score
    // ========================================================

    result["Descent Score"] =
        scoreByThresholds(
            result["Total Descent (m)"],
            DESCENT_THRESHOLDS
        );

    // ========================================================
    // 12. Final Difficulty Score
    // ========================================================

    result["Difficulty Score"] =
        0.40 *
        result["Climb Load"]

        +

        0.35 *
        result["Slope Difficulty"]

        +

        0.15 *
        result["Altitude Score"]

        +

        0.10 *
        result["Descent Score"];

    return result;
}
function analyzeRoute(route, routeName = null) {
    // ========================================================
    // 1. General route metrics
    // ========================================================

const routeMetrics =
    calculateRouteMetrics(route);

const ascentDistance3D =
    calculateAscentDistance3D(route);

const routeTimes =
    calculateRouteTimes(route);
    // ========================================================
    // 2. Slope analysis
    // ========================================================

    const slopeMetrics =
        calculateSlopeDistribution(
            route,
            20,
            5
        );

    // ========================================================
    // 3. Combine metrics
    // ========================================================

    const slopeMetricsForMerge = {
        ...slopeMetrics
    };

    delete slopeMetricsForMerge["Total Ascent (m)"];
    delete slopeMetricsForMerge["Total Descent (m)"];

const combinedMetrics = {
    ...routeMetrics,
    ...slopeMetricsForMerge,

    "Ascent Distance 3D (km)":
        ascentDistance3D,

    "Ascent Time (h)":
        routeTimes.ascentTimeHours,

    "Total Time (h)":
        routeTimes.totalTimeHours
};
    if (routeName !== null) {
        combinedMetrics.route = routeName;
    }

    // ========================================================
    // 4. Difficulty
    // ========================================================

    const difficulty =
        calculateDifficulty(
            combinedMetrics
        );

    // ========================================================
    // 5. Elevation profiles
    // ========================================================

    const profiles = {
        elevation:
            getElevationProfile(route),

        normalized_elevation:
            getNormalizedElevationProfile(route),

        elevation_gain:
            getElevationGainProfile(route),

        normalized_elevation_gain:
            getNormalizedElevationGainProfile(route)
    };

    // ========================================================
    // 6. Route map coordinates
    // ========================================================

    const routeMap = {
        latitude:
            route.points.map(
                point => point.latitude
            ),

        longitude:
            route.points.map(
                point => point.longitude
            )
    };

    // ========================================================
    // 7. Final result
    // ========================================================

    return {
        route: routeName,
        metrics: combinedMetrics,
        difficulty: difficulty,
        profiles: profiles,
        slope: slopeMetrics,
        map: routeMap
    };
}