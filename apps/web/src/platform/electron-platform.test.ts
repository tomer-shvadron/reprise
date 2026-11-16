import { describe, expect, it, vi } from 'vitest';

import type { RepriseBridge } from './bridge';
import { createElectronPlatform } from './electron-platform';

function fakeBridge() {
  const writeFile = vi.fn<RepriseBridge['writeFile']>(() => Promise.resolve(undefined));
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
    onOpenRecent: vi.fn(() => () => undefined),
    setDocumentEdited: vi.fn(() => Promise.resolve(undefined)),
    confirmClose: vi.fn(() => Promise.resolve(undefined)),
    onCloseRequest: vi.fn(() => () => undefined),
  };
  return { bridge, writeFile };
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
});
