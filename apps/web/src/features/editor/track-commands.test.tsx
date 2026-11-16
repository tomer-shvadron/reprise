import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { dispatchShortcut } from '@/app/shortcut-dispatcher';

import { setupTracks, tracksOf } from './test/tracks';

const names = (services: Parameters<typeof tracksOf>[0]) =>
  tracksOf(services).map((track) => track.name);

describe('the track commands', () => {
  it('add a track as one undo step and make it current', () => {
    const { services, run } = setupTracks();
    const before = services.document.getState().revision;
    act(() => {
      services.document.getState().setVisibleTracks([tracksOf(services)[0]?.id ?? '']);
    });
    run('track.add');
    // The dialog's own submit, with the defaults.
    act(() => {
      screen.getByRole('button', { name: 'Add track' }).click();
    });
    expect(names(services)).toEqual(['Lead', 'Bass', 'Drums', 'Guitar']);
    const added = tracksOf(services)[3];
    expect(services.document.getState().revision).toBe(before + 1);
    expect(services.document.getState().undoLabel).toBe('addTrack');
    expect(services.selection.getState().currentTrack).toBe(added?.id);
    expect(services.document.getState().view.tracks).toContain(added?.id);
    act(() => {
      services.document.getState().undo();
    });
    expect(names(services)).toEqual(['Lead', 'Bass', 'Drums']);
  });

  it('move a track up and down, each one undo step, and stop at the ends', () => {
    const { services, ids, run } = setupTracks();
    act(() => {
      services.selection.getState().setCurrentTrack(ids[1]);
    });
    const before = services.document.getState().revision;
    run('track.moveUp');
    expect(names(services)).toEqual(['Bass', 'Lead', 'Drums']);
    expect(services.document.getState().revision).toBe(before + 1);
    run('track.moveUp');
    expect(services.document.getState().revision).toBe(before + 1);
    run('track.moveDown');
    run('track.moveDown');
    expect(names(services)).toEqual(['Lead', 'Drums', 'Bass']);
    run('track.moveDown');
    expect(services.document.getState().revision).toBe(before + 3);
    act(() => {
      services.document.getState().undo();
    });
    expect(names(services)).toEqual(['Lead', 'Bass', 'Drums']);
  });

  it('remove an empty track at once as one undo step, and undo brings it back', () => {
    const { services, ids, run } = setupTracks();
    act(() => {
      services.selection.getState().setCurrentTrack(ids[1]);
    });
    const before = services.document.getState().revision;
    run('track.remove');
    expect(names(services)).toEqual(['Lead', 'Drums']);
    expect(services.document.getState().revision).toBe(before + 1);
    expect(services.selection.getState().currentTrack).toBe(ids[2]);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => {
      services.document.getState().undo();
    });
    expect(names(services)).toEqual(['Lead', 'Bass', 'Drums']);
  });

  it('keeps single-track view on the current track when the shown track is removed', () => {
    const { services, ids, run } = setupTracks();
    act(() => {
      services.selection.getState().setCurrentTrack(ids[1]);
      services.document.getState().setSingleTrack(ids[1]);
    });
    run('track.remove');
    expect(services.selection.getState().currentTrack).toBe(ids[2]);
    expect(services.document.getState().view.only).toBe(ids[2]);
    act(() => {
      services.document.getState().undo();
    });
    expect(names(services)).toEqual(['Lead', 'Bass', 'Drums']);
    expect(services.document.getState().view.only).toBe(ids[2]);
    expect(services.selection.getState().currentTrack).toBe(ids[2]);
  });

  it('ask before removing a track that holds notes, and keep it on Cancel', () => {
    const { services, run } = setupTracks();
    run('track.remove');
    const dialog = screen.getByRole('dialog', { name: 'Remove “Lead”?' });
    expect(dialog).toHaveTextContent('Its notes go with it. Undo brings it back.');
    act(() => {
      screen.getByRole('button', { name: 'Cancel' }).click();
    });
    expect(names(services)).toEqual(['Lead', 'Bass', 'Drums']);
    run('track.remove');
    act(() => {
      screen.getByRole('button', { name: 'Remove' }).click();
    });
    expect(names(services)).toEqual(['Bass', 'Drums']);
  });

  it('refuse to remove the last track', () => {
    const { services, run } = setupTracks();
    run('track.remove');
    act(() => {
      screen.getByRole('button', { name: 'Remove' }).click();
    });
    run('track.remove');
    expect(names(services)).toEqual(['Drums']);
    const before = services.document.getState().revision;
    run('track.remove');
    expect(names(services)).toEqual(['Drums']);
    expect(services.document.getState().revision).toBe(before);
  });

  it('bind F6 to the properties dialog, ⌥⌘N on macOS and Ctrl+Shift+Insert elsewhere to Add track', () => {
    const { registry } = setupTracks();
    const press = (init: KeyboardEventInit, platform: 'mac' | 'other') => {
      act(() => {
        dispatchShortcut(new KeyboardEvent('keydown', init), registry, platform);
      });
    };
    press({ key: 'F6' }, 'mac');
    expect(screen.getByRole('dialog', { name: 'Track properties' })).toBeInTheDocument();
    act(() => {
      screen.getByRole('button', { name: 'Cancel' }).click();
    });
    press({ key: 'n', code: 'KeyN', metaKey: true, altKey: true }, 'mac');
    expect(screen.getByRole('dialog', { name: 'Add track' })).toBeInTheDocument();
    act(() => {
      screen.getByRole('button', { name: 'Cancel' }).click();
    });
    press({ key: 'Insert', ctrlKey: true, shiftKey: true }, 'other');
    expect(screen.getByRole('dialog', { name: 'Add track' })).toBeInTheDocument();
  });

  it('have no keys for remove and move', () => {
    const { registry } = setupTracks();
    for (const id of ['track.remove', 'track.moveUp', 'track.moveDown']) {
      expect(registry.get(id)?.shortcut).toBeUndefined();
    }
  });
});
