/**
 * An in-memory origin-private file system with the slice of the File System Access API the
 * platform uses: directories, files, `entries`, `removeEntry` and `createWritable`, and the
 * errors a browser throws (`NotFoundError`, `TypeMismatchError`). `move` is optional because
 * engines differ, and the platform must work without it.
 */

/** `true` moves natively; `false` has no `move`; the others make it reject, as engines do. */
export type MoveMode = boolean | 'unsupported' | 'broken';

class MemoryFileHandle {
  readonly kind = 'file';
  bytes: Uint8Array<ArrayBuffer> = new Uint8Array();

  constructor(
    readonly name: string,
    private readonly owner: MemoryDirectoryHandle,
    private readonly withMove: MoveMode,
  ) {
    if (withMove) {
      Object.defineProperty(this, 'move', {
        value: (destination: MemoryDirectoryHandle, name: string) => {
          if (withMove === 'unsupported') {
            return Promise.reject(new DOMException('no', 'NotSupportedError'));
          }
          if (withMove === 'broken') return Promise.reject(new Error('move failed'));
          this.owner.entries_.delete(this.name);
          destination.entries_.set(name, new MemoryFileHandle(name, destination, this.withMove));
          const moved = destination.entries_.get(name);
          if (moved instanceof MemoryFileHandle) moved.bytes = this.bytes;
          return Promise.resolve();
        },
      });
    }
  }

  getFile(): Promise<File> {
    return Promise.resolve(new File([this.bytes.slice()], this.name));
  }

  createWritable() {
    const chunks: Uint8Array[] = [];
    return Promise.resolve({
      write: (data: BufferSource) => {
        chunks.push(
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        );
        return Promise.resolve();
      },
      close: () => {
        this.bytes = Uint8Array.from(chunks.flatMap((chunk) => [...chunk]));
        return Promise.resolve();
      },
    });
  }
}

export class MemoryDirectoryHandle {
  readonly kind = 'directory';
  readonly entries_ = new Map<string, MemoryFileHandle | MemoryDirectoryHandle>();

  constructor(
    readonly name = '',
    private readonly withMove: MoveMode = true,
  ) {}

  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectoryHandle> {
    const existing = this.entries_.get(name);
    if (existing instanceof MemoryDirectoryHandle) return Promise.resolve(existing);
    if (existing) return Promise.reject(new DOMException('is a file', 'TypeMismatchError'));
    if (!options?.create) return Promise.reject(new DOMException('missing', 'NotFoundError'));
    const created = new MemoryDirectoryHandle(name, this.withMove);
    this.entries_.set(name, created);
    return Promise.resolve(created);
  }

  getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFileHandle> {
    const existing = this.entries_.get(name);
    if (existing instanceof MemoryFileHandle) return Promise.resolve(existing);
    if (existing) return Promise.reject(new DOMException('is a directory', 'TypeMismatchError'));
    if (!options?.create) return Promise.reject(new DOMException('missing', 'NotFoundError'));
    const created = new MemoryFileHandle(name, this, this.withMove);
    this.entries_.set(name, created);
    return Promise.resolve(created);
  }

  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const existing = this.entries_.get(name);
    if (!existing) return Promise.reject(new DOMException('missing', 'NotFoundError'));
    if (
      existing instanceof MemoryDirectoryHandle &&
      existing.entries_.size > 0 &&
      !options?.recursive
    ) {
      return Promise.reject(new DOMException('not empty', 'InvalidModificationError'));
    }
    this.entries_.delete(name);
    return Promise.resolve();
  }

  async *entries(): AsyncGenerator<[string, MemoryFileHandle | MemoryDirectoryHandle]> {
    await Promise.resolve();
    for (const entry of [...this.entries_]) yield entry;
  }

  /** Test helper: puts a file at a '/'-separated path, making its directories. */
  async put(path: string, bytes: Uint8Array): Promise<void> {
    const names = path.split('/');
    const fileName = names.pop() ?? '';
    const dir = await names.reduce<Promise<MemoryDirectoryHandle>>(
      async (parent, name) => (await parent).getDirectoryHandle(name, { create: true }),
      Promise.resolve(this),
    );
    (await dir.getFileHandle(fileName, { create: true })).bytes = new Uint8Array(bytes);
  }

  /** Test helper: every file as '/'-separated path, sorted; directories end in '/'. */
  tree(prefix = ''): string[] {
    return [...this.entries_]
      .flatMap(([name, handle]) =>
        handle instanceof MemoryDirectoryHandle
          ? [`${prefix}${name}/`, ...handle.tree(`${prefix}${name}/`)]
          : [`${prefix}${name}`],
      )
      .sort();
  }
}

/** Installs the fake as `win.navigator.storage` and returns its root; `persist` is a spy slot. */
export function installMemoryOpfs(
  win: Window,
  options: { withMove?: MoveMode; persist?: () => Promise<boolean> } = {},
): MemoryDirectoryHandle {
  const root = new MemoryDirectoryHandle('', options.withMove ?? true);
  Object.defineProperty(win.navigator, 'storage', {
    configurable: true,
    value: {
      getDirectory: () => Promise.resolve(root),
      ...(options.persist && { persist: options.persist }),
    },
  });
  return root;
}

export function removeMemoryOpfs(win: Window): void {
  Reflect.deleteProperty(win.navigator, 'storage');
}
