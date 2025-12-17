struct FragmentInput {
  @location(0) age: f32,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  let alpha = 1.0 - input.age;
  let color = vec3<f32>(1.0, 0.75, 0.15);
  return vec4<f32>(color, alpha * 0.7);
}
