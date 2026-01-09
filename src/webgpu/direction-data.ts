import { lightAnglePaths } from '../data';

export function getAvailablePaths(): string[] {
    let tmp = Object.keys(lightAnglePaths)
        .filter(k => k[0] == 'm')
        .filter(k => lightAnglePaths[k] && lightAnglePaths[k][0] !== undefined)
        .sort();
    let withNames = tmp.filter(k => lightAnglePaths[k].title != k);
    let withoutNames = tmp.filter(k => lightAnglePaths[k].title == k);
    return [...withNames, ...withoutNames];
}

// Predefined colors for different segments (HSL-based for good distinction)
const segmentColors: Vec3[] = [
    [1.0, 0.75, 0.15], // Orange (original)
    [0.15, 0.75, 1.0], // Cyan
    [1.0, 0.3, 0.4], // Red/Pink
    [0.4, 1.0, 0.4], // Green
    [0.8, 0.4, 1.0], // Purple
    [1.0, 1.0, 0.3], // Yellow
    [0.3, 0.6, 1.0], // Blue
    [1.0, 0.5, 0.8], // Pink
];

function rad2Point(direction: RadDirection): Vector3 {
    const x = Math.cos(direction.vertical) * -Math.sin(direction.horizontal);
    const z = Math.cos(direction.vertical) * Math.cos(direction.horizontal);
    const y = -Math.sin(direction.vertical);
    return { x, y, z };
}

function geometricSpheralLerp(start: RadPoint, end: RadPoint): LightDirection[] {
    const result: LightDirection[] = [];
    const startVec = rad2Point(start.direction);
    const endVec = rad2Point(end.direction);
    const dot = startVec.x * endVec.x + startVec.y * endVec.y + startVec.z * endVec.z;
    const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
    const sinTheta = Math.sin(theta);
    for (let t = start.timestamp; t <= end.timestamp; t += 0.01) {
        let x, y, z;
        const progress = (t - start.timestamp) / (end.timestamp - start.timestamp);
        if (theta < 0.001 || end.timestamp === start.timestamp) {
            x = startVec.x + (endVec.x - startVec.x) * progress;
            y = startVec.y + (endVec.y - startVec.y) * progress;
            z = startVec.z + (endVec.z - startVec.z) * progress;
        } else {
            const w1 = Math.sin((1 - progress) * theta) / sinTheta;
            const w2 = Math.sin(progress * theta) / sinTheta;
            x = w1 * startVec.x + w2 * endVec.x;
            y = w1 * startVec.y + w2 * endVec.y;
            z = w1 * startVec.z + w2 * endVec.z;
        }
        const length = Math.sqrt(x * x + y * y + z * z);
        result.push({
            x: x / length,
            y: y / length,
            z: z / length,
            time: t,
        });
    }
    return result;
}

function generateSegmentData(data: { [time: number]: { x: number; y: number } }): LightDirection[] {
    // Clone and add wrap-around point at time 24
    const dataCopy = { ...data };
    const keys = Object.keys(dataCopy)
        .map(k => Number(k))
        .filter(k => !isNaN(k))
        .sort((a, b) => a - b);

    if (keys.length === 0) return [];

    // Add wrap-around point
    dataCopy[24] = dataCopy[keys[0]];

    const sortedKeys = [...keys, 24];
    let res: LightDirection[] = [];

    for (let i = 0; i < sortedKeys.length - 1; i++) {
        const key1 = sortedKeys[i];
        const key2 = sortedKeys[i + 1];
        const start: RadPoint = {
            timestamp: key1,
            direction: {
                vertical: dataCopy[key1].x,
                horizontal: dataCopy[key1].y,
            },
        };
        const end: RadPoint = {
            timestamp: key2,
            direction: {
                vertical: dataCopy[key2].x,
                horizontal: dataCopy[key2].y,
            },
        };
        const part = geometricSpheralLerp(start, end);
        res = res.concat(part);
    }
    return res;
}

export function generateDemoData(pathKey: string = 'default'): SegmentData[] {
    const pathData = lightAnglePaths[pathKey];
    if (!pathData) {
        console.error(`Path data not found for key: ${pathKey}`);
        return [];
    }

    const segments: SegmentData[] = [];
    let colorIndex = 0;

    // Get all segment IDs (numeric keys excluding 'title')
    const segmentIds = Object.keys(pathData)
        .filter(k => k !== 'title')
        .map(k => Number(k))
        .filter(k => !isNaN(k))
        .sort((a, b) => a - b);

    for (const segmentId of segmentIds) {
        const segmentTimeData = pathData[segmentId];
        if (!segmentTimeData || typeof segmentTimeData !== 'object') continue;

        const directions = generateSegmentData(segmentTimeData as { [time: number]: { x: number; y: number } });
        if (directions.length > 0) {
            segments.push({
                id: segmentId,
                directions,
                color: segmentColors[colorIndex % segmentColors.length],
            });
            colorIndex++;
        }
    }

    return segments;
}

export function interpolateDirection(dir1: LightDirection, dir2: LightDirection, t: number): Vector3 {
    const dot = dir1.x * dir2.x + dir1.y * dir2.y + dir1.z * dir2.z;
    const theta = Math.acos(Math.max(-1, Math.min(1, dot)));

    if (theta < 0.001) {
        return {
            x: dir1.x + (dir2.x - dir1.x) * t,
            y: dir1.y + (dir2.y - dir1.y) * t,
            z: dir1.z + (dir2.z - dir1.z) * t,
        };
    }

    const sinTheta = Math.sin(theta);
    const w1 = Math.sin((1 - t) * theta) / sinTheta;
    const w2 = Math.sin(t * theta) / sinTheta;

    return {
        x: w1 * dir1.x + w2 * dir2.x,
        y: w1 * dir1.y + w2 * dir2.y,
        z: w1 * dir1.z + w2 * dir2.z,
    };
}
