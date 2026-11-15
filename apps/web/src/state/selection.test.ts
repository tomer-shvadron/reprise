import { describe, expect, it, vi } from 'vitest';

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
      barsAnchor: 'bar000000001',
    });

    store
      .getState()
      .selectBars({ startBar: 'bar000000001', endBar: 'bar000000002' }, 'bar000000002');
    expect(store.getState().barsAnchor).toBe('bar000000002');
    store.getState().selectBars(undefined, 'bar000000003');
    expect(store.getState()).toMatchObject({ bars: undefined, barsAnchor: 'bar000000003' });

    store.getState().reset('track000002');
    expect(store.getState()).toMatchObject({
      currentTrack: 'track000002',
      selection: {},
      bars: undefined,
      barsAnchor: undefined,
    });
  });

  describe('the edit cursor and range', () => {
    const cursor = {
      track: 'track000001',
      masterBar: 'bar000000001',
      voice: 0,
      beat: undefined,
      string: 1,
      staff: 'tab',
      at: { track: 0, bar: 0, beat: 0 },
    } as const;
    const range = {
      kind: 'beats',
      anchor: { track: 'track000001', masterBar: 'bar000000001', beat: 'beat00000001' },
      focus: { track: 'track000001', masterBar: 'bar000000002', beat: undefined },
    } as const;

    it('starts with neither', () => {
      expect(createSelectionStore().getState()).toMatchObject({
        cursor: undefined,
        range: undefined,
      });
    });

    it('setEdit sets only the keys present and clears a key given as undefined', () => {
      const store = createSelectionStore();
      store.getState().select({ noteIds: ['note00000001'] });
      store.getState().setEdit({ cursor, range, currentTrack: 'track000001' });
      expect(store.getState()).toMatchObject({
        cursor,
        range,
        currentTrack: 'track000001',
        selection: { noteIds: ['note00000001'] },
      });

      store.getState().setEdit({ range: undefined, bars: { startBar: 'a', endBar: 'b' } });
      expect(store.getState()).toMatchObject({
        cursor,
        range: undefined,
        bars: { startBar: 'a', endBar: 'b' },
        selection: { noteIds: ['note00000001'] },
      });
    });

    it('setEdit notifies once', () => {
      const store = createSelectionStore();
      const listener = vi.fn();
      store.subscribe(listener);
      store.getState().setEdit({ cursor, range, selection: {}, barsAnchor: 'a' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('selectBars clears the range but keeps the cursor', () => {
      const store = createSelectionStore();
      store.getState().setEdit({ cursor, range });
      store.getState().selectBars({ startBar: 'a', endBar: 'b' });
      expect(store.getState()).toMatchObject({ cursor, range: undefined });
    });

    it('reset clears both', () => {
      const store = createSelectionStore();
      store.getState().setEdit({ cursor, range });
      store.getState().reset();
      expect(store.getState()).toMatchObject({ cursor: undefined, range: undefined });
    });
  });
});
