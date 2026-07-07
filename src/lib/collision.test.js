import { describe, it, expect } from 'vitest';
import { buildGrid, queryCircle, resolveCircleBox, collide } from './collision.js';

const box = (minX, maxX, minZ, maxZ) => ({ minX, maxX, minZ, maxZ });

describe('buildGrid + queryCircle', () => {
  const boxes = [box(0, 10, 0, 10), box(100, 110, 100, 110)];
  const grid = buildGrid(boxes, 20);

  it('finds the box near a point', () => {
    const ids = queryCircle(grid, 5, 5, 1);
    expect(ids).toContain(0);
    expect(ids).not.toContain(1);
  });

  it('returns nothing in empty space', () => {
    const ids = queryCircle(grid, 500, 500, 1);
    expect(ids).toHaveLength(0);
  });

  it('registers a box that spans several cells', () => {
    const big = buildGrid([box(0, 60, 0, 5)], 20);
    expect(queryCircle(big, 55, 2, 1)).toContain(0);
    expect(queryCircle(big, 5, 2, 1)).toContain(0);
  });
});

describe('resolveCircleBox', () => {
  const b = box(-5, 5, -5, 5);

  it('leaves a circle that does not touch the box', () => {
    expect(resolveCircleBox(20, 0, 1, b)).toEqual([20, 0]);
  });

  it('pushes a circle out along +X when overlapping an edge', () => {
    const [x, z] = resolveCircleBox(5.5, 0, 1, b);
    expect(x).toBeCloseTo(6, 6); // maxX + r
    expect(z).toBeCloseTo(0, 6);
  });

  it('pops a circle whose centre is inside out of the nearest face', () => {
    const [x, z] = resolveCircleBox(4, 0, 0.5, b); // nearest face is +X
    expect(x).toBeCloseTo(5.5, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('pops out of the -X, -Z and +Z faces too', () => {
    expect(resolveCircleBox(-4, 0, 0.5, b)[0]).toBeCloseTo(-5.5, 6);
    expect(resolveCircleBox(0, -4, 0.5, b)[1]).toBeCloseTo(-5.5, 6);
    expect(resolveCircleBox(0, 4, 0.5, b)[1]).toBeCloseTo(5.5, 6);
  });
});

describe('collide', () => {
  it('keeps the player out of a building', () => {
    const boxes = [box(-5, 5, -5, 5)];
    const grid = buildGrid(boxes, 20);
    const [x, z] = collide(grid, boxes, 5.2, 0, 1);
    expect(Math.abs(x) >= 5.999).toBe(true);
    expect(z).toBeCloseTo(0, 6);
  });

  it('leaves a free position untouched', () => {
    const boxes = [box(-5, 5, -5, 5)];
    const grid = buildGrid(boxes, 20);
    expect(collide(grid, boxes, 50, 50, 1)).toEqual([50, 50]);
  });
});
