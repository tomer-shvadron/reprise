import { afterEach, describe, expect, it, vi } from 'vitest';

import { PICKED_FOLDER_LIMITS } from './bridge';
import { createBrowserPlatform } from './browser-platform';
import { MemoryDirectoryHandle } from '@/test/memory-opfs';

/** A folder the browser refuses to list, as for a permission the user did not give. */
class UnreadableDirectory extends MemoryDirectoryHandle {
  override async *entries() {
    await Promise.reject(new DOMException('denied', 'NotReadableError'));
    yield* [];
  }
}

const filters = [{ name: 'Guitar Pro', extensions: ['gp', 'gp5'] }];

afterEach(() => {
  delete window.showOpenFilePicker;
  delete window.showDirectoryPicker;
  vi.restoreAllMocks();
});

function fileWith(name: string, bytes: number[], relativePath?: string): File {
  const file = new File([new Uint8Array(bytes)], name);
  if (relativePath !== undefined) {
    Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  }
  return file;
}

/** Stands in for the user choosing `files` in the input's dialog, or cancelling with none. */
function answerInput(files: File[] | 'cancel') {
  return vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement,
  ) {
    if (files === 'cancel') {
      this.dispatchEvent(new Event('cancel'));
      return;
    }
    Object.defineProperty(this, 'files', { value: files });
    this.dispatchEvent(new Event('change'));
  });
}

describe('openFiles', () => {
  it('reads each file picked through the input fallback lazily', async () => {
    const a = fileWith('a.gp', [1, 2]);
    const read = vi.spyOn(a, 'arrayBuffer');
    const click = answerInput([a, fileWith('b.gp5', [3])]);

    const files = await createBrowserPlatform().openFiles(filters);

    expect(click.mock.contexts[0]).toMatchObject({ multiple: true, accept: '.gp,.gp5' });
    expect(files.map(({ name, relativePath, size }) => [name, relativePath, size])).toEqual([
      ['a.gp', 'a.gp', 2],
      ['b.gp5', 'b.gp5', 1],
    ]);
    expect(read).not.toHaveBeenCalled();
    await expect(files[0]?.read()).resolves.toEqual(new Uint8Array([1, 2]));
  });

  it('resolves [] when the input is cancelled', async () => {
    answerInput('cancel');
    await expect(createBrowserPlatform().openFiles(filters)).resolves.toEqual([]);
  });

  it('asks the File System Access picker for several files, and treats abort as cancel', async () => {
    const handle = { getFile: () => Promise.resolve(fileWith('a.gp', [9])) };
    const picker = vi.fn(() => Promise.resolve([handle as unknown as FileSystemFileHandle]));
    window.showOpenFilePicker = picker;

    const files = await createBrowserPlatform().openFiles(filters);

    expect(picker).toHaveBeenCalledWith({
      types: [
        { description: 'Guitar Pro', accept: { 'application/octet-stream': ['.gp', '.gp5'] } },
      ],
      multiple: true,
    });
    await expect(files[0]?.read()).resolves.toEqual(new Uint8Array([9]));

    window.showOpenFilePicker = () => Promise.reject(new DOMException('', 'AbortError'));
    await expect(createBrowserPlatform().openFiles(filters)).resolves.toEqual([]);
  });
});

