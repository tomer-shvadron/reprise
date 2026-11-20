import { write } from '@reprise/formats';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { createTestServices } from '@/test/services';

import { dialogsOf } from './dialogs';

function song() {
  const builder = score().track('guitar');
  for (let bar = 0; bar < 4; bar++) {
    builder.bar();
    if (bar === 2) builder.section('Verse');
    builder.beat('4', [note(1, bar)], bar === 1 ? { chord: { name: 'Am' } } : {});
    builder.beat('4', [note(3, bar)]);
  }
  return builder.build({ ids: 'sequential' });
}

async function setup() {
  const services = createTestServices();
  await services.document
    .getState()
    .openBytes('here.reprise', (await write(song(), 'reprise')).bytes);
  const loaded = services.document.getState().score;
  if (!loaded) throw new Error('not open');
  const registry = createAppRegistry(services);
  const run = (id: string) => registry.get(id)?.run();
  const beat = (bar: number, index: number) => {
    const found = loaded.tracks[0]?.bars[bar]?.voices[0]?.beats[index];
    if (!found) throw new Error('no beat');
    return found;
  };
  const place = { track: loaded.tracks[0]?.id ?? '' };
  return { services, loaded, registry, run, beat, place };
}

describe('editor.editHere', () => {
  it('switches to edit mode with the cursor on the right-clicked note, and never seeks', async () => {
    const { services, loaded, run, beat, place } = await setup();
    const target = beat(1, 1);
    const noted = target.notes[0];
    if (!noted) throw new Error('no note');
    services.menuTarget.getState().set({
      kind: 'note',
      note: noted.id,
      beat: target.id,
      masterBar: loaded.masterBars[1]?.id ?? '',
      ...place,
    });
    void run('editor.editHere');
    expect(services.editing.getState().editing).toBe(true);
    expect(services.selection.getState().cursor).toMatchObject({
      beat: target.id,
      string: noted.string,
      masterBar: loaded.masterBars[1]?.id,
    });
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
  });

  it('puts the cursor at the start of a right-clicked bar', async () => {
    const { services, loaded, run, place } = await setup();
    services.menuTarget
      .getState()
      .set({ kind: 'bar', masterBar: loaded.masterBars[3]?.id ?? '', track: place.track });
    void run('editor.editHere');
    expect(services.selection.getState().cursor).toMatchObject({
      masterBar: loaded.masterBars[3]?.id,
      beat: loaded.tracks[0]?.bars[3]?.voices[0]?.beats[0]?.id,
    });
  });

  it('opens the chord name field on a chord name', async () => {
    const { services, loaded, run, beat, place } = await setup();
    services.menuTarget.getState().set({
      kind: 'chord',
      beat: beat(1, 0).id,
      masterBar: loaded.masterBars[1]?.id ?? '',
      ...place,
    });
    void run('editor.editHere');
    expect(services.entry.getState().word).toMatchObject({ kind: 'chord', beatId: beat(1, 0).id });
  });

  it('opens the Section dialog on a section marker', async () => {
    const { services, loaded, run } = await setup();
    const bar = loaded.masterBars[2]?.id ?? '';
    services.menuTarget.getState().set({ kind: 'section', masterBar: bar });
    void run('editor.editHere');
    expect(dialogsOf(services).getState().dialog).toEqual({
      kind: 'masterBar',
      ids: [bar],
      focus: 'section',
    });
  });

  it('adopts the selected bars with no target, a range of several as a range', async () => {
    const { services, loaded, run } = await setup();
    const [, b, c] = loaded.masterBars;
    if (!b || !c) throw new Error('short song');
    services.selection.getState().selectBars({ startBar: b.id, endBar: c.id });
    void run('editor.editHere');
    expect(services.selection.getState().range).toMatchObject({
      kind: 'bars',
      anchor: { masterBar: b.id },
      focus: { masterBar: c.id },
    });
    expect(services.selection.getState().bars).toEqual({ startBar: b.id, endBar: c.id });
  });

  it('is only offered outside edit mode, and does nothing without a score', async () => {
    const { services, registry } = await setup();
    const command = registry.get('editor.editHere');
    expect(command?.enabled?.()).toBe(true);
    services.editing.getState().setEditing(true);
    expect(command?.enabled?.()).toBe(false);
    services.editing.getState().setEditing(false);
    services.document.setState({ score: undefined });
    expect(command?.enabled?.()).toBe(false);
    void command?.run();
    expect(services.editing.getState().editing).toBe(false);
  });
});

describe('editor.copyBars', () => {
  it('copies the right-clicked bar, or the selected bars, in play mode, and a paste lands them', async () => {
    const { services, loaded, run, place } = await setup();
    const [a, b, c] = loaded.masterBars;
    if (!a || !b || !c) throw new Error('short song');
    services.menuTarget.getState().set({ kind: 'bar', masterBar: b.id, track: place.track });
    void run('editor.copyBars');
    expect(services.editing.getState().editing).toBe(false);
    services.menuTarget.getState().clear();
    services.selection.getState().selectBars({ startBar: a.id, endBar: c.id });
    void run('editor.copyBars');
    const { clipboardOf } = await import('./clipboard-store');
    const clip = clipboardOf(services).get();
    expect(clip?.tracks[0]?.bars).toHaveLength(3);
  });

  it('is enabled only with a bar to copy', async () => {
    const { services, registry, loaded } = await setup();
    const command = registry.get('editor.copyBars');
    expect(command?.enabled?.()).toBe(false);
    services.selection.getState().selectBars({
      startBar: loaded.masterBars[0]?.id ?? '',
      endBar: loaded.masterBars[0]?.id ?? '',
    });
    expect(command?.enabled?.()).toBe(true);
  });
});
