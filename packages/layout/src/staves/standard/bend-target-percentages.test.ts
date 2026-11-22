import type { Bend, Score } from '@reprise/model';
import { beatOf, note } from '@reprise/model/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { layout } from '../../index';
import { strayPrimitives } from '../../test/check-result';
import { describePrimitive } from '../../test/describe';
import { guitar, paged } from '../../test/effects';
import { TARGET, bendSpan } from './bend-targets';

// Guitar Pro 6 and 7 store bend positions as percentages (59.4 is the end, 29.4 and 30 one turn).
const bend = (kind: Bend['kind'], values: [number, number][]): Bend => ({
  kind,
  points: values.map(([position, value]) => ({ position, value })),
});

const SHAPES: [string, Bend][] = [
  [
    'release ending at 59.4',
    bend('release', [
      [0, 4],
      [59.4, 0],
    ]),
  ],
  [
    'release ending at 58.2',
    bend('release', [
      [0, 4],
      [58.2, 0],
    ]),
  ],
  [
    'release ending at 57',
    bend('release', [
      [0, 4],
      [57, 0],
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
  ],
  [
    'prebendRelease ending at 59.4',
    bend('prebendRelease', [
      [0, 4],
      [59.4, 0],
    ]),
  ],
];

function bar(withBend: Bend | undefined, bent: number): Score {
  const builder = guitar('standard');
  for (let b = 0; b < 8; b += 1) {
    builder.beat('8', [note(3, 7, b === bent && withBend ? { bend: withBend } : {})]);
  }
  builder.bar();
  for (let b = 0; b < 8; b += 1) builder.beat('8', [note(3, 7)]);
  return builder.build();
}

function beatX(built: Score, result: ReturnType<typeof layout>, bar: number, beat: number): number {
  const id = beatOf(built, 0, bar, beat).id;
  const anchor = result.anchors.find((a) => a.kind === 'beat' && a.id === id);
  expect(anchor, `beat ${String(beat)}`).toBeDefined();
  return anchor?.bbox.x ?? 0;
}

describe('bends with percentage positions', () => {
  it.each(SHAPES)('%s does not stretch the bar', (_name, shape) => {
    const plain = bar(undefined, 2);
    const built = bar(shape, 2);
    const base = layout(plain, paged);
    const result = layout(built, paged);
    const gap = (score: Score, r: typeof result): number =>
      beatX(score, r, 0, 3) - beatX(score, r, 0, 2);
    expect(result.systems).toHaveLength(base.systems.length);
    expect(gap(built, result)).toBeLessThanOrEqual(3 * gap(plain, base));
    expect(strayPrimitives(result, built).map(describePrimitive)).toEqual([]);
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
  });

  it('never asks for more than maxNeed', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            position: fc.double({ min: 0, max: 60, noNaN: true }),
            width: fc.double({ min: 0, max: 12, noNaN: true }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        fc.array(
          fc.record({
            position: fc.double({ min: 0, max: 60, noNaN: true }),
            offset: fc.double({ min: 0, max: 10, noNaN: true }),
          }),
          { maxLength: 8 },
        ),
        (groups, obstacles) => {
          expect(bendSpan(groups, obstacles, space).need).toBeLessThanOrEqual(
            TARGET.maxNeed * space,
          );
        },
      ),
    );
  });
});
