import { setTrackProperties } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { installCloseGuard } from './close-guard';
import { UnsavedChangesHost } from './unsaved-dialog';

const stops: (() => void)[] = [];

function setup(desktop: boolean) {
  let request: (() => void) | undefined;
  const confirmClose = vi.fn<(close: boolean) => void>();
  const platform = fakePlatform(
    desktop
      ? {
          onCloseRequest: (listener) => {
            request = listener;
            return () => {
              request = undefined;
            };
          },
          confirmClose,
        }
      : {},
  );
  const services = createTestServices({ platform });
  const discardDraft = vi.fn(() => Promise.resolve());
  const stop = installCloseGuard({ services, discardDraft });
  const edit = () => {
    act(() => {
      const { document } = services;
      document
        .getState()
        .apply(
          setTrackProperties(
            { trackId: document.getState().score?.tracks[0]?.id ?? '' },
            { name: 'Edited' },
          ),
        );
    });
  };
  services.document.getState().newDocument(score().title('Riff').track('guitar').build());
  stops.push(stop);
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { services, confirmClose, discardDraft, edit, unload, stop, ask: () => request?.() };
}

afterEach(() => {
  stops.splice(0).forEach((stop) => {
    stop();
  });
});

describe('the web close guard', () => {
  it('prompts on unload only while the document is modified', () => {
    const { services, edit, unload } = setup(false);
    expect(unload()).toBe(false);
    edit();
    expect(unload()).toBe(true);
    services.document.getState().undo();
    expect(unload()).toBe(false);
  });

  it('stops listening when removed', () => {
    const { edit, unload, stop } = setup(false);
    edit();
    stop();
    expect(unload()).toBe(false);
  });
});

describe('the desktop close guard', () => {
  it('never registers beforeunload', () => {
    const { edit, unload } = setup(true);
    edit();
    expect(unload()).toBe(false);
  });

  it('closes at once when nothing is modified', () => {
    const { confirmClose, ask } = setup(true);
    ask();
    expect(confirmClose).toHaveBeenCalledWith(true);
  });

  it('Don’t save removes the draft and then confirms the close', async () => {
    const { services, confirmClose, discardDraft, edit, ask } = setup(true);
    renderWithServices(<UnsavedChangesHost />, services);
    edit();
    act(() => {
      ask();
    });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Don’t save' }));
    await vi.waitFor(() => {
      expect(confirmClose).toHaveBeenCalledWith(true);
    });
    expect(discardDraft).toHaveBeenCalledTimes(1);
  });

  it('Cancel keeps the draft and cancels the request', async () => {
    const { services, confirmClose, discardDraft, edit, ask } = setup(true);
    renderWithServices(<UnsavedChangesHost />, services);
    edit();
    act(() => {
      ask();
    });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(confirmClose).toHaveBeenCalledWith(false);
    expect(discardDraft).not.toHaveBeenCalled();
  });

  it('treats a request while its dialog is open as a no-op', async () => {
    const { services, confirmClose, edit, ask } = setup(true);
    renderWithServices(<UnsavedChangesHost />, services);
    edit();
    act(() => {
      ask();
    });
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved changes' });
    act(() => {
      ask();
    });
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBe(dialog);
    expect(confirmClose).not.toHaveBeenCalled();
  });
});
