/**
 * A zip reader for archives that are untrusted input: a pack the user dropped or one that was
 * downloaded. It reads the central directory (the authoritative listing) with ranged reads, never
 * the whole archive, and inflates one entry at a time through `DecompressionStream`, counting the
 * output so a bomb is cut off at its declared size. Everything it will not trust is a `ZipError`.
 */

export const ZIP_LIMITS = {
  /** Central directory entries, files and folders; the end record's own count is checked first. */
  maxEntries: 20_000,
  /** '/'-separated segments of a path. */
  maxDepth: 16,
  /** Bytes of the central directory itself. */
  maxDirectoryBytes: 32 * 1024 * 1024,
  /** Bytes of one entry once inflated: the sample cap of the SFZ loader. */
  maxEntryBytes: 128 * 1024 * 1024,
  /** Bytes of every file entry together, as declared. */
  maxTotalBytes: 4 * 1024 * 1024 * 1024,
  /** One ranged read; inside the platform's cap. */
  chunkBytes: 4 * 1024 * 1024,
  /**
   * The most compressed bytes written to the decompressor at once. Chromium inflates a whole
   * written chunk before the reader sees any of it, and deflate expands up to about 1032 to 1, so
   * this bounds the burst of one write to about 16 MiB, whatever `chunkBytes` is.
   */
  inflateSliceBytes: 16 * 1024,
} as const;

export type ZipLimits = { -readonly [K in keyof typeof ZIP_LIMITS]: number };

export type ZipErrorCode =
  | 'not-a-zip'
  | 'truncated'
  | 'unsupported'
  | 'too-many-entries'
  | 'too-deep'
  | 'too-large'
  | 'bad-path'
  | 'symlink'
  | 'encrypted'
  | 'duplicate'
  | 'overlap'
  | 'bad-header'
  | 'bad-crc'
  | 'bomb';

export class ZipError extends Error {
  readonly code: ZipErrorCode;
  constructor(code: ZipErrorCode, message: string) {
    super(message);
    this.name = 'ZipError';
    this.code = code;
  }
}

export interface ZipSource {
  size: number;
  /** `length` is at most `ZIP_LIMITS.chunkBytes`; a range past the end returns what exists. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface ZipEntry {
  /** Normalized: '/'-separated, relative, no `..`, no empty segment; a folder has no trailing '/'. */
  path: string;
  isDirectory: boolean;
  /** Declared uncompressed size. */
  size: number;
  compressedSize: number;
  method: number;
  flags: number;
  crc32: number;
  localOffset: number;
  /** The name bytes of the central record, which the local header must repeat. */
  rawName: Uint8Array;
  /**
   * Where this entry's slot ends: the next file's local offset, or the start of the directory.
   * Its local header, name, extra field, data and descriptor must all fit before it.
   */
  slotEnd: number;
}

export interface ZipDirectory {
  entries: ZipEntry[];
  /** Where the central directory starts; entry data must end before it. */
  directoryOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;
const LOCAL_HEADER = 30;

const FLAG_ENCRYPTED = 0x0001;
const FLAG_DESCRIPTOR = 0x0008;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;
const FLAG_MASKED = 0x2000;

const CP437 =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeCp437(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes)
    text += byte < 0x80 ? String.fromCharCode(byte) : (CP437[byte - 0x80] ?? '?');
  return text;
}

function decodeName(bytes: Uint8Array, flags: number): string {
  if ((flags & FLAG_UTF8) === 0) return decodeCp437(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ZipError('bad-path', 'A file name is not valid UTF-8');
  }
}

/**
 * A name as a safe relative path. Backslashes are separators (Windows zippers), so `a\..\..\x`
 * cannot slip past a '/'-only check.
 */
