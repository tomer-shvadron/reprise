import { write } from '@reprise/formats';
import { STANDARD_TUNING, setTrackProperties } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { runCommand } from '@/app/command-registry';
import { formatShortcut } from '@/app/keyboard';
import { dispatchShortcut } from '@/app/shortcut-dispatcher';
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

  it('jump to a track by number, showing a hidden one, and ignore a number past the last', async () => {
    const { services, ids, run } = await setup();
    await run('track.go3');
    expect(services.selection.getState().currentTrack).toBe(ids[2]);
    await run('track.go2');
    expect(services.selection.getState().currentTrack).toBe(ids[1]);
    await run('track.go4');
    expect(services.selection.getState().currentTrack).toBe(ids[1]);

    services.document.getState().setVisibleTracks([ids[0] ?? '']);
    await run('track.go3');
    expect(services.document.getState().view.tracks).toContain(ids[2]);
    expect(services.selection.getState().currentTrack).toBe(ids[2]);
  });

  it('make the shown track follow a jump in single-track view', async () => {
    const { services, ids, run } = await setup();
    await run('view.toggleMultitrack');
    await run('track.go3');
    expect(services.document.getState().view.only).toBe(ids[2]);
  });

  it('bind Alt+1 to Alt+9 and F7 without a conflict, off the palette, and hide jumps past the last track', async () => {
    const { registry } = await setup();
    expect(registry.get('track.go1')?.shortcut).toEqual({ key: '1', alt: true });
    expect(formatShortcut({ key: '1', alt: true }, 'mac')).toBe('⌥1');
    expect(formatShortcut({ key: '1', alt: true }, 'other')).toBe('Alt+1');
    expect(registry.get('track.focusSidebar')?.shortcut).toEqual({ key: 'F7' });
    expect(registry.conflicts()).toEqual([]);
    const ids = registry.available().map((command) => command.id);
    expect(ids).toContain('track.go3');
    expect(ids).not.toContain('track.go4');
    expect(registry.get('track.go1')?.inPalette).toBe(false);
    expect(registry.get('track.focusSidebar')?.inPalette).toBe(false);
  });

  it('keep the focus key off while no score is open', async () => {
    const { registry } = await setup(false);
    expect(registry.available().map((command) => command.id)).not.toContain('track.focusSidebar');
  });

  it('jump from the keyboard, including the symbol Option types on a Mac, but not from a text field', async () => {
    const { services, ids, registry } = await setup();
    const key = (init: KeyboardEventInit, target?: HTMLElement) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      Object.defineProperty(event, 'target', { value: target ?? document.body });
      return event;
    };
    services.selection.getState().setCurrentTrack(ids[2] ?? '');
    expect(dispatchShortcut(key({ key: '¡', code: 'Digit1', altKey: true }), registry, 'mac')).toBe(
      true,
    );
    expect(services.selection.getState().currentTrack).toBe(ids[0]);
    expect(
      dispatchShortcut(key({ key: '2', code: 'Digit2', altKey: true }), registry, 'other'),
    ).toBe(true);
    expect(services.selection.getState().currentTrack).toBe(ids[1]);

    const field = document.createElement('input');
    expect(
      dispatchShortcut(key({ key: '¡', code: 'Digit1', altKey: true }, field), registry, 'mac'),
    ).toBe(false);
    expect(services.selection.getState().currentTrack).toBe(ids[1]);
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

  it('never sets tab or both on a pitched track, even one stored as tab', async () => {
    const services = createTestServices();
    mirrorAudio(services);
    const registry = createAppRegistry(services);
    const song = score()
      .track('piano', {
        tuning: [...STANDARD_TUNING],
        fretCount: 24,
        display: { notation: 'tab', clef: 'treble', octaveShift: 0 },
      })
      .build();
    await services.document
      .getState()
      .openBytes('song.reprise', (await write(song, 'reprise')).bytes);
    services.selection.getState().setCurrentTrack(song.tracks[0]?.id ?? '');
    for (const id of ['track.notationTab', 'track.notationBoth', 'track.notationStandard']) {
      const command = registry.get(id);
      if (!command) throw new Error(`no ${id}`);
      runCommand(command);
      await Promise.resolve();
      expect(services.document.getState().view.notation).toEqual({});
      expect(services.document.getState().dirty).toBe(false);
    }
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
