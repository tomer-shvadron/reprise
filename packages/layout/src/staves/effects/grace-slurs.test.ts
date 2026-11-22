import {
  applyCommand,
  createNote,
  removeNote,
  setBeatEffect,
  setNote,
  type Command,
  type Score,
} from '@reprise/model';
import { beatOf, note, noteOf, type ScoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  LayoutCache,
  layout,
  type LayoutOptions,
  type LayoutResult,
  type Primitive,
} from '../../index';
import { stable, strayPrimitives } from '../../test/check-result';
import { describePrimitive } from '../../test/describe';
import { guitar, laid, paged, texts } from '../../test/effects';

type Notation = 'tab' | 'standard' | 'both';

const arcsOf = (result: LayoutResult, node: string): Primitive[] =>
  result.primitives.filter(
    (p) => p.kind === 'path' && p.fill && p.d.includes('C') && p.node === node,
  );

const letters = (result: LayoutResult): string[] => texts(result).filter((t) => /^[HP]$/.test(t));

/**
 * Warms a cache on `built`, then applies each command in turn and checks the cached layout, told
 * only the touched bars, against a cold one, paged and continuous.
 */
function expectCachedAsCold(built: Score, commands: (score: Score) => Command[]): void {
  for (const mode of ['paged', 'continuous'] as const) {
    const options: LayoutOptions = { ...paged, mode, width: 320 };
    const cache = new LayoutCache();
    layout(built, options, cache);
    let current = built;
    const steps = commands(current);
    for (const [i, command] of steps.entries()) {
      const step = applyCommand(current, command);
      current = step.score;
      const cached = layout(current, { ...options, dirtyBars: step.change.touchedBars }, cache);
      expect(stable(cached), `${mode} step ${String(i)}`).toBe(stable(layout(current, options)));
    }
  }
}

/** Twelve bars of a string-2 note, the last bar's first beat optionally holding a grace note. */
function chain(notation: Notation): Score {
  const builder = guitar(notation);
  for (let bar = 0; bar < 12; bar++) {
    builder
      .bar()
      .beat('2', [note(2, 5)])
      .beat('2', [note(2, 5)]);
  }
  return builder
    .bar()
    .beat('4', [note(2, 7)])
    .build({ ids: 'sequential' });
}

const graceOn = (hammerPull: boolean) => [
  { duration: 32 as const, before: true, notes: [createNote({ string: 2, fret: 9, hammerPull })] },
];

/** Two grace notes on string 2, the second hammered, then a main note. */
function twoGraces(notation: Notation, first: number, second: number): ScoreBuilder {
  return guitar(notation)
    .bar()
    .beat('4', [note(2, 7)], {
      grace: [
        { duration: 32, before: true, notes: [note(2, first)] },
        { duration: 32, before: true, notes: [note(2, second, { hammerPull: true })] },
      ],
    })
    .beat('2.', [note(2, 7)]);
}

function graceTarget(built: Score): string {
  const grace = built.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.grace?.[1]?.notes[0];
  if (!grace) throw new Error('no grace note');
  return grace.id;
}

