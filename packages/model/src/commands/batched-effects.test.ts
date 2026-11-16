import { describe, expect, it } from 'vitest';

import { createNote } from '../factories';
import { applyCommand, createHistory } from '../history';
import type { Score } from '../score';
import { largeScore } from '../testing';
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

  it('matches a chain of single commands over 400 notes', { timeout: 60_000 }, () => {
    const score = largeScore(8, 300);
    const ids = score.tracks
      .flatMap((track) => track.bars.slice(0, 25))
      .flatMap((bar) => bar.voices.slice(0, 1).flatMap((voice) => voice.beats))
      .flatMap((beat) => beat.notes.map((n) => n.id))
      .slice(0, 400);
    expect(ids).toHaveLength(400);
    const batched = applyCommand(
      score,
      setNoteEffects(
        ids.map((noteId, i) => ({ noteId, effects: i % 2 ? { palmMute: false } : { dead: true } })),
      ),
    );
    const chained = applyCommand(
      score,
      chain(
        'chain',
        ids.map((noteId, i) =>
          setNoteEffect({ noteId }, i % 2 ? { palmMute: false } : { dead: true }),
        ),
      ),
    );
    expect(batched.score).toEqual(chained.score);
    expect(new Set(batched.change.touchedBars)).toEqual(new Set(chained.change.touchedBars));
  });
});

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
});
