import type { LayoutResult } from '@reprise/layout';
import type { Chord, Score } from '@reprise/model';
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

/**
 * Rest glyphs whose box overlaps a note head's by more than half a pixel. The layout package's
 * own helper is test-only and `@reprise/layout` has no testing export, so the guard keeps a copy.
 */
function restsOnRests(result: LayoutResult): string[] {
  const rests = result.primitives.filter((p) => p.kind === 'glyph' && p.glyph.startsWith('rest'));
  return rests.flatMap((a, i) =>
    rests.slice(i + 1).flatMap((b) => {
      const x =
        Math.min(a.bbox.x + a.bbox.width, b.bbox.x + b.bbox.width) - Math.max(a.bbox.x, b.bbox.x);
      const y =
        Math.min(a.bbox.y + a.bbox.height, b.bbox.y + b.bbox.height) - Math.max(a.bbox.y, b.bbox.y);
      const same = Math.abs(a.bbox.x - b.bbox.x) < 0.01 && Math.abs(a.bbox.y - b.bbox.y) < 0.01;
      return x > 0.5 && y > 0.5 && !same ? [`rests overlap at ${String(b.bbox.x)}`] : [];
    }),
  );
}

function restsOnHeads(result: LayoutResult): string[] {
  const heads = result.primitives.filter(
    (p) => p.kind === 'glyph' && p.glyph.startsWith('notehead'),
  );
  return result.primitives.flatMap((rest) => {
    if (rest.kind !== 'glyph' || !rest.glyph.startsWith('rest')) return [];
    return heads.flatMap((head) => {
      const a = rest.bbox;
      const b = head.bbox;
      const x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const y = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      return x > 0.5 && y > 0.5 ? [`${rest.glyph} on a head at ${String(b.x)}`] : [];
    });
  });
}

function voiceRests(): Score {
  return score()
    .track('guitar')
    .bar()
    .rest('4')
    .beat('4', [note(4, 2)])
    .beat('4', [note(3, 2)])
    .beat('4', [note(2, 0)])
    .voice(1)
    .beat('4', [note(5, 0)])
    .rest('4')
    .rest('4')
    .rest('4')
    .bar()
    .rest('4')
    .beat('4', [note(4, 0)])
    .beat('2', [note(4, 2)])
    .voice(1)
    .beat('4', [note(1, 12), note(2, 13)])
    .beat('4', [note(5, 0)])
    .beat('2', [note(5, 2)])
    .bar()
    .beat('8', [note(1, 5)])
    .rest('8')
    .beat('8', [note(1, 5)])
    .rest('8')
    .beat('8', [note(1, 5)])
    .rest('8')
    .beat('8', [note(1, 5)])
    .rest('8')
    .voice(1)
    .rest('1')
    .bar()
    .rest('1')
    .voice(1)
    .rest('1')
    .bar()
    .beat('2', [note(5, 3)])
    .beat('2', [note(5, 3)])
    .voice(1)
    .rest('2')
    .rest('2')
    .build({ ids: 'sequential' });
}

