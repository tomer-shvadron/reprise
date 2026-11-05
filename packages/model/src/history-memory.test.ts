import { describe, expect, it } from 'vitest';

import type { Bar } from './bar';
import { setNote } from './commands/note-commands';
import {
  createBar,
  createBeat,
  createEmptyScore,
  createMasterBar,
  createNote,
  createTrack,
  createVoice,
} from './factories';
import { createHistory } from './history';
import type { Score } from './score';

const TRACKS = 8;
const BARS = 300;
const BEATS_PER_BAR = 8;
const EDITS = 1000;
// Measured at 193,598 bytes, about 194 per edit (forward plus inverse); the score is 9.6 MB of JSON.
const BUDGET_BYTES = 256 * 1024;

// The shape of large-score.test.ts: 38,400 notes, two per eighth on every track.
function buildLongScore(): Score {
  const masterBars = Array.from({ length: BARS }, (_, m) =>
    createMasterBar(m === 0 ? { tempo: { bpm: 120 } } : {}),
  );
  const tracks = Array.from({ length: TRACKS }, () =>
    createTrack('fretted', {
      bars: Array.from({ length: BARS }, (_, b): Bar => {
        const beats = Array.from({ length: BEATS_PER_BAR }, (_, i) =>
          createBeat({
            duration: 8,
            notes: [
              createNote({ string: ((b + i) % 6) + 1, fret: (b + i) % 12 }),
              createNote({ string: ((b + i + 2) % 6) + 1, fret: (b + i) % 12 }),
            ],
          }),
        );
        return {
          ...createBar(),
          voices: [createVoice(beats), createVoice(), createVoice(), createVoice()],
        };
      }),
    }),
  );
  return { ...createEmptyScore(), masterBars, tracks };
}

describe('history memory', () => {
  it(`keeps ${String(EDITS)} single-note edits on a long score under ${String(BUDGET_BYTES)} bytes`, () => {
    let score = buildLongScore();
    const scoreBytes = JSON.stringify(score).length;
    const history = createHistory();
    for (let edit = 0; edit < EDITS; edit++) {
      const track = score.tracks[edit % TRACKS];
      const beat = track?.bars[(edit * 37) % BARS]?.voices[0].beats[edit % BEATS_PER_BAR];
      const note = beat?.notes[0];
      if (!beat || !note) throw new Error('the long score lost a beat');
      score = history.apply(
        score,
        setNote({ beatId: beat.id }, { string: note.string, fret: (note.fret + 1) % 12 }),
      ).score;
    }

    const steps = history.steps;
    const bytes = steps.reduce(
      (sum, step) =>
        sum + JSON.stringify(step.patches).length + JSON.stringify(step.inverse).length,
      0,
    );
    expect(steps).toHaveLength(EDITS);
    expect(bytes).toBeLessThan(BUDGET_BYTES);
    // Snapshots would hold a copy of the score per step: a thousand times scoreBytes.
    expect(bytes).toBeLessThan(scoreBytes / 10);
  });
});
