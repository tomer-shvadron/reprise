import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { MixerPanel } from './mixer-panel';
import { renderTracks, threeTracks } from './test/render-tracks';

function setup() {
  return { ...renderTracks(() => <MixerPanel />), user: userEvent.setup() };
}

// The instrument select's optgroups are groups too, one of them named "Bass".
function strip(name: string): HTMLElement {
  const found = screen.getAllByRole('group', { name }).find((group) => group.tagName === 'DIV');
  if (!found) throw new Error(`no strip ${name}`);
  return found;
}

describe('MixerPanel', () => {
  it('keeps the master slider in the empty state', async () => {
    const { services, user } = setup();
    expect(screen.getByText('Open a file to mix its tracks.')).toBeInTheDocument();
    const master = screen.getByRole('slider', { name: 'Master volume' });
    expect(master).toHaveAttribute('aria-valuetext', '100%');
    master.focus();
    await user.keyboard('{ArrowLeft}');
    expect(services.fakeAudio.setMasterVolume).toHaveBeenLastCalledWith(0.99);
  });

  it('focuses the mixer when it opens', () => {
    setup();
    expect(screen.getByRole('region', { name: 'Mixer' })).toHaveFocus();
  });

  it('shows volume and pan, and commits a pan step', async () => {
    const { open, user, services } = setup();
    const song = threeTracks();
    const [lead, ...rest] = song.tracks;
    if (!lead) throw new Error('no lead');
    await open({
      ...song,
      tracks: [{ ...lead, channel: { ...lead.channel, volume: 100, pan: 64 } }, ...rest],
    });
    const lane = strip('Lead');
    expect(within(lane).getByText('79%')).toBeInTheDocument();
    expect(within(lane).getByText('C')).toBeInTheDocument();

    within(lane).getByRole('slider', { name: 'Pan of Lead' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(services.document.getState().score?.tracks[0]?.channel.pan).toBe(63);
    expect(within(lane).getByText('L 2')).toBeInTheDocument();
    expect(within(lane).getByRole('slider', { name: 'Pan of Lead' })).toHaveAttribute(
      'aria-valuetext',
      '2% left',
    );
  });

  it('changes the instrument as an undoable edit, and lists kits for drums', async () => {
    const { open, user, services } = setup();
    await open();
    await user.selectOptions(
      within(strip('Lead')).getByRole('combobox', { name: 'Instrument of Lead' }),
      '29',
    );
    expect(services.document.getState().score?.tracks[0]?.program).toBe(29);
    expect(services.document.getState().undoLabel).toBe('setTrackProperties');

    const kits = within(strip('Drums')).getByRole('combobox', { name: 'Instrument of Drums' });
    expect(within(kits).getByRole('option', { name: 'TR-808 Kit' })).toBeInTheDocument();
  });

  it('names a kit outside the list', async () => {
    const { open } = setup();
    const song = threeTracks();
    await open({
      ...song,
      tracks: song.tracks.map((track) =>
        track.kind === 'drums' ? { ...track, program: 5 } : track,
      ),
    });
    const kits = within(strip('Drums')).getByRole('combobox', { name: 'Instrument of Drums' });
    expect(kits).toHaveDisplayValue('Kit 5');
  });

  it('shows an instrument load in its own strip only', async () => {
    const { open, services } = setup();
    const [lead = ''] = await open();
    act(() => {
      services.playback.setState({ instrumentLoads: { [lead]: { loaded: 2, total: 5 } } });
    });
    expect(within(strip('Lead')).getByRole('status')).toHaveTextContent('Loading sound… 40%');
    expect(within(strip('Bass')).queryByRole('status')).toBeNull();
  });

  it('solos from the strip', async () => {
    const { open, user, services } = setup();
    const [lead = ''] = await open();
    await user.click(within(strip('Lead')).getByRole('button', { name: 'Solo Lead' }));
    expect(services.playback.getState().mixer).toEqual({ [lead]: { solo: true } });
    expect(strip('Bass')).toHaveAttribute('data-audible', 'false');
  });
});
