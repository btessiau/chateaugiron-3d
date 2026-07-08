// Pure geometry for pitched (gabled) roofs. No three.js here so it stays unit
// tested. buildWorld turns these vertex lists into meshes.

// Oriented bounding box of a footprint via a 2D principal axis (PCA).
// points: array of [x, z]. Returns the box centre, the long-axis unit vector u,
// the perpendicular unit vector v, and the half extents L (along u) and W (along v).
export function orientedBox(points) {
  const n = points.length;
  let mx = 0;
  let mz = 0;
  for (const [x, z] of points) {
    mx += x;
    mz += z;
  }
  mx /= n;
  mz /= n;

  let cxx = 0;
  let czz = 0;
  let cxz = 0;
  for (const [x, z] of points) {
    const dx = x - mx;
    const dz = z - mz;
    cxx += dx * dx;
    czz += dz * dz;
    cxz += dx * dz;
  }

  // Principal axis angle for the 2x2 covariance matrix.
  const theta = 0.5 * Math.atan2(2 * cxz, cxx - czz);
  const ux = Math.cos(theta);
  const uz = Math.sin(theta);
  const vx = -uz;
  const vz = ux;

  let aMin = Infinity;
  let aMax = -Infinity;
  let bMin = Infinity;
  let bMax = -Infinity;
  for (const [x, z] of points) {
    const dx = x - mx;
    const dz = z - mz;
    const a = dx * ux + dz * uz;
    const b = dx * vx + dz * vz;
    if (a < aMin) aMin = a;
    if (a > aMax) aMax = a;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }

  // Recentre on the box middle (the point cloud mean is not the box centre).
  const ca = (aMin + aMax) / 2;
  const cb = (bMin + bMax) / 2;
  const cx = mx + ux * ca + vx * cb;
  const cz = mz + uz * ca + vz * cb;

  let L = (aMax - aMin) / 2;
  let W = (bMax - bMin) / 2;

  // Keep L as the long half so the ridge runs along the longer side.
  let rux = ux;
  let ruz = uz;
  let rvx = vx;
  let rvz = vz;
  if (W > L) {
    [L, W] = [W, L];
    rux = vx;
    ruz = vz;
    rvx = ux;
    rvz = uz;
  }

  return { cx, cz, ux: rux, uz: ruz, vx: rvx, vz: rvz, L, W };
}

// Gabled roof triangles for an oriented box. Ridge runs along u at height
// wallTop + roofHeight; eaves sit at wallTop. Returns a flat array of triangle
// vertices [x0,y0,z0, x1,y1,z1, ...] (6 triangles, 54 numbers).
export function gableRoofPositions(box, wallTop, roofHeight) {
  const { cx, cz, ux, uz, vx, vz, L, W } = box;
  const top = wallTop + roofHeight;
  const P = (a, b, y) => [cx + ux * a + vx * b, y, cz + uz * a + vz * b];

  const c00 = P(-L, -W, wallTop);
  const c10 = P(L, -W, wallTop);
  const c11 = P(L, W, wallTop);
  const c01 = P(-L, W, wallTop);
  const r0 = P(-L, 0, top);
  const r1 = P(L, 0, top);

  const tris = [
    c00,
    c10,
    r1,
    c00,
    r1,
    r0, // slope on the -W side
    c11,
    c01,
    r0,
    c11,
    r0,
    r1, // slope on the +W side
    c00,
    r0,
    c01, // gable end at -L
    c10,
    c11,
    r1, // gable end at +L
  ];

  const out = [];
  for (const t of tris) out.push(t[0], t[1], t[2]);
  return out;
}

// Hipped roof triangles for an oriented box: four slopes meeting a ridge that is
// inset from both ends by the hip run, so large or squarish footprints get a
// proper slate roof instead of a flat top. When the footprint is square the
// ridge collapses to a point and the roof becomes a pyramid. Same vertex layout
// as gableRoofPositions (6 triangles, 54 numbers).
export function hipRoofPositions(box, wallTop, roofHeight) {
  const { cx, cz, ux, uz, vx, vz, L, W } = box;
  const top = wallTop + roofHeight;
  const ridgeHalf = Math.max(0, L - W);
  const P = (a, b, y) => [cx + ux * a + vx * b, y, cz + uz * a + vz * b];

  const c00 = P(-L, -W, wallTop);
  const c10 = P(L, -W, wallTop);
  const c11 = P(L, W, wallTop);
  const c01 = P(-L, W, wallTop);
  const r0 = P(-ridgeHalf, 0, top);
  const r1 = P(ridgeHalf, 0, top);

  const tris = [
    c00,
    c10,
    r1,
    c00,
    r1,
    r0, // slope on the -W side
    c11,
    c01,
    r0,
    c11,
    r0,
    r1, // slope on the +W side
    c00,
    r0,
    c01, // hip end at -L
    c10,
    c11,
    r1, // hip end at +L
  ];

  const out = [];
  for (const t of tris) out.push(t[0], t[1], t[2]);
  return out;
}
