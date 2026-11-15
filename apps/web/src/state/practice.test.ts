import { describe, expect, it } from 'vitest';

import { createPracticeStore } from './practice';

const loop = { startBar: 'bar-a', endBar: 'bar-b' };
const begin = (store = createPracticeStore(), documentId = 'doc-1') => {
  store.getState().start({ songId: 'song-1', documentId, now: 1000 });
  return store;
};

describe('practice store', () => {
  it('has no session until started', () => {
    const store = createPracticeStore();
    store.getState().addPlayed(500);
    store.getState().recordTempo({ mode: 'percent', value: 80 });
    expect(store.getState().session).toBeUndefined();
  });

  it('starts a session carrying the song and document', () => {
    const { session } = begin().getState();
    expect(session).toEqual({
      songId: 'song-1',
      documentId: 'doc-1',
      startedAt: 1000,
      playedMs: 0,
      loops: [],
      tempoHistory: [],
    });
  });

  it('keeps the running session when started again for the same document', () => {
    const store = begin();
    store.getState().addPlayed(300);
    store.getState().start({ songId: 'song-1', documentId: 'doc-1', now: 9999 });
    expect(store.getState().session).toMatchObject({ startedAt: 1000, playedMs: 300 });
  });

  it('replaces the session for a different document', () => {
    const store = begin();
    store.getState().addPlayed(300);
    store.getState().start({ songId: undefined, documentId: 'doc-2', now: 2000 });
    expect(store.getState().session).toMatchObject({
      songId: undefined,
      documentId: 'doc-2',
      playedMs: 0,
    });
  });

  it('adds played time and ignores non-positive amounts', () => {
    const store = begin();
    store.getState().addPlayed(250);
    store.getState().addPlayed(-5);
    store.getState().addPlayed(250);
    expect(store.getState().session?.playedMs).toBe(500);
  });

  it('records a loop once and tracks the active one', () => {
    const store = begin();
    store.getState().setLoop(loop);
    store.getState().setLoop({ ...loop });
    expect(store.getState().session?.loops).toEqual([{ ...loop, bestPercent: undefined }]);
    expect(store.getState().activeLoop).toEqual(loop);
    store.getState().setLoop(undefined);
    expect(store.getState().activeLoop).toBeUndefined();
    expect(store.getState().session?.loops).toHaveLength(1);
  });

  it('keeps the highest completed step per loop', () => {
    const store = begin();
    store.getState().setLoop(loop);
    store.getState().recordStep(70);
    store.getState().recordStep(85);
    store.getState().recordStep(60);
    expect(store.getState().session?.loops[0]?.bestPercent).toBe(85);
  });

  it('ignores a step with no active loop', () => {
    const store = begin();
    store.getState().recordStep(90);
    expect(store.getState().session?.loops).toEqual([]);
  });

  it('records tempo changes against played time and skips repeats', () => {
    const store = begin();
    store.getState().recordTempo({ mode: 'percent', value: 100 });
    store.getState().addPlayed(4000);
    store.getState().recordTempo({ mode: 'percent', value: 100 });
    store.getState().recordTempo({ mode: 'percent', value: 90 });
    expect(store.getState().session?.tempoHistory).toEqual([
      { atPlayedMs: 0, tempo: { mode: 'percent', value: 100 } },
      { atPlayedMs: 4000, tempo: { mode: 'percent', value: 90 } },
    ]);
  });

  it('ends the session, returning it and clearing the store', () => {
    const store = begin();
    store.getState().setLoop(loop);
    const ended = store.getState().end();
    expect(ended?.loops).toHaveLength(1);
    expect(store.getState().session).toBeUndefined();
    expect(store.getState().activeLoop).toBeUndefined();
    expect(store.getState().end()).toBeUndefined();
  });
});
