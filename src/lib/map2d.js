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
