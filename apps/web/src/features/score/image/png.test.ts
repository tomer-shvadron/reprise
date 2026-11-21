import { describe, expect, it } from 'vitest';

import { crc32, withDpi } from './png';

/** A 1x1 transparent PNG. */
const PIXEL = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

describe('png', () => {
  it('computes the CRC-32 of a known string', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('puts a pHYs chunk after IHDR with the right density and CRC', () => {
    const out = withDpi(PIXEL, 192);
    const view = new DataView(out.buffer);
    expect(out.length).toBe(PIXEL.length + 21);
    expect(String.fromCharCode(...out.subarray(12, 16))).toBe('IHDR');
    expect(view.getUint32(33)).toBe(9);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('pHYs');
    // 192 dpi is 7559.05 pixels per metre.
    expect(view.getUint32(41)).toBe(7559);
    expect(view.getUint32(45)).toBe(7559);
    expect(out[49]).toBe(1);
    expect(view.getUint32(50)).toBe(crc32(out.subarray(37, 50)));
    // The rest of the file is where it was.
    expect([...out.subarray(54)]).toEqual([...PIXEL.subarray(33)]);
  });

  it('leaves a file with the signature but no IHDR in place, and a truncated one', () => {
    const noHeader = PIXEL.slice();
    noHeader.set([0x58, 0x58, 0x58, 0x58], 12);
    expect(withDpi(noHeader, 96)).toBe(noHeader);
    expect(withDpi(PIXEL.subarray(0, 20), 96)).toEqual(PIXEL.subarray(0, 20));
  });

  it('returns something that is not a PNG unchanged', () => {
    const text = new TextEncoder().encode('not a png at all, but long enough to try'.repeat(2));
    expect(withDpi(text, 96)).toBe(text);
  });
});
