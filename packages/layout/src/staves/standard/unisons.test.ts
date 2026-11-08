import { STANDARD_TUNING, openStringPitch, type Note, type Score } from '@reprise/model';
import { midi, note, noteOf, score, type ScoreBuilder } from '@reprise/model/testing';
import {
  array,
  assert,
  boolean,
  constantFrom,
  integer,
  option,
  property,
  record,
  tuple,
  type Arbitrary,
} from 'fast-check';
import { describe, expect, it } from 'vitest';

import { engraving } from '../../metrics';
import { hitTest, type Anchor, type LayoutResult, type Primitive, type Rect } from '../../index';
import { expectValid, strayPrimitives } from '../../test/check-result';
import { describePrimitive } from '../../test/describe';
import { guitar, laid as laidOut } from '../../test/effects';

const EPSILON = 0.05;

const rightOf = (box: Rect): number => box.x + box.width;
const centreX = (box: Rect): number => box.x + box.width / 2;
const centreY = (box: Rect): number => box.y + box.height / 2;

/** Every note anchor's centre hits that note. */
function expectHits(result: LayoutResult): void {
  for (const anchor of result.anchors.filter((a) => a.kind === 'note')) {
    const hit = hitTest(result, centreX(anchor.bbox), centreY(anchor.bbox));
    expect(hit?.kind, `${anchor.id} on ${String(anchor.staff)}`).toBe('note');
    expect(hit?.id, `${anchor.id} on ${String(anchor.staff)}`).toBe(anchor.id);
  }
}

/** Laid out valid, with no strays and every anchor hit, in `notation`. */
function laid(built: Score, notation: 'standard' | 'both' = 'standard'): LayoutResult {
  const track = built.tracks[0];
  const options = track ? { notation: { [track.id]: notation } } : {};
  const result = laidOut(built, options);
  expect(strayPrimitives(result, built).map(describePrimitive)).toEqual([]);
  expectHits(result);
  return result;
}

/** Laid out in standard and in both; returns the standard result. */
function checked(builder: () => ScoreBuilder): { built: Score; result: LayoutResult } {
  const built = builder().build({ ids: 'sequential' });
  laid(built, 'both');
  return { built, result: laid(built) };
}

function anchorOf(result: LayoutResult, id: string, staff = 'standard'): Rect {
  const found = result.anchors.find((a) => a.kind === 'note' && a.id === id && a.staff === staff);
  if (!found) throw new Error(`no anchor for ${id}`);
  return found.bbox;
}

function heads(result: LayoutResult, id: string): Primitive[] {
  return result.primitives.filter(
    (p) => p.kind === 'glyph' && p.glyph.startsWith('notehead') && p.node === id,
  );
}

function head(result: LayoutResult, id: string): Rect {
  const [first] = heads(result, id).filter(
    (p) => p.kind === 'glyph' && !p.glyph.startsWith('noteheadParenthesis'),
  );
  if (!first) throw new Error(`no head for ${id}`);
  return first.bbox;
}

function glyphOf(result: LayoutResult, id: string): string {
  const found = heads(result, id)[0];
  return found?.kind === 'glyph' ? found.glyph : '';
}

function stems(result: LayoutResult, beat: string): Primitive[] {
  return result.primitives.filter((p) => p.kind === 'line' && p.node === beat && p.x === p.x2);
}

function accidentals(result: LayoutResult): string[] {
  return result.primitives.flatMap((p) =>
    p.kind === 'glyph' && p.glyph.startsWith('accidental') ? [p.glyph] : [],
  );
}

function space(result: LayoutResult): number {
  const staff = result.systems[0]?.staves.find((s) => s.type !== 'tab');
  if (!staff) throw new Error('no staff');
  return (staff.bottom - staff.top) / 4;
}

const ids = (built: Score, beat: number, count: number, voice = 0): string[] =>
  Array.from({ length: count }, (_, i) => noteOf(built, 0, 0, beat, i, voice).id);

