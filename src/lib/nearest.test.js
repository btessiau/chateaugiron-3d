import { describe, it, expect } from 'vitest';
import { nearestIndex } from './nearest.js';

describe('nearestIndex', () => {
  it('returns -1 and Infinity for an empty list', () => {
    const r = nearestIndex([], 0, 0);
    expect(r.index).toBe(-1);
    expect(r.distance).toBe(Infinity);
  });
  it('finds the closest point and its distance', () => {
    const pts = [
      { x: 10, z: 0 },
      { x: 0, z: 3 },
      { x: -8, z: -8 },
    ];
    const r = nearestIndex(pts, 0, 0);
    expect(r.index).toBe(1);
    expect(r.distance).toBeCloseTo(3, 6);
  });
});
