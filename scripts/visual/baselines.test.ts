import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');
const DIR = 'apps/web/e2e/visual/__screenshots__';
const KB = 1024;
const FILE_BUDGET = 512 * KB;
const TOTAL_BUDGET = 5 * KB * KB;
const VIEWPORT = { width: 1600, height: 2000 };

/** Tracked files only, so a developer's local darwin references never count. */
const tracked = execFileSync('git', ['ls-files', '-z', DIR], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

/** Width and height from the PNG's IHDR chunk, big-endian at bytes 16 and 20. */
function dimensions(path: string): { width: number; height: number } {
  const header = readFileSync(join(ROOT, path)).subarray(0, 24);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

describe('the visual baselines', () => {
  it('are CI Linux images only', () => {
    expect(tracked.filter((path) => !path.endsWith('-chromium-linux.png'))).toEqual([]);
  });

  it(`are each at most ${String(FILE_BUDGET / KB)} KB and ${String(TOTAL_BUDGET / KB / KB)} MB together`, () => {
    const sizes = tracked.map((path) => ({ path, bytes: statSync(join(ROOT, path)).size }));
    expect(sizes.filter(({ bytes }) => bytes > FILE_BUDGET)).toEqual([]);
    expect(sizes.reduce((sum, { bytes }) => sum + bytes, 0)).toBeLessThanOrEqual(TOTAL_BUDGET);
  });

  it('each fit the capture viewport', () => {
    expect(
      tracked.filter((path) => {
        const { width, height } = dimensions(path);
        return width > VIEWPORT.width || height > VIEWPORT.height;
      }),
    ).toEqual([]);
  });
});
