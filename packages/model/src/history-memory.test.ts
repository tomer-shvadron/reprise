import { describe, expect, it } from 'vitest';

import { setNote } from './commands/note-commands';
import { createHistory } from './history';
import { largeScore } from './testing';

const TRACKS = 8;
const BARS = 300;
const BEATS_PER_BAR = 8;
const EDITS = 1000;
// Measured at 193,598 bytes, about 194 per edit (forward plus inverse); the score is 9.8 MB of JSON.
const BUDGET_BYTES = 256 * 1024;

describe('history memory', () => {
  it(
    `keeps ${String(EDITS)} single-note edits on a long score under ${String(BUDGET_BYTES)} bytes`,
    { timeout: 30_000 },
    () => {
      let score = largeScore(TRACKS, BARS);
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
    },
  );
});
