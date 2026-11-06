import { applyCommand, setBeatEffect, setNoteEffect, type Score } from '@reprise/model';
import { beatOf, note, noteOf, score, type ScoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  LayoutCache,
  PAGE_SIZES,
  layout,
  type LayoutOptions,
  type LayoutResult,
  type Primitive,
} from '../../index';
import { expectValid, overlappingMarks, stable } from '../../test/check-result';
import { describePrimitive } from '../../test/describe';
import { BENDS, everyEffectScore } from '../../test/effects';
import { bendLabel } from './labels';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

function laid(built: Score, options: Partial<LayoutOptions> = {}): LayoutResult {
  const result = layout(built, { ...paged, ...options });
  expectValid(result);
  expect(
    overlappingMarks(result).map(([a, b]) => [describePrimitive(a), describePrimitive(b)]),
  ).toEqual([]);
  return result;
}

function guitar(notation: 'tab' | 'both' | 'standard' = 'tab'): ScoreBuilder {
  return score().track('guitar', { display: { notation, octaveShift: 1 } });
}

/** What notes and beats drew, one line each, for data snapshots. */
function content(result: LayoutResult): string[] {
  return result.primitives
    .filter((p) => p.node !== undefined && (p.node.startsWith('beat') || p.node.startsWith('note')))
    .map(describePrimitive);
}

function texts(result: LayoutResult): string[] {
  return result.primitives.flatMap((p) =>
    p.kind === 'text' && (p.node?.startsWith('beat') || p.node?.startsWith('note')) ? [p.text] : [],
  );
}

const isText = (value: string) => (p: Primitive) => p.kind === 'text' && p.text === value;
const dashed = (p: Primitive) => p.kind === 'line' && p.dash !== undefined;
const arrows = (p: Primitive) => p.kind === 'path' && p.fill && p.d.split('L').length === 3;
const strokedPaths = (p: Primitive) => p.kind === 'path' && !p.fill;

describe('note effects on the tab: bends', () => {
  it('labels bends by amount: ¼ ½ ¾ full 1¼ 1½ 2', () => {
    expect([1, 2, 3, 4, 5, 6, 8, 0, -4, -2].map(bendLabel)).toEqual([
      '¼',
      '½',
      '¾',
      'full',
      '1¼',
      '1½',
      '2',
      '0',
      '-full',
      '-½',
    ]);
  });

  it('draws every bend kind with its arrows and labels', () => {
    const built = guitar()
      .bar()
      .beat('4', [note(3, 7, { bend: BENDS.quarter })])
      .beat('4', [note(3, 7, { bend: BENDS.half })])
      .beat('4', [note(3, 7, { bend: BENDS.oneAndHalf })])
      .beat('4', [note(3, 7, { bend: BENDS.two })])
      .bar()
      .beat('4', [note(3, 7, { bend: BENDS.bendRelease })])
      .beat('4', [note(3, 7, { bend: BENDS.bendReleaseBend })])
      .beat('4', [note(3, 7, { bend: BENDS.prebendBend })])
      .beat('4', [note(3, 7, { bend: BENDS.custom })])
      .bar()
      .beat('2', [note(3, 7, { bend: BENDS.prebend })])
      .beat('4', [note(3, 7, { tie: true, bend: BENDS.hold })])
      .beat('4', [note(3, 7, { tie: true, bend: BENDS.release })])
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(texts(result).filter((t) => t !== '7' && t !== '(7)')).toEqual([
      '¼',
      '½',
      '1½',
      '2',
      'full',
      'full',
      'full',
      '½',
      'full',
      '½',
      'full',
      '¾',
      'full',
    ]);
    // The tied hold continues at the tip with a dashed line and no new arrow.
    expect(result.primitives.filter(dashed).length).toBeGreaterThanOrEqual(3);
    expect(content(result)).toMatchSnapshot();
  });

  it('shares one tip, arrowhead and label between equal bends of a chord', () => {
    const result = laid(
      guitar()
        .bar()
        .beat('1', [note(2, 8, { bend: BENDS.half }), note(3, 7, { bend: BENDS.half })])
        .build({ ids: 'sequential' }),
    );
    expect(result.primitives.filter(arrows)).toHaveLength(1);
    expect(result.primitives.filter(isText('½'))).toHaveLength(1);
    expect(result.primitives.filter(strokedPaths)).toHaveLength(2);
  });

  it('draws bends on the tab in both mode and nothing of them on the standard staff', () => {
    const result = laid(
      guitar('both')
        .bar()
        .beat('1', [note(3, 7, { bend: BENDS.full })])
        .build({ ids: 'sequential' }),
    );
    const [system] = result.systems;
    const tab = system?.staves.find((staff) => staff.type === 'tab');
    const standard = system?.staves.find((staff) => staff.type === 'standard');
    const arrow = result.primitives.find(arrows);
    expect(tab && standard && arrow).toBeTruthy();
    if (tab && standard && arrow) {
      expect(arrow.bbox.y).toBeGreaterThan(standard.bottom);
      expect(arrow.bbox.y).toBeLessThan(tab.top);
    }
  });
});

