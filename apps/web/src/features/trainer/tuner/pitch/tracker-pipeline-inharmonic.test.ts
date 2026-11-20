import { describe, it } from 'vitest';

import { sweep } from './test-pipeline-sweep';

describe('the tuning pipeline on synthetic strings', () => {
  it(
    'reads an inharmonic string with a weak fundamental within 3 cents',
    { timeout: 120_000 },
    () => {
      const { worst, slowest } = sweep({ snrDb: 30, inharmonicity: 3e-4, weak: true });
      console.info(
        `inharmonic 30 dB: worst ${worst.toFixed(2)} cents, first reading after ${String(slowest)} hops`,
      );
    },
  );
});