export function normalizeZipPath(raw: string, maxDepth: number = ZIP_LIMITS.maxDepth): string {
  if (raw.includes('\0')) throw new ZipError('bad-path', 'A file name holds a NUL byte');
  const slashed = raw.replaceAll('\\', '/');
  if (slashed.startsWith('/') || /^[a-zA-Z]:/.test(slashed)) {
    throw new ZipError('bad-path', `"${raw}" is an absolute path`);
  }
  const trimmed = slashed.endsWith('/') ? slashed.slice(0, -1) : slashed;
  if (trimmed === '') throw new ZipError('bad-path', 'A file name is empty');
  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (segment === '..') throw new ZipError('bad-path', `"${raw}" leaves the pack folder`);
    if (segment === '' || segment === '.') {
      throw new ZipError('bad-path', `"${raw}" has an empty path segment`);
    }
  }
  if (segments.length > maxDepth) {
    throw new ZipError('too-deep', `"${raw}" is nested more than ${String(maxDepth)} folders deep`);
  }
  return trimmed;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function safeNumber(value: bigint, what: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipError('too-large', `${what} is larger than this reader supports`);
  }
  return Number(value);
}

/** A range in chunks the source accepts; shorter than asked means the file ended. */
async function readExactly(
  source: ZipSource,
  offset: number,
  length: number,
  limits: ZipLimits,
): Promise<Uint8Array> {
  if (offset < 0 || length < 0 || offset + length > source.size) {
    throw new ZipError('truncated', 'The archive ends before a part it points to');
  }
  const out = new Uint8Array(length);
  let done = 0;
  while (done < length) {
    const want = Math.min(limits.chunkBytes, length - done);
    const chunk = await source.read(offset + done, want);
    if (chunk.length === 0 || chunk.length > want) {
      throw new ZipError('truncated', 'The archive ends before a part it points to');
    }
    out.set(chunk, done);
    done += chunk.length;
  }
  return out;
}

interface EndRecord {
  entries: number;
  directorySize: number;
  directoryOffset: number;
  /** Where the end record (or the ZIP64 one before it) starts. */
  recordOffset: number;
}

async function findEndRecord(source: ZipSource, limits: ZipLimits): Promise<EndRecord> {
  if (source.size < EOCD_MIN) throw new ZipError('not-a-zip', 'This is not a zip archive');
  const tailLength = Math.min(source.size, EOCD_MIN + MAX_COMMENT);
  const tailStart = source.size - tailLength;
  const tail = await readExactly(source, tailStart, tailLength, limits);
  const tailView = view(tail);
  for (let at = tail.length - EOCD_MIN; at >= 0; at -= 1) {
    if (tailView.getUint32(at, true) !== SIG_EOCD) continue;
    // The comment must run to the end of the file, or this is the signature inside a comment.
    if (at + EOCD_MIN + tailView.getUint16(at + 20, true) !== tail.length) continue;
    const recordAt = tailStart + at;
    const disk = tailView.getUint16(at + 4, true);
    const directoryDisk = tailView.getUint16(at + 6, true);
    let entries = tailView.getUint16(at + 10, true);
    let directorySize = tailView.getUint32(at + 12, true);
    let directoryOffset = tailView.getUint32(at + 16, true);
    let recordOffset = recordAt;
    const wide =
      entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff;
    if (wide) {
      if (recordAt < 20) throw new ZipError('not-a-zip', 'The ZIP64 locator is missing');
      const locator = await readExactly(source, recordAt - 20, 20, limits);
      const locatorView = view(locator);
      if (locatorView.getUint32(0, true) !== SIG_ZIP64_LOCATOR) {
        throw new ZipError('not-a-zip', 'The ZIP64 locator is missing');
      }
      if (locatorView.getUint32(4, true) !== 0 || locatorView.getUint32(16, true) !== 1) {
        throw new ZipError('unsupported', 'Archives split over several disks are not supported');
      }
      const wideAt = safeNumber(locatorView.getBigUint64(8, true), 'The ZIP64 record offset');
      if (wideAt + 56 > recordAt - 20)
        throw new ZipError('truncated', 'The ZIP64 record is out of bounds');
      const record = await readExactly(source, wideAt, 56, limits);
      const recordView = view(record);
      if (recordView.getUint32(0, true) !== SIG_ZIP64_EOCD) {
        throw new ZipError('not-a-zip', 'The ZIP64 end record is missing');
      }
      if (recordView.getUint32(16, true) !== 0 || recordView.getUint32(20, true) !== 0) {
        throw new ZipError('unsupported', 'Archives split over several disks are not supported');
      }
      entries = safeNumber(recordView.getBigUint64(32, true), 'The entry count');
      directorySize = safeNumber(recordView.getBigUint64(40, true), 'The directory size');
      directoryOffset = safeNumber(recordView.getBigUint64(48, true), 'The directory offset');
      recordOffset = wideAt;
    } else if (disk !== 0 || directoryDisk !== 0) {
      throw new ZipError('unsupported', 'Archives split over several disks are not supported');
    }
    return { entries, directorySize, directoryOffset, recordOffset };
  }
  throw new ZipError('not-a-zip', 'This is not a zip archive (no end-of-directory record)');
}

