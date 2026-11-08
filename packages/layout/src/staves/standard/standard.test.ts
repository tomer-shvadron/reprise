import {
  applyCommand,
  setMasterBar,
  setNote,
  type Clef,
  type Dynamics,
  type Note,
  type Score,
} from '@reprise/model';
import { beatOf, largeScore, midi, note, score, type ScoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  LayoutCache,
  PAGE_SIZES,
  layout,
  type LayoutOptions,
  type LayoutResult,
  type Rect,
} from '../../index';
import { expectValid, stable, strayPrimitives } from '../../test/check-result';
import { describePrimitive } from '../../test/describe';
import type { StaffBar } from '../staff-module';
import { MARGIN, planBar, type BarPlan } from './plan';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

const piano = { display: { notation: 'standard', octaveShift: 0 } } as const;

function laid(built: Score, options: Partial<LayoutOptions> = {}): LayoutResult {
  const result = layout(built, { ...paged, ...options });
  expectValid(result);
  return result;
}

/** What the staff module drew: every primitive of a note, beat or bar-content node. */
function content(result: LayoutResult): string[] {
  return result.primitives
    .filter(({ node }) => node !== undefined && /^(note|beat)/.test(node))
    .map(describePrimitive);
}

function glyphNames(result: LayoutResult, pattern: RegExp): string[] {
  return result.primitives.flatMap((primitive) =>
    primitive.kind === 'glyph' && pattern.test(primitive.glyph) ? [primitive.glyph] : [],
  );
}

function staffBar(built: Score, barIndex: number, track = 0, clef: Clef = 'treble'): StaffBar {
  const t = built.tracks[track];
  const bar = t?.bars[barIndex];
  const masterBar = built.masterBars[barIndex];
  if (!t || !bar || !masterBar) throw new Error('no such bar');
  return {
    score: built,
    track: t,
    trackIndex: track,
    staves: ['standard'],
    bar,
    masterBar,
    barIndex,
    clef,
    keySignature: masterBar.keySignature,
    space: 7,
  };
}

function plan(built: Score, barIndex = 0, courtesyAccidentals = true): BarPlan {
  return planBar(staffBar(built, barIndex), { percussion: false, courtesyAccidentals });
}

function accidentals(p: BarPlan): string[] {
  return p.beats.flatMap(({ chord, graces }) =>
    [...graces.map((grace) => grace.chord), ...(chord ? [chord] : [])].flatMap(({ heads }) =>
      heads.flatMap(({ accidental }) => (accidental ? [accidental.glyphs.join('+')] : [])),
    ),
  );
}

function quarters(builder: ScoreBuilder, notes: readonly Note[][]): ScoreBuilder {
  for (const chord of notes) builder.beat('4', chord);
  return builder;
}

