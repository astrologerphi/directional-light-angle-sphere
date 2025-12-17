struct FragmentInput {
  @location(0) normal: vec3<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  let lightDir = normalize(vec3<f32>(1.0, 1.0, 1.0));
  let normal = normalize(input.normal);
  let diffuse = max(dot(normal, lightDir), 0.0);
  let baseColor = vec3<f32>(0.3, 0.5, 0.8);
  let color = baseColor * (0.3 + 0.7 * diffuse);
  return vec4<f32>(color, 0.28);
}
