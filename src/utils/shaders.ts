// Vertex shader for the sphere
export const sphereVertexShader = `
struct Uniforms {
  modelViewProjection: mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.modelViewProjection * vec4<f32>(input.position, 1.0);
  output.normal = input.normal;
  output.worldPos = input.position;
  return output;
}
`;

// Fragment shader for the translucent sphere
export const sphereFragmentShader = `
struct FragmentInput {
  @location(0) normal: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  let lightDir = normalize(vec3<f32>(1.0, 1.0, 1.0));
  let normal = normalize(input.normal);
  let diffuse = max(dot(normal, lightDir), 0.0);
  
  // Translucent blue-ish color
  let baseColor = vec3<f32>(0.3, 0.5, 0.8);
  let color = baseColor * (0.3 + 0.7 * diffuse);
  
  // Alpha for translucency
  return vec4<f32>(color, 0.3);
}
`;

// Vertex shader for scale lines
export const lineVertexShader = `
struct Uniforms {
  modelViewProjection: mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.modelViewProjection * vec4<f32>(input.position, 1.0);
  return output;
}
`;

// Fragment shader for scale lines
export const lineFragmentShader = `
@fragment
fn main() -> @location(0) vec4<f32> {
  return vec4<f32>(0.5, 0.5, 0.5, 0.5);
}
`;

// Vertex shader for the light direction line
export const lightLineVertexShader = `
struct Uniforms {
  modelViewProjection: mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.modelViewProjection * vec4<f32>(input.position, 1.0);
  return output;
}
`;

// Fragment shader for the light direction line
export const lightLineFragmentShader = `
@fragment
fn main() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 0.3, 0.9);
}
`;

// Vertex shader for the glowing dot
export const dotVertexShader = `
struct Uniforms {
  modelViewProjection: mat4x4<f32>,
  dotPosition: vec3<f32>,
  dotSize: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPos: vec2<f32>,
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  
  // Billboard the quad to always face camera
  let worldPos = uniforms.dotPosition + input.position * uniforms.dotSize;
  output.position = uniforms.modelViewProjection * vec4<f32>(worldPos, 1.0);
  output.localPos = input.position.xy;
  
  return output;
}
`;

// Fragment shader for the glowing dot
export const dotFragmentShader = `
struct FragmentInput {
  @location(0) localPos: vec2<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  let dist = length(input.localPos);
  
  // Create glow effect
  let glow = 1.0 - smoothstep(0.0, 1.0, dist);
  let intensity = glow * glow;
  
  let color = vec3<f32>(1.0, 0.9, 0.3);
  return vec4<f32>(color * intensity, intensity);
}
`;

// Vertex shader for trail
export const trailVertexShader = `
struct Uniforms {
  modelViewProjection: mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) age: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) age: f32,
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.modelViewProjection * vec4<f32>(input.position, 1.0);
  output.age = input.age;
  return output;
}
`;

// Fragment shader for trail with fade
export const trailFragmentShader = `
struct FragmentInput {
  @location(0) age: f32,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  // Fade out based on age (0 = new, 1 = old)
  let alpha = 1.0 - input.age;
  let color = vec3<f32>(1.0, 0.8, 0.2);
  return vec4<f32>(color, alpha * 0.7);
}
`;
