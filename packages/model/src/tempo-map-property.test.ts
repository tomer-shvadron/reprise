import { array, assert, constantFrom, integer, option, property, record, tuple } from 'fast-check';
import type { Arbitrary } from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Bar } from './bar';
import type { Beat, Dots, Duration } from './beat';
import {
  createBar,
  createBeat,
  createEmptyScore,
  createMasterBar,
  createTrack,
  createVoice,
} from './factories';
import type { MasterBar } from './master-bar';
import { expandPlaybackSequence } from './playback-sequence';
import type { Score } from './score';
import { positionAtSeconds, secondsAt, tempoMap } from './tempo-map';

const bpmArbitrary = integer({ min: 20, max: 300 });

const beatArbitrary: Arbitrary<Beat> = record({
  duration: constantFrom<Duration>(1, 2, 4, 8, 16, 32, 64, 128, 256),
  dots: constantFrom<Dots>(0, 1, 2),
  tuplet: option(record({ n: integer({ min: 1, max: 7 }), of: integer({ min: 1, max: 4 }) }), {
    nil: undefined,
  }),
  tempo: option(
    record({
      bpm: bpmArbitrary,
      duration: option(integer({ min: 1, max: 8 }), { nil: undefined }),
    }),
    {
      nil: undefined,
    },
  ),
}).map(({ duration, dots, tuplet, tempo }) =>
  createBeat({
    duration,
    dots,
    ...(tuplet ? { tuplet } : {}),
    ...(tempo
      ? {
          mix: {
            tempo: { bpm: tempo.bpm, ...(tempo.duration ? { duration: tempo.duration } : {}) },
          },
        }
      : {}),
  }),
);

const barArbitrary: Arbitrary<[MasterBar, Bar]> = tuple(
  record({
    numerator: integer({ min: 1, max: 7 }),
    denominator: constantFrom(2, 4, 8),
    mark: option(bpmArbitrary, { nil: undefined }),
    repeat: constantFrom('none', 'start', 'end'),
  }),
  array(beatArbitrary, { minLength: 1, maxLength: 6 }),
).map(([{ numerator, denominator, mark, repeat }, beats]) => [
  createMasterBar({
    timeSignature: { numerator, denominator },
    ...(mark ? { tempo: { bpm: mark } } : {}),
    repeat: { start: repeat === 'start', endCount: repeat === 'end' ? 2 : 0 },
  }),
  { ...createBar(), voices: [createVoice(beats), createVoice(), createVoice(), createVoice()] },
]);

const scoreArbitrary: Arbitrary<Score> = array(barArbitrary, { minLength: 1, maxLength: 5 }).map(
  (bars) => ({
    ...createEmptyScore(),
    masterBars: bars.map(([masterBar]) => masterBar),
    tracks: [createTrack('fretted', { bars: bars.map(([, bar]) => bar) })],
  }),
);

describe('tempoMap: properties', () => {
  it('times passes contiguously, keeps every tempo positive, and inverts secondsAt inside each pass', () => {
    assert(
      property(scoreArbitrary, (score) => {
        const map = tempoMap(score, expandPlaybackSequence(score).sequence);
        let expectedStart = 0;
        for (const [index, pass] of map.passes.entries()) {
          expect(pass.startSeconds).toBeCloseTo(expectedStart, 9);
          expect(pass.durationSeconds).toBeGreaterThan(0);
          expect(pass.segments.reduce((sum, segment) => sum + segment.ticks, 0)).toBeCloseTo(
            pass.ticks,
            6,
          );
          for (const segment of pass.segments) {
            expect(segment.startBpm).toBeGreaterThan(0);
            expect(segment.endBpm).toBeGreaterThan(0);
          }
          let previous = -1;
          for (const fraction of [0, 0.2, 0.5, 0.8]) {
            const tick = pass.ticks * fraction;
            const seconds = secondsAt(map, index, tick);
            expect(seconds).toBeGreaterThanOrEqual(previous);
            previous = seconds;
            const position = positionAtSeconds(map, seconds);
            expect(position?.sequenceIndex).toBe(index);
            expect(position?.tick).toBeCloseTo(tick, 6);
          }
          expectedStart += pass.durationSeconds;
        }
        expect(map.durationSeconds).toBeCloseTo(expectedStart, 9);
      }),
      { numRuns: 300 },
    );
  });
});
