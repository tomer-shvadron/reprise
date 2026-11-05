import { BitReader } from './bit-reader';
import { GpxError } from './errors';

const BCFZ = 'BCFZ';
const HEADER_BYTES = 8;

/**
 * The cap on a declared uncompressed size, as the gp container caps a zip entry: the output is
 * allocated up front, so a forged length would otherwise allocate that much.
 */
export const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

/** True when the bytes start with the 4-byte ASCII magic. */
export function hasMagic(bytes: Uint8Array, magic: string): boolean {
  if (bytes.length < magic.length) return false;
  for (let index = 0; index < magic.length; index++) {
    if (bytes[index] !== magic.charCodeAt(index)) return false;
  }
  return true;
}

export interface BcfzContent {
  /** The bytes decoded; shorter than `declaredLength` when the stream ran out first. */
  bytes: Uint8Array;
  declaredLength: number;
}

/**
 * Inflates a BCFZ stream: the magic, a little-endian 32-bit uncompressed length, then chunks
 * until that many bytes are out. A chunk's first bit picks its kind.
 *
 * - 0, a literal run: a 2-bit count (0 to 3), then that many bytes, none byte-aligned.
 * - 1, a back-reference: a 4-bit width w, then a w-bit distance and a w-bit length, both least
 *   significant bit first (unlike the width and the literals), copying from that far back in
 *   the output.
 *
 * A back-reference copies at most `distance` bytes, so it never reads bytes it is writing: a
 * length past the distance is cut short rather than repeating the run as classic LZ77 would.
 * That is how alphaTab's and TuxGuitar's readers treat it. The last chunk may overshoot the
 * declared length; the excess is discarded.
 *
 * Guitar Pro 6 itself stops writing a byte or two short of the length it declares (the tail
 * of the file system's last sector, which nothing reads), so running out of input is not an
 * error here: the bytes decoded so far are returned, and the file system reports a file whose
 * blocks are missing as `truncated`.
 *
 * Each chunk consumes at least three bits and the output is bounded by the declared length, so
 * the time is linear in the input plus the output.
 */
export function decompressBcfz(bytes: Uint8Array): BcfzContent {
  if (!hasMagic(bytes, BCFZ)) throw new GpxError('not-bcfz', 'The data does not start with BCFZ');
  if (bytes.length < HEADER_BYTES) {
    throw new GpxError('truncated', 'The BCFZ header ends before its uncompressed length');
  }
  const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(4, true);
  if (declared < 0) {
    throw new GpxError('corrupt', `The BCFZ header declares ${String(declared)} bytes`);
  }
  if (declared > MAX_UNCOMPRESSED_BYTES) {
    throw new GpxError(
      'too-large',
      `The BCFZ header declares ${String(declared)} bytes; the limit is ${String(MAX_UNCOMPRESSED_BYTES)}`,
    );
  }

  const output = new Uint8Array(declared);
  const input = new BitReader(bytes, HEADER_BYTES);
  let length = 0;
  try {
    while (length < declared) {
      if (input.readBit() === 1) {
        const width = input.readBits(4);
        const distance = input.readBitsReversed(width);
        const count = Math.min(input.readBitsReversed(width), distance, declared - length);
        if (distance > length) {
          throw new GpxError(
            'corrupt',
            `A back-reference reaches ${String(distance)} bytes back with only ${String(length)} decoded`,
          );
        }
        output.copyWithin(length, length - distance, length - distance + count);
        length += count;
      } else {
        const count = input.readBitsReversed(2);
        for (let index = 0; index < count; index++) {
          const byte = input.readByte();
          if (length < declared) output[length++] = byte;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof GpxError && error.code === 'truncated')) throw error;
  }
  return { bytes: output.subarray(0, length), declaredLength: declared };
}
