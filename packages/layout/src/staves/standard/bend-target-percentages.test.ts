import type { Bend, Score } from '@reprise/model';
import { beatOf, note } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { layout, type LayoutResult } from '../../index';
import { strayPrimitives } from '../../test/check-result';
import { describePrimitive } from '../../test/describe';
import { guitar, paged } from '../../test/effects';
import { TARGET, bendSpan } from './bend-targets';

// Guitar Pro 6 and 7 store bend positions as percentages (59.4 is the end, 29.4 and 30 one turn).
const bend = (kind: Bend['kind'], values: [number, number][]): Bend => ({
  kind,
  points: values.map(([position, value]) => ({ position, value })),
});

type NoteSpec = { string: number; fret: number; bend?: Bend };

/** One bar of 8ths with `bent` on beat 2, then a plain bar. */
function bar(bent: NoteSpec[] | undefined): Score {
  const builder = guitar('standard');
  for (let b = 0; b < 8; b += 1) {
    builder.beat(
      '8',
      b === 2 && bent
        ? bent.map((n) => note(n.string, n.fret, n.bend ? { bend: n.bend } : {}))
        : [note(3, 7)],
    );
  }
  builder.bar();
  for (let b = 0; b < 8; b += 1) builder.beat('8', [note(3, 7)]);
  return builder.build();
}

interface Measured {
  /** Next beat's leftmost glyph minus the bent beat's rightmost glyph edge (target heads included). */
  clearance: number;
  gap: number;
  right: number;
  systems: number;
}

function measure(built: Score): Measured {
  const result: LayoutResult = layout(built, paged);
  const ids = (beat: number): Set<string> => {
    const b = beatOf(built, 0, 0, beat);
    return new Set([b.id, ...b.notes.map((n) => n.id)]);
  };
  const glyphs = (beat: number) => {
    const set = ids(beat);
    return result.primitives.filter(
      (p) => p.kind === 'glyph' && p.node !== undefined && set.has(p.node),
    );
  };
  const right = Math.max(...glyphs(2).map((p) => p.bbox.x + p.bbox.width));
  const nextLeft = Math.min(...glyphs(3).map((p) => p.bbox.x));
  const anchor = (beat: number): number =>
    result.anchors.find((a) => a.kind === 'beat' && a.id === beatOf(built, 0, 0, beat).id)?.bbox
      .x ?? NaN;
  expect(strayPrimitives(result, built).map(describePrimitive)).toEqual([]);
  return {
    clearance: nextLeft - right,
    gap: anchor(3) - anchor(2),
    right,
    systems: result.systems.length,
  };
}

/** 0.6 staff spaces at the default 7 px space. */
const CLEARANCE = 0.6 * 7 - 0.1;

const SHAPES: [string, Bend, Bend][] = [
  [
    'release ending at 59.4',
    bend('release', [
      [0, 4],
      [59.4, 0],
    ]),
    bend('release', [
      [0, 4],
      [60, 0],
    ]),
  ],
  [
    'release ending at 58.2',
    bend('release', [
      [0, 4],
      [58.2, 0],
    ]),
    bend('release', [
      [0, 4],
      [60, 0],
    ]),
  ],
  [
    'release ending at 57',
    bend('release', [
      [0, 4],
      [57, 0],
    ]),
    bend('release', [
      [0, 4],
      [60, 0],
    ]),
  ],
  [
    'bendRelease dipping at 29.4 and 30',
    bend('bendRelease', [
      [0, 0],
      [29.4, 2],
      [30, 2],
      [60, 0],
    ]),
    bend('bendRelease', [
      [0, 0],
      [30, 2],
      [30, 2],
      [60, 0],
    ]),
  ],
  [
    'prebendRelease ending at 59.4',
    bend('prebendRelease', [
      [0, 4],
      [59.4, 0],
    ]),
    bend('prebendRelease', [
      [0, 4],
      [60, 0],
    ]),
  ],
];

describe('bends with percentage positions', () => {
  it.each(SHAPES)('%s lays out like its integer positions', (_name, shape, integer) => {
    const got = measure(bar([{ string: 3, fret: 7, bend: shape }]));
    const want = measure(bar([{ string: 3, fret: 7, bend: integer }]));
    expect(got.systems).toBe(want.systems);
    expect(Math.abs(got.gap - want.gap)).toBeLessThan(1);
    expect(Math.abs(got.right - want.right)).toBeLessThan(1);
    expect(got.clearance).toBeGreaterThanOrEqual(CLEARANCE);
  });

  it('draws targets within the snap distance of each other as one chord, as 30 and 30 would', () => {
    const at = (a: number, b: number): Measured =>
      measure(
        bar([
          {
            string: 3,
            fret: 7,
            bend: bend('bend', [
              [0, 0],
              [a, 4],
              [60, 4],
            ]),
          },
          {
            string: 2,
            fret: 5,
            bend: bend('bend', [
              [0, 0],
              [b, 2],
              [60, 2],
            ]),
          },
        ]),
      );
    const got = at(28, 30);
    const want = at(30, 30);
    // The group sits at 28, so its heads sit up to 2/60 of the frame left of the 30 case's.
    expect(Math.abs(got.right - want.right)).toBeLessThan(2);
    expect(Math.abs(got.gap - want.gap)).toBeLessThan(2);
  });

  it('keeps every head clear of the next onset for arrivals from 50 to 59.4, with and without a sign', () => {
    for (const arrival of [50, 51, 54, 55, 56, 57, 58.2, 59.4]) {
      for (const [kind, value, fret] of [
        ['bend', 2, 7], // a half bend: its D-sharp head takes an accidental
        ['bend', 4, 6],
        ['release', 0, 7],
      ] as const) {
        const shape =
          kind === 'bend'
            ? bend('bend', [
                [0, 0],
                [arrival, value],
                [60, value],
              ])
            : bend('release', [
                [0, 4],
                [arrival, value],
              ]);
        const got = measure(bar([{ string: 3, fret, bend: shape }]));
        expect(
          got.clearance,
          `${kind} ${String(value)} at ${String(arrival)}`,
        ).toBeGreaterThanOrEqual(CLEARANCE);
      }
    }
  });

  it('keeps a chord whose bends arrive at 56 and 59.4 clear of itself and the next onset', () => {
    const got = measure(
      bar([
        {
          string: 3,
          fret: 7,
          bend: bend('bend', [
            [0, 0],
            [56, 2],
            [60, 2],
          ]),
        },
        {
          string: 2,
          fret: 5,
          bend: bend('bend', [
            [0, 0],
            [59.4, 4],
            [60, 4],
          ]),
        },
      ]),
    );
    expect(got.clearance).toBeGreaterThanOrEqual(CLEARANCE);
  });
});

describe('bendSpan with percentage positions', () => {
  const space = 10;

  it('counts a group within the snap distance of the end as arriving at it', () => {
    const at60 = bendSpan([{ position: 60, width: 7 }], [], space);
    expect(bendSpan([{ position: 57, width: 7 }], [], space)).toEqual(at60);
    expect(bendSpan([{ position: 56.9, width: 7 }], [], space).tail).toBe(0);
  });

  it('counts an obstacle within the snap distance after a group as coincident', () => {
    const none = bendSpan([{ position: 29.4, width: 7 }], [], space);
    expect(bendSpan([{ position: 29.4, width: 7 }], [{ position: 30, offset: 0 }], space)).toEqual(
      none,
    );
    expect(TARGET.snap).toBe(3);
  });
});
