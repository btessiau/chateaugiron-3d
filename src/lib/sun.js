// Sun position maths. Given a sun elevation (degrees above the horizon) and an
// azimuth (degrees clockwise from north, so 90 = east, 180 = south), return a
// unit direction pointing from the ground toward the sun in our world frame
// (+X east, +Y up, +Z north).

const DEG = Math.PI / 180;

export function sunDirection(elevationDeg, azimuthDeg) {
  const el = elevationDeg * DEG;
  const az = azimuthDeg * DEG;
  const horiz = Math.cos(el);
  return {
    x: horiz * Math.sin(az),
    y: Math.sin(el),
    z: horiz * Math.cos(az),
  };
}

// Scale a unit direction to a world-space position at the given distance.
export function sunPosition(elevationDeg, azimuthDeg, distance) {
  const d = sunDirection(elevationDeg, azimuthDeg);
  return { x: d.x * distance, y: d.y * distance, z: d.z * distance };
}

// A simple daylight factor in [0, 1]: 0 at or below the horizon, 1 high in the
// sky. Useful for dimming ambient light near sunrise and sunset.
export function daylight(elevationDeg) {
  if (elevationDeg <= 0) return 0;
  if (elevationDeg >= 60) return 1;
  return elevationDeg / 60;
}