describe('standard staff', () => {
  it('places notes by clef and octave shift', () => {
    const clefs: [Clef, number][] = [
      ['treble', 0],
      ['treble', 1],
      ['bass', 0],
      ['bass', 1],
      ['alto', 0],
      ['tenor', 0],
    ];
    const builder = score();
    for (const [clef, octaveShift] of clefs) {
      builder.track('piano', { display: { notation: 'standard', clef, octaveShift } }).bar();
      quarters(builder, [[midi(48)], [midi(55)], [midi(60)], [midi(67)]]);
    }
    const built = builder.build({ ids: 'sequential' });
    const positions = clefs.map(([clef], t) =>
      planBar(staffBar(built, 0, t, clef), {
        percussion: false,
        courtesyAccidentals: true,
      }).beats.map(({ chord }) => chord?.heads[0]?.position),
    );
    expect(positions).toEqual([
      [-9, -5, -2, 2],
      [-2, 2, 5, 9],
      [3, 7, 10, 14],
      [10, 14, 17, 21],
      [-3, 1, 4, 8],
      [-1, 3, 6, 10],
    ]);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('spells against every key, from seven flats to seven sharps', () => {
    const builder = score().track('piano', piano);
    for (let fifths = -7; fifths <= 7; fifths++) {
      builder.bar().key(fifths);
      quarters(builder, [[midi(60)], [midi(61)], [midi(66)], [midi(70)]]);
    }
    const built = builder.build({ ids: 'sequential' });
    const shown = built.masterBars.map((_, i) => accidentals(plan(built, i, false)));
    expect(shown).toMatchSnapshot();
    expect(shown[7]).toEqual(['accidentalSharp', 'accidentalSharp', 'accidentalSharp']);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('remembers accidentals through the bar and reminds of them in the next', () => {
    const built = quarters(score().track('piano', piano).bar(), [
      [midi(61)],
      [midi(61)],
      [midi(60)],
      [midi(73)],
    ])
      .bar()
      .beat('2', [midi(60)])
      .beat('2', [midi(72)])
      .build({ ids: 'sequential' });
    expect(accidentals(plan(built, 0))).toEqual([
      'accidentalSharp',
      'accidentalNatural',
      'accidentalSharp',
    ]);
    expect(accidentals(plan(built, 1))).toEqual([
      'accidentalParensLeft+accidentalNatural+accidentalParensRight',
    ]);
    expect(accidentals(plan(built, 1, false))).toEqual([]);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('shows no accidental on a tied note and restates it after', () => {
    const built = score()
      .track('piano', piano)
      .bar()
      .beat('2', [midi(61)])
      .beat('2', [midi(61, { tie: true })])
      .bar()
      .beat('2', [midi(61, { tie: true })])
      .beat('2', [midi(61)])
      .build({ ids: 'sequential' });
    expect(accidentals(plan(built, 0))).toEqual(['accidentalSharp']);
    expect(accidentals(plan(built, 1))).toEqual(['accidentalSharp']);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('prints a plain natural after a tied-in sharp, and restates the sharp', () => {
    const built = score()
      .track('piano', piano)
      .bar()
      .beat('1', [midi(61)])
      .bar()
      .beat('4', [midi(61, { tie: true })])
      .beat('4', [midi(60)])
      .beat('4', [midi(61)])
      .beat('4', [midi(61)])
      .build({ ids: 'sequential' });
    for (const courtesy of [true, false]) {
      expect(accidentals(plan(built, 1, courtesy))).toEqual([
        'accidentalNatural',
        'accidentalSharp',
      ]);
    }
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('moves a head a second from its neighbour to the other side of the stem', () => {
    const built = score()
      .track('piano', piano)
      .bar()
      .beat('2', [midi(60), midi(62), midi(64)])
      .beat('2', [midi(71), midi(72), midi(76), midi(77)])
      .build({ ids: 'sequential' });
    const [up, down] = plan(built).beats;
    expect(up?.chord?.direction).toBe('up');
    expect(down?.chord?.direction).toBe('down');
    const lefts = (chord: typeof up) => chord?.chord?.heads.map(({ left }) => left) ?? [];
    const [c, d, e] = lefts(up);
    expect(d).toBeGreaterThan(c ?? 0);
    expect(e).toBe(c);
    const [b, cc, ee, f] = lefts(down);
    expect(b).toBeLessThan(cc ?? 0);
    expect(ee).toBe(b);
    expect(f).toBe(cc);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('stacks the accidentals of a chord in columns', () => {
    const built = score()
      .track('piano', piano)
      .bar()
      .beat('1', [midi(61), midi(63), midi(66), midi(68)])
      .build({ ids: 'sequential' });
    const heads = plan(built).beats[0]?.chord?.heads ?? [];
    const columns = new Set(heads.map(({ accidental }) => accidental?.left));
    expect(columns.size).toBeGreaterThan(1);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('points stems by the note furthest from the middle line', () => {
    const built = quarters(score().track('piano', piano).bar(), [
      [midi(60)],
      [midi(71)],
      [midi(64), midi(81)],
      [midi(57), midi(72)],
    ]).build({ ids: 'sequential' });
    expect(plan(built).beats.map(({ chord }) => chord?.direction)).toEqual([
      'up',
      'down',
      'down',
      'up',
    ]);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('draws ledger lines above and below, the stems reaching the middle line', () => {
    const built = quarters(score().track('piano', piano).bar(), [
      [midi(48)],
      [midi(57)],
      [midi(84)],
      [midi(93)],
    ]).build({ ids: 'sequential' });
    const p = plan(built);
    expect(p.beats.map(({ chord }) => chord?.ledgers.length)).toEqual([4, 2, 2, 4]);
    for (const { chord } of p.beats) expect(chord?.tip).toBe(14);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('beams eighths by the half bar and sixteenths by the beat in 4/4', () => {
    const builder = score().track('piano', piano).bar();
    for (let i = 0; i < 4; i++) builder.beat('8', [midi(64 + i)]);
    builder
      .beat('16', [midi(72)])
      .beat('16', [midi(74)])
      .beat('16', [midi(76)])
      .beat('16', [midi(77)]);
    builder.beat('8.', [midi(67)]).beat('16', [midi(65)]);
    const built = builder.build({ ids: 'sequential' });
    expect(plan(built).groups.map(({ beats }) => beats.length)).toEqual([4, 4, 2]);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('beams 3/4 by the beat and 6/8 by the dotted quarter', () => {
    const builder = score().timeSignature(3, 4).track('piano', piano).bar();
    for (let i = 0; i < 6; i++) builder.beat('8', [midi(60 + i)]);
    builder.bar().timeSignature(6, 8);
    for (let i = 0; i < 6; i++) builder.beat('8', [midi(72 - i)]);
    const built = builder.build({ ids: 'sequential' });
    expect(plan(built, 0).groups.map(({ beats }) => beats.length)).toEqual([2, 2, 2]);
    expect(plan(built, 1).groups.map(({ beats }) => beats.length)).toEqual([3, 3]);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('beams 2/2 eighths by the half note and sixteenths by the quarter', () => {
    const builder = score().timeSignature(2, 2).track('piano', piano).bar();
    for (let i = 0; i < 8; i++) builder.beat('8', [midi(60 + i)]);
    builder.bar();
    for (let i = 0; i < 16; i++) builder.beat('16', [midi(72 - (i % 4))]);
    const built = builder.build({ ids: 'sequential' });
    expect(plan(built, 0).groups.map(({ beats }) => beats.length)).toEqual([4, 4]);
    expect(plan(built, 1).groups.map(({ beats }) => beats.length)).toEqual([4, 4, 4, 4]);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('keeps beams of repeated pitches horizontal and others within a space', () => {
    const builder = score().track('piano', piano).bar();
    builder
      .beat('8', [midi(67)])
      .beat('8', [midi(67)])
      .rest('4');
    builder
      .beat('8', [midi(60)])
      .beat('8', [midi(79)])
      .rest('4');
    const result = laid(builder.build({ ids: 'sequential' }));
    const beams = result.primitives.filter(
      (primitive) => primitive.kind === 'path' && primitive.fill,
    );
    expect(beams).toHaveLength(2);
    const [flat, steep] = beams;
    expect(flat?.bbox.height).toBeCloseTo(3.5, 1);
    expect(steep?.bbox.height).toBeLessThanOrEqual(3.5 + 7 + 0.5);
    expect(content(result)).toMatchSnapshot();
  });

  it('places rests by voice', () => {
    const built = score()
      .track('piano', piano)
      .bar()
      .rest('1')
      .bar()
      .rest('2')
      .rest('4')
      .rest('8')
      .rest('16.')
      .rest('32')
      .bar()
      .beat('2', [midi(72)])
      .rest('2')
      .voice(1)
      .rest('2')
      .beat('2', [midi(60)])
      .build({ ids: 'sequential' });
    expect(plan(built, 0).beats[0]?.rest?.centred).toBe(true);
    const twoVoices = plan(built, 2);
    expect(twoVoices.multiVoice).toBe(true);
    const restYs = twoVoices.beats.flatMap(({ rest }) => (rest ? [rest.y] : []));
    expect(restYs[0]).toBeLessThan(restYs[1] ?? 0);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('stems voice 1 up and voice 2 down whatever their pitch', () => {
    const built = score()
      .track('piano', piano)
      .bar()
      .beat('2', [midi(60)])
      .beat('2', [midi(64)])
      .voice(1)
      .beat('2', [midi(79)])
      .beat('2', [midi(81)])
      .build({ ids: 'sequential' });
    expect(plan(built).beats.map(({ voice, chord }) => [voice, chord?.direction])).toEqual([
      [0, 'up'],
      [0, 'up'],
      [1, 'down'],
      [1, 'down'],
    ]);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('ties across a bar line in one piece, and in halves across a system break', () => {
    const builder = score().track('piano', piano);
    for (let b = 0; b < 12; b++) {
      builder.bar();
      builder.beat('2', [midi(64, { tie: b > 0 })]).beat('2', [midi(64)]);
    }
    const built = builder.build({ ids: 'sequential' });
    const result = laid(built, { zoom: 2 });
    expect(result.systems.length).toBeGreaterThan(1);
    const ties = result.primitives.filter(
      (primitive) => primitive.kind === 'path' && primitive.d.includes('C'),
    );
    expect(ties).toHaveLength(11 + result.systems.length - 1);
    expect(ties.map(describePrimitive)).toMatchSnapshot();
  });

  it('marks tuplets with a number over a beam and a bracket otherwise', () => {
    const built = score()
      .track('piano', piano)
      .bar()
      .beat('8t', [midi(72)])
      .beat('8t', [midi(71)])
      .beat('8t', [midi(69)])
      .beat('4t', [midi(64)])
      .beat('8t', [midi(65)])
      .rest('2')
      .build({ ids: 'sequential' });
    expect(plan(built).tuplets.map(({ bracket }) => bracket)).toEqual([false, true]);
    const result = laid(built);
    expect(glyphNames(result, /^tuplet/)).toEqual(['tuplet3', 'tuplet3']);
    expect(content(result)).toMatchSnapshot();
  });

  it('closes a tuplet of unequal values on a plain note value and one of equal values at n', () => {
    const quintuplet = { tuplet: { n: 5, of: 4 } };
    const built = score()
      .track('piano', piano)
      .bar()
      .beat('4t', [midi(64)])
      .beat('8t', [midi(65)])
      .beat('4t', [midi(67)])
      .beat('4t', [midi(69)])
      .beat('4t', [midi(71)])
      .bar()
      .beat('8t', [midi(72)])
      .beat('8t', [midi(72)])
      .beat('8t', [midi(72)])
      .beat('16', [midi(72)], quintuplet)
      .beat('16', [midi(74)], quintuplet)
      .beat('16', [midi(76)], quintuplet)
      .beat('16', [midi(77)], quintuplet)
      .beat('16', [midi(79)], quintuplet)
      .rest('2')
      .build({ ids: 'sequential' });
    const sizes = (bar: number) =>
      plan(built, bar).tuplets.map(({ beats, n }) => [n, beats.length]);
    expect(sizes(0)).toEqual([
      [3, 2],
      [3, 3],
    ]);
    expect(sizes(1)).toEqual([
      [3, 3],
      [5, 5],
    ]);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('draws grace notes small, a single one slashed and several beamed', () => {
    const built = score()
      .track('piano', piano)
      .bar()
      .beat('2', [midi(64)], { grace: [{ duration: 16, before: true, notes: [midi(62)] }] })
      .beat('2', [midi(65)], {
        grace: [
          { duration: 16, before: true, notes: [midi(67)] },
          { duration: 16, before: true, notes: [midi(66)] },
        ],
      })
      .build({ ids: 'sequential' });
    const p = plan(built);
    expect(p.beats[0]?.graces.map(({ slash }) => slash)).toEqual([true]);
    expect(p.beats[1]?.graceBeam).toBeDefined();
    expect(accidentals(p)).toEqual(['accidentalSharp', 'accidentalNatural']);
    const result = laid(built);
    const small = result.primitives.flatMap((primitive) =>
      primitive.kind === 'glyph' && primitive.glyph === 'noteheadBlack' ? [primitive.size] : [],
    );
    expect(small).toEqual([16.8, 16.8, 16.8]);
    expect(content(result)).toMatchSnapshot();
  });

  it('dots a line note in the space above', () => {
    const built = score()
      .track('piano', piano)
      .bar()
      .beat('2.', [midi(64)])
      .beat('4', [midi(65)])
      .build({ ids: 'sequential' });
    const [beat] = plan(built).beats;
    expect(beat?.chord?.dots.ys).toEqual([24.5]);
    expect(content(laid(built))).toMatchSnapshot();
  });

  it('shows dynamics below where they change and fingering above', () => {
    const built = score()
      .track('piano', piano)
      .bar()
      .beat('4', [midi(64)])
      .beat('4', [midi(65, { dynamics: 'pp' })])
      .beat('4', [midi(67, { dynamics: 'pp', leftHandFinger: 'ring' })])
      .beat('4', [midi(69, { dynamics: 'mf', rightHandFinger: 'index' })])
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(glyphNames(result, /^dynamic/)).toEqual(['dynamicPP', 'dynamicMF']);
    expect(glyphNames(result, /^fingering/)).toEqual(['fingering3', 'fingeringILower']);
    expect(content(result)).toMatchSnapshot();
  });

  it('anchors every note head to its note', () => {
    const built = score()
      .track('piano', piano)
      .bar()
      .beat('2', [midi(60), midi(62)])
      .beat('2', [midi(67)], { grace: [{ duration: 16, before: true, notes: [midi(69)] }] })
      .build({ ids: 'sequential' });
    const result = laid(built);
    const notes = result.anchors.filter(({ kind }) => kind === 'note').map(({ id }) => id);
    expect(notes.sort()).toEqual(['note00000001', 'note00000002', 'note00000003', 'note00000004']);
  });
});

describe('key and time changes', () => {
  /** A key change at the first bar of the second system. */
  function changeAtBreak(fifths: number, from = 3): { built: Score; result: LayoutResult } {
    const builder = score().key(from).track('piano', piano);
    for (let b = 0; b < 16; b++) {
      builder.bar();
      if (b === 8) builder.key(fifths).timeSignature(3, 4);
      quarters(
        builder,
        b >= 8
          ? [[midi(64)], [midi(65)], [midi(67)]]
          : [[midi(64)], [midi(65)], [midi(67)], [midi(69)]],
      );
    }
    const built = builder.build({ ids: 'sequential' });
    return { built, result: laid(built, { zoom: 1.6 }) };
  }

  it('cancels a key with naturals before the new one inside a system', () => {
    const built = score()
      .key(3)
      .track('piano', piano)
      .bar()
      .rest('1')
      .bar()
      .key(-2)
      .rest('1')
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(glyphNames(result, /^accidental/)).toEqual([
      ...Array.from({ length: 3 }, () => 'accidentalSharp'),
      ...Array.from({ length: 3 }, () => 'accidentalNatural'),
      ...Array.from({ length: 2 }, () => 'accidentalFlat'),
    ]);
    expect(
      result.primitives
        .filter(
          (primitive) => primitive.kind === 'glyph' && primitive.glyph.startsWith('accidental'),
        )
        .map(describePrimitive),
    ).toMatchSnapshot();
  });

  it('announces a change at the next line with courtesy signatures after the last bar line', () => {
    const { built, result } = changeAtBreak(-1);
    const changed = built.masterBars[8]?.id;
    const system = result.systems.find(({ bars }) => bars.end === 8);
    expect(system, 'a system ends before the change').toBeDefined();
    if (!system || !changed) return;
    const courtesy = result.primitives
      .slice(system.primitives.start, system.primitives.end)
      .filter(({ node }) => node === changed)
      .map(describePrimitive);
    expect(courtesy.filter((line) => line.includes('accidentalNatural'))).toHaveLength(3);
    expect(courtesy.filter((line) => line.includes('accidentalFlat'))).toHaveLength(1);
    expect(courtesy.filter((line) => line.includes('timeSig'))).toHaveLength(2);
    const lastBarLine = Math.max(
      ...result.primitives
        .slice(system.primitives.start, system.primitives.end)
        .filter(
          (primitive) => primitive.kind === 'line' && primitive.node === built.masterBars[7]?.id,
        )
        .map(({ x }) => x),
    );
    for (const primitive of result.primitives.slice(
      system.primitives.start,
      system.primitives.end,
    )) {
      if (primitive.node === changed) expect(primitive.x).toBeGreaterThan(lastBarLine);
    }
    expect(courtesy).toMatchSnapshot();
  });
});

describe('both mode', () => {
  it('draws the rhythm on the standard staff and joins the bar lines of the two staves', () => {
    const builder = score().track('guitar', { display: { notation: 'both', octaveShift: 1 } });
    builder.bar();
    for (let i = 0; i < 8; i++) builder.beat('8', [note(1, i), note(3, 2)]);
    const built = builder.build({ ids: 'sequential' });
    const result = laid(built);
    const [standard, tab] = result.systems[0]?.staves ?? [];
    expect(standard?.type).toBe('standard');
    expect(tab?.type).toBe('tab');
    const stems = result.primitives.filter(
      (primitive) =>
        primitive.kind === 'line' &&
        primitive.node?.startsWith('beat') &&
        primitive.x === primitive.x2,
    );
    expect(stems).toHaveLength(8);
    for (const stem of stems)
      expect(stem.bbox.y + stem.bbox.height).toBeLessThanOrEqual((standard?.bottom ?? 0) + 30);
    const joins = result.primitives.filter(
      (primitive) =>
        primitive.kind === 'line' &&
        primitive.node?.startsWith('mbar') &&
        primitive.y === standard?.bottom &&
        primitive.y2 === tab?.top,
    );
    expect(joins.length).toBeGreaterThan(0);
    const barLines = result.primitives.filter(
      (primitive) => primitive.kind === 'line' && primitive.node?.startsWith('mbar'),
    );
    expect({
      content: content(result),
      barLines: barLines.map(describePrimitive),
    }).toMatchSnapshot();
  });
});

describe('percussion staff', () => {
  // Every GM and GM2 percussion note the fixture corpus plays (gp5/percussion-all.gp5 and
  // gp/drum-tabs.gp, read with alphaTab): 29 to 31 and 33 to 87.
  const corpus = [29, 30, 31, ...Array.from({ length: 87 - 33 + 1 }, (_, i) => 33 + i)];

  it('renders every percussion instrument of the corpus with its position and head', () => {
    const builder = score().track('drums');
    for (const [i, value] of corpus.entries()) {
      if (i % 4 === 0) builder.bar();
      builder.beat('4', [midi(value)]);
    }
    const built = builder.build({ ids: 'sequential' });
    const result = laid(built);
    const heads = result.primitives.flatMap((primitive) =>
      primitive.kind === 'glyph' && primitive.glyph.startsWith('notehead') ? [primitive.glyph] : [],
    );
    expect(heads).toHaveLength(corpus.length);
    const byMidi = Object.fromEntries(corpus.map((value, i) => [value, heads[i]]));
    expect(byMidi[42]).toBe('noteheadXBlack');
    expect(byMidi[49]).toBe('noteheadXBlack');
    expect(byMidi[53]).toBe('noteheadDiamondBlack');
    expect(byMidi[54]).toBe('noteheadTriangleUpBlack');
    expect(byMidi[38]).toBe('noteheadBlack');
    expect(byMidi[36]).toBe('noteheadBlack');
    expect(glyphNames(result, /^accidental/)).toEqual([]);
    expect(content(result)).toMatchSnapshot();
  });

  it('stems one voice up and splits two by voice', () => {
    const builder = score().track('drums').bar();
    for (let i = 0; i < 8; i++) builder.beat('8', [midi(42), midi(i % 2 === 0 ? 36 : 38)]);
    builder.bar();
    for (let i = 0; i < 8; i++) builder.beat('8', [midi(42)]);
    builder.voice(1);
    for (let i = 0; i < 4; i++) builder.beat('4', [midi(i % 2 === 0 ? 36 : 38)]);
    const built = builder.build({ ids: 'sequential' });
    const percussion = (barIndex: number): BarPlan =>
      planBar(staffBar(built, barIndex, 0, 'percussion'), {
        percussion: true,
        courtesyAccidentals: false,
      });
    expect(new Set(percussion(0).beats.map(({ chord }) => chord?.direction))).toEqual(
      new Set(['up']),
    );
    expect(
      percussion(1).beats.map(({ voice, chord }) => `${String(voice)}${chord?.direction ?? ''}`),
    ).toEqual([
      ...Array.from({ length: 8 }, () => '0up'),
      ...Array.from({ length: 4 }, () => '1down'),
    ]);
    expect(content(laid(built))).toMatchSnapshot();
  });
  it('draws rests, beams, dots, tuplets and ties on the percussion staff as on the standard staff', () => {
    const builder = score().track('drums').bar();
    builder
      .beat('8', [midi(42), midi(36)])
      .beat('8', [midi(42)])
      .beat('8t', [midi(42), midi(38)])
      .beat('8t', [midi(42)])
      .beat('8t', [midi(42)])
      .beat('4.', [midi(49)])
      .rest('8')
      .bar()
      .beat('2', [midi(49, { tie: true })])
      .rest('4')
      .beat('16', [midi(42)])
      .beat('16', [midi(42)])
      .rest('8');
    builder
      .voice(1)
      .beat('2', [midi(36)])
      .rest('4')
      .beat('4', [midi(36)]);
    const result = laid(builder.build({ ids: 'sequential' }));
    expect(glyphNames(result, /^(rest|augmentationDot|tuplet)/).length).toBeGreaterThan(0);
    expect(content(result)).toMatchSnapshot();
  });
});

describe('standard notation at scale', () => {
  it(
    'lays out the long score without overlapping anchors, standard and both',
    { timeout: 30_000 },
    () => {
      const long = largeScore(4, 120, { structure: true });
      for (const mode of ['standard', 'both'] as const) {
        laid(long, { notation: Object.fromEntries(long.tracks.map(({ id }) => [id, mode])) });
      }
    },
  );

  it('re-measures the bar after an edit, so a cached layout matches a cold one', () => {
    const built = score()
      .track('piano', piano)
      .bar()
      .beat('1', [midi(60)])
      .bar()
      .beat('1', [midi(60)])
      .build({ ids: 'sequential' });
    const cache = new LayoutCache();
    layout(built, paged, cache);
    const { score: edited, change } = applyCommand(
      built,
      setNote({ beatId: beatOf(built, 0, 0, 0).id }, { string: 0, fret: 61 }),
    );
    const cached = layout(edited, { ...paged, dirtyBars: change.touchedBars }, cache);
    expect(accidentals(plan(edited, 1))).toEqual([
      'accidentalParensLeft+accidentalNatural+accidentalParensRight',
    ]);
    expect(stable(cached)).toBe(stable(layout(edited, paged)));
  });

  it('re-measures a bar whose predecessor changed key, so its naturals are measured', () => {
    const built = score()
      .key(2)
      .track('piano', piano)
      .bar()
      .beat('1', [midi(66)])
      .bar()
      .key(-1)
      .beat('1', [midi(65)])
      .build({ ids: 'sequential' });
    const first = built.masterBars[0];
    if (!first) throw new Error('no first bar');
    const cache = new LayoutCache();
    layout(built, paged, cache);
    const { score: edited, change } = applyCommand(
      built,
      setMasterBar({ masterBarId: first.id }, { keySignature: { fifths: 3, minor: false } }),
    );
    const cached = layout(edited, { ...paged, dirtyBars: change.touchedBars }, cache);
    expect(cached.metrics.measuredBars).toBe(2);
    expect(stable(cached)).toBe(stable(layout(edited, paged)));
  });
});

describe('room for everything the five-line staves draw', () => {
  const strays = (result: LayoutResult, built: Score): string[] =>
    strayPrimitives(result, built).map(describePrimitive);
  const guitar = (notation: 'standard' | 'both'): ScoreBuilder =>
    score().track('guitar', { display: { notation, octaveShift: 1 } });
  const glyphOf = (result: LayoutResult, name: string): Rect => {
    const found = result.primitives.find((p) => p.kind === 'glyph' && p.glyph === name);
    if (!found) throw new Error(`no ${name}`);
    return found.bbox;
  };
  /** Flags whose box reaches into a staff's 0.3-space margin: a flag is measured, not absorbed. */
  const flagsInMargin = (result: LayoutResult): string[] => {
    const margin = MARGIN * 7;
    const staves = result.anchors.filter(
      (anchor) => anchor.kind === 'staff' && anchor.staff !== 'tab',
    );
    return result.primitives.flatMap((primitive) => {
      if (primitive.kind !== 'glyph' || !primitive.glyph.startsWith('flag')) return [];
      const { y, height } = primitive.bbox;
      const held = staves.some(
        ({ bbox }) =>
          y >= bbox.y + margin - 0.02 && y + height <= bbox.y + bbox.height - margin + 0.02,
      );
      return held ? [] : [describePrimitive(primitive)];
    });
  };

  it('keeps every dynamic inside the dynamics lane, on the standard and percussion staves', () => {
    const marks: Dynamics[] = ['mf', 'ppp', 'pp', 'p', 'mp', 'ff', 'fff', 'f'];
    for (const [kind, pitch] of [
      ['piano', 72],
      ['drums', 38],
    ] as const) {
      const builder = kind === 'piano' ? score().track('piano', piano) : score().track('drums');
      for (const [i, dynamics] of marks.entries()) {
        if (i % 4 === 0) builder.bar();
        builder.beat('4', [midi(pitch, { dynamics })]);
      }
      const built = builder.build({ ids: 'sequential' });
      const result = laid(built);
      expect(glyphNames(result, /^dynamic/), kind).toHaveLength(8);
      expect(strays(result, built), kind).toEqual([]);
    }
  });

  it('keeps room for a flag past its stem tip, up and down, and past a tremolo-lengthened stem', () => {
    const lone = (builder: ScoreBuilder, value: '32' | '64', pitch: number, spec = {}): void => {
      builder.rest(value === '32' ? '16.' : '16..');
      builder.beat(value, [midi(pitch)], spec);
      builder.rest('8');
    };
    for (const [kind, high, low] of [
      ['piano', 69, 72],
      ['drums', 38, 42],
    ] as const) {
      const start = (): ScoreBuilder =>
        (kind === 'piano' ? score().track('piano', piano) : score().track('drums')).bar();
      const plain = start();
      lone(plain, '32', high);
      lone(plain, '32', low);
      lone(plain, '64', high);
      lone(plain, '64', low);
      // Apart from the 64ths, whose room would hide the lengthened stems'.
      const tremolo = start();
      lone(tremolo, '32', low, { effects: { tremoloPicking: 32 } });
      lone(tremolo, '32', high, { effects: { tremoloPicking: 32 } });
      tremolo.rest('2');
      for (const builder of [plain, tremolo]) {
        const built = builder.build({ ids: 'sequential' });
        const result = laid(built);
        expect(glyphNames(result, /^flag/).length, kind).toBeGreaterThan(0);
        expect(strays(result, built), kind).toEqual([]);
        expect(flagsInMargin(result), kind).toEqual([]);
      }
    }
  });

  it('measures a tuplet number from a rest it holds by the rest itself, above and below', () => {
    const five = { tuplet: { n: 5, of: 4 } };
    for (const notation of ['standard', 'both'] as const) {
      const builder = guitar(notation).bar().rest('16', five);
      for (let i = 0; i < 4; i++) builder.beat('16', [note(3, 2)], five);
      builder.rest('4').rest('2');
      builder
        .bar()
        .beat('1', [note(1, 1)])
        .voice(1)
        .rest('16', five);
      for (let i = 0; i < 4; i++) builder.beat('16', [note(5, 3)], five);
      builder.rest('4').rest('2');
      const built = builder.build({ ids: 'sequential' });
      const result = laid(built);
      expect(glyphNames(result, /^tuplet/), notation).toEqual(['tuplet5', 'tuplet5']);
      expect(strays(result, built), notation).toEqual([]);
    }
  });

  it('puts a tuplet number past the flag of an unbeamed note', () => {
    const t = { tuplet: { n: 3, of: 2 } };
    const built = score()
      .track('piano', piano)
      .bar()
      .rest('32', t)
      .beat('32', [midi(69)], t)
      .rest('32', t)
      .rest('16')
      .rest('8')
      .rest('4')
      .rest('2')
      .build({ ids: 'sequential' });
    const result = laid(built);
    const number = glyphOf(result, 'tuplet3');
    expect(number.y + number.height).toBeLessThanOrEqual(glyphOf(result, 'flag32ndUp').y + 0.02);
    expect(strays(result, built)).toEqual([]);
  });

  it("keeps room for the right hand's i over the fingering stack", () => {
    const built = score()
      .track('piano', piano)
      .bar()
      .beat('4', [midi(74, { rightHandFinger: 'index' })])
      .rest('4')
      .rest('2')
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(glyphNames(result, /^fingering/)).toEqual(['fingeringILower']);
    expect(strays(result, built)).toEqual([]);
  });

  const originHalves = (notation: 'standard' | 'both'): Score => {
    const builder = guitar(notation);
    for (let b = 0; b < 4; b++) {
      builder.bar().beat('8', [note(1, 17, { hammerPull: b > 0 })]);
      for (let i = 0; i < 7; i++) builder.beat('8', [note(3, 2)]);
    }
    return builder.build({ ids: 'sequential' });
  };

  it("keeps room for a slur's origin half at a break from a note before its voice's last beat", () => {
    for (const [notation, arcs] of [
      ['standard', 1],
      ['both', 2],
    ] as const) {
      const built = originHalves(notation);
      const result = laid(built, { width: 300 });
      expect(result.systems, notation).toHaveLength(4);
      const origin = beatOf(built, 0, 0, 0).notes[0]?.id;
      const system = result.systems[0];
      if (!system) throw new Error('no system');
      const drawn = result.primitives
        .slice(system.primitives.start, system.primitives.end)
        .filter((p) => p.kind === 'path' && p.node === origin && p.d.includes('C'));
      expect(drawn, notation).toHaveLength(arcs);
      expect(strays(result, built), notation).toEqual([]);
    }
  });

  it('re-measures only the edited bar when a later note on the string takes the slur room', () => {
    const built = originHalves('standard');
    const options = { ...paged, width: 300 };
    const cache = new LayoutCache();
    layout(built, options, cache);
    const { score: edited, change } = applyCommand(
      built,
      setNote({ beatId: beatOf(built, 0, 0, 7).id }, { string: 1, fret: 15 }),
    );
    const cached = layout(edited, { ...options, dirtyBars: change.touchedBars }, cache);
    expect(cached.metrics.measuredBars).toBeLessThanOrEqual(2);
    expect(stable(cached)).toBe(stable(layout(edited, options)));
  });
});
