import { MAX_READ_LENGTH, type ReadRange } from './bridge';

/**
 * The `[start, end)` byte span of a ranged read, after the checks main makes too: both fields
 * non-negative safe integers and a length within `MAX_READ_LENGTH`. A span past the end of the
 * file is not an error: `Blob.slice` clamps it, which is the contract's "the bytes that exist".
 */
export function rangeBounds(range: ReadRange): { start: number; end: number } {
  const { offset, length } = range;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError('A read offset is a non-negative integer');
  }
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_READ_LENGTH) {
    throw new RangeError(`A read length is an integer from 0 to ${String(MAX_READ_LENGTH)}`);
  }
  return { start: offset, end: offset + length };
}

/** The bytes of `file`, or of `range` within it. */
export async function readBlob(file: Blob, range?: ReadRange): Promise<Uint8Array> {
  if (!range) return new Uint8Array(await file.arrayBuffer());
  const { start, end } = rangeBounds(range);
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}
