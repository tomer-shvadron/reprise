import {
  applyCommand,
  setBeatEffect,
  setNoteEffect,
  spell,
  staffPosition,
  type Score,
} from '@reprise/model';
import { beatOf, midi, note, noteOf, score, type ScoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  LayoutCache,
  layout,
  type Anchor,
  type LayoutResult,
  type Primitive,
  type Rect,
} from '../../index';
import { stable, strayPrimitives } from '../../test/check-result';
import { describePrimitive } from '../../test/describe';
import { BENDS, content, guitar, laid as laidOut, paged, texts } from '../../test/effects';
import { positionY } from './chord';

const EPSILON = 0.05;

/** `laid`, plus: nothing a note or beat drew lies outside its staff's measured room and lanes. */
function laid(built: Score, options: Parameters<typeof laidOut>[1] = {}): LayoutResult {
  const result = laidOut(built, options);
  expect(strayPrimitives(result, built).map(describePrimitive)).toEqual([]);
  return result;
}

function drums(): ScoreBuilder {
  return score().track('drums');
}

const glyphs = (result: LayoutResult, prefix: string): Primitive[] =>
  result.primitives.filter((p) => p.kind === 'glyph' && p.glyph.startsWith(prefix));

const named = (result: LayoutResult, name: string, node?: string): Primitive[] =>
  result.primitives.filter(
    (p) => p.kind === 'glyph' && p.glyph === name && (node === undefined || p.node === node),
  );

function one<T>(found: readonly T[], what: string): T {
  const [first] = found;
  if (!first) throw new Error(`no ${what}`);
  return first;
}

const centreY = (box: Rect): number => box.y + box.height / 2;
const centreX = (box: Rect): number => box.x + box.width / 2;
const bottomOf = (box: Rect): number => box.y + box.height;
const rightOf = (box: Rect): number => box.x + box.width;

/** The first staff of the first system: its top line and its space. */
function staffOf(result: LayoutResult, system = 0, staff = 0): { top: number; space: number } {
  const placement = result.systems[system]?.staves[staff];
  if (!placement) throw new Error('no staff');
  return { top: placement.top, space: (placement.bottom - placement.top) / 4 };
}

function staffAnchor(
  result: LayoutResult,
  type: 'standard' | 'tab' | 'percussion',
  system = 0,
): Rect {
  const found = result.anchors.find(
    (a: Anchor) => a.kind === 'staff' && a.staff === type && a.system === system,
  );
  if (!found) throw new Error(`no ${type} staff`);
  return found.bbox;
}

const within = (box: Rect, outer: Rect): boolean =>
  box.y >= outer.y - EPSILON && bottomOf(box) <= bottomOf(outer) + EPSILON;

/** A note's head: the head glyph drawn for it. */
function head(result: LayoutResult, node: string): Primitive {
  return one(
    result.primitives.filter(
      (p) => p.kind === 'glyph' && p.glyph.startsWith('notehead') && p.node === node,
    ),
    `head of ${node}`,
  );
}

/** The vertical stem a beat drew. */
function stem(result: LayoutResult, node: string): Primitive & { kind: 'line' } {
  const found = result.primitives.find(
    (p): p is Primitive & { kind: 'line' } =>
      p.kind === 'line' &&
      p.node === node &&
      Math.abs(p.x - p.x2) < EPSILON &&
      p.dash === undefined,
  );
  if (!found) throw new Error(`no stem for ${node}`);
  return found;
}

const stemLength = (line: Primitive & { kind: 'line' }): number => Math.abs(line.y2 - line.y);

const lines = (result: LayoutResult, node: string): (Primitive & { kind: 'line' })[] =>
  result.primitives.filter(
    (p): p is Primitive & { kind: 'line' } =>
      p.kind === 'line' && p.node === node && Math.abs(p.x - p.x2) > EPSILON && !p.dash,
  );

/** Filled crescents: ties and slurs. */
const arcs = (result: LayoutResult, node?: string): Primitive[] =>
  result.primitives.filter(
    (p) =>
      p.kind === 'path' && p.fill && p.d.includes('C') && (node === undefined || p.node === node),
  );

const arrows = (result: LayoutResult): Primitive[] =>
  result.primitives.filter((p) => p.kind === 'path' && p.fill && p.d.split('L').length === 3);

const isText = (value: string) => (p: Primitive) => p.kind === 'text' && p.text === value;

