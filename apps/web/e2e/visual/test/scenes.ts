import type { LayoutResult } from '@reprise/layout';
import type { Score } from '@reprise/model';
import { midi, note, score, type ScoreBuilder } from '@reprise/model/testing';
import { expect } from 'vitest';

import type { NotationChoice } from '@/features/score';
import { longScore } from '@/features/score/test/long-score';

import type { Theme } from './paint-page';

/**
 * One scene of the reference set. Each `notations` entry is captured once per page in `pages`
 * (every page its layout has, for `'all'`; page 0 alone, which must be the only one, without it),
 * in the dark theme, and again in light for the entries in `light`. A guard runs on the layout
 * before painting and proves the scene shows what it claims: when one fails, change the scene's
 * content, not the guard.
 */
export interface Scene {
  id: string;
  covers: string;
  source: { build: () => Score } | { fixture: string };
  notations: readonly NotationChoice[];
  mode?: 'paged' | 'continuous';
  /** A narrower paged width than A4, to force a system break. */
  width?: number;
  pages?: readonly number[] | 'all';
  light?: readonly NotationChoice[];
  guard?: (result: LayoutResult) => void;
}

export const DEFAULT_THEME: Theme = 'dark';

const ALL = ['tab', 'standard', 'both'] as const;

/** The system holding master bar `bar`. */
function systemOf(result: LayoutResult, bar: number): number {
  const found = result.systems.find(({ bars }) => bar >= bars.start && bar < bars.end);
  if (!found) throw new Error(`no system holds bar ${String(bar)}`);
  return found.index;
}

function rhythmValues(builder: ScoreBuilder = score()): ScoreBuilder {
  const up = [0, 2, 3, 5, 7, 8, 10, 12];
  const run = (spec: '8' | '16' | '32' | '64', count: number, from = 0) => {
    for (let i = 0; i < count; i++) {
      const step = (from + i) % (2 * up.length);
      const fret = step < up.length ? up[step] : up[2 * up.length - 1 - step];
      builder.beat(spec, [note(1, fret ?? 0)]);
    }
  };
  builder
    .track('guitar')
    .bar()
    .beat('1', [note(2, 1)]);
  builder
    .bar()
    .beat('2', [note(3, 2)])
    .beat('4.', [note(2, 3)])
    .beat('8', [note(1, 0)]);
  builder.bar();
  run('8', 4);
  run('16', 4, 4);
  builder.beat('8.', [note(1, 10)]).beat('16', [note(1, 5)]);
  builder.bar();
  run('32', 8);
  run('64', 16, 3);
  builder.rest('4').rest('8').rest('16').rest('16');
  return builder;
}

function meters(): Score {
  const builder = score().track('guitar').bar().timeSignature(3, 4);
  for (let i = 0; i < 6; i++) builder.beat('8', [note(2, i)]);
  builder.bar().timeSignature(6, 8);
  for (let i = 0; i < 3; i++) builder.beat('8', [note(1, i)]);
  for (let i = 0; i < 4; i++) builder.beat('16', [note(1, 5 - i)]);
  builder.beat('8', [note(1, 0)]);
  builder.bar().timeSignature(2, 2);
  for (let i = 0; i < 8; i++) builder.beat('8', [note(3, i % 4)]);
  builder.bar().timeSignature(3, 8);
  for (let i = 0; i < 6; i++) builder.beat('16', [note(2, i)]);
  return builder.build({ ids: 'sequential' });
}

