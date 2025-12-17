export function generateDemoData(): LightDirection[] {
    const data: LightDirection[] = [];
    const numPoints = 200;
    const duration = 20;

    for (let i = 0; i < numPoints; i++) {
        const t = (i / numPoints) * Math.PI * 2;
        const time = (i / numPoints) * duration;

        const a = 0.8;
        const denominator = 1 + Math.sin(t) ** 2;

        const x = (a * Math.cos(t)) / denominator;
        const y = (a * Math.sin(t) * Math.cos(t)) / denominator;
        const z = Math.sin(t * 0.5) * 0.5;

        const length = Math.sqrt(x * x + y * y + z * z);

        data.push({
            x: x / length,
            y: y / length,
            z: z / length,
            time,
        });
    }

    return data;
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