describe('articulations on the standard staff', () => {
  it('puts them on the head side with one voice: a staccato in a space, an accent outside the staff', () => {
    const built = guitar('standard')
      .bar()
      .beat('4', [note(3, 0, { staccato: true })])
      .beat('4', [note(3, 2, { staccato: true })])
      .beat('4', [note(1, 12, { staccato: true, accent: 'accent' })])
      .beat('4', [note(6, 0, { accent: 'accent' })])
      .bar()
      .beat('2', [note(2, 1, { accent: 'accent' }), note(3, 2, { accent: 'heavy' })])
      .beat('2', [note(1, 12, { staccato: true })])
      .bar()
      .beat('1', [note(1, 12, { staccato: true })])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const { top, space } = staffOf(result);
    const staccatos = glyphs(result, 'articStaccato');
    // G4 on a line, stem up: below, three positions down; A4 in a space: two.
    const [onLine, inSpace, high] = staccatos;
    if (!onLine || !inSpace || !high) throw new Error('staccatos');
    expect(onLine.kind === 'glyph' && onLine.glyph).toBe('articStaccatoBelow');
    expect(centreY(onLine.bbox)).toBeCloseTo(top + positionY(2 - 3, space), 1);
    expect(centreY(inSpace.bbox)).toBeCloseTo(top + positionY(3 - 2, space), 1);
    // E6, stem down: above, with the accent beyond it.
    expect(high.kind === 'glyph' && high.glyph).toBe('articStaccatoAbove');
    const accent = one(named(result, 'articAccentAbove'), 'accent above');
    expect(bottomOf(accent.bbox)).toBeLessThan(high.bbox.y);
    // A low E's accent stays clear of the bottom line.
    const low = one(named(result, 'articAccentBelow'), 'accent below');
    expect(low.bbox.y).toBeGreaterThanOrEqual(top + 4.5 * space - EPSILON);
    // A chord shows the union: a marcato over an accent.
    expect(glyphs(result, 'articMarcato')).toHaveLength(1);
    // A whole note on its direction's side: E6 points down, so above.
    const whole = staccatos.at(-1);
    expect(whole?.kind === 'glyph' && whole.glyph).toBe('articStaccatoAbove');
    expect(content(result)).toMatchSnapshot();
  });

  it('puts them beyond the stem with two voices, and on drums', () => {
    const built = guitar('standard')
      .bar()
      .beat('8', [note(2, 5, { accent: 'accent' })], { tuplet: { n: 3, of: 2 } })
      .beat('8', [note(2, 6, { staccato: true })], { tuplet: { n: 3, of: 2 } })
      .beat('8', [note(2, 8)], { tuplet: { n: 3, of: 2 } })
      .beat('4', [note(2, 6, { staccato: true })])
      .beat('2', [note(1, 3)])
      .voice(1)
      .beat('2', [note(4, 2, { staccato: true })])
      .beat('2', [note(5, 3, { accent: 'heavy' })])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const { top, space } = staffOf(result);
    const beam = one(
      result.primitives.filter((p) => p.kind === 'path' && p.node === beatOf(built, 0, 0, 0).id),
      'beam',
    );
    const accent = one(named(result, 'articAccentAbove'), 'accent');
    const beamed = stem(result, beatOf(built, 0, 0, 0).id);
    expect(bottomOf(accent.bbox)).toBeLessThan(Math.min(beamed.y, beamed.y2));
    expect(beam.bbox.y).toBeLessThan(Math.min(beamed.y, beamed.y2));
    // A tuplet's number sits beyond the marks on its side.
    const number = one(glyphs(result, 'tuplet3'), 'tuplet number');
    expect(bottomOf(number.bbox)).toBeLessThanOrEqual(accent.bbox.y + EPSILON);
    // Centred on the stem.
    const quarter = beatOf(built, 0, 0, 3).id;
    const mark = one(named(result, 'articStaccatoAbove', quarter), 'staccato');
    expect(centreX(mark.bbox)).toBeCloseTo(stem(result, quarter).x, 1);
    // A staccato that would fall inside the staff moves to a space.
    const lower = beatOf(built, 0, 0, 0, 1).id;
    const below = one(named(result, 'articStaccatoBelow', lower), 'staccato below');
    expect(below.bbox.y).toBeGreaterThan(bottomOf(stem(result, lower).bbox) - EPSILON);
    const at = (centreY(below.bbox) - top) / space;
    if (at > 0 && at < 4) expect(Math.abs(at - 0.5 - Math.round(at - 0.5))).toBeLessThan(0.01);
    expect(named(result, 'articMarcatoBelow')).toHaveLength(1);

    const kit = drums()
      .bar()
      .beat('8', [midi(42, { accent: 'accent' })])
      .beat('8', [midi(42, { staccato: true })])
      .beat('8', [midi(42)])
      .beat('8', [midi(42, { accent: 'heavy' })])
      .beat('2', [midi(38)])
      .build({ ids: 'sequential' });
    const drummed = laid(kit);
    const kitBeam = one(
      drummed.primitives.filter((p) => p.kind === 'path' && p.node === beatOf(kit, 0, 0, 0).id),
      'beam',
    );
    for (const prefix of ['articAccent', 'articStaccato', 'articMarcato']) {
      const found = one(glyphs(drummed, prefix), prefix);
      expect(bottomOf(found.bbox)).toBeLessThan(kitBeam.bbox.y);
    }
    expect(content(result)).toMatchSnapshot();
    expect(content(drummed)).toMatchSnapshot();
  });
});