function tupletsTies(): Score {
  const five = { tuplet: { n: 5, of: 4 } };
  const builder = score()
    .track('guitar')
    .bar()
    .beat('8t', [note(1, 0)])
    .beat('8t', [note(1, 1)])
    .beat('8t', [note(1, 2)])
    .beat('4t', [note(2, 0)])
    .beat('4t', [note(2, 1)])
    .beat('4t', [note(2, 3)])
    .beat('4t', [note(3, 0)])
    .beat('8t', [note(3, 2)])
    .bar();
  for (let i = 0; i < 5; i++) builder.beat('16', [note(3, i)], five);
  builder
    .beat('4', [note(2, 5)])
    .beat('4', [note(2, 5, { tie: true })])
    .beat('4', [note(1, 3)])
    .bar()
    .beat('4', [note(1, 3, { tie: true })])
    .beat('4', [note(2, 1)])
    .beat('4', [note(3, 2)])
    .beat('4', [note(4, 2)])
    .bar()
    .beat('2', [note(4, 2, { tie: true })])
    .rest('2');
  return builder.build({ ids: 'sequential' });
}

function voices(): Score {
  return score()
    .track('guitar')
    .bar()
    .beat('4', [note(1, 0)])
    .beat('4', [note(1, 3)])
    .beat('8', [note(2, 1)])
    .beat('8', [note(2, 3)])
    .beat('8', [note(1, 0)])
    .beat('8', [note(1, 1)])
    .voice(1)
    .beat('2', [note(5, 3)])
    .rest('2')
    .bar()
    .beat('8', [note(1, 0)])
    .beat('8', [note(1, 2)])
    .beat('8', [note(2, 3)])
    .beat('8', [note(2, 1)])
    .beat('4', [note(1, 0)])
    .beat('4', [note(1, 3)])
    .voice(1)
    .rest('4')
    .beat('2.', [note(6, 3)])
    .build({ ids: 'sequential' });
}

function words(): Score {
  const dyn = (dynamics: 'pp' | 'f' | 'mf') => [note(1, 0, { dynamics })];
  return score()
    .track('guitar')
    .bar()
    .beat('4', [note(3, 2)], {
      grace: [{ duration: 16, before: true, notes: [note(3, 0)] }],
      chord: { name: 'Am' },
      lyrics: ['Hel-'],
    })
    .beat('4', [note(2, 3)], {
      grace: [
        { duration: 16, before: true, notes: [note(2, 0)] },
        { duration: 16, before: true, notes: [note(2, 1)] },
      ],
      text: 'let ring',
      lyrics: ['lo'],
    })
    .beat(
      '2',
      [
        note(3, 1, { leftHandFinger: 'index' }),
        note(4, 2, { leftHandFinger: 'middle' }),
        note(5, 2, { leftHandFinger: 'ring' }),
      ],
      { chord: { name: 'E7' }, lyrics: ['world'] },
    )
    .bar()
    .beat('4', dyn('pp'))
    .beat('4', dyn('f'))
    .beat('2', dyn('pp'))
    .bar()
    .beat('4', dyn('mf'))
    .beat('4', dyn('f'))
    .beat('2', dyn('mf'))
    .build({ ids: 'sequential' });
}

function pitchAccidentals(): Score {
  return (
    score()
      .key(-3)
      .track('guitar')
      .bar()
      .beat('4', [note(3, 0), note(4, 3)])
      // E natural, B natural and G flat in E-flat: three accidentals stack in columns.
      .beat('4', [note(1, 0), note(2, 0), note(4, 4)])
      .beat('2', [note(1, 17)])
      .bar()
      .beat('4', [note(1, 2)])
      .beat('4', [note(1, 2)])
      .beat('4', [note(1, 1)])
      .beat('4', [note(6, 0)])
      .bar()
      .key(2)
      .beat('4', [note(1, 1)])
      .beat('4', [note(1, 2)])
      .beat('2', [note(2, 1), note(3, 2)])
      .bar()
      .beat('2', [note(6, 1)])
      .beat('2', [note(1, 15)])
      .track('bass')
      .bar()
      .beat('2', [note(4, 1)])
      .beat('2', [note(3, 1)])
      .bar()
      .beat('4', [note(4, 3)])
      .beat('4', [note(4, 3)])
      .beat('2', [note(4, 2)])
      .bar()
      .beat('1', [note(3, 0)])
      .bar()
      .beat('2', [note(1, 12)])
      .beat('2', [note(4, 0)])
      .build({ ids: 'sequential' })
  );
}

