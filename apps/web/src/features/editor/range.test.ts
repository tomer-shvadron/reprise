import {
  createHistory,
  insertBeat,
  removeBar,
  removeBeat,
  removeTrack,
  type Score,
} from '@reprise/model';
import { beatOf } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import type { EditCursor, EditRange } from '@/state/selection';

import { cursorAtPosition, firstStop, reconcile } from './cursor';
import { move } from './navigation';
import {
  barRangeOf,
  editTarget,
  endOf,
  extendRange,
  extendRangeTo,
  rangeBars,
  rangeBeats,
  rangePatch,
  rangeSpan,
} from './range';
import { editScore } from './test/scores';

const score = editScore();
const [guitar, drums] = score.tracks.map(({ id }) => id);
const visible = [guitar ?? '', drums ?? ''];
const bar = (i: number) => score.masterBars[i]?.id ?? '';
const beatId = (track: number, b: number, beat: number, voice = 0) =>
  beatOf(score, track, b, beat, voice).id;

function range(
  a: { track: number; bar: number; beat?: number },
  f: { track: number; bar: number; beat?: number },
  kind: EditRange['kind'] = 'beats',
): EditRange {
  const end = (e: { track: number; bar: number; beat?: number }) => ({
    track: score.tracks[e.track]?.id ?? '',
    masterBar: bar(e.bar),
    beat: e.beat === undefined ? undefined : beatId(e.track, e.bar, e.beat),
  });
  return { kind, anchor: end(a), focus: end(f) };
}

describe('rangeSpan and rangeBeats', () => {
  it('orders the span when the focus is before the anchor', () => {
    const forward = rangeSpan(
      score,
      range({ track: 0, bar: 0, beat: 1 }, { track: 0, bar: 1, beat: 0 }),
    );
    const backward = rangeSpan(
      score,
      range({ track: 0, bar: 1, beat: 0 }, { track: 0, bar: 0, beat: 1 }),
    );
    expect(backward).toEqual(forward);
    expect(forward?.start).toEqual({ bar: 0, tick: 960 });
    expect(forward?.end).toEqual({ bar: 1, tick: 960 });
  });

  it('covers every voice of the beats in the span', () => {
    const parts = rangeBeats(
      score,
      range({ track: 0, bar: 1, beat: 0 }, { track: 0, bar: 1, beat: 1 }),
    );
    expect(parts.map((p) => [p.bar, p.voice, p.beats.length])).toEqual([
      [1, 0, 2],
      [1, 1, 1],
    ]);
  });

  it('takes the beats that start in the span across tracks, and skips hidden ones', () => {
    const r = range({ track: 0, bar: 0, beat: 1 }, { track: 1, bar: 0, beat: 2 });
    const all = rangeBeats(score, r, visible);
    expect(all.map((p) => [p.track === guitar ? 'g' : 'd', p.beats.length])).toEqual([
      ['g', 2],
      ['d', 2],
    ]);
    expect(rangeBeats(score, r, [guitar ?? '']).map((p) => p.track)).toEqual([guitar]);
  });

  it('takes a whole bar for an end without a beat', () => {
    const r = range({ track: 0, bar: 0 }, { track: 0, bar: 1 }, 'bars');
    expect(rangeBeats(score, r).map((p) => [p.bar, p.voice, p.beats.length])).toEqual([
      [0, 0, 4],
      [1, 0, 2],
      [1, 1, 1],
    ]);
    expect(rangeBars(score, r)).toEqual([bar(0), bar(1)]);
    expect(barRangeOf(score, r)).toEqual({ startBar: bar(0), endBar: bar(1) });
  });

  it('is undefined for ends the score does not hold', () => {
    const r = range({ track: 0, bar: 0 }, { track: 0, bar: 0 });
    expect(
      rangeSpan(score, { ...r, focus: { track: 'x', masterBar: bar(0), beat: undefined } }),
    ).toBeUndefined();
    expect(
      rangeBars(score, { ...r, anchor: { track: guitar ?? '', masterBar: 'x', beat: undefined } }),
    ).toEqual([]);
  });

  it('mirrors itself into bars and the anchor for the transport', () => {
    const r = range({ track: 0, bar: 1, beat: 0 }, { track: 0, bar: 0, beat: 1 });
    expect(rangePatch(score, r)).toEqual({
      range: r,
      bars: { startBar: bar(0), endBar: bar(1) },
      barsAnchor: bar(1),
    });
    expect(rangePatch(score, undefined)).toEqual({
      range: undefined,
      bars: undefined,
      barsAnchor: undefined,
    });
  });
});