describe('tremolo strokes on the standard staff', () => {
  it('puts the strokes on the stem, lengthening it only when they do not fit', () => {
    const built = guitar('standard')
      .bar()
      .beat('4', [note(3, 2)])
      .beat('4', [note(3, 2)], { effects: { tremoloPicking: 8 } })
      .beat('4', [note(3, 2)], { effects: { tremoloPicking: 16 } })
      .beat('4', [note(3, 2)], { effects: { tremoloPicking: 32 } })
      .bar()
      .beat('8', [note(3, 2)], { effects: { tremoloPicking: 16 } })
      .beat('8', [note(3, 4)])
      .beat('4', [note(3, 2)])
      .beat('2', [note(3, 2)], { effects: { tremoloPicking: 8 } })
      .bar()
      .beat('1', [note(3, 0)], { effects: { tremoloPicking: 16 } })
      .build({ ids: 'sequential' });
    const result = laid(built);
    const length = (bar: number, beat: number) =>
      stemLength(stem(result, beatOf(built, 0, bar, beat).id));
    const plain = length(0, 0);
    expect(length(0, 1)).toBeCloseTo(plain, 1);
    expect(length(0, 2)).toBeCloseTo(plain, 1);
    expect(length(0, 3)).toBeGreaterThan(plain + 0.5);
    expect(glyphs(result, 'tremolo').map((p) => p.kind === 'glyph' && p.glyph)).toEqual([
      'tremolo1',
      'tremolo2',
      'tremolo3',
      'tremolo2',
      'tremolo1',
      'tremolo2',
    ]);
    // The beamed pair: both stems reach the moved beam, longer than the same pair unmarked.
    const pair = guitar('standard')
      .bar()
      .beat('8', [note(3, 2)])
      .beat('8', [note(3, 4)])
      .beat('2.', [note(3, 2)])
      .build({ ids: 'sequential' });
    const unmarked = laid(pair);
    const plainPair = (beat: number) => stemLength(stem(unmarked, beatOf(pair, 0, 0, beat).id));
    expect(length(1, 0)).toBeGreaterThan(plainPair(0) + 0.5);
    expect(length(1, 1)).toBeGreaterThan(plainPair(1) + 0.5);
    const first = beatOf(built, 0, 1, 0).id;
    const strokes = one(
      glyphs(result, 'tremolo').filter((p) => p.node === first),
      'strokes',
    );
    const beamed = stem(result, first);
    expect(strokes.bbox.y).toBeGreaterThan(Math.min(beamed.y, beamed.y2));
    expect(bottomOf(strokes.bbox)).toBeLessThan(
      bottomOf(head(result, noteOf(built, 0, 1, 0).id).bbox),
    );
    // A half note's strokes are on its stem; a whole note's above its head.
    const half = beatOf(built, 0, 1, 3).id;
    const halfStrokes = one(
      glyphs(result, 'tremolo').filter((p) => p.node === half),
      'half',
    );
    expect(centreX(halfStrokes.bbox)).toBeCloseTo(stem(result, half).x, 1);
    const whole = beatOf(built, 0, 2, 0).id;
    const wholeStrokes = one(
      glyphs(result, 'tremolo').filter((p) => p.node === whole),
      'whole',
    );
    expect(bottomOf(wholeStrokes.bbox)).toBeLessThan(
      head(result, noteOf(built, 0, 2, 0).id).bbox.y,
    );

    const roll = laid(
      drums()
        .bar()
        .beat('4', [midi(38)], { effects: { tremoloPicking: 32 } })
        .beat('2.', [midi(38)])
        .build({ ids: 'sequential' }),
    );
    expect(glyphs(roll, 'tremolo3')).toHaveLength(1);
    expect(content(result)).toMatchSnapshot();
  });
});

describe('ghost notes on the standard staff', () => {
  it('parenthesises the heads outside both columns, with the sharp left and the dot right', () => {
    const built = guitar('standard')
      .bar()
      .beat('4', [note(3, 2, { ghost: true }), note(2, 0, { ghost: true })])
      .beat('4.', [note(1, 2, { ghost: true })])
      .beat('8', [note(1, 0)], {
        grace: [{ duration: 16, before: true, notes: [note(1, 3, { ghost: true })] }],
      })
      .beat('4', [note(1, 0)])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const second = beatOf(built, 0, 0, 0).notes;
    const heads = second.map((n) => head(result, n.id).bbox);
    const left = one(named(result, 'noteheadParenthesisLeft', second[0]?.id), 'left paren');
    const right = one(named(result, 'noteheadParenthesisRight', second[0]?.id), 'right paren');
    expect(rightOf(left.bbox)).toBeLessThanOrEqual(Math.min(...heads.map((b) => b.x)) + EPSILON);
    expect(right.bbox.x).toBeGreaterThanOrEqual(Math.max(...heads.map(rightOf)) - EPSILON);
    const sharpNote = noteOf(built, 0, 0, 1).id;
    const sharp = one(named(result, 'accidentalSharp', sharpNote), 'sharp');
    const open = one(named(result, 'noteheadParenthesisLeft', sharpNote), 'paren');
    const close = one(named(result, 'noteheadParenthesisRight', sharpNote), 'paren');
    expect(rightOf(sharp.bbox)).toBeLessThanOrEqual(open.bbox.x + EPSILON);
    const dot = one(named(result, 'augmentationDot', beatOf(built, 0, 0, 1).id), 'dot');
    expect(dot.bbox.x).toBeGreaterThanOrEqual(rightOf(close.bbox) - EPSILON);
    // A grace note's parentheses are at grace size.
    const grace = beatOf(built, 0, 0, 2).grace?.[0]?.notes[0]?.id;
    const small = one(named(result, 'noteheadParenthesisLeft', grace), 'grace paren');
    expect(small.kind === 'glyph' && left.kind === 'glyph' && small.size / left.size).toBeCloseTo(
      0.6,
      2,
    );
    const kit = laid(
      drums()
        .bar()
        .beat('4', [midi(38, { ghost: true })])
        .beat('2.', [midi(38)])
        .build({ ids: 'sequential' }),
    );
    expect(glyphs(kit, 'noteheadParenthesis')).toHaveLength(2);
    expect(content(result)).toMatchSnapshot();
  });
});

