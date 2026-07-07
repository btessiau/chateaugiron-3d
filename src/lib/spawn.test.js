import { describe, it, expect } from 'vitest';
import { pickSpawn } from './spawn.js';

describe('pickSpawn', () => {
  it('returns a finite open point when there are no buildings', () => {
    const s = pickSpawn([]);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Number.isFinite(s.z)).toBe(true);
    expect(s.clr).toBe(Infinity);
  });

  it('picks a point away from building centroids', () => {
    const centroids = [
      { x: 0, z: 0, r: 5 },
      { x: 100, z: 0, r: 5 },
    ];
    const s = pickSpawn(centroids);
    const nearest = Math.min(...centroids.map((c) => Math.hypot(s.x - c.x, s.z - c.z) - c.r));
    expect(nearest).toBeGreaterThan(0);
    expect(s.clr).toBeCloseTo(nearest, 6);
  });
});
