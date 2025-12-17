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
