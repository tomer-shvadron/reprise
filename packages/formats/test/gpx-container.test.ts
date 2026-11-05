import { describe, expect, it } from 'vitest';

import { readBcfs } from '../src/gpx/bcfs';
import { BitReader } from '../src/gpx/bit-reader';
import { MAX_UNCOMPRESSED_BYTES, decompressBcfz } from '../src/gpx/bcfz';
import { GpxError, readGpx } from '../src/index';
import { fixtureBytes, manifestEntries } from './corpus';
import { ascii, bcfs, bcfz, bcfzLiterals, gpx } from './gpx-builder';

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof GpxError) return error.code;
    throw error;
  }
  return undefined;
}

const inflate = (bytes: Uint8Array): number[] => [...decompressBcfz(bytes).bytes];

describe('BitReader', () => {
  it('reads most significant bit first, across byte boundaries', () => {
    const reader = new BitReader(Uint8Array.of(0b1011_0011, 0b1100_0000));
    expect(reader.readBit()).toBe(1);
    expect(reader.readBits(4)).toBe(0b0110);
    expect(reader.readBits(5)).toBe(0b01111);
    expect(reader.remaining).toBe(6);
  });

  it('reads reversed fields least significant bit first', () => {
    expect(new BitReader(Uint8Array.of(0b1100_0000)).readBitsReversed(3)).toBe(0b011);
  });

  it('reads unaligned bytes', () => {
    const reader = new BitReader(Uint8Array.of(0b0101_0101, 0b1000_0000));
    reader.readBit();
    expect(reader.readByte()).toBe(0b1010_1011);
  });

  it('throws truncated past the end', () => {
    const reader = new BitReader(Uint8Array.of(0xff));
    reader.readBits(7);
    expect(codeOf(() => reader.readBits(2))).toBe('truncated');
  });
});

