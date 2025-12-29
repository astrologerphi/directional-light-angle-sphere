struct FragmentInput {
  @location(0) age: f32,
  @location(1) color: vec3<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  let alpha = 1.0 - input.age;
  return vec4<f32>(input.color, alpha * 0.7);
}
