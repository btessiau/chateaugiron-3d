// Placement math for a roof chimney on a gabled building. Pure and unit tested,
// so buildWorld can turn the result into a small stone box mesh.
//
// Breton houses carry a tall stone chimney near a gable end, sitting on the
// ridge line and rising above it. Given the oriented box (from roof.js), the
// wall top height and the roof height, this returns where that chimney stands
// and how big it is, or null when the roof is too small to carry one.

function fract01(n) {
  return n - Math.floor(n);
}

export function chimneyFor(box, wallTop, roofHeight, seed = 0) {
  if (!box || !(roofHeight > 0)) return null;
  const { cx, cz, ux, uz, L, W } = box;
  if (!(L >= 2.5) || !(W >= 1.5)) return null;

  // Deterministic jitter so a rebuild places the same chimney every time.
  const r = fract01(Math.sin((seed + 1) * 12.9898) * 43758.5453);
  const r2 = fract01(Math.sin((seed + 1) * 78.233) * 24634.6345);

  // Sit near one gable end, inset a little from the very edge, on the ridge.
  const aFrac = 0.78 + 0.14 * r; // 0.78..0.92 of the half length
  const a = (r2 < 0.5 ? -1 : 1) * aFrac * L;

  const x = cx + ux * a;
  const z = cz + uz * a;

  const ridgeTop = wallTop + roofHeight;
  const size = 0.55 + 0.3 * r2; // 0.55..0.85 m square stack
  const rise = 0.9 + 0.9 * r; // how far it clears the ridge
  const base = ridgeTop - 0.7; // sink into the ridge so it looks seated
  const top = ridgeTop + rise;
  const angle = Math.atan2(uz, ux); // align the stack with the ridge

  return { x, z, base, top, size, angle };
}
