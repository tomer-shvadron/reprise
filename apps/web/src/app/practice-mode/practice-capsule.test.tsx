import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { SpeedTrainerChip } from '@/features/trainer';
import { renderHeader } from '../header/test/render-header';

import { PracticeCapsule } from './practice-capsule';

describe('PracticeCapsule', () => {
  it('holds the transport controls, the trainer chip that starts it, and a way out', async () => {
    const { open } = renderHeader(<PracticeCapsule />);
    await open();
    const capsule = screen.getByRole('region', { name: 'Practice controls' });
    const inside = within(capsule);
    expect(inside.getByRole('group', { name: 'Playback' })).toBeInTheDocument();
    expect(inside.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(inside.getByRole('group', { name: 'Practice' })).toBeInTheDocument();
    expect(inside.getByRole('button', { name: /^Loop/ })).toBeInTheDocument();
    expect(inside.getByRole('button', { name: 'Count-in' })).toBeInTheDocument();
    expect(inside.getByRole('button', { name: 'Metronome' })).toBeInTheDocument();
    expect(inside.getByTestId('speed-trainer-chip')).toHaveAttribute(
      'data-command',
      'trainer.speedTrainerToggle',
    );
    expect(inside.getByRole('button', { name: 'Leave practice mode' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Escape',
    );
  });

  it('leaves the mode from its button', async () => {
    const { open, services } = renderHeader(<PracticeCapsule />);
    await open();
    services.ui.getState().enterPracticeMode('play');
    await userEvent.click(screen.getByRole('button', { name: 'Leave practice mode' }));
    expect(services.ui.getState().practiceMode.on).toBe(false);
  });

  it('starts the speed trainer without opening a panel or ending the mode', async () => {
    const { open, services } = renderHeader(<PracticeCapsule />);
    await open();
    services.ui.getState().enterPracticeMode('play');
    await userEvent.click(screen.getByTestId('speed-trainer-chip'));
    expect(services.ui.getState().practiceMode.on).toBe(true);
    expect(services.ui.getState().panels.rightPanel).toBe(false);
  });
});

describe('PracticeCapsule standalone click indicator', () => {
  const setRunning = (services: ReturnType<typeof renderHeader>['services'], running: boolean) => {
    act(() => {
      services.playback.setState({ click: { ...services.playback.getState().click, running } });
    });
  };

  it('shows only while the standalone click runs, and a press stops it', async () => {
    const { open, services } = renderHeader(<PracticeCapsule />);
    await open();
    expect(screen.queryByRole('button', { name: 'Click, standalone metronome on' })).toBeNull();
    setRunning(services, true);
    const indicator = screen.getByRole('button', { name: 'Click, standalone metronome on' });
    expect(indicator).toHaveAttribute('aria-keyshortcuts');
    // The capsule's own Metronome toggle stays a separate control.
    expect(screen.getByRole('button', { name: 'Metronome' })).toBeInTheDocument();
    await userEvent.setup().click(indicator);
    expect(services.fakeAudio.stopClick).toHaveBeenCalledOnce();
    expect(services.ui.getState().panels.rightPanel).toBe(false);
    setRunning(services, false);
    expect(screen.queryByRole('button', { name: 'Click, standalone metronome on' })).toBeNull();
  });

  it("stays hidden while only the song's metronome is on", async () => {
    const { open, services } = renderHeader(<PracticeCapsule />);
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Metronome' }));
    expect(services.playback.getState().click.running).toBe(false);
    expect(screen.queryByRole('button', { name: /standalone metronome/ })).toBeNull();
  });

  it('moves focus to the score when a keyboard press stops it', async () => {
    const { open, services } = renderHeader(
      <>
        <main aria-roledescription="score" role="region" tabIndex={-1}>
          score
        </main>
        <PracticeCapsule />
      </>,
    );
    await open();
    setRunning(services, true);
    screen.getByRole('button', { name: 'Click, standalone metronome on' }).focus();
    await userEvent.setup().keyboard('{Enter}');
    setRunning(services, false);
    expect(document.activeElement).toBe(screen.getByText('score'));
  });
});

describe('SpeedTrainerChip in the transport', () => {
  it('still shows the settings, which opens the panel', async () => {
    const { open, services } = renderHeader(<SpeedTrainerChip />);
    await open();
    await userEvent.click(screen.getByTestId('speed-trainer-chip'));
    expect(services.ui.getState().rightPanelView).toBe('speedTrainer');
  });
});
