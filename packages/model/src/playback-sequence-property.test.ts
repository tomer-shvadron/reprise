import {
  array,
  assert,
  boolean,
  constant,
  constantFrom,
  integer,
  oneof,
  property,
  record,
  uniqueArray,
} from 'fast-check';
import type { Arbitrary } from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createMasterBar } from './factories';
import { DirectionTargetSchema, JumpKindSchema } from './master-bar';
import type { MasterBar } from './master-bar';
import {
  PLAYBACK_LENGTH_FACTOR,
  expandCounted,
  expandPlaybackSequence,
  playbackStepLimit,
} from './playback-sequence';

const masterBarArbitrary: Arbitrary<MasterBar> = record({
  start: boolean(),
  endCount: oneof(
    { weight: 6, arbitrary: constant(0) },
    { weight: 3, arbitrary: integer({ min: 1, max: 4 }) },
    { weight: 1, arbitrary: integer({ min: 5, max: 200 }) },
  ),
  alternateEndings: uniqueArray(integer({ min: 1, max: 4 }), { maxLength: 2 }),
  jumps: array(constantFrom(...JumpKindSchema.options), { maxLength: 2 }),
  targets: uniqueArray(constantFrom(...DirectionTargetSchema.options), { maxLength: 2 }),
}).map(({ start, endCount, alternateEndings, jumps, targets }) =>
  createMasterBar({
    repeat: { start, endCount },
    alternateEndings: [...alternateEndings].sort((a, b) => a - b),
    jumps: jumps.map((kind) => ({ kind })),
    targets,
  }),
);

const masterBarsArbitrary = array(masterBarArbitrary, { minLength: 1, maxLength: 40 });

describe('expandPlaybackSequence: properties', () => {
  it(
    'is finite, bounded by a multiple of the bar count, and numbers passes consistently',
    { timeout: 30_000 },
    () => {
      assert(
        property(masterBarsArbitrary, (masterBars) => {
          const { sequence, steps } = expandCounted({ masterBars });
          expect(sequence.length).toBeLessThanOrEqual(masterBars.length * PLAYBACK_LENGTH_FACTOR);
          expect(steps).toBeLessThanOrEqual(playbackStepLimit(masterBars.length) + 1);
          const seen = masterBars.map(() => 0);
          for (const { masterBarIndex, passIndex } of sequence) {
            expect(masterBarIndex).toBeGreaterThanOrEqual(0);
            expect(masterBarIndex).toBeLessThan(masterBars.length);
            expect(passIndex).toBe(seen[masterBarIndex]);
            seen[masterBarIndex] = passIndex + 1;
          }
        }),
        { numRuns: 2000 },
      );
    },
  );

  it('without repeats, plays each bar at most once per jump instruction plus once', () => {
    const withoutRepeats = masterBarsArbitrary.map((masterBars) =>
      masterBars.map((masterBar) => ({ ...masterBar, repeat: { start: false, endCount: 0 } })),
    );
    assert(
      property(withoutRepeats, (masterBars) => {
        const { sequence, warnings } = expandPlaybackSequence({ masterBars });
        const jumpCount = masterBars.reduce((sum, masterBar) => sum + masterBar.jumps.length, 0);
        expect(sequence.length).toBeLessThanOrEqual(masterBars.length * (jumpCount + 1));
        expect(warnings.map((warning) => warning.code)).not.toContain('sequence-truncated');
      }),
      { numRuns: 2000 },
    );
  });

  it('is the written order when no bar carries a repeat, volta or jump', () => {
    const plain = array(constant(null), { minLength: 1, maxLength: 60 }).map((slots) =>
      slots.map(() => createMasterBar()),
    );
    assert(
      property(plain, (masterBars) => {
        const { sequence } = expandPlaybackSequence({ masterBars });
        expect(sequence.map((pass) => pass.masterBarIndex)).toEqual(
          masterBars.map((_, index) => index),
        );
      }),
    );
  });
});
