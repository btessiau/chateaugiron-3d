// Metric projection: turn lon/lat into local metres on a tangent plane centred
// on a reference point, so the world is a true 1:1 scale reproduction.
// three.js is Y-up; the ground lives on X/Z. +X = east, +Z = north.

export const M_PER_DEG_LAT = 111320;

export function makeProjector(center) {
  const lat0 = center.lat;
  const lon0 = center.lon;
  const mPerDegLon = Math.cos((lat0 * Math.PI) / 180) * 111320;

  function project(lon, lat) {
    return [(lon - lon0) * mPerDegLon, (lat - lat0) * M_PER_DEG_LAT];
  }

  return { project, lat0, lon0, mPerDegLon, mPerDegLat: M_PER_DEG_LAT };
}

export function metresToLatLon(proj, x, z) {
  return {
    lat: proj.lat0 + z / proj.mPerDegLat,
    lon: proj.lon0 + x / proj.mPerDegLon,
  };
}
