import { describe, it, expect } from 'vitest';
import { pointInPolygon, scatterInPolygon } from './scatter.js';

const square = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('pointInPolygon', () => {
  it('detects a point inside', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });

  it('detects a point outside', () => {
    expect(pointInPolygon(15, 5, square)).toBe(false);
    expect(pointInPolygon(-1, 5, square)).toBe(false);
  });
});

describe('scatterInPolygon', () => {
  it('returns only points inside the polygon', () => {
    const pts = scatterInPolygon(square, 3, 42);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(pointInPolygon(p.x, p.z, square)).toBe(true);
      expect(p.s).toBeGreaterThan(0);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = scatterInPolygon(square, 3, 7);
    const b = scatterInPolygon(square, 3, 7);
    expect(a).toEqual(b);
  });

  it('returns nothing for a degenerate ring or bad spacing', () => {
    expect(scatterInPolygon([[0, 0]], 3, 1)).toEqual([]);
    expect(scatterInPolygon(square, 0, 1)).toEqual([]);
  });
});
