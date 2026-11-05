import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RepriseBridge } from './bridge';

function fakeBridge(): RepriseBridge {
  return {
    openFile: vi.fn(() => Promise.resolve({ name: 'song.gp5', bytes: new Uint8Array([7]) })),
    saveFile: vi.fn(() => Promise.resolve('/Users/me/song.gp5')),
    readFile: vi.fn(() => Promise.resolve(new Uint8Array([1]))),
    writeFile: vi.fn(() => Promise.resolve(undefined)),
    libraryDir: vi.fn(() => Promise.resolve('/Users/me/Music/Reprise')),
    dataDir: vi.fn(() => Promise.resolve('/Users/me/Library/Application Support/Reprise')),
    print: vi.fn(() => Promise.resolve(undefined)),
    onMenuCommand: vi.fn(() => () => undefined),
  };
}

async function freshPlatform() {
  vi.resetModules();
  return (await import('./select-platform')).platform;
}

afterEach(() => {
  delete window.reprise;
});

describe('platform()', () => {
  it('uses the preload bridge when Electron exposes one', async () => {
    const bridge = fakeBridge();
    window.reprise = bridge;
    const platform = await freshPlatform();

    const filters = [{ name: 'Guitar Pro', extensions: ['gp5'] }];
    await expect(platform().openFile(filters)).resolves.toEqual({
      name: 'song.gp5',
      bytes: new Uint8Array([7]),
    });
    await expect(platform().libraryDir()).resolves.toBe('/Users/me/Music/Reprise');
    await platform().writeFile('/Users/me/song.gp5', new Uint8Array([2]));

    expect(bridge.openFile).toHaveBeenCalledWith(filters);
    expect(bridge.writeFile).toHaveBeenCalledWith('/Users/me/song.gp5', new Uint8Array([2]));
  });

  it('falls back to the browser implementation without a bridge', async () => {
    const platform = await freshPlatform();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);

    void platform().openFile([{ name: 'Guitar Pro', extensions: ['gp5'] }]);

    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.contexts[0]).toMatchObject({ type: 'file', accept: '.gp5' });
  });

  it('chooses once and keeps the choice', async () => {
    const platform = await freshPlatform();
    const first = platform();
    window.reprise = fakeBridge();

    expect(platform()).toBe(first);
  });
});
