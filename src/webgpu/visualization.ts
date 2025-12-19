import {
    createProjectionMatrix,
    createScaleLines,
    createSphereGeometry,
    createViewMatrix,
    multiplyMatrices,
} from './geometry';
import { generateDemoData, interpolateDirection } from './direction-data';
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

export interface VisualizationController {
    pause(): void;
    resume(): void;
    stop(): void;
    readonly running: boolean;
}

export async function initWebGPUVisualization(
    canvas: HTMLCanvasElement,
    statusEl?: HTMLElement | null
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
    const demoData = generateDemoData();
    console.log(demoData);
    const cycleDuration = demoData[demoData.length - 1]?.time ?? 0;
    if (cycleDuration <= 0) {
        throw new Error('Demo data is empty.');
    }

    const trailPoints: TrailPoint[] = [];
    const sphere = createSphereGeometry(1, 48, 24);
    const scaleLines = createScaleLines(1.01);

    const sphereVertexBuffer = createStaticBuffer(device, sphere.vertices, GPUBufferUsage.VERTEX);
    const sphereNormalBuffer = createStaticBuffer(device, sphere.normals, GPUBufferUsage.VERTEX);
    const sphereIndexBuffer = createStaticBuffer(device, sphere.indices, GPUBufferUsage.INDEX);
    const scaleLinesBuffer = createStaticBuffer(device, scaleLines.vertices, GPUBufferUsage.VERTEX);

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

    const trailPipeline = device.createRenderPipeline({
        layout: pipelineLayout,
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

    const trailBuffer = device.createBuffer({
        size: maxTrailPoints * 4 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    const lightLineBuffer = device.createBuffer({
        size: 6 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    const dotQuadBuffer = createStaticBuffer(
        device,
        new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]),
        GPUBufferUsage.VERTEX
    );

    const dotUniformBuffer = device.createBuffer({
        size: 32 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const dotBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' },
            },
        ],
    });

    const dotBindGroup = device.createBindGroup({
        layout: dotBindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: { buffer: dotUniformBuffer },
            },
        ],
    });

    const dotPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [dotBindGroupLayout],
        }),
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

        const elapsedSeconds = ((now ?? performance.now()) - startTime) / 1000;
        const cycleTime = cycleDuration === 0 ? 0 : elapsedSeconds % cycleDuration;

        const { prev, next, t } = getCurrentKeyframes(demoData, cycleTime, cycleDuration);
        const currentDirection = interpolateDirection(prev, next, t);

        const nowMs = performance.now();
        trailPoints.push({
            position: [currentDirection.x, currentDirection.y, currentDirection.z],
            timestamp: nowMs,
        });

        while (trailPoints.length > 0 && nowMs - trailPoints[0].timestamp > trailFadeTime) {
            trailPoints.shift();
        }
        if (trailPoints.length > maxTrailPoints) {
            trailPoints.shift();
        }

        const aspect = canvas.width / canvas.height;
        const projectionMatrix = createProjectionMatrix(Math.PI / 4, aspect, 0.1, 100);
        // view from top looking down
        const viewMatrix = createViewMatrix([0, 3, 0], [0, 0, 0], [0, 0, 1]);
        const mvpMatrix = new Float32Array(16);
        multiplyMatrices(mvpMatrix, projectionMatrix, viewMatrix);

        device.queue.writeBuffer(uniformBuffer, 0, mvpMatrix);
        device.queue.writeBuffer(dotUniformBuffer, 0, mvpMatrix);
        device.queue.writeBuffer(
            dotUniformBuffer,
            64,
            new Float32Array([currentDirection.x, currentDirection.y, currentDirection.z, dotSize])
        );

        device.queue.writeBuffer(
            lightLineBuffer,
            0,
            new Float32Array([0, 0, 0, currentDirection.x, currentDirection.y, currentDirection.z])
        );

        if (trailPoints.length > 0) {
            const trailData = new Float32Array(trailPoints.length * 4);
            trailPoints.forEach((point, i) => {
                const age = Math.min(1, (nowMs - point.timestamp) / trailFadeTime);
                const baseIndex = i * 4;
                trailData[baseIndex + 0] = point.position[0];
                trailData[baseIndex + 1] = point.position[1];
                trailData[baseIndex + 2] = point.position[2];
                trailData[baseIndex + 3] = age;
            });
            device.queue.writeBuffer(trailBuffer, 0, trailData);
        }

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

        if (trailPoints.length > 1) {
            passEncoder.setPipeline(trailPipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.setVertexBuffer(0, trailBuffer);
            passEncoder.draw(trailPoints.length, 1, 0, 0);
        }

        passEncoder.setPipeline(lightLinePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.setVertexBuffer(0, lightLineBuffer);
        passEncoder.draw(2);

        passEncoder.setPipeline(dotPipeline);
        passEncoder.setBindGroup(0, dotBindGroup);
        passEncoder.setVertexBuffer(0, dotQuadBuffer);
        passEncoder.draw(6);

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
