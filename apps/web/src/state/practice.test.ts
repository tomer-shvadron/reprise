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

  it('replaces and returns the session of a different document', () => {
    const store = begin();
    store.getState().addPlayed(300);
    const replaced = store.getState().start({ songId: undefined, documentId: 'doc-2', now: 2000 });
    expect(replaced).toMatchObject({ documentId: 'doc-1', playedMs: 300 });
    expect(store.getState().session).toMatchObject({
      songId: undefined,
      documentId: 'doc-2',
      playedMs: 0,
    });
  });

  it('returns nothing from a start that replaces nothing', () => {
    const store = createPracticeStore();
    const args = { songId: undefined, documentId: 'doc-1', now: 1 };
    expect(store.getState().start(args)).toBeUndefined();
    expect(store.getState().start(args)).toBeUndefined();
  });

  it('attributes a running session to a song set later', () => {
    const store = createPracticeStore();
    store.getState().start({ songId: undefined, documentId: 'doc-1', now: 1 });
    store.getState().setSongId('song-9');
    expect(store.getState().session?.songId).toBe('song-9');
  });

  it('adds played time and ignores non-positive amounts', () => {
    const store = begin();
    store.getState().addPlayed(250);
    store.getState().addPlayed(-5);
    store.getState().addPlayed(250);
    expect(store.getState().session?.playedMs).toBe(500);
  });

  it('records a loop once', () => {
    const store = begin();
    store.getState().noteLoop(loop);
    store.getState().noteLoop({ ...loop });
    expect(store.getState().session?.loops).toEqual([{ ...loop, bestPercent: undefined }]);
  });

  it('orders loops by last use, so the last one is the one to resume', () => {
    const store = begin();
    const other = { startBar: 'bar-c', endBar: 'bar-d' };
    store.getState().noteLoop(loop);
    store.getState().noteLoop(other);
    store.getState().noteLoop(loop);
    expect(store.getState().session?.loops.map((entry) => entry.startBar)).toEqual([
      'bar-c',
      'bar-a',
    ]);
  });

  it('keeps the highest completed step per loop and creates the record when missing', () => {
    const store = begin();
    store.getState().recordStep(loop, 70);
    store.getState().recordStep(loop, 85);
    store.getState().recordStep(loop, 60);
    expect(store.getState().session?.loops).toEqual([{ ...loop, bestPercent: 85 }]);
  });

  it('ignores loops and steps with no session', () => {
    const store = createPracticeStore();
    store.getState().noteLoop(loop);
    store.getState().recordStep(loop, 90);
    expect(store.getState().session).toBeUndefined();
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
    store.getState().noteLoop(loop);
    const ended = store.getState().end();
    expect(ended?.loops).toHaveLength(1);
    expect(store.getState().session).toBeUndefined();
    expect(store.getState().end()).toBeUndefined();
  });
});
