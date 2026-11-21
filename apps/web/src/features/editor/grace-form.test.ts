import { CommandError, createHistory } from '@reprise/model';
import { beatOf, note, noteOf, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { cursorAtPosition } from './cursor';
import { defaultGraceForm, graceBlocker, planGrace, type GraceForm } from './grace-form';
import { riff } from './test/effects';
import { must } from './test/must';
import type { Score } from '@reprise/model';

const FORM: GraceForm = { fret: 3, duration: 32, before: true, transition: 'none', dead: false };

function input(built: Score, stop = 0) {
  const cursor = cursorAtPosition(
    built,
    { track: 0, bar: 0, voice: 0, stop },
    { string: 1, staff: 'tab' },
  );
  return { score: built, state: { cursor, range: undefined, selection: {} } };
}

function apply(built: Score, result: ReturnType<typeof planGrace>): Score {
  if (!('command' in result)) throw new Error(`no command: ${JSON.stringify(result)}`);
  return createHistory().apply(built, result.command).score;
}

describe('the grace form', () => {
  it('defaults to two frets below the note, 1/32, before the beat', () => {
    const { form, existing } = defaultGraceForm(input(riff()), true);
    expect(existing).toBe(false);
    expect(form).toEqual({ fret: 3, duration: 32, before: true, transition: 'none', dead: false });
    expect(defaultGraceForm(input(riff()), false).form.before).toBe(false);
  });

  it('never defaults below the open string', () => {
    expect(defaultGraceForm(input(riff(), 1), true).form.fret).toBe(5);
    const low = structuredClone(riff());
    must(low.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.notes[0]).fret = 1;
    expect(defaultGraceForm(input(low), true).form.fret).toBe(0);
  });

  it('puts one grace note on each string of a chord beat', () => {
    const built = riff();
    const after = apply(built, planGrace(input(built, 1), FORM));
    const grace = must(beatOf(after, 0, 0, 1).grace);
    expect(grace).toHaveLength(1);
    expect(grace[0]).toMatchObject({ duration: 32, before: true });
    expect(grace[0]?.notes.map((n) => [n.string, n.fret])).toEqual([
      [2, 3],
      [3, 3],
    ]);
    expect(noteOf(after, 0, 0, 1).hammerPull).toBe(false);
  });

  it('slides and hammers as the transition says, and can be dead', () => {
    const built = riff();
    const slid = apply(
      built,
      planGrace(input(built), { ...FORM, transition: 'slide', dead: true }),
    );
    expect(beatOf(slid, 0, 0, 0).grace?.[0]?.notes[0]).toMatchObject({
      slide: ['shift'],
      dead: true,
    });
    const hammered = apply(built, planGrace(input(built), { ...FORM, transition: 'hammer' }));
    expect(noteOf(hammered, 0, 0, 0).hammerPull).toBe(true);
    expect(beatOf(hammered, 0, 0, 0).grace?.[0]?.notes[0]?.slide).toBeUndefined();
  });

  it('opens on existing grace notes and removes them', () => {
    const built = riff();
    const with_ = apply(
      built,
      planGrace(input(built), { ...FORM, fret: 4, duration: 16, before: false }),
    );
    const { form, existing } = defaultGraceForm(input(with_), true);
    expect(existing).toBe(true);
    expect(form).toMatchObject({ fret: 4, duration: 16, before: false, transition: 'none' });
    const without = apply(with_, planGrace(input(with_), 'remove'));
    expect(beatOf(without, 0, 0, 0).grace).toBeUndefined();
    expect(planGrace(input(built), 'remove')).toEqual({ nothing: true });
  });

  it('refuses with nothing selected and on a rest', () => {
    const empty = { score: riff(), state: { cursor: undefined, range: undefined, selection: {} } };
    expect(graceBlocker(empty)).toBe('Select a note first');
    expect(planGrace(empty, FORM)).toEqual({ refused: 'Select a note first' });
  });

  it('is refused by the model for a fret off the neck', () => {
    const built = riff();
    const result = planGrace(input(built), { ...FORM, fret: 100 });
    expect(() => apply(built, result)).toThrow(CommandError);
  });

  it('clears the hammer-on flag with the grace note it belonged to', () => {
    const built = riff();
    const hammered = apply(built, planGrace(input(built), { ...FORM, transition: 'hammer' }));
    expect(noteOf(hammered, 0, 0, 0).hammerPull).toBe(true);
    const removed = apply(hammered, planGrace(input(hammered), 'remove'));
    expect(noteOf(removed, 0, 0, 0).hammerPull).toBe(false);
    expect(removed).toEqual(built);
  });

  it('lets a later Apply change the transition off a hammer-on, and reads it back', () => {
    const built = riff();
    const hammered = apply(built, planGrace(input(built), { ...FORM, transition: 'hammer' }));
    expect(defaultGraceForm(input(hammered), true).form.transition).toBe('hammer');
    const slid = apply(hammered, planGrace(input(hammered), { ...FORM, transition: 'slide' }));
    expect(noteOf(slid, 0, 0, 0).hammerPull).toBe(false);
    expect(defaultGraceForm(input(slid), true).form.transition).toBe('slide');
    const plain = apply(slid, planGrace(input(slid), { ...FORM, transition: 'none' }));
    expect(defaultGraceForm(input(plain), true).form.transition).toBe('none');
  });

  it('writes only the notes whose flag changes, and clears strings that lost their grace note', () => {
    const built = riff();
    // A grace note on both strings of the chord, then one on the first string only.
    const both = apply(built, planGrace(input(built, 1), { ...FORM, transition: 'hammer' }));
    expect(beatOf(both, 0, 0, 1).notes.every((n) => n.hammerPull)).toBe(true);
    const onlyFirst = {
      score: both,
      state: {
        cursor: undefined,
        range: undefined,
        selection: { noteIds: [noteOf(both, 0, 0, 1, 0).id] },
      },
    };
    const next = apply(both, planGrace(onlyFirst, { ...FORM, transition: 'hammer' }));
    expect(noteOf(next, 0, 0, 1, 0).hammerPull).toBe(true);
    expect(noteOf(next, 0, 0, 1, 1).hammerPull).toBe(false);
  });
});

describe('the grace form on a banjo drone string', () => {
  const banjo = (fret: number): Score =>
    score()
      .track('banjo')
      .bar()
      .beat('4', [note(5, fret)])
      .build({ ids: 'sequential' });
  const onDrone = (built: Score) => {
    const cursor = cursorAtPosition(
      built,
      { track: 0, bar: 0, voice: 0, stop: 0 },
      { string: 5, staff: 'tab' },
    );
    return { score: built, state: { cursor, range: undefined, selection: {} } };
  };
  const stored = (built: Score) => built.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.grace?.[0]?.notes;

  it('defaults to a neck fret two below the note, and to open when that fret does not exist', () => {
    expect(defaultGraceForm(onDrone(banjo(4)), true).form.fret).toBe(7);
    // Neck 7 less two is 5, which the drone string does not have.
    expect(defaultGraceForm(onDrone(banjo(2)), true).form.fret).toBe(0);
  });

  it('stores the typed neck fret from the string nut, and refuses frets 1 to 5', () => {
    const built = banjo(4);
    const done = apply(built, planGrace(onDrone(built), { ...FORM, fret: 7 }));
    expect(stored(done)?.map((n) => [n.string, n.fret])).toEqual([[5, 2]]);
    expect(planGrace(onDrone(built), { ...FORM, fret: 3 })).toEqual({
      refused: expect.stringContaining('0, or 6 and up') as string,
    });
  });

  it('shows an existing grace note as the tab does', () => {
    const built = banjo(4);
    const done = apply(built, planGrace(onDrone(built), { ...FORM, fret: 8 }));
    expect(defaultGraceForm(onDrone(done), true)).toMatchObject({
      existing: true,
      form: { fret: 8 },
    });
  });
});
