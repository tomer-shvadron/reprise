import { describe, expect, it } from 'vitest';

import { BinaryReader, CorruptFile, TruncatedFile, hasFlag } from './binary-reader';
import { decodeWindows1252 } from './windows-1252';

const reader = (...bytes: number[]): BinaryReader => new BinaryReader(Uint8Array.from(bytes));

describe('BinaryReader', () => {
  it('reads little-endian integers, signed bytes and booleans', () => {
    const r = reader(0xff, 0xff, 0x34, 0x12, 0x78, 0x56, 0x34, 0x12, 0xff, 0xff, 0xff, 0xff, 0, 2);
    expect([r.byte(), r.signedByte(), r.short(), r.int(), r.int(), r.bool(), r.bool()]).toEqual([
      255,
      -1,
      0x1234,
      0x12345678,
      -1,
      false,
      true,
    ]);
    expect(r.remaining).toBe(0);
  });

  it('reads the big-endian double GP5 uses for note durations', () => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, 0.75, false);
    expect(new BinaryReader(bytes).doubleBigEndian()).toBe(0.75);
  });

  it('reads the string forms', () => {
    const r = reader(
      ...[3, 0x61, 0x62, 0x63],
      ...[2, 0x68, 0x69, 0, 0],
      ...[2, 0, 0, 0, 0x6f, 0x6b],
      ...[3, 0, 0, 0, 2, 0x67, 0x70],
      ...[9, 0, 0, 0, 2, 0x67, 0x70],
    );
    expect(r.byteString()).toBe('abc');
    expect(r.fixedString(4)).toBe('hi');
    expect(r.intString()).toBe('ok');
    expect(r.intByteString('int')).toBe('gp');
    expect(r.intByteString('byte')).toBe('gp');
  });

  it('reads a colour as lower-case hex and skips its padding byte', () => {
    const r = reader(0xff, 0x0a, 0x00, 0x00, 7);
    expect(r.color()).toBe('#ff0a00');
    expect(r.byte()).toBe(7);
  });

  it('throws TruncatedFile with the offset of the read that ran out', () => {
    const r = reader(1, 2, 3);
    r.byte();
    expect(() => r.int()).toThrow(TruncatedFile);
    expect(() => r.int()).toThrow(expect.objectContaining({ offset: 1 }));
    expect(r.offset).toBe(1);
  });

  it('throws CorruptFile on a negative string length', () => {
    expect(() => reader(0xff, 0xff, 0xff, 0xff).intString()).toThrow(CorruptFile);
    expect(() => reader(0, 0, 0, 0, 0).intByteString('int')).toThrow(CorruptFile);
  });
});

describe('hasFlag', () => {
  it('tests one bit of a mask', () => {
    expect(hasFlag(0b0101, 0x04)).toBe(true);
    expect(hasFlag(0b0101, 0x02)).toBe(false);
  });
});

describe('decodeWindows1252', () => {
  it('decodes Latin-1 and the windows-1252 punctuation range', () => {
    expect(
      decodeWindows1252(Uint8Array.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x96, 0x81])),
    ).toBe('Café €–\u0081');
  });
});
