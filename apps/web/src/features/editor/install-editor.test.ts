import { write } from '@reprise/formats';
import type { Command } from '@reprise/model';
import { removeBeat } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { cursorAtPosition } from './cursor';
import { editScore } from './test/scores';

async function setup() {
  const services = createTestServices();
  // The app's own wiring: createAppServices calls installEditor.
  await services.document
    .getState()
    .openBytes('edit.reprise', (await write(editScore(), 'reprise')).bytes);
  const score = () => {
    const found = services.document.getState().score;
    if (!found) throw new Error('not open');
    return found;
  };
  const apply = (command: Command) => {
    services.document.getState().apply(command);
  };
  return { services, score, apply, state: () => services.selection.getState() };
}

describe('installEditor, as the services wire it', () => {
  it('puts the cursor on the first stop when edit mode turns on, once', async () => {
    const { services, state, score } = await setup();
    expect(state().cursor).toBeUndefined();
    services.editing.getState().setEditing(true);
    expect(state().cursor).toMatchObject({
      track: score().tracks[0]?.id,
      beat: score().tracks[0]?.bars[0]?.voices[0]?.beats[0]?.id,
    });
    const placed = state().cursor;
    services.editing.getState().setEditing(false);
    services.editing.getState().setEditing(true);
    expect(state().cursor).toBe(placed);
  });

  it('starts at the playhead, in the current track', async () => {
    const { services, state, score } = await setup();
    state().setCurrentTrack(score().tracks[1]?.id);
    services.playback.setState({
      position: {
        position: { playbackTick: 3840 + 960 },
        masterBarId: score().masterBars[1]?.id ?? '',
        seconds: 0,
        countingIn: false,
      },
    } as never);
    services.editing.getState().setEditing(true);
    expect(state().cursor).toMatchObject({
      track: score().tracks[1]?.id,
      at: { track: 1, bar: 1, beat: 1 },
    });
  });

  it('keeps the cursor on its beat through an edit elsewhere, and moves it off a removed beat', async () => {
    const { services, state, score, apply } = await setup();
    services.editing.getState().setEditing(true);
    const cursor = cursorAtPosition(
      score(),
      { track: 0, bar: 0, voice: 0, stop: 2 },
      { string: 3, staff: 'tab' },
    );
    state().setEdit({ cursor });
    const first = score().tracks[0]?.bars[0]?.voices[0]?.beats[0]?.id ?? '';
    apply(removeBeat({ beatId: first }));
    expect(state().cursor).toMatchObject({ beat: cursor?.beat, at: { beat: 1 } });
    const removed = cursor?.beat ?? '';
    apply(removeBeat({ beatId: removed }));
    expect(state().cursor?.beat).toBe(score().tracks[0]?.bars[0]?.voices[0]?.beats[1]?.id);
    expect(state().cursor?.at.beat).toBe(1);
    // Undo restores the beat with its id, and the cursor goes back onto it.
    services.document.getState().undo();
    expect(state().cursor?.beat).toBe(removed);
    expect(score().tracks[0]?.bars[0]?.voices[0]?.beats).toHaveLength(3);
  });

  it('follows the current track to the same bar and onset', async () => {
    const { services, state, score } = await setup();
    services.editing.getState().setEditing(true);
    state().setEdit({
      cursor: cursorAtPosition(
        score(),
        { track: 0, bar: 0, voice: 0, stop: 2 },
        { string: 3, staff: 'tab' },
      ),
    });
    state().setCurrentTrack(score().tracks[1]?.id);
    expect(state().cursor).toMatchObject({
      track: score().tracks[1]?.id,
      at: { track: 1, bar: 0, beat: 2 },
    });
  });

  it('stops watching when disposed', async () => {
    const { services, state } = await setup();
    services.dispose();
    services.editing.getState().setEditing(true);
    expect(state().cursor).toBeUndefined();
  });
});
