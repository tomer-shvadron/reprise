import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '@/app/app';
import { createAppRegistry } from '@/app/app-registry';
import { runCommand } from '@/app/command-registry';
import { createTestServices } from '@/test/services';

/** The fake audio service records calls; this makes its click methods write `playback.click`. */
function mirrorClick(services: ReturnType<typeof createTestServices>) {
  const { fakeAudio, playback } = services;
  const click = (partial: object) => {
    playback.setState({ click: { ...playback.getState().click, ...partial } });
  };
  const update = (settings: object) => {
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

  it('starts and stops from the command, which shows the panel', () => {
    const { services, run } = renderEmptyApp();
    run('trainer.metronomeToggle');
    expect(services.playback.getState().click.running).toBe(true);
    run('trainer.metronomeToggle');
    expect(services.playback.getState().click.running).toBe(false);
  });

  it('sets the tempo from the field, ignoring a value outside the range', () => {
    const { services, panel } = renderEmptyApp();
    const field = panel.getByRole('textbox');
    fireEvent.change(field, { target: { value: '140' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(services.playback.getState().click.settings.bpm).toBe(140);
    fireEvent.change(field, { target: { value: '900' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(services.playback.getState().click.settings.bpm).toBe(140);
  });

  it('taps a tempo', () => {
    const { services, panel } = renderEmptyApp();
    const tap = panel.getByRole('button', { name: 'Tap tempo' });
    fireEvent.click(tap);
    expect(services.fakeAudio.updateClick).not.toHaveBeenCalled();
    // jsdom stamps events with the real clock, so assert only that a second tap sets a tempo.
    fireEvent.click(tap);
    expect(services.fakeAudio.updateClick).toHaveBeenCalledOnce();
    const [update] = services.fakeAudio.updateClick.mock.calls[0] ?? [];
    expect(update?.bpm).toBeGreaterThanOrEqual(10);
  });

  it('sets the time signature, subdivision, accent and volume', async () => {
    const { services, panel, user } = renderEmptyApp();
    fireEvent.change(panel.getByRole('spinbutton', { name: 'Beats per bar' }), {
      target: { value: '7' },
    });
    await user.click(panel.getByRole('radio', { name: 'Triplet' }));
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
});
