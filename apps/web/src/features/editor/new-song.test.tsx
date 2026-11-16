import { setTrackProperties } from '@reprise/model';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { EditorDialogs } from './editor-dialogs';
import { startNewSong } from './new-song';
import { whenSaved } from './when-saved';
import { bandScore } from './test/tracks';

function setup(
  saveFile: () => Promise<string | undefined> = () => Promise.resolve('/m/Untitled.reprise'),
) {
  const save = vi.fn(saveFile);
  const platform = fakePlatform({ saveFile: save });
  const services = createTestServices({ platform });
  renderWithServices(<EditorDialogs />, services);
  act(() => {
    services.document.getState().newDocument(bandScore());
  });
  const dirty = () => {
    act(() => {
      services.document
        .getState()
        .apply(
          setTrackProperties(
            { trackId: services.document.getState().score?.tracks[0]?.id ?? '' },
            { name: 'Edited' },
          ),
        );
    });
  };
  const start = () => {
    act(() => {
      startNewSong(services);
    });
  };
  return { services, save, dirty, start, user: userEvent.setup() };
}

const trackNames = (services: ReturnType<typeof setup>['services']) =>
  services.document.getState().score?.tracks.map((track) => track.name);

describe('New song', () => {
  it('opens an empty song in edit mode with a cursor in bar 1, with no prompt on a clean document', () => {
    const { services, start } = setup();
    services.ui.getState().setScreen('library');
    start();
    expect(screen.queryByRole('dialog')).toBeNull();
    const { score, file, songId, dirty, canUndo } = services.document.getState();
    expect(trackNames(services)).toEqual(['Guitar']);
    expect(score?.masterBars).toHaveLength(1);
    expect([file, songId, dirty, canUndo]).toEqual([undefined, undefined, false, false]);
    expect(services.ui.getState().screen).toBe('player');
    expect(services.editing.getState().editing).toBe(true);
    expect(services.selection.getState().cursor?.at).toEqual({ track: 0, bar: 0, beat: 0 });
  });

  it('asks first when the document is modified, naming it, and Cancel changes nothing', async () => {
    const { services, dirty, start, user } = setup();
    dirty();
    start();
    const dialog = screen.getByRole('dialog', { name: 'Unsaved changes' });
    expect(dialog).toHaveTextContent('Save changes to “Untitled” before starting a new song?');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trackNames(services)?.[0]).toBe('Edited');
    expect(services.editing.getState().editing).toBe(false);
  });

  it('treats Escape as Cancel', async () => {
    const { services, dirty, start, user } = setup();
    dirty();
    start();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trackNames(services)?.[0]).toBe('Edited');
  });

  it('drops the changes on Don’t save', async () => {
    const { services, save, dirty, start, user } = setup();
    dirty();
    start();
    await user.click(screen.getByRole('button', { name: 'Don’t save' }));
    expect(trackNames(services)).toEqual(['Guitar']);
    expect(save).not.toHaveBeenCalled();
    expect(services.editing.getState().editing).toBe(true);
  });

  it('saves, then starts the new song once the document is clean', async () => {
    const { services, save, dirty, start, user } = setup();
    dirty();
    start();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(services.document.getState().savePrompt).toBeDefined();
    });
    act(() => {
      services.document.getState().answerSavePrompt('reprise');
    });
    await waitFor(() => {
      expect(trackNames(services)).toEqual(['Guitar']);
    });
    expect(save).toHaveBeenCalledOnce();
    expect(services.editing.getState().editing).toBe(true);
  });

  it('stops where it stood when Save As is cancelled', async () => {
    const { services, save, dirty, start, user } = setup();
    dirty();
    start();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(services.document.getState().savePrompt).toBeDefined();
    });
    act(() => {
      services.document.getState().answerSavePrompt('cancel');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull();
    });
    expect(save).not.toHaveBeenCalled();
    expect(trackNames(services)?.[0]).toBe('Edited');
    expect(services.document.getState().dirty).toBe(true);
    expect(services.editing.getState().editing).toBe(false);
  });

  it('stops when the file picker is cancelled after choosing a format', async () => {
    const { services, dirty, start, user } = setup(() => Promise.resolve(undefined));
    dirty();
    start();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(services.document.getState().savePrompt).toBeDefined();
    });
    act(() => {
      services.document.getState().answerSavePrompt('reprise');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull();
    });
    expect(trackNames(services)?.[0]).toBe('Edited');
    expect(services.document.getState().dirty).toBe(true);
  });

  describe('while Save is in flight', () => {
    async function saving() {
      let release: (path: string | undefined) => void = () => undefined;
      const env = setup(
        () =>
          new Promise<string | undefined>((resolve) => {
            release = resolve;
          }),
      );
      env.dirty();
      env.start();
      await env.user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => {
        expect(env.services.document.getState().savePrompt).toBeDefined();
      });
      act(() => {
        env.services.document.getState().answerSavePrompt('reprise');
      });
      await waitFor(() => {
        expect(env.services.document.getState().saving).toBe(true);
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      });
      return { ...env, release };
    }

    it('disables every button and ignores Escape, so no answer can race the write', async () => {
      const { services, user, release } = await saving();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Don’t save' })).toBeDisabled();
      await user.keyboard('{Escape}');
      expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument();
      expect(trackNames(services)?.[0]).toBe('Edited');
      await act(async () => {
        release('/m/Untitled.reprise');
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(trackNames(services)).toEqual(['Guitar']);
      });
    });

    it('starts exactly one new song', async () => {
      const { services, release } = await saving();
      const changes: (string | undefined)[] = [];
      services.document.subscribe((state, previous) => {
        if (state.id !== previous.id) changes.push(state.id);
      });
      await act(async () => {
        release('/m/Untitled.reprise');
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(trackNames(services)).toEqual(['Guitar']);
      });
      expect(changes).toHaveLength(1);
    });
  });

  it('is not stopped by an error left over from an earlier failure', async () => {
    const { services, dirty, start, user } = setup();
    act(() => {
      services.document.getState().failOpen('old.gp', 'could not open');
    });
    dirty();
    start();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(services.document.getState().savePrompt).toBeDefined();
    });
    act(() => {
      services.document.getState().answerSavePrompt('reprise');
    });
    await waitFor(() => {
      expect(trackNames(services)).toEqual(['Guitar']);
    });
  });
});

describe('whenSaved', () => {
  it('continues at once on a clean document and asks on a dirty one, once', async () => {
    const { services, dirty, user } = setup();
    const onContinue = vi.fn();
    act(() => {
      whenSaved(services, 'closing', onContinue);
    });
    expect(onContinue).toHaveBeenCalledOnce();
    dirty();
    act(() => {
      whenSaved(services, 'closing', onContinue);
    });
    expect(screen.getByRole('dialog')).toHaveTextContent('before closing?');
    expect(onContinue).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Don’t save' }));
    expect(onContinue).toHaveBeenCalledTimes(2);
  });
});
