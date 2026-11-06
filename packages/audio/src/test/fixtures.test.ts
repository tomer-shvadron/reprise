import { describe, expect, inject, it } from 'vitest';

import { parseNative } from '@reprise/model';

import { GM_BUDGET_BYTES, MEGABYTE } from '../samples/managed-sample-source';
import { loadGeneralUser, renderScore } from './harness';
import { peak } from './signal';

/** What `scripts/fixtures/provide-scores.ts` provides: each fixture read in Node, as a native document. */
interface ScoreFixture {
  path: string;
  native: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    scoreFixtures: ScoreFixture[];
  }
}

/** Half the usual rate: the smoke test listens for failures, not for detail, over minutes of audio. */
const SAMPLE_RATE = 22_050;

const fixtures = inject('scoreFixtures');
const generalUser = await loadGeneralUser();
if (!generalUser) {
  console.warn(
    'GeneralUser GS is not present; run `pnpm sounds:fetch` to include the corpus smoke.',
  );
}

describe('the fixture corpus', () => {
  it('is provided by the global setup', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    const { native } = fixture;
    it.skipIf(!generalUser)(`${fixture.path} renders through the GM tier`, async () => {
      if (!generalUser) return;
      const { score } = parseNative(new TextEncoder().encode(native));
      const rendered = await renderScore(score, {
        instruments: generalUser,
        sampleRate: SAMPLE_RATE,
        tail: 0.5,
      });
      const notes = score.tracks.some((track) =>
        track.bars.some((bar) =>
          bar.voices.some((voice) => voice.beats.some((beat) => beat.notes.length > 0)),
        ),
      );
      const memory = rendered.source?.memory();
      console.info(
        `${fixture.path}: ${rendered.songSeconds.toFixed(1)} s, ` +
          `${((memory?.decodedBytes ?? 0) / MEGABYTE).toFixed(1)} MiB decoded, ` +
          `${String(memory?.residents.length ?? 0)} instruments`,
      );

      expect(rendered.missed).toEqual([]);
      expect(memory?.decodedBytes ?? 0).toBeLessThanOrEqual(GM_BUDGET_BYTES);
      expect(rendered.data.every(Number.isFinite)).toBe(true);
      const loudest = peak(rendered, 0, rendered.data.length / SAMPLE_RATE);
      expect(loudest).toBeLessThanOrEqual(1);
      if (notes) expect(loudest).toBeGreaterThan(1e-3);
      else expect(loudest).toBe(0);
    });
  }
});
