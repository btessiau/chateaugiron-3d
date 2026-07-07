// Nearest-point search on the ground plane. Points are { x, z } in metres.
// Pure so it is unit tested to 100%.

export function nearestIndex(points, x, z) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - x;
    const dz = points[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, distance: best === -1 ? Infinity : Math.sqrt(bestD) };
}
