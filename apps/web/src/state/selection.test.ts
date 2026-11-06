import { describe, expect, it } from 'vitest';

import { createSelectionStore } from './selection';

describe('the selection store', () => {
  it('sets the current track, the selection and the bar range, and resets them', () => {
    const store = createSelectionStore();
    store.getState().setCurrentTrack('track000001');
    store.getState().select({ noteIds: ['note00000001'] });
    store.getState().selectBars({ startBar: 'bar000000001', endBar: 'bar000000002' });

    expect(store.getState()).toMatchObject({
      currentTrack: 'track000001',
      selection: { noteIds: ['note00000001'] },
      bars: { startBar: 'bar000000001', endBar: 'bar000000002' },
    });

    store.getState().reset('track000002');
    expect(store.getState()).toMatchObject({
      currentTrack: 'track000002',
      selection: {},
      bars: undefined,
    });
  });
});
