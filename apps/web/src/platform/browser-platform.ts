import type { FileFilter, OpenedFile, Platform } from './platform';

/** Virtual paths inside origin-private storage; the browser has no real filesystem paths. */
export const BROWSER_LIBRARY_DIR = '/library';
export const BROWSER_DATA_DIR = '/data';

function extensionsOf(filters: readonly FileFilter[]): string[] {
  return filters.flatMap(({ extensions }) => extensions.map((ext) => `.${ext}`));
}

function pickerTypes(filters: readonly FileFilter[]): FilePickerAcceptType[] {
  return filters.map(({ name, extensions }) => ({
    description: name,
    accept: { 'application/octet-stream': extensions.map((ext) => `.${ext}`) },
  }));
}

// The DOM lib takes views over a plain ArrayBuffer; a copy rules out a SharedArrayBuffer-backed one.
const plainCopy = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => bytes.slice();

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function pickWithInput(doc: Document, filters: readonly FileFilter[]): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = extensionsOf(filters).join(',');
    input.addEventListener('change', () => {
      resolve(input.files?.[0]);
    });
    input.addEventListener('cancel', () => {
      resolve(undefined);
    });
    input.click();
  });
}

function download(doc: Document, name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([plainCopy(bytes)]));
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Revoking synchronously can cancel the download before the browser has read the blob.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/** Splits a virtual path into directory names and a file name, rejecting `..` and empties. */
export function splitStoragePath(path: string): { dirs: string[]; name: string } {
  const segments = path.split('/').filter((segment) => segment !== '' && segment !== '.');
  const name = segments.pop();
  if (!path.startsWith('/') || name === undefined || segments.includes('..') || name === '..') {
    throw new Error(`Not a storage path: "${path}"`);
  }
  return { dirs: segments, name };
}

async function storageRoot(win: Window): Promise<FileSystemDirectoryHandle> {
  // The DOM lib types OPFS as always present; older engines and insecure origins lack it.
  if (!('storage' in win.navigator) || !('getDirectory' in win.navigator.storage)) {
    throw new Error('Origin-private storage is not available in this browser');
  }
  return win.navigator.storage.getDirectory();
}

async function storageDir(
  win: Window,
  dirs: readonly string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = await storageRoot(win);
  for (const name of dirs) dir = await dir.getDirectoryHandle(name, { create });
  return dir;
}

async function writeHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(plainCopy(bytes));
  await writable.close();
}

function isFileHandle(value: unknown): value is FileSystemFileHandle {
  return typeof value === 'object' && value !== null && 'createWritable' in value;
}

export function requestMicrophone(win: Window = window): Promise<MediaStream> {
  return win.navigator.mediaDevices.getUserMedia({ audio: true });
}

export function createBrowserPlatform(win: Window = window): Platform {
  // A picked file has no path the page can see, so saveFile hands out a key to its handle.
  const savedHandles = new Map<string, FileSystemFileHandle>();
  let nextHandle = 0;

  async function storageFile(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const saved = savedHandles.get(path);
    if (saved) return saved;
    const { dirs, name } = splitStoragePath(path);
    const dir = await storageDir(win, dirs, create);
    return dir.getFileHandle(name, { create });
  }

  async function ensureDir(path: string): Promise<string> {
    await storageDir(win, path.split('/').filter(Boolean), true);
    return path;
  }

  return {
    async openFile(filters): Promise<OpenedFile | undefined> {
      let file: File | undefined;
      let handle: FileSystemFileHandle | undefined;
      if (win.showOpenFilePicker) {
        try {
          [handle] = await win.showOpenFilePicker({ types: pickerTypes(filters) });
          file = await handle?.getFile();
        } catch (error) {
          if (isAbort(error)) return undefined;
          throw error;
        }
      } else {
        file = await pickWithInput(win.document, filters);
      }
      if (!file) return undefined;
      const bytes = new Uint8Array(await file.arrayBuffer());
      return handle ? { name: file.name, bytes, handle } : { name: file.name, bytes };
    },

    async saveFile(suggestedName, bytes, filters) {
      if (!win.showSaveFilePicker) {
        download(win.document, suggestedName, bytes);
        return undefined;
      }
      let handle: FileSystemFileHandle;
      try {
        handle = await win.showSaveFilePicker({ suggestedName, types: pickerTypes(filters) });
      } catch (error) {
        if (isAbort(error)) return undefined;
        throw error;
      }
      await writeHandle(handle, bytes);
      const key = `picked:${String(nextHandle++)}/${handle.name}`;
      savedHandles.set(key, handle);
      return key;
    },

    async readFile(path) {
      const file = await (await storageFile(path, false)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    },

    async writeFile(path, bytes) {
      await writeHandle(await storageFile(path, true), bytes);
    },

    async writeHandle(handle, bytes) {
      if (typeof handle === 'string') {
        await writeHandle(await storageFile(handle, true), bytes);
        return;
      }
      if (!isFileHandle(handle)) throw new Error('Not a file handle this platform issued');
      await writeHandle(handle, bytes);
    },

    libraryDir: () => ensureDir(BROWSER_LIBRARY_DIR),
    dataDir: () => ensureDir(BROWSER_DATA_DIR),

    print() {
      win.print();
      return Promise.resolve();
    },

    microphone: () => requestMicrophone(win),
  };
}
