import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderTracks, threeTracks } from './test/render-tracks';
import { TrackSidebar } from './track-sidebar';

function setup() {
  return {
    ...renderTracks((registry) => <TrackSidebar registry={registry} keyboard="mac" />),
    user: userEvent.setup(),
  };
}

const list = () => screen.getByRole('list', { name: 'Tracks' });
const row = (name: string) =>
  within(list())
    .getAllByRole('listitem')
    .find((item) => within(item).queryByRole('button', { name: new RegExp(`^${name}`) }));

function rowOf(name: string): HTMLElement {
  const found = row(name);
  if (!found) throw new Error(`no row ${name}`);
  return found;
}

describe('TrackSidebar', () => {
  it('shows the empty state, then the file being opened', () => {
    const { services } = setup();
    expect(screen.getByText('No file open.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Multitrack view' })).toBeDisabled();
    act(() => {
      services.document.setState({ opening: 'riff.gp' });
    });
    expect(screen.getByText('Opening riff.gp…')).toBeInTheDocument();
  });

  it('lists the tracks with their instruments, the first one current', async () => {
    const { open } = setup();
    await open();
    const names = within(list())
      .getAllByRole('listitem')
      .map((item) => within(item).getAllByRole('button')[0]?.textContent);
    expect(names).toEqual([
      'LeadDistortion Guitar',
      'BassElectric Bass (finger)',
      'DrumsStandard Kit',
    ]);
    expect(within(rowOf('Lead')).getByText('Distortion Guitar')).toBeInTheDocument();
    expect(within(rowOf('Drums')).getByText('Standard Kit')).toBeInTheDocument();
    expect(within(rowOf('Lead')).getByRole('button', { name: /^Lead/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('selects by click and by the next-track command', async () => {
    const { open, user, services, registry } = setup();
    const [, bass, drums] = await open();
    await user.click(within(rowOf('Bass')).getByRole('button', { name: /^Bass/ }));
    expect(services.selection.getState().currentTrack).toBe(bass);
    act(() => {
      void registry.get('track.next')?.run();
    });
    expect(services.selection.getState().currentTrack).toBe(drums);
    expect(within(rowOf('Drums')).getByRole('button', { name: /^Drums/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('presses mute and solo and dims the silenced rows', async () => {
    const { open, user } = setup();
    await open();
    const solo = within(rowOf('Lead')).getByRole('button', { name: 'Solo Lead' });
    await user.click(solo);
    expect(solo).toHaveAttribute('aria-pressed', 'true');
    expect(rowOf('Lead')).toHaveAttribute('data-audible', 'true');
    expect(rowOf('Bass')).toHaveAttribute('data-audible', 'false');

    const mute = within(rowOf('Lead')).getByRole('button', { name: 'Mute Lead' });
    await user.click(mute);
    expect(mute).toHaveAttribute('aria-pressed', 'true');
    expect(rowOf('Lead')).toHaveAttribute('data-audible', 'false');
  });

  it('opens pressed when the file soloes a track', async () => {
    const { open } = setup();
    const song = threeTracks();
    const [lead, ...rest] = song.tracks;
    if (!lead) throw new Error('no lead');
    await open({
      ...song,
      tracks: [{ ...lead, channel: { ...lead.channel, solo: true } }, ...rest],
    });
    expect(within(rowOf('Lead')).getByRole('button', { name: 'Solo Lead' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(rowOf('Bass')).toHaveAttribute('data-audible', 'false');
  });

  it('hides tracks, keeps the last one, and locks the eyes in single-track view', async () => {
    const { open, user, services } = setup();
    const [lead] = await open();
    await user.click(within(rowOf('Bass')).getByRole('button', { name: 'Show Bass' }));
    await user.click(within(rowOf('Drums')).getByRole('button', { name: 'Show Drums' }));
    expect(services.document.getState().view.tracks).toEqual([lead]);
    const lastShown = within(rowOf('Lead')).getByRole('button', { name: 'Show Lead' });
    expect(lastShown).toHaveAttribute('aria-disabled', 'true');
    await user.click(lastShown);
    expect(services.document.getState().view.tracks).toEqual([lead]);

    await user.click(screen.getByRole('button', { name: 'Multitrack view' }));
    expect(services.document.getState().view.only).toBe(lead);
    expect(screen.getByRole('button', { name: 'Multitrack view' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    const locked = within(rowOf('Bass')).getByRole('button', { name: 'Show Bass' });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    // The locked eye is its own tab stop, with no role-less wrapper around it.
    expect(rowOf('Bass').querySelector('span[tabindex]:not([role])')).toBeNull();
  });

  it('switches notation from the menu, and offers none on drums', async () => {
    const { open, user, services } = setup();
    const [lead] = await open();
    await user.click(within(rowOf('Lead')).getByRole('button', { name: 'Notation for Lead: Tab' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Standard notation' }));
    expect(services.document.getState().view.notation).toEqual({ [lead ?? '']: 'standard' });

    // The name holds the visible word for speech input; the description spells it out.
    const trigger = within(rowOf('Lead')).getByRole('button', { name: 'Notation for Lead: Std' });
    expect(trigger).toHaveAccessibleDescription('Standard notation');
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitemradio', { name: 'Tab' }));
    expect(services.document.getState().view.notation).toEqual({});
    expect(within(rowOf('Drums')).queryByRole('button', { name: /^Notation/ })).toBeNull();
  });

  it('previews then commits the compact volume as one undo step', async () => {
    const { open, user, services } = setup();
    const [lead = ''] = await open();
    const thumb = within(rowOf('Lead')).getByRole('slider', { name: 'Volume of Lead' });
    const before = services.document.getState().score?.tracks[0]?.channel.volume ?? 0;
    thumb.focus();
    await user.keyboard('{ArrowRight}');
    expect(services.fakeAudio.previewTrack).toHaveBeenCalledWith(lead, { volume: before + 1 });
    expect(services.document.getState().score?.tracks[0]?.channel.volume).toBe(before + 1);
    expect(services.document.getState().canUndo).toBe(true);
    expect(thumb).toHaveAttribute(
      'aria-valuetext',
      `${String(Math.round(((before + 1) / 127) * 100))}%`,
    );

    // An undo shows through: the step leaves no draft behind.
    act(() => {
      services.document.getState().undo();
    });
    expect(thumb).toHaveAttribute('aria-valuenow', String(before));
  });

  it('re-renders no row on position writes', async () => {
    const commits = vi.fn();
    const { open, services } = renderTracks((registry) => (
      <Profiler id="sidebar" onRender={commits}>
        <TrackSidebar registry={registry} keyboard="mac" />
      </Profiler>
    ));
    await open();
    const before = commits.mock.calls.length;
    act(() => {
      for (let tick = 0; tick < 30; tick += 1) {
        services.playback.setState({ position: undefined, lastLoop: undefined });
      }
    });
    expect(commits.mock.calls.length).toBe(before);
  });
});
