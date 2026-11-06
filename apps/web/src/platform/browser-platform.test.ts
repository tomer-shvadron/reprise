import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserPlatform, splitStoragePath } from './browser-platform';

const filters = [{ name: 'Guitar Pro', extensions: ['gp', 'gp5'] }];

afterEach(() => {
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
  vi.restoreAllMocks();
});

describe('browser platform', () => {
  it('reads the file picked through the input fallback', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      const file = new File([new Uint8Array([1, 2, 3])], 'song.gp5');
      Object.defineProperty(this, 'files', { value: [file] });
      this.dispatchEvent(new Event('change'));
    });

    await expect(createBrowserPlatform().openFile(filters)).resolves.toEqual({
      name: 'song.gp5',
      bytes: new Uint8Array([1, 2, 3]),
    });
  });

  it('asks the File System Access picker for the filtered types, and treats abort as cancel', async () => {
    const showOpenFilePicker = vi.fn(() => Promise.reject(new DOMException('', 'AbortError')));
    window.showOpenFilePicker = showOpenFilePicker;

    await expect(createBrowserPlatform().openFile(filters)).resolves.toBeUndefined();
    expect(showOpenFilePicker).toHaveBeenCalledWith({
      types: [
        { description: 'Guitar Pro', accept: { 'application/octet-stream': ['.gp', '.gp5'] } },
      ],
    });
  });

  it('hands out the picked file’s handle and writes over it in place', async () => {
    const write = vi.fn(() => Promise.resolve());
    const close = vi.fn(() => Promise.resolve());
    const handle = {
      name: 'song.reprise',
      getFile: () => Promise.resolve(new File([new Uint8Array([7])], 'song.reprise')),
      createWritable: vi.fn(() => Promise.resolve({ write, close })),
    };
    window.showOpenFilePicker = vi.fn(() =>
      Promise.resolve([handle as unknown as FileSystemFileHandle]),
    );
    const platform = createBrowserPlatform();

    const opened = await platform.openFile(filters);
    expect(opened).toEqual({ name: 'song.reprise', bytes: new Uint8Array([7]), handle });
    await platform.writeHandle(opened?.handle, new Uint8Array([8]));

    expect(handle.createWritable).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(new Uint8Array([8]));
    expect(close).toHaveBeenCalledOnce();
    await expect(platform.writeHandle(42, new Uint8Array([8]))).rejects.toThrow(
      /Not a file handle/,
    );
  });

  it('downloads when there is no save picker, with no path to write back to', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:song');
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    await expect(
      createBrowserPlatform().saveFile('song.gp5', new Uint8Array([1]), filters),
    ).resolves.toBeUndefined();
    expect(click.mock.contexts[0]).toMatchObject({ download: 'song.gp5', href: 'blob:song' });
  });

  it('prints the page', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await createBrowserPlatform().print();
    expect(print).toHaveBeenCalledOnce();
  });

  it('rejects storage access when origin-private storage is missing', async () => {
    await expect(createBrowserPlatform().libraryDir()).rejects.toThrow(/Origin-private storage/);
  });
});

describe('splitStoragePath', () => {
  it('splits a virtual path', () => {
    expect(splitStoragePath('/library/rock/song.gp5')).toEqual({
      dirs: ['library', 'rock'],
      name: 'song.gp5',
    });
  });

  it.each([['library/song.gp5'], ['/'], ['/library/../secret'], ['/library/..']])(
    'rejects %j',
    (path) => {
      expect(() => splitStoragePath(path)).toThrow(/Not a storage path/);
    },
  );
});
