import { describe, it, expect } from 'vitest';
import {
  WALKABLE_HIGHWAYS,
  isWalkableWay,
  featureBounds,
  makeGrid,
  fillPolygon,
  isBlocked,
  blockedFootprint,
  stepPlayer,
  inputVector,
  facingFrom,
  findOpenSpawn,
  ringCentroid,
  nearestPoint,
  classifyLandmark,
  buildingHeight,
  mapTargets,
} from './map2d.js';

const id = (lon, lat) => [lon, lat]; // identity projector: input is already metres

describe('walkable ways', () => {
  it('knows footways are walkable and roads are not', () => {
    expect(isWalkableWay('footway')).toBe(true);
    expect(isWalkableWay('path')).toBe(true);
    expect(isWalkableWay('primary')).toBe(false);
    expect(WALKABLE_HIGHWAYS.has('steps')).toBe(true);
  });
});

describe('featureBounds', () => {
  it('spans every vertex', () => {
    const b = featureBounds(
      [
        {
          g: [
            [0, 0],
            [10, 4],
          ],
        },
        { g: [[-2, 3]] },
      ],
      id,
    );
    expect(b).toEqual({ minX: -2, minN: 0, maxX: 10, maxN: 4 });
  });
  it('returns zeros when there are no features', () => {
    expect(featureBounds([], id)).toEqual({ minX: 0, minN: 0, maxX: 0, maxN: 0 });
  });
});

describe('makeGrid', () => {
  it('sizes columns and rows from the bounds', () => {
    const g = makeGrid({ minX: 0, minN: 0, maxX: 10, maxN: 6 }, 2);
    expect(g.cols).toBe(5);
    expect(g.rows).toBe(3);
    expect(g.data.length).toBe(15);
  });
  it('never collapses to zero size', () => {
    const g = makeGrid({ minX: 0, minN: 0, maxX: 0, maxN: 0 }, 2);
    expect(g.cols).toBe(1);
    expect(g.rows).toBe(1);
  });
});

describe('fillPolygon + isBlocked', () => {
  it('blocks cells inside a square and leaves the rest free', () => {
    const g = makeGrid({ minX: 0, minN: 0, maxX: 10, maxN: 10 }, 1);
    fillPolygon(g, [
      [2, 2],
      [6, 2],
      [6, 6],
      [2, 6],
    ]);
    expect(isBlocked(g, 3.5, 3.5)).toBe(true);
    expect(isBlocked(g, 0.5, 0.5)).toBe(false);
  });
  it('ignores degenerate rings', () => {
    const g = makeGrid({ minX: 0, minN: 0, maxX: 10, maxN: 10 }, 1);
    fillPolygon(g, [
      [1, 1],
      [2, 2],
    ]);
    expect(g.data.every((v) => v === 0)).toBe(true);
  });
  it('clamps a polygon that pokes outside the grid on every side', () => {
    const g = makeGrid({ minX: 0, minN: 0, maxX: 6, maxN: 6 }, 1);
    fillPolygon(g, [
      [-5, -5],
      [11, -5],
      [11, 11],
      [-5, 11],
    ]);
    expect(isBlocked(g, 0.5, 0.5)).toBe(true);
    expect(isBlocked(g, 5.5, 5.5)).toBe(true);
  });
  it('reports out-of-bounds points as blocked on all four edges', () => {
    const g = makeGrid({ minX: 0, minN: 0, maxX: 4, maxN: 4 }, 1);
    expect(isBlocked(g, -1, 2)).toBe(true); // cx < 0
    expect(isBlocked(g, 2, -1)).toBe(true); // cy < 0
    expect(isBlocked(g, 99, 2)).toBe(true); // cx >= cols
    expect(isBlocked(g, 2, 99)).toBe(true); // cy >= rows
  });
});

describe('blockedFootprint', () => {
  const g = makeGrid({ minX: 0, minN: 0, maxX: 20, maxN: 20 }, 1);
  fillPolygon(g, [
    [10, 10],
    [12, 10],
    [12, 12],
    [10, 12],
  ]);
  it('is clear away from the block', () => {
    expect(blockedFootprint(g, 3, 3, 0.5)).toBe(false);
  });
  it('is blocked when the centre is on the block', () => {
    expect(blockedFootprint(g, 10.5, 10.5, 0.5)).toBe(true);
  });
  it('is blocked when only an offset touches the block', () => {
    expect(blockedFootprint(g, 9.6, 10.5, 0.5)).toBe(true);
  });
});

