import { applyCommand, setBeatEffect, setMasterBar, type Score } from '@reprise/model';
import { beatOf, largeScore, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MARGINS,
  PAGE_SIZES,
  layout,
  type LayoutOptions,
  type LayoutResult,
  type System,
  type TextPrimitive,
} from './index';
import { continuationRows, partHeight, partVertical, splitSlots } from './split';
import { expectInsidePages, expectValid } from './test/check-result';
import { describe as describeResult } from './test/describe';
import type { VerticalLayout } from './vertical';

const SPACE = 10;

/** A stack of staves 40 px tall with 10 px kept above and below, 20 px apart, under `rows`. */
function stack(count: number, rows: VerticalLayout['rows'] = {}): VerticalLayout {
  let y = 0;
  for (const row of Object.values(rows)) y = Math.max(y, row.bottom);
  const staves: VerticalLayout['staves'] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) y += 20;
    y += 10;
    staves.push({ top: y, bottom: y + 40, above: 10, below: 10, lanes: {} });
    y += 50;
  }
  return { rows, staves, groups: [], height: y, key: 'k' };
}

describe('splitSlots', () => {
  it('cuts after the last whole track that fits', () => {
    // Staves are 60 px with their room, 20 px apart; a continuation adds a 24 px bar-number row.
    const vertical = stack(6);
    expect(splitSlots(vertical, [0, 0, 1, 1, 2, 2], 220, SPACE)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 6 },
    ]);
    expect(splitSlots(vertical, [0, 0, 1, 1, 2, 2], 300, SPACE)).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 6 },
    ]);
  });

  it('cuts inside a track only when that track alone is taller than the room', () => {
    expect(splitSlots(stack(4), [0, 0, 0, 1], 200, SPACE)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it('makes a staff taller than the room a part of its own', () => {
    expect(splitSlots(stack(3), [0, 1, 2], 50, SPACE)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ]);
  });

  it("counts a continuation's bar numbers, and its voltas when the system has them", () => {
    const plain = stack(2);
    expect(partHeight(plain, { start: 1, end: 2 }, SPACE)).toBe(24 + 60);
    const volta = stack(2, { volta: { top: 0, bottom: 26 } });
    expect(continuationRows(volta, SPACE)).toEqual({
      barNumber: { top: 0, bottom: 24 },
      volta: { top: 24, bottom: 50 },
    });
    expect(partHeight(volta, { start: 0, end: 2 }, SPACE)).toBe(volta.height);
    expect(partHeight(volta, { start: 1, end: 2 }, SPACE)).toBe(50 + 60);
  });

  it('moves a continuation to its own top and keeps only its tracks', () => {
    const vertical = stack(3, { section: { top: 0, bottom: 32 } });
    const part = partVertical(vertical, [0, 1, 1], { start: 1, end: 3 }, SPACE);
    expect(part.rows).toEqual({ barNumber: { top: 0, bottom: 24 } });
    expect(part.staves[1]).toMatchObject({ top: 34, bottom: 74 });
    expect(part.groups[0]).toBeUndefined();
    expect(part.groups[1]).toEqual({ top: 34, bottom: 154 });
    expect(part.height).toBe(164);
  });
});

const margins = DEFAULT_MARGINS.paged;

function both(built: Score, options: Partial<LayoutOptions> = {}): LayoutOptions {
  return {
    mode: 'paged',
    width: PAGE_SIZES.a4.width,
    zoom: 1,
    tracks: 'all',
    notation: Object.fromEntries(built.tracks.map(({ id }) => [id, 'both'])),
    ...options,
  };
}

const columns = (result: LayoutResult, system: System) =>
  result.anchors
    .slice(system.anchors.start, system.anchors.end)
    .filter((anchor) => anchor.kind === 'bar' && anchor.track === undefined);

