// North-up minimap maths. World +X is east and +Z is north. Screen v grows
// downward, so north maps to a smaller v. Pure so it is unit tested to 100%.

export function worldToMinimap(wx, wz, cx, cz, mPerPx, size) {
  const half = size / 2;
  return {
    u: half + (wx - cx) / mPerPx,
    v: half - (wz - cz) / mPerPx,
  };
}

// Metres-per-pixel needed to fit a world bounds box into a square minimap of
// `size` px, leaving a fractional `margin` on each side. The wider of the two
// spans decides the scale so the whole town fits.
export function minimapScale(bounds, size, margin = 0.06) {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxN - bounds.minN;
  const span = Math.max(w, h, 1e-6);
  const usable = Math.max(1e-6, size * (1 - 2 * margin));
  return span / usable;
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// Compass bearing the player faces, in degrees clockwise from north, plus the
// nearest cardinal. yaw is the camera Y rotation; forward at yaw 0 points -Z,
// which is south, because +Z is north.
export function compassFromYaw(yaw) {
  const east = -Math.sin(yaw);
  const north = -Math.cos(yaw);
  let deg = (Math.atan2(east, north) * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  const cardinal = CARDINALS[Math.round(deg / 45) % 8];
  return { deg, cardinal };
}

// Screen-space angle (radians, clockwise from +x / east) of the player heading
// arrow on a north-up minimap.
export function headingArrowAngle(yaw) {
  const east = -Math.sin(yaw);
  const north = -Math.cos(yaw);
  return Math.atan2(-north, east);
}