/** Wide fields of the ZIP64 extra block, in the fixed order of the fields that overflowed. */
function applyZip64(
  extra: Uint8Array,
  fields: { size: number; compressedSize: number; localOffset: number },
  wanted: { size: boolean; compressedSize: boolean; localOffset: boolean },
): void {
  const extraView = view(extra);
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extraView.getUint16(at, true);
    const length = extraView.getUint16(at + 2, true);
    const end = at + 4 + length;
    if (end > extra.length) throw new ZipError('bad-header', 'An extra field overruns its record');
    if (id === 0x0001) {
      let cursor = at + 4;
      const next = (what: string): number => {
        if (cursor + 8 > end)
          throw new ZipError('bad-header', `The ZIP64 field for ${what} is missing`);
        const value = safeNumber(extraView.getBigUint64(cursor, true), what);
        cursor += 8;
        return value;
      };
      if (wanted.size) fields.size = next('the size');
      if (wanted.compressedSize) fields.compressedSize = next('the compressed size');
      if (wanted.localOffset) fields.localOffset = next('the offset');
      return;
    }
    at = end;
  }
  if (wanted.size || wanted.compressedSize || wanted.localOffset) {
    throw new ZipError('bad-header', 'A ZIP64 field is missing');
  }
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const HOST_UNIX = 3;
const HOST_OSX = 19;

/**
 * Reads and checks the central directory. Names are checked for every entry, including the ones
 * a caller will skip: an archive with a `..` anywhere is not one to trust. Symlinks, duplicate
 * names (also after case folding, which macOS and Windows would overwrite) and entries whose
 * data overlap are refused here.
 */