function tabNotes(): Score {
  const forms = (builder: ScoreBuilder, chord: number) => {
    builder
      .bar()
      .beat('8', [note(1, 5, { dead: true })])
      .beat('8', [note(2, 3, { ghost: true })])
      .beat('8', [note(3, 7)])
      .beat('8', [note(3, 7, { tie: true })])
      .beat('8', [note(2, 0, { dead: true, ghost: true })])
      .beat('8', [note(1, 12)])
      .beat('8', [note(1, 24)])
      .beat(
        '8',
        Array.from({ length: chord }, (_, i) => note(i + 1, i % 3)),
      );
    return builder;
  };
  const builder = score().track('guitar', { name: '6-string' });
  forms(builder, 6);
  builder.track('guitar', { name: '7-string', tuning: [35, 40, 45, 50, 55, 59, 64] });
  forms(builder, 7);
  builder.track('bass');
  forms(builder, 4);
  return builder.build({ ids: 'sequential' });
}

function furniture(): Score {
  const builder = score()
    .track('guitar', {
      name: 'Guitar',
      shortName: 'Gtr.',
      display: { notation: 'both', clef: 'treble', octaveShift: 1 },
    })
    .bar()
    .tempo(120)
    .section('Intro', { letter: 'A' });
  builder.beat('2', [note(3, 0)]).beat('2', [note(2, 1)]);
  builder
    .bar()
    .repeatStart()
    .beat('2', [note(3, 2)])
    .beat('2', [note(2, 0)]);
  builder
    .bar()
    .repeatEnd(3)
    .beat('2', [note(3, 1)])
    .beat('2', [note(2, 2)]);
  builder
    .bar()
    .repeatStart()
    .beat('1', [note(4, 2)]);
  builder
    .bar()
    .volta([1])
    .repeatEnd()
    .beat('1', [note(4, 0)]);
  builder
    .bar()
    .volta([2])
    .masterBar({ doubleBar: true })
    .beat('1', [note(4, 3)]);
  builder
    .bar()
    .target('segno')
    .tempo(96)
    .key(2)
    .beat('1', [note(3, 2)]);
  builder
    .bar({ clef: 'bass' })
    .timeSignature(3, 4)
    .target('fine')
    .beat('2.', [note(5, 0)]);
  builder
    .bar({ clef: 'bass' })
    .jump('dsAlFine')
    .beat('2.', [note(5, 3)]);
  builder.track('bass', { name: 'Bass', shortName: 'Bs.' });
  for (let b = 0; b < 9; b++) {
    builder.bar();
    if (b >= 7) builder.beat('2.', [note(3, b % 4)]);
    else builder.beat('2', [note(4, b % 4)]).beat('2', [note(3, b % 3)]);
  }
  builder.track('drums', { name: 'Drums', shortName: 'Dr.' });
  for (let b = 0; b < 9; b++) {
    builder.bar();
    const beats = b >= 7 ? 3 : 4;
    for (let i = 0; i < beats; i++) builder.beat('4', [midi(i % 2 === 0 ? 36 : 38), midi(42)]);
  }
  return builder.build({ ids: 'sequential' });
}

