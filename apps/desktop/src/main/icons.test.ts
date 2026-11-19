import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const RESOURCES = join(import.meta.dirname, '../../resources');

/** A PNG's IHDR holds width and height as the first two big-endian words after the signature. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(join(RESOURCES, file));
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('app icons', () => {
  it.each(['icon.png', 'icon-mac.png'])('%s is 1024 by 1024', (file) => {
    expect(pngSize(file)).toEqual({ width: 1024, height: 1024 });
  });
});
