import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FIXTURE_PATH, buildTestSf2 } from './make-test-sf2.ts';

describe('synthetic SF2 fixture', () => {
  it('matches what the generator writes, so the tests and the script cannot drift', () => {
    const committed = new Uint8Array(readFileSync(FIXTURE_PATH));
    expect(Buffer.compare(committed, buildTestSf2())).toBe(0);
  });

  it('stays a few KB', () => {
    expect(buildTestSf2().length).toBeLessThan(8 * 1024);
  });
});