describe('unisons in one voice', () => {
  it('sets a two-string unison side by side, the higher string number on the left', () => {
    const { built, result } = checked(() =>
      guitar('standard')
        .bar()
        .beat('4', [note(1, 0), note(2, 5)]),
    );
    const [one, two] = ids(built, 0, 2).map((id) => head(result, id));
    if (!one || !two) throw new Error('heads');
    expect(glyphOf(result, noteOf(built, 0, 0, 0, 0).id)).toBe('noteheadBlack');
    expect(one.y).toBeCloseTo(two.y, 3);
    expect(two.x).toBeLessThan(one.x);
    expect(one.x - two.x).toBeGreaterThan(two.width * 0.8);
  });

  it('sets a dead note beside the normal head it doubles', () => {
    const { built, result } = checked(() =>
      guitar('standard')
        .bar()
        .beat('4', [note(1, 0, { dead: true }), note(2, 5)]),
    );
    const [dead, normal] = ids(built, 0, 2);
    expect(glyphOf(result, dead ?? '')).toBe('noteheadXBlack');
    expect(glyphOf(result, normal ?? '')).toBe('noteheadBlack');
    expect(head(result, dead ?? '').x).toBeGreaterThan(head(result, normal ?? '').x + 5);
  });

  it('gives each head of a unison beside a second its own anchor (#109)', () => {
    const { built, result } = checked(() =>
      guitar('standard')
        .bar()
        .beat('2', [note(1, 5), note(2, 8), note(4, 17)]),
    );
    const [a, g2, g4] = ids(built, 0, 3).map((id) => anchorOf(result, id));
    if (!a || !g2 || !g4) throw new Error('anchors');
    expect(g2.y).toBeCloseTo(g4.y, 3);
    expect(new Set([a.x, g2.x, g4.x].map((x) => x.toFixed(2))).size).toBe(3);
  });

  it.each(['4', '1'] as const)('sets a triple unison in three columns (%s)', (duration) => {
    const { built, result } = checked(() =>
      guitar('standard')
        .bar()
        .beat(duration, [note(1, 0), note(2, 5), note(3, 9)]),
    );
    const [one, two, three] = ids(built, 0, 3).map((id) => head(result, id));
    if (!one || !two || !three) throw new Error('heads');
    // String 3 left, string 1 right.
    expect(two.x).toBeGreaterThan(three.x + three.width * 0.8);
    expect(one.x).toBeGreaterThan(two.x + two.width * 0.8);
    expect(one.x - two.x).toBeLessThan(three.width * 1.5);
  });

  it('keeps a sounding diamond off every main head (#114)', () => {
    const { built, result } = checked(() =>
      guitar('standard')
        .bar()
        .beat('1', [
          note(2, 3, { harmonic: { kind: 'artificial', value: 12 } }),
          note(4, 1, { harmonic: { kind: 'artificial', value: 12 } }),
          note(6, 22),
        ]),
    );
    const notes = ids(built, 0, 3);
    const diamonds = result.primitives.filter(
      (p) => p.kind === 'glyph' && p.glyph.startsWith('noteheadDiamond'),
    );
    const mains = notes.map((id) => head(result, id));
    for (const diamond of diamonds) {
      for (const main of mains) {
        const apart =
          rightOf(diamond.bbox) <= main.x + EPSILON ||
          rightOf(main) <= diamond.bbox.x + EPSILON ||
          Math.abs(centreY(diamond.bbox) - centreY(main)) > space(result) * 0.6;
        expect(apart).toBe(true);
      }
    }
  });
});

