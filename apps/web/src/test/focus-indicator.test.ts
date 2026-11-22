import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// #471: a focus indicator drawn only as the `ring-ring/50` halo is about 1.85:1, under WCAG
// 1.4.11's 3:1. The six sites below draw the solid `--ring`, and nothing else may be halo-only.
const SRC = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

const SOLID_SITES = [
  'components/ui/tabs.tsx',
  'components/ui/scroll-area.tsx',
  'app/right-panel/tab-list.tsx',
  'app/bottom-dock/bottom-dock.tsx',
  'features/library/song-list.tsx',
];

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });

describe('solid focus indicators', () => {
  it.each(SOLID_SITES)('%s draws the solid ring on keyboard focus', (path) => {
    const text = read(path);
    expect(text).toMatch(/focus-visible:ring-ring(?![/\w-])/);
    expect(text).not.toContain('ring-ring/50');
  });

  it('the base outline is the solid ring', () => {
    const css = read('index.css');
    expect(css).toMatch(/outline-ring(?![/\w-])/);
    expect(css).not.toContain('outline-ring/50');
  });

  it('no file draws the ring halo without a solid border-ring beside it', () => {
    const offenders = sources(SRC)
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return /ring-ring\/50/.test(text) && !/border-ring/.test(text);
      })
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
