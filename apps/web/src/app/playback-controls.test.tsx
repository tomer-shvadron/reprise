import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { initialPlaybackState, type PlaybackStoreState } from '@/state/playback';
import { renderWithServices } from '@/test/render';

import { PlaybackControls, soundStatus } from './playback-controls';

function stateWith(partial: Partial<PlaybackStoreState>): PlaybackStoreState {
  return { ...initialPlaybackState(), ...partial };
}

describe('PlaybackControls', () => {
  it('stays disabled until the song is ready, then toggles play', async () => {
    const { services } = renderWithServices(<PlaybackControls />);
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();

    act(() => {
      services.playback.setState({ song: { status: 'ready', error: undefined } });
    });
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(services.fakeAudio.togglePlay).toHaveBeenCalledOnce();

    act(() => {
      services.playback.setState({ transport: 'playing' });
    });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  });

  it('offers Retry when sounds are unavailable', async () => {
    const { services } = renderWithServices(<PlaybackControls />);
    const user = userEvent.setup();

    act(() => {
      services.playback.setState({
        sounds: { status: 'error', loaded: 0, total: undefined, error: 'missing' },
      });
    });

    expect(screen.getByRole('status')).toHaveTextContent('Sounds unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(services.fakeAudio.retry).toHaveBeenCalledOnce();
  });
});

describe('soundStatus', () => {
  it('names each load stage', () => {
    const sounds = (partial: Partial<PlaybackStoreState['sounds']>) => ({
      ...initialPlaybackState().sounds,
      ...partial,
    });
    expect(soundStatus(stateWith({}))).toBeUndefined();
    expect(
      soundStatus(stateWith({ sounds: sounds({ status: 'loading', loaded: 42, total: 100 }) }))
        ?.text,
    ).toBe('Loading sounds… 42%');
    expect(soundStatus(stateWith({ sounds: sounds({ status: 'loading' }) }))?.text).toBe(
      'Loading sounds…',
    );
    expect(soundStatus(stateWith({ song: { status: 'loading', error: undefined } }))?.text).toBe(
      'Preparing instruments…',
    );
    expect(soundStatus(stateWith({ output: { status: 'error', error: 'no device' } }))).toEqual({
      text: 'Audio output unavailable',
      retry: true,
    });
  });
});
