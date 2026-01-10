import { createProjectionMatrix, createViewMatrix, multiplyMatrices } from './geometry';
import { generateDemoData, interpolateDirection, getAvailablePaths } from './direction-data';

export { getAvailablePaths };
import { dotFragmentShader, dotVertexShader, trailFragmentShader, trailVertexShader } from '../shaders/_index';

const dotSize = 0.08;
const maxTrailPoints = 3600;
const trailFadeTime = 6400;
const animationSpeed = 10;

// Uniform buffer sizes (must be aligned to 16 bytes)
const trailUniformBufferSize = 80; // mat4x4 (64) + vec3 (12) + padding (4)
const dotUniformBufferSize = 96; // mat4x4 (64) + vec3 + f32 (16) + vec3 + padding (16)

export interface VisualizationController {
    pause(): void;
    resume(): void;
    stop(): void;
    readonly running: boolean;
}

// Create a circular plane with grid lines
function createCircularPlane(radius = 1, segments = 32): { vertices: Float32Array } {
    const vertices: number[] = [];

    // Draw concentric circles
    for (let r = 0.2; r <= 1.0; r += 0.2) {
        const adjustedRadius = radius * r;
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = adjustedRadius * Math.cos(angle);
            const z = adjustedRadius * Math.sin(angle);
            vertices.push(x, 0, z);
        }
    }

    // Draw radial lines
    for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const dx = Math.cos(angle);
        const dz = Math.sin(angle);

        for (let r = 0; r <= 1.0; r += 0.05) {
            const adjustedRadius = radius * r;
            vertices.push(adjustedRadius * dx, 0, adjustedRadius * dz);
        }
    }

    // Draw outline circle
    for (let i = 0; i <= segments * 2; i++) {
        const angle = (i / (segments * 2)) * Math.PI * 2;
        const x = radius * Math.cos(angle);
        const z = radius * Math.sin(angle);
        vertices.push(x, 0, z);
    }

    return {
        vertices: new Float32Array(vertices),
    };
}

// Project 3D direction onto 2D plane (stereographic projection from top)
function projectToPlane(direction: Vector3): { x: number; z: number } {
    // If direction points straight up (y = 1), map to center
    // If direction points horizontally (y = 0), map to circle edge
    // Stereographic projection from north pole
    const scale = 1 / (1 + direction.y + 0.01); // Add small epsilon to avoid division by zero
    return {
        x: direction.x * scale,
        z: direction.z * scale,
    };
}

function createStaticBuffer(
    device: GPUDevice,
    data: Float32Array | Uint16Array,
    usage: GPUBufferUsageFlags
): GPUBuffer {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: usage | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    return buffer;
}

function alphaBlend(): GPUBlendState {
    return {
        color: {
            srcFactor: 'src-alpha',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
        },
        alpha: {
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
        },
    };
}

function getCurrentKeyframes(
    demoData: LightDirection[],
    cycleTime: number,
    cycleDuration: number
): { prev: LightDirection; next: LightDirection; t: number } {
    let nextIndex = demoData.findIndex(d => d.time > cycleTime);
    if (nextIndex === -1) nextIndex = 0;
    const prevIndex = nextIndex === 0 ? demoData.length - 1 : nextIndex - 1;

    const prev = demoData[prevIndex];
    const next = demoData[nextIndex];

    const timeBetween = next.time - prev.time <= 0 ? cycleDuration - prev.time + next.time : next.time - prev.time;

    let t: number;
    if (next.time > prev.time) {
        t = timeBetween === 0 ? 0 : (cycleTime - prev.time) / timeBetween;
    } else {
        const adjustedTime = cycleTime >= prev.time ? cycleTime - prev.time : cycleDuration - prev.time + cycleTime;
        t = timeBetween === 0 ? 0 : adjustedTime / timeBetween;
    }

    return { prev, next, t };
}