describe('hammer-ons and pull-offs between grace notes (#160)', () => {
  it.each<Notation>(['tab', 'standard', 'both'])(
    'draws one arc for a hammered second grace note in %s',
    (notation) => {
      const built = twoGraces(notation, 5, 7).build({ ids: 'sequential' });
      const result = laid(built);
      expect(strayPrimitives(result, built).map(describePrimitive)).toEqual([]);
      // Both mode shows the slur on the standard staff and the arc on the tab: one each.
      expect(arcsOf(result, graceTarget(built))).toHaveLength(notation === 'both' ? 2 : 1);
      expect(letters(result)).toEqual(['H']);
    },
  );

  it.each<Notation>(['tab', 'standard'])('letters a pull-off P in %s', (notation) => {
    const built = twoGraces(notation, 7, 5).build({ ids: 'sequential' });
    const result = laid(built);
    expect(arcsOf(result, graceTarget(built))).toHaveLength(1);
    expect(letters(result)).toEqual(['P']);
  });

  it.each<Notation>(['tab', 'standard', 'both'])(
    'draws nothing when the second grace note is not hammered, in %s',
    (notation) => {
      const built = guitar(notation)
        .bar()
        .beat('4', [note(2, 7)], {
          grace: [
            { duration: 32, before: true, notes: [note(2, 5)] },
            { duration: 32, before: true, notes: [note(2, 7)] },
          ],
        })
        .beat('2.', [note(2, 7)])
        .build({ ids: 'sequential' });
      const result = laid(built);
      expect(arcsOf(result, graceTarget(built))).toHaveLength(0);
      expect(letters(result)).toEqual([]);
    },
  );

  it.each<Notation>(['tab', 'standard', 'both'])(
    'links a main note to the grace column just before it, in %s',
    (notation) => {
      const built = guitar(notation)
        .bar()
        .beat('4', [note(2, 7, { hammerPull: true })], {
          grace: [
            { duration: 32, before: true, notes: [note(4, 5)] },
            { duration: 32, before: true, notes: [note(2, 5)] },
          ],
        })
        .beat('2.', [note(2, 7)])
        .build({ ids: 'sequential' });
      const result = laid(built);
      expect(arcsOf(result, noteOf(built, 0, 0, 0).id).length).toBeGreaterThan(0);
      expect(letters(result)).toEqual(['H']);
    },
  );

  // A link never reaches over a column between: its slur or letter would be drawn through it.
  it.each<[string, number, number, number, number, number, number]>([
    ['same pitch on the next string', 2, 5, 3, 9, 2, 7],
    ['a head a third below', 2, 5, 3, 7, 2, 7],
    ['an outer lower string', 4, 5, 5, 7, 4, 7],
  ])('draws nothing over an intervening grace column, %s', (_name, s1, f1, s2, f2, s3, f3) => {
    for (const notation of ['tab', 'standard', 'both'] as const) {
      const built = guitar(notation)
        .bar()
        .beat('4', [note(s3, f3, { hammerPull: true })], {
          grace: [
            { duration: 32, before: true, notes: [note(s1, f1)] },
            { duration: 32, before: true, notes: [note(s2, f2)] },
          ],
        })
        .beat('2.', [note(s3, f3)])
        .build({ ids: 'sequential' });
      const result = laid(built);
      expect(arcsOf(result, noteOf(built, 0, 0, 0).id)).toHaveLength(0);
      expect(letters(result)).toEqual([]);
    }
  });

  it.each<Notation>(['tab', 'standard', 'both'])(
    'draws no grace link across a column between, in %s',
    (notation) => {
      const built = guitar(notation)
        .bar()
        .beat('4', [note(2, 7)], {
          grace: [
            { duration: 32, before: true, notes: [note(2, 5)] },
            { duration: 32, before: true, notes: [note(3, 9)] },
            { duration: 32, before: true, notes: [note(2, 7, { hammerPull: true })] },
          ],
        })
        .beat('2.', [note(2, 7)])
        .build({ ids: 'sequential' });
      expect(letters(laid(built))).toEqual([]);
    },
  );

  // The arc's letter on an outer string stays inside the room the staff kept.
  it.each<[Notation, number]>([
    ['tab', 1],
    ['both', 1],
    ['tab', 6],
    ['both', 6],
  ])("keeps a link's letter inside its system in %s on string %i", (notation, string) => {
    const built = guitar(notation)
      .bar()
      .beat('4', [note(string, 9)], {
        grace: [
          { duration: 32, before: true, notes: [note(string, 5)] },
          { duration: 32, before: true, notes: [note(string, 7, { hammerPull: true })] },
        ],
      })
      .beat('2.', [note(string, 9)])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const [system] = result.systems;
    if (!system) throw new Error('no system');
    const letter = result.primitives.find((p) => p.kind === 'text' && p.text === 'H');
    if (!letter) throw new Error('no letter');
    expect(letter.bbox.y).toBeGreaterThanOrEqual(system.bbox.y - 0.01);
    expect(letter.bbox.y + letter.bbox.height).toBeLessThanOrEqual(
      system.bbox.y + system.bbox.height + 0.01,
    );
  });

  it("draws a legato-slide origin's hammered link, which nothing else draws between graces", () => {
    const built = guitar('tab')
      .bar()
      .beat('4', [note(2, 9)], {
        grace: [
          { duration: 32, before: true, notes: [note(2, 5, { slide: ['legato'] })] },
          { duration: 32, before: true, notes: [note(2, 7, { hammerPull: true })] },
        ],
      })
      .beat('2.', [note(2, 9)])
      .build({ ids: 'sequential' });
    expect(letters(laid(built))).toEqual(['H']);
  });

  it("keeps a down link's letter off the origin column's flag", () => {
    const chord = (fret: number, hammerPull: boolean) =>
      [2, 3, 5].map((string) => note(string, fret, hammerPull ? { hammerPull } : {}));
    const built = guitar('tab')
      .bar()
      .beat('4', [note(2, 9)], {
        grace: [
          { duration: 32, before: true, notes: chord(5, false) },
          { duration: 32, before: true, notes: chord(7, true) },
        ],
      })
      .beat('2.', [note(2, 9)])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const flags = result.primitives.filter((p) => p.kind === 'glyph' && p.glyph.startsWith('flag'));
    for (const letter of result.primitives.filter(
      (p) => p.kind === 'text' && /^[HP]$/.test(p.text),
    )) {
      for (const flag of flags) {
        const x =
          Math.min(letter.bbox.x + letter.bbox.width, flag.bbox.x + flag.bbox.width) -
          Math.max(letter.bbox.x, flag.bbox.x);
        const y =
          Math.min(letter.bbox.y + letter.bbox.height, flag.bbox.y + flag.bbox.height) -
          Math.max(letter.bbox.y, flag.bbox.y);
        expect(x > 0.05 && y > 0.05).toBe(false);
      }
    }
  });

  it('spaces the grace columns of a link further apart, on the tab and the standard staff', () => {
    const columns = (notation: Notation, hammered: boolean): number => {
      const built = guitar(notation)
        .bar()
        .beat('4', [note(2, 7)], {
          grace: [
            { duration: 32, before: true, notes: [note(2, 5)] },
            {
              duration: 32,
              before: true,
              notes: [note(2, 7, hammered ? { hammerPull: true } : {})],
            },
          ],
        })
        .beat('2.', [note(2, 7)])
        .build({ ids: 'sequential' });
      const result = laid(built);
      const grace = built.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.grace ?? [];
      const x = (g: number): number => {
        const id = grace[g]?.notes[0]?.id;
        const found = result.primitives.find((p) => p.node === id && p.kind !== 'path');
        if (!found) throw new Error('no grace primitive');
        return found.bbox.x;
      };
      return x(1) - x(0);
    };
    for (const notation of ['tab', 'standard'] as const) {
      expect(columns(notation, true)).toBeGreaterThan(columns(notation, false) + 3);
    }
    const linkedScore = twoGraces('standard', 5, 7).build({ ids: 'sequential' });
    const arc = arcsOf(laid(linkedScore), graceTarget(linkedScore))[0];
    expect(arc && arc.bbox.width).toBeGreaterThan(5);
  });

  it.each<Notation>(['tab', 'standard', 'both'])(
    'lays an edited bar out as a cold one, grace link on and off, in %s',
    (notation) => {
      const built = twoGraces(notation, 5, 7).build({ ids: 'sequential' });
      expectCachedAsCold(built, (score) => {
        const beat = beatOf(score, 0, 0, 0);
        const grace = (hammerPull: boolean) => [
          {
            duration: 32 as const,
            before: true,
            notes: [createNote({ string: 2, fret: 5 })],
          },
          {
            duration: 32 as const,
            before: true,
            notes: [createNote({ string: 2, fret: 7, hammerPull })],
          },
        ];
        return [
          setBeatEffect({ beatId: beat.id }, { grace: grace(false) }),
          setBeatEffect({ beatId: beat.id }, { grace: grace(true) }),
          setNote({ beatId: beat.id }, { string: 2, fret: 9, hammerPull: true }),
        ];
      });
    },
  );

  // A grace note in the first column is hammered from the note before the beat (#500).
  describe('from the main note before the beat', () => {
    const graceNote = (built: Score, bar: number, beat: number): string => {
      const found = built.tracks[0]?.bars[bar]?.voices[0]?.beats[beat]?.grace?.[0]?.notes[0];
      if (!found) throw new Error('no grace note');
      return found.id;
    };
    const across = (notation: Notation, crossBar: boolean, fret = 9): Score => {
      const builder = guitar(notation)
        .bar()
        .beat('2', [note(2, 5)]);
      if (crossBar) builder.bar();
      return builder
        .beat('4', [note(2, 7)], {
          grace: [{ duration: 32, before: true, notes: [note(2, fret, { hammerPull: true })] }],
        })
        .beat('4', [note(2, 7)])
        .build({ ids: 'sequential' });
    };

    it.each<[Notation, boolean]>([
      ['tab', false],
      ['standard', false],
      ['both', false],
      ['tab', true],
      ['standard', true],
      ['both', true],
    ])('draws the arc and its letter, in %s, across a barline: %s', (notation, crossBar) => {
      const built = across(notation, crossBar);
      const result = laid(built);
      expect(strayPrimitives(result, built).map(describePrimitive)).toEqual([]);
      expect(arcsOf(result, graceNote(built, crossBar ? 1 : 0, crossBar ? 0 : 1))).toHaveLength(
        notation === 'both' ? 2 : 1,
      );
      expect(letters(result)).toEqual(['H']);
    });

    it('letters a pull-off P on the tab alone in both mode', () => {
      const built = across('both', true, 3);
      expect(letters(laid(built))).toEqual(['P']);
    });

    it.each<Notation>(['tab', 'standard', 'both'])(
      'keeps its primitives inside the system at 320 px, in %s',
      (notation) => {
        for (const crossBar of [false, true]) {
          const built = across(notation, crossBar);
          const result = laid(built, { width: 320 });
          expect(strayPrimitives(result, built).map(describePrimitive)).toEqual([]);
          expect(letters(result)).toEqual(['H']);
        }
      },
    );

    it.each<Notation>(['tab', 'standard', 'both'])(
      'lays an edited score out as a cold one, in %s',
      (notation) => {
        expectCachedAsCold(chain(notation), (score) => {
          const target = beatOf(score, 0, 12, 0);
          const origin = beatOf(score, 0, 11, 1);
          const originNote = origin.notes[0];
          if (!originNote) throw new Error('no origin');
          return [
            setBeatEffect({ beatId: target.id }, { grace: graceOn(true) }),
            setNote({ beatId: origin.id }, { string: 2, fret: 3 }),
            setBeatEffect({ beatId: target.id }, { grace: graceOn(false) }),
            setBeatEffect({ beatId: target.id }, { grace: graceOn(true) }),
            removeNote({ noteId: originNote.id }),
          ];
        });
      },
    );

    it.each<Notation>(['tab', 'standard'])(
      'draws the origin half at the end of a system, in %s',
      (notation) => {
        const base = chain(notation);
        const { score: built } = applyCommand(
          base,
          setBeatEffect({ beatId: beatOf(base, 0, 12, 0).id }, { grace: graceOn(true) }),
        );
        const result = laid(built, { width: 320 });
        // The target bar opens a system, so the origin note draws a half of its own.
        expect(result.systems.some(({ bars }) => bars.start === 12)).toBe(true);
        expect(arcsOf(result, noteOf(built, 0, 11, 1).id)).toHaveLength(1);
        expect(strayPrimitives(result, built).map(describePrimitive)).toEqual([]);
        expect(result.primitives.filter((p) => p.kind === 'text' && p.text === 'H')).toHaveLength(
          1,
        );
      },
    );

    it.each<Notation>(['tab', 'standard'])(
      'bends both halves of a split slur to a grace note the same way on string 1 and 2, in %s',
      (notation) => {
        for (const string of [1, 2]) {
          const builder = guitar(notation);
          for (let bar = 0; bar < 12; bar++) {
            builder
              .bar()
              .beat('2', [note(string, 5)])
              .beat('2', [note(string, 5)]);
          }
          const built = builder
            .bar()
            .beat('4', [note(string, 7)], {
              grace: [
                { duration: 32, before: true, notes: [note(string, 9, { hammerPull: true })] },
              ],
            })
            .build({ ids: 'sequential' });
          const result = laid(built, { width: 320 });
          expect(result.systems.some(({ bars }) => bars.start === 12)).toBe(true);
          const [half] = arcsOf(result, noteOf(built, 0, 11, 1).id);
          const graceId = built.tracks[0]?.bars[12]?.voices[0]?.beats[0]?.grace?.[0]?.notes[0]?.id;
          const [other] = arcsOf(result, graceId ?? '');
          if (!half || !other) throw new Error('missing half');
          // A slur's bulge is the middle of its path: both bulge to the same side of their ends.
          const side = (p: Primitive): number => {
            if (p.kind !== 'path') throw new Error('not a path');
            const n = p.d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
            return Math.sign((n[3] ?? 0) - (n[1] ?? 0));
          };
          expect(side(half)).toBe(side(other));
        }
      },
    );

    it.each<Notation>(['tab', 'standard'])(
      'draws no origin half when the next bar hammers a main note from its own grace note, in %s',
      (notation) => {
        const base = chain(notation);
        const target = beatOf(base, 0, 12, 0);
        const { score: graced } = applyCommand(
          base,
          setBeatEffect({ beatId: target.id }, { grace: graceOn(false) }),
        );
        const { score: built } = applyCommand(
          graced,
          setNote({ beatId: target.id }, { string: 2, fret: 7, hammerPull: true }),
        );
        const result = laid(built, { width: 320 });
        expect(result.systems.some(({ bars }) => bars.start === 12)).toBe(true);
        expect(arcsOf(result, noteOf(built, 0, 11, 1).id)).toHaveLength(0);
      },
    );
  });

  it('gives the arc from the last grace column into a hammered main note room on the tab', () => {
    const length = (hammered: boolean): number => {
      const built = guitar('tab')
        .bar()
        .beat('4', [note(2, 7, hammered ? { hammerPull: true } : {})], {
          grace: [{ duration: 32, before: true, notes: [note(2, 5)] }],
        })
        .beat('2.', [note(2, 7)])
        .build({ ids: 'sequential' });
      const result = laid(built);
      const arc = arcsOf(result, noteOf(built, 0, 0, 0).id)[0];
      return arc?.bbox.width ?? 0;
    };
    expect(length(true)).toBeGreaterThan(length(false) + 5);
  });
});
