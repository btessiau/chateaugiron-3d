import { describe, it, expect } from 'vitest';
import {
  roadWidth,
  roadColor,
  normalizeRing,
  boundsOf,
  isOversized,
  buildRoadRibbon,
  polygonArea,
  doorwayGap,
  DEFAULT_ROAD_WIDTH,
  DEFAULT_ROAD_COLOR,
} from './geometry.js';

describe('roadWidth / roadColor', () => {
  it('returns known values', () => {
    expect(roadWidth('residential')).toBe(5);
    expect(roadColor('residential')).toBe(0xa8a199);
  });
  it('paints walkable ways a distinct tan from vehicle roads', () => {
    expect(roadColor('footway')).toBe(0xd2ba90);
    expect(roadColor('footway')).not.toBe(roadColor('residential'));
    expect(roadColor('steps')).toBe(roadColor('footway'));
  });
  it('falls back to defaults', () => {
    expect(roadWidth('mystery')).toBe(DEFAULT_ROAD_WIDTH);
    expect(roadColor('mystery')).toBe(DEFAULT_ROAD_COLOR);
  });
});

describe('normalizeRing', () => {
  it('rejects non-arrays and short rings', () => {
    expect(normalizeRing(null)).toBeNull();
    expect(
      normalizeRing([
        [0, 0],
        [1, 1],
      ]),
    ).toBeNull();
  });
  it('keeps an open ring as-is', () => {
    const r = normalizeRing([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    expect(r).toHaveLength(3);
  });
  it('drops a duplicated closing point', () => {
    const r = normalizeRing([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ]);
    expect(r).toHaveLength(3);
  });
  it('rejects a ring that collapses below 3 points', () => {
    expect(
      normalizeRing([
        [0, 0],
        [1, 1],
        [0, 0],
      ]),
    ).toBeNull();
  });
});

describe('boundsOf', () => {
  it('computes min/max over points', () => {
    const b = boundsOf([
      [0, 0],
      [5, 3],
      [-2, 7],
      [1, 1],
    ]);
    expect(b).toEqual({ minX: -2, maxX: 5, minZ: 0, maxZ: 7 });
  });
});

describe('isOversized', () => {
  it('flags wide footprints', () => {
    expect(isOversized({ minX: 0, maxX: 400, minZ: 0, maxZ: 1 })).toBe(true);
  });
  it('flags tall footprints', () => {
    expect(isOversized({ minX: 0, maxX: 1, minZ: 0, maxZ: 400 })).toBe(true);
  });
  it('passes normal footprints', () => {
    expect(isOversized({ minX: 0, maxX: 20, minZ: 0, maxZ: 30 })).toBe(false);
  });
  it('honours a custom limit', () => {
    expect(isOversized({ minX: 0, maxX: 20, minZ: 0, maxZ: 0 }, 10)).toBe(true);
  });
});

describe('buildRoadRibbon', () => {
  it('returns nothing for degenerate input', () => {
    expect(buildRoadRibbon(null, 4, 0)).toEqual([]);
    expect(buildRoadRibbon([[0, 0]], 4, 0)).toEqual([]);
  });
  it('builds one quad for a straight segment', () => {
    const out = buildRoadRibbon(
      [
        [0, 0],
        [10, 0],
      ],
      4,
      0,
    );
    expect(out).toHaveLength(18);
    expect(out.slice(0, 3)).toEqual([0, 0, 2]);
    expect(out.slice(3, 6)).toEqual([0, 0, -2]);
  });
  it('builds two quads for a bent road', () => {
    const out = buildRoadRibbon(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      4,
      0,
    );
    expect(out).toHaveLength(36);
    expect(out.every((n) => Number.isFinite(n))).toBe(true);
  });
  it('skips zero-length segments and their vertices', () => {
    const out = buildRoadRibbon(
      [
        [0, 0],
        [0, 0],
        [10, 0],
      ],
      4,
      0,
    );
    expect(out).toHaveLength(18);
  });
  it('skips vertices where segment normals cancel', () => {
    const out = buildRoadRibbon(
      [
        [0, 0],
        [10, 0],
        [0, 0],
      ],
      4,
      0,
    );
    expect(out).toEqual([]);
  });
});

describe('polygonArea', () => {
  it('computes the area of a unit square', () => {
    expect(
      polygonArea([
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ]),
    ).toBe(4);
  });
  it('is sign independent of winding order', () => {
    const ring = [
      [0, 0],
      [0, 3],
      [3, 3],
      [3, 0],
    ];
    expect(polygonArea(ring)).toBe(9);
  });
});

describe('doorwayGap', () => {
  it('returns two symmetric flanking pieces for a centred door', () => {
    const pieces = doorwayGap(5, 2);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].center).toBeCloseTo(-3);
    expect(pieces[1].center).toBeCloseTo(3);
    expect(pieces[0].half).toBeCloseTo(2);
    expect(pieces[1].half).toBeCloseTo(2);
  });
  it('treats a non-positive door as one solid wall', () => {
    expect(doorwayGap(4, 0)).toEqual([{ center: 0, half: 4 }]);
  });
  it('returns nothing when the door is as wide as the wall', () => {
    expect(doorwayGap(3, 6)).toEqual([]);
    expect(doorwayGap(3, 8)).toEqual([]);
  });
  it('drops slivers thinner than the minimum piece', () => {
    expect(doorwayGap(2, 3.99, 0.1)).toEqual([]);
  });
  it('uses the absolute half span', () => {
    const pieces = doorwayGap(-5, 2);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].half).toBeCloseTo(2);
  });
});
