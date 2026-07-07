import { describe, it, expect } from 'vitest';
import { skinToneFor, SKIN_LINEAR } from './skin.js';

describe('skinToneFor', () => {
  it('recolours a skin material', () => {
    expect(skinToneFor('Skin')).toEqual(SKIN_LINEAR);
  });

  it('recolours a face material', () => {
    expect(skinToneFor('Face')).toEqual(SKIN_LINEAR);
  });

  it('recolours a head material', () => {
    expect(skinToneFor('head')).toEqual(SKIN_LINEAR);
  });

  it('recolours a body material', () => {
    expect(skinToneFor('BODY')).toEqual(SKIN_LINEAR);
  });

  it('ignores surrounding whitespace and case', () => {
    expect(skinToneFor('  sKiN  ')).toEqual(SKIN_LINEAR);
  });

  it('leaves clothing and props untouched', () => {
    expect(skinToneFor('Shirt')).toBeNull();
    expect(skinToneFor('Hat')).toBeNull();
  });

  it('handles null, undefined and empty names', () => {
    expect(skinToneFor(null)).toBeNull();
    expect(skinToneFor(undefined)).toBeNull();
    expect(skinToneFor('')).toBeNull();
  });

  it('returns a fresh object each time', () => {
    const a = skinToneFor('Skin');
    const b = skinToneFor('Skin');
    expect(a).not.toBe(b);
  });
});
