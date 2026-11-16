import { setTrackProperties } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { UnsavedChangesHost } from './unsaved-dialog';
import { whenSaved } from './when-saved';

function setup(saveFile: () => Promise<string | undefined>) {
  const services = createTestServices({ platform: fakePlatform({ saveFile }) });
  renderWithServices(<UnsavedChangesHost />, services);
  act(() => {
    const { document } = services;
    document.getState().newDocument(score().title('Draft').track('guitar').build());
    document
      .getState()
      .apply(
        setTrackProperties(
          { trackId: document.getState().score?.tracks[0]?.id ?? '' },
          { name: 'Edited' },
        ),
      );
  });
  return { services, user: userEvent.setup() };
}

describe('whenSaved with a request already open', () => {
  it('cancels the first request, which hears about it, and asks the second', async () => {
    const { services, user } = setup(() => Promise.resolve(undefined));
    const firstContinue = vi.fn();
    const firstCancel = vi.fn();
    const secondContinue = vi.fn();
    act(() => {
      whenSaved(services, 'opening one', firstContinue, firstCancel);
    });
    expect(screen.getByRole('dialog')).toHaveTextContent('before opening one?');
    act(() => {
      whenSaved(services, 'opening two', secondContinue);
    });
    expect(firstCancel).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog')).toHaveTextContent('before opening two?');
    await user.click(screen.getByRole('button', { name: 'Don’t save' }));
    expect(secondContinue).toHaveBeenCalledOnce();
    expect(firstContinue).not.toHaveBeenCalled();
  });

  it('lets a Save still running for the first request neither continue it nor close the second', async () => {
    let finishSave: (path: string | undefined) => void = () => undefined;
    const { services, user } = setup(
      () =>
        new Promise<string | undefined>((resolve) => {
          finishSave = resolve;
        }),
    );
    const firstContinue = vi.fn();
    const secondContinue = vi.fn();
    act(() => {
      whenSaved(services, 'opening one', firstContinue);
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(services.document.getState().saving).toBe(true);
    });
    act(() => {
      whenSaved(services, 'opening two', secondContinue);
    });
    await act(async () => {
      finishSave('/m/Draft.reprise');
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(firstContinue).not.toHaveBeenCalled();
    expect(secondContinue).not.toHaveBeenCalled();
    // The second question is still on screen; the document is saved, so it continues at once.
    expect(screen.getByRole('dialog')).toHaveTextContent('before opening two?');
  });
});
