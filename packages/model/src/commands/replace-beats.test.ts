import { describe, expect, it } from 'vitest';

import { newId } from '../id';
import { createBeat, createNote } from '../factories';
import { applyCommand, createHistory } from '../history';
import { ScoreSchema } from '../score';
import type { Score } from '../score';
import { largeScore, midi } from '../testing';
import { validateScore } from '../validate';
import { chain } from './chain';
import { insertBeat, removeBeat, replaceBeats } from './beat-commands';
import { insertBar } from './bar-commands';
import { beatOf, buildScore, expectRefusal, noteOf, roundTrip } from './test-score';

const voiceId = (score: Score, track: number, bar: number): string => {
  const voice = score.tracks[track]?.bars[bar]?.voices[0];
  if (!voice) throw new Error('no voice');
  return voice.id;
};
const played = (string: number, fret: number) =>
  createBeat({ notes: [createNote({ string, fret })] });

describe('replaceBeats', () => {
  it('splices voices across tracks and bars, in one history step with the union of touched bars', () => {
    const score = buildScore();
    const guitar = played(2, 2);
    const drum = createBeat({ notes: [midi(38)] });
    const applied = roundTrip(
      score,
      replaceBeats([
        { voiceId: voiceId(score, 0, 0), index: 1, remove: 1, beats: [guitar] },
        { voiceId: voiceId(score, 1, 0), index: 0, remove: 1, beats: [drum] },
        { voiceId: voiceId(score, 0, 2), index: 0, remove: 1, beats: [] },
      ]),
    );
    const after = applied.score;
    expect(beatOf(after, 0, 0, 1).id).toBe(guitar.id);
    expect(beatOf(after, 0, 0, 0)).toEqual(beatOf(score, 0, 0, 0));
    expect(beatOf(after, 1, 0, 0).id).toBe(drum.id);
    expect(after.tracks[0]?.bars[2]?.voices[0]?.beats).toHaveLength(0);
    const ids = score.masterBars.map((m) => m.id);
    expect([...applied.change.touchedBars].sort()).toEqual([ids[0], ids[2]].sort());
  });

  it('applies several splices to one voice against its original indices', () => {
    const score = buildScore();
    const a = played(1, 9);
    const b = played(1, 10);
    const { score: after } = roundTrip(
      score,
      replaceBeats([
        { voiceId: voiceId(score, 0, 0), index: 3, remove: 1, beats: [b] },
        { voiceId: voiceId(score, 0, 0), index: 0, remove: 1, beats: [a] },
      ]),
    );
    const beats = after.tracks[0]?.bars[0]?.voices[0]?.beats ?? [];
    expect(beats.map((beat) => beat.id)).toEqual([
      a.id,
      beatOf(score, 0, 0, 1).id,
      beatOf(score, 0, 0, 2).id,
      b.id,
    ]);
  });

  it('releases the tie of a note whose origin the splice removed', () => {
    const score = buildScore();
    expect(noteOf(score, 0, 1, 0, 0).tie).toBe(true);
    const { score: after } = roundTrip(
      score,
      replaceBeats([
        {
          voiceId: voiceId(score, 0, 0),
          index: 3,
          remove: 1,
          beats: [createBeat({ rest: true })],
        },
      ]),
    );
    expect(noteOf(after, 0, 1, 0, 0).tie).toBe(false);
  });

  it('refuses an id used twice across edits, or already in the score', () => {
    const score = buildScore();
    const shared = createBeat({ rest: true });
    expectRefusal(
      score,
      replaceBeats([
        { voiceId: voiceId(score, 0, 2), index: 0, remove: 1, beats: [shared] },
        { voiceId: voiceId(score, 1, 0), index: 0, remove: 1, beats: [shared] },
      ]),
      'duplicate-id',
    );
    const used = { ...createBeat({ rest: true }), id: beatOf(score, 0, 0, 0).id };
    expectRefusal(
      score,
      replaceBeats([{ voiceId: voiceId(score, 0, 2), index: 0, remove: 1, beats: [used] }]),
      'duplicate-id',
    );
    const note = createNote({ string: 1, fret: 1 });
    expectRefusal(
      score,
      replaceBeats([
        {
          voiceId: voiceId(score, 0, 2),
          index: 0,
          remove: 1,
          beats: [createBeat({ notes: [note] }), createBeat({ notes: [note], duration: 8 })],
        },
      ]),
      'duplicate-id',
    );
  });

  it('refuses a voice that ends over-full, as insertBeat does', () => {
    const score = buildScore();
    expectRefusal(
      score,
      replaceBeats([{ voiceId: voiceId(score, 0, 0), index: 0, remove: 0, beats: [played(1, 1)] }]),
      'invariant',
    );
  });

  it('refuses an empty list, overlapping edits and out-of-range edits', () => {
    const score = buildScore();
    const voice = voiceId(score, 0, 0);
    expectRefusal(score, replaceBeats([]), 'invalid-value');
    expectRefusal(
      score,
      replaceBeats([
        { voiceId: voice, index: 0, remove: 2, beats: [] },
        { voiceId: voice, index: 1, remove: 1, beats: [] },
      ]),
      'invalid-value',
    );
    expectRefusal(
      score,
      replaceBeats([
        { voiceId: voice, index: 1, remove: 0, beats: [] },
        { voiceId: voice, index: 1, remove: 0, beats: [] },
      ]),
      'invalid-value',
    );
    for (const [index, remove] of [
      [5, 0],
      [-1, 0],
      [3, 2],
      [0, -1],
      [0.5, 0],
    ] as const) {
      expectRefusal(
        score,
        replaceBeats([{ voiceId: voice, index, remove, beats: [] }]),
        'invalid-value',
      );
    }
    expectRefusal(
      score,
      replaceBeats([{ voiceId: 'x'.repeat(21), index: 0, remove: 0, beats: [] }]),
      'not-found',
    );
  });

  it('is atomic: a refused second edit leaves the score untouched', () => {
    const score = buildScore();
    const history = createHistory();
    const before = ScoreSchema.parse(JSON.parse(JSON.stringify(score)));
    expect(() =>
      history.apply(
        score,
        replaceBeats([
          {
            voiceId: voiceId(score, 0, 2),
            index: 0,
            remove: 1,
            beats: [createBeat({ rest: true })],
          },
          { voiceId: voiceId(score, 0, 0), index: 0, remove: 0, beats: [played(1, 1)] },
        ]),
      ),
    ).toThrow();
    expect(score).toEqual(before);
    expect(history.canUndo).toBe(false);
  });

  it('equals the chain of removeBeat and insertBeat steps', () => {
    const score = buildScore();
    const g0 = played(2, 2);
    const g1 = createBeat({ rest: true });
    const d = createBeat({ notes: [midi(38)] });
    const gv = voiceId(score, 0, 0);
    const dv = voiceId(score, 1, 0);
    const edited = applyCommand(
      score,
      replaceBeats([
        { voiceId: gv, index: 2, remove: 2, beats: [g0, g1] },
        { voiceId: dv, index: 0, remove: 1, beats: [d] },
      ]),
    );
    const viaChain = applyCommand(
      score,
      chain('chain', [
        removeBeat({ beatId: beatOf(score, 0, 0, 3).id }),
        removeBeat({ beatId: beatOf(score, 0, 0, 2).id }),
        insertBeat({ voiceId: gv, index: 2, id: g0.id }, g0),
        insertBeat({ voiceId: gv, index: 3, id: g1.id }, g1),
        removeBeat({ beatId: beatOf(score, 1, 0, 0).id }),
        insertBeat({ voiceId: dv, index: 0, id: d.id }, d),
      ]),
    );
    expect(edited.score).toEqual(viaChain.score);
    expect(validateScore(edited.score)).toEqual([]);
  });

  describe('ties', () => {
    const tied = (string: number, fret: number, tie = false) =>
      createBeat({ notes: [createNote({ string, fret, tie })] });
    const permutations = <T>(items: T[]): T[][] =>
      items.length <= 1
        ? [items]
        : items.flatMap((item, i) =>
            permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
              item,
              ...rest,
            ]),
          );

    it('keeps a tie inside the clip whatever the order of the edits', () => {
      const score = buildScore();
      const v = (bar: number) => voiceId(score, 0, bar);
      const bar0 = { voiceId: v(0), index: 0, remove: 1, beats: [tied(3, 3)] };
      const bar1 = { voiceId: v(1), index: 0, remove: 2, beats: [tied(1, 3, true), tied(2, 8)] };
      const bar2 = { voiceId: v(2), index: 0, remove: 1, beats: [tied(2, 8, true)] };
      const orders = permutations([bar0, bar1, bar2]);
      expect(orders).toHaveLength(6);
      for (const edits of orders) {
        const { score: after } = roundTrip(score, replaceBeats(edits));
        expect(noteOf(after, 0, 2, 0, 0).tie).toBe(true);
      }
    });

    it('clears an orphan tie on a pasted beat in the first or a later splice, in either order', () => {
      const score = buildScore();
      const v = (bar: number) => voiceId(score, 0, bar);
      const unrelated = { voiceId: v(0), index: 0, remove: 1, beats: [tied(4, 4)] };
      const orphan0 = { voiceId: v(0), index: 2, remove: 1, beats: [tied(2, 9, true)] };
      const orphan1 = { voiceId: v(1), index: 0, remove: 1, beats: [tied(1, 5, true)] };
      for (const edits of [[orphan0], [unrelated, orphan0], [orphan0, unrelated]]) {
        const { score: after } = roundTrip(score, replaceBeats(edits));
        expect(noteOf(after, 0, 0, 2, 0).tie).toBe(false);
      }
      for (const edits of [
        [unrelated, orphan1],
        [orphan1, unrelated],
      ]) {
        const { score: after } = roundTrip(score, replaceBeats(edits));
        expect(noteOf(after, 0, 1, 0, 0).tie).toBe(false);
      }
    });
  });

  it('accepts adjacent edits on one voice', () => {
    const score = buildScore();
    const voice = voiceId(score, 0, 0);
    const a = played(1, 9);
    const b = played(1, 10);
    const { score: after } = roundTrip(
      score,
      replaceBeats([
        { voiceId: voice, index: 2, remove: 0, beats: [b] },
        { voiceId: voice, index: 0, remove: 2, beats: [a] },
      ]),
    );
    const ids = after.tracks[0]?.bars[0]?.voices[0]?.beats.map((beat) => beat.id);
    expect(ids).toEqual([a.id, b.id, beatOf(score, 0, 0, 2).id, beatOf(score, 0, 0, 3).id]);
  });

  it('runs as a function step after insertBar in a chain, as one history step', () => {
    const score = buildScore();
    const clip = played(1, 2);
    const applied = roundTrip(
      score,
      chain('pasteBars', [
        insertBar({ index: 4 }),
        (inserted) => {
          const voice = inserted.tracks[0]?.bars[4]?.voices[0];
          if (!voice) throw new Error('no voice');
          return replaceBeats([{ voiceId: voice.id, index: 0, remove: 0, beats: [clip] }]);
        },
      ]),
    );
    expect(beatOf(applied.score, 0, 4, 0).id).toBe(clip.id);
  });

  it('keeps the patches proportional to the voices touched on a large score', () => {
    const score = largeScore(8, 300);
    for (const bar of [0, 150, 299]) {
      const voice = score.tracks[0]?.bars[bar]?.voices[0];
      if (!voice) throw new Error('no voice');
      const { change } = applyCommand(
        score,
        replaceBeats([
          {
            voiceId: voice.id,
            index: 0,
            remove: voice.beats.length,
            beats: voice.beats.map((beat) => ({
              ...beat,
              id: newId(),
              notes: beat.notes.map((n) => ({ ...n, id: newId() })),
              ...(beat.grace && {
                grace: beat.grace.map((g) => ({
                  ...g,
                  notes: g.notes.map((n) => ({ ...n, id: newId() })),
                })),
              }),
            })),
          },
        ]),
      );
      // About one patch per beat replaced, wherever the bar sits: nothing shifts the later bars.
      expect(change.patches.length).toBeLessThanOrEqual(voice.beats.length + 1);
      expect(change.touchedBars).toEqual([score.masterBars[bar]?.id]);
    }
  });
});