describe('note effects on the tab: slides and hammer-ons', () => {
  it('draws shift, legato, into and out slides', () => {
    const built = guitar()
      .bar()
      .beat('8', [note(3, 5, { slide: ['shift'] })])
      .beat('8', [note(3, 7, { slide: ['shift'] })])
      .beat('8', [note(3, 5, { slide: ['legato'] })])
      .beat('8', [note(3, 7)])
      .beat('8', [note(2, 5, { slide: ['intoFromBelow'] })])
      .beat('8', [note(2, 5, { slide: ['intoFromAbove'] })])
      .beat('8', [note(2, 5, { slide: ['outDown'] })])
      .beat('8', [note(2, 5, { slide: ['outUp', 'shift'] })])
      .bar()
      .beat('2', [note(2, 9)], {
        grace: [{ duration: 16, before: true, notes: [note(2, 7, { slide: ['legato'] })] }],
      })
      .beat('2', [note(2, 9)])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const slides = result.primitives.filter(
      (p) => p.kind === 'line' && p.y !== p.y2 && p.x !== p.x2,
    );
    // Shift up rises: its right end is higher on the page.
    const [up, down] = slides;
    expect(up && up.kind === 'line' && up.y2 < up.y).toBe(true);
    expect(down && down.kind === 'line' && down.y2 > down.y).toBe(true);
    expect(result.primitives.filter(isText('sl.'))).toHaveLength(2);
    expect(content(result)).toMatchSnapshot();
  });

  it('writes H and P over knockouts at the arc apex, up from strings 1 to 3 and down from 4 to 6', () => {
    const built = guitar()
      .bar()
      .beat('8', [note(1, 5)])
      .beat('8', [note(1, 7, { hammerPull: true })])
      .beat('8', [note(1, 5, { hammerPull: true })])
      .beat('8', [note(5, 5)])
      .beat('8', [note(5, 7, { hammerPull: true })])
      .beat('8', [note(5, 5, { hammerPull: true })])
      .beat('8', [note(2, 5), note(3, 5)])
      .beat('8', [note(2, 7, { hammerPull: true }), note(3, 7, { hammerPull: true })])
      .bar()
      .beat('1', [note(4, 7, { hammerPull: true })], {
        grace: [{ duration: 16, before: true, notes: [note(4, 5)] }],
      })
      .build({ ids: 'sequential' });
    const result = laid(built);
    const letters = result.primitives.filter((p) => p.kind === 'text' && /^[HP]$/.test(p.text));
    expect(letters.map((p) => (p.kind === 'text' ? p.text : ''))).toEqual([
      'H',
      'P',
      'H',
      'P',
      'H',
      'H',
    ]);
    const [system] = result.systems;
    const tab = system?.staves[0];
    const [h1, p1, h5, p5, double] = letters;
    if (!tab || !h1 || !p1 || !h5 || !p5 || !double) throw new Error('letters');
    expect(h1.bbox.y + h1.bbox.height).toBeLessThan(tab.top);
    expect(p1.bbox.y + p1.bbox.height).toBeLessThan(tab.top);
    expect(h5.bbox.y).toBeGreaterThan(tab.top + 4 * 10.5);
    expect(p5.bbox.y).toBeGreaterThan(tab.top + 4 * 10.5);
    // The double stop's letter sits over string 2, the outer of its two upward arcs.
    expect(double.bbox.y + double.bbox.height).toBeLessThan(tab.top + 10.5);
    const knockouts = result.primitives.filter(
      (p) =>
        p.role === 'paper' &&
        letters.some(
          (letter) =>
            letter.node === p.node &&
            p.bbox.x < letter.x &&
            p.bbox.x + p.bbox.width > letter.x &&
            p.bbox.y < letter.y,
        ),
    );
    expect(knockouts.length).toBeGreaterThanOrEqual(letters.length);
    expect(content(result)).toMatchSnapshot();
  });
});

