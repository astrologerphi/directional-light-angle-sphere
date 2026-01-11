import { createProjectionMatrix, createViewMatrix, multiplyMatrices } from './geometry';
import { generateDemoData, interpolateDirection, getAvailablePaths } from './direction-data';

export { getAvailablePaths };
import {
    dotFragmentShader,
    dotVertexShader,
    gridFragmentShader,
    gridVertexShader,
    trailFragmentShader,
    trailVertexShader,
} from '../shaders/_index';

const dotSize = 0.04;
const pathThickness = 5; // Adjust this value to change path thickness (1 = thin, 5 = thick)
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

// Create a torus geometry (donut shape)
function createTorusGeometry(
    majorRadius = 1.5, // Distance from center to tube center
    minorRadius = 0.6, // Tube radius
    majorSegments = 48, // Segments around the major circle (time divisions)
    minorSegments = 24 // Segments around the tube
): { vertices: Float32Array; indices: Uint16Array } {
    const vertices: number[] = [];
    const indices: number[] = [];

    // Generate vertices
    for (let i = 0; i <= majorSegments; i++) {
        const u = (i / majorSegments) * Math.PI * 2;

        for (let j = 0; j <= minorSegments; j++) {
            const v = (j / minorSegments) * Math.PI * 2;

            const x = (majorRadius + minorRadius * Math.cos(v)) * Math.cos(u);
            const y = minorRadius * Math.sin(v);
            const z = (majorRadius + minorRadius * Math.cos(v)) * Math.sin(u);

            vertices.push(x, y, z);
        }
    }

    // Generate indices for wireframe lines
    for (let i = 0; i < majorSegments; i++) {
        for (let j = 0; j < minorSegments; j++) {
            const a = i * (minorSegments + 1) + j;
            const b = a + minorSegments + 1;
            const c = a + 1;

            // Lines around the tube
            indices.push(a, c);
            // Lines along the major circle
            indices.push(a, b);
        }
    }

    return {
        vertices: new Float32Array(vertices),
        indices: new Uint16Array(indices),
    };
}

// Project 3D direction onto the torus surface at a given time
function projectToTorus(
    time: number, // 0-24 hours
    direction: Vector3, // Light direction
    majorRadius = 1.5,
    minorRadius = 0.6
): Vec3 {
    // Convert time to angle around major circle (0 hours = -90 degrees, top)
    const majorAngle = (time / 24) * Math.PI * 2 - Math.PI / 2;

    // Project direction onto plane (stereographic projection)
    const scale = 1 / (1 + direction.y + 0.01);
    const projX = direction.x * scale;
    const projZ = direction.z * scale;

    // Convert 2D projection to position on torus cross-section
    const distance = Math.sqrt(projX * projX + projZ * projZ);
    const angle = Math.atan2(projZ, projX);

    // Clamp distance to fit within tube
    const radiusOnTube = Math.min(distance, 1.0) * minorRadius * 0.9;

    // Calculate position on torus
    const tubeX = radiusOnTube * Math.cos(angle);
    const tubeY = radiusOnTube * Math.sin(angle);

    // Position of tube center
    const centerX = majorRadius * Math.cos(majorAngle);
    const centerZ = majorRadius * Math.sin(majorAngle);

    // Rotate tube position to align with major circle
    const x = centerX + tubeX * Math.cos(majorAngle) - tubeY * 0;
    const y = tubeY;
    const z = centerZ + tubeX * Math.sin(majorAngle);

    return [x, y, z];
}