describe('extendRange', () => {
  const cursor = firstStop(score, 0, 0) as EditCursor;
  const state = (c: EditCursor | undefined, r?: EditRange) => ({ cursor: c, range: r });

  it('extends by a stop from the cursor, and keeps extending from the same anchor', () => {
    const first = extendRange(score, state(cursor), 'next', visible);
    expect(first?.range).toEqual(
      range({ track: 0, bar: 0, beat: 0 }, { track: 0, bar: 0, beat: 1 }),
    );
    const second = first && extendRange(score, state(first.cursor, first.range), 'next', visible);
    expect(second?.range.anchor.beat).toBe(beatId(0, 0, 0));
    expect(second?.range.focus.beat).toBe(beatId(0, 0, 2));
    expect(second?.cursor.beat).toBe(beatId(0, 0, 2));
  });

  it('extends across tracks, and by bars', () => {
    const tracks = extendRange(score, state(cursor), 'nextTrack', visible);
    expect(tracks?.range.focus.track).toBe(drums);
    const bars = extendRange(score, state(cursor), 'nextBar', visible);
    expect(bars?.range).toMatchObject({
      kind: 'bars',
      anchor: { beat: undefined },
      focus: { masterBar: bar(1), beat: undefined },
    });
  });

  it('does nothing where the cursor cannot move, or without one', () => {
    expect(extendRange(score, state(cursor), 'previous', visible)).toBeUndefined();
    expect(extendRange(score, state(undefined), 'next', visible)).toBeUndefined();
  });

  it('extends to a clicked end', () => {
    const end = { track: guitar ?? '', masterBar: bar(1), beat: beatId(0, 1, 1) };
    expect(extendRangeTo(state(cursor), end)).toEqual({
      kind: 'beats',
      anchor: endOf(cursor),
      focus: end,
    });
    expect(extendRangeTo(state(undefined), end)).toBeUndefined();
    expect(extendRangeTo(state(cursor), end, 'bars')?.focus.beat).toBeUndefined();
  });
});

describe('editTarget', () => {
  const cursor = move(score, firstStop(score, 0, 1) as EditCursor, 'next') as EditCursor;

  it('prefers the range, then picked notes, then the note on the string, then the beat', () => {
    const r = range({ track: 0, bar: 0, beat: 0 }, { track: 0, bar: 0, beat: 1 });
    expect(editTarget(score, { cursor, range: r, selection: { noteIds: ['x'] } })).toEqual({
      beatIds: [beatId(0, 0, 0), beatId(0, 0, 1)],
    });
    expect(editTarget(score, { cursor, range: undefined, selection: { noteIds: ['x'] } })).toEqual({
      noteIds: ['x'],
    });
    const onNote = { ...cursor, string: 4 };
    expect(editTarget(score, { cursor: onNote, range: undefined, selection: {} })).toEqual({
      noteIds: [beatOf(score, 0, 1, 1).notes[0]?.id],
    });
    expect(
      editTarget(score, { cursor: { ...cursor, string: 3 }, range: undefined, selection: {} }),
    ).toEqual({
      beatIds: [beatId(0, 1, 1)],
    });
    expect(editTarget(score, { cursor: undefined, range: undefined, selection: {} })).toEqual({});
  });
});

