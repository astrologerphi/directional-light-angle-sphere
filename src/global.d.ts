declare module '*.wgsl' {
    const shader: string;
    export default shader;
}

type Vec3 = [number, number, number];

interface Vector3 {
    x: number;
    y: number;
    z: number;
}

interface LightDirection extends Vector3 {
    time: number;
}

interface TrailPoint {
    position: Vec3;
    timestamp: number;
}

// prettier-ignore
interface RadDirection {
        vertical: number;   // -1/2 * pi <= vertical < 0
        horizontal: number; // -3/4 * pi < horizontal < 1/4 * pi
    }

interface RadDirectionsWithTime {
    [time: number]: RadDirection; // 0 <= time < 24
}

interface RadPoint {
    timestamp: number; // 0 <= timestamp < 24
    direction: RadDirection;
}

interface LightAnglePathCollection {
    [name: string]: {
        title: string;
        [id: number]: {
            [time: number]: {
                x: number;
                y: number;
            };
        };
    };
}

interface Window {
    lightAnglePaths: LightAnglePathCollection;
}