describe('stepPlayer', () => {
  const g = makeGrid({ minX: 0, minN: 0, maxX: 20, maxN: 20 }, 1);
  fillPolygon(g, [
    [10, 0],
    [12, 0],
    [12, 20],
    [10, 20],
  ]); // a wall at x in [10,12)
  it('moves freely in the open', () => {
    const p = stepPlayer(g, { x: 3, n: 3 }, 1, 1, 0.4);
    expect(p).toEqual({ x: 4, n: 4 });
  });
  it('slides along a wall: x is stopped, n still applies', () => {
    const p = stepPlayer(g, { x: 9.2, n: 5 }, 1, 1, 0.4);
    expect(p.x).toBeCloseTo(9.2); // blocked into the wall
    expect(p.n).toBeCloseTo(6); // free vertically
  });
  it('does nothing when both axes are zero', () => {
    expect(stepPlayer(g, { x: 3, n: 3 }, 0, 0, 0.4)).toEqual({ x: 3, n: 3 });
  });
});

describe('inputVector', () => {
  it('is zero with no keys', () => {
    expect(inputVector({})).toEqual({ dx: 0, dn: 0, len: 0 });
  });
  it('normalises a diagonal', () => {
    const v = inputVector({ up: true, right: true });
    expect(v.dx).toBeCloseTo(Math.SQRT1_2);
    expect(v.dn).toBeCloseTo(Math.SQRT1_2);
    expect(v.len).toBeCloseTo(Math.SQRT2);
  });
  it('cancels opposite keys', () => {
    const v = inputVector({ up: true, down: true, left: true, right: true });
    expect(v).toEqual({ dx: 0, dn: 0, len: 0 });
  });
  it('maps single keys to axes (up=north, right=east)', () => {
    expect(inputVector({ up: true })).toMatchObject({ dx: 0, dn: 1 });
    expect(inputVector({ down: true })).toMatchObject({ dx: 0, dn: -1 });
    expect(inputVector({ left: true })).toMatchObject({ dx: -1, dn: 0 });
  });
});

describe('facingFrom', () => {
  it('keeps the previous facing when still', () => {
    expect(facingFrom(0, 0, 'left')).toBe('left');
  });
  it('prefers the dominant axis', () => {
    expect(facingFrom(1, 0.2, 'down')).toBe('right');
    expect(facingFrom(-1, 0.2, 'down')).toBe('left');
    expect(facingFrom(0.2, 1, 'left')).toBe('up');
    expect(facingFrom(0.2, -1, 'left')).toBe('down');
  });
});

describe('findOpenSpawn', () => {
  it('returns the preferred point when it is already clear', () => {
    const g = makeGrid({ minX: 0, minN: 0, maxX: 20, maxN: 20 }, 1);
    expect(findOpenSpawn(g, 5, 5, 0.4)).toEqual({ x: 5, n: 5 });
  });
  it('spirals out to the nearest clear spot', () => {
    const g = makeGrid({ minX: 0, minN: 0, maxX: 40, maxN: 40 }, 1);
    fillPolygon(g, [
      [10, 10],
      [30, 10],
      [30, 30],
      [10, 30],
    ]);
    const s = findOpenSpawn(g, 20, 20, 0.4);
    expect(blockedFootprint(g, s.x, s.n, 0.4)).toBe(false);
  });
  it('falls back to the preferred point when nothing is open', () => {
    const g = makeGrid({ minX: 0, minN: 0, maxX: 2, maxN: 2 }, 1);
    g.data.fill(1); // whole map blocked, and off-map is blocked too
    expect(findOpenSpawn(g, 1, 1, 0.4)).toEqual({ x: 1, n: 1 });
  });
});

describe('ringCentroid', () => {
  it('averages the vertices', () => {
    expect(
      ringCentroid([
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ]),
    ).toEqual({ x: 2, n: 2 });
  });
});

describe('nearestPoint', () => {
  it('returns null for an empty list', () => {
    expect(nearestPoint([], 0, 0)).toBe(null);
  });
  it('finds the closest vertex and its distance', () => {
    const r = nearestPoint(
      [
        [10, 0],
        [3, 4],
        [-8, -8],
      ],
      0,
      0,
    );
    expect(r.x).toBe(3);
    expect(r.n).toBe(4);
    expect(r.d).toBeCloseTo(5);
  });
});

