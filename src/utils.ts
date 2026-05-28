/**
 * Finds the closest fraction approximation of a rational number
 * where both numerator and denominator are smaller than n.
 *
 * Uses the Stern-Brocot tree / mediant approach to find the best approximation.
 *
 * @param value - The decimal number to approximate
 * @param maxDenominator - Maximum value for both numerator and denominator
 * @returns Object containing the numerator and denominator of the best approximation
 */
export function closestFraction(value: number, maxDenominator: number): { numerator: number; denominator: number } {
    if (maxDenominator <= 0) {
        throw new Error('maxDenominator must be positive');
    }

    if (!isFinite(value) || isNaN(value)) {
        throw new Error('value must be a finite number');
    }

    // Handle simple cases
    if (value === 0) {
        return { numerator: 0, denominator: 1 };
    }

    const isNegative = value < 0;
    const absValue = Math.abs(value);

    // Start with bounds [0/1, 1/0] for positive numbers
    let leftNum = 0;
    let leftDen = 1;
    let rightNum = 1;
    let rightDen = 0;

    let bestNum = 0;
    let bestDen = 1;
    let bestError = Math.abs(absValue);

    // Binary search using mediants
    while (true) {
        // Calculate mediant
        const mediantNum = leftNum + rightNum;
        const mediantDen = leftDen + rightDen;

        // Check if mediant exceeds our limit
        if (mediantNum >= maxDenominator || mediantDen >= maxDenominator) {
            break;
        }

        const mediantValue = mediantNum / mediantDen;
        const error = Math.abs(absValue - mediantValue);

        // Update best approximation if this is closer
        if (error < bestError) {
            bestNum = mediantNum;
            bestDen = mediantDen;
            bestError = error;

            // Perfect match found
            if (error === 0) {
                break;
            }
        }

        // Decide which side to continue on
        if (mediantValue < absValue) {
            leftNum = mediantNum;
            leftDen = mediantDen;
        } else {
            rightNum = mediantNum;
            rightDen = mediantDen;
        }
    }

    // Check the boundary fractions (within limits)
    for (let den = 1; den < maxDenominator; den++) {
        const num = Math.round(absValue * den);
        if (num < maxDenominator) {
            const error = Math.abs(absValue - num / den);
            if (error < bestError) {
                bestNum = num;
                bestDen = den;
                bestError = error;
            }
        }
    }

    return {
        numerator: isNegative ? -bestNum : bestNum,
        denominator: bestDen,
    };
}

/**
 * Formats a fraction as a string
 */
export function formatFraction(numerator: number, denominator: number): string {
    if (denominator === 1) {
        return `${numerator}`;
    }
    return `${numerator}/${denominator}`;
}

export function calculateAndFormatClosestFraction(value: number, maxDenominator: number): string {
    const fraction = closestFraction(value, maxDenominator);
    return formatFraction(fraction.numerator, fraction.denominator);
}

type SphereAnglePoint = { x: number; y: number };
type SphereVector = { x: number; y: number; z: number };

const SPHERE_INTERSECTION_EPSILON = 1e-9;

function sphereAnglesToVector(point: SphereAnglePoint): SphereVector {
    const cosVertical = Math.cos(point.x);
    return {
        x: cosVertical * -Math.sin(point.y),
        y: -Math.sin(point.x),
        z: cosVertical * Math.cos(point.y),
    };
}

function vectorToSphereAngles(vector: SphereVector): SphereAnglePoint {
    const normalized = normalizeSphereVector(vector);
    return {
        x: -Math.asin(clamp(normalized.y, -1, 1)),
        y: Math.atan2(-normalized.x, normalized.z),
    };
}

