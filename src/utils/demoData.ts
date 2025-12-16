// Demo data: light direction changes over time
export interface LightDirection {
  x: number;
  y: number;
  z: number;
  time: number;
}

// Generate a periodic path for the light direction
// The path creates a figure-8 pattern on the sphere
export function generateDemoData(): LightDirection[] {
  const data: LightDirection[] = [];
  const numPoints = 200;
  const duration = 20; // seconds for full cycle

  for (let i = 0; i < numPoints; i++) {
    const t = (i / numPoints) * Math.PI * 2;
    const time = (i / numPoints) * duration;

    // Create a figure-8 pattern (lemniscate) on the sphere
    const a = 0.8; // size parameter
    const denominator = 1 + Math.sin(t) ** 2;
    
    // Parametric equations for 3D lemniscate
    const x = (a * Math.cos(t)) / denominator;
    const y = (a * Math.sin(t) * Math.cos(t)) / denominator;
    const z = Math.sin(t * 0.5) * 0.5;

    // Normalize to ensure it's on the unit sphere
    const length = Math.sqrt(x * x + y * y + z * z);
    
    data.push({
      x: x / length,
      y: y / length,
      z: z / length,
      time,
    });
  }

  return data;
}

// Interpolate between two directions
export function interpolateDirection(
  dir1: LightDirection,
  dir2: LightDirection,
  t: number
): { x: number; y: number; z: number } {
  // Spherical linear interpolation (slerp)
  const dot = dir1.x * dir2.x + dir1.y * dir2.y + dir1.z * dir2.z;
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  
  if (theta < 0.001) {
    // Directions are very close, use linear interpolation
    return {
      x: dir1.x + (dir2.x - dir1.x) * t,
      y: dir1.y + (dir2.y - dir1.y) * t,
      z: dir1.z + (dir2.z - dir1.z) * t,
    };
  }

  const sinTheta = Math.sin(theta);
  const w1 = Math.sin((1 - t) * theta) / sinTheta;
  const w2 = Math.sin(t * theta) / sinTheta;

  return {
    x: w1 * dir1.x + w2 * dir2.x,
    y: w1 * dir1.y + w2 * dir2.y,
    z: w1 * dir1.z + w2 * dir2.z,
  };
}