describe('unisons across two voices', () => {
  it('shares a quarter head, its anchor split at the centre', () => {
    const { built, result } = checked(() =>
      guitar('standard')
        .bar()
        .beat('4', [note(1, 0)])
        .voice(1)
        .beat('4', [note(2, 5)]),
    );
    const up = noteOf(built, 0, 0, 0, 0, 0).id;
    const down = noteOf(built, 0, 0, 0, 0, 1).id;
    const upHead = head(result, up);
    const downHead = head(result, down);
    expect(upHead.x).toBeCloseTo(downHead.x, 3);
    expect(upHead.width).toBeCloseTo(downHead.width, 3);
    const upStem = stems(result, built.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.id ?? '');
    const downStem = stems(result, built.tracks[0]?.bars[0]?.voices[1]?.beats[0]?.id ?? '');
    expect(upStem).toHaveLength(1);
    expect(downStem).toHaveLength(1);
    const upAnchor = anchorOf(result, up);
    const downAnchor = anchorOf(result, down);
    expect(upAnchor.x).toBeGreaterThan(downAnchor.x);
    expect(upAnchor.x).toBeCloseTo(rightOf(downAnchor), 3);
    expect(upAnchor.x).toBeCloseTo(centreX(upHead), 1);
    const y = centreY(upHead);
    expect(hitTest(result, upHead.x + upHead.width / 4, y)?.id).toBe(down);
    expect(hitTest(result, rightOf(upHead) - upHead.width / 4, y)?.id).toBe(up);
  });

  const moving: [string, () => ScoreBuilder][] = [
    [
      'half against quarter',
      () =>
        guitar('standard')
          .bar()
          .beat('2', [note(1, 0)])
          .voice(1)
          .beat('4', [note(2, 5)]),
    ],
    [
      'dead against normal',
      () =>
        guitar('standard')
          .bar()
          .beat('4', [note(1, 0, { dead: true })])
          .voice(1)
          .beat('4', [note(2, 5)]),
    ],
    [
      'dotted against undotted',
      () =>
        guitar('standard')
          .bar()
          .beat('4.', [note(1, 0)])
          .voice(1)
          .beat('4', [note(2, 5)]),
    ],
    [
      'whole against whole',
      () =>
        guitar('standard')
          .bar()
          .beat('1', [note(1, 0)])
          .voice(1)
          .beat('1', [note(2, 5)]),
    ],
    [
      'a second, C5 over B4',
      () =>
        guitar('standard')
          .bar()
          .beat('4', [note(1, 8)])
          .voice(1)
          .beat('4', [note(2, 12)]),
    ],
    [
      'an accidental and a grace on the moved voice',
      () =>
        guitar('standard')
          .bar()
          .beat('2', [note(1, 0)])
          .voice(1)
          .beat('4', [note(2, 6)], {
            grace: [{ duration: 16, before: true, notes: [note(2, 3)] }],
          }),
    ],
  ];
  it.each(moving)('moves the later voice right: %s', (_, builder) => {
    const { built, result } = checked(builder);
    const first = head(result, noteOf(built, 0, 0, 0, 0, 0).id);
    const later = noteOf(built, 0, 0, 0, 0, 1).id;
    const gap = 0.2 * space(result);
    expect(head(result, later).x).toBeGreaterThanOrEqual(rightOf(first) + gap - EPSILON);
    const drawn = result.primitives.filter(
      (p) => p.kind === 'glyph' && p.glyph.startsWith('accidental') && p.node === later,
    );
    for (const sign of drawn) expect(sign.bbox.x).toBeGreaterThan(rightOf(first) - EPSILON);
  });

  it('keeps a moved voice clear of the other, grace notes included', () => {
    const { built, result } = checked(moving[5]?.[1] ?? guitar);
    const first = head(result, noteOf(built, 0, 0, 0, 0, 0).id);
    const grace = built.tracks[0]?.bars[0]?.voices[1]?.beats[0]?.grace?.[0]?.notes[0];
    expect(head(result, grace?.id ?? '').x).toBeGreaterThan(rightOf(first) - EPSILON);
  });
});

