import { describe, it, expect } from 'vitest';
import { worldToMinimap, compassFromYaw, headingArrowAngle } from './minimap.js';

describe('worldToMinimap', () => {
  it('puts the player at the centre', () => {
    expect(worldToMinimap(5, -3, 5, -3, 2, 180)).toEqual({ u: 90, v: 90 });
  });
  it('maps east to the right and north up', () => {
    const east = worldToMinimap(20, 0, 0, 0, 2, 180);
    expect(east.u).toBe(90 + 10);
    expect(east.v).toBe(90);
    const north = worldToMinimap(0, 20, 0, 0, 2, 180);
    expect(north.v).toBe(90 - 10);
    expect(north.u).toBe(90);
  });
});

describe('compassFromYaw', () => {
  it('reads south when facing the default -Z direction', () => {
    const c = compassFromYaw(0);
    expect(c.deg).toBeCloseTo(180, 6);
    expect(c.cardinal).toBe('S');
  });
  it('reads north, east, and west as the player turns', () => {
    expect(compassFromYaw(Math.PI).cardinal).toBe('N');
    expect(compassFromYaw(-Math.PI / 2).cardinal).toBe('E');
    expect(compassFromYaw(Math.PI / 2).cardinal).toBe('W');
  });
});

describe('headingArrowAngle', () => {
  it('points up (screen -y) when facing north', () => {
    const a = headingArrowAngle(Math.PI);
    expect(Math.cos(a)).toBeCloseTo(0, 6);
    expect(Math.sin(a)).toBeCloseTo(-1, 6);
  });
  it('points right (east) when facing east', () => {
    const a = headingArrowAngle(-Math.PI / 2);
    expect(Math.cos(a)).toBeCloseTo(1, 6);
    expect(Math.sin(a)).toBeCloseTo(0, 6);
  });
});
