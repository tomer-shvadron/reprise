import type { ChordDiagram, KeySignature } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { shiftDiagram, transposeChordName, transposeKey } from './chord-names';

const key = (fifths: number, minor = false): KeySignature => ({ fifths, minor });

describe('transposeChordName', () => {
  it('spells the new root for the key in force', () => {
    expect(transposeChordName('C', 1, key(0))).toBe('C#');
    expect(transposeChordName('C', 1, key(-1))).toBe('Db');
    expect(transposeChordName('G', 2, key(2))).toBe('A');
  });

  it('moves the slash bass too and keeps the quality as typed', () => {
    expect(transposeChordName('Am7/G', 1, key(-1))).toBe('Bbm7/Ab');
    expect(transposeChordName('F#m7b5', -1, key(0))).toBe('Fm7b5');
    expect(transposeChordName('Csus4', 2, key(0))).toBe('Dsus4');
  });

  it('reads sharps and flats, ASCII or typographic, and writes them back the same way', () => {
    expect(transposeChordName('B♭', 2, key(0))).toBe('C');
    expect(transposeChordName('C♯m', 1, key(3, true))).toBe('Dm');
    expect(transposeChordName('Cm', 1, key(-3))).toBe('Dbm');
    expect(transposeChordName('C♯', 1, key(0))).toBe('D');
    expect(transposeChordName('E♭', 1, key(1))).toBe('E');
  });

  it('reads the quality in any case and the short spellings guitar files use', () => {
    expect(transposeChordName('CMaj7', 2, key(0))).toBe('DMaj7');
    expect(transposeChordName('Cma7', 2, key(0))).toBe('Dma7');
    expect(transposeChordName('Cmi7', 2, key(0))).toBe('Dmi7');
    expect(transposeChordName('CMA7', 2, key(0))).toBe('DMA7');
    expect(transposeChordName('CM7', 2, key(0))).toBe('DM7');
    expect(transposeChordName('Cmadd9', 2, key(0))).toBe('Dmadd9');
    expect(transposeChordName('Cmadd11', 2, key(0))).toBe('Dmadd11');
    expect(transposeChordName('Cmaug', 2, key(0))).toBe('Dmaug');
    expect(transposeChordName('Cmalt', 2, key(0))).toBe('Dmalt');
    expect(transposeChordName('Csus4', 2, key(0))).toBe('Dsus4');
  });

  it('never writes a double accidental, even in a sharp minor key', () => {
    expect(transposeChordName('G#dim', -1, key(5, true))).toBe('Gdim');
    expect(transposeChordName('D#', 1, key(5, true))).toBe('E');
  });

  it('leaves what is not a chord alone and reports it as unread', () => {
    expect(transposeChordName('N.C.', 2, key(0))).toBeUndefined();
    expect(transposeChordName('Riff', 2, key(0))).toBeUndefined();
    expect(transposeChordName('Break', 2, key(0))).toBeUndefined();
    expect(transposeChordName('', 2, key(0))).toBeUndefined();
  });

  it('leaves a move by whole octaves as written', () => {
    expect(transposeChordName('C#m7', 12, key(0))).toBe('C#m7');
    expect(transposeChordName('Eb', -24, key(0))).toBe('Eb');
  });
});

describe('shiftDiagram', () => {
  const barre: ChordDiagram = {
    baseFret: 1,
    frets: [1, 3, 3, 2, 1, 1],
    barres: [{ fret: 1, firstString: 1, lastString: 6 }],
    fingering: [null, null, null, null, null, null],
  };

  it('moves a movable shape, its barres and its grid', () => {
    expect(shiftDiagram(barre, 2, 24)).toEqual({
      baseFret: 3,
      frets: [3, 5, 5, 4, 3, 3],
      barres: [{ fret: 3, firstString: 1, lastString: 6 }],
      fingering: [null, null, null, null, null, null],
    });
  });

  it('moves a shape whose grid starts below its lowest fret', () => {
    const grid: ChordDiagram = { baseFret: 1, frets: [3, 5, 5, 4, 3, 3] };
    expect(shiftDiagram(grid, -2, 24)).toEqual({ baseFret: 1, frets: [1, 3, 3, 2, 1, 1] });
    expect(shiftDiagram(grid, -3, 24)).toBeUndefined();
  });

  it('refuses an open shape and one that would leave the neck', () => {
    expect(shiftDiagram({ baseFret: 1, frets: [0, 1, 0, 2, 3, null] }, 2, 24)).toBeUndefined();
    expect(shiftDiagram(barre, -1, 24)).toBeUndefined();
    expect(shiftDiagram(barre, 22, 24)).toBeUndefined();
    expect(shiftDiagram(barre, 21, 24)).toBeDefined();
  });
});

describe('transposeKey', () => {
  it('takes the spelling with the fewest accidentals', () => {
    expect(transposeKey(key(0), 1)).toEqual(key(-5));
    expect(transposeKey(key(0), 2)).toEqual(key(2));
    expect(transposeKey(key(2), -2)).toEqual(key(0));
    expect(transposeKey(key(0, true), 3)).toEqual(key(-3, true));
  });

  it('keeps the side of the tritone the key was on', () => {
    expect(transposeKey(key(-1), 1)).toEqual(key(-6));
    expect(transposeKey(key(0), 6)).toEqual(key(6));
    expect(transposeKey(key(1), -1)).toEqual(key(6));
    expect(transposeKey(key(0, true), 6)).toEqual(key(-6, true));
    expect(transposeKey(key(-1, true), 1)).toEqual(key(-6, true));
  });

  it.each([false, true])(
    'lands on the right pitch class for every key and amount (minor %s), keeps the mode and the side of the tritone',
    (minor) => {
      for (let fifths = -7; fifths <= 7; fifths++) {
        for (let semitones = -11; semitones <= 11; semitones++) {
          if (semitones === 0) continue;
          const next = transposeKey(key(fifths, minor), semitones);
          expect(next.minor).toBe(minor);
          expect(Math.abs(next.fifths)).toBeLessThanOrEqual(7);
          expect((((next.fifths - fifths - 7 * semitones) % 12) + 12) % 12).toBe(0);
          // No other spelling of that key has fewer accidentals.
          const other = next.fifths > 0 ? next.fifths - 12 : next.fifths + 12;
          if (Math.abs(other) <= 7) {
            expect(Math.abs(next.fifths)).toBeLessThanOrEqual(Math.abs(other));
          }
          // At the tritone the key stays on the side it was on; C and A minor count as flat.
          if (Math.abs(next.fifths) === 6) {
            const flat = fifths < 0 || (fifths === 0 && minor);
            expect(next.fifths < 0).toBe(flat);
          }
        }
      }
    },
  );

  it('keeps the key as written for whole octaves', () => {
    expect(transposeKey(key(7), 12)).toEqual(key(7));
  });
});
