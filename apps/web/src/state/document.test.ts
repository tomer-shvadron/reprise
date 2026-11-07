import { FormatError, read, write, type ReadResult, type Warning } from '@reprise/formats';
import {
  CommandError,
  STANDARD_TUNING,
  setNote,
  setTrackProperties,
  type Score,
} from '@reprise/model';
import { beatOf, note, score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import type { Platform } from '@/platform/platform';
import { fakePlatform } from '@/test/services';

import {
  contentKey,
  createDocumentStore,
  GP_FILES,
  REPRISE_FILES,
  SCORE_FILES,
  visibleTrackIds,
  withViewNotation,
  type SaveAnswer,
} from './document';

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

const GP = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const REPRISE_BYTES = new Uint8Array([1]);
const GP_BYTES = new Uint8Array([2]);

const dynamicsDropped: Warning = {
  code: 'note-dynamics',
  severity: 'warning',
  message: 'notes of one beat with different dynamics',
  location: { track: 0, bar: 0 },
};
const rseNotModelled: Warning = {
  code: 'rse-dropped',
  severity: 'info',
  message: 'RSE settings',
  location: {},
};

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
    gpDropped?: Warning[];
  } = {},
) {
  const read = vi.fn(options.read ?? (() => Promise.resolve({ score: song(), warnings: [] })));
  const write = vi.fn((_score: Score, format: 'reprise' | 'gp') =>
    Promise.resolve(
      format === 'gp'
        ? { bytes: GP_BYTES, dropped: options.gpDropped ?? [] }
        : { bytes: REPRISE_BYTES, dropped: [] },
    ),
  );
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

/** Runs a save, answers the question it asks, and waits for it to finish. */
async function answering(
  store: ReturnType<typeof setup>['store'],
  saving: Promise<void>,
  answer: SaveAnswer,
) {
  await vi.waitFor(() => {
    expect(store.getState().savePrompt).toBeDefined();
  });
  const prompt = store.getState().savePrompt;
  store.getState().answerSavePrompt(answer);
  await saving;
  return prompt;
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
    expect(state.file).toMatchObject({ name: 'song.gp5', format: 'gp5' });
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
    await answering(store, store.getState().saveAs(), 'reprise');
    expect(store.getState().dirty).toBe(false);

    store.getState().undo();
    store.getState().apply(editOf(store, 7));
    store.getState().undo();

    expect(store.getState().dirty).toBe(true);
  });

  it('keys a file by the SHA-256 of its bytes and records the hash of each save', async () => {
    expect(await contentKey(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const handle = { kind: 'file' };
    const { store } = setup({ saveFile: () => Promise.resolve('/music/song.gp') });
    const opened = new TextEncoder().encode('{}');
    await store.getState().openBytes('song.reprise', opened, handle);
    const key = await contentKey(opened);
    expect(store.getState().file).toMatchObject({ key, savedKeys: [] });

    store.getState().apply(editOf(store, 5));
    await store.getState().save();
    const saved = await contentKey(REPRISE_BYTES);
    expect(store.getState().file).toMatchObject({ key, savedKeys: [saved] });

    await answering(store, store.getState().saveAs(), 'gp');
    expect(store.getState().file).toMatchObject({
      name: 'song.gp',
      format: 'gp',
      key,
      savedKeys: [saved, await contentKey(GP_BYTES)],
    });
  });

  it('sends Save on a gp5 to Save As, saying why, then saves in place to the chosen .reprise', async () => {
    const { store, write, saveFile, writeHandle } = setup({ gpDropped: [dynamicsDropped] });
    await store.getState().openBytes('song.gp5', GP5, { kind: 'file' });
    store.getState().apply(editOf(store, 5));

    const prompt = await answering(store, store.getState().save(), 'reprise');

    expect(prompt).toEqual({
      kind: 'save-as',
      reason:
        "Reprise can't write Guitar Pro 5 (.gp5) files, so this saves a copy as Reprise or as Guitar Pro 7–8.",
      gpLosses: [dynamicsDropped],
    });
    expect(write).toHaveBeenCalledWith(store.getState().score, 'reprise');
    expect(saveFile).toHaveBeenCalledWith('song.reprise', REPRISE_BYTES, REPRISE_FILES);
    expect(store.getState().file).toMatchObject({
      name: 'song.reprise',
      format: 'reprise',
      handle: '/music/song.reprise',
    });
    expect(store.getState().dirty).toBe(false);

    store.getState().apply(editOf(store, 6));
    await store.getState().save();
    expect(store.getState().savePrompt).toBeUndefined();
    expect(writeHandle).toHaveBeenCalledWith('/music/song.reprise', REPRISE_BYTES);
    expect(saveFile).toHaveBeenCalledOnce();
    expect(store.getState().dirty).toBe(false);
  });

  it('saves a gp5 as Guitar Pro 7–8, then saves the new .gp in place without asking again', async () => {
    const { store, saveFile, writeHandle } = setup({
      read: () => Promise.resolve({ score: song(), warnings: [rseNotModelled] }),
      saveFile: () => Promise.resolve('/music/song.gp'),
    });
    await store.getState().openBytes('song.gp5', GP5);
    store.getState().apply(editOf(store, 5));

    await answering(store, store.getState().saveAs(), 'gp');

    expect(saveFile).toHaveBeenCalledWith('song.gp', GP_BYTES, GP_FILES);
    expect(store.getState().file).toMatchObject({
      name: 'song.gp',
      format: 'gp',
      handle: '/music/song.gp',
    });
    expect(store.getState().dirty).toBe(false);

    // The new file never held what the gp5's read dropped, so overwriting it loses nothing.
    store.getState().apply(editOf(store, 6));
    await store.getState().save();
    expect(store.getState().savePrompt).toBeUndefined();
    expect(writeHandle).toHaveBeenCalledWith('/music/song.gp', GP_BYTES);
    expect(store.getState().dirty).toBe(false);
  });

  it('gives no reason in Save As for a format Reprise writes', async () => {
    const { store } = setup({ saveFile: () => Promise.resolve(undefined) });
    await store.getState().openBytes('song.reprise', new TextEncoder().encode('{}'));

    const prompt = await answering(store, store.getState().saveAs(), 'reprise');

    expect(prompt).toMatchObject({ kind: 'save-as', reason: undefined });
  });

  it('saves an opened .reprise file in place through its handle', async () => {
    const { store, saveFile, writeHandle } = setup();
    const handle = { kind: 'file' };
    await store.getState().openBytes('song.reprise', new TextEncoder().encode('{}'), handle);

    await store.getState().save();

    expect(store.getState().savePrompt).toBeUndefined();
    expect(saveFile).not.toHaveBeenCalled();
    expect(writeHandle).toHaveBeenCalledWith(handle, REPRISE_BYTES);
  });

  it('overwrites an opened .gp with the gp writer once its losses are confirmed', async () => {
    const handle = { kind: 'file' };
    const { store, write, saveFile, writeHandle } = setup({
      read: () => Promise.resolve({ score: song(), warnings: [rseNotModelled, warning('error')] }),
      gpDropped: [dynamicsDropped],
    });
    await store.getState().openBytes('song.gp', GP, handle);
    store.getState().apply(editOf(store, 5));

    const saving = store.getState().save();
    await vi.waitFor(() => {
      expect(store.getState().savePrompt).toBeDefined();
    });
    expect(store.getState().savePrompt).toEqual({
      kind: 'overwrite',
      fileName: 'song.gp',
      losses: [dynamicsDropped, rseNotModelled],
    });
    expect(writeHandle).not.toHaveBeenCalled();
    store.getState().answerSavePrompt('overwrite');
    await saving;

    expect(write).toHaveBeenCalledWith(store.getState().score, 'gp');
    expect(write).not.toHaveBeenCalledWith(expect.anything(), 'reprise');
    expect(writeHandle).toHaveBeenCalledWith(handle, GP_BYTES);
    expect(saveFile).not.toHaveBeenCalled();
    expect(store.getState().file).toMatchObject({ name: 'song.gp', format: 'gp', handle });
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().savePrompt).toBeUndefined();

    // The original is gone, so the next overwrite asks only about the writer's drops.
    store.getState().apply(editOf(store, 6));
    const again = await answering(store, store.getState().save(), 'overwrite');
    expect(again).toMatchObject({ losses: [dynamicsDropped] });
  });

  it('writes nothing when the overwrite of a .gp is cancelled', async () => {
    const handle = { kind: 'file' };
    const { store, saveFile, writeHandle } = setup({ gpDropped: [dynamicsDropped] });
    await store.getState().openBytes('song.gp', GP, handle);
    store.getState().apply(editOf(store, 5));

    await answering(store, store.getState().save(), 'cancel');

    expect(writeHandle).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
    expect(store.getState().file).toMatchObject({ name: 'song.gp', format: 'gp', handle });
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().saving).toBe(false);
  });

  it('overwrites a .gp that loses nothing without asking', async () => {
    const handle = { kind: 'file' };
    const { store, writeHandle } = setup();
    await store.getState().openBytes('song.gp', GP, handle);
    store.getState().apply(editOf(store, 5));

    await store.getState().save();

    expect(store.getState().savePrompt).toBeUndefined();
    expect(writeHandle).toHaveBeenCalledWith(handle, GP_BYTES);
    expect(store.getState().file).toMatchObject({ name: 'song.gp', format: 'gp', handle });
    expect(store.getState().dirty).toBe(false);
  });

  it('changes nothing when Save As is cancelled in the app or in the platform dialog', async () => {
    const { store, saveFile } = setup({ saveFile: () => Promise.resolve(undefined) });
    await store.getState().openBytes('song.gp5', GP5);
    store.getState().apply(editOf(store, 5));

    await answering(store, store.getState().saveAs(), 'cancel');
    expect(saveFile).not.toHaveBeenCalled();
    await answering(store, store.getState().saveAs(), 'gp');
    expect(saveFile).toHaveBeenCalledWith('song.gp', GP_BYTES, GP_FILES);

    expect(store.getState().file).toMatchObject({ name: 'song.gp5', format: 'gp5' });
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().saving).toBe(false);
  });

  it('reports a failed save', async () => {
    const { store } = setup({ saveFile: () => Promise.reject(new Error('disk full')) });
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);
    await store.getState().openBytes('song.gp5', GP5);

    await answering(store, store.getState().saveAs(), 'reprise');

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
    await vi.waitFor(() => {
      expect(store.getState().savePrompt).toBeDefined();
    });
    store.getState().answerSavePrompt('reprise');
    await vi.waitFor(() => {
      expect(saveFile).toHaveBeenCalledOnce();
    });

    await store.getState().save();
    store.getState().apply(editOf(store, 5));
    finish('/music/song.reprise');
    await saving;

    expect(saveFile).toHaveBeenCalledOnce();
    expect(store.getState().dirty).toBe(true);
  });

  it('drops a save that outlives its document', async () => {
    let finish: (path: string) => void = () => undefined;
    const { store, saveFile } = setup({
      saveFile: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await store.getState().openBytes('first.gp5', GP5);
    store.getState().apply(editOf(store, 5));
    const saving = store.getState().saveAs();
    await vi.waitFor(() => {
      expect(store.getState().savePrompt).toBeDefined();
    });
    store.getState().answerSavePrompt('reprise');
    await vi.waitFor(() => {
      expect(saveFile).toHaveBeenCalledOnce();
    });

    await store.getState().openBytes('second.gp5', GP5);
    store.getState().apply(editOf(store, 6));
    finish('/music/first.reprise');
    await saving;

    expect(store.getState().file).toMatchObject({ name: 'second.gp5', format: 'gp5' });
    expect(store.getState().dirty).toBe(true);
  });

  it('cancels a pending question when the document closes', async () => {
    const { store, writeHandle } = setup({ gpDropped: [dynamicsDropped] });
    await store.getState().openBytes('song.gp', GP, { kind: 'file' });
    const saving = store.getState().save();
    await vi.waitFor(() => {
      expect(store.getState().savePrompt).toBeDefined();
    });

    store.getState().close();
    await saving;

    expect(store.getState().savePrompt).toBeUndefined();
    expect(store.getState().saving).toBe(false);
    expect(writeHandle).not.toHaveBeenCalled();
  });

  it('opens the import details expanded from the command, and collapses them on the next open', async () => {
    const { store } = setup({
      read: () => Promise.resolve({ score: song(), warnings: [warning('warning')] }),
    });
    await store.getState().openBytes('song.gp5', GP5);
    store.getState().setWarningsOpen(false);

    store.getState().showImportDetails();
    expect(store.getState()).toMatchObject({ warningsOpen: true, detailsOpen: true });

    await store.getState().openBytes('other.gp5', GP5);
    expect(store.getState()).toMatchObject({ warningsOpen: true, detailsOpen: false });
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

  it('keeps view changes out of the history, and the dirty flag back where it was', async () => {
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

  it('marks the document modified by a notation change and writes it on Save', async () => {
    const { store, write } = setup();
    await store.getState().openBytes('song.reprise', GP5, '/music/song.reprise');
    store.setState({
      file: { name: 'song.reprise', format: 'reprise', handle: '/x', key: 'k', savedKeys: [] },
    });
    const trackId = store.getState().score?.tracks[0]?.id ?? '';

    store.getState().setNotation(trackId, 'both');
    expect(store.getState()).toMatchObject({ dirty: true, canUndo: false });
    await store.getState().save();

    expect(write.mock.calls.at(-1)?.[0].tracks[0]?.display.notation).toBe('both');
    expect(store.getState().dirty).toBe(false);
    // The open score keeps the file's display as read; the view carries the choice.
    expect(store.getState().score?.tracks[0]?.display.notation).toBe('tab');
  });

  it('sets and clears single-track view without dirtying, and skips a no-op', async () => {
    const { store } = setup();
    await store.getState().openBytes('song.gp5', GP5);
    const trackId = store.getState().score?.tracks[0]?.id ?? '';
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.getState().setSingleTrack(trackId);
    store.getState().setSingleTrack(trackId);
    expect(store.getState().view.only).toBe(trackId);
    store.getState().setSingleTrack(undefined);
    expect(store.getState().view).not.toHaveProperty('only');
    store.getState().setNotation(trackId, 'tab');
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getState().dirty).toBe(false);
  });

  it('replaces the visible tracks in one set, keeping notation and the modified flag', async () => {
    const { store } = setup();
    await store.getState().openBytes('song.gp5', GP5);
    const trackId = store.getState().score?.tracks[0]?.id ?? '';
    store.getState().setNotation(trackId, 'both');
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.getState().setView({ tracks: 'all', only: 'x' });
    unsubscribe();
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getState().view).toEqual({
      tracks: 'all',
      notation: { [trackId]: 'both' },
      only: 'x',
    });
    expect(store.getState().dirty).toBe(true);
  });
});

describe('visibleTrackIds', () => {
  const three = score().track('guitar').track('bass').track('drums').build();
  const [a = '', b = '', c = ''] = three.tracks.map((track) => track.id);

  it('shows the single track, even one hidden in the multitrack set', () => {
    expect(visibleTrackIds({ tracks: [a], notation: {}, only: c }, three)).toEqual([c]);
  });

  it('ignores a stale single track and stale ids, and never lays out nothing', () => {
    expect(visibleTrackIds({ tracks: [b, 'gone'], notation: {}, only: 'gone' }, three)).toEqual([
      b,
    ]);
    expect(visibleTrackIds({ tracks: ['gone'], notation: {} }, three)).toBe('all');
    expect(visibleTrackIds({ tracks: 'all', notation: {} }, three)).toBe('all');
    expect(visibleTrackIds({ tracks: [a], notation: {} }, undefined)).toEqual([a]);
  });
});

describe('a track without strings that a file shows as tab', () => {
  const keysAsTab = (): Score =>
    score()
      .track('guitar', { name: 'Lead' })
      .bar()
      .beat('4', [note(1, 0)])
      .track('piano', {
        name: 'Keys',
        tuning: [...STANDARD_TUNING],
        fretCount: 24,
        display: { notation: 'tab', clef: 'treble', octaveShift: 0 },
      })
      .bar()
      .bar()
      .build();
  const notations = (saved: Score) =>
    saved.tracks.map((track) => `${track.kind}:${track.display.notation}`);

  it('is folded to standard notation for Save, leaving drums and fretted tracks alone', () => {
    const base = keysAsTab();
    const drums = score()
      .track('drums', { display: { notation: 'tab', octaveShift: 0 } })
      .bar()
      .build().tracks;
    const song = { ...base, tracks: [...base.tracks, ...drums] };
    const keys = song.tracks[1]?.id ?? '';
    expect(notations(withViewNotation(song, {}))).toEqual([
      'fretted:tab',
      'pitched:standard',
      'drums:tab',
    ]);
    expect(notations(withViewNotation(song, { [keys]: 'both' }))).toEqual([
      'fretted:tab',
      'pitched:standard',
      'drums:tab',
    ]);
    const plain = score().track('guitar').track('piano', { tuning: [] }).track('drums').build();
    expect(withViewNotation(plain, {})).toBe(plain);
  });

  it('opens unmodified and saves as standard to .reprise and gp, with no notation loss', async () => {
    const song = keysAsTab();
    const writeHandle = vi.fn<Platform['writeHandle']>(() => Promise.resolve());
    const store = createDocumentStore({ platform: fakePlatform({ writeHandle }) });
    const opened = (await write(song, 'reprise')).bytes;
    await store.getState().openBytes('song.reprise', opened, '/music/song.reprise');
    expect(store.getState().dirty).toBe(false);

    await store.getState().save();
    const reprise = await read(writeHandle.mock.calls.at(-1)?.[1] ?? new Uint8Array());
    expect(notations(reprise.score)).toEqual(['fretted:tab', 'pitched:standard']);
    expect(store.getState().score?.tracks[1]?.display.notation).toBe('tab');

    const file = store.getState().file;
    if (!file) throw new Error('no file');
    store.setState({ file: { ...file, name: 'song.gp', format: 'gp', handle: '/music/song.gp' } });
    await store.getState().save();
    expect(store.getState().savePrompt).toBeUndefined();
    expect(writeHandle).toHaveBeenCalledTimes(2);
    const gp = await read(writeHandle.mock.calls.at(-1)?.[1] ?? new Uint8Array());
    expect(notations(gp.score)).toEqual(['fretted:tab', 'pitched:standard']);

    // Unfolded, the gp writer reports the notation it cannot keep, and .reprise keeps the value.
    const unfolded = await write(song, 'gp');
    expect(unfolded.dropped.map((loss) => loss.code)).toContain('notation');
    expect(
      (await read((await write(song, 'reprise')).bytes)).score.tracks[1]?.display.notation,
    ).toBe('tab');
  });
});
