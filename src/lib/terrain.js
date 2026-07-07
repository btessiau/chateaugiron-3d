// Bilinear sampler over the IGN elevation heightfield. Pure maths, unit tested
// to 100%. The grid is stored in world metres centred on the chateau, row-major
// with row 0 at -z (south), so sampling maps directly to the render world.

// Catmull-Rom cubic through p1..p2 (p0, p3 are the outer control points).
function catmull(p0, p1, p2, p3, t) {
  const a = 2 * p1;
  const b = p2 - p0;
  const c = 2 * p0 - 5 * p1 + 4 * p2 - p3;
  const d = -p0 + 3 * p1 - 3 * p2 + p3;
  return 0.5 * (a + b * t + c * t * t + d * t * t * t);
}

export function clampRange(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function makeHeightField(data) {
  const n = data.meta.n;
  const size = data.meta.size_m;
  const half = size / 2;
  const spacing = size / (n - 1);
  const z = data.z;

  function sample(x, zc) {
    let fx = (x + half) / spacing;
    let fz = (zc + half) / spacing;
    if (fx < 0) fx = 0;
    else if (fx > n - 1) fx = n - 1;
    if (fz < 0) fz = 0;
    else if (fz > n - 1) fz = n - 1;

    const ix0 = Math.floor(fx);
    const iz0 = Math.floor(fz);
    const ix1 = Math.min(ix0 + 1, n - 1);
    const iz1 = Math.min(iz0 + 1, n - 1);
    const tx = fx - ix0;
    const tz = fz - iz0;

    const h00 = z[iz0 * n + ix0];
    const h10 = z[iz0 * n + ix1];
    const h01 = z[iz1 * n + ix0];
    const h11 = z[iz1 * n + ix1];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
  }

  // Smooth bicubic (Catmull-Rom) sampler for the render mesh, so the coarse
  // 26 m grid reads as rolling terrain instead of hard-creased facets. Physics
  // stays on the bilinear sample() above.
  function sampleSmooth(x, zc) {
    let fx = (x + half) / spacing;
    let fz = (zc + half) / spacing;
    if (fx < 0) fx = 0;
    else if (fx > n - 1) fx = n - 1;
    if (fz < 0) fz = 0;
    else if (fz > n - 1) fz = n - 1;

    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const at = (cx, cz) => {
      const gx = cx < 0 ? 0 : cx > n - 1 ? n - 1 : cx;
      const gz = cz < 0 ? 0 : cz > n - 1 ? n - 1 : cz;
      return z[gz * n + gx];
    };
    const cols = [];
    for (let m = -1; m <= 2; m++) {
      cols.push(
        catmull(at(ix - 1, iz + m), at(ix, iz + m), at(ix + 1, iz + m), at(ix + 2, iz + m), tx),
      );
    }
    const v = catmull(cols[0], cols[1], cols[2], cols[3], tz);
    // Clamp to the four surrounding cell corners so the cubic never rings into
    // a spike or pit above/below the real data on the steep cells.
    const c0 = at(ix, iz);
    const c1 = at(ix + 1, iz);
    const c2 = at(ix, iz + 1);
    const c3 = at(ix + 1, iz + 1);
    const lo = Math.min(c0, c1, c2, c3);
    const hi = Math.max(c0, c1, c2, c3);
    return clampRange(v, lo, hi);
  }

  return {
    sample,
    sampleSmooth,
    n,
    size,
    half,
    spacing,
    min: data.meta.min_m,
    max: data.meta.max_m,
  };
}
