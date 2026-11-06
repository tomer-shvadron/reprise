import { write } from '@reprise/formats';
import { layout, LayoutCache, type LayoutOptions } from '@reprise/layout';
import { setNote } from '@reprise/model';
import { beatOf, largeScore, note, score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { viewLayoutOptions } from '@/features/score';
import { fakePlatform } from '@/test/services';

import { createDocumentStore, type DocumentStore } from './document';
import { createLayoutStore } from './layout';
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

  it('re-lays out for a view change, never for zoom, theme or panels', async () => {
    const { document, ui, spy } = setup();
    await document.getState().openBytes('a.reprise', await bytesOf('A'));
    const { cache } = lastCall(spy);
    spy.mockClear();

    ui.getState().setZoom(2);
    ui.getState().toggleTheme();
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
