import { applyCommand, type Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { cursorAtPosition } from './cursor';
import { historyLabel } from './history-labels';
import { planRespell } from './respell';
import { drumScore } from './test/drum-scores';
import { keysScore } from './test/key-scores';

const stateAt = (built: Score, stop: number, bar = 0, extra = {}) => ({
  cursor: cursorAtPosition(
    built,
    { track: 0, bar, voice: 0, stop },
    { string: 1, staff: 'tab', ...extra },
  ),
  range: undefined,
  selection: {},
});

describe('planRespell', () => {
  it('flips the note under the cursor and back, as one step named Respell', () => {
    const built = score().track('guitar');
    // String 2 fret 11 is A# in C major.
    built.bar().beat('4', [note(2, 11)]);
    const sharp = built.build({ ids: 'sequential' });
    const plan = planRespell({ score: sharp, state: stateAt(sharp, 0, 0, { string: 2 }) });
    if (!('command' in plan)) throw new Error('refused');
    expect(historyLabel(plan.command.name)).toBe('Respell');
    const flat = applyCommand(sharp, plan.command).score;
    expect(flat.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.notes[0]?.accidental).toBe('flat');
    const again = planRespell({ score: flat, state: stateAt(flat, 0, 0, { string: 2 }) });
    if (!('command' in again)) throw new Error('refused');
    expect(
      applyCommand(flat, again.command).score.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.notes[0]
        ?.accidental,
    ).toBeUndefined();
  });

  it('respells a keyboard note by the lane, and only that one of a chord', () => {
    const keys = keysScore();
    const plan = planRespell({ score: keys, state: stateAt(keys, 1, 1, { pitch: 72 }) });
    if (!('command' in plan)) throw new Error('refused');
    const notes = applyCommand(keys, plan.command).score.tracks[0]?.bars[1]?.voices[0]?.beats[1]
      ?.notes;
    // C5 is written B sharp; E5 beside it is untouched.
    expect(notes?.find((n) => n.fret === 72)?.accidental).toBe('sharp');
    expect(notes?.find((n) => n.fret === 76)?.accidental).toBeUndefined();
  });

  it('refuses with nothing under the cursor, and on drum notes', () => {
    const empty = score().track('guitar');
    empty.bar();
    const nothing = empty.build({ ids: 'sequential' });
    expect(planRespell({ score: nothing, state: stateAt(nothing, 0) })).toEqual({
      refused: 'Select a note first',
    });
    const kit = drumScore();
    const state = { ...stateAt(kit, 0, 1), selection: {} };
    const plan = planRespell({ score: kit, state });
    expect('refused' in plan).toBe(true);
  });
});
