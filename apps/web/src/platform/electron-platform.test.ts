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
    libraryDir: vi.fn(() => Promise.resolve('/library')),
    dataDir: vi.fn(() => Promise.resolve('/data')),
    print: vi.fn(() => Promise.resolve(undefined)),
    onMenuCommand: vi.fn(() => () => undefined),
  };
  return { bridge, writeFile };
}

describe('the Electron platform', () => {
  it('writes a handle main issued, a path, through the bridge', async () => {
    const { bridge, writeFile } = fakeBridge();

    await createElectronPlatform(bridge).writeHandle('/Users/me/song.gp', new Uint8Array([3]));

    expect(writeFile).toHaveBeenCalledWith('/Users/me/song.gp', new Uint8Array([3]));
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
