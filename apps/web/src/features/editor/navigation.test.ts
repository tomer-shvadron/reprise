import { layout, PAGE_SIZES, type LayoutOptions } from '@reprise/layout';
import { beatTicks, barTicks } from '@reprise/model';
import { beatOf, largeScore, score as scoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import type { EditCursor } from '@/state/selection';

import { cursorAtTick, firstStop, stopCount } from './cursor';
import { move, moveString, movePage, moveTrack } from './navigation';
import { editScore } from './test/scores';

const score = editScore();

function at(track: number, bar: number, stop: number, voice = 0): EditCursor {
  const cursor = firstStop(score, track, bar, voice);
  if (!cursor) throw new Error('no stop');
  let current = cursor;
  for (let i = 0; i < stop; i++) {
    const next = move(score, current, 'next');
    if (!next) throw new Error('no next');
    current = next;
  }
  return current;
}

const place = (cursor: EditCursor | undefined) =>
  cursor && ([cursor.at.track, cursor.at.bar, cursor.voice, cursor.at.beat] as const);

describe('stops', () => {
  it('counts beats plus one end slot unless the bar is full', () => {
    expect(stopCount(score, 0, 0, 0)).toBe(4);
    expect(stopCount(score, 0, 1, 0)).toBe(3);
    expect(stopCount(score, 0, 1, 1)).toBe(2);
    expect(stopCount(score, 0, 2, 0)).toBe(1);
    expect(stopCount(score, 0, 1, 3)).toBe(1);
  });

  it('puts an empty voice on its end slot', () => {
    const cursor = firstStop(score, 0, 2);
    expect(cursor).toMatchObject({ beat: undefined, at: { beat: 0 } });
  });
});

describe('move', () => {
  it('walks every stop across bars and back', () => {
    const forward: (readonly [number, number, number, number] | undefined)[] = [];
    let cursor: EditCursor | undefined = firstStop(score, 0, 0);
    while (cursor) {
      forward.push(place(cursor));
      cursor = move(score, cursor, 'next');
    }
    expect(forward).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 1],
      [0, 0, 0, 2],
      [0, 0, 0, 3],
      [0, 1, 0, 0],
      [0, 1, 0, 1],
      [0, 1, 0, 2],
      [0, 2, 0, 0],
    ]);
    const back: unknown[] = [];
    let current: EditCursor | undefined = at(0, 2, 0);
    while (current) {
      back.push(place(current));
      current = move(score, current, 'previous');
    }
    expect(back).toEqual([...forward].reverse());
  });

  it('goes to the start and end of a bar, bars and the score', () => {
    const middle = at(0, 1, 1);
    expect(place(move(score, middle, 'barStart'))).toEqual([0, 1, 0, 0]);
    expect(place(move(score, middle, 'barEnd'))).toEqual([0, 1, 0, 2]);
    expect(place(move(score, middle, 'previousBar'))).toEqual([0, 0, 0, 0]);
    expect(place(move(score, middle, 'nextBar'))).toEqual([0, 2, 0, 0]);
    expect(place(move(score, middle, 'scoreStart'))).toEqual([0, 0, 0, 0]);
    expect(place(move(score, middle, 'scoreEnd'))).toEqual([0, 2, 0, 0]);
    const first = at(0, 0, 0);
    expect(move(score, first, 'previous')).toBeUndefined();
    expect(move(score, first, 'barStart')).toBeUndefined();
    expect(move(score, first, 'scoreStart')).toBeUndefined();
  });

  it('stays in its voice', () => {
    const second = at(0, 1, 0, 1);
    expect(place(move(score, second, 'next'))).toEqual([0, 1, 1, 1]);
    expect(place(move(score, second, 'previous'))).toEqual([0, 0, 1, 0]);
  });

  it('visits exactly the beats of the long score, plus one end slot per bar that has room', () => {
    const long = largeScore(8, 300, { structure: true });
    long.tracks.forEach((track, t) => {
      const expected: (string | undefined)[] = [];
      track.bars.forEach((bar, b) => {
        const beats = bar.voices[0].beats;
        for (const beat of beats) expected.push(beat.id);
        const masterBar = long.masterBars[b];
        const total = beats.reduce((sum, beat) => sum + beatTicks(beat), 0);
        if (masterBar && total < barTicks(masterBar) - 1e-6) expected.push(undefined);
      });
      const seen: (string | undefined)[] = [];
      let cursor: EditCursor | undefined = firstStop(long, t, 0);
      let last: EditCursor | undefined = cursor;
      while (cursor) {
        seen.push(cursor.beat);
        last = cursor;
        cursor = move(long, cursor, 'next');
      }
      expect(seen).toEqual(expected);
      let back = 0;
      let current: EditCursor | undefined = last;
      while (current) {
        back++;
        current = move(long, current, 'previous');
      }
      expect(back).toBe(expected.length);
    });
  }, 60_000);
});

