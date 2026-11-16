import { crc32 } from '../install/zip';
import type { ZipSource } from '../install/zip';

/** A test-only zip writer: well-formed archives by default, and a hook per way to break one. */
export interface ZipFileSpec {
  /** The name as it goes into the archive; a trailing '/' makes a folder. */
  name: string;
  data?: Uint8Array | string;
  method?: 'stored' | 'deflate';
  /** UTF-8 flag (bit 11); names are written as UTF-8 when set, else as the raw bytes given. */
  utf8?: boolean;
  /** Raw name bytes, for a CP437 name. */
  rawName?: Uint8Array;
  /** Sizes and CRC after the data, zero in the local header. */
  descriptor?: boolean;
  /** Unix mode in the high half of the external attributes. */
  unixMode?: number;
  flags?: number;
  /** The method number written, whatever the data is. */
  methodNumber?: number;
  /** Replaces the declared uncompressed size. */
  declaredSize?: number;
  /** Replaces the CRC. */
  crc?: number;
  /** Uses ZIP64 extra fields for this entry's sizes and offset. */
  zip64?: boolean;
  /** Bytes written as the entry's compressed data, instead of compressing `data`. */
  compressed?: Uint8Array;
  /** Local header name differs from the central one. */
  localName?: string;
  /** Shifts the central directory's offset for this entry. */
  offsetDelta?: number;
  /** Version-made-by host: 3 is Unix (the default), 19 is OS X. */
  host?: number;
  /** Replaces the central extra field bytes, whatever `zip64` writes. */
  centralExtra?: Uint8Array;
  /** Extra bytes written after the local name. */
  localExtra?: Uint8Array;
  /** The local header's extra length field, when it should claim more than was written. */
  localExtraClaim?: number;
  /** The CRC and sizes the local header carries (without a descriptor), when they should differ. */
  localCrc?: number;
  localSize?: number;
  /** Claimed compressed and uncompressed size in both headers, past the data that exists. */
  claimSize?: number;
}

export interface ZipOptions {
  /** Writes the ZIP64 end records. */
  zip64End?: boolean;
  comment?: string;
  /** Cuts this many bytes off the end. */
  truncate?: number;
  /** Replaces the entry count in the end record. */
  declaredEntries?: number;
}

const encoder = new TextEncoder();

const bytesOf = (data: Uint8Array | string | undefined): Uint8Array =>
  typeof data === 'string' ? encoder.encode(data) : (data ?? new Uint8Array());

/** Raw deflate through `CompressionStream`; jsdom's Blob has no `stream()`, so the input is a stream of its own. */
export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data.slice());
      controller.close();
    },
  });
  const reader = input.pipeThrough(new CompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const all = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all;
}

class Out {
  readonly parts: Uint8Array[] = [];
  length = 0;
  push(bytes: Uint8Array): void {
    this.parts.push(bytes);
    this.length += bytes.length;
  }
  bytes(): Uint8Array {
    const all = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      all.set(part, at);
      at += part.length;
    }
    return all;
  }
}

function record(size: number, fill: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer));
  return bytes;
}

