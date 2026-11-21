import {
  PAGE_SIZES,
  type LayoutResult,
  type Page,
  type Primitive,
  type System,
} from '@reprise/layout';
import { fullScore, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { stripLayout } from '../chord-strip-layout';
import { layoutForPrint } from '../print-layout';
import bravuraJson from './outlines/bravura.json';
import geistJson from './outlines/geist.json';
import { parseOutlines } from './outlines';
import { pageSvg, pageSvgReport } from './svg-page';

const outlines = parseOutlines(bravuraJson, geistJson);

function oneBar() {
  const built = score()
    .title('One bar')
    .artist('Reprise')
    .track('guitar', { display: { notation: 'both', octaveShift: 1 } })
    .bar()
    .beat('4', [note(2, 5)])
    .beat('4', [note(1, 3), note(3, 12)])
    .beat('8', [note(4, 0)])
    .beat('8', [note(4, 2)])
    .beat('4', [note(5, 7)])
    .build({ ids: 'sequential' });
  const content = layoutForPrint(
    built,
    { tracks: built.tracks.map(({ id }) => id), paper: 'a4', header: true, pageNumbers: false },
    {},
    undefined,
  );
  return { built, ...content };
}

function render(
  content: ReturnType<typeof oneBar>,
  extra: Partial<Parameters<typeof pageSvg>[0]> = {},
): string {
  const page = content.result.pages[0];
  if (!page) throw new Error('no page');
  return pageSvg({
    layout: content.result,
    page,
    outlines,
    background: 'white',
    heading: content.heading,
    title: 'One bar',
    ...extra,
  });
}

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')?.textContent ?? '').toBe('');
  return doc;
}

/** A hand-made single-system layout, for what the real layout does not put where a test needs it. */
function handmade(primitives: Primitive[]): { layout: LayoutResult; page: Page } {
  const page: Page = {
    index: 0,
    bbox: { x: 0, y: 0, width: 200, height: 100 },
    systems: { start: 0, end: 1 },
  };
  const system: System = {
    id: 'system:x',
    index: 0,
    page: 0,
    bars: { start: 0, end: 1 },
    bbox: page.bbox,
    staves: [],
    primitives: { start: 0, end: primitives.length },
    anchors: { start: 0, end: 0 },
  };
  const layout: LayoutResult = {
    pages: [page],
    systems: [system],
    primitives,
    anchors: [],
    metrics: {
      layoutMs: 0,
      primitives: primitives.length,
      anchors: 0,
      measuredBars: 0,
      reusedSystems: 0,
    },
  };
  return { layout, page };
}

const box = { x: 0, y: 0, width: 1, height: 1 };
const word = (over: Partial<Extract<Primitive, { kind: 'text' }>>): Primitive => ({
  kind: 'text',
  x: 50,
  y: 40,
  bbox: box,
  role: 'ink',
  text: 'AB',
  size: 10,
  anchor: 'start',
  italic: false,
  ...over,
});

