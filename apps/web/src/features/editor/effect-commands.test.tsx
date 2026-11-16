import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { dispatchShortcut } from '@/app/shortcut-dispatcher';
import { createTestServices } from '@/test/services';

import { cursorAtPosition } from './cursor';

function riff(): Score {
  const built = score().track('guitar');
  built
    .bar()
    .beat('4', [note(1, 5)])
    .beat('4', [note(2, 7), note(3, 0)])
    .beat('4', [note(1, 9)])
    .beat('4', [note(4, 2)]);
  return built.build({ ids: 'sequential' });
}

async function setup() {
  const services = createTestServices();
  const registry = createAppRegistry(services);
  await services.document
    .getState()
    .openBytes('effects.reprise', (await write(riff(), 'reprise')).bytes);
  const goTo = (stop: number, string = 1) => {
    const current = services.document.getState().score;
    if (!current) throw new Error('not open');
    const cursor = cursorAtPosition(
      current,
      { track: 0, bar: 0, voice: 0, stop },
      { string, staff: 'tab' },
    );
    services.selection.getState().setEdit({ cursor, currentTrack: cursor?.track });
  };
  goTo(0);
  const press = (key: string, init: KeyboardEventInit = {}) =>
    dispatchShortcut(
      new KeyboardEvent('keydown', { key, cancelable: true, ...init }),
      registry,
      'other',
    );
  const beats = () =>
    services.document.getState().score?.tracks[0]?.bars[0]?.voices[0]?.beats ?? [];
  return { services, registry, goTo, press, beats };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the effect commands', () => {
  it('are bound in the editing context only: a bare key does nothing in play mode', async () => {
    const { services, press, beats } = await setup();
    expect(press('p')).toBe(false);
    expect(beats()[0]?.notes[0]?.palmMute).toBe(false);
    services.editing.getState().setEditing(true);
    expect(press('p')).toBe(true);
    expect(beats()[0]?.notes[0]?.palmMute).toBe(true);
    expect(press('p')).toBe(true);
    expect(beats()[0]?.notes[0]?.palmMute).toBe(false);
  });

  it('does not fire a bare key typed in a text field', async () => {
    const { services, registry, beats } = await setup();
    services.editing.getState().setEditing(true);
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    let handled: boolean | undefined;
    field.addEventListener('keydown', (event) => {
      handled = dispatchShortcut(event, registry, 'other');
    });
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }),
    );
    expect(handled).toBe(false);
    expect(beats()[0]?.notes[0]?.palmMute).toBe(false);
  });

  it('applies one undo step per key, with the cursor left where it was', async () => {
    const { services, press, goTo, beats } = await setup();
    services.editing.getState().setEditing(true);
    goTo(1, 2);
    const before = services.selection.getState().cursor;
    press('x');
    expect(beats()[1]?.notes.find((n) => n.string === 2)?.dead).toBe(true);
    expect(services.selection.getState().cursor).toEqual(before);
    services.document.getState().undo();
    expect(beats()[1]?.notes.find((n) => n.string === 2)?.dead).toBe(false);
  });

  it('puts a note effect on every note of a beat the cursor has no note on', async () => {
    const { services, press, goTo, beats } = await setup();
    services.editing.getState().setEditing(true);
    goTo(1, 5);
    press('o');
    expect(beats()[1]?.notes.map((n) => n.ghost)).toEqual([true, true]);
  });

  it('binds both spellings of a punctuation key, listing the shifted one', async () => {
    const { services, registry, press, beats } = await setup();
    services.editing.getState().setEditing(true);
    expect(press(':', { shiftKey: true })).toBe(true);
    expect(beats()[0]?.notes[0]?.accent).toBe('heavy');
    expect(press(':')).toBe(true);
    expect(beats()[0]?.notes[0]?.accent).toBe('none');
    expect(registry.get('editor.effect.heavyAccent')?.shortcut).toEqual({ key: ':', shift: true });
    expect(registry.get('editor.effect.heavyAccentUnshifted')?.inPalette).toBe(false);
    expect(press(';')).toBe(true);
    expect(beats()[0]?.notes[0]?.accent).toBe('accent');
    expect(press('!', { shiftKey: true })).toBe(true);
    expect(press('!')).toBe(true);
    expect(beats()[0]?.notes[0]?.staccato).toBe(false);
  });

  it('sets a beat effect with a Shift or Ctrl chord', async () => {
    const { services, press, beats } = await setup();
    services.editing.getState().setEditing(true);
    expect(press('D', { shiftKey: true })).toBe(true);
    expect(beats()[0]?.effects.pickStroke).toBe('down');
    expect(press('d', { ctrlKey: true })).toBe(true);
    expect(beats()[0]?.effects.brush).toEqual({ direction: 'down' });
    expect(press('D', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(beats()[0]?.effects).toMatchObject({ arpeggio: { direction: 'down' } });
    expect(beats()[0]?.effects.brush).toBeUndefined();
  });

  it('sets hammerPull on the next note on the string, and reports a refusal on the status line', async () => {
    const { services, press, goTo, beats } = await setup();
    services.editing.getState().setEditing(true);
    press('h');
    expect(beats()[2]?.notes[0]?.hammerPull).toBe(true);
    goTo(3, 4);
    press('h');
    expect(services.entry.getState().message).toBe('Nothing to hammer to on string 4');
  });

  it('commits a digit still waiting before it acts, so one then P mutes the note entered', async () => {
    const { services, press, goTo, beats } = await setup();
    services.editing.getState().setEditing(true);
    goTo(0, 2);
    expect(press('3')).toBe(true);
    press('p');
    expect(beats()[0]?.notes.find((n) => n.string === 2)).toMatchObject({
      fret: 3,
      palmMute: true,
    });
  });

  it('lists every key in the palette with the same title and refuses nothing silently', async () => {
    const { registry } = await setup();
    const titles = registry
      .list()
      .filter((command) => command.id.startsWith('editor.effect.') && command.inPalette !== false)
      .map((command) => command.title);
    expect(titles).toContain('Toggle palm mute');
    expect(titles).toContain('Bend: Full prebend and release');
    expect(new Set(titles).size).toBe(titles.length);
  });
});
