struct Uniforms {
  modelViewProjection: mat4x4<f32>,
  color: vec3<f32>,
  _padding: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) age: f32,
  @builtin(instance_index) instanceIndex: u32,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) age: f32,
  @location(1) color: vec3<f32>,
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  
  // Apply small offset based on instance index for thickness effect
  let offset = (f32(input.instanceIndex) - 1.0) * 0.003;
  var pos = input.position;
  pos.x += offset;
  pos.y += offset * 0.5;
  
  output.position = uniforms.modelViewProjection * vec4<f32>(pos, 1.0);
  output.age = input.age;
  output.color = uniforms.color;
  return output;
}
