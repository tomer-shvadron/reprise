import { describe, expect, it } from 'vitest';

import { newId } from '../id';
import type { Bend } from '../note';
import {
  removeNote,
  setNote,
  setNoteEffect,
  shiftStrings,
  transposeSelection,
} from './note-commands';
import { beatOf, buildScore, expectRefusal, noteOf, roundTrip } from './test-score';

describe('setNote', () => {
  it('replaces the note on the same string, keeping its id', () => {
    const score = buildScore();
    const beat = beatOf(score, 0, 0, 1);
    const { score: after } = roundTrip(score, setNote({ beatId: beat.id }, { string: 3, fret: 2 }));
    expect(beatOf(after, 0, 0, 1).notes).toEqual([{ ...noteOf(score, 0, 0, 1), fret: 2 }]);
  });

  it('adds a note on a free string and turns a rest into a played beat', () => {
    const score = buildScore();
    const rest = beatOf(score, 0, 0, 2);
    const id = newId();
    const { score: after } = roundTrip(
      score,
      setNote({ beatId: rest.id, id }, { string: 4, fret: 9, palmMute: true }),
    );
    expect(beatOf(after, 0, 0, 2)).toMatchObject({
      rest: false,
      notes: [{ id, string: 4, fret: 9, palmMute: true }],
    });
  });

  it('matches drum notes by MIDI value', () => {
    const score = buildScore();
    const beat = beatOf(score, 1, 0, 0);
    const { score: after } = roundTrip(
      score,
      setNote({ beatId: beat.id }, { string: 0, fret: 38 }),
    );
    expect(beatOf(after, 1, 0, 0).notes.map((note) => note.fret)).toEqual([36, 38]);
  });

  it('refuses a string the track lacks, a fret off the neck, and a tie with no target', () => {
    const score = buildScore();
    const beatId = beatOf(score, 0, 0, 1).id;
    expectRefusal(score, setNote({ beatId }, { string: 7, fret: 0 }), 'invalid-value');
    expectRefusal(score, setNote({ beatId }, { string: 3, fret: 25 }), 'off-fretboard');
    expectRefusal(score, setNote({ beatId }, { string: 4, fret: 1, tie: true }), 'tie-target');
    expectRefusal(
      score,
      setNote({ beatId: beatOf(score, 1, 0, 0).id }, { string: 1, fret: 36 }),
      'invalid-value',
    );
    expectRefusal(score, setNote({ beatId: 'nonexistent0' }, { string: 1, fret: 0 }), 'not-found');
  });

  it('numbers frets up to the neck length whatever the capo, as transpose does', () => {
    const score = buildScore();
    const guitar = score.tracks[0];
    if (!guitar) throw new Error('no guitar');
    const capoed = { ...score, tracks: [{ ...guitar, capo: 5 }, ...score.tracks.slice(1)] };
    const beatId = beatOf(score, 0, 0, 1).id;
    expect(
      roundTrip(capoed, setNote({ beatId }, { string: 3, fret: 24 })).score.tracks[0]?.capo,
    ).toBe(5);
    expectRefusal(capoed, setNote({ beatId }, { string: 3, fret: 25 }), 'off-fretboard');
  });
});

describe('removeNote', () => {
  it('removes one note of a chord', () => {
    const score = buildScore();
    const { score: after } = roundTrip(score, removeNote({ noteId: noteOf(score, 0, 0, 0, 1).id }));
    expect(beatOf(after, 0, 0, 0).notes).toEqual([noteOf(score, 0, 0, 0)]);
  });

  it('leaves a rest and releases the tie that pointed at the note', () => {
    const score = buildScore();
    const { score: after } = roundTrip(score, removeNote({ noteId: noteOf(score, 0, 0, 3).id }));
    expect(beatOf(after, 0, 0, 3)).toMatchObject({ rest: true, notes: [] });
    expect(noteOf(after, 0, 1, 0).tie).toBe(false);
  });

  it('refuses an unknown note', () => {
    expectRefusal(buildScore(), removeNote({ noteId: 'nonexistent0' }), 'not-found');
  });
});

