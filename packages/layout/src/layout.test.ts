import { createEmptyScore } from '@reprise/model';
import { largeScore, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MARGINS, PAGE_SIZES, layout, type LayoutOptions } from './index';
import { expectValid, overlappingAnchors, stable } from './test/check-result';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};
const continuous: LayoutOptions = { ...paged, mode: 'continuous', width: 1200 };

function eighthsScore(bars: number) {
  const builder = score().track('guitar');
  for (let b = 0; b < bars; b++) {
    builder.bar();
    for (let i = 0; i < 8; i++) builder.beat('8', [note((i % 6) + 1, b % 12)]);
  }
  return builder.build({ ids: 'sequential' });
}

describe('layout', () => {
  it.each([
    ['paged', paged],
    ['continuous', continuous],
  ])('lays out the empty score in %s mode', (_, options) => {
    const result = layout(createEmptyScore(), options);
    expectValid(result);
    expect(result.systems).toHaveLength(1);
    expect(result.pages).toHaveLength(1);
  });

  it('lays out a one-bar score with an anchor for every beat', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)])
      .beat('4', [note(2, 1)])
      .rest('2')
      .build({ ids: 'sequential' });
    const result = layout(built, paged);
    expectValid(result);
    const beats = result.anchors.filter((anchor) => anchor.kind === 'beat');
    expect(beats.map((anchor) => anchor.id)).toEqual(
      built.tracks[0]?.bars[0]?.voices[0]?.beats.map((beat) => beat.id),
    );
    const xs = beats.map((anchor) => anchor.bbox.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it.each([
    ['paged', paged],
    ['continuous', continuous],
  ])(
    'lays out the long score in %s mode',
    (_, options) => {
      const long = largeScore(8, 300, { structure: true });
      const result = layout(long, options);
      expectValid(result);
      expect(result.systems.at(-1)?.bars.end).toBe(300);
      const beats = result.anchors.filter((anchor) => anchor.kind === 'beat');
      const total = long.tracks.reduce(
        (sum, track) =>
          sum + track.bars.reduce((count, bar) => count + bar.voices[0].beats.length + 1, 0),
        0,
      );
      expect(beats).toHaveLength(total);
    },
    30_000,
  );

  it('justifies every paged system but a short last one to the right margin', () => {
    const result = layout(eighthsScore(10), paged);
    const right = paged.width - DEFAULT_MARGINS.paged.right;
    expect(result.systems.length).toBeGreaterThan(2);
    for (const system of result.systems.slice(0, -1)) {
      expect(system.bbox.x + system.bbox.width).toBeCloseTo(right, 1);
    }
  });

  it('keeps natural widths in continuous mode, one page with systems side by side', () => {
    const result = layout(eighthsScore(10), continuous);
    expectValid(result);
    expect(result.pages).toHaveLength(1);
    const [first, ...rest] = result.systems;
    let right = (first?.bbox.x ?? 0) + (first?.bbox.width ?? 0);
    for (const system of rest) {
      expect(system.bbox.y).toBe(first?.bbox.y);
      expect(system.bbox.x).toBeCloseTo(right, 1);
      right = system.bbox.x + system.bbox.width;
    }
    const bars = (options: LayoutOptions) =>
      layout(eighthsScore(10), options).anchors.filter(
        (anchor) => anchor.kind === 'bar' && anchor.track === undefined,
      );
    const narrow = bars({ ...continuous, width: 400 }).map((anchor) => anchor.bbox.width);
    const wide = bars({ ...continuous, width: 3000 }).map((anchor) => anchor.bbox.width);
    expect(narrow.slice(1)).toEqual(wide.slice(1));
  });

  it('breaks pages by system height', () => {
    const result = layout(largeScore(2, 120), paged);
    expectValid(result);
    expect(result.pages.length).toBeGreaterThan(1);
    for (const system of result.systems) {
      const page = result.pages[system.page];
      if (!page) throw new Error('system without a page');
      expect(system.bbox.y).toBeGreaterThanOrEqual(page.bbox.y + DEFAULT_MARGINS.paged.top);
      expect(system.bbox.y + system.bbox.height).toBeLessThanOrEqual(
        page.bbox.y + page.bbox.height - DEFAULT_MARGINS.paged.bottom,
      );
    }
    const letter = layout(largeScore(2, 120), {
      ...paged,
      width: PAGE_SIZES.letter.width,
      pageHeight: PAGE_SIZES.letter.height,
    });
    expect(letter.pages[1]?.bbox).toEqual({
      x: 0,
      y: PAGE_SIZES.letter.height + 32,
      width: PAGE_SIZES.letter.width,
      height: PAGE_SIZES.letter.height,
    });
  });

  it('fits fewer bars on a line as the zoom grows', () => {
    const at = (zoom: number) => layout(eighthsScore(12), { ...paged, zoom }).systems.length;
    expect(at(2)).toBeGreaterThan(at(1));
    expect(at(1)).toBeGreaterThan(at(0.5));
  });

  it('never splits a bar wider than the page; it overflows its own system', () => {
    const builder = score().timeSignature(32, 4).track('guitar').bar();
    for (let i = 0; i < 128; i++) builder.beat('32', [note(1, i % 12)]);
    const result = layout(builder.build({ ids: 'sequential' }), paged);
    expect(result.systems).toHaveLength(1);
    expect(
      result.anchors.filter((anchor) => anchor.kind === 'beat').map((anchor) => anchor.system),
    ).toEqual(Array.from({ length: 128 }, () => 0));
    expect(overlappingAnchors(result)).toEqual([]);
  });

  it('shows the visible tracks only, each with the staves its notation asks for', () => {
    const built = score()
      .track('guitar', { id: 'guitar000001' })
      .bar()
      .track('bass', { id: 'bass00000001' })
      .bar()
      .track('drums', { id: 'drums0000001' })
      .bar()
      .track('piano', { id: 'piano0000001' })
      .bar()
      .build({ ids: 'sequential' });
    const staves = (options: Partial<LayoutOptions>) =>
      layout(built, { ...paged, ...options }).systems[0]?.staves.map(
        ({ track, type }) => `${track}:${type}`,
      );
    expect(staves({})).toEqual([
      'guitar000001:tab',
      'bass00000001:tab',
      'drums0000001:percussion',
      'piano0000001:standard',
    ]);
    expect(
      staves({
        tracks: ['bass00000001', 'guitar000001', 'drums0000001'],
        notation: { guitar000001: 'both', bass00000001: 'standard', drums0000001: 'tab' },
      }),
    ).toEqual([
      'guitar000001:standard',
      'guitar000001:tab',
      'bass00000001:standard',
      'drums0000001:percussion',
    ]);
    const none = layout(built, { ...paged, tracks: [] });
    expect(none.systems).toEqual([]);
    expect(none.pages).toHaveLength(1);
  });

  it('is deterministic: identical input gives byte-identical output', () => {
    const long = largeScore(2, 40, { structure: true });
    expect(stable(layout(long, paged))).toBe(stable(layout(long, paged)));
    const sequential = () => eighthsScore(6);
    expect(stable(layout(sequential(), paged))).toBe(stable(layout(sequential(), paged)));
    expect(stable(layout(sequential(), continuous))).toBe(stable(layout(sequential(), continuous)));
  });

  it('rejects a zoom or width that is not positive', () => {
    expect(() => layout(createEmptyScore(), { ...paged, zoom: 0 })).toThrow(RangeError);
    expect(() => layout(createEmptyScore(), { ...paged, width: Number.NaN })).toThrow(RangeError);
  });
});
