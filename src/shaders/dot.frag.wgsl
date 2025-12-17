struct FragmentInput {
  @location(0) localPos: vec2<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  let dist = length(input.localPos);
  let glow = 1.0 - smoothstep(0.0, 1.0, dist);
  let intensity = glow * glow;
  let color = vec3<f32>(1.0, 0.9, 0.3);
  return vec4<f32>(color * intensity, intensity * 0.9);
}
