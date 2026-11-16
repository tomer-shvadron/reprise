import { describe, expect, it } from 'vitest';

import { createNote } from '../factories';
import { applyCommand, createHistory } from '../history';
import type { Score } from '../score';
import { largeScore, note, score as scoreBuilder } from '../testing';
import { validateScore } from '../validate';
import { setBeatEffect, setBeatEffects } from './beat-commands';
import { chain } from './chain';
import { setNote, setNoteEffect, setNoteEffects } from './note-commands';
import { beatOf, buildScore, expectRefusal, noteOf, roundTrip } from './test-score';

function withGrace(score: Score) {
  const grace = [
    { duration: 16 as const, before: true, notes: [createNote({ string: 2, fret: 4 })] },
  ];
  const { score: after } = applyCommand(
    score,
    setBeatEffect({ beatId: beatOf(score, 0, 2, 0).id }, { grace }),
  );
  const graceNote = beatOf(after, 0, 2, 0).grace?.[0]?.notes[0];
  if (!graceNote) throw new Error('no grace note');
  return { score: after, graceNote };
}

describe('setNoteEffects', () => {
  it('edits notes across tracks, voices and bars in one history step', () => {
    const base = largeScore(3, 4);
    const restId = beatOf(base, 1, 2, 0, 1).id;
    const { score } = applyCommand(base, setNote({ beatId: restId }, { string: 3, fret: 5 }));
    const a = noteOf(score, 0, 0, 0);
    const b = noteOf(score, 2, 3, 1, 1);
    const c = noteOf(score, 1, 2, 0, 0, 1);
    const history = createHistory();
    const applied = history.apply(
      score,
      setNoteEffects([
        { noteId: a.id, effects: { palmMute: true } },
        { noteId: b.id, effects: { dead: true } },
        { noteId: c.id, effects: { ghost: true, accent: 'heavy' } },
      ]),
    );
    expect(noteOf(applied.score, 0, 0, 0)).toMatchObject({ palmMute: true });
    expect(noteOf(applied.score, 2, 3, 1, 1)).toMatchObject({ dead: true });
    expect(noteOf(applied.score, 1, 2, 0, 0, 1)).toMatchObject({ ghost: true, accent: 'heavy' });
    expect(validateScore(applied.score)).toEqual([]);
    expect(new Set(applied.change.touchedBars)).toEqual(
      new Set([0, 2, 3].map((i) => score.masterBars[i]?.id)),
    );
    expect(history.undo()?.score).toEqual(score);
    expect(history.undo()).toBeUndefined();
    expect(history.redo()?.score).toEqual(applied.score);
  });

  it('reaches grace notes, which setNoteEffect cannot', () => {
    const { score, graceNote } = withGrace(buildScore());
    expectRefusal(score, setNoteEffect({ noteId: graceNote.id }, { dead: true }), 'not-found');
    const { score: after } = roundTrip(
      score,
      setNoteEffects([{ noteId: graceNote.id, effects: { dead: true } }]),
    );
    expect(beatOf(after, 0, 2, 0).grace?.[0]?.notes[0]).toMatchObject({ dead: true });
    expect(validateScore(after)).toEqual([]);
  });

  it('refuses a tie on a grace note and a tie with no origin on a main note', () => {
    const { score, graceNote } = withGrace(buildScore());
    expectRefusal(
      score,
      setNoteEffects([{ noteId: graceNote.id, effects: { tie: true } }]),
      'invalid-value',
    );
    const first = noteOf(score, 0, 0, 0);
    expectRefusal(
      score,
      setNoteEffects([{ noteId: first.id, effects: { tie: true } }]),
      'tie-target',
    );
  });

  it('is atomic: one bad edit leaves every other edit unapplied', () => {
    const score = buildScore();
    const good = noteOf(score, 0, 0, 0);
    expectRefusal(
      score,
      setNoteEffects([
        { noteId: good.id, effects: { palmMute: true } },
        { noteId: 'missing', effects: { dead: true } },
      ]),
      'not-found',
    );
  });

  it('refuses an empty list and an id named twice', () => {
    const score = buildScore();
    const id = noteOf(score, 0, 0, 0).id;
    expectRefusal(score, setNoteEffects([]), 'invalid-value');
    expectRefusal(
      score,
      setNoteEffects([
        { noteId: id, effects: { dead: true } },
        { noteId: id, effects: { ghost: true } },
      ]),
      'invalid-value',
    );
  });

  it(
    'matches a chain of single commands over 400 notes of several tracks',
    { timeout: 60_000 },
    () => {
      const score = largeScore(8, 300);
      // Four bars of every track, as a range selection over the whole score would be; some of the
      // notes already have the effect, so their edits change nothing.
      const notes = score.tracks
        .flatMap((track) => track.bars.slice(0, 4))
        .flatMap((bar) => bar.voices.slice(0, 1).flatMap((voice) => voice.beats))
        .flatMap((beat) => beat.notes)
        .slice(0, 400);
      expect(notes).toHaveLength(400);
      expect(notes.some((n) => n.palmMute)).toBe(true);
      expect(notes.some((n) => !n.palmMute)).toBe(true);
      const edits = notes.map(({ id: noteId }) => ({ noteId, effects: { palmMute: true } }));
      const batched = applyCommand(score, setNoteEffects(edits));
      const chained = applyCommand(
        score,
        chain(
          'chain',
          edits.map(({ noteId, effects }) => setNoteEffect({ noteId }, effects)),
        ),
      );
      expect(batched.score).toEqual(chained.score);
      expect(new Set(batched.change.touchedBars)).toEqual(new Set(chained.change.touchedBars));
      expect(batched.change.touchedBars.length).toBeGreaterThan(1);
      // Proportional to the notes that changed, not to the score or the edits asked for.
      const changed = notes.filter((n) => !n.palmMute).length;
      expect(batched.change.patches.length).toBe(changed);
      expect(batched.change.patches.length).toBeLessThan(edits.length);
    },
  );

  it('accepts ties set in one batch, in any order', () => {
    const score = buildTieRun();
    const tied = [1, 2, 3].map((i) => beatOf(score, 0, 0, i).notes[0]?.id ?? '');
    const effects = { tie: true };
    for (const order of [tied, [...tied].reverse()]) {
      const { score: after } = roundTrip(
        score,
        setNoteEffects(order.map((noteId) => ({ noteId, effects }))),
      );
      expect([1, 2, 3].map((i) => noteOf(after, 0, 0, i).tie)).toEqual([true, true, true]);
    }
  });

  it('names the note whose edit was refused', () => {
    const score = buildScore();
    const id = noteOf(score, 0, 0, 0).id;
    expect(() =>
      applyCommand(score, setNoteEffects([{ noteId: id, effects: { tie: true } }])),
    ).toThrow(`note ${id}:`);
  });
});

