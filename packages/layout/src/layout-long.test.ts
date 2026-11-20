import { type Notation } from '@reprise/model';
import { largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MARGINS, PAGE_SIZES, layout, type LayoutOptions } from './index';
import { expectInsidePages, expectValid } from './test/check-result';
import { continuous, paged } from './test/layout-options';

// Split from layout.test.ts: these cases lay out the 300-bar score and dominate its runtime.
describe('layout', () => {
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
      // The words every staff now draws make each system of the 8-track score taller than a page.
      if (paper === 'a4') {
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
});
