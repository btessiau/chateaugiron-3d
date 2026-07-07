// Bilinear sampler over the IGN elevation heightfield. Pure maths, unit tested
// to 100%. The grid is stored in world metres centred on the chateau, row-major
// with row 0 at -z (south), so sampling maps directly to the render world.

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

  return { sample, n, size, half, spacing, min: data.meta.min_m, max: data.meta.max_m };
}
