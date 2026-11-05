import { hasMagic } from './bcfz';
import { GpxError } from './errors';

const BCFS = 'BCFS';
export const SECTOR_BYTES = 0x1000;
const ENTRY_FILE = 2;
const NAME_OFFSET = 4;
const NAME_BYTES = 127;
const SIZE_OFFSET = 140;
const BLOCKS_OFFSET = 148;

export interface BcfsFile {
  name: string;
  data: Uint8Array;
}

function int32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(offset, true);
}

function entryName(data: Uint8Array, offset: number): string {
  let name = '';
  for (let index = 0; index < NAME_BYTES; index++) {
    const code = data[offset + index] ?? 0;
    if (code === 0) break;
    name += String.fromCharCode(code);
  }
  return name;
}

/**
 * Reads the files of a BCFS image (the inflated content of a gpx file) whose names `wanted`
 * accepts. After the `BCFS` magic the image is a run of 4 KB sectors; sector 0 is a header
 * nothing needs. Every later sector is either free, a directory entry, a file entry or a block
 * of some file's data. A file entry holds, little-endian: the type 2 at 0, a NUL-terminated
 * ASCII name at 4 (127 bytes at most), the size at 140, and from 148 the sector numbers of its
 * data blocks, ended by a 0. The entries carry no paths in practice: Guitar Pro 6 names its
 * files `score.gpif`, `PartConfiguration` and so on, and directory entries can be ignored.
 *
 * Data blocks are not marked as such, and one can begin with the bytes of a file entry's type,
 * so the scan skips every sector some earlier entry claimed (alphaTab skips past each file's
 * last block, which comes to the same on the files Guitar Pro writes).
 */
export function readBcfs(
  image: Uint8Array,
  wanted: (name: string) => boolean,
  declaredLength = image.length,
): BcfsFile[] {
  if (!hasMagic(image, BCFS)) {
    const cut = image.length < BCFS.length && declaredLength >= BCFS.length;
    throw new GpxError(
      cut ? 'truncated' : 'corrupt',
      'The inflated gpx content is not a BCFS file system',
    );
  }
  const data = image.subarray(BCFS.length);
  const sectors = Math.ceil(data.length / SECTOR_BYTES);
  // Bytes the header declared but the stream never delivered are truncation; bytes past the
  // declared size are a bad reference.
  const missing = (end: number, message: string): GpxError =>
    new GpxError(BCFS.length + end <= declaredLength ? 'truncated' : 'corrupt', message);
  const claimed = new Uint8Array(sectors);
  const files: BcfsFile[] = [];

  /** Copies an entry's data when `keep`, and claims its blocks either way. */
  const readEntry = (entry: number, name: string, keep: boolean): Uint8Array | undefined => {
    const size = int32(data, entry + SIZE_OFFSET);
    if (size < 0 || size > declaredLength - BCFS.length) {
      throw new GpxError('corrupt', `The BCFS entry "${name}" declares ${String(size)} bytes`);
    }
    const content = keep ? new Uint8Array(size) : undefined;
    let filled = 0;
    // Stopping once the size is covered keeps a looping or overlong block list from costing more
    // than the file itself.
    for (let pointer = entry + BLOCKS_OFFSET; filled < size; pointer += 4) {
      if (pointer + 4 > data.length)
        throw missing(pointer + 4, `The block list of "${name}" runs off the image`);
      const block = int32(data, pointer);
      if (block === 0) break;
      if (block < 1) throw new GpxError('corrupt', `"${name}" points at sector ${String(block)}`);
      if (block >= sectors)
        throw missing(
          block * SECTOR_BYTES + 1,
          `"${name}" points at sector ${String(block)}, past the image`,
        );
      claimed[block] = 1;
      const start = block * SECTOR_BYTES;
      const wantedBytes = Math.min(SECTOR_BYTES, size - filled);
      const piece = data.subarray(start, start + wantedBytes);
      if (piece.length < wantedBytes) {
        throw missing(
          start + wantedBytes,
          `"${name}" continues into a sector the image cuts short`,
        );
      }
      content?.set(piece, filled);
      filled += piece.length;
    }
    if (filled < size) {
      throw new GpxError(
        'corrupt',
        `"${name}" declares ${String(size)} bytes but its blocks hold ${String(filled)}`,
      );
    }
    return content;
  };

  for (let sector = 1; sector < sectors; sector++) {
    const entry = sector * SECTOR_BYTES;
    if (claimed[sector] === 1 || entry + BLOCKS_OFFSET > data.length) continue;
    if (int32(data, entry) !== ENTRY_FILE) continue;
    const name = entryName(data, entry + NAME_OFFSET);
    const keep = wanted(name);
    try {
      const content = readEntry(entry, name, keep);
      if (content) files.push({ name, data: content });
    } catch (error) {
      // A damaged file nobody asked for (a stylesheet in a cut-short file) is not a reason to fail.
      if (keep || !(error instanceof GpxError)) throw error;
    }
  }
  return files;
}
