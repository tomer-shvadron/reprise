import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// #471: a focus indicator drawn only as a translucent `ring-ring/NN` halo is about 1.85:1, under
// WCAG 1.4.11's 3:1. The five components and the base outline below draw the solid `--ring`, and
// a translucent ring may appear only where this allowlist says a solid `border-ring` rides with it.
const SRC = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

const SOLID_SITES = [
  'components/ui/tabs.tsx',
  'components/ui/scroll-area.tsx',
  'app/right-panel/tab-list.tsx',
  'app/bottom-dock/bottom-dock.tsx',
  'features/library/song-list.tsx',
];

// Each entry draws a translucent ring beside a solid `border-ring` (or, for the slider thumb, beside
// a solid `focus-visible:ring-ring` that the halo only supports on hover and press).
const HALO_PLUS_SOLID = new Set([
  'components/ui/button.tsx',
  'components/ui/input.tsx',
  'components/ui/textarea.tsx',
  'components/ui/switch.tsx',
  'components/ui/input-group.tsx',
  'components/ui/toggle.tsx',
  'components/ui/slider.tsx',
]);

// Any opacity but 100: `/50`, `/40`, `/[.3]`.
const TRANSLUCENT = /(?:ring|outline)-ring\/(?!100\b)(?:\d+|\[)/;

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });

// The quoted class strings that name a focus-visible ring, so a check binds to one element.
const classStrings = (text: string) =>
  [...text.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g)].map((m) => m[0].slice(1, -1));

describe('solid focus indicators', () => {
  it.each(SOLID_SITES)(
    '%s has an element whose focus ring is solid and not translucent',
    (path) => {
      const solid = classStrings(read(path)).filter((c) =>
        /(?:^|\s)focus-visible:ring-ring(?:\s|$)/.test(c),
      );
      expect(solid.length).toBeGreaterThan(0);
      for (const c of solid) expect(c).not.toMatch(TRANSLUCENT);
    },
  );

  it('the default Toggle and the slider thumb draw the solid ring on focus', () => {
    const toggle = read('components/ui/toggle.tsx');
    expect(toggle).toMatch(/focus-visible:ring-ring(?![/\w-])/);
    expect(toggle).not.toMatch(/focus-visible:ring-ring\//);
    expect(read('components/ui/slider.tsx')).toMatch(/focus-visible:ring-ring(?![/\w-])/);
  });

  it('the base outline is the solid ring', () => {
    const css = read('index.css');
    expect(css).toMatch(/outline-ring(?![/\w-])/);
    expect(css).not.toMatch(TRANSLUCENT);
  });

  it('a translucent ring appears only in the allowlisted halo-plus-solid components', () => {
    const offenders = sources(SRC)
      .filter((file) => TRANSLUCENT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
      .filter((file) => !HALO_PLUS_SOLID.has(file));
    expect(offenders).toEqual([]);
  });

  it('every allowlisted file keeps a solid indicator beside its halo', () => {
    for (const file of HALO_PLUS_SOLID) {
      expect(read(file), file).toMatch(/border-ring|focus-visible:ring-ring(?![/\w-])/);
    }
  });
});
