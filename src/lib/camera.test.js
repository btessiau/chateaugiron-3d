import { describe, it, expect } from 'vitest';
import { clampPitch, moveVector, orbitOffset } from './camera.js';

describe('clampPitch', () => {
  it('clamps to the default range', () => {
    expect(clampPitch(5)).toBeCloseTo(1.35, 6);
    expect(clampPitch(-5)).toBeCloseTo(-1.35, 6);
    expect(clampPitch(0.5)).toBeCloseTo(0.5, 6);
  });

  it('honours custom bounds', () => {
    expect(clampPitch(2, -1, 1)).toBe(1);
    expect(clampPitch(-2, -1, 1)).toBe(-1);
  });
});

describe('moveVector', () => {
  it('returns no motion with no keys', () => {
    const m = moveVector({}, 0, 5, 1);
    expect(m.moving).toBe(false);
    expect(m.dx).toBe(0);
    expect(m.dz).toBe(0);
  });

  it('moves along -Z when facing forward at yaw 0', () => {
    const m = moveVector({ forward: true }, 0, 5, 1);
    expect(m.dx).toBeCloseTo(0, 6);
    expect(m.dz).toBeCloseTo(-5, 6);
    expect(m.moving).toBe(true);
    // Avatar heading 0 faces -Z.
    expect(m.heading).toBeCloseTo(0, 6);
  });

  it('strafes right along +X at yaw 0', () => {
    const m = moveVector({ right: true }, 0, 5, 1);
    expect(m.dx).toBeCloseTo(5, 6);
    expect(m.dz).toBeCloseTo(0, 6);
    expect(m.heading).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('moves backward (+Z) and left (-X) at yaw 0', () => {
    const back = moveVector({ back: true }, 0, 5, 1);
    expect(back.dz).toBeCloseTo(5, 6);
    const left = moveVector({ left: true }, 0, 5, 1);
    expect(left.dx).toBeCloseTo(-5, 6);
  });

  it('normalises diagonal motion to the given speed', () => {
    const m = moveVector({ forward: true, right: true }, 0, 10, 1);
    expect(Math.hypot(m.dx, m.dz)).toBeCloseTo(10, 6);
  });

  it('rotates the forward direction with yaw', () => {
    const m = moveVector({ forward: true }, Math.PI / 2, 5, 1);
    // Facing yaw 90 deg means forward points along -X.
    expect(m.dx).toBeCloseTo(-5, 6);
    expect(m.dz).toBeCloseTo(0, 6);
  });
});

describe('orbitOffset', () => {
  it('sits directly behind (+Z) at yaw 0, pitch 0', () => {
    const o = orbitOffset(0, 0, 6);
    expect(o.x).toBeCloseTo(0, 6);
    expect(o.y).toBeCloseTo(0, 6);
    expect(o.z).toBeCloseTo(6, 6);
  });

  it('swings to +X at yaw 90 deg', () => {
    const o = orbitOffset(Math.PI / 2, 0, 6);
    expect(o.x).toBeCloseTo(6, 6);
    expect(o.z).toBeCloseTo(0, 6);
  });

  it('rises above the target when pitched down', () => {
    const o = orbitOffset(0, -0.5, 6);
    expect(o.y).toBeGreaterThan(0);
  });
});