describe('decompressBcfz', () => {
  it('copies literal runs of zero to three bytes', () => {
    expect(
      inflate(bcfz(5, [{ literal: [1, 2, 3] }, { literal: [] }, { literal: [4, 5] }])),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it('copies back-references from the decoded output', () => {
    const stream = bcfz(9, [
      { literal: [7, 8, 9] },
      { distance: 3, length: 3, width: 2 },
      { distance: 6, length: 3, width: 4 },
    ]);
    expect(inflate(stream)).toEqual([7, 8, 9, 7, 8, 9, 7, 8, 9]);
  });

  it('mixes literals and wide back-references', () => {
    const text = ascii('<Note><Note>');
    const stream = bcfz(text.length + 2, [
      { literal: [...text.subarray(0, 3)] },
      { literal: [...text.subarray(3, 6)] },
      { distance: 6, length: 6, width: 15 },
      { literal: [33, 33] },
    ]);
    expect(inflate(stream)).toEqual([...text, 33, 33]);
  });

  it('cuts a back-reference longer than its distance at the distance', () => {
    // Classic LZ77 would repeat [1, 2] to fill five bytes; BCFZ copies only what exists.
    const stream = bcfz(6, [
      { literal: [1, 2] },
      { distance: 2, length: 5, width: 3 },
      { distance: 4, length: 2, width: 3 },
    ]);
    expect(inflate(stream)).toEqual([1, 2, 1, 2, 1, 2]);
  });

  it('discards what the last chunk writes past the declared length', () => {
    expect(inflate(bcfz(2, [{ literal: [1, 2, 3] }]))).toEqual([1, 2]);
    expect(inflate(bcfz(3, [{ literal: [1, 2] }, { distance: 2, length: 2, width: 2 }]))).toEqual([
      1, 2, 1,
    ]);
  });

  it('returns what it decoded when the stream ends early, with the declared length', () => {
    const full = bcfz(6, [{ literal: [1, 2, 3] }, { literal: [4, 5, 6] }]);
    const content = decompressBcfz(full.subarray(0, full.length - 2));
    expect([...content.bytes]).toEqual([1, 2, 3, 4]);
    expect(content.declaredLength).toBe(6);
  });

  it('rejects data without the magic', () => {
    expect(codeOf(() => decompressBcfz(ascii('PK\u0003\u0004 a zip')))).toBe('not-bcfz');
    expect(codeOf(() => decompressBcfz(new Uint8Array()))).toBe('not-bcfz');
  });

  it('rejects a header cut before its length', () => {
    expect(codeOf(() => decompressBcfz(ascii('BCFZ\u0001')))).toBe('truncated');
  });

  it('refuses a declared size above the cap before allocating it', () => {
    expect(codeOf(() => decompressBcfz(bcfz(MAX_UNCOMPRESSED_BYTES + 1, [])))).toBe('too-large');
    expect(codeOf(() => decompressBcfz(bcfz(-1, [])))).toBe('corrupt');
  });

  it('rejects a back-reference before the start of the output', () => {
    const stream = bcfz(4, [{ literal: [1] }, { distance: 2, length: 1, width: 2 }]);
    expect(codeOf(() => decompressBcfz(stream))).toBe('corrupt');
  });

  it.each(manifestEntries(['gpx']).map((entry) => entry.path))(
    'inflates %s to a BCFS image within a sector tail of its declared length',
    (path) => {
      const { bytes, declaredLength } = decompressBcfz(fixtureBytes(path));
      expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('BCFS');
      expect(declaredLength - bytes.length).toBeGreaterThanOrEqual(0);
      expect(declaredLength - bytes.length).toBeLessThan(4);
    },
  );
});

describe('readBcfs', () => {
  const names = (image: Uint8Array) =>
    readBcfs(image, () => true).map((file) => [file.name, file.data.length]);

  it('reads every file entry and skips directories', () => {
    const big = new Uint8Array(0x1000 * 2 + 10).fill(65);
    const image = bcfs([
      { name: 'Content', type: 1 },
      { name: 'score.gpif', data: big },
      { name: 'misc.xml', data: ascii('<MISC/>') },
    ]);
    expect(names(image)).toEqual([
      ['score.gpif', 0x2000 + 10],
      ['misc.xml', 7],
    ]);
    expect(readBcfs(image, (name) => name === 'misc.xml')[0]?.data).toEqual(ascii('<MISC/>'));
  });

  it('follows block lists in any order and trims the last block to the size', () => {
    const image = bcfs([{ name: 'a', data: new Uint8Array(0x1800).fill(1) }]);
    // Swap the file's two blocks in the image and in the list.
    const first = image.slice(4 + 0x2000, 4 + 0x3000);
    image.copyWithin(4 + 0x2000, 4 + 0x3000, 4 + 0x4000);
    image.set(first, 4 + 0x3000);
    image[4 + 0x2000] = 2;
    const view = new DataView(image.buffer, 4 + 0x1000);
    view.setInt32(148, 3, true);
    view.setInt32(152, 2, true);
    const [file] = readBcfs(image, () => true);
    expect(file?.data.length).toBe(0x1800);
    expect(file?.data[0]).toBe(1);
    expect(file?.data[0x1000]).toBe(2);
  });

  it('does not mistake a data block that looks like an entry for one', () => {
    const decoy = new Uint8Array(200);
    decoy.set(Uint8Array.of(2, 0, 0, 0));
    decoy.set(ascii('score.gpif'), 4);
    expect(names(bcfs([{ name: 'BinaryStylesheet', data: decoy }]))).toEqual([
      ['BinaryStylesheet', 200],
    ]);
  });

  it('rejects an image without the magic', () => {
    expect(codeOf(() => readBcfs(ascii('BCFZ'), () => true))).toBe('corrupt');
  });

  it('rejects a size larger than the image and a block outside it', () => {
    const size = bcfs([{ name: 'a', data: ascii('abc'), size: 1 << 30 }]);
    expect(codeOf(() => readBcfs(size, () => true))).toBe('corrupt');
    const block = bcfs([{ name: 'a', data: ascii('abc'), blocks: [99] }]);
    expect(codeOf(() => readBcfs(block, () => true))).toBe('corrupt');
    const zero = bcfs([{ name: 'a', data: ascii('abc'), blocks: [] }]);
    expect(codeOf(() => readBcfs(zero, () => true))).toBe('corrupt');
  });

  it('calls a block the image does not reach but its header declared truncated', () => {
    const image = bcfs([{ name: 'a', data: new Uint8Array(0x1800) }]);
    expect(codeOf(() => readBcfs(image.subarray(0, 4 + 0x2800), () => true, image.length))).toBe(
      'truncated',
    );
  });
});

describe('readGpx errors', () => {
  it('rejects a file that is not BCFZ or BCFS', () => {
    expect(codeOf(() => readGpx(ascii('FICHIER GUITAR PRO v5.00')))).toBe('not-bcfz');
  });

  it('rejects a file system without score.gpif', () => {
    expect(codeOf(() => readGpx(gpx({ 'misc.xml': '<MISC/>' })))).toBe('missing-score');
  });

  it('calls a fixture cut inside its score truncated', () => {
    const bytes = fixtureBytes('gpx/effects.gpx');
    for (const keep of [9, 100, 4000, Math.floor(bytes.length / 2)]) {
      expect(codeOf(() => readGpx(bytes.subarray(0, keep)))).toBe('truncated');
    }
  });

  it('still reads a file cut inside the stylesheet that follows the score', () => {
    const bytes = fixtureBytes('gpx/effects.gpx');
    expect(readGpx(bytes.subarray(0, bytes.length - 2000)).score.masterBars).toHaveLength(32);
  });

  it('reads an uncompressed BCFS image too', () => {
    const image = decompressBcfz(fixtureBytes('gpx/chords.gpx')).bytes;
    expect(readGpx(image).score.masterBars).toHaveLength(5);
  });

  it('round-trips a hand-built container', () => {
    const xml = readBcfs(decompressBcfz(fixtureBytes('gpx/chords.gpx')).bytes, (name) => {
      return name === 'score.gpif';
    })[0]?.data;
    expect(xml).toBeDefined();
    if (!xml) return;
    expect(
      readGpx(bcfzLiterals(bcfs([{ name: 'score.gpif', data: xml }]))).score.tracks,
    ).toHaveLength(1);
  });
});
