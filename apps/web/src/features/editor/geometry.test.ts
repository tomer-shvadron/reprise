import {
  anchorBox,
  layout,
  PAGE_SIZES,
  type StaffType,
  type LayoutOptions,
  type LayoutResult,
} from '@reprise/layout';
import { beatTicks, type Notation, type Score } from '@reprise/model';
import { beatOf, largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { playheadAt } from '@/features/score';
import type { EditRange } from '@/state/selection';

import { cursorAtPosition, defaultStaff } from './cursor';
import { caretBoxes, caretRect, rangeBoxes } from './geometry';
import { editScore } from './test/scores';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

const lay = (built: Score, notation: Notation, base = paged): LayoutResult =>
  layout(built, {
    ...base,
    notation: Object.fromEntries(built.tracks.map(({ id }) => [id, notation])),
  });

const score = editScore();
const guitar = score.tracks[0]?.id ?? '';

function cursor(track: number, bar: number, stop: number, string: number, staff: StaffType) {
  const found = cursorAtPosition(score, { track, bar, voice: 0, stop }, { string, staff });
  if (!found) throw new Error('no stop');
  return found;
}

describe('caretBoxes', () => {
  const tab = lay(score, 'tab');

  it('centres a box one line tall on the string line, at the beat x', () => {
    const staff = tab.systems[0]?.staves.find((s) => s.track === guitar && s.type === 'tab');
    const beat = beatOf(score, 0, 0, 1);
    const anchor = tab.anchors.find((a) => a.kind === 'beat' && a.id === beat.id);
    if (!staff || !anchor) throw new Error('missing');
    const [box] = caretBoxes(tab, score, cursor(0, 0, 1, 3, 'tab'));
    const gap = (staff.bottom - staff.top) / 5;
    const rect = anchorBox(tab, anchor);
    expect(box?.box.height).toBeCloseTo(gap);
    expect((box?.box.y ?? 0) + gap / 2).toBeCloseTo(staff.top + gap * 2);
    expect((box?.box.x ?? 0) + (box?.box.width ?? 0) / 2).toBeCloseTo(rect.x + rect.width / 2);
    expect(box?.box.width).toBeGreaterThanOrEqual(gap * 1.6 - 1e-9);
    expect(box?.muted).toBe(false);
  });

  it('draws a column over a standard staff', () => {
    const standard = lay(score, 'standard');
    const staff = standard.systems[0]?.staves.find((s) => s.track === guitar);
    const [box] = caretBoxes(standard, score, cursor(0, 0, 1, 3, 'standard'));
    expect(box?.box.y).toBeCloseTo(staff?.top ?? 0);
    expect(box?.box.height).toBeCloseTo((staff?.bottom ?? 0) - (staff?.top ?? 0));
  });

  it('draws the cursor strong on the one staff there is, whichever staff it says', () => {
    const standard = lay(score, 'standard');
    expect(caretBoxes(standard, score, cursor(0, 0, 1, 3, 'tab')).map((b) => b.muted)).toEqual([
      false,
    ]);
    expect(caretBoxes(tab, score, cursor(0, 0, 1, 3, 'standard')).map((b) => b.muted)).toEqual([
      false,
    ]);
    const drums = cursorAtPosition(
      score,
      { track: 1, bar: 0, voice: 0, stop: 1 },
      { string: 1, staff: 'tab' },
    );
    if (!drums) throw new Error('no stop');
    expect(caretBoxes(tab, score, drums).map((b) => b.muted)).toEqual([false]);
  });

  it('starts a cursor on the staff the notation shows first', () => {
    expect(defaultStaff(score, 0, 'standard')).toBe('standard');
    expect(defaultStaff(score, 0, 'tab')).toBe('tab');
    expect(defaultStaff(score, 0, 'both')).toBe('tab');
    expect(defaultStaff(score, 1, 'tab')).toBe('percussion');
    for (const notation of ['tab', 'standard', 'both'] as const) {
      const laid = lay(score, notation);
      const boxes = caretBoxes(laid, score, cursor(0, 0, 1, 3, defaultStaff(score, 0, notation)));
      expect(boxes.filter((b) => !b.muted)).toHaveLength(1);
    }
  });

  it('draws both staves in both notation, the cursor staff strong and the other muted', () => {
    const both = lay(score, 'both');
    const boxes = caretBoxes(both, score, cursor(0, 0, 1, 3, 'tab'));
    expect(boxes).toHaveLength(2);
    expect(boxes.map((b) => b.muted).sort()).toEqual([false, true]);
    const standard = caretBoxes(both, score, cursor(0, 0, 1, 3, 'standard'));
    expect(standard.filter((b) => b.muted)).toHaveLength(1);
    expect(standard.map((b) => b.muted)).not.toEqual(boxes.map((b) => b.muted));
  });

  it('puts the end slot where the playhead puts the voice end', () => {
    const end = cursor(0, 1, 2, 2, 'tab');
    expect(end.beat).toBeUndefined();
    const ticks = (score.tracks[0]?.bars[1]?.voices[0]?.beats ?? []).reduce(
      (n, b) => n + beatTicks(b),
      0,
    );
    const head = playheadAt(tab, score, end.masterBar, ticks, guitar);
    const [box] = caretBoxes(tab, score, end);
    expect((box?.box.x ?? 0) + (box?.box.width ?? 0) / 2).toBeCloseTo(head?.x ?? -1);
  });

  it('puts the cursor in an empty bar one staff space from the column edge', () => {
    const empty = cursor(0, 2, 0, 1, 'tab');
    const column = tab.anchors.find(
      (a) => a.kind === 'bar' && a.track === undefined && a.masterBar === empty.masterBar,
    );
    const [box] = caretBoxes(tab, score, empty);
    if (!column || !box) throw new Error('missing');
    const centre = box.box.x + box.box.width / 2;
    expect(centre).toBeGreaterThan(anchorBox(tab, column).x);
    expect(centre).toBeLessThan(anchorBox(tab, column).x + anchorBox(tab, column).width);
  });

  it('has no box for a cursor on nothing, and a rect that is their union', () => {
    expect(caretBoxes(tab, score, { ...cursor(0, 0, 0, 1, 'tab'), track: 'nobody' })).toEqual([]);
    const boxes = caretBoxes(lay(score, 'both'), score, cursor(0, 0, 1, 3, 'tab'));
    const rect = caretRect(boxes);
    for (const { box } of boxes) {
      expect(rect?.x).toBeLessThanOrEqual(box.x);
      expect((rect?.y ?? 0) + (rect?.height ?? 0)).toBeGreaterThanOrEqual(box.y + box.height);
    }
    expect(caretRect([])).toBeUndefined();
  });
});

describe('rangeBoxes', () => {
  const tab = lay(score, 'tab');
  const range = (
    kind: EditRange['kind'],
    from: number,
    to: number,
    tracks: [number, number] = [0, 0],
  ): EditRange => {
    const end = (track: number, beat: number) => ({
      track: score.tracks[track]?.id ?? '',
      masterBar: score.masterBars[0]?.id ?? '',
      beat: kind === 'bars' ? undefined : beatOf(score, track, 0, beat).id,
    });
    return { kind, anchor: end(tracks[0], from), focus: end(tracks[1], to) };
  };

  it('spans from the first beat left edge to the last beat right edge', () => {
    const [box] = rangeBoxes(tab, score, range('beats', 1, 2));
    const a = tab.anchors.find((x) => x.kind === 'beat' && x.id === beatOf(score, 0, 0, 1).id);
    const b = tab.anchors.find((x) => x.kind === 'beat' && x.id === beatOf(score, 0, 0, 2).id);
    if (!a || !b || !box) throw new Error('missing');
    expect(box.box.x).toBeCloseTo(anchorBox(tab, a).x);
    expect(box.box.x + box.box.width).toBeCloseTo(anchorBox(tab, b).x + anchorBox(tab, b).width);
  });

  it('covers the tracks it crosses in one box', () => {
    const one = rangeBoxes(tab, score, range('beats', 0, 1))[0];
    const both = rangeBoxes(tab, score, range('beats', 0, 1, [0, 1]))[0];
    expect(both?.box.height).toBeGreaterThan(one?.box.height ?? 0);
  });

  it('takes whole columns for a bars range', () => {
    const [box] = rangeBoxes(tab, score, range('bars', 0, 0));
    const column = tab.anchors.find(
      (a) => a.kind === 'bar' && a.track === undefined && a.masterBar === score.masterBars[0]?.id,
    );
    if (!column || !box) throw new Error('missing');
    expect(box.box.x).toBeCloseTo(anchorBox(tab, column).x);
    expect(box.box.width).toBeCloseTo(anchorBox(tab, column).width);
  });

  it('makes a box per system part and draws nothing for a score it does not hold', () => {
    const long = largeScore(1, 40);
    const laid = lay(long, 'tab');
    const ends = (bar: number, beat: number) => ({
      track: long.tracks[0]?.id ?? '',
      masterBar: long.masterBars[bar]?.id ?? '',
      beat: beatOf(long, 0, bar, beat).id,
    });
    const spanning: EditRange = { kind: 'beats', anchor: ends(1, 2), focus: ends(30, 3) };
    const boxes = rangeBoxes(laid, long, spanning);
    expect(new Set(boxes.map((b) => b.system)).size).toBe(boxes.length);
    expect(boxes.length).toBeGreaterThan(2);
    const last = boxes.at(-1);
    const system = laid.systems[last?.system ?? 0];
    expect(last?.box.x ?? 0).toBeLessThanOrEqual((system?.bbox.x ?? 0) + (system?.bbox.width ?? 0));
    expect(rangeBoxes(laid, score, spanning)).toEqual([]);
  });
});
