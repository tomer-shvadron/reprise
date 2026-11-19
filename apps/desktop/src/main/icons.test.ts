import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const RESOURCES = join(import.meta.dirname, '../../resources');

/** A PNG's IHDR holds width, height, bit depth and colour type right after the signature. */
function ihdr(file: string) {
  const bytes = readFileSync(join(RESOURCES, file));
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

describe('app icons', () => {
  it.each(['icon.png', 'icon-mac.png'])('%s is 1024 by 1024', (file) => {
    expect(ihdr(file)).toMatchObject({ width: 1024, height: 1024 });
  });

  it('keeps the transparent margin of the macOS grid (RGBA)', () => {
    expect(ihdr('icon-mac.png').colorType).toBe(6);
  });

  // Edit icon.svg, run `pnpm desktop:icon`, then update this hash with the PNGs.
  it('has icon.svg unchanged since the PNGs were rendered', () => {
    const svg = readFileSync(join(RESOURCES, 'icon.svg'));
    expect(createHash('sha256').update(svg).digest('hex')).toBe(
      '9f8795baebb878f7f9bd2f13f00504b917fca430d3bd39e952142611b8232c6e',
    );
  });
});