export async function zipBytes(
  files: readonly ZipFileSpec[],
  options: ZipOptions = {},
): Promise<Uint8Array> {
  const out = new Out();
  const central: Uint8Array[] = [];
  for (const file of files) {
    const isFolder = file.name.endsWith('/');
    const data = bytesOf(file.data);
    const method = isFolder ? 'stored' : (file.method ?? 'deflate');
    const stored = method === 'stored';
    const payload = file.compressed ?? (stored ? data : await deflateRaw(data));
    const crc = file.crc ?? crc32(data);
    const size = file.claimSize ?? file.declaredSize ?? data.length;
    const name = file.rawName ?? encoder.encode(file.name);
    const localName = file.localName === undefined ? name : encoder.encode(file.localName);
    const flags = (file.utf8 ? 0x0800 : 0) | (file.descriptor ? 0x0008 : 0) | (file.flags ?? 0);
    const methodNumber = file.methodNumber ?? (stored ? 0 : 8);
    const offset = out.length;
    const wide = file.zip64 === true;
    const localExtra =
      file.localExtra ??
      (wide
        ? record(20, (v) => {
            v.setUint16(0, 1, true);
            v.setUint16(2, 16, true);
            v.setBigUint64(4, BigInt(size), true);
            v.setBigUint64(12, BigInt(payload.length), true);
          })
        : new Uint8Array());
    const claimed = file.claimSize ?? payload.length;
    out.push(
      record(30, (v) => {
        v.setUint32(0, 0x04034b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, flags, true);
        v.setUint16(8, methodNumber, true);
        v.setUint32(14, file.descriptor ? 0 : (file.localCrc ?? crc), true);
        v.setUint32(18, file.descriptor ? 0 : wide ? 0xffffffff : claimed, true);
        v.setUint32(22, file.descriptor ? 0 : wide ? 0xffffffff : (file.localSize ?? size), true);
        v.setUint16(26, localName.length, true);
        v.setUint16(28, file.localExtraClaim ?? localExtra.length, true);
      }),
    );
    out.push(localName);
    out.push(localExtra);
    out.push(payload);
    if (file.descriptor) {
      out.push(
        record(16, (v) => {
          v.setUint32(0, 0x08074b50, true);
          v.setUint32(4, crc, true);
          v.setUint32(8, payload.length, true);
          v.setUint32(12, size, true);
        }),
      );
    }
    const extra =
      file.centralExtra ??
      (wide
        ? record(28, (v) => {
            v.setUint16(0, 1, true);
            v.setUint16(2, 24, true);
            v.setBigUint64(4, BigInt(size), true);
            v.setBigUint64(12, BigInt(payload.length), true);
            v.setBigUint64(20, BigInt(offset), true);
          })
        : new Uint8Array());
    const entry = record(46, (v) => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, ((file.host ?? 3) << 8) | 20, true);
      v.setUint16(6, 20, true);
      v.setUint16(8, flags, true);
      v.setUint16(10, methodNumber, true);
      v.setUint32(16, crc, true);
      v.setUint32(20, wide ? 0xffffffff : claimed, true);
      v.setUint32(24, wide ? 0xffffffff : size, true);
      v.setUint16(28, name.length, true);
      v.setUint16(30, extra.length, true);
      v.setUint32(38, ((file.unixMode ?? (isFolder ? 0o040755 : 0o100644)) << 16) >>> 0, true);
      v.setUint32(42, wide ? 0xffffffff : offset + (file.offsetDelta ?? 0), true);
    });
    central.push(entry, name, extra);
  }
  const directoryOffset = out.length;
  for (const part of central) out.push(part);
  const directorySize = out.length - directoryOffset;
  const comment = encoder.encode(options.comment ?? '');
  const count = options.declaredEntries ?? files.length;
  if (options.zip64End === true) {
    const recordAt = out.length;
    out.push(
      record(56, (v) => {
        v.setUint32(0, 0x06064b50, true);
        v.setBigUint64(4, 44n, true);
        v.setUint16(12, 45, true);
        v.setUint16(14, 45, true);
        v.setBigUint64(24, BigInt(count), true);
        v.setBigUint64(32, BigInt(count), true);
        v.setBigUint64(40, BigInt(directorySize), true);
        v.setBigUint64(48, BigInt(directoryOffset), true);
      }),
    );
    out.push(
      record(20, (v) => {
        v.setUint32(0, 0x07064b50, true);
        v.setBigUint64(8, BigInt(recordAt), true);
        v.setUint32(16, 1, true);
      }),
    );
  }
  const wideEnd = options.zip64End === true;
  out.push(
    record(22, (v) => {
      v.setUint32(0, 0x06054b50, true);
      v.setUint16(8, wideEnd ? 0xffff : count, true);
      v.setUint16(10, wideEnd ? 0xffff : count, true);
      v.setUint32(12, wideEnd ? 0xffffffff : directorySize, true);
      v.setUint32(16, wideEnd ? 0xffffffff : directoryOffset, true);
      v.setUint16(20, comment.length, true);
    }),
  );
  out.push(comment);
  const all = out.bytes();
  return options.truncate ? all.subarray(0, all.length - options.truncate) : all;
}

export interface CountingSource extends ZipSource {
  /** Bytes handed out by `read`, so a test can show a bomb was not read through. */
  bytesRead(): number;
  reads(): number;
}

/** A ranged source over bytes, as `PickedFile.read(range)` behaves, that counts what it served. */
export function sourceOf(bytes: Uint8Array): CountingSource {
  let served = 0;
  let calls = 0;
  return {
    size: bytes.length,
    read: (offset, length) => {
      calls += 1;
      const chunk = bytes.slice(offset, offset + length);
      served += chunk.length;
      return Promise.resolve(chunk);
    },
    bytesRead: () => served,
    reads: () => calls,
  };
}
