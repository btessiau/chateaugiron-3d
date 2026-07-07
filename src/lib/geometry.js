// Pure 2D geometry helpers used to build the world. No three.js here, so these
// are unit tested to 100%. Points are [x, z] pairs in metres.

export const ROAD_WIDTH = {
  motorway: 12,
  trunk: 11,
  primary: 10,
  secondary: 8,
  tertiary: 6.5,
  unclassified: 5,
  residential: 5,
  living_street: 4.5,
  service: 3.5,
  pedestrian: 4,
  footway: 1.8,
  path: 1.6,
  cycleway: 2,
  track: 3,
  steps: 1.5,
};
export const DEFAULT_ROAD_WIDTH = 4;

export const ROAD_COLOR = {
  primary: 0x3a3d42,
  secondary: 0x3d4045,
  tertiary: 0x42454a,
  residential: 0x46494e,
  service: 0x4a4d52,
  pedestrian: 0x6a5f4d,
  footway: 0x6f6350,
  path: 0x6f6350,
  cycleway: 0x4a4457,
  steps: 0x6f6350,
};
export const DEFAULT_ROAD_COLOR = 0x45484d;

export function roadWidth(highway) {
  return ROAD_WIDTH[highway] ?? DEFAULT_ROAD_WIDTH;
}

export function roadColor(highway) {
  return ROAD_COLOR[highway] ?? DEFAULT_ROAD_COLOR;
}

// Drop a duplicated closing point and reject rings that are too small.
export function normalizeRing(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  let p = points;
  const a = p[0];
  const b = p[p.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) p = p.slice(0, -1);
  if (p.length < 3) return null;
  return p;
}

export function boundsOf(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

export function isOversized(bounds, limit = 350) {
  return bounds.maxX - bounds.minX > limit || bounds.maxZ - bounds.minZ > limit;
}

// Shoelace area of a closed ring in square metres. Points are [x, z].
export function polygonArea(points) {
  let a = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % n];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}

// Turn a polyline into a flat triangle ribbon of a given width, at height y.
// Returns a flat array of x, y, z triples ready for a BufferGeometry.
export function buildRoadRibbon(points, width, y) {
  const out = [];
  if (!Array.isArray(points) || points.length < 2) return out;
  const hw = width / 2;

  const segN = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dz = points[i + 1][1] - points[i][1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      segN.push(null);
      continue;
    }
    segN.push([-dz / len, dx / len]);
  }

  const vN = [];
  for (let i = 0; i < points.length; i++) {
    const a = segN[i - 1] || null;
    const b = segN[i] || null;
    let nx = 0;
    let nz = 0;
    if (a) {
      nx += a[0];
      nz += a[1];
    }
    if (b) {
      nx += b[0];
      nz += b[1];
    }
    const len = Math.hypot(nx, nz);
    if (len < 1e-4) {
      vN.push(null);
      continue;
    }
    vN.push([nx / len, nz / len]);
  }

  for (let i = 0; i < points.length - 1; i++) {
    const n0 = vN[i];
    const n1 = vN[i + 1];
    if (!n0 || !n1) continue;
    const [x0, z0] = points[i];
    const [x1, z1] = points[i + 1];
    const l0x = x0 + n0[0] * hw;
    const l0z = z0 + n0[1] * hw;
    const r0x = x0 - n0[0] * hw;
    const r0z = z0 - n0[1] * hw;
    const l1x = x1 + n1[0] * hw;
    const l1z = z1 + n1[1] * hw;
    const r1x = x1 - n1[0] * hw;
    const r1z = z1 - n1[1] * hw;
    out.push(l0x, y, l0z, r0x, y, r0z, l1x, y, l1z);
    out.push(r0x, y, r0z, r1x, y, r1z, l1x, y, l1z);
  }
  return out;
}