// Create circular cross-sections at intervals around the torus to show the "plane" projections
function createCrossSectionCircles(
    majorRadius = 1.5,
    minorRadius = 0.6,
    numSections = 24 // One per hour
): { vertices: Float32Array } {
    const vertices: number[] = [];
    const pointsPerCircle = 32;

    for (let section = 0; section < numSections; section++) {
        const majorAngle = (section / numSections) * Math.PI * 2 - Math.PI / 2;
        const centerX = majorRadius * Math.cos(majorAngle);
        const centerZ = majorRadius * Math.sin(majorAngle);

        // Draw a circle in the cross-section plane
        for (let i = 0; i <= pointsPerCircle; i++) {
            const angle = (i / pointsPerCircle) * Math.PI * 2;
            const r = minorRadius * 0.85;

            const localX = r * Math.cos(angle);
            const localY = r * Math.sin(angle);

            // Rotate to align with major circle
            const x = centerX + localX * Math.cos(majorAngle);
            const y = localY;
            const z = centerZ + localX * Math.sin(majorAngle);

            vertices.push(x, y, z);
        }
    }

    return {
        vertices: new Float32Array(vertices),
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

export async function initWebGPUVisualizationRing(
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
    const segments = generateDemoData(pathKey);
    if (segments.length === 0) {
        throw new Error('No segment data found.');
    }

    const cycleDuration = segments[0].directions[segments[0].directions.length - 1]?.time ?? 0;
    if (cycleDuration <= 0) {
        throw new Error('Demo data is empty.');
    }

    // Create full path visualization (all time points on torus)
    const segmentPaths: { points: Vec3[] }[] = segments.map(() => ({ points: [] }));

    const torus = createTorusGeometry(1.5, 0.6, 48, 24);
    const crossSections = createCrossSectionCircles(1.5, 0.6, 24);

    const torusVertexBuffer = createStaticBuffer(device, torus.vertices, GPUBufferUsage.VERTEX);
    const torusIndexBuffer = createStaticBuffer(device, torus.indices, GPUBufferUsage.INDEX);
    const crossSectionsBuffer = createStaticBuffer(device, crossSections.vertices, GPUBufferUsage.VERTEX);

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

    // Line shader for torus wireframe
    const torusLinesPipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: device.createShaderModule({ code: gridVertexShader }),
            entryPoint: 'main',
            buffers: [
                {
                    arrayStride: 12,
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
                },
            ],
        },
        fragment: {
            module: device.createShaderModule({ code: gridFragmentShader }),
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

    const crossSectionPipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: device.createShaderModule({ code: gridVertexShader }),
            entryPoint: 'main',
            buffers: [
                {
                    arrayStride: 12,
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
                },
            ],
        },
        fragment: {
            module: device.createShaderModule({ code: gridFragmentShader }),
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
        pathBuffer: GPUBuffer;
        pathUniformBuffer: GPUBuffer;
        pathBindGroup: GPUBindGroup;
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
        const pathBuffer = device.createBuffer({
            size: 500 * 16, // More points for full cycle
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        const pathUniformBuffer = device.createBuffer({
            size: trailUniformBufferSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const pathBindGroup = device.createBindGroup({
            layout: trailBindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: pathUniformBuffer } }],
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
            pathBuffer,
            pathUniformBuffer,
            pathBindGroup,
            dotUniformBuffer,
            dotBindGroup,
        };
    });

    let depthTexture: GPUTexture | null = null;
    let configured = false;

    // Camera control state
    let cameraDistance = 8;
    let cameraTheta = 0;
    let cameraPhi = Math.PI / 3;
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
        cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPhi - deltaY * 0.01));

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    };

    const handleMouseUp = () => {
        isDragging = false;
        canvas.style.cursor = 'grab';
    };

    const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        cameraDistance = Math.max(2, Math.min(10, cameraDistance + e.deltaY * 0.01));
    };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });

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
            canvas.removeEventListener('mousedown', handleMouseDown);
            canvas.removeEventListener('mousemove', handleMouseMove);
            canvas.removeEventListener('mouseup', handleMouseUp);
            canvas.removeEventListener('mouseleave', handleMouseUp);
            canvas.removeEventListener('wheel', handleWheel);
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

        // Calculate current direction
        const currentDirections: Vector3[] = segments.map(segment => {
            const { prev, next, t } = getCurrentKeyframes(segment.directions, cycleTime, cycleDuration);
            return interpolateDirection(prev, next, t);
        });

        // Generate full path on torus (once)
        segments.forEach((segment, idx) => {
            const path = segmentPaths[idx];
            if (path.points.length === 0) {
                const samples = 240;
                for (let i = 0; i <= samples; i++) {
                    const time = (i / samples) * cycleDuration;
                    const { prev, next, t } = getCurrentKeyframes(segment.directions, time, cycleDuration);
                    const dir = interpolateDirection(prev, next, t);
                    const pos = projectToTorus(time, dir);
                    path.points.push(pos);
                }
            }
        });

        const aspect = canvas.width / canvas.height;
        const projectionMatrix = createProjectionMatrix(Math.PI / 4, aspect, 0.1, 100);

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
            const path = segmentPaths[idx];
            const direction = currentDirections[idx];
            const currentPos = projectToTorus(cycleTime, direction);

            // Path uniform buffer
            const pathUniformData = new Float32Array(20);
            pathUniformData.set(mvpMatrix, 0);
            pathUniformData.set(segment.color, 16);
            device.queue.writeBuffer(resources.pathUniformBuffer, 0, pathUniformData);

            // Path vertex buffer
            if (path.points.length > 0) {
                const pathData = new Float32Array(path.points.length * 4);
                path.points.forEach((point, i) => {
                    const baseIndex = i * 4;
                    pathData[baseIndex + 0] = point[0];
                    pathData[baseIndex + 1] = point[1];
                    pathData[baseIndex + 2] = point[2];
                    pathData[baseIndex + 3] = 0;
                });
                device.queue.writeBuffer(resources.pathBuffer, 0, pathData);
            }

            // Dot uniform buffer
            const dotUniformData = new Float32Array(24);
            dotUniformData.set(mvpMatrix, 0);
            dotUniformData[16] = currentPos[0];
            dotUniformData[17] = currentPos[1];
            dotUniformData[18] = currentPos[2];
            dotUniformData[19] = dotSize;
            dotUniformData.set(segment.color, 20);
            device.queue.writeBuffer(resources.dotUniformBuffer, 0, dotUniformData);
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

        // Draw torus wireframe
        passEncoder.setPipeline(torusLinesPipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, torusVertexBuffer);
        passEncoder.setIndexBuffer(torusIndexBuffer, 'uint16');
        passEncoder.drawIndexed(torus.indices.length);

        // Draw cross-section circles
        passEncoder.setPipeline(crossSectionPipeline);
        passEncoder.setVertexBuffer(0, crossSectionsBuffer);
        const pointsPerCircle = 33;
        for (let i = 0; i < 24; i++) {
            passEncoder.draw(pointsPerCircle, 1, i * pointsPerCircle, 0);
        }

        // Draw path on torus (render multiple times with instance offsets for thickness)
        passEncoder.setPipeline(trailPipeline);
        segments.forEach((_, idx) => {
            const resources = segmentResources[idx];
            const path = segmentPaths[idx];
            if (path.points.length > 0) {
                passEncoder.setBindGroup(0, resources.pathBindGroup);
                passEncoder.setVertexBuffer(0, resources.pathBuffer);
                // Draw multiple instances for thickness effect
                passEncoder.draw(path.points.length, pathThickness, 0, 0);
            }
        });

        // Draw current position dot
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

    updateStatus('WebGPU Torus View ready. Playing animation.');
    animationFrameId = requestAnimationFrame(render);

    return controller;
}