describe('pageSvg', () => {
  const content = oneBar();
  const svg = render(content);

  it('is well-formed XML with the page size as its size and viewBox', () => {
    const root = parse(svg).documentElement;
    const { width, height } = PAGE_SIZES.a4;
    expect(root.getAttribute('width')).toBe(String(width));
    expect(root.getAttribute('height')).toBe(String(height));
    expect(root.getAttribute('viewBox')).toBe(`0 0 ${String(width)} ${String(height)}`);
    expect(root.querySelector('title')?.textContent).toBe('One bar');
  });

  it('carries no CSS, class, currentColor, oklch, variable or font face', () => {
    for (const forbidden of ['class=', 'currentColor', 'oklch', 'var(', '@font-face', '<style']) {
      expect(svg, forbidden).not.toContain(forbidden);
    }
  });

  it('draws one <use> per glyph primitive and no <text> for Latin text', () => {
    const page = content.result.pages[0];
    if (!page) throw new Error('no page');
    const range = content.result.systems.slice(page.systems.start, page.systems.end);
    const glyphs = range.flatMap((system) =>
      content.result.primitives
        .slice(system.primitives.start, system.primitives.end)
        .filter((p) => p.kind === 'glyph'),
    );
    expect(glyphs.length).toBeGreaterThan(5);
    const doc = parse(svg);
    expect(doc.querySelectorAll('use[*|href^="#b-"]').length).toBe(glyphs.length);
    expect(doc.querySelectorAll('text').length).toBe(0);
  });

  it('defines exactly the shapes the page uses', () => {
    const doc = parse(svg);
    const defined = [...doc.querySelectorAll('defs > path')].map(
      (p) => `#${p.getAttribute('id') ?? ''}`,
    );
    const used = new Set([...doc.querySelectorAll('use')].map((u) => u.getAttribute('xlink:href')));
    expect(new Set(defined)).toEqual(used);
    expect(defined.length).toBe(new Set(defined).size);
  });

  it('draws the heading on page 1 only, in outlines', () => {
    const doc = parse(svg);
    expect(doc.querySelectorAll('use[*|href^="#g600-"]').length).toBe(
      'One bar'.replaceAll(' ', '').length,
    );
    const many = fullScore();
    const result = layoutForPrint(
      many,
      { tracks: many.tracks.map(({ id }) => id), paper: 'a4', header: true, pageNumbers: false },
      {},
      'x.gp',
    );
    const second = result.result.pages[1];
    if (second) {
      const text = pageSvg({
        layout: result.result,
        page: second,
        outlines,
        background: 'white',
        heading: result.heading,
      });
      expect(text).not.toContain('#g600-');
    }
  });

  it('cuts a long title with an ellipsis to the content width', () => {
    const long = render(content, {
      heading: { title: 'A very long song title '.repeat(12), height: 68 },
    });
    const doc = parse(long);
    const ellipsis = doc.querySelectorAll('use[*|href="#g600-8230"]');
    expect(ellipsis.length).toBe(1);
  });

  it('writes the same string for the same input', () => {
    expect(render(content)).toBe(svg);
  });

  it('matches the one-bar snapshot', async () => {
    await expect(svg).toMatchFileSnapshot('__snapshots__/one-bar.svg');
  });
});

describe('the chord strip under the title', () => {
  const content = oneBar();
  const diagram = { baseFret: 1, frets: [0, 1, 2, 2, 0, null] };
  const strip = stripLayout(
    [
      { name: 'Am', diagram, suggested: false },
      { name: 'G', diagram, suggested: true },
    ],
    700,
  );
  if (!strip) throw new Error('no strip');

  it('writes the strip on the first page, in the same document, and only there', () => {
    const plain = parse(render(content));
    const heading = { ...content.heading, strip, stripTop: 50, height: 200 };
    const withStrip = parse(render(content, { heading }));
    const paths = (doc: Document) => doc.querySelectorAll('path').length;
    expect(paths(withStrip)).toBeGreaterThan(paths(plain));
    // Both names are drawn as outlines, so more `use` elements; the strip's text is not `<text>`.
    expect(withStrip.querySelectorAll('use').length).toBeGreaterThan(
      plain.querySelectorAll('use').length,
    );
    expect(withStrip.querySelectorAll('text')).toHaveLength(0);
  });
});