describe('moveString', () => {
  it('moves up and down, clamped to the strings', () => {
    const cursor = { ...at(0, 0, 0), string: 1 };
    expect(moveString(score, cursor, -1)).toBeUndefined();
    expect(moveString(score, cursor, 1)?.string).toBe(2);
    expect(moveString(score, { ...cursor, string: 6 }, 1)).toBeUndefined();
  });

  it('steps the lane a line or space on a pitched track, from the middle line by default', () => {
    const keys = scoreBuilder().track('piano').bar().build();
    const cursor = firstStop(keys, 0, 0);
    if (!cursor) throw new Error('no stop');
    expect(cursor.pitch).toBe(71);
    expect(moveString(keys, cursor, -1)?.pitch).toBe(72);
    expect(moveString(keys, cursor, 1)?.pitch).toBe(69);
  });

  it('does nothing on a fretted track with no strings', () => {
    const keys = scoreBuilder().track('guitar').bar().build();
    const track = keys.tracks[0];
    if (!track) throw new Error('no track');
    track.tuning = [];
    const cursor = firstStop(keys, 0, 0);
    if (!cursor) throw new Error('no stop');
    expect(moveString(keys, cursor, 1)).toBeUndefined();
  });

  it('steps the lane up and down the kit on a drum track, from the snare by default', () => {
    const cursor = at(1, 0, 0);
    expect(cursor.pitch).toBeUndefined();
    const up = moveString(score, cursor, -1);
    expect(up).toMatchObject({ pitch: 48, string: 0 });
    expect(moveString(score, { ...cursor, pitch: 36 }, 1)?.pitch).toBe(41);
    expect(moveString(score, { ...cursor, pitch: 44 }, 1)).toBeUndefined();
  });

  it('knows a seven-string track has one more', () => {
    const seven = {
      ...score,
      tracks: score.tracks.map((t, i) => (i === 0 ? { ...t, tuning: [...t.tuning, 30] } : t)),
    };
    const cursor = { ...at(0, 0, 0), string: 6 };
    expect(moveString(seven, cursor, 1)?.string).toBe(7);
  });
});

describe('moveTrack', () => {
  const visible = score.tracks.map(({ id }) => id);

  it('keeps the bar and onset on the new track', () => {
    const cursor = at(0, 0, 2);
    const next = moveTrack(score, cursor, visible, 1);
    expect(place(next)).toEqual([1, 0, 0, 2]);
    expect(next?.staff).toBe('percussion');
    expect(place(moveTrack(score, next ?? cursor, visible, -1))).toEqual([0, 0, 0, 2]);
  });

  it('drops the drum lane when the cursor changes track', () => {
    const cursor = { ...at(1, 0, 1), pitch: 42 };
    expect(moveTrack(score, cursor, visible, -1)?.pitch).toBeUndefined();
    expect(moveTrack(score, { ...at(0, 0, 1), pitch: 42 }, visible, 1)?.pitch).toBeUndefined();
  });

  it('goes to the end slot when the other track is shorter there', () => {
    const cursor = at(0, 1, 2);
    expect(cursorAtTick(score, 1, 1, 2000, 0)?.beat).toBeUndefined();
    expect(place(moveTrack(score, cursor, visible, 1))).toEqual([1, 1, 0, 2]);
  });

  it('stops at the ends, and skips hidden tracks', () => {
    expect(moveTrack(score, at(0, 0, 0), visible, -1)).toBeUndefined();
    expect(moveTrack(score, at(0, 0, 0), [visible[0] ?? ''], 1)).toBeUndefined();
  });
});

describe('movePage', () => {
  const options: LayoutOptions = {
    mode: 'paged',
    width: PAGE_SIZES.a4.width,
    zoom: 1,
    tracks: 'all',
    notation: {},
  };
  const long = largeScore(1, 40);
  const laid = layout(long, options);

  it('goes to the first bar of the next and previous system, and stops at the ends', () => {
    const [first, second, third] = laid.systems;
    if (!first || !second || !third) throw new Error('needs three systems');
    const start = firstStop(long, 0, first.bars.start);
    if (!start) throw new Error('no start');
    const next = movePage(long, start, laid, 1);
    expect(next?.at.bar).toBe(second.bars.start);
    const further = next && movePage(long, next, laid, 1);
    expect(further?.at.bar).toBe(third.bars.start);
    expect(further && movePage(long, further, laid, -1)?.at.bar).toBe(second.bars.start);
    expect(movePage(long, start, laid, -1)).toBeUndefined();
    const lastSystem = laid.systems.at(-1);
    const end = lastSystem && firstStop(long, 0, lastSystem.bars.start);
    expect(end && movePage(long, end, laid, 1)).toBeUndefined();
  });

  it('keeps voice and string', () => {
    const start = firstStop(long, 0, 0, 0, { string: 4, staff: 'tab' });
    expect(start && movePage(long, start, laid, 1)).toMatchObject({
      voice: 0,
      string: 4,
      staff: 'tab',
    });
    expect(beatOf(long, 0, 0, 0).id).toBe(start?.beat);
  });
});
