import { createHistory, type Id, type Score, type Selection } from '@reprise/model';
import { beatOf, midi, noteOf, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { bendPreset } from './bend-presets';
import { planEffect, type EffectAction, type EffectMode } from './effects';
import { editScore } from './test/scores';

/** Two bars: a full guitar bar with a chord, and a second bar to slide and hammer into. */
function riff(): Score {
  const built = score().track('guitar');
  built
    .bar()
    .beat('4', [note(1, 5)])
    .beat('4', [note(2, 7)])
    .beat('4', [note(3, 0), note(4, 2)])
    .beat('4', [note(1, 7)]);
  built
    .bar()
    .beat('4', [note(1, 9)])
    .beat('4', [note(2, 3)])
    .beat('2', [note(1, 9, { tie: true })]);
  return built.build({ ids: 'sequential' });
}

const state = (selection: Selection) => ({ cursor: undefined, range: undefined, selection });

const apply = (built: Score, selection: Selection, action: EffectAction, mode?: EffectMode) => {
  const plan = planEffect({ score: built, state: state(selection) }, action, mode);
  if (!('command' in plan)) return { plan };
  const history = createHistory();
  const applied = history.apply(built, plan.command);
  return { plan, history, applied, after: applied.score, label: history.undoLabel };
};

const ids = (built: Score, ...at: [number, number, number][]): Id[] =>
  at.map(([bar, beat, note]) => noteOf(built, 0, bar, beat, note).id);

const palmMute: EffectAction = { kind: 'flag', flag: 'palmMute' };

describe('planEffect: the toggle rule', () => {
  it('sets an effect on a note and takes it off with the same key, each one undo step with a label', () => {
    const built = riff();
    const noteIds = ids(built, [0, 0, 0]);
    const on = apply(built, { noteIds }, palmMute);
    expect(noteOf(on.after ?? built, 0, 0, 0).palmMute).toBe(true);
    expect(on.label).toBe('Palm mute');
    const off = apply(on.after ?? built, { noteIds }, palmMute);
    expect(off.label).toBe('Remove palm mute');
    expect(off.after).toEqual(built);
    // Undo returns the score exactly.
    expect(on.history?.undo()?.score).toEqual(built);
    expect(on.history?.canUndo).toBe(false);
  });

  it('sets on every note when the state is mixed, and removes from all when uniform', () => {
    const built = riff();
    const noteIds = ids(built, [0, 0, 0], [0, 1, 0], [0, 3, 0]);
    const first = apply(built, { noteIds: noteIds.slice(0, 1) }, palmMute);
    const mixed = apply(first.after ?? built, { noteIds }, palmMute);
    expect(mixed.label).toBe('Palm mute');
    for (const beat of [0, 1, 3])
      expect(noteOf(mixed.after ?? built, 0, 0, beat).palmMute).toBe(true);
    const uniform = apply(mixed.after ?? built, { noteIds }, palmMute);
    expect(uniform.label).toBe('Remove palm mute');
    expect(uniform.after).toEqual(built);
  });

  it('writes only the notes that change', () => {
    const built = riff();
    const noteIds = ids(built, [0, 0, 0], [0, 1, 0]);
    const first = apply(built, { noteIds: noteIds.slice(0, 1) }, palmMute);
    const second = apply(first.after ?? built, { noteIds }, palmMute);
    const touched = new Set(second.applied?.change.patches.map(({ path }) => path.join('/')));
    expect(touched.size).toBe(1);
    expect([...touched][0]).toContain('palmMute');
  });

  it('does nothing when set finds every note already set, and set never removes', () => {
    const built = riff();
    const noteIds = ids(built, [0, 0, 0]);
    const on = apply(built, { noteIds }, palmMute, 'set');
    expect(apply(on.after ?? built, { noteIds }, palmMute, 'set').plan).toEqual({ nothing: true });
    expect(apply(built, { noteIds }, palmMute, 'remove').plan).toEqual({ nothing: true });
  });

  it('treats a bend of another size as a different value, which a toggle replaces', () => {
    const built = riff();
    const noteIds = ids(built, [0, 0, 0]);
    const half = apply(built, { noteIds }, { kind: 'bend', bend: bendPreset('bend', 'half') });
    const full = apply(
      half.after ?? built,
      { noteIds },
      {
        kind: 'bend',
        bend: bendPreset('bend', 'full'),
      },
    );
    expect(full.label).toBe('Bend');
    expect(noteOf(full.after ?? built, 0, 0, 0).bend).toEqual(bendPreset('bend', 'full'));
    const removed = apply(
      full.after ?? built,
      { noteIds },
      {
        kind: 'bend',
        bend: bendPreset('bend', 'full'),
      },
    );
    expect(removed.after).toEqual(built);
  });
});

describe('planEffect: targets', () => {
  it('puts a note effect on every note of a beat target (D7)', () => {
    const built = riff();
    const beatIds = [beatOf(built, 0, 0, 2).id];
    const result = apply(built, { beatIds }, palmMute);
    expect(beatOf(result.after ?? built, 0, 0, 2).notes.map((n) => n.palmMute)).toEqual([
      true,
      true,
    ]);
    expect(beatOf(result.after ?? built, 0, 0, 1).notes[0]?.palmMute).toBe(false);
  });

  it('puts a whole-beat note effect on the beats of the notes picked', () => {
    const built = riff();
    const result = apply(
      built,
      { noteIds: ids(built, [0, 2, 0]) },
      { kind: 'flag', flag: 'palmMute', wholeBeat: true },
    );
    expect(beatOf(result.after ?? built, 0, 0, 2).notes.map((n) => n.palmMute)).toEqual([
      true,
      true,
    ]);
  });

  it('puts a beat effect on the beats of the notes picked, once per beat', () => {
    const built = riff();
    const noteIds = ids(built, [0, 2, 0], [0, 2, 1]);
    const result = apply(built, { noteIds }, { kind: 'beatFlag', flag: 'tapping' });
    expect(beatOf(result.after ?? built, 0, 0, 2).effects.tapping).toBe(true);
    expect(result.applied?.change.patches).toHaveLength(1);
  });

  it('acts across tracks and voices as one undo step', () => {
    const built = editScore();
    const beatIds = [
      beatOf(built, 0, 0, 0).id,
      beatOf(built, 0, 1, 0).id,
      beatOf(built, 0, 1, 0, 1).id,
    ];
    const result = apply(built, { beatIds }, { kind: 'flag', flag: 'staccato' });
    expect(result.history?.steps).toHaveLength(1);
    expect(noteOf(result.after ?? built, 0, 1, 0, 0, 1).staccato).toBe(true);
    expect(result.history?.undo()?.score).toEqual(built);
  });

  it('refuses a rest and an empty selection with a plain sentence', () => {
    const built = score().track('guitar').bar().rest('1').build();
    const empty = planEffect({ score: built, state: state({}) }, palmMute);
    expect(empty).toEqual({ refused: 'Select a note first' });
    const onRest = planEffect(
      { score: built, state: state({ beatIds: [beatOf(built, 0, 0, 0).id] }) },
      palmMute,
    );
    expect(onRest).toEqual({ refused: 'Select a note first' });
  });

  it('refuses a fretted effect on a drum track, and allows accents and staccato there', () => {
    const built = score()
      .track('drums')
      .bar()
      .beat('4', [midi(38)])
      .build();
    const selection = { noteIds: [noteOf(built, 0, 0, 0).id] };
    expect(planEffect({ score: built, state: state(selection) }, palmMute)).toEqual({
      refused: 'That effect needs a fretted track',
    });
    expect(
      planEffect({ score: built, state: state(selection) }, { kind: 'accent', accent: 'heavy' }),
    ).toHaveProperty('command');
    expect(
      planEffect({ score: built, state: state(selection) }, { kind: 'beatFlag', flag: 'fadeIn' }),
    ).toHaveProperty('command');
  });
});

describe('planEffect: exclusive groups', () => {
  it('replaces a slide of the same group and keeps one of another', () => {
    const built = riff();
    const noteIds = ids(built, [0, 0, 0]);
    const out = apply(built, { noteIds }, { kind: 'slide', slide: 'outDown' });
    const legato = apply(out.after ?? built, { noteIds }, { kind: 'slide', slide: 'legato' });
    expect(noteOf(legato.after ?? built, 0, 0, 0).slide).toEqual(['outDown', 'legato']);
    const shift = apply(legato.after ?? built, { noteIds }, { kind: 'slide', slide: 'shift' });
    expect(noteOf(shift.after ?? built, 0, 0, 0).slide).toEqual(['outDown', 'shift']);
    const outUp = apply(shift.after ?? built, { noteIds }, { kind: 'slide', slide: 'outUp' });
    expect(noteOf(outUp.after ?? built, 0, 0, 0).slide).toEqual(['shift', 'outUp']);
  });

  it('removes the last slide kind as no slide at all', () => {
    const built = riff();
    const noteIds = ids(built, [0, 0, 0]);
    const on = apply(built, { noteIds }, { kind: 'slide', slide: 'legato' });
    const off = apply(on.after ?? built, { noteIds }, { kind: 'slide', slide: 'legato' });
    expect(off.after).toEqual(built);
    expect('slide' in noteOf(off.after ?? built, 0, 0, 0)).toBe(false);
  });

  it('keeps accent, vibrato, tapping and the fades each to one value', () => {
    const built = riff();
    const noteIds = ids(built, [0, 2, 0]);
    const accent = apply(built, { noteIds }, { kind: 'accent', accent: 'accent' });
    const heavy = apply(accent.after ?? built, { noteIds }, { kind: 'accent', accent: 'heavy' });
    expect(noteOf(heavy.after ?? built, 0, 0, 2).accent).toBe('heavy');
    const tap = apply(built, { noteIds }, { kind: 'beatFlag', flag: 'tapping' });
    const slap = apply(tap.after ?? built, { noteIds }, { kind: 'beatFlag', flag: 'slapping' });
    expect(beatOf(slap.after ?? built, 0, 0, 2).effects).toEqual({ slapping: true });
    const fade = apply(built, { noteIds }, { kind: 'beatFlag', flag: 'fadeIn' });
    const swell = apply(
      fade.after ?? built,
      { noteIds },
      { kind: 'beatFlag', flag: 'volumeSwell' },
    );
    expect(beatOf(swell.after ?? built, 0, 0, 2).effects).toEqual({ volumeSwell: true });
    const brush = apply(built, { noteIds }, { kind: 'brush', direction: 'down' });
    const arpeggio = apply(
      brush.after ?? built,
      { noteIds },
      { kind: 'arpeggio', direction: 'up' },
    );
    expect(beatOf(arpeggio.after ?? built, 0, 0, 2).effects).toEqual({
      arpeggio: { direction: 'up' },
    });
  });
});

describe('planEffect: connections', () => {
  it('hammer sets hammerPull on the next note on the string, across a bar line (D2)', () => {
    const built = riff();
    // String 1: bar 0 beat 3 (fret 7) is followed by bar 1 beat 0 (fret 9).
    const result = apply(built, { noteIds: ids(built, [0, 3, 0]) }, { kind: 'hammer' });
    expect(noteOf(result.after ?? built, 0, 1, 0).hammerPull).toBe(true);
    expect(noteOf(result.after ?? built, 0, 0, 3).hammerPull).toBe(false);
    expect(result.label).toBe('Hammer-on or pull-off');
    const again = apply(
      result.after ?? built,
      { noteIds: ids(built, [0, 3, 0]) },
      { kind: 'hammer' },
    );
    expect(again.after).toEqual(built);
  });

  it('skips notes with nothing to hammer to, and refuses when none has', () => {
    const built = riff();
    const result = apply(built, { noteIds: ids(built, [0, 3, 0], [1, 1, 0]) }, { kind: 'hammer' });
    expect(noteOf(result.after ?? built, 0, 1, 0).hammerPull).toBe(true);
    const last = planEffect(
      { score: built, state: state({ noteIds: ids(built, [1, 1, 0]) }) },
      { kind: 'hammer' },
    );
    expect(last).toEqual({ refused: 'Nothing to hammer to on string 2' });
  });

  it('refuses a shift slide with nothing to slide to', () => {
    const built = riff();
    expect(
      planEffect(
        { score: built, state: state({ noteIds: ids(built, [1, 1, 0]) }) },
        { kind: 'slide', slide: 'shift' },
      ),
    ).toEqual({ refused: 'Nothing to slide to on string 2' });
    const ok = apply(built, { noteIds: ids(built, [0, 3, 0]) }, { kind: 'slide', slide: 'shift' });
    expect(noteOf(ok.after ?? built, 0, 0, 3).slide).toEqual(['shift']);
  });

  it('lets a slide in or out stand alone', () => {
    const built = riff();
    const result = apply(
      built,
      { noteIds: ids(built, [1, 1, 0]) },
      { kind: 'slide', slide: 'intoFromBelow' },
    );
    expect(noteOf(result.after ?? built, 0, 1, 1).slide).toEqual(['intoFromBelow']);
  });
});

describe('planEffect: bends', () => {
  it('refuses a prebend on a tied note and allows a bend there', () => {
    const built = riff();
    const noteIds = ids(built, [1, 2, 0]);
    expect(
      planEffect(
        { score: built, state: state({ noteIds }) },
        { kind: 'bend', bend: bendPreset('prebend', 'full') },
      ),
    ).toEqual({ refused: 'A tied note continues its bend; put the prebend on the first note' });
    expect(
      planEffect(
        { score: built, state: state({ noteIds }) },
        { kind: 'bend', bend: bendPreset('bend', 'full') },
      ),
    ).toHaveProperty('command');
  });
});
