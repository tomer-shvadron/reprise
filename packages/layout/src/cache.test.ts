import {
  applyCommand,
  insertBar,
  removeBar,
  setBeatDuration,
  setBeatEffect,
  setMasterBar,
  setNote,
  setNoteEffect,
  setTrackProperties,
  type Score,
} from '@reprise/model';
import { beatOf, largeScore, note, noteOf, score as scoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { LayoutCache, PAGE_SIZES, layout, type LayoutOptions, type LayoutResult } from './index';
import { BAR_REACH } from './staves/staff-module';
import { expectValid, stable } from './test/check-result';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

const continuous: LayoutOptions = { ...paged, mode: 'continuous', width: 640 };

function warm(score: Score, options: LayoutOptions = paged) {
  const cache = new LayoutCache();
  const first = layout(score, options, cache);
  return { cache, first };
}

/** Systems more than `BAR_REACH` bars from bar `index`, which an edit there leaves alone. */
function outOfReach(result: LayoutResult, index: number): number {
  return result.systems.filter(
    ({ bars }) => bars.end - 1 + BAR_REACH < index || bars.start - BAR_REACH > index,
  ).length;
}

/** The system was handed over as the same primitive objects, not rebuilt. */
function kept(before: LayoutResult, after: LayoutResult, systemId: string): boolean {
  const old = before.systems.find(({ id }) => id === systemId);
  const now = after.systems.find(({ id }) => id === systemId);
  return (
    old !== undefined &&
    now !== undefined &&
    after.primitives[now.primitives.start] === before.primitives[old.primitives.start]
  );
}

/** A score whose width puts a system's first bar at `start`, from the widths tried in turn. */
function widthStarting(built: Score, start: number, options: LayoutOptions): number {
  for (let width = 300; width <= 1200; width += 5) {
    const result = layout(built, { ...options, width });
    if (result.systems.some(({ bars }) => bars.start === start)) return width;
  }
  throw new Error(`no width starts a system at bar ${String(start)}`);
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

  it('re-measures only the dirty bar and rebuilds only the systems within reach of it', () => {
    const score = largeScore(2, 60, { structure: true });
    const { cache, first } = warm(score);
    const bar = 30;
    const { score: edited, change } = applyCommand(
      score,
      setNote({ beatId: beatOf(score, 1, bar, 0).id }, { string: 6, fret: 7 }),
    );
    expect(change.touchedBars).toEqual([score.masterBars[bar]?.id]);

    const result = layout(edited, { ...paged, dirtyBars: change.touchedBars }, cache);
    expect(result.metrics.measuredBars).toBe(1);
    expect(result.metrics.reusedSystems).toBe(outOfReach(first, bar));
    expect(result.systems.length - result.metrics.reusedSystems).toBeLessThanOrEqual(3);
    expect(stable(result)).toBe(stable(layout(edited, paged)));
    expectValid(result);
  });

  it.each([
    ['paged', paged],
    ['continuous', continuous],
  ])('rebuilds at most three systems for a fret edit that keeps the width, %s', (_, options) => {
    const score = largeScore(2, 60);
    const { cache, first } = warm(score, options);
    for (const bar of [3, 20, 31, 47, 58]) {
      const beat = beatOf(score, 0, bar, 2);
      const fret = beat.notes[0]?.fret === 1 ? 2 : 1;
      const string = beat.notes[0]?.string ?? 1;
      const { score: edited, change } = applyCommand(
        score,
        setNote({ beatId: beat.id }, { string, fret }),
      );
      const result = layout(edited, { ...options, dirtyBars: change.touchedBars }, cache);
      expect(result.systems).toHaveLength(first.systems.length);
      expect(result.systems.length - result.metrics.reusedSystems).toBeLessThanOrEqual(3);
      expect(stable(result)).toBe(stable(layout(edited, options)));
      layout(score, options, cache);
    }
  });

  it('redraws a tie half at a system end when its continuation three bars on changes (#88)', () => {
    // String 1 rests for two bars between a tie's halves, so the continuation sits three bars on.
    const builder = scoreBuilder().track('guitar');
    for (let bar = 0; bar < 32; bar++) {
      builder.bar();
      if (bar % 4 === 0) builder.beat('2', [note(1, 5)]).beat('2', [note(1, 7)]);
      else if (bar % 4 === 3)
        builder.beat('2', [note(1, 7, { tie: true })]).beat('2', [note(2, 3)]);
      else builder.beat('1', [note(3, 2)]);
    }
    const built = builder.build({ ids: 'sequential' });
    const options = { ...paged, width: widthStarting(built, 13, paged) };
    const { cache, first } = warm(built, options);
    const origin = first.systems.find(({ bars }) => bars.end === 13);
    if (!origin) throw new Error('no system ends after bar 12');

    const { score: edited, change } = applyCommand(
      built,
      setNoteEffect({ noteId: noteOf(built, 0, 15, 0).id }, { tie: false }),
    );
    expect(change.touchedBars).toEqual([built.masterBars[15]?.id]);
    const result = layout(edited, { ...options, dirtyBars: change.touchedBars }, cache);
    expect(stable(result)).toBe(stable(layout(edited, options)));
    expect(kept(first, result, origin.id)).toBe(false);
    const now = result.systems.find(({ id }) => id === origin.id);
    expect(now && now.primitives.end - now.primitives.start).toBeLessThan(
      origin.primitives.end - origin.primitives.start,
    );
  });

  it('rebuilds a system out of reach whose entering dynamic changed', () => {
    // Voice 2 plays in bar 0 and bar 12 only, so its bar-0 dynamic decides whether bar 12 writes
    // one. Voice 1 opens with a dynamic, so the first system keeps its dynamics lane and height.
    const builder = scoreBuilder().track('guitar');
    for (let bar = 0; bar < 24; bar++) {
      builder.bar();
      for (let beat = 0; beat < 4; beat++) {
        builder.beat('4', [note(1, (bar + beat) % 5, bar + beat === 0 ? { dynamics: 'p' } : {})]);
      }
      if (bar === 0 || bar === 12) builder.voice(1).beat('1', [note(4, 2, { dynamics: 'mf' })]);
    }
    const built = builder.build({ ids: 'sequential' });
    const options = { ...paged, width: widthStarting(built, 12, paged) };
    const { cache, first } = warm(built, options);
    const later = first.systems.find(({ bars }) => bars.start === 12);
    if (!later) throw new Error('no system starts at bar 12');

    const { score: edited, change } = applyCommand(
      built,
      setNoteEffect({ noteId: noteOf(built, 0, 0, 0, 0, 1).id }, { dynamics: 'p' }),
    );
    const result = layout(edited, { ...options, dirtyBars: change.touchedBars }, cache);
    expect(change.touchedBars).toEqual([built.masterBars[0]?.id]);
    expect(kept(first, result, later.id)).toBe(false);
    expect(stable(result)).toBe(stable(layout(edited, options)));
  });

  it('rebuilds every later segment when a continuous edit changes a bar width', () => {
    const score = largeScore(1, 40);
    const { cache, first } = warm(score, continuous);
    const bar = 10;
    const { score: edited, change } = applyCommand(
      score,
      setBeatDuration({ beatId: beatOf(score, 0, bar, 0).id }, { duration: 16 }),
    );
    const result = layout(edited, { ...continuous, dirtyBars: change.touchedBars }, cache);
    const before = first.systems.filter(({ bars }) => bars.end - 1 + BAR_REACH < bar).length;
    expect(result.metrics.reusedSystems).toBe(before);
    expect(stable(result)).toBe(stable(layout(edited, continuous)));
  });

  it('reuses the systems past an edit that changes the system count, at their new indices', () => {
    // A bar almost as wide as the page takes a system of its own, so the edit adds one; the page
    // height is the first that leaves room for it on its page, so the next page keeps its systems.
    const wide = 'C'.repeat(75);
    const score = largeScore(1, 48, { structure: true });
    const { score: edited, change } = applyCommand(
      score,
      setBeatEffect({ beatId: beatOf(score, 0, 5, 0).id }, { chord: { name: wide } }),
    );
    for (let pageHeight = 400; pageHeight <= 1600; pageHeight += 4) {
      const options = { ...paged, pageHeight };
      const { cache, first } = warm(score, options);
      const result = layout(edited, { ...options, dirtyBars: change.touchedBars }, cache);
      expect(stable(result)).toBe(stable(layout(edited, options)));
      const moved = result.systems.filter(
        (system) => system.bars.start > 5 + BAR_REACH && kept(first, result, system.id),
      );
      if (result.systems.length === first.systems.length || moved.length === 0) continue;
      const old = first.systems.find(({ id }) => id === moved[0]?.id);
      expect(moved[0]?.index).not.toBe(old?.index);
      expect(result.anchors.filter(({ system }) => system === moved[0]?.index).length).toBe(
        (moved[0]?.anchors.end ?? 0) - (moved[0]?.anchors.start ?? 0),
      );
      expectValid(result);
      return;
    }
    throw new Error('no page height let the added system fit');
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

  it('notices a clef change by identity in every bar it reaches', () => {
    const score = largeScore(1, 20);
    const { cache } = warm(score);
    const edited: Score = {
      ...score,
      tracks: score.tracks.map((track) => ({
        ...track,
        bars: track.bars.map((bar, index) => (index === 5 ? { ...bar, clef: 'bass' } : bar)),
      })),
    };
    const result = layout(edited, paged, cache);
    expect(result.metrics.measuredBars).toBe(15);
    expect(stable(result)).toBe(stable(layout(edited, paged)));
  });

  it('keeps measurements across a rename and drops them for a capo change', () => {
    const score = largeScore(1, 10);
    const trackId = score.tracks[0]?.id ?? '';
    const { cache } = warm(score);
    const renamed = applyCommand(score, setTrackProperties({ trackId }, { name: 'Lead' })).score;
    const afterRename = layout(renamed, paged, cache);
    expect(afterRename.metrics.measuredBars).toBe(0);
    expect(afterRename.metrics.reusedSystems).toBe(0);
    expect(stable(afterRename)).toBe(stable(layout(renamed, paged)));
    const capo = applyCommand(renamed, setTrackProperties({ trackId }, { capo: 3 })).score;
    expect(layout(capo, paged, cache).metrics.measuredBars).toBe(10);
  });
});
