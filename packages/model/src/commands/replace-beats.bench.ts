import { expect, test } from 'vitest';

import { BeatSchema } from '../beat';
import type { Beat } from '../beat';
import { applyCommand } from '../history';
import { newId } from '../id';
import { largeScore } from '../testing';
import { insertBeat, removeBeat, replaceBeats } from './beat-commands';
import { chain } from './chain';

const RUN = { iterations: 15, time: 0, warmupIterations: 3, warmupTime: 0 };

// Unbudgeted, so the numbers are reported only. A paste of 4 bars on each of 8 tracks replaces the
// beats of 32 voices, each with a copy of another bar's beats under fresh ids.
const score = largeScore(8, 300);

function withFreshIds(beat: Beat): Beat {
  const copy = BeatSchema.parse(JSON.parse(JSON.stringify(beat)));
  copy.id = newId();
  for (const note of [...copy.notes, ...(copy.grace ?? []).flatMap((g) => g.notes)]) {
    note.id = newId();
  }
  return copy;
}

const targets = score.tracks.flatMap((track) =>
  track.bars.slice(100, 104).flatMap((bar, i) => {
    const voice = bar.voices[0];
    const source = track.bars[i]?.voices[0];
    if (!source) throw new Error('no voice');
    return [{ voice, source }];
  }),
);
const edits = targets.map(({ voice, source }) => ({
  voiceId: voice.id,
  index: 0,
  remove: voice.beats.length,
  beats: source.beats.map(withFreshIds),
}));
const steps = targets.flatMap(({ voice }, t) => [
  ...voice.beats.map((beat) => removeBeat({ beatId: beat.id })),
  ...(edits[t]?.beats ?? []).map((beat, i) =>
    insertBeat({ voiceId: voice.id, index: i, id: beat.id }, beat),
  ),
]);

test(
  'replaceBeats, 4 bars x 8 tracks, largeScore(8, 300)',
  { timeout: 120_000 },
  async (context) => {
    expect(edits).toHaveLength(32);
    const result = await context
      .bench('replaceBeats, 4 bars x 8 tracks, largeScore(8, 300)', () => {
        applyCommand(score, replaceBeats(edits));
      })
      .run(RUN);
    expect(result.latency.p50).toBeGreaterThan(0);
  },
);

// The same paste as a chain of one removeBeat or insertBeat per beat: each step walks the score.
test(
  'chain of removeBeat/insertBeat, 4 bars x 8 tracks, largeScore(8, 300)',
  { timeout: 120_000 },
  async (context) => {
    const result = await context
      .bench('chain of removeBeat/insertBeat, 4 bars x 8 tracks, largeScore(8, 300)', () => {
        applyCommand(score, chain('paste', steps));
      })
      .run({ iterations: 3, time: 0, warmupIterations: 1, warmupTime: 0 });
    expect(result.latency.p50).toBeGreaterThan(0);
  },
);
