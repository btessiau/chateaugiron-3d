// Pure logic for the 2D top-down (Pokemon-style) map. No canvas or DOM here, so
// this file is held to 100% coverage. World coordinates are metres, with
// x = east and n = north. North is up on the screen, east is to the right, so
// the map reads the same way round as a real paper map (it is not mirrored).

// Ways a person can walk on. Everything else (car roads) is still drawn but is
// styled as a road; the ground under both is walkable in this friendly map.
export const WALKABLE_HIGHWAYS = new Set([
  'pedestrian',
  'footway',
  'path',
  'cycleway',
  'track',
  'steps',
  'living_street',
]);

export function isWalkableWay(highway) {
  return WALKABLE_HIGHWAYS.has(highway);
}

// Bounding box (in projected metres) of every vertex across all features.
export function featureBounds(features, project) {
  let minX = Infinity;
  let minN = Infinity;
  let maxX = -Infinity;
  let maxN = -Infinity;
  for (const f of features) {
    for (const p of f.g) {
      const [x, n] = project(p[0], p[1]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (n < minN) minN = n;
      if (n > maxN) maxN = n;
    }
  }
  if (minX === Infinity) return { minX: 0, minN: 0, maxX: 0, maxN: 0 };
  return { minX, minN, maxX, maxN };
}

// A blocked/free grid covering the given bounds, one byte per cell.
export function makeGrid(bounds, cell) {
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cell));
  const rows = Math.max(1, Math.ceil((bounds.maxN - bounds.minN) / cell));
  return {
    cols,
    rows,
    cell,
    minX: bounds.minX,
    minN: bounds.minN,
    data: new Uint8Array(cols * rows),
  };
}