describe('note effects on the tab: lanes', () => {
  it('merges consecutive palm mutes into one label, dashed line and end tick; a lone one is a label', () => {
    const pm = { palmMute: true };
    const built = guitar()
      .bar()
      .beat('8', [note(6, 0, pm)])
      .beat('8', [note(6, 0, pm)])
      .beat('8', [note(6, 0, pm)])
      .beat('8', [note(6, 0, pm)])
      .beat('8', [note(6, 0)])
      .beat('8', [note(6, 0, pm)])
      .beat('8', [note(6, 0)])
      .beat('8', [note(6, 0, { letRing: true })])
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(result.primitives.filter(isText('P.M.'))).toHaveLength(2);
    expect(result.primitives.filter(isText('let ring'))).toHaveLength(1);
    expect(result.primitives.filter(dashed)).toHaveLength(1);
    const ticks = result.primitives.filter(
      (p) =>
        p.kind === 'line' && p.x === p.x2 && p.node === 'beat00000001' && Math.abs(p.y2 - p.y) < 7,
    );
    expect(ticks).toHaveLength(1);
  });

  it('labels harmonics on the tab and in their lane, by kind', () => {
    const built = guitar()
      .bar()
      .beat('8', [note(3, 12, { harmonic: { kind: 'natural' } })])
      .beat('8', [note(3, 0, { harmonic: { kind: 'natural', value: 2.7 } })])
      .beat('8', [note(3, 5, { harmonic: { kind: 'artificial' } })])
      .beat('8', [note(3, 5, { harmonic: { kind: 'tapped', value: 7 } })])
      .beat('8', [note(3, 5, { harmonic: { kind: 'pinch', value: 12 } })])
      .beat('8', [note(3, 5, { harmonic: { kind: 'semi', value: 12 } })])
      .beat('8', [note(3, 5, { harmonic: { kind: 'feedback', value: 12 } })])
      .beat('8', [note(3, 5, { trill: { fret: 7, speed: 16 }, harmonic: { kind: 'pinch' } })])
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(texts(result)).toEqual(
      [
        '<12>',
        '<2.7>',
        '5',
        '<17>',
        '5',
        '<12>',
        '5',
        '<17>',
        '5',
        '<17>',
        '5',
        '<17>',
        '5',
        '(7)',
        'N.H.',
        'A.H.',
        'T.H.',
        'P.H.',
        'S.H.',
        'Fdbk.',
        'P.H.',
        'tr',
      ].filter((t) => t !== 'tr'),
    );
  });

  it('draws beat marks: tapping, slapping, popping, pick strokes and fades', () => {
    const built = guitar()
      .bar()
      .beat('8', [note(1, 5)], { effects: { tapping: true } })
      .beat('8', [note(1, 5)], { effects: { slapping: true } })
      .beat('8', [note(1, 5)], { effects: { popping: true } })
      .beat('8', [note(1, 5)], { effects: { pickStroke: 'down' } })
      .beat('8', [note(1, 5)], { effects: { pickStroke: 'up' } })
      .beat('8', [note(1, 5)], { effects: { fadeIn: true } })
      .beat('8', [note(1, 5)], { effects: { fadeOut: true } })
      .beat('8', [note(1, 5)], { effects: { volumeSwell: true } })
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(texts(result).filter((t) => /^[TSP]$/.test(t))).toEqual(['T', 'S', 'P']);
    expect(
      result.primitives.flatMap((p) =>
        p.kind === 'glyph' && !p.glyph.startsWith('flag') ? [p.glyph] : [],
      ),
    ).toEqual(
      expect.arrayContaining([
        'stringsDownBow',
        'stringsUpBow',
        'guitarFadeIn',
        'guitarFadeOut',
        'guitarVolumeSwell',
      ]),
    );
    expect(content(result)).toMatchSnapshot();
  });

  it('draws one wave per bar for consecutive vibrato, joined across the bar line', () => {
    const built = guitar()
      .bar()
      .beat('2', [note(2, 5)])
      .beat('4', [note(2, 5, { vibrato: 'slight' })])
      .beat('4', [note(2, 5, { vibrato: 'wide' })])
      .bar()
      .beat('4', [note(2, 5, { vibrato: 'slight' })])
      .beat('4', [note(2, 5)], { effects: { vibrato: 'wide' } })
      .beat('4', [note(2, 5, { trill: { fret: 7, speed: 16 } })])
      .beat('4', [note(2, 5, { trill: { fret: 7, speed: 16 } })])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const waves = result.primitives.filter(
      (p) => p.kind === 'path' && !p.fill && p.d.includes('Q'),
    );
    // Vibrato in bar 1 and its continuation in bar 2, then one trill wave.
    expect(waves).toHaveLength(3);
    const [first, second] = waves;
    if (!first || !second) throw new Error('waves');
    expect(first.bbox.y + first.bbox.height / 2).toBeCloseTo(
      second.bbox.y + second.bbox.height / 2,
      1,
    );
    expect(first.bbox.x + first.bbox.width).toBeGreaterThan(second.bbox.x - 12);
    expect(
      result.primitives.filter((p) => p.kind === 'glyph' && p.glyph === 'ornamentTrill'),
    ).toHaveLength(1);
    expect(
      result.primitives.filter(
        (p) => p.kind === 'path' && !p.fill && p.d.includes('L') && !p.d.includes('Q'),
      ),
    ).toHaveLength(1);
    expect(content(result)).toMatchSnapshot();
  });

  it('graphs whammy dives, dips and returns with one w/bar per run and labels at the extremes', () => {
    const point = (position: number, value: number) => ({ position, value });
    const built = guitar()
      .bar()
      .beat('4', [note(3, 0)], {
        effects: { whammy: { kind: 'dive', points: [point(0, 0), point(60, -8)] } },
      })
      .beat('4', [note(3, 0)], {
        effects: { whammy: { kind: 'dip', points: [point(0, 0), point(30, -4), point(60, 0)] } },
      })
      .beat('4', [note(3, 0)])
      .beat('4', [note(3, 0)], {
        effects: { whammy: { kind: 'return', points: [point(0, -4), point(60, 0)] } },
      })
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(result.primitives.filter(isText('w/bar'))).toHaveLength(2);
    expect(texts(result).filter((t) => t.startsWith('-'))).toEqual(['-2', '-full', '-full']);
  });

  it('stacks articulations in tab mode, staccato nearest, and leaves them to the standard staff in both mode', () => {
    const accented = (built: ScoreBuilder) =>
      built
        .bar()
        .beat('4', [note(2, 5, { staccato: true, accent: 'accent' })])
        .beat('4', [note(2, 5, { accent: 'heavy' }), note(3, 5, { staccato: true })])
        .build({ ids: 'sequential' });
    const tab = laid(accented(guitar()));
    const glyphs = tab.primitives.flatMap((p) =>
      p.kind === 'glyph' && p.glyph.startsWith('artic') ? [p] : [],
    );
    expect(glyphs.map((p) => p.glyph)).toEqual([
      'articStaccatoAbove',
      'articAccentAbove',
      'articStaccatoAbove',
      'articMarcatoAbove',
    ]);
    const [staccato, accent] = glyphs;
    if (!staccato || !accent) throw new Error('glyphs');
    expect(accent.bbox.y + accent.bbox.height).toBeLessThan(staccato.bbox.y);
    const both = laid(accented(guitar('both')));
    expect(both.primitives.some((p) => p.kind === 'glyph' && p.glyph.startsWith('artic'))).toBe(
      false,
    );
  });

  it('draws tremolo strokes on the stems, lengthening them where the strokes need room', () => {
    const built = guitar()
      .bar()
      .beat('8', [note(1, 5)], { effects: { tremoloPicking: 8 } })
      .beat('8', [note(1, 5)])
      .beat('16', [note(1, 5)], { effects: { tremoloPicking: 32 } })
      .beat('16', [note(1, 5)])
      .beat('8', [note(1, 5)])
      .beat('4', [note(1, 5)], { effects: { tremoloPicking: 16 } })
      .bar()
      .beat('1', [note(1, 5)], { effects: { tremoloPicking: 32 } })
      .build({ ids: 'sequential' });
    const result = laid(built);
    const strokes = result.primitives.flatMap((p) =>
      p.kind === 'glyph' && p.glyph.startsWith('tremolo') ? [p] : [],
    );
    expect(strokes.map((p) => p.glyph)).toEqual(['tremolo1', 'tremolo3', 'tremolo2', 'tremolo3']);
    const plain = laid(
      guitar()
        .bar()
        .beat('8', [note(1, 5)])
        .beat('16', [note(1, 5)])
        .beat('16', [note(1, 5)])
        .build({ ids: 'sequential' }),
    );
    const stemEnd = (r: LayoutResult) =>
      Math.max(
        ...r.primitives.flatMap((p) =>
          p.kind === 'line' && p.x === p.x2 && p.node?.startsWith('beat') ? [p.y2] : [],
        ),
      );
    const top = (r: LayoutResult) => r.systems[0]?.staves[0]?.top ?? 0;
    expect(stemEnd(result) - top(result)).toBeGreaterThan(stemEnd(plain) - top(plain));
  });

  it('draws arpeggio waves and brush lines with arrows toward string 1 for down and away for up', () => {
    const chord = () => [note(1, 0), note(2, 1), note(3, 0)];
    const built = guitar()
      .bar()
      .beat('4', chord(), { effects: { arpeggio: { direction: 'down' } } })
      .beat('4', chord(), { effects: { arpeggio: { direction: 'up' } } })
      .beat('4', chord(), { effects: { brush: { direction: 'down' } } })
      .beat('4', chord(), { effects: { brush: { direction: 'up' } } })
      .build({ ids: 'sequential' });
    const result = laid(built);
    const heads = result.primitives.filter(arrows);
    expect(heads).toHaveLength(4);
    // An arrowhead's path starts at its tip: at the top of its box when it points up.
    const pointsUp = heads.map(
      (p) => Number(/^M\S+ ([^L]+)L/.exec(p.kind === 'path' ? p.d : '')?.[1]) === p.bbox.y,
    );
    expect(pointsUp).toEqual([true, false, true, false]);
    expect(content(result)).toMatchSnapshot();
  });
});

