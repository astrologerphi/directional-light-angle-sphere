import { useEffect, useRef, useState } from 'react';
import {
  createSphereGeometry,
  createScaleLines,
  createProjectionMatrix,
  createViewMatrix,
} from '../utils/geometry';
import {
  generateDemoData,
  interpolateDirection,
} from '../utils/demoData';
import {
  sphereVertexShader,
  sphereFragmentShader,
  lineVertexShader,
  lineFragmentShader,
  lightLineVertexShader,
  lightLineFragmentShader,
  dotVertexShader,
  dotFragmentShader,
  trailVertexShader,
  trailFragmentShader,
} from '../utils/shaders';
import './WebGPUVisualization.css';

interface TrailPoint {
  position: [number, number, number];
  timestamp: number;
}

const WebGPUVisualization = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(true);

  useEffect(() => {
    if (!canvasRef.current) return;

    let animationFrameId: number;
    let device: GPUDevice;
    let context: GPUCanvasContext;
    const demoData = generateDemoData();
    const trailPoints: TrailPoint[] = [];
    const maxTrailPoints = 100;
    const trailFadeTime = 3000; // 3 seconds

    const init = async () => {
      try {
        const canvas = canvasRef.current!;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          throw new Error('No GPU adapter found');
        }

        device = await adapter.requestDevice();
        context = canvas.getContext('webgpu')!;
        
        const devicePixelRatio = window.devicePixelRatio || 1;
        canvas.width = canvas.clientWidth * devicePixelRatio;
        canvas.height = canvas.clientHeight * devicePixelRatio;

        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        context.configure({
          device,
          format: presentationFormat,
          alphaMode: 'premultiplied',
        });

        // Create sphere geometry
        const sphere = createSphereGeometry(1, 48, 24);
        const scaleLines = createScaleLines(1.01);

        // Create buffers
        const sphereVertexBuffer = device.createBuffer({
          size: sphere.vertices.byteLength,
          usage: GPUBufferUsage.VERTEX,
          mappedAtCreation: true,
        });
        new Float32Array(sphereVertexBuffer.getMappedRange()).set(sphere.vertices);
        sphereVertexBuffer.unmap();

        const sphereNormalBuffer = device.createBuffer({
          size: sphere.normals.byteLength,
          usage: GPUBufferUsage.VERTEX,
          mappedAtCreation: true,
        });
        new Float32Array(sphereNormalBuffer.getMappedRange()).set(sphere.normals);
        sphereNormalBuffer.unmap();

        const sphereIndexBuffer = device.createBuffer({
          size: sphere.indices.byteLength,
          usage: GPUBufferUsage.INDEX,
          mappedAtCreation: true,
        });
        new Uint16Array(sphereIndexBuffer.getMappedRange()).set(sphere.indices);
        sphereIndexBuffer.unmap();

        const scaleLinesBuffer = device.createBuffer({
          size: scaleLines.vertices.byteLength,
          usage: GPUBufferUsage.VERTEX,
          mappedAtCreation: true,
        });
        new Float32Array(scaleLinesBuffer.getMappedRange()).set(scaleLines.vertices);
        scaleLinesBuffer.unmap();

        // Create uniform buffer
        const uniformBufferSize = 64; // mat4x4
        const uniformBuffer = device.createBuffer({
          size: uniformBufferSize,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create bind group layout
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

        // Create pipelines
        const pipelineLayout = device.createPipelineLayout({
          bindGroupLayouts: [bindGroupLayout],
        });

        // Sphere pipeline (translucent)
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
            targets: [
              {
                format: presentationFormat,
                blend: {
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
                },
              },
            ],
          },
          primitive: {
            topology: 'triangle-list',
            cullMode: 'back',
          },
          depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus',
          },
        });

        // Scale lines pipeline
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
            targets: [
              {
                format: presentationFormat,
                blend: {
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
                },
              },
            ],
          },
          primitive: {
            topology: 'line-strip',
          },
          depthStencil: {
            depthWriteEnabled: false,
            depthCompare: 'less',
            format: 'depth24plus',
          },
        });

        // Light line pipeline
        const lightLinePipeline = device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: {
            module: device.createShaderModule({ code: lightLineVertexShader }),
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
            targets: [
              {
                format: presentationFormat,
                blend: {
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
                },
              },
            ],
          },
          primitive: {
            topology: 'line-list',
          },
          depthStencil: {
            depthWriteEnabled: false,
            depthCompare: 'less',
            format: 'depth24plus',
          },
        });

        // Create depth texture
        let depthTexture = device.createTexture({
          size: [canvas.width, canvas.height],
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        // Animation state
        let startTime = Date.now();

        const render = () => {
          if (!isRunning) return;

          const now = Date.now();
          const elapsed = (now - startTime) / 1000;
          const cycleDuration = demoData[demoData.length - 1].time;
          const cycleTime = elapsed % cycleDuration;

          // Find current position in demo data
          let nextIndex = demoData.findIndex((d) => d.time > cycleTime);
          if (nextIndex === -1) nextIndex = 0;
          const prevIndex = nextIndex === 0 ? demoData.length - 1 : nextIndex - 1;

          const prev = demoData[prevIndex];
          const next = demoData[nextIndex];
          const timeBetween = next.time - prev.time;
          const t = timeBetween > 0 ? (cycleTime - prev.time) / timeBetween : 0;

          const currentDirection = interpolateDirection(prev, next, t);

          // Add to trail
          trailPoints.push({
            position: [currentDirection.x, currentDirection.y, currentDirection.z],
            timestamp: now,
          });

          // Remove old trail points
          while (trailPoints.length > 0 && now - trailPoints[0].timestamp > trailFadeTime) {
            trailPoints.shift();
          }
          if (trailPoints.length > maxTrailPoints) {
            trailPoints.shift();
          }

          // Update matrices
          const aspect = canvas.width / canvas.height;
          const projectionMatrix = createProjectionMatrix(Math.PI / 4, aspect, 0.1, 100);
          const viewMatrix = createViewMatrix([0, 0, 3.5], [0, 0, 0], [0, 1, 0]);

          // Combine matrices (simplified - in real app would use proper matrix multiplication)
          const mvpMatrix = new Float32Array(16);
          for (let i = 0; i < 16; i++) {
            mvpMatrix[i] = projectionMatrix[i] + viewMatrix[i] * 0; // Simplified
          }
          
          // Proper matrix multiplication
          multiplyMatrices(mvpMatrix, projectionMatrix, viewMatrix);

          device.queue.writeBuffer(uniformBuffer, 0, mvpMatrix);

          // Create light line buffer
          const lightLineData = new Float32Array([
            0, 0, 0,
            currentDirection.x, currentDirection.y, currentDirection.z,
          ]);
          const lightLineBuffer = device.createBuffer({
            size: lightLineData.byteLength,
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true,
          });
          new Float32Array(lightLineBuffer.getMappedRange()).set(lightLineData);
          lightLineBuffer.unmap();

          // Create trail buffer
          let trailBuffer: GPUBuffer | null = null;
          let trailVertexCount = 0;
          if (trailPoints.length > 1) {
            const trailData: number[] = [];
            trailPoints.forEach((point) => {
              const age = (now - point.timestamp) / trailFadeTime;
              trailData.push(...point.position, age);
            });
            const trailArray = new Float32Array(trailData);
            trailBuffer = device.createBuffer({
              size: trailArray.byteLength,
              usage: GPUBufferUsage.VERTEX,
              mappedAtCreation: true,
            });
            new Float32Array(trailBuffer.getMappedRange()).set(trailArray);
            trailBuffer.unmap();
            trailVertexCount = trailPoints.length;
          }

          // Create trail pipeline
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
              targets: [
                {
                  format: presentationFormat,
                  blend: {
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
                  },
                },
              ],
            },
            primitive: {
              topology: 'line-strip',
            },
            depthStencil: {
              depthWriteEnabled: false,
              depthCompare: 'less',
              format: 'depth24plus',
            },
          });

          // Create dot buffer (quad)
          const dotSize = 0.08;
          const dotQuadData = new Float32Array([
            -1, -1, 0,
            1, -1, 0,
            1, 1, 0,
            -1, -1, 0,
            1, 1, 0,
            -1, 1, 0,
          ]);
          const dotQuadBuffer = device.createBuffer({
            size: dotQuadData.byteLength,
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true,
          });
          new Float32Array(dotQuadBuffer.getMappedRange()).set(dotQuadData);
          dotQuadBuffer.unmap();

          // Create dot uniform buffer
          const dotUniformData = new Float32Array([
            ...mvpMatrix,
            currentDirection.x, currentDirection.y, currentDirection.z, 0,
            dotSize, 0, 0, 0,
          ]);
          const dotUniformBuffer = device.createBuffer({
            size: dotUniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM,
            mappedAtCreation: true,
          });
          new Float32Array(dotUniformBuffer.getMappedRange()).set(dotUniformData);
          dotUniformBuffer.unmap();

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
              targets: [
                {
                  format: presentationFormat,
                  blend: {
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
                  },
                },
              ],
            },
            primitive: {
              topology: 'triangle-list',
            },
            depthStencil: {
              depthWriteEnabled: false,
              depthCompare: 'less',
              format: 'depth24plus',
            },
          });

          // Render
          const commandEncoder = device.createCommandEncoder();
          const textureView = context.getCurrentTexture().createView();

          const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [
              {
                view: textureView,
                clearValue: { r: 0.1, g: 0.1, b: 0.15, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
            depthStencilAttachment: {
              view: depthTexture.createView(),
              depthClearValue: 1.0,
              depthLoadOp: 'clear',
              depthStoreOp: 'store',
            },
          };

          const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);

          // Draw sphere
          passEncoder.setPipeline(spherePipeline);
          passEncoder.setBindGroup(0, bindGroup);
          passEncoder.setVertexBuffer(0, sphereVertexBuffer);
          passEncoder.setVertexBuffer(1, sphereNormalBuffer);
          passEncoder.setIndexBuffer(sphereIndexBuffer, 'uint16');
          passEncoder.drawIndexed(sphere.indices.length);

          // Draw scale lines
          passEncoder.setPipeline(linesPipeline);
          passEncoder.setBindGroup(0, bindGroup);
          passEncoder.setVertexBuffer(0, scaleLinesBuffer);
          const lineSegmentSize = 65;
          const numLineSegments = scaleLines.vertices.length / 3 / lineSegmentSize;
          for (let i = 0; i < numLineSegments; i++) {
            passEncoder.draw(lineSegmentSize, 1, i * lineSegmentSize, 0);
          }

          // Draw trail
          if (trailBuffer && trailVertexCount > 1) {
            passEncoder.setPipeline(trailPipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.setVertexBuffer(0, trailBuffer);
            passEncoder.draw(trailVertexCount);
          }

          // Draw light line
          passEncoder.setPipeline(lightLinePipeline);
          passEncoder.setBindGroup(0, bindGroup);
          passEncoder.setVertexBuffer(0, lightLineBuffer);
          passEncoder.draw(2);

          // Draw glowing dot
          passEncoder.setPipeline(dotPipeline);
          passEncoder.setBindGroup(0, dotBindGroup);
          passEncoder.setVertexBuffer(0, dotQuadBuffer);
          passEncoder.draw(6);

          passEncoder.end();
          device.queue.submit([commandEncoder.finish()]);

          animationFrameId = requestAnimationFrame(render);
        };

        render();
      } catch (err) {
        console.error('WebGPU initialization error:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    };

    init();

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isRunning]);

  // Helper function for matrix multiplication
  function multiplyMatrices(result: Float32Array, a: Float32Array, b: Float32Array) {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        result[i * 4 + j] = 
          a[i * 4 + 0] * b[0 * 4 + j] +
          a[i * 4 + 1] * b[1 * 4 + j] +
          a[i * 4 + 2] * b[2 * 4 + j] +
          a[i * 4 + 3] * b[3 * 4 + j];
      }
    }
  }

  if (error) {
    return (
      <div className="visualization-container">
        <div className="error">Error initializing WebGPU: {error}</div>
      </div>
    );
  }

  return (
    <div className="visualization-container">
      <canvas ref={canvasRef} className="webgpu-canvas" />
      <div className="controls">
        <button onClick={() => setIsRunning(!isRunning)}>
          {isRunning ? 'Pause' : 'Play'}
        </button>
      </div>
    </div>
  );
};

export default WebGPUVisualization;
