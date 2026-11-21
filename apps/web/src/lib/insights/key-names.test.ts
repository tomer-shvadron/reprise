import { describe, expect, it } from 'vitest';

import { keyName, keySignatureOf, scaleName } from './key-names';

describe('keySignatureOf', () => {
  it('gives every major key its signature, in -6..6', () => {
    const fifths = Array.from({ length: 12 }, (_, pc) => keySignatureOf(pc, 'major').fifths);
    expect(fifths).toEqual([0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]);
  });

  it('gives a minor key the signature of its relative major', () => {
    expect(keySignatureOf(9, 'minor')).toEqual({ fifths: 0, minor: true });
    expect(keySignatureOf(4, 'minor')).toEqual({ fifths: 1, minor: true });
    expect(keySignatureOf(0, 'minor')).toEqual({ fifths: -3, minor: true });
  });

  it('lets the file decide between F sharp and G flat', () => {
    expect(keySignatureOf(6, 'major', { fifths: -6, minor: false }).fifths).toBe(-6);
    expect(keySignatureOf(6, 'major', { fifths: 6, minor: false }).fifths).toBe(6);
    expect(keySignatureOf(6, 'major').fifths).toBe(6);
    expect(keySignatureOf(3, 'minor').fifths).toBe(-6);
  });
});

describe('names', () => {
  it('spells keys for their signature', () => {
    expect(keyName(1, 'minor')).toBe('C♯ minor');
    expect(keyName(1, 'major')).toBe('D♭ major');
    expect(keyName(3, 'minor')).toBe('E♭ minor');
    expect(keyName(7, 'none')).toBe('G');
  });

  it('spells a scale in the key that holds it', () => {
    expect(scaleName(4, 'dorian')).toBe('E Dorian');
    expect(scaleName(10, 'minorPentatonic')).toBe('B♭ minor pentatonic');
    expect(scaleName(1, 'mixolydian')).toBe('C♯ Mixolydian');
    expect(scaleName(1, 'mixolydian', { fifths: -6, minor: false })).toBe('D♭ Mixolydian');
  });
});
