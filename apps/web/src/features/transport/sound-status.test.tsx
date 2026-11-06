import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { initialPlaybackState, type PlaybackStoreState } from '@/state/playback';
import { renderWithServices } from '@/test/render';

import { megabytes, SoundStatus, soundStatus } from './sound-status';

const status = () => {
  const element = document.querySelector<HTMLElement>('[data-sound-status]');
  if (!element) throw new Error('no sound status');
  return element;
};

function stateWith(partial: Partial<PlaybackStoreState>): PlaybackStoreState {
  return { ...initialPlaybackState(), ...partial };
}

describe('SoundStatus', () => {
  it('offers Retry when sounds are unavailable', async () => {
    const { services } = renderWithServices(<SoundStatus />);
    const user = userEvent.setup();

    act(() => {
      services.playback.setState({
        sounds: { status: 'error', loaded: 0, total: undefined, error: 'missing' },
      });
    });

    expect(status()).toHaveTextContent('Sounds unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(services.fakeAudio.retry).toHaveBeenCalledOnce();
  });

  it('counts the song’s instruments in the memory tooltip, not the bank’s preset aliases', async () => {
    const { services } = renderWithServices(<SoundStatus />);
    const user = userEvent.setup();
    act(() => {
      services.playback.setState({
        memory: {
          decodedBytes: 0.63 * 1024 * 1024,
          budgetBytes: 80 * 1024 * 1024,
          residents: ['gm:0:25', 'gm:0:93', 'gm:12:27', 'gm:8:107', 'gm:8:25'],
        },
        instruments: 1,
      });
    });

    expect(status()).toHaveTextContent('0.6 MB');
    await user.hover(status());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      '0.6 of 80 MB decoded · 1 instrument',
    );
  });
});

describe('megabytes', () => {
  it('keeps a decimal below 10 MB', () => {
    expect(megabytes(0.63 * 1024 * 1024)).toBe('0.6');
    expect(megabytes(9.94 * 1024 * 1024)).toBe('9.9');
    expect(megabytes(80 * 1024 * 1024)).toBe('80');
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
    expect(
      soundStatus(stateWith({ sounds: sounds({ status: 'loading', loaded: 42, total: 100 }) }))
        ?.stage,
    ).toBe('Loading sounds…');
    expect(soundStatus(stateWith({ song: { status: 'loading', error: undefined } }))?.text).toBe(
      'Preparing instruments…',
    );
    expect(soundStatus(stateWith({ output: { status: 'error', error: 'no device' } }))).toEqual({
      text: 'Audio output unavailable',
      stage: 'Audio output unavailable',
      retry: true,
    });
  });
});