describe('harmonics on the standard staff', () => {
  /** The y of the head drawn at a staff position, for the score's first staff. */
  const at = (result: LayoutResult, position: number) => {
    const { top, space } = staffOf(result);
    return top + positionY(position, space);
  };
  const written = (midiNote: number) =>
    staffPosition(spell(midiNote, { fifths: 0, minor: false }), 'treble', 1);

  it('writes a natural harmonic as a diamond at the rounded sounding pitch', () => {
    const built = guitar('standard')
      .bar()
      .beat('4', [note(1, 12, { harmonic: { kind: 'natural' } })])
      .beat('4', [note(1, 12)])
      .beat('4', [note(1, 7, { harmonic: { kind: 'natural' } })])
      .beat('4', [note(1, 19)])
      .bar()
      .beat('1', [note(6, 0, { harmonic: { kind: 'natural', value: 2.7 } })])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const y = (bar: number, beat: number) =>
      centreY(head(result, noteOf(built, 0, bar, beat).id).bbox);
    expect(y(0, 0)).toBeCloseTo(y(0, 1), 1);
    expect(y(0, 2)).toBeCloseTo(y(0, 3), 1);
    // E2 and 34 semitones is D5, written an octave higher.
    expect(y(1, 0)).toBeCloseTo(at(result, written(40 + 34)), 1);
    expect(named(result, 'noteheadDiamondBlack')).toHaveLength(2);
    expect(named(result, 'noteheadDiamondWhole')).toHaveLength(1);
  });

  it('adds a diamond at the sounding pitch to every other harmonic, with its own accidental', () => {
    const built = guitar('standard')
      .bar()
      .beat('4', [note(1, 2, { harmonic: { kind: 'artificial', value: 12 } })])
      .beat('4', [note(1, 0, { harmonic: { kind: 'pinch', value: 7 } })])
      .beat('4', [note(1, 0, { harmonic: { kind: 'semi' } })])
      .beat('4', [note(1, 2, { harmonic: { kind: 'artificial', value: 12 }, dead: true })])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const { space } = staffOf(result);
    const artificial = noteOf(built, 0, 0, 0).id;
    const drawn = result.primitives.filter(
      (p) => p.kind === 'glyph' && p.glyph.startsWith('notehead') && p.node === artificial,
    );
    expect(drawn.map((p) => p.kind === 'glyph' && p.glyph)).toEqual([
      'noteheadBlack',
      'noteheadDiamondBlack',
    ]);
    const [main, diamond] = drawn;
    if (!main || !diamond) throw new Error('heads');
    expect(centreY(main.bbox) - centreY(diamond.bbox)).toBeCloseTo(3.5 * space, 1);
    expect(named(result, 'accidentalSharp', artificial)).toHaveLength(2);
    expect(result.anchors.filter((a) => a.kind === 'note' && a.id === artificial)).toHaveLength(1);
    const pinch = noteOf(built, 0, 0, 1).id;
    const pinchDiamond = one(named(result, 'noteheadDiamondBlack', pinch), 'pinch diamond');
    expect(centreY(pinchDiamond.bbox)).toBeCloseTo(at(result, written(64 + 19)), 1);
    const semi = noteOf(built, 0, 0, 2).id;
    const semiDiamond = one(named(result, 'noteheadDiamondBlack', semi), 'semi diamond');
    expect(centreY(head(result, semi).bbox) - centreY(semiDiamond.bbox)).toBeCloseTo(
      3.5 * space,
      1,
    );
    const dead = noteOf(built, 0, 0, 3).id;
    expect(
      result.primitives
        .filter((p) => p.kind === 'glyph' && p.glyph.startsWith('notehead') && p.node === dead)
        .map((p) => p.kind === 'glyph' && p.glyph),
    ).toEqual(['noteheadXBlack']);
    expect(content(result)).toMatchSnapshot();
  });

  it('draws the diamonds on the standard staff in both mode and keeps the tab numbers', () => {
    const built = guitar('both')
      .bar()
      .beat('2', [note(1, 12, { harmonic: { kind: 'natural' } })])
      .beat('2', [note(1, 5, { harmonic: { kind: 'artificial', value: 12 } })])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const standard = staffAnchor(result, 'standard');
    const diamonds = glyphs(result, 'noteheadDiamond');
    expect(diamonds).toHaveLength(2);
    expect(diamonds.every((p) => within(p.bbox, standard))).toBe(true);
    expect(texts(result)).toEqual(expect.arrayContaining(['<12>', '5', '<17>']));
  });
});

