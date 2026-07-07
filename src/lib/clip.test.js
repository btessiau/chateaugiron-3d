import { describe, it, expect } from 'vitest';
import { resolveClip } from './clip.js';

describe('resolveClip', () => {
  it('returns an exact alias when present', () => {
    expect(resolveClip(['Idle', 'Walk'], ['Walk', 'Walking'])).toBe('Walk');
  });

  it('tries later aliases when the first is absent', () => {
    expect(resolveClip(['Idle', 'Walking'], ['Walk', 'Walking'])).toBe('Walking');
  });

  it('matches a clip whose base name follows a pipe prefix', () => {
    expect(resolveClip(['CharacterArmature|Run'], ['Run', 'Running'])).toBe(
      'CharacterArmature|Run',
    );
  });

  it('matches after a colon prefix and ignores case', () => {
    expect(resolveClip(['mixamo:WALKING'], ['Walking'])).toBe('mixamo:WALKING');
  });

  it('matches a bare name that differs only by case', () => {
    expect(resolveClip(['idle'], ['Idle'])).toBe('idle');
  });

  it('returns null when nothing matches', () => {
    expect(resolveClip(['Dance'], ['Idle'])).toBeNull();
  });
});
