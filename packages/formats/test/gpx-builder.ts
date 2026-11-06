/**
 * Builds gpx containers for tests: BCFZ streams chunk by chunk, and BCFS images file by file,
 * laid out the way Guitar Pro 6 writes them (each file's entry sector followed by its blocks).
 */

const SECTOR = 0x1000;

class BitWriter {
  readonly #bits: number[] = [];

  /** Most significant bit first. */
  bits(value: number, count: number): this {
    for (let index = count - 1; index >= 0; index--) this.#bits.push((value >>> index) & 1);
    return this;
  }

  /** Least significant bit first. */
  reversed(value: number, count: number): this {
    for (let index = 0; index < count; index++) this.#bits.push((value >>> index) & 1);
    return this;
  }

  /** The bits so far, zero-padded to whole bytes. */
  bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.#bits.length / 8));
    this.#bits.forEach((bit, index) => {
      out[index >>> 3] = (out[index >>> 3] ?? 0) | (bit << (7 - (index & 7)));
    });
    return out;
  }
}

/** A literal run of 0 to 3 bytes, or a back-reference with its field width. */
export type BcfzChunk = { literal: number[] } | { distance: number; length: number; width: number };

export const ascii = (text: string): Uint8Array =>
  Uint8Array.from(text, (char) => char.charCodeAt(0));

export function bcfz(declaredLength: number, chunks: BcfzChunk[]): Uint8Array {
  const writer = new BitWriter();
  for (const chunk of chunks) {
    if ('literal' in chunk) {
      writer.bits(0, 1).reversed(chunk.literal.length, 2);
      for (const byte of chunk.literal) writer.bits(byte, 8);
    } else {
      writer
        .bits(1, 1)
        .bits(chunk.width, 4)
        .reversed(chunk.distance, chunk.width)
        .reversed(chunk.length, chunk.width);
    }
  }
  const body = writer.bytes();
  const out = new Uint8Array(8 + body.length);
  out.set(ascii('BCFZ'));
  new DataView(out.buffer).setInt32(4, declaredLength, true);
  out.set(body, 8);
  return out;
}

/** Content as literal runs of three, the simplest valid encoding. */
export function bcfzLiterals(content: Uint8Array): Uint8Array {
  const chunks: BcfzChunk[] = [];
  for (let at = 0; at < content.length; at += 3) {
    chunks.push({ literal: [...content.subarray(at, at + 3)] });
  }
  return bcfz(content.length, chunks);
}

export interface BcfsEntry {
  name: string;
  data?: Uint8Array;
  /** 1 for a directory; files are 2. */
  type?: number;
  /** Overrides the declared size. */
  size?: number;
  /** Overrides the block list (the trailing 0 is added). */
  blocks?: number[];
}

/** A BCFS image: the magic, an empty header sector, then each entry and its data blocks. */
export function bcfs(entries: BcfsEntry[]): Uint8Array {
  const sectors: Uint8Array[] = [new Uint8Array(SECTOR)];
  for (const entry of entries) {
    const header = new Uint8Array(SECTOR);
    const view = new DataView(header.buffer);
    const data = entry.data ?? new Uint8Array();
    const first = sectors.length + 1;
    const count = Math.ceil(data.length / SECTOR);
    const blocks = entry.blocks ?? Array.from({ length: count }, (_, index) => first + index);
    view.setInt32(0, entry.type ?? 2, true);
    header.set(ascii(entry.name), 4);
    view.setInt32(140, entry.size ?? data.length, true);
    blocks.forEach((block, index) => {
      view.setInt32(148 + index * 4, block, true);
    });
    sectors.push(header);
    for (let index = 0; index < count; index++) {
      const block = new Uint8Array(SECTOR);
      block.set(data.subarray(index * SECTOR, (index + 1) * SECTOR));
      sectors.push(block);
    }
  }
  const image = new Uint8Array(4 + sectors.length * SECTOR);
  image.set(ascii('BCFS'));
  sectors.forEach((sector, index) => {
    image.set(sector, 4 + index * SECTOR);
  });
  return image;
}

/** A complete gpx file: the files in a BCFS image, compressed as literals. */
export function gpx(files: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  return bcfzLiterals(
    bcfs(
      Object.entries(files).map(([name, data]) => ({
        name,
        data: typeof data === 'string' ? encoder.encode(data) : data,
      })),
    ),
  );
}
