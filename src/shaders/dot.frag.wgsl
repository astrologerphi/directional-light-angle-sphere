struct FragmentInput {
  @location(0) localPos: vec2<f32>,
  @location(1) color: vec3<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  let dist = length(input.localPos);
  let core = 1.0 - smoothstep(0.0, 0.28, dist);
  let glow = 1.0 - smoothstep(0.08, 1.0, dist);
  let halo = pow(glow, 2.4);
  let color = input.color * (0.4 + halo * 1.35) + vec3<f32>(1.0, 1.0, 1.0) * core * 0.65;
  let alpha = max(core * 0.95, halo * 0.78);
  return vec4<f32>(color, alpha);
}