/** Three bars whose runs, slide and hammer-on cross from bar 1 into bar 2. */
function acrossBars(): Score {
  const run = {
    palmMute: true,
    letRing: true,
    vibrato: 'slight' as const,
    trill: { fret: 7, speed: 16 as const },
  };
  return guitar()
    .bar()
    .beat('4', [note(3, 5)])
    .beat('4', [note(3, 5)])
    .beat('4', [note(2, 5, run)])
    .beat('4', [note(2, 5, run), note(3, 5, { slide: ['shift'] }), note(1, 5)])
    .bar()
    .beat('4', [note(2, 5, run), note(3, 7), note(1, 7, { hammerPull: true })])
    .beat('4', [note(2, 5, run)])
    .beat('2', [note(2, 5)])
    .bar()
    .beat('1', [note(2, 5)])
    .build({ ids: 'sequential' });
}

function inSystem(
  result: LayoutResult,
  index: number,
  keep: (p: Primitive) => boolean,
): Primitive[] {
  const system = result.systems[index];
  if (!system) return [];
  return result.primitives.slice(system.primitives.start, system.primitives.end).filter(keep);
}

const endTick = (p: Primitive) =>
  p.kind === 'line' &&
  p.x === p.x2 &&
  p.dash === undefined &&
  Math.abs(p.y2 - p.y) < 6 &&
  p.node?.startsWith('beat') === true;