describe('accidentals on unisons', () => {
  it('prints one sign for an F♯ unison', () => {
    const { result } = checked(() =>
      guitar('standard')
        .bar()
        .beat('4', [note(1, 2), note(2, 7)]),
    );
    expect(accidentals(result)).toEqual(['accidentalSharp']);
  });

  it('prints ♮ then ♯ for F with F♯, whatever the beat order, and the later F its ♮', () => {
    const drawn = (notes: Note[]) => {
      const built = guitar('standard')
        .bar()
        .beat('4', notes)
        .beat('4', [note(1, 1)])
        .build({ ids: 'sequential' });
      const result = laid(built);
      return result.primitives
        .filter((p) => p.kind === 'glyph' && p.node?.startsWith('note'))
        .map((p) => `${p.kind === 'glyph' ? p.glyph : ''} ${p.bbox.x.toFixed(2)}`)
        .sort();
    };
    const forward = drawn([note(1, 1), note(2, 7)]);
    expect(drawn([note(2, 7), note(1, 1)])).toEqual(forward);
    const built = guitar('standard')
      .bar()
      .beat('4', [note(1, 1), note(2, 7)])
      .beat('4', [note(1, 1)])
      .build({ ids: 'sequential' });
    const result = laid(built);
    const sign = (id: string) =>
      result.primitives.find(
        (p) => p.kind === 'glyph' && p.glyph.startsWith('accidental') && p.node === id,
      );
    const [f, sharp] = ids(built, 0, 2);
    const natural = sign(f ?? '');
    const sharpSign = sign(sharp ?? '');
    expect(natural?.kind === 'glyph' && natural.glyph).toBe('accidentalNatural');
    expect(sharpSign?.kind === 'glyph' && sharpSign.glyph).toBe('accidentalSharp');
    expect(natural?.bbox.x ?? 0).toBeLessThan(sharpSign?.bbox.x ?? 0);
    expect(head(result, f ?? '').x).toBeLessThan(head(result, sharp ?? '').x);
    const later = sign(noteOf(built, 0, 0, 1).id);
    expect(later?.kind === 'glyph' && later.glyph).toBe('accidentalNatural');
  });

  it('prints one sign per alteration in a split chord: G, G♯, G♯ prints ♮♯', () => {
    for (const notes of [
      [note(1, 3), note(2, 9), note(3, 13)],
      [note(3, 13), note(2, 9), note(1, 3)],
      [note(2, 9), note(1, 3), note(3, 13)],
    ]) {
      const built = guitar('standard').bar().beat('4', notes).build({ ids: 'sequential' });
      const result = laid(built);
      expect(accidentals(result)).toEqual(['accidentalNatural', 'accidentalSharp']);
      // The ♯ belongs to the leftmost G♯ head, the higher string number's.
      const sharp = result.primitives.find(
        (p) => p.kind === 'glyph' && p.glyph === 'accidentalSharp',
      );
      const owner = built.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.notes.find(
        (n) => n.id === sharp?.node,
      );
      expect(owner?.string).toBe(3);
    }
  });

  it('gives the next bar’s F a courtesy ♮ after F with F♯, whatever the beat order', () => {
    const nextBar = (notes: Note[]) => {
      const built = guitar('standard')
        .bar()
        .beat('1', notes)
        .bar()
        .beat('1', [note(1, 1)])
        .build({ ids: 'sequential' });
      const result = laid(built);
      const id = noteOf(built, 0, 1, 0).id;
      return result.primitives.flatMap((p) =>
        p.kind === 'glyph' && p.glyph.startsWith('accidental') && p.node === id ? [p.glyph] : [],
      );
    };
    const courtesy = ['accidentalParensLeft', 'accidentalNatural', 'accidentalParensRight'];
    expect(nextBar([note(1, 1), note(2, 7)])).toEqual(courtesy);
    expect(nextBar([note(2, 7), note(1, 1)])).toEqual(courtesy);
  });

  it('prints both signs for F♯ in one voice against F in the other', () => {
    const { result } = checked(() =>
      guitar('standard')
        .bar()
        .beat('4', [note(1, 2)])
        .voice(1)
        .beat('4', [note(2, 6)]),
    );
    expect(accidentals(result).sort()).toEqual(['accidentalNatural', 'accidentalSharp']);
  });
});

