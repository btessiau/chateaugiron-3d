import { describe, it, expect } from 'vitest';
import { makeProjector, metresToLatLon, M_PER_DEG_LAT } from './geo.js';

describe('geo', () => {
  const center = { lat: 48.0489, lon: -1.5019 };

  it('projects the reference point to the origin', () => {
    const p = makeProjector(center);
    const [x, z] = p.project(center.lon, center.lat);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('maps east to +x and north to +z', () => {
    const p = makeProjector(center);
    const [ex] = p.project(center.lon + 0.001, center.lat);
    const [, nz] = p.project(center.lon, center.lat + 0.001);
    expect(ex).toBeGreaterThan(0);
    expect(nz).toBeGreaterThan(0);
    expect(p.mPerDegLat).toBe(M_PER_DEG_LAT);
  });

  it('round-trips metres back to lat/lon', () => {
    const p = makeProjector(center);
    const [x, z] = p.project(-1.49, 48.06);
    const g = metresToLatLon(p, x, z);
    expect(g.lat).toBeCloseTo(48.06, 6);
    expect(g.lon).toBeCloseTo(-1.49, 6);
  });
});
