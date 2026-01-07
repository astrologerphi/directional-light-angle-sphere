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
