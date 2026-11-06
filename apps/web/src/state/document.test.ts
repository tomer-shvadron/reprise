import { FormatError, type ReadResult, type Warning } from '@reprise/formats';
import { CommandError, setNote, setTrackProperties, type Score } from '@reprise/model';
import { beatOf, note, score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import type { Platform } from '@/platform/platform';
import { fakePlatform } from '@/test/services';

import { createDocumentStore, REPRISE_FILES, SCORE_FILES } from './document';

// Any bytes `detect` recognises; the injected `read` decides what they hold.
const GP5 = new TextEncoder().encode('\u0018FICHIER GUITAR PRO v5.00');

function song(title = 'Song'): Score {
  return score()
    .title(title)
    .track('guitar')
    .bar()
    .beat('4', [note(1, 0)])
    .build();
}

const warning = (severity: Warning['severity']): Warning => ({
  code: 'invalid-value',
  severity,
  message: `a ${severity}`,
  location: { track: 0, bar: 1 },
});

function setup(
  options: {
    read?: (bytes: Uint8Array) => Promise<ReadResult>;
    saveFile?: () => Promise<string | undefined>;
    writeHandle?: () => Promise<void>;
  } = {},
) {
  const read = vi.fn(options.read ?? (() => Promise.resolve({ score: song(), warnings: [] })));
  const write = vi.fn(() => Promise.resolve({ bytes: new Uint8Array([1]), dropped: [] }));
  const openFile = vi.fn<Platform['openFile']>(() =>
    Promise.resolve({ name: 'song.gp5', bytes: GP5 }),
  );
  const saveFile = vi.fn(options.saveFile ?? (() => Promise.resolve('/music/song.reprise')));
  const writeHandle = vi.fn(options.writeHandle ?? (() => Promise.resolve()));
  const store = createDocumentStore({
    platform: fakePlatform({ openFile, saveFile, writeHandle }),
    read,
    write,
  });
  return { store, read, write, openFile, saveFile, writeHandle };
}

function editOf(store: ReturnType<typeof setup>['store'], fret: number) {
  const current = store.getState().score;
  if (!current) throw new Error('no score');
  return setNote({ beatId: beatOf(current, 0, 0, 0).id }, { string: 1, fret });
}

describe('the document store', () => {
  it('opens through the platform with the score filters', async () => {
    const { store, openFile } = setup({
      read: () => Promise.resolve({ score: song(), warnings: [warning('warning')] }),
    });

    await store.getState().open();

    expect(openFile).toHaveBeenCalledWith(SCORE_FILES);
    const state = store.getState();
    expect(state.score?.meta.title).toBe('Song');
    expect(state.id).toBeDefined();
    expect(state.file).toEqual({ name: 'song.gp5', format: 'gp5' });
    expect(state.warnings).toHaveLength(1);
    expect(state.warningsOpen).toBe(true);
    expect(state.dirty).toBe(false);
    expect(state.canUndo).toBe(false);
    expect(state.lastChange).toBeUndefined();
    expect(state.opening).toBeUndefined();
  });

  it('changes nothing when the pick is cancelled', async () => {
    const { store, openFile, read } = setup();
    openFile.mockResolvedValueOnce(undefined);
    const before = store.getState();

    await store.getState().open();

    expect(store.getState()).toBe(before);
    expect(read).not.toHaveBeenCalled();
  });

  it('shows no warnings toast for an info-only read', async () => {
    const { store } = setup({
      read: () => Promise.resolve({ score: song(), warnings: [warning('info')] }),
    });

    await store.getState().openBytes('song.gp5', GP5);

    expect(store.getState().warnings).toHaveLength(1);
    expect(store.getState().warningsOpen).toBe(false);
  });

  it('keeps the open document when an open fails, then replaces it on the next', async () => {
    const { store, read } = setup();
    await store.getState().openBytes('first.gp5', GP5);
    const first = store.getState().id;
    read.mockRejectedValueOnce(new FormatError('unknown-version', 'The file ended early'));

    await store.getState().openBytes('broken.gp5', GP5);

    expect(store.getState().id).toBe(first);
    expect(store.getState().error).toEqual({
      action: 'open',
      fileName: 'broken.gp5',
      message: 'The file ended early',
      code: 'unknown-version',
    });

    read.mockResolvedValueOnce({ score: song('Second'), warnings: [] });
    await store.getState().openBytes('second.gp5', GP5);
    expect(store.getState().id).not.toBe(first);
    expect(store.getState().score?.meta.title).toBe('Second');
    expect(store.getState().error).toBeUndefined();
  });

  it('refuses bytes of no known format without reading them', async () => {
    const { store, read } = setup();

    await store.getState().openBytes('notes.txt', new TextEncoder().encode('hello'));

    expect(read).not.toHaveBeenCalled();
    expect(store.getState().error).toMatchObject({
      fileName: 'notes.txt',
      message: 'Not a Guitar Pro or Reprise file',
      code: 'unknown-format',
    });
  });

  it('turns a platform rejection into an open error', async () => {
    const { store, openFile } = setup();
    openFile.mockRejectedValueOnce(new Error('permission denied'));
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);

    await store.getState().open();

    expect(store.getState().error).toMatchObject({ action: 'open', message: 'permission denied' });
  });

  it('drops an open that a later one overtook', async () => {
    let finishFirst: (result: ReadResult) => void = () => undefined;
    const { store, read } = setup();
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    const first = store.getState().openBytes('slow.gp5', GP5);
    read.mockResolvedValueOnce({ score: song('Fast'), warnings: [] });
    await store.getState().openBytes('fast.gp5', GP5);

    finishFirst({ score: song('Slow'), warnings: [] });
    await first;

    expect(store.getState().score?.meta.title).toBe('Fast');
    expect(store.getState().file?.name).toBe('fast.gp5');
  });

  it('applies a command as one undo step that dirties the document', async () => {
    const { store } = setup();
    await store.getState().openBytes('song.gp5', GP5);
    const revision = store.getState().revision;

    store.getState().apply(editOf(store, 5));

    const state = store.getState();
    expect(state.lastChange?.touchedBars).toEqual([state.score?.masterBars[0]?.id]);
    expect(state.dirty).toBe(true);
    expect(state.canUndo).toBe(true);
    expect(state.undoLabel).toBe('setNote');
    expect(state.revision).toBe(revision + 1);
  });

  it('leaves the revision alone for a command that changes nothing', async () => {
    const { store } = setup();
    await store.getState().openBytes('song.gp5', GP5);
    const before = store.getState();
    const trackId = before.score?.tracks[0]?.id ?? '';

    store.getState().apply(setTrackProperties({ trackId }, {}));

    expect(store.getState().revision).toBe(before.revision);
    expect(store.getState().score).toBe(before.score);
  });

  it('changes nothing when a command throws', async () => {
    const { store } = setup();
    await store.getState().openBytes('song.gp5', GP5);
    const before = store.getState();

    expect(() =>
      store.getState().apply(setNote({ beatId: 'nosuchbeat00' }, { string: 1, fret: 1 })),
    ).toThrow(CommandError);
    expect(store.getState()).toBe(before);
  });

  it('undoes to the opened score and redoes, tracking dirty', async () => {
    const { store } = setup();
    await store.getState().openBytes('song.gp5', GP5);
    const opened = store.getState().score;
    store.getState().apply(editOf(store, 5));

    store.getState().undo();
    expect(store.getState().score).toEqual(opened);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().canRedo).toBe(true);
    expect(store.getState().lastChange?.touchedBars).toHaveLength(1);

    store.getState().redo();
    expect(store.getState().dirty).toBe(true);

    store.getState().redo();
    expect(store.getState().canRedo).toBe(false);
  });

  it('stays dirty once an edit after undoing past the save makes the save unreachable', async () => {
    const { store } = setup();
    await store.getState().openBytes('song.gp5', GP5);
    store.getState().apply(editOf(store, 5));
    await store.getState().saveAs();
    expect(store.getState().dirty).toBe(false);

    store.getState().undo();
    store.getState().apply(editOf(store, 7));
    store.getState().undo();

    expect(store.getState().dirty).toBe(true);
  });

  it('saves as .reprise, then saves in place to the chosen path', async () => {
    const { store, write, saveFile, writeHandle } = setup();
    await store.getState().openBytes('song.gp5', GP5);
    store.getState().apply(editOf(store, 5));

    await store.getState().save();

    expect(write).toHaveBeenCalledWith(store.getState().score, 'reprise');
    expect(saveFile).toHaveBeenCalledWith('song.reprise', new Uint8Array([1]), REPRISE_FILES);
    expect(store.getState().file).toEqual({
      name: 'song.reprise',
      format: 'reprise',
      handle: '/music/song.reprise',
    });
    expect(store.getState().dirty).toBe(false);

    store.getState().apply(editOf(store, 6));
    await store.getState().save();
    expect(writeHandle).toHaveBeenCalledWith('/music/song.reprise', new Uint8Array([1]));
    expect(saveFile).toHaveBeenCalledOnce();
    expect(store.getState().dirty).toBe(false);
  });

  it('saves an opened .reprise file in place through its handle', async () => {
    const { store, saveFile, writeHandle } = setup();
    const handle = { kind: 'file' };
    await store.getState().openBytes('song.reprise', new TextEncoder().encode('{}'), handle);

    await store.getState().save();

    expect(saveFile).not.toHaveBeenCalled();
    expect(writeHandle).toHaveBeenCalledWith(handle, new Uint8Array([1]));
  });

  it('changes nothing on a cancelled Save As', async () => {
    const { store } = setup({ saveFile: () => Promise.resolve(undefined) });
    await store.getState().openBytes('song.gp5', GP5);
    store.getState().apply(editOf(store, 5));

    await store.getState().saveAs();

    expect(store.getState().file).toEqual({ name: 'song.gp5', format: 'gp5' });
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().saving).toBe(false);
  });

  it('reports a failed save', async () => {
    const { store } = setup({ saveFile: () => Promise.reject(new Error('disk full')) });
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);
    await store.getState().openBytes('song.gp5', GP5);

    await store.getState().saveAs();

    expect(store.getState().error).toEqual({
      action: 'save',
      fileName: 'song.reprise',
      message: 'disk full',
    });
  });

  it('keeps an edit made during the save dirty, and ignores a second save meanwhile', async () => {
    let finish: (path: string) => void = () => undefined;
    const { store, saveFile } = setup({
      saveFile: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await store.getState().openBytes('song.gp5', GP5);
    const saving = store.getState().saveAs();
    await Promise.resolve();
    await Promise.resolve();

    await store.getState().save();
    store.getState().apply(editOf(store, 5));
    finish('/music/song.reprise');
    await saving;

    expect(saveFile).toHaveBeenCalledOnce();
    expect(store.getState().dirty).toBe(true);
  });

  it('closes to the empty state', async () => {
    const { store } = setup();
    await store.getState().openBytes('song.gp5', GP5);

    store.getState().close();

    const state = store.getState();
    expect(state.id).toBeUndefined();
    expect(state.score).toBeUndefined();
    expect(state.file).toBeUndefined();
    expect(state.canUndo).toBe(false);
  });

  it('keeps view changes out of the history and the dirty flag', async () => {
    const { store } = setup();
    await store.getState().openBytes('song.gp5', GP5);
    const { revision, score: opened } = store.getState();
    const trackId = opened?.tracks[0]?.id ?? '';

    store.getState().setNotation(trackId, 'standard');
    store.getState().setVisibleTracks([trackId]);

    expect(store.getState().view).toEqual({
      tracks: [trackId],
      notation: { [trackId]: 'standard' },
    });
    store.getState().setNotation(trackId, undefined);
    expect(store.getState().view.notation).toEqual({});
    expect(store.getState().revision).toBe(revision);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().canUndo).toBe(false);
  });
});
