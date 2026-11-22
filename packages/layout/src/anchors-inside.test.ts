import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { assert, constantFrom, integer, property } from 'fast-check';
import { describe, expect, it } from 'vitest';

import { PAGE_SIZES, layout, type LayoutOptions } from './index';
import { expectValid } from './test/check-result';
import { randomScore } from './test/random-score';

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
    // from the first at every onset, sits right of the last beat, wholly beyond the bar's end.
    const first = score().track('guitar').bar();
    for (let i = 0; i < 16; i++) first.beat('16', [note(1, 0), note(2, 0), note(3, 0)]);
    first.voice(1);
    for (let i = 0; i < 16; i++) first.beat('16', [note(1, 1), note(2, 1)]);
    const built = first.build({ ids: 'sequential' });
    // `expectValid` checks every anchor against its system's frame.
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

  it.each([
    ['identical', 5],
    ['a third apart', 9],
    ['a fourth apart', 10],
  ])('keeps two voices apart when their grace notes are %s', (_name, fret) => {
    // The main chords sit far apart, so only the graces meet (#465): a third or fourth apart,
    // their heads clear each other but their stems and flags cross.
    const grace = (at: number) => ({
      grace: [{ duration: 16 as const, before: true, notes: [note(3, at)] }],
    });
    const first = score().track('guitar').bar();
    first.beat('4', [note(1, 0)], grace(5)).beat('4', [note(1, 0)]);
    first
      .voice(1)
      .beat('4', [note(6, 3)], grace(fret))
      .beat('4', [note(6, 3)]);
    const built = first.build({ ids: 'sequential' });
    const result = layout(built, options(built, PAGE_SIZES.a4.width, 'paged'));
    expectValid(result);
    // The anchors alone clear each other here; the later voice moves right of the graces' extent.
    const [high, low] = [0, 1].map((voice) =>
      result.anchors.find((a) => a.kind === 'note' && a.voice === voice),
    );
    expect(low?.bbox.x).toBeGreaterThan((high?.bbox.x ?? 0) + 5);
  });

  it('holds for the random scores #465 found, at every width in both modes', () => {
    for (const seed of [37, 97, 293, 323, 358, 373]) {
      const built = randomScore(seed, { diagrams: true });
      for (const width of [320, 500, 700, 1200]) {
        for (const mode of ['paged', 'continuous'] as const) {
          expectValid(layout(built, options(built, width, mode)));
        }
      }
    }
  }, 30_000);

  it('holds for random scores with chord diagrams, in both modes at narrow and wide lines', () => {
    assert(
      property(integer({ min: 0, max: 400 }), constantFrom(320, 500, 700, 1200), (seed, width) => {
        const built = randomScore(seed, { diagrams: true });
        for (const mode of ['paged', 'continuous'] as const) {
          expectValid(layout(built, options(built, width, mode)));
        }
      }),
      { numRuns: 60 },
    );
  }, 30_000);
});