describe('reconcile', () => {
  const base = { range: undefined, selection: {} } as const;
  const cursorOn = (s: Score, track: number, b: number, stop: number): EditCursor => {
    const c = cursorAtPosition(s, { track, bar: b, voice: 0, stop }, { string: 2, staff: 'tab' });
    if (!c) throw new Error('no stop');
    return c;
  };

  it('changes nothing for a score that holds everything', () => {
    expect(
      reconcile(score, { ...base, cursor: cursorOn(score, 0, 0, 1), currentTrack: guitar }),
    ).toBeUndefined();
  });

  it('moves to the neighbour when its beat is removed, and back when the removal is undone', () => {
    const history = createHistory();
    const cursor = cursorOn(score, 0, 0, 1);
    const removed = history.apply(score, removeBeat({ beatId: cursor.beat ?? '' }));
    const patch = reconcile(removed.score, { ...base, cursor, currentTrack: guitar });
    expect(patch?.cursor).toMatchObject({
      beat: beatOf(removed.score, 0, 0, 1).id,
      at: { beat: 1 },
    });
    const undone = history.undo();
    const restored = reconcile(undone?.score ?? score, {
      ...base,
      cursor: cursor,
      currentTrack: guitar,
    });
    expect(restored).toBeUndefined();
  });

  it('keeps an end-slot cursor after the voice gains a beat before it', () => {
    const history = createHistory();
    const end = cursorOn(score, 0, 1, 2);
    expect(end.beat).toBeUndefined();
    const grown = history.apply(
      score,
      insertBeat(
        { voiceId: score.tracks[0]?.bars[1]?.voices[0]?.id ?? '', index: 0 },
        { duration: 8, rest: true },
      ),
    );
    const patch = reconcile(grown.score, { ...base, cursor: end, currentTrack: guitar });
    expect(patch?.cursor).toMatchObject({ beat: undefined, at: { beat: 3 } });
  });

  it('clamps to the bar at its old index when the bar is removed', () => {
    const history = createHistory();
    const cursor = cursorOn(score, 0, 2, 0);
    const shorter = history.apply(score, removeBar({ masterBarId: bar(2) })).score;
    expect(reconcile(shorter, { ...base, cursor, currentTrack: guitar })?.cursor).toMatchObject({
      masterBar: bar(1),
      at: { bar: 1, beat: 0 },
    });
  });

  it('follows the current track when the cursor track is removed', () => {
    const history = createHistory();
    const cursor = cursorOn(score, 1, 0, 0);
    const one = history.apply(score, removeTrack({ trackId: drums ?? '' })).score;
    const patch = reconcile(one, { ...base, cursor, currentTrack: guitar });
    expect(patch?.cursor).toMatchObject({ track: guitar });
  });

  it('clamps the string when the track loses strings', () => {
    const fewer: Score = {
      ...score,
      tracks: score.tracks.map((t, i) => (i === 0 ? { ...t, tuning: t.tuning.slice(0, 4) } : t)),
    };
    const cursor = { ...cursorOn(score, 0, 0, 0), string: 6 };
    expect(reconcile(fewer, { ...base, cursor, currentTrack: guitar })?.cursor?.string).toBe(4);
  });

  it('widens a range end whose beat is gone, and clears a range whose bar is gone', () => {
    const history = createHistory();
    const r = range({ track: 0, bar: 0, beat: 1 }, { track: 0, bar: 1, beat: 0 });
    const removed = history.apply(score, removeBeat({ beatId: beatId(0, 0, 1) })).score;
    const widened = reconcile(removed, {
      ...base,
      cursor: undefined,
      range: r,
      currentTrack: guitar,
    });
    expect(widened?.range?.anchor).toEqual({ track: guitar, masterBar: bar(0), beat: undefined });
    expect(widened?.range?.focus).toEqual(r.focus);
    const noBar = history.apply(removed, removeBar({ masterBarId: bar(1) })).score;
    expect(
      reconcile(noBar, { ...base, cursor: undefined, range: r, currentTrack: guitar }),
    ).toMatchObject({
      range: undefined,
      bars: undefined,
      barsAnchor: undefined,
    });
  });

  it('drops picked ids the score no longer has', () => {
    const live = beatOf(score, 0, 0, 0).notes[0]?.id ?? '';
    const patch = reconcile(score, {
      ...base,
      cursor: undefined,
      selection: { noteIds: [live, 'gone'], beatIds: ['gone'] },
      currentTrack: guitar,
    });
    expect(patch?.selection).toEqual({ noteIds: [live] });
  });
});
