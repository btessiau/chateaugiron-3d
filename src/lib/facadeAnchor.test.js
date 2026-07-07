import { describe, it, expect } from 'vitest';
import { facadePlacement, fitFacade } from './facadeAnchor.js';

const boxU = { cx: 0, cz: 0, ux: 1, uz: 0, vx: 0, vz: 1, L: 5, W: 3 };

describe('facadePlacement', () => {
  it('picks the +v wall when the street lies on that side', () => {
    const p = facadePlacement(boxU, 0, 10);
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(3);
    expect(p.yaw).toBeCloseTo(0);
    expect(p.width).toBe(10);
    expect(p.normalX).toBeCloseTo(0);
    expect(p.normalZ).toBeCloseTo(1);
  });

  it('picks the -v wall when the street lies on the far side', () => {
    const p = facadePlacement(boxU, 0, -10);
    expect(p.z).toBeCloseTo(-3);
    expect(Math.abs(p.yaw)).toBeCloseTo(Math.PI);
    expect(p.normalZ).toBeCloseTo(-1);
  });

  it('breaks a tie toward the +v wall', () => {
    const p = facadePlacement(boxU, 0, 0);
    expect(p.normalZ).toBeCloseTo(1);
  });

  it('handles a box whose short axis runs along x', () => {
    const boxV = { cx: 0, cz: 0, ux: 0, uz: 1, vx: 1, vz: 0, L: 5, W: 3 };
    const p = facadePlacement(boxV, 10, 0);
    expect(p.x).toBeCloseTo(3);
    expect(p.yaw).toBeCloseTo(Math.PI / 2);
    expect(p.width).toBe(10);
  });
});

describe('fitFacade', () => {
  it('keeps full height when the photo fits the wall width', () => {
    const f = fitFacade(10, 7, 1.3);
    expect(f.h).toBeCloseTo(7);
    expect(f.w).toBeCloseTo(9.1);
    expect(f.centerY).toBeCloseTo(3.5);
  });

  it('shrinks height when the photo would overflow the wall width', () => {
    const f = fitFacade(10, 7, 2);
    expect(f.w).toBe(10);
    expect(f.h).toBeCloseTo(5);
    expect(f.centerY).toBeCloseTo(2.5);
  });
});
