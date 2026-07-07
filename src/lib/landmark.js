// Pure helpers for landmark buildings (churches, chapels). No three.js here so
// the maths stays unit tested. buildWorld turns these into meshes.

export function isChurch(tags) {
  return tags.building === 'church' || tags.amenity === 'place_of_worship';
}

export function isChapel(tags) {
  return tags.building === 'chapel' || tags.historic === 'chapel';
}

// Place a square bell tower at one short end of an oriented box. `box` comes
// from orientedBox (centre, unit axes u/v, half extents L/W). The tower sits
// just inside the +L gable end. Returns its centre and half width.
export function towerPlacement(box) {
  const half = Math.min(Math.max(box.W * 0.7, 2.0), 3.6);
  const d = Math.max(box.L - half, 0);
  return {
    x: box.cx + box.ux * d,
    z: box.cz + box.uz * d,
    half,
  };
}

// Triangles for a pyramidal spire over a square base (2*half) in the box frame,
// rising from baseY to an apex at baseY + height. Returns a flat array of
// vertices [x0,y0,z0, ...] for 4 triangles (36 numbers).
export function pyramidPositions(cx, cz, baseY, half, height, ux, uz, vx, vz) {
  const corner = (sa, sb) => [
    cx + ux * half * sa + vx * half * sb,
    baseY,
    cz + uz * half * sa + vz * half * sb,
  ];
  const p00 = corner(-1, -1);
  const p10 = corner(1, -1);
  const p11 = corner(1, 1);
  const p01 = corner(-1, 1);
  const apex = [cx, baseY + height, cz];

  const tris = [p00, p10, apex, p10, p11, apex, p11, p01, apex, p01, p00, apex];
  const out = [];
  for (const t of tris) out.push(t[0], t[1], t[2]);
  return out;
}
