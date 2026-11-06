import { describe, expect, it } from 'vitest';

import { detect } from './detect';

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));
const bytes = (...parts: (string | number[])[]): Uint8Array =>
  new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? ascii(part) : part)));

/** The 31-byte binary header: a length byte and a 30-byte field. */
function header(version: string): Uint8Array {
  const field = new Uint8Array(30);
  field.set(ascii(`FICHIER GUITAR PRO ${version}`));
  return bytes([0x18], [...field]);
}

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('detect', () => {
  it.each([
    ['v3.00', 'gp3'],
    ['v4.06', 'gp4'],
    ['v5.10', 'gp5'],
    ['L5.00', 'gp5'],
    ['v5.20', 'gp5'],
  ])('reads the binary header %s as %s', (version, format) => {
    expect(detect(header(version))).toBe(format);
  });

  it('knows no Guitar Pro 6 binary header', () => {
    expect(detect(header('v6.00'))).toBeUndefined();
  });

  it('needs 23 bytes of a binary header', () => {
    const full = header('v5.10');
    for (const length of [0, 1, 4, 22]) expect(detect(full.slice(0, length))).toBeUndefined();
    expect(detect(full.slice(0, 23))).toBe('gp5');
  });

  it('takes a zip local file header for gp, not an empty zip', () => {
    expect(detect(bytes('PK', [3, 4], 'rest'))).toBe('gp');
    expect(detect(bytes('PK', [5, 6], 'rest'))).toBeUndefined();
  });

  it('takes both BCFZ and BCFS for gpx', () => {
    expect(detect(bytes('BCFZ', [0, 0, 0, 0]))).toBe('gpx');
    expect(detect(bytes('BCFS', [0, 0, 0, 0]))).toBe('gpx');
  });

  it('takes a JSON object for reprise, past a BOM and whitespace', () => {
    expect(detect(bytes('{"format":"reprise"}'))).toBe('reprise');
    expect(detect(bytes([0xef, 0xbb, 0xbf], '{}'))).toBe('reprise');
    expect(detect(bytes('\n  \t{}'))).toBe('reprise');
    expect(detect(bytes('[{}]'))).toBeUndefined();
  });

  it('finds nothing in random bytes', () => {
    const next = random(45);
    const noise = new Uint8Array(64).map(() => Math.floor(next() * 256));
    expect(detect(noise)).toBeUndefined();
  });
});
