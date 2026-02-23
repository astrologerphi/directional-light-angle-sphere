import { createProjectionMatrix, createViewMatrix, multiplyMatrices } from './geometry';
import { lineVertexShader, dotVertexShader, dotFragmentShader } from '../shaders/_index';

export interface HexagonController {
    updateVertices(vertices: (Vec3 | null)[]): void;
    stop(): void;
}

// Connections: Vertex 1–4, Vertex 2–5, Vertex 3–6 (0-indexed: 0–3, 1–4, 2–5)
const CONNECTIONS: [number, number][] = [
    [0, 3], // Vertex 1 ↔ Vertex 4
    [1, 4], // Vertex 2 ↔ Vertex 5
    [2, 5], // Vertex 3 ↔ Vertex 6
];

const DOT_SIZE = 0.06;

// Per-vertex colors: green, blue, orange, yellow, purple, red
const VERTEX_COLORS: Vec3[] = [
    [0.2, 0.9, 0.3], // Vertex 1 – green
    [0.3, 0.5, 1.0], // Vertex 2 – blue
    [1.0, 0.6, 0.2], // Vertex 3 – orange
    [1.0, 0.95, 0.3], // Vertex 4 – yellow
    [0.7, 0.3, 1.0], // Vertex 5 – purple
    [1.0, 0.3, 0.3], // Vertex 6 – red
];

// White line fragment shader (inline)
const whiteLineFragmentShader = `
@fragment
fn main() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 0.9);
}
`;

