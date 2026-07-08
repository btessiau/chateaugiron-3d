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
  footway: 2.2,
  path: 2.0,
  cycleway: 2,
  track: 3,
  steps: 2.0,
};
export const DEFAULT_ROAD_WIDTH = 4;

// Flat cartoon road colours for the toy town. Vehicle roads are a clean warm
// grey, like painted model streets. Every walkable way (pedestrian, footway,
// path, steps, cycleway, track) is a distinct warm tan so the player can see
// the pavements and lanes they can actually walk, matching the real network.
export const ROAD_COLOR = {
  motorway: 0x9a938a,
  trunk: 0x9d968d,
  primary: 0x9a938a,
  secondary: 0x9f9890,
  tertiary: 0xa39c93,
  unclassified: 0xa8a199,
  residential: 0xa8a199,
  living_street: 0xb0a99f,
  service: 0xada69d,
  pedestrian: 0xcbb389,
  footway: 0xd2ba90,
  path: 0xd2ba90,
  cycleway: 0xbfb59a,
  track: 0xc9b98f,
  steps: 0xd2ba90,
};
export const DEFAULT_ROAD_COLOR = 0xa39c93;

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

// Split a wall span into the solid pieces left after cutting a centred doorway.
// halfSpan is the half length of the wall (so the wall runs from -halfSpan to
// +halfSpan along its own axis). doorWidth is the clear opening at the centre.
// Returns pieces as { center, half } in the same axis, dropping slivers.
export function doorwayGap(halfSpan, doorWidth, minPiece = 0.1) {
  const h = Math.abs(halfSpan);
  const d = Math.max(0, doorWidth);
  if (d <= 0) return [{ center: 0, half: h }];
  if (d >= 2 * h) return [];
  const inner = d / 2;
  const pieceHalf = (h - inner) / 2;
  if (pieceHalf < minPiece) return [];
  const c = (h + inner) / 2;
  return [
    { center: -c, half: pieceHalf },
    { center: c, half: pieceHalf },
  ];
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
