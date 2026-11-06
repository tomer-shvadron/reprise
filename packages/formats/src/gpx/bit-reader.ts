import { GpxError } from './errors';

/**
 * Reads a byte array as a bit stream, most significant bit of each byte first, the order BCFZ
 * packs its fields in. Running past the end throws `GpxError('truncated')`.
 */
export class BitReader {
  readonly #bytes: Uint8Array;
  #bit: number;

  constructor(bytes: Uint8Array, byteOffset = 0) {
    this.#bytes = bytes;
    this.#bit = byteOffset * 8;
  }

  /** Bits left to read. */
  get remaining(): number {
    return this.#bytes.length * 8 - this.#bit;
  }

  readBit(): number {
    return this.readBits(1);
  }

  /** Up to 24 bits as an unsigned number, the first bit read the most significant. */
  readBits(count: number): number {
    let value = 0;
    // A byte at a time rather than a bit at a time: literals are most of a stream's bits.
    for (let left = count; left > 0;) {
      const byte = this.#bytes[this.#bit >>> 3];
      if (byte === undefined) {
        throw new GpxError('truncated', 'The compressed stream ends inside a chunk');
      }
      const available = 8 - (this.#bit & 7);
      const take = Math.min(available, left);
      value = (value << take) | ((byte >>> (available - take)) & ((1 << take) - 1));
      this.#bit += take;
      left -= take;
    }
    return value;
  }

  /** `count` bits as an unsigned number, the first bit read the least significant. */
  readBitsReversed(count: number): number {
    const forward = this.readBits(count);
    let value = 0;
    for (let index = 0; index < count; index++)
      value |= ((forward >>> index) & 1) << (count - 1 - index);
    return value;
  }

  /** Eight bits, wherever the stream is: BCFZ's literal bytes are not byte-aligned. */
  readByte(): number {
    return this.readBits(8);
  }
}
