import { write } from '@reprise/formats';
import { setTrackProperties } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { runCommand } from '@/app/command-registry';
import { formatShortcut } from '@/app/keyboard';
import { mirrorAudio } from '@/test/mirror-audio';
import { createTestServices } from '@/test/services';

async function setup(open = true) {
  const services = createTestServices();
  mirrorAudio(services);
  const registry = createAppRegistry(services);
  if (open) {
    const song = score().track('guitar').track('bass').track('drums').build();
    await services.document
      .getState()
      .openBytes('song.reprise', (await write(song, 'reprise')).bytes);
  }
  const ids = services.document.getState().score?.tracks.map((track) => track.id) ?? [];
  const run = async (id: string) => {
    const command = registry.get(id);
    if (!command) throw new Error(`no ${id}`);
    runCommand(command);
    await Promise.resolve();
  };
  return { services, registry, ids, run };
}

describe('track commands', () => {
  it('register beside every other command, with their shortcuts', async () => {
    const { registry } = await setup(false);
    const shortcut = (id: string) => registry.get(id)?.shortcut;
    expect(shortcut('track.next')).toEqual({ key: 'ArrowDown', mod: true });
    expect(formatShortcut({ key: 'ArrowDown', mod: true }, 'mac')).toBe('⌘↓');
    expect(formatShortcut({ key: 'ArrowDown', mod: true }, 'other')).toBe('Ctrl+Down');
    expect(shortcut('view.toggleMultitrack')).toEqual({ key: 'F3' });
    expect(registry.get('view.togglePanel')).toMatchObject({
      title: 'Toggle mixer',
      shortcut: { key: 'F8' },
    });
  });

  it('do nothing with no document, except the mixer toggle', async () => {
    const { services, registry, run } = await setup(false);
    for (const command of registry.list()) {
      if (command.id.startsWith('track.') || command.id === 'view.toggleMultitrack') {
        await run(command.id);
      }
    }
    expect(services.fakeAudio.setTrack).not.toHaveBeenCalled();
    expect(services.document.getState().view).toEqual({ tracks: 'all', notation: {} });
    await run('view.togglePanel');
    expect(services.ui.getState().panels.rightPanel).toBe(true);
  });

  it('step the current track, clamped', async () => {
    const { services, ids, run } = await setup();
    await run('track.previous');
    expect(services.selection.getState().currentTrack).toBe(ids[0]);
    await run('track.next');
    await run('track.next');
    await run('track.next');
    expect(services.selection.getState().currentTrack).toBe(ids[2]);
  });

  it('toggle multitrack view, mute and solo the current track, and clear them', async () => {
    const { services, ids, run } = await setup();
    const [lead = '', bass = ''] = ids;
    await run('view.toggleMultitrack');
    expect(services.document.getState().view.only).toBe(lead);
    await run('track.showAll');
    expect(services.document.getState().view).toEqual({ tracks: 'all', notation: {} });

    await run('track.next');
    await run('track.toggleMute');
    await run('track.toggleSolo');
    expect(services.playback.getState().mixer).toEqual({ [bass]: { mute: true, solo: true } });
    await run('track.clearMuteSolo');
    expect(services.playback.getState().mixer).toEqual({ [bass]: { mute: false, solo: false } });
  });

  it('set the current track’s notation, and skip a track without the choice', async () => {
    const { services, ids, run } = await setup();
    const [lead = ''] = ids;
    await run('track.notationBoth');
    expect(services.document.getState().view.notation).toEqual({ [lead]: 'both' });
    await run('track.notationTab');
    expect(services.document.getState().view.notation).toEqual({});

    await run('track.next');
    await run('track.next');
    await run('track.notationStandard');
    expect(services.document.getState().view.notation).toEqual({});
  });
});

describe('edit commands', () => {
  it('undo and redo the document’s history', async () => {
    const { services, ids, run, registry } = await setup();
    const { document } = services;
    document.getState().apply(setTrackProperties({ trackId: ids[0] ?? '' }, { program: 30 }));

    await run('edit.undo');
    expect(document.getState().score?.tracks[0]?.program).not.toBe(30);
    await run('edit.redo');
    expect(document.getState().score?.tracks[0]?.program).toBe(30);
    await run('edit.undo');
    await run('edit.redoAlternate');
    expect(document.getState().score?.tracks[0]?.program).toBe(30);

    expect(registry.get('edit.undo')?.shortcut).toEqual({ key: 'z', mod: true });
    expect(registry.get('edit.redo')?.shortcut).toEqual({ key: 'z', mod: true, shift: true });
    expect(registry.get('edit.redoAlternate')?.shortcut).toEqual({
      key: 'y',
      mod: true,
      only: 'other',
    });
  });

  it('leave a focused text field its own undo', async () => {
    const { services, ids, run } = await setup();
    const { document } = services;
    document.getState().apply(setTrackProperties({ trackId: ids[0] ?? '' }, { program: 30 }));
    const field = globalThis.document.createElement('input');
    globalThis.document.body.append(field);
    field.focus();
    const calls: string[] = [];
    // jsdom has no editing commands, so record what the field was asked to do.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- stubbing what the command calls
    globalThis.document.execCommand = (command: string) => {
      calls.push(command);
      return true;
    };

    await run('edit.undo');
    await run('edit.redo');

    expect(calls).toEqual(['undo', 'redo']);
    expect(document.getState().score?.tracks[0]?.program).toBe(30);

    // A checkbox has no text history, so the score's undo runs.
    field.type = 'checkbox';
    await run('edit.undo');
    expect(calls).toEqual(['undo', 'redo']);
    expect(document.getState().score?.tracks[0]?.program).not.toBe(30);
    field.remove();
  });
});