describe('openFolder with the directory picker', () => {
  async function tabsFolder(): Promise<MemoryDirectoryHandle> {
    const root = new MemoryDirectoryHandle('tabs');
    await root.put('b.GP5', new Uint8Array([1]));
    await root.put('a.gp', new Uint8Array([1, 2]));
    await root.put('readme.txt', new Uint8Array([0]));
    await root.put('.hidden/x.gp', new Uint8Array([0]));
    await root.put('sub/deep/c.gp', new Uint8Array([3]));
    return root;
  }

  it('walks it recursively, filtered, in name order, skipping dot entries', async () => {
    window.showDirectoryPicker = async () =>
      (await tabsFolder()) as unknown as FileSystemDirectoryHandle;

    const folder = await createBrowserPlatform().openFolder(filters);

    expect(folder).toMatchObject({ name: 'tabs', truncated: false });
    expect(folder?.skipped).toBe(0);
    expect(folder?.files.map((f) => [f.relativePath, f.name, f.size])).toEqual([
      ['a.gp', 'a.gp', 2],
      ['b.GP5', 'b.GP5', 1],
      ['sub/deep/c.gp', 'c.gp', 1],
    ]);
    await expect(folder?.files[2]?.read()).resolves.toEqual(new Uint8Array([3]));
  });

  it('resolves undefined on abort', async () => {
    window.showDirectoryPicker = () => Promise.reject(new DOMException('', 'AbortError'));
    await expect(createBrowserPlatform().openFolder(filters)).resolves.toBeUndefined();
  });

  it('reports a walk cut by the depth limit', async () => {
    const root = new MemoryDirectoryHandle('deep');
    const path = Array.from(
      { length: PICKED_FOLDER_LIMITS.maxDepth + 1 },
      (_, i) => `d${String(i)}`,
    );
    await root.put(`${path.join('/')}/x.gp`, new Uint8Array([1]));
    await root.put('top.gp', new Uint8Array([1]));
    window.showDirectoryPicker = () =>
      Promise.resolve(root as unknown as FileSystemDirectoryHandle);

    const folder = await createBrowserPlatform().openFolder(filters);

    expect(folder?.truncated).toBe(true);
    expect(folder?.files.map((f) => f.relativePath)).toEqual(['top.gp']);
  });
});

describe('openFolder with an unreadable subfolder or a name without a dot', () => {
  it('skips and counts an unreadable subfolder, and matches an extension only after a dot', async () => {
    const root = new MemoryDirectoryHandle('tabs');
    await root.put('ok.gp', new Uint8Array([1]));
    await root.put('gp5', new Uint8Array([1]));
    root.entries_.set('locked', new UnreadableDirectory('locked'));
    window.showDirectoryPicker = () =>
      Promise.resolve(root as unknown as FileSystemDirectoryHandle);

    const folder = await createBrowserPlatform().openFolder(filters);

    expect(folder?.files.map((f) => f.relativePath)).toEqual(['ok.gp']);
    expect(folder?.skipped).toBe(1);
  });

  it('rejects when the picked folder itself cannot be listed', async () => {
    window.showDirectoryPicker = () =>
      Promise.resolve(new UnreadableDirectory('tabs') as unknown as FileSystemDirectoryHandle);

    await expect(createBrowserPlatform().openFolder(filters)).rejects.toThrow();
  });
});

describe('openFolder with the directory input fallback', () => {
  it('names the folder, strips it from each path, and filters', async () => {
    answerInput([
      fileWith('b.gp', [1], 'tabs/sub/b.gp'),
      fileWith('a.gp5', [1, 2], 'tabs/a.gp5'),
      fileWith('notes.txt', [0], 'tabs/notes.txt'),
      fileWith('x.gp', [0], 'tabs/.git/x.gp'),
    ]);

    const folder = await createBrowserPlatform().openFolder(filters);

    expect(folder).toMatchObject({ name: 'tabs', truncated: false });
    expect(folder?.files.map((f) => [f.relativePath, f.size])).toEqual([
      ['a.gp5', 2],
      ['sub/b.gp', 1],
    ]);
  });

  it('marks a pick past the file limit as truncated', async () => {
    const many = Array.from({ length: PICKED_FOLDER_LIMITS.maxFiles + 1 }, (_, i) =>
      fileWith(`s${String(i).padStart(5, '0')}.gp`, [1], `big/s${String(i).padStart(5, '0')}.gp`),
    );
    answerInput(many);

    const folder = await createBrowserPlatform().openFolder(filters);

    expect(folder?.files).toHaveLength(PICKED_FOLDER_LIMITS.maxFiles);
    expect(folder?.truncated).toBe(true);
  });

  it('resolves undefined on cancel or an empty pick', async () => {
    answerInput('cancel');
    await expect(createBrowserPlatform().openFolder(filters)).resolves.toBeUndefined();
    vi.restoreAllMocks();
    answerInput([]);
    await expect(createBrowserPlatform().openFolder(filters)).resolves.toBeUndefined();
  });
});