function wordPlacement(): Score {
  const quarter = (fret: number, words = {}) => [fret, words] as const;
  const builder = score()
    .track('guitar')
    .bar()
    .rest('1', { chord: { name: 'N.C. long chord name here' } })
    .bar();
  const bar2 = [
    quarter(0, { chord: { name: 'Am' }, lyrics: ['Twin-'] }),
    quarter(2, { lyrics: ['kle'] }),
    quarter(3, {}),
    quarter(5, { lyrics: ['twin-'] }),
  ] as const;
  for (const [fret, spec] of bar2) builder.beat('4', [note(1, fret)], spec);
  builder.bar().beat('4', [note(1, 0)], { lyrics: ['kle'] });
  builder
    .beat('4', [note(1, 2)], { lyrics: ['lit-'] })
    .beat('4', [note(1, 3)])
    .beat('4', [note(1, 5)], { lyrics: ['tle'] });
  return builder.build({ ids: 'sequential' });
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

/** Unisons in one voice and across two, and one letter at two alterations in a chord. */
function unisons(): Score {
  return score()
    .track('guitar')
    .bar()
    .beat('4', [note(1, 0), note(2, 5)])
    .beat('4', [note(1, 0, { dead: true }), note(2, 5)])
    .beat('2', [note(1, 5), note(2, 8), note(4, 17)])
    .bar()
    .beat('4', [note(1, 0), note(2, 5), note(3, 9)])
    .beat('4', [note(1, 0)])
    .beat('2', [note(1, 0)])
    .voice(1)
    .rest('4')
    .beat('4', [note(2, 5)])
    .beat('4', [note(2, 5)])
    .beat('4', [note(2, 5)])
    .bar()
    .beat('4', [note(1, 0, { dead: true })])
    .beat('4.', [note(1, 0)])
    .beat('8', [note(1, 3)])
    .beat('4', [note(1, 3)])
    .voice(1)
    .beat('4', [note(2, 5)])
    .beat('4', [note(2, 5)])
    .beat('2', [note(2, 8)])
    .bar()
    .beat('4', [note(1, 1), note(2, 7)])
    .beat('4', [note(1, 2), note(2, 7)])
    .beat('2', [note(1, 1)])
    .build({ ids: 'sequential' });
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

/**
 * A 7-string track: a barre at base fret 7, muted and open strings, two diagrams on consecutive
 * eighths, and a diagram on the last beat of every bar, so each system ends on one.
 */
function chordDiagramsBuilt(): Score {
  const strings = 7;
  const builder = score().track('guitar', { tuning: [64, 59, 55, 50, 45, 40, 35] });
  const barre: Chord = {
    name: 'B7 barre',
    diagram: {
      baseFret: 7,
      frets: Array.from({ length: strings }, (_, i) => [7, 9, 8, 7, 7, 7, 7][i] ?? 7),
      barres: [{ fret: 7, firstString: 1, lastString: strings }],
      fingering: ['index', 'little', 'ring', 'index', 'index', 'index', 'index'],
    },
  };
  const open: Chord = {
    name: 'Em',
    diagram: {
      baseFret: 1,
      frets: [0, 0, 0, 2, 2, 0, null],
    },
  };
  const muted: Chord = {
    name: 'D',
    diagram: {
      baseFret: 1,
      frets: [2, 3, 2, 0, null, null, null],
    },
  };
  builder
    .bar()
    .beat('4', [note(1, 7)], { chord: barre })
    .beat('4', [note(2, 9)])
    .beat('4', [note(3, 8)])
    .beat('4', [note(4, 7)], { chord: muted });
  builder
    .bar()
    .beat('8', [note(1, 0)], { chord: open })
    .beat('8', [note(1, 0)], { chord: muted })
    .beat('4', [note(2, 3)])
    .beat('2', [note(3, 2)]);
  for (let i = 0; i < 2; i++) {
    builder
      .bar()
      .beat('4', [note(1, i)])
      .beat('4', [note(2, i)])
      .beat('4', [note(3, i)])
      .beat('4', [note(4, i)], { chord: i % 2 === 0 ? open : barre });
  }
  return builder.build({ ids: 'sequential' });
}

const hasDiagrams = (result: LayoutResult): void => {
  const grids = result.primitives.filter((p) => p.kind === 'path' && p.lane === 'chordDiagram');
  expect(grids.length, 'the scene draws chord diagrams').toBeGreaterThan(0);
};

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
    id: 'voice-rests',
    covers:
      "Rests of two voices clear of each other's notes; a voice of rests only; two whole-bar rests coincide; half rests moved off the staff take ledger lines",
    source: { build: voiceRests },
    notations: ['standard', 'both'],
    guard: (result) => {
      expect(restsOnHeads(result), 'no rest sits on a note head').toEqual([]);
      expect(restsOnRests(result), 'no rest sits on another rest').toEqual([]);
      const flags = result.primitives.filter(
        (p) => p.kind === 'glyph' && p.glyph === 'flag8thDown',
      );
      expect(flags.length, 'the rests-only bar stems its notes down by pitch').toBeGreaterThan(0);
    },
  },
  {
    id: 'words',
    covers: 'Grace notes, chord names, text, lyrics, fingering and dynamics on each staff',
    source: { build: words },
    notations: ALL,
  },
  {
    id: 'chord-diagrams',
    covers:
      'Chord diagrams a real file carries, above each beat on the tab staff, in every notation',
    source: { fixture: 'gp5/chords.gp5' },
    notations: ALL,
    light: ['tab'],
    guard: hasDiagrams,
  },
  {
    id: 'chord-diagrams-built',
    covers:
      'A 7-string barre at base fret 7 with fingering, muted and open strings, diagrams on consecutive eighths and on the last beat of each system',
    source: { build: chordDiagramsBuilt },
    notations: ['tab'],
    width: 400,
    guard: (result) => {
      hasDiagrams(result);
      expect(result.systems.length, 'a system ends on a diagram').toBeGreaterThan(1);
    },
  },
  {
    id: 'word-placement',
    covers:
      'A whole-bar rest name from its onset; hyphens centred between syllables, across a bar line and a melisma',
    source: { build: wordPlacement },
    notations: ['tab', 'standard'],
    guard: (result) => {
      const texts = result.primitives.flatMap((p) => (p.kind === 'text' ? [p] : []));
      const find = (text: string, nth = 0) => {
        const found = texts.filter((p) => p.text === text)[nth];
        if (!found) throw new Error(`no text ${text}`);
        return found;
      };
      const name = find('N.C. long chord name here');
      expect(name.bbox.x + name.bbox.width, 'the name ends before bar 2').toBeLessThan(
        find('Am').bbox.x,
      );
      const dashes = texts.filter((p) => p.text === '-' && p.lane === undefined);
      const across = dashes.find((d) => d.node === find('twin').node);
      expect(across, 'the cross-bar hyphen is drawn').toBeDefined();
      expect(across?.x ?? 0).toBeGreaterThan(find('twin').x);
      expect(across?.x ?? Infinity).toBeLessThan(find('kle', 1).x);
    },
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
    id: 'golpe',
    covers: 'Finger golpes above the staff and thumb golpes below it, from a real file (#354)',
    source: { fixture: 'gp/golpe.gp' },
    notations: ['tab', 'standard'],
    pages: [0],
    guard: (result) => {
      const golpes = result.primitives.filter(
        (p) => p.kind === 'glyph' && p.glyph === 'guitarGolpe',
      );
      expect(golpes.length).toBeGreaterThanOrEqual(2);
    },
  },
  {
    id: 'pick-scrape',
    covers: 'Pick scrapes: the P.S. run and the wave out of each note, from a real file (#354)',
    source: { fixture: 'gp/pick-slide.gp' },
    notations: ['tab', 'standard'],
    pages: [0],
    guard: (result) => {
      expect(result.primitives.some((p) => p.kind === 'text' && p.text === 'P.S.')).toBe(true);
    },
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
    id: 'unisons',
    covers:
      'Unisons in one voice (two and three strings, with a dead note, beside a second) and across two voices (shared heads, voices moved right); F with F sharp in one chord',
    source: { build: unisons },
    notations: ['standard', 'both'],
    guard: (result) => {
      const notes = result.anchors.filter(
        (anchor) => anchor.kind === 'note' && anchor.staff === 'standard',
      );
      for (const [i, a] of notes.entries()) {
        for (const b of notes.slice(i + 1)) {
          const apart =
            a.bbox.x + a.bbox.width <= b.bbox.x + 0.02 ||
            b.bbox.x + b.bbox.width <= a.bbox.x + 0.02 ||
            a.bbox.y + a.bbox.height <= b.bbox.y + 0.02 ||
            b.bbox.y + b.bbox.height <= a.bbox.y + 0.02;
          expect(apart, `note anchors ${a.id} and ${b.id} overlap`).toBe(true);
        }
      }
      const rows = new Map<string, number[]>();
      for (const { bbox } of notes) {
        const key = bbox.y.toFixed(1);
        rows.set(
          key,
          [...(rows.get(key) ?? []), bbox.x].sort((x, y) => x - y),
        );
      }
      // Three heads of one pitch side by side span less than three head widths.
      const three = [...rows.values()].some((xs) =>
        xs.some((x, i) => (xs[i + 2] ?? Infinity) - x < 30),
      );
      expect(three, 'some beat must set three heads of one pitch side by side').toBe(true);
    },
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