describe('ledger lines and ties on unisons', () => {
  const ledgers = (result: LayoutResult, beat: string) =>
    result.primitives.filter((p) => p.kind === 'line' && p.node === beat && p.y === p.y2);

  it('spans every column of a triple unison past the staff', () => {
    const { built, result } = checked(() =>
      guitar('standard')
        .bar()
        .beat('4', [note(1, 8), note(2, 13), note(3, 17)]),
    );
    const notes = ids(built, 0, 3).map((id) => head(result, id));
    const left = Math.min(...notes.map((box) => box.x));
    const right = Math.max(...notes.map(rightOf));
    const lines = ledgers(result, built.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.id ?? '');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.bbox.x).toBeLessThan(left);
      expect(rightOf(line.bbox)).toBeGreaterThan(right);
    }
  });

  it('meets a moved voice’s ledger lines with the earlier voice’s', () => {
    const { built, result } = checked(() =>
      guitar('standard')
        .bar()
        .beat('2', [note(1, 8)])
        .voice(1)
        .beat('4', [note(2, 13)]),
    );
    const extension = engraving.legerLineExtension * space(result);
    const first = head(result, noteOf(built, 0, 0, 0, 0, 0).id);
    const later = head(result, noteOf(built, 0, 0, 0, 0, 1).id);
    const beats = built.tracks[0]?.bars[0]?.voices.map((v) => v.beats[0]?.id ?? '') ?? [];
    const lines = beats.flatMap((id) => ledgers(result, id));
    const y = Math.min(...lines.map((line) => line.bbox.y));
    const row = lines
      .filter((line) => Math.abs(line.bbox.y - y) < EPSILON)
      .map((line) => line.bbox)
      .sort((a, b) => a.x - b.x);
    let reach = first.x - extension;
    expect(row[0]?.x ?? Infinity).toBeLessThanOrEqual(reach + EPSILON);
    for (const box of row) {
      expect(box.x).toBeLessThanOrEqual(reach + EPSILON);
      reach = Math.max(reach, rightOf(box));
    }
    expect(reach).toBeGreaterThanOrEqual(rightOf(later) + extension - EPSILON);
  });

  it('stops a bridged ledger line short of a moved voice’s accidentals and parentheses', () => {
    const cases: [Note[], Note[]][] = [
      [[note(1, 15)], [note(1, 14)]],
      [[note(1, 15)], [note(2, 19, { ghost: true })]],
      [[note(1, 15)], [note(1, 14), note(2, 19, { ghost: true })]],
      [[note(5, 0)], [note(5, 1)]],
      [[note(6, 3)], [note(6, 2)]],
    ];
    for (const [first, second] of cases) {
      // Standard only: the tab cannot hold two voices on one string at one onset.
      const built = guitar('standard')
        .bar()
        .beat('1', first)
        .voice(1)
        .beat('1', second)
        .build({ ids: 'sequential' });
      const result = laid(built);
      const moved = head(result, noteOf(built, 0, 0, 0, 0, 1).id);
      expect(moved.x).toBeGreaterThan(head(result, noteOf(built, 0, 0, 0, 0, 0).id).x + 5);
      const beats = built.tracks[0]?.bars[0]?.voices.map((v) => v.beats[0]?.id ?? '') ?? [];
      const lines = beats.flatMap((id) => ledgers(result, id)).map((line) => line.bbox);
      const signs = result.primitives.filter(
        (p) =>
          p.kind === 'glyph' &&
          (p.glyph.startsWith('accidental') || p.glyph === 'noteheadParenthesisLeft'),
      );
      expect(signs.length).toBeGreaterThan(0);
      // A ghost head's own ledger line may start inside its parenthesis; none may run into a
      // sign left of the heads from its left.
      for (const sign of signs) {
        for (const line of lines) {
          const across =
            line.y + line.height / 2 > sign.bbox.y &&
            line.y + line.height / 2 < sign.bbox.y + sign.bbox.height &&
            line.x < sign.bbox.x &&
            rightOf(line) > sign.bbox.x;
          expect(across, `${sign.kind === 'glyph' ? sign.glyph : ''} at y ${String(line.y)}`).toBe(
            false,
          );
        }
      }
    }
  });

  it('ends a tie at a moved head’s edge', () => {
    const { built, result } = checked(() =>
      guitar('standard')
        .bar()
        .beat('2', [note(1, 0, { dead: true })])
        .beat('2', [note(1, 0, { dead: true })])
        .voice(1)
        .beat('4', [note(2, 5)])
        .beat('4', [note(2, 5, { tie: true })])
        .beat('2', [note(2, 5, { tie: true })]),
    );
    const voice = (beat: number) => noteOf(built, 0, 0, beat, 0, 1).id;
    const tie = (id: string) => {
      const found = result.primitives.find((p) => p.kind === 'path' && p.node === id);
      if (!found) throw new Error(`no tie into ${id}`);
      return found.bbox;
    };
    const moved = head(result, voice(0));
    const target = head(result, voice(2));
    expect(moved.x).toBeGreaterThan(head(result, noteOf(built, 0, 0, 0, 0, 0).id).x + 5);
    expect(tie(voice(1)).x).toBeGreaterThanOrEqual(rightOf(moved) - EPSILON);
    expect(tie(voice(1)).x).toBeLessThan(rightOf(moved) + space(result));
    expect(rightOf(tie(voice(2)))).toBeLessThanOrEqual(target.x + EPSILON);
    expect(rightOf(tie(voice(2)))).toBeGreaterThan(target.x - space(result));
  });
});

