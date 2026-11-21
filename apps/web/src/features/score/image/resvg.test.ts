import { Resvg } from '@resvg/resvg-js';
import type { LayoutResult } from '@reprise/layout';
import { describe, expect, it } from 'vitest';

import bravuraJson from './outlines/bravura.json';
import geistJson from './outlines/geist.json';
import { parseOutlines } from './outlines';
import { pageSvg } from './svg-page';

const outlines = parseOutlines(bravuraJson, geistJson);

/**
 * resvg ignores CSS and web fonts as Inkscape does, so ink where a glyph or word should be shows
 * the SVG needs neither.
 */
describe('pageSvg through a renderer that knows no fonts', () => {
  const layout: LayoutResult = {
    pages: [
      { index: 0, bbox: { x: 0, y: 0, width: 120, height: 60 }, systems: { start: 0, end: 1 } },
    ],
    systems: [
      {
        id: 'system:x',
        index: 0,
        page: 0,
        bars: { start: 0, end: 1 },
        bbox: { x: 0, y: 0, width: 120, height: 60 },
        staves: [],
        primitives: { start: 0, end: 2 },
        anchors: { start: 0, end: 0 },
      },
    ],
    primitives: [
      {
        kind: 'glyph',
        glyph: 'gClef',
        codepoint: 0xe050,
        x: 10,
        y: 40,
        size: 40,
        bbox: { x: 10, y: 0, width: 20, height: 50 },
        role: 'ink',
      },
      {
        kind: 'text',
        x: 60,
        y: 40,
        text: 'Hello',
        size: 20,
        anchor: 'start',
        italic: false,
        bbox: { x: 60, y: 25, width: 50, height: 20 },
        role: 'ink',
      },
    ],
    anchors: [],
    metrics: { layoutMs: 0, primitives: 2, anchors: 0, measuredBars: 0, reusedSystems: 0 },
  };

  const page = layout.pages[0];
  if (!page) throw new Error('no page');

  const ink = (background: 'white' | 'transparent') => {
    const svg = pageSvg({
      layout: {
        ...layout,
        pages: [...layout.pages],
        systems: [...layout.systems],
        primitives: [...layout.primitives],
        anchors: [],
      },
      page: page,
      outlines,
      background,
    });
    const image = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
    return { pixels: image.pixels, width: image.width, height: image.height };
  };

  const darkIn = (shot: ReturnType<typeof ink>, x0: number, x1: number): number => {
    let count = 0;
    for (let y = 0; y < shot.height; y++) {
      for (let x = x0; x < x1; x++) {
        const at = (y * shot.width + x) * 4;
        if ((shot.pixels[at + 3] ?? 0) > 128 && (shot.pixels[at] ?? 255) < 100) count++;
      }
    }
    return count;
  };

  it('draws ink at the glyph and at the word', () => {
    const shot = ink('white');
    expect(shot.width).toBe(120);
    expect(darkIn(shot, 10, 30)).toBeGreaterThan(50);
    expect(darkIn(shot, 60, 110)).toBeGreaterThan(50);
    expect(darkIn(shot, 48, 58)).toBe(0);
  });

  it('is transparent in the margin when asked, and white otherwise', () => {
    const corner = (shot: ReturnType<typeof ink>) => [...shot.pixels.subarray(0, 4)];
    expect(corner(ink('transparent'))).toEqual([0, 0, 0, 0]);
    expect(corner(ink('white'))).toEqual([255, 255, 255, 255]);
  });
});
