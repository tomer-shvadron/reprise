import { score, note, noteOf } from '@reprise/model/testing';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { historyLabel } from './history-labels';
import { setupEffects } from './test/effects';

const alt = { altKey: true };
const altShift = { altKey: true, shiftKey: true };

describe('the transpose and string keys', () => {
  it('Alt+Shift+Up and Down move the selected note a semitone, one undo step each', async () => {
    const { services, press, beats } = await setupEffects();
    const before = services.document.getState().revision;
    expect(press('ArrowUp', altShift)).toBe(true);
    expect(beats()[0]?.notes[0]?.fret).toBe(6);
    expect(press('ArrowDown', altShift)).toBe(true);
    expect(press('ArrowDown', altShift)).toBe(true);
    expect(beats()[0]?.notes[0]?.fret).toBe(4);
    expect(services.document.getState().revision).toBe(before + 3);
    expect(services.document.getState().undoLabel).toBe('Transpose');
    // Only the note under the cursor moved; the chord beat's notes did not.
    expect(beats()[1]?.notes.map((n) => n.fret)).toEqual([7, 0]);
  });

  it('refuses a note that would fall off the neck on the status line, leaving the score as it was', async () => {
    const { services, press, goTo, beats } = await setupEffects();
    goTo(3, 4);
    const before = services.document.getState().revision;
    for (let step = 0; step < 2; step++) press('ArrowDown', altShift);
    expect(beats()[3]?.notes[0]?.fret).toBe(0);
    press('ArrowDown', altShift);
    expect(services.entry.getState().message).toMatch(
      /Track 1, bar 1, string 4: fret 0 cannot go down 1 semitone/,
    );
    expect(services.document.getState().revision).toBe(before + 2);
  });

  it('with nothing selected, says to select a note', async () => {
    const { services, press } = await setupEffects();
    act(() => {
      services.selection.getState().setEdit({ cursor: undefined });
    });
    press('ArrowUp', altShift);
    expect(services.entry.getState().message).toBe('Select a note first');
  });

  it('Alt+Down and Alt+Up move the note to the next string and the cursor follows it', async () => {
    const { services, press, goTo, beats } = await setupEffects();
    goTo(2, 1);
    expect(press('ArrowDown', alt)).toBe(true);
    expect(beats()[2]?.notes[0]).toMatchObject({ string: 2, fret: 14 });
    expect(services.selection.getState().cursor?.string).toBe(2);
    expect(press('ArrowDown', alt)).toBe(true);
    expect(beats()[2]?.notes[0]).toMatchObject({ string: 3, fret: 18 });
    expect(historyLabel(services.document.getState().undoLabel ?? '')).toBe('Move to next string');
    press('ArrowUp', alt);
    expect(beats()[2]?.notes[0]).toMatchObject({ string: 2, fret: 14 });
  });

  it('refuses the top string on the status line', async () => {
    const { services, press, beats } = await setupEffects();
    press('ArrowUp', alt);
    expect(services.entry.getState().message).toBe('There is no string above string 1');
    expect(beats()[0]?.notes[0]).toMatchObject({ string: 1, fret: 5 });
  });

  it('are left to a text field: Alt+Up in an input moves no note', async () => {
    const { press, beats } = await setupEffects();
    const input = document.createElement('input');
    document.body.append(input);
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, cancelable: true });
    input.dispatchEvent(event);
    expect(beats()[0]?.notes[0]?.fret).toBe(5);
    expect(press('x')).toBeDefined();
    input.remove();
  });

  it('do nothing outside edit mode', async () => {
    const { services, press, beats } = await setupEffects();
    services.editing.getState().setEditing(false);
    expect(press('ArrowUp', altShift)).toBe(false);
    expect(beats()[0]?.notes[0]?.fret).toBe(5);
  });
});

describe('a note tied across a bar line', () => {
  it('moves with its origin when a key transposes it', async () => {
    const built = score();
    built.track('guitar');
    built.bar().beat('1', [note(1, 5)]);
    built.bar().beat('1', [note(1, 5, { tie: true })]);
    const { services, press } = await setupEffects(undefined, built.build({ ids: 'sequential' }));
    press('ArrowUp', altShift);
    const after = services.document.getState().score;
    expect(after && noteOf(after, 0, 1, 0)).toMatchObject({ fret: 6, tie: true });
  });
});
