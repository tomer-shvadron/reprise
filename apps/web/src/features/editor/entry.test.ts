import { applyCommand, createHistory, type Beat, type Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import type { EditCursor } from '@/state/selection';

import { cursorAtPosition } from './cursor';
import {
  planAppendBar,
  planEntry,
  type EntryAction,
  type EntryInput,
  type EntryPlan,
} from './entry';
import { historyLabel } from './history-labels';
import { QUARTER, type Rhythm } from './rhythm';
import { drumScore } from './test/drum-scores';
import { entryScore, fullBarScore, mixedScore } from './test/entry-scores';
import { keysScore } from './test/key-scores';

const EIGHTH: Rhythm = { duration: 8, dots: 0, tuplet: undefined };

function cursorAt(score: Score, bar: number, stop: number, string = 1, voice = 0): EditCursor {
  const cursor = cursorAtPosition(score, { track: 0, bar, voice, stop }, { string, staff: 'tab' });
  if (!cursor) throw new Error('no such stop');
  return cursor;
}

function plan(
  score: Score,
  cursor: EditCursor,
  action: EntryAction,
  over: Partial<EntryInput> = {},
): EntryPlan {
  return planEntry(
    {
      score,
      cursor,
      rhythm: QUARTER,
      mode: 'overwrite',
      inserted: undefined,
      state: { range: undefined, selection: {} },
      ...over,
    },
    action,
  );
}

/** Applies a plan's command to the score, failing the test on a plan that has none. */
function after(score: Score, planned: EntryPlan): Score {
  if (!('command' in planned)) throw new Error(`no command: ${JSON.stringify(planned)}`);
  return applyCommand(score, planned.command).score;
}

const beatsOf = (score: Score, bar: number, voice = 0): Beat[] =>
  score.tracks[0]?.bars[bar]?.voices[voice]?.beats ?? [];

const frets = (beat: Beat | undefined) => beat?.notes.map((n) => [n.string, n.fret]);

describe('a fret typed on a banjo drone string', () => {
  const banjoScore = (): Score => {
    const built = score().track('banjo');
    built.bar().beat('4', [note(5, 0)]);
    return built.build({ ids: 'sequential' });
  };

  it('stores the neck fret from the string nut: 7 is stored as 2, 0 stays open', () => {
    const banjo = banjoScore();
    const seven = plan(banjo, cursorAt(banjo, 0, 1, 5), { kind: 'fret', fret: 7 });
    expect(frets(beatsOf(after(banjo, seven), 0)[1])).toEqual([[5, 2]]);
    if (!('command' in seven)) throw new Error('refused');
    expect(seven.sound).toMatchObject({ string: 5, fret: 2 });
    const open = plan(banjo, cursorAt(banjo, 0, 1, 5), { kind: 'fret', fret: 0 });
    expect(frets(beatsOf(after(banjo, open), 0)[1])).toEqual([[5, 0]]);
  });

  it('refuses frets 1 to 5 with the reason, and leaves other strings alone', () => {
    const banjo = banjoScore();
    const refused = plan(banjo, cursorAt(banjo, 0, 1, 5), { kind: 'fret', fret: 3 });
    expect(refused).toMatchObject({ refused: expect.stringContaining('0, or 6 and up') as string });
    const other = plan(banjo, cursorAt(banjo, 0, 1, 1), { kind: 'fret', fret: 3 });
    expect(frets(beatsOf(after(banjo, other), 0)[1])).toEqual([[1, 3]]);
  });
});

describe('a fret digit', () => {
  it('at the end slot makes a beat of the current rhythm holding the note, and lands on it', () => {
    const score = entryScore();
    const planned = plan(
      score,
      cursorAt(score, 0, 0),
      { kind: 'fret', fret: 7 },
      { rhythm: EIGHTH },
    );
    const next = after(score, planned);
    expect(beatsOf(next, 0)).toHaveLength(1);
    expect(beatsOf(next, 0)[0]).toMatchObject({ duration: 8, rest: false });
    expect(frets(beatsOf(next, 0)[0])).toEqual([[1, 7]]);
    if (!('command' in planned)) throw new Error('refused');
    expect(planned.land).toEqual({ beat: beatsOf(next, 0)[0]?.id });
    expect(planned.sound).toEqual({
      track: score.tracks[0]?.id,
      beat: beatsOf(next, 0)[0]?.id,
      string: 1,
      fret: 7,
    });
  });

  it('on a beat replaces the fret on that string, or adds a chord note on another', () => {
    const score = entryScore();
    const replaced = after(score, plan(score, cursorAt(score, 2, 0), { kind: 'fret', fret: 9 }));
    expect(frets(beatsOf(replaced, 2)[0])).toEqual([[1, 9]]);
    const chord = after(score, plan(score, cursorAt(score, 2, 0, 3), { kind: 'fret', fret: 4 }));
    expect(frets(beatsOf(chord, 2)[0])).toEqual([
      [1, 5],
      [3, 4],
    ]);
    expect(beatsOf(chord, 2)).toHaveLength(4);
  });

  it('in insert mode inserts a beat before the cursor, then takes chord notes on that beat', () => {
    const score = entryScore();
    const barOne = cursorAt(score, 1, 0);
    // Bar 1 has an eighth left, so an eighth fits.
    const planned = plan(
      score,
      barOne,
      { kind: 'fret', fret: 2 },
      { mode: 'insert', rhythm: EIGHTH },
    );
    const next = after(score, planned);
    expect(beatsOf(next, 1)).toHaveLength(5);
    expect(frets(beatsOf(next, 1)[0])).toEqual([[1, 2]]);
    expect(frets(beatsOf(next, 1)[1])).toEqual([[1, 5]]);
    if (!('command' in planned) || !planned.inserted) throw new Error('not inserted');
    const inserted = beatsOf(next, 1)[0];
    expect(planned.inserted).toBe(inserted?.id);
    const again = plan(
      next,
      cursorAt(next, 1, 0, 3),
      { kind: 'fret', fret: 6 },
      { mode: 'insert', rhythm: EIGHTH, inserted: inserted?.id },
    );
    const chord = after(next, again);
    expect(beatsOf(chord, 1)).toHaveLength(5);
    expect(frets(beatsOf(chord, 1)[0])).toEqual([
      [1, 2],
      [3, 6],
    ]);
  });

  it('is refused with the room left when the beat does not fit', () => {
    const score = entryScore();
    const end = cursorAt(score, 1, 4);
    expect(plan(score, end, { kind: 'fret', fret: 3 })).toEqual({
      refused: 'Bar 2 has an eighth left: a quarter does not fit',
    });
    const insert = plan(
      score,
      cursorAt(score, 1, 0),
      { kind: 'fret', fret: 3 },
      { mode: 'insert' },
    );
    expect(insert).toEqual({ refused: 'Bar 2 has an eighth left: a quarter does not fit' });
  });

  it('is refused as a digit on a pitched track, which takes letters', () => {
    const built = score().track('piano');
    built.bar();
    const keys = built.build({ ids: 'sequential' });
    const cursor = cursorAtPosition(
      keys,
      { track: 0, bar: 0, voice: 0, stop: 0 },
      { string: 0, staff: 'standard' },
    );
    if (!cursor) throw new Error('no cursor');
    expect(plan(keys, cursor, { kind: 'fret', fret: 1 })).toEqual({
      refused: 'Type a note name, A to G',
    });
    expect(plan(keys, cursor, { kind: 'tie' })).toEqual({ refused: 'Nothing to tie to on B4' });
  });
});

describe('rests and inserted beats', () => {
  it('R on a played beat makes it a rest, and on a rest does nothing', () => {
    const score = entryScore();
    const next = after(score, plan(score, cursorAt(score, 2, 1), { kind: 'rest' }));
    expect(beatsOf(next, 2)[1]).toMatchObject({ rest: true, notes: [] });
    expect(plan(next, cursorAt(next, 2, 1), { kind: 'rest' })).toEqual({ nothing: true });
  });

  it('R at the end slot, or in insert mode, inserts a rest of the current rhythm', () => {
    const score = entryScore();
    const end = after(
      score,
      plan(score, cursorAt(score, 0, 0), { kind: 'rest' }, { rhythm: EIGHTH }),
    );
    expect(beatsOf(end, 0)[0]).toMatchObject({ rest: true, duration: 8 });
    const insert = after(
      score,
      plan(score, cursorAt(score, 1, 0), { kind: 'rest' }, { mode: 'insert', rhythm: EIGHTH }),
    );
    expect(beatsOf(insert, 1).map((b) => b.rest)).toEqual([true, false, false, false, false]);
  });

  it('Enter inserts a rest after the cursor beat, or at the end slot, and lands on it', () => {
    const score = entryScore();
    const planned = plan(score, cursorAt(score, 1, 0), { kind: 'insertAfter' }, { rhythm: EIGHTH });
    const next = after(score, planned);
    expect(beatsOf(next, 1).map((b) => b.rest)).toEqual([false, true, false, false, false]);
    if (!('command' in planned)) throw new Error('refused');
    expect(planned.land).toEqual({ beat: beatsOf(next, 1)[1]?.id });
    const end = after(
      score,
      plan(score, cursorAt(score, 1, 4), { kind: 'insertAfter' }, { rhythm: EIGHTH }),
    );
    expect(beatsOf(end, 1)).toHaveLength(5);
  });

  it('refuses an insertion into a full bar', () => {
    const score = entryScore();
    expect(plan(score, cursorAt(score, 2, 3), { kind: 'insertAfter' })).toEqual({
      refused: 'Bar 3 is full: a quarter does not fit',
    });
  });
});

describe('the duration keys', () => {
  it('change only the current rhythm at the end slot', () => {
    const score = entryScore();
    const end = cursorAt(score, 0, 0);
    expect(plan(score, end, { kind: 'shorter' })).toEqual({ rhythm: EIGHTH });
    expect(plan(score, end, { kind: 'dot' })).toEqual({ rhythm: { ...QUARTER, dots: 1 } });
    expect(plan(score, end, { kind: 'triplet' })).toEqual({
      rhythm: { ...QUARTER, tuplet: { n: 3, of: 2 } },
    });
    expect(plan(score, end, { kind: 'longer' }, { rhythm: { ...QUARTER, duration: 1 } })).toEqual({
      refused: 'Already the longest note',
    });
  });

  it('change the beat under the cursor', () => {
    const score = entryScore();
    const shorter = after(score, plan(score, cursorAt(score, 2, 0), { kind: 'shorter' }));
    expect(beatsOf(shorter, 2)[0]).toMatchObject({ duration: 8 });
    const dotted = after(score, plan(score, cursorAt(score, 1, 1), { kind: 'dot' }));
    expect(beatsOf(dotted, 1)[1]).toMatchObject({ duration: 4, dots: 1 });
    const double = after(score, plan(score, cursorAt(score, 1, 3), { kind: 'doubleDot' }));
    expect(beatsOf(double, 1)[3]?.dots).toBe(2);
  });

  it('toggle a triplet on and off', () => {
    const score = entryScore();
    const on = after(score, plan(score, cursorAt(score, 2, 0), { kind: 'triplet' }));
    expect(beatsOf(on, 2)[0]?.tuplet).toEqual({ n: 3, of: 2 });
    const off = after(on, plan(on, cursorAt(on, 2, 0), { kind: 'triplet' }));
    expect(beatsOf(off, 2)[0]?.tuplet).toBeUndefined();
  });

  it('refuse a lengthening that overfills the bar, with the room left', () => {
    const score = entryScore();
    expect(plan(score, cursorAt(score, 2, 0), { kind: 'longer' })).toEqual({
      refused: 'Bar 3 is full: a half does not fit',
    });
    expect(plan(score, cursorAt(score, 1, 0), { kind: 'longer' })).toEqual({
      refused: 'Bar 2 has an eighth left: a half does not fit',
    });
  });

  it('act on every beat picked', () => {
    const score = entryScore();
    const [a, b] = beatsOf(score, 2);
    if (!a || !b) throw new Error('missing');
    const planned = plan(
      score,
      cursorAt(score, 2, 0),
      { kind: 'shorter' },
      {
        state: { range: undefined, selection: { beatIds: [a.id, b.id] } },
      },
    );
    const next = after(score, planned);
    expect(beatsOf(next, 2).map((beat) => beat.duration)).toEqual([8, 8, 4, 4]);
  });

  it('over a range is one history step with one label, undone in one step', () => {
    const score = entryScore();
    const [a, b] = beatsOf(score, 2);
    if (!a || !b) throw new Error('missing');
    const planned = plan(
      score,
      cursorAt(score, 2, 0),
      { kind: 'shorter' },
      { state: { range: undefined, selection: { beatIds: [a.id, b.id] } } },
    );
    if (!('command' in planned)) throw new Error('no command');
    const history = createHistory();
    const applied = history.apply(score, planned.command);
    expect(history.steps).toHaveLength(1);
    expect(history.steps[0]?.patches.length).toBeGreaterThan(0);
    expect(history.undoLabel && historyLabel(history.undoLabel)).toBe('Change duration');
    expect(beatsOf(applied.score, 2).map((beat) => beat.duration)).toEqual([8, 8, 4, 4]);
    expect(history.undo()?.score).toEqual(score);
    expect(history.canUndo).toBe(false);
  });
});

describe('tie', () => {
  it('ties a note to the one before it, taking its fret, and toggles it off', () => {
    const score = entryScore();
    const tied = after(score, plan(score, cursorAt(score, 2, 1), { kind: 'tie' }));
    expect(beatsOf(tied, 2)[1]?.notes[0]).toMatchObject({ string: 1, fret: 5, tie: true });
    const untied = after(tied, plan(tied, cursorAt(tied, 2, 1), { kind: 'tie' }));
    expect(beatsOf(untied, 2)[1]?.notes[0]).toMatchObject({ fret: 5, tie: false });
  });

  it('adds a tied note on an empty string, copying the fret of its origin', () => {
    const score = entryScore();
    const next = after(score, plan(score, cursorAt(score, 2, 1, 2), { kind: 'tie' }));
    expect(beatsOf(next, 2)[1]?.notes.find((n) => n.string === 2)).toMatchObject({
      fret: 3,
      tie: true,
    });
  });

  it('is refused with nothing to tie to', () => {
    const score = entryScore();
    expect(plan(score, cursorAt(score, 0, 0), { kind: 'tie' })).toEqual({
      refused: 'Nothing to tie to on string 1',
    });
  });

  it('at the end slot inserts a tied beat copying the origin', () => {
    const score = entryScore();
    const next = after(
      score,
      plan(score, cursorAt(score, 1, 4), { kind: 'tie' }, { rhythm: EIGHTH }),
    );
    expect(beatsOf(next, 1)[4]?.notes[0]).toMatchObject({ string: 1, fret: 9, tie: true });
  });
});

describe('deleting', () => {
  it('deletes the note on the cursor string, and an emptied beat becomes a rest', () => {
    const score = entryScore();
    const next = after(score, plan(score, cursorAt(score, 2, 0), { kind: 'deleteNote' }));
    expect(beatsOf(next, 2)[0]).toMatchObject({ rest: true, notes: [] });
  });

  it('deletes the notes picked instead, and says when there is nothing to delete', () => {
    const score = entryScore();
    const picked = beatsOf(score, 2)[1]?.notes[0];
    if (!picked) throw new Error('missing');
    const next = after(
      score,
      plan(
        score,
        cursorAt(score, 2, 0),
        { kind: 'deleteNote' },
        {
          state: { range: undefined, selection: { noteIds: [picked.id] } },
        },
      ),
    );
    expect(beatsOf(next, 2)[1]?.rest).toBe(true);
    expect(beatsOf(next, 2)[0]?.rest).toBe(false);
    expect(plan(score, cursorAt(score, 2, 0, 5), { kind: 'deleteNote' })).toEqual({
      refused: 'No note on string 5 to delete',
    });
  });

  it('deletes the beat, and refuses at the end slot', () => {
    const score = entryScore();
    const next = after(score, plan(score, cursorAt(score, 2, 1), { kind: 'deleteBeat' }));
    expect(beatsOf(next, 2)).toHaveLength(3);
    expect(plan(score, cursorAt(score, 0, 0), { kind: 'deleteBeat' })).toEqual({
      refused: 'No beat here to delete',
    });
  });
});

describe('appending a bar', () => {
  it('plans one only at a beat that ends a full last bar', () => {
    const full = fullBarScore();
    const last = cursorAt(full, 0, 3);
    const planned = planAppendBar(full, last);
    if (!planned) throw new Error('no plan');
    const next = applyCommand(full, planned.command).score;
    expect(next.masterBars).toHaveLength(2);
    expect(planned.land).toEqual({ bar: next.masterBars[1]?.id });
    expect(planAppendBar(full, cursorAt(full, 0, 2))).toBeUndefined();
    const score = entryScore();
    expect(planAppendBar(score, cursorAt(score, 2, 3))).toBeDefined();
    expect(planAppendBar(score, cursorAt(score, 1, 1))).toBeUndefined();
    expect(planAppendBar(score, cursorAt(score, 1, 4))).toBeUndefined();
  });
});

describe('a toggle over a mixed pick in a full bar', () => {
  // The growing beat comes first in the pick: run in that order the model would refuse it, so
  // the plan puts the shrinking beat first.
  const pick = (score: Score, bar: number, first: number, second: number) => {
    const beats = beatsOf(score, bar);
    const ids = [beats[first]?.id, beats[second]?.id].filter(
      (id): id is string => id !== undefined,
    );
    return { range: undefined, selection: { beatIds: ids } };
  };

  // [kind, bar, the beat that grows (first in the pick), the beat that shrinks, what to read]
  it.each([
    ['dot', 0, 3, 0, (b: Beat[]) => [b[0]?.dots, b[3]?.dots], [0, 1]],
    ['doubleDot', 1, 3, 0, (b: Beat[]) => [b[0]?.dots, b[3]?.dots], [0, 2]],
    ['triplet', 2, 0, 3, (b: Beat[]) => [b[0]?.tuplet, b[3]?.tuplet?.n], [undefined, 3]],
  ] as const)('toggles %s on both beats', (kind, bar, grows, shrinks, read, expected) => {
    const score = mixedScore();
    const planned = plan(
      score,
      cursorAt(score, bar, 0),
      { kind },
      { state: pick(score, bar, grows, shrinks) },
    );
    const next = after(score, planned);
    expect(read(beatsOf(next, bar))).toEqual(expected);
  });

  it('is not refused when the net change fits, whatever the order', () => {
    const score = mixedScore();
    const planned = plan(
      score,
      cursorAt(score, 0, 0),
      { kind: 'dot' },
      {
        state: pick(score, 0, 3, 0),
      },
    );
    expect('command' in planned).toBe(true);
  });

  it('still refuses a mixed pick that grows the voice past the bar', () => {
    const score = mixedScore();
    const beats = beatsOf(score, 0);
    const planned = plan(
      score,
      cursorAt(score, 0, 0),
      { kind: 'dot' },
      {
        state: {
          range: undefined,
          selection: { beatIds: [beats[1]?.id ?? '', beats[2]?.id ?? ''] },
        },
      },
    );
    expect('refused' in planned).toBe(true);
  });

  it('shortens in a bar that is already over-full, which fixes it', () => {
    const score = fullBarScore();
    const track = score.tracks[0];
    const bar = track?.bars[0];
    const voice = bar?.voices[0];
    if (!track || !bar || !voice) throw new Error('missing');
    const extra = { ...voice.beats[3], id: 'extra000001', notes: [] } as Beat;
    const over: Score = {
      ...score,
      tracks: [
        {
          ...track,
          bars: [
            {
              ...bar,
              voices: [
                { ...voice, beats: [...voice.beats, extra] },
                ...bar.voices.slice(1),
              ] as typeof bar.voices,
            },
          ],
        },
      ],
    };
    const planned = plan(over, cursorAt(over, 0, 0), { kind: 'shorter' });
    expect('command' in planned).toBe(true);
    expect(plan(over, cursorAt(over, 0, 0), { kind: 'longer' })).toEqual({
      refused: 'Bar 1 is full: a half does not fit',
    });
  });
});

describe('drum entry', () => {
  const drums = drumScore();
  const at = (bar: number, stop: number, pitch?: number): EditCursor => {
    const cursor = cursorAtPosition(
      drums,
      { track: 0, bar, voice: 0, stop },
      { string: 0, staff: 'percussion', ...(pitch !== undefined && { pitch }) },
    );
    if (!cursor) throw new Error('no such stop');
    return cursor;
  };
  const hits = (beat: Beat | undefined) => beat?.notes.map((n) => [n.string, n.fret]);

  it('0 at the end slot makes a beat of the current rhythm holding the lane, the snare by default', () => {
    const planned = plan(drums, at(0, 0), { kind: 'lane' });
    const next = after(drums, planned);
    expect(hits(beatsOf(next, 0)[0])).toEqual([[0, 38]]);
    if (!('command' in planned)) throw new Error('refused');
    expect(planned.lane).toBe(38);
    expect(planned.sound).toMatchObject({ string: 0, fret: 38 });
  });

  it('0 on another lane places that drum', () => {
    const next = after(drums, plan(drums, at(0, 0, 42), { kind: 'lane' }));
    expect(hits(beatsOf(next, 0)[0])).toEqual([[0, 42]]);
  });

  it('in overwrite mode adds the hit to the beat, and a duplicate changes nothing', () => {
    const added = after(drums, plan(drums, at(1, 0, 49), { kind: 'lane' }));
    expect(hits(beatsOf(added, 1)[0])).toEqual([
      [0, 36],
      [0, 49],
    ]);
    const again = after(drums, plan(drums, at(1, 0, 36), { kind: 'lane' }));
    expect(hits(beatsOf(again, 1)[0])).toEqual([[0, 36]]);
    const planned = plan(drums, at(1, 0, 36), { kind: 'lane' });
    if (!('command' in planned)) throw new Error('refused');
    expect(planned.sound).toMatchObject({ fret: 36 });
  });

  it('in insert mode inserts a beat before, and a further hit joins the inserted beat as a chord', () => {
    const first = plan(drums, at(1, 1, 51), { kind: 'lane' }, { mode: 'insert' });
    const inserted = after(drums, first);
    expect(beatsOf(inserted, 1).map(hits)).toEqual([
      [[0, 36]],
      [[0, 51]],
      [
        [0, 38],
        [0, 42],
      ],
    ]);
    if (!('command' in first) || !first.inserted) throw new Error('no insert');
    const onInserted = cursorAtPosition(
      inserted,
      { track: 0, bar: 1, voice: 0, stop: 1 },
      { string: 0, staff: 'percussion', pitch: 49 },
    );
    if (!onInserted) throw new Error('no cursor');
    const second = plan(
      inserted,
      onInserted,
      { kind: 'lane' },
      { mode: 'insert', inserted: first.inserted },
    );
    expect(hits(beatsOf(after(inserted, second), 1)[1])).toEqual([
      [0, 51],
      [0, 49],
    ]);
  });

  it('takes a GM number as the key, and lands the lane on it', () => {
    const planned = plan(drums, at(0, 0), { kind: 'fret', fret: 42 });
    expect(hits(beatsOf(after(drums, planned), 0)[0])).toEqual([[0, 42]]);
    if (!('command' in planned)) throw new Error('refused');
    expect(planned.lane).toBe(42);
  });

  it.each([9, 26, 88])('refuses %i, which no drum sound sits on', (key) => {
    expect(plan(drums, at(0, 0), { kind: 'fret', fret: key })).toEqual({
      refused: `No drum sound on key ${String(key)}: drums are 27 to 87`,
    });
  });

  it('is refused as a lane hit on a fretted track', () => {
    const guitar = entryScore();
    expect(plan(guitar, cursorAt(guitar, 0, 0), { kind: 'lane' })).toEqual({
      refused: 'A note on the lane is placed on a drum or keyboard track only',
    });
  });

  it('deletes the hit in the lane, and names the drum when there is none', () => {
    const next = after(drums, plan(drums, at(1, 1, 42), { kind: 'deleteNote' }));
    expect(hits(beatsOf(next, 1)[1])).toEqual([[0, 38]]);
    expect(plan(drums, at(1, 1, 49), { kind: 'deleteNote' })).toEqual({
      refused: 'No Crash Cymbal 1 on this beat',
    });
  });

  it('ties the hit in the lane to the previous hit of the same key', () => {
    const built = score().track('drums');
    built.bar().beat('4', [note(0, 38)]);
    const tied = built.build({ ids: 'sequential' });
    const cursor = cursorAtPosition(
      tied,
      { track: 0, bar: 0, voice: 0, stop: 1 },
      { string: 0, staff: 'percussion', pitch: 38 },
    );
    if (!cursor) throw new Error('no cursor');
    const next = after(tied, plan(tied, cursor, { kind: 'tie' }));
    expect(beatsOf(next, 0)[1]?.notes[0]).toMatchObject({ string: 0, fret: 38, tie: true });
    expect(plan(tied, { ...cursor, pitch: 42 }, { kind: 'tie' })).toEqual({
      refused: 'Nothing to tie to on Closed Hi-Hat (42)',
    });
  });
});

describe('pitch entry on a keyboard track', () => {
  const keys = keysScore();
  const at = (bar: number, stop: number, pitch?: number, score: Score = keys): EditCursor => {
    const found = cursorAtPosition(
      score,
      { track: 0, bar, voice: 0, stop },
      { string: 0, staff: 'standard', ...(pitch !== undefined && { pitch }) },
    );
    if (!found) throw new Error('no such stop');
    return found;
  };
  const letter = (
    cursor: EditCursor,
    name: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G',
    over: Partial<EntryInput> = {},
    chord = false,
    score: Score = keys,
  ) => plan(score, cursor, { kind: 'pitch', letter: name, chord }, over);

  it('starts the cursor on the middle line, B4 in treble', () => {
    expect(at(0, 0).pitch).toBe(71);
  });

  it('enters a letter at the end slot near the clef middle line when nothing precedes it', () => {
    const planned = letter(at(0, 0), 'C');
    expect(frets(beatsOf(after(keys, planned), 0)[0])).toEqual([[0, 72]]);
    expect(planned).toMatchObject({ lane: 72, sound: { string: 0, fret: 72 } });
  });

  it('takes its octave from the note before the cursor, and the alteration from the key', () => {
    // After the chord E5/C5 the top note is E5; F in G major is F sharp 5.
    expect(frets(beatsOf(after(keys, letter(at(1, 2), 'F')), 1)[2])).toEqual([[0, 78]]);
    // Across the barline: the last beat of bar 2 (top note E5) leads bar 3's first note.
    expect(frets(beatsOf(after(keys, letter(at(2, 0), 'A')), 2)[0])).toEqual([[0, 81]]);
  });

  it('replaces the note in the lane in overwrite mode, keeping its effects but not its accidental', () => {
    const built = score().track('piano');
    built.bar().beat('4', [note(0, 67, { staccato: true, accidental: 'sharp' })]);
    const staccato = built.build({ ids: 'sequential' });
    const planned = letter(at(0, 0, 67, staccato), 'A', {}, false, staccato);
    const next = after(staccato, planned);
    const [beat] = beatsOf(next, 0);
    expect(beat?.notes).toHaveLength(1);
    expect(beat?.notes[0]).toMatchObject({ string: 0, fret: 69, staccato: true });
    expect(beat?.notes[0]?.accidental).toBeUndefined();
    expect(beat?.notes[0]?.id).toBe(beatsOf(staccato, 0)[0]?.notes[0]?.id);
    expect(planned).toMatchObject({ lane: 69 });
  });

  it('adds a note when the lane holds none', () => {
    const next = after(keys, letter(at(1, 0, 60), 'C'));
    expect(beatsOf(next, 1)[0]?.notes.map((n) => n.fret)).toEqual([67, 72]);
  });

  it('adds a chord note above the highest note of the beat with a shifted letter', () => {
    const chord = letter(at(1, 0, 67), 'B', {}, true);
    // The beat holds G4: B in G major is B natural, first above G4 is B4.
    expect(beatsOf(after(keys, chord), 1)[0]?.notes.map((n) => n.fret)).toEqual([67, 71]);
    const top = letter(at(1, 1, 76), 'C', {}, true);
    expect(beatsOf(after(keys, top), 1)[1]?.notes.map((n) => n.fret)).toEqual([76, 72, 84]);
  });

  it('types a chord letter on an end slot as a plain note', () => {
    const planned = letter(at(1, 2), 'D', {}, true);
    expect(frets(beatsOf(after(keys, planned), 1)[2])).toEqual([[0, 74]]);
  });

  it('refuses a replacement that lands on a pitch the beat holds, merging nothing', () => {
    // The chord E5/C5 with the lane on E5 and the note before it G4: C lands on C5 again.
    const planned = letter(at(1, 1, 76), 'C');
    expect(planned).toEqual({ refused: 'C5 is already on this beat' });
  });

  it('corrects the note just typed with a plain letter, and adds with a shifted one', () => {
    const first = letter(at(1, 2), 'D');
    const next = after(keys, first);
    const inserted = 'command' in first ? first.lane : undefined;
    const typo = letter(
      at(1, 2, inserted, next),
      'F',
      { inserted: beatsOf(next, 1)[2]?.id },
      false,
      next,
    );
    expect(frets(beatsOf(after(next, typo), 1)[2])).toEqual([[0, 78]]);
    const chord = letter(
      at(1, 2, inserted, next),
      'F',
      { inserted: beatsOf(next, 1)[2]?.id },
      true,
      next,
    );
    expect(beatsOf(after(next, chord), 1)[2]?.notes.map((n) => n.fret)).toEqual([74, 78]);
  });

  it('inserts a beat in insert mode, and adds further letters to that beat', () => {
    const insert = letter(at(1, 0, 67), 'D', { mode: 'insert' });
    const next = after(keys, insert);
    expect(beatsOf(next, 1)).toHaveLength(3);
    expect(frets(beatsOf(next, 1)[0])).toEqual([[0, 74]]);
    const inserted = 'command' in insert ? insert.inserted : undefined;
    const again = letter(at(1, 0, 74, next), 'F', { mode: 'insert', inserted }, true, next);
    expect(beatsOf(after(next, again), 1)[0]?.notes.map((n) => n.fret)).toEqual([74, 78]);
  });

  it('is refused when the bar has no room for an inserted beat', () => {
    const full = score().track('piano');
    full
      .bar()
      .beat('4', [note(0, 60)])
      .beat('4', [note(0, 62)])
      .beat('4', [note(0, 64)])
      .beat('4', [note(0, 65)]);
    const built = full.build({ ids: 'sequential' });
    const planned = letter(at(0, 0, 60, built), 'C', { mode: 'insert' }, false, built);
    expect('refused' in planned && planned.refused).toContain('Bar 1');
  });

  it('enters the lane with 0, which repeats a note', () => {
    const planned = plan(keys, at(1, 2, 76), { kind: 'fret', fret: 0 });
    expect(frets(beatsOf(after(keys, planned), 1)[2])).toEqual([[0, 76]]);
  });

  it('refuses the other digits, and a letter on a drum track', () => {
    expect(plan(keys, at(0, 0), { kind: 'fret', fret: 4 })).toEqual({
      refused: 'Type a note name, A to G',
    });
    const kit = drumScore();
    expect(letter(cursorAt(kit, 0, 0), 'C', {}, false, kit)).toEqual({
      refused: 'Typing a note name works on keyboard and fretted tracks only',
    });
  });

  it('deletes and ties by the lane', () => {
    const removed = after(keys, plan(keys, at(1, 1, 72), { kind: 'deleteNote' }));
    expect(beatsOf(removed, 1)[1]?.notes.map((n) => n.fret)).toEqual([76]);
    expect(plan(keys, at(1, 1, 60), { kind: 'deleteNote' })).toEqual({
      refused: 'No C4 on this beat',
    });
    expect(plan(keys, at(1, 2, 60), { kind: 'tie' })).toEqual({
      refused: 'Nothing to tie to on C4',
    });
    const tied = plan(keys, at(1, 2, 76), { kind: 'tie' });
    expect(tied).toMatchObject({ lane: 76 });
    expect(frets(beatsOf(after(keys, tied), 1)[2])).toEqual([[0, 76]]);
  });
});

describe('pitch entry on a fretted track', () => {
  /** A guitar in standard tuning (string 1 is E4): one bar holding a quarter on string 2, fret 7 (F#4). */
  const phrase = (...notes: [number, number][]): Score => {
    const built = score().track('guitar');
    const bar = built.bar();
    for (const [string, fret] of notes) bar.beat('4', [note(string, fret)]);
    built.bar();
    return built.build({ ids: 'sequential' });
  };
  const letter = (
    built: Score,
    cursor: EditCursor,
    name: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G',
    chord = false,
    over: Partial<EntryInput> = {},
  ) => plan(built, cursor, { kind: 'pitch', letter: name, chord }, over);
  const placed = (planned: EntryPlan, built: Score, bar: number, stop: number) =>
    frets(beatsOf(after(built, planned), bar)[stop]);

  it('with no note before it, takes the fret nearest the nut', () => {
    const empty = score().track('guitar');
    empty.bar();
    const built = empty.build({ ids: 'sequential' });
    const planned = letter(built, cursorAt(built, 0, 0), 'E');
    if (!('command' in planned) || !planned.sound) throw new Error('no entry');
    const { string, fret } = planned.sound;
    const opens = [64, 59, 55, 50, 45, 40];
    const pitch = (opens[string - 1] ?? 0) + fret;
    // No other string plays the same pitch at a lower fret.
    for (const open of opens) expect(pitch - open < 0 || pitch - open >= fret).toBe(true);
    expect(planned.string).toBe(string);
  });

  it('stays in position: the fret nearest the one before, a tie going to the higher string', () => {
    // F#4 on string 2, fret 7; E4 is string 2 fret 5 or string 3 fret 9, both two frets away.
    const built = phrase([2, 7]);
    const planned = letter(built, cursorAt(built, 0, 1, 1), 'E');
    expect(placed(planned, built, 0, 1)).toEqual([[2, 5]]);
    expect(planned).toMatchObject({ string: 2, sound: { string: 2, fret: 5 } });
  });

  it("breaks a tie for the cursor's string first", () => {
    const built = phrase([2, 7]);
    const planned = letter(built, cursorAt(built, 0, 1, 3), 'E');
    expect(placed(planned, built, 0, 1)).toEqual([[3, 9]]);
    expect(planned).toMatchObject({ string: 3 });
  });

  it('adds a chord note on a string the beat does not use', () => {
    // G3 is open on string 3; a shifted D goes above it, on any other string.
    const built = phrase([3, 0]);
    const added = letter(built, cursorAt(built, 0, 0, 1), 'D', true);
    const [kept, put] = beatsOf(after(built, added), 0)[0]?.notes ?? [];
    expect(kept).toMatchObject({ string: 3, fret: 0 });
    expect(put?.string).not.toBe(3);
    expect(put).toBeDefined();
  });

  it("replaces the note on the cursor's string and frees that string, keeping the note's id and effects", () => {
    // A3 on string 3 and G2 on string 6; G typed on string 6 is G3, which string 3 would play
    // open but holds A3, so it moves to string 4 fret 5 and the note keeps its id and its palm mute.
    const built = score().track('guitar');
    built.bar().beat('4', [note(3, 2), note(6, 3, { palmMute: true })]);
    const two = built.build({ ids: 'sequential' });
    const before = beatsOf(two, 0)[0]?.notes.find((n) => n.string === 6);
    const planned = letter(two, cursorAt(two, 0, 0, 6), 'G');
    const result = beatsOf(after(two, planned), 0)[0]?.notes ?? [];
    expect(result).toHaveLength(2);
    expect(result.find((n) => n.id === before?.id)).toMatchObject({
      string: 4,
      fret: 5,
      palmMute: true,
    });
    expect(planned).toMatchObject({ string: 4 });
  });

  it('refuses a pitch the beat already holds on another string', () => {
    // A3 is string 3 fret 2; the cursor is on string 1, whose own note is E4, and A lands on A3.
    const built = score().track('guitar');
    built.bar().beat('4', [note(1, 0), note(3, 2)]);
    const chordScore = built.build({ ids: 'sequential' });
    expect(letter(chordScore, cursorAt(chordScore, 0, 0, 1), 'A')).toEqual({
      refused: 'A3 is already on this beat',
    });
  });

  it('keeps the note when its own pitch is typed again, and sounds it', () => {
    const built = phrase([1, 5], [1, 5]);
    const planned = letter(built, cursorAt(built, 0, 1, 1), 'A');
    expect(placed(planned, built, 0, 1)).toEqual([[1, 5]]);
    expect(planned).toMatchObject({ string: 1, sound: { string: 1, fret: 5 } });
  });

  it('refuses a pitch no string can play, naming the track and the letter', () => {
    // The chord note must sit above E6 on the highest fret of string 1; no F up there is on the neck.
    const built = phrase([1, 24]);
    expect(letter(built, cursorAt(built, 0, 0, 2), 'F', true)).toEqual({
      refused: "No F that this track's strings can play above the chord",
    });
  });

  it('refuses a pitch whose strings are all in use', () => {
    // E2 is only on string 6, which holds G2 on this beat.
    const built = score().track('guitar');
    built
      .bar()
      .beat('4', [note(6, 0)])
      .beat('4', [note(6, 3)]);
    const low = built.build({ ids: 'sequential' });
    expect(letter(low, cursorAt(low, 0, 1, 1), 'E')).toEqual({
      refused: 'No free string plays E2',
    });
  });

  it('counts frets from the capo and the capo as the lowest note', () => {
    const built = score().track('guitar', { capo: 2 });
    built.bar().beat('4', [note(1, 0)]);
    const capoed = built.build({ ids: 'sequential' });
    // Open string 1 sounds F#4 under the capo. G4 is its fret 1, and E4, below it, is string 2 fret 3.
    const g = letter(capoed, cursorAt(capoed, 0, 1, 1), 'G');
    expect(g).toMatchObject({ sound: { string: 1, fret: 1 } });
    const e = letter(capoed, cursorAt(capoed, 0, 1, 1), 'E');
    expect(e).toMatchObject({ sound: { string: 2, fret: 3 } });
  });

  it('takes a replaced tied note off its tie', () => {
    const built = score().track('guitar');
    built
      .bar()
      .beat('4', [note(1, 5)])
      .beat('4', [note(1, 5, { tie: true })]);
    const tied = built.build({ ids: 'sequential' });
    const planned = letter(tied, cursorAt(tied, 0, 1, 1), 'C');
    expect(beatsOf(after(tied, planned), 0)[1]?.notes[0]?.tie).toBeFalsy();
  });

  it('still types a digit as a fret on the cursor string', () => {
    const built = phrase([2, 7]);
    const planned = plan(built, cursorAt(built, 0, 1, 4), { kind: 'fret', fret: 3 });
    expect(placed(planned, built, 0, 1)).toEqual([[4, 3]]);
  });
});
