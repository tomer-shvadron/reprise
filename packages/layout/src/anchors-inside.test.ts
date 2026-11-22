import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { assert, constantFrom, integer, property } from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PAGE_SIZES, layout, type LayoutOptions, type LayoutResult } from './index';
import { expectValid } from './test/check-result';
import { randomScore } from './test/random-score';

const EPSILON = 0.02;

/** Anchors, as `kind id`, that are not wholly inside the frame of the system they belong to. */
function outside(result: LayoutResult): string[] {
  const found: string[] = [];
  for (const system of result.systems) {
    const left = system.bbox.x - (system.offsetX ?? 0);
    const right = left + system.bbox.width;
    for (const anchor of result.anchors.slice(system.anchors.start, system.anchors.end)) {
      const { x, width } = anchor.bbox;
      if (x < left - EPSILON || x + width > right + EPSILON)
        found.push(`${anchor.kind} ${anchor.id}`);
    }
  }
  return found;
}

function options(built: Score, width: number, mode: LayoutOptions['mode']): LayoutOptions {
  return {
    mode,
    width,
    pageHeight: PAGE_SIZES.a4.height,
    zoom: 1,
    tracks: 'all',
    notation: Object.fromEntries(built.tracks.map(({ id }) => [id, 'standard' as const])),
  };
}

describe('anchors stay inside their system', () => {
  it('in a squeezed bar whose last beat has a second voice moved right of it', () => {
    // Sixteen sixteenths a line cannot hold: the bar is squeezed, and the second voice, a second
    // from the first at every onset, is drawn at `rigidScale` inside the bar, so no anchor needs
    // clipping to it.
    const first = score().track('guitar').bar();
    for (let i = 0; i < 16; i++) first.beat('16', [note(1, 0), note(2, 0), note(3, 0)]);
    first.voice(1);
    for (let i = 0; i < 16; i++) first.beat('16', [note(1, 1), note(2, 1)]);
    const built = first.build({ ids: 'sequential' });
    // `expectValid` checks every anchor against its system's frame; `outside` is for the property.
    expectValid(layout(built, options(built, 200, 'paged')));
  });

  it('keeps two voices apart at onsets a float tick apart', () => {
    // Seven septuplet 32nds reach tick 960 by summing 120 * 8/7 seven times, a float short of
    // the second quarter, where the other voice's chord starts; the voices are one onset, as
    // `measure` draws them.
    const septuplet = { tuplet: { n: 7, of: 8 } } as const;
    const first = score().track('guitar').bar();
    for (let i = 0; i < 7; i++) first.beat('32', [note(1, 0)], septuplet);
    first.beat('4', [note(1, 0), note(2, 0)]);
    first
      .voice(1)
      .beat('4', [note(1, 1)])
      .beat('4', [note(1, 1), note(2, 1)]);
    const built = first.build({ ids: 'sequential' });
    expectValid(layout(built, options(built, PAGE_SIZES.a4.width, 'paged')));
  });

  it('holds for random scores with chord diagrams, in both modes at narrow and wide lines', () => {
    // Only `outside`, not `expectValid`: two voices' grace notes on identical positions still
    // overlap (seeds 37, 97, 293, 358 and 373 at 1200 px paged, #465). Widen this check to
    // `expectValid` when that is fixed.
    assert(
      property(integer({ min: 0, max: 400 }), constantFrom(320, 500, 700, 1200), (seed, width) => {
        const built = randomScore(seed, { diagrams: true });
        for (const mode of ['paged', 'continuous'] as const) {
          expect(
            outside(layout(built, options(built, width, mode))),
            `seed ${String(seed)}`,
          ).toEqual([]);
        }
      }),
      { numRuns: 60 },
    );
  }, 30_000);
});
