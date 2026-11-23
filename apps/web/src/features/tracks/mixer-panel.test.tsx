import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { mirrorAudio } from '@/test/mirror-audio';
import { renderWithServices } from '@/test/render';
import { CHANNEL_EFFECTS_SETTING, GM_TIER_BYPASS_SETTING } from '@/state/app-settings';
import { createTestServices } from '@/test/services';
import { createMemorySettingsBackend, createTestSettings } from '@/test/settings-backend';

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

  it('toggles the GM tier bypass and keeps it as a preference', async () => {
    const backend = createMemorySettingsBackend();
    const settings = createTestSettings(backend);
    const services = createTestServices({ settings });
    mirrorAudio(services);
    renderWithServices(<MixerPanel />, services);
    const user = userEvent.setup();
    const bypass = screen.getByRole('switch', { name: 'No automatic effects on GM sounds' });
    expect(bypass).toBeChecked();
    await user.click(bypass);
    expect(services.fakeAudio.setGmTierBypass).toHaveBeenLastCalledWith(false);
    expect(bypass).not.toBeChecked();
    // The preference lives in the settings store, which a reload hydrates from the table.
    expect(settings.get(GM_TIER_BYPASS_SETTING)).toBe(false);
    expect(await settings.settled()).toBe(true);
    // A reload: new services over the same rows reach the audio service.
    const reloadedSettings = createTestSettings(backend);
    const reloaded = createTestServices({ settings: reloadedSettings });
    await reloadedSettings.whenHydrated();
    expect(reloaded.fakeAudio.setGmTierBypass).toHaveBeenLastCalledWith(false);
  });

  it('toggles the channel reverb and chorus switch and keeps it as a preference', async () => {
    const settings = createTestSettings(createMemorySettingsBackend());
    const services = createTestServices({ settings });
    mirrorAudio(services);
    renderWithServices(<MixerPanel />, services);
    const user = userEvent.setup();
    const toggle = screen.getByRole('switch', { name: 'Reverb and chorus from the file' });
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
    await user.click(toggle);
    expect(services.fakeAudio.setChannelEffects).toHaveBeenLastCalledWith(false);
    expect(toggle).not.toBeChecked();
    expect(settings.get(CHANNEL_EFFECTS_SETTING)).toBe(false);
  });

  it('disables the channel switch while the GM switch is off', async () => {
    const services = createTestServices({});
    mirrorAudio(services);
    renderWithServices(<MixerPanel />, services);
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'No automatic effects on GM sounds' }));
    expect(screen.getByRole('switch', { name: 'Reverb and chorus from the file' })).toBeDisabled();
  });

  it('lists the effects preset beside the instrument of each track', async () => {
    const { open, services, user } = setup();
    await open();
    const effects = within(strip('Lead')).getByRole('combobox', { name: 'Effects of Lead' });
    expect(effects).toHaveValue('');
    await user.selectOptions(effects, 'distortion');
    expect(services.document.getState().score?.tracks[0]?.sound).toEqual({ preset: 'distortion' });
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

  it('shows an undo after a drag that ends where it began', async () => {
    const { open, user, services } = setup();
    await open();
    const thumb = within(strip('Lead')).getByRole('slider', { name: 'Volume of Lead' });
    const root = thumb.closest<HTMLElement>('[data-slot="slider"]');
    if (!root) throw new Error('no slider root');
    // jsdom has no layout or pointer capture: one pixel per step, and the thumb always holds it.
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 127, 10));
    Object.assign(thumb, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: () => true,
    });

    thumb.focus();
    await user.keyboard('{ArrowRight}');
    const stepped = services.document.getState().score?.tracks[0]?.channel.volume ?? 0;
    const revision = services.document.getState().revision;

    fireEvent.pointerDown(thumb, { pointerId: 1, clientX: stepped });
    fireEvent.pointerMove(thumb, { pointerId: 1, clientX: stepped - 30 });
    fireEvent.pointerMove(thumb, { pointerId: 1, clientX: stepped });
    fireEvent.pointerUp(thumb, { pointerId: 1, clientX: stepped });
    expect(services.document.getState().revision).toBe(revision);

    act(() => {
      services.document.getState().undo();
    });
    expect(thumb).toHaveAttribute('aria-valuenow', String(stepped - 1));
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
    expect(within(strip('Bass')).getByRole('status')).toBeEmptyDOMElement();
  });

  it('solos from the strip', async () => {
    const { open, user, services } = setup();
    const [lead = ''] = await open();
    await user.click(within(strip('Lead')).getByRole('button', { name: 'Solo Lead' }));
    expect(services.playback.getState().mixer).toEqual({ [lead]: { solo: true } });
    expect(strip('Bass')).toHaveAttribute('data-audible', 'false');
  });
});
