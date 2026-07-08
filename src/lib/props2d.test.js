import { describe, it, expect } from 'vitest';
import {
  treeSpots,
  lampSpots,
  pointInPolygon,
  scatterInRing,
  benchSpots,
  ringArea,
  bushSpots,
} from './props2d.js';

// A simple projector for tests: identity-ish, lon->x, lat->n.
const project = (lon, lat) => [lon * 10, lat * 10];

const SQUARE = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

describe('treeSpots', () => {
  it('returns [] for a non-array', () => {
    expect(treeSpots(null, project)).toEqual([]);
    expect(treeSpots(undefined, project)).toEqual([]);
  });

  it('projects each valid [lon,lat] and skips malformed points', () => {
    const out = treeSpots([[1, 2], [3, 4], null, [5], [6, 7]], project);
    expect(out).toEqual([
      { x: 10, n: 20 },
      { x: 30, n: 40 },
      { x: 60, n: 70 },
    ]);
  });
});

describe('lampSpots', () => {
  it('returns [] for a non-array', () => {
    expect(lampSpots(null)).toEqual([]);
  });

  it('skips walkable ways, holes and malformed roads, lamps the streets', () => {
    const roads = [
      null,
      {
        walk: true,
        pts: [
          [0, 0],
          [100, 0],
        ],
      },
      { walk: false, pts: null },
      {
        walk: false,
        pts: [
          [0, 0],
          [100, 0],
        ],
      },
    ];
    const out = lampSpots(roads, 25, 0);
    expect(out.length).toBe(4);
    expect(out.map((p) => Math.round(p.x))).toEqual([25, 50, 75, 100]);
    expect(out.every((p) => Math.abs(p.n) < 1e-9)).toBe(true);
  });
});

describe('pointInPolygon', () => {
  it('is true inside and false outside a square', () => {
    expect(pointInPolygon(5, 5, SQUARE)).toBe(true);
    expect(pointInPolygon(20, 5, SQUARE)).toBe(false);
    expect(pointInPolygon(5, -1, SQUARE)).toBe(false);
  });

  it('handles points level with vertices (no spurious toggle)', () => {
    // A point to the right of the square at a vertex height must be outside.
    expect(pointInPolygon(20, 0, SQUARE)).toBe(false);
    expect(pointInPolygon(20, 10, SQUARE)).toBe(false);
  });
});

describe('scatterInRing', () => {
  it('returns [] for a bad ring or non-positive count', () => {
    expect(scatterInRing(null, 2)).toEqual([]);
    expect(
      scatterInRing(
        [
          [0, 0],
          [1, 1],
        ],
        2,
      ),
    ).toEqual([]);
    expect(scatterInRing(SQUARE, 0)).toEqual([]);
  });

  it('places the requested count of points, all inside the ring', () => {
    const pts = scatterInRing(SQUARE, 3, 7);
    expect(pts.length).toBe(3);
    expect(pts.every((p) => pointInPolygon(p.x, p.n, SQUARE))).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    expect(scatterInRing(SQUARE, 3, 7)).toEqual(scatterInRing(SQUARE, 3, 7));
  });

  it('gives up after bounded tries on a degenerate (zero-area) ring', () => {
    const line = [
      [0, 0],
      [10, 0],
      [20, 0],
    ];
    expect(scatterInRing(line, 2, 1)).toEqual([]);
  });

  it('falls back to a non-zero seed when given 0', () => {
    const pts = scatterInRing(SQUARE, 2, 0);
    expect(pts.length).toBe(2);
  });
});

describe('benchSpots', () => {
  const proj = (lon, lat) => [lon, lat];
  const park = (extra) => ({
    k: 'green',
    t: extra,
    g: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  });

  it('returns [] for a non-array', () => {
    expect(benchSpots(null, proj)).toEqual([]);
  });

  it('skips non-greens and greens that are not parks', () => {
    const feats = [
      null,
      { k: 'building', t: { leisure: 'park' }, g: SQUARE },
      { k: 'green', g: SQUARE }, // no tags at all
      park({ landuse: 'grass' }),
    ];
    expect(benchSpots(feats, proj)).toEqual([]);
  });

  it('places benches in leisure parks, playgrounds and named gardens', () => {
    const byLeisure = benchSpots([park({ leisure: 'park' })], proj, 2);
    const byPlay = benchSpots([park({ leisure: 'playground' })], proj, 1);
    const byName = benchSpots([park({ name: 'Jardin de la Glaume' })], proj, 2);
    expect(byLeisure.length).toBe(2);
    expect(byPlay.length).toBe(1);
    expect(byName.length).toBe(2);
    expect(byLeisure.every((p) => pointInPolygon(p.x, p.n, SQUARE))).toBe(true);
  });

  it('seeds from coordinates when a park has no name', () => {
    const feats = [park({ leisure: 'park' })];
    expect(benchSpots(feats, proj)).toEqual(benchSpots(feats, proj));
  });
});

describe('ringArea', () => {
  it('measures a polygon area with the shoelace formula', () => {
    expect(ringArea(SQUARE)).toBe(100);
    expect(
      ringArea([
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ]),
    ).toBe(12);
  });
  it('returns 0 for a degenerate ring', () => {
    expect(ringArea(null)).toBe(0);
    expect(ringArea([[0, 0]])).toBe(0);
  });
});

describe('bushSpots', () => {
  const proj = (lon, lat) => [lon, lat];
  const green = (side) => ({
    k: 'green',
    g: [
      [0, 0],
      [side, 0],
      [side, side],
      [0, side],
      [0, 0],
    ],
  });

  it('returns [] for a non-array', () => {
    expect(bushSpots(null, proj)).toEqual([]);
  });

  it('scatters bushes inside a garden-sized green', () => {
    const spots = bushSpots([green(30)], proj); // 900 m2
    expect(spots.length).toBeGreaterThanOrEqual(1);
    expect(spots.every((p) => pointInPolygon(p.x, p.n, green(30).g))).toBe(true);
  });

  it('skips greens that are too small or too large, and non-greens', () => {
    expect(bushSpots([green(5)], proj)).toEqual([]); // 25 m2, under minArea
    expect(bushSpots([green(200)], proj)).toEqual([]); // 40000 m2, over maxArea
    expect(bushSpots([{ k: 'building', g: green(30).g }], proj)).toEqual([]);
  });

  it('is deterministic for the same input', () => {
    expect(bushSpots([green(40)], proj)).toEqual(bushSpots([green(40)], proj));
  });

  it('seeds from the green name when present', () => {
    const named = { ...green(40), t: { name: 'Jardin du Château' } };
    const spots = bushSpots([named], proj);
    expect(spots.length).toBeGreaterThanOrEqual(1);
  });
});