function createStaticBuffer(
    device: GPUDevice,
    data: Float32Array | Uint16Array,
    usage: GPUBufferUsageFlags
): GPUBuffer {
    const buffer = device.createBuffer({
        size: Math.max(data.byteLength, 4),
        usage: usage | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    return buffer;
}

function alphaBlend(): GPUBlendState {
    return {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
}

export async function initHexagonVisualization(canvas: HTMLCanvasElement): Promise<HexagonController> {
    if (!navigator.gpu) {
        throw new Error('WebGPU is not available in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found.');

    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Unable to acquire WebGPU context.');

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

    // Current vertex data (6 vertices, nullable)
    let currentVertices: (Vec3 | null)[] = Array.from({ length: 6 }, () => null);

    // Normalised vertices (centred at origin, scaled to fit radius ~2)
    let normalizedVertices: (Vec3 | null)[] = Array.from({ length: 6 }, () => null);

    const normalizeVertices = () => {
        // Collect all valid positions
        const valid: Vec3[] = [];
        for (const v of currentVertices) {
            if (v) valid.push(v);
        }

        if (valid.length === 0) {
            normalizedVertices = currentVertices.map(() => null);
            return;
        }

        // Compute centroid
        let cx = 0,
            cy = 0,
            cz = 0;
        for (const v of valid) {
            cx += v[0];
            cy += v[1];
            cz += v[2];
        }
        cx /= valid.length;
        cy /= valid.length;
        cz /= valid.length;

        // Compute max distance from centroid
        let maxDist = 0;
        for (const v of valid) {
            const dx = v[0] - cx,
                dy = v[1] - cy,
                dz = v[2] - cz;
            maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy + dz * dz));
        }

        // Scale so all points fit within radius 2 (if maxDist is 0, use scale=1)
        const scale = maxDist > 1e-6 ? 2 / maxDist : 1;

        normalizedVertices = currentVertices.map(v => {
            if (!v) return null;
            return [(v[2] - cz) * scale, (v[1] - cy) * scale, (v[0] - cx) * scale] as Vec3;
        });
    };

    // --- GPU resources ---

    const uniformBufferSize = 64; // mat4x4
    const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });

    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    // Line pipeline for connections
    const linePipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: device.createShaderModule({ code: lineVertexShader }),
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: {
            module: device.createShaderModule({ code: whiteLineFragmentShader }),
            entryPoint: 'main',
            targets: [{ format: presentationFormat, blend: alphaBlend() }],
        },
        primitive: { topology: 'line-list' },
        depthStencil: { depthWriteEnabled: false, depthCompare: 'less', format: 'depth24plus' },
    });

    // Dot bind group layout & pipeline (per-dot uniforms: MVP + position + size + color)
    const dotUniformSize = 96; // mat4(64) + vec3+f32(16) + vec3+pad(16)
    const dotBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
    });

    const dotPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [dotBindGroupLayout] }),
        vertex: {
            module: device.createShaderModule({ code: dotVertexShader }),
            entryPoint: 'main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
        },
        fragment: {
            module: device.createShaderModule({ code: dotFragmentShader }),
            entryPoint: 'main',
            targets: [{ format: presentationFormat, blend: alphaBlend() }],
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: { depthWriteEnabled: false, depthCompare: 'less', format: 'depth24plus' },
    });

    const dotQuadVertices = new Float32Array([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ]);
    const dotQuadBuffer = createStaticBuffer(device, dotQuadVertices, GPUBufferUsage.VERTEX);

    // Per-vertex dot resources (6 dots)
    const dotResources = Array.from({ length: 6 }, () => {
        const buf = device.createBuffer({
            size: dotUniformSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const bg = device.createBindGroup({
            layout: dotBindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: buf } }],
        });
        return { uniformBuffer: buf, bindGroup: bg };
    });

    // Line buffer (3 connections * 2 endpoints * 3 floats = 18 floats)
    const lineBuffer = device.createBuffer({
        size: CONNECTIONS.length * 2 * 12,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // --- Depth texture & surface ---

    let depthTexture: GPUTexture | null = null;
    let configured = false;

    const configureSurface = (force = false) => {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.floor((rect.width || canvas.clientWidth || 640) * dpr));
        const height = Math.max(1, Math.floor((rect.height || canvas.clientHeight || 480) * dpr));

        if (!configured || force) {
            context.configure({ device, format: presentationFormat, alphaMode: 'opaque' });
            configured = true;
        }

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        depthTexture?.destroy();
        depthTexture = device.createTexture({
            size: [canvas.width, canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    };

    configureSurface(true);

    const handleResize = () => configureSurface();
    let resizeObserver: ResizeObserver | null = null;
    let resizeFallbackAttached = false;

    if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(canvas);
    } else {
        window.addEventListener('resize', handleResize);
        resizeFallbackAttached = true;
    }

    // --- Camera (same spherical setup as visualization-sphere) ---

    let cameraDistance = 5;
    let cameraTheta = -Math.PI / 2;
    let cameraPhi = Math.PI / 8;
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    const handleMouseDown = (e: MouseEvent) => {
        isDragging = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        canvas.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;
        cameraTheta += deltaX * 0.01;
        cameraPhi = Math.max(0.01, Math.min(Math.PI - 0.01, cameraPhi - deltaY * 0.01));
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    };

    const handleMouseUp = () => {
        isDragging = false;
        canvas.style.cursor = 'grab';
    };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);

    // --- Render loop ---

    let animationFrameId: number | null = null;
    let isRunning = true;

    const render = () => {
        if (!isRunning) return;

        // Re-check surface size every frame (handles hidden→visible tab switch)
        configureSurface();

        // Skip rendering if canvas is effectively invisible
        if (canvas.width < 2 || canvas.height < 2) {
            animationFrameId = requestAnimationFrame(render);
            return;
        }

        const aspect = canvas.width / canvas.height;
        const projectionMatrix = createProjectionMatrix(Math.PI / 4, aspect, 0.1, 100);

        const eyeX = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
        const eyeY = cameraDistance * Math.cos(cameraPhi);
        const eyeZ = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);

        const viewMatrix = createViewMatrix([eyeX, eyeY, eyeZ], [0, 0, 0], [0, 1, 0]);
        const mvpMatrix = new Float32Array(16);
        multiplyMatrices(mvpMatrix, projectionMatrix, viewMatrix);

        device.queue.writeBuffer(uniformBuffer, 0, mvpMatrix);

        // Build line data for valid connections (use normalized positions)
        const lineData = new Float32Array(CONNECTIONS.length * 6);
        let validLines = 0;
        CONNECTIONS.forEach(([a, b]) => {
            const va = normalizedVertices[a];
            const vb = normalizedVertices[b];
            if (va && vb) {
                const off = validLines * 6;
                lineData[off + 0] = va[0];
                lineData[off + 1] = va[1];
                lineData[off + 2] = va[2];
                lineData[off + 3] = vb[0];
                lineData[off + 4] = vb[1];
                lineData[off + 5] = vb[2];
                validLines++;
            }
        });
        if (validLines > 0) {
            device.queue.writeBuffer(lineBuffer, 0, lineData.buffer, 0, validLines * 6 * 4);
        }

        // Update dot uniforms for valid vertices (use normalized positions)
        normalizedVertices.forEach((v, idx) => {
            if (!v) return;
            const data = new Float32Array(24);
            data.set(mvpMatrix, 0);
            data[16] = v[0];
            data[17] = v[1];
            data[18] = v[2];
            data[19] = DOT_SIZE;
            data.set(VERTEX_COLORS[idx], 20);
            device.queue.writeBuffer(dotResources[idx].uniformBuffer, 0, data);
        });

        // --- Render pass ---
        const textureView = context.getCurrentTexture().createView();
        const commandEncoder = device.createCommandEncoder();

        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: textureView,
                    clearValue: { r: 0.08, g: 0.09, b: 0.15, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
            depthStencilAttachment: {
                view: depthTexture!.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        });

        // Draw connection lines
        if (validLines > 0) {
            passEncoder.setPipeline(linePipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.setVertexBuffer(0, lineBuffer);
            passEncoder.draw(validLines * 2);
        }

        // Draw vertex dots
        passEncoder.setPipeline(dotPipeline);
        passEncoder.setVertexBuffer(0, dotQuadBuffer);
        normalizedVertices.forEach((v, idx) => {
            if (!v) return;
            passEncoder.setBindGroup(0, dotResources[idx].bindGroup);
            passEncoder.draw(6);
        });

        passEncoder.end();
        device.queue.submit([commandEncoder.finish()]);

        animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return {
        updateVertices(vertices: (Vec3 | null)[]) {
            currentVertices = vertices.slice(0, 6);
            while (currentVertices.length < 6) currentVertices.push(null);
            normalizeVertices();
        },
        stop() {
            isRunning = false;
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            if (resizeObserver) {
                resizeObserver.disconnect();
            } else if (resizeFallbackAttached) {
                window.removeEventListener('resize', handleResize);
            }
            canvas.removeEventListener('mousedown', handleMouseDown);
            canvas.removeEventListener('mousemove', handleMouseMove);
            canvas.removeEventListener('mouseup', handleMouseUp);
            canvas.removeEventListener('mouseleave', handleMouseUp);
        },
    };
}
