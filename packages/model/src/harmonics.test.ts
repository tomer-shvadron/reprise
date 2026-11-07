import { describe, expect, it } from 'vitest';

import { createNote, createTrack } from './factories';
import { harmonicInterval, soundingPitch } from './harmonics';
import type { Harmonic, HarmonicKind } from './note';

describe('harmonicInterval', () => {
  it.each([
    [12, 12],
    [7, 19.02],
    [19, 19.02],
    [5, 24],
    [24, 24],
    [4, 27.86],
    [9, 27.86],
    [16, 27.86],
    [3, 31.02],
    [3.2, 31.02],
    [2.7, 33.69],
    [5.8, 33.69],
    [9.6, 33.69],
    [14.7, 33.69],
    [21.7, 33.69],
    [2.4, 36],
    [8.2, 36],
    [17, 36],
  ])('maps fret %d to %d semitones', (fret, interval) => {
    expect(harmonicInterval(fret)).toBeCloseTo(interval, 2);
  });

  it.each([11, 13, 18, 20])('finds no node at fret %d', (fret) => {
    expect(harmonicInterval(fret)).toBeUndefined();
  });
});

interface Row {
  name: string;
  string: number;
  fret: number;
  harmonic?: Harmonic;
  capo?: number;
  pitch: number;
  /** alphaTab 1.8.4's `realValue`, absent where we diverge on purpose. */
  alphaTab?: number;
}

const harmonicOf = (kind: HarmonicKind, value: number | undefined): Harmonic =>
  value === undefined ? { kind } : { kind, value };

const natural = (fret: number, pitch: number, alphaTab: number, value?: number): Row => ({
  name: `natural, fret ${String(fret)}, value ${String(value ?? 'absent')}`,
  string: 1,
  fret,
  harmonic: harmonicOf('natural', value),
  pitch,
  alphaTab,
});

const offset = (
  kind: HarmonicKind,
  value: number | undefined,
  pitch: number,
  alphaTab?: number,
): Row => ({
  name: `${kind}, value ${String(value ?? 'absent')}`,
  string: 1,
  fret: 5,
  harmonic: harmonicOf(kind, value),
  pitch,
  ...(alphaTab === undefined ? {} : { alphaTab }),
});

const rows: Row[] = [
  { name: 'no harmonic', string: 1, fret: 5, pitch: 69, alphaTab: 69 },
  natural(12, 76, 76),
  natural(7, 83.02, 83),
  natural(19, 83.02, 83),
  natural(5, 88, 88),
  natural(24, 88, 88),
  natural(4, 91.86, 92),
  natural(9, 91.86, 92),
  natural(16, 91.86, 92),
  natural(3, 95.02, 95, 3.2),
  natural(3, 97.69, 98, 2.7),
  natural(6, 97.69, 98, 5.8),
  natural(10, 97.69, 98, 9.6),
  natural(15, 97.69, 98, 14.7),
  natural(2, 100, 100, 2.4),
  natural(8, 100, 100, 8.2),
  natural(17, 100, 100, 17),
  // alphaTab maps 21.7 to the 8th partial (36); the node is 5/7 of the string, the 7th.
  {
    name: 'natural, fret 22, value 21.7',
    string: 1,
    fret: 22,
    harmonic: { kind: 'natural', value: 21.7 },
    pitch: 97.69,
  },
  // alphaTab adds 0 to the open string off the nodes; we sound the fretted note.
  { name: 'natural, fret 11', string: 1, fret: 11, harmonic: { kind: 'natural' }, pitch: 75 },
  {
    name: 'natural, capo 2, fret 12',
    string: 1,
    fret: 12,
    harmonic: { kind: 'natural' },
    capo: 2,
    pitch: 78,
    alphaTab: 78,
  },
  {
    name: 'natural, capo 2, fret 7',
    string: 1,
    fret: 7,
    harmonic: { kind: 'natural' },
    capo: 2,
    pitch: 85.02,
    alphaTab: 85,
  },
  {
    name: 'natural, string 6, value 2.7',
    string: 6,
    fret: 3,
    harmonic: { kind: 'natural', value: 2.7 },
    pitch: 73.69,
    alphaTab: 74,
  },
  offset('artificial', 12, 81, 81),
  offset('artificial', 7, 88.02, 88),
  offset('artificial', 19, 88.02, 88),
  offset('artificial', 5, 93, 93),
  offset('artificial', 24, 93, 93),
  offset('artificial', 4, 96.86, 97),
  offset('artificial', 3.2, 100.02, 100),
  offset('artificial', 2.7, 102.69, 103),
  offset('artificial', 2.4, 105, 105),
  // alphaTab reads a missing value as 0 and an off-node one as no interval; we fall back to 12.
  offset('artificial', undefined, 81),
  offset('artificial', 11, 81),
  {
    name: 'artificial, capo 2, value 12',
    string: 1,
    fret: 5,
    harmonic: { kind: 'artificial', value: 12 },
    capo: 2,
    pitch: 83,
    alphaTab: 83,
  },
  offset('pinch', 12, 81, 81),
  offset('semi', 12, 81, 81),
  offset('tapped', 12, 81, 81),
  offset('tapped', 7, 88.02, 88),
  offset('feedback', 12, 81, 81),
  // alphaTab reads a missing value as 0; we fall back to 12.
  offset('feedback', undefined, 81),
];

describe('soundingPitch', () => {
  it.each(rows)(
    '$name sounds at $pitch',
    ({ string, fret, harmonic, capo = 0, pitch, alphaTab }) => {
      const track = createTrack('fretted', { capo });
      const result = soundingPitch(
        track,
        createNote(harmonic ? { string, fret, harmonic } : { string, fret }),
      );

      expect(result).toBeCloseTo(pitch, 2);
      if (alphaTab !== undefined) expect(Math.round(result)).toBe(alphaTab);
    },
  );

  it('returns the stored MIDI note on pitched and drum tracks, whatever the harmonic', () => {
    for (const kind of ['natural', 'artificial'] as const) {
      const harmonic = { kind, value: 12 };
      expect(
        soundingPitch(createTrack('pitched'), createNote({ string: 0, fret: 60, harmonic })),
      ).toBe(60);
      expect(
        soundingPitch(createTrack('drums'), createNote({ string: 0, fret: 38, harmonic })),
      ).toBe(38);
    }
  });

  it("lets a natural harmonic's value win over its fret", () => {
    const track = createTrack('fretted');
    const harmonic = { kind: 'natural' as const, value: 2.7 };
    expect(soundingPitch(track, createNote({ string: 1, fret: 3 }))).toBe(67);
    expect(
      soundingPitch(track, createNote({ string: 1, fret: 3, harmonic: { kind: 'natural' } })),
    ).toBeCloseTo(95.02, 2);
    expect(soundingPitch(track, createNote({ string: 1, fret: 3, harmonic }))).toBeCloseTo(
      97.69,
      2,
    );
  });

  it('throws on a string the track does not have', () => {
    const harmonic = { kind: 'natural' as const };
    expect(() =>
      soundingPitch(createTrack('fretted'), createNote({ string: 7, fret: 12, harmonic })),
    ).toThrow(RangeError);
  });
});
