import { describe, expect, it } from 'vitest';

import { deflateRaw, sourceOf, zipBytes } from '../test/zip-writer';
import type { ZipFileSpec } from '../test/zip-writer';

import {
  crc32,
  inflateStream,
  normalizeZipPath,
  readZipDirectory,
  readZipEntry,
  ZIP_LIMITS,
  ZipError,
} from './zip';
import type { ZipErrorCode } from './zip';

const text = (value: string) => new TextEncoder().encode(value);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

async function open(files: readonly ZipFileSpec[], options?: Parameters<typeof zipBytes>[1]) {
  const source = sourceOf(await zipBytes(files, options));
  const directory = await readZipDirectory(source);
  return { source, directory };
}

async function codeOf(promise: Promise<unknown>): Promise<ZipErrorCode | 'no error'> {
  try {
    await promise;
    return 'no error';
  } catch (error) {
    if (error instanceof ZipError) return error.code;
    throw error;
  }
}

const refusedDirectory = async (
  files: readonly ZipFileSpec[],
  options?: Parameters<typeof zipBytes>[1],
) => codeOf(open(files, options));

describe('zip reader: round trips', () => {
  it('reads stored and deflate entries and folders', async () => {
    const { source, directory } = await open([
      { name: 'Pack/' },
      { name: 'Pack/a.sfz', data: 'hello hello hello', method: 'deflate' },
      { name: 'Pack/b.txt', data: 'plain', method: 'stored' },
    ]);
    expect(directory.entries.map((entry) => [entry.path, entry.isDirectory])).toEqual([
      ['Pack', true],
      ['Pack/a.sfz', false],
      ['Pack/b.txt', false],
    ]);
    const [, a, b] = directory.entries;
    if (!a || !b) throw new Error('missing');
    expect(decode(await readZipEntry(source, directory, a))).toBe('hello hello hello');
    expect(decode(await readZipEntry(source, directory, b))).toBe('plain');
  });

  it('reads data descriptors, ZIP64 entries and a ZIP64 end record', async () => {
    const { source, directory } = await open(
      [
        { name: 'a.txt', data: 'one', descriptor: true },
        { name: 'b.txt', data: 'two', zip64: true },
        { name: 'c.txt', data: 'three', zip64: true, method: 'stored' },
      ],
      { zip64End: true },
    );
    const read = async (index: number) => {
      const entry = directory.entries[index];
      if (!entry) throw new Error('missing');
      return new TextDecoder().decode(await readZipEntry(source, directory, entry));
    };
    expect([await read(0), await read(1), await read(2)]).toEqual(['one', 'two', 'three']);
  });

  it('decodes UTF-8 names with the flag and CP437 names without', async () => {
    const { directory } = await open([
      { name: 'café/ü.sfz', utf8: true, data: 'x' },
      { name: 'x', rawName: Uint8Array.of(0x82, 0x81, 0x2e, 0x74, 0x78, 0x74), data: 'y' },
    ]);
    expect(directory.entries.map((entry) => entry.path)).toEqual(['café/ü.sfz', 'éü.txt']);
  });

  it('finds the end record behind a comment', async () => {
    const { directory } = await open([{ name: 'a.txt', data: 'x' }], { comment: 'a comment' });
    expect(directory.entries).toHaveLength(1);
  });

  it('computes the standard CRC-32', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(text('6789'), crc32(text('12345')))).toBe(0xcbf43926);
  });
});

