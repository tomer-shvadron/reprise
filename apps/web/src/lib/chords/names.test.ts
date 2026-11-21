import { describe, expect, it } from 'vitest';

import { parseChordName } from './names';
import { QUALITIES, parseChord, qualityOf } from './qualities';

describe('parseChordName', () => {
  it('splits root, quality and slash bass', () => {
    expect(parseChordName('F#m7/C#')).toEqual({
      root: 6,
      rootText: 'F#',
      quality: 'm7',
      bass: 1,
      bassText: 'C#',
    });
    expect(parseChordName('B♭')).toMatchObject({ root: 10, rootText: 'B♭', quality: '' });
  });

  it('rejects words and never throws', () => {
    expect(parseChordName('Riff')).toBeUndefined();
    expect(parseChordName('N.C.')).toBeUndefined();
    expect(parseChordName('')).toBeUndefined();
  });
});

describe('qualityOf', () => {
  it('reads the usual aliases', () => {
    expect(qualityOf('')?.suffix).toBe('');
    expect(qualityOf('M')?.suffix).toBe('');
    expect(qualityOf('m')?.suffix).toBe('m');
    expect(qualityOf('M7')?.suffix).toBe('maj7');
    expect(qualityOf('m7')?.suffix).toBe('m7');
    expect(qualityOf('Maj7')?.suffix).toBe('maj7');
    expect(qualityOf('Δ')?.suffix).toBe('maj7');
    expect(qualityOf('ø')?.suffix).toBe('m7b5');
    expect(qualityOf('m(add9)')?.suffix).toBe('m(add9)');
    expect(qualityOf('7♭9')?.suffix).toBe('7b9');
  });

  it('returns undefined for a quality the table lacks', () => {
    expect(qualityOf('alt')).toBeUndefined();
    expect(parseChord('Calt')).toBeUndefined();
    expect(parseChord('Am7/G')).toMatchObject({ root: 9, bass: 7 });
  });
});

describe('the table of qualities', () => {
  it.each(
    QUALITIES.flatMap((quality) =>
      [quality.suffix, ...quality.aliases].map((s) => [quality, s] as const),
    ),
  )('reaches %# through a chord name', (quality, suffix) => {
    expect(parseChord(`C${suffix}`)?.quality).toBe(quality);
  });
});