const wave = (p: Primitive) => p.kind === 'path' && !p.fill && p.d.includes('Q');
const trill = (p: Primitive) => p.kind === 'glyph' && p.glyph === 'ornamentTrill';
const slideLine = (p: Primitive) => p.kind === 'line' && p.x !== p.x2 && p.y !== p.y2;

describe('note effects across bar lines and system breaks', () => {
  it('repeats run labels at the start of a paged line and ends the first line without an end tick', () => {
    const result = laid(acrossBars(), { width: 400 });
    expect(result.systems.map(({ bars }) => bars)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 3 },
    ]);
    for (const label of ['P.M.', 'let ring']) {
      expect(inSystem(result, 0, isText(label))).toHaveLength(1);
      expect(inSystem(result, 1, isText(label))).toHaveLength(1);
    }
    expect([inSystem(result, 0, trill).length, inSystem(result, 1, trill).length]).toEqual([1, 1]);
    expect(inSystem(result, 0, endTick)).toHaveLength(0);
    expect(inSystem(result, 1, endTick)).toHaveLength(2);
    // Vibrato and trill: one wave each per line.
    expect([inSystem(result, 0, wave).length, inSystem(result, 1, wave).length]).toEqual([2, 2]);
    const system = result.systems[0];
    const ends = inSystem(result, 0, dashed).map((p) => (p.kind === 'line' ? p.x2 : 0));
    if (system) for (const end of ends) expect(end).toBeLessThan(system.bbox.x + system.bbox.width);
  });

  it('draws a slide and a hammer-on across a system break as two halves, the letter on the second', () => {
    const result = laid(acrossBars(), { width: 400 });
    expect([inSystem(result, 0, slideLine).length, inSystem(result, 1, slideLine).length]).toEqual([
      1, 1,
    ]);
    expect(inSystem(result, 0, isText('H'))).toHaveLength(0);
    expect(inSystem(result, 1, isText('H'))).toHaveLength(1);
  });

  it('draws them in one piece across a bar line within a line', () => {
    const result = laid(acrossBars());
    expect(result.systems).toHaveLength(1);
    expect(result.primitives.filter(slideLine)).toHaveLength(1);
    expect(result.primitives.filter(isText('P.M.'))).toHaveLength(1);
    expect(result.primitives.filter(endTick)).toHaveLength(2);
  });

  it('does not repeat labels where a continuous line is cut into segments', () => {
    const result = laid(acrossBars(), { mode: 'continuous', width: 300 });
    expect(result.systems.map(({ bars }) => bars.start)).toEqual([0, 1]);
    expect(result.primitives.filter(isText('P.M.'))).toHaveLength(1);
    expect(result.primitives.filter(isText('let ring'))).toHaveLength(1);
    expect(result.primitives.filter(trill)).toHaveLength(1);
  });
});