describe('slides on the standard staff', () => {
  it('joins the heads with a line, and draws slides into and out of a note', () => {
    const built = guitar('standard')
      .bar()
      .beat('8', [note(3, 5, { slide: ['shift'] })])
      .beat('8', [note(3, 7, { slide: ['shift'] })])
      .beat('8', [note(3, 5, { slide: ['legato'] })])
      .beat('8', [note(3, 7)])
      .beat('8', [note(2, 3, { slide: ['intoFromBelow'] })])
      .beat('8', [note(2, 3, { slide: ['intoFromAbove'] })])
      .beat('8', [note(2, 3, { slide: ['outDown'] })])
      .beat('8', [note(2, 3, { slide: ['outUp'] })])
      .bar()
      .beat('4', [note(1, 2, { slide: ['intoFromBelow'] })])
      .beat('2.', [note(1, 0)])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const shiftUp = one(lines(result, noteOf(built, 0, 0, 1).id), 'shift up');
    const from = head(result, noteOf(built, 0, 0, 0).id).bbox;
    const to = head(result, noteOf(built, 0, 0, 1).id).bbox;
    expect(shiftUp.y).toBeCloseTo(centreY(from), 1);
    expect(shiftUp.y2).toBeCloseTo(centreY(to), 1);
    const shiftDown = one(lines(result, noteOf(built, 0, 0, 2).id), 'shift down');
    expect(shiftDown.y2).toBeGreaterThan(shiftDown.y);
    // A legato slide adds its slur and `sl.`.
    expect(arcs(result, noteOf(built, 0, 0, 3).id)).toHaveLength(1);
    expect(result.primitives.filter(isText('sl.'))).toHaveLength(1);
    const loose = [4, 5, 6, 7].map((b) => one(lines(result, noteOf(built, 0, 0, b).id), 'loose'));
    const [fromBelow, fromAbove, outDown, outUp] = loose;
    if (!fromBelow || !fromAbove || !outDown || !outUp) throw new Error('loose');
    expect(fromBelow.y).toBeGreaterThan(fromBelow.y2);
    expect(fromAbove.y).toBeLessThan(fromAbove.y2);
    expect(outDown.y2).toBeGreaterThan(outDown.y);
    expect(outUp.y2).toBeLessThan(outUp.y);
    // A slide into a note with a sharp ends left of the sharp.
    const sharpened = noteOf(built, 0, 1, 0).id;
    const into = one(lines(result, sharpened), 'into');
    expect(into.x2).toBeLessThanOrEqual(
      one(named(result, 'accidentalSharp', sharpened), 'sharp').bbox.x,
    );
    expect(content(result)).toMatchSnapshot();
  });

  it('draws a slide across a bar line in one piece, and as halves across a break or a clef', () => {
    const across = () =>
      guitar('standard')
        .bar()
        .beat('2', [note(3, 5)])
        .beat('2', [note(3, 5, { slide: ['shift'] })])
        .bar()
        .beat('2', [note(3, 7)])
        .beat('2', [note(3, 7, { slide: ['shift'] })])
        .bar({ clef: 'bass' })
        .beat('1', [note(3, 9)])
        .build({ ids: 'sequential' });
    const built = across();
    const whole = laid(built);
    expect(lines(whole, noteOf(built, 0, 1, 0).id)).toHaveLength(1);
    const piece = one(lines(whole, noteOf(built, 0, 1, 0).id), 'piece');
    const originHead = head(whole, noteOf(built, 0, 0, 1).id).bbox;
    expect(piece.x).toBeGreaterThanOrEqual(rightOf(originHead) - EPSILON);
    expect(piece.x).toBeLessThan(rightOf(originHead) + staffOf(whole).space);
    // The bar setting a clef draws its half from its left edge.
    const clefHalf = one(lines(whole, noteOf(built, 0, 2, 0).id), 'clef half');
    const { space } = staffOf(whole);
    expect(Math.abs(clefHalf.y - clefHalf.y2)).toBeCloseTo(0.5 * space, 1);

    const broken = laid(built, { width: 400 });
    const split = broken.systems.findIndex(({ bars }) => bars.start === 1);
    expect(split).toBeGreaterThan(0);
    const origin = noteOf(built, 0, 0, 1).id;
    const first = one(lines(broken, origin), 'origin half');
    const originY = centreY(head(broken, origin).bbox);
    expect(first.y).toBeCloseTo(originY, 1);
    expect(originY - first.y2).toBeCloseTo(0.5 * staffOf(broken).space, 1);
    expect(lines(broken, noteOf(built, 0, 1, 0).id)).toHaveLength(1);
  });

  it('slides from a grace note to its main note in one piece', () => {
    const built = guitar('standard')
      .bar()
      .beat('4', [note(3, 7)], {
        grace: [{ duration: 16, before: true, notes: [note(3, 5, { slide: ['legato'] })] }],
      })
      .beat('2.', [note(3, 7)])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const target = noteOf(built, 0, 0, 0).id;
    expect(lines(result, target)).toHaveLength(1);
    const [slur] = arcs(result, target);
    expect(slur).toBeDefined();
    if (slur) expect(slur.bbox.y).toBeGreaterThan(head(result, target).bbox.y);
  });
});

describe('hammer-ons and pull-offs on the standard staff', () => {
  it('slurs them, lettered H and P over a knockout when the staff is alone, one letter a side', () => {
    const built = guitar('standard')
      .bar()
      .beat('8', [note(2, 5)])
      .beat('8', [note(2, 7, { hammerPull: true })])
      .beat('8', [note(2, 5, { hammerPull: true })])
      .beat('8', [note(2, 3), note(3, 2)])
      .beat('8', [note(2, 5, { hammerPull: true }), note(3, 4, { hammerPull: true })])
      .beat('8', [note(1, 12)])
      .beat('4', [note(1, 8, { hammerPull: true })])
      .bar()
      .beat('4', [note(3, 7, { hammerPull: true })], {
        grace: [{ duration: 16, before: true, notes: [note(3, 5)] }],
      })
      .beat('2.', [note(3, 7)])
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(texts(result)).toEqual(['H', 'P', 'H', 'H', 'P', 'H']);
    const letter = one(result.primitives.filter(isText('H')), 'H');
    const paper = result.primitives.find(
      (p) => p.role === 'paper' && p.node === letter.node && p.kind === 'path',
    );
    expect(paper).toBeDefined();
    // A grace note's slur bends down, away from its stem.
    const target = noteOf(built, 0, 1, 0).id;
    const [slur] = arcs(result, target);
    if (!slur) throw new Error('grace slur');
    expect(centreY(slur.bbox)).toBeGreaterThan(centreY(head(result, target).bbox));
    expect(content(result)).toMatchSnapshot();
  });

  it('draws them as halves across a system break, the letter on the second', () => {
    const built = guitar('standard')
      .bar()
      .beat('2', [note(2, 5)])
      .beat('2', [note(2, 5)])
      .bar()
      .beat('2', [note(2, 7, { hammerPull: true })])
      .beat('2', [note(2, 5)])
      .bar()
      .beat('1', [note(2, 5)])
      .build({ ids: 'sequential' });
    const result = laid(built, { width: 400 });
    expect(result.systems.findIndex(({ bars }) => bars.start === 1)).toBeGreaterThan(0);
    expect(arcs(result, noteOf(built, 0, 0, 1).id)).toHaveLength(1);
    expect(arcs(result, noteOf(built, 0, 1, 0).id)).toHaveLength(1);
    const letter = one(result.primitives.filter(isText('H')), 'H');
    expect(letter.node).toBe(noteOf(built, 0, 1, 0).id);
  });

  it('draws the slurs on the standard staff in both mode and leaves the letters to the tab', () => {
    const built = guitar('both')
      .bar()
      .beat('4', [note(2, 5)])
      .beat('4', [note(2, 7, { hammerPull: true })])
      .beat('4', [note(2, 5, { hammerPull: true, slide: ['legato'] })])
      .beat('4', [note(2, 7)])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const standard = staffAnchor(result, 'standard');
    const slurs = arcs(result).filter((p) => within(p.bbox, standard));
    expect(slurs).toHaveLength(3);
    const letters = result.primitives.filter(
      (p) => p.kind === 'text' && ['H', 'P', 'sl.'].includes(p.text),
    );
    expect(letters.length).toBeGreaterThan(0);
    expect(letters.some((p) => within(p.bbox, standard))).toBe(false);
    expect(letters.every((p) => within(p.bbox, staffAnchor(result, 'tab')))).toBe(true);
  });
});

