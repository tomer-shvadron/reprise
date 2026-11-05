import { describe, expect, it } from 'vitest';

import type { Bar } from './bar';
import {
  createBar,
  createBeat,
  createEmptyScore,
  createMasterBar,
  createNote,
  createTrack,
  createVoice,
} from './factories';
import { ScoreSchema } from './score';
import type { Score } from './score';
import { validateScore } from './validate';

const TRACKS = 8;
const BARS = 300;
const BEATS_PER_BAR = 8;

// Two notes per eighth in voice 1, a whole rest in voice 2: 38,400 notes, 21,600 beats.
function buildLargeScore(): Score {
  const masterBars = Array.from({ length: BARS }, (_, m) =>
    createMasterBar(m === 0 ? { tempo: { bpm: 120 } } : {}),
  );
  const tracks = Array.from({ length: TRACKS }, (_, t) =>
    createTrack('fretted', {
      bars: Array.from({ length: BARS }, (_, b): Bar => {
        const beats = Array.from({ length: BEATS_PER_BAR }, (_, i) =>
          createBeat({
            duration: 8,
            notes: [
              createNote({ string: ((b + i) % 6) + 1, fret: (b + i + t) % 12 }),
              createNote({
                string: ((b + i + 2) % 6) + 1,
                fret: (b + i) % 12,
                palmMute: i % 2 === 0,
              }),
            ],
          }),
        );
        const rest = createVoice([createBeat({ duration: 1, rest: true })]);
        return { ...createBar(), voices: [createVoice(beats), rest, createVoice(), createVoice()] };
      }),
    }),
  );
  return { ...createEmptyScore(), masterBars, tracks };
}

// Date.now() because the package's lib has no `performance`; millisecond resolution is enough.
function timed<T>(run: () => T): [T, number] {
  const start = Date.now();
  const result = run();
  return [result, Date.now() - start];
}

// Measured at 15 to 26 ms, 67 ms and 12 ms; the bounds only catch a quadratic regression.
describe('a large score', () => {
  const score = buildLargeScore();

  it('validates in linear time', () => {
    const [violations, ms] = timed(() => validateScore(score));
    expect(violations).toEqual([]);
    expect(ms).toBeLessThan(1000);
  });

  it('round-trips through JSON and the schema', () => {
    const [json, stringifyMs] = timed(() => JSON.stringify(score));
    const [parsed, parseMs] = timed(() => ScoreSchema.parse(JSON.parse(json)));
    expect(parsed).toEqual(score);
    expect(stringifyMs).toBeLessThan(1000);
    expect(parseMs).toBeLessThan(2000);
  });
});
