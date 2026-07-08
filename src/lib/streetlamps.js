// Pure geometry helper for placing street lamps along a road polyline.
// Walks the line and returns a lamp point every `spacing` metres, pushed to one
// side by `offset` metres (perpendicular to the local direction). Kept free of
// three.js so it can be unit tested.

export function lampPointsAlong(polyline, spacing, offset = 0) {
  const out = [];
  if (!Array.isArray(polyline) || polyline.length < 2 || spacing <= 0) return out;

  let cum = 0; // length walked so far, up to the start of the current segment
  let next = spacing; // cumulative distance of the next lamp
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1];
    const b = polyline[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const segLen = Math.hypot(dx, dz);
    if (segLen === 0) continue;
    const ux = dx / segLen;
    const uz = dz / segLen;
    const px = -uz; // left perpendicular
    const pz = ux;
    const angle = Math.atan2(dz, dx);
    while (next <= cum + segLen) {
      const t = next - cum;
      const bx = a[0] + ux * t;
      const bz = a[1] + uz * t;
      out.push({ x: bx + px * offset, z: bz + pz * offset, angle });
      next += spacing;
    }
    cum += segLen;
  }
  return out;
}
