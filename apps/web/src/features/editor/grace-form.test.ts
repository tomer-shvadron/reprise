import { CommandError, createHistory } from '@reprise/model';
import { beatOf, noteOf } from '@reprise/model/testing';
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
});