// Scanline-fill a polygon ring (metres) into the grid, marking covered cells as
// blocked. Used for buildings and water so the player cannot walk through them.
export function fillPolygon(grid, ring) {
  if (ring.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  let r0 = Math.floor((minY - grid.minN) / grid.cell);
  let r1 = Math.floor((maxY - grid.minN) / grid.cell);
  if (r0 < 0) r0 = 0;
  if (r1 > grid.rows - 1) r1 = grid.rows - 1;
  for (let ry = r0; ry <= r1; ry++) {
    const yc = grid.minN + (ry + 0.5) * grid.cell;
    const xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][1];
      const yj = ring[j][1];
      if (yi > yc !== yj > yc) {
        const t = (yc - yi) / (yj - yi);
        xs.push(ring[i][0] + t * (ring[j][0] - ring[i][0]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let cx0 = Math.ceil((xs[k] - grid.minX) / grid.cell - 0.5);
      let cx1 = Math.floor((xs[k + 1] - grid.minX) / grid.cell - 0.5);
      if (cx0 < 0) cx0 = 0;
      if (cx1 > grid.cols - 1) cx1 = grid.cols - 1;
      for (let cx = cx0; cx <= cx1; cx++) {
        grid.data[ry * grid.cols + cx] = 1;
      }
    }
  }
}

// Half-width in metres of the walkable strip carved for each kind of way, kept
// close to the width each road is actually drawn (see geometry.ROAD_WIDTH) so
// the passable ground matches what the player sees. A small floor keeps even the
// thinnest footpath wide enough to move along.
const ROAD_HALF = {
  primary: 5,
  trunk: 5.5,
  secondary: 4,
  tertiary: 3.25,
  residential: 2.5,
  unclassified: 2.5,
  service: 1.75,
  living_street: 2.25,
  pedestrian: 2,
  footway: 1.4,
  path: 1.4,
  cycleway: 1.4,
  steps: 1.4,
  track: 1.5,
};
export function roadHalfWidth(highway) {
  return ROAD_HALF[highway] || 2;
}

// Stamp every grid cell within `r` metres of the segment a->b to `value`. Used
// to carve the road and path network (value 0, passable) out of an otherwise
// blocked map, so the player can only move on streets and paths.
export function stampSegment(grid, ax, an, bx, bn, r, value) {
  let c0 = Math.floor((Math.min(ax, bx) - r - grid.minX) / grid.cell);
  let c1 = Math.floor((Math.max(ax, bx) + r - grid.minX) / grid.cell);
  let r0 = Math.floor((Math.min(an, bn) - r - grid.minN) / grid.cell);
  let r1 = Math.floor((Math.max(an, bn) + r - grid.minN) / grid.cell);
  if (c0 < 0) c0 = 0;
  if (r0 < 0) r0 = 0;
  if (c1 > grid.cols - 1) c1 = grid.cols - 1;
  if (r1 > grid.rows - 1) r1 = grid.rows - 1;
  for (let cy = r0; cy <= r1; cy++) {
    const py = grid.minN + (cy + 0.5) * grid.cell;
    for (let cx = c0; cx <= c1; cx++) {
      const px = grid.minX + (cx + 0.5) * grid.cell;
      if (distToSegment(px, py, ax, an, bx, bn) <= r) {
        grid.data[cy * grid.cols + cx] = value;
      }
    }
  }
}

// True if the metre point falls in a blocked cell or off the edge of the map.
export function isBlocked(grid, x, n) {
  const cx = Math.floor((x - grid.minX) / grid.cell);
  const cy = Math.floor((n - grid.minN) / grid.cell);
  if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return true;
  return grid.data[cy * grid.cols + cx] === 1;
}

// Sample a small cross around the player so their body, not just their centre,
// is stopped by walls.
export function blockedFootprint(grid, x, n, r) {
  return (
    isBlocked(grid, x, n) ||
    isBlocked(grid, x + r, n) ||
    isBlocked(grid, x - r, n) ||
    isBlocked(grid, x, n + r) ||
    isBlocked(grid, x, n - r)
  );
}

// Move the player by (dx, dn) metres, sliding along walls: each axis is applied
// only if it stays clear, so a diagonal into a wall slides along it.
export function stepPlayer(grid, pos, dx, dn, r) {
  let x = pos.x;
  let n = pos.n;
  if (dx !== 0 && !blockedFootprint(grid, x + dx, n, r)) x += dx;
  if (dn !== 0 && !blockedFootprint(grid, x, n + dn, r)) n += dn;
  return { x, n };
}

// Move the player one step, but if the desired heading is blocked, fan out to
// nearby headings and take the first that is clear. This lets a single held key
// follow a curving lane or slide along a wall instead of snagging the moment the
// road bends, while still never entering a blocked (off-road) cell.
const GLIDE_FAN = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2];
export function glide(grid, pos, dx, dn, r) {
  const speed = Math.hypot(dx, dn);
  if (speed === 0) return { x: pos.x, n: pos.n };
  const base = Math.atan2(dn, dx);
  for (let i = 0; i < GLIDE_FAN.length; i++) {
    const a = base + GLIDE_FAN[i];
    const nx = pos.x + Math.cos(a) * speed;
    const nn = pos.n + Math.sin(a) * speed;
    if (!blockedFootprint(grid, nx, nn, r)) return { x: nx, n: nn };
  }
  return { x: pos.x, n: pos.n };
}

// Normalised movement direction from held keys (up = north, right = east).
export function inputVector(keys) {
  let dx = 0;
  let dn = 0;
  if (keys.up) dn += 1;
  if (keys.down) dn -= 1;
  if (keys.right) dx += 1;
  if (keys.left) dx -= 1;
  const len = Math.hypot(dx, dn);
  if (len > 0) {
    dx /= len;
    dn /= len;
  }
  return { dx, dn, len };
}

// Which way the sprite should face. Holding still keeps the previous facing.
export function facingFrom(dx, dn, prev) {
  if (dx === 0 && dn === 0) return prev;
  if (Math.abs(dx) > Math.abs(dn)) return dx > 0 ? 'right' : 'left';
  return dn > 0 ? 'up' : 'down';
}

// Travel speeds in metres per second. On foot the player walks or runs (Shift);
// on the bicycle they cruise much faster and can still sprint, so crossing the
// whole town takes a few seconds.
export const TRAVEL = { walk: 4.6, run: 9.5, bike: 13, bikeSprint: 22 };
export function travelSpeed({ bike, run } = {}) {
  if (bike) return run ? TRAVEL.bikeSprint : TRAVEL.bike;
  return run ? TRAVEL.run : TRAVEL.walk;
}

// Spiral out from a preferred point to the nearest spot clear of buildings and
// water, so the player never spawns inside a wall.
export function findOpenSpawn(grid, x0, n0, r) {
  if (!blockedFootprint(grid, x0, n0, r)) return { x: x0, n: n0 };
  const step = grid.cell;
  for (let ring = 1; ring < 400; ring++) {
    const count = ring * 8;
    for (let a = 0; a < count; a++) {
      const ang = (a / count) * Math.PI * 2;
      const x = x0 + Math.cos(ang) * ring * step;
      const n = n0 + Math.sin(ang) * ring * step;
      if (!blockedFootprint(grid, x, n, r)) return { x, n };
    }
  }
  return { x: x0, n: n0 };
}

// Average of a ring's vertices, used to place a label or marker on a feature.
export function ringCentroid(ring) {
  let x = 0;
  let n = 0;
  for (const p of ring) {
    x += p[0];
    n += p[1];
  }
  return { x: x / ring.length, n: n / ring.length };
}

// Nearest point (by straight-line distance) among a list of [x, n] vertices to a
// target. Used to seed the spawn on the closest open street to a landmark.
export function nearestPoint(points, tx, tn) {
  let best = null;
  let bestD = Infinity;
  for (const p of points) {
    const dx = p[0] - tx;
    const dn = p[1] - tn;
    const d = dx * dx + dn * dn;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ? { x: best[0], n: best[1], d: Math.sqrt(bestD) } : null;
}

// Best place to draw a road's name: the midpoint of its longest straight
// segment, with that segment's world-space angle so the text can run along the
// road. Returns null for a degenerate way. len is the segment length in metres,
// used by the renderer to skip labels that are too short on screen to read.
export function roadLabelAnchor(pts) {
  if (!pts || pts.length < 2) return null;
  let best = -1;
  let x = 0;
  let n = 0;
  let angle = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0];
    const an = pts[i][1];
    const bx = pts[i + 1][0];
    const bn = pts[i + 1][1];
    const len = Math.hypot(bx - ax, bn - an);
    if (len > best) {
      best = len;
      x = (ax + bx) / 2;
      n = (an + bn) / 2;
      angle = Math.atan2(bn - an, bx - ax);
    }
  }
  return { x, n, angle, len: best };
}

