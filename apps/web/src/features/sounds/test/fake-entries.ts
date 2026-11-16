/**
 * Fake `FileSystemEntry` trees for a dropped folder. Only what `walkDroppedFolder` and
 * `snapshotPackDrop` read exists on them, so the types are narrowed by hand.
 */
export interface FakeNode {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export function fakeFile(name: string, content: Uint8Array | string = 'x') {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (ok: (file: File) => void) => {
      ok(new File([typeof content === 'string' ? content : content.slice()], name));
    },
  };
}

export interface FakeDirOptions {
  /** Entries returned per `readEntries` call, like Chromium's batches of about 100. */
  batch?: number;
  /** `readEntries` fails. */
  fail?: boolean;
}

export function fakeDir(name: string, children: readonly FakeNode[], options: FakeDirOptions = {}) {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let at = 0;
      return {
        readEntries: (ok: (entries: FakeNode[]) => void, fail: (error: Error) => void) => {
          if (options.fail) {
            fail(new Error('not allowed'));
            return;
          }
          const batch = children.slice(at, at + (options.batch ?? 100));
          at += batch.length;
          ok(batch);
        },
      };
    },
  };
}
