import { write } from '@reprise/formats';
import {
  layout,
  LayoutCache,
  VERTICAL_EDIT_REACH,
  VERTICAL_FOLLOW_UP_REACH,
  type LayoutOptions,
} from '@reprise/layout';
import { insertBar, setNote, setNoteEffect } from '@reprise/model';
import { beatOf, largeScore, note, score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { viewLayoutOptions } from '@/features/score';
import { fakePlatform } from '@/test/services';

import { createDocumentStore, type DocumentStore } from './document';
import { createLayoutStore, FOLLOW_UP_DELAY_MS, FOLLOW_UP_IDLE_TIMEOUT_MS } from './layout';
import { createUiStore } from './ui';

const options = viewLayoutOptions;

async function bytesOf(title: string, bars = 1) {
  let builder = score().title(title).track('guitar');
  for (let bar = 0; bar < bars; bar++) builder = builder.bar().beat('1', [note(1, bar)]);
  return (await write(builder.build(), 'reprise')).bytes;
}

function setup(layoutFn: typeof layout = vi.fn(layout)) {
  const document = createDocumentStore({ platform: fakePlatform() });
  const ui = createUiStore('dark');
  const spy = vi.mocked(layoutFn);
  const store = createLayoutStore({ document, ui, options, layout: layoutFn });
  return { document, ui, store, spy };
}

const lastCall = (spy: ReturnType<typeof vi.mocked<typeof layout>>) => {
  const call = spy.mock.calls.at(-1);
  if (!call) throw new Error('layout was not called');
  return { options: call[1], cache: call[2] };
};

function edit(document: DocumentStore, fret: number) {
  const current = document.getState().score;
  if (!current) throw new Error('no score');
  document.getState().apply(setNote({ beatId: beatOf(current, 0, 0, 0).id }, { string: 1, fret }));
}

describe('the layout store', () => {
  it('lays out an opened score cold, with a new cache', async () => {
    const { document, store, spy } = setup();

    await document.getState().openBytes('a.reprise', await bytesOf('A'));

    expect(spy).toHaveBeenCalledOnce();
    const call = lastCall(spy);
    expect(call.cache).toBeInstanceOf(LayoutCache);
    expect(call.options).toEqual(
      options({ mode: 'paged', paper: 'a4' }, { tracks: 'all', notation: {} }),
    );
    expect(store.getState().result?.systems.length).toBeGreaterThan(0);
    expect(store.getState().documentId).toBe(document.getState().id);
  });

  it('passes an edit’s touched bars to the same cache, and undo’s and redo’s', async () => {
    const { document, spy } = setup();
    await document.getState().openBytes('a.reprise', await bytesOf('A', 3));
    const { cache } = lastCall(spy);

    edit(document, 5);
    const touched = document.getState().lastChange?.touchedBars;
    expect(lastCall(spy).options.dirtyBars).toEqual(touched);
    expect(lastCall(spy).cache).toBe(cache);

    document.getState().undo();
    expect(lastCall(spy).options.dirtyBars).toEqual(touched);
    expect(lastCall(spy).cache).toBe(cache);
    document.getState().redo();
    expect(lastCall(spy).options.dirtyBars).toEqual(touched);
  });

  it('lays out a history jump once, with every bar the jumped steps touched', async () => {
    const { document, spy } = setup();
    await document.getState().openBytes('a.reprise', await bytesOf('A', 3));
    const { cache } = lastCall(spy);
    edit(document, 5);
    document.getState().apply(insertBar({ index: 1 }));
    edit(document, 6);
    const touched = document.getState().undoLabel;
    expect(touched).toBeDefined();
    const calls = spy.mock.calls.length;

    expect(document.getState().step(-3)).toBe(3);
    expect(spy.mock.calls.length).toBe(calls + 1);
    expect(lastCall(spy).cache).toBe(cache);
    const dirty = lastCall(spy).options.dirtyBars ?? [];
    const merged = document.getState().lastChange?.touchedBars ?? [];
    expect(dirty).toEqual(merged);
    expect(dirty.length).toBeGreaterThan(1);
  });

  it('re-lays out for a view change, never for zoom, theme or panels', async () => {
    const { document, ui, spy } = setup();
    await document.getState().openBytes('a.reprise', await bytesOf('A'));
    const { cache } = lastCall(spy);
    spy.mockClear();

    ui.getState().setZoom(2);
    ui.getState().setTheme('light');
    ui.getState().togglePanel('rightPanel');
    expect(spy).not.toHaveBeenCalled();

    ui.getState().setViewMode('continuous');
    expect(lastCall(spy).options.mode).toBe('continuous');
    expect(lastCall(spy).cache).toBe(cache);

    const trackId = document.getState().score?.tracks[0]?.id ?? '';
    document.getState().setNotation(trackId, 'both');
    expect(lastCall(spy).options.notation).toEqual({ [trackId]: 'both' });
    expect(lastCall(spy).options.dirtyBars).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('re-lays out when a watched setting changes', async () => {
    let flag = true;
    let rerun: () => void = () => undefined;
    const document = createDocumentStore({ platform: fakePlatform() });
    const spy = vi.fn(layout);
    createLayoutStore({
      document,
      ui: createUiStore('dark'),
      options: (view, content) => ({
        ...viewLayoutOptions(view, { ...content, tracks: 'all' }),
        chordDiagrams: flag,
      }),
      layout: spy,
      watch: (fn) => {
        rerun = fn;
        return () => undefined;
      },
    });
    await document.getState().openBytes('a.reprise', await bytesOf('A'));
    spy.mockClear();
    flag = false;
    rerun();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[1].chordDiagrams).toBe(false);
  });

  it('starts a new cache on a switch and clears the result on close', async () => {
    const { document, store, spy } = setup();
    await document.getState().openBytes('a.reprise', await bytesOf('A'));
    const first = lastCall(spy).cache;

    await document.getState().openBytes('b.reprise', await bytesOf('B'));
    expect(lastCall(spy).cache).not.toBe(first);

    document.getState().close();
    expect(store.getState()).toMatchObject({ result: undefined, documentId: undefined });
  });

  it('reports a layout that throws and keeps the document open', async () => {
    const failing = vi.fn((): ReturnType<typeof layout> => {
      throw new Error('no room for the bar');
    });
    const { document, store } = setup(failing);
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);

    await document.getState().openBytes('a.reprise', await bytesOf('A'));

    expect(store.getState()).toMatchObject({ result: undefined, error: 'no room for the bar' });
    expect(document.getState().score).toBeDefined();
  });

  it('stops following the stores once disposed', async () => {
    const { document, store, spy } = setup();
    store.dispose();

    await document.getState().openBytes('a.reprise', await bytesOf('A'));

    expect(spy).not.toHaveBeenCalled();
  });

  it('lays out an edit through the cache as a cold layout of the edited score would', async () => {
    const big = largeScore(2, 20);
    const { document, store } = setup(layout);
    await document.getState().openBytes('big.reprise', (await write(big, 'reprise')).bytes);
    const current = document.getState().score;
    if (!current) throw new Error('no score');

    document
      .getState()
      .apply(setNote({ beatId: beatOf(current, 1, 10, 0).id }, { string: 2, fret: 9 }));

    const edited = document.getState().score;
    if (!edited) throw new Error('no score');
    const cold: LayoutOptions = options(
      { mode: 'paged', paper: 'a4' },
      { tracks: 'all', notation: {} },
    );
    const result = store.getState().result;
    if (!result) throw new Error('no layout');
    // Metrics carry timings and cache counts, which differ by construction.
    const fresh = layout(edited, cold);
    expect(result.systems).toEqual(fresh.systems);
    expect(result.pages).toEqual(fresh.pages);
    expect(result.primitives).toEqual(fresh.primitives);
    expect(result.anchors).toEqual(fresh.anchors);
  });
});

describe('the layout store, stale segments (#229)', () => {
  /** A layout that reports `stale` segments left, one fewer after each call that asks for a reach. */
  function staleSetup(stale: number) {
    let left = stale;
    const calls: LayoutOptions[] = [];
    const fake = vi.fn((...args: Parameters<typeof layout>): ReturnType<typeof layout> => {
      const result = layout(...args);
      calls.push(args[1]);
      if (args[1].verticalReach !== undefined) left = Math.max(0, left - 1);
      return { ...result, metrics: { ...result.metrics, staleSystems: left } };
    });
    const made = setup(fake);
    return { ...made, calls, fake, left: () => left, reset: (n: number) => (left = n) };
  }

  async function open(setupResult: ReturnType<typeof staleSetup>, bars = 3) {
    await setupResult.document.getState().openBytes('a.reprise', await bytesOf('A', bars));
    setupResult.ui.getState().setViewMode('continuous');
    setupResult.fake.mockClear();
    setupResult.calls.length = 0;
  }

  it('passes the edit reach on an edit run in continuous mode, and none on a full run', async () => {
    vi.useFakeTimers();
    try {
      const made = staleSetup(0);
      await open(made);
      edit(made.document, 5);
      expect(made.calls.at(-1)?.verticalReach).toBe(VERTICAL_EDIT_REACH);
      made.ui.getState().setViewMode('paged');
      made.ui.getState().setViewMode('continuous');
      expect(made.calls.at(-1)?.verticalReach).toBeUndefined();
      made.ui.getState().setViewMode('paged');
      edit(made.document, 6);
      expect(made.calls.at(-1)?.verticalReach).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows up one call per frame with the follow-up reach, and publishes only when none is stale', async () => {
    vi.useFakeTimers();
    try {
      const made = staleSetup(3);
      await open(made);
      edit(made.document, 5);
      // The edit call reports 3 stale, its own call leaving one fewer.
      expect(made.fake).toHaveBeenCalledTimes(1);
      expect(made.store.getState().result?.metrics.staleSystems).toBe(2);
      vi.advanceTimersByTime(FOLLOW_UP_DELAY_MS - 1);
      expect(made.fake).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(made.fake).toHaveBeenCalledTimes(2);
      expect(made.calls.at(-1)).toMatchObject({ verticalReach: VERTICAL_FOLLOW_UP_REACH });
      expect(made.calls.at(-1)?.dirtyBars).toBeUndefined();
      // Off-screen progress is not published.
      expect(made.store.getState().result?.metrics.staleSystems).toBe(2);
      const published = vi.fn();
      const stop = made.store.subscribe(published);
      vi.advanceTimersByTime(FOLLOW_UP_DELAY_MS);
      expect(made.store.getState().result?.metrics.staleSystems).toBe(0);
      expect(published).toHaveBeenCalledTimes(1);
      stop();
      vi.advanceTimersByTime(10 * FOLLOW_UP_DELAY_MS);
      expect(made.fake).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for an idle period, bounded by a timeout, where the browser has one', async () => {
    vi.useFakeTimers();
    const idle = vi.fn((task: () => void) => {
      queued.push(task);
      return queued.length;
    });
    const queued: (() => void)[] = [];
    vi.stubGlobal('requestIdleCallback', idle);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    try {
      const made = staleSetup(3);
      await open(made);
      edit(made.document, 5);
      vi.advanceTimersByTime(10 * FOLLOW_UP_DELAY_MS);
      expect(made.fake).toHaveBeenCalledTimes(1);
      expect(idle).toHaveBeenCalledWith(expect.any(Function), {
        timeout: FOLLOW_UP_IDLE_TIMEOUT_MS,
      });
      queued.shift()?.();
      expect(made.fake).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('passes the view’s mounted range as the window of an edit run', async () => {
    const document = createDocumentStore({ platform: fakePlatform() });
    const ui = createUiStore('dark');
    const spy = vi.fn(layout);
    createLayoutStore({
      document,
      ui,
      options,
      layout: spy,
      visible: () => ({ start: 2, end: 5 }),
    });
    await document.getState().openBytes('a.reprise', await bytesOf('A', 3));
    ui.getState().setViewMode('continuous');
    spy.mockClear();
    edit(document, 5);
    expect(lastCall(spy).options.verticalWindow).toEqual({ start: 2, end: 5 });
    ui.getState().setViewMode('paged');
    ui.getState().setViewMode('continuous');
    expect(lastCall(spy).options.verticalWindow).toBeUndefined();
  });

  it('cancels a pending follow-up on a view change, and the next call is exact', async () => {
    vi.useFakeTimers();
    try {
      const made = staleSetup(50);
      await open(made);
      edit(made.document, 5);
      made.reset(0);
      made.ui.getState().setViewMode('paged');
      const callsAfterSwitch = made.fake.mock.calls.length;
      vi.advanceTimersByTime(5 * FOLLOW_UP_DELAY_MS);
      expect(made.fake).toHaveBeenCalledTimes(callsAfterSwitch);
      expect(made.calls.at(-1)?.verticalReach).toBeUndefined();

      made.reset(50);
      made.ui.getState().setViewMode('continuous');
      edit(made.document, 6);
      const trackId = made.document.getState().score?.tracks[0]?.id ?? '';
      made.reset(0);
      made.document.getState().setNotation(trackId, 'both');
      const count = made.fake.mock.calls.length;
      expect(made.calls.at(-1)?.verticalReach).toBeUndefined();
      vi.advanceTimersByTime(5 * FOLLOW_UP_DELAY_MS);
      expect(made.fake).toHaveBeenCalledTimes(count);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending follow-up on a new edit, a switch of document and dispose', async () => {
    vi.useFakeTimers();
    try {
      const made = staleSetup(50);
      await open(made);
      edit(made.document, 5);
      edit(made.document, 6);
      // One follow-up pending, not two.
      expect(made.fake).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(FOLLOW_UP_DELAY_MS);
      expect(made.fake).toHaveBeenCalledTimes(3);

      // The new document's own layout is exact, and the pending follow-up is gone.
      made.reset(0);
      await made.document.getState().openBytes('b.reprise', await bytesOf('B', 3));
      expect(vi.getTimerCount()).toBe(0);

      made.reset(50);
      made.ui.getState().setViewMode('paged');
      made.ui.getState().setViewMode('continuous');
      edit(made.document, 7);
      made.fake.mockClear();
      made.store.dispose();
      vi.advanceTimersByTime(5 * FOLLOW_UP_DELAY_MS);
      expect(made.fake).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules nothing when no segment is stale, or in paged mode', async () => {
    vi.useFakeTimers();
    try {
      const made = staleSetup(0);
      await open(made);
      edit(made.document, 5);
      expect(vi.getTimerCount()).toBe(0);
      made.ui.getState().setViewMode('paged');
      edit(made.document, 6);
      expect(made.calls.at(-1)?.verticalReach).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('catches up to a cold layout of the edited score with the real layout', async () => {
    vi.useFakeTimers();
    try {
      const big = largeScore(2, 40, { structure: true });
      const made = setup(layout);
      await made.document.getState().openBytes('big.reprise', (await write(big, 'reprise')).bytes);
      made.ui.getState().setViewMode('continuous');
      const current = made.document.getState().score;
      if (!current) throw new Error('no score');
      const note = beatOf(current, 0, 20, 0).notes[0];
      if (!note) throw new Error('no note');
      made.document.getState().apply(setNoteEffect({ noteId: note.id }, { letRing: true }));
      const first = made.store.getState().result;
      expect(first?.metrics.staleSystems).toBeGreaterThan(0);
      vi.advanceTimersByTime(100 * FOLLOW_UP_DELAY_MS);
      const result = made.store.getState().result;
      expect(result?.metrics.staleSystems).toBe(0);
      const edited = made.document.getState().score;
      if (!edited || !result) throw new Error('no layout');
      const cold = layout(
        edited,
        options({ mode: 'continuous', paper: 'a4' }, { tracks: 'all', notation: {} }),
      );
      expect(result.systems).toEqual(cold.systems);
      expect(result.primitives).toEqual(cold.primitives);
    } finally {
      vi.useRealTimers();
    }
  });
});
