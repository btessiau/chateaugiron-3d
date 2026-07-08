import { describe, it, expect } from 'vitest';
import {
  WALKABLE_HIGHWAYS,
  isWalkableWay,
  featureBounds,
  makeGrid,
  fillPolygon,
  stampSegment,
  roadHalfWidth,
  isBlocked,
  blockedFootprint,
  stepPlayer,
  glide,
  inputVector,
  facingFrom,
  travelSpeed,
  TRAVEL,
  findOpenSpawn,
  ringCentroid,
  roadLabelAnchor,
  nearestPoint,
  classifyLandmark,
  buildingHeight,
  mapTargets,
  namedPlaces,
  nearestWithin,
  distanceToPlace,
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

describe('glide', () => {
  it('goes straight when the desired heading is open', () => {
    const g = makeGrid({ minX: 0, minN: 0, maxX: 20, maxN: 20 }, 1);
    const p = glide(g, { x: 5, n: 5 }, 1, 0, 0.4);
    expect(p.x).toBeCloseTo(6);
    expect(p.n).toBeCloseTo(5);
  });
  it('stays put with no input', () => {
    const g = makeGrid({ minX: 0, minN: 0, maxX: 20, maxN: 20 }, 1);
    expect(glide(g, { x: 5, n: 5 }, 0, 0, 0.4)).toEqual({ x: 5, n: 5 });
  });
  it('fans out to a clear heading when the straight path is blocked', () => {
    // A wall directly east of the player. Pushing east must veer around it
    // rather than stopping dead.
    const g = makeGrid({ minX: 0, minN: 0, maxX: 20, maxN: 20 }, 1);
    fillPolygon(g, [
      [6, 2],
      [7, 2],
      [7, 8],
      [6, 8],
    ]);
    const p = glide(g, { x: 5, n: 5 }, 1, 0, 0.4);
    expect(p.x).not.toBe(5); // it moved
    expect(Math.abs(p.n - 5)).toBeGreaterThan(0); // veered off the straight line
  });
  it('stays put when every heading is blocked', () => {
    const g = makeGrid({ minX: 0, minN: 0, maxX: 20, maxN: 20 }, 1);
    g.data.fill(1);
    expect(glide(g, { x: 5, n: 5 }, 1, 0, 0.4)).toEqual({ x: 5, n: 5 });
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

describe('roadLabelAnchor', () => {
  it('returns null for a degenerate way', () => {
    expect(roadLabelAnchor([])).toBe(null);
    expect(roadLabelAnchor([[1, 1]])).toBe(null);
    expect(roadLabelAnchor(undefined)).toBe(null);
  });
  it('picks the midpoint and angle of the longest segment', () => {
    // Short east step, then a long north-east run.
    const a = roadLabelAnchor([
      [0, 0],
      [1, 0],
      [11, 10],
    ]);
    expect(a.x).toBeCloseTo(6);
    expect(a.n).toBeCloseTo(5);
    expect(a.angle).toBeCloseTo(Math.PI / 4);
    expect(a.len).toBeCloseTo(Math.hypot(10, 10));
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

describe('namedPlaces', () => {
  const ring = (cx, cn) => [
    [cx - 1, cn - 1],
    [cx + 1, cn - 1],
    [cx + 1, cn + 1],
    [cx - 1, cn + 1],
  ];
  const feats = [
    { k: 'building', t: { name: 'Cinéma Paradisio' }, g: ring(10, 20) },
    { k: 'building', t: { building: 'house' }, g: ring(0, 0) }, // no name
    { k: 'building', t: null, g: ring(5, 5) }, // no tags
    { k: 'green', t: { name: 'Jardin' }, g: ring(-8, 3) }, // not a building
    { k: 'road', t: { name: 'Rue de Rennes' }, g: ring(2, 2) }, // not a building
  ];

  it('returns one entry per named building with its centroid and footprint', () => {
    const p = namedPlaces(feats, id);
    expect(p).toHaveLength(1);
    expect(p[0].label).toBe('Cinéma Paradisio');
    expect(p[0].x).toBe(10);
    expect(p[0].n).toBe(20);
    expect(p[0].poly).toEqual(ring(10, 20));
  });
});

describe('distanceToPlace', () => {
  const sq = {
    label: 'S',
    x: 0,
    n: 0,
    poly: [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ],
  };
  it('is zero inside the footprint', () => {
    expect(distanceToPlace(sq, 0, 0)).toBe(0);
  });
  it('is the distance to the nearest wall outside', () => {
    expect(distanceToPlace(sq, 3, 0)).toBe(2);
    expect(distanceToPlace(sq, 0, -4)).toBe(3);
  });
  it('measures to the nearest corner past a wall end', () => {
    expect(distanceToPlace(sq, 4, 4)).toBeCloseTo(Math.hypot(3, 3), 6);
  });
  it('handles a degenerate edge without dividing by zero', () => {
    const dup = {
      label: 'D',
      x: 0,
      n: 0,
      poly: [
        [1, 1],
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
      ],
    };
    expect(distanceToPlace(dup, 0, 0)).toBeCloseTo(Math.hypot(1, 1), 6);
  });
  it('falls back to the centroid when there is no footprint', () => {
    expect(distanceToPlace({ x: 0, n: 0 }, 3, 4)).toBe(5);
    expect(distanceToPlace({ x: 0, n: 0, poly: [[2, 0]] }, 5, 0)).toBe(5);
  });
});

describe('nearestWithin', () => {
  const places = [
    { label: 'A', x: 0, n: 0 },
    { label: 'B', x: 100, n: 0 },
  ];
  it('returns the nearest place inside the radius', () => {
    const r = nearestWithin(places, 5, 0, 12);
    expect(r.place.label).toBe('A');
    expect(r.d).toBe(5);
  });
  it('returns null when nothing is inside the radius', () => {
    expect(nearestWithin(places, 50, 0, 12)).toBe(null);
  });
});

describe('travelSpeed', () => {
  it('walks and runs on foot', () => {
    expect(travelSpeed({})).toBe(TRAVEL.walk);
    expect(travelSpeed({ run: true })).toBe(TRAVEL.run);
  });
  it('is much faster on the bicycle, and faster still sprinting', () => {
    expect(travelSpeed({ bike: true })).toBe(TRAVEL.bike);
    expect(travelSpeed({ bike: true, run: true })).toBe(TRAVEL.bikeSprint);
    expect(TRAVEL.bike).toBeGreaterThan(TRAVEL.run);
  });
  it('defaults to walking with no argument', () => {
    expect(travelSpeed()).toBe(TRAVEL.walk);
  });
});

describe('roadHalfWidth', () => {
  it('gives wider strips to bigger roads and a default for the unknown', () => {
    expect(roadHalfWidth('secondary')).toBeGreaterThan(roadHalfWidth('footway'));
    expect(roadHalfWidth('footway')).toBe(1.4);
    expect(roadHalfWidth('some-other')).toBe(2);
    expect(roadHalfWidth(undefined)).toBe(2);
  });
});

describe('stampSegment', () => {
  const bounds = { minX: 0, minN: 0, maxX: 20, maxN: 20 };

  it('carves a passable strip along a segment, leaving the rest blocked', () => {
    const g = makeGrid(bounds, 1);
    g.data.fill(1);
    stampSegment(g, 2, 10, 18, 10, 1.2, 0);
    expect(isBlocked(g, 10, 10)).toBe(false); // on the line
    expect(isBlocked(g, 10, 10.5)).toBe(false); // within the half-width
    expect(isBlocked(g, 10, 14)).toBe(true); // clear of the strip
    expect(isBlocked(g, 10, 2)).toBe(true);
  });

  it('clamps to the grid when the segment runs past the edges', () => {
    const g = makeGrid(bounds, 1);
    stampSegment(g, -10, 5, 30, 5, 1.5, 1); // extends beyond both x edges
    expect(isBlocked(g, 0.5, 5)).toBe(true); // stamped near the left edge
    expect(isBlocked(g, 19.5, 5)).toBe(true); // and the right edge
  });

  it('clamps top and bottom for a segment past the north/south edges', () => {
    const g = makeGrid(bounds, 1);
    stampSegment(g, 5, -10, 5, 30, 1.5, 1); // extends beyond both n edges
    expect(isBlocked(g, 5, 0.5)).toBe(true); // stamped near the bottom edge
    expect(isBlocked(g, 5, 19.5)).toBe(true); // and the top edge
  });
});
