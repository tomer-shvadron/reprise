import { describe, expect, it } from 'vitest';

import { GM_DRUM_KITS, GM_FAMILIES, GM_PROGRAMS, instrumentName } from './gm-programs';

describe('GM names', () => {
  it('has 128 programs in 16 families of eight', () => {
    expect(GM_PROGRAMS).toHaveLength(128);
    expect(new Set(GM_PROGRAMS).size).toBe(128);
    expect(GM_FAMILIES).toHaveLength(16);
    expect(GM_PROGRAMS[29]).toBe('Overdriven Guitar');
    expect(GM_PROGRAMS[127]).toBe('Gunshot');
  });

  it('names programs, kits and a kit outside the list', () => {
    expect(instrumentName({ kind: 'fretted', program: 30 })).toBe('Distortion Guitar');
    expect(instrumentName({ kind: 'drums', program: 0 })).toBe('Standard Kit');
    expect(instrumentName({ kind: 'drums', program: 5 })).toBe('Kit 5');
    expect(GM_DRUM_KITS.get(25)).toBe('TR-808 Kit');
  });

  it('names a ukulele on program 24, and a nylon guitar keeps its GM name', () => {
    expect(instrumentName({ kind: 'fretted', program: 24, tuning: [67, 60, 64, 69] })).toBe(
      'Ukulele',
    );
    expect(instrumentName({ kind: 'fretted', program: 24, tuning: [40, 45, 50, 55, 59, 64] })).toBe(
      'Acoustic Guitar (nylon)',
    );
    expect(instrumentName({ kind: 'fretted', program: 25, tuning: [67, 60, 64, 69] })).toBe(
      'Acoustic Guitar (steel)',
    );
  });

  it('names a 12-string and a mandolin, which GM has no program for', () => {
    const six = [40, 45, 50, 55, 59, 64];
    expect(
      instrumentName({
        kind: 'fretted',
        program: 25,
        tuning: six,
        courses: [12, 12, 12, 12, 0, 0],
      }),
    ).toBe('12-string Guitar');
    expect(
      instrumentName({
        kind: 'fretted',
        program: 25,
        tuning: [55, 62, 69, 76],
        courses: [0, 0, 0, 0],
      }),
    ).toBe('Mandolin');
    // A 12-string on another program keeps that program's name.
    expect(
      instrumentName({
        kind: 'fretted',
        program: 30,
        tuning: six,
        courses: [12, 12, 12, 12, 0, 0],
      }),
    ).toBe('Distortion Guitar');
    expect(instrumentName({ kind: 'fretted', program: 25, tuning: six })).toBe(
      'Acoustic Guitar (steel)',
    );
  });
});
