import {
  PICKED_FOLDER_LIMITS,
  type FileFilter,
  type PickedFile,
  type PickedFolder,
} from './bridge';

function pickerTypes(filters: readonly FileFilter[]): FilePickerAcceptType[] {
  return filters.map(({ name, extensions }) => ({
    description: name,
    accept: { 'application/octet-stream': extensions.map((ext) => `.${ext}`) },
  }));
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function pickedFile(file: File, relativePath: string): PickedFile {
  return {
    name: file.name,
    relativePath,
    size: file.size,
    read: async () => new Uint8Array(await file.arrayBuffer()),
  };
}

/** Lower-case extension without the dot; '' for a name with no dot, as Node's `extname` gives. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function isUnreadable(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotReadableError';
}

function wantedExtensions(filters: readonly FileFilter[]): Set<string> {
  return new Set(filters.flatMap(({ extensions }) => extensions.map((ext) => ext.toLowerCase())));
}

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `<input type=file>` for engines without the pickers; resolves [] on cancel. */
function pickWithInput(
  doc: Document,
  filters: readonly FileFilter[],
  mode: 'files' | 'directory',
): Promise<File[]> {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    if (mode === 'files') {
      input.multiple = true;
      input.accept = filters.flatMap(({ extensions }) => extensions.map((e) => `.${e}`)).join(',');
    } else {
      input.webkitdirectory = true;
    }
    input.addEventListener('change', () => {
      resolve([...(input.files ?? [])]);
    });
    input.addEventListener('cancel', () => {
      resolve([]);
    });
    input.click();
  });
}

export async function pickFiles(
  win: Window,
  filters: readonly FileFilter[],
): Promise<PickedFile[]> {
  let files: File[];
  if (win.showOpenFilePicker) {
    try {
      const handles = await win.showOpenFilePicker({ types: pickerTypes(filters), multiple: true });
      files = await Promise.all(handles.map((handle) => handle.getFile()));
    } catch (error) {
      if (isAbort(error)) return [];
      throw error;
    }
  } else {
    files = await pickWithInput(win.document, filters, 'files');
  }
  return files.map((file) => pickedFile(file, file.name));
}

async function walkDirectory(
  root: FileSystemDirectoryHandle,
  filters: readonly FileFilter[],
): Promise<PickedFolder> {
  const wanted = wantedExtensions(filters);
  const { maxFiles, maxDepth, maxEntries } = PICKED_FOLDER_LIMITS;
  const files: PickedFile[] = [];
  let truncated = false;
  // Only the file and entry caps end the walk; a folder cut by depth leaves its siblings listed.
  let full = false;
  let visited = 0;
  let skipped = 0;

  async function walk(dir: FileSystemDirectoryHandle, prefix: string, depth: number) {
    const entries: [string, FileSystemFileHandle | FileSystemDirectoryHandle][] = [];
    try {
      for await (const entry of dir.entries()) entries.push(entry);
    } catch (error) {
      if (depth === 0 || !isUnreadable(error)) throw error;
      skipped += 1;
      return;
    }
    entries.sort(([a], [b]) => byName(a, b));
    for (const [name, handle] of entries) {
      if (full) return;
      if (visited >= maxEntries) {
        truncated = full = true;
        return;
      }
      visited += 1;
      if (name.startsWith('.')) continue;
      const relativePath = prefix === '' ? name : `${prefix}/${name}`;
      if (handle.kind === 'directory') {
        if (depth >= maxDepth) truncated = true;
        else await walk(handle, relativePath, depth + 1);
      } else if (wanted.has(extensionOf(name))) {
        if (files.length >= maxFiles) truncated = full = true;
        else {
          try {
            files.push(pickedFile(await handle.getFile(), relativePath));
          } catch (error) {
            if (!isUnreadable(error)) throw error;
            skipped += 1;
          }
        }
      }
    }
  }

  await walk(root, '', 0);
  return { name: root.name, files, truncated, skipped };
}

/** The same walk over what a `webkitdirectory` input returned: every file, already flattened. */
function folderFromInput(files: readonly File[], filters: readonly FileFilter[]): PickedFolder {
  const wanted = wantedExtensions(filters);
  const { maxFiles, maxDepth } = PICKED_FOLDER_LIMITS;
  const name = files[0]?.webkitRelativePath.split('/')[0] ?? '';
  const picked: PickedFile[] = [];
  let truncated = false;
  for (const file of [...files].sort((a, b) =>
    byName(a.webkitRelativePath, b.webkitRelativePath),
  )) {
    // The first segment is the picked folder itself.
    const inside = file.webkitRelativePath.split('/').slice(1);
    if (inside.some((segment) => segment.startsWith('.'))) continue;
    if (!wanted.has(extensionOf(file.name))) continue;
    if (inside.length - 1 > maxDepth || picked.length >= maxFiles) {
      truncated = true;
      continue;
    }
    picked.push(pickedFile(file, inside.join('/')));
  }
  return { name, files: picked, truncated, skipped: 0 };
}

export async function pickFolder(
  win: Window,
  filters: readonly FileFilter[],
): Promise<PickedFolder | undefined> {
  if (win.showDirectoryPicker) {
    try {
      return await walkDirectory(await win.showDirectoryPicker(), filters);
    } catch (error) {
      if (isAbort(error)) return undefined;
      throw error;
    }
  }
  const files = await pickWithInput(win.document, filters, 'directory');
  // An empty pick cannot be told from a cancel: the input fires nothing for either.
  return files.length === 0 ? undefined : folderFromInput(files, filters);
}
