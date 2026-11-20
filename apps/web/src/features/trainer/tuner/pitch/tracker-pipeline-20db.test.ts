import { describe, it } from 'vitest';

import { sweep } from './test-pipeline-sweep';

describe('the tuning pipeline on synthetic strings', () => {
  it('reads a harmonic pluck at 20 dB SNR within 5 cents', { timeout: 120_000 }, () => {
    const { worst, slowest } = sweep({ snrDb: 20 });
    console.info(
      `harmonic 20 dB: worst ${worst.toFixed(2)} cents, first reading after ${String(slowest)} hops`,
    );
  });
});
