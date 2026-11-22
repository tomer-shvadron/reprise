import { describe, expect, it, vi } from 'vitest';

import type { MenuChecks } from '@/platform/bridge';
import { createPlaybackStore } from '@/state/playback';

import { installMenuChecks, menuChecksOf } from './install-menu-checks';

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('menuChecksOf', () => {
  it('reads the four checkbox items from the settings', () => {
    const { settings } = createPlaybackStore().getState();

    expect(menuChecksOf(settings)).toEqual({
      'transport.toggleLoop': false,
      'transport.toggleCountIn': false,
      'transport.toggleMetronome': false,
      'transport.toggleFixedTempo': false,
    });
    expect(
      menuChecksOf({
        ...settings,
        loop: { startBar: '1', endBar: '2' },
        countIn: true,
        metronome: { on: true, volume: 0.5 },
        tempo: { mode: 'bpm', value: 90 },
      }),
    ).toEqual({
      'transport.toggleLoop': true,
      'transport.toggleCountIn': true,
      'transport.toggleMetronome': true,
      'transport.toggleFixedTempo': true,
    });
  });
});

describe('installMenuChecks', () => {
  const setup = () => {
    const playback = createPlaybackStore();
    const setMenuChecks = vi.fn<(checked: MenuChecks) => Promise<boolean>>(() =>
      Promise.resolve(true),
    );
    return { playback, setMenuChecks };
  };
  const setSettings = (playback: ReturnType<typeof createPlaybackStore>, patch: object) => {
    playback.setState((state) => ({ settings: { ...state.settings, ...patch } }));
  };

  it('does nothing on a platform without a menu', () => {
    const { playback } = setup();

    const stop = installMenuChecks({ playback, platform: {} });
    expect(stop).not.toThrow();
  });

  it('pushes at once, again on a change, and skips an unchanged map', async () => {
    const { playback, setMenuChecks } = setup();
    installMenuChecks({ playback, platform: { setMenuChecks } });
    await settle();
    expect(setMenuChecks).toHaveBeenCalledTimes(1);

    // Not a checked state: the volume moves and the map stays the same.
    setSettings(playback, { metronome: { on: false, volume: 0.2 } });
    await settle();
    expect(setMenuChecks).toHaveBeenCalledTimes(1);

    setSettings(playback, { countIn: true });
    expect(setMenuChecks).toHaveBeenCalledTimes(2);
    expect(setMenuChecks.mock.calls[1]?.[0]['transport.toggleCountIn']).toBe(true);
  });

  it('tries a refused push again on the next change, and stops after the undo', async () => {
    const { playback, setMenuChecks } = setup();
    setMenuChecks.mockResolvedValueOnce(false);
    const stop = installMenuChecks({ playback, platform: { setMenuChecks } });
    await settle();
    setSettings(playback, { countIn: false, loop: undefined });
    expect(setMenuChecks).toHaveBeenCalledTimes(2);
    await settle();
    setSettings(playback, { countIn: false });
    expect(setMenuChecks).toHaveBeenCalledTimes(2);

    stop();
    setSettings(playback, { countIn: true });
    expect(setMenuChecks).toHaveBeenCalledTimes(2);
  });
});