describe('classifyLandmark', () => {
  it('returns null without tags or for a plain house', () => {
    expect(classifyLandmark(null)).toBe(null);
    expect(classifyLandmark({ building: 'yes' })).toBe(null);
  });
  it('recognises churches', () => {
    expect(classifyLandmark({ building: 'church' })).toBe('church');
    expect(classifyLandmark({ building: 'chapel' })).toBe('church');
    expect(classifyLandmark({ amenity: 'place_of_worship' })).toBe('church');
    expect(classifyLandmark({ name: 'Église Sainte-Marie-Madeleine' })).toBe('church');
    expect(classifyLandmark({ name: 'Eglise' })).toBe('church');
  });
  it('recognises the château', () => {
    expect(classifyLandmark({ historic: 'castle' })).toBe('chateau');
    expect(classifyLandmark({ castle_type: 'defensive' })).toBe('chateau');
    expect(classifyLandmark({ name: 'Château de Châteaugiron' })).toBe('chateau');
    expect(classifyLandmark({ name: 'Le Donjon' })).toBe('chateau');
  });
  it('recognises Les Halles and the town hall', () => {
    expect(classifyLandmark({ name: 'Les Halles' })).toBe('halles');
    expect(classifyLandmark({ amenity: 'townhall' })).toBe('townhall');
    expect(classifyLandmark({ name: 'Mairie de Châteaugiron' })).toBe('townhall');
  });
});

describe('buildingHeight', () => {
  it('makes landmarks tall so they stand out', () => {
    expect(buildingHeight({ historic: 'castle' })).toBe(22);
    expect(buildingHeight({ building: 'church' })).toBe(17);
    expect(buildingHeight({ name: 'Les Halles' })).toBe(11);
    expect(buildingHeight({ amenity: 'townhall' })).toBe(11);
  });
  it('uses real eaves height plus half the roof rise', () => {
    expect(buildingHeight({ building: 'house', height: '4', 'roof:height': '3' })).toBe(5.5);
  });
  it('falls back to levels then a default, and clamps', () => {
    expect(buildingHeight({ building: 'house', 'building:levels': '2' })).toBe(6);
    expect(buildingHeight({ building: 'house' })).toBe(3.2);
    expect(buildingHeight(null)).toBe(3.2);
    expect(buildingHeight({ building: 'house', height: '80' })).toBe(20);
  });
});

describe('mapTargets', () => {
  const ring = (cx, cn) => [
    [cx - 1, cn - 1],
    [cx + 1, cn - 1],
    [cx + 1, cn + 1],
    [cx - 1, cn + 1],
  ];
  const feats = [
    { k: 'building', t: { building: 'church', name: 'Église' }, g: ring(10, 20) },
    { k: 'building', t: { historic: 'yes', height: '32' }, g: ring(-40, -50) }, // donjon
    { k: 'building', t: { historic: 'yes' }, g: ring(-40, 10) }, // lower historic, no height
    { k: 'building', t: { building: 'house' }, g: ring(0, 0) },
    { k: 'green', t: { leisure: 'park', name: 'Etang de Châteaugiron' }, g: ring(100, 5) },
    { k: 'green', t: { leisure: 'park', name: 'Jardin de la Glaume' }, g: ring(-80, 30) },
    { k: 'green', t: {}, g: ring(5, 5) },
  ];

  it('locates the church, the tallest historic building and the named greens', () => {
    const t = mapTargets(feats, id);
    const kinds = t.map((x) => x.kind);
    expect(kinds).toEqual(['church', 'chateau', 'etang', 'jardin']);
    const chateau = t.find((x) => x.kind === 'chateau');
    expect(chateau.x).toBe(-40);
    expect(chateau.n).toBe(-50); // the h=32 donjon, not the shorter historic building
    const etang = t.find((x) => x.kind === 'etang');
    expect(etang.x).toBe(100);
  });

  it('omits targets that are not in the data', () => {
    const only = mapTargets([{ k: 'building', t: { building: 'house' }, g: ring(0, 0) }], id);
    expect(only).toEqual([]);
  });
});
