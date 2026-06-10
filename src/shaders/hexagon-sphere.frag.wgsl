struct FragmentInput {
  @location(0) normal: vec3<f32>,
  @location(1) color: vec3<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  let normal = normalize(input.normal);
  let lightDir = normalize(vec3<f32>(0.4, 1.0, 0.35));
  let viewDir = normalize(vec3<f32>(0.0, 0.0, 1.0));
  let halfVector = normalize(lightDir + viewDir);
  let diffuse = max(dot(normal, lightDir), 0.0);
  let specular = pow(max(dot(normal, halfVector), 0.0), 24.0);
  let ambient = 0.24;
  let color = input.color * (ambient + diffuse * 0.86) + vec3<f32>(1.0, 1.0, 1.0) * specular * 0.65;
  return vec4<f32>(color, 0.98);
}
