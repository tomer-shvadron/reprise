/**
 * Wah marks through the real transport, scheduler, sampler and a GM guitar (#355, part 4): the
 * centroid of the sound is dark with the pedal closed and bright with it open, against a plain
 * note, and the pedal ends at the first played note without a mark.
 */
import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { START, loadGeneralUser, renderScore } from './test/harness';
import { spectralCentroid } from './test/signal';
import type { Signal } from './test/signal';

const font = await loadGeneralUser();
const BAR = 2;

type Mark = 'closed' | 'open' | undefined;

/** Four bars of four quarter notes on a steel guitar's E3, bar by bar marked `marks`. */
function song(marks: readonly Mark[]): Score {
  const builder = score().tempo(120).track('guitar', { program: 25 });
  for (const mark of marks) {
    builder.bar();
    for (let beat = 0; beat < 4; beat += 1) {
      builder.beat('4', [note(4, 2)], mark ? { effects: { wah: mark } } : {});
    }
  }
  return builder.build();
}

/** The centroid of the second beat of `bar`, after the pedal has settled. */
function centroid(signal: Signal, bar: number): number {
  const from = START + bar * BAR + 0.5 + 0.05;
  return spectralCentroid(signal, from, from + 0.2, { low: 100, high: 8000, resolution: 25 });
}

describe('wah marks through the engine', () => {
  it('darkens the sound closed, brightens it open, and ends at the first unmarked note', async () => {
    // Fetched by `pnpm sounds:fetch`; CI does it in the setup action, so a missing file fails here.
    if (!font) throw new Error('GeneralUser GS is not present; run `pnpm sounds:fetch`');
    const marks: Mark[] = [undefined, 'closed', 'open', undefined];
    const marked = await renderScore(song(marks), { instruments: font, tail: 0.5 });
    const plain = await renderScore(song([undefined, undefined, undefined, undefined]), {
      instruments: font,
      tail: 0.5,
    });
    const centroids = {
      plain: centroid(plain, 1),
      closed: centroid(marked, 1),
      open: centroid(marked, 2),
      after: centroid(marked, 3),
    };

    expect(centroid(marked, 0)).toBeCloseTo(centroid(plain, 0), 0);
    // Measured with GeneralUser GS 2.0.3: plain 1044 Hz, closed 392, open 2028.
    expect(centroids.closed).toBeLessThan(0.6 * centroids.plain);
    expect(centroids.open).toBeGreaterThan(1.6 * centroids.plain);
    expect(centroids.after).toBeCloseTo(centroid(plain, 3), 0);
  }, 60_000);
});