describe('setNoteEffect', () => {
  it('sets and clears effects', () => {
    const score = buildScore();
    const noteId = noteOf(score, 0, 2, 0).id;
    const bend: Bend = {
      kind: 'bend',
      points: [
        { position: 0, value: 0 },
        { position: 60, value: 4 },
      ],
    };
    const { score: bent } = roundTrip(
      score,
      setNoteEffect({ noteId }, { bend, vibrato: 'wide', dynamics: 'pp' }),
    );
    expect(noteOf(bent, 0, 2, 0)).toMatchObject({ bend, vibrato: 'wide', dynamics: 'pp' });
    const { score: cleared } = roundTrip(bent, setNoteEffect({ noteId }, { bend: null }));
    expect(noteOf(cleared, 0, 2, 0)).not.toHaveProperty('bend');
  });

  it('refuses an out-of-range value and a tie with no target', () => {
    const score = buildScore();
    const noteId = noteOf(score, 0, 2, 0).id;
    expectRefusal(
      score,
      setNoteEffect({ noteId }, { trill: { fret: 200, speed: 16 } }),
      'invalid-value',
    );
    expectRefusal(score, setNoteEffect({ noteId }, { tie: true }), 'tie-target');
  });

  it('accepts null only for optional fields', () => {
    // @ts-expect-error -- `dead` is required on a note and cannot be removed
    expect(() => setNoteEffect({ noteId: 'x' }, { dead: null })).not.toThrow();
  });
});

describe('transposeSelection', () => {
  it('shifts frets on fretted tracks and leaves drum notes alone', () => {
    const score = buildScore();
    const beatIds = [beatOf(score, 0, 0, 0).id, beatOf(score, 1, 0, 0).id];
    const { score: after } = roundTrip(score, transposeSelection({ beatIds }, 2));
    expect(beatOf(after, 0, 0, 0).notes.map((note) => note.fret)).toEqual([5, 7]);
    expect(noteOf(after, 1, 0, 0).fret).toBe(36);
  });

  it('takes single notes, counts each once and drops explicit accidentals', () => {
    const score = buildScore();
    const note = noteOf(score, 0, 2, 0);
    const marked = roundTrip(
      score,
      setNoteEffect({ noteId: note.id }, { accidental: 'sharp' }),
    ).score;
    const { score: after } = roundTrip(
      marked,
      transposeSelection({ noteIds: [note.id], beatIds: [beatOf(score, 0, 2, 0).id] }, -7),
    );
    expect(noteOf(after, 0, 2, 0)).toEqual({ ...note, fret: 0 });
  });

  it('refuses a note that would fall off the fretboard', () => {
    const score = buildScore();
    expectRefusal(
      score,
      transposeSelection({ noteIds: [noteOf(score, 0, 1, 1).id] }, 3),
      'off-fretboard',
    );
    expectRefusal(
      score,
      transposeSelection({ noteIds: [noteOf(score, 0, 0, 1).id] }, -1),
      'off-fretboard',
    );
  });
});

describe('shiftStrings', () => {
  it('moves a note to the neighbouring string at the same pitch', () => {
    const score = buildScore();
    const { score: after } = roundTrip(
      score,
      shiftStrings({ noteIds: [noteOf(score, 0, 2, 0).id] }, 'lower'),
    );
    // String 2 is B3, string 3 G3: four semitones lower, so four frets higher.
    expect(noteOf(after, 0, 2, 0)).toMatchObject({ string: 3, fret: 11 });
  });

  it('crosses the G to B major third going up', () => {
    const score = buildScore();
    const { score: after } = roundTrip(
      score,
      shiftStrings({ noteIds: [noteOf(score, 0, 2, 0).id] }, 'higher'),
    );
    expect(noteOf(after, 0, 2, 0)).toMatchObject({ string: 1, fret: 2 });
  });

  it('keeps a tie when both ends move and releases it when one does', () => {
    const score = buildScore();
    const both = [noteOf(score, 0, 0, 3).id, noteOf(score, 0, 1, 0).id];
    const { score: moved } = roundTrip(score, shiftStrings({ noteIds: both }, 'lower'));
    expect(noteOf(moved, 0, 1, 0)).toMatchObject({ string: 2, fret: 8, tie: true });
    const { score: split } = roundTrip(
      score,
      shiftStrings({ noteIds: [noteOf(score, 0, 0, 3).id] }, 'lower'),
    );
    expect(noteOf(split, 0, 1, 0).tie).toBe(false);
  });

  it('refuses an occupied string, an edge string, a negative fret and a drum note', () => {
    const score = buildScore();
    expectRefusal(
      score,
      shiftStrings({ noteIds: [noteOf(score, 0, 0, 0).id] }, 'lower'),
      'string-occupied',
    );
    expectRefusal(
      score,
      shiftStrings({ noteIds: [noteOf(score, 0, 0, 0).id] }, 'higher'),
      'invalid-value',
    );
    expectRefusal(
      score,
      shiftStrings({ noteIds: [noteOf(score, 0, 0, 1).id] }, 'higher'),
      'off-fretboard',
    );
    expectRefusal(
      score,
      shiftStrings({ noteIds: [noteOf(score, 1, 0, 0).id] }, 'higher'),
      'not-fretted',
    );
  });
});
