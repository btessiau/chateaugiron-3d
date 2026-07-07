import { describe, it, expect } from 'vitest';
import { orientedBox, gableRoofPositions } from './roof.js';

describe('orientedBox', () => {
  it('aligns the long axis with x for a wide rectangle', () => {
    const rect = [
      [-10, -4],
      [10, -4],
      [10, 4],
      [-10, 4],
    ];
    const box = orientedBox(rect);
    expect(box.L).toBeCloseTo(10, 6);
    expect(box.W).toBeCloseTo(4, 6);
    expect(Math.abs(box.ux)).toBeCloseTo(1, 6);
    expect(Math.abs(box.uz)).toBeCloseTo(0, 6);
    expect(box.cx).toBeCloseTo(0, 6);
    expect(box.cz).toBeCloseTo(0, 6);
  });

  it('recentres the box on off-origin footprints', () => {
    const rect = [
      [90, 40],
      [110, 40],
      [110, 48],
      [90, 48],
    ];
    const box = orientedBox(rect);
    expect(box.cx).toBeCloseTo(100, 6);
    expect(box.cz).toBeCloseTo(44, 6);
    expect(box.L).toBeCloseTo(10, 6);
    expect(box.W).toBeCloseTo(4, 6);
  });

  it('swaps so the ridge follows the longer extent when variance disagrees', () => {
    // Mass concentrated on the short (z) extremes makes PCA pick z first, but
    // the x extent is longer, so the box must swap axes.
    const pts = [
      [5, 0],
      [-5, 0],
      [0, 3],
      [0, -3],
      [0, 3],
      [0, -3],
      [0, 3],
      [0, -3],
      [0, 3],
      [0, -3],
    ];
    const box = orientedBox(pts);
    expect(box.L).toBeCloseTo(5, 6);
    expect(box.W).toBeCloseTo(3, 6);
    expect(Math.abs(box.ux)).toBeCloseTo(1, 6);
    expect(Math.abs(box.uz)).toBeCloseTo(0, 6);
  });
});

describe('gableRoofPositions', () => {
  const box = { cx: 0, cz: 0, ux: 1, uz: 0, vx: 0, vz: 1, L: 5, W: 3 };

  it('returns six triangles (54 numbers)', () => {
    const pos = gableRoofPositions(box, 6, 3);
    expect(pos).toHaveLength(54);
  });

  it('puts eaves at the wall top and the ridge above it', () => {
    const pos = gableRoofPositions(box, 6, 3);
    const ys = [];
    for (let i = 1; i < pos.length; i += 3) ys.push(pos[i]);
    expect(Math.min(...ys)).toBeCloseTo(6, 6);
    expect(Math.max(...ys)).toBeCloseTo(9, 6);
  });

  it('keeps the ridge on the centre line and eaves at the box edges', () => {
    const pos = gableRoofPositions(box, 6, 3);
    // First vertex is the -L,-W eave corner: (-5, 6, -3).
    expect(pos[0]).toBeCloseTo(-5, 6);
    expect(pos[1]).toBeCloseTo(6, 6);
    expect(pos[2]).toBeCloseTo(-3, 6);
  });
});
