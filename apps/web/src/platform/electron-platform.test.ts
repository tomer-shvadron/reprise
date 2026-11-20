import { describe, expect, it, vi } from 'vitest';

import type { RepriseBridge } from './bridge';
import { createElectronPlatform } from './electron-platform';

function fakeBridge() {
  const writeFile = vi.fn<RepriseBridge['writeFile']>(() => Promise.resolve(undefined));
  const startDownload = vi.fn<RepriseBridge['startDownload']>(() => Promise.resolve({ size: 4 }));
  const cancelDownload = vi.fn<RepriseBridge['cancelDownload']>(() => Promise.resolve(undefined));
  let listener: ((id: string, loaded: number, total?: number) => void) | undefined;
  const off = vi.fn(() => {
    listener = undefined;
  });
  const progress = (id: string, loaded: number, total?: number) => listener?.(id, loaded, total);
  const bridge: RepriseBridge = {
    openFile: vi.fn(() => Promise.resolve(undefined)),
    saveFile: vi.fn(() => Promise.resolve(undefined)),
    readFile: vi.fn(() => Promise.resolve(new Uint8Array())),
    writeFile,
    openFiles: vi.fn(() => Promise.resolve([])),
    openFolder: vi.fn(() => Promise.resolve(undefined)),
    mkdir: vi.fn(() => Promise.resolve(undefined)),
    listDir: vi.fn(() => Promise.resolve([])),
    move: vi.fn(() => Promise.resolve(undefined)),
    remove: vi.fn(() => Promise.resolve(undefined)),
    setRecentSongs: vi.fn(() => Promise.resolve(undefined)),
    libraryDir: vi.fn(() => Promise.resolve('/library')),
    dataDir: vi.fn(() => Promise.resolve('/data')),
    print: vi.fn(() => Promise.resolve(undefined)),
    onMenuCommand: vi.fn(() => () => undefined),
    setHistoryLabels: vi.fn(() => Promise.resolve(undefined)),
    setMenuKeys: vi.fn(() => Promise.resolve(undefined)),
    onOpenRecent: vi.fn(() => () => undefined),
    setDocumentEdited: vi.fn(() => Promise.resolve(undefined)),
    confirmClose: vi.fn(() => Promise.resolve(undefined)),
    startDownload,
    cancelDownload,
    onDownloadProgress: vi.fn<RepriseBridge['onDownloadProgress']>((next) => {
      listener = next;
      return off;
    }),
    onCloseRequest: vi.fn(() => () => undefined),
  };
  return { bridge, writeFile, startDownload, cancelDownload, progress, off };
}