export async function readZipDirectory(
  source: ZipSource,
  overrides: Partial<ZipLimits> = {},
): Promise<ZipDirectory> {
  const limits: ZipLimits = { ...ZIP_LIMITS, ...overrides };
  const end = await findEndRecord(source, limits);
  if (end.entries > limits.maxEntries) {
    throw new ZipError(
      'too-many-entries',
      `The archive lists ${String(end.entries)} entries; at most ${String(limits.maxEntries)} are read`,
    );
  }
  if (end.directorySize > limits.maxDirectoryBytes) {
    throw new ZipError('too-large', 'The archive directory is too large');
  }
  if (end.directoryOffset + end.directorySize > end.recordOffset) {
    throw new ZipError('truncated', 'The archive directory is out of bounds');
  }
  const bytes = await readExactly(source, end.directoryOffset, end.directorySize, limits);
  const data = view(bytes);
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let at = 0;
  let total = 0;
  for (let index = 0; index < end.entries; index += 1) {
    if (at + 46 > bytes.length || data.getUint32(at, true) !== SIG_CENTRAL) {
      throw new ZipError('bad-header', 'The archive directory is damaged');
    }
    const madeBy = data.getUint16(at + 4, true);
    const flags = data.getUint16(at + 8, true);
    const method = data.getUint16(at + 10, true);
    const crc32 = data.getUint32(at + 16, true);
    const nameLength = data.getUint16(at + 28, true);
    const extraLength = data.getUint16(at + 30, true);
    const commentLength = data.getUint16(at + 32, true);
    const externalAttributes = data.getUint32(at + 38, true);
    const nameAt = at + 46;
    const extraAt = nameAt + nameLength;
    const next = extraAt + extraLength + commentLength;
    if (next > bytes.length) throw new ZipError('bad-header', 'The archive directory is damaged');
    const fields = {
      compressedSize: data.getUint32(at + 20, true),
      size: data.getUint32(at + 24, true),
      localOffset: data.getUint32(at + 42, true),
    };
    applyZip64(bytes.subarray(extraAt, extraAt + extraLength), fields, {
      size: fields.size === 0xffffffff,
      compressedSize: fields.compressedSize === 0xffffffff,
      localOffset: fields.localOffset === 0xffffffff,
    });
    const rawName = bytes.slice(nameAt, extraAt);
    const rawText = decodeName(rawName, flags);
    const path = normalizeZipPath(rawText, limits.maxDepth);
    const host = madeBy >>> 8;
    const hostIsUnix = host === HOST_UNIX || host === HOST_OSX;
    const mode = externalAttributes >>> 16;
    if (hostIsUnix && (mode & S_IFMT) === S_IFLNK) {
      throw new ZipError('symlink', `"${rawText}" is a symbolic link`);
    }
    const isDirectory = rawText.endsWith('/') || rawText.endsWith('\\');
    if (!isDirectory) {
      const folded = path.normalize('NFC').toLowerCase();
      if (seen.has(folded)) {
        throw new ZipError(
          'duplicate',
          `"${path}" appears twice (names are compared ignoring case)`,
        );
      }
      seen.add(folded);
      total += fields.size;
      if (total > limits.maxTotalBytes) {
        throw new ZipError('too-large', 'The archive holds more data than the limit allows');
      }
    }
    entries.push({
      path,
      isDirectory,
      size: fields.size,
      compressedSize: fields.compressedSize,
      method,
      flags,
      crc32,
      localOffset: fields.localOffset,
      rawName,
      slotEnd: end.directoryOffset,
    });
    at = next;
  }
  checkOverlap(entries, end.directoryOffset);
  return { entries, directoryOffset: end.directoryOffset };
}

/** The bytes an entry takes at least: its local header, its name and its compressed data. */
const spanOf = (entry: ZipEntry) => LOCAL_HEADER + entry.rawName.length + entry.compressedSize;

/**
 * Gives each file the slot up to the next file's local header and refuses a minimum span that
 * does not fit. The local extra field is only known from the local header, so `readZipEntry`
 * checks the real data range against the slot (`entry.slotEnd`).
 */
function checkOverlap(entries: readonly ZipEntry[], directoryOffset: number): void {
  const files = entries.filter((entry) => !entry.isDirectory);
  files.sort((a, b) => a.localOffset - b.localOffset);
  files.forEach((entry, index) => {
    entry.slotEnd = files[index + 1]?.localOffset ?? directoryOffset;
    if (entry.localOffset + spanOf(entry) > entry.slotEnd) {
      throw new ZipError(
        entry.slotEnd === directoryOffset ? 'truncated' : 'overlap',
        entry.slotEnd === directoryOffset
          ? `"${entry.path}" runs past the end of the archive`
          : `"${entry.path}" overlaps another entry's data`,
      );
    }
  });
}

let crcTable: Uint32Array | undefined;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  const made = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    made[n] = c >>> 0;
  }
  crcTable = made;
  return made;
}

