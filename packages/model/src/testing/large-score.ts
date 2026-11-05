import {
  createBar,
  createBeat,
  createMasterBar,
  createNote,
  createScoreMeta,
  createTrack,
  createVoice,
  newId,
} from '../index';
import type { Bar, Beat, MasterBar, Score } from '../index';

export interface LargeScoreOptions {
  /**
   * Varies the score so it is not one bar repeated: a tempo change every 16 bars, a repeated
   * section every 8, a 3/4 bar every 5th, a rest every 7th eighth and text on every 4th.
   */
  structure?: boolean;
}

function masterBarAt(m: number, structure: boolean): MasterBar {
  if (!structure) return createMasterBar(m === 0 ? { tempo: { bpm: 120 } } : {});
  return createMasterBar({
    ...(m % 16 === 0 && { tempo: { bpm: 90 + m } }),
    repeat: { start: m % 8 === 0, endCount: m % 8 === 7 ? 2 : 0 },
    timeSignature:
      m % 5 === 4 ? { numerator: 3, denominator: 4 } : { numerator: 4, denominator: 4 },
  });
}

function eighthAt(t: number, b: number, i: number, structure: boolean): Beat {
  if (structure && (b + i + t) % 7 === 0) return createBeat({ duration: 8, rest: true });
  return createBeat({
    duration: 8,
    notes: [
      createNote({ string: ((b + i) % 6) + 1, fret: (b + i + t) % 12 }),
      createNote({ string: ((b + i + 2) % 6) + 1, fret: (b + i) % 12, palmMute: i % 2 === 0 }),
    ],
    ...(structure && i % 4 === 0 && { text: `b${String(b)}` }),
  });
}

/**
 * A valid score of `tracks` guitar tracks by `bars` bars for performance and memory tests: each
 * bar fills voice 1 with eighths of two notes and voice 2 with a whole-bar rest. Plain, 8 tracks
 * by 300 bars is 38,400 notes in 21,600 beats.
 */
export function largeScore(tracks: number, bars: number, options: LargeScoreOptions = {}): Score {
  const { structure = false } = options;
  const masterBars = Array.from({ length: bars }, (_, m) => masterBarAt(m, structure));
  return {
    id: newId(),
    meta: createScoreMeta(),
    masterBars,
    tracks: Array.from({ length: tracks }, (_, t) =>
      createTrack('fretted', {
        name: `Track ${String(t + 1)}`,
        bars: masterBars.map((masterBar, b): Bar => {
          const { numerator, denominator } = masterBar.timeSignature;
          const eighths = (numerator * 8) / denominator;
          const beats = Array.from({ length: eighths }, (_, i) => eighthAt(t, b, i, structure));
          const rest =
            eighths === 6
              ? createBeat({ duration: 2, dots: 1, rest: true })
              : createBeat({ duration: 1, rest: true });
          return {
            ...createBar(),
            voices: [createVoice(beats), createVoice([rest]), createVoice(), createVoice()],
          };
        }),
      }),
    ),
  };
}
