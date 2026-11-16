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
});
