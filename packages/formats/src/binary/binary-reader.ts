import { decodeWindows1252 } from './windows-1252';

/** The file ended inside a structure; `offset` is where the read that ran out started. */
export class TruncatedFile extends Error {
  readonly offset: number;

  constructor(offset: number, wanted: number, available: number) {
    super(
      `file truncated at byte ${String(offset)}: needed ${String(wanted)} bytes, ${String(available)} left`,
    );
    this.name = 'TruncatedFile';
    this.offset = offset;
  }
}

/** A value that cannot be right in any real file, such as a negative count; reading stops. */
export class CorruptFile extends Error {
  readonly offset: number;

  constructor(offset: number, message: string) {
    super(`file corrupt at byte ${String(offset)}: ${message}`);
    this.name = 'CorruptFile';
    this.offset = offset;
  }
}

/**
 * A bounds-checked little-endian cursor over the bytes of a Guitar Pro 3 to 5 file. Every read
 * either returns a value or throws `TruncatedFile`, so a reader can stop anywhere and keep what
 * it has.
 */
export class BinaryReader {
  private readonly view: DataView;
  private position = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset(): number {
    return this.position;
  }

  get remaining(): number {
    return this.bytes.length - this.position;
  }

  private take(count: number): number {
    if (count < 0 || count > this.remaining) {
      throw new TruncatedFile(this.position, count, this.remaining);
    }
    const start = this.position;
    this.position += count;
    return start;
  }

  skip(count: number): void {
    this.take(count);
  }

  byte(): number {
    return this.view.getUint8(this.take(1));
  }

  signedByte(): number {
    return this.view.getInt8(this.take(1));
  }

  bool(): boolean {
    return this.byte() !== 0;
  }

  short(): number {
    return this.view.getInt16(this.take(2), true);
  }

  int(): number {
    return this.view.getInt32(this.take(4), true);
  }

  /** GP5 stores the note duration percentage as the one big-endian value in the format. */
  doubleBigEndian(): number {
    return this.view.getFloat64(this.take(8), false);
  }

  bytesOf(count: number): Uint8Array {
    const start = this.take(count);
    return this.bytes.subarray(start, start + count);
  }

  /** A length byte, then the text, with no padding. */
  byteString(): string {
    return decodeWindows1252(this.bytesOf(this.byte()));
  }

  /**
   * A length byte, then a field of exactly `size` bytes of which the first `length` are text: the
   * fixed-width form used for the version header, track names and chord names.
   */
  fixedString(size: number): string {
    const length = this.byte();
    const field = this.bytesOf(size);
    return decodeWindows1252(field.subarray(0, Math.min(length, size)));
  }

  /** An int length, then the text. */
  intString(): string {
    const start = this.position;
    const length = this.int();
    if (length < 0) throw new CorruptFile(start, `string length ${String(length)}`);
    return decodeWindows1252(this.bytesOf(length));
  }

  /**
   * An int, then a byte, then the text: Guitar Pro's most common string. The int is normally the
   * byte length plus one and the byte the length itself, but writers disagree on which one to get
   * right, so each field reads the one Guitar Pro itself trusts there: the byte for the header's
   * metadata and beat text, the int (minus one) everywhere else.
   */
  intByteString(trust: 'int' | 'byte'): string {
    const start = this.position;
    const size = this.int();
    const length = this.byte();
    if (trust === 'byte') return decodeWindows1252(this.bytesOf(length));
    if (size < 1) throw new CorruptFile(start, `string size ${String(size)}`);
    return decodeWindows1252(this.bytesOf(size - 1));
  }

  /**
   * Red, green, blue and a padding byte, as lower-case `#rrggbb`. The fourth byte is always 0 in
   * Guitar Pro's own files and is not alpha.
   */
  color(): string {
    const [red, green, blue] = [this.byte(), this.byte(), this.byte()];
    this.skip(1);
    return `#${[red, green, blue].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
  }
}

/** Whether `bit` (a mask such as 0x04) is set in `flags`. */
export function hasFlag(flags: number, bit: number): boolean {
  return (flags & bit) !== 0;
}
