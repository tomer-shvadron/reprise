import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { initialPlaybackState, type PlaybackStoreState } from '@/state/playback';
import { renderHeader, spyOnCommand } from '@/app/header/test/render-header';

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
    const { services } = renderHeader(<SoundStatus />);
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

  it('shows the tier and the decoded memory, and the budget and counts in the tooltip', async () => {
    const { services } = renderHeader(<SoundStatus />);
    const user = userEvent.setup();
    act(() => {
      services.playback.setState({
        memory: {
          decodedBytes: 0.63 * 1024 * 1024,
          budgetBytes: 80 * 1024 * 1024,
          residents: ['gm:0:25', 'gm:0:93', 'gm:12:27', 'gm:8:107', 'gm:8:25'],
          unused: ['gm:0:93', 'gm:8:107'],
          shortfall: false,
        },
      });
    });

    expect(status()).toHaveTextContent('GM · 0.6 MB');
    // The desktop smoke test waits on this ending.
    expect(status().textContent).toMatch(/\d MB$/);
    await user.hover(status());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Sounds: 0.6 of 80 MB decoded · 5 instruments loaded (2 unused)',
    );
  });
});

describe('SoundStatus segment', () => {
  const memory = {
    decodedBytes: 42 * 1024 * 1024,
    budgetBytes: 300 * 1024 * 1024,
    residents: [],
    unused: [],
    shortfall: false,
  };

  it("names a mixed tier over the song's tracks", async () => {
    const { services, open } = renderHeader(<SoundStatus />);
    await open();
    const [first] = services.document.getState().score?.tracks ?? [];
    if (!first) throw new Error('no track');
    act(() => {
      services.playback.setState({
        memory,
        trackSounds: { [first.id]: { tier: 'hq', packId: 'pack' } },
      });
    });
    expect(status()).toHaveTextContent('GM + HQ · 42 MB');
  });

  it('opens the Sounds screen, and keeps focus where it was on mousedown', async () => {
    const { services, registry } = renderHeader(<SoundStatus />);
    act(() => {
      services.playback.setState({ memory });
    });
    const show = spyOnCommand(registry, 'sounds.show');
    const segment = screen.getByRole('button', { name: /42 MB/ });
    expect(fireEvent.mouseDown(segment)).toBe(false);
    await userEvent.setup().click(segment);
    expect(show).toHaveBeenCalledOnce();
  });

  it('is absent before anything loaded, and shows the load text in place of the memory', () => {
    const { services } = renderHeader(<SoundStatus />);
    expect(screen.queryByRole('button')).toBeNull();
    act(() => {
      services.playback.setState({
        sounds: { status: 'loading', loaded: 42, total: 100, error: undefined },
      });
    });
    expect(status()).toHaveTextContent('Loading sounds… 42%');
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
