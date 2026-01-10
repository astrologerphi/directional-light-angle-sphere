import {
    createProjectionMatrix,
    createScaleLines,
    createSphereGeometry,
    createViewMatrix,
    multiplyMatrices,
    createCoordinateAxes,
} from './geometry';
import { generateDemoData, interpolateDirection, getAvailablePaths } from './direction-data';

export { getAvailablePaths };
import {
    dotFragmentShader,
    dotVertexShader,
    lightLineFragmentShader,
    lineFragmentShader,
    lineVertexShader,
    sphereFragmentShader,
    sphereVertexShader,
    trailFragmentShader,
    trailVertexShader,
} from '../shaders/_index';

const dotSize = 0.1;
const maxTrailPoints = 3600;
const trailFadeTime = 6400;
const animationSpeed = 10; // Multiplier: 1 = real-time (24 sec = 24 hours), 4 = 4x faster

// Uniform buffer sizes (must be aligned to 16 bytes)
const trailUniformBufferSize = 80; // mat4x4 (64) + vec3 (12) + padding (4)
const dotUniformBufferSize = 96; // mat4x4 (64) + vec3 + f32 (16) + vec3 + padding (16)

export interface VisualizationController {
    pause(): void;
    resume(): void;
    stop(): void;
    readonly running: boolean;
}

