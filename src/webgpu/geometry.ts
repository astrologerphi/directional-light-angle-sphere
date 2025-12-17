export interface SphereGeometry {
    vertices: Float32Array;
    indices: Uint16Array;
    normals: Float32Array;
}

export interface ScaleLines {
    vertices: Float32Array;
}

export function createSphereGeometry(radius = 1, widthSegments = 32, heightSegments = 16): SphereGeometry {
    const vertices: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];

    for (let y = 0; y <= heightSegments; y++) {
        const v = y / heightSegments;
        const theta = v * Math.PI;

        for (let x = 0; x <= widthSegments; x++) {
            const u = x / widthSegments;
            const phi = u * Math.PI * 2;

            const px = -radius * Math.cos(phi) * Math.sin(theta);
            const py = radius * Math.cos(theta);
            const pz = radius * Math.sin(phi) * Math.sin(theta);

            vertices.push(px, py, pz);

            const length = Math.sqrt(px * px + py * py + pz * pz);
            normals.push(px / length, py / length, pz / length);
        }
    }

    for (let y = 0; y < heightSegments; y++) {
        for (let x = 0; x < widthSegments; x++) {
            const a = y * (widthSegments + 1) + x;
            const b = a + widthSegments + 1;
            const c = a + 1;
            const d = b + 1;

            indices.push(a, b, c);
            indices.push(b, d, c);
        }
    }

    return {
        vertices: new Float32Array(vertices),
        indices: new Uint16Array(indices),
        normals: new Float32Array(normals),
    };
}

export function createScaleLines(radius = 1): ScaleLines {
    const vertices: number[] = [];
    const segments = 64;

    for (let lat = -4; lat <= 4; lat++) {
        if (lat === 0) continue;
        const theta = (lat / 5) * (Math.PI / 2);
        const y = radius * Math.sin(theta);
        const r = radius * Math.cos(theta);

        for (let i = 0; i <= segments; i++) {
            const phi = (i / segments) * Math.PI * 2;
            const x = r * Math.cos(phi);
            const z = r * Math.sin(phi);
            vertices.push(x, y, z);
        }
    }

    for (let lon = 0; lon < 8; lon++) {
        const phi = (lon / 8) * Math.PI * 2;

        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI;
            const y = radius * Math.cos(theta);
            const r = radius * Math.sin(theta);
            const x = r * Math.cos(phi);
            const z = r * Math.sin(phi);
            vertices.push(x, y, z);
        }
    }

    for (let i = 0; i <= segments; i++) {
        const phi = (i / segments) * Math.PI * 2;
        const x = radius * Math.cos(phi);
        const z = radius * Math.sin(phi);
        vertices.push(x, 0, z);
    }

    return {
        vertices: new Float32Array(vertices),
    };
}

export function createProjectionMatrix(fov: number, aspect: number, near: number, far: number): Float32Array {
    const f = 1.0 / Math.tan(fov / 2);
    const rangeInv = 1.0 / (near - far);

    return new Float32Array([
        f / aspect,
        0,
        0,
        0,
        0,
        f,
        0,
        0,
        0,
        0,
        (near + far) * rangeInv,
        -1,
        0,
        0,
        near * far * rangeInv * 2,
        0,
    ]);
}

export function createViewMatrix(eye: Vec3, target: Vec3, up: Vec3): Float32Array {
    const z = normalize(subtract(eye, target));
    const x = normalize(cross(up, z));
    const y = cross(z, x);

    return new Float32Array([
        x[0],
        y[0],
        z[0],
        0,
        x[1],
        y[1],
        z[1],
        0,
        x[2],
        y[2],
        z[2],
        0,
        -dot(x, eye),
        -dot(y, eye),
        -dot(z, eye),
        1,
    ]);
}

export function multiplyMatrices(out: Float32Array, a: Float32Array, b: Float32Array): void {
    // Column-major matrix multiplication: out = a * b
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            out[col * 4 + row] =
                a[0 * 4 + row] * b[col * 4 + 0] +
                a[1 * 4 + row] * b[col * 4 + 1] +
                a[2 * 4 + row] * b[col * 4 + 2] +
                a[3 * 4 + row] * b[col * 4 + 3];
        }
    }
}

function subtract(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): Vec3 {
    const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return [v[0] / length, v[1] / length, v[2] / length];
}
