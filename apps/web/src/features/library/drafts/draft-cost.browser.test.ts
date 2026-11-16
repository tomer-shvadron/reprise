import { largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { withViewNotation } from '@/state/document';

import { createParser } from '../import/parser';

// What one draft write costs the thread that is editing: the structured clone of the score into
// the parse worker (the serialization itself runs there). WP-061 budgeted about 50 ms for the 8 x
// 300 reference score; over that, a worker that mirrors the score from `Change.patches` would
// need a model contract (see the library README).
const SANITY_BOUND_MS = 500;

describe('the draft write', () => {
  it(
    'costs the main thread little: the clone into the worker, not the serialization',
    { timeout: 30_000 },
    async () => {
      const parser = createParser();
      try {
        const score = largeScore(8, 300);
        const spans: number[] = [];
        let size = 0;
        for (let run = 0; run < 5; run += 1) {
          const started = performance.now();
          const pending = parser.native(withViewNotation(score, {}));
          // `postMessage` has cloned the score by the time it returns, so this is the whole
          // synchronous cost; the wait below is the worker's.
          spans.push(performance.now() - started);
          const outcome = await pending;
          if (!outcome.ok) throw new Error(outcome.message);
          size = outcome.native.byteLength;
        }
        spans.sort((a, b) => a - b);
        const median = spans[Math.floor(spans.length / 2)] ?? 0;
        console.info(
          `draft write, 8 x 300 score: main-thread ${median.toFixed(1)} ms median ` +
            `(${spans.map((span) => span.toFixed(1)).join(', ')} ms), native ${String(size)} bytes`,
        );
        expect(median).toBeLessThan(SANITY_BOUND_MS);
      } finally {
        parser.dispose();
      }
    },
  );
});
