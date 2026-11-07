import { write } from '@reprise/formats';
import { layout, PAGE_SIZES, type LayoutOptions } from '@reprise/layout';
import type { Score } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { createTestServices } from '@/test/services';

import { createPrintStore, type PrintStoreDeps } from './print-store';

function threeTracks(): Score {
  return score()
    .title('Riff')
    .track('guitar', { name: 'Lead' })
    .track('bass', { name: '' })
    .track('guitar', { name: 'Rhythm' })
    .build();
}

async function setup(overrides: Partial<PrintStoreDeps> = {}, open = true) {
  const services = createTestServices();
  if (open) {
    const { bytes } = await write(threeTracks(), 'reprise');
    await services.document.getState().openBytes('riff.reprise', bytes);
  }
  const calls: string[] = [];
  const print = vi.fn(() => {
    calls.push('print');
    return Promise.resolve();
  });
  const run = vi.fn((built: Score, options: LayoutOptions) => {
    calls.push('layout');
    return layout(built, options);
  });
  const store = createPrintStore({
    document: services.document,
    ui: services.ui,
    platform: { print },
    fonts: () => {
      calls.push('fonts');
      return Promise.resolve();
    },
    layout: run,
    nextPaint: () => {
      calls.push('paint');
      return Promise.resolve();
    },
    ...overrides,
  });
  const ids = services.document.getState().score?.tracks.map(({ id }) => id) ?? [];
  /** Resolves once the store has mounted a job, and signals it rendered. */
  const renderJob = async () => {
    await vi.waitFor(() => {
      expect(store.getState().job).toBeDefined();
    });
    const job = store.getState().job;
    if (!job) throw new Error('no job');
    store.getState().rendered(job.id);
    return job;
  };
  return { services, store, print, run, calls, ids, renderJob };
}

describe('the print store', () => {
  it('opens with the tracks on screen, the view paper and both switches on', async () => {
    const { services, store, ids } = await setup();
    const [lead, , rhythm] = ids;
    if (lead === undefined || rhythm === undefined) throw new Error('no tracks');
    services.ui.getState().setPaper('letter');
    services.document.getState().setVisibleTracks([rhythm, lead]);
    store.getState().open();
    expect(store.getState().dialog?.settings).toEqual({
      tracks: [lead, rhythm],
      paper: 'letter',
      header: true,
      pageNumbers: true,
    });
    expect(store.getState().dialog?.choices.map(({ name }) => name)).toEqual([
      'Lead',
      'Track 2',
      'Rhythm',
    ]);
  });

  it('opens with the single track in single-track view', async () => {
    const { services, store, ids } = await setup();
    services.document.getState().setSingleTrack(ids[1]);
    store.getState().open();
    expect(store.getState().dialog?.settings.tracks).toEqual([ids[1]]);
  });

  it('does nothing with no score, or when already open', async () => {
    const empty = await setup({}, false);
    empty.store.getState().open();
    expect(empty.store.getState().dialog).toBeUndefined();

    const { store } = await setup();
    store.getState().open();
    store.getState().update({ paper: 'letter' });
    store.getState().open();
    expect(store.getState().dialog?.settings.paper).toBe('letter');
  });

  it('paints, loads the fonts, lays out, mounts, and prints only after the pages render', async () => {
    const { store, print, run, calls, ids, renderJob } = await setup();
    store.getState().open();
    store.getState().update({ paper: 'letter', tracks: [ids[0] ?? ''] });
    const printing = store.getState().print();
    expect(store.getState().preparing).toBe(true);
    const job = await renderJob();
    expect(store.getState().dialog).toBeUndefined();
    expect(job.result.pages[0]?.bbox.height).toBe(PAGE_SIZES.letter.height);
    await printing;
    expect(calls).toEqual(['paint', 'fonts', 'layout', 'print']);
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      mode: 'paged',
      zoom: 1,
      width: PAGE_SIZES.letter.width,
      pageHeight: PAGE_SIZES.letter.height,
      tracks: [ids[0]],
      notation: {},
      headerHeight: 48,
    });
    expect(print).toHaveBeenCalledWith({ pageSize: 'Letter' });
    expect(store.getState().job).toBeUndefined();
    expect(store.getState().preparing).toBe(false);
  });

  it('waits for the rendered signal of its own job, and prints once', async () => {
    const { store, print, renderJob } = await setup();
    store.getState().open();
    const printing = store.getState().print();
    void store.getState().print();
    await vi.waitFor(() => {
      expect(store.getState().job).toBeDefined();
    });
    const id = store.getState().job?.id ?? 0;
    store.getState().rendered(id + 1);
    await Promise.resolve();
    expect(print).not.toHaveBeenCalled();
    await renderJob();
    store.getState().rendered(id);
    await printing;
    expect(print).toHaveBeenCalledOnce();
  });

  it('clears the job when printing fails, and passes the failure on', async () => {
    const failure = new Error('Printing failed: no printer');
    const { store, renderJob } = await setup({
      platform: { print: () => Promise.reject(failure) },
    });
    store.getState().open();
    const printing = store.getState().print();
    await renderJob();
    await expect(printing).rejects.toBe(failure);
    expect(store.getState().job).toBeUndefined();
    expect(store.getState().preparing).toBe(false);
  });

  it('keeps the dialog open with the error when the layout throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { store, print } = await setup({
      layout: () => {
        throw new Error('no room');
      },
    });
    store.getState().open();
    await store.getState().print();
    expect(store.getState().dialog?.error).toBe('no room');
    expect(store.getState().job).toBeUndefined();
    expect(store.getState().preparing).toBe(false);
    expect(print).not.toHaveBeenCalled();
    store.getState().update({ header: false });
    expect(store.getState().dialog?.error).toBeUndefined();
    error.mockRestore();
  });

  it('does not print with no track chosen', async () => {
    const { store, run } = await setup();
    store.getState().open();
    store.getState().update({ tracks: [] });
    await store.getState().print();
    expect(run).not.toHaveBeenCalled();
    expect(store.getState().dialog).toBeDefined();
  });

  it('remembers the paper and switches for the next print, but not the tracks', async () => {
    const { store, ids, renderJob } = await setup();
    store.getState().open();
    store.getState().update({
      paper: 'letter',
      header: false,
      pageNumbers: false,
      tracks: [ids[2] ?? ''],
    });
    const printing = store.getState().print();
    await renderJob();
    await printing;
    store.getState().open();
    expect(store.getState().dialog?.settings).toEqual({
      tracks: ids,
      paper: 'letter',
      header: false,
      pageNumbers: false,
    });
  });

  it('ignores updates and cancel while preparing', async () => {
    const { store, renderJob } = await setup();
    store.getState().open();
    const printing = store.getState().print();
    store.getState().cancel();
    store.getState().update({ paper: 'letter' });
    const job = await renderJob();
    expect(job.settings.paper).toBe('a4');
    await printing;
  });
});
