import { largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { panelState } from './panel-state';

describe('panelState', () => {
  // Reference machine: about 70 to 90 ms for 38,400 notes picked at once (it was 250 ms when
  // each effect resolved the target itself). Under the pre-commit hook's parallel runs it took 2.5 s, so the bound is 10 s (3x the worst seen,
  // in the 1-2-5 series) and the timeout 30 s.
  it('reads every control for a select-all of a large score in about a tenth of a second', () => {
    const score = largeScore(8, 300);
    const beatIds = score.tracks.flatMap((track) =>
      track.bars.flatMap((bar) => bar.voices.flatMap((voice) => voice.beats.map(({ id }) => id))),
    );
    const input = { score, state: { cursor: undefined, range: undefined, selection: { beatIds } } };
    const started = performance.now();
    const { known, empty } = panelState(input, true);
    const elapsed = performance.now() - started;
    expect(empty).toBe(false);
    // Voice 2 holds rests, which are no target, so the notes are all off.
    expect(known.get('tapping')?.state).toBe('off');
    expect(elapsed).toBeLessThan(10_000);
  }, 30_000);

  it('knows nothing outside edit mode', () => {
    const score = largeScore(1, 1);
    const input = { score, state: { cursor: undefined, range: undefined, selection: {} } };
    const { known, blockers } = panelState(input, false);
    expect(known.size).toBe(0);
    expect(blockers.bend).toBe('Turn on edit mode first');
  });
});