describe('note effect lanes', () => {
  it('stacks five and more effects on one beat in lane order without overlap', () => {
    const built = guitar()
      .bar()
      .beat(
        '1',
        [
          note(3, 7, {
            bend: BENDS.full,
            palmMute: true,
            letRing: true,
            vibrato: 'slight',
            accent: 'accent',
            harmonic: { kind: 'artificial', value: 12 },
          }),
        ],
        { effects: { pickStroke: 'down', fadeIn: true, tapping: true } },
      )
      .build({ ids: 'sequential' });
    const result = laid(built);
    const find = (keep: (p: Primitive) => boolean): Primitive => {
      const found = result.primitives.find(keep);
      if (!found) throw new Error('missing');
      return found;
    };
    const glyphNamed = (name: string) => (p: Primitive) => p.kind === 'glyph' && p.glyph === name;
    const upward = [
      find(isText('full')),
      find(glyphNamed('articAccentAbove')),
      find(glyphNamed('stringsDownBow')),
      find(isText('P.M.')),
      find(isText('let ring')),
      find(isText('A.H.')),
      find(glyphNamed('guitarFadeIn')),
      find(isText('T')),
      find(wave),
    ];
    for (const [i, item] of upward.entries()) {
      const below = upward[i - 1];
      if (below) expect(item.bbox.y + item.bbox.height).toBeLessThanOrEqual(below.bbox.y + 0.02);
    }
  });

  it('lines up effect rows, words and lyrics across the bars of a system', () => {
    const built = guitar()
      .bar()
      .beat('1', [note(3, 5, { palmMute: true })], { chord: { name: 'A' }, lyrics: ['one'] })
      .bar()
      .beat('1', [note(3, 5, { palmMute: true, bend: BENDS.full })], {
        chord: { name: 'B' },
        lyrics: ['two'],
      })
      .voice(1)
      .beat('2', [note(1, 0)])
      .beat('2', [note(1, 0)])
      .bar()
      .beat('1', [note(3, 5, { palmMute: true })], { chord: { name: 'C' }, lyrics: ['three'] })
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(result.systems).toHaveLength(1);
    const ys = (values: string[]) =>
      new Set(
        result.primitives
          .filter((p) => p.kind === 'text' && values.includes(p.text))
          .map((p) => p.y),
      );
    expect(ys(['A', 'B', 'C']).size).toBe(1);
    expect(ys(['P.M.']).size).toBe(1);
    expect(ys(['one', 'two', 'three']).size).toBe(1);
  });

  it('finds overlapping marks when there are some', () => {
    const result = laid(
      guitar()
        .bar()
        .beat('1', [note(3, 5, { palmMute: true })])
        .build({ ids: 'sequential' }),
    );
    const label = result.primitives.find(isText('P.M.'));
    const system = result.systems[0];
    if (!label || !system) throw new Error('label');
    const moved = { ...label, bbox: { ...label.bbox, x: label.bbox.x + 1 } };
    const primitives = [...result.primitives, moved];
    const systems = [{ ...system, primitives: { start: 0, end: primitives.length } }];
    expect(overlappingMarks({ ...result, primitives, systems })).toHaveLength(1);
  });

  it('lays out a score with every effect in every mode without overlapping marks', () => {
    const built = everyEffectScore();
    const ids = built.tracks.map(({ id }) => id);
    for (const notation of ['tab', 'standard', 'both'] as const) {
      laid(built, { notation: Object.fromEntries(ids.map((id) => [id, notation])) });
    }
    laid(built, { mode: 'continuous', width: 1200 });
  });

  it('keeps a cached layout equal to a cold one when an effect changes on either side of a break', () => {
    const built = acrossBars();
    const options = { ...paged, width: 400 };
    const cache = new LayoutCache();
    layout(built, options, cache);
    const pm = applyCommand(
      built,
      setNoteEffect({ noteId: noteOf(built, 0, 1, 0).id }, { palmMute: false }),
    );
    const afterPm = layout(pm.score, { ...options, dirtyBars: pm.change.touchedBars }, cache);
    expect(afterPm.metrics.measuredBars).toBe(1);
    expect(stable(afterPm)).toBe(stable(layout(pm.score, options)));
    const vibrato = applyCommand(
      pm.score,
      setBeatEffect({ beatId: beatOf(pm.score, 0, 0, 3).id }, { effects: { vibrato: 'wide' } }),
    );
    const afterVibrato = layout(
      vibrato.score,
      { ...options, dirtyBars: vibrato.change.touchedBars },
      cache,
    );
    expect(afterVibrato.metrics.measuredBars).toBe(1);
    expect(stable(afterVibrato)).toBe(stable(layout(vibrato.score, options)));
  });
});
