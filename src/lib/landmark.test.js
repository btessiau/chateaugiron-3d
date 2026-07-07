import { describe, it, expect } from 'vitest';
import { isChurch, isChapel, towerPlacement, pyramidPositions } from './landmark.js';

describe('isChurch / isChapel', () => {
  it('detects churches by building or amenity', () => {
    expect(isChurch({ building: 'church' })).toBe(true);
    expect(isChurch({ amenity: 'place_of_worship' })).toBe(true);
    expect(isChurch({ building: 'yes' })).toBe(false);
  });

  it('detects chapels by building or historic', () => {
    expect(isChapel({ building: 'chapel' })).toBe(true);
    expect(isChapel({ historic: 'chapel' })).toBe(true);
    expect(isChapel({ building: 'yes' })).toBe(false);
  });
});

describe('towerPlacement', () => {
  const box = { cx: 0, cz: 0, ux: 1, uz: 0, vx: 0, vz: 1, L: 20, W: 6 };

  it('sits toward the +L end of the box', () => {
    const t = towerPlacement(box);
    expect(t.x).toBeGreaterThan(0);
    expect(t.z).toBeCloseTo(0, 6);
  });

  it('clamps the tower half width', () => {
    const wide = towerPlacement({ ...box, W: 40 });
    expect(wide.half).toBeLessThanOrEqual(3.6);
    const narrow = towerPlacement({ ...box, W: 0.5 });
    expect(narrow.half).toBeGreaterThanOrEqual(2.0);
  });

  it('never places the tower past the box end', () => {
    const t = towerPlacement({ ...box, L: 1 });
    // d clamps at 0 so the tower centre stays at the box centre
    expect(t.x).toBeCloseTo(0, 6);
  });
});

describe('pyramidPositions', () => {
  it('returns 4 triangles (36 numbers)', () => {
    const p = pyramidPositions(0, 0, 10, 2, 6, 1, 0, 0, 1);
    expect(p).toHaveLength(36);
  });

  it('puts the apex at baseY + height above the centre', () => {
    const p = pyramidPositions(5, 7, 10, 2, 6, 1, 0, 0, 1);
    // apex is the third vertex of the first triangle
    expect(p[6]).toBeCloseTo(5, 6);
    expect(p[7]).toBeCloseTo(16, 6);
    expect(p[8]).toBeCloseTo(7, 6);
  });

  it('keeps every base corner at baseY', () => {
    const p = pyramidPositions(0, 0, 3, 2, 6, 1, 0, 0, 1);
    // vertices 0 and 1 of the first triangle are base corners
    expect(p[1]).toBeCloseTo(3, 6);
    expect(p[4]).toBeCloseTo(3, 6);
  });
});
