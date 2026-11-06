import { GM_BUDGET_BYTES } from '@reprise/audio';
import { describe, expect, it } from 'vitest';

import { createPlaybackStore, selectCanPlay, selectRunning } from './playback';

describe('the playback store', () => {
  it('starts stopped, locked and idle, with the GM budget', () => {
    const state = createPlaybackStore().getState();
    expect(state.transport).toBe('stopped');
    expect(state.output.status).toBe('locked');
    expect(state.sounds.status).toBe('idle');
    expect(state.memory).toEqual({ decodedBytes: 0, budgetBytes: GM_BUDGET_BYTES, residents: [] });
    expect(state.settings).toEqual({
      tempo: { mode: 'percent', value: 100 },
      loop: undefined,
      countIn: false,
      metronome: { on: false, volume: 0.7 },
    });
  });

  it('can play once the song is ready, unless audio output failed', () => {
    const store = createPlaybackStore();
    expect(selectCanPlay(store.getState())).toBe(false);
    store.setState({ song: { status: 'ready', error: undefined } });
    expect(selectCanPlay(store.getState())).toBe(true);
    store.setState({ output: { status: 'error', error: 'no device' } });
    expect(selectCanPlay(store.getState())).toBe(false);
  });

  it('counts a count-in as running', () => {
    const store = createPlaybackStore();
    store.setState({ transport: 'counting-in' });
    expect(selectRunning(store.getState())).toBe(true);
    store.setState({ transport: 'paused' });
    expect(selectRunning(store.getState())).toBe(false);
  });
});