export async function initWebGPUVisualization(
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

    // Use the first segment's cycle duration as reference (all should be 24 hours)
    const cycleDuration = segments[0].directions[segments[0].directions.length - 1]?.time ?? 0;
    if (cycleDuration <= 0) {
        throw new Error('Demo data is empty.');
    }

    // Create trail points array for each segment
    const segmentTrails: SegmentTrail[] = segments.map(() => ({ points: [] }));

    const sphere = createSphereGeometry(0.99, 48, 24);
    const scaleLines = createScaleLines(1.01);
    const coordinateAxes = createCoordinateAxes(1.5);

    const sphereVertexBuffer = createStaticBuffer(device, sphere.vertices, GPUBufferUsage.VERTEX);
    const sphereNormalBuffer = createStaticBuffer(device, sphere.normals, GPUBufferUsage.VERTEX);
    const sphereIndexBuffer = createStaticBuffer(device, sphere.indices, GPUBufferUsage.INDEX);
    const scaleLinesBuffer = createStaticBuffer(device, scaleLines.vertices, GPUBufferUsage.VERTEX);
    const coordinateAxesBuffer = createStaticBuffer(device, coordinateAxes.vertices, GPUBufferUsage.VERTEX);

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

    const spherePipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: device.createShaderModule({ code: sphereVertexShader }),
            entryPoint: 'main',
            buffers: [
                {
                    arrayStride: 12,
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
                },
                {
                    arrayStride: 12,
                    attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }],
                },
            ],
        },
        fragment: {
            module: device.createShaderModule({ code: sphereFragmentShader }),
            entryPoint: 'main',
            targets: [{ format: presentationFormat, blend: alphaBlend() }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus',
        },
    });

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

    const lightLinePipeline = device.createRenderPipeline({
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
            module: device.createShaderModule({ code: lightLineFragmentShader }),
            entryPoint: 'main',
            targets: [{ format: presentationFormat, blend: alphaBlend() }],
        },
        primitive: { topology: 'line-list' },
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

    // Create per-segment resources
    interface SegmentResources {
        trailBuffer: GPUBuffer;
        trailUniformBuffer: GPUBuffer;
        trailBindGroup: GPUBindGroup;
        lightLineBuffer: GPUBuffer;
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

    const dotPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [dotBindGroupLayout],
    });

    const segmentResources: SegmentResources[] = segments.map(() => {
        const trailBuffer = device.createBuffer({
            size: maxTrailPoints * 4 * Float32Array.BYTES_PER_ELEMENT,
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

        const lightLineBuffer = device.createBuffer({
            size: 6 * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
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
            lightLineBuffer,
            dotUniformBuffer,
            dotBindGroup,
        };
    });

    const dotQuadBuffer = createStaticBuffer(
        device,
        new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]),
        GPUBufferUsage.VERTEX
    );

    const dotPipeline = device.createRenderPipeline({
        layout: dotPipelineLayout,
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

    let depthTexture: GPUTexture | null = null;
    let configured = false;

    // Camera control state
    let cameraDistance = 3;
    let cameraTheta = -Math.PI / 2; // Rotation around Y axis (horizontal)
    let cameraPhi = Math.PI / 8; // Rotation from Y axis (vertical)
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

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

    // Camera controls
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
            // Clean up camera event listeners
            canvas.removeEventListener('mousedown', handleMouseDown);
            canvas.removeEventListener('mousemove', handleMouseMove);
            canvas.removeEventListener('mouseup', handleMouseUp);
            canvas.removeEventListener('mouseleave', handleMouseUp);
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

        // Update trail points for each segment
        segments.forEach((_, idx) => {
            const trail = segmentTrails[idx];
            const direction = currentDirections[idx];

            trail.points.push({
                position: [direction.x, direction.y, direction.z],
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

        // Calculate camera position from spherical coordinates
        const eyeX = cameraDistance * Math.sin(cameraPhi) * Math.cos(cameraTheta);
        const eyeY = cameraDistance * Math.cos(cameraPhi);
        const eyeZ = cameraDistance * Math.sin(cameraPhi) * Math.sin(cameraTheta);

        const viewMatrix = createViewMatrix([eyeX, eyeY, eyeZ], [0, 0, 0], [0, 1, 0]);
        const mvpMatrix = new Float32Array(16);
        multiplyMatrices(mvpMatrix, projectionMatrix, viewMatrix);

        device.queue.writeBuffer(uniformBuffer, 0, mvpMatrix);

        // Update per-segment buffers
        segments.forEach((segment, idx) => {
            const resources = segmentResources[idx];
            const trail = segmentTrails[idx];
            const direction = currentDirections[idx];

            // Trail uniform buffer: MVP matrix + color
            const trailUniformData = new Float32Array(20); // 16 for mat4 + 3 for color + 1 padding
            trailUniformData.set(mvpMatrix, 0);
            trailUniformData.set(segment.color, 16);
            device.queue.writeBuffer(resources.trailUniformBuffer, 0, trailUniformData);

            // Dot uniform buffer: MVP matrix + position + size + color
            const dotUniformData = new Float32Array(24); // 16 for mat4 + 4 (pos+size) + 4 (color+padding)
            dotUniformData.set(mvpMatrix, 0);
            dotUniformData[16] = direction.x;
            dotUniformData[17] = direction.y;
            dotUniformData[18] = direction.z;
            dotUniformData[19] = dotSize;
            dotUniformData.set(segment.color, 20);
            device.queue.writeBuffer(resources.dotUniformBuffer, 0, dotUniformData);

            // Light line buffer
            device.queue.writeBuffer(
                resources.lightLineBuffer,
                0,
                new Float32Array([0, 0, 0, direction.x, direction.y, direction.z])
            );

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

        passEncoder.setPipeline(spherePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, sphereVertexBuffer);
        passEncoder.setVertexBuffer(1, sphereNormalBuffer);
        passEncoder.setIndexBuffer(sphereIndexBuffer, 'uint16');
        passEncoder.drawIndexed(sphere.indices.length);

        passEncoder.setPipeline(linesPipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, scaleLinesBuffer);
        const lineSegmentSize = 65;
        const numLineSegments = Math.floor(scaleLines.vertices.length / 3 / lineSegmentSize);
        for (let i = 0; i < numLineSegments; i++) {
            passEncoder.draw(lineSegmentSize, 1, i * lineSegmentSize, 0);
        }

        // Draw coordinate axes
        passEncoder.setPipeline(lightLinePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, coordinateAxesBuffer);
        passEncoder.draw(6); // 3 axes * 2 vertices each

        // Draw trails for all segments
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

        // Draw light lines for all segments
        passEncoder.setPipeline(lightLinePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        segments.forEach((_, idx) => {
            const resources = segmentResources[idx];
            passEncoder.setVertexBuffer(0, resources.lightLineBuffer);
            passEncoder.draw(2);
        });

        // Draw dots for all segments
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

    updateStatus('WebGPU ready. Playing animation.');
    animationFrameId = requestAnimationFrame(render);

    return controller;
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
    // @ts-ignore
    device.queue.writeBuffer(buffer, 0, data);
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
