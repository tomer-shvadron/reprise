import {
  applyCommand,
  insertBar,
  removeBar,
  setMasterBar,
  setNote,
  type Score,
} from '@reprise/model';
import { beatOf, largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { LayoutCache, PAGE_SIZES, layout, type LayoutOptions } from './index';
import { expectValid, stable } from './test/check-result';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

function warm(score: Score, options: LayoutOptions = paged) {
  const cache = new LayoutCache();
  const first = layout(score, options, cache);
  return { cache, first };
}

describe('LayoutCache', () => {
  it('reuses every bar and system when nothing changed', () => {
    const score = largeScore(2, 60, { structure: true });
    const { cache, first } = warm(score);
    expect(cache.size).toBe(60);
    const again = layout(score, paged, cache);
    expect(again.metrics.measuredBars).toBe(0);
    expect(again.metrics.reusedSystems).toBe(first.systems.length);
    expect(stable(again)).toBe(stable(first));
  });

  it('re-measures only the dirty bar and re-breaks from its system', () => {
    const score = largeScore(2, 60, { structure: true });
    const { cache, first } = warm(score);
    const bar = 30;
    const { score: edited, change } = applyCommand(
      score,
      setNote({ beatId: beatOf(score, 1, bar, 0).id }, { string: 6, fret: 12 }),
    );
    expect(change.touchedBars).toEqual([score.masterBars[bar]?.id]);

    const result = layout(edited, { ...paged, dirtyBars: change.touchedBars }, cache);
    expect(result.metrics.measuredBars).toBe(1);
    const before = first.systems.filter((system) => system.bars.end < bar).length;
    expect(result.metrics.reusedSystems).toBe(before);
    expect(stable(result)).toBe(stable(layout(edited, paged)));
    expectValid(result);
  });

  it('notices an edited bar by identity when no dirty bars are given', () => {
    const score = largeScore(1, 20);
    const { cache } = warm(score);
    const { score: edited } = applyCommand(
      score,
      setNote({ beatId: beatOf(score, 0, 12, 3).id }, { string: 1, fret: 7 }),
    );
    const result = layout(edited, paged, cache);
    expect(result.metrics.measuredBars).toBe(1);
    expect(stable(result)).toBe(stable(layout(edited, paged)));
  });

  it.each([
    ['inserting a bar', () => insertBar({ index: 7 })],
    ['removing a bar', (score: Score) => removeBar({ masterBarId: score.masterBars[7]?.id ?? '' })],
    [
      'changing a time signature',
      (score: Score) =>
        setMasterBar(
          { masterBarId: score.masterBars[9]?.id ?? '' },
          { timeSignature: { numerator: 6, denominator: 4 } },
        ),
    ],
    [
      'adding a repeat',
      (score: Score) =>
        setMasterBar(
          { masterBarId: score.masterBars[11]?.id ?? '' },
          { repeat: { start: false, endCount: 3 } },
        ),
    ],
  ])('matches a cold layout after %s', (_, command) => {
    const score = largeScore(2, 24);
    for (const mode of ['paged', 'continuous'] as const) {
      const options: LayoutOptions = {
        ...paged,
        mode,
        width: mode === 'paged' ? paged.width : 900,
      };
      const { cache } = warm(score, options);
      const { score: edited, change } = applyCommand(score, command(score));
      const result = layout(edited, { ...options, dirtyBars: change.touchedBars }, cache);
      expect(stable(result)).toBe(stable(layout(edited, options)));
      expect(result.metrics.measuredBars).toBeLessThan(edited.masterBars.length);
    }
  });

  it('starts over when the options change what bars measure', () => {
    const score = largeScore(1, 10);
    const { cache } = warm(score);
    expect(layout(score, { ...paged, zoom: 1.5 }, cache).metrics.measuredBars).toBe(10);
    const wider = layout(score, { ...paged, zoom: 1.5, width: 1000 }, cache);
    expect(wider.metrics.measuredBars).toBe(0);
    expect(wider.metrics.reusedSystems).toBe(0);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
