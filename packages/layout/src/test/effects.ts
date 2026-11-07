import type { Bend, Beat, Note, Score } from '@reprise/model';
import { midi, note, score, type ScoreBuilder } from '@reprise/model/testing';
import { expect } from 'vitest';

import { PAGE_SIZES, layout, type LayoutOptions, type LayoutResult } from '../index';
import { expectValid, overlappingMarks } from './check-result';
import { describePrimitive } from './describe';

export const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

/** Lays out `built` and checks the result's invariants and that no two marks overlap. */
export function laid(built: Score, options: Partial<LayoutOptions> = {}): LayoutResult {
  const result = layout(built, { ...paged, ...options });
  expectValid(result);
  expect(
    overlappingMarks(result).map(([a, b]) => [describePrimitive(a), describePrimitive(b)]),
  ).toEqual([]);
  return result;
}

export function guitar(notation: 'tab' | 'both' | 'standard' = 'tab'): ScoreBuilder {
  return score().track('guitar', { display: { notation, octaveShift: 1 } });
}

/** What notes and beats drew, one line each, for data snapshots. */
export function content(result: LayoutResult): string[] {
  return result.primitives
    .filter((p) => p.node !== undefined && (p.node.startsWith('beat') || p.node.startsWith('note')))
    .map(describePrimitive);
}

export function texts(result: LayoutResult): string[] {
  return result.primitives.flatMap((p) =>
    p.kind === 'text' && (p.node?.startsWith('beat') || p.node?.startsWith('note')) ? [p.text] : [],
  );
}

const bend = (kind: Bend['kind'], values: [number, number][]): Bend => ({
  kind,
  points: values.map(([position, value]) => ({ position, value })),
});

/** One of each bend Guitar Pro writes, in quarter tones. */
export const BENDS = {
  quarter: bend('bend', [
    [0, 0],
    [60, 1],
  ]),
  half: bend('bend', [
    [0, 0],
    [60, 2],
  ]),
  full: bend('bend', [
    [0, 0],
    [30, 4],
    [60, 4],
  ]),
  oneAndHalf: bend('bend', [
    [0, 0],
    [60, 6],
  ]),
  two: bend('bend', [
    [0, 0],
    [60, 8],
  ]),
  bendRelease: bend('bendRelease', [
    [0, 0],
    [20, 4],
    [40, 4],
    [60, 0],
  ]),
  bendReleaseBend: bend('bendReleaseBend', [
    [0, 0],
    [15, 4],
    [30, 4],
    [45, 0],
    [60, 4],
  ]),
  prebend: bend('prebend', [
    [0, 4],
    [60, 4],
  ]),
  prebendBend: bend('prebendBend', [
    [0, 2],
    [60, 4],
  ]),
  prebendRelease: bend('prebendRelease', [
    [0, 4],
    [60, 0],
  ]),
  release: bend('release', [
    [0, 4],
    [60, 0],
  ]),
  hold: bend('hold', [
    [0, 4],
    [60, 4],
  ]),
  custom: bend('custom', [
    [0, 0],
    [20, 2],
    [40, 4],
    [60, 3],
  ]),
} as const;

/**
 * A guitar with every effect the model has, a piano with articulations, trills and dynamics,
 * and drums with accents, ghost notes and rolls.
 */
