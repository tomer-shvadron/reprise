import { assert, constantFrom, integer, property, record, string } from 'fast-check';
import { describe, expect, it } from 'vitest';

import { fingerShape } from './fingering';
import { nameChord } from './identify';
import { QUALITIES, parseChord } from './qualities';
import { voicings, voicingsForName, type VoicingTrack } from './voicings';

const STANDARD: VoicingTrack = { tuning: [40, 45, 50, 55, 59, 64], capo: 0, fretCount: 24 };
const DROP_D: VoicingTrack = { ...STANDARD, tuning: [38, 45, 50, 55, 59, 64] };
const SEVEN: VoicingTrack = { ...STANDARD, tuning: [35, 40, 45, 50, 55, 59, 64] };
const BASS: VoicingTrack = { ...STANDARD, tuning: [28, 33, 38, 43] };
const TUNINGS = [STANDARD, DROP_D, SEVEN, BASS];

/** A shape as players read it: lowest string first, `x` for muted. */
const shape = (frets: (number | null)[]): string =>
  [...frets]
    .reverse()
    .map((fret) => (fret === null ? 'x' : String(fret)))
    .join(frets.some((f) => (f ?? 0) > 9) ? '-' : '');

const shapes = (name: string, track: VoicingTrack, limit?: number): string[] =>
  voicingsForName(name, track, limit === undefined ? {} : { limit }).map((v) =>
    shape(v.diagram.frets),
  );

describe('voicings in standard tuning', () => {
  it.each([
    ['C', 'x32010'],
    ['G', '320003'],
    ['D', 'xx0232'],
    ['A', 'x02220'],
    ['E', '022100'],
    ['Am', 'x02210'],
    ['Em', '022000'],
    ['Dm', 'xx0231'],
  ])('puts the open shape of %s first', (name, expected) => {
    expect(shapes(name, STANDARD)[0]).toBe(expected);
  });

  it('plays F as a barre across all six strings', () => {
    const [best] = voicingsForName('F', STANDARD);
    expect(best && shape(best.diagram.frets)).toBe('133211');
    expect(best?.diagram.barres).toEqual([{ fret: 1, firstString: 1, lastString: 6 }]);
    expect(best?.diagram.baseFret).toBe(1);
  });

  it('plays Bm as a barre at the second fret', () => {
    const [best] = voicingsForName('Bm', STANDARD);
    expect(best && shape(best.diagram.frets)).toBe('x24432');
    expect(best?.diagram.barres?.[0]?.fret).toBe(2);
  });

  it('puts the slash bass lowest', () => {
    const [best] = voicingsForName('D/F#', STANDARD);
    expect(best && shape(best.diagram.frets)).toBe('200232');
    expect(best?.bass).toBe(6);
  });

  it('finds Cmaj7 with the open shape first', () => {
    expect(shapes('Cmaj7', STANDARD)[0]).toBe('x32000');
  });

  it('lists nothing for a name outside the table', () => {
    expect(voicingsForName('C(no3)', STANDARD)).toEqual([]);
    expect(voicingsForName('Riff', STANDARD)).toEqual([]);
  });

  it('moves the base fret up the neck for a high shape', () => {
    const high = voicingsForName('F', STANDARD).find((v) => v.position >= 5);
    expect(high?.diagram.baseFret).toBe(high?.position);
  });
});

describe('voicings in other tunings', () => {
  it('finds the drop D power chord and the full D', () => {
    expect(shapes('D5', DROP_D)).toContain('000xxx');
    expect(shapes('D', DROP_D)).toContain('000232');
  });

  it('names a capo shape by its sounding pitch: the C shape at capo 2 is D', () => {
    const capoed: VoicingTrack = { ...STANDARD, capo: 2 };
    expect(shapes('D', capoed)).toContain('x32010');
    expect(shapes('C', capoed)).not.toContain('x32010');
  });

  it('uses the seventh string', () => {
    const onSeven = voicingsForName('B', SEVEN).filter((v) => v.diagram.frets[6] !== null);
    expect(onSeven.length).toBeGreaterThan(0);
    expect(onSeven.every((v) => v.diagram.frets.length === 7)).toBe(true);
  });

  it('returns nothing for a track with no strings', () => {
    expect(voicingsForName('C', { ...STANDARD, tuning: [] })).toEqual([]);
  });
});

