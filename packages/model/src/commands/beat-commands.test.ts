import { describe, expect, it } from 'vitest';

import { createNote } from '../factories';
import { newId } from '../id';
import {
  insertBeat,
  removeBeat,
  setBeatDuration,
  setBeatEffect,
  setBeatRest,
} from './beat-commands';
import { beatOf, buildScore, expectRefusal, noteOf, roundTrip } from './test-score';

const voiceOf = (score: ReturnType<typeof buildScore>, track: number, bar: number) => {
  const voice = score.tracks[track]?.bars[bar]?.voices[0];
  if (!voice) throw new Error('no voice');
  return voice;
};

describe('insertBeat', () => {
  it('inserts a quarter rest by default, with the id asked for', () => {
    const score = buildScore();
    const id = newId();
    const { score: after } = roundTrip(
      score,
      insertBeat({ voiceId: voiceOf(score, 0, 2).id, index: 0, id }),
    );
    expect(beatOf(after, 0, 2, 0)).toMatchObject({ id, duration: 4, rest: true, notes: [] });
    expect(beatOf(after, 0, 2, 1)).toEqual(beatOf(score, 0, 2, 0));
  });

  it('inserts a played beat and releases the tie it interrupts', () => {
    const score = buildScore();
    const notes = [createNote({ string: 5, fret: 2 })];
    const { score: after } = roundTrip(
      score,
      insertBeat({ voiceId: voiceOf(score, 0, 1).id, index: 0 }, { duration: 8, notes }),
    );
    expect(beatOf(after, 0, 1, 0)).toMatchObject({ duration: 8, rest: false, notes });
    expect(noteOf(after, 0, 1, 1).tie).toBe(false);
  });

  it('refuses to overfill a voice, a bad index, a used id and an invalid beat', () => {
    const score = buildScore();
    const full = voiceOf(score, 0, 0).id;
    expectRefusal(score, insertBeat({ voiceId: full, index: 0 }), 'invariant');
    expectRefusal(
      score,
      insertBeat({ voiceId: voiceOf(score, 0, 2).id, index: 5 }),
      'invalid-value',
    );
    expectRefusal(
      score,
      insertBeat({ voiceId: voiceOf(score, 0, 2).id, index: 0, id: score.id }),
      'duplicate-id',
    );
    expectRefusal(
      score,
      insertBeat(
        { voiceId: voiceOf(score, 0, 2).id, index: 0 },
        { notes: [noteOf(score, 0, 2, 0)] },
      ),
      'duplicate-id',
    );
    expectRefusal(
      score,
      insertBeat(
        { voiceId: voiceOf(score, 0, 2).id, index: 0 },
        { notes: [createNote({ string: 9, fret: 0 })] },
      ),
      'invariant',
    );
  });
});

describe('removeBeat', () => {
  it('removes a beat and releases the tie that depended on it', () => {
    const score = buildScore();
    const { score: after } = roundTrip(score, removeBeat({ beatId: beatOf(score, 0, 0, 3).id }));
    expect(voiceOf(after, 0, 0).beats).toHaveLength(3);
    expect(noteOf(after, 0, 1, 0).tie).toBe(false);
  });
});

describe('setBeatDuration', () => {
  it('sets value, dots and tuplet, and removes the tuplet with null', () => {
    const score = buildScore();
    const beatId = beatOf(score, 0, 2, 0).id;
    const { score: triplet } = roundTrip(
      score,
      setBeatDuration({ beatId }, { duration: 8, tuplet: { n: 3, of: 2 } }),
    );
    expect(beatOf(triplet, 0, 2, 0)).toMatchObject({ duration: 8, tuplet: { n: 3, of: 2 } });
    const { score: dotted } = roundTrip(
      triplet,
      setBeatDuration({ beatId }, { dots: 1, tuplet: null }),
    );
    expect(beatOf(dotted, 0, 2, 0)).not.toHaveProperty('tuplet');
    expect(beatOf(dotted, 0, 2, 0).dots).toBe(1);
  });

  it('refuses to overfill the bar and a tuplet that is none', () => {
    const score = buildScore();
    expectRefusal(
      score,
      setBeatDuration({ beatId: beatOf(score, 0, 0, 0).id }, { duration: 2 }),
      'invariant',
    );
    expectRefusal(
      score,
      setBeatDuration({ beatId: beatOf(score, 0, 2, 0).id }, { tuplet: { n: 2, of: 2 } }),
      'invariant',
    );
  });
});

describe('setBeatRest', () => {
  it('makes a played beat a rest and releases the tie into the next bar', () => {
    const score = buildScore();
    const { score: after } = roundTrip(
      score,
      setBeatRest({ beatId: beatOf(score, 0, 0, 3).id }, true),
    );
    expect(beatOf(after, 0, 0, 3)).toMatchObject({ rest: true, notes: [] });
    expect(noteOf(after, 0, 1, 0).tie).toBe(false);
  });

  it('turns a rest into an empty beat', () => {
    const score = buildScore();
    const { score: after } = roundTrip(
      score,
      setBeatRest({ beatId: beatOf(score, 0, 0, 2).id }, false),
    );
    expect(beatOf(after, 0, 0, 2)).toMatchObject({ rest: false, notes: [] });
  });
});

describe('setBeatEffect', () => {
  it('sets effects, text, chord and lyrics, and clears them with null', () => {
    const score = buildScore();
    const beatId = beatOf(score, 0, 0, 0).id;
    const chord = { name: 'C', diagram: { baseFret: 1, frets: [0, 1, 0, 2, 3, null] } };
    const { score: after } = roundTrip(
      score,
      setBeatEffect(
        { beatId },
        { effects: { pickStroke: 'down', tapping: true }, text: 'intro', chord, lyrics: ['la'] },
      ),
    );
    expect(beatOf(after, 0, 0, 0)).toMatchObject({
      effects: { pickStroke: 'down', tapping: true },
      text: 'intro',
      chord,
      lyrics: ['la'],
    });
    const { score: cleared } = roundTrip(
      after,
      setBeatEffect({ beatId }, { effects: { tapping: null }, chord: null }),
    );
    expect(beatOf(cleared, 0, 0, 0).effects).toEqual({ pickStroke: 'down' });
    expect(beatOf(cleared, 0, 0, 0)).not.toHaveProperty('chord');
  });

  it('adds grace notes with fresh ids', () => {
    const score = buildScore();
    const grace = [
      { duration: 16 as const, before: true, notes: [createNote({ string: 2, fret: 4 })] },
    ];
    const { score: after } = roundTrip(
      score,
      setBeatEffect({ beatId: beatOf(score, 0, 2, 0).id }, { grace }),
    );
    expect(beatOf(after, 0, 2, 0).grace).toEqual(grace);
  });

  it('refuses a chord diagram for the wrong string count and a reused note id', () => {
    const score = buildScore();
    const beatId = beatOf(score, 0, 2, 0).id;
    expectRefusal(
      score,
      setBeatEffect({ beatId }, { chord: { name: 'C', diagram: { baseFret: 1, frets: [0, 1] } } }),
      'invariant',
    );
    const grace = [{ duration: 16 as const, before: true, notes: [noteOf(score, 0, 0, 1)] }];
    expectRefusal(score, setBeatEffect({ beatId }, { grace }), 'duplicate-id');
    expectRefusal(
      score,
      setBeatEffect({ beatId }, { lyrics: ['a', 'b', 'c', 'd', 'e', 'f'] }),
      'invalid-value',
    );
  });
});
