import { write } from '@reprise/formats';
import {
  insertBar,
  removeBeat,
  setNote,
  setTrackProperties,
  type Command,
  type Score,
} from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { copySelection, pasteClip } from './clipboard-actions';
import { barsRange, clipboardScore, cursorAt } from './test/clip-scores';
import { must } from './test/must';

async function setup() {
  const services = createTestServices();
  await services.document
    .getState()
    .openBytes('land.reprise', (await write(clipboardScore(), 'reprise')).bytes);
  services.editing.getState().setEditing(true);
  const score = (): Score => must(services.document.getState().score, 'score');
  const state = () => services.selection.getState();
  const goTo = (track: number, bar: number, stop: number, string = 1) => {
    const cursor = cursorAt(score(), track, bar, stop, 0, string);
    state().setEdit({ cursor, currentTrack: cursor.track });
  };
  const apply = (command: Command) => {
    services.document.getState().apply(command);
  };
  const at = () => state().cursor?.at;
  return { services, score, state, goTo, apply, at };
}

describe('the cursor after an undo or a redo', () => {
  it('returns to the beat an undone delete brought back, and leaves it on a redo', async () => {
    const { services, score, goTo, apply, at, state } = await setup();
    const target = must(score().tracks[0]?.bars[0]?.voices[0]?.beats[2]).id;
    apply(removeBeat({ beatId: target }));
    goTo(0, 0, 0);
    services.document.getState().undo();
    expect(state().cursor?.beat).toBe(target);
    expect(at()).toEqual({ track: 0, bar: 0, beat: 2 });
    goTo(0, 1, 0);
    services.document.getState().redo();
    // The beat is gone again: the cursor takes the stop that took its place.
    expect(at()).toEqual({ track: 0, bar: 0, beat: 2 });
    expect(state().cursor?.beat).not.toBe(target);
  });

  it('lands on the beat and the string of an undone note entry', async () => {
    const { services, score, goTo, apply, at, state } = await setup();
    const rest = must(score().tracks[0]?.bars[1]?.voices[0]?.beats[1]).id;
    apply(setNote({ beatId: rest }, { string: 3, fret: 2 }));
    goTo(0, 0, 0, 1);
    services.document.getState().undo();
    expect(state().cursor?.beat).toBe(rest);
    expect(at()).toEqual({ track: 0, bar: 1, beat: 1 });
  });

  it('lands on the bar an undone insert-bar patch names', async () => {
    const { services, goTo, apply, at } = await setup();
    apply(insertBar({ index: 2 }));
    goTo(0, 0, 1);
    services.document.getState().undo();
    // The inserted bar is gone: the cursor is reconciled, never left on a missing bar.
    expect(at()).toMatchObject({ track: 0 });
    services.document.getState().redo();
    expect(at()).toMatchObject({ track: 0, bar: 2, beat: 0 });
  });

  it('lands on the first pasted position after an undone paste, even from another track', async () => {
    const { services, goTo, at, score } = await setup();
    goTo(0, 0, 0);
    const clip = must(copySelection(services));
    goTo(1, 2, 0);
    expect(pasteClip(services, clip, 'overwrite')).toBe(true);
    goTo(0, 4, 0);
    services.document.getState().undo();
    expect(at()).toEqual({ track: 1, bar: 2, beat: 0 });
    expect(score().tracks[1]?.bars[2]?.voices[0]?.beats).toHaveLength(0);
    goTo(0, 4, 0);
    services.document.getState().redo();
    expect(at()).toEqual({ track: 1, bar: 2, beat: 0 });
  });

  it('lands on the first pasted bar of a bars paste', async () => {
    const { services, goTo, at, state, score } = await setup();
    state().setEdit({ range: barsRange(score(), { first: 0, from: 0, to: 0 }) });
    const clip = must(copySelection(services));
    goTo(1, 3, 0);
    state().setEdit({ range: undefined });
    expect(pasteClip(services, clip, 'overwrite')).toBe(true);
    goTo(0, 0, 0);
    services.document.getState().undo();
    expect(at()).toMatchObject({ track: 1, bar: 3 });
  });

  it('leaves the cursor alone after a track-property undo', async () => {
    const { services, score, goTo, apply, at } = await setup();
    goTo(0, 1, 1);
    const before = at();
    apply(setTrackProperties({ trackId: must(score().tracks[1]).id }, { name: 'Other' }));
    services.document.getState().undo();
    expect(at()).toEqual(before);
    services.document.getState().redo();
    expect(at()).toEqual(before);
  });

  it('does nothing without a cursor', async () => {
    const { services, apply, score, state } = await setup();
    state().setEdit({ cursor: undefined });
    apply(removeBeat({ beatId: must(score().tracks[0]?.bars[0]?.voices[0]?.beats[0]).id }));
    services.document.getState().undo();
    expect(state().cursor).toBeUndefined();
  });
});
