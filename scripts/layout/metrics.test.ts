import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { generate } from './metrics.ts';

describe('layout font metrics', () => {
  it('are what the generator produces from the committed fonts', async () => {
    for (const { path, text } of await generate()) {
      expect(readFileSync(path, 'utf8'), `${path} is stale; run \`pnpm layout:metrics\``).toBe(
        text,
      );
    }
  });
});
