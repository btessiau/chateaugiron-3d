import { describe, it, expect } from 'vitest';
import { chimneyFor } from './chimney.js';

// A unit oriented box aligned to the x axis (ridge runs along +x).
function boxAlongX(L = 6, W = 3, cx = 10, cz = 20) {
  return { cx, cz, ux: 1, uz: 0, vx: 0, vz: 1, L, W };
}

describe('chimneyFor', () => {
  it('returns null for a missing box or non-positive roof height', () => {
    expect(chimneyFor(null, 5, 2)).toBe(null);
    expect(chimneyFor(boxAlongX(), 5, 0)).toBe(null);
    expect(chimneyFor(boxAlongX(), 5, -1)).toBe(null);
  });

  it('returns null when the footprint is too small to carry a chimney', () => {
    expect(chimneyFor(boxAlongX(2, 3), 5, 2)).toBe(null); // short L
    expect(chimneyFor(boxAlongX(6, 1), 5, 2)).toBe(null); // narrow W
  });

  it('places the stack on the ridge near a gable end', () => {
    const box = boxAlongX(6, 3, 10, 20);
    const c = chimneyFor(box, 5, 2, 1);
    // On the ridge means z stays on the centre line for an x-aligned box.
    expect(c.z).toBeCloseTo(20, 6);
    // Near a gable end: |x - cx| is a large fraction of L (0.78..0.92).
    const along = Math.abs(c.x - 10);
    expect(along).toBeGreaterThanOrEqual(0.78 * 6 - 1e-6);
    expect(along).toBeLessThanOrEqual(0.92 * 6 + 1e-6);
  });

  it('rises above the ridge and seats below it', () => {
    const wallTop = 5;
    const roofH = 2;
    const c = chimneyFor(boxAlongX(6, 3), wallTop, roofH, 3);
    const ridge = wallTop + roofH;
    expect(c.top).toBeGreaterThan(ridge);
    expect(c.base).toBeLessThan(ridge);
    expect(c.top).toBeGreaterThan(c.base);
  });

  it('gives a sensible square size and ridge-aligned angle', () => {
    const c = chimneyFor(boxAlongX(6, 3), 5, 2, 2);
    expect(c.size).toBeGreaterThanOrEqual(0.55);
    expect(c.size).toBeLessThanOrEqual(0.85);
    expect(c.angle).toBeCloseTo(0, 6); // u is +x
  });

  it('is deterministic for a given seed and varies across seeds', () => {
    const box = boxAlongX(6, 3);
    const a = chimneyFor(box, 5, 2, 7);
    const b = chimneyFor(box, 5, 2, 7);
    const d = chimneyFor(box, 5, 2, 8);
    expect(a).toEqual(b);
    expect(a.x === d.x && a.size === d.size).toBe(false);
  });
});
