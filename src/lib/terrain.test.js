import { describe, it, expect } from 'vitest';
import { makeHeightField } from './terrain.js';

// 2x2 grid over 2 m, centred at origin: corners at (-1,-1)..(1,1).
// z is row-major with row 0 at -z: [ SW, SE, NW, NE ].
const data = {
  meta: { n: 2, size_m: 2, min_m: 0, max_m: 30 },
  z: [0, 10, 20, 30],
};

describe('makeHeightField', () => {
  const hf = makeHeightField(data);

  it('exposes grid metadata', () => {
    expect(hf.n).toBe(2);
    expect(hf.size).toBe(2);
    expect(hf.half).toBe(1);
    expect(hf.spacing).toBe(2);
    expect(hf.min).toBe(0);
    expect(hf.max).toBe(30);
  });

  it('returns exact corner heights', () => {
    expect(hf.sample(-1, -1)).toBe(0);
    expect(hf.sample(1, 1)).toBe(30);
  });

  it('bilinearly interpolates the centre', () => {
    expect(hf.sample(0, 0)).toBe(15);
  });

  it('clamps below the grid', () => {
    expect(hf.sample(-5, -5)).toBe(0);
  });

  it('clamps above the grid', () => {
    expect(hf.sample(5, 5)).toBe(30);
  });
});
