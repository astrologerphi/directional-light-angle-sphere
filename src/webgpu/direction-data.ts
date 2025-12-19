function Rad2Point(direction: RadDirection): Vector3 {
    const x = Math.cos(direction.vertical) * -Math.sin(direction.horizontal);
    const z = Math.cos(direction.vertical) * Math.cos(direction.horizontal);
    const y = -Math.sin(direction.vertical);
    return { x, y, z };
}

function geometricSpheralLerp(start: RadPoint, end: RadPoint): LightDirection[] {
    const result: LightDirection[] = [];
    const startVec = Rad2Point(start.direction);
    const endVec = Rad2Point(end.direction);
    const dot = startVec.x * endVec.x + startVec.y * endVec.y + startVec.z * endVec.z;
    const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
    const sinTheta = Math.sin(theta);
    for (let t = 0; t <= 1; t += 0.01) {
        let x, y, z;
        if (theta < 0.001) {
            x = startVec.x + (endVec.x - startVec.x) * t;
            y = startVec.y + (endVec.y - startVec.y) * t;
            z = startVec.z + (endVec.z - startVec.z) * t;
        } else {
            const w1 = Math.sin((1 - t) * theta) / sinTheta;
            const w2 = Math.sin(t * theta) / sinTheta;
            x = w1 * startVec.x + w2 * endVec.x;
            y = w1 * startVec.y + w2 * endVec.y;
            z = w1 * startVec.z + w2 * endVec.z;
        }
        const length = Math.sqrt(x * x + y * y + z * z);
        result.push({
            x: x / length,
            y: y / length,
            z: z / length,
            time: start.timestamp + t * (end.timestamp - start.timestamp),
        });
    }
    return result;
}

export function generateDemoData(): LightDirection[] {
    return geometricSpheralLerp(
        { timestamp: 0, direction: { vertical: -0.506, horizontal: 1.92 } },
        { timestamp: 24, direction: { vertical: -0.349, horizontal: -1.92 } }
    );
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
