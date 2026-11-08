import type { Bend } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { BENDS } from '../../test/effects';
import { TARGET, bendSpan, bendTargets, targetKey } from './bend-targets';

describe('bendTargets', () => {
  it.each([
    ['quarter', []],
    ['half', [{ value: 2, position: 60 }]],
    ['full', [{ value: 4, position: 30 }]],
    ['oneAndHalf', [{ value: 6, position: 60 }]],
    ['two', [{ value: 8, position: 60 }]],
    [
      'bendRelease',
      [
        { value: 4, position: 20 },
        { value: 0, position: 60 },
      ],
    ],
    ['bendReleaseBend', []],
    ['prebend', []],
    ['prebendBend', [{ value: 4, position: 60 }]],
    ['prebendRelease', [{ value: 0, position: 60 }]],
    ['release', [{ value: 0, position: 60 }]],
    ['hold', []],
    ['custom', []],
  ] as const)('reads %s', (kind, expected) => {
    expect(bendTargets(BENDS[kind])).toEqual(expected);
  });

  const bend = (kind: Bend['kind'], values: [number, number][]): Bend => ({
    kind,
    points: values.map(([position, value]) => ({ position, value })),
  });

  it('keeps the first point of a final run of equal values, as a zigzag bend ends', () => {
    const zigzag = bend('bend', [
      [0, 0],
      [10, 12],
      [20, 1],
      [30, 10],
      [45, 6],
      [60, 6],
    ]);
    expect(bendTargets(zigzag)).toEqual([{ value: 6, position: 45 }]);
  });

  it('leaves out an odd last value', () => {
    const odd = bend('bend', [
      [0, 0],
      [60, 5],
    ]);
    expect(bendTargets(odd)).toEqual([]);
  });

  it('names a target by its note and index', () => {
    expect(targetKey('note1', 1)).toBe('note1:bend:1');
  });
});

describe('bendSpan', () => {
  const space = 10;
  const gap = TARGET.gap * space;

  it('keeps a group at the end clear with a tail alone', () => {
    expect(bendSpan([{ position: 60, width: 7 }], [], space)).toEqual({ need: 0, tail: gap + 7 });
  });

  it('asks for a frame that clears the obstacle after a group', () => {
    const { need, tail } = bendSpan(
      [{ position: 20, width: 7 }],
      [{ position: 40, offset: 0 }],
      space,
    );
    expect(tail).toBe(0);
    expect(need).toBeCloseTo(Math.max((7 + 2 * gap) / (1 / 3), (7 + gap) / (2 / 3)), 6);
  });

  it('adds the offset of an obstacle drawn from the onset', () => {
    const plain = bendSpan([{ position: 20, width: 7 }], [{ position: 40, offset: 0 }], space);
    const offset = bendSpan([{ position: 20, width: 7 }], [{ position: 40, offset: 6 }], space);
    expect(offset.need - plain.need).toBeCloseTo(6 / (1 / 3), 6);
  });

  it('ignores an obstacle at the same position or before', () => {
    const none = bendSpan([{ position: 30, width: 7 }], [], space);
    const same = bendSpan(
      [{ position: 30, width: 7 }],
      [
        { position: 30, offset: 0 },
        { position: 10, offset: 0 },
      ],
      space,
    );
    expect(same).toEqual(none);
  });
});
