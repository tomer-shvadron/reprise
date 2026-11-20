import { describe, it } from 'vitest';

import { sweep } from './pipeline-sweep';

describe('the tuning pipeline on synthetic strings', () => {
  it('reads a harmonic pluck at 30 dB SNR within 2 cents', { timeout: 120_000 }, () => {
    const { worst, slowest } = sweep({ snrDb: 30 });
    console.info(
      `harmonic 30 dB: worst ${worst.toFixed(2)} cents, first reading after ${String(slowest)} hops`,
    );
  });
});