/** CRC-32 of a chunk, continuing from `crc` (0 to start). */
export function crc32(bytes: Uint8Array, crc = 0): number {
  const lookup = table();
  let c = ~crc >>> 0;
  for (const byte of bytes) c = (lookup[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return ~c >>> 0;
}

export interface ReadEntryOptions {
  signal?: AbortSignal;
  limits?: Partial<ZipLimits>;
}

function aborted(): DOMException {
  return new DOMException('The install was cancelled', 'AbortError');
}

/** The data of a local header, checked against the central record. Returns where the data starts. */
async function checkLocalHeader(
  source: ZipSource,
  entry: ZipEntry,
  directoryOffset: number,
  limits: ZipLimits,
): Promise<number> {
  const header = await readExactly(source, entry.localOffset, LOCAL_HEADER, limits);
  const data = view(header);
  if (data.getUint32(0, true) !== SIG_LOCAL) {
    throw new ZipError(
      'bad-header',
      `"${entry.path}" has no local header where the directory says`,
    );
  }
  const flags = data.getUint16(6, true);
  const method = data.getUint16(8, true);
  const nameLength = data.getUint16(26, true);
  const extraLength = data.getUint16(28, true);
  if (method !== entry.method || nameLength !== entry.rawName.length) {
    throw new ZipError(
      'bad-header',
      `"${entry.path}": the local header disagrees with the directory`,
    );
  }
  const name = await readExactly(source, entry.localOffset + LOCAL_HEADER, nameLength, limits);
  if (name.some((byte, i) => byte !== entry.rawName[i])) {
    throw new ZipError(
      'bad-header',
      `"${entry.path}": the local name disagrees with the directory`,
    );
  }
  // With a data descriptor the local sizes and CRC are zero by design; otherwise they must agree.
  if ((flags & FLAG_DESCRIPTOR) === 0) {
    const crc = data.getUint32(14, true);
    const compressed = data.getUint32(18, true);
    const size = data.getUint32(22, true);
    const wide = compressed === 0xffffffff || size === 0xffffffff;
    if (
      crc !== entry.crc32 ||
      (!wide && (compressed !== entry.compressedSize || size !== entry.size))
    ) {
      throw new ZipError(
        'bad-header',
        `"${entry.path}": the local header disagrees with the directory`,
      );
    }
  }
  const start = entry.localOffset + LOCAL_HEADER + nameLength + extraLength;
  // A descriptor follows the data: at least a CRC and two 32-bit sizes.
  const end = start + entry.compressedSize + ((flags & FLAG_DESCRIPTOR) === 0 ? 0 : 12);
  if (end > entry.slotEnd) {
    throw new ZipError(
      entry.slotEnd === directoryOffset ? 'truncated' : 'overlap',
      entry.slotEnd === directoryOffset
        ? `"${entry.path}" runs past the end of the archive`
        : `"${entry.path}" overlaps another entry's data (through its local extra field)`,
    );
  }
  return start;
}

/**
 * The bytes of a file entry. Refuses an entry that is encrypted, uses a method other than stored
 * or deflate, declares more than `maxEntryBytes`, inflates past what it declared (stopped at the next
 * read, so a bomb never grows beyond its limit plus one slice's worst-case expansion) or fails its CRC.
 */
export async function readZipEntry(
  source: ZipSource,
  directory: ZipDirectory,
  entry: ZipEntry,
  options: ReadEntryOptions = {},
): Promise<Uint8Array> {
  const limits: ZipLimits = { ...ZIP_LIMITS, ...options.limits };
  const { signal } = options;
  if (entry.isDirectory) throw new ZipError('unsupported', `"${entry.path}" is a folder`);
  if ((entry.flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION | FLAG_MASKED)) !== 0) {
    throw new ZipError('encrypted', `"${entry.path}" is encrypted`);
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipError(
      'unsupported',
      `"${entry.path}" uses compression method ${String(entry.method)}`,
    );
  }
  if (entry.size > limits.maxEntryBytes) {
    throw new ZipError(
      'too-large',
      `"${entry.path}" is larger than ${String(limits.maxEntryBytes)} bytes`,
    );
  }
  if (entry.method === 0 && entry.compressedSize !== entry.size) {
    throw new ZipError('bad-header', `"${entry.path}": a stored entry's two sizes differ`);
  }
  if (signal?.aborted) throw aborted();
  const start = await checkLocalHeader(source, entry, directory.directoryOffset, limits);
  // Grown as data arrives, so an entry that declares 128 MiB over a few bytes costs a few bytes.
  let out = new Uint8Array(Math.min(entry.size, 1024 * 1024));
  let produced = 0;
  let crc = 0;
  const take = (chunk: Uint8Array): void => {
    if (produced + chunk.length > entry.size) {
      throw new ZipError(
        'bomb',
        `"${entry.path}" inflates past its declared size of ${String(entry.size)} bytes`,
      );
    }
    if (produced + chunk.length > out.length) {
      const grown = new Uint8Array(
        Math.min(entry.size, Math.max(out.length * 2, produced + chunk.length)),
      );
      grown.set(out.subarray(0, produced));
      out = grown;
    }
    out.set(chunk, produced);
    produced += chunk.length;
    crc = crc32(chunk, crc);
  };
  async function* compressed(): AsyncGenerator<Uint8Array> {
    for (let done = 0; done < entry.compressedSize;) {
      if (signal?.aborted) throw aborted();
      const want = Math.min(limits.chunkBytes, entry.compressedSize - done);
      const chunk = await source.read(start + done, want);
      if (chunk.length === 0 || chunk.length > want) {
        throw new ZipError('truncated', `"${entry.path}" is cut off`);
      }
      done += chunk.length;
      yield chunk;
    }
  }
  if (entry.method === 0) {
    for await (const chunk of compressed()) take(chunk);
  } else {
    await inflateStream(compressed(), take);
  }
  if (produced !== entry.size) {
    throw new ZipError(
      'bad-header',
      `"${entry.path}" is ${String(produced)} bytes, not the declared ${String(entry.size)}`,
    );
  }
  if (crc !== entry.crc32) throw new ZipError('bad-crc', `"${entry.path}" fails its checksum`);
  return out.length === produced ? out : out.slice(0, produced);
}

/** Streams `input` through a raw-deflate decompressor into `take`; a throw from `take` stops it. */
export async function inflateStream(
  input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  take: (chunk: Uint8Array) => void,
  options: {
    sliceBytes?: number;
    /** The decompressor; a test passes a stand-in to see what is written to it. */
    createStream?: () => {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<BufferSource>;
    };
  } = {},
): Promise<void> {
  const sliceBytes = options.sliceBytes ?? ZIP_LIMITS.inflateSliceBytes;
  const stream = options.createStream?.() ?? new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  let failure: unknown;
  const fail = async (error: unknown): Promise<void> => {
    failure ??= error;
    await reader.cancel(error).catch(() => undefined);
    await writer.abort(error).catch(() => undefined);
  };
  const feed = (async () => {
    try {
      // A copy: the stream wants a plain ArrayBuffer, and the source may hand out a shared view.
      for await (const chunk of input) {
        for (let at = 0; at < chunk.length; at += sliceBytes) {
          // Each write is awaited, so the reader has `take`n the last slice's output (and may have
          // thrown) before the next one goes in.
          if (failure !== undefined) return;
          await writer.write(chunk.slice(at, at + sliceBytes));
        }
      }
      await writer.close();
    } catch (error) {
      await fail(error);
    }
  })();
  const drain = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        take(value);
      }
    } catch (error) {
      await fail(error);
    }
  })();
  await Promise.all([feed, drain]);
  if (failure !== undefined) {
    if (failure instanceof ZipError || failure instanceof DOMException) throw failure;
    throw new ZipError('bad-header', 'An entry holds data that does not inflate');
  }
}

/** A zip source over a `Blob` or a picked file's `read`. */
export function zipSourceOf(
  size: number,
  read: (range: { offset: number; length: number }) => Promise<Uint8Array>,
): ZipSource {
  return { size, read: (offset, length) => read({ offset, length }) };
}