function crossSphereVector(a: SphereVector, b: SphereVector): SphereVector {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function vectorLength(vector: SphereVector): number {
    return Math.hypot(vector.x, vector.y, vector.z);
}

function normalizeSphereVector(vector: SphereVector): SphereVector {
    const length = vectorLength(vector);
    if (length < SPHERE_INTERSECTION_EPSILON) {
        throw new Error('Cannot normalize a zero-length vector');
    }

    return {
        x: vector.x / length,
        y: vector.y / length,
        z: vector.z / length,
    };
}

function negateSphereVector(vector: SphereVector): SphereVector {
    return {
        x: -vector.x,
        y: -vector.y,
        z: -vector.z,
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function dotSphereVector(a: SphereVector, b: SphereVector): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function angleBetweenSphereVectors(a: SphereVector, b: SphereVector): number {
    return Math.acos(clamp(dotSphereVector(a, b), -1, 1));
}

function isPointOnShorterSphereArc(start: SphereVector, end: SphereVector, candidate: SphereVector): boolean {
    const totalAngle = angleBetweenSphereVectors(start, end);
    if (totalAngle < SPHERE_INTERSECTION_EPSILON || totalAngle >= Math.PI - SPHERE_INTERSECTION_EPSILON) {
        return false;
    }

    const startToCandidate = angleBetweenSphereVectors(start, candidate);
    const candidateToEnd = angleBetweenSphereVectors(candidate, end);

    return Math.abs(startToCandidate + candidateToEnd - totalAngle) <= 1e-7;
}

export function getSphereLineIntersectionPoints(
    line1PointA: SphereAnglePoint,
    line1PointB: SphereAnglePoint,
    line2PointA: SphereAnglePoint,
    line2PointB: SphereAnglePoint,
): SphereAnglePoint | null {
    const line1VectorA = sphereAnglesToVector(line1PointA);
    const line1VectorB = sphereAnglesToVector(line1PointB);
    const line2VectorA = sphereAnglesToVector(line2PointA);
    const line2VectorB = sphereAnglesToVector(line2PointB);

    const normal1 = crossSphereVector(line1VectorA, line1VectorB);
    const normal2 = crossSphereVector(line2VectorA, line2VectorB);

    if (
        vectorLength(normal1) < SPHERE_INTERSECTION_EPSILON ||
        vectorLength(normal2) < SPHERE_INTERSECTION_EPSILON
    ) {
        return null;
    }

    const intersectionVector = crossSphereVector(normal1, normal2);
    if (vectorLength(intersectionVector) < SPHERE_INTERSECTION_EPSILON) {
        return null;
    }

    const primaryIntersection = normalizeSphereVector(intersectionVector);
    const secondaryIntersection = negateSphereVector(primaryIntersection);

    if (
        isPointOnShorterSphereArc(line1VectorA, line1VectorB, primaryIntersection) &&
        isPointOnShorterSphereArc(line2VectorA, line2VectorB, primaryIntersection)
    ) {
        return vectorToSphereAngles(primaryIntersection);
    }

    if (
        isPointOnShorterSphereArc(line1VectorA, line1VectorB, secondaryIntersection) &&
        isPointOnShorterSphereArc(line2VectorA, line2VectorB, secondaryIntersection)
    ) {
        return vectorToSphereAngles(secondaryIntersection);
    }

    return null;
}

/**
 * Groups all lightAnglePaths by their "0" value
 * @param lightAnglePaths - The light angle paths object
 * @returns An object where keys are stringified "0" values and values are arrays of matching path names
 */
function _groupLightPaths(lightAnglePaths: Record<string, any>): Record<string, string[]> {
    const groups: Record<string, string[]> = {};

    for (const pathName in lightAnglePaths) {
        const path = lightAnglePaths[pathName];

        // Skip if the path doesn't have a "0" key
        if (!path || typeof path !== 'object' || !('0' in path)) {
            continue;
        }

        // Create a stable string representation of the "0" value
        const zeroValue = path['0'];
        const groupKey = JSON.stringify(zeroValue);

        // Initialize the group if it doesn't exist
        if (!groups[groupKey]) {
            groups[groupKey] = [];
        }

        // Add this path name to the group
        groups[groupKey].push(pathName);
    }

    return groups;
}

export function getPathDataGroups(lightAnglePaths?: Record<string, any>) {
    const paths = lightAnglePaths || window.lightAnglePaths;
    let groupedPaths = _groupLightPaths(paths);
    let res = [];
    for (let key in groupedPaths) {
        let names = groupedPaths[key];
        let titles: Record<string, string> = {};
        for (let n of names) {
            titles[n] = paths[n].title;
        }
        let val = paths[names[0]]['0'];
        res.push({ titles: titles, values: val });
    }
    return res;
}

export function getPathDataGroupsFormatted(lightAnglePaths?: Record<string, any>) {
    const paths = lightAnglePaths || window.lightAnglePaths;
    let groupedPaths = _groupLightPaths(paths);
    let res = [];
    for (let key in groupedPaths) {
        let names = groupedPaths[key];
        let titles: Record<string, string> = {};
        for (let n of names) {
            titles[n] = paths[n].title;
        }
        let val = paths[names[0]]['0'];
        let _val = {};
        for (const k in val) {
            const element = val[k];
            let x = element.x / Math.PI;
            let y = element.y / Math.PI;
            let fracX = closestFraction(x, 100);
            let fracY = closestFraction(y, 100);
            let _X = formatFraction(fracX.numerator, fracX.denominator);
            let _Y = formatFraction(fracY.numerator, fracY.denominator);
            // @ts-ignore
            _val[k] = { x: 'π * ' + _X, y: 'π * ' + _Y };
        }
        res.push({ titles: titles, values: _val });
    }
    return res;
}

export function printPathData() {
    let res = [];
    let ks = Object.keys(window.lightAnglePaths).filter(k => window.lightAnglePaths[k].title != k);
    for (let k of ks) {
        let title = window.lightAnglePaths[k].title;
        let val = window.lightAnglePaths[k][0];
        let _val = {};
        for (const key in val) {
            const element = val[key];
            let x = element.x / Math.PI;
            let y = element.y / Math.PI;
            let fracX = closestFraction(x, 100);
            let fracY = closestFraction(y, 100);
            let _X = formatFraction(fracX.numerator, fracX.denominator);
            let _Y = formatFraction(fracY.numerator, fracY.denominator);
            // @ts-ignore
            _val[key] = { x: 'π * ' + _X, y: 'π * ' + _Y };
        }
        res.push({ name: k, title: title, values: _val });
    }

    console.log(res);
}