function noteMarks(): Score {
  const builder = score().track('guitar', { name: 'Guitar' });
  builder
    .bar()
    .beat('4', [note(1, 12, { staccato: true, accent: 'accent' })])
    .beat('4', [note(6, 0, { staccato: true, accent: 'heavy' })])
    .beat('8', [note(3, 2)], { effects: { tremoloPicking: 16 } })
    .beat('8', [note(3, 4)])
    .beat('4', [note(2, 1)], { effects: { tremoloPicking: 32 } });
  builder
    .bar()
    .beat('2', [note(4, 4, { ghost: true }), note(3, 2, { ghost: true })])
    .beat('4', [note(1, 12, { harmonic: { kind: 'natural' } })])
    .beat('4', [note(2, 7, { harmonic: { kind: 'natural' } })]);
  builder
    .bar()
    .beat('4', [note(6, 0, { harmonic: { kind: 'natural', value: 2.7 } })])
    .beat('4', [note(1, 2, { harmonic: { kind: 'artificial', value: 12 } })])
    .beat('4', [note(3, 5, { harmonic: { kind: 'pinch', value: 7 } })])
    .beat('4', [note(3, 5, { slide: ['shift'] })]);
  builder
    .bar()
    .beat('8', [note(3, 7)])
    .beat('8', [note(3, 5, { slide: ['legato'] })])
    .beat('8', [note(3, 7)])
    .beat('8', [note(2, 5)])
    .beat('8', [note(2, 7, { hammerPull: true })])
    .beat('8', [note(2, 5, { hammerPull: true })])
    .beat('4', [note(4, 5, { slide: ['intoFromBelow'] })]);
  builder
    .bar()
    .beat('4', [note(4, 7, { slide: ['outDown'] })])
    .beat('4', [note(3, 7, { hammerPull: true })], {
      grace: [{ duration: 16, before: true, notes: [note(3, 5)] }],
    })
    .beat('4', [note(1, 0), note(2, 1), note(3, 0)], {
      effects: { arpeggio: { direction: 'down' } },
    })
    .beat('4', [note(1, 0), note(2, 1), note(3, 2)], { effects: { brush: { direction: 'up' } } });
  builder.bar().beat('1', [note(2, 5)], { effects: { tremoloPicking: 8 } });
  builder
    .bar()
    .beat('8', [note(1, 5, { accent: 'accent' })])
    .beat('8', [note(1, 7, { staccato: true })])
    .beat('4', [note(2, 6, { staccato: true })])
    .beat('2', [note(1, 8, { accent: 'heavy' })])
    .voice(1)
    .beat('2', [note(5, 3, { staccato: true })])
    .beat('2', [note(6, 0, { accent: 'accent' })]);
  builder.track('drums', { name: 'Drums' });
  builder
    .bar()
    .beat('8', [midi(36, { accent: 'accent' })])
    .beat('8', [midi(38, { ghost: true })])
    .beat('4', [midi(38)], { effects: { tremoloPicking: 16 } })
    .beat('4', [midi(38, { staccato: true })], {
      grace: [{ duration: 32, before: true, notes: [midi(38)] }],
    })
    .beat('4', [midi(42, { accent: 'heavy' })]);
  builder
    .bar()
    .beat('8', [midi(42, { accent: 'accent' })])
    .beat('8', [midi(42)])
    .beat('8', [midi(42, { staccato: true })])
    .beat('8', [midi(42)])
    .beat('2', [midi(46, { accent: 'heavy' })])
    .voice(1)
    .beat('4', [midi(36, { accent: 'accent' })])
    .beat('4', [midi(38, { ghost: true })])
    .beat('2', [midi(36)]);
  for (let b = 0; b < 5; b++) builder.bar().rest('1');
  return builder.build({ ids: 'sequential' });
}

function hasGlyph(result: LayoutResult, prefix: string): void {
  expect(
    result.primitives.some((p) => p.kind === 'glyph' && p.glyph.startsWith(prefix)),
    `the scene must draw a ${prefix} glyph`,
  ).toBe(true);
}

function atLeastTwoSystems(result: LayoutResult): void {
  expect(result.systems.length, 'the scene must break into at least two systems').toBeGreaterThan(
    1,
  );
}

