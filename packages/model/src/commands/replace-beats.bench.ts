import { expect, test } from 'vitest';

import { BeatSchema } from '../beat';
import type { Beat } from '../beat';
import { applyCommand } from '../history';
import { newId } from '../id';
import { largeScore } from '../testing';
import { replaceBeats } from './beat-commands';

const RUN = { iterations: 15, time: 0, warmupIterations: 3, warmupTime: 0 };

// Unbudgeted, so the number is reported only. A chain of one removeBeat or insertBeat per beat for
// the same paste took about 2.45 s, against about 37 ms here.
// A paste of 4 bars on each of 8 tracks replaces the
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