describe('zip reader: refusals in the directory', () => {
  it.each([
    ['..\\x', '../x'],
    ['a/../../x', 'a/../../x'],
    ['a\\..\\..\\x', 'a/../../x'],
    ['/etc/passwd', '/etc/passwd'],
    ['C:/x', 'C:/x'],
    ['C:\\x', 'C:\\x'],
    ['//server/share/x', '//server/share/x'],
    ['\\\\server\\share\\x', '\\\\server\\share\\x'],
    ['a//b', 'a//b'],
  ])('refuses the path %s', async (_label, name) => {
    expect(await refusedDirectory([{ name, data: 'x' }])).toBe('bad-path');
  });

  it('refuses a name that is not valid UTF-8 under the UTF-8 flag', async () => {
    expect(
      await refusedDirectory([
        { name: 'x', utf8: true, rawName: Uint8Array.of(0xff, 0xfe), data: 'x' },
      ]),
    ).toBe('bad-path');
  });

  it('refuses a symbolic link', async () => {
    expect(await refusedDirectory([{ name: 'link', data: '../../etc', unixMode: 0o120777 }])).toBe(
      'symlink',
    );
  });

  it('refuses a duplicate name and a case-only duplicate', async () => {
    expect(
      await refusedDirectory([
        { name: 'a.wav', data: '1' },
        { name: 'a.wav', data: '2' },
      ]),
    ).toBe('duplicate');
    expect(
      await refusedDirectory([
        { name: 'Samples/A.wav', data: '1' },
        { name: 'samples/a.WAV', data: '2' },
      ]),
    ).toBe('duplicate');
  });

  it('refuses more entries than the limit, from the end record alone', async () => {
    const bytes = await zipBytes([{ name: 'a', data: 'x' }], { declaredEntries: 30_000 });
    expect(await codeOf(readZipDirectory(sourceOf(bytes)))).toBe('too-many-entries');
    const many = Array.from({ length: 6 }, (_, i) => ({ name: `f${String(i)}`, data: 'x' }));
    const source = sourceOf(await zipBytes(many));
    expect(await codeOf(readZipDirectory(source, { maxEntries: 5 }))).toBe('too-many-entries');
  });

  it('refuses a path that is too deep', async () => {
    const deep = Array.from({ length: 17 }, () => 'd').join('/');
    expect(await refusedDirectory([{ name: `${deep}/f.wav`, data: 'x' }])).toBe('too-deep');
    const ok = Array.from({ length: 15 }, () => 'd').join('/');
    expect(await refusedDirectory([{ name: `${ok}/f.wav`, data: 'x' }])).toBe('no error');
  });

  it('refuses a declared total over the limit', async () => {
    const source = sourceOf(
      await zipBytes([
        { name: 'a', data: 'x', declaredSize: 600 },
        { name: 'b', data: 'x', declaredSize: 600 },
      ]),
    );
    expect(await codeOf(readZipDirectory(source, { maxTotalBytes: 1000 }))).toBe('too-large');
  });

  it('refuses entries whose data overlap', async () => {
    const first = text('a'.repeat(100));
    const bytes = await zipBytes([
      { name: 'a.bin', data: first, method: 'stored' },
      { name: 'b.bin', data: first, method: 'stored', offsetDelta: 0 },
    ]);
    // Point the second central record at the first entry's local header.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = bytes.length - 22;
    const directoryOffset = view.getUint32(eocd + 16, true);
    const secondAt = directoryOffset + 46 + 5;
    view.setUint32(secondAt + 42, 0, true);
    expect(await codeOf(readZipDirectory(sourceOf(bytes)))).toBe('overlap');
  });

  it('refuses a directory over the byte cap', async () => {
    const source = sourceOf(await zipBytes([{ name: 'a.txt', data: 'x' }]));
    expect(await codeOf(readZipDirectory(source, { maxDirectoryBytes: 10 }))).toBe('too-large');
  });

  it.each([
    ['a NUL byte', 'a\0b.wav'],
    ['a dot segment', 'a/./b.wav'],
  ])('refuses a name with %s', async (_label, name) => {
    expect(await refusedDirectory([{ name, data: 'x' }])).toBe('bad-path');
  });

  it('refuses names that differ only in Unicode normalization form', async () => {
    expect(
      await refusedDirectory([
        { name: '\u00e9.wav', utf8: true, data: '1' },
        { name: 'e\u0301.wav', utf8: true, data: '2' },
      ]),
    ).toBe('duplicate');
  });

  it('refuses a symlink written by an OS X host too', async () => {
    expect(
      await refusedDirectory([{ name: 'link', data: 'x', host: 19, unixMode: 0o120755 }]),
    ).toBe('symlink');
  });

  it('refuses malformed ZIP64 and extra fields', async () => {
    // Sizes overflow into ZIP64, but the field is absent.
    expect(
      await refusedDirectory([
        { name: 'a', data: 'x', zip64: true, centralExtra: new Uint8Array() },
      ]),
    ).toBe('bad-header');
    // The ZIP64 block is shorter than the fields that overflowed.
    expect(
      await refusedDirectory([
        {
          name: 'a',
          data: 'x',
          zip64: true,
          centralExtra: Uint8Array.of(1, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        },
      ]),
    ).toBe('bad-header');
    // An extra field whose length runs past its record.
    expect(
      await refusedDirectory([
        { name: 'a', data: 'x', centralExtra: Uint8Array.of(0x99, 0x99, 50, 0, 1, 2) },
      ]),
    ).toBe('bad-header');
  });

  it('refuses a ZIP64 end record that overlaps its locator', async () => {
    const bytes = await zipBytes([{ name: 'a', data: 'x' }], { zip64End: true });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const locator = bytes.length - 22 - 20;
    view.setBigUint64(locator + 8, BigInt(locator - 30), true);
    expect(await codeOf(readZipDirectory(sourceOf(bytes)))).toBe('truncated');
  });

  it('refuses an entry that claims more data than the archive holds', async () => {
    expect(
      await refusedDirectory([
        { name: 'a.bin', data: 'x'.repeat(10), method: 'stored', claimSize: 9000 },
      ]),
    ).toBe('truncated');
  });

  it('refuses overlap that goes through the local extra field', async () => {
    const { source, directory } = await open([
      { name: 'a.wav', data: 'A'.repeat(16), method: 'stored', localExtraClaim: 60 },
      { name: 'b.wav', data: 'B'.repeat(64), method: 'stored' },
    ]);
    const [a, b] = directory.entries;
    if (!a || !b) throw new Error('missing');
    // The directory alone cannot see a local extra length; reading the entry does.
    expect(await codeOf(readZipEntry(source, directory, a))).toBe('overlap');
    expect(decode(await readZipEntry(source, directory, b))).toBe('B'.repeat(64));
  });

  it('refuses an archive with no end record, a truncated one and a directory out of bounds', async () => {
    expect(await codeOf(readZipDirectory(sourceOf(text('this is not a zip file at all'))))).toBe(
      'not-a-zip',
    );
    expect(await codeOf(readZipDirectory(sourceOf(new Uint8Array(5))))).toBe('not-a-zip');
    const bytes = await zipBytes([{ name: 'a.txt', data: 'hello' }]);
    expect(await codeOf(readZipDirectory(sourceOf(bytes.subarray(0, bytes.length - 8))))).toBe(
      'not-a-zip',
    );
    const broken = bytes.slice();
    new DataView(broken.buffer).setUint32(broken.length - 22 + 16, 0x7fffff00, true);
    expect(await codeOf(readZipDirectory(sourceOf(broken)))).toBe('truncated');
  });
});

describe('zip reader: refusals reading an entry', () => {
  const first = async (files: readonly ZipFileSpec[]) => {
    const { source, directory } = await open(files);
    const [entry] = directory.entries;
    if (!entry) throw new Error('missing');
    return { source, directory, entry };
  };

  it('refuses the encrypted flag and an unknown method', async () => {
    const encrypted = await first([{ name: 'a', data: 'x', flags: 1 }]);
    expect(await codeOf(readZipEntry(encrypted.source, encrypted.directory, encrypted.entry))).toBe(
      'encrypted',
    );
    const odd = await first([{ name: 'a', data: 'x', methodNumber: 12 }]);
    expect(await codeOf(readZipEntry(odd.source, odd.directory, odd.entry))).toBe('unsupported');
  });

  it('refuses a CRC mismatch in stored and deflate entries', async () => {
    for (const method of ['stored', 'deflate'] as const) {
      const bad = await first([{ name: 'a', data: 'hello', method, crc: 1, descriptor: true }]);
      expect(await codeOf(readZipEntry(bad.source, bad.directory, bad.entry))).toBe('bad-crc');
    }
  });

  it('refuses an entry over the per-entry cap before reading its data', async () => {
    const big = await first([{ name: 'a', data: 'x', declaredSize: 1_000_000 }]);
    expect(
      await codeOf(
        readZipEntry(big.source, big.directory, big.entry, { limits: { maxEntryBytes: 999 } }),
      ),
    ).toBe('too-large');
  });

  it('stops a bomb: data that inflates past its declared size is cut off at the limit', async () => {
    const zeros = new Uint8Array(200 * 1024 * 1024);
    const compressed = await deflateRaw(zeros);
    const { source, directory } = await open([
      { name: 'bomb.wav', compressed, declaredSize: 10, crc: 0 },
    ]);
    const [entry] = directory.entries;
    if (!entry) throw new Error('missing');
    const chunk = 1024;
    const code = await codeOf(
      readZipEntry(source, directory, entry, { limits: { chunkBytes: chunk } }),
    );
    expect(code).toBe('bomb');
    // The compressed stream was not read through: it stopped within a few chunks of the start.
    expect(source.bytesRead()).toBeLessThan(compressed.length);
  }, 60_000);

  it('refuses an entry that inflates to less than it declared', async () => {
    const short = await first([{ name: 'a', data: 'hello', declaredSize: 50 }]);
    expect(await codeOf(readZipEntry(short.source, short.directory, short.entry))).toBe(
      'bad-header',
    );
  });

  it('refuses a local header that disagrees with the directory', async () => {
    const renamed = await first([{ name: 'good.wav', data: 'x', localName: 'evil.wav' }]);
    expect(await codeOf(readZipEntry(renamed.source, renamed.directory, renamed.entry))).toBe(
      'bad-header',
    );
    const wrongMethod = await first([{ name: 'a', data: 'x', method: 'stored' }]);
    const entry = { ...wrongMethod.entry, method: 8 };
    expect(await codeOf(readZipEntry(wrongMethod.source, wrongMethod.directory, entry))).toBe(
      'bad-header',
    );
  });

  it('refuses a local header whose CRC or size disagrees with the directory', async () => {
    const crc = await first([{ name: 'a', data: 'hello', localCrc: 5 }]);
    expect(await codeOf(readZipEntry(crc.source, crc.directory, crc.entry))).toBe('bad-header');
    const size = await first([{ name: 'a', data: 'hello', localSize: 1 }]);
    expect(await codeOf(readZipEntry(size.source, size.directory, size.entry))).toBe('bad-header');
  });

  it('feeds the decompressor slices of at most inflateSliceBytes and awaits each', async () => {
    const writes: number[] = [];
    const stand = new TransformStream<BufferSource, Uint8Array>({
      transform(chunk, controller) {
        writes.push(chunk.byteLength);
        controller.enqueue(new Uint8Array(chunk.byteLength));
      },
    });
    const produced: number[] = [];
    function* input() {
      yield new Uint8Array(100 * 1024);
      yield new Uint8Array(10);
    }
    await inflateStream(input(), (chunk) => produced.push(chunk.length), {
      createStream: () => stand,
    });
    expect(ZIP_LIMITS.inflateSliceBytes).toBe(16 * 1024);
    expect(Math.max(...writes)).toBe(ZIP_LIMITS.inflateSliceBytes);
    expect(writes).toHaveLength(8);
    expect(writes.reduce((a, b) => a + b, 0)).toBe(100 * 1024 + 10);
    expect(produced.reduce((a, b) => a + b, 0)).toBe(100 * 1024 + 10);
  });

  it('stops feeding once the output was refused', async () => {
    const writes: number[] = [];
    const stand = new TransformStream<BufferSource, Uint8Array>({
      transform(chunk, controller) {
        writes.push(chunk.byteLength);
        controller.enqueue(new Uint8Array(chunk.byteLength));
      },
    });
    function* input() {
      yield new Uint8Array(1024 * 1024);
    }
    await expect(
      inflateStream(
        input(),
        () => {
          throw new ZipError('bomb', 'too much');
        },
        { createStream: () => stand },
      ),
    ).rejects.toMatchObject({ code: 'bomb' });
    expect(writes.length).toBeLessThan(64);
  });

  it('honours an aborted signal', async () => {
    const { source, directory, entry } = await first([{ name: 'a', data: 'x' }]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      readZipEntry(source, directory, entry, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('normalizeZipPath', () => {
  it('keeps a plain path and strips a folder slash', () => {
    expect(normalizeZipPath('a/b.wav')).toBe('a/b.wav');
    expect(normalizeZipPath('a/b/')).toBe('a/b');
    expect(normalizeZipPath('a\\b.wav')).toBe('a/b.wav');
  });
});