function buildTieRun(): Score {
  return scoreBuilder()
    .track('guitar')
    .bar()
    .beat('4', [note(1, 3)])
    .beat('4', [note(1, 3)])
    .beat('4', [note(1, 3)])
    .beat('4', [note(1, 3)])
    .build();
}

describe('setBeatEffects', () => {
  it('edits beats on two tracks in one history step and names their bars', () => {
    const score = buildScore();
    const a = beatOf(score, 0, 0, 0);
    const b = beatOf(score, 1, 0, 0);
    const { change } = roundTrip(
      score,
      setBeatEffects([
        { beatId: a.id, changes: { effects: { tapping: true } } },
        { beatId: b.id, changes: { effects: { slapping: true } } },
      ]),
    );
    expect(change.touchedBars).toEqual([score.masterBars[0]?.id]);
    const { score: after } = applyCommand(
      score,
      setBeatEffects([
        { beatId: beatOf(score, 0, 2, 0).id, changes: { effects: { fadeIn: true } } },
        { beatId: a.id, changes: { text: 'x' } },
      ]),
    );
    expect(beatOf(after, 0, 2, 0).effects).toMatchObject({ fadeIn: true });
    expect(beatOf(after, 0, 0, 0).text).toBe('x');
  });

  it('applies grace notes like setBeatEffect and matches a chain', () => {
    const score = buildScore();
    const grace = [
      { duration: 16 as const, before: true, notes: [createNote({ string: 2, fret: 4 })] },
    ];
    const edits = [
      { beatId: beatOf(score, 0, 2, 0).id, changes: { grace } },
      { beatId: beatOf(score, 0, 0, 0).id, changes: { effects: { pickStroke: 'up' as const } } },
    ];
    const batched = applyCommand(score, setBeatEffects(edits)).score;
    const chained = applyCommand(
      score,
      chain(
        'c',
        edits.map((e) => setBeatEffect({ beatId: e.beatId }, e.changes)),
      ),
    ).score;
    expect(batched).toEqual(chained);
  });

  it('refuses a bad grace note, an empty list, a duplicate and a missing beat', () => {
    const score = buildScore();
    const id = beatOf(score, 0, 0, 0).id;
    const off = [
      { duration: 16 as const, before: true, notes: [createNote({ string: 4, fret: 30 })] },
    ];
    expectRefusal(
      score,
      setBeatEffects([{ beatId: id, changes: { grace: off } }]),
      'off-fretboard',
    );
    expectRefusal(score, setBeatEffects([]), 'invalid-value');
    expectRefusal(
      score,
      setBeatEffects([
        { beatId: id, changes: { text: 'a' } },
        { beatId: id, changes: { text: 'b' } },
      ]),
      'invalid-value',
    );
    expectRefusal(score, setBeatEffects([{ beatId: 'missing', changes: {} }]), 'not-found');
  });

  it('refuses a grace note id reused across tracks or on one track, as a chain does', () => {
    const score = buildScore();
    const grace = [
      { duration: 16 as const, before: true, notes: [createNote({ string: 2, fret: 4 })] },
    ];
    const across = [
      { beatId: beatOf(score, 0, 0, 0).id, changes: { grace } },
      { beatId: beatOf(score, 1, 0, 0).id, changes: { grace } },
    ];
    const same = [
      { beatId: beatOf(score, 0, 0, 0).id, changes: { grace } },
      { beatId: beatOf(score, 0, 2, 0).id, changes: { grace } },
    ];
    for (const edits of [across, same]) {
      expectRefusal(score, setBeatEffects(edits), 'duplicate-id');
      expect(() =>
        applyCommand(
          score,
          chain(
            'c',
            edits.map((e) => setBeatEffect({ beatId: e.beatId }, e.changes)),
          ),
        ),
      ).toThrow(expect.objectContaining({ code: 'duplicate-id' }));
    }
  });

  it('refuses a grace note id the score already uses', () => {
    const { score, graceNote } = withGrace(buildScore());
    const grace = [{ duration: 16 as const, before: true, notes: [{ ...graceNote }] }];
    expectRefusal(
      score,
      setBeatEffects([{ beatId: beatOf(score, 0, 0, 0).id, changes: { grace } }]),
      'duplicate-id',
    );
  });
});