describe('fingerShape', () => {
  it('gives an open chord one finger per fretted note, by fret and bass string first', () => {
    expect(fingerShape([0, 1, 2, 2, 0, null])).toEqual({
      fingering: [null, 'index', 'ring', 'middle', null, null],
      barres: [],
    });
  });

  it('rejects a shape that needs a fifth finger and cannot be barred', () => {
    expect(fingerShape([1, 3, 5, 7, 9, 11])).toBeUndefined();
  });

  it('barres only where no string between is open or muted', () => {
    expect(fingerShape([1, 3, 3, 1, 0, 1])).toBeUndefined();
  });
});

describe('properties', () => {
  const sample = record({
    quality: constantFrom(...QUALITIES),
    root: integer({ min: 0, max: 11 }),
    track: constantFrom(...TUNINGS),
  });

  it('holds for every shape of any chord, tuning and capo', { timeout: 120_000 }, () => {
    assert(
      property(sample, integer({ min: 0, max: 5 }), ({ quality, root, track }, capo) => {
        const used = { ...track, capo };
        const list = voicings({ root, quality }, used);
        const tones = quality.intervals.map((i) => (root + i) % 12);
        const required = quality.intervals
          .filter((i) => !quality.optional.includes(i))
          .map((i) => (root + i) % 12);
        for (const { diagram } of list) {
          const { frets, barres = [], fingering } = diagram;
          expect(frets).toHaveLength(used.tuning.length);
          expect(fingering).toHaveLength(frets.length);
          const sounding = frets.flatMap((fret, index) => {
            if (fret === null) return [];
            const open = used.tuning[used.tuning.length - 1 - index] ?? 0;
            return [{ fret, pc: (open + capo + fret) % 12 }];
          });
          expect(sounding.length).toBeGreaterThanOrEqual(3);
          expect(sounding.every(({ pc }) => tones.includes(pc))).toBe(true);
          expect(required.every((pc) => sounding.some((s) => s.pc === pc))).toBe(true);
          const fretted = sounding.map((s) => s.fret).filter((fret) => fret > 0);
          if (fretted.length > 0) {
            expect(Math.max(...fretted) - Math.min(...fretted) + 1).toBeLessThanOrEqual(4);
          }
          for (const barre of barres) {
            for (let s = barre.firstString; s <= barre.lastString; s++) {
              expect(frets[s - 1] ?? 0).toBeGreaterThanOrEqual(barre.fret);
            }
            expect(fingering?.[barre.firstString - 1]).toBe('index');
          }
          expect(new Set(fingering?.filter((f) => f !== null)).size).toBeLessThanOrEqual(4);
        }
      }),
      { numRuns: 120 },
    );
  });

  it('names every shape back as the chord it was made for', { timeout: 120_000 }, () => {
    assert(
      property(sample, ({ quality, root, track }) => {
        for (const { diagram } of voicings({ root, quality }, track).slice(0, 12)) {
          const pitches = diagram.frets.flatMap((fret, index) =>
            fret === null ? [] : [(track.tuning[track.tuning.length - 1 - index] ?? 0) + fret],
          );
          const names = nameChord(pitches, { fifths: 0, minor: false });
          expect(names.some((n) => n.root === root && n.quality === quality.suffix)).toBe(true);
        }
      }),
      { numRuns: 120 },
    );
  });

  it('never throws on a chord name', () => {
    assert(property(string(), (text) => void parseChord(text)));
  });
});