describe('pageSvg text', () => {
  const at = (p: Primitive[], extra: Partial<Parameters<typeof pageSvg>[0]> = {}) => {
    const { layout, page } = handmade(p);
    return pageSvg({ layout, page, outlines, background: 'white', ...extra });
  };
  const A = outlines.geist.styles['400']['65']?.advance ?? 0;
  const B = outlines.geist.styles['400']['66']?.advance ?? 0;

  it('moves a run left by half its width when centred and by all of it at the end', () => {
    const k = 10 / outlines.geist.unitsPerEm;
    const translate = (svg: string): number => {
      const match = /<g transform="translate\(([-\d.]+) 40\)/.exec(svg);
      return Number(match?.[1]);
    };
    expect(translate(at([word({})]))).toBeCloseTo(50, 2);
    expect(translate(at([word({ anchor: 'middle' })]))).toBeCloseTo(50 - ((A + B) * k) / 2, 2);
    expect(translate(at([word({ anchor: 'end' })]))).toBeCloseTo(50 - (A + B) * k, 2);
  });

  it('puts the second character at the first one’s advance', () => {
    expect(at([word({})])).toContain(`<use xlink:href="#g400-66" x="${String(A)}"/>`);
  });

  it('draws italic as the upright outlines under the painter’s 0.25 oblique, same advances', () => {
    const upright = at([word({})]);
    const slanted = at([word({ italic: true })]);
    const k = 10 / outlines.geist.unitsPerEm;
    expect(slanted).toContain('#g400-65');
    expect(slanted).not.toContain('g400i');
    expect(slanted).toContain(`matrix(${String(k)} 0 ${String(k * 0.25)} ${String(-k)} 50 40)`);
    expect(slanted).toContain(`x="${String(A)}"`);
    expect(upright).not.toContain('matrix(');
  });

  it('keeps ♯ ♭ ♮ in a chord name as shapes', () => {
    const svg = at([word({ text: 'F♯m7 B♭ E♮' })]);
    expect(svg).not.toContain('<text');
    for (const codepoint of [9839, 9837, 9838]) expect(svg).toContain(`#g400-${String(codepoint)}`);
  });

  it('falls back to escaped <text> when a character has no outline', () => {
    const svg = at([word({ text: '歌 <&>' })]);
    const doc = parse(svg);
    const texts = [...doc.querySelectorAll('text')];
    expect(texts.map((t) => t.textContent)).toEqual(['歌 <&>']);
    expect(svg).toContain('font-family="Geist, \'Geist Variable\', Helvetica, Arial, sans-serif"');
  });

  it('drops C0 controls from fallback text', () => {
    const doc = parse(at([word({ text: '歌\u0001\u0008x' })]));
    expect(doc.querySelector('text')?.textContent).toBe('歌x');
  });
});

describe('pageSvgReport', () => {
  const run = (primitives: Primitive[]) => {
    const { layout, page } = handmade(primitives);
    return pageSvgReport({ layout, page, outlines, background: 'white' });
  };

  it('counts the strings that fell back to <text>', () => {
    expect(run([word({ text: '歌' }), word({ text: 'ok' })]).fallbackTexts).toBe(1);
  });

  it('counts a glyph with no outline instead of dropping it silently', () => {
    const glyph: Primitive = {
      kind: 'glyph',
      glyph: 'gClef',
      codepoint: 0x10ffff,
      x: 10,
      y: 20,
      size: 40,
      bbox: box,
      role: 'ink',
    };
    const report = run([glyph]);
    expect(report.missingGlyphs).toBe(1);
    expect(report.svg).not.toContain('<use');
  });
});

describe('pageSvg heading', () => {
  const heading = (title: string, byline?: string) => {
    const { layout, page } = handmade([]);
    return pageSvgReport({
      layout,
      page,
      outlines,
      background: 'white',
      heading: { title, ...(byline && { byline }), height: 68 },
    });
  };

  it('cuts a title that falls back to <text> too, and never past the content width', () => {
    const report = heading('歌'.repeat(60));
    const text = new DOMParser()
      .parseFromString(report.svg, 'image/svg+xml')
      .querySelector('text')?.textContent;
    expect(report.fallbackTexts).toBe(1);
    expect(text?.endsWith('…')).toBe(true);
    // The page is 200 wide with margins, so far fewer than 60 characters fit.
    expect(Array.from(text ?? '').length).toBeLessThan(20);
  });

  it('draws nothing when not even the ellipsis fits', () => {
    const { layout, page } = handmade([]);
    const narrow = { ...page, bbox: { ...page.bbox, width: 90 } };
    const report = pageSvgReport({
      layout,
      page: narrow,
      outlines,
      background: 'white',
      heading: { title: 'A long title that cannot fit', height: 68 },
    });
    expect(report.svg).not.toContain('#g600-');
  });

  it('kerns the heading as print does and no score text', () => {
    const k = 22 / outlines.geist.unitsPerEm;
    const pair = (text: string): number | undefined => {
      const svg = heading(text).svg;
      const match = /<use xlink:href="#g600-\d+" x="(-?\d+)"\/>/.exec(svg);
      return match ? Number(match[1]) * k : undefined;
    };
    const advance = outlines.geist.styles['600']['65']?.advance ?? 0;
    const kern = outlines.geist.kern['600']['AV'] ?? 0;
    expect(kern).toBeLessThan(0);
    expect(pair('AV')).toBeCloseTo((advance + kern) * k, 2);
  });
});

