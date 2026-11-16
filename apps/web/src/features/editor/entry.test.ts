import { applyCommand, type Beat, type Score } from '@reprise/model';
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
import { QUARTER, type Rhythm } from './rhythm';
import { entryScore, fullBarScore, mixedScore } from './test/entry-scores';
import { editScore } from './test/scores';

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

  it('is refused on a track without strings', () => {
    const score = editScore();
    const drums = cursorAtPosition(
      score,
      { track: 1, bar: 0, voice: 0, stop: 0 },
      { string: 0, staff: 'percussion' },
    );
    if (!drums) throw new Error('no cursor');
    expect(plan(score, drums, { kind: 'fret', fret: 1 })).toEqual({
      refused: 'Note entry works on fretted tracks only',
    });
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
