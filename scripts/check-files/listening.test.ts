import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT_DIR } from './files.ts';
import { ALWAYS, CHECKLIST, FEATURES, listeningSheet } from './listening.ts';

/** GitHub's heading slug: lowercase, punctuation dropped, spaces as hyphens. */
const slug = (heading: string): string =>
  heading
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N} -]/gu, '')
    .replaceAll(' ', '-');

const headings = new Set(
  readFileSync(join(ROOT_DIR, CHECKLIST), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('#'))
    .map((line) => slug(line.replace(/^#+\s*/, ''))),
);

// formats may import nothing from scripts, so the key list is read off the source.
const source = readFileSync(
  join(ROOT_DIR, 'packages/formats/test/files-check/read-facts.ts'),
  'utf8',
);
const keys = [
  ...(/FEATURE_KEYS = \[([^\]]*)\]/.exec(source)?.[1] ?? '').matchAll(/'([^']+)'/g),
].map((match) => match[1]);

describe('the listening table', () => {
  it('links every row to a heading of the checklist', () => {
    for (const item of [...ALWAYS, ...Object.values(FEATURES)]) {
      expect(headings, item.anchor).toContain(item.anchor);
    }
  });

  it('maps every feature key the read check can emit, and no other', () => {
    expect(keys.length).toBeGreaterThan(30);
    expect(Object.keys(FEATURES).sort()).toEqual([...keys].sort());
  });

  it('builds a sheet with the fixed rows and one per feature', () => {
    const sheet = listeningSheet(
      'fixtures/gp5/effects.gp5',
      [{ key: 'bends', bars: [7, 8], detail: 'bend' }],
      'x.md',
    );
    expect(sheet).toContain('| [B1 Opens](x.md#b1-opens) |');
    expect(sheet).toContain('| [Bends](x.md#b4-effects) | 7, 8 |');
    expect(sheet.match(/^\| \[/gm)).toHaveLength(ALWAYS.length + 1);
  });
});
