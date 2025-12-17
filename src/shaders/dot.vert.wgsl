struct DotUniforms {
  modelViewProjection: mat4x4<f32>,
  dotPosition: vec3<f32>,
  dotSize: f32,
}

@group(0) @binding(0) var<uniform> uniforms: DotUniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPos: vec2<f32>,
}

@vertex
fn main(@location(0) position: vec3<f32>) -> VertexOutput {
  var output: VertexOutput;
  let worldPos = uniforms.dotPosition + position * uniforms.dotSize;
  output.position = uniforms.modelViewProjection * vec4<f32>(worldPos, 1.0);
  output.localPos = position.xy;
  return output;
}
