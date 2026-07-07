import { describe, it, expect } from 'vitest';
import {
  roadWidth,
  roadColor,
  normalizeRing,
  boundsOf,
  isOversized,
  buildRoadRibbon,
  DEFAULT_ROAD_WIDTH,
  DEFAULT_ROAD_COLOR,
} from './geometry.js';

describe('roadWidth / roadColor', () => {
  it('returns known values', () => {
    expect(roadWidth('residential')).toBe(5);
    expect(roadColor('residential')).toBe(0x46494e);
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
