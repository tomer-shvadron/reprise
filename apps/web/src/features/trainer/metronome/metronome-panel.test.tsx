import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from '@/app/app';
import { createAppRegistry } from '@/app/app-registry';
import { runCommand } from '@/app/command-registry';
import type { PlaybackStoreState } from '@/state/playback';
import { createTestServices } from '@/test/services';

/** The fake audio service records calls; this makes its click methods write `playback.click`. */
function mirrorClick(services: ReturnType<typeof createTestServices>) {
  const { fakeAudio, playback } = services;
  const click = (partial: Partial<PlaybackStoreState['click']>) => {
    playback.setState({ click: { ...playback.getState().click, ...partial } });
  };
  const update = (settings: Partial<PlaybackStoreState['click']['settings']>) => {
    click({ settings: { ...playback.getState().click.settings, ...settings } });
  };
  fakeAudio.startClick.mockImplementation((settings) => {
    update(settings ?? {});
    click({ running: true });
  });
  fakeAudio.updateClick.mockImplementation(update);
  fakeAudio.stopClick.mockImplementation(() => {
    click({ running: false });
  });
}

function renderEmptyApp() {
  const services = createTestServices();
  mirrorClick(services);
  render(<App services={services} keyboard="mac" />);
  expect(services.document.getState().score).toBeUndefined();
  const run = (id: string) => {
    const command = createAppRegistry(services).get(id);
    if (!command) throw new Error(`no command ${id}`);
    act(() => {
      runCommand(command);
    });
  };
  run('trainer.metronome');
  const panel = within(screen.getByRole('region', { name: 'Metronome' }));
  return { services, run, panel, user: userEvent.setup() };
}

describe('MetronomePanel from the empty state', () => {
  it('starts and stops the click with no song open', async () => {
    const { services, panel, user } = renderEmptyApp();
    await user.click(panel.getByRole('button', { name: 'Start' }));
    expect(services.fakeAudio.startClick).toHaveBeenCalledOnce();
    expect(services.playback.getState().click.running).toBe(true);
    await user.click(panel.getByRole('button', { name: 'Stop' }));
    expect(services.fakeAudio.stopClick).toHaveBeenCalledOnce();
    expect(services.playback.getState().click.running).toBe(false);
  });

  it('starts and stops from the command, which shows the panel only when it starts', () => {
    const { services, run } = renderEmptyApp();
    services.ui.getState().setPanelOpen('rightPanel', false);
    run('trainer.metronomeToggle');
    expect(services.playback.getState().click.running).toBe(true);
    expect(services.ui.getState().panels.rightPanel).toBe(true);
    services.ui.getState().setPanelOpen('rightPanel', false);
    run('trainer.metronomeToggle');
    expect(services.playback.getState().click.running).toBe(false);
    expect(services.ui.getState().panels.rightPanel).toBe(false);
  });

  it('sets the tempo from the field, ignoring a value outside the range', () => {
    const { services, panel } = renderEmptyApp();
    const field = panel.getByRole('textbox', { name: 'Tempo' });
    fireEvent.change(field, { target: { value: '140' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(services.playback.getState().click.settings.bpm).toBe(140);
    fireEvent.change(field, { target: { value: '900' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(services.playback.getState().click.settings.bpm).toBe(140);
    fireEvent.keyDown(field, { key: 'ArrowUp', shiftKey: true });
    expect(services.playback.getState().click.settings.bpm).toBe(150);
  });

  it('taps a tempo of exactly 120 for taps half a second apart', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { services, panel } = renderEmptyApp();
      const tap = panel.getByRole('button', { name: 'Tap tempo' });
      vi.setSystemTime(10_000);
      fireEvent.click(tap);
      expect(services.fakeAudio.updateClick).not.toHaveBeenCalled();
      vi.setSystemTime(10_500);
      fireEvent.click(tap);
      expect(services.fakeAudio.updateClick).toHaveBeenCalledExactlyOnceWith({ bpm: 120 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets the time signature, subdivision, accent and volume', async () => {
    const { services, panel, user } = renderEmptyApp();
    const beats = panel.getByRole('textbox', { name: 'Beats per bar' });
    fireEvent.change(beats, { target: { value: '7' } });
    fireEvent.keyDown(beats, { key: 'Enter' });
    await user.click(panel.getByRole('radio', { name: '3 per beat (triplets)' }));
    await user.click(panel.getByRole('switch', { name: 'Accent the downbeat' }));
    const volume = panel.getByRole('slider', { name: 'Metronome click volume' });
    volume.focus();
    await user.keyboard('{End}');
    expect(services.playback.getState().click.settings).toMatchObject({
      beatsPerBar: 7,
      subdivision: 3,
      accents: [],
      volume: 1,
    });
  });

  it('lets the beats field be cleared and typed without touching the click until it commits', () => {
    const { services, panel } = renderEmptyApp();
    const beats = panel.getByRole('textbox', { name: 'Beats per bar' });
    fireEvent.change(beats, { target: { value: '' } });
    expect(beats).toHaveValue('');
    fireEvent.change(beats, { target: { value: '1' } });
    fireEvent.change(beats, { target: { value: '12' } });
    expect(services.fakeAudio.updateClick).not.toHaveBeenCalled();
    fireEvent.keyDown(beats, { key: 'Enter' });
    expect(services.playback.getState().click.settings.beatsPerBar).toBe(12);
    fireEvent.change(beats, { target: { value: '5' } });
    fireEvent.keyDown(beats, { key: 'Escape' });
    expect(beats).toHaveValue('12');
  });

  it('counts 6/8 in dotted quarters, shows 6/8, and keeps the meter when the panel remounts', async () => {
    const { services, panel, user, run } = renderEmptyApp();
    expect(panel.queryByRole('switch', { name: 'Count in dotted quarters' })).toBeNull();
    const beats = panel.getByRole('textbox', { name: 'Beats per bar' });
    fireEvent.change(beats, { target: { value: '6' } });
    fireEvent.keyDown(beats, { key: 'Enter' });
    await user.click(panel.getByRole('radio', { name: '8' }));
    expect(services.playback.getState().click.settings).toMatchObject({
      beatsPerBar: 2,
      subdivision: 3,
    });
    expect(beats).toHaveValue('6');
    expect(panel.getByText('Tempo, BPM of the dotted quarter note')).toBeInTheDocument();

    await user.click(panel.getByRole('switch', { name: 'Count in dotted quarters' }));
    expect(services.playback.getState().click.settings).toMatchObject({
      beatsPerBar: 6,
      subdivision: 1,
    });
    expect(panel.getByText('Tempo, BPM of the eighth note')).toBeInTheDocument();

    run('trainer.metronome');
    act(() => {
      services.ui.getState().showPanelView('mixer');
    });
    run('trainer.metronome');
    const again = within(screen.getByRole('region', { name: 'Metronome' }));
    expect(again.getByRole('textbox', { name: 'Beats per bar' })).toHaveValue('6');
    expect(again.getByText('Tempo, BPM of the eighth note')).toBeInTheDocument();
  });
});