export function everyEffectScore(): Score {
  const builder = score().track('guitar');
  builder
    .bar()
    .beat('4', [note(3, 7, { bend: BENDS.full })])
    .beat('4', [note(3, 7, { bend: BENDS.bendRelease })])
    .beat('4', [
      note(2, 8, { bend: BENDS.prebendRelease }),
      note(3, 7, { bend: BENDS.prebendRelease }),
    ])
    .beat('4', [note(3, 7, { bend: BENDS.hold })]);
  builder
    .bar()
    .beat('8', [note(3, 5, { slide: ['shift'] })])
    .beat('8', [note(3, 7, { slide: ['legato'] })])
    .beat('8', [note(3, 5, { slide: ['intoFromBelow'] })])
    .beat('8', [note(3, 5, { slide: ['outDown'] })])
    .beat('8', [note(1, 5)])
    .beat('8', [note(1, 7, { hammerPull: true })])
    .beat('8', [note(1, 5, { hammerPull: true })])
    .beat('8', [note(6, 3, { hammerPull: false, slide: ['outUp'] })]);
  builder
    .bar()
    .beat('4', [note(3, 7, { vibrato: 'slight', palmMute: true })], {
      effects: { pickStroke: 'down' },
    })
    .beat('4', [note(3, 7, { vibrato: 'wide', palmMute: true })], { effects: { pickStroke: 'up' } })
    .beat('4', [note(2, 5, { letRing: true, trill: { fret: 7, speed: 16 } })], {
      effects: { tapping: true, fadeIn: true },
    })
    .beat('4', [note(2, 12, { letRing: true, harmonic: { kind: 'natural' } })], {
      effects: { vibrato: 'wide', fadeOut: true },
    });
  builder
    .bar()
    .beat('8', [note(2, 5, { harmonic: { kind: 'artificial', value: 12 } })], {
      effects: { slapping: true, volumeSwell: true },
    })
    .beat('8', [note(2, 5, { harmonic: { kind: 'pinch', value: 7 } })], {
      effects: { popping: true },
    })
    .beat('8', [note(2, 3, { harmonic: { kind: 'tapped', value: 12 }, accent: 'accent' })])
    .beat('8', [note(2, 3, { harmonic: { kind: 'semi' }, staccato: true, accent: 'heavy' })])
    .beat('4', [note(1, 0), note(2, 1), note(3, 0), note(4, 2)], {
      effects: { arpeggio: { direction: 'down' } },
    })
    .beat('4', [note(1, 0), note(2, 1), note(3, 0)], {
      effects: { brush: { direction: 'up' }, tremoloPicking: 32 },
    });
  builder
    .bar()
    .beat('4', [note(3, 0, { harmonic: { kind: 'natural', value: 2.7 }, ghost: true })], {
      effects: {
        whammy: {
          kind: 'dive',
          points: [
            { position: 0, value: 0 },
            { position: 60, value: -8 },
          ],
        },
      },
    })
    .beat('4', [note(3, 0)], {
      effects: {
        whammy: {
          kind: 'dip',
          points: [
            { position: 0, value: 0 },
            { position: 30, value: -4 },
            { position: 60, value: 0 },
          ],
        },
        tremoloPicking: 8,
      },
    })
    .beat('4', [note(4, 2, { harmonic: { kind: 'feedback', value: 12 }, dead: false })], {
      grace: [{ duration: 16, before: true, notes: [note(4, 0, { slide: ['legato'] })] }],
    })
    .beat('4', [note(4, 4, { hammerPull: true, dynamics: 'pp' })], {
      grace: [{ duration: 32, before: false, notes: [note(4, 2)] }],
      effects: { tremoloPicking: 16 },
    });
  builder
    .bar()
    .beat('4', [note(6, 0, { harmonic: { kind: 'natural', value: 2.7 } })])
    .beat('4', [note(1, 2, { harmonic: { kind: 'artificial', value: 12 } })])
    .beat('2', [note(4, 4, { ghost: true }), note(3, 2, { ghost: true })])
    .voice(1)
    .beat('2', [note(5, 3, { staccato: true })])
    .beat('2', [note(6, 0, { accent: 'heavy' })]);
  builder.track('piano');
  for (let b = 0; b < 6; b++) {
    builder
      .bar()
      .beat('4', [midi(60, { staccato: true, dynamics: b % 2 === 0 ? 'p' : 'f' })])
      .beat('4', [midi(64, { accent: 'accent' })])
      .beat('4', [midi(67, { accent: 'heavy', trill: { fret: 69, speed: 32 } })])
      .beat('4', [midi(72, { ghost: true })]);
  }
  builder.track('drums');
  for (let b = 0; b < 6; b++) {
    builder
      .bar()
      .beat('8', [midi(36, { accent: 'accent' })])
      .beat('8', [midi(38, { ghost: true })])
      .beat('4', [midi(38)], { effects: { tremoloPicking: 16 } })
      .beat('2', [midi(42, { accent: 'heavy', dynamics: 'mp' })]);
  }
  return builder.build({ ids: 'sequential' });
}

const EFFECTS: readonly ((n: Note) => Partial<Note>)[] = [
  () => ({ bend: BENDS.full }),
  () => ({ slide: ['shift'] }),
  () => ({ hammerPull: true }),
  () => ({ vibrato: 'slight' }),
  () => ({ letRing: true }),
  (n) => ({ harmonic: { kind: 'natural', value: n.fret } }),
];

/**
 * Gives every fourth beat of `built` one effect in turn: a full bend, a shift slide, a hammer-on,
 * vibrato, let ring, a natural harmonic or a pick stroke. Changes `built` in place and returns
 * it, so pass a fresh score.
 */
export function withEffects(built: Score): Score {
  let count = 0;
  for (const track of built.tracks) {
    for (const bar of track.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          count += 1;
          if (count % 4 !== 0 || beat.rest || beat.notes.length === 0) continue;
          const which = (count / 4) % (EFFECTS.length + 1);
          const effect = EFFECTS[which];
          if (!effect) {
            beat.effects = { ...beat.effects, pickStroke: 'down' };
            continue;
          }
          beat.notes = beat.notes.map((n) => ({ ...n, ...effect(n) }));
        }
      }
    }
  }
  return built;
}

const MARKS: readonly ((beat: Beat) => void)[] = [
  (beat) => {
    beat.notes = beat.notes.map((n) => ({ ...n, staccato: true }));
  },
  (beat) => {
    beat.notes = beat.notes.map((n) => ({ ...n, accent: 'heavy' }));
  },
  (beat) => {
    beat.notes = beat.notes.map((n) => ({ ...n, ghost: true }));
  },
  (beat) => {
    beat.notes = beat.notes.map((n) => ({ ...n, harmonic: { kind: 'artificial', value: 12 } }));
  },
  (beat) => {
    beat.effects = { ...beat.effects, tremoloPicking: 16 };
  },
  (beat) => {
    beat.effects = { ...beat.effects, arpeggio: { direction: 'down' } };
  },
];

/**
 * Gives every fourth beat of `built`, two after `withEffects`' beats, one note mark in turn: a
 * staccato, a heavy accent, ghost notes, an artificial harmonic, tremolo picking or an arpeggio.
 * Changes `built` in place and returns it, so pass a fresh score.
 */
export function withNoteMarks(built: Score): Score {
  let count = 0;
  let mark = 0;
  for (const track of built.tracks) {
    for (const bar of track.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          count += 1;
          if (count % 4 !== 2 || beat.rest || beat.notes.length === 0) continue;
          MARKS[mark % MARKS.length]?.(beat);
          mark += 1;
        }
      }
    }
  }
  return built;
}