describe('a tie from a moved head across a bar line', () => {
  const GAP = 0.15;

  /** Bar 1 moves voice 2's last half right of voice 1's dead head; the next bar ties into it. */
  const tied = (clef?: 'bass' | 'treble') =>
    guitar('standard')
      .bar()
      .beat('2', [note(1, 0, { dead: true })])
      .beat('2', [note(1, 0, { dead: true })])
      .voice(1)
      .beat('4.', [note(2, 5)])
      .beat('8', [note(2, 5)])
      .beat('2', [note(2, 5)])
      .bar(clef ? { clef } : {})
      .voice(1)
      .beat('2', [note(2, 5, { tie: true })]);

  /** Whole notes in both voices: the second moves right, and is wider than the black head. */
  const wholes = () =>
    guitar('standard')
      .bar()
      .beat('1', [note(1, 0)])
      .voice(1)
      .beat('1', [note(2, 5)])
      .bar()
      .voice(1)
      .beat('1', [note(2, 5, { tie: true })]);

  const tieInto = (result: LayoutResult, id: string): Rect => {
    const found = result.primitives.find(
      (p) => p.kind === 'path' && p.node === id && p.bbox.y < 120,
    );
    if (!found) throw new Error(`no tie into ${id}`);
    return found.bbox;
  };

  const expectStart = (start: number | undefined, moved: Rect, result: LayoutResult): void => {
    expect(start).toBeCloseTo(rightOf(moved) + GAP * space(result), 1);
  };

  it.each(['standard', 'both'] as const)('starts past the moved head in %s notation', (mode) => {
    const built = tied().build({ ids: 'sequential' });
    const result = laid(built, mode);
    const moved = head(result, noteOf(built, 0, 0, 2, 0, 1).id);
    expect(moved.x).toBeGreaterThan(head(result, noteOf(built, 0, 0, 1, 0, 0).id).x + 5);
    expectStart(tieInto(result, noteOf(built, 0, 1, 0, 0, 1).id).x, moved, result);
  });

  it('starts past a moved whole note, whose head is wider than a black one', () => {
    const built = wholes().build({ ids: 'sequential' });
    const result = laid(built);
    const moved = head(result, noteOf(built, 0, 0, 0, 0, 1).id);
    expect(moved.x).toBeGreaterThan(head(result, noteOf(built, 0, 0, 0, 0, 0).id).x + 5);
    expectStart(tieInto(result, noteOf(built, 0, 1, 0, 0, 1).id).x, moved, result);
  });

  it.each(['treble', 'bass'] as const)(
    'starts past the moved head when the next bar sets %s',
    (clef) => {
      const built = tied(clef).build({ ids: 'sequential' });
      const result = laid(built);
      const moved = head(result, noteOf(built, 0, 0, 2, 0, 1).id);
      expectStart(tieInto(result, noteOf(built, 0, 1, 0, 0, 1).id).x, moved, result);
    },
  );

  it('starts a hammer-on slur past the moved head', () => {
    const built = tied().build({ ids: 'sequential' });
    const target = built.tracks[0]?.bars[1]?.voices[1]?.beats[0]?.notes[0];
    if (!target) throw new Error('no target');
    target.tie = false;
    target.fret = 7;
    target.hammerPull = true;
    const result = laid(built);
    const moved = head(result, noteOf(built, 0, 0, 2, 0, 1).id);
    const slur = result.primitives.find((p) => p.kind === 'path' && p.node === target.id);
    expectStart(slur?.bbox.x, moved, result);
  });

  it('starts past the moved head when the next bar is on the next system', () => {
    const built = tied().build({ ids: 'sequential' });
    const track = built.tracks[0];
    const result = laidOut(built, {
      width: 330,
      notation: { [track?.id ?? '']: 'standard' },
    });
    const origin = noteOf(built, 0, 0, 2, 0, 1).id;
    const target = noteOf(built, 0, 1, 0, 0, 1).id;
    expect(new Set(result.anchors.map((a) => a.system)).size).toBe(2);
    const moved = head(result, origin);
    const halves = result.primitives.filter(
      (p) => p.kind === 'path' && (p.node === origin || p.node === target),
    );
    expectStart(halves.find((p) => p.bbox.x >= moved.x)?.bbox.x, moved, result);
  });
});