describe('arpeggio and brush strokes on the standard staff', () => {
  it('draws them left of the accidentals, the arrow toward the top for down, graces further left', () => {
    const built = guitar('standard')
      .bar()
      .beat('4', [note(1, 2), note(2, 3), note(3, 2)], {
        effects: { arpeggio: { direction: 'down' } },
      })
      .beat('4', [note(1, 0), note(2, 1), note(3, 0)], {
        effects: { arpeggio: { direction: 'up' } },
      })
      .beat('4', [note(1, 0), note(2, 1)], { effects: { brush: { direction: 'down' } } })
      .beat('4', [note(1, 0), note(2, 1)], {
        effects: { brush: { direction: 'up' } },
        grace: [{ duration: 16, before: true, notes: [note(1, 2)] }],
      })
      .build({ ids: 'sequential' });
    const result = laid(built);
    const heads = arrows(result);
    expect(heads).toHaveLength(4);
    const tip = (p: Primitive) =>
      p.kind === 'path' ? Number(p.d.slice(1).split(' ')[1]?.split('L')[0]) : 0;
    const [down, up] = heads;
    if (!down || !up) throw new Error('arrows');
    // The tip is the arrow's first point: at its top for a downstroke.
    expect(tip(down)).toBeCloseTo(down.bbox.y, 1);
    expect(tip(up)).toBeCloseTo(bottomOf(up.bbox), 1);
    const sharp = one(named(result, 'accidentalSharp', noteOf(built, 0, 0, 0, 0).id), 'sharp');
    expect(rightOf(down.bbox)).toBeLessThan(sharp.bbox.x);
    const graced = beatOf(built, 0, 0, 3);
    const graceHead = head(result, graced.grace?.[0]?.notes[0]?.id ?? '');
    const last = heads.at(-1);
    if (!last) throw new Error('arrow');
    expect(rightOf(graceHead.bbox)).toBeLessThan(last.bbox.x);
    expect(content(result)).toMatchSnapshot();
  });

  it('leaves the brush to the tab in both mode and keeps the arpeggio beside the heads', () => {
    const built = guitar('both')
      .bar()
      .beat('2', [note(1, 0), note(2, 1)], { effects: { arpeggio: { direction: 'down' } } })
      .beat('2', [note(1, 0), note(2, 1)], { effects: { brush: { direction: 'down' } } })
      .build({ ids: 'sequential' });
    const result = laid(built);
    const standard = staffAnchor(result, 'standard');
    const onStandard = arrows(result).filter((p) => within(p.bbox, standard));
    expect(onStandard).toHaveLength(1);
    expect(onStandard[0]?.node).toBe(beatOf(built, 0, 0, 0).id);
  });
});

