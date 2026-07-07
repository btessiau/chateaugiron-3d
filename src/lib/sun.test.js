import { describe, it, expect } from 'vitest';
import { sunDirection, sunPosition, daylight } from './sun.js';

describe('sunDirection', () => {
  it('points straight up at 90 deg elevation', () => {
    const d = sunDirection(90, 0);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.y).toBeCloseTo(1, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it('points east at the horizon with azimuth 90', () => {
    const d = sunDirection(0, 90);
    expect(d.x).toBeCloseTo(1, 6);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it('points north at the horizon with azimuth 0', () => {
    const d = sunDirection(0, 0);
    expect(d.z).toBeCloseTo(1, 6);
  });

  it('returns a unit vector', () => {
    const d = sunDirection(35, 210);
    const len = Math.hypot(d.x, d.y, d.z);
    expect(len).toBeCloseTo(1, 6);
  });
});

describe('sunPosition', () => {
  it('scales the direction by distance', () => {
    const p = sunPosition(90, 0, 500);
    expect(p.y).toBeCloseTo(500, 4);
    expect(p.x).toBeCloseTo(0, 4);
  });
});

describe('daylight', () => {
  it('is 0 at or below the horizon', () => {
    expect(daylight(0)).toBe(0);
    expect(daylight(-10)).toBe(0);
  });

  it('is 1 high in the sky', () => {
    expect(daylight(60)).toBe(1);
    expect(daylight(75)).toBe(1);
  });

  it('ramps linearly in between', () => {
    expect(daylight(30)).toBeCloseTo(0.5, 6);
  });
});
