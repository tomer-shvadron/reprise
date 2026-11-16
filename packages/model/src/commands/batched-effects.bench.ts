import { expect, test } from 'vitest';

import { createNote } from '../factories';
import { applyCommand } from '../history';
import { largeScore } from '../testing';
import { setBeatEffects } from './beat-commands';
import { setNoteEffects } from './note-commands';

// tinybench: exactly 15 timed iterations after 3 untimed ones, as the layout benches run.
const RUN = { iterations: 15, time: 0, warmupIterations: 3, warmupTime: 0 };

// Unbudgeted, so there is no row in the roadmap's budgets table to assert; the number is reported
// only. A chain of one setNoteEffect per note took about 0.75 to 0.95 s for the same 400 notes.
const score = largeScore(8, 300);
const edits = score.tracks
  .flatMap((track) => track.bars.slice(0, 25))
  .flatMap((bar) => bar.voices.slice(0, 1).flatMap((voice) => voice.beats))
  .flatMap((beat) => beat.notes)
  .slice(0, 400)
  .map((note) => ({ noteId: note.id, effects: { palmMute: !note.palmMute } }));

test('setNoteEffects, 400 notes, largeScore(8, 300)', { timeout: 120_000 }, async (context) => {
  expect(edits).toHaveLength(400);
  const result = await context
    .bench('setNoteEffects, 400 notes, largeScore(8, 300)', () => {
      applyCommand(score, setNoteEffects(edits));
    })
    .run(RUN);
  expect(result.latency.p50).toBeGreaterThan(0);
});

// A new grace note on each of 400 beats: the fresh-id check is one walk for the whole batch, where
// it was one walk per note (719 ms) before the shared `assertFreshIds`.
const graceEdits = score.tracks
  .flatMap((track) => track.bars.slice(0, 25))
  .flatMap((bar) => bar.voices.slice(0, 1).flatMap((voice) => voice.beats))
  .slice(0, 400)
  .map((beat) => ({
    beatId: beat.id,
    changes: {
      grace: [{ duration: 16 as const, before: true, notes: [createNote({ string: 2, fret: 4 })] }],
    },
  }));

test(
  'setBeatEffects, 400 grace notes, largeScore(8, 300)',
  { timeout: 120_000 },
  async (context) => {
    expect(graceEdits).toHaveLength(400);
    const result = await context
      .bench('setBeatEffects, 400 grace notes, largeScore(8, 300)', () => {
        applyCommand(score, setBeatEffects(graceEdits));
      })
      .run(RUN);
    expect(result.latency.p50).toBeGreaterThan(0);
  },
);
