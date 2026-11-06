import { layout, PAGE_SIZES } from '@reprise/layout';
import { beatOf, fullScore, largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { columnAnchor, cursorAt, cursorForBeat, describeLayout, findAnchors } from './anchors';
import { uniformNotation } from './view-options';

const options = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
} as const;

describe('anchors', () => {
  const score = fullScore();
  const result = layout(score, options);
  const beat = beatOf(score, 0, 0, 0);

  it('finds anchors by id and kind', () => {
    const all = findAnchors(result, beat.id);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((a) => a.id === beat.id)).toBe(true);
    expect(findAnchors(result, beat.id, 'note')).toEqual([]);
    expect(findAnchors(result, 'nope')).toEqual([]);
  });

  it('finds the column anchor across every staff', () => {
    const masterBar = score.masterBars[0]?.id ?? '';
    const column = columnAnchor(result, masterBar, 0);
    expect(column?.kind).toBe('bar');
    expect(column?.track).toBeUndefined();
    const system = result.systems[0];
    const lastStaff = system?.staves.at(-1);
    expect(column?.bbox.y).toBeLessThanOrEqual(system?.staves[0]?.top ?? 0);
    expect((column?.bbox.y ?? 0) + (column?.bbox.height ?? 0)).toBeGreaterThanOrEqual(
      lastStaff?.bottom ?? Number.POSITIVE_INFINITY,
    );
    expect(columnAnchor(result, masterBar, 5)).toBeUndefined();
  });

  it('places the cursor at a note or beat centre and a bar start', () => {
    const [note] = findAnchors(result, beat.notes[0]?.id ?? '', 'note');
    if (!note) throw new Error('no note anchor');
    expect(cursorAt(result, note)).toEqual({
      x: note.bbox.x + note.bbox.width / 2,
      bar: columnAnchor(result, note.masterBar ?? '', 0),
    });
    const [beatAnchor] = findAnchors(result, beat.id, 'beat');
    if (!beatAnchor) throw new Error('no beat anchor');
    expect(cursorForBeat(result, beat.id)?.x).toBe(beatAnchor.bbox.x + beatAnchor.bbox.width / 2);
    const bar = columnAnchor(result, note.masterBar ?? '', 0);
    if (!bar) throw new Error('no bar anchor');
    expect(cursorAt(result, bar)?.x).toBe(bar.bbox.x);
    expect(cursorForBeat(result, 'nope')).toBeUndefined();
  });

  it('uses the first anchor of a beat shown on two staves', () => {
    const both = layout(score, { ...options, notation: uniformNotation(score, 'both') });
    const anchors = findAnchors(both, beat.id, 'beat');
    expect(anchors.length).toBeGreaterThan(1);
    const [first] = anchors;
    if (!first) throw new Error('no beat anchor');
    expect(cursorForBeat(both, beat.id)?.x).toBe(first.bbox.x + first.bbox.width / 2);
  });

  it('describes the layout', () => {
    expect(describeLayout(result)).toBe(`${String(score.masterBars.length)} bars, 1 page`);
    expect(describeLayout(layout(largeScore(1, 40), options))).toMatch(/^40 bars, \d+ pages$/);
    const continuous = layout(largeScore(1, 40), { ...options, mode: 'continuous', width: 640 });
    expect(continuous.systems.length).toBeGreaterThan(1);
    expect(describeLayout(continuous)).toBe('40 bars');
  });
});
