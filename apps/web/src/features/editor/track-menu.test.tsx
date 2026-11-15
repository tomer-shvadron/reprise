import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';
import { TrackSidebar } from '@/features/tracks';

import { EditorDialogs } from './editor-dialogs';
import { bandScore, tracksOf } from './test/tracks';
import { AddTrackButton, TrackRowMenu } from './track-menu';

function setup(platform: 'mac' | 'other' = 'mac') {
  const services = createTestServices();
  const registry = createAppRegistry(services);
  renderWithServices(
    <>
      <TrackSidebar
        registry={registry}
        keyboard={platform}
        headerActions={<AddTrackButton />}
        rowMenu={(track, index) => <TrackRowMenu track={track} index={index} />}
      />
      <EditorDialogs />
    </>,
    services,
  );
  act(() => {
    services.document.getState().newDocument(bandScore());
  });
  return { services, user: userEvent.setup() };
}

const menuOf = (name: string) => screen.getByRole('button', { name: `Track actions for ${name}` });

describe('the track sidebar with the editor’s slots', () => {
  it('adds a track from the header button, which is disabled with no file open', async () => {
    const { services, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Add track' }));
    expect(screen.getByRole('dialog', { name: 'Add track' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add track' }));
    expect(tracksOf(services).map((track) => track.name)).toEqual([
      'Lead',
      'Bass',
      'Drums',
      'Guitar',
    ]);
  });

  it('keeps the sidebar without the slots as it was', () => {
    const services = createTestServices();
    renderWithServices(
      <TrackSidebar registry={createAppRegistry(services)} keyboard="mac" />,
      services,
    );
    expect(screen.queryByRole('button', { name: 'Add track' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Multitrack view' })).toBeInTheDocument();
  });

  it('shows the add-track keys of the platform in the tooltip', async () => {
    const { user } = setup('other');
    await user.hover(screen.getByRole('button', { name: 'Add track' }));
    expect(await screen.findAllByText(/Add track \(Ctrl\+Shift\+Insert\)/)).not.toHaveLength(0);
  });

  it('opens a row’s properties from its menu, by keyboard', async () => {
    const { user } = setup();
    menuOf('Bass').focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Track properties' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByLabelText('Name')).toHaveValue('Bass');
  });

  it('moves a track up and down from its menu, disabled at the ends', async () => {
    const { services, user } = setup();
    await user.click(menuOf('Lead'));
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('data-disabled');
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(tracksOf(services).map((track) => track.name)).toEqual(['Bass', 'Lead', 'Drums']);
    await user.click(menuOf('Drums'));
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toHaveAttribute('data-disabled');
  });

  it('removes a track from its menu, asking when it holds notes', async () => {
    const { services, user } = setup();
    await user.click(menuOf('Bass'));
    await user.click(screen.getByRole('menuitem', { name: 'Remove…' }));
    expect(tracksOf(services).map((track) => track.name)).toEqual(['Lead', 'Drums']);
    await user.click(menuOf('Lead'));
    await user.click(screen.getByRole('menuitem', { name: 'Remove…' }));
    expect(screen.getByRole('dialog', { name: 'Remove “Lead”?' })).toBeInTheDocument();
  });

  it('disables Remove on the last track and says why', async () => {
    const { services, user } = setup();
    act(() => {
      services.document.getState().newDocument(
        (() => {
          const [first] = tracksOf(services);
          const score = services.document.getState().score;
          return score && first ? { ...score, tracks: [first] } : bandScore();
        })(),
      );
    });
    await user.click(menuOf('Lead'));
    const remove = screen.getByRole('menuitem', { name: /^Remove…/ });
    expect(remove).toHaveAttribute('data-disabled');
    expect(remove).toHaveTextContent('A score keeps at least one track');
  });
});
