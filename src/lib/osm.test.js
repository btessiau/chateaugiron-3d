import { describe, it, expect } from 'vitest';
import { parseMeters, buildingHeight, baseHeight, classify, trimTags } from './osm.js';

describe('parseMeters', () => {
  it('returns null for nullish input', () => {
    expect(parseMeters(null)).toBeNull();
    expect(parseMeters(undefined)).toBeNull();
  });
  it('parses a number embedded in a string', () => {
    expect(parseMeters('12 m')).toBe(12);
    expect(parseMeters('-3.5')).toBe(-3.5);
  });
  it('coerces non-string values', () => {
    expect(parseMeters(42)).toBe(42);
  });
  it('returns null when no number is present', () => {
    expect(parseMeters('abc')).toBeNull();
  });
});

describe('buildingHeight', () => {
  it('uses an explicit height', () => {
    expect(buildingHeight({ height: '12' })).toBe(12);
  });
  it('derives height from levels', () => {
    expect(buildingHeight({ 'building:levels': '3' })).toBeCloseTo(9.9, 6);
  });
  it('falls back to a default when levels are not a number', () => {
    expect(buildingHeight({ 'building:levels': 'abc' })).toBe(7.5);
  });
  it('falls back to a default when nothing is given', () => {
    expect(buildingHeight({})).toBe(7.5);
  });
  it('enforces a minimum height', () => {
    expect(buildingHeight({ height: '1' })).toBe(2.5);
  });
});

describe('baseHeight', () => {
  it('reads min_height', () => {
    expect(baseHeight({ min_height: '3' })).toBe(3);
  });
  it('defaults to zero', () => {
    expect(baseHeight({})).toBe(0);
  });
});

describe('classify', () => {
  it('classifies buildings', () => {
    expect(classify({ building: 'yes' })).toBe('building');
    expect(classify({ 'building:part': 'yes' })).toBe('building');
  });
  it('ignores building=no and building:part=no', () => {
    expect(classify({ building: 'no' })).toBeNull();
    expect(classify({ 'building:part': 'no' })).toBeNull();
  });
  it('classifies roads', () => {
    expect(classify({ highway: 'residential' })).toBe('road');
  });
  it('classifies water in all forms', () => {
    expect(classify({ natural: 'water' })).toBe('water');
    expect(classify({ water: 'pond' })).toBe('water');
    expect(classify({ waterway: 'riverbank' })).toBe('water');
  });
  it('classifies green in all forms', () => {
    expect(classify({ natural: 'wood' })).toBe('green');
    expect(classify({ landuse: 'grass' })).toBe('green');
    expect(classify({ leisure: 'park' })).toBe('green');
  });
  it('returns null for everything else', () => {
    expect(classify({})).toBeNull();
    expect(classify({ amenity: 'school' })).toBeNull();
  });
});

describe('trimTags', () => {
  it('keeps known non-null keys and drops the rest', () => {
    const out = trimTags({ building: 'yes', foo: 'bar', height: null, name: 'Mairie' });
    expect(out).toEqual({ building: 'yes', name: 'Mairie' });
  });
});