describe('a standard staff shown alone', () => {
  it('draws the lane effects the tab draws in both mode', () => {
    const built = guitar('standard')
      .bar()
      .beat('4', [note(3, 5, { palmMute: true })], { effects: { pickStroke: 'down' } })
      .beat('4', [note(3, 5, { palmMute: true })])
      .beat('4', [note(3, 5, { palmMute: true })])
      .beat('4', [note(3, 5, { palmMute: true, vibrato: 'slight' })])
      .bar()
      .beat('4', [note(2, 5, { vibrato: 'slight', letRing: true })])
      .beat('4', [note(2, 12, { harmonic: { kind: 'natural' } })], {
        effects: { tapping: true, fadeIn: true },
      })
      .beat('4', [note(2, 5, { harmonic: { kind: 'artificial', value: 12 } })])
      .beat('4', [note(2, 5, { trill: { fret: 7, speed: 16 } })], {
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
      .build({ ids: 'sequential' });
    const result = laid(built);
    expect(texts(result)).toEqual(
      expect.arrayContaining(['P.M.', 'let ring', 'N.H.', 'A.H.', 'T', 'w/bar']),
    );
    expect(result.primitives.filter(isText('P.M.'))).toHaveLength(1);
    const dashed = result.primitives.filter((p) => p.kind === 'line' && p.dash !== undefined);
    expect(dashed.length).toBeGreaterThanOrEqual(1);
    expect(glyphs(result, 'stringsDownBow')).toHaveLength(1);
    expect(glyphs(result, 'guitarFadeIn')).toHaveLength(1);
    expect(glyphs(result, 'ornamentTrill')).toHaveLength(1);
    // A trill gets no head for its other note.
    expect(
      result.primitives.filter(
        (p) =>
          p.kind === 'glyph' &&
          p.glyph.startsWith('notehead') &&
          p.node === noteOf(built, 0, 1, 3).id,
      ),
    ).toHaveLength(1);
    // The lanes sit above the staff, clear of everything the notes drew.
    const { top } = staffOf(result);
    const words = result.primitives.filter(
      (p) => p.kind === 'text' && /^(beat|note)/.test(p.node ?? ''),
    );
    expect(words.length).toBeGreaterThan(5);
    expect(words.every((p) => bottomOf(p.bbox) <= top + EPSILON)).toBe(true);
    expect(content(result)).toMatchSnapshot();
  });

  it('draws every bend from its head up into the bend lane, releases above the highest bent head', () => {
    const built = guitar('standard')
      .bar()
      .beat('4', [note(3, 7, { bend: BENDS.full })])
      .beat('4', [note(3, 7, { bend: BENDS.bendRelease })])
      .beat('4', [
        note(2, 8, { bend: BENDS.prebendRelease }),
        note(3, 7, { bend: BENDS.prebendRelease }),
      ])
      .beat('4', [note(3, 7, { bend: BENDS.hold })])
      .bar()
      .beat('4', [note(3, 7, { bend: BENDS.bendReleaseBend })])
      .beat('4', [note(3, 7, { bend: BENDS.prebendBend })])
      .beat('4', [note(3, 7, { bend: BENDS.custom })])
      .beat('4', [note(3, 9)], {
        grace: [{ duration: 16, before: true, notes: [note(3, 7, { bend: BENDS.half })] }],
      })
      .build({ ids: 'sequential' });
    const result = laid(built);
    const { top } = staffOf(result);
    const tips = arrows(result);
    expect(tips.length).toBeGreaterThan(5);
    const ups = tips.filter((p) => p.kind === 'path' && p.bbox.y < top);
    expect(ups.length).toBeGreaterThan(3);
    // The chord's releases end above its highest bent head.
    const chord = beatOf(built, 0, 0, 2).notes.map((n) => head(result, n.id).bbox.y);
    const release = tips.find(
      (p) => p.node === noteOf(built, 0, 0, 2, 0).id && p.kind === 'path' && p.bbox.y > top - 20,
    );
    if (release) expect(bottomOf(release.bbox)).toBeLessThanOrEqual(Math.min(...chord) + EPSILON);
    expect(texts(result)).toEqual(expect.arrayContaining(['full', '½']));
    expect(content(result)).toMatchSnapshot();
  });

  it('repeats a run label at a paged line start and not where a continuous line is cut', () => {
    const built = guitar('standard');
    for (let b = 0; b < 8; b++) {
      built.bar();
      for (let i = 0; i < 4; i++) built.beat('4', [note(3, 5, { palmMute: true })]);
    }
    const score = built.build({ ids: 'sequential' });
    const pagedResult = laid(score, { width: 400 });
    expect(pagedResult.systems.length).toBeGreaterThan(1);
    expect(pagedResult.primitives.filter(isText('P.M.'))).toHaveLength(pagedResult.systems.length);
    const continuous = laid(score, { mode: 'continuous', width: 300 });
    expect(continuous.primitives.filter(isText('P.M.'))).toHaveLength(1);
  });
});

describe('effects in both mode', () => {
  it('puts the marks on the standard staff and the lanes, bends and letters on the tab', () => {
    const built = guitar('both')
      .bar()
      .beat('8', [note(2, 5, { staccato: true, accent: 'accent' })], {
        effects: { tremoloPicking: 16 },
      })
      .beat('8', [note(2, 7, { hammerPull: true, palmMute: true })])
      .beat('4', [note(3, 4, { ghost: true }), note(2, 5, { ghost: true })])
      .beat('4', [note(1, 12, { harmonic: { kind: 'natural' }, vibrato: 'slight' })])
      .beat('4', [note(1, 0), note(2, 1), note(3, 0)], {
        effects: { arpeggio: { direction: 'down' } },
      })
      .bar()
      .beat('4', [note(3, 5, { slide: ['shift'] })])
      .beat('4', [note(3, 7, { bend: BENDS.full })])
      .beat('2', [note(2, 5, { harmonic: { kind: 'artificial', value: 12 } })])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const standard = staffAnchor(result, 'standard');
    const tab = staffAnchor(result, 'tab');
    for (const prefix of ['artic', 'tremolo', 'noteheadDiamond', 'noteheadParenthesis']) {
      const found = glyphs(result, prefix);
      expect(found.length, prefix).toBeGreaterThan(0);
      expect(
        found.every((p) => within(p.bbox, standard)),
        prefix,
      ).toBe(true);
    }
    expect(arcs(result).filter((p) => within(p.bbox, standard)).length).toBeGreaterThan(0);
    const shift = noteOf(built, 0, 1, 1).id;
    expect(lines(result, shift).filter((p) => within(p.bbox, standard))).toHaveLength(1);
    const words = result.primitives.flatMap((p) =>
      p.kind === 'text' && /^(beat|note)/.test(p.node ?? '') ? [p] : [],
    );
    expect(words.some((p) => within(p.bbox, standard))).toBe(false);
    const lettered = words.filter((p) => ['H', 'P.M.', 'full'].includes(p.text));
    expect(lettered).toHaveLength(3);
    expect(lettered.every((p) => within(p.bbox, tab))).toBe(true);
    expect(
      arrows(result)
        .filter((p) => p.node === noteOf(built, 0, 1, 1).id)
        .every((p) => within(p.bbox, tab)),
    ).toBe(true);
    expect(content(result)).toMatchSnapshot();
  });
});

describe('effects on the percussion staff', () => {
  /** With `lanes`, drum notes also carry palm mutes, let ring and slides, which drums never show. */
  const kit = (lanes: boolean): Score =>
    drums()
      .bar()
      .beat('8', [midi(36, { accent: 'accent' })])
      .beat('8', [midi(38, { ghost: true })])
      .beat('4', [midi(38)], { effects: { tremoloPicking: 16 } })
      .beat('4', [midi(38, { staccato: true })], {
        grace: [{ duration: 32, before: true, notes: [midi(38)] }],
      })
      .beat('4', [
        midi(42, {
          accent: 'heavy',
          ...(lanes && { palmMute: true, letRing: true, slide: ['shift' as const] }),
        }),
      ])
      .bar()
      .beat('4', [midi(42, { accent: 'accent', palmMute: lanes })])
      .beat('4', [midi(42, lanes ? { slide: ['outDown'] } : {})])
      .beat('2', [midi(46, { staccato: true })])
      .voice(1)
      .beat('2', [midi(36, { accent: 'accent' })])
      .beat('2', [midi(38, { ghost: true })])
      .build({ ids: 'sequential' });

  it('draws accents, staccatos, ghosts, rolls and flams, and no lane or line', () => {
    const built = kit(true);
    const result = laid(built);
    expect(glyphs(result, 'articAccent').length).toBeGreaterThanOrEqual(3);
    expect(glyphs(result, 'articStaccato')).toHaveLength(2);
    expect(glyphs(result, 'tremolo2')).toHaveLength(1);
    expect(glyphs(result, 'noteheadParenthesis')).toHaveLength(4);
    expect(texts(result)).toEqual([]);
    expect(result.primitives.filter((p) => p.kind === 'line' && p.dash !== undefined)).toEqual([]);
    // Slides would be lines drawn for a note; a flam's slash is drawn for its beat.
    expect(
      result.primitives.filter((p) => p.kind === 'line' && p.node?.startsWith('note')),
    ).toEqual([]);
    const staff = (laidOut: LayoutResult) => staffAnchor(laidOut, 'percussion');
    expect(staff(result)).toEqual(staff(layout(kit(false), paged)));
    expect(content(result)).toMatchSnapshot();
  });
});

describe('effects on five-line staves with a cache', () => {
  type Step = (built: Score) => ReturnType<typeof applyCommand>;

  function check(start: Score, notation: 'standard' | 'both', steps: readonly Step[]): void {
    const options = {
      ...paged,
      width: 400,
      notation: Object.fromEntries(start.tracks.map(({ id }) => [id, notation])),
    };
    const cache = new LayoutCache();
    layout(start, options, cache);
    let built = start;
    for (const step of steps) {
      const applied = step(built);
      built = applied.score;
      const cached = layout(built, { ...options, dirtyBars: applied.change.touchedBars }, cache);
      expect(cached.metrics.measuredBars).toBeLessThanOrEqual(2);
      expect(stable(cached)).toBe(stable(layout(built, options)));
    }
  }

  const note0 = (bar: number, beat: number) => (built: Score) => noteOf(built, 0, bar, beat).id;
  const noteEffect =
    (bar: number, beat: number, changes: Parameters<typeof setNoteEffect>[1]): Step =>
    (built) =>
      applyCommand(built, setNoteEffect({ noteId: note0(bar, beat)(built) }, changes));

  function long(): Score {
    const builder = guitar('standard');
    for (let b = 0; b < 12; b++) {
      builder
        .bar()
        .beat('8', [note(1, 3)])
        .beat('8', [note(1, 5)])
        .beat('4', [note(2, 5)])
        .beat('2', [note(1, 2)]);
    }
    return builder.build({ ids: 'sequential' });
  }

  it.each(['standard', 'both'] as const)(
    'keeps cached equal to cold in %s notation',
    (notation) => {
      const built = long();
      const result = layout(built, { ...paged, width: 400 });
      const breakAt = result.systems[1]?.bars.start ?? 1;
      check(built, notation, [
        noteEffect(1, 2, { staccato: true, accent: 'accent' }),
        noteEffect(1, 2, { staccato: false, accent: 'none' }),
        noteEffect(1, 0, { hammerPull: true }),
        noteEffect(1, 0, { hammerPull: false }),
        noteEffect(breakAt, 0, { hammerPull: true }),
        noteEffect(breakAt, 0, { hammerPull: false }),
        noteEffect(2, 3, { harmonic: { kind: 'artificial', value: 12 } }),
        noteEffect(2, 3, { harmonic: null }),
        (score) =>
          applyCommand(
            score,
            setBeatEffect(
              { beatId: beatOf(score, 0, 3, 0).id },
              { effects: { tremoloPicking: 32 } },
            ),
          ),
        noteEffect(5, 2, { palmMute: true }),
        noteEffect(5, 2, { palmMute: false }),
      ]);
    },
  );

  it('reuses the systems before a lane appears in a later system of a lone standard staff', () => {
    const built = long();
    const options = { ...paged, width: 400 };
    const cache = new LayoutCache();
    const before = layout(built, options, cache);
    const last = before.systems.at(-1)?.bars.start ?? 0;
    const applied = applyCommand(
      built,
      setNoteEffect({ noteId: noteOf(built, 0, last, 2).id }, { palmMute: true }),
    );
    const after = layout(
      applied.score,
      { ...options, dirtyBars: applied.change.touchedBars },
      cache,
    );
    expect(after.metrics.reusedSystems).toBeGreaterThan(0);
    expect(stable(after)).toBe(stable(layout(applied.score, options)));
    expect(after.primitives.filter(isText('P.M.'))).toHaveLength(1);
  });

  it('keeps cached equal to cold on drums when an accent is added', () => {
    const kit = drums();
    for (let b = 0; b < 6; b++)
      kit
        .bar()
        .beat('4', [midi(38)])
        .beat('2.', [midi(36)]);
    const built = kit.build({ ids: 'sequential' });
    check(built, 'standard', [
      (score) =>
        applyCommand(
          score,
          setNoteEffect({ noteId: noteOf(score, 0, 2, 0).id }, { accent: 'heavy' }),
        ),
    ]);
  });
});
