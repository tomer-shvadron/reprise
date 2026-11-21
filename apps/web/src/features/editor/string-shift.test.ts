import { applyCommand, type Score } from '@reprise/model';
import { midi, note, noteOf, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { cursorAtPosition } from './cursor';
import { planShift, type StringShiftInput } from './string-shift';

function riff(): Score {
  const built = score();
  built.track('guitar');
  built
    .bar()
    .beat('4', [note(3, 7)])
    .beat('4', [note(1, 0)])
    .beat('4', [note(2, 1), note(3, 5)])
    .beat('4', [note(6, 0)]);
  built.bar().beat('1', [note(2, 3), note(3, 5)]);
  built.track('drums');
  built.bar().beat('1', [midi(38)]);
  built.bar().beat('1', [midi(36)]);
  return built.build({ ids: 'sequential' });
}

const input = (built: Score, patch: Partial<StringShiftInput['state']> = {}): StringShiftInput => ({
  score: built,
  state: { cursor: undefined, range: undefined, selection: {}, ...patch },
});

const at = (built: Score, stop: number, string: number, track = 0, bar = 0) =>
  cursorAtPosition(built, { track, bar, voice: 0, stop }, { string, staff: 'tab' });

describe('planShift', () => {
  it('moves the note under the cursor and puts the cursor on its new string', () => {
    const built = riff();
    const plan = planShift(input(built, { cursor: at(built, 0, 3) }), 'higher');
    if (!('command' in plan)) throw new Error(JSON.stringify(plan));
    expect(plan.cursorString).toBe(2);
    const after = applyCommand(built, plan.command).score;
    expect(noteOf(after, 0, 0, 0)).toMatchObject({ string: 2, fret: 3 });
  });

  it('leaves the cursor alone when more than the note under it moves', () => {
    const built = riff();
    const plan = planShift(
      input(built, {
        selection: { beatIds: [built.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.id ?? ''] },
      }),
      'higher',
    );
    expect('command' in plan).toBe(true);
    expect('cursorString' in plan).toBe(false);
  });

  it('refuses the top and the bottom string by name', () => {
    const built = riff();
    expect(planShift(input(built, { cursor: at(built, 1, 1) }), 'higher')).toEqual({
      refused: 'There is no string above string 1 in bar 1',
    });
    expect(planShift(input(built, { cursor: at(built, 3, 6) }), 'lower')).toEqual({
      refused: 'There is no string below string 6 in bar 1',
    });
  });

  it('refuses a fret that would leave the neck, with both frets', () => {
    const built = riff();
    expect(planShift(input(built, { cursor: at(built, 2, 2) }), 'higher')).toEqual({
      refused: 'Fret 1 on string 2 would be fret −4 on string 1 in bar 1',
    });
  });

  it('refuses a string that already has a note, naming the bar', () => {
    const built = riff();
    expect(planShift(input(built, { cursor: at(built, 2, 3) }), 'higher')).toEqual({
      refused: 'String 2 already has a note in bar 1',
    });
  });

  it('moves a range across a drum track for the fretted notes only', () => {
    const built = riff();
    const beatIds = [
      built.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.id ?? '',
      built.tracks[1]?.bars[0]?.voices[0]?.beats[0]?.id ?? '',
    ];
    const plan = planShift(input(built, { selection: { beatIds } }), 'higher');
    if (!('command' in plan)) throw new Error(JSON.stringify(plan));
    const after = applyCommand(built, plan.command).score;
    expect(noteOf(after, 0, 0, 0).string).toBe(2);
    expect(noteOf(after, 1, 0, 0)).toMatchObject({ string: 0, fret: 38 });
  });

  it('refuses a drum track and an empty target in words', () => {
    const built = riff();
    expect(planShift(input(built, { cursor: at(built, 0, 0, 1) }), 'higher')).toEqual({
      refused: 'Moving to another string works on fretted tracks only',
    });
    expect(planShift(input(built), 'higher')).toEqual({ refused: 'Select a note first' });
  });

  it('refuses a picked grace note up front, in a sentence', () => {
    const built = score();
    built.track('guitar');
    built.bar().beat('1', [note(3, 7)], {
      grace: [{ before: true, duration: 32, notes: [note(2, 3)] }],
    });
    const model = built.build({ ids: 'sequential' });
    const graceNote = model.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.grace?.[0]?.notes[0];
    const plan = planShift(
      input(model, { selection: { noteIds: [graceNote?.id ?? ''] } }),
      'higher',
    );
    expect(plan).toEqual({ refused: 'Grace notes move with their beat: select the beat' });
  });

  it('puts the cursor on the note, not on the string it was on, when it sat on an empty string', () => {
    const built = riff();
    const plan = planShift(input(built, { cursor: at(built, 0, 5) }), 'higher');
    expect('command' in plan).toBe(true);
    expect('cursorString' in plan).toBe(false);
  });

  describe('ties', () => {
    function tied() {
      const built = score();
      built.track('guitar');
      built.bar().beat('1', [note(3, 5)]);
      built.bar().beat('1', [note(3, 5, { tie: true })]);
      return built.build({ ids: 'sequential' });
    }

    it('moves the whole chain, so the tie survives', () => {
      const built = tied();
      const plan = planShift(input(built, { cursor: at(built, 0, 3) }), 'lower');
      if (!('command' in plan)) throw new Error(JSON.stringify(plan));
      const after = applyCommand(built, plan.command).score;
      expect(noteOf(after, 0, 0, 0)).toMatchObject({ string: 4, fret: 10 });
      expect(noteOf(after, 0, 1, 0)).toMatchObject({ string: 4, fret: 10, tie: true });
    });

    it('refuses a follower picked without its origin, rather than releasing the tie', () => {
      const built = tied();
      const plan = planShift(
        input(built, { selection: { noteIds: [noteOf(built, 0, 1, 0).id] } }),
        'lower',
      );
      expect(plan).toEqual({
        refused:
          'The note on string 3 in bar 2 is tied to an earlier note: move the tie from its first note',
      });
    });

    it('names the bar of a follower that would leave the neck', () => {
      const built = score();
      built.track('guitar');
      built.bar().beat('1', [note(3, 1)]);
      built.bar().beat('1', [note(3, 1, { tie: true })]);
      const model = built.build({ ids: 'sequential' });
      const plan = planShift(input(model, { cursor: at(model, 0, 3) }), 'higher');
      expect(plan).toEqual({
        refused: 'Fret 1 on string 3 would be fret −3 on string 2 in bar 1',
      });
    });
  });
});

describe('planShift onto a banjo drone string', () => {
  const banjo = (fret: number): Score => {
    const built = score().track('banjo');
    built.bar().beat('4', [note(4, fret)]);
    return built.build({ ids: 'sequential' });
  };

  it('never stores a fret below 0 on string 5, and says the refusal in neck frets', () => {
    // String 4 is D3; moving it to the G4 drone string would need a negative fret.
    const built = banjo(0);
    const plan = planShift(input(built, { cursor: at(built, 0, 4) }), 'lower');
    expect(plan).toEqual({ refused: expect.stringContaining('would be fret') as string });
  });

  it('moves a note up to the drone string with a stored fret from its own nut', () => {
    // String 4 is D3 and the drone is G4, 17 semitones up, so fret 20 lands on stored fret 3.
    const built = banjo(20);
    const plan = planShift(input(built, { cursor: at(built, 0, 4) }), 'lower');
    if (!('command' in plan)) throw new Error(JSON.stringify(plan));
    const after = applyCommand(built, plan.command).score;
    expect(noteOf(after, 0, 0, 0).string).toBe(5);
    expect(noteOf(after, 0, 0, 0).fret).toBe(3);
  });
});
