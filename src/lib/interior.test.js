import { describe, it, expect } from 'vitest';
import {
  pickDoor,
  enterableBuildings,
  enterableAt,
  buildInterior,
  moveInInterior,
  onExitMat,
} from './interior.js';

// Identity projector: the feature coords are already metres in these tests.
const id = (lon, lat) => [lon, lat];

// A square building footprint centred on (cx, cn) with half-size s.
function square(cx, cn, s, tags) {
  return {
    k: 'building',
    t: tags,
    g: [
      [cx - s, cn - s],
      [cx + s, cn - s],
      [cx + s, cn + s],
      [cx - s, cn + s],
    ],
  };
}

describe('pickDoor', () => {
  const poly = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it('picks the boundary vertex nearest to a street point', () => {
    const d = pickDoor(poly, [[9, 9.5]]);
    expect(d).toEqual({ x: 10, n: 10 });
  });

  it('falls back to the southern-most vertex without street points', () => {
    const d = pickDoor(poly, []);
    expect(d.n).toBe(0);
  });

  it('also falls back when roadPts is undefined', () => {
    const d = pickDoor(poly);
    expect(d.n).toBe(0);
  });
});

describe('enterableBuildings', () => {
  it('adds a tagged church with its real name', () => {
    const feats = [square(0, 0, 5, { building: 'church', name: 'Église Test' })];
    const out = enterableBuildings(feats, id, []);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('church');
    expect(out[0].label).toBe('Église Test');
    expect(out[0].area).toBeGreaterThan(0);
  });

  it('labels a nameless landmark from its kind', () => {
    const feats = [square(0, 0, 5, { amenity: 'townhall' })];
    const out = enterableBuildings(feats, id, []);
    expect(out[0].kind).toBe('townhall');
    expect(out[0].label).toBe('Mairie');
  });

  it('adds the largest historic footprint as the château fallback', () => {
    const feats = [
      square(0, 0, 3, { building: 'yes', historic: 'yes' }),
      square(100, 0, 8, { building: 'yes', historic: 'yes' }),
    ];
    const out = enterableBuildings(feats, id, []);
    const castle = out.find((b) => b.kind === 'chateau');
    expect(castle).toBeTruthy();
    expect(castle.label).toBe('Château');
    expect(Math.round(castle.cx)).toBe(100);
  });

  it('prefers a tag-classified château over the historic fallback', () => {
    const feats = [
      square(0, 0, 9, { building: 'yes', historic: 'yes' }),
      square(100, 0, 5, { historic: 'castle', name: 'Château de Test' }),
    ];
    const out = enterableBuildings(feats, id, []);
    const castles = out.filter((b) => b.kind === 'chateau');
    expect(castles).toHaveLength(1);
    expect(castles[0].label).toBe('Château de Test');
    expect(Math.round(castles[0].cx)).toBe(100);
  });

  it('does not double-count a historic church as the château', () => {
    const feats = [square(0, 0, 6, { building: 'church', historic: 'church', name: 'Chapelle' })];
    const out = enterableBuildings(feats, id, []);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('church');
  });

  it('skips non-buildings and degenerate rings', () => {
    const feats = [
      { k: 'road', t: { highway: 'residential' }, g: [] },
      {
        k: 'building',
        t: { building: 'church' },
        g: [
          [0, 0],
          [1, 1],
        ],
      },
    ];
    expect(enterableBuildings(feats, id, [])).toHaveLength(0);
  });

  it('returns nothing when no historic building exists', () => {
    const feats = [square(0, 0, 5, { building: 'yes' })];
    expect(enterableBuildings(feats, id, [])).toHaveLength(0);
  });
});

describe('enterableAt', () => {
  const builds = [
    { label: 'A', doorX: 0, doorN: 0 },
    { label: 'B', doorX: 50, doorN: 0 },
  ];

  it('returns the door within radius', () => {
    expect(enterableAt(builds, 3, 0, 6).label).toBe('A');
  });

  it('returns null when nothing is close enough', () => {
    expect(enterableAt(builds, 25, 0, 6)).toBeNull();
  });

  it('returns the nearest when two are in range', () => {
    expect(enterableAt(builds, 48, 0, 60).label).toBe('B');
  });
});

describe('buildInterior', () => {
  it('makes a tall narrow nave for a church', () => {
    const s = buildInterior('church', 400);
    expect(s.h).toBeGreaterThan(s.w);
    expect(s.props.some((p) => p.type === 'altar')).toBe(true);
    expect(s.props.some((p) => p.type === 'pew')).toBe(true);
    expect(s.props.some((p) => p.type === 'glass' && !p.solid)).toBe(true);
  });

  it('makes a wide hall for the château', () => {
    const s = buildInterior('chateau', 400);
    expect(s.props.some((p) => p.type === 'hearth')).toBe(true);
    expect(s.props.some((p) => p.type === 'table')).toBe(true);
  });

  it('makes stalls for the halles', () => {
    const s = buildInterior('halles', 300);
    expect(s.props.filter((p) => p.type === 'stall').length).toBe(6);
  });

  it('makes a desk room for anything else', () => {
    const s = buildInterior('townhall', 200);
    expect(s.props.some((p) => p.type === 'desk')).toBe(true);
    expect(s.props.some((p) => p.type === 'bench')).toBe(true);
  });

  it('places the spawn above the exit mat', () => {
    const s = buildInterior('church', 400);
    expect(s.spawn.y).toBeLessThan(s.exit.y);
    expect(onExitMat(s, s.spawn)).toBe(false);
  });
});

describe('moveInInterior', () => {
  const spec = buildInterior('chateau', 400);

  it('moves freely across open floor', () => {
    const r = moveInInterior(spec, { x: 3, y: spec.h / 2 }, 1, 0, 0.4);
    expect(r.x).toBeGreaterThan(3);
  });

  it('clamps to the room walls', () => {
    const r = moveInInterior(spec, { x: 3, y: spec.h / 2 }, -100, 0, 0.4);
    expect(r.x).toBeGreaterThanOrEqual(0.4);
  });

  it('is blocked on the x axis by solid furniture', () => {
    // Just left of the central table, pushing right into it.
    const table = spec.props.find((p) => p.type === 'table');
    const start = { x: table.x - 0.5, y: table.y + 1 };
    const r = moveInInterior(spec, start, 1, 0, 0.4);
    expect(r.x).toBe(start.x);
  });

  it('is blocked on the y axis by solid furniture', () => {
    const table = spec.props.find((p) => p.type === 'table');
    const start = { x: table.x + table.w / 2, y: table.y - 0.5 };
    const r = moveInInterior(spec, start, 0, 1, 0.4);
    expect(r.y).toBe(start.y);
  });

  it('ignores non-solid props (stained glass) when moving', () => {
    const church = buildInterior('church', 400);
    const start = { x: church.w / 2, y: church.h - 3 };
    const r = moveInInterior(church, start, 0, -1, 0.4);
    expect(r.y).toBeLessThan(start.y);
  });
});

describe('onExitMat', () => {
  const spec = buildInterior('chateau', 400);

  it('is true on the mat', () => {
    expect(onExitMat(spec, { x: spec.w / 2, y: spec.h - 1 })).toBe(true);
  });

  it('is false away from the mat', () => {
    expect(onExitMat(spec, { x: spec.w / 2, y: 2 })).toBe(false);
  });
});
