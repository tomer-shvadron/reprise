import { describe, expect, it } from 'vitest';

import { deflateRaw } from '../test/zip-writer';

import { inflateStream, ZIP_LIMITS, ZipError } from './zip';

/**
 * Chromium's `DecompressionStream` inflates a whole written chunk before the reader sees any of
 * it (the unit tests run on Node's, which respects backpressure), and what `take` receives is
 * 64 KiB pieces either way. So the burst is bounded by counting the compressed bytes that reach
 * the real decompressor: its output is at most about 1032 times that.
 */
describe('inflateStream in Chromium', () => {
  it('writes a bomb entry to the real decompressor one slice at a time and refuses it', async () => {
    // 256 MiB of zeros is about 250 KiB of deflate: an unsliced write would inflate all of it.
    const bomb = await deflateRaw(new Uint8Array(256 * 1024 * 1024));
    expect(bomb.length).toBeGreaterThan(4 * ZIP_LIMITS.inflateSliceBytes);
    let written = 0;
    const createStream = () => {
      const real = new DecompressionStream('deflate-raw');
      const realWriter = real.writable.getWriter();
      const writable = new WritableStream<BufferSource>({
        async write(chunk) {
          written += chunk.byteLength;
          await realWriter.write(chunk);
        },
        close: () => realWriter.close(),
        abort: (reason) => realWriter.abort(reason),
      });
      return { readable: real.readable, writable };
    };
    let seen = 0;
    const cap = 1024;
    const take = (chunk: Uint8Array) => {
      seen += chunk.length;
      if (seen > cap) throw new ZipError('bomb', 'inflates past its declared size');
    };
    await expect(inflateStream([bomb], take, { createStream })).rejects.toMatchObject({
      code: 'bomb',
    });
    // Printed so a review can read the number.
    console.info(`compressed bytes written to the decompressor: ${String(written)}`);
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThanOrEqual(2 * ZIP_LIMITS.inflateSliceBytes);
  }, 60_000);

  it('still inflates an honest entry in full', async () => {
    const text = new TextEncoder().encode('hello hello hello '.repeat(5000));
    const compressed = await deflateRaw(text);
    let total = 0;
    await inflateStream([compressed], (chunk) => {
      total += chunk.length;
    });
    expect(total).toBe(text.length);
  });
});
