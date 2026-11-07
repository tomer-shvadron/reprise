import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { write } from '@reprise/formats';
import { layout, PAGE_SIZES, type LayoutOptions } from '@reprise/layout';
import type { Score } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { createTestServices } from '@/test/services';

import { PrintDialog } from './print-dialog';
import { createPrintStore } from './print-store';

async function setup(song: Score) {
  const services = createTestServices();
  const { bytes } = await write(song, 'reprise');
  await services.document.getState().openBytes('song.reprise', bytes);
  const print = vi.fn(() => Promise.resolve());
  const run = vi.fn((built: Score, options: LayoutOptions) => layout(built, options));
  const store = createPrintStore({
    document: services.document,
    ui: services.ui,
    platform: { print },
    fonts: () => Promise.resolve(),
    nextPaint: () => Promise.resolve(),
    layout: run,
  });
  render(
    <>
      <button type="button">Score</button>
      <PrintDialog store={store} />
    </>,
  );
  screen.getByRole('button', { name: 'Score' }).focus();
  act(() => {
    store.getState().open();
  });
  return { store, run, print, user: userEvent.setup() };
}

const twoTracks = () =>
  score().track('guitar', { name: 'Lead' }).track('bass', { name: 'Bass' }).build();

describe('PrintDialog', () => {
  it('prints the chosen tracks on the chosen paper, without page numbers', async () => {
    const { store, run, user } = await setup(twoTracks());
    expect(screen.getByRole('dialog', { name: 'Print' })).toBeInTheDocument();
    const lead = screen.getByRole('switch', { name: 'Lead' });
    const bass = screen.getByRole('switch', { name: 'Bass' });
    expect(lead).toBeChecked();
    expect(bass).toBeChecked();
    await user.click(bass);
    await user.click(screen.getByRole('radio', { name: 'Letter' }));
    await user.click(screen.getByRole('switch', { name: 'Page numbers' }));
    await user.click(screen.getByRole('button', { name: 'Print…' }));
    await waitFor(() => {
      expect(run).toHaveBeenCalledOnce();
    });
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      width: PAGE_SIZES.letter.width,
      tracks: [store.getState().job?.settings.tracks[0]],
    });
    expect(store.getState().job?.settings).toMatchObject({ paper: 'letter', pageNumbers: false });
    expect(store.getState().job?.settings.tracks).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('focuses Print… on open', async () => {
    await setup(twoTracks());
    expect(screen.getByRole('button', { name: 'Print…' })).toHaveFocus();
  });

  it.each([
    ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    [
      'Cancel',
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByRole('button', { name: 'Cancel' })),
    ],
    [
      'a print',
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByRole('button', { name: 'Print…' })),
    ],
  ])('gives focus back to where it was after %s', async (_, close) => {
    const { user } = await setup(twoTracks());
    await close(user);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Print' })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Score' })).toHaveFocus();
    });
  });

  it('names the groups by their visible captions', async () => {
    await setup(twoTracks());
    const tracks = screen.getByRole('group', { name: 'Tracks' });
    expect(tracks).toHaveAttribute('aria-labelledby');
    expect(tracks).not.toHaveAttribute('aria-label');
    const paper = screen.getByRole('radiogroup', { name: 'Paper' });
    expect(paper).toHaveAttribute('aria-labelledby');
    expect(paper).not.toHaveAttribute('aria-label');
  });

  it('disables Print… with no track on', async () => {
    const { user } = await setup(twoTracks());
    await user.click(screen.getByRole('switch', { name: 'Lead' }));
    await user.click(screen.getByRole('switch', { name: 'Bass' }));
    expect(screen.getByRole('button', { name: 'Print…' })).toBeDisabled();
  });

  it.each([
    ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    [
      'Cancel',
      async (user: ReturnType<typeof userEvent.setup>) =>
        user.click(screen.getByRole('button', { name: 'Cancel' })),
    ],
  ])('closes on %s', async (_, close) => {
    const { store, user } = await setup(twoTracks());
    await close(user);
    expect(store.getState().dialog).toBeUndefined();
    expect(screen.queryByRole('dialog', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('reads Preparing… while the print is being prepared', async () => {
    const { store } = await setup(twoTracks());
    act(() => {
      store.setState({ preparing: true });
    });
    expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('lists no tracks for a one-track score', async () => {
    await setup(score().track('guitar', { name: 'Solo' }).build());
    expect(screen.queryByRole('group', { name: 'Tracks' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Title header' })).toBeChecked();
  });
});
