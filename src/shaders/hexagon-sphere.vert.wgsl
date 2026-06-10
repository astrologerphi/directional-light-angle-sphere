struct SphereUniforms {
  modelViewProjection: mat4x4<f32>,
  spherePosition: vec3<f32>,
  sphereScale: f32,
  sphereColor: vec3<f32>,
  _padding: f32,
}

@group(0) @binding(0) var<uniform> uniforms: SphereUniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) color: vec3<f32>,
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let worldPosition = uniforms.spherePosition + input.position * uniforms.sphereScale;
  output.position = uniforms.modelViewProjection * vec4<f32>(worldPosition, 1.0);
  output.normal = input.normal;
  output.color = uniforms.sphereColor;
  return output;
}
