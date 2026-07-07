// Metric projection: turn lon/lat into local metres on a tangent plane centred
// on the château, so the world is a true 1:1 scale reproduction.
//
// Convention: three.js is Y-up. The ground lives on the X/Z plane.
//   +X = east, +Z = north, Y = up.

const M_PER_DEG_LAT = 111320;

export function makeProjector(center) {
  const lat0 = center.lat;
  const lon0 = center.lon;
  const mPerDegLon = Math.cos((lat0 * Math.PI) / 180) * 111320;

  // Returns [x, z] in metres. North maps to +Z.
  function project(lon, lat) {
    const x = (lon - lon0) * mPerDegLon;
    const z = (lat - lat0) * M_PER_DEG_LAT;
    return [x, z];
  }

  return { project, lat0, lon0, mPerDegLon, mPerDegLat: M_PER_DEG_LAT };
}

// Inverse: metres back to lon/lat, for the HUD read-out.
export function metresToLatLon(proj, x, z) {
  const lat = proj.lat0 + z / proj.mPerDegLat;
  const lon = proj.lon0 + x / proj.mPerDegLon;
  return { lat, lon };
}
