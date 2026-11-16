import { describe, expect, it } from 'vitest';

import { deflateRaw } from '../test/zip-writer';

import { inflateStream, ZIP_LIMITS, ZipError } from './zip';

/**
 * Chromium's `DecompressionStream` inflates a whole written chunk before the reader sees any of
 * it (the unit tests run on Node's, which respects backpressure), so only real Chromium can show
 * that a crafted entry is cut off after one slice instead of one chunk.
 */
describe('inflateStream in Chromium', () => {
  /** Deflate's best ratio is about 1032 to 1; a slice of zeros is the worst case. */
  const WORST_SLICE_OUTPUT = ZIP_LIMITS.inflateSliceBytes * 1032;

  it('refuses a bomb entry after about one slice, not one chunk', async () => {
    // 256 MiB of zeros is about 250 KiB of deflate: one unsliced write would inflate all of it.
    const bomb = await deflateRaw(new Uint8Array(256 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(ZIP_LIMITS.chunkBytes);
    expect(256 * 1024 * 1024).toBeGreaterThan(WORST_SLICE_OUTPUT * 4);
    const cap = 1024;
    let seen = 0;
    let largestSeen = 0;
    function* input() {
      yield bomb;
    }
    const take = (chunk: Uint8Array) => {
      seen += chunk.length;
      largestSeen = Math.max(largestSeen, seen);
      if (seen > cap) throw new ZipError('bomb', 'inflates past its declared size');
    };
    await expect(inflateStream(input(), take)).rejects.toMatchObject({ code: 'bomb' });
    expect(largestSeen).toBeGreaterThan(cap);
    expect(largestSeen).toBeLessThanOrEqual(cap + WORST_SLICE_OUTPUT);
  }, 60_000);

  it('still inflates an honest entry in full', async () => {
    const text = new TextEncoder().encode('hello hello hello '.repeat(5000));
    const compressed = await deflateRaw(text);
    let total = 0;
    function* input() {
      yield compressed;
    }
    await inflateStream(input(), (chunk) => {
      total += chunk.length;
    });
    expect(total).toBe(text.length);
  });
});
