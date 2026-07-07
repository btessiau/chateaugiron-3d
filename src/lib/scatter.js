// Pure point sampling for scattering trees inside wooded polygons. Deterministic
// so the forest looks the same every load. Rings are arrays of [x, z].

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pointInPolygon(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const zi = ring[i][1];
    const xj = ring[j][0];
    const zj = ring[j][1];
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function ringBounds(ring) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

// Jittered grid of points that fall inside the polygon. spacing is the grid
// step in metres; seed makes the jitter deterministic.
export function scatterInPolygon(ring, spacing, seed = 1) {
  if (ring.length < 3 || spacing <= 0) return [];
  const b = ringBounds(ring);
  const rng = mulberry32(seed);
  const pts = [];
  for (let x = b.minX; x <= b.maxX; x += spacing) {
    for (let z = b.minZ; z <= b.maxZ; z += spacing) {
      const jx = x + (rng() - 0.5) * spacing * 0.85;
      const jz = z + (rng() - 0.5) * spacing * 0.85;
      if (pointInPolygon(jx, jz, ring)) pts.push({ x: jx, z: jz, s: 0.7 + rng() * 0.7 });
    }
  }
  return pts;
}
