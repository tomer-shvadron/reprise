import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { dispatchShortcut } from '@/app/shortcut-dispatcher';
import { createTestServices } from '@/test/services';

import { cursorAtPosition } from './cursor';
import { fullBarScore } from './test/entry-scores';

async function setup(built: Score = fullBarScore()) {
  const services = createTestServices();
  const registry = createAppRegistry(services);
  await services.document
    .getState()
    .openBytes('entry.reprise', (await write(built, 'reprise')).bytes);
  const score = () => {
    const found = services.document.getState().score;
    if (!found) throw new Error('not open');
    return found;
  };
  const goTo = (bar: number, stop: number, string = 1, voice = 0) => {
    const cursor = cursorAtPosition(
      score(),
      { track: 0, bar, voice, stop },
      { string, staff: 'tab' },
    );
    services.selection.getState().setEdit({ cursor, currentTrack: cursor?.track });
  };
  goTo(0, 0);
  const press = (key: string, init: KeyboardEventInit = {}, platform: 'mac' | 'other' = 'other') =>
    dispatchShortcut(
      new KeyboardEvent('keydown', { key, cancelable: true, ...init }),
      registry,
      platform,
    );
  const beats = (bar = 0, voice = 0) => score().tracks[0]?.bars[bar]?.voices[voice]?.beats ?? [];
  return { services, registry, score, goTo, press, beats };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the note entry commands', () => {
  it('bind Guitar Pro keys in the editing context only, digits and key-less insert toggle out of the palette', async () => {
    const { services, registry, press, beats } = await setup();
    // Play mode: the digit is nothing.
    expect(press('5')).toBe(false);
    expect(beats(0)).toHaveLength(4);
    services.editing.getState().setEditing(true);
    const digit = registry.get('editor.fret5');
    expect(digit).toMatchObject({ context: 'editing', inPalette: false, repeat: false });
    expect(registry.get('editor.toggleInsertMode')?.shortcut).toBeUndefined();
    expect(registry.get('editor.toggleInsertMode')?.inPalette).not.toBe(false);
    expect(press('5')).toBe(true);
    expect(beats(0)[0]?.notes[0]?.fret).toBe(5);
  });

  it('toggles edit mode with Cmd or Ctrl+E', async () => {
    const { services, press } = await setup();
    press('e', { metaKey: true }, 'mac');
    expect(services.editing.getState().editing).toBe(true);
    press('e', { ctrlKey: true });
    expect(services.editing.getState().editing).toBe(false);
  });

  it('types a two-digit fret, and a lone digit after the window', async () => {
    const { services, press, beats } = await setup();
    services.editing.getState().setEditing(true);
    press('1');
    press('2');
    expect(beats(0)[0]?.notes[0]?.fret).toBe(12);
    press('3');
    expect(beats(0)[0]?.notes[0]?.fret).toBe(3);
  });

  it('changes duration, dot and triplet of the beat under the cursor', async () => {
    const { services, press, beats, goTo } = await setup();
    services.editing.getState().setEditing(true);
    press('=');
    expect(beats(0)[0]?.duration).toBe(8);
    press('-');
    expect(beats(0)[0]?.duration).toBe(4);
    press('+', { shiftKey: true });
    expect(beats(0)[0]?.duration).toBe(8);
    press('+');
    expect(beats(0)[0]?.duration).toBe(16);
    press('.');
    expect(beats(0)[0]?.dots).toBe(1);
    press('.', { ctrlKey: true });
    expect(beats(0)[0]?.dots).toBe(2);
    press('.', { ctrlKey: true });
    press('/');
    expect(beats(0)[0]?.tuplet).toEqual({ n: 3, of: 2 });
    goTo(0, 1);
    press('/');
    expect(beats(0)[1]?.tuplet).toBeDefined();
  });

  it('inserts a rest with Enter and R, deletes a note and a beat', async () => {
    const { services, press, beats, goTo } = await setup();
    services.editing.getState().setEditing(true);
    goTo(0, 1);
    press('r');
    expect(beats(0)[1]?.rest).toBe(true);
    goTo(0, 0);
    press('Backspace');
    expect(beats(0)[0]?.rest).toBe(true);
    goTo(0, 2, 3);
    press('Delete');
    expect(beats(0)[2]?.rest).toBe(true);
    press('Backspace', { shiftKey: true }, 'mac');
    expect(beats(0)).toHaveLength(3);
    press('Delete', { shiftKey: true });
    expect(beats(0)).toHaveLength(2);
    // Shift+Delete is Windows' key and Shift+Backspace the Mac's.
    press('Delete', { shiftKey: true }, 'mac');
    expect(beats(0)).toHaveLength(2);
  });

  it('shows the room left when Enter would overfill the bar, and edits nothing', async () => {
    const { services, press, beats } = await setup();
    services.editing.getState().setEditing(true);
    const before = services.document.getState().revision;
    press('Enter');
    expect(services.document.getState().revision).toBe(before);
    expect(beats(0)).toHaveLength(4);
    expect(services.entry.getState().message).toBe('Bar 1 is full: a quarter does not fit');
  });

  it('moves between voices with Cmd or Ctrl+1 and 2', async () => {
    const { services, press } = await setup();
    services.editing.getState().setEditing(true);
    press('2', { ctrlKey: true });
    expect(services.selection.getState().cursor?.voice).toBe(1);
    press('1', { metaKey: true }, 'mac');
    expect(services.selection.getState().cursor?.voice).toBe(0);
  });

  it('toggles insert mode from the palette command, with no key', async () => {
    const { services, registry } = await setup();
    services.editing.getState().setEditing(true);
    await registry.get('editor.toggleInsertMode')?.run();
    expect(services.entry.getState().mode).toBe('insert');
    await registry.get('editor.toggleInsertMode')?.run();
    expect(services.entry.getState().mode).toBe('overwrite');
  });

  it('leaves Backspace and Delete to a focused text field, and everything to an open modal', async () => {
    const { services, registry, goTo, beats } = await setup();
    services.editing.getState().setEditing(true);
    goTo(0, 1);
    const input = document.createElement('input');
    input.type = 'text';
    document.body.append(input);
    input.addEventListener('keydown', (event) => {
      dispatchShortcut(event, registry, 'other');
    });
    for (const key of ['Backspace', 'Delete', '5']) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', shiftKey: true, bubbles: true }),
    );
    expect(beats(0)[1]?.rest).toBe(false);
    expect(beats(0)[1]?.notes[0]?.fret).toBe(1);

    input.remove();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.dataset.state = 'open';
    document.body.append(dialog);
    const press = (key: string) =>
      dispatchShortcut(new KeyboardEvent('keydown', { key, cancelable: true }), registry, 'other');
    expect(press('5')).toBe(false);
    expect(press('Backspace')).toBe(false);
    expect(beats(0)[1]?.notes[0]?.fret).toBe(1);
  });
});