describe('two drum voices', () => {
  const drums = (other: number) =>
    score()
      .track('drums')
      .bar()
      .beat('4', [midi(38)])
      .voice(1)
      .beat('4', [midi(other)]);

  it('shares a snare head both voices play', () => {
    const built = drums(38).build({ ids: 'sequential' });
    const result = laid(built);
    const up = anchorOf(result, noteOf(built, 0, 0, 0, 0, 0).id, 'percussion');
    const down = anchorOf(result, noteOf(built, 0, 0, 0, 0, 1).id, 'percussion');
    expect(up.x).toBeCloseTo(rightOf(down), 3);
  });

  it('moves the later voice right of a second', () => {
    const built = drums(48).build({ ids: 'sequential' });
    const result = laid(built);
    const first = head(result, noteOf(built, 0, 0, 0, 0, 0).id);
    const later = head(result, noteOf(built, 0, 0, 0, 0, 1).id);
    expect(later.x).toBeGreaterThanOrEqual(rightOf(first) + 0.2 * space(result) - EPSILON);
  });
});

/** Raise locally to soak the column and voice rules; 300 keeps the unit suite fast. */
const RUNS = 300;

type Fret = { string: number; offset: number; dead: boolean; ghost: boolean; harmonic: boolean };

const fretted: Arbitrary<Fret> = record({
  string: integer({ min: 1, max: 6 }),
  offset: constantFrom(0, 0, 0, 1, -1, 2, -2, 5),
  dead: boolean(),
  ghost: boolean(),
  harmonic: integer({ min: 0, max: 3 }).map((n) => n === 0),
});

const chord = record({
  pitch: integer({ min: 52, max: 76 }),
  strings: array(fretted, { minLength: 1, maxLength: 6 }),
  duration: constantFrom('1', '2', '4', '8', '4.', '2.'),
});

type Chord = typeof chord extends Arbitrary<infer T> ? T : never;

const STANDARD = { tuning: [...STANDARD_TUNING] };
const open = (string: number): number => openStringPitch(STANDARD, string) ?? 0;

/** A chord's notes: one per string that reaches its pitch, dead when another note doubles it. */
function notesOf({ pitch, strings }: Chord): Note[] {
  const taken = new Map<number, number>();
  for (const { string, offset } of strings) {
    if (taken.has(string)) continue;
    const fret = pitch + offset - open(string);
    if (fret >= 0 && fret <= 24) taken.set(string, fret);
  }
  const pitches = [...taken].map(([string, fret]) => fret + open(string));
  return [...taken].map(([string, fret], i) => {
    const spec = strings.find((s) => s.string === string);
    const doubled = pitches.filter((p) => p === pitches[i]).length > 1;
    return note(string, fret, {
      ...(doubled ? { dead: spec?.dead ?? false } : { ghost: spec?.ghost ?? false }),
      ...(spec?.harmonic && { harmonic: { kind: 'artificial' as const, value: 12 } }),
    });
  });
}

describe('unisons: random chords', () => {
  it.each(['standard', 'both'] as const)(
    'gives every note one anchor that hits it in %s',
    (notation) => {
      assert(
        property(tuple(chord, option(chord, { nil: undefined })), ([first, second]) => {
          const builder = guitar(notation).bar().beat(first.duration, notesOf(first));
          if (second) builder.voice(1).beat(second.duration, notesOf(second));
          const built = builder.build({ ids: 'sequential' });
          const result = laidOut(built);
          expectValid(result);
          const staff = result.anchors.filter(
            (a: Anchor) => a.kind === 'note' && a.staff === 'standard',
          );
          const count = built.tracks[0]?.bars[0]?.voices.reduce(
            (sum, voice) => sum + voice.beats.reduce((n, beat) => n + beat.notes.length, 0),
            0,
          );
          expect(staff).toHaveLength(count ?? 0);
          expect(new Set(staff.map((a) => a.id)).size).toBe(staff.length);
          for (const anchor of staff) {
            expect(hitTest(result, centreX(anchor.bbox), centreY(anchor.bbox))?.id).toBe(anchor.id);
          }
        }),
        { numRuns: RUNS },
      );
    },
    60_000,
  );
});
