import {
  STANDARD_TUNING,
  applyCommand,
  createEmptyScore,
  setBeatDuration,
  type Notation,
} from '@reprise/model';
import { beatOf, largeScore, midi, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MARGINS, LayoutCache, PAGE_SIZES, layout, type LayoutOptions } from './index';
import {
  expectInsidePages,
  expectValid,
  nonFinite,
  outsideItsPage,
  stable,
} from './test/check-result';

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

  it.each([
    ['tab', 'a4'],
    ['standard', 'a4'],
    ['both', 'a4'],
    ['mixed', 'a4'],
    ['tab', 'letter'],
    ['standard', 'letter'],
    ['both', 'letter'],
    ['mixed', 'letter'],
  ] as const)(
    'lays out the long score in page view in %s on %s with no system crossing a page edge',
    (notation, paper) => {
      const long = largeScore(8, 300, { structure: true });
      const mixed: readonly Notation[] = ['tab', 'standard', 'both'];
      const options: LayoutOptions = {
        ...paged,
        width: PAGE_SIZES[paper].width,
        pageHeight: PAGE_SIZES[paper].height,
        notation: Object.fromEntries(
          long.tracks.map(({ id }, i) => [
            id,
            notation === 'mixed' ? (mixed[i % mixed.length] ?? 'tab') : notation,
          ]),
        ),
      };
      const result = layout(long, options);
      expectValid(result);
      expectInsidePages(result, DEFAULT_MARGINS.paged);
      expect(result.systems.at(-1)?.bars.end).toBe(300);
      if (paper === 'letter' && notation === 'standard') {
        // The one long-score case that mixes whole and split systems.
        expect(result.systems.some(({ part }) => part === undefined)).toBe(true);
        expect(result.systems.some(({ part }) => part === 1)).toBe(true);
      }
      if (paper === 'a4' && notation !== 'standard') {
        // Every system splits in two, each part at its page's top.
        for (const system of result.systems) {
          expect(system.part).toBe(system.index % 2);
          expect(system.bbox.y).toBe(
            (result.pages[system.page]?.bbox.y ?? 0) + DEFAULT_MARGINS.paged.top,
          );
        }
      }
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

  it('spaces a bar with no beats, or only empty ones, like a single quarter, as alphaTab does', () => {
    const built = score()
      .track('guitar')
      .bar()
      .rest('1')
      .bar()
      .bar()
      .beat('4')
      .bar()
      .masterBar({ timeSignature: { numerator: 1, denominator: 4 } })
      .rest('4')
      .bar()
      .rest('4')
      .bar()
      .rest('4')
      .build({ ids: 'sequential' });
    const widths = layout(built, continuous)
      .anchors.filter((anchor) => anchor.kind === 'bar' && anchor.track === undefined)
      .map((anchor) => anchor.bbox.width);
    expect(widths[1]).toBeCloseTo(widths[4] ?? 0, 6);
    expect(widths[2]).toBeCloseTo(widths[4] ?? 0, 6);
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

  it('squeezes a bar wider than the page into a system of its own', () => {
    const builder = score().timeSignature(32, 4).track('guitar').bar();
    for (let i = 0; i < 128; i++) builder.beat('32', [note(1, i % 12)]);
    const result = layout(builder.build({ ids: 'sequential' }), paged);
    expect(result.systems).toHaveLength(1);
    const [system] = result.systems;
    const right = PAGE_SIZES.a4.width - DEFAULT_MARGINS.paged.right;
    expect(system && system.bbox.x + system.bbox.width).toBeCloseTo(right, 1);
    const bar = result.anchors.find((anchor) => anchor.kind === 'bar');
    const beats = result.anchors.filter((anchor) => anchor.kind === 'beat');
    expect(beats.map((anchor) => anchor.system)).toEqual(Array.from({ length: 128 }, () => 0));
    for (const beat of beats) {
      expect(beat.bbox.x).toBeGreaterThanOrEqual(bar?.bbox.x ?? Infinity);
      expect(beat.bbox.x + beat.bbox.width).toBeLessThanOrEqual(
        (bar?.bbox.x ?? 0) + (bar?.bbox.width ?? 0),
      );
    }
    expectValid(result);
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

  it.each([
    ['paged', paged],
    ['continuous', continuous],
  ])(
    'never gives a track without strings a tab staff, whatever its notation says (%s)',
    (_, base) => {
      const built = score()
        .track('guitar', { id: 'guitar000001' })
        .bar()
        .beat('4', [note(1, 0)])
        .track('piano', {
          id: 'keystuning01',
          tuning: [...STANDARD_TUNING],
          fretCount: 24,
          display: { notation: 'tab', clef: 'treble', octaveShift: 0 },
        })
        .bar()
        .beat('4', [midi(60)])
        .track('piano', {
          id: 'keysnotune01',
          tuning: [],
          display: { notation: 'both', clef: 'treble', octaveShift: 0 },
        })
        .bar()
        .beat('4', [midi(64)])
        .track('drums', { id: 'drums0000001' })
        .bar()
        .build({ ids: 'sequential' });
      const staves = (notation: LayoutOptions['notation']) =>
        layout(built, { ...base, notation }).systems[0]?.staves.map(
          ({ track, type }) => `${track}:${type}`,
        );
      const every = (wanted: Notation) =>
        Object.fromEntries(built.tracks.map((track) => [track.id, wanted]));
      expect(staves({})).toEqual([
        'guitar000001:tab',
        'keystuning01:standard',
        'keysnotune01:standard',
        'drums0000001:percussion',
      ]);
      expect(staves(every('tab'))).toEqual([
        'guitar000001:tab',
        'keystuning01:standard',
        'keysnotune01:standard',
        'drums0000001:percussion',
      ]);
      expect(staves(every('both'))).toEqual([
        'guitar000001:standard',
        'guitar000001:tab',
        'keystuning01:standard',
        'keysnotune01:standard',
        'drums0000001:percussion',
      ]);
    },
  );

  it('spaces the visible tracks alone, whatever a hidden track plays', () => {
    const builder = score().track('guitar');
    for (let b = 0; b < 6; b++)
      builder
        .bar()
        .beat('2', [note(1, b)])
        .beat('4', [note(2, 0)])
        .beat('4');
    builder.track('bass');
    for (let b = 0; b < 6; b++) builder.bar().beat('1', [note(1, b)]);
    const built = builder.build({ ids: 'sequential' });
    const options: LayoutOptions = { ...continuous, tracks: [built.tracks[0]?.id ?? ''] };
    const cache = new LayoutCache();
    const before = layout(built, options, cache);
    const { score: edited } = applyCommand(
      built,
      setBeatDuration({ beatId: beatOf(built, 1, 2, 0).id }, { duration: 16 }),
    );
    const after = layout(edited, options, cache);
    expect(after.metrics.measuredBars).toBe(0);
    expect(stable(after)).toBe(stable(before));
    expect(stable(after)).toBe(stable(layout(edited, options)));
  });

  it('is deterministic: identical input gives byte-identical output', () => {
    const long = largeScore(2, 40, { structure: true });
    expect(stable(layout(long, paged))).toBe(stable(layout(long, paged)));
    const sequential = () => eighthsScore(6);
    expect(stable(layout(sequential(), paged))).toBe(stable(layout(sequential(), paged)));
    expect(stable(layout(sequential(), continuous))).toBe(stable(layout(sequential(), continuous)));
  });

  describe("keeps the first page's header room", () => {
    const header = 68;
    const margins = DEFAULT_MARGINS.paged;
    const both = (built: ReturnType<typeof largeScore>): LayoutOptions['notation'] =>
      Object.fromEntries(built.tracks.map(({ id }) => [id, 'both']));

    it('starts page 0 under the header and every later page at its margin', () => {
      const result = layout(largeScore(2, 40), { ...paged, headerHeight: header });
      expectValid(result);
      expectInsidePages(result, margins);
      expect(result.pages.length).toBeGreaterThan(1);
      const firstOn = (page: number) => result.systems.find((system) => system.page === page);
      expect(firstOn(0)?.bbox.y).toBe(margins.top + header);
      expect(firstOn(1)?.bbox.y).toBe((result.pages[1]?.bbox.y ?? 0) + margins.top);
      for (const system of result.systems.filter(({ page }) => page === 0)) {
        expect(system.bbox.y).toBeGreaterThanOrEqual(margins.top + header);
        for (const primitive of result.primitives.slice(
          system.primitives.start,
          system.primitives.end,
        )) {
          expect(primitive.bbox.y).toBeGreaterThanOrEqual(margins.top + header - 0.01);
        }
      }
    });

    it('splits an 8-track system on page 0 below the header, between whole tracks', () => {
      const tall = largeScore(8, 6);
      const result = layout(tall, { ...paged, notation: both(tall), headerHeight: header });
      expectValid(result);
      expectInsidePages(result, margins);
      const first = result.systems[0];
      if (!first) throw new Error('no system');
      expect(first.part).toBe(0);
      expect(first.page).toBe(0);
      expect(first.bbox.y).toBe(margins.top + header);
      const types = (track: string) =>
        first.staves.filter((staff) => staff.track === track).map(({ type }) => type);
      for (const { track } of first.staves) expect(types(track)).toEqual(['standard', 'tab']);
    });

    it('splits a system that fits a full page but not the first page under its header', () => {
      const built = largeScore(4, 2);
      const options = { ...paged, notation: both(built) };
      const height = layout(built, { ...options, pageHeight: 100_000 }).systems[0]?.bbox.height;
      if (height === undefined) throw new Error('no system');
      const pageHeight = height + margins.top + margins.bottom + header / 2;
      const whole = layout(built, { ...options, pageHeight });
      expect(whole.systems[0]?.part).toBeUndefined();
      const result = layout(built, { ...options, pageHeight, headerHeight: header });
      expect(result.systems[0]?.part).toBe(0);
      expect(result.systems[0]?.page).toBe(0);
      expect(result.systems[1]?.page).toBe(1);
      expectInsidePages(result, margins);
    });

    it('ignores the header in continuous mode and rejects a negative one', () => {
      const built = largeScore(2, 8);
      expect(stable(layout(built, { ...continuous, headerHeight: header }))).toBe(
        stable(layout(built, continuous)),
      );
      expect(() => layout(built, { ...paged, headerHeight: -1 })).toThrow(RangeError);
    });

    it('rejects a header that leaves no room on the first page', () => {
      const built = largeScore(2, 4);
      const room = PAGE_SIZES.a4.height - margins.top - margins.bottom;
      for (const headerHeight of [room, 2000]) {
        expect(() => layout(built, { ...paged, headerHeight })).toThrow(
          /headerHeight .* must be less than the first page's content area/,
        );
      }
      expect(() => layout(built, { ...paged, headerHeight: room - 1 })).not.toThrow();
    });
  });

  it('rejects a zoom or width that is not positive', () => {
    expect(() => layout(createEmptyScore(), { ...paged, zoom: 0 })).toThrow(RangeError);
    expect(() => layout(createEmptyScore(), { ...paged, width: Number.NaN })).toThrow(RangeError);
  });
});

describe('the page checks', () => {
  it('find nothing on an ordinary score', () => {
    const result = layout(eighthsScore(8), paged);
    expect(outsideItsPage(result, DEFAULT_MARGINS.paged)).toEqual([]);
    expect(nonFinite(result)).toEqual([]);
  });

  it('find a primitive past the page edge and a system past its right margin', () => {
    const laid = layout(eighthsScore(8), paged);
    const [first, ...rest] = laid.primitives;
    const [system, ...others] = laid.systems;
    if (!first || !system) throw new Error('nothing laid out');
    const broken = {
      ...laid,
      primitives: [{ ...first, bbox: { ...first.bbox, x: PAGE_SIZES.a4.width + 10 } }, ...rest],
      systems: [
        { ...system, bbox: { ...system.bbox, width: PAGE_SIZES.a4.width - system.bbox.x } },
        ...others,
      ],
    };
    const overflows = outsideItsPage(broken, DEFAULT_MARGINS.paged);
    expect(overflows).toHaveLength(1);
    expect(overflows[0]?.primitives).toBe(1);
    expect(overflows[0]?.systemOverflowPx).toBeGreaterThan(0);
  });

  it('name every non-finite number by its path', () => {
    const result = layout(eighthsScore(1), paged);
    const [primitive] = result.primitives;
    if (!primitive) throw new Error('no primitive');
    primitive.bbox.x = Number.NaN;
    expect(nonFinite(result)).toEqual(['result.primitives[0].bbox.x']);
  });
});
