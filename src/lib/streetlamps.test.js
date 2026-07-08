import { describe, it, expect } from 'vitest';
import { lampPointsAlong } from './streetlamps.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('lampPointsAlong', () => {
  it('returns [] for non-array, too-short lines or bad spacing', () => {
    expect(lampPointsAlong(null, 10)).toEqual([]);
    expect(lampPointsAlong([[0, 0]], 10)).toEqual([]);
    expect(
      lampPointsAlong(
        [
          [0, 0],
          [1, 0],
        ],
        0,
      ),
    ).toEqual([]);
    expect(
      lampPointsAlong(
        [
          [0, 0],
          [1, 0],
        ],
        -5,
      ),
    ).toEqual([]);
  });

  it('places lamps every spacing along a straight line, including the far end', () => {
    const pts = lampPointsAlong(
      [
        [0, 0],
        [100, 0],
      ],
      25,
    );
    expect(pts.length).toBe(4);
    expect(pts.map((p) => Math.round(p.x))).toEqual([25, 50, 75, 100]);
    expect(pts.every((p) => near(p.z, 0))).toBe(true);
    expect(pts.every((p) => near(p.angle, 0))).toBe(true);
  });

  it('pushes lamps to the left side by the offset', () => {
    const pts = lampPointsAlong(
      [
        [0, 0],
        [100, 0],
      ],
      50,
      2,
    );
    expect(pts.length).toBe(2);
    expect(near(pts[0].x, 50)).toBe(true);
    expect(near(pts[0].z, 2)).toBe(true);
  });

  it('skips zero-length segments', () => {
    const pts = lampPointsAlong(
      [
        [0, 0],
        [0, 0],
        [10, 0],
      ],
      5,
    );
    expect(pts.map((p) => Math.round(p.x))).toEqual([5, 10]);
  });

  it('carries the running length across segments', () => {
    const pts = lampPointsAlong(
      [
        [0, 0],
        [0, 10],
        [10, 10],
      ],
      6,
    );
    expect(pts.length).toBe(3);
    expect(near(pts[0].x, 0) && near(pts[0].z, 6)).toBe(true);
    expect(near(pts[0].angle, Math.PI / 2)).toBe(true);
    expect(near(pts[1].x, 2) && near(pts[1].z, 10)).toBe(true);
    expect(near(pts[2].x, 8) && near(pts[2].z, 10)).toBe(true);
    expect(near(pts[2].angle, 0)).toBe(true);
  });
});
