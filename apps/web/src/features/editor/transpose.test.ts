import { applyCommand, createHistory, type Score } from '@reprise/model';
import { beatOf, midi, note, noteOf, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { cursorAtPosition } from './cursor';
import { planTranspose, type TransposeInput, type TransposeOptions } from './transpose';

const state = (built: Score, patch: Partial<TransposeInput['state']> = {}) => ({
  cursor: undefined,
  range: undefined,
  selection: {},
  currentTrack: built.tracks[0]?.id,
  ...patch,
});

const run = (built: Score, options: Partial<TransposeOptions>, patch = {}) =>
  planTranspose(
    { score: built, state: state(built, patch) },
    { semitones: 1, scope: 'song', chordNames: true, keySignature: true, ...options },
  );

function applied(built: Score, plan: ReturnType<typeof run>): Score {
  if (!('command' in plan)) throw new Error(`no command: ${JSON.stringify(plan)}`);
  return applyCommand(built, plan.command).score;
}

const refusal = (plan: ReturnType<typeof run>): string => ('refused' in plan ? plan.refused : '');

const key = (built: Score, bar = 0) => built.masterBars[bar]?.keySignature;

function band() {
  const built = score().key(0);
  built.track('guitar', { name: 'Lead' });
  built
    .bar()
    .beat('4', [note(1, 5), note(2, 7)], { chord: { name: 'C' } })
    .beat('4', [note(3, 0)], { chord: { name: 'Am7/G' } });
  built
    .bar()
    .key(2)
    .beat('1', [note(1, 3)], { chord: { name: 'N.C.' } });
  built.track('bass', { name: 'Bass' });
  built
    .bar()
    .beat('2', [note(4, 5)])
    .beat('2', [note(4, 7)]);
  built.bar().beat('1', [note(4, 0)]);
  built.track('drums', { name: 'Kit' });
  built.bar().beat('1', [midi(38)]);
  built.bar().beat('1', [midi(36)]);
  return built.build({ ids: 'sequential' });
}

describe('planTranspose', () => {
  it('moves every pitched track on its strings, leaves drums, and says so', () => {
    const before = band();
    const plan = run(before, {});
    const after = applied(before, plan);
    expect(noteOf(after, 0, 0, 0, 0).fret).toBe(6);
    expect(noteOf(after, 0, 0, 0, 0).string).toBe(1);
    expect(noteOf(after, 1, 0, 1, 0).fret).toBe(8);
    expect(noteOf(after, 2, 0, 0, 0).fret).toBe(38);
    expect('notice' in plan && plan.notice).toMatch(/Drum tracks were left as they are/);
  });

  it('is one undo step labelled Transpose, and undo restores the score', () => {
    const before = band();
    const plan = run(before, {});
    if (!('command' in plan)) throw new Error('no command');
    const history = createHistory();
    const first = history.apply(before, plan.command);
    expect(history.undoLabel).toBe('Transpose');
    expect(first.score).not.toBe(before);
    expect(history.undo()?.score).toEqual(before);
    expect(history.canUndo).toBe(false);
  });

  it('maps each scope to its notes', () => {
    const built = band();
    const track = applied(
      built,
      run(
        built,
        { scope: 'track' },
        {
          currentTrack: built.tracks[1]?.id,
        },
      ),
    );
    expect(noteOf(track, 0, 0, 0, 0).fret).toBe(5);
    expect(noteOf(track, 1, 0, 0, 0).fret).toBe(6);

    const picked = applied(
      built,
      run(
        built,
        { scope: 'selection' },
        { selection: { noteIds: [noteOf(built, 0, 0, 0, 1).id] } },
      ),
    );
    expect(noteOf(picked, 0, 0, 0, 1).fret).toBe(8);
    expect(noteOf(picked, 0, 0, 0, 0).fret).toBe(5);
  });

  it('reaches the beats of a range, and a cursor on a note moves that note', () => {
    const built = band();
    const cursor = cursorAtPosition(
      built,
      { track: 0, bar: 0, voice: 0, stop: 0 },
      { string: 2, staff: 'tab' },
    );
    const moved = applied(built, run(built, { scope: 'selection' }, { cursor }));
    expect(noteOf(moved, 0, 0, 0, 1).fret).toBe(8);
    expect(noteOf(moved, 0, 0, 0, 0).fret).toBe(5);
    expect(run(built, { scope: 'selection' })).toEqual({ nothing: true });
  });

  it('spells chord names for the key after the edit and counts what it cannot read', () => {
    const built = band();
    const plan = run(built, { semitones: 2 });
    const after = applied(built, plan);
    expect(beatOf(after, 0, 0, 0).chord?.name).toBe('D');
    expect(beatOf(after, 0, 0, 1).chord?.name).toBe('Bm7/A');
    expect(beatOf(after, 0, 1, 0).chord?.name).toBe('N.C.');
    expect('notice' in plan && plan.notice).toMatch(/1 chord name could not be read/);
  });

  it('leaves chord names alone when the option is off, and for notes picked on their own', () => {
    const built = band();
    const off = applied(built, run(built, { chordNames: false }));
    expect(beatOf(off, 0, 0, 0).chord?.name).toBe('C');
    const picked = applied(
      built,
      run(built, { scope: 'selection' }, { selection: { noteIds: [noteOf(built, 0, 0, 0).id] } }),
    );
    expect(beatOf(picked, 0, 0, 0).chord?.name).toBe('C');
  });

  it('moves a movable diagram and removes one that cannot move, with a notice', () => {
    const built = score();
    built.track('guitar');
    built
      .bar()
      .beat('4', [note(1, 1)], {
        chord: { name: 'F', diagram: { baseFret: 1, frets: [1, 1, 2, 3, 3, 1] } },
      })
      .beat('4', [note(1, 0)], {
        chord: { name: 'Em', diagram: { baseFret: 1, frets: [0, 0, 0, 2, 2, 0] } },
      });
    const before = built.build({ ids: 'sequential' });
    const plan = run(before, { keySignature: false });
    const after = applied(before, plan);
    expect(beatOf(after, 0, 0, 0).chord).toEqual({
      name: 'F#',
      diagram: { baseFret: 2, frets: [2, 2, 3, 4, 4, 2] },
    });
    expect(beatOf(after, 0, 0, 1).chord).toEqual({ name: 'Fm' });
    expect('notice' in plan && plan.notice).toMatch(
      /1 chord diagram could not move and was removed/,
    );
  });

  it('moves the key only when the scope covers every non-drum track', () => {
    const built = band();
    expect(key(applied(built, run(built, { semitones: 2 })))).toEqual({ fifths: 2, minor: false });
    expect(key(applied(built, run(built, { semitones: 2 })), 1)).toEqual({
      fifths: 4,
      minor: false,
    });
    const oneTrack = applied(built, run(built, { semitones: 2, scope: 'track' }));
    expect(key(oneTrack)).toEqual({ fifths: 0, minor: false });
    const alone = score().key(1, true);
    alone.track('guitar');
    alone.bar().beat('1', [note(1, 5)]);
    const solo = alone.build({ ids: 'sequential' });
    const moved = applied(solo, run(solo, { semitones: 2, scope: 'track' }));
    expect(key(moved)).toEqual({ fifths: 3, minor: true });
    const kept = applied(solo, run(solo, { semitones: 2, scope: 'track', keySignature: false }));
    expect(key(kept)).toEqual({ fifths: 1, minor: true });
  });

  it('carries a tie chain across bars with its origin', () => {
    const built = score();
    built.track('guitar');
    built.bar().beat('1', [note(1, 5)]);
    built.bar().beat('1', [note(1, 5, { tie: true })]);
    const before = built.build({ ids: 'sequential' });
    const after = applied(
      before,
      run(
        before,
        { scope: 'selection', keySignature: false },
        {
          selection: { noteIds: [noteOf(before, 0, 0, 0).id] },
        },
      ),
    );
    expect(noteOf(after, 0, 1, 0)).toMatchObject({ fret: 6, tie: true });
  });

  it('counts the warnings the model will raise', () => {
    const built = score();
    built.track('guitar', { fretCount: 24 });
    built.bar().beat('1', [note(1, 23, { trill: { fret: 24, speed: 16 } })]);
    const before = built.build({ ids: 'sequential' });
    const plan = run(before, { keySignature: false });
    expect('notice' in plan && plan.notice).toMatch(/1 trill fell off the neck and was removed/);
  });

  describe('refusals, before anything is built', () => {
    function neck(spec: { fret: number; string?: number; capo?: number; bar?: number }) {
      const built = score();
      built.track('guitar', { ...(spec.capo && { capo: spec.capo }) });
      built.bar().beat('1', [note(1, 3)]);
      for (let bar = 1; bar < (spec.bar ?? 1); bar++) built.bar().beat('1', [note(1, 3)]);
      built.bar().beat('1', [note(spec.string ?? 6, spec.fret)]);
      return built.build({ ids: 'sequential' });
    }

    it('names the track, bar and string for a note below the open string', () => {
      const before = neck({ fret: 0, bar: 2 });
      const plan = run(before, { semitones: -2 });
      expect(plan).toEqual({
        refused:
          'Track 1, bar 3, string 6: fret 0 cannot go down 2 semitones without falling below the open string',
      });
    });

    it('says past the last fret, and below the capo', () => {
      expect(refusal(run(neck({ fret: 24 }), { semitones: 1 }))).toMatch(
        /string 6: fret 24 cannot go up 1 semitone without going past fret 24$/,
      );
      expect(refusal(run(neck({ fret: 0, capo: 2 }), { semitones: -1 }))).toMatch(
        /without falling below the capo$/,
      );
    });

    it('leaves nothing built: the score and the history are untouched', () => {
      const before = neck({ fret: 0 });
      const plan = run(before, { semitones: -1 });
      expect('refused' in plan).toBe(true);
      expect(noteOf(before, 0, 1, 0).fret).toBe(0);
    });

    it('refuses a pitched track out of the MIDI range', () => {
      const built = score();
      built.track('piano');
      built.bar().beat('1', [midi(126)]);
      const before = built.build({ ids: 'sequential' });
      expect(refusal(run(before, { semitones: 5 }))).toMatch(
        /^Track 1, bar 1: F♯9 cannot go up 5 semitones without leaving the MIDI range$/,
      );
    });
  });

  it('moves pitched tracks by their MIDI value and does nothing at zero', () => {
    const built = score();
    built.track('piano');
    built.bar().beat('1', [midi(60)]);
    const before = built.build({ ids: 'sequential' });
    expect(noteOf(applied(before, run(before, { semitones: 7 })), 0, 0, 0).fret).toBe(67);
    expect(run(before, { semitones: 0 })).toEqual({ nothing: true });
  });

  it('refuses a picked grace note up front', () => {
    const built = score();
    built.track('guitar');
    built.bar().beat('1', [note(3, 7)], {
      grace: [{ before: true, duration: 32, notes: [note(2, 3)] }],
    });
    const model = built.build({ ids: 'sequential' });
    const graceNote = model.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.grace?.[0]?.notes[0];
    const plan = run(
      model,
      { scope: 'selection' },
      { selection: { noteIds: [graceNote?.id ?? ''] } },
    );
    expect(refusal(plan)).toBe('Grace notes move with their beat: select the beat');
  });

  it('moves the grid of a chord whose name cannot be read, or removes it with the notice', () => {
    const built = score();
    built.track('guitar');
    built.bar().beat('4', [note(1, 3)], {
      chord: { name: 'Riff', diagram: { baseFret: 1, frets: [3, 5, 5, 4, 3, 3] } },
    });
    const model = built.build({ ids: 'sequential' });
    const moved = applied(model, run(model, { semitones: 2, keySignature: false }));
    expect(beatOf(moved, 0, 0, 0).chord).toEqual({
      name: 'Riff',
      diagram: { baseFret: 3, frets: [5, 7, 7, 6, 5, 5] },
    });
  });

  it('removes the grid of a chord whose name cannot be read when it cannot move', () => {
    const built = score();
    built.track('guitar');
    built.bar().beat('4', [note(1, 3)], {
      chord: { name: 'Riff', diagram: { baseFret: 1, frets: [0, 2, 2, 1, 0, 0] } },
    });
    const model = built.build({ ids: 'sequential' });
    const plan = run(model, { semitones: 2, keySignature: false });
    expect(beatOf(applied(model, plan), 0, 0, 0).chord).toEqual({ name: 'Riff' });
    expect('notice' in plan && plan.notice).toMatch(
      /1 chord diagram could not move and was removed/,
    );
  });

  it('leaves chord names on drum tracks and says so', () => {
    const built = score();
    built.track('guitar');
    built.bar().beat('1', [note(1, 3)], { chord: { name: 'C' } });
    built.track('drums');
    built.bar().beat('1', [midi(38)], { chord: { name: 'G' } });
    const model = built.build({ ids: 'sequential' });
    const plan = run(model, { keySignature: false });
    const after = applied(model, plan);
    expect(beatOf(after, 1, 0, 0).chord?.name).toBe('G');
    expect(beatOf(after, 0, 0, 0).chord?.name).toBe('C#');
    expect('notice' in plan && plan.notice).toMatch(
      /1 chord name on drum tracks was left as written/,
    );
  });

  it('says drum notes have no pitch when only drums are in scope', () => {
    const built = score();
    built.track('drums');
    built.bar().beat('1', [midi(38)]);
    const model = built.build({ ids: 'sequential' });
    expect(refusal(run(model, { scope: 'track' }))).toBe('Drum notes have no pitch to transpose');
  });

  it('counts a range over every beat of every pitched track as covering the key', () => {
    const built = band();
    const beatIds = built.tracks
      .filter((track) => track.kind !== 'drums')
      .flatMap((track) =>
        track.bars.flatMap((bar) => bar.voices.flatMap((voice) => voice.beats.map((b) => b.id))),
      );
    const plan = run(built, { scope: 'selection', semitones: 2 }, { selection: { beatIds } });
    expect(key(applied(built, plan))).toEqual({ fifths: 2, minor: false });
    const partial = run(
      built,
      { scope: 'selection', semitones: 2 },
      { selection: { beatIds: beatIds.slice(1) } },
    );
    expect(key(applied(built, partial))).toEqual({ fifths: 0, minor: false });
  });
});