export const SCENES: readonly Scene[] = [
  {
    id: 'rhythm-values',
    covers: 'Stems, flags, beams by the half bar and the quarter, partial beams, dots, rests',
    source: { build: () => rhythmValues().build({ ids: 'sequential' }) },
    notations: ALL,
    light: ['both'],
  },
  {
    id: 'meters',
    covers: 'The shared beam grouping drawn by both helper sets; time-signature changes',
    source: { build: meters },
    notations: ['tab', 'standard'],
  },
  {
    id: 'tuplets-ties',
    covers: 'Tuplet numbers and brackets; ties inside a bar, across a bar line and a system break',
    source: { build: tupletsTies },
    notations: ALL,
    width: 400,
    guard: (result) => {
      // Master-bar indices: the tie from bar 2 into bar 3 crosses a break, 3 into 4 does not.
      expect(systemOf(result, 2), 'the 2-3 tie crosses a system break').toBe(
        systemOf(result, 1) + 1,
      );
      expect(systemOf(result, 3), 'the 3-4 tie stays in one system').toBe(systemOf(result, 2));
    },
  },
  {
    id: 'voices',
    covers: 'Voice direction on each staff; rests and dots moved by voice',
    source: { build: voices },
    notations: ALL,
  },
  {
    id: 'words',
    covers: 'Grace notes, chord names, text, lyrics, fingering and dynamics on each staff',
    source: { build: words },
    notations: ALL,
  },
  {
    id: 'pitch-accidentals',
    covers: 'Clefs, key signatures and naturals, accidental columns, seconds, ledger lines',
    source: { build: pitchAccidentals },
    notations: ['standard', 'both'],
  },
  {
    id: 'tab-notes',
    covers: 'String counts, dead, ghost and tied note forms, two-digit knockouts',
    source: { build: tabNotes },
    notations: ['tab'],
  },
  {
    id: 'furniture',
    covers: 'Track names, staff stacking, joined bar lines, repeats, voltas, jumps, header bands',
    source: { build: furniture },
    notations: ['default'],
    guard: atLeastTwoSystems,
  },
  {
    id: 'continuous',
    covers: 'The joins between continuous segments on both staves',
    source: { build: () => rhythmValues().build({ ids: 'sequential' }) },
    notations: ['both'],
    mode: 'continuous',
    guard: atLeastTwoSystems,
  },
  {
    id: 'effects',
    covers: 'Bends, slides, hammer-ons, harmonics, palm muting as Guitar Pro writes them',
    source: { fixture: 'gp5/effects.gp5' },
    notations: ALL,
    pages: 'all',
  },
  {
    id: 'multivoice',
    covers: 'A real two-voice file',
    source: { fixture: 'gp/multivoice-rhythm.gp' },
    notations: ALL,
  },
  {
    id: 'drums',
    covers: 'A real drum part',
    source: { fixture: 'gp/drum-tabs.gp' },
    notations: ['default'],
    guard: (result) => {
      hasGlyph(result, 'artic');
    },
  },
  {
    id: 'note-marks',
    covers:
      'Articulations by voice, tremolo strokes, ghost parentheses, harmonic diamonds, slurs, slides and strokes on the standard staff; drum accents, ghosts, rolls and flams',
    source: { build: noteMarks },
    notations: ['standard', 'both'],
    light: ['standard'],
    guard: (result) => {
      for (const prefix of ['artic', 'tremolo', 'noteheadParenthesis', 'noteheadDiamond']) {
        hasGlyph(result, prefix);
      }
    },
  },
  {
    id: 'percussion-all',
    covers: 'Every GM percussion instrument in the corpus: positions and heads',
    source: { fixture: 'gp5/percussion-all.gp5' },
    notations: ['default'],
  },
  {
    id: 'pitched',
    covers: 'A pitched, non-fretted track on the standard staff',
    source: { fixture: 'gp/sustain.gp' },
    notations: ['default'],
  },
  {
    id: 'long',
    covers:
      "Paged breaking and justification; an 8-track system split across A4 pages, its continuation's bar numbers",
    source: { build: longScore },
    notations: ['default'],
    pages: [0, 1],
    guard: (result) => {
      const continuation = result.systems[1];
      expect(continuation?.part).toBe(1);
      expect(continuation?.page).toBe(1);
    },
  },
];
