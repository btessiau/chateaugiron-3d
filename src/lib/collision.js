// Circle-vs-axis-aligned-box collision with a uniform spatial hash so the player
// can be pushed out of buildings without checking thousands of footprints each
// frame. Pure maths, unit tested. Boxes are { minX, maxX, minZ, maxZ }.

export function buildGrid(boxes, cell = 24) {
  const map = new Map();
  const key = (cx, cz) => `${cx}|${cz}`;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const x0 = Math.floor(b.minX / cell);
    const x1 = Math.floor(b.maxX / cell);
    const z0 = Math.floor(b.minZ / cell);
    const z1 = Math.floor(b.maxZ / cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = key(cx, cz);
        let list = map.get(k);
        if (!list) {
          list = [];
          map.set(k, list);
        }
        list.push(i);
      }
    }
  }
  return { map, cell };
}

// Indices of boxes in the cells overlapping the circle (x, z, r). May contain
// duplicates when a box spans several cells; the resolver handles that safely.
export function queryCircle(grid, x, z, r) {
  const { map, cell } = grid;
  const out = [];
  const x0 = Math.floor((x - r) / cell);
  const x1 = Math.floor((x + r) / cell);
  const z0 = Math.floor((z - r) / cell);
  const z1 = Math.floor((z + r) / cell);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const list = map.get(`${cx}|${cz}`);
      if (list) for (const i of list) out.push(i);
    }
  }
  return out;
}

// Push a circle of radius r out of one box. Returns the corrected [x, z].
export function resolveCircleBox(x, z, r, b) {
  const cx = Math.max(b.minX, Math.min(x, b.maxX));
  const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;

  if (d2 > r * r) return [x, z]; // no overlap

  if (d2 > 1e-9) {
    // Centre outside the box: push straight out along the closest edge.
    const d = Math.sqrt(d2);
    const push = r - d;
    return [x + (dx / d) * push, z + (dz / d) * push];
  }

  // Centre inside the box: pop out through the nearest face.
  const left = x - b.minX;
  const right = b.maxX - x;
  const up = z - b.minZ;
  const down = b.maxZ - z;
  const m = Math.min(left, right, up, down);
  if (m === left) return [b.minX - r, z];
  if (m === right) return [b.maxX + r, z];
  if (m === up) return [x, b.minZ - r];
  return [x, b.maxZ + r];
}

// Resolve a circle against every nearby box. Two passes settle most corners.
export function collide(grid, boxes, x, z, r) {
  let px = x;
  let pz = z;
  for (let pass = 0; pass < 2; pass++) {
    const ids = queryCircle(grid, px, pz, r);
    for (const i of ids) {
      [px, pz] = resolveCircleBox(px, pz, r, boxes[i]);
    }
  }
  return [px, pz];
}