export async function initWebGPUVisualizationPlane(
    canvas: HTMLCanvasElement,
    statusEl?: HTMLElement | null,
    pathKey: string = 'default'
): Promise<VisualizationController> {
    if (!navigator.gpu) {
        throw new Error('WebGPU is not available in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error('No GPU adapter found.');
    }

    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) {
        throw new Error('Unable to acquire WebGPU context.');
    }

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    const segments = generateDemoData(pathKey).filter(s => s.id == 0);
    if (segments.length === 0) {
        throw new Error('No segment data found.');
    }

    const cycleDuration = segments[0].directions[segments[0].directions.length - 1]?.time ?? 0;
    if (cycleDuration <= 0) {
        throw new Error('Demo data is empty.');
    }

    // Create trail points array for each segment (2D positions)
    const segmentTrails: { points: { position: Vec3; timestamp: number }[] }[] = segments.map(() => ({ points: [] }));

    const plane = createCircularPlane(1.5, 64);
    const planeBuffer = createStaticBuffer(device, plane.vertices, GPUBufferUsage.VERTEX);

    const uniformBufferSize = 64;
    const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: 'uniform' },
            },
        ],
    });

    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: { buffer: uniformBuffer },
            },
        ],
    });

    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
    });

    // Simple line shader for grid
    const lineVertexShader = `
        struct Uniforms {
            modelViewProjection: mat4x4<f32>,
        }
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        
        @vertex
        fn main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
            return uniforms.modelViewProjection * vec4<f32>(position, 1.0);
        }
    `;

    const lineFragmentShader = `
        @fragment
        fn main() -> @location(0) vec4<f32> {
            return vec4<f32>(0.3, 0.4, 0.5, 0.4);
        }
    `;

    const linesPipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: device.createShaderModule({ code: lineVertexShader }),
            entryPoint: 'main',
            buffers: [
                {
                    arrayStride: 12,
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
                },
            ],
        },
        fragment: {
            module: device.createShaderModule({ code: lineFragmentShader }),
            entryPoint: 'main',
            targets: [{ format: presentationFormat, blend: alphaBlend() }],
        },
        primitive: { topology: 'line-strip' },
        depthStencil: {
            depthWriteEnabled: false,
            depthCompare: 'less',
            format: 'depth24plus',
        },
    });

    const trailBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' },
            },
        ],
    });

    const trailPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [trailBindGroupLayout] }),
        vertex: {
            module: device.createShaderModule({ code: trailVertexShader }),
            entryPoint: 'main',
            buffers: [
                {
                    arrayStride: 16,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x3' },
                        { shaderLocation: 1, offset: 12, format: 'float32' },
                    ],
                },
            ],
        },
        fragment: {
            module: device.createShaderModule({ code: trailFragmentShader }),
            entryPoint: 'main',
            targets: [{ format: presentationFormat, blend: alphaBlend() }],
        },
        primitive: { topology: 'line-strip' },
        depthStencil: {
            depthWriteEnabled: false,
            depthCompare: 'less',
            format: 'depth24plus',
        },
    });

    interface SegmentResources {
        trailBuffer: GPUBuffer;
        trailUniformBuffer: GPUBuffer;
        trailBindGroup: GPUBindGroup;
        dotUniformBuffer: GPUBuffer;
        dotBindGroup: GPUBindGroup;
    }

    const dotBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' },
            },
        ],
    });

    const dotPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [dotBindGroupLayout] }),
        vertex: {
            module: device.createShaderModule({ code: dotVertexShader }),
            entryPoint: 'main',
            buffers: [
                {
                    arrayStride: 12,
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
                },
            ],
        },
        fragment: {
            module: device.createShaderModule({ code: dotFragmentShader }),
            entryPoint: 'main',
            targets: [{ format: presentationFormat, blend: alphaBlend() }],
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
            depthWriteEnabled: false,
            depthCompare: 'less',
            format: 'depth24plus',
        },
    });

    const dotQuadVertices = new Float32Array([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ]);
    const dotQuadBuffer = createStaticBuffer(device, dotQuadVertices, GPUBufferUsage.VERTEX);

    const segmentResources: SegmentResources[] = segments.map(_segment => {
        const trailBuffer = device.createBuffer({
            size: maxTrailPoints * 16,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        const trailUniformBuffer = device.createBuffer({
            size: trailUniformBufferSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const trailBindGroup = device.createBindGroup({
            layout: trailBindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: trailUniformBuffer } }],
        });

        const dotUniformBuffer = device.createBuffer({
            size: dotUniformBufferSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const dotBindGroup = device.createBindGroup({
            layout: dotBindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: dotUniformBuffer } }],
        });

        return {
            trailBuffer,
            trailUniformBuffer,
            trailBindGroup,
            dotUniformBuffer,
            dotBindGroup,
        };
    });

    let depthTexture: GPUTexture | null = null;
    let configured = false;

    const configureSurface = (force = false) => {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.floor((rect.width || canvas.clientWidth || 640) * dpr));
        const height = Math.max(1, Math.floor((rect.height || canvas.clientHeight || 480) * dpr));

        if (!configured || force) {
            context.configure({
                device,
                format: presentationFormat,
                alphaMode: 'opaque',
            });
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

    let animationFrameId: number | null = null;
    let isRunning = true;
    let pauseOffset = 0;
    let startTime = performance.now();

    const controller: VisualizationController = {
        pause() {
            if (!isRunning) return;
            isRunning = false;
            pauseOffset = performance.now() - startTime;
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        },
        resume() {
            if (isRunning) return;
            isRunning = true;
            startTime = performance.now() - pauseOffset;
            animationFrameId = requestAnimationFrame(render);
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
        },
        get running() {
            return isRunning;
        },
    };

    const updateStatus = (message: string) => {
        if (statusEl) {
            statusEl.textContent = message;
        }
    };

    const render = (now?: number) => {
        if (!isRunning) {
            return;
        }

        const elapsedSeconds = (((now ?? performance.now()) - startTime) / 1000) * animationSpeed;
        const cycleTime = cycleDuration === 0 ? 0 : elapsedSeconds % cycleDuration;
        const nowMs = performance.now();

        // Calculate current direction for each segment
        const currentDirections: Vector3[] = segments.map(segment => {
            const { prev, next, t } = getCurrentKeyframes(segment.directions, cycleTime, cycleDuration);
            return interpolateDirection(prev, next, t);
        });

        // Project to 2D and update trail points
        segments.forEach((_, idx) => {
            const trail = segmentTrails[idx];
            const direction = currentDirections[idx];
            const projected = projectToPlane(direction);

            trail.points.push({
                position: [projected.x, 0, projected.z],
                timestamp: nowMs,
            });

            while (trail.points.length > 0 && nowMs - trail.points[0].timestamp > trailFadeTime) {
                trail.points.shift();
            }
            if (trail.points.length > maxTrailPoints) {
                trail.points.shift();
            }
        });

        const aspect = canvas.width / canvas.height;
        const projectionMatrix = createProjectionMatrix(Math.PI / 4, aspect, 0.1, 100);

        // Top-down view
        const viewMatrix = createViewMatrix([0, 3, 0], [0, 0, 0], [0, 0, 1]);
        const mvpMatrix = new Float32Array(16);
        multiplyMatrices(mvpMatrix, projectionMatrix, viewMatrix);

        device.queue.writeBuffer(uniformBuffer, 0, mvpMatrix);

        // Update per-segment buffers
        segments.forEach((segment, idx) => {
            const resources = segmentResources[idx];
            const trail = segmentTrails[idx];
            const direction = currentDirections[idx];
            const projected = projectToPlane(direction);

            // Trail uniform buffer: MVP matrix + color
            const trailUniformData = new Float32Array(20);
            trailUniformData.set(mvpMatrix, 0);
            trailUniformData.set(segment.color, 16);
            device.queue.writeBuffer(resources.trailUniformBuffer, 0, trailUniformData);

            // Dot uniform buffer: MVP matrix + position + size + color
            const dotUniformData = new Float32Array(24);
            dotUniformData.set(mvpMatrix, 0);
            dotUniformData[16] = projected.x;
            dotUniformData[17] = 0;
            dotUniformData[18] = projected.z;
            dotUniformData[19] = dotSize;
            dotUniformData.set(segment.color, 20);
            device.queue.writeBuffer(resources.dotUniformBuffer, 0, dotUniformData);

            // Trail vertex buffer
            if (trail.points.length > 0) {
                const trailData = new Float32Array(trail.points.length * 4);
                trail.points.forEach((point, i) => {
                    const age = Math.min(1, (nowMs - point.timestamp) / trailFadeTime);
                    const baseIndex = i * 4;
                    trailData[baseIndex + 0] = point.position[0];
                    trailData[baseIndex + 1] = point.position[1];
                    trailData[baseIndex + 2] = point.position[2];
                    trailData[baseIndex + 3] = age;
                });
                device.queue.writeBuffer(resources.trailBuffer, 0, trailData);
            }
        });

        const textureView = context.getCurrentTexture().createView();
        const commandEncoder = device.createCommandEncoder();

        const renderPassDescriptor: GPURenderPassDescriptor = {
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
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

        // Draw circular plane grid
        passEncoder.setPipeline(linesPipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, planeBuffer);

        const totalVertices = plane.vertices.length / 3;
        let offset = 0;

        // Draw concentric circles
        const circleSegments = 65;
        for (let i = 0; i < 5; i++) {
            passEncoder.draw(circleSegments, 1, offset, 0);
            offset += circleSegments;
        }

        // Draw radial lines
        const radialPoints = 21;
        for (let i = 0; i < 8; i++) {
            passEncoder.draw(radialPoints, 1, offset, 0);
            offset += radialPoints;
        }

        // Draw outline
        const outlinePoints = totalVertices - offset;
        passEncoder.draw(outlinePoints, 1, offset, 0);

        // Draw trails
        passEncoder.setPipeline(trailPipeline);
        segments.forEach((_, idx) => {
            const resources = segmentResources[idx];
            const trail = segmentTrails[idx];
            if (trail.points.length > 1) {
                passEncoder.setBindGroup(0, resources.trailBindGroup);
                passEncoder.setVertexBuffer(0, resources.trailBuffer);
                passEncoder.draw(trail.points.length, 1, 0, 0);
            }
        });

        // Draw dots
        passEncoder.setPipeline(dotPipeline);
        passEncoder.setVertexBuffer(0, dotQuadBuffer);
        segments.forEach((_, idx) => {
            const resources = segmentResources[idx];
            passEncoder.setBindGroup(0, resources.dotBindGroup);
            passEncoder.draw(6);
        });

        passEncoder.end();
        device.queue.submit([commandEncoder.finish()]);

        animationFrameId = requestAnimationFrame(render);
    };

    updateStatus('WebGPU Plane View ready. Playing animation.');
    animationFrameId = requestAnimationFrame(render);

    return controller;
}