// Tag a named feature as one of the town's landmarks so it can be coloured and
// labelled for easy navigation.
export function classifyLandmark(tags) {
  if (!tags) return null;
  // Fold accents away so "Église" and "Chateau" match regardless of accents.
  const name = (tags.name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (
    tags.building === 'church' ||
    tags.building === 'chapel' ||
    tags.amenity === 'place_of_worship' ||
    name.includes('eglise') ||
    name.includes('chapelle')
  ) {
    return 'church';
  }
  // Match the castle itself, not the town "Chateaugiron", so require "chateau
  // de" or "donjon" (the town name is one word with no following "de").
  if (
    tags.historic === 'castle' ||
    tags.castle_type ||
    name.includes('chateau de') ||
    name.includes('donjon')
  ) {
    return 'chateau';
  }
  if (name.includes('halles')) return 'halles';
  if (tags.amenity === 'townhall' || name.includes('mairie')) return 'townhall';
  return null;
}

// Height in metres used to extrude a building into the 2.5D view. Landmarks are
// made deliberately tall so they stand out like a town's gyms; ordinary houses
// use the real baked eaves height plus part of the roof rise.
export function buildingHeight(tags) {
  const lm = classifyLandmark(tags);
  if (lm === 'chateau') return 22;
  if (lm === 'church') return 17;
  if (lm === 'halles') return 11;
  if (lm === 'townhall') return 11;
  const eaves =
    parseFloat(tags && tags.height) ||
    (parseFloat(tags && tags['building:levels']) || 0) * 3 ||
    3.2;
  const roofRise = parseFloat(tags && tags['roof:height']) || 0;
  return Math.max(2.5, Math.min(eaves + roofRise * 0.5, 20));
}

// Locate the real, navigable landmarks that actually exist in the data, as
// jump/minimap targets {kind, label, x, n}. The church classifies by tag; the
// château is the tallest historic building (the donjon); the étang and the
// jardin are named greens. Anything missing is simply left out.
export function mapTargets(features, project) {
  const out = [];
  const centroid = (f) => ringCentroid(f.g.map((p) => project(p[0], p[1])));

  const church = features.find((f) => f.k === 'building' && classifyLandmark(f.t) === 'church');
  if (church) {
    const c = centroid(church);
    out.push({ kind: 'church', label: 'Church', x: c.x, n: c.n });
  }

  let chateau = null;
  let tallest = -Infinity;
  for (const f of features) {
    if (f.k !== 'building' || !f.t || !f.t.historic) continue;
    const h = parseFloat(f.t.height) || 0;
    if (h > tallest) {
      tallest = h;
      chateau = f;
    }
  }
  if (chateau) {
    const c = centroid(chateau);
    out.push({ kind: 'chateau', label: 'Château', x: c.x, n: c.n });
  }

  const namedGreen = [
    [/etang|étang/i, 'etang', 'Étang'],
    [/jardin/i, 'jardin', 'Jardin'],
  ];
  for (const [re, kind, label] of namedGreen) {
    const g = features.find((f) => f.k === 'green' && f.t && f.t.name && re.test(f.t.name));
    if (g) {
      const c = centroid(g);
      out.push({ kind, label, x: c.x, n: c.n });
    }
  }
  return out;
}

// Every named building in the town, as {label, x, n, poly} in world metres (poly
// is the projected footprint ring), so the player gets a "you are at ..."
// placard when they walk up to one. These are the 50 real named places (cinema,
// dojo, chapelle, gendarmerie, schools ...) that make the town navigable.
export function namedPlaces(features, project) {
  const out = [];
  for (const f of features) {
    if (f.k !== 'building' || !f.t || !f.t.name) continue;
    const poly = f.g.map((p) => project(p[0], p[1]));
    const c = ringCentroid(poly);
    out.push({ label: f.t.name, x: c.x, n: c.n, poly });
  }
  return out;
}

// Shortest distance from a point to a building: 0 if inside the footprint, else
// the distance to the nearest wall. Big buildings (a long church) then trigger
// the placard as soon as the player reaches a wall, not only at the centre.
export function distanceToPlace(place, x, n) {
  const ring = place.poly;
  if (!ring || ring.length < 2) return Math.hypot(place.x - x, place.n - n);
  if (pointInRing(x, n, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    best = Math.min(best, distToSegment(x, n, a[0], a[1], b[0], b[1]));
  }
  return best;
}

function pointInRing(x, n, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const ni = ring[i][1];
    const xj = ring[j][0];
    const nj = ring[j][1];
    const hit = ni > n !== nj > n && x < ((xj - xi) * (n - ni)) / (nj - ni) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function distToSegment(px, pn, ax, an, bx, bn) {
  const dx = bx - ax;
  const dn = bn - an;
  const len2 = dx * dx + dn * dn;
  let t = len2 ? ((px - ax) * dx + (pn - an) * dn) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pn - (an + t * dn));
}

// Nearest place within a radius (metres) of a point, measured to the footprint,
// or null. Used to raise the building placard only when the player is standing
// at a named place.
export function nearestWithin(places, x, n, radius) {
  let best = null;
  let bestD = radius;
  for (const p of places) {
    const d = distanceToPlace(p, x, n);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ? { place: best, d: bestD } : null;
}