describe('pageSvg backgrounds', () => {
  const staffLine: Primitive = {
    kind: 'line',
    x: 10,
    y: 50,
    x2: 190,
    y2: 50,
    thickness: 1,
    bbox: { x: 10, y: 49.5, width: 180, height: 1 },
    role: 'ink',
  };
  const fretBox: Primitive = {
    kind: 'path',
    x: 90,
    y: 56,
    d: 'M90 44H110V56H90Z',
    fill: true,
    thickness: 0,
    bbox: { x: 90, y: 44, width: 20, height: 12 },
    role: 'paper',
  };
  const scene = [staffLine, fretBox, word({ text: '5', x: 100, y: 54, anchor: 'middle' })];

  it('keeps white boxes on a white background', () => {
    const { layout, page } = handmade(scene);
    const doc = parse(pageSvg({ layout, page, outlines, background: 'white' }));
    expect(doc.querySelectorAll('mask').length).toBe(0);
    expect(doc.querySelector('rect[fill="#ffffff"]')).not.toBeNull();
    expect(doc.querySelector('path[fill="#ffffff"]')).not.toBeNull();
  });

  it('cuts the lines behind a box through a mask on a transparent one, with no white fill', () => {
    const { layout, page } = handmade(scene);
    const svg = pageSvg({ layout, page, outlines, background: 'transparent' });
    const doc = parse(svg);
    const mask = doc.querySelector('mask');
    expect(mask?.getAttribute('maskUnits')).toBe('userSpaceOnUse');
    expect(mask?.querySelector('path')?.getAttribute('d')).toBe('M90 44H110V56H90Z');
    expect(doc.querySelector('line')?.getAttribute('mask')).toBe(
      `url(#${mask?.getAttribute('id') ?? ''})`,
    );
    expect(doc.querySelector('rect[fill="#ffffff"]')?.parentElement?.tagName).toBe('mask');
    expect(doc.querySelectorAll('path[fill="#ffffff"]').length).toBe(0);
  });

  it('leaves a line drawn after the box, or clear of it, unmasked', () => {
    const after: Primitive = {
      ...staffLine,
      y: 80,
      y2: 80,
      bbox: { x: 10, y: 79.5, width: 180, height: 1 },
    };
    const { layout, page } = handmade([
      staffLine,
      fretBox,
      after,
      { ...staffLine, role: 'accent' },
    ]);
    const doc = parse(pageSvg({ layout, page, outlines, background: 'transparent' }));
    const lines = [...doc.querySelectorAll('line')];
    expect(lines.map((line) => line.hasAttribute('mask'))).toEqual([true, false, false]);
  });

  it('keeps a mask no larger than its line, and ids apart between pages', () => {
    const { layout, page } = handmade(scene);
    const second = { ...page, index: 1 };
    const a = parse(pageSvg({ layout, page, outlines, background: 'transparent' }));
    const b = parse(pageSvg({ layout, page: second, outlines, background: 'transparent' }));
    const maskA = a.querySelector('mask');
    const maskB = b.querySelector('mask');
    expect(Number(maskA?.getAttribute('width'))).toBeLessThan(200);
    expect(Number(maskA?.getAttribute('height'))).toBeLessThan(10);
    expect(maskA?.getAttribute('id')).not.toBe(maskB?.getAttribute('id'));
  });

  it('crops to a page rectangle and moves the content with it', () => {
    const { layout, page } = handmade(scene);
    const doc = parse(
      pageSvg({
        layout,
        page,
        outlines,
        background: 'white',
        crop: { x: 20, y: 30, width: 100, height: 40 },
      }),
    );
    const root = doc.documentElement;
    expect(root.getAttribute('viewBox')).toBe('0 0 100 40');
    expect(doc.querySelector('svg > g')?.getAttribute('transform')).toBe('translate(-20 -30)');
  });
});