describe('a system taller than the page', () => {
  const tall = largeScore(8, 6);
  const result = layout(tall, both(tall));
  const [first, second] = result.systems;

  it('splits an 8-track system on A4 between tracks, every primitive inside its page', () => {
    if (!first || !second) throw new Error('no parts');
    expect([first.part, second.part]).toEqual([0, 1]);
    expect([first.page, second.page]).toEqual([0, 1]);
    for (const part of [first, second]) {
      expect(part.bbox.y).toBe((result.pages[part.page]?.bbox.y ?? 0) + margins.top);
    }
    const tracksOf = (system: System) => new Set(system.staves.map(({ track }) => track));
    expect([...tracksOf(first)].filter((track) => tracksOf(second).has(track))).toEqual([]);
    const whole = layout(tall, both(tall, { pageHeight: 100_000 })).systems[0];
    const names = (system: System | undefined) =>
      system?.staves.map(({ track, type }) => `${track}:${type}`);
    expect([...(names(first) ?? []), ...(names(second) ?? [])]).toEqual(names(whole));
    const boxes = (system: System) =>
      columns(result, system).map(({ bbox }) => [bbox.x, bbox.width]);
    expect(boxes(second)).toEqual(boxes(first));
    expectValid(result);
    expectInsidePages(result, margins);
  });

  it('opens a continuation with its bar numbers', () => {
    if (!first || !second) throw new Error('no parts');
    const texts = (system: System) =>
      result.primitives
        .slice(system.primitives.start, system.primitives.end)
        .filter((primitive): primitive is TextPrimitive => primitive.kind === 'text');
    const top = second.staves[0]?.top ?? 0;
    for (const column of columns(result, second)) {
      const index = tall.masterBars.findIndex(({ id }) => id === column.id);
      const number = texts(second).find(
        (primitive) => primitive.text === String(index + 1) && primitive.node === column.id,
      );
      expect(number?.y).toBeLessThan(top);
      expect(number?.x).toBeCloseTo(column.bbox.x + 1.4, 5);
    }
    const masterBars = new Set(tall.masterBars.map(({ id }) => id));
    const numbers = (system: System) =>
      texts(system).filter(
        (primitive) =>
          /^\d+$/.test(primitive.text) &&
          primitive.node !== undefined &&
          masterBars.has(primitive.node),
      );
    expect(numbers(first)).toEqual([]);
  });

  it('starts a split system at the top of the next page although room was left', () => {
    let built = largeScore(2, 24);
    const bar = 16;
    for (const track of [0, 1]) {
      ({ score: built } = applyCommand(
        built,
        setBeatEffect({ beatId: beatOf(built, track, bar, 0).id }, { chord: { name: 'Am7' } }),
      ));
    }
    ({ score: built } = applyCommand(
      built,
      setMasterBar({ masterBarId: built.masterBars[bar]?.id ?? '' }, { section: { name: 'Solo' } }),
    ));
    const unbounded = layout(built, both(built, { pageHeight: 100_000 }));
    const heights = unbounded.systems.map(({ bbox }) => bbox.height);
    const tallIndex = unbounded.systems.findIndex(
      ({ bars }) => bars.start <= bar && bar < bars.end,
    );
    const tallest = heights[tallIndex] ?? 0;
    const others = Math.max(...heights.filter((_, i) => i !== tallIndex));
    expect(tallest).toBeGreaterThan(others);
    const room = (tallest + others) / 2;
    const result = layout(built, both(built, { pageHeight: room + margins.top + margins.bottom }));
    expectValid(result);
    expectInsidePages(result, margins);
    const part0 = result.systems.find((system) => system.part === 0);
    const part1 = result.systems.find((system) => system.part === 1);
    const before = result.systems[(part0?.index ?? 0) - 1];
    if (!part0 || !part1 || !before) throw new Error('no split after a whole system');
    expect(part0.bars.start).toBe(unbounded.systems[tallIndex]?.bars.start);
    expect(part0.page).toBe(before.page + 1);
    expect(part1.page).toBe(part0.page + 1);
    for (const part of [part0, part1]) {
      expect(part.bbox.y).toBe((result.pages[part.page]?.bbox.y ?? 0) + margins.top);
    }
  });

  it('never splits in continuous mode', () => {
    const continuous = layout(tall, { ...both(tall), mode: 'continuous', width: 640 });
    expect(continuous.pages).toHaveLength(1);
    expect(continuous.systems.some((system) => system.part !== undefined)).toBe(false);
  });

  it('describes a split two-track system', () => {
    const builder = score()
      .track('guitar')
      .bar()
      .section('Intro')
      .beat('2', [note(1, 0)])
      .beat('2', [note(2, 2)])
      .bar()
      .beat('1', [note(3, 3)])
      .bar()
      .volta([1])
      .repeatEnd()
      .beat('1', [note(1, 5)])
      .track('bass');
    for (let b = 0; b < 3; b++) builder.bar().beat('1', [note(1, b)]);
    const built = builder.build({ ids: 'sequential' });
    const guitar = built.tracks[0]?.id ?? '';
    const bass = built.tracks[1]?.id ?? '';
    const notation: LayoutOptions['notation'] = { [guitar]: 'both', [bass]: 'tab' };
    const whole = layout(built, { ...both(built), notation, pageHeight: 100_000 });
    const height = whole.systems[0]?.bbox.height ?? 0;
    const result = layout(built, {
      ...both(built),
      notation,
      pageHeight: height - 1 + margins.top + margins.bottom,
    });
    expectValid(result);
    expect(result.systems.map(({ part }) => part)).toEqual([0, 1]);
    expect(result.systems[0]?.staves.map(({ track }) => track)).toEqual([guitar, guitar]);
    expect(describeResult(result)).toMatchSnapshot();
  });
});
