// Placement maths for the little 2.5D props on the 2D map: real OSM trees,
// street lamps along the vehicle roads, and benches inside the parks. Kept pure
// (no canvas) so every branch can be unit tested.

import { lampPointsAlong } from './streetlamps.js';

// Project the real OSM tree points ([lon,lat]) into map metres {x,n}.
export function treeSpots(trees, project) {
  const out = [];
  if (!Array.isArray(trees)) return out;
  for (const p of trees) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const [x, n] = project(p[0], p[1]);
    out.push({ x, n });
  }
  return out;
}

// Lamp posts along the lit vehicle roads. `roads` are prepared roads with a
// projected `pts` polyline and a `walk` flag; lamps line the streets, not the
// footpaths, and sit a few metres to one kerb.
export function lampSpots(roads, spacing = 42, offset = 5) {
  const out = [];
  if (!Array.isArray(roads)) return out;
  for (const r of roads) {
    if (!r || r.walk || !Array.isArray(r.pts)) continue;
    for (const p of lampPointsAlong(r.pts, spacing, offset)) {
      out.push({ x: p.x, n: p.z });
    }
  }
  return out;
}

// Even-odd ray cast: is (x, n) inside the polygon ring [[x,n], ...]?
export function pointInPolygon(x, n, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const ni = ring[i][1];
    const xj = ring[j][0];
    const nj = ring[j][1];
    const crosses = ni > n !== nj > n;
    if (crosses && x < ((xj - xi) * (n - ni)) / (nj - ni) + xi) inside = !inside;
  }
  return inside;
}

// A small deterministic scatter of points that fall inside a polygon ring. A
// seeded generator means the same park always gets the same benches.
export function scatterInRing(ring, count, seed = 1) {
  const out = [];
  if (!Array.isArray(ring) || ring.length < 3 || count <= 0) return out;
  let minX = Infinity;
  let minN = Infinity;
  let maxX = -Infinity;
  let maxN = -Infinity;
  for (const [x, n] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  }
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  let tries = 0;
  while (out.length < count && tries < count * 40) {
    tries++;
    const x = minX + rnd() * (maxX - minX);
    const n = minN + rnd() * (maxN - minN);
    if (pointInPolygon(x, n, ring)) out.push({ x, n });
  }
  return out;
}

function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A couple of benches inside each park-like green (leisure park/playground, or
// a named jardin/square/glaume). Benches belong in the greens, not on roads.
export function benchSpots(features, project, perPark = 2) {
  const out = [];
  if (!Array.isArray(features)) return out;
  for (const f of features) {
    if (!f || f.k !== 'green' || !Array.isArray(f.g)) continue;
    const t = f.t || {};
    const named = t.name && /jardin|square|parc|glaume/i.test(t.name);
    const park = t.leisure === 'park' || t.leisure === 'playground' || named;
    if (!park) continue;
    const ring = f.g.map((p) => project(p[0], p[1]));
    const seed = seedFrom(t.name || String(f.g[0]));
    for (const p of scatterInRing(ring, perPark, seed)) out.push(p);
  }
  return out;
}
