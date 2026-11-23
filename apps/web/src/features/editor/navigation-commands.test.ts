import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { dispatchShortcut } from '@/app/shortcut-dispatcher';
import { createTestServices } from '@/test/services';

import { cursorAtPosition, firstStop } from './cursor';
import { fullBarScore } from './test/entry-scores';
import { editScore } from './test/scores';

async function setup(built: Score = editScore()) {
  const services = createTestServices();
  const registry = createAppRegistry(services);
  await services.document
    .getState()
    .openBytes('edit.reprise', (await write(built, 'reprise')).bytes);
  const opened = services.document.getState().score;
  if (!opened) throw new Error('not open');
  const cursor = firstStop(opened, 0, 0);
  services.selection.getState().setEdit({ cursor, currentTrack: cursor?.track });
  const press = (key: string, init: KeyboardEventInit = {}) =>
    dispatchShortcut(new KeyboardEvent('keydown', { key, ...init }), registry, 'other');
  const at = () => services.selection.getState().cursor?.at;
  return { services, registry, opened, press, at };
}

describe('the edit navigation commands', () => {
  it('bind the transport keys in the editing context, so the arrows move the cursor while editing', async () => {
    const { services, press, at } = await setup();
    services.editing.getState().setEditing(true);
    press('ArrowRight');
    press('ArrowRight');
    expect(at()).toEqual({ track: 0, bar: 0, beat: 2 });
    press('ArrowLeft');
    expect(at()).toEqual({ track: 0, bar: 0, beat: 1 });
    press('End');
    expect(at()).toEqual({ track: 0, bar: 0, beat: 3 });
    press('Home');
    expect(at()?.beat).toBe(0);
    press('ArrowRight', { ctrlKey: true });
    expect(at()).toEqual({ track: 0, bar: 1, beat: 0 });
    press('End', { ctrlKey: true });
    expect(at()).toEqual({ track: 0, bar: 2, beat: 0 });
    press('Home', { ctrlKey: true });
    expect(at()).toEqual({ track: 0, bar: 0, beat: 0 });
  });

  it('leave the keys to transport in play mode, and do nothing without a cursor', async () => {
    const { services, press, at } = await setup();
    press('ArrowRight');
    expect(at()).toEqual({ track: 0, bar: 0, beat: 0 });
    services.editing.getState().setEditing(true);
    services.selection.getState().setEdit({ cursor: undefined });
    expect(press('ArrowRight')).toBe(true);
    expect(services.selection.getState().cursor).toBeUndefined();
  });

  it('moves the string with the up and down arrows, clamped', async () => {
    const { services, press } = await setup();
    services.editing.getState().setEditing(true);
    const string = () => services.selection.getState().cursor?.string;
    press('ArrowUp');
    expect(string()).toBe(1);
    press('ArrowDown');
    press('ArrowDown');
    expect(string()).toBe(3);
  });

  it('extends a range with Shift, makes the cursor its moving end, and Escape clears it', async () => {
    const { services, press, at, opened } = await setup();
    services.editing.getState().setEditing(true);
    press('ArrowRight', { shiftKey: true });
    press('ArrowRight', { shiftKey: true });
    const state = services.selection.getState();
    expect(state.range?.kind).toBe('beats');
    expect(state.range?.anchor.beat).toBe(opened.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.id);
    expect(state.range?.focus.beat).toBe(opened.tracks[0]?.bars[0]?.voices[0]?.beats[2]?.id);
    expect(at()?.beat).toBe(2);
    expect(state.bars).toEqual({
      startBar: opened.masterBars[0]?.id,
      endBar: opened.masterBars[0]?.id,
    });
    press('ArrowDown', { shiftKey: true });
    expect(services.selection.getState().range?.focus.track).toBe(opened.tracks[1]?.id);
    press('Escape');
    expect(services.selection.getState().range).toBeUndefined();
    expect(services.selection.getState().bars).toBeUndefined();
    expect(at()?.track).toBe(1);
  });

  it('clears the range on a plain move, and extends by bars with Ctrl+Shift', async () => {
    const { services, press } = await setup();
    services.editing.getState().setEditing(true);
    press('ArrowRight', { ctrlKey: true, shiftKey: true });
    expect(services.selection.getState().range).toMatchObject({ kind: 'bars' });
    press('ArrowRight');
    expect(services.selection.getState().range).toBeUndefined();
  });

  it('follows the current track', async () => {
    const { services, press, opened } = await setup();
    services.editing.getState().setEditing(true);
    press('ArrowDown', { shiftKey: true });
    expect(services.selection.getState().currentTrack).toBe(opened.tracks[1]?.id);
  });

  it('keeps them out of the palette and registered once, shadowing transport only while editing', async () => {
    const { services, registry } = await setup();
    const move = registry.get('editor.nextBeat');
    const transport = registry.get('transport.nextBeat');
    if (!move || !transport) throw new Error('missing');
    expect(move.inPalette).toBe(false);
    expect(registry.isShadowed(transport)).toBe(false);
    services.editing.getState().setEditing(true);
    expect(registry.isShadowed(transport)).toBe(true);
    expect(registry.available()).toContain(move);
  });

  it('appends a bar with → past a full last bar, as its own undo step, and only there', async () => {
    const { services, press, at } = await setup();
    services.editing.getState().setEditing(true);
    const bars = () => services.document.getState().score?.masterBars.length ?? 0;
    // The edit score's last bar is empty: → stops at its end slot.
    press('ArrowRight', { ctrlKey: true });
    press('ArrowRight', { ctrlKey: true });
    expect(at()).toMatchObject({ bar: 2 });
    press('ArrowRight');
    expect(bars()).toBe(3);

    const full = await setup(fullBarScore());
    full.services.editing.getState().setEditing(true);
    const lastBeat = cursorAtPosition(
      full.opened,
      { track: 0, bar: 0, voice: 0, stop: 3 },
      { string: 1, staff: 'tab' },
    );
    full.services.selection.getState().setEdit({ cursor: lastBeat });
    const revision = full.services.document.getState().revision;
    full.press('ArrowRight');
    const after = full.services.document.getState();
    expect(after.score?.masterBars).toHaveLength(2);
    expect(after.revision).toBe(revision + 1);
    expect(full.at()).toMatchObject({ bar: 1, beat: 0 });
    after.undo();
    expect(full.services.document.getState().score?.masterBars).toHaveLength(1);
  });
});

describe('Switch staff', () => {
  it('moves the cursor between the tab and standard staves of a track shown in both', async () => {
    const built = fullBarScore();
    const track = built.tracks[0];
    if (!track) throw new Error('no track');
    const { services, registry } = await setup({
      ...built,
      tracks: [{ ...track, display: { ...track.display, notation: 'both' } }],
    });
    services.editing.getState().setEditing(true);
    const switchStaff = registry.get('editor.switchStaff');
    expect(switchStaff).toMatchObject({ title: 'Switch staff', context: 'editing' });
    expect(switchStaff?.shortcut).toBeUndefined();
    const staff = () => services.selection.getState().cursor?.staff;
    const before = staff();
    void switchStaff?.run();
    expect(staff()).not.toBe(before);
    void switchStaff?.run();
    expect(staff()).toBe(before);
  });

  it('does nothing on a track shown in one notation', async () => {
    const { services, registry } = await setup(fullBarScore());
    services.editing.getState().setEditing(true);
    const before = services.selection.getState().cursor?.staff;
    void registry.get('editor.switchStaff')?.run();
    expect(services.selection.getState().cursor?.staff).toBe(before);
  });
});