describe('the Electron platform', () => {
  it('writes a handle main issued, a path, through the bridge', async () => {
    const { bridge, writeFile } = fakeBridge();

    await createElectronPlatform(bridge).writeHandle('/Users/me/song.gp', new Uint8Array([3]));

    expect(writeFile).toHaveBeenCalledWith('/Users/me/song.gp', new Uint8Array([3]));
  });

  it('passes the paper to the bridge, and nothing without one', async () => {
    const { bridge } = fakeBridge();
    const platform = createElectronPlatform(bridge);

    await platform.print({ pageSize: 'Letter' });
    await platform.print();

    expect(vi.mocked(bridge.print).mock.calls).toEqual([[{ pageSize: 'Letter' }], []]);
  });

  it('forwards the history labels over the bridge', () => {
    const { bridge } = fakeBridge();

    createElectronPlatform(bridge).setHistoryLabels?.({ undo: 'setNote' });

    expect(bridge.setHistoryLabels).toHaveBeenCalledWith({ undo: 'setNote' });
  });

  it('forwards the menu keys over the bridge, and swallows a rejection', async () => {
    const { bridge } = fakeBridge();
    const platform = createElectronPlatform(bridge);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    platform.setMenuKeys?.({ 'file.save': { key: 's', mod: true } });
    expect(bridge.setMenuKeys).toHaveBeenCalledWith({ 'file.save': { key: 's', mod: true } });

    vi.mocked(bridge.setMenuKeys).mockRejectedValueOnce(new Error('gone'));
    platform.setMenuKeys?.({});
    await Promise.resolve();
    await Promise.resolve();

    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('reports the edited state, and confirms a close, over the bridge', () => {
    const { bridge } = fakeBridge();
    const platform = createElectronPlatform(bridge);

    platform.setDocumentEdited?.(true);
    platform.confirmClose?.(true);
    platform.confirmClose?.(false);

    expect(bridge.setDocumentEdited).toHaveBeenCalledWith(true);
    expect(vi.mocked(bridge.confirmClose).mock.calls).toEqual([[true], [false]]);
  });

  it('subscribes a close listener through the bridge and returns its unsubscribe', () => {
    const { bridge } = fakeBridge();
    const off = vi.fn();
    vi.mocked(bridge.onCloseRequest).mockReturnValue(off);
    const listener = vi.fn();

    const unsubscribe = createElectronPlatform(bridge).onCloseRequest?.(listener);
    unsubscribe?.();

    expect(bridge.onCloseRequest).toHaveBeenCalledWith(listener);
    expect(off).toHaveBeenCalledOnce();
  });

  it('keeps a failed report or close from rejecting into the caller', async () => {
    const { bridge } = fakeBridge();
    const failure = new Error('main is gone');
    vi.mocked(bridge.setDocumentEdited).mockRejectedValue(failure);
    vi.mocked(bridge.confirmClose).mockRejectedValue(failure);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const platform = createElectronPlatform(bridge);

    platform.setDocumentEdited?.(false);
    platform.confirmClose?.(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it('rejects any other handle without touching the bridge', async () => {
    const { bridge, writeFile } = fakeBridge();
    const platform = createElectronPlatform(bridge);

    await expect(platform.writeHandle({ kind: 'file' }, new Uint8Array([3]))).rejects.toThrow(
      'Not a file handle this platform issued',
    );
    await expect(platform.writeHandle(undefined, new Uint8Array([3]))).rejects.toThrow();
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe('the Electron platform’s file operations', () => {
  it('reads a picked file lazily through the path main granted', async () => {
    const { bridge } = fakeBridge();
    vi.mocked(bridge.openFiles).mockResolvedValue([
      { name: 'a.gp', relativePath: 'a.gp', size: 3, path: '/Users/me/a.gp' },
    ]);
    vi.mocked(bridge.readFile).mockResolvedValue(new Uint8Array([1, 2, 3]));

    const [file] = await createElectronPlatform(bridge).openFiles([]);

    expect(file).toMatchObject({ name: 'a.gp', relativePath: 'a.gp', size: 3 });
    expect(bridge.readFile).not.toHaveBeenCalled();
    await expect(file?.read()).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(bridge.readFile).toHaveBeenCalledWith('/Users/me/a.gp');
    expect(file).not.toHaveProperty('path');
  });

  it('maps a picked folder, keeping the truncation flag, and passes a cancel through', async () => {
    const { bridge } = fakeBridge();
    const platform = createElectronPlatform(bridge);
    vi.mocked(bridge.openFolder).mockResolvedValueOnce({
      name: 'tabs',
      truncated: true,
      skipped: 2,
      files: [{ name: 'b.gp', relativePath: 'x/b.gp', size: 1, path: '/Users/me/tabs/x/b.gp' }],
    });

    const folder = await platform.openFolder([]);
    expect(folder).toMatchObject({ name: 'tabs', truncated: true, skipped: 2 });
    expect(folder?.files[0]).toMatchObject({ name: 'b.gp', relativePath: 'x/b.gp', size: 1 });
    await expect(platform.openFolder([])).resolves.toBeUndefined();
  });

  it('forwards the storage calls and the recent list, and unsubscribes', async () => {
    const { bridge } = fakeBridge();
    const platform = createElectronPlatform(bridge);
    const unsubscribe = vi.fn();
    vi.mocked(bridge.onOpenRecent).mockReturnValue(unsubscribe);

    await platform.mkdir('library/songs');
    await platform.listDir('library');
    await platform.move('library/a', 'data/b');
    await platform.remove('data/b');
    platform.setRecentSongs?.([{ id: 's1', title: 'A' }]);
    const listener = vi.fn();
    platform.onOpenRecent?.(listener)();

    expect(bridge.mkdir).toHaveBeenCalledWith('library/songs');
    expect(bridge.listDir).toHaveBeenCalledWith('library');
    expect(bridge.move).toHaveBeenCalledWith('library/a', 'data/b');
    expect(bridge.remove).toHaveBeenCalledWith('data/b');
    expect(bridge.setRecentSongs).toHaveBeenCalledWith([{ id: 's1', title: 'A' }]);
    expect(bridge.onOpenRecent).toHaveBeenCalledWith(listener);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('passes a read range to the bridge for a path and for a picked file', async () => {
    const { bridge } = fakeBridge();
    vi.mocked(bridge.openFiles).mockResolvedValue([
      { name: 'a.zip', relativePath: 'a.zip', size: 9, path: '/Users/me/a.zip' },
    ]);
    const platform = createElectronPlatform(bridge);
    const [picked] = await platform.openFiles([]);

    await platform.readFile('data/sounds/a.zip', { offset: 1, length: 2 });
    await picked?.read({ offset: 3, length: 4 });
    await picked?.read();
    await platform.readFile('data/a');

    expect(vi.mocked(bridge.readFile).mock.calls).toEqual([
      ['data/sounds/a.zip', { offset: 1, length: 2 }],
      ['/Users/me/a.zip', { offset: 3, length: 4 }],
      ['/Users/me/a.zip'],
      ['data/a'],
    ]);
  });

  describe('download', () => {
    const request = {
      url: 'https://example.com/a.zip',
      to: 'data/sounds/a.zip',
      sha256: 'a'.repeat(64),
      maxBytes: 100,
    };

    it('starts it under a fresh id and forwards only its own progress', async () => {
      const { bridge, startDownload, progress } = fakeBridge();
      const seen: [number, number | undefined][] = [];
      startDownload.mockImplementation((id) => {
        progress('other', 1, 2);
        progress(id, 2, 4);
        return Promise.resolve({ size: 4 });
      });

      await expect(
        createElectronPlatform(bridge).download?.({
          ...request,
          onProgress: (loaded, total) => seen.push([loaded, total]),
        }),
      ).resolves.toEqual({ size: 4 });

      expect(seen).toEqual([[2, 4]]);
      expect(startDownload.mock.calls[0]?.slice(1)).toEqual([
        request.url,
        request.to,
        request.sha256,
        100,
      ]);
    });

    it('unsubscribes when it ends, by success or failure', async () => {
      const { bridge, startDownload, off } = fakeBridge();
      const platform = createElectronPlatform(bridge);
      const onProgress = vi.fn();

      await platform.download?.({ ...request, onProgress });
      startDownload.mockRejectedValueOnce(new Error('mismatch'));
      await expect(platform.download?.({ ...request, onProgress })).rejects.toThrow('mismatch');

      expect(off).toHaveBeenCalledTimes(2);
    });

    it('cancels through the id when the signal aborts, and rejects with an AbortError', async () => {
      const { bridge, startDownload, cancelDownload } = fakeBridge();
      const controller = new AbortController();
      startDownload.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            controller.abort();
            reject(new Error('The download was cancelled'));
          }),
      );

      await expect(
        createElectronPlatform(bridge).download?.({ ...request, signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });

      expect(cancelDownload).toHaveBeenCalledWith(startDownload.mock.calls[0]?.[0]);
    });

    it('does not start with a signal that is already aborted', async () => {
      const { bridge, startDownload } = fakeBridge();

      await expect(
        createElectronPlatform(bridge).download?.({ ...request, signal: AbortSignal.abort() }),
      ).rejects.toMatchObject({ name: 'AbortError' });

      expect(startDownload).not.toHaveBeenCalled();
    });
  });
});
