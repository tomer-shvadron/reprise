import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseOutlines, textRun } from './outlines';
import bravuraJson from './outlines/bravura.json';
import geistJson from './outlines/geist.json';

const outlines = parseOutlines(bravuraJson, geistJson);
const metricsDir = join(import.meta.dirname, '../../../../../../packages/layout/src/metrics');
const read = (name: string): unknown => JSON.parse(readFileSync(join(metricsDir, name), 'utf8'));

const layoutBravura = z.object({
  glyphs: z.record(z.string(), z.object({ codepoint: z.number() })),
});
const layoutGeist = z.object({ advances: z.record(z.string(), z.number()) });

describe('outline tables', () => {
  it('hold every SMuFL glyph layout can emit, with ink', () => {
    const { glyphs } = layoutBravura.parse(read('bravura.json'));
    expect(Object.keys(glyphs).length).toBeGreaterThan(100);
    for (const [name, { codepoint }] of Object.entries(glyphs)) {
      expect(outlines.bravura.glyphs[String(codepoint)]?.d, name).toBeTruthy();
    }
  });

  it('give Geist the advances layout measured, so outlined text sits where layout put it', () => {
    const { advances } = layoutGeist.parse(read('geist.json'));
    for (const [character, advance] of Object.entries(advances)) {
      const glyph = outlines.geist.styles['400'][String(character.codePointAt(0))];
      expect(glyph?.advance, character).toBe(advance);
    }
  });

  it('cover Latin Extended in every style and place accented text without a fallback', () => {
    for (const style of ['400', '400i', '600'] as const) {
      const run = textRun('Ångström – Łódź', outlines.geist.styles[style]);
      expect(run.missing, style).toBe(false);
      expect(run.width, style).toBeGreaterThan(0);
    }
  });

  it('flag text outside the tables', () => {
    expect(textRun('歌', outlines.geist.styles['400']).missing).toBe(true);
  });
});
